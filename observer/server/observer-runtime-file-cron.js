export function createObserverRuntimeFileCron(context = {}) {
  const {
    INSPECT_ROOTS,
    OBSERVER_CONTAINER_WORKSPACE_ROOT,
    OBSERVER_OUTPUT_ROOT,
    compactTaskText,
    ensureObserverOutputDir,
    fs,
    listAllTasks,
    path
  } = context;

  async function listObserverOutputFiles() {
    await ensureObserverOutputDir();
    const files = [];
    async function walk(dirPath) {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        const stat = await fs.stat(fullPath);
        files.push({
          name: entry.name,
          path: path.relative(OBSERVER_OUTPUT_ROOT, fullPath).replaceAll("\\", "/"),
          fullPath,
          size: Number(stat.size || 0),
          modifiedAt: Number(stat.mtimeMs || 0)
        });
      }
    }
    await walk(OBSERVER_OUTPUT_ROOT);
    files.sort((left, right) => left.path.localeCompare(right.path));
    return files;
  }

  function resolveInspectablePath(scope, relativePath = "") {
    const root = INSPECT_ROOTS[scope];
    if (!root) {
      throw new Error("invalid scope");
    }

    const normalized = path.posix.normalize(relativePath || "");
    const target = normalized === "." ? root : path.posix.join(root, normalized);

    if (!target.startsWith(root)) {
      throw new Error("path escapes allowed root");
    }

    return target;
  }

  function resolveContainerInspectablePath(relativePath = "") {
    const root = OBSERVER_CONTAINER_WORKSPACE_ROOT;
    const normalized = path.posix.normalize(relativePath || "");
    const target = normalized === "." ? root : path.posix.join(root, normalized);
    if (!target.startsWith(root)) {
      throw new Error("path escapes allowed root");
    }
    return target;
  }

  async function readCronStore() {
    return { jobs: [] };
  }

  async function listCronRunEvents({ sinceTs = 0, limit = 10 } = {}) {
    const { done, failed } = await listAllTasks();
    return [...done, ...failed]
      .filter((task) => task.scheduler?.periodic)
      .filter((task) => task.silentInternalSkip !== true)
      .filter((task) => Number(task.completedAt || task.updatedAt || 0) > Number(sinceTs || 0))
      .sort((a, b) => Number(a.completedAt || a.updatedAt || 0) - Number(b.completedAt || b.updatedAt || 0))
      .slice(-Math.max(1, Math.min(Number(limit || 10), 50)))
      .map((task) => ({
        ts: Number(task.completedAt || task.updatedAt || 0),
        action: "finished",
        name: task.scheduler?.name || task.scheduler?.seriesId || task.codename || task.id,
        jobId: task.scheduler?.seriesId || task.id,
        codename: task.codename || "",
        status: task.status,
        durationMs: Number(task.completedAt || 0) && Number(task.startedAt || 0)
          ? Math.max(0, Number(task.completedAt || 0) - Number(task.startedAt || 0))
          : 0,
        summary: compactTaskText(
          task.reviewSummary
          || task.resultSummary
          || task.workerSummary
          || task.notes
          || task.message
          || "",
          420
        ),
        message: compactTaskText(task.message || "", 220),
        internalJobType: String(task.internalJobType || ""),
        model: String(task.model || "")
      }));
  }

  async function writeCronStore(store) {
    return store;
  }

  function getCronMinGapMs(brainId, everyMs) {
    if (everyMs >= 24 * 60 * 60 * 1000) return 30 * 60 * 1000;
    return 5 * 60 * 1000;
  }

  function findStaggeredAnchorMs(jobs, job) {
    const everyMs = Number(job?.schedule?.everyMs || 0);
    if (!everyMs) {
      return { anchorMs: null, staggered: false };
    }

    const minGapMs = getCronMinGapMs(job.agentId || "worker", everyMs);
    const sameBrainTimes = jobs
      .filter((entry) => entry.enabled && entry.id !== job.id && (entry.agentId || "worker") === (job.agentId || "worker"))
      .map((entry) => Number(entry?.state?.nextRunAtMs || entry?.schedule?.anchorMs || 0))
      .filter(Boolean)
      .sort((a, b) => a - b);

    let anchorMs = Number(job?.state?.nextRunAtMs || job?.schedule?.anchorMs || Date.now());
    const originalAnchorMs = anchorMs;
    let moved = false;

    for (const scheduledAt of sameBrainTimes) {
      if (Math.abs(anchorMs - scheduledAt) < minGapMs) {
        anchorMs = scheduledAt + minGapMs;
        moved = true;
      }
    }

    return { anchorMs, staggered: moved && anchorMs !== originalAnchorMs, minGapMs };
  }

  return {
    findStaggeredAnchorMs,
    getCronMinGapMs,
    listCronRunEvents,
    listObserverOutputFiles,
    readCronStore,
    resolveContainerInspectablePath,
    resolveInspectablePath,
    writeCronStore
  };
}
