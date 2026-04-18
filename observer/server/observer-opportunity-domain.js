export function createObserverOpportunityDomain(options = {}) {
  const {
    compactTaskText = (value = "") => String(value || ""),
    fs = null,
    hashRef = (value = "") => String(value || ""),
    listAllTasks = async () => ({ done: [], failed: [] }),
    observerInputHostRoot = "",
    opportunityScanState = null,
    pathModule = null,
    visibleCompletedHistoryCount = 1,
    visibleFailedHistoryCount = 1
  } = options;

  async function listTopLevelWorkspaceEntries(rootPath, limit = 24) {
    try {
      const entries = await fs.readdir(rootPath, { withFileTypes: true });
      return entries
        .map((entry) => `${entry.isDirectory() ? "dir" : "file"}:${entry.name}`)
        .sort((left, right) => left.localeCompare(right))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  async function listRecursiveFiles(rootPath, {
    extensions = [],
    limit = 24,
    maxDepth = 5
  } = {}) {
    const normalizedRoot = String(rootPath || "").trim();
    if (!normalizedRoot) {
      return [];
    }
    const allowed = new Set((extensions || []).map((value) => String(value || "").toLowerCase()).filter(Boolean));
    const matches = [];
    const ignoredDirNames = new Set([
      ".git",
      "node_modules",
      "vendor",
      "dist",
      "build",
      ".next",
      ".nuxt",
      "coverage",
      ".cache",
      "observer-output",
      ".derpy-observer-runtime"
    ]);
    const queue = [{ path: normalizedRoot, depth: 0 }];
    while (queue.length && matches.length < limit) {
      const current = queue.shift();
      try {
        const entries = await fs.readdir(current.path, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
          if (matches.length >= limit) {
            break;
          }
          const entryPath = pathModule.join(current.path, entry.name);
          if (entry.isDirectory()) {
            if (
              current.depth < maxDepth
              && !ignoredDirNames.has(entry.name.toLowerCase())
              && !(entry.name.startsWith(".") && entry.name.toLowerCase() !== ".github")
            ) {
              queue.push({ path: entryPath, depth: current.depth + 1 });
            }
            continue;
          }
          if (!entry.isFile()) {
            continue;
          }
          const extension = pathModule.extname(entry.name).toLowerCase();
          if (allowed.size && !allowed.has(extension)) {
            continue;
          }
          matches.push(entryPath);
        }
      } catch {
        continue;
      }
    }
    return matches;
  }

  function scoreMarkdownPath(rootPath, filePath) {
    const relativePath = pathModule.relative(rootPath, filePath).replace(/\\/g, "/");
    const baseName = pathModule.basename(filePath).toLowerCase();
    const segments = relativePath.split("/").filter(Boolean);
    let score = 0;
    const preferredNames = new Map([
      ["agents.md", 220],
      ["soul.md", 210],
      ["tools.md", 205],
      ["todo.md", 200],
      ["tasks.md", 195],
      ["plan.md", 190],
      ["plans.md", 185],
      ["roadmap.md", 180],
      ["notes.md", 170],
      ["readme.md", 160],
      ["handoff.md", 150],
      ["laptop-handoff.md", 150],
      ["status.md", 140]
    ]);
    score += preferredNames.get(baseName) || 0;
    if (segments.length <= 2) {
      score += 120;
    } else if (segments.length <= 4) {
      score += 70;
    }
    if (segments.some((segment) => /prompt|workspace|observer|docs?|design|spec|plan|task|notes?/i.test(segment))) {
      score += 80;
    }
    if (/^\./.test(baseName)) {
      score -= 80;
    }
    if (/readme|changelog|history|license|contributing|security|upgrade|release|code_of_conduct/i.test(baseName)) {
      score -= 20;
    }
    return score;
  }

  async function summarizeMarkdownFile(rootPath, filePath) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const heading = lines.find((line) => /^#{1,6}\s+/.test(line)) || "";
      const summaryLine = lines.find((line) => !/^#{1,6}\s+/.test(line)) || "";
      return {
        path: pathModule.relative(rootPath, filePath).replace(/\\/g, "/"),
        heading: heading.replace(/^#{1,6}\s+/, "").trim(),
        summary: compactTaskText(summaryLine, 140)
      };
    } catch {
      return {
        path: pathModule.relative(rootPath, filePath).replace(/\\/g, "/"),
        heading: "",
        summary: ""
      };
    }
  }

  async function listMarkdownSummaries(rootPath, limit = 20, maxDepth = 5, rotationKey = "") {
    const files = await listRecursiveFiles(rootPath, {
      extensions: [".md", ".markdown", ".mdx"],
      limit: 5000,
      maxDepth
    });
    const rankedFiles = [];
    for (const filePath of files) {
      let modifiedAt = 0;
      try {
        const stats = await fs.stat(filePath);
        modifiedAt = Number(stats.mtimeMs || 0);
      } catch {
        modifiedAt = 0;
      }
      rankedFiles.push({
        filePath,
        modifiedAt,
        score: scoreMarkdownPath(rootPath, filePath)
      });
    }
    rankedFiles.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.modifiedAt - left.modifiedAt;
    });
    const total = rankedFiles.length;
    const normalizedOffset = total > 0
      ? Math.max(0, Number(opportunityScanState?.markdownOffsets?.[rotationKey] || 0)) % total
      : 0;
    const rotatedFiles = total > 0
      ? rankedFiles.map((_, index) => rankedFiles[(normalizedOffset + index) % total])
      : [];
    const summaries = [];
    for (const entry of rotatedFiles.slice(0, limit)) {
      summaries.push(await summarizeMarkdownFile(rootPath, entry.filePath));
    }
    return {
      summaries,
      total,
      nextOffset: total > 0 ? (normalizedOffset + Math.max(1, limit)) % total : 0
    };
  }

  async function buildOpportunityWorkspaceSnapshot() {
    const workspaceEntries = await listTopLevelWorkspaceEntries(observerInputHostRoot, 24);
    const workspaceMarkdownResult = await listMarkdownSummaries(observerInputHostRoot, 24, 6, "workspace");
    if (opportunityScanState?.markdownOffsets) {
      opportunityScanState.markdownOffsets.workspace = workspaceMarkdownResult.nextOffset;
    }
    const workspaceMarkdown = workspaceMarkdownResult.summaries.map((entry) => ({
      ...entry,
      path: entry?.path ? `observer-input/${String(entry.path).replace(/^\/+/, "")}` : "observer-input"
    }));
    const { failed, done } = await listAllTasks();
    const recentFailed = failed
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
      .slice(0, 5)
      .map((task) => ({
        id: task.id,
        message: compactTaskText(task.message, 140),
        summary: compactTaskText(task.resultSummary || task.notes || "", 180)
      }));
    const recentDone = done
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
      .slice(0, 5)
      .map((task) => ({
        id: task.id,
        message: compactTaskText(task.message, 140),
        summary: compactTaskText(task.resultSummary || "", 180)
      }));
    return {
      workspaceRoot: observerInputHostRoot,
      workspaceEntries,
      workspaceMarkdown,
      defaultMounts: [],
      recentFailed,
      recentDone
    };
  }

  async function buildTaskMaintenanceSnapshot(limit = 8) {
    const { done, failed } = await listAllTasks();
    const retainedDoneIds = done
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
      .slice(0, visibleCompletedHistoryCount)
      .map((task) => String(task.id || ""));
    const retainedFailedIds = failed
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
      .slice(0, visibleFailedHistoryCount)
      .map((task) => String(task.id || ""));
    const candidates = [...failed, ...done]
      .filter((task) => !task.maintenanceReviewedAt)
      .filter((task) => String(task.internalJobType || "") !== "opportunity_scan")
      .filter((task) => {
        const id = String(task.id || "");
        if (String(task.status || "").toLowerCase() === "failed") {
          return !retainedFailedIds.includes(id);
        }
        return !retainedDoneIds.includes(id);
      })
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
      .slice(0, limit)
      .map((task) => ({
        id: task.id,
        status: task.status,
        sessionId: String(task.sessionId || ""),
        maintenanceKey: String(task.maintenanceKey || ""),
        parentTaskId: String(task.parentTaskId || ""),
        message: compactTaskText(task.message, 160),
        summary: compactTaskText(task.reviewSummary || task.resultSummary || task.notes || "", 220),
        outputFiles: Array.isArray(task.outputFiles) ? task.outputFiles.slice(0, 6).map((file) => file.path || file.name) : []
      }));
    return candidates;
  }

  function buildMarkdownReviewOpportunity(entry, sourceRoot = "workspace") {
    const relativePath = String(entry?.path || "").trim();
    if (!relativePath) {
      return null;
    }
    const lowerPath = relativePath.toLowerCase();
    const heading = String(entry?.heading || "").trim();
    const summary = String(entry?.summary || "").trim();
    const evidenceText = `${heading}\n${summary}`.toLowerCase();
    const preferred = /(agents|soul|tools|todo|tasks|plan|plans|roadmap|notes|readme|handoff)\.mdx?$/i.test(lowerPath);
    const signal = /\b(todo|next|plan|roadmap|follow[- ]?up|unfinished|pending|fix|issue|problem|review|opportunit)\b/i.test(evidenceText);
    if (!preferred && !signal) {
      return null;
    }
    const shortPath = compactTaskText(relativePath, 120);
    return {
      key: `md-${sourceRoot}-${hashRef(lowerPath)}`,
      message: `Review ${shortPath} and carry out the highest-value concrete next step you find there.`,
      specialtyHint: /todo|fix|issue|problem|unfinished|pending/i.test(evidenceText) ? "code" : "document",
      sourceDocumentPath: shortPath,
      reason: heading
        ? `Prioritized markdown file ${shortPath} appears relevant (${compactTaskText(heading, 80)}).`
        : `Prioritized markdown file ${shortPath} appears relevant for follow-up review.`
    };
  }

  function buildFailedTaskOpportunity(task) {
    const taskId = String(task?.id || "").trim();
    let message = String(task?.message || "").trim();
    message = message.replace(/^Investigate and fix the worker JSON formatting failure for task [^:]+:\s*/i, "");
    message = message.replace(/^Investigate why task [^:]+ stalled and make the queue runner recover or complete it cleanly:\s*/i, "");
    const compactMessage = compactTaskText(message, 140);
    const summary = String(task?.summary || "").toLowerCase();
    if (!taskId || !compactMessage) {
      return null;
    }
    if (summary.includes("invalid json")) {
      return {
        key: `failed-json-${taskId}`,
        message: compactTaskText(`Investigate and fix the worker JSON formatting failure for task ${taskId}. Original task: ${compactMessage}`, 220),
        specialtyHint: "code",
        sourceTaskId: taskId,
        reason: `Recent failed task ${taskId} ended with malformed worker JSON.`
      };
    }
    if (summary.includes("stalled")) {
      return {
        key: `failed-stall-${taskId}`,
        message: compactTaskText(`Investigate why task ${taskId} stalled and make the queue runner recover or complete it cleanly. Original task: ${compactMessage}`, 220),
        specialtyHint: "code",
        sourceTaskId: taskId,
        reason: `Recent failed task ${taskId} stalled during execution.`
      };
    }
    if (summary.includes("send_mail tool") || summary.includes("mail sender")) {
      return {
        key: `failed-mail-${taskId}`,
        message: compactTaskText(`Verify the mail sending tool path and retry the failed email task ${taskId}. Original task: ${compactMessage}`, 220),
        specialtyHint: "document",
        sourceTaskId: taskId,
        reason: `Recent failed task ${taskId} could not complete its email send path.`
      };
    }
    return null;
  }

  function isBogusOrMetaOpportunityMessage(message = "") {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    return (
      !text
      || /^task-\\d+:/i.test(text)
      || /\bi have completed the task\b/i.test(text)
      || /\bi completed the task\b/i.test(text)
      || /\bworker summary\b/i.test(text)
      || /\bartifact summary\b/i.test(text)
      || /\bno further tasks are pending\b/i.test(text)
      || /\bnova awaits instructions\b/i.test(text)
      || /\bhanded to worker brains\b/i.test(text)
      || /\badditional useful work packages\b/i.test(text)
      || /\bidentify(?:ing)? and suggesting additional work packages\b/i.test(text)
      || /\bsearching for additional useful work packages\b/i.test(text)
      || /\btoday'?s tasks\b/i.test(text)
      || /\bdaily tasks\b/i.test(text)
      || /\bpersonal notes\b/i.test(text)
      || /\btypical preferences\b/i.test(text)
      || /\bpersonal commitments\b/i.test(text)
      || /\bactionable items and reminders\b/i.test(text)
      || /\banaly[sz]ing the workload\b/i.test(text)
      || /\bsuggested work packages\b/i.test(text)
      || lower.startsWith("i have completed")
      || lower.startsWith("i completed")
    );
  }

  function buildAllowedOpportunityReferences({ workspaceProjects = [], recentFailed = [], recentDone = [], urgentDocuments = [], workspaceMarkdown = [] } = {}) {
    const refs = new Set();
    const addRef = (value) => {
      const normalized = String(value || "").trim();
      if (!normalized || normalized.length < 3) {
        return;
      }
      refs.add(normalized.toLowerCase());
    };
    for (const project of Array.isArray(workspaceProjects) ? workspaceProjects : []) {
      addRef(project?.name);
    }
    for (const task of [...(Array.isArray(recentFailed) ? recentFailed : []), ...(Array.isArray(recentDone) ? recentDone : [])]) {
      addRef(task?.id);
      addRef(task?.message);
    }
    for (const doc of Array.isArray(urgentDocuments) ? urgentDocuments : []) {
      addRef(doc?.relativePath);
      addRef(doc?.heading);
    }
    for (const entry of Array.isArray(workspaceMarkdown) ? workspaceMarkdown : []) {
      addRef(entry?.path);
      addRef(entry?.heading);
    }
    return [...refs];
  }

  function messageReferencesKnownOpportunitySource(message = "", allowedRefs = []) {
    const text = String(message || "").trim().toLowerCase();
    if (!text) {
      return false;
    }
    if (/task-\\d+/i.test(text) || /[\\\\/]/.test(text) || /\\.[a-z0-9]{1,8}\\b/i.test(text)) {
      return true;
    }
    return (Array.isArray(allowedRefs) ? allowedRefs : []).some((ref) => ref && text.includes(String(ref).toLowerCase()));
  }

  function deriveOpportunityAnchorData(message = "", { workspaceProjects = [], recentFailed = [], urgentDocuments = [], workspaceMarkdown = [] } = {}) {
    const text = String(message || "").trim().toLowerCase();
    if (!text) {
      return null;
    }
    const matchedTask = (Array.isArray(recentFailed) ? recentFailed : []).find((task) => {
      const taskId = String(task?.id || "").trim().toLowerCase();
      return taskId && text.includes(taskId);
    });
    if (matchedTask) {
      return { sourceTaskId: String(matchedTask.id || "").trim() };
    }
    const matchedProject = (Array.isArray(workspaceProjects) ? workspaceProjects : []).find((project) => {
      const projectName = String(project?.name || "").trim().toLowerCase();
      return projectName && text.includes(projectName);
    });
    if (matchedProject) {
      return {
        projectName: String(matchedProject.name || "").trim(),
        projectPath: String(matchedProject.path || "").trim()
      };
    }
    const matchedDocument = [
      ...(Array.isArray(urgentDocuments) ? urgentDocuments : []),
      ...(Array.isArray(workspaceMarkdown) ? workspaceMarkdown : [])
    ].find((entry) => {
      const relativePath = String(entry?.relativePath || entry?.path || "").trim().toLowerCase();
      return relativePath && text.includes(relativePath);
    });
    if (matchedDocument) {
      return {
        sourceDocumentPath: String(matchedDocument.relativePath || matchedDocument.path || "").trim()
      };
    }
    return null;
  }

  async function planWorkspaceOpportunities(snapshot) {
    const planned = [];
    const seenKeys = new Set();
    const pushPlan = (entry) => {
      if (!entry?.key || !entry?.message || seenKeys.has(entry.key)) {
        return;
      }
      seenKeys.add(entry.key);
      planned.push(entry);
    };

    for (const failedTask of Array.isArray(snapshot?.recentFailed) ? snapshot.recentFailed : []) {
      pushPlan(buildFailedTaskOpportunity(failedTask));
      if (planned.length >= 2) {
        return planned;
      }
    }

    for (const entry of Array.isArray(snapshot?.workspaceMarkdown) ? snapshot.workspaceMarkdown : []) {
      pushPlan(buildMarkdownReviewOpportunity(entry, "workspace"));
      if (planned.length >= 2) {
        return planned;
      }
    }

    for (const mount of Array.isArray(snapshot?.defaultMounts) ? snapshot.defaultMounts : []) {
      for (const entry of Array.isArray(mount?.markdownFiles) ? mount.markdownFiles : []) {
        pushPlan(buildMarkdownReviewOpportunity(entry, String(mount?.id || "mount")));
        if (planned.length >= 2) {
          return planned;
        }
      }
    }

    return planned;
  }

  return {
    buildAllowedOpportunityReferences,
    buildOpportunityWorkspaceSnapshot,
    buildTaskMaintenanceSnapshot,
    deriveOpportunityAnchorData,
    isBogusOrMetaOpportunityMessage,
    listRecursiveFiles,
    messageReferencesKnownOpportunitySource,
    planWorkspaceOpportunities
  };
}
