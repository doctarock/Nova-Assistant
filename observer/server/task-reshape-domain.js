export function createTaskReshapeDomain(options = {}) {
  const {
    broadcastObserverEvent = () => {},
    buildCapabilityMismatchRetryMessage = () => "",
    classifyFailureText = () => "unknown",
    compactTaskText = (value = "") => String(value || ""),
    findTaskById = async () => null,
    fs = null,
    getProjectsRuntime = () => null,
    hashRef = (value = "") => String(value || ""),
    listAllTasks = async () => ({ queued: [], inProgress: [] }),
    materializeTaskRecord = (task = {}) => task,
    maxTaskReshapeAttempts = 3,
    pathModule = null,
    taskPathForStatus = () => "",
    taskReshapeIssuesPath = "",
    taskReshapeLogPath = "",
    workspaceTaskPath = () => "",
    writeTask = async () => {},
    writeVolumeText = async () => {}
  } = options;

  let taskReshapeIssueState = null;

  function buildRetryTaskMeta(task = {}, extra = {}) {
    return {
      ...(String(task.rootTaskId || task.id || "").trim() ? { rootTaskId: String(task.rootTaskId || task.id).trim() } : {}),
      reshapeAttemptCount: Math.max(0, Number(task.reshapeAttemptCount || 0)) + 1,
      ...(String(task.reshapeIssueKey || "").trim() ? { reshapeIssueKey: String(task.reshapeIssueKey).trim() } : {}),
      ...(String(task.internalJobType || "").trim() ? { internalJobType: String(task.internalJobType).trim() } : {}),
      ...(String(task.specialtyHint || "").trim() ? { specialtyHint: String(task.specialtyHint).trim() } : {}),
      ...(String(task.creativeThroughputMode || "").trim() ? { creativeThroughputMode: String(task.creativeThroughputMode).trim() } : {}),
      ...(task.preferHigherThroughputCreativeLane === true ? { preferHigherThroughputCreativeLane: true } : {}),
      ...(task.skipCreativeHandoff === true ? { skipCreativeHandoff: true } : {}),
      ...(String(task.creativeHandoffBrainId || "").trim() ? { creativeHandoffBrainId: String(task.creativeHandoffBrainId).trim() } : {}),
      ...(String(task.projectName || "").trim() ? { projectName: String(task.projectName).trim() } : {}),
      ...(String(task.projectPath || "").trim() ? { projectPath: String(task.projectPath).trim() } : {}),
      ...(String(task.projectWorkKey || "").trim() ? { projectWorkKey: String(task.projectWorkKey).trim() } : {}),
      ...(String(task.projectWorkFocus || "").trim() ? { projectWorkFocus: String(task.projectWorkFocus).trim() } : {}),
      ...(String(task.projectWorkSource || "").trim() ? { projectWorkSource: String(task.projectWorkSource).trim() } : {}),
      ...(String(task.projectWorkRoleName || "").trim() ? { projectWorkRoleName: String(task.projectWorkRoleName).trim() } : {}),
      ...(String(task.projectWorkRoleReason || "").trim() ? { projectWorkRoleReason: String(task.projectWorkRoleReason).trim() } : {}),
      ...(String(task.projectWorkRolePlaybook || "").trim() ? { projectWorkRolePlaybook: String(task.projectWorkRolePlaybook).trim() } : {}),
      ...(String(task.projectWorkPrimaryTarget || "").trim() ? { projectWorkPrimaryTarget: String(task.projectWorkPrimaryTarget).trim() } : {}),
      ...(String(task.projectWorkSecondaryTarget || "").trim() ? { projectWorkSecondaryTarget: String(task.projectWorkSecondaryTarget).trim() } : {}),
      ...(String(task.projectWorkTertiaryTarget || "").trim() ? { projectWorkTertiaryTarget: String(task.projectWorkTertiaryTarget).trim() } : {}),
      ...(String(task.projectWorkExpectedFirstMove || "").trim() ? { projectWorkExpectedFirstMove: String(task.projectWorkExpectedFirstMove).trim() } : {}),
      ...extra
    };
  }

  function getTaskRootId(task = {}) {
    return String(task?.rootTaskId || task?.id || "").trim();
  }

  function getTaskReshapeAttemptCount(task = {}) {
    return Math.max(0, Number(task?.reshapeAttemptCount || 0));
  }

  function canReshapeTask(task = {}, increment = 1) {
    return getTaskReshapeAttemptCount(task) + Math.max(0, Number(increment || 0)) <= maxTaskReshapeAttempts;
  }

  function normalizeReshapeSignatureText(value = "") {
    return String(value || "")
      .toLowerCase()
      .replace(/[a-z]:\\[^\s"]+/gi, "<path>")
      .replace(/\/home\/openclaw\/[^\s"]+/gi, "<path>")
      .replace(/\btask-\d+\b/gi, "task")
      .replace(/\b\d{2,}\b/g, "#")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseTaskReshapeLogEntries(raw = "") {
    return String(raw || "")
      .split(/^##\s+/m)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const timestamp = String(lines.shift() || "").trim();
        const entry = {
          at: Number(new Date(timestamp).getTime() || 0),
          taskId: "",
          taskCodename: "",
          rootTaskId: "",
          phase: "",
          action: "",
          classification: "",
          recurrenceCount: 0,
          uniqueRootTaskCount: 0,
          reason: "",
          improvement: ""
        };
        for (const line of lines) {
          const match = line.match(/^- ([^:]+):\s*(.*)$/);
          if (!match) {
            continue;
          }
          const key = String(match[1] || "").trim().toLowerCase();
          const value = String(match[2] || "").trim();
          if (key === "task") {
            const taskMatch = value.match(/^(.*)\((task-\d+)\)$/i);
            if (taskMatch) {
              entry.taskCodename = String(taskMatch[1] || "").trim();
              entry.taskId = String(taskMatch[2] || "").trim();
            } else {
              entry.taskCodename = value;
            }
            continue;
          }
          if (key === "root task") {
            entry.rootTaskId = value;
            continue;
          }
          if (key === "phase") {
            entry.phase = value;
            continue;
          }
          if (key === "action") {
            entry.action = value;
            continue;
          }
          if (key === "classification") {
            entry.classification = value;
            continue;
          }
          if (key === "recurrence count") {
            entry.recurrenceCount = Number(value || 0);
            continue;
          }
          if (key === "unique job count") {
            entry.uniqueRootTaskCount = Number(value || 0);
            continue;
          }
          if (key === "reason") {
            entry.reason = value;
            continue;
          }
          if (key === "improvement") {
            entry.improvement = value;
          }
        }
        return entry;
      })
      .filter((entry) => entry.at > 0 && (entry.taskId || entry.reason || entry.classification));
  }

  function buildTaskReshapeIssueStateFromLogEntries(entries = []) {
    const issues = {};
    for (const entry of Array.isArray(entries) ? entries : []) {
      const signatureSeed = [
        String(entry.classification || "unknown").trim().toLowerCase() || "unknown",
        normalizeReshapeSignatureText(entry.reason || entry.improvement || entry.taskCodename || entry.taskId || "")
      ].join("|");
      const issueKey = hashRef(signatureSeed || `reshape-${entry.at}`);
      const existing = issues[issueKey] || {
        issueKey,
        signature: signatureSeed,
        classification: String(entry.classification || "unknown").trim() || "unknown",
        firstSeenAt: Number(entry.at || 0),
        lastSeenAt: Number(entry.at || 0),
        occurrenceCount: 0,
        uniqueRootTaskCount: 0,
        rootTaskIds: [],
        recentTaskIds: []
      };
      const rootTaskIds = new Set((Array.isArray(existing.rootTaskIds) ? existing.rootTaskIds : []).filter(Boolean));
      if (entry.rootTaskId) {
        rootTaskIds.add(String(entry.rootTaskId).trim());
      }
      const recentTaskIds = [
        ...(Array.isArray(existing.recentTaskIds) ? existing.recentTaskIds : []).filter(Boolean),
        String(entry.taskId || "").trim()
      ].filter(Boolean).slice(-20);
      issues[issueKey] = {
        ...existing,
        issueKey,
        signature: signatureSeed,
        classification: String(entry.classification || existing.classification || "unknown").trim() || "unknown",
        firstSeenAt: Math.min(Number(existing.firstSeenAt || entry.at || 0), Number(entry.at || existing.firstSeenAt || 0)),
        lastSeenAt: Math.max(Number(existing.lastSeenAt || 0), Number(entry.at || 0)),
        occurrenceCount: Math.max(Number(existing.occurrenceCount || 0) + 1, Number(entry.recurrenceCount || 0) || 1),
        uniqueRootTaskCount: Math.max(rootTaskIds.size, Number(entry.uniqueRootTaskCount || 0)),
        rootTaskIds: [...rootTaskIds].slice(-50),
        recentTaskIds,
        lastTaskId: String(entry.taskId || existing.lastTaskId || "").trim(),
        lastTaskCodename: String(entry.taskCodename || existing.lastTaskCodename || "").trim(),
        lastSourceTaskId: String(entry.taskId || existing.lastSourceTaskId || "").trim(),
        lastSourceTaskCodename: String(entry.taskCodename || existing.lastSourceTaskCodename || "").trim(),
        lastRequestedBrainId: String(existing.lastRequestedBrainId || "").trim(),
        lastRequestedBrainLabel: String(existing.lastRequestedBrainLabel || "").trim(),
        lastAttemptedBrains: Array.isArray(existing.lastAttemptedBrains) ? existing.lastAttemptedBrains : [],
        lastOutcomeSummary: String(existing.lastOutcomeSummary || "").trim(),
        lastTaskMessage: String(existing.lastTaskMessage || "").trim(),
        lastReason: compactTaskText(String(entry.reason || existing.lastReason || "").trim(), 320),
        lastImprovement: compactTaskText(String(entry.improvement || existing.lastImprovement || "").trim(), 320),
        lastPhase: String(entry.phase || existing.lastPhase || "").trim(),
        lastAction: String(entry.action || existing.lastAction || "").trim()
      };
    }
    return {
      issues,
      events: []
    };
  }

  async function buildTaskReshapeIssueStateFromLog() {
    try {
      const raw = await fs.readFile(taskReshapeLogPath, "utf8");
      return buildTaskReshapeIssueStateFromLogEntries(parseTaskReshapeLogEntries(raw));
    } catch {
      return {
        issues: {},
        events: []
      };
    }
  }

  async function getEffectiveTaskReshapeIssueState() {
    const state = await loadTaskReshapeIssueState();
    if (Object.keys(state?.issues || {}).length) {
      return state;
    }
    const recovered = await buildTaskReshapeIssueStateFromLog();
    if (Object.keys(recovered?.issues || {}).length) {
      return recovered;
    }
    return state;
  }

  function buildReshapeIssueSignature({ task = {}, sourceTask = null, classification = "", reason = "", improvement = "" } = {}) {
    const anchorTask = sourceTask && typeof sourceTask === "object" ? sourceTask : task;
    const summary = compactTaskText(
      String(reason || improvement || anchorTask?.resultSummary || anchorTask?.reviewSummary || anchorTask?.workerSummary || anchorTask?.notes || anchorTask?.message || "").trim(),
      220
    );
    const normalizedSummary = normalizeReshapeSignatureText(summary);
    const normalizedClassification = String(classification || anchorTask?.failureClassification || "").trim().toLowerCase() || "unknown";
    return `${normalizedClassification}|${normalizedSummary || "unspecified"}`;
  }

  async function loadTaskReshapeIssueState() {
    if (taskReshapeIssueState) {
      return taskReshapeIssueState;
    }
    try {
      const raw = await fs.readFile(taskReshapeIssuesPath, "utf8");
      const parsed = JSON.parse(raw);
      taskReshapeIssueState = {
        issues: parsed?.issues && typeof parsed.issues === "object" ? parsed.issues : {},
        events: Array.isArray(parsed?.events) ? parsed.events : []
      };
    } catch {
      taskReshapeIssueState = {
        issues: {},
        events: []
      };
    }
    return taskReshapeIssueState;
  }

  async function saveTaskReshapeIssueState() {
    const state = await loadTaskReshapeIssueState();
    const normalizedIssues = Object.fromEntries(
      Object.entries(state.issues || {})
        .filter(([key]) => String(key || "").trim())
        .map(([key, value]) => [
          key,
          {
            issueKey: String(value?.issueKey || key).trim(),
            signature: String(value?.signature || "").trim(),
            classification: String(value?.classification || "unknown").trim(),
            firstSeenAt: Number(value?.firstSeenAt || 0),
            lastSeenAt: Number(value?.lastSeenAt || 0),
            occurrenceCount: Math.max(0, Number(value?.occurrenceCount || 0)),
            uniqueRootTaskCount: Math.max(0, Number(value?.uniqueRootTaskCount || 0)),
            lastTaskId: String(value?.lastTaskId || "").trim(),
            lastTaskCodename: String(value?.lastTaskCodename || "").trim(),
            lastSourceTaskId: String(value?.lastSourceTaskId || "").trim(),
            lastSourceTaskCodename: String(value?.lastSourceTaskCodename || "").trim(),
            lastRequestedBrainId: String(value?.lastRequestedBrainId || "").trim(),
            lastRequestedBrainLabel: String(value?.lastRequestedBrainLabel || "").trim(),
            lastAttemptedBrains: Array.isArray(value?.lastAttemptedBrains) ? value.lastAttemptedBrains.slice(-8) : [],
            lastOutcomeSummary: String(value?.lastOutcomeSummary || "").trim(),
            lastTaskMessage: String(value?.lastTaskMessage || "").trim(),
            lastReason: String(value?.lastReason || "").trim(),
            lastImprovement: String(value?.lastImprovement || "").trim(),
            lastPhase: String(value?.lastPhase || "").trim(),
            lastAction: String(value?.lastAction || "").trim(),
            rootTaskIds: Array.isArray(value?.rootTaskIds) ? value.rootTaskIds.slice(-50) : [],
            recentTaskIds: Array.isArray(value?.recentTaskIds) ? value.recentTaskIds.slice(-20) : []
          }
        ])
    );
    const normalizedEvents = Array.isArray(state.events) ? state.events.slice(-500) : [];
    taskReshapeIssueState = {
      issues: normalizedIssues,
      events: normalizedEvents
    };
    await writeVolumeText(taskReshapeIssuesPath, `${JSON.stringify(taskReshapeIssueState, null, 2)}\n`);
  }

  async function resetTaskReshapeIssueState() {
    const state = await loadTaskReshapeIssueState();
    const clearedIssueCount = Object.keys(state?.issues || {}).length;
    const clearedEventCount = Array.isArray(state?.events) ? state.events.length : 0;
    taskReshapeIssueState = {
      issues: {},
      events: []
    };
    await writeVolumeText(taskReshapeIssuesPath, `${JSON.stringify(taskReshapeIssueState, null, 2)}\n`);
    await writeVolumeText(taskReshapeLogPath, "");
    return {
      clearedIssueCount,
      clearedEventCount
    };
  }

  async function listTaskReshapeIssues({ limit = 12 } = {}) {
    const state = await getEffectiveTaskReshapeIssueState();
    const issueEntries = Object.values(state?.issues || {})
      .filter((entry) => entry && typeof entry === "object")
      .sort((left, right) => {
        const rightScore = Number(right.lastSeenAt || right.firstSeenAt || 0);
        const leftScore = Number(left.lastSeenAt || left.firstSeenAt || 0);
        return rightScore - leftScore;
      })
      .slice(0, Math.max(1, Number(limit || 12)));
    const issues = await Promise.all(issueEntries.map(async (entry) => {
      const sourceTaskId = String(entry.lastSourceTaskId || "").trim() || String(entry.lastTaskId || "").trim();
      const liveTask = sourceTaskId ? await findTaskById(sourceTaskId) : null;
      const attemptedBrains = Array.isArray(entry.lastAttemptedBrains) && entry.lastAttemptedBrains.length
        ? entry.lastAttemptedBrains
        : [
            ...(Array.isArray(liveTask?.specialistAttemptedBrainIds) ? liveTask.specialistAttemptedBrainIds : []),
            String(liveTask?.requestedBrainId || "").trim()
          ].map((value) => String(value || "").trim()).filter(Boolean);
      const synthesizedReason = getProjectsRuntime()?.buildConcreteReviewReason?.({
        task: liveTask || {},
        sourceTask: liveTask || null,
        attemptedBrains,
        classification: String(entry.classification || liveTask?.failureClassification || "").trim(),
        fallback: String(entry.lastReason || "").trim()
      });
      return {
        issueKey: String(entry.issueKey || "").trim(),
        classification: String(entry.classification || "unknown").trim(),
        signature: String(entry.signature || "").trim(),
        occurrenceCount: Math.max(0, Number(entry.occurrenceCount || 0)),
        uniqueRootTaskCount: Math.max(0, Number(entry.uniqueRootTaskCount || 0)),
        firstSeenAt: Number(entry.firstSeenAt || 0),
        lastSeenAt: Number(entry.lastSeenAt || 0),
        lastTaskId: String(entry.lastTaskId || "").trim(),
        lastTaskCodename: String(entry.lastTaskCodename || "").trim(),
        lastSourceTaskId: sourceTaskId,
        lastSourceTaskCodename: String(entry.lastSourceTaskCodename || liveTask?.codename || "").trim(),
        lastRequestedBrainId: String(entry.lastRequestedBrainId || liveTask?.requestedBrainId || "").trim(),
        lastRequestedBrainLabel: String(entry.lastRequestedBrainLabel || liveTask?.requestedBrainLabel || liveTask?.requestedBrainId || "").trim(),
        lastAttemptedBrains: [...new Set(attemptedBrains)].slice(-8),
        lastOutcomeSummary: compactTaskText(String(entry.lastOutcomeSummary || liveTask?.resultSummary || liveTask?.reviewSummary || liveTask?.workerSummary || liveTask?.notes || "").trim(), 320),
        lastTaskMessage: compactTaskText(String(entry.lastTaskMessage || liveTask?.originalMessage || liveTask?.message || "").trim(), 220),
        lastReason: compactTaskText(String(entry.lastReason || synthesizedReason || "").trim(), 220) || synthesizedReason,
        lastImprovement: compactTaskText(String(entry.lastImprovement || "").trim(), 220),
        lastPhase: String(entry.lastPhase || "").trim(),
        lastAction: String(entry.lastAction || "").trim()
      };
    }));
    const criticalCount = issues.filter((entry) => /critical/i.test(String(entry.lastAction || ""))).length;
    return {
      issues,
      summary: {
        totalIssues: Object.keys(state?.issues || {}).length,
        visibleIssues: issues.length,
        criticalVisibleCount: criticalCount
      }
    };
  }

  async function recordTaskReshapeReview({
    task = {},
    sourceTask = null,
    phase = "review",
    action = "reviewed",
    reason = "",
    improvement = "",
    classification = "",
    willResubmit = false,
    critical = false
  } = {}) {
    const anchorTask = sourceTask && typeof sourceTask === "object" ? sourceTask : task;
    const taskId = String(task?.id || anchorTask?.id || "").trim();
    if (!taskId) {
      return null;
    }
    const rootTaskId = getTaskRootId(anchorTask) || taskId;
    const finalClassification = String(classification || anchorTask?.failureClassification || classifyFailureText(reason || improvement || anchorTask?.resultSummary || anchorTask?.reviewSummary || anchorTask?.workerSummary || anchorTask?.notes || "")).trim() || "unknown";
    const signature = buildReshapeIssueSignature({
      task,
      sourceTask: anchorTask,
      classification: finalClassification,
      reason,
      improvement
    });
    const issueKey = hashRef(signature);
    const now = Date.now();
    const state = await loadTaskReshapeIssueState();
    const existing = state.issues?.[issueKey] && typeof state.issues[issueKey] === "object"
      ? state.issues[issueKey]
      : {
          issueKey,
          signature,
          classification: finalClassification,
          firstSeenAt: now,
          lastSeenAt: now,
          occurrenceCount: 0,
          uniqueRootTaskCount: 0,
          rootTaskIds: [],
          recentTaskIds: []
        };
    const rootTaskIds = new Set((Array.isArray(existing.rootTaskIds) ? existing.rootTaskIds : []).map((value) => String(value || "").trim()).filter(Boolean));
    if (rootTaskId) {
      rootTaskIds.add(rootTaskId);
    }
    const attemptedBrains = [
      ...(Array.isArray(task?.specialistAttemptedBrainIds) ? task.specialistAttemptedBrainIds : []),
      ...(Array.isArray(anchorTask?.specialistAttemptedBrainIds) ? anchorTask.specialistAttemptedBrainIds : []),
      String(anchorTask?.requestedBrainId || "").trim()
    ].map((value) => String(value || "").trim()).filter(Boolean);
    const recentTaskIds = [
      ...(Array.isArray(existing.recentTaskIds) ? existing.recentTaskIds : []).map((value) => String(value || "").trim()).filter(Boolean),
      taskId
    ].slice(-20);
    const updated = {
      ...existing,
      issueKey,
      signature,
      classification: finalClassification,
      lastSeenAt: now,
      occurrenceCount: Math.max(0, Number(existing.occurrenceCount || 0)) + 1,
      uniqueRootTaskCount: rootTaskIds.size,
      rootTaskIds: [...rootTaskIds].slice(-50),
      recentTaskIds,
      lastTaskId: taskId,
      lastTaskCodename: String(task?.codename || anchorTask?.codename || "").trim(),
      lastSourceTaskId: String(anchorTask?.id || "").trim(),
      lastSourceTaskCodename: String(anchorTask?.codename || "").trim(),
      lastRequestedBrainId: String(anchorTask?.requestedBrainId || "").trim(),
      lastRequestedBrainLabel: String(anchorTask?.requestedBrainLabel || anchorTask?.requestedBrainId || "").trim(),
      lastAttemptedBrains: [...new Set(attemptedBrains)].slice(-8),
      lastOutcomeSummary: compactTaskText(String(anchorTask?.resultSummary || anchorTask?.reviewSummary || anchorTask?.workerSummary || anchorTask?.notes || "").trim(), 320),
      lastTaskMessage: compactTaskText(String(anchorTask?.originalMessage || anchorTask?.message || "").trim(), 220),
      lastReason: compactTaskText(String(reason || "").trim(), 320),
      lastImprovement: compactTaskText(String(improvement || "").trim(), 320),
      lastPhase: String(phase || "review").trim(),
      lastAction: String(action || "reviewed").trim()
    };
    state.issues[issueKey] = updated;
    state.events.push({
      at: now,
      taskId,
      taskCodename: String(task?.codename || anchorTask?.codename || "").trim(),
      sourceTaskId: String(anchorTask?.id || "").trim(),
      rootTaskId,
      issueKey,
      phase: String(phase || "review").trim(),
      action: String(action || "reviewed").trim(),
      classification: finalClassification,
      reason: compactTaskText(String(reason || "").trim(), 320),
      improvement: compactTaskText(String(improvement || "").trim(), 320),
      reshapeAttemptCount: getTaskReshapeAttemptCount(anchorTask),
      willResubmit: willResubmit === true,
      critical: critical === true,
      recurrenceCount: updated.occurrenceCount,
      uniqueRootTaskCount: updated.uniqueRootTaskCount
    });
    await saveTaskReshapeIssueState();

    const logLines = [
      `## ${new Date(now).toISOString()}`,
      `- Task: ${updated.lastTaskCodename || taskId} (${taskId})`,
      `- Root task: ${rootTaskId || "unknown"}`,
      `- Phase: ${String(phase || "review").trim() || "review"}`,
      `- Action: ${String(action || "reviewed").trim() || "reviewed"}`,
      `- Classification: ${finalClassification}`,
      `- Recurrence count: ${updated.occurrenceCount}`,
      `- Unique job count: ${updated.uniqueRootTaskCount}`,
      `- Reshape attempts so far: ${getTaskReshapeAttemptCount(anchorTask)}/${maxTaskReshapeAttempts}`,
      `- Will resubmit: ${willResubmit === true ? "yes" : "no"}`,
      `- Critical: ${critical === true ? "yes" : "no"}`,
      `- Reason: ${compactTaskText(String(reason || "").trim(), 320) || "n/a"}`,
      `- Improvement: ${compactTaskText(String(improvement || "").trim(), 320) || "n/a"}`,
      ""
    ];
    await fs.mkdir(pathModule.dirname(taskReshapeLogPath), { recursive: true });
    await fs.appendFile(taskReshapeLogPath, `${logLines.join("\n")}\n`, "utf8");
    return updated;
  }

  function buildFailureReshapeMessage(task = {}, improvement = "") {
    const failureClassification = String(task?.failureClassification || classifyFailureText(task?.resultSummary || task?.reviewSummary || task?.workerSummary || task?.notes || "")).trim();
    const retryMessage = compactTaskText(
      String(improvement || "").trim(),
      500
    ) || compactTaskText(buildCapabilityMismatchRetryMessage(task, failureClassification).replace(String(task?.message || "").trim(), "").trim(), 500);
    if (String(task?.internalJobType || "").trim() === "project_cycle") {
      return getProjectsRuntime()?.buildProjectCycleFollowUpMessage?.(task, { retryNote: retryMessage || failureClassification });
    }
    return [String(task?.message || "").trim(), "", compactTaskText(retryMessage || `Retry note: address the previous ${failureClassification || "failed"} outcome and keep the next pass concrete.`, 320)]
      .filter(Boolean)
      .join("\n");
  }

  async function markTaskCriticalFailure(task = {}, reason = "") {
    if (!task?.id) {
      return task;
    }
    const updatedTask = materializeTaskRecord({
      ...task,
      criticalFailure: true,
      criticalFailureAt: Date.now(),
      criticalFailureReason: compactTaskText(String(reason || "").trim(), 320),
      notes: compactTaskText(`${String(task.notes || "").trim()} Critical failure: ${String(reason || "").trim()}`.trim(), 320)
    });
    await writeVolumeText(updatedTask.filePath, `${JSON.stringify(updatedTask, null, 2)}\n`);
    return updatedTask;
  }

  async function attachHelperAnalysisToRelatedTasks({
    message,
    sessionId = "Main",
    helperAnalysis = null
  } = {}) {
    if (!helperAnalysis || !String(message || "").trim()) {
      return 0;
    }
    const { queued, inProgress } = await listAllTasks();
    const candidates = [...queued, ...inProgress]
      .filter((task) => String(task.sessionId || "") === String(sessionId || "Main"))
      .filter((task) => String(task.message || "").trim() === String(message || "").trim())
      .filter((task) => !task.helperAnalysis?.summary && !task.helperAnalysis?.intent);
    let updated = 0;
    for (const task of candidates) {
      const nextTask = {
        ...task,
        updatedAt: Date.now(),
        helperAnalysis
      };
      await writeTask(nextTask);
      broadcastObserverEvent({
        type: "task.updated",
        task: {
          ...nextTask,
          filePath: taskPathForStatus(nextTask.id, nextTask.status),
          workspacePath: workspaceTaskPath(nextTask.status, nextTask.id)
        }
      });
      updated += 1;
    }
    return updated;
  }

  return {
    attachHelperAnalysisToRelatedTasks,
    buildFailureReshapeMessage,
    buildRetryTaskMeta,
    canReshapeTask,
    getTaskReshapeAttemptCount,
    getTaskRootId,
    listTaskReshapeIssues,
    markTaskCriticalFailure,
    recordTaskReshapeReview,
    resetTaskReshapeIssueState
  };
}
