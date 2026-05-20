export function createObserverEscalationReview(context = {}) {
  const {
    MAX_TASK_RESHAPE_ATTEMPTS,
    MODEL_KEEPALIVE,
    buildConcreteReviewReason,
    buildEscalationCloseRecommendation,
    buildEscalationSplitProjectWorkKey,
    buildProjectCycleFollowUpMessage,
    buildRetryTaskMeta,
    canReshapeTask,
    chooseEscalationRetryBrainId,
    choosePlannerRepairBrain,
    compactTaskText,
    createQueuedTask,
    extractJsonObject,
    findTaskById,
    getBrain,
    getRoutingConfig,
    getTaskReshapeAttemptCount,
    listAvailableBrains,
    markTaskCriticalFailure,
    recordTaskReshapeReview,
    runOllamaJsonGenerate,
    appendRepairLesson = async () => null
  } = context;

  function determineHeuristicEscalationDecision({ classification, capabilityMismatchSuspected, availableWorkers, attemptedBrains }) {
    const untried = availableWorkers.filter((id) => !attemptedBrains.includes(id));
    if (capabilityMismatchSuspected && untried.length > 0) {
      return { action: "retry", requestedBrainId: untried[0], reason: "Capability mismatch detected; routing to untried worker brain.", message: "", subTasks: [] };
    }
    if (classification === "tool_loop" || classification === "repeated_tool_loop") {
      if (untried.length > 0) {
        return { action: "retry", requestedBrainId: untried[0], reason: "Tool loop failure; routing to untried worker to break the pattern.", message: "", subTasks: [] };
      }
      return { action: "close", requestedBrainId: "", reason: "Tool loop failure with no untried workers remaining.", message: "", subTasks: [] };
    }
    if ((classification === "timed_out" || classification === "model_timeout") && untried.length > 0) {
      return { action: "retry", requestedBrainId: untried[0], reason: "Timeout failure; routing to untried worker.", message: "", subTasks: [] };
    }
    if (classification === "no_idle_worker" || classification === "worker_unavailable") {
      return { action: "close", requestedBrainId: "", reason: "No worker available at escalation time.", message: "", subTasks: [] };
    }
    return null;
  }

  function buildPriorAttemptDiagnosticsNote(sourceTask) {
    if (!sourceTask) return "";
    const parts = [];
    const diagSummary = compactTaskText(String(sourceTask.toolLoopDiagnostics?.summary || "").trim(), 300);
    if (diagSummary) parts.push(`Prior attempt diagnostics: ${diagSummary}`);
    const malformed = compactTaskText(String(sourceTask.malformedResponse || "").trim(), 200);
    if (malformed && !diagSummary) parts.push(`Prior attempt stuck on: ${malformed}`);
    return parts.length ? `\n\n${parts.join("\n")}` : "";
  }

async function executeEscalationReviewJob(task) {
  const routing = getRoutingConfig();
  const plannerBrain = await choosePlannerRepairBrain(
    [
      String(task.requestedBrainId || "").trim(),
      String(routing.remoteTriageBrainId || "").trim(),
      "helper"
    ].filter(Boolean),
    { preferRemote: true }
  ) || await getBrain("bitnet");
  const sourceTaskId = String(task.escalationSourceTaskId || task.previousTaskId || "").trim();
  const sourceTask = sourceTaskId ? await findTaskById(sourceTaskId) : null;
  const anchorTask = sourceTask || task;
  const attemptedBrains = Array.isArray(task.specialistAttemptedBrainIds)
    ? task.specialistAttemptedBrainIds.map((value) => String(value)).filter(Boolean)
    : [];
  const availableWorkers = (await listAvailableBrains())
    .filter((brain) => brain.kind === "worker" && brain.toolCapable)
    .map((brain) => brain.id);
  const failureClassification = String(task.failureClassification || sourceTask?.failureClassification || "").trim().toLowerCase();
  const capabilityMismatchSuspected = task.capabilityMismatchSuspected === true || sourceTask?.capabilityMismatchSuspected === true;
  const heuristicDecision = determineHeuristicEscalationDecision({
    classification: failureClassification,
    capabilityMismatchSuspected,
    availableWorkers,
    attemptedBrains
  });

  let decision = null;
  if (!heuristicDecision) {
    const escalationPrompt = [
      "You are Nova's escalation planner.",
      "Return JSON only.",
      "Decide what to do after all direct worker attempts failed.",
      "Use exactly this schema:",
      "{\"action\":\"retry|split|clarify|close\",\"reason\":\"...\",\"requestedBrainId\":\"...\",\"message\":\"...\",\"subTasks\":[\"...\"]}",
      `Original queued message: ${String(task.message || "").trim()}`,
      `Escalation notes: ${String(task.notes || "").trim()}`,
      `Source task id: ${sourceTaskId || "none"}`,
      `Source task summary: ${compactTaskText(String(sourceTask?.resultSummary || sourceTask?.reviewSummary || sourceTask?.workerSummary || ""), 300) || "none"}`,
      `Failure classification: ${failureClassification || "unknown"}`,
      `Capability mismatch suspected: ${capabilityMismatchSuspected ? "yes" : "no"}`,
      `Brains already attempted: ${attemptedBrains.length ? attemptedBrains.join(", ") : "none"}`,
      `Available worker brains: ${availableWorkers.join(", ") || "none"}`,
      "Prefer retry only if you can materially improve the brief or pick an untried worker.",
      "If capability mismatch is suspected, prefer an untried worker that is a better execution fit over repeating the same route.",
      "Use split when the task is too broad and should become smaller concrete jobs.",
      "Use clarify when the user must answer something before progress is possible.",
      "Use close when no safe next step exists."
    ].join("\n");
    try {
      const result = await runOllamaJsonGenerate(plannerBrain.model, escalationPrompt, {
        timeoutMs: 20000,
        keepAlive: MODEL_KEEPALIVE,
        baseUrl: plannerBrain.ollamaBaseUrl,
        brainId: plannerBrain.id,
        leaseOwnerId: task?.id ? `task:${String(task.id).trim()}` : `escalation:${String(task?.sessionId || "Main").trim() || "Main"}`,
        leaseWaitMs: 2500
      });
      if (result.ok) {
        decision = extractJsonObject(result.text);
      }
    } catch {
      decision = null;
    }
  } else {
    decision = heuristicDecision;
  }

  const action = String(decision?.action || "").trim().toLowerCase();
  const requestedBrainId = String(decision?.requestedBrainId || "").trim();
  const reason = compactTaskText(
    String(decision?.reason || "").trim(),
    220
  ) || buildConcreteReviewReason({
    task,
    sourceTask,
    attemptedBrains,
    classification: failureClassification,
    fallback: "Escalation planner reviewed the failed worker chain."
  });
  const retryMessage = compactTaskText(String(decision?.message || "").trim(), 500);
  const subTasks = Array.isArray(decision?.subTasks)
    ? decision.subTasks.map((value) => compactTaskText(String(value || "").trim(), 280)).filter(Boolean).slice(0, 3)
    : [];
  const nextBrainId = chooseEscalationRetryBrainId({
    requestedBrainId,
    availableWorkers,
    attemptedBrains
  });
  const reshapeLimitReached = !canReshapeTask(anchorTask);
  const criticalLimitReason = `Critical failure after ${getTaskReshapeAttemptCount(anchorTask)}/${MAX_TASK_RESHAPE_ATTEMPTS} reshaped resubmission attempts. Escalation review will not queue another retry.`;

  if (action === "split" && subTasks.length) {
    if (reshapeLimitReached) {
      await recordTaskReshapeReview({
        task,
        sourceTask: anchorTask,
        phase: "escalation_review",
        action: "critical_close",
        reason: criticalLimitReason,
        improvement: reason,
        classification: String(anchorTask?.failureClassification || "").trim(),
        willResubmit: false,
        critical: true
      });
      if (sourceTask) {
        await markTaskCriticalFailure(sourceTask, criticalLimitReason);
      }
      return {
        ok: true,
        code: 0,
        brain: plannerBrain,
        parsed: {
          final: true,
          final_text: criticalLimitReason
        },
        stdout: "",
        stderr: "",
        outputFiles: []
      };
    }
    const splitBrainId = nextBrainId;
    if (!splitBrainId) {
      await recordTaskReshapeReview({
        task,
        sourceTask: anchorTask,
        phase: "escalation_review",
        action: "close",
        reason,
        classification: String(anchorTask?.failureClassification || "").trim(),
        willResubmit: false
      });
      return {
        ok: true,
        code: 0,
        brain: plannerBrain,
        parsed: {
          final: true,
          final_text: buildEscalationCloseRecommendation(task, sourceTask, `Escalation review could not queue split follow-up tasks because no untried worker remained. ${reason}`)
        },
        stdout: "",
        stderr: "",
        outputFiles: []
      };
    }
    const reshapeRecord = await recordTaskReshapeReview({
      task,
      sourceTask: anchorTask,
      phase: "escalation_review",
      action: "split_resubmit",
      reason,
      improvement: subTasks.join(" | "),
      classification: String(anchorTask?.failureClassification || "").trim(),
      willResubmit: true
    });
    const splitGroupId = `split-${String(task.id || "").trim()}-${Date.now()}`;
    let previousSubTaskId = null;
    for (let splitIndex = 0; splitIndex < subTasks.length; splitIndex += 1) {
      const subTask = subTasks[splitIndex];
      const splitMessage = String(task.internalJobType || "").trim() === "project_cycle"
        ? buildProjectCycleFollowUpMessage(task, { focusOverride: subTask, retryNote: reason })
        : [String(task.message || "").trim(), "", `Focused split objective: ${subTask}`, reason].filter(Boolean).join("\n");
      const createdSubTask = await createQueuedTask({
        message: splitMessage,
        sessionId: task.sessionId || "task-escalation",
        requestedBrainId: splitBrainId,
        intakeBrainId: task.intakeBrainId || "bitnet",
        internetEnabled: Boolean(task.internetEnabled),
        selectedMountIds: Array.isArray(task.mountIds) ? task.mountIds : [],
        forceToolUse: true,
        attachments: Array.isArray(task.attachments) ? task.attachments : [],
        helperAnalysis: task.helperAnalysis || null,
        notes: `Queued from escalation review of ${task.escalationSourceTaskId || task.previousTaskId || task.id}. ${reason}`.trim(),
        taskMeta: buildRetryTaskMeta(task, {
          escalationParentTaskId: task.id,
          escalationSourceTaskId: sourceTaskId || undefined,
          reshapeIssueKey: String(reshapeRecord?.issueKey || "").trim() || undefined,
          reshapeSourcePhase: "escalation_review",
          splitGroupId,
          splitOrderIndex: splitIndex,
          dependsOnTaskIds: previousSubTaskId ? [previousSubTaskId] : undefined,
          projectWorkFocus: String(task.internalJobType || "").trim() === "project_cycle" ? compactTaskText(subTask, 220) : undefined,
          projectWorkKey: String(task.internalJobType || "").trim() === "project_cycle"
            ? buildEscalationSplitProjectWorkKey(task, subTask)
            : undefined
        })
      });
      previousSubTaskId = createdSubTask?.id ? String(createdSubTask.id).trim() : null;
    }
    return {
      ok: true,
      code: 0,
      brain: plannerBrain,
      parsed: {
        final: true,
        final_text: `Escalation review split this into ${subTasks.length} follow-up task${subTasks.length === 1 ? "" : "s"}. ${reason}`
      },
      stdout: "",
      stderr: "",
      outputFiles: []
    };
  }

  if (action === "retry" || (action === "close" && nextBrainId)) {
    if (reshapeLimitReached) {
      await recordTaskReshapeReview({
        task,
        sourceTask: anchorTask,
        phase: "escalation_review",
        action: "critical_close",
        reason: criticalLimitReason,
        improvement: retryMessage || reason,
        classification: String(anchorTask?.failureClassification || "").trim(),
        willResubmit: false,
        critical: true
      });
      if (sourceTask) {
        await markTaskCriticalFailure(sourceTask, criticalLimitReason);
      }
      return {
        ok: true,
        code: 0,
        brain: plannerBrain,
        parsed: {
          final: true,
          final_text: criticalLimitReason
        },
        stdout: "",
        stderr: "",
        outputFiles: []
      };
    }
    if (!nextBrainId) {
      await recordTaskReshapeReview({
        task,
        sourceTask: anchorTask,
        phase: "escalation_review",
        action: "close",
        reason,
        improvement: retryMessage,
        classification: String(anchorTask?.failureClassification || "").trim(),
        willResubmit: false
      });
      return {
        ok: true,
        code: 0,
        brain: plannerBrain,
        parsed: {
          final: true,
          final_text: buildEscalationCloseRecommendation(task, sourceTask, `Escalation review closed this out because no untried worker remained. ${reason}`)
        },
        stdout: "",
        stderr: "",
        outputFiles: []
      };
    }
    const reshapeRecord = await recordTaskReshapeReview({
      task,
      sourceTask: anchorTask,
      phase: "escalation_review",
      action: action === "close" ? "close_override_resubmit" : "retry_resubmit",
      reason,
      improvement: retryMessage || reason,
      classification: String(anchorTask?.failureClassification || "").trim(),
      willResubmit: true
    });
    const priorDiagnosticsNote = buildPriorAttemptDiagnosticsNote(sourceTask);
    await createQueuedTask({
      message: String(task.internalJobType || "").trim() === "project_cycle"
        ? buildProjectCycleFollowUpMessage(task, { retryNote: retryMessage || reason })
        : [String(task.message || "").trim(), "", compactTaskText(retryMessage || reason, 320), priorDiagnosticsNote].filter(Boolean).join("\n"),
      sessionId: task.sessionId || "task-escalation",
      requestedBrainId: nextBrainId,
      intakeBrainId: task.intakeBrainId || "bitnet",
      internetEnabled: Boolean(task.internetEnabled),
      selectedMountIds: Array.isArray(task.mountIds) ? task.mountIds : [],
      forceToolUse: true,
      attachments: Array.isArray(task.attachments) ? task.attachments : [],
      helperAnalysis: task.helperAnalysis || null,
      notes: `Queued from escalation review of ${task.escalationSourceTaskId || task.previousTaskId || task.id}. ${reason}`.trim(),
      taskMeta: buildRetryTaskMeta(task, {
        escalationParentTaskId: task.id,
        escalationSourceTaskId: sourceTaskId || undefined,
        reshapeIssueKey: String(reshapeRecord?.issueKey || "").trim() || undefined,
        reshapeSourcePhase: "escalation_review",
        specialistAttemptedBrainIds: [...new Set([...attemptedBrains, nextBrainId].filter(Boolean))],
        escalationDepth: Number(task.escalationDepth || 0) + 1
      })
    });
    appendRepairLesson({
      taskMessage: compactTaskText(String(task.message || "").trim(), 200),
      repeatedCalls: `escalation:${failureClassification || "unknown"}`,
      repairNote: `${action === "close" ? "close_override_" : ""}retry:${nextBrainId}`
    }).catch(() => {});
    return {
      ok: true,
      code: 0,
      brain: plannerBrain,
      parsed: {
        final: true,
        final_text: action === "close"
          ? `Escalation review overrode a close decision and queued a retry on ${nextBrainId}. ${reason}`
          : `Escalation review queued a retry on ${nextBrainId}. ${reason}`
      },
      stdout: "",
      stderr: "",
      outputFiles: []
    };
  }

  if (action === "clarify") {
    await recordTaskReshapeReview({
      task,
      sourceTask: anchorTask,
      phase: "escalation_review",
      action: "clarify",
      reason,
      improvement: retryMessage,
      classification: String(anchorTask?.failureClassification || "").trim(),
      willResubmit: false
    });
    return {
      ok: true,
      code: 0,
      brain: plannerBrain,
      waitingForUser: true,
      questionForUser: compactTaskText(retryMessage || reason, 1000) || "I need more information before I can continue.",
      parsed: {
        final: true,
        final_text: `This task needs clarification before I can continue. ${reason}`
      },
      stdout: "",
      stderr: "",
      outputFiles: []
    };
  }

  await recordTaskReshapeReview({
    task,
    sourceTask: anchorTask,
    phase: "escalation_review",
    action: "close",
    reason,
    improvement: retryMessage,
    classification: String(anchorTask?.failureClassification || "").trim(),
    willResubmit: false
  });
  appendRepairLesson({
    taskMessage: compactTaskText(String(task.message || "").trim(), 200),
    repeatedCalls: `escalation:${failureClassification || "unknown"}`,
    repairNote: `close:no_safe_next_step`
  }).catch(() => {});

  return {
    ok: true,
    code: 0,
    brain: plannerBrain,
    parsed: {
      final: true,
      final_text: buildEscalationCloseRecommendation(task, sourceTask, `Escalation review closed this out. ${reason}`)
    },
    stdout: "",
    stderr: "",
    outputFiles: []
  };
}
  return {
    executeEscalationReviewJob
  };
}
