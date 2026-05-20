const VOLUME_WRITE_RETRY_CODES = new Set([
  "EBUSY",
  "EMFILE",
  "ENFILE",
  "EPERM",
  "EACCES",
  "UNKNOWN"
]);

function isRetryableVolumeWriteError(error) {
  return VOLUME_WRITE_RETRY_CODES.has(String(error?.code || "").trim().toUpperCase());
}

function waitForVolumeWriteRetry(attempt) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.min(2000, 50 * Math.pow(2, attempt)));
  });
}

export function createObserverTaskStorageIo(options = {}) {
  const {
    appendVolumeText = async () => {},
    compactTaskText = (value = "") => String(value || ""),
    fileExists = async () => false,
    fs = null,
    observerOutputRoot = "",
    pathModule = null,
    shouldHideInspectorEntry = () => false,
    taskEventLogPath = "",
    taskEventSeqPath = "",
    taskPathForStatus = () => "",
    taskQueueClosed = "",
    taskQueueDone = "",
    taskQueueInbox = "",
    taskQueueInProgress = "",
    taskQueueRoot = "",
    taskQueueWorkspacePath = "",
    taskStateIndexPath = "",
    workspaceTaskPath = () => ""
  } = options;

  let taskTraceWriteChain = Promise.resolve();
  const volumeWriteChains = new Map();

  function enqueueVolumeWrite(filePath, work) {
    const key = String(filePath || "");
    const previous = volumeWriteChains.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    volumeWriteChains.set(key, next);
    next.finally(() => {
      if (volumeWriteChains.get(key) === next) {
        volumeWriteChains.delete(key);
      }
    }).catch(() => {});
    return next;
  }

  async function listVolumeFiles(rootPath) {
    const entries = [];
    async function walk(currentPath, depth = 0) {
      let stat;
      try {
        stat = await fs.stat(currentPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          return;
        }
        throw error;
      }
      const entryName = pathModule.basename(currentPath);
      if (depth > 0 && shouldHideInspectorEntry(entryName)) {
        return;
      }
      entries.push({
        type: stat.isDirectory() ? "dir" : "file",
        path: currentPath,
        name: entryName
      });
      if (!stat.isDirectory() || depth >= 3) {
        return;
      }
      let children = [];
      try {
        children = await fs.readdir(currentPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          return;
        }
        throw error;
      }
      for (const child of children.sort()) {
        await walk(pathModule.join(currentPath, child), depth + 1);
      }
    }
    await walk(rootPath);
    return entries;
  }

  async function readVolumeFile(filePath) {
    return fs.readFile(filePath, "utf8");
  }

  async function ensureObserverOutputDir() {
    await fs.mkdir(observerOutputRoot, { recursive: true });
  }

  async function ensureTaskQueueDirs() {
    await Promise.all([
      fs.mkdir(taskQueueInbox, { recursive: true }),
      fs.mkdir(taskQueueInProgress, { recursive: true }),
      fs.mkdir(taskQueueDone, { recursive: true }),
      fs.mkdir(taskQueueClosed, { recursive: true })
    ]);
  }

  async function countJsonFilesInFolder(folderPath = "") {
    try {
      const entries = await listVolumeFiles(folderPath);
      return entries.filter((entry) => entry.type === "file" && entry.path.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }

  async function countCanonicalQueueFiles() {
    const [inboxCount, inProgressCount, doneCount, closedCount] = await Promise.all([
      countJsonFilesInFolder(taskQueueInbox),
      countJsonFilesInFolder(taskQueueInProgress),
      countJsonFilesInFolder(taskQueueDone),
      countJsonFilesInFolder(taskQueueClosed)
    ]);
    return inboxCount + inProgressCount + doneCount + closedCount;
  }

  async function writeVolumeText(filePath, content) {
    return enqueueVolumeWrite(filePath, async () => {
      await fs.mkdir(pathModule.dirname(filePath), { recursive: true });
      let lastError = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          await fs.writeFile(filePath, content, "utf8");
          return;
        } catch (error) {
          lastError = error;
          if (!isRetryableVolumeWriteError(error) || attempt >= 11) {
            break;
          }
          await waitForVolumeWriteRetry(attempt);
        }
      }
      throw lastError;
    });
  }

  function enqueueTaskTraceWrite(work) {
    taskTraceWriteChain = taskTraceWriteChain.then(work, work);
    return taskTraceWriteChain;
  }

  async function readTaskStateIndex() {
    try {
      const raw = await readVolumeFile(taskStateIndexPath);
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : { tasks: {} };
    } catch {
      return { tasks: {} };
    }
  }

  async function readCoreEventSeq() {
    try {
      const raw = await readVolumeFile(taskEventSeqPath);
      const parsed = Number(String(raw || "").trim());
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }

  async function allocateCoreEventSeq() {
    const current = await readCoreEventSeq();
    const next = current + 1;
    await writeVolumeText(taskEventSeqPath, `${next}\n`);
    return next;
  }

  function resolveQueueWorkspacePath(workspacePath = "") {
    const normalized = String(workspacePath || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
    if (!normalized) {
      return "";
    }
    if (normalized === taskQueueWorkspacePath) {
      return taskQueueRoot;
    }
    if (normalized.startsWith(`${taskQueueWorkspacePath}/`)) {
      return pathModule.join(taskQueueRoot, normalized.slice(taskQueueWorkspacePath.length + 1));
    }
    return "";
  }

  function deriveTaskIndexPathDetails(filePath = "") {
    const resolved = pathModule.resolve(String(filePath || ""));
    if (!resolved) {
      return { status: "", workspacePath: "" };
    }
    const fileName = pathModule.basename(resolved);
    if (resolved.startsWith(pathModule.resolve(taskQueueInbox))) {
      return { status: "queued", workspacePath: `${taskQueueWorkspacePath}/inbox/${fileName}` };
    }
    if (resolved.startsWith(pathModule.resolve(taskQueueInProgress))) {
      return { status: "in_progress", workspacePath: `${taskQueueWorkspacePath}/in_progress/${fileName}` };
    }
    if (resolved.startsWith(pathModule.resolve(taskQueueClosed))) {
      return { status: "closed", workspacePath: `${taskQueueWorkspacePath}/closed/${fileName}` };
    }
    if (resolved.startsWith(pathModule.resolve(taskQueueDone))) {
      return { status: "done", workspacePath: `${taskQueueWorkspacePath}/done/${fileName}` };
    }
    return { status: "", workspacePath: "" };
  }

  function extractTaskIdFromQueuePath(filePath = "") {
    const match = String(filePath || "").match(/(task-\\d+)\\.json$/i);
    return match ? match[1] : "";
  }

  async function recordTaskBreadcrumb(event = {}) {
    const taskId = String(event.taskId || "").trim();
    const timestamp = Number(event.at || Date.now());
    let normalizedEvent = {
      at: timestamp,
      eventSeq: 0,
      eventType: String(event.eventType || "task.updated").trim() || "task.updated",
      type: String(event.type || event.eventType || "task.updated").trim() || "task.updated",
      taskId,
      fromStatus: String(event.fromStatus || "").trim(),
      toStatus: String(event.toStatus || "").trim(),
      fromPath: String(event.fromPath || "").trim(),
      toPath: String(event.toPath || "").trim(),
      fromWorkspacePath: String(event.fromWorkspacePath || "").trim(),
      toWorkspacePath: String(event.toWorkspacePath || "").trim(),
      reason: compactTaskText(String(event.reason || "").trim(), 260),
      sessionId: String(event.sessionId || "").trim(),
      brainId: String(event.brainId || "").trim()
    };
    await enqueueTaskTraceWrite(async () => {
      normalizedEvent = {
        ...normalizedEvent,
        eventSeq: await allocateCoreEventSeq()
      };
      const index = await readTaskStateIndex();
      if (!index.tasks || typeof index.tasks !== "object") {
        index.tasks = {};
      }
      if (taskId) {
        const existing = index.tasks[taskId] && typeof index.tasks[taskId] === "object"
          ? index.tasks[taskId]
          : {};
        index.tasks[taskId] = {
          ...existing,
          taskId,
          currentStatus: normalizedEvent.toStatus || existing.currentStatus || normalizedEvent.fromStatus || "",
          currentFilePath: normalizedEvent.toPath || existing.currentFilePath || normalizedEvent.fromPath || "",
          currentWorkspacePath: normalizedEvent.toWorkspacePath || existing.currentWorkspacePath || normalizedEvent.fromWorkspacePath || "",
          previousStatus: normalizedEvent.fromStatus || existing.previousStatus || "",
          previousFilePath: normalizedEvent.fromPath || existing.previousFilePath || "",
          previousWorkspacePath: normalizedEvent.fromWorkspacePath || existing.previousWorkspacePath || "",
          lastEventType: normalizedEvent.eventType,
          latestEventSeq: normalizedEvent.eventSeq,
          lastReason: normalizedEvent.reason || existing.lastReason || "",
          sessionId: normalizedEvent.sessionId || existing.sessionId || "",
          brainId: normalizedEvent.brainId || existing.brainId || "",
          updatedAt: timestamp
        };
      }
      await writeVolumeText(taskStateIndexPath, `${JSON.stringify(index, null, 2)}\n`);
      await appendVolumeText(taskEventLogPath, `${JSON.stringify(normalizedEvent)}\n`);
    });
    return normalizedEvent;
  }

  async function recordCoreEvent(event = {}) {
    let normalizedEvent = {
      at: Number(event.at || Date.now()),
      eventSeq: 0,
      eventType: String(event.eventType || event.type || "core.event").trim() || "core.event",
      type: String(event.type || event.eventType || "core.event").trim() || "core.event",
      taskId: String(event.taskId || "").trim(),
      transactionId: String(event.transactionId || "").trim(),
      provider: String(event.provider || "").trim(),
      toolName: String(event.toolName || "").trim(),
      status: String(event.status || "").trim(),
      summary: compactTaskText(String(event.summary || event.reason || "").trim(), 500),
      pluginId: String(event.pluginId || "").trim(),
      payload: event.payload && typeof event.payload === "object" ? event.payload : undefined
    };
    await enqueueTaskTraceWrite(async () => {
      normalizedEvent = {
        ...normalizedEvent,
        eventSeq: await allocateCoreEventSeq()
      };
      await appendVolumeText(taskEventLogPath, `${JSON.stringify(normalizedEvent)}\n`);
    });
    return normalizedEvent;
  }

  async function readTaskRecordAtPath(filePath, options = {}) {
    const normalizedPath = pathModule.resolve(String(filePath || "").trim());
    const maxRedirects = Math.max(0, Math.min(Number(options.maxRedirects || 4), 12));
    if (!normalizedPath) {
      return null;
    }
    let currentPath = normalizedPath;
    const visited = new Set();
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (!currentPath || visited.has(currentPath)) {
        return null;
      }
      visited.add(currentPath);
      let parsed;
      try {
        parsed = JSON.parse(await readVolumeFile(currentPath));
      } catch (error) {
        if (error?.code === "ENOENT") {
          return null;
        }
        throw error;
      }
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      if (!parsed.redirectOnly) {
        return {
          ...parsed,
          filePath: currentPath
        };
      }
      const redirectWorkspacePath = String(parsed.redirectPath || "").trim();
      const redirectFilePath = resolveQueueWorkspacePath(redirectWorkspacePath) || taskPathForStatus(String(parsed.id || ""), String(parsed.status || ""));
      currentPath = pathModule.resolve(redirectFilePath);
    }
    return null;
  }

  async function findIndexedTaskById(taskId) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      return null;
    }
    const index = await readTaskStateIndex();
    const entry = index?.tasks && typeof index.tasks === "object"
      ? index.tasks[normalizedTaskId]
      : null;
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const candidatePaths = [
      String(entry.currentFilePath || "").trim(),
      resolveQueueWorkspacePath(String(entry.currentWorkspacePath || "").trim()),
      taskPathForStatus(normalizedTaskId, String(entry.currentStatus || "").trim())
    ].filter(Boolean);
    for (const candidatePath of candidatePaths) {
      const task = await readTaskRecordAtPath(candidatePath);
      if (task?.id === normalizedTaskId) {
        return {
          ...task,
          workspacePath: String(task.workspacePath || entry.currentWorkspacePath || "").trim()
        };
      }
    }
    return null;
  }

  async function readTaskHistory(taskId, options = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      return [];
    }
    const limit = Math.max(1, Math.min(Number(options.limit || 40), 200));
    let raw;
    try {
      raw = await readVolumeFile(taskEventLogPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    return String(raw || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && String(entry.taskId || "").trim() === normalizedTaskId)
      .sort((a, b) => Number(a.at || 0) - Number(b.at || 0))
      .slice(-limit);
  }

  return {
    deriveTaskIndexPathDetails,
    ensureObserverOutputDir,
    ensureTaskQueueDirs,
    extractTaskIdFromQueuePath,
    findIndexedTaskById,
    listVolumeFiles,
    readTaskHistory,
    readCoreEventSeq,
    readTaskRecordAtPath,
    readTaskStateIndex,
    readVolumeFile,
    recordTaskBreadcrumb,
    recordCoreEvent,
    resolveQueueWorkspacePath,
    writeVolumeText
  };
}
