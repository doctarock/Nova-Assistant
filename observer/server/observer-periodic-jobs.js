export function createObserverPeriodicJobs(context = {}) {
  const {
    AGENT_BRAINS,
    QUESTION_MAINTENANCE_INTERVAL_MS,
    TASK_QUEUE_DONE,
    TASK_QUEUE_INBOX,
    TASK_QUEUE_IN_PROGRESS,
    TASK_QUEUE_WAITING,
    chooseQuestionMaintenanceBrain,
    closeTaskRecord,
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

function normalizeMailWatchRuleAction(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["trash", "archive", "forward", "keep"].includes(normalized) ? normalized : "";
}

function extractEmailDomain(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  return atIndex >= 0 ? normalized.slice(atIndex + 1) : "";
}

function normalizeMailWatchRuleMatch(match = {}) {
  const normalized = match && typeof match === "object" ? match : {};
  return {
    fromAddress: String(normalized.fromAddress || "").trim().toLowerCase(),
    fromDomain: String(normalized.fromDomain || "").trim().toLowerCase(),
    category: String(normalized.category || "").trim().toLowerCase(),
    automated: normalized.automated === true ? true : null
  };
}

function hasMailWatchRuleMatch(match = {}) {
  const normalized = normalizeMailWatchRuleMatch(match);
  return Boolean(
    normalized.fromAddress
    || normalized.fromDomain
    || normalized.category
    || normalized.automated === true
  );
}

function isExplicitMailWatchActionRule(rule = {}) {
  return String(rule?.ruleKind || "").trim().toLowerCase() === "message_action"
    && Boolean(normalizeMailWatchRuleAction(rule?.actionOnMatch))
    && hasMailWatchRuleMatch(rule?.match);
}

function ruleMatchesMailMessage(rule = {}, message = {}) {
  const match = normalizeMailWatchRuleMatch(rule?.match);
  if (!hasMailWatchRuleMatch(match)) {
    return false;
  }
  const senderAddress = String(message?.fromAddress || "").trim().toLowerCase();
  const senderDomain = extractEmailDomain(senderAddress);
  const category = String(message?.triage?.category || "").trim().toLowerCase();
  const automated = message?.triage?.automated === true;
  if (match.fromAddress && senderAddress !== match.fromAddress) {
    return false;
  }
  if (match.fromDomain && senderDomain !== match.fromDomain) {
    return false;
  }
  if (match.category && category !== match.category) {
    return false;
  }
  if (match.automated === true && automated !== true) {
    return false;
  }
  if (match.subjectKeywords && match.subjectKeywords.length) {
    const subject = String(message?.subject || "").trim().toLowerCase();
    if (!match.subjectKeywords.some((kw) => subject.includes(kw))) {
      return false;
    }
  }
  if (match.bodyKeywords && match.bodyKeywords.length) {
    const body = String(message?.text || message?.rawText || "").trim().toLowerCase();
    if (!match.bodyKeywords.some((kw) => body.includes(kw))) {
      return false;
    }
  }
  return true;
}

function messageReservedBySpecificRule(message = {}, excludingRuleId = "") {
  const rules = Array.isArray(getMailWatchRulesState()?.rules) ? getMailWatchRulesState().rules : [];
  return rules.some((rule) =>
    rule?.enabled !== false
    && String(rule?.id || "").trim() !== String(excludingRuleId || "").trim()
    && isExplicitMailWatchActionRule(rule)
    && ruleMatchesMailMessage(rule, message)
  );
}

function getEnabledMailWatchRules() {
  const rules = Array.isArray(getMailWatchRulesState()?.rules) ? getMailWatchRulesState().rules : [];
  return rules.filter((rule) => rule && rule.enabled !== false && String(rule.id || "").trim());
}

function isMailWatchSchedulerTask(task = {}) {
  return String(task?.internalJobType || "").trim().toLowerCase() === "mail_watch";
}

async function closeObsoleteMailWatchJobs() {
  if (typeof closeTaskRecord !== "function") {
    return;
  }
  const { queued, done, failed } = await listAllTasks();
  const candidates = [...queued, ...done, ...failed].filter(isMailWatchSchedulerTask);
  for (const task of candidates) {
    await closeTaskRecord(
      task,
      "Closed legacy queue-backed mail watch task because mail rules now run directly during mail grabs."
    );
  }
}

function buildMailWatchJobResponse(summary, meta = {}) {
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
    parsed: {
      status: "ok",
      result: {
        payloads: [{ text: summary, mediaUrl: null }],
        meta: {
          durationMs: 0,
          ...meta
        }
      }
    },
    stdout: summary,
    stderr: ""
  };
}

async function ensureMailWatchJob() {
  await closeObsoleteMailWatchJobs();
  return null;
}

async function ensureAllMailWatchJobs() {
  return ensureMailWatchJob();
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

async function executeSingleMailWatchRule(rule) {
  const blocked = new Set(
    [
      getActiveMailAgent()?.email
    ].filter(Boolean).map((value) => String(value).trim().toLowerCase())
  );
  const mailState = getMailState();
  const baseInboxMessages = (Array.isArray(mailState?.recentMessages) ? mailState.recentMessages : [])
    .filter((message) => String(message.fromAddress || "").trim())
    .filter((message) => !blocked.has(String(message.fromAddress || "").trim().toLowerCase()))
    .sort((left, right) => Number(left.receivedAt || 0) - Number(right.receivedAt || 0));
  const forwardedMessageIds = new Set(Array.isArray(rule.forwardedMessageIds) ? rule.forwardedMessageIds.map((value) => String(value || "").trim()) : []);
  const resolvedUnsureMessageIds = new Set(Array.isArray(rule.resolvedUnsureMessageIds) ? rule.resolvedUnsureMessageIds.map((value) => String(value || "").trim()) : []);
  const pendingUnsureMessageIds = new Set(Array.isArray(rule.pendingUnsureMessageIds) ? rule.pendingUnsureMessageIds.map((value) => String(value || "").trim()) : []);
  if (isExplicitMailWatchActionRule(rule)) {
    const action = normalizeMailWatchRuleAction(rule.actionOnMatch);
    const recentMessages = baseInboxMessages
      .filter((message) => ruleMatchesMailMessage(rule, message))
      .filter((message) => Number(message.receivedAt || 0) > Number(rule.lastProcessedReceivedAt || 0));
    const notifyEmail = resolveMailWatchNotifyEmail(rule);
    let forwardedCount = 0;
    let movedCount = 0;
    let keptCount = 0;
    const actionSummaries = [];
    for (const message of recentMessages) {
      const messageId = String(message.id || "").trim();
      if (!messageId) {
        continue;
      }
      if (action === "trash") {
        try {
          await moveAgentMail({ destination: "trash", messageId });
          movedCount += 1;
          actionSummaries.push(`${message.subject || "(no subject)"} -> trashed by explicit rule`);
        } catch (error) {
          actionSummaries.push(`${message.subject || "(no subject)"} -> trash failed (${error.message})`);
        }
      } else if (action === "archive") {
        try {
          await moveAgentMail({ destination: "archive", messageId });
          movedCount += 1;
          actionSummaries.push(`${message.subject || "(no subject)"} -> archived by explicit rule`);
        } catch (error) {
          actionSummaries.push(`${message.subject || "(no subject)"} -> archive failed (${error.message})`);
        }
      } else if (action === "forward") {
        if (!forwardedMessageIds.has(messageId)) {
          try {
            await forwardMailToUser(message, notifyEmail);
            forwardedMessageIds.add(messageId);
            forwardedCount += 1;
            actionSummaries.push(`${message.subject || "(no subject)"} -> forwarded by explicit rule`);
          } catch (error) {
            actionSummaries.push(`${message.subject || "(no subject)"} -> forward failed (${error.message})`);
          }
        }
      } else {
        keptCount += 1;
        actionSummaries.push(`${message.subject || "(no subject)"} -> kept by explicit rule`);
      }
      resolvedUnsureMessageIds.add(messageId);
      pendingUnsureMessageIds.delete(messageId);
    }
    const latestSeenAt = recentMessages.length
      ? Math.min(Math.max(...recentMessages.map((message) => Number(message.receivedAt || 0))), Date.now())
      : Number(rule.lastProcessedReceivedAt || 0);
    const updatedRule = await upsertMailWatchRule({
      ...rule,
      forwardedMessageIds: [...forwardedMessageIds],
      resolvedUnsureMessageIds: [...resolvedUnsureMessageIds],
      pendingUnsureMessageIds: [...pendingUnsureMessageIds],
      lastCheckedAt: Date.now(),
      lastProcessedReceivedAt: latestSeenAt
    });
    const summary = recentMessages.length
      ? `Mail rule matched ${recentMessages.length} new email${recentMessages.length === 1 ? "" : "s"} and ${action === "forward" ? `forwarded ${forwardedCount}` : action === "keep" ? `kept ${keptCount}` : `${action === "trash" ? "trashed" : "archived"} ${movedCount}`}.`
      : "Mail rule checked for new matching emails and found nothing new to handle.";
    return {
      ruleId: updatedRule.id,
      action,
      summary,
      matchedCount: recentMessages.length,
      movedCount,
      forwardedCount,
      keptCount,
      trashedCount: action === "trash" ? movedCount : 0,
      archivedCount: action === "archive" ? movedCount : 0,
      pendingUnsureCount: pendingUnsureMessageIds.size,
      residualSweepCount: 0,
      actionSummaries
    };
  }
  const allInboxMessages = baseInboxMessages
    .filter((message) => !messageReservedBySpecificRule(message, rule.id));
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
    ? Math.min(Math.max(...recentMessages.map((message) => Number(message.receivedAt || 0))), Date.now())
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
    ruleId: updatedRule.id,
    action: "",
    summary,
    matchedCount: recentMessages.length,
    movedCount: 0,
    forwardedCount,
    keptCount: 0,
    trashedCount,
    archivedCount: 0,
    autoHandledCount,
    promptedCount,
    pendingUnsureCount: pendingUnsureMessageIds.size,
    residualSweepCount,
    actionSummaries: autoHandledSummaries
  };
}

function normalizeRequestedMailWatchRuleIds(ruleIds = []) {
  return Array.isArray(ruleIds)
    ? ruleIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

async function runMailWatchRulesNow({ source = "mail_grab", ruleIds = [] } = {}) {
  await closeObsoleteMailWatchJobs();
  const requestedRuleIds = normalizeRequestedMailWatchRuleIds(ruleIds);
  const enabledRules = getEnabledMailWatchRules()
    .filter((rule) => !requestedRuleIds.length || requestedRuleIds.includes(String(rule.id || "").trim()));
  if (!enabledRules.length) {
    return buildMailWatchJobResponse(
      requestedRuleIds.length
        ? "Mail rules skipped because the requested rule is no longer active."
        : "Mail rules skipped because there are no active rules in MAIL-RULES.md.",
      {
        source,
        checkedRuleCount: 0
      }
    );
  }

  const ruleResults = [];
  for (const rule of enabledRules) {
    ruleResults.push(await executeSingleMailWatchRule(rule));
  }

  const aggregate = ruleResults.reduce((totals, result) => ({
    matchedCount: totals.matchedCount + Number(result?.matchedCount || 0),
    forwardedCount: totals.forwardedCount + Number(result?.forwardedCount || 0),
    trashedCount: totals.trashedCount + Number(result?.trashedCount || 0),
    archivedCount: totals.archivedCount + Number(result?.archivedCount || 0),
    keptCount: totals.keptCount + Number(result?.keptCount || 0),
    promptedCount: totals.promptedCount + Number(result?.promptedCount || 0),
    residualSweepCount: totals.residualSweepCount + Number(result?.residualSweepCount || 0)
  }), {
    matchedCount: 0,
    forwardedCount: 0,
    trashedCount: 0,
    archivedCount: 0,
    keptCount: 0,
    promptedCount: 0,
    residualSweepCount: 0
  });
  const totalPendingUnsure = getEnabledMailWatchRules()
    .reduce((count, rule) => count + (Array.isArray(rule?.pendingUnsureMessageIds) ? rule.pendingUnsureMessageIds.length : 0), 0);
  const summaryParts = [];
  if (aggregate.matchedCount) {
    summaryParts.push(`matched ${aggregate.matchedCount} new email${aggregate.matchedCount === 1 ? "" : "s"}`);
  }
  if (aggregate.forwardedCount) {
    summaryParts.push(`forwarded ${aggregate.forwardedCount}`);
  }
  if (aggregate.trashedCount) {
    summaryParts.push(`trashed ${aggregate.trashedCount}`);
  }
  if (aggregate.archivedCount) {
    summaryParts.push(`archived ${aggregate.archivedCount}`);
  }
  if (aggregate.keptCount) {
    summaryParts.push(`kept ${aggregate.keptCount}`);
  }
  if (aggregate.promptedCount) {
    summaryParts.push(`prompted on ${aggregate.promptedCount} unsure email${aggregate.promptedCount === 1 ? "" : "s"}`);
  }
  const waitingSummary = totalPendingUnsure
    ? `${totalPendingUnsure} unsure email${totalPendingUnsure === 1 ? "" : "s"} still need direction`
    : "no unsure mail is waiting";
  const summary = summaryParts.length
    ? `Mail rules checked ${enabledRules.length} active rule${enabledRules.length === 1 ? "" : "s"} after ${source.replace(/_/g, " ")}, ${summaryParts.join(", ")}, and ${waitingSummary}.`
    : totalPendingUnsure
      ? `Mail rules checked ${enabledRules.length} active rule${enabledRules.length === 1 ? "" : "s"} after ${source.replace(/_/g, " ")} and ${waitingSummary}.`
      : `Mail rules checked ${enabledRules.length} active rule${enabledRules.length === 1 ? "" : "s"} after ${source.replace(/_/g, " ")} and found nothing new to handle.`;

  return buildMailWatchJobResponse(summary, {
    source,
    checkedRuleCount: enabledRules.length,
    totalPendingUnsure,
    ...aggregate,
    ruleSummaries: ruleResults.map((result) => ({
      ruleId: result?.ruleId || "",
      summary: result?.summary || ""
    }))
  });
}

async function executeMailWatchJob(task = {}) {
  const targetRuleId = String(task?.mailWatchRuleId || "").trim();
  return runMailWatchRulesNow({
    source: "legacy_mail_watch_task",
    ruleIds: targetRuleId ? [targetRuleId] : []
  });
}
  return {
    ensureAllMailWatchJobs,
    ensureMailWatchJob,
    ensureQuestionMaintenanceJob,
    executeMailWatchJob,
    runMailWatchRulesNow
  };
}
