export function createObserverPeriodicJobs(context = {}) {
  const {
    AGENT_BRAINS,
    QUESTION_MAINTENANCE_INTERVAL_MS,
    TASK_QUEUE_CLOSED,
    TASK_QUEUE_DONE,
    TASK_QUEUE_INBOX,
    TASK_QUEUE_IN_PROGRESS,
    TASK_QUEUE_WAITING,
    chooseQuestionMaintenanceBrain,
    compactTaskText,
    createQueuedTask,
    createWaitingTask,
    buildMailWatchSingleQuestion,
    findMailWatchWaitingTask,
    forwardMailToUser,
    getActiveMailAgent,
    getMailState,
    getMailWatchRule,
    getMailWatchRulesState,
    isDefinitelyBadMail,
    isDefinitelyGoodMail,
    listAllTasks,
    listTasksByFolder,
    moveAgentMail,
    resolveMailWatchNotifyEmail,
    sendUnsureMailDigest,
    upsertMailWatchRule
  } = context;
async function ensureMailWatchJob(rule) {
  const normalizedRule = rule && typeof rule === "object" ? rule : null;
  if (!normalizedRule?.id || normalizedRule.enabled === false) {
    return null;
  }
  const seriesId = `mail-watch:${normalizedRule.id}`;
  const { queued, inProgress, done, failed } = await listAllTasks();
  const closed = await listTasksByFolder(TASK_QUEUE_CLOSED, "closed");
  const active = [...queued, ...inProgress].find((task) => String(task.scheduler?.seriesId || "") === seriesId);
  if (active) {
    return active;
  }
  const latestHistorical = [...done, ...failed, ...closed]
    .filter((task) => String(task.scheduler?.seriesId || "") === seriesId)
    .sort((left, right) => Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0))[0];
  if (latestHistorical?.status === "completed" && Number(latestHistorical.notBeforeAt || 0) > Date.now()) {
    return latestHistorical;
  }
  return createQueuedTask({
    message: `Mail watch: ${normalizedRule.instruction}`,
    sessionId: "scheduler",
    requestedBrainId: "worker",
    intakeBrainId: "bitnet",
    internetEnabled: false,
    selectedMountIds: [],
    forceToolUse: false,
    notes: `Internal periodic mail watch for rule "${normalizedRule.id}".`,
    taskMeta: {
      internalJobType: "mail_watch",
      mailWatchRuleId: normalizedRule.id,
      scheduler: {
        periodic: true,
        name: `Mail watch: ${compactTaskText(normalizedRule.instruction, 60)}`,
        seriesId,
        every: normalizedRule.every,
        everyMs: normalizedRule.everyMs
      },
      notBeforeAt: Date.now() + Number(normalizedRule.everyMs || 10 * 60 * 1000)
    }
  });
}

async function ensureAllMailWatchJobs() {
  const mailWatchRulesState = getMailWatchRulesState();
  const rules = Array.isArray(mailWatchRulesState?.rules) ? mailWatchRulesState.rules : [];
  for (const rule of rules.filter((entry) => entry.enabled !== false)) {
    await ensureMailWatchJob(rule);
  }
}

async function ensureQuestionMaintenanceJob() {
  const seriesId = "internal-question-maintenance";
  const [queued, inProgress, waiting, done, failed, closed] = await Promise.all([
    listTasksByFolder(TASK_QUEUE_INBOX, "queued"),
    listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress"),
    listTasksByFolder(TASK_QUEUE_WAITING, "waiting_for_user"),
    listTasksByFolder(TASK_QUEUE_DONE, "done"),
    Promise.resolve([]),
    listTasksByFolder(TASK_QUEUE_CLOSED, "closed")
  ]);
  const active = [...queued, ...inProgress, ...waiting].find((task) => String(task.scheduler?.seriesId || "") === seriesId);
  if (active) {
    return active;
  }
  const latestHistorical = [...done, ...failed, ...closed]
    .filter((task) => String(task.scheduler?.seriesId || "") === seriesId)
    .sort((left, right) => Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0))[0];
  if (latestHistorical?.status === "completed" && Number(latestHistorical.notBeforeAt || 0) > Date.now()) {
    return latestHistorical;
  }
  const brain = await chooseQuestionMaintenanceBrain();
  return createQueuedTask({
    message: "Prompt memory question maintenance: ask one focused question, fill out USER.md, MEMORY.md, and PERSONAL.md when answers exist, and deepen those documents when core sections are already filled.",
    sessionId: "scheduler",
    requestedBrainId: brain?.id || "helper",
    intakeBrainId: "bitnet",
    internetEnabled: false,
    selectedMountIds: [],
    forceToolUse: false,
    notes: "Internal periodic prompt-memory question maintenance.",
    taskMeta: {
      internalJobType: "question_maintenance",
      scheduler: {
        periodic: true,
        name: "Prompt memory question maintenance",
        seriesId,
        every: "15m",
        everyMs: QUESTION_MAINTENANCE_INTERVAL_MS
      },
      notBeforeAt: Date.now() + QUESTION_MAINTENANCE_INTERVAL_MS,
      appliedClarificationCount: 0,
      questionCycleIndex: 0
    }
  });
}

async function executeMailWatchJob(task) {
  const rule = getMailWatchRule(task.mailWatchRuleId);
  if (!rule || rule.enabled === false) {
    return {
      ok: true,
      code: 0,
      timedOut: false,
      preset: "internal-mail-watch",
      brain: AGENT_BRAINS[0],
      network: "local",
      mounts: [],
      attachments: [],
      outputFiles: [],
      parsed: { status: "ok", result: { payloads: [{ text: "Mail watch skipped because the rule is no longer active.", mediaUrl: null }], meta: { durationMs: 0 } } },
      stdout: "Mail watch skipped because the rule is no longer active.",
      stderr: ""
    };
  }

  const blocked = new Set(
    [
      getActiveMailAgent()?.email
    ].filter(Boolean).map((value) => String(value).trim().toLowerCase())
  );
  const mailState = getMailState();
  const allInboxMessages = (Array.isArray(mailState?.recentMessages) ? mailState.recentMessages : [])
    .filter((message) => String(message.fromAddress || "").trim())
    .filter((message) => !blocked.has(String(message.fromAddress || "").trim().toLowerCase()))
    .sort((left, right) => Number(left.receivedAt || 0) - Number(right.receivedAt || 0));
  const forwardedMessageIds = new Set(Array.isArray(rule.forwardedMessageIds) ? rule.forwardedMessageIds.map((value) => String(value || "").trim()) : []);
  const resolvedUnsureMessageIds = new Set(Array.isArray(rule.resolvedUnsureMessageIds) ? rule.resolvedUnsureMessageIds.map((value) => String(value || "").trim()) : []);
  const pendingUnsureMessageIds = new Set(Array.isArray(rule.pendingUnsureMessageIds) ? rule.pendingUnsureMessageIds.map((value) => String(value || "").trim()) : []);
  const pendingUnsureBefore = new Set(pendingUnsureMessageIds);
  const recentMessages = allInboxMessages
    .filter((message) => Number(message.receivedAt || 0) > Number(rule.lastProcessedReceivedAt || 0));
  const residualMessages = allInboxMessages
    .filter((message) => Number(message.receivedAt || 0) <= Number(rule.lastProcessedReceivedAt || 0))
    .filter((message) => {
      const messageId = String(message.id || "").trim();
      if (!messageId) {
        return false;
      }
      if (isDefinitelyBadMail(message)) {
        return true;
      }
      if (rule.autoForwardGood !== false && isDefinitelyGoodMail(message) && !forwardedMessageIds.has(messageId)) {
        return true;
      }
      return rule.promptUnsure !== false;
    });
  const sweepMessages = [];
  const seenSweepIds = new Set();
  for (const message of [...recentMessages, ...residualMessages]) {
    const messageId = String(message.id || "").trim();
    if (!messageId || seenSweepIds.has(messageId)) {
      continue;
    }
    seenSweepIds.add(messageId);
    sweepMessages.push(message);
  }
  const notifyEmail = resolveMailWatchNotifyEmail(rule);
  let autoHandledCount = 0;
  let forwardedCount = 0;
  let promptedCount = 0;
  let trashedCount = 0;
  const autoHandledSummaries = [];
  const unsureDigestCandidates = [];
  const newlyUnsureMessages = [];
  let residualSweepCount = 0;

  for (const message of sweepMessages) {
    if (Number(message.receivedAt || 0) <= Number(rule.lastProcessedReceivedAt || 0)) {
      residualSweepCount += 1;
    }
    if (isDefinitelyBadMail(message)) {
      if (rule.trashDefiniteBad !== false) {
        try {
          await moveAgentMail({ destination: "trash", messageId: String(message.id || "").trim() });
          trashedCount += 1;
          autoHandledCount += 1;
          autoHandledSummaries.push(`${message.subject || "(no subject)"} -> trashed as definite bad (${message?.triage?.category || "other"})`);
        } catch (error) {
          autoHandledSummaries.push(`${message.subject || "(no subject)"} -> trash failed (${error.message})`);
        }
      } else {
        autoHandledCount += 1;
        autoHandledSummaries.push(`${message.subject || "(no subject)"} -> definite bad (${message?.triage?.category || "other"})`);
      }
      pendingUnsureMessageIds.delete(String(message.id || ""));
      continue;
    }
    if (rule.autoForwardGood !== false && isDefinitelyGoodMail(message) && !forwardedMessageIds.has(String(message.id || ""))) {
      try {
        await forwardMailToUser(message, notifyEmail);
        forwardedMessageIds.add(String(message.id || ""));
        pendingUnsureMessageIds.delete(String(message.id || ""));
        forwardedCount += 1;
        autoHandledSummaries.push(`${message.subject || "(no subject)"} -> forwarded to ${notifyEmail}`);
      } catch (error) {
        pendingUnsureMessageIds.add(String(message.id || ""));
        autoHandledSummaries.push(`${message.subject || "(no subject)"} -> forward failed (${error.message})`);
      }
      continue;
    }
    const messageId = String(message.id || "").trim();
    if (resolvedUnsureMessageIds.has(messageId)) {
      pendingUnsureMessageIds.delete(messageId);
      continue;
    }
    pendingUnsureMessageIds.add(messageId);
    if (messageId && !pendingUnsureBefore.has(messageId)) {
      newlyUnsureMessages.push(message);
    }
  }

  const currentInboxById = new Map(
    (Array.isArray(mailState?.recentMessages) ? mailState.recentMessages : [])
      .map((message) => [String(message.id || "").trim(), message])
      .filter(([id]) => id)
  );
  for (const messageId of [...pendingUnsureMessageIds]) {
    const message = currentInboxById.get(messageId);
    if (!message || isDefinitelyBadMail(message) || forwardedMessageIds.has(messageId)) {
      pendingUnsureMessageIds.delete(messageId);
      resolvedUnsureMessageIds.delete(messageId);
      continue;
    }
    unsureDigestCandidates.push(message);
  }

  if (rule.promptUnsure !== false && unsureDigestCandidates.length) {
    const existingWaitingTask = await findMailWatchWaitingTask(rule.id);
    const questionMessages = newlyUnsureMessages.length ? newlyUnsureMessages : unsureDigestCandidates;
    if (!existingWaitingTask && questionMessages.length) {
      const questionMessage = questionMessages[0];
      const question = buildMailWatchSingleQuestion(questionMessage);
      await createWaitingTask({
        message: question.message,
        questionForUser: question.questionForUser,
        sessionId: "mail-watch-question",
        requestedBrainId: "worker",
        intakeBrainId: "bitnet",
        internetEnabled: false,
        selectedMountIds: [],
        forceToolUse: false,
        notes: `Waiting for direction on uncertain mail from rule ${rule.id}.`,
        taskMeta: {
          internalJobType: "mail_watch_question",
          mailWatchRuleId: rule.id,
          pendingUnsureMessageIds: [String(questionMessage?.id || "").trim()].filter(Boolean)
        }
      });
      autoHandledSummaries.push(`Asked for direction on 1 unsure email in the Questions panel.`);
    }
  }

  if (
    rule.promptUnsure !== false
    && rule.sendSummaries !== false
    && unsureDigestCandidates.length
    && Number(rule.lastPromptedAt || 0) <= Date.now() - Number(rule.promptEveryMs || 4 * 60 * 60 * 1000)
  ) {
    try {
      await sendUnsureMailDigest({ rule, messages: unsureDigestCandidates });
      promptedCount = unsureDigestCandidates.length;
      autoHandledSummaries.push(`Prompted for direction on ${promptedCount} unsure email${promptedCount === 1 ? "" : "s"}.`);
    } catch (error) {
      autoHandledSummaries.push(`Direction prompt failed: ${error.message}`);
    }
  }

  const latestSeenAt = recentMessages.length
    ? Math.max(...recentMessages.map((message) => Number(message.receivedAt || 0)))
    : Number(rule.lastProcessedReceivedAt || 0);
  const updatedRule = await upsertMailWatchRule({
    ...rule,
    notifyEmail: notifyEmail || rule.notifyEmail,
    lastCheckedAt: Date.now(),
    lastProcessedReceivedAt: latestSeenAt,
    lastPromptedAt: promptedCount ? Date.now() : Number(rule.lastPromptedAt || 0),
    forwardedMessageIds: [...forwardedMessageIds],
    resolvedUnsureMessageIds: [...resolvedUnsureMessageIds],
    pendingUnsureMessageIds: [...pendingUnsureMessageIds]
  });

  const summary = recentMessages.length
    ? `Mail watch checked ${recentMessages.length} new copied email${recentMessages.length === 1 ? "" : "s"}${residualSweepCount ? ` and revisited ${residualSweepCount} older inbox item${residualSweepCount === 1 ? "" : "s"}` : ""}, forwarded ${forwardedCount}, trashed ${trashedCount}, and ${pendingUnsureMessageIds.size ? `is waiting on direction for ${pendingUnsureMessageIds.size}` : "has no uncertain mail"}`
    : pendingUnsureMessageIds.size
      ? `Mail watch found no new copied emails, but revisited ${residualSweepCount} older inbox item${residualSweepCount === 1 ? "" : "s"} and ${pendingUnsureMessageIds.size} unsure email${pendingUnsureMessageIds.size === 1 ? "" : "s"} still need direction.`
      : residualSweepCount
        ? `Mail watch found no new copied emails, but revisited ${residualSweepCount} older inbox item${residualSweepCount === 1 ? "" : "s"} and handled what it could.`
        : "Mail watch checked for new copied emails and found nothing new that needed review.";
  return {
    ok: true,
    code: 0,
    timedOut: false,
    preset: "internal-mail-watch",
    brain: AGENT_BRAINS[0],
    network: "local",
    mounts: [],
    attachments: [],
    outputFiles: [],
    parsed: { status: "ok", result: { payloads: [{ text: summary, mediaUrl: null }], meta: { durationMs: 0, ruleId: updatedRule.id, forwardedCount, autoHandledCount, trashedCount, promptedCount, pendingUnsureCount: pendingUnsureMessageIds.size, residualSweepCount, autoHandledSummaries } } },
    stdout: summary,
    stderr: ""
  };
}
  return {
    ensureAllMailWatchJobs,
    ensureMailWatchJob,
    ensureQuestionMaintenanceJob,
    executeMailWatchJob
  };
}
