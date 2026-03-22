export function createObserverNativeSupport(context = {}) {
  const {
    OBSERVER_ATTACHMENTS_ROOT,
    OBSERVER_CONTAINER_ATTACHMENTS_ROOT,
    OBSERVER_CONTAINER_OUTPUT_ROOT,
    OBSERVER_CONTAINER_WORKSPACE_ROOT,
    OBSERVER_OUTPUT_ROOT,
    PROMPT_MEMORY_CURATED_PATH,
    PROMPT_PERSONAL_PATH,
    PROMPT_TODAY_BRIEFING_PATH,
    PROMPT_USER_PATH,
    RUNTIME_ROOT,
    WORKSPACE_ROOT,
    appendVolumeText,
    buildMailStatus,
    compactTaskText,
    ensureObserverOutputDir,
    fileExists,
    formatDateTimeForUser,
    formatJobCodename,
    formatTimeForUser,
    fs,
    getActiveMailAgent,
    getMailState,
    getMailWatchRulesState,
    getObserverConfig,
    humanJoin,
    listAllTasks,
    listCronRunEvents,
    listObserverOutputFiles,
    path,
    readVolumeFile,
    resolveObserverOutputPath,
    startOfTodayMs,
    summarizeCronTools,
    writeVolumeText
  } = context;

  function summarizeTaskActivity(task) {
    const subject = task.codename || task.id || "task";
    const message = compactTaskText(task.message, 110);
    if (message) {
      return `${subject}: ${message}`;
    }
    return subject;
  }

  function summarizeTaskOutcome(task) {
    const subject = task.codename || task.id || "task";
    const summary = compactTaskText(task.reviewSummary || task.resultSummary || task.notes || task.message, 130);
    if (summary) {
      return `${subject}: ${summary}`;
    }
    return subject;
  }

  function outputNameCandidateFromSource(sourcePath) {
    const base = path.basename(sourcePath).trim() || "export";
    return base.replace(/[<>:\"/\\\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim() || "export";
  }

  async function ensureUniqueOutputPath(candidateName) {
    await ensureObserverOutputDir();
    const parsed = path.parse(candidateName);
    const safeBase = (parsed.name || "export").trim() || "export";
    const safeExt = parsed.ext || "";
    let attempt = 0;
    while (attempt < 200) {
      const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
      const finalName = `${safeBase}${suffix}${safeExt}`;
      const target = resolveObserverOutputPath(finalName);
      try {
        await fs.access(target);
        attempt += 1;
      } catch {
        return { name: finalName, path: target };
      }
    }
    throw new Error("unable to allocate unique output path");
  }

  function extractQuotedSegments(message = "") {
    return [...String(message || "").matchAll(/\"([^\"]+)\"|'([^']+)'/g)]
      .map((match) => match[1] || match[2] || "")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  function normalizeWindowsPathCandidate(value = "") {
    const text = String(value || "").trim();
    if (/^[A-Za-z]:[\\/]/.test(text)) {
      return text.replaceAll("/", "\\");
    }
    return "";
  }

  function normalizeContainerMountPathCandidate(value = "") {
    const text = String(value || "")
      .trim()
      .replaceAll("\\", "/")
      .replace(/[)"'`,;:!?]+$/g, "")
      .replace(/\.+$/g, "");
    if (
      text === OBSERVER_CONTAINER_WORKSPACE_ROOT
      || text.startsWith(`${OBSERVER_CONTAINER_WORKSPACE_ROOT}/`)
      || text === OBSERVER_CONTAINER_OUTPUT_ROOT
      || text.startsWith(`${OBSERVER_CONTAINER_OUTPUT_ROOT}/`)
      || text === OBSERVER_CONTAINER_ATTACHMENTS_ROOT
      || text.startsWith(`${OBSERVER_CONTAINER_ATTACHMENTS_ROOT}/`)
      || text.startsWith("/home/openclaw/mounts/")
    ) {
      return text;
    }
    return "";
  }

  function normalizeWorkspaceRelativePathCandidate(value = "") {
    const text = String(value || "").trim().replaceAll("/", path.sep);
    if (!text) {
      return "";
    }
    if (
      /^[A-Za-z]:[\\/]/.test(text)
      || normalizeContainerMountPathCandidate(text.replaceAll(path.sep, "/"))
    ) {
      return "";
    }
    if (!(/[\\/]/.test(text) || /\.[A-Za-z0-9]{1,12}$/.test(text))) {
      return "";
    }
    return path.resolve(WORKSPACE_ROOT, text);
  }

  function resolveSourcePathFromContainerPath(containerPath) {
    const normalized = String(containerPath || "").replaceAll("\\", "/");
    if (normalized === OBSERVER_CONTAINER_OUTPUT_ROOT || normalized.startsWith(`${OBSERVER_CONTAINER_OUTPUT_ROOT}/`)) {
      const relative = normalized === OBSERVER_CONTAINER_OUTPUT_ROOT
        ? ""
        : normalized.slice((`${OBSERVER_CONTAINER_OUTPUT_ROOT}/`).length);
      return resolveObserverOutputPath(relative);
    }
    if (normalized === OBSERVER_CONTAINER_ATTACHMENTS_ROOT || normalized.startsWith(`${OBSERVER_CONTAINER_ATTACHMENTS_ROOT}/`)) {
      const relative = normalized === OBSERVER_CONTAINER_ATTACHMENTS_ROOT
        ? ""
        : normalized.slice((`${OBSERVER_CONTAINER_ATTACHMENTS_ROOT}/`).length);
      return path.resolve(OBSERVER_ATTACHMENTS_ROOT, relative.replaceAll("/", path.sep));
    }
    const observerConfig = getObserverConfig();
    for (const mount of observerConfig.mounts) {
      const mountPath = String(mount.containerPath || "").replaceAll("\\", "/");
      if (normalized === mountPath || normalized.startsWith(`${mountPath}/`)) {
        const relative = normalized === mountPath ? "" : normalized.slice(mountPath.length + 1);
        return path.resolve(String(mount.hostPath || ""), relative.replaceAll("/", path.sep));
      }
    }
    return "";
  }

  function isPathWithinAllowedRoots(targetPath = "") {
    const resolved = path.resolve(String(targetPath || ""));
    const observerConfig = getObserverConfig();
    const allowedRoots = [
      WORKSPACE_ROOT,
      OBSERVER_OUTPUT_ROOT,
      RUNTIME_ROOT,
      ...observerConfig.mounts.map((mount) => String(mount.hostPath || "")).filter(Boolean)
    ].map((root) => path.resolve(root));
    return allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  }

  function extractFileReferenceCandidates(message = "") {
    const candidates = new Set();
    for (const segment of extractQuotedSegments(message)) {
      candidates.add(segment);
    }
    for (const token of String(message || "").split(/\s+/)) {
      const trimmed = token.replace(/^[("'`]+|[)\]}",;:!?'.`]+$/g, "");
      if (!trimmed) {
        continue;
      }
      if (/[\\/]/.test(trimmed) || /\.[A-Za-z0-9]{1,12}$/.test(trimmed)) {
        candidates.add(trimmed);
      }
    }
    return [...candidates];
  }

  function isDirectReadFileRequest(message = "") {
    const lower = String(message || "").toLowerCase().trim();
    return /\b(read|show|open|display|view|print|cat)\b/.test(lower)
      && (
        /\b(file|files|document|doc|contents|content|text)\b/.test(lower)
        || extractFileReferenceCandidates(message).length > 0
      );
  }

  async function buildRecentActivitySummary() {
    const { queued, inProgress, done, failed } = await listAllTasks();
    const now = Date.now();
    const sinceMs = now - (24 * 60 * 60 * 1000);
    const lines = [];

    const recentDone = [...done]
      .filter((task) => Number(task.completedAt || task.updatedAt || task.createdAt || 0) >= sinceMs)
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0));
    const recentFailed = [...failed]
      .filter((task) => Number(task.completedAt || task.updatedAt || task.createdAt || 0) >= sinceMs)
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0));
    const currentInProgress = [...inProgress]
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
      .slice(0, 3);

    const cronTasksToday = [...recentDone, ...recentFailed]
      .filter((task) => task.scheduler?.periodic);
    const observerCronRuns = new Map();
    for (const task of cronTasksToday) {
      const key = String(task.scheduler?.seriesId || task.id);
      const existing = observerCronRuns.get(key);
      const stamp = Number(task.completedAt || task.updatedAt || task.createdAt || 0);
      if (!existing || stamp > existing.stamp) {
        observerCronRuns.set(key, {
          stamp,
          name: task.scheduler?.name || task.codename || key,
          status: task.status === "failed" ? "failed" : "ok",
          task
        });
      }
    }

    const nativeCronEvents = await listCronRunEvents({ sinceTs: sinceMs, limit: 20 });
    const cronEventSummaries = nativeCronEvents
      .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
      .slice(0, 5)
      .map((event) => {
        const name = event.name ? String(event.name) : (event.jobId ? formatJobCodename(event.jobId) : "scheduled run");
        const status = event.status === "ok" ? "completed" : String(event.status || "unknown");
        const activity = summarizeCronTools(event.summary || event.error || "");
        return activity ? `${name}: ${status}; ${activity}` : `${name}: ${status}`;
      })
      .filter(Boolean);

    const outputArtifacts = recentDone
      .flatMap((task) => Array.isArray(task.outputFiles) ? task.outputFiles : [])
      .map((file) => file?.path || file?.name)
      .filter(Boolean);
    const uniqueArtifacts = [...new Set(outputArtifacts)];

    const recentTaskMentions = recentDone.slice(0, 3).map((task) => {
      if (Array.isArray(task.outputFiles) && task.outputFiles.length) {
        const topOutputs = task.outputFiles
          .slice(0, 2)
          .map((file) => file?.path || file?.name)
          .filter(Boolean);
        if (topOutputs.length) {
          return `${task.codename || task.id}, which produced ${humanJoin(topOutputs)}`;
        }
      }
      return summarizeTaskOutcome(task);
    });
    const recentCronMentions = cronEventSummaries.slice(0, 3);

    const headlineParts = [];
    if (recentTaskMentions.length) headlineParts.push(`worked on ${humanJoin(recentTaskMentions)}`);
    if (recentCronMentions.length) headlineParts.push(`saw ${recentCronMentions.length} scheduled job run${recentCronMentions.length === 1 ? "" : "s"} complete`);
    if (currentInProgress.length) headlineParts.push(`${currentInProgress.length} still in progress`);
    if (recentFailed.length) headlineParts.push(`${recentFailed.length} failed`);
    if (uniqueArtifacts.length) headlineParts.push(`generated ${uniqueArtifacts.length} output file${uniqueArtifacts.length === 1 ? "" : "s"}`);

    if (headlineParts.length) {
      lines.push(`In the last day I've ${humanJoin(headlineParts)}.`);
    }

    if (recentDone.length) {
      lines.push("Recent completed work:");
      for (const task of recentDone.slice(0, 5)) {
        lines.push(`- ${summarizeTaskOutcome(task)}`);
      }
    } else {
      lines.push("Recent completed work: none yet.");
    }

    if (currentInProgress.length) {
      lines.push("Still in progress:");
      for (const task of currentInProgress) {
        lines.push(`- ${summarizeTaskActivity(task)}`);
      }
    }

    if (observerCronRuns.size || cronEventSummaries.length) {
      lines.push("Scheduled jobs and outcomes:");
      for (const entry of [...observerCronRuns.values()].sort((a, b) => b.stamp - a.stamp).slice(0, 4)) {
        lines.push(`- ${entry.name}: ${entry.status === "ok" ? "completed" : "failed"}`);
      }
      for (const summary of cronEventSummaries) {
        lines.push(`- ${summary}`);
      }
    } else {
      lines.push("Scheduled jobs and outcomes: no scheduled runs have completed in the last day.");
    }

    if (uniqueArtifacts.length) {
      lines.push("Files created or updated in observer-output:");
      for (const filePath of uniqueArtifacts.slice(0, 6)) {
        lines.push(`- ${filePath}`);
      }
    } else {
      lines.push("Files created or updated in observer-output: none in the last day.");
    }

    if (recentFailed.length) {
      lines.push("Problems in the last day:");
      for (const task of recentFailed.slice(0, 3)) {
        lines.push(`- ${summarizeTaskOutcome(task)}`);
      }
    }

    if (!lines.length) {
      lines.push("I don't have any recent activity to report yet.");
    }

    return lines;
  }

  async function buildQueueStatusSummary() {
    const { queued, inProgress, done, failed } = await listAllTasks();
    const lines = [
      `There ${queued.length === 1 ? "is" : "are"} ${queued.length} task${queued.length === 1 ? "" : "s"} queued, ${inProgress.length} in progress, ${done.length} done, and ${failed.length} failed.`
    ];
    if (inProgress[0]) {
      const task = inProgress[0];
      lines.push(`Right now I am working on ${task.codename || task.id}: ${compactTaskText(task.message, 140)}.`);
    }
    if (queued[0]) {
      const task = queued[0];
      lines.push(`Next up is ${task.codename || task.id}: ${compactTaskText(task.message, 120)}.`);
    }
    return lines;
  }

  async function buildMailStatusSummary() {
    const status = await buildMailStatus();
    const lines = [];
    lines.push(status.ready
      ? `${status.activeAgentLabel || "The active agent"} has mailbox access configured and ready.`
      : `${status.activeAgentLabel || "The active agent"} does not have mailbox access ready yet.`);
    if (status.activeAgentEmail) {
      lines.push(`Active mailbox: ${status.activeAgentEmail}.`);
    }
    if (status.lastCheckAt) {
      lines.push(`Last mailbox check: ${formatDateTimeForUser(status.lastCheckAt)}.`);
    }
    if (Number(status.recentMessageCount || 0) > 0) {
      lines.push(`Recent inbox messages currently cached: ${status.recentMessageCount}.`);
    }
    if (Number(status.trustedSourceCount || 0) > 0 || Number(status.knownSourceCount || 0) > 0) {
      lines.push(`Recognized inbox sources: ${Number(status.trustedSourceCount || 0)} trusted and ${Number(status.knownSourceCount || 0)} known.`);
    }
    if (Number(status.commandReadyCount || 0) > 0 || Number(status.commandReviewCount || 0) > 0) {
      lines.push(`Email commands: ${Number(status.commandReadyCount || 0)} ready for execution and ${Number(status.commandReviewCount || 0)} limited or waiting on user review. Only trusted sources may execute commands.`);
    }
    if (Number(status.likelySpamCount || 0) > 0) {
      lines.push(`Messages flagged as likely spam or promotional noise: ${status.likelySpamCount}.`);
    }
    if (Number(status.quarantinedCount || 0) > 0) {
      lines.push(`Messages automatically quarantined before review: ${status.quarantinedCount}.`);
    }
    const categoryBits = Object.entries(status.categoryCounts || {})
      .filter(([, count]) => Number(count || 0) > 0)
      .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
      .map(([category, count]) => `${category}: ${count}`);
    if (categoryBits.length) {
      lines.push(`Recent categories: ${categoryBits.join(", ")}.`);
    }
    if (status.lastError) {
      lines.push(`Last mail error: ${status.lastError}`);
    }
    return lines;
  }

  async function buildInboxSummary({ todayOnly = false } = {}) {
    const agent = getActiveMailAgent();
    const mailState = getMailState();
    const mailWatchRulesState = getMailWatchRulesState();
    const recentMessages = (Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [])
      .filter((entry) => entry.agentId === agent?.id)
      .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0));
    const cutoff = startOfTodayMs(Date.now());
    const visibleMessages = recentMessages.filter((message) => !message?.triage?.likelySpam && !message?.triage?.likelyPhishing);
    const messages = todayOnly
      ? visibleMessages.filter((message) => Number(message.receivedAt || 0) >= cutoff)
      : visibleMessages;
    const pendingUnsureIds = new Set(
      (Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [])
        .filter((rule) => rule?.enabled !== false)
        .flatMap((rule) => Array.isArray(rule?.pendingUnsureMessageIds) ? rule.pendingUnsureMessageIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
    const heldMessages = messages.filter((message) => pendingUnsureIds.has(String(message?.id || "").trim()));
    const nonHeldMessages = messages.filter((message) => !pendingUnsureIds.has(String(message?.id || "").trim()));

    const lines = [];
    if (!messages.length) {
      lines.push(todayOnly
        ? "I do not have any non-spam emails from today to report."
        : "I do not have any non-spam inbox emails to report right now.");
      return lines;
    }

    lines.push(todayOnly
      ? `I have ${messages.length} non-spam email${messages.length === 1 ? "" : "s"} from today to report.`
      : `I have ${messages.length} non-spam inbox email${messages.length === 1 ? "" : "s"} in the current cache.`);
    if (heldMessages.length) {
      lines.push(`I am currently holding ${heldMessages.length} email${heldMessages.length === 1 ? "" : "s"} for your direction in the Questions flow.`);
    }

    const orderedMessages = [...heldMessages, ...nonHeldMessages];
    for (const message of orderedMessages.slice(0, 6)) {
      const parts = [
        `${formatTimeForUser(message.receivedAt)} from ${message.fromName || message.fromAddress || "Unknown sender"}`,
        `subject: ${message.subject || "(no subject)"}`
      ];
      const summary = compactTaskText(message.text || "", 120);
      if (summary) {
        parts.push(summary);
      }
      const isHeld = pendingUnsureIds.has(String(message?.id || "").trim());
      lines.push(`- ${isHeld ? "[held] " : ""}${parts.join(" | ")}`);
    }

    const hiddenCount = recentMessages.length - messages.length;
    if (hiddenCount > 0 && !todayOnly) {
      lines.push(`I am leaving out ${hiddenCount} spam, phishing, or low-priority promotional message${hiddenCount === 1 ? "" : "s"}.`);
    }
    return lines;
  }

  async function buildOutputStatusSummary() {
    const files = await listObserverOutputFiles();
    const lines = [];
    lines.push(files.length
      ? `There are ${files.length} file${files.length === 1 ? "" : "s"} in observer-output.`
      : "Observer-output is currently empty.");
    for (const file of files.slice(0, 8)) {
      lines.push(`- ${file.path}`);
    }
    return lines;
  }

  async function buildCompletionSummary() {
    const { done } = await listAllTasks();
    const recentDone = [...done]
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
      .slice(0, 5);
    const lines = [];
    if (!recentDone.length) {
      lines.push("I do not have any recent completed tasks to report.");
      return lines;
    }
    lines.push(`I have ${recentDone.length} recent completed task${recentDone.length === 1 ? "" : "s"} to report.`);
    for (const task of recentDone) {
      lines.push(`- ${summarizeTaskOutcome(task)}`);
    }
    return lines;
  }

  async function buildFailureSummary() {
    const { failed } = await listAllTasks();
    const recentFailed = [...failed]
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
      .slice(0, 5);
    const lines = [];
    if (!recentFailed.length) {
      lines.push("Nothing has failed recently.");
      return lines;
    }
    lines.push(`There ${recentFailed.length === 1 ? "has" : "have"} been ${recentFailed.length} recent failed task${recentFailed.length === 1 ? "" : "s"}.`);
    for (const task of recentFailed) {
      lines.push(`- ${summarizeTaskOutcome(task)}`);
    }
    return lines;
  }

  async function buildDailyBriefingSummary() {
    try {
      const briefing = await fs.readFile(PROMPT_TODAY_BRIEFING_PATH, "utf8");
      const lines = briefing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      return lines.length ? lines.slice(0, 20) : ["No daily briefing has been generated yet."];
    } catch {
      return ["No daily briefing has been generated yet."];
    }
  }

  const PROMPT_MEMORY_FILE_MAP = {
    "USER.md": PROMPT_USER_PATH,
    "MEMORY.md": PROMPT_MEMORY_CURATED_PATH,
    "PERSONAL.md": PROMPT_PERSONAL_PATH,
    "TODAY.md": PROMPT_TODAY_BRIEFING_PATH
  };

  function resolvePromptMemoryFileKey(value = "") {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      return "";
    }
    const matched = Object.keys(PROMPT_MEMORY_FILE_MAP).find((key) => key.toUpperCase() === normalized);
    return matched || "";
  }

  async function readPromptMemoryContext() {
    const entries = [];
    for (const [fileName, filePath] of Object.entries(PROMPT_MEMORY_FILE_MAP)) {
      let content = "";
      try {
        content = await readVolumeFile(filePath);
      } catch {
        content = "";
      }
      entries.push({
        fileName,
        filePath,
        content: compactTaskText(String(content || "").trim(), 4000)
      });
    }
    return entries;
  }

  async function writePromptMemoryFile({ file = "", content = "", mode = "replace" } = {}) {
    const fileKey = resolvePromptMemoryFileKey(file);
    if (!fileKey) {
      throw new Error("file must be one of USER.md, MEMORY.md, PERSONAL.md, TODAY.md");
    }
    const filePath = PROMPT_MEMORY_FILE_MAP[fileKey];
    const normalizedMode = String(mode || "replace").trim().toLowerCase() === "append" ? "append" : "replace";
    const text = String(content || "");
    if (!text.trim()) {
      throw new Error("content is required");
    }
    if (normalizedMode === "append") {
      const prefix = await fileExists(filePath) ? "\n" : "";
      await appendVolumeText(filePath, `${prefix}${text.replace(/\s+$/, "")}\n`);
    } else {
      await writeVolumeText(filePath, `${text.replace(/\s+$/, "")}\n`);
    }
    return {
      fileName: fileKey,
      filePath,
      mode: normalizedMode
    };
  }

  return {
    buildCompletionSummary,
    buildDailyBriefingSummary,
    buildFailureSummary,
    buildInboxSummary,
    buildMailStatusSummary,
    buildOutputStatusSummary,
    buildQueueStatusSummary,
    buildRecentActivitySummary,
    ensureUniqueOutputPath,
    extractFileReferenceCandidates,
    extractQuotedSegments,
    isDirectReadFileRequest,
    isPathWithinAllowedRoots,
    normalizeContainerMountPathCandidate,
    normalizeWindowsPathCandidate,
    normalizeWorkspaceRelativePathCandidate,
    outputNameCandidateFromSource,
    readPromptMemoryContext,
    resolveSourcePathFromContainerPath,
    writePromptMemoryFile
  };
}
