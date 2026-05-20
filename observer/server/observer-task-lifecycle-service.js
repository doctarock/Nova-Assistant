export function createObserverTaskLifecycleService({
  activeTaskControllers,
  appendFailureTelemetryEntry = async () => {},
  appendQueueMaintenanceReport = async () => {},
  broadcast = () => {},
  broadcastObserverEvent = () => {},
  chooseCreativeHandoffBrain = async () => null,
  chooseIdleWorkerBrainForSpecialtyExcluding = async () => null,
  chooseIdleWorkerBrainForTransportFailover = async () => null,
  classifyFailureText = () => "",
  closedTaskRetentionMs,
  compactHookText = (value = "") => String(value || ""),
  compactTaskText = (value = "") => String(value || ""),
  ensureTaskQueueDirs = async () => {},
  extractTaskIdFromQueuePath = () => "",
  fileExists = async () => false,
  findIndexedTaskById = async () => null,
  formatTaskCodename = (value = "") => String(value || ""),
  fs,
  getBrain = async () => ({}),
  getBrainQueueLane = () => "",
  getObserverConfig = () => ({}),
  getProjectsRuntime = () => null,
  inferTaskSpecialty = () => "general",
  listAllTasks = async () => ({ queued: [], waiting: [], inProgress: [], done: [], failed: [] }),
  listTasksByFolder = async () => [],
  listVolumeFiles = async () => [],
  maxClosedTaskFiles,
  normalizeTaskRecord = (task = {}) => task,
  observerTaskQueueName,
  prepareAttachments = async () => null,
  readTaskStateIndex = async () => ({}),
  readVolumeFile = async () => "",
  recordTaskBreadcrumb = async () => {},
  persistTaskTransition = async ({ nextTask }) => nextTask,
  scheduleTaskDispatch = () => {},
  runPluginHook = async () => {},
  selectSpecialistBrainRoute = async () => null,
  taskPathForStatus = () => "",
  taskQueueClosed,
  taskQueueDone,
  taskQueueInbox,
  taskQueueInProgress,
  taskQueueWaiting,
  taskStateIndexPath,
  visibleCompletedHistoryCount,
  visibleFailedHistoryCount,
  workspaceTaskPath = () => "",
  writeTask = async () => "",
  writeTaskRecord = async (task) => task,
  writeVolumeText = async () => {}
} = {}) {
  async function chooseAutomaticRetryBrainId(task = {}, failureClassification = "") {
    const attempted = new Set((Array.isArray(task?.specialistAttemptedBrainIds) ? task.specialistAttemptedBrainIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean));
    const requestedBrainId = String(task?.requestedBrainId || "worker").trim() || "worker";
    attempted.add(requestedBrainId);
    const specialty = inferTaskSpecialty(task) || "general";
    const projectCycleRecoveryBrain = await getProjectsRuntime()?.chooseProjectCycleRecoveryBrain?.(
      task,
      failureClassification,
      specialty,
      [...attempted]
    );
    const alternateBrain = task?.capabilityMismatchSuspected === true
      ? await chooseIdleWorkerBrainForSpecialtyExcluding(specialty, [...attempted])
      : task?.transportFailoverSuggested === true
        ? await chooseIdleWorkerBrainForTransportFailover(task, specialty, [...attempted])
        : null;
    const fallbackBrainId = (Array.isArray(task?.specialistRoute?.fallbackBrainIds) ? task.specialistRoute.fallbackBrainIds : [])
      .find((id) => {
        const normalized = String(id || "").trim();
        return normalized && !attempted.has(normalized);
      }) || "";
    return String(projectCycleRecoveryBrain?.id || "").trim()
      || String(alternateBrain?.id || "").trim()
      || fallbackBrainId;
  }

  async function getWaitingQuestionBacklogCount({ excludeTaskId = "" } = {}) {
    const normalizedExcludedTaskId = String(excludeTaskId || "").trim();
    const waitingTasks = await listTasksByFolder(taskQueueWaiting, "waiting_for_user");
    return waitingTasks.filter((task) => {
      if (String(task.status || "").toLowerCase() !== "waiting_for_user") {
        return false;
      }
      if (String(task?.status || "").trim().toLowerCase() === "waiting_for_user"
        && String(task?.waitingMode || "").trim().toLowerCase() === "todo"
        && Boolean(String(task?.todoItemId || "").trim())) {
        return false;
      }
      if (normalizedExcludedTaskId && String(task.id || "") === normalizedExcludedTaskId) {
        return false;
      }
      return true;
    }).length;
  }

  function buildWaitingQuestionLimitSummary(waitingQuestionCount = 0) {
    const count = Math.max(0, Number(waitingQuestionCount || 0));
    return `Question backlog limit reached: ${count} waiting question${count === 1 ? "" : "s"} already exist, so no additional question was generated.`;
  }

  async function findTaskById(taskId) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      return null;
    }
    const indexedTask = await findIndexedTaskById(normalizedTaskId);
    if (indexedTask) {
      return indexedTask;
    }
    const [queued, waiting, inProgress, doneRaw, closed] = await Promise.all([
      listTasksByFolder(taskQueueInbox, "queued"),
      listTasksByFolder(taskQueueWaiting, "waiting_for_user"),
      listTasksByFolder(taskQueueInProgress, "in_progress"),
      listTasksByFolder(taskQueueDone, "done"),
      listTasksByFolder(taskQueueClosed, "closed")
    ]);
    return [...queued, ...waiting, ...inProgress, ...doneRaw, ...closed].find((task) => task.id === normalizedTaskId) || null;
  }

  function shouldKeepTaskVisible(task, siblings, visibleCount = 1) {
    if (!task?.id || !Array.isArray(siblings) || visibleCount <= 0) {
      return false;
    }
    const keepIds = siblings
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
      .slice(0, visibleCount)
      .map((entry) => String(entry.id || ""));
    return keepIds.includes(String(task.id || ""));
  }

  function isAutoCloseCompletedInternalTask(task) {
    const internalJobType = String(task?.internalJobType || "").trim().toLowerCase();
    return ["opportunity_scan", "mail_watch", "agent_recreation"].includes(internalJobType);
  }

  function isImmediateInternalNoopCompletion(task) {
    const internalJobType = String(task?.internalJobType || "").trim().toLowerCase();
    const summaryText = [
      String(task?.resultSummary || "").trim(),
      String(task?.reviewSummary || "").trim(),
      String(task?.workerSummary || "").trim(),
      String(task?.notes || "").trim()
    ].filter(Boolean).join("\n");
    if (internalJobType === "opportunity_scan" && /Idle scan skipped because the queue already has \d+ queued tasks\./i.test(summaryText)) {
      return true;
    }
    if (internalJobType === "opportunity_scan" && /Idle scan skipped because the observer was recently active\./i.test(summaryText)) {
      return true;
    }
    if (internalJobType === "question_maintenance" && /Question backlog limit reached: \d+ waiting questions? already exist, so no additional question was generated\./i.test(summaryText)) {
      return true;
    }
    return false;
  }

  function getAutoCloseCompletedInternalTaskReason(task) {
    const internalJobType = String(task?.internalJobType || "").trim().toLowerCase();
    if (internalJobType === "mail_watch") {
      return "Internal mail watch run completed and was closed automatically.";
    }
    if (internalJobType === "question_maintenance") {
      return "Internal question maintenance completed with no user-facing action and was closed automatically.";
    }
    if (internalJobType === "agent_recreation") {
      return "Agent recreation cycle completed and was closed automatically.";
    }
    return "Internal idle workspace opportunity scan completed and was closed automatically.";
  }

  async function archiveExpiredCompletedTasks() {
    await ensureTaskQueueDirs();
    const now = Date.now();
    const { done: completedTasks, failed: failedTasks } = await listAllTasks();
    let archivedDone = 0;
    let archivedFailed = 0;
    for (const task of [...completedTasks, ...failedTasks]) {
      if (
        (String(task.status || "").toLowerCase() === "failed" && shouldKeepTaskVisible(task, failedTasks, visibleFailedHistoryCount))
        || (String(task.status || "").toLowerCase() !== "failed" && shouldKeepTaskVisible(task, completedTasks, visibleCompletedHistoryCount))
      ) {
        continue;
      }
      await persistTaskTransition({
        previousTask: task,
        nextTask: {
          ...task,
          status: "closed",
          updatedAt: now,
          closedAt: now
        },
        eventType: "task.closed",
        reason: "Task moved into closed history during cleanup."
      });
      if (task.status === "failed") {
        archivedFailed += 1;
      } else {
        archivedDone += 1;
      }
    }
    const archived = archivedDone + archivedFailed;
    if (archived) {
      broadcast(`[observer] archived ${archivedDone} completed and ${archivedFailed} failed task(s) to closed`);
    }
    return archived;
  }

  async function compactTaskStateIndex() {
    const index = await readTaskStateIndex();
    const tasks = index?.tasks && typeof index.tasks === "object" ? index.tasks : {};
    let changed = false;
    for (const [taskId, entry] of Object.entries(tasks)) {
      if (!entry || typeof entry !== "object") {
        delete tasks[taskId];
        changed = true;
        continue;
      }
      const currentStatus = String(entry.currentStatus || "").trim().toLowerCase();
      const currentFilePath = String(entry.currentFilePath || "").trim();
      const updatedAt = Number(entry.updatedAt || 0);
      const isExpiredRemoved = currentStatus === "removed" && updatedAt > 0 && (Date.now() - updatedAt) > closedTaskRetentionMs;
      const isExpiredClosed = currentStatus === "closed" && updatedAt > 0 && (Date.now() - updatedAt) > closedTaskRetentionMs;
      const missingClosedFile = (currentStatus === "closed" || currentStatus === "removed") && currentFilePath && !(await fileExists(currentFilePath));
      if (isExpiredRemoved || isExpiredClosed || missingClosedFile) {
        delete tasks[taskId];
        changed = true;
      }
    }
    if (changed) {
      await writeVolumeText(taskStateIndexPath, `${JSON.stringify({ tasks }, null, 2)}\n`);
    }
    return changed;
  }

  async function pruneClosedTasks() {
    await ensureTaskQueueDirs();
    const entries = await listVolumeFiles(taskQueueClosed).catch(() => []);
    const files = [];
    for (const entry of entries.filter((candidate) => candidate.type === "file" && candidate.path.endsWith(".json"))) {
      try {
        const parsed = normalizeTaskRecord(JSON.parse(await readVolumeFile(entry.path)));
        const closedAt = Number(parsed.closedAt || parsed.completedAt || parsed.updatedAt || parsed.createdAt || 0);
        files.push({
          path: entry.path,
          taskId: String(parsed.id || extractTaskIdFromQueuePath(entry.path) || "").trim(),
          redirectOnly: parsed.redirectOnly === true,
          closedAt
        });
      } catch {
        files.push({
          path: entry.path,
          taskId: extractTaskIdFromQueuePath(entry.path),
          redirectOnly: false,
          closedAt: 0
        });
      }
    }
    const ordered = files.sort((left, right) => Number(right.closedAt || 0) - Number(left.closedAt || 0));
    const keepPaths = new Set(ordered.slice(0, maxClosedTaskFiles).map((entry) => entry.path));
    const now = Date.now();
    let prunedCount = 0;
    for (const file of ordered) {
      const expired = Number(file.closedAt || 0) > 0 && (now - Number(file.closedAt || 0)) > closedTaskRetentionMs;
      const overLimit = !keepPaths.has(file.path);
      if (!expired && !overLimit) {
        continue;
      }
      await fs.rm(file.path, { force: true });
      prunedCount += 1;
    }
    if (prunedCount) {
      await compactTaskStateIndex();
      broadcast(`[observer] pruned ${prunedCount} closed task file${prunedCount === 1 ? "" : "s"}.`);
    }
    return prunedCount;
  }

  async function pruneRedirectTaskFiles() {
    await ensureTaskQueueDirs();
    const folders = [taskQueueInbox, taskQueueInProgress, taskQueueDone, taskQueueClosed];
    let prunedCount = 0;
    for (const folder of folders) {
      const entries = await listVolumeFiles(folder).catch(() => []);
      for (const entry of entries.filter((candidate) => candidate.type === "file" && candidate.path.endsWith(".json"))) {
        try {
          const parsed = JSON.parse(await readVolumeFile(entry.path));
          if (!parsed?.redirectOnly) {
            continue;
          }
          await fs.rm(entry.path, { force: true });
          prunedCount += 1;
        } catch {
          // skip malformed files
        }
      }
    }
    if (prunedCount) {
      broadcast(`[observer] pruned ${prunedCount} redirect task file${prunedCount === 1 ? "" : "s"}.`);
    }
    return prunedCount;
  }

  async function runQueueStorageMaintenance() {
    const prunedRedirectsBeforeClosed = await pruneRedirectTaskFiles();
    const prunedClosed = await pruneClosedTasks();
    const prunedRedirectsAfterClosed = await pruneRedirectTaskFiles();
    const prunedRedirects = prunedRedirectsBeforeClosed + prunedRedirectsAfterClosed;
    const compactedIndex = await compactTaskStateIndex();
    const reportLines = [];
    if (prunedRedirects) {
      reportLines.push(`pruned ${prunedRedirects} redirect stub file${prunedRedirects === 1 ? "" : "s"}`);
    }
    if (prunedClosed) {
      reportLines.push(`pruned ${prunedClosed} closed history file${prunedClosed === 1 ? "" : "s"}`);
    }
    if (compactedIndex) {
      reportLines.push("compacted the task-state index");
    }
    if (reportLines.length) {
      await appendQueueMaintenanceReport("Queue storage maintenance completed.", reportLines);
    }
    return {
      migration,
      prunedRedirects,
      prunedClosed,
      compactedIndex
    };
  }

  async function closeCompletedInternalPeriodicTasks() {
    await ensureTaskQueueDirs();
    const completedTasks = await listTasksByFolder(taskQueueDone, "done");
    const closable = completedTasks.filter((task) => {
      if (task.maintenanceReviewedAt || String(task.status || "").toLowerCase() === "failed") {
        return false;
      }
      if (shouldKeepTaskVisible(task, completedTasks, visibleCompletedHistoryCount)) {
        return false;
      }
      return isAutoCloseCompletedInternalTask(task);
    });
    let closedCount = 0;
    for (const task of closable) {
      await closeTaskRecord(task, getAutoCloseCompletedInternalTaskReason(task));
      closedCount += 1;
    }
    if (closedCount) {
      await appendQueueMaintenanceReport(
        `Queue maintenance report: closed ${closedCount} completed internal periodic task${closedCount === 1 ? "" : "s"}.`,
        [
          "Recurring internal jobs now close themselves after documenting the run."
        ]
      );
    }
    return closedCount;
  }

  async function createQueuedTask({
    message,
    sessionId = "Main",
    requestedBrainId = "worker",
    intakeBrainId = "bitnet",
    internetEnabled = getObserverConfig().defaults.internetEnabled,
    selectedMountIds = getObserverConfig().defaults.mountIds,
    forceToolUse = false,
    requireWorkerPreflight = false,
    attachments = [],
    helperAnalysis = null,
    notes = "Observer queued task for deferred processing.",
    taskMeta = {}
  }) {
    let requestedBrain = await getBrain(String(requestedBrainId || "worker"));
    const internalCpuJob = String(taskMeta?.internalJobType || "").trim();
    const lockRequestedBrain = taskMeta?.lockRequestedBrain === true;
    const allowsInternalQueueJob = internalCpuJob && (requestedBrain.kind === "intake" || requestedBrain.kind === "helper");
    if ((!requestedBrain.toolCapable || requestedBrain.kind !== "worker") && !allowsInternalQueueJob) {
      throw new Error(`brain "${requestedBrain.id}" cannot process queued tool tasks`);
    }
    let specialistRoute = taskMeta?.specialistRoute && typeof taskMeta.specialistRoute === "object"
      ? taskMeta.specialistRoute
      : null;
    if (!lockRequestedBrain && !specialistRoute && requestedBrain.kind === "worker" && requestedBrain.toolCapable) {
      specialistRoute = await selectSpecialistBrainRoute({
        message,
        notes,
        ...taskMeta
      }, {
        preferredBrainId: requestedBrain.id
      });
      if (specialistRoute?.preferredBrainId) {
        requestedBrain = await getBrain(specialistRoute.preferredBrainId);
      }
    }
    const inferredSpecialty = inferTaskSpecialty({
      message,
      notes,
      attachments: Array.isArray(attachments) ? attachments : [],
      ...taskMeta
    });
    const creativeHandoffSkipped = taskMeta?.skipCreativeHandoff === true;
    const creativeHandoffBrain = !String(taskMeta?.creativeHandoffBrainId || "").trim()
      && !creativeHandoffSkipped
      && inferredSpecialty === "creative"
      && requestedBrain.kind === "worker"
      && requestedBrain.toolCapable
        ? await chooseCreativeHandoffBrain({ excludeBrainId: requestedBrain.id })
        : null;
    const resolvedTaskMeta = {
      ...taskMeta,
      ...(creativeHandoffBrain?.id ? { creativeHandoffBrainId: creativeHandoffBrain.id } : {})
    };

    const preparedAttachments = await prepareAttachments(Array.isArray(attachments) ? attachments : []);
    const now = Date.now();
    const task = {
      id: `task-${now}`,
      codename: formatTaskCodename(`task-${now}`),
      status: "queued",
      createdAt: now,
      updatedAt: now,
      sessionId,
      intakeBrainId,
      requestedBrainId: requestedBrain.id,
      requestedBrainLabel: requestedBrain.label,
      internetEnabled,
      mountIds: selectedMountIds,
      forceToolUse,
      requireWorkerPreflight,
      message: String(message || "").trim(),
      attachments: preparedAttachments?.files || [],
      helperAnalysis: helperAnalysis && typeof helperAnalysis === "object" ? helperAnalysis : undefined,
      specialistRoute: specialistRoute || undefined,
      specialistAttemptedBrainIds: [],
      queueLane: getBrainQueueLane(requestedBrain),
      notes,
      ...resolvedTaskMeta
    };
    const filePath = await writeTask(task);
    const queuedTask = {
      ...task,
      filePath,
      workspacePath: workspaceTaskPath("queued", task.id)
    };
    await recordTaskBreadcrumb({
      taskId: queuedTask.id,
      eventType: "task.created",
      toStatus: "queued",
      toPath: filePath,
      toWorkspacePath: queuedTask.workspacePath,
      reason: notes,
      sessionId: queuedTask.sessionId,
      brainId: queuedTask.requestedBrainId
    });
    broadcastObserverEvent({
      type: "task.queued",
      task: queuedTask
    });
    runPluginHook("queue:task-created", {
      at: Date.now(),
      taskId: queuedTask.id,
      codename: queuedTask.codename,
      message: compactHookText(String(queuedTask.message || "").trim(), 220),
      sessionId: String(queuedTask.sessionId || "Main").trim(),
      brainId: String(queuedTask.requestedBrainId || "").trim(),
      queueLane: String(queuedTask.queueLane || "").trim(),
      internalJobType: String(queuedTask.internalJobType || "").trim()
    }).catch(() => {});
    scheduleTaskDispatch();
    return queuedTask;
  }

  async function abortActiveTask(taskId = "", reason = "Aborted by user.") {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      throw new Error("taskId is required");
    }
    const task = await findTaskById(normalizedTaskId);
    if (!task) {
      throw new Error("task not found");
    }
    if (String(task.status || "") !== "in_progress") {
      throw new Error("task is not currently in progress");
    }
    const controller = activeTaskControllers.get(normalizedTaskId);
    if (controller) {
      controller.abort();
    }
    const abortedAt = Date.now();
    const updatedTask = {
      ...task,
      updatedAt: abortedAt,
      abortRequestedAt: abortedAt,
      progressNote: "Abort requested. Stopping active work.",
      notes: compactTaskText(reason, 240)
    };
    const inProgressPath = taskPathForStatus(normalizedTaskId, "in_progress");
    await writeVolumeText(inProgressPath, `${JSON.stringify(updatedTask, null, 2)}\n`);
    broadcastObserverEvent({
      type: "task.progress",
      task: updatedTask
    });
    return updatedTask;
  }

  async function forceStopTask(taskId = "", reason = "Force-cleared by user.") {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      throw new Error("taskId is required");
    }
    const task = await findTaskById(normalizedTaskId);
    if (!task) {
      throw new Error("task not found");
    }
    if (String(task.status || "") !== "in_progress") {
      throw new Error("task is not currently in progress");
    }
    const now = Date.now();
    const controller = activeTaskControllers.get(normalizedTaskId);
    if (controller) {
      controller.abort();
      activeTaskControllers.delete(normalizedTaskId);
    }
    return closeTaskRecord({
      ...task,
      updatedAt: now,
      abortRequestedAt: Number(task.abortRequestedAt || 0) || now,
      aborted: true,
      abortedAt: now,
      progressNote: "Force-cleared by user.",
      workerSummary: String(task.workerSummary || "").trim(),
      reviewSummary: String(task.reviewSummary || "").trim(),
      resultSummary: compactTaskText(
        String(task.resultSummary || reason || "Force-cleared by user.").trim(),
        420
      ),
      notes: compactTaskText(String(reason || "Force-cleared by user.").trim(), 240)
    }, reason || "Force-cleared by user.");
  }

  async function createWaitingTask({
    message,
    questionForUser,
    sessionId = "Main",
    requestedBrainId = "worker",
    intakeBrainId = "bitnet",
    internetEnabled = getObserverConfig().defaults.internetEnabled,
    selectedMountIds = getObserverConfig().defaults.mountIds,
    forceToolUse = false,
    notes = "Observer is waiting for user direction.",
    taskMeta = {}
  }) {
    const requestedBrain = await getBrain(String(requestedBrainId || "worker"));
    const now = Date.now();
    const task = normalizeTaskRecord({
      id: `task-${now}`,
      codename: formatTaskCodename(`task-${now}`),
      status: "waiting_for_user",
      createdAt: now,
      updatedAt: now,
      waitingForUserAt: now,
      answerPending: true,
      sessionId,
      intakeBrainId,
      requestedBrainId: requestedBrain.id,
      requestedBrainLabel: requestedBrain.label,
      internetEnabled,
      mountIds: Array.isArray(selectedMountIds) ? selectedMountIds : [],
      forceToolUse,
      message: String(message || "").trim(),
      originalMessage: String(message || "").trim(),
      questionForUser: compactTaskText(String(questionForUser || "").trim(), 2000),
      queueLane: getBrainQueueLane(requestedBrain),
      notes,
      ...taskMeta
    });
    const savedTask = await writeTaskRecord(task);
    await recordTaskBreadcrumb({
      taskId: savedTask.id,
      eventType: "task.waiting",
      toStatus: "waiting_for_user",
      toPath: savedTask.filePath,
      toWorkspacePath: savedTask.workspacePath,
      reason: notes,
      sessionId: savedTask.sessionId,
      brainId: savedTask.requestedBrainId
    });
    broadcastObserverEvent({
      type: "task.waiting",
      task: savedTask
    });
    return savedTask;
  }

  async function findRecentCronTaskRuns(seriesId, limit = 3) {
    if (!seriesId) {
      return [];
    }
    const { done, failed } = await listAllTasks();
    return [...done, ...failed]
      .filter((task) => String(task.scheduler?.seriesId || "") === String(seriesId))
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
      .slice(0, limit);
  }

  async function findRecentDuplicateQueuedTask({
    message,
    sessionId = "Main",
    requestedBrainId = "worker",
    intakeBrainId = "bitnet",
    dedupeWindowMs = 8000
  } = {}) {
    const trimmedMessage = String(message || "").trim();
    if (!trimmedMessage) {
      return null;
    }
    const now = Date.now();
    const { queued, inProgress, failed } = await listAllTasks();
    return [...queued, ...inProgress, ...failed].find((task) => {
      const taskAgeMs = now - Number(task.updatedAt || task.createdAt || 0);
      if (taskAgeMs < 0 || taskAgeMs > dedupeWindowMs) {
        return false;
      }
      return String(task.message || "").trim() === trimmedMessage
        && String(task.sessionId || "Main") === String(sessionId || "Main")
        && String(task.requestedBrainId || "worker") === String(requestedBrainId || "worker")
        && String(task.intakeBrainId || "bitnet") === String(intakeBrainId || "bitnet");
    }) || null;
  }

  async function findTaskByOpportunityKey(opportunityKey = "") {
    const key = String(opportunityKey || "").trim();
    if (!key) {
      return null;
    }
    const [queued, inProgress, done, closed] = await Promise.all([
      listTasksByFolder(taskQueueInbox, "queued"),
      listTasksByFolder(taskQueueInProgress, "in_progress"),
      listTasksByFolder(taskQueueDone, "done"),
      listTasksByFolder(taskQueueClosed, "closed")
    ]);
    return [...queued, ...inProgress, ...done, ...closed].find((task) => String(task.opportunityKey || "") === key) || null;
  }

  async function findTaskByMaintenanceKey(maintenanceKey = "") {
    const key = String(maintenanceKey || "").trim();
    if (!key) {
      return null;
    }
    const [queued, inProgress, done, closed] = await Promise.all([
      listTasksByFolder(taskQueueInbox, "queued"),
      listTasksByFolder(taskQueueInProgress, "in_progress"),
      listTasksByFolder(taskQueueDone, "done"),
      listTasksByFolder(taskQueueClosed, "closed")
    ]);
    return [...queued, ...inProgress, ...done, ...closed].find((task) => String(task.maintenanceKey || "") === key) || null;
  }

  async function closeTaskRecord(task, reason = "") {
    const now = Date.now();
    const closedTask = await persistTaskTransition({
      previousTask: task,
      nextTask: {
        ...task,
        status: "closed",
        closedFromStatus: String(task?.status || "").trim() || "unknown",
        updatedAt: now,
        closedAt: now,
        maintenanceReviewedAt: now,
        maintenanceDecision: "closed",
        maintenanceReason: String(reason || "").trim(),
        notes: String(reason || task.notes || "").trim() || task.notes
      },
      eventType: "task.closed",
      reason: reason || "Task closed."
    });
    broadcastObserverEvent({
      type: "task.closed",
      task: closedTask
    });
    if (String(task?.status || "").toLowerCase() === "failed") {
      await appendFailureTelemetryEntry({
        task: closedTask,
        phase: "maintenance_close",
        summary: reason || closedTask.resultSummary || closedTask.reviewSummary || closedTask.notes || "",
        classification: classifyFailureText(reason || closedTask.resultSummary || closedTask.reviewSummary || closedTask.notes || "")
      });
    }
    return closedTask;
  }

  return {
    abortActiveTask,
    archiveExpiredCompletedTasks,
    buildWaitingQuestionLimitSummary,
    chooseAutomaticRetryBrainId,
    closeCompletedInternalPeriodicTasks,
    closeTaskRecord,
    createQueuedTask,
    createWaitingTask,
    findRecentCronTaskRuns,
    findRecentDuplicateQueuedTask,
    findTaskById,
    findTaskByMaintenanceKey,
    findTaskByOpportunityKey,
    forceStopTask,
    getAutoCloseCompletedInternalTaskReason,
    getWaitingQuestionBacklogCount,
    isAutoCloseCompletedInternalTask,
    isImmediateInternalNoopCompletion,
    runQueueStorageMaintenance,
    shouldKeepTaskVisible
  };
}
