export function createObserverWaitingTaskHandling(context = {}) {
  const {
    assessEmailSourceIdentity,
    broadcastObserverEvent,
    buildMailCommandRecord,
    closeTaskRecord,
    compactTaskText,
    describeSourceTrust,
    findTaskById,
    getAppTrustConfig,
    getMailState,
    getObserverConfig,
    handleIncomingMailCommand,
    handleMailWatchWaitingAnswer,
    normalizeAppTrustConfig,
    normalizeCombinedTrustRecord,
    normalizeSourceIdentityRecord,
    normalizeTrustLevel,
    persistTaskTransition,
    refreshRecentMailTrustForSource,
    resolveMailCommandSourceIdentity,
    sanitizeTrustRecordForConfig,
    saveObserverConfig,
    scheduleTaskDispatch,
    setObserverConfig,
    trustLevelLabel,
    upsertTrustRecord
  } = context;

  function shouldRouteWaitingTaskToTodo(task = {}, questionForUser = "") {
    if (!task || typeof task !== "object") {
      return false;
    }
    const question = String(questionForUser || "").trim();
    if (!question) {
      return false;
    }
    const internalJobType = String(task.internalJobType || "").trim().toLowerCase();
    if (["question_maintenance", "mail_watch_question"].includes(internalJobType)) {
      return false;
    }
    const lower = question.toLowerCase();
    const directionPatterns = [
      /\bdo you want\b/,
      /\bwould you like\b/,
      /\bshould i\b/,
      /\bwhat would you like\b/,
      /\bwhat should i\b/,
      /\bwhich (?:one|option|folder|file|path|version)\b/,
      /\bwhere should i\b/,
      /\bwho should i\b/,
      /\bhow should i\b/,
      /\bcan you clarify\b/,
      /\bplease clarify\b/,
      /\bwhat information\b/,
      /\bwhich of these\b/,
      /\bwhat would you like me to do\b/
    ];
    if (directionPatterns.some((pattern) => pattern.test(lower))) {
      return false;
    }
    const actionPatterns = [
      /\breply\b/,
      /\brespond\b/,
      /\bsend\b/,
      /\bemail\b/,
      /\bcall\b/,
      /\btext\b/,
      /\bpay\b/,
      /\breview\b/,
      /\bapprove\b/,
      /\bsign\b/,
      /\bupload\b/,
      /\bprovide\b/,
      /\bshare\b/,
      /\bcontact\b/,
      /\bfollow up\b/,
      /\bfollow-up\b/,
      /\bbook\b/,
      /\bschedule\b/,
      /\brenew\b/,
      /\bcheck\b/,
      /\bconfirm with\b/,
      /\btalk to\b/,
      /\bask\b/,
      /\bvisit\b/,
      /\bbuy\b/,
      /\border\b/,
      /\bremember to\b/,
      /\byou need to\b/,
      /\bplease\b/
    ];
    if (actionPatterns.some((pattern) => pattern.test(lower))) {
      return true;
    }
    return !/[?]$/.test(question);
  }

  function buildTodoTextFromWaitingQuestion(task = {}, questionForUser = "") {
    let text = String(questionForUser || "").replace(/\s+/g, " ").trim();
    text = text
      .replace(/^(?:please|remember to|you need to|action item:)\s+/i, "")
      .replace(/\b(?:and|then)\s+let me know once(?: it'?s)? done\b/gi, "")
      .replace(/\bthen tell me once(?: it'?s)? done\b/gi, "")
      .replace(/[.?!]+$/g, "")
      .trim();
    if (!text) {
      text = compactTaskText(String(task.notes || task.message || "Follow up on the blocked task.").trim(), 280);
    }
    if (text && !/^[A-Z]/.test(text)) {
      text = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
    }
    return compactTaskText(text, 280);
  }

  function parseSourceTrustDecisionAnswer(answer = "") {
    const lower = String(answer || "").trim().toLowerCase();
    if (!lower) {
      return { action: "", trustLevel: "", replayCommand: false };
    }
    if (/\b(ignore|do nothing|leave it|drop it|skip it|no reply|don't reply|do not reply)\b/.test(lower)) {
      return { action: "ignore", trustLevel: "", replayCommand: false };
    }
    if (/\b(answer manually|reply manually|respond manually|manual reply|i(?:'| wi)ll reply|i(?:'| wi)ll answer)\b/.test(lower)) {
      return { action: "manual_reply", trustLevel: "", replayCommand: false };
    }
    const suppressReplay = /\b(do not run|don't run|do not execute|don't execute|just mark|without (?:running|executing)|but don'?t run)\b/.test(lower);
    if (/\b(mark(?: the)? sender trusted|mark trusted|sender trusted|trust(?: the)? sender|make(?: the)? sender trusted|allow(?: the)? sender)\b/.test(lower) || /\btrusted\b/.test(lower)) {
      return { action: "set_trust", trustLevel: "trusted", replayCommand: !suppressReplay };
    }
    if (/\b(mark(?: the)? sender known|mark known|sender known|make(?: the)? sender known|known sender)\b/.test(lower) || /\bknown\b/.test(lower)) {
      return { action: "set_trust", trustLevel: "known", replayCommand: !suppressReplay };
    }
    return { action: "", trustLevel: "", replayCommand: false };
  }

  function extractSourceTrustDecisionSubject(task = {}) {
    const match = String(task.questionForUser || "").match(/^\s*Subject:\s*(.+)$/im);
    return compactTaskText(String(match?.[1] || "").trim(), 220);
  }

  function extractSourceTrustDecisionCommandText(task = {}) {
    const embeddedCommand = String(task?.sourceIdentity?.command?.text || "").trim();
    if (embeddedCommand) {
      return compactTaskText(embeddedCommand, 600);
    }
    const questionMatch = String(task.questionForUser || "").match(/^\s*Requested command:\s*(.+)$/im);
    if (questionMatch?.[1]) {
      return compactTaskText(String(questionMatch[1] || "").trim(), 600);
    }
    const messageMatch = String(task.message || "").match(/^Unknown email source requested:\s*(.+)$/i);
    return compactTaskText(String(messageMatch?.[1] || "").trim(), 600);
  }

  async function applyEmailTrustDecision(sourceIdentity = {}, trustLevel = "known") {
    const normalizedSource = normalizeSourceIdentityRecord(sourceIdentity);
    if (!normalizedSource || normalizedSource.kind !== "email") {
      return null;
    }
    const normalizedTrustLevel = normalizeTrustLevel(trustLevel, "known");
    const currentTrust = getAppTrustConfig();
    const records = Array.isArray(currentTrust.records)
      ? currentTrust.records.map((entry, index) => normalizeCombinedTrustRecord(entry, index))
      : [];
    upsertTrustRecord(records, {
      ...normalizedSource,
      kind: "email",
      label: String(normalizedSource.label || normalizedSource.email || "Email source").trim(),
      email: String(normalizedSource.email || "").trim().toLowerCase(),
      trustLevel: normalizedTrustLevel
    }, records.length);
    const nextTrust = normalizeAppTrustConfig({
      ...currentTrust,
      records
    });
    const currentConfig = getObserverConfig() || {};
    setObserverConfig({
      ...currentConfig,
      app: {
        ...currentConfig.app,
        trust: {
          ...nextTrust,
          records: nextTrust.records.map((entry, index) => sanitizeTrustRecordForConfig(entry, index)),
          voiceProfiles: []
        }
      }
    });
    await saveObserverConfig();
    return assessEmailSourceIdentity({
      fromName: normalizedSource.label || "",
      fromAddress: normalizedSource.email || ""
    });
  }

  function buildReplayMailMessageFromTrustTask(task = {}, sourceIdentity = null) {
    const normalizedSourceIdentity = normalizeSourceIdentityRecord(sourceIdentity || task.sourceIdentity) || {
      kind: "email",
      label: String(task?.sourceIdentity?.label || task?.sourceIdentity?.email || "Unknown sender").trim(),
      email: String(task?.sourceIdentity?.email || "").trim().toLowerCase(),
      trustLevel: "unknown"
    };
    const commandText = extractSourceTrustDecisionCommandText(task);
    const observerConfig = getObserverConfig() || {};
    return {
      id: String(task.sourceMessageId || task.id || "").trim(),
      agentId: String(task.agentId || String(task.sessionId || "").replace(/^mail:/i, "") || observerConfig?.mail?.activeAgentId || "nova").trim(),
      fromName: String(normalizedSourceIdentity.label || "").trim(),
      fromAddress: String(normalizedSourceIdentity.email || "").trim(),
      subject: extractSourceTrustDecisionSubject(task),
      triage: {
        likelySpam: false,
        likelyPhishing: false
      },
      sourceIdentity: normalizedSourceIdentity,
      command: {
        detected: Boolean(commandText),
        text: commandText
      }
    };
  }

  async function resumeWaitingTaskAfterUserAnswer(task = {}, normalizedAnswer = "", sessionId = "Main") {
    const now = Date.now();
    const questionText = compactTaskText(String(task.questionForUser || "").trim(), 2000);
    const nextClarificationHistory = [
      ...(Array.isArray(task.clarificationHistory) ? task.clarificationHistory : []),
      {
        askedAt: Number(task.waitingForUserAt || task.updatedAt || task.createdAt || now),
        answeredAt: now,
        question: questionText,
        answer: normalizedAnswer,
        sessionId: String(sessionId || "Main").trim()
      }
    ];
    const clarificationTranscript = nextClarificationHistory
      .map((entry, index) => [
        `Clarification ${index + 1}:`,
        `Question: ${compactTaskText(String(entry.question || "").trim(), 1200) || "(not captured)"}`,
        `Answer: ${compactTaskText(String(entry.answer || "").trim(), 1200) || "(empty)"}`
      ].join("\n"))
      .join("\n\n");
    const resumedTask = await persistTaskTransition({
      previousTask: task,
      nextTask: {
        ...task,
        status: "queued",
        updatedAt: now,
        resumedFromQuestionAt: now,
        resumedBySessionId: String(sessionId || "Main").trim(),
        originalMessage: String(task.originalMessage || task.message || "").trim(),
        message: [
          String(task.originalMessage || task.message || "").trim(),
          "",
          "User clarification history:",
          clarificationTranscript
        ].filter(Boolean).join("\n"),
        lastUserAnswer: normalizedAnswer,
        questionForUser: "",
        answerPending: false,
        waitingForUserAt: undefined,
        clarificationHistory: nextClarificationHistory,
        notes: compactTaskText(`User answered follow-up question. ${String(task.notes || "").trim()}`.trim(), 260)
      },
      eventType: "task.answered",
      reason: "Waiting task resumed after user answer."
    });
    broadcastObserverEvent({
      type: "task.answered",
      task: resumedTask
    });
    scheduleTaskDispatch();
    return resumedTask;
  }

  async function handleSourceTrustDecisionWaitingAnswer(task = {}, answer = "", sessionId = "Main") {
    const decision = parseSourceTrustDecisionAnswer(answer);
    if (!decision.action || decision.action === "manual_reply") {
      return resumeWaitingTaskAfterUserAnswer(task, answer, sessionId);
    }
    const originalSourceIdentity = normalizeSourceIdentityRecord(task.sourceIdentity) || null;
    let resolvedSourceIdentity = originalSourceIdentity;
    if (decision.trustLevel) {
      resolvedSourceIdentity = await applyEmailTrustDecision(originalSourceIdentity, decision.trustLevel) || originalSourceIdentity;
      if (resolvedSourceIdentity) {
        refreshRecentMailTrustForSource(resolvedSourceIdentity);
      }
    }
    let replayStatus = null;
    if (decision.replayCommand) {
      const mailState = getMailState() || {};
      const recentMessage = (Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [])
        .find((entry) => String(entry.id || "").trim() === String(task.sourceMessageId || "").trim());
      const replayMessage = recentMessage
        ? {
            ...recentMessage,
            sourceIdentity: resolveMailCommandSourceIdentity({
              ...recentMessage,
              sourceIdentity: resolvedSourceIdentity || recentMessage.sourceIdentity
            }) || resolvedSourceIdentity || recentMessage.sourceIdentity
          }
        : buildReplayMailMessageFromTrustTask(task, resolvedSourceIdentity);
      replayStatus = await handleIncomingMailCommand(replayMessage);
      if (recentMessage) {
        recentMessage.sourceIdentity = replayMessage.sourceIdentity;
        recentMessage.command = buildMailCommandRecord(replayStatus, replayMessage.command);
      }
    }
    const summaryParts = [];
    if (decision.trustLevel && resolvedSourceIdentity) {
      summaryParts.push(`User marked ${describeSourceTrust(resolvedSourceIdentity)} as ${trustLevelLabel(decision.trustLevel)}.`);
    } else if (decision.action === "ignore") {
      summaryParts.push(`User chose to ignore the email command from ${describeSourceTrust(originalSourceIdentity || { kind: "email", label: "Unknown sender", trustLevel: "unknown" })}.`);
    }
    if (replayStatus?.action === "auto_queue") {
      summaryParts.push(`Replayed the original email command and queued ${replayStatus.taskCodename || replayStatus.taskId || "a worker task"}.`);
    } else if (replayStatus?.action === "safe_reply_only") {
      summaryParts.push("Replayed the original email command in acknowledgement-only mode.");
    } else if (replayStatus?.action === "blocked") {
      summaryParts.push("Replayed the original email command but it remained blocked.");
    } else if (decision.replayCommand && !replayStatus?.detected) {
      summaryParts.push("The original email command could not be replayed because no command text was available.");
    }
    const closedTask = await closeTaskRecord(
      task,
      compactTaskText(summaryParts.join(" ").trim() || "User resolved the email trust decision.", 260)
    );
    return {
      ...closedTask,
      sourceIdentity: resolvedSourceIdentity || closedTask.sourceIdentity,
      lastUserAnswer: compactTaskText(String(answer || "").trim(), 4000),
      decision: {
        action: decision.action,
        trustLevel: decision.trustLevel,
        replayStatus
      }
    };
  }

  async function answerWaitingTask(taskId = "", answer = "", sessionId = "Main") {
    const normalizedTaskId = String(taskId || "").trim();
    const normalizedAnswer = compactTaskText(String(answer || "").trim(), 4000);
    if (!normalizedTaskId) {
      throw new Error("taskId is required");
    }
    if (!normalizedAnswer) {
      throw new Error("answer is required");
    }
    const task = await findTaskById(normalizedTaskId);
    if (!task) {
      throw new Error("task not found");
    }
    if (String(task.status || "") !== "waiting_for_user") {
      throw new Error("task is not waiting for user input");
    }
    if (String(task.internalJobType || "") === "mail_watch_question") {
      return handleMailWatchWaitingAnswer(task, normalizedAnswer, sessionId);
    }
    if (String(task.questionCategory || "").trim() === "source_trust_decision") {
      return handleSourceTrustDecisionWaitingAnswer(task, normalizedAnswer, sessionId);
    }
    return resumeWaitingTaskAfterUserAnswer(task, normalizedAnswer, sessionId);
  }

  return {
    answerWaitingTask,
    buildTodoTextFromWaitingQuestion,
    shouldRouteWaitingTaskToTodo
  };
}
