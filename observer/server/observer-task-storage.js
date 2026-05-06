export function createObserverTaskStorage(options = {}) {
  const {
    broadcast = () => {},
    broadcastObserverEvent = () => {},
    compactTaskText = (value = "") => String(value || ""),
    deriveTaskIndexPathDetails = (_filePath = "") => ({ status: "", workspacePath: "" }),
    ensureTaskQueueDirs = async () => {},
    fileExists = async () => false,
    formatElapsedShort = (value = 0) => String(value || 0),
    fs = null,
    getBrain = async () => null,
    getBrainQueueLane = () => "",
    getTaskDispatchInFlight = () => false,
    getTaskDispatchStartedAt = () => 0,
    listVolumeFiles = async () => [],
    normalizeTaskRecord = (task = {}) => task,
    pathModule = null,
    readVolumeFile = async () => "",
    recordTaskBreadcrumb = async () => {},
    setTaskDispatchInFlight = () => {},
    setTaskDispatchStartedAt = () => {},
    taskOrphanedInProgressMs = 0,
    taskPathForStatusFallback = () => "",
    taskQueueClosed = "",
    taskQueueDone = "",
    taskQueueInbox = "",
    taskQueueInProgress = "",
    taskQueueWaiting = "",
    taskStaleInProgressMs = 0,
    writeVolumeText = async () => {}
  } = options;

  function workspaceTaskPath(status, taskId) {
    const fileName = `${taskId}.json`;
    if (status === "in_progress") return `queue/in_progress/${fileName}`;
    if (status === "closed") return `queue/closed/${fileName}`;
    if (status === "waiting_for_user") return `queue/inbox/${fileName}`;
    if (status === "done" || status === "completed" || status === "failed") return `queue/done/${fileName}`;
    return `queue/inbox/${fileName}`;
  }

  function taskPathForStatus(taskId, status) {
    const fileName = `${taskId}.json`;
    if (status === "in_progress") return pathModule.join(taskQueueInProgress, fileName);
    if (status === "closed") return pathModule.join(taskQueueClosed, fileName);
    if (status === "waiting_for_user") return pathModule.join(taskQueueInbox, fileName);
    if (status === "done" || status === "completed" || status === "failed") return pathModule.join(taskQueueDone, fileName);
    return pathModule.join(taskQueueInbox, fileName);
  }

  function materializeTaskRecord(task = {}) {
    const normalizedTask = normalizeTaskRecord(task);
    return {
      ...normalizedTask,
      filePath: taskPathForStatus(normalizedTask.id, normalizedTask.status),
      workspacePath: workspaceTaskPath(normalizedTask.status, normalizedTask.id)
    };
  }

  async function writeTaskRecord(task = {}) {
    const materializedTask = materializeTaskRecord(task);
    await writeVolumeText(materializedTask.filePath, `${JSON.stringify(materializedTask, null, 2)}\n`);
    return materializedTask;
  }

  async function removeObsoleteTaskFile(previousPath = "", nextPath = "") {
    const normalizedPreviousPath = String(previousPath || "").trim();
    const normalizedNextPath = String(nextPath || "").trim();
    if (!normalizedPreviousPath || normalizedPreviousPath === normalizedNextPath) {
      return false;
    }
    await fs.rm(normalizedPreviousPath, { force: true }).catch(() => {});
    return true;
  }

  async function persistTaskTransition({
    previousTask = null,
    previousPath = "",
    nextTask = {},
    eventType = "task.updated",
    reason = ""
  } = {}) {
    const sourceTask = previousTask && typeof previousTask === "object" ? previousTask : null;
    const sourcePath = String(previousPath || sourceTask?.filePath || "").trim()
      || taskPathForStatus(String(nextTask?.id || ""), String(sourceTask?.status || "").trim());
    const derivedSource = deriveTaskIndexPathDetails(sourcePath);
    const sourceStatus = String(sourceTask?.status || derivedSource.status || "").trim();
    const sourceWorkspacePath = String(sourceTask?.workspacePath || derivedSource.workspacePath || "").trim()
      || workspaceTaskPath(sourceStatus || "queued", String(nextTask?.id || ""));
    const savedTask = await writeTaskRecord(nextTask);
    await removeObsoleteTaskFile(sourcePath, savedTask.filePath);
    const transitionEvent = await recordTaskBreadcrumb({
      taskId: savedTask.id,
      eventType,
      fromStatus: sourceStatus,
      fromPath: sourcePath,
      fromWorkspacePath: sourceWorkspacePath,
      toStatus: savedTask.status,
      toPath: savedTask.filePath,
      toWorkspacePath: savedTask.workspacePath,
      reason,
      sessionId: savedTask.sessionId,
      brainId: savedTask.requestedBrainId
    });
    return {
      ...savedTask,
      latestEventSeq: Number(transitionEvent?.eventSeq || savedTask.latestEventSeq || 0)
    };
  }

  async function listExistingTaskFilePaths(taskId = "") {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      return [];
    }
    const candidates = new Set([
      taskPathForStatus(normalizedTaskId, "queued"),
      taskPathForStatus(normalizedTaskId, "in_progress"),
      taskPathForStatus(normalizedTaskId, "done"),
      taskPathForStatus(normalizedTaskId, "closed")
    ]);
    const existing = [];
    for (const candidatePath of candidates) {
      if (await fileExists(candidatePath)) {
        existing.push(candidatePath);
      }
    }
    return existing;
  }

  async function removeTaskRecord(task, reason = "Task removed from queue.") {
    const normalizedTaskId = String(task?.id || "").trim();
    if (!normalizedTaskId) {
      throw new Error("task id is required");
    }
    const sourceStatus = String(task?.status || "").trim();
    const sourcePath = String(task?.filePath || "").trim() || taskPathForStatus(normalizedTaskId, sourceStatus);
    const sourceWorkspacePath = String(task?.workspacePath || "").trim()
      || workspaceTaskPath(sourceStatus || "queued", normalizedTaskId);
    const removedPaths = new Set(await listExistingTaskFilePaths(normalizedTaskId));
    removedPaths.add(sourcePath);
    for (const filePath of removedPaths) {
      await fs.rm(filePath, { force: true }).catch(() => {});
    }
    const removedEvent = await recordTaskBreadcrumb({
      taskId: normalizedTaskId,
      eventType: "task.removed",
      fromStatus: sourceStatus,
      fromPath: sourcePath,
      fromWorkspacePath: sourceWorkspacePath,
      toStatus: "removed",
      toPath: "",
      toWorkspacePath: "",
      reason: String(reason || "").trim() || "Task removed from queue.",
      sessionId: String(task?.sessionId || "").trim(),
      brainId: String(task?.requestedBrainId || "").trim()
    });
    return Object.assign([...removedPaths], { latestEventSeq: Number(removedEvent?.eventSeq || 0) });
  }

  async function writeTask(task) {
    await ensureTaskQueueDirs();
    const normalizedTask = await writeTaskRecord(task);
    const writtenEvent = await recordTaskBreadcrumb({
      taskId: normalizedTask.id,
      eventType: "task.state_written",
      toStatus: normalizedTask.status,
      toPath: normalizedTask.filePath,
      toWorkspacePath: normalizedTask.workspacePath,
      reason: "Canonical task state written.",
      sessionId: normalizedTask.sessionId,
      brainId: normalizedTask.requestedBrainId
    });
    normalizedTask.latestEventSeq = Number(writtenEvent?.eventSeq || normalizedTask.latestEventSeq || 0);
    return normalizedTask.filePath;
  }

  function isCanonicalInProgressTaskRun(task, expectedTask = null, expectedPath = "") {
    if (!task || String(task.status || "").trim() !== "in_progress") {
      return false;
    }
    const normalizedExpectedPath = pathModule.resolve(String(expectedPath || "").trim());
    if (normalizedExpectedPath && pathModule.resolve(String(task.filePath || "").trim()) !== normalizedExpectedPath) {
      return false;
    }
    if (expectedTask && Number(task.startedAt || 0) !== Number(expectedTask.startedAt || 0)) {
      return false;
    }
    return true;
  }

  async function listTasksByFolder(folder, status) {
    await ensureTaskQueueDirs();
    const entries = await listVolumeFiles(folder);
    const files = entries.filter((entry) => entry.type === "file" && entry.path.endsWith(".json"));
    const tasks = [];
    for (const entry of files) {
      try {
        const content = await readVolumeFile(entry.path);
        const parsed = normalizeTaskRecord(JSON.parse(content));
        if (parsed.redirectOnly) {
          continue;
        }
        tasks.push({
          ...parsed,
          status: parsed.status || status,
          filePath: entry.path
        });
      } catch {
        // Skip malformed queue files.
      }
    }
    return tasks.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  }

  function isTodoBackedWaitingTask(task = {}) {
    return String(task?.status || "").trim().toLowerCase() === "waiting_for_user"
      && String(task?.waitingMode || "").trim().toLowerCase() === "todo"
      && Boolean(String(task?.todoItemId || "").trim());
  }

  async function listAllTasks() {
    const [queued, inProgress, doneRaw] = await Promise.all([
      listTasksByFolder(taskQueueInbox, "queued"),
      listTasksByFolder(taskQueueInProgress, "in_progress"),
      listTasksByFolder(taskQueueDone, "done")
    ]);
    const waiting = queued.filter((task) =>
      String(task.status || "").toLowerCase() === "waiting_for_user"
      && !isTodoBackedWaitingTask(task)
    );
    const queuedReady = queued.filter((task) => String(task.status || "").toLowerCase() !== "waiting_for_user");
    const failed = doneRaw.filter((task) => String(task.status || "").toLowerCase() === "failed");
    const done = doneRaw.filter((task) => String(task.status || "").toLowerCase() !== "failed");
    return { queued: queuedReady, waiting, inProgress, done, failed };
  }

  async function recoverStaleInProgressTasks({ activeTaskControllers = new Map() } = {}) {
    const inProgressTasks = await listTasksByFolder(taskQueueInProgress, "in_progress");
    if (!inProgressTasks.length) {
      return [];
    }

    const now = Date.now();
    const recovered = [];
    for (const task of inProgressTasks) {
      const lastTouchedAt = Number(task.lastHeartbeatAt || task.updatedAt || task.startedAt || task.createdAt || 0);
      const orphanedWithoutController = !activeTaskControllers.has(String(task.id || "").trim());
      const staleWindowMs = orphanedWithoutController ? taskOrphanedInProgressMs : taskStaleInProgressMs;
      if (!lastTouchedAt || now - lastTouchedAt < staleWindowMs) {
        continue;
      }

      const attemptCount = Number(task.dispatchCount || 0);
      if (attemptCount >= 2) {
        const failedTask = await persistTaskTransition({
          previousTask: task,
          nextTask: {
            ...task,
            status: "failed",
            updatedAt: now,
            completedAt: now,
            stalledAt: lastTouchedAt,
            resultSummary: `Task stalled after ${attemptCount} attempts and was marked failed.`,
            notes: `Marked failed after ${attemptCount} attempts because it stalled for ${formatElapsedShort(now - lastTouchedAt)} without a heartbeat or completion${orphanedWithoutController ? " after the worker controller was lost" : ""}.`,
            recoveryTrail: [
              ...(Array.isArray(task.recoveryTrail) ? task.recoveryTrail : []),
              { at: now, from: "in_progress", to: "failed", reason: "stale_in_progress_attempt_limit" }
            ]
          },
          eventType: "task.failed",
          reason: `Marked failed after ${attemptCount} attempts because it stalled for ${formatElapsedShort(now - lastTouchedAt)} without a heartbeat or completion${orphanedWithoutController ? " after the worker controller was lost" : ""}.`
        });
        broadcastObserverEvent({ type: "task.failed", task: failedTask });
        recovered.push(failedTask);
        continue;
      }

      const recoveredTask = await persistTaskTransition({
        previousTask: task,
        nextTask: {
          ...task,
          status: "queued",
          updatedAt: now,
          recoveredAt: now,
          stalledAt: lastTouchedAt,
          notes: `Recovered from stale in_progress after ${formatElapsedShort(now - lastTouchedAt)} without a heartbeat or completion${orphanedWithoutController ? " after the worker controller was lost" : ""}.`,
          recoveryTrail: [
            ...(Array.isArray(task.recoveryTrail) ? task.recoveryTrail : []),
            { at: now, from: "in_progress", to: "queued", reason: "stale_in_progress" }
          ]
        },
        eventType: "task.recovered",
        reason: `Recovered from stale in_progress after ${formatElapsedShort(now - lastTouchedAt)} without a heartbeat or completion${orphanedWithoutController ? " after the worker controller was lost" : ""}.`
      });
      broadcastObserverEvent({ type: "task.recovered", task: { ...recoveredTask, recovered: true } });
      recovered.push(recoveredTask);
    }

    return recovered;
  }

  async function recoverConflictingInProgressLaneTasks() {
    const inProgressTasks = await listTasksByFolder(taskQueueInProgress, "in_progress");
    if (!inProgressTasks.length) {
      return [];
    }
    const byLane = new Map();
    for (const task of inProgressTasks) {
      const lane = String(task.queueLane || "").trim()
        || getBrainQueueLane(await getBrain(task.requestedBrainId || "worker"));
      if (!lane) {
        continue;
      }
      if (!byLane.has(lane)) {
        byLane.set(lane, []);
      }
      byLane.get(lane).push(task);
    }
    const now = Date.now();
    const recovered = [];
    for (const [lane, tasks] of byLane.entries()) {
      if (tasks.length <= 1) {
        continue;
      }
      const ordered = [...tasks].sort((left, right) => {
        const leftStarted = Number(left.startedAt || left.updatedAt || left.createdAt || 0);
        const rightStarted = Number(right.startedAt || right.updatedAt || right.createdAt || 0);
        return leftStarted - rightStarted;
      });
      const keeper = ordered[0];
      for (const task of ordered.slice(1)) {
        const recoveryNote = compactTaskText(`Recovered from lane conflict on ${lane}; ${keeper.codename || keeper.id} kept the active slot. ${String(task.notes || "").trim()}`.trim(), 260);
        const recoveredTask = await persistTaskTransition({
          previousTask: task,
          nextTask: {
            ...task,
            status: "queued",
            updatedAt: now,
            recoveredAt: now,
            stalledAt: Number(task.lastHeartbeatAt || task.updatedAt || task.startedAt || task.createdAt || now),
            notes: recoveryNote,
            recoveryTrail: [
              ...(Array.isArray(task.recoveryTrail) ? task.recoveryTrail : []),
              { at: now, from: "in_progress", to: "queued", reason: "queue_lane_conflict", lane, keptTaskId: keeper.id }
            ]
          },
          eventType: "task.recovered",
          reason: recoveryNote
        });
        broadcastObserverEvent({ type: "task.recovered", task: { ...recoveredTask, recovered: true } });
        recovered.push(recoveredTask);
      }
    }
    return recovered;
  }

  async function recoverStaleTaskDispatchLock(maxAgeMs = 20000) {
    if (!getTaskDispatchInFlight()) {
      setTaskDispatchStartedAt(0);
      return false;
    }
    const startedAt = Number(getTaskDispatchStartedAt() || 0);
    if (!startedAt || (Date.now() - startedAt) < maxAgeMs) {
      return false;
    }
    const inProgressTasks = await listTasksByFolder(taskQueueInProgress, "in_progress");
    if (inProgressTasks.length) {
      return false;
    }
    setTaskDispatchInFlight(false);
    setTaskDispatchStartedAt(0);
    broadcast(`[observer] recovered a stale task dispatch lock after ${formatElapsedShort(Date.now() - startedAt)} with no in-progress task.`);
    return true;
  }

  return {
    isCanonicalInProgressTaskRun,
    isTodoBackedWaitingTask,
    listAllTasks,
    listTasksByFolder,
    materializeTaskRecord,
    persistTaskTransition,
    recoverConflictingInProgressLaneTasks,
    recoverStaleInProgressTasks,
    recoverStaleTaskDispatchLock,
    removeTaskRecord,
    taskPathForStatus,
    workspaceTaskPath,
    writeTask,
    writeTaskRecord
  };
}
