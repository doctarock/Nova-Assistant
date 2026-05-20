export function createIntakePlannerService({
  buildIntakeSystemPrompt,
  buildPostToolDecisionInstruction,
  buildTranscriptForPrompt,
  compactHookText,
  executeIntakeToolCall,
  extractJsonObject,
  getBrain,
  intakeMessageExplicitlyRequestsScheduling,
  intakeLeaseWaitMs,
  intakePlanTimeoutMs,
  isLightweightPlannerReplyRequest,
  looksLikeLowSignalPlannerTaskMessage,
  modelKeepAlive,
  normalizeAgentSelfReference,
  normalizeIntakeReplyText,
  normalizeToolCallRecord,
  parseToolCallArgs,
  pluginManagerProvider,
  runOllamaJsonGenerate,
  shapePlannerTaskMessage
} = {}) {
  async function planIntakeWithBitNet({
    message,
    sessionId = "Main",
    internetEnabled = true,
    selectedMountIds = [],
    forceToolUse = false,
    recentExchanges = [],
    systemContext = {}
  } = {}) {
    const intakeBrain = await getBrain("bitnet");
    const systemPrompt = await buildIntakeSystemPrompt({
      internetEnabled,
      selectedMountIds,
      forceToolUse,
      sessionId,
      recentExchanges,
      systemContext
    });
    let parsed = null;
    const transcript = [];
    for (let step = 0; step < 4; step += 1) {
      const toolHistory = transcript.length
        ? `\n\nConversation so far:\n${buildTranscriptForPrompt(transcript)}`
        : "";
      const result = await runOllamaJsonGenerate(intakeBrain.model, `${systemPrompt}${toolHistory}\n\nUser message:\n${message}`, {
        timeoutMs: intakePlanTimeoutMs,
        keepAlive: modelKeepAlive,
        options: {
          num_gpu: 0
        },
        baseUrl: intakeBrain.ollamaBaseUrl,
        brainId: intakeBrain.id,
        leaseOwnerId: `intake:${String(sessionId || "Main").trim() || "Main"}`,
        leaseWaitMs: intakeLeaseWaitMs
      });
      if (!result.ok) {
        throw new Error(result.stderr || "CPU intake planning failed");
      }
      try {
        parsed = extractJsonObject(result.text);
      } catch {
        parsed = null;
        break;
      }
      const toolCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls.map((call, index) => normalizeToolCallRecord(call, index)) : [];
      if (parsed.final || !toolCalls.length) {
        break;
      }
      const toolResults = [];
      for (const toolCall of toolCalls.slice(0, 4)) {
        try {
          const toolResult = await executeIntakeToolCall(toolCall);
          toolResults.push({
            tool_call_id: String(toolCall.id || `call_${toolResults.length + 1}`),
            name: String(toolCall?.function?.name || ""),
            arguments: parseToolCallArgs(toolCall),
            result: toolResult
          });
        } catch (error) {
          toolResults.push({
            tool_call_id: String(toolCall.id || `call_${toolResults.length + 1}`),
            name: String(toolCall?.function?.name || ""),
            arguments: parseToolCallArgs(toolCall),
            error: error.message || "tool failed"
          });
        }
      }
      transcript.push({
        role: "assistant",
        assistant_message: String(parsed.assistant_message || "").trim(),
        action: parsed.action || "",
        tool_calls: toolCalls
      });
      transcript.push({
        role: "tool",
        tool_results: toolResults
      });
      transcript.push({
        role: "assistant",
        assistant_message: buildPostToolDecisionInstruction(toolResults)
      });
    }
    if (!parsed) {
      const inferredEvery = (() => {
        const match = String(message || "").toLowerCase().match(/\bevery\s+(\d+\s*(?:ms|s|m|h|d))\b/);
        return match ? match[1].replace(/\s+/g, "") : "";
      })();
      parsed = {
        final_text: inferredEvery
          ? "I'll queue that as a periodic worker task."
          : "I'll queue that for the worker.",
        action: "enqueue",
        tasks: [
          {
            message: String(message || "").trim(),
            every: inferredEvery,
            delay: ""
          }
        ],
        reason: "Fallback intake plan after non-JSON model output",
        final: true
      };
    }
    let action = parsed.action === "reply_only" ? "reply_only" : parsed.action === "clarify" ? "clarify" : "enqueue";
    const explicitScheduleRequested = intakeMessageExplicitlyRequestsScheduling(message);
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .map((task) => ({
            message: String(task?.message || "").trim(),
            every: explicitScheduleRequested && task?.every ? String(task.every).trim() : "",
            delay: explicitScheduleRequested && task?.delay ? String(task.delay).trim() : ""
          }))
          .filter((task) => task.message)
      : [];
    const rawReplyText = normalizeAgentSelfReference(String(parsed.final_text || parsed.reply_text || parsed.assistant_message || "").trim());
    if (
      action === "enqueue"
      && tasks.length === 1
      && tasks[0].message === String(message || "").trim()
      && !tasks[0].every
      && !tasks[0].delay
      && isLightweightPlannerReplyRequest(message)
    ) {
      action = "reply_only";
      tasks.length = 0;
    }
    if (
      action === "enqueue"
      && transcript.length
      && rawReplyText
      && (!tasks.length || (tasks.length === 1 && tasks[0].message === String(message || "").trim() && !tasks[0].every && !tasks[0].delay))
    ) {
      action = "reply_only";
      tasks.length = 0;
    }
    if (action !== "reply_only" && action !== "clarify" && !tasks.length) {
      const inferredEvery = (() => {
        const match = String(message || "").toLowerCase().match(/\bevery\s+(\d+\s*(?:ms|s|m|h|d))\b/);
        return match ? match[1].replace(/\s+/g, "") : "";
      })();
      tasks.push({
        message: String(message || "").trim(),
        every: inferredEvery,
        delay: ""
      });
    }
    if (
      action === "enqueue"
      && rawReplyText
      && isLightweightPlannerReplyRequest(message)
    ) {
      action = "reply_only";
      tasks.length = 0;
    }
    if (action === "enqueue") {
      for (const task of tasks) {
        if (looksLikeLowSignalPlannerTaskMessage(task.message, message)) {
          task.message = shapePlannerTaskMessage(message);
        }
      }
    }
    const replyText = normalizeIntakeReplyText({
      message,
      action,
      replyText: rawReplyText
    });
    if (action === "reply_only" || action === "clarify") {
      pluginManagerProvider()?.runHook?.("intake:reply-complete", {
        at: Date.now(),
        action,
        sessionId: String(sessionId || "Main").trim(),
        messagePreview: compactHookText(String(message || "").trim(), 200),
        replyPreview: compactHookText(String(replyText || "").trim(), 300)
      }).catch(() => {});
    }
    return {
      replyText,
      action,
      tasks,
      reason: String(parsed.reason || "").trim() || "CPU intake decision",
      modelUsed: intakeBrain.model,
      fallbackReason: ""
    };
  }

  return { planIntakeWithBitNet };
}
