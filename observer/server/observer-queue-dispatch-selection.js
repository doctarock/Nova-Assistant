export function createObserverQueueDispatchSelection(context = {}) {
  const {
    TASK_QUEUE_IN_PROGRESS,
    findRecentProjectCycleMessageAttempt,
    findRecentProjectWorkAttempt,
    getBrain,
    getBrainQueueLane,
    getProjectConfig,
    listTasksByFolder,
    normalizeOllamaBaseUrl
  } = context;

  async function getActiveQueueLanes(activeTasks = []) {
    const lanes = new Set();
    for (const task of Array.isArray(activeTasks) ? activeTasks : []) {
      const explicitLane = String(task.queueLane || "").trim();
      if (explicitLane) {
        lanes.add(explicitLane);
        continue;
      }
      const brain = await getBrain(task.requestedBrainId || "worker");
      const derivedLane = getBrainQueueLane(brain);
      if (derivedLane) {
        lanes.add(derivedLane);
      }
    }
    return lanes;
  }

  async function selectDispatchableQueuedTask(tasks, { preferredBrainId = "", remoteParallel = false } = {}) {
    const projectConfig = getProjectConfig();
    const dueTasks = [];
    for (const entry of tasks) {
      if (Number(entry.notBeforeAt || 0) > Date.now()) {
        continue;
      }
      if (String(entry.queueLane || "").trim()) {
        const brain = await getBrain(entry.requestedBrainId || "worker");
        dueTasks.push({
          ...entry,
          queueLane: String(entry.queueLane || "").trim() || getBrainQueueLane(brain),
          ollamaBaseUrl: normalizeOllamaBaseUrl(String(entry.ollamaBaseUrl || brain?.ollamaBaseUrl || "").trim())
        });
        continue;
      }
      const brain = await getBrain(entry.requestedBrainId || "worker");
      dueTasks.push({
        ...entry,
        queueLane: getBrainQueueLane(brain),
        ollamaBaseUrl: normalizeOllamaBaseUrl(String(brain?.ollamaBaseUrl || "").trim())
      });
    }
    if (!dueTasks.length) {
      return { task: null, message: "No due queued tasks." };
    }

    const suppressedTaskIds = new Set();
    for (const entry of dueTasks) {
      if (entry?.lockRequestedBrain === true) {
        continue;
      }
      const isRetryFollowUp = Boolean(
        String(entry.previousTaskId || "").trim()
        || Number(entry.reshapeAttemptCount || 0) > 0
        || entry.capabilityMismatchSuspected === true
        || String(entry.failureClassification || "").trim()
      );
      if (String(entry.internalJobType || "") !== "project_cycle") {
        if (
          !isRetryFollowUp
          && String(entry.sessionId || "").trim() === "project-cycle"
          && !String(entry.projectWorkKey || "").trim()
          && await findRecentProjectCycleMessageAttempt(entry.message, projectConfig.projectWorkRetryCooldownMs, entry.id)
        ) {
          suppressedTaskIds.add(String(entry.id || ""));
        }
        continue;
      }
      if (isRetryFollowUp) {
        continue;
      }
      const recentAttempt = await findRecentProjectWorkAttempt(entry.projectWorkKey, projectConfig.projectWorkRetryCooldownMs, entry.id);
      if (recentAttempt) {
        suppressedTaskIds.add(String(entry.id || ""));
      }
    }
    const eligibleDueTasks = dueTasks.filter((entry) => !suppressedTaskIds.has(String(entry.id || "")));
    if (!eligibleDueTasks.length) {
      return { task: null, message: "Queued project work is cooling down after recent attempts." };
    }

    const activeTasks = await listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress");
    if (!remoteParallel && activeTasks.length) {
      return {
        task: null,
        message: "Another queued task is already in progress.",
        activeTask: activeTasks[0]
      };
    }

    const activeLanes = await getActiveQueueLanes(activeTasks);
    const dispatchable = eligibleDueTasks.filter((entry) => {
      const projectName = String(entry.projectName || "").trim().toLowerCase();
      if (projectName) {
        const activeProjectTaskCount = activeTasks.filter((task) =>
          String(task.id || "") !== String(entry.id || "")
          && String(task.projectName || "").trim().toLowerCase() === projectName
          && String(task.internalJobType || "") === "project_cycle"
        ).length;
        if (activeProjectTaskCount >= projectConfig.maxActiveWorkPackagesPerProject) {
          return false;
        }
      }
      if (!remoteParallel) {
        return true;
      }
      const lane = String(entry.queueLane || "").trim();
      if (lane && activeLanes.has(lane)) {
        return false;
      }
      return true;
    });
    if (!dispatchable.length) {
      return { task: null, message: "All available worker lanes are already busy." };
    }

    if (preferredBrainId) {
      const preferredTask = dispatchable.find((entry) => (entry.requestedBrainId || "worker") === preferredBrainId);
      if (!preferredTask) {
        return { task: null, message: `No dispatchable queued task is ready for ${preferredBrainId}.` };
      }
      return { task: preferredTask };
    }

    return { task: dispatchable[0] };
  }

  return {
    selectDispatchableQueuedTask
  };
}
