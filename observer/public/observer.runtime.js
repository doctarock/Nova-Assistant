(() => {
const observerApp = window.ObserverApp || (window.ObserverApp = {});
const {
  buildTaskFileEntries,
  enqueueUpdate,
  escapeAttr,
  escapeHtml,
  formatCronObservation,
  formatEntityRef,
  formatDateTime,
  formatGpuStatus,
  formatTime,
  getTaskEventKey,
  getLanguageVariants,
  hashId,
  normalizeTrustLevel,
  pickLanguageVariant,
  trustLevelLabel,
  renderAttachmentList,
  renderPassivePayload,
  renderRepairTaskList,
  renderRegressionResults,
  renderRegressionSuiteList,
  renderTaskReshapeIssuesList,
  renderTaskFilesList,
  renderTaskList,
  activateQueueSubtab,
  captureVoiceTrustProfileSignature,
  rememberTaskEvent,
  renderLanguageString,
  setStatus,
  showQueuedUpdate
} = observerApp;

const pluginEventHandlers = new Map();
const taskJobTypeCompletedHandlers = new Map();

function renderQdrantDetails(status = {}) {
  const docs = Math.max(0, Number(status?.indexedDocumentCount || 0));
  const chunks = Math.max(0, Number(status?.indexedChunkCount || 0));
  const syncLabel = Number(status?.lastSyncAt || 0)
    ? formatDateTime(status.lastSyncAt)
    : "Never";
  const authLabel = status?.enabled ? (status?.hasApiKey ? "Auth key stored" : "No auth key") : "Auth n/a";
  return `${docs} docs | ${chunks} chunks | ${authLabel} | Sync ${syncLabel}`;
}

function hasCoreStateBrowserUi() {
  return Boolean(
    scopeSelect
    && selectedFileEl
    && reloadFilesBtn
    && stateFileBrowserEl
    && stateTaskFilesBrowserEl
    && fileListEl
    && fileContentEl
    && taskFilesListEl
    && taskFileContentEl
  );
}

async function loadTaskFile(relativePath) {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  activeTaskFilePath = relativePath;
  selectedFileEl.value = relativePath || "";
  taskFileContentEl.textContent = "Loading task file...";
  renderTaskFilesList(buildTaskFileEntries());
  try {
    const normalizedPath = String(relativePath || "").trim();
    const isQueueFile = normalizedPath.startsWith("task-queue/")
      || normalizedPath.startsWith("observer-task-queue/")
      || normalizedPath.startsWith("derpy-observer-task-queue/");
    const scope = isQueueFile ? "queue" : "workspace";
    const requestPath = isQueueFile
      ? normalizedPath
          .replace(/^task-queue\//, "")
          .replace(/^observer-task-queue\//, "")
          .replace(/^derpy-observer-task-queue\//, "")
      : normalizedPath;
    const r = await fetch(`/api/inspect/file?scope=${encodeURIComponent(scope)}&file=${encodeURIComponent(requestPath)}`);
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load task file");
    }
    if (j.relocated && String(j.file || "").trim()) {
      activeTaskFilePath = String(j.file || "").trim();
      selectedFileEl.value = activeTaskFilePath;
    }
    taskFileContentEl.textContent = j.content || "(empty file)";
    renderTaskFilesList(buildTaskFileEntries());
  } catch (error) {
    taskFileContentEl.textContent = `Failed to load task file: ${error.message}`;
  }
}

async function loadTaskFiles(options = {}) {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  updateStateScopeView();
  if (!options.preserveSelection) {
    activeTaskFilePath = "";
  }
  const files = buildTaskFileEntries();
  renderTaskFilesList(files);
  if (!files.length) {
    selectedFileEl.value = "";
    return;
  }
  const preferredFile = activeTaskFilePath && files.some((file) => file.relativePath === activeTaskFilePath)
    ? activeTaskFilePath
    : files[0].relativePath;
  await loadTaskFile(preferredFile);
}

function quotePowerShellArg(value) {
  return `'${String(value == null ? "" : value).replace(/'/g, "''")}'`;
}

function buildRegressionCommandLine(suiteId = "all") {
  const normalizedSuiteId = String(suiteId || "all").trim() || "all";
  return `node openclaw-observer/run-regressions.js --suite ${quotePowerShellArg(normalizedSuiteId)}`;
}

function refreshRegressionCommandUi() {
  if (!regressionCommandSuiteSelectEl || !regressionCommandLineEl) {
    return;
  }
  const suites = Array.isArray(observerApp.regressionSuites) ? observerApp.regressionSuites : [];
  const options = [
    { id: "all", label: "All suites" },
    ...suites.map((suite) => ({
      id: String(suite?.id || "").trim(),
      label: String(suite?.label || suite?.id || "Suite").trim() || "Suite"
    })).filter((suite) => suite.id)
  ];
  const selectedSuiteId = String(
    regressionCommandSuiteSelectEl.value
    || observerApp.selectedRegressionCommandSuiteId
    || "all"
  ).trim() || "all";
  regressionCommandSuiteSelectEl.innerHTML = options.map((suite) => `
    <option value="${escapeAttr(suite.id)}">${escapeHtml(suite.label)}</option>
  `).join("");
  const resolvedSuiteId = options.some((suite) => suite.id === selectedSuiteId)
    ? selectedSuiteId
    : "all";
  regressionCommandSuiteSelectEl.value = resolvedSuiteId;
  observerApp.selectedRegressionCommandSuiteId = resolvedSuiteId;
  regressionCommandLineEl.textContent = buildRegressionCommandLine(resolvedSuiteId);
  if (copyRegressionCommandBtn) {
    copyRegressionCommandBtn.disabled = false;
  }
  if (regressionCommandHintEl) {
    regressionCommandHintEl.textContent = "Runs against http://127.0.0.1:3220 by default. Set OBSERVER_BASE_URL to override.";
  }
}

function isTaskFilesScopeSelected() {
  return String(scopeSelect?.value || "").trim() === "taskfiles";
}

function updateStateScopeView() {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  const taskFilesScope = isTaskFilesScopeSelected();
  if (stateFileBrowserEl) {
    stateFileBrowserEl.hidden = taskFilesScope;
  }
  if (stateTaskFilesBrowserEl) {
    stateTaskFilesBrowserEl.hidden = !taskFilesScope;
  }
  if (selectedFileEl) {
    selectedFileEl.placeholder = taskFilesScope ? "Select a task file below" : "Select a file below";
    if (!taskFilesScope && !activeFileKey) {
      selectedFileEl.value = "";
    }
    if (taskFilesScope) {
      selectedFileEl.value = activeTaskFilePath || "";
    }
  }
  if (reloadFilesBtn) {
    reloadFilesBtn.textContent = taskFilesScope ? "Reload task files" : "Reload files";
  }
}

async function loadStateInspector(options = {}) {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  updateStateScopeView();
  if (isTaskFilesScopeSelected()) {
    return loadTaskFiles({ preserveSelection: options.preserveSelection !== false });
  }
  return loadTree();
}

async function resetToSimpleProjectState() {
  const hasCoreUi = hasCoreStateBrowserUi();
  const confirmationText = "This will clear Nova's internal test projects, queue/runtime logs, observer input/output, and generated prompt logs, then seed one simple checkbox project. Continue?";
  if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(confirmationText)) {
    return;
  }
  if (resetSimpleStateBtn) {
    resetSimpleStateBtn.disabled = true;
  }
  if (stateResetHintEl) {
    stateResetHintEl.textContent = "Resetting internal state...";
  }
  try {
    const tokenRes = await fetch("/api/admin-token");
    const tokenJson = await tokenRes.json();
    const r = await fetch("/api/state/reset-simple-project", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": tokenJson.token || "" }
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "reset failed");
    }

    const now = Date.now();
    latestCronEventTs = now;
    latestTaskEventTs = now;
    saveEventCursor(CRON_CURSOR_KEY, now);
    saveEventCursor(TASK_CURSOR_KEY, now);
    seenTaskEventKeys.clear();
    historyEntries = [];
    renderHistory();
    updateQueue = [];
    queueDisplayActive = false;
    logsEl.textContent = "";

    const summaryLines = Array.isArray(j.summaryLines) ? j.summaryLines : [];
    if (stateResetHintEl) {
      stateResetHintEl.textContent = j.message || "Reset complete.";
    }
    if (hasCoreUi && isTaskFilesScopeSelected()) {
      taskFileContentEl.textContent = summaryLines.length ? summaryLines.join("\n") : (j.message || "Reset complete.");
    } else if (hasCoreUi) {
      fileContentEl.textContent = summaryLines.length ? summaryLines.join("\n") : (j.message || "Reset complete.");
    }

    const refreshTasks = [
      loadTaskQueue()
    ];
    if (hasCoreUi) {
      refreshTasks.push(loadStateInspector({ preserveSelection: false }));
    }
    if (typeof observerApp?.refreshStateBrowserPlugin === "function") {
      refreshTasks.push(observerApp.refreshStateBrowserPlugin({ preserveSelection: false }));
    }
    await Promise.all(refreshTasks);
    if (typeof observerApp?.loadProjectsPluginPanel === "function") {
      await observerApp.loadProjectsPluginPanel();
    }
  } catch (error) {
    const message = `Reset failed: ${error.message}`;
    if (stateResetHintEl) {
      stateResetHintEl.textContent = message;
    }
    if (hasCoreUi && isTaskFilesScopeSelected()) {
      taskFileContentEl.textContent = message;
    } else if (hasCoreUi) {
      fileContentEl.textContent = message;
    }
  } finally {
    if (resetSimpleStateBtn) {
      resetSimpleStateBtn.disabled = false;
    }
  }
}

function normalizeSummaryComparisonText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeLowSignalTaskSummary(summary, task) {
  const rawSummary = String(summary || "").trim();
  if (!rawSummary) {
    return true;
  }
  const normalizedSummary = normalizeSummaryComparisonText(rawSummary);
  const taskMessage = String(task?.originalMessage || task?.message || "").trim();
  const normalizedTask = normalizeSummaryComparisonText(taskMessage);
  const taskLead = normalizedTask.slice(0, 120);
  if (normalizedTask && taskLead && normalizedSummary.includes(taskLead)) {
    return true;
  }
  return /^(i finished|i completed|i wrapped up)\b/i.test(rawSummary)
    && (
      /\badvance the project\b/i.test(rawSummary)
      || /\/home\/openclaw\/\.observer-sandbox\/workspace\//i.test(rawSummary)
      || /\bstart by reviewing\b/i.test(rawSummary)
    );
}

function buildConcreteTaskNarrationDetail(task) {
  const resultSummary = String(task.resultSummary || "").trim();
  const workerSummary = String(task.workerSummary || "").trim();
  const reviewSummary = String(task.reviewSummary || "").trim();
  const noteText = String(task.notes || "").trim();
  const outputFiles = Array.isArray(task.outputFiles) ? task.outputFiles : [];
  const betterSummary = [resultSummary, reviewSummary, workerSummary, noteText]
    .find((entry) => entry && !looksLikeLowSignalTaskSummary(entry, task));
  if (betterSummary) {
    return betterSummary;
  }
  if (outputFiles.length) {
    const topFiles = outputFiles.slice(0, 4).map((file) => file.path || file.name).filter(Boolean);
    if (topFiles.length) {
      return `Created or updated ${topFiles.join(", ")}.`;
    }
  }
  if (String(task.projectName || "").trim()) {
    return `Finished the latest pass on ${String(task.projectName).trim()}, but the recorded completion note was too vague.`;
  }
  return resultSummary || reviewSummary || workerSummary || noteText || "";
}

async function loadTaskReshapeIssues() {
  if (!taskReshapeIssuesListEl || !taskReshapeIssuesSummaryEl) {
    return;
  }
  try {
    const r = await fetch("/api/tasks/reshape-issues?limit=8");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "reshape issue summary unavailable");
    }
    const summary = j.summary || {};
    const totalIssues = Number(summary.totalIssues || 0);
    const criticalVisibleCount = Number(summary.criticalVisibleCount || 0);
    if (taskQueueIssuesCountEl) {
      taskQueueIssuesCountEl.textContent = String(Number(summary.visibleIssues || 0));
    }
    taskReshapeIssuesSummaryEl.textContent = totalIssues
      ? `${totalIssues} tracked issue${totalIssues === 1 ? "" : "s"}${criticalVisibleCount ? `, ${criticalVisibleCount} currently critical` : ""}.`
      : "No reshape issues recorded yet.";
    renderTaskReshapeIssuesList(taskReshapeIssuesListEl, j);
  } catch (error) {
    if (taskQueueIssuesCountEl) {
      taskQueueIssuesCountEl.textContent = "0";
    }
    taskReshapeIssuesSummaryEl.textContent = `Issue summary load failed: ${error.message}`;
    taskReshapeIssuesListEl.innerHTML = `<div class="panel-subtle">Recurring issue load failed.</div>`;
  }
}

function formatRepairMonitorSummary(summary = {}) {
  const activeFollowUpCount = Math.max(0, Number(summary?.activeFollowUpCount || 0));
  const activeReviewCount = Math.max(0, Number(summary?.activeReviewCount || 0));
  const reviewCount = Math.max(0, Number(summary?.reviewCount || 0));
  const recentOutcomeCount = Math.max(0, Number(summary?.recentOutcomeCount || 0));
  if (!activeFollowUpCount && !activeReviewCount && !reviewCount && !recentOutcomeCount) {
    return "No repair activity is being tracked right now.";
  }
  const lines = [];
  const activeBits = [];
  if (activeFollowUpCount) {
    activeBits.push(`${activeFollowUpCount} follow-up${activeFollowUpCount === 1 ? "" : "s"} active`);
  }
  if (activeReviewCount) {
    activeBits.push(`${activeReviewCount} repair review${activeReviewCount === 1 ? "" : "s"} running`);
  }
  if (activeBits.length) {
    lines.push(activeBits.join(", "));
  }
  const settledReviewCount = Math.max(0, reviewCount - activeReviewCount);
  const historyBits = [];
  if (settledReviewCount) {
    historyBits.push(`${settledReviewCount} logged review${settledReviewCount === 1 ? "" : "s"}`);
  }
  if (recentOutcomeCount) {
    historyBits.push(`${recentOutcomeCount} recent retry outcome${recentOutcomeCount === 1 ? "" : "s"}`);
  }
  if (historyBits.length) {
    lines.push(historyBits.join(", "));
  }
  return `${lines.join(". ")}.`;
}

function renderRepairMonitor(repairMonitor = {}) {
  const summary = repairMonitor?.summary && typeof repairMonitor.summary === "object"
    ? repairMonitor.summary
    : {};
  renderRepairTaskList(taskRepairActiveEl, repairMonitor?.active, {
    emptyText: "No active repair follow-ups."
  });
  renderRepairTaskList(taskRepairReviewsEl, repairMonitor?.reviews, {
    emptyText: "No repair review jobs are recorded."
  });
  renderRepairTaskList(taskRepairRecentEl, repairMonitor?.recent, {
    emptyText: "No recent retry outcomes are recorded."
  });
  if (taskRepairMonitorSummaryEl) {
    taskRepairMonitorSummaryEl.textContent = formatRepairMonitorSummary(summary);
  }
  if (taskQueueRepairsCountEl) {
    taskQueueRepairsCountEl.textContent = String(Math.max(0, Number(summary?.totalVisible || 0)));
  }
}

function updateQueueSummaryText(taskSnapshot = latestTaskSnapshot) {
  const queued = Array.isArray(taskSnapshot?.queued) ? taskSnapshot.queued : [];
  const waiting = Array.isArray(taskSnapshot?.waiting) ? taskSnapshot.waiting : [];
  const inProgress = Array.isArray(taskSnapshot?.inProgress) ? taskSnapshot.inProgress : [];
  const done = Array.isArray(taskSnapshot?.done) ? taskSnapshot.done : [];
  const failed = Array.isArray(taskSnapshot?.failed) ? taskSnapshot.failed : [];
  const repairSummary = taskSnapshot?.repairMonitor?.summary && typeof taskSnapshot.repairMonitor.summary === "object"
    ? taskSnapshot.repairMonitor.summary
    : {};
  const activeRepairCount = Math.max(
    0,
    Number(repairSummary?.activeFollowUpCount || 0) + Number(repairSummary?.activeReviewCount || 0)
  );
  const paused = runtimeOptions?.queue?.paused === true;
  queueSummaryEl.textContent = `${queued.length} queued, ${waiting.length} questions, ${inProgress.length} in progress, ${done.length} done, ${failed.length} failed.${activeRepairCount ? ` ${activeRepairCount} repair item${activeRepairCount === 1 ? "" : "s"} active.` : ""}${paused ? " Queue paused." : ""}`;
}

function updateQueueControlUi() {
  const paused = runtimeOptions?.queue?.paused === true;
  if (jobsQueueStateEl) {
    jobsQueueStateEl.textContent = paused ? "Queue state: paused" : "Queue state: running";
  }
  if (pauseQueueBtn) {
    pauseQueueBtn.disabled = paused;
  }
  if (resumeQueueBtn) {
    resumeQueueBtn.disabled = !paused;
  }
  updateQueueSummaryText();
}

async function setQueuePaused(paused) {
  const nextPaused = paused === true;
  if (pauseQueueBtn) {
    pauseQueueBtn.disabled = true;
  }
  if (resumeQueueBtn) {
    resumeQueueBtn.disabled = true;
  }
  if (cronHintEl) {
    cronHintEl.textContent = nextPaused ? "Pausing queue..." : "Restarting queue...";
  }
  try {
    const r = await fetch("/api/queue/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: nextPaused })
    });
    const j = await r.json();
    if (!j.ok) {
      throw new Error(j.error || "queue control failed");
    }
    runtimeOptions = {
      ...runtimeOptions,
      queue: j.queue || { ...(runtimeOptions?.queue || {}), paused: nextPaused }
    };
    updateQueueControlUi();
    if (cronHintEl && j.message) {
      cronHintEl.textContent = String(j.message);
    }
    await loadTaskQueue();
  } catch (error) {
    if (cronHintEl) {
      cronHintEl.textContent = `Queue control failed: ${error.message}`;
    }
    updateQueueControlUi();
  }
}

let pendingQuestionTimeReplayTimer = null;
let activeWaitingQuestionTaskId = "";

function getWaitingQuestionDraft(taskId = "") {
  return String(waitingQuestionAnswerDrafts.get(String(taskId || "").trim()) || "");
}

function setWaitingQuestionDraft(taskId = "", value = "") {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    return;
  }
  const nextValue = String(value || "");
  if (nextValue.trim()) {
    waitingQuestionAnswerDrafts.set(normalizedTaskId, nextValue);
    return;
  }
  waitingQuestionAnswerDrafts.delete(normalizedTaskId);
}

function pickActiveWaitingQuestion(questions = []) {
  const items = Array.isArray(questions) ? questions : [];
  if (!items.length) {
    activeWaitingQuestionTaskId = "";
    return null;
  }
  const preferredTaskIds = [
    String(activeWaitingQuestionTaskId || "").trim(),
    String(activeQuestionTimeTaskId || "").trim()
  ].filter(Boolean);
  for (const preferredTaskId of preferredTaskIds) {
    const match = items.find((task) => String(task?.id || "").trim() === preferredTaskId);
    if (match) {
      activeWaitingQuestionTaskId = preferredTaskId;
      return match;
    }
  }
  const firstTask = items[0];
  activeWaitingQuestionTaskId = String(firstTask?.id || "").trim();
  return firstTask;
}

function captureWaitingQuestionInputState() {
  if (!taskQueueWaitingEl) {
    return null;
  }
  const activeEl = document.activeElement;
  if (!activeEl || typeof activeEl.matches !== "function") {
    return null;
  }
  if (!taskQueueWaitingEl.contains(activeEl) || !activeEl.matches("[data-waiting-question-answer]")) {
    return null;
  }
  const selectionStart = typeof activeEl.selectionStart === "number" ? activeEl.selectionStart : null;
  const selectionEnd = typeof activeEl.selectionEnd === "number" ? activeEl.selectionEnd : null;
  return {
    taskId: String(activeEl.dataset.waitingQuestionTaskId || "").trim(),
    selectionStart,
    selectionEnd,
    selectionDirection: String(activeEl.selectionDirection || "none")
  };
}

function restoreWaitingQuestionInputState(answerInput, inputState = null, taskId = "") {
  if (!answerInput || !inputState) {
    return;
  }
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId || inputState.taskId !== normalizedTaskId) {
    return;
  }
  answerInput.focus({ preventScroll: true });
  if (typeof inputState.selectionStart !== "number" || typeof inputState.selectionEnd !== "number") {
    return;
  }
  const maxLength = answerInput.value.length;
  const start = Math.max(0, Math.min(maxLength, inputState.selectionStart));
  const end = Math.max(0, Math.min(maxLength, inputState.selectionEnd));
  answerInput.setSelectionRange(start, end, inputState.selectionDirection || "none");
}

function scheduleQuestionTimeReplay(delayMs = 120) {
  if (pendingQuestionTimeReplayTimer) {
    return;
  }
  pendingQuestionTimeReplayTimer = window.setTimeout(() => {
    pendingQuestionTimeReplayTimer = null;
    if (!questionTimeActive) {
      return;
    }
    replayWaitingQuestionThroughAvatar();
  }, delayMs);
}

function syncQuestionTimeAfterQueueLoad(waiting = []) {
  if (!questionTimeActive) {
    if (pendingQuestionTimeReplayTimer) {
      window.clearTimeout(pendingQuestionTimeReplayTimer);
      pendingQuestionTimeReplayTimer = null;
    }
    return;
  }
  const questions = Array.isArray(waiting) ? waiting : [];
  const activeTaskId = String(activeQuestionTimeTaskId || "").trim();
  if (!questions.length) {
    if (activeTaskId) {
      waitingQuestionAnswerDrafts.delete(activeTaskId);
    }
    if (typeof window.clearPendingVoiceQuestionInvite === "function") {
      window.clearPendingVoiceQuestionInvite({ preserveStatus: true });
    }
    if (typeof window.clearPendingVoiceQuestionWindow === "function") {
      window.clearPendingVoiceQuestionWindow({ preserveStatus: true, preserveQuestionTime: true });
    }
    setQuestionTimeActive(false);
    return;
  }
  if (activeTaskId && questions.some((task) => String(task?.id || "").trim() === activeTaskId)) {
    return;
  }
  if (activeTaskId) {
    waitingQuestionAnswerDrafts.delete(activeTaskId);
  }
  if (typeof window.clearPendingVoiceQuestionWindow === "function") {
    window.clearPendingVoiceQuestionWindow({ preserveStatus: true, preserveQuestionTime: true });
  }
  scheduleQuestionTimeReplay();
}

function renderWaitingQuestionsPanel(waiting = [], options = {}) {
  if (!taskQueueWaitingEl) {
    return;
  }
  const priorInputState = captureWaitingQuestionInputState();
  if (options.errorMessage) {
    activeWaitingQuestionTaskId = "";
    taskQueueWaitingEl.innerHTML = `<div class="panel-subtle">${escapeHtml(String(options.errorMessage || "Question load failed."))}</div>`;
    return;
  }
  const questions = Array.isArray(waiting) ? waiting : [];
  const invitedTaskStillPresent = questions.some((entry) => String(entry?.id || "").trim() === String(pendingVoiceQuestionInviteTaskId || "").trim());
  if (!invitedTaskStillPresent && typeof window.clearPendingVoiceQuestionInvite === "function") {
    window.clearPendingVoiceQuestionInvite({ preserveStatus: true });
  }
  const task = pickActiveWaitingQuestion(questions);
  if (!task) {
    activeWaitingQuestionTaskId = "";
    if (typeof window.clearPendingVoiceQuestionInvite === "function") {
      window.clearPendingVoiceQuestionInvite({ preserveStatus: true });
    }
    taskQueueWaitingEl.innerHTML = `<div class="panel-subtle">No questions waiting.</div>`;
    return;
  }
  const normalizedTaskId = String(task.id || "").trim();
  activeWaitingQuestionTaskId = normalizedTaskId;
  const narration = buildTaskNarration(task);
  const pendingCount = Math.max(0, questions.length - 1);
  const pendingText = pendingCount
    ? `${pendingCount} more question${pendingCount === 1 ? "" : "s"} waiting.`
    : "No other questions waiting.";
  const draftAnswer = getWaitingQuestionDraft(task.id);
  taskQueueWaitingEl.innerHTML = `
    <article class="card">
      <div class="metric-label">Current question</div>
      <div class="micro">${escapeHtml(pendingText)}</div>
      <div class="micro">Code: ${escapeHtml(task.codename || formatEntityRef("task", task.id || "unknown"))}</div>
      <div style="white-space: pre-wrap; margin-top: 0.75rem;">${escapeHtml(String(narration.displayText || task.questionForUser || "I need your direction before I can continue.").trim())}</div>
      <div class="queue-answer" style="margin-top: 1rem;">
        <textarea class="queue-answer-input" data-waiting-question-answer data-waiting-question-task-id="${escapeAttr(normalizedTaskId)}" rows="4" placeholder="Type your answer here">${escapeHtml(draftAnswer)}</textarea>
        <div class="queue-item-actions">
          <button type="button" class="secondary" data-submit-waiting-question>Send answer</button>
          <button type="button" class="secondary" data-clear-waiting-question-answer>Clear</button>
          <button type="button" class="secondary" data-next-waiting-question ${pendingCount ? "" : "disabled"}>Next question</button>
          <button type="button" class="secondary" data-remove-waiting-question>Remove question</button>
        </div>
        <div class="micro" data-waiting-question-status></div>
      </div>
    </article>
  `;
  const answerInput = taskQueueWaitingEl.querySelector("[data-waiting-question-answer]");
  const submitButton = taskQueueWaitingEl.querySelector("[data-submit-waiting-question]");
  const clearButton = taskQueueWaitingEl.querySelector("[data-clear-waiting-question-answer]");
  const nextButton = taskQueueWaitingEl.querySelector("[data-next-waiting-question]");
  const removeButton = taskQueueWaitingEl.querySelector("[data-remove-waiting-question]");
  const statusEl = taskQueueWaitingEl.querySelector("[data-waiting-question-status]");
  if (answerInput) {
    answerInput.addEventListener("focus", () => {
      activeWaitingQuestionTaskId = normalizedTaskId;
    });
    answerInput.addEventListener("input", () => {
      activeWaitingQuestionTaskId = normalizedTaskId;
      setWaitingQuestionDraft(task.id, answerInput.value);
    });
    answerInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        submitButton?.click();
      }
    });
    restoreWaitingQuestionInputState(answerInput, priorInputState, normalizedTaskId);
  }
  if (clearButton && answerInput) {
    clearButton.onclick = () => {
      activeWaitingQuestionTaskId = normalizedTaskId;
      setWaitingQuestionDraft(task.id, "");
      answerInput.value = "";
      if (statusEl) {
        statusEl.textContent = "";
      }
      answerInput.focus();
    };
  }
  if (submitButton && answerInput) {
    submitButton.onclick = async () => {
      activeWaitingQuestionTaskId = normalizedTaskId;
      const answer = String(answerInput.value || "").trim();
      if (!answer) {
        if (statusEl) {
          statusEl.textContent = "Type an answer first.";
        }
        answerInput.focus();
        return;
      }
      submitButton.disabled = true;
      if (removeButton) {
        removeButton.disabled = true;
      }
      if (statusEl) {
        statusEl.textContent = "Sending...";
      }
      try {
        const r = await pluginAdminFetch("/api/tasks/answer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            taskId: task.id,
            answer,
            sessionId: document.getElementById("sessionId")?.value || "Main"
          })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) {
          throw new Error(j.error || "failed to answer task");
        }
        waitingQuestionAnswerDrafts.delete(String(task.id || "").trim());
        if (typeof window.clearPendingVoiceQuestionWindow === "function") {
          window.clearPendingVoiceQuestionWindow({ preserveStatus: true, preserveQuestionTime: true });
        }
        hintEl.textContent = "Follow-up answer saved and the task has been re-queued.";
        if (statusEl) {
          statusEl.textContent = "Saved.";
        }
        await loadTaskQueue();
      } catch (error) {
        const message = String(error?.message || "failed to answer task");
        if (/task not found/i.test(message)) {
          waitingQuestionAnswerDrafts.delete(String(task.id || "").trim());
          hintEl.textContent = "That question was already replaced with a newer one. Refreshing the queue.";
          if (statusEl) {
            statusEl.textContent = "That question was already replaced. Refreshing.";
          }
          await loadTaskQueue();
        } else {
          hintEl.textContent = `Task answer failed: ${message}`;
          if (statusEl) {
            statusEl.textContent = message;
          }
        }
      } finally {
        submitButton.disabled = false;
        if (removeButton) {
          removeButton.disabled = false;
        }
      }
    };
  }
  if (nextButton) {
    nextButton.onclick = () => {
      if (questions.length <= 1) {
        if (statusEl) {
          statusEl.textContent = "No other questions waiting.";
        }
        return;
      }
      const currentIndex = questions.findIndex((entry) => String(entry?.id || "").trim() === normalizedTaskId);
      const nextIndex = currentIndex >= 0
        ? (currentIndex + 1) % questions.length
        : 0;
      const nextTask = questions[nextIndex];
      if (!nextTask) {
        return;
      }
      const nextTaskId = String(nextTask.id || "").trim();
      if (!nextTaskId) {
        return;
      }
      activeWaitingQuestionTaskId = nextTaskId;
      if (questionTimeActive && typeof setActiveQuestionTimeTaskId === "function") {
        setActiveQuestionTimeTaskId(nextTaskId);
      }
      renderWaitingQuestionsPanel(questions);
      if (statusEl) {
        statusEl.textContent = "";
      }
      if (hintEl) {
        hintEl.textContent = "Showing the next waiting question.";
      }
      if (questionTimeActive) {
        replayWaitingQuestionThroughAvatar();
      }
    };
  }
  if (removeButton) {
    removeButton.onclick = async () => {
      activeWaitingQuestionTaskId = normalizedTaskId;
      removeButton.disabled = true;
      if (submitButton) {
        submitButton.disabled = true;
      }
      if (statusEl) {
        statusEl.textContent = "Removing...";
      }
      try {
        const r = await pluginAdminFetch("/api/tasks/remove", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskId: task.id })
        });
        const j = await r.json();
        if (j.code === "task_in_progress") {
          hintEl.textContent = "That task is currently running. Use Abort instead.";
          await loadTaskQueue();
          return;
        }
        if (!r.ok || !j.ok) {
          throw new Error(j.error || "failed to remove task");
        }
        waitingQuestionAnswerDrafts.delete(String(task.id || "").trim());
        if (typeof window.clearPendingVoiceQuestionWindow === "function") {
          window.clearPendingVoiceQuestionWindow({ preserveStatus: true, preserveQuestionTime: true });
        }
        hintEl.textContent = "Waiting question removed.";
        await loadTaskQueue();
      } catch (error) {
        const message = String(error?.message || "failed to remove task");
        if (/task not found/i.test(message)) {
          waitingQuestionAnswerDrafts.delete(String(task.id || "").trim());
          hintEl.textContent = "That question was already cleared. Refreshing the queue.";
          await loadTaskQueue();
        } else {
          hintEl.textContent = `Task removal failed: ${message}`;
          if (statusEl) {
            statusEl.textContent = message;
          }
          removeButton.disabled = false;
          if (submitButton) {
            submitButton.disabled = false;
          }
        }
      }
    };
  }
}

async function loadTaskQueue() {
  try {
    const r = await fetch("/api/tasks/list");
    const j = await r.json();
    if (!j.ok) {
      throw new Error(j.error || "task queue unavailable");
    }
    const queued = Array.isArray(j.queued) ? j.queued : [];
    const waiting = Array.isArray(j.waiting) ? j.waiting : [];
    const inProgress = Array.isArray(j.inProgress) ? j.inProgress : [];
    const done = Array.isArray(j.done) ? j.done : [];
    const failed = Array.isArray(j.failed) ? j.failed : [];
    const repairMonitor = j.repairMonitor && typeof j.repairMonitor === "object" ? j.repairMonitor : {};
    latestTaskSnapshot = { queued, waiting, inProgress, done, failed, repairMonitor };
    window.dispatchEvent(new CustomEvent("observer:task-snapshot", {
      detail: {
        ...latestTaskSnapshot,
        source: "loadTaskQueue",
        at: Date.now()
      }
    }));
    syncInProgressTaskUpdates(inProgress);
    renderTaskList(taskQueueQueuedEl, queued);
    renderWaitingQuestionsPanel(waiting);
    syncQuestionTimeAfterQueueLoad(waiting);
    renderTaskList(taskQueueInProgressEl, inProgress);
    renderTaskList(taskQueueDoneEl, done.slice(0, 10));
    renderTaskList(taskQueueFailedEl, failed.slice(0, 10));
    renderRepairMonitor(repairMonitor);
    if (taskQueueQueuedCountEl) taskQueueQueuedCountEl.textContent = String(queued.length);
    if (novaQuestionsCountEl) novaQuestionsCountEl.textContent = String(waiting.length);
    if (taskQueueInProgressCountEl) taskQueueInProgressCountEl.textContent = String(inProgress.length);
    if (taskQueueDoneCountEl) taskQueueDoneCountEl.textContent = String(done.length);
    if (taskQueueFailedCountEl) taskQueueFailedCountEl.textContent = String(failed.length);
    if (questionTimeBtn) questionTimeBtn.disabled = waiting.length === 0;
    activateQueueSubtab(activeQueueSubtabId || "taskQueueQueuedPanel");
    updateQueueSummaryText();
    await loadTaskReshapeIssues();
    loadTaskFiles({ preserveSelection: true });
    observerApp.refreshStateBrowserPlugin?.({ preserveSelection: true, source: "task-queue" });
  } catch (error) {
    queueSummaryEl.textContent = `Queue load failed: ${error.message}`;
    taskQueueQueuedEl.innerHTML = `<div class="panel-subtle">Queue load failed.</div>`;
    renderWaitingQuestionsPanel([], { errorMessage: "Question load failed." });
    taskQueueInProgressEl.innerHTML = `<div class="panel-subtle">Queue load failed.</div>`;
    taskQueueDoneEl.innerHTML = `<div class="panel-subtle">Queue load failed.</div>`;
    taskQueueFailedEl.innerHTML = `<div class="panel-subtle">Queue load failed.</div>`;
    if (taskRepairActiveEl) taskRepairActiveEl.innerHTML = `<div class="panel-subtle">Repair load failed.</div>`;
    if (taskRepairReviewsEl) taskRepairReviewsEl.innerHTML = `<div class="panel-subtle">Repair load failed.</div>`;
    if (taskRepairRecentEl) taskRepairRecentEl.innerHTML = `<div class="panel-subtle">Repair load failed.</div>`;
    if (taskQueueQueuedCountEl) taskQueueQueuedCountEl.textContent = "0";
    if (novaQuestionsCountEl) novaQuestionsCountEl.textContent = "0";
    if (taskQueueInProgressCountEl) taskQueueInProgressCountEl.textContent = "0";
    if (taskQueueDoneCountEl) taskQueueDoneCountEl.textContent = "0";
    if (taskQueueFailedCountEl) taskQueueFailedCountEl.textContent = "0";
    if (taskQueueRepairsCountEl) taskQueueRepairsCountEl.textContent = "0";
    if (questionTimeBtn) questionTimeBtn.disabled = true;
    if (taskRepairMonitorSummaryEl) taskRepairMonitorSummaryEl.textContent = `Repair monitor load failed: ${error.message}`;
    if (taskReshapeIssuesSummaryEl) taskReshapeIssuesSummaryEl.textContent = "Recurring issue summary unavailable.";
    if (taskReshapeIssuesListEl) taskReshapeIssuesListEl.innerHTML = `<div class="panel-subtle">Recurring issue load failed.</div>`;
    if (taskQueueIssuesCountEl) taskQueueIssuesCountEl.textContent = "0";
    taskFilesListEl.innerHTML = `<div class="panel-subtle">Task file load failed.</div>`;
    taskFileContentEl.textContent = `Failed to load task files: ${error.message}`;
  }
}

function replayWaitingQuestionThroughAvatar() {
  const waiting = Array.isArray(latestTaskSnapshot?.waiting) ? latestTaskSnapshot.waiting : [];
  const activeTaskId = String(activeQuestionTimeTaskId || "").trim();
  const activeWaitingTaskId = String(activeWaitingQuestionTaskId || "").trim();
  const task = (activeTaskId
    ? waiting.find((entry) => String(entry?.id || "").trim() === activeTaskId)
    : null)
    || (activeWaitingTaskId
      ? waiting.find((entry) => String(entry?.id || "").trim() === activeWaitingTaskId)
    : null) || waiting[0];
  if (!task) {
    setQuestionTimeActive(false);
    activeWaitingQuestionTaskId = "";
    hintEl.textContent = "There is no active waiting question to replay.";
    return false;
  }
  if (typeof window.clearPendingVoiceQuestionInvite === "function") {
    window.clearPendingVoiceQuestionInvite({ preserveStatus: true });
  }
  const narration = buildTaskNarration(task);
  activeWaitingQuestionTaskId = String(task.id || "").trim();
  if (typeof setQuestionTimeActive === "function") {
    setQuestionTimeActive(true);
  }
  if (typeof setActiveQuestionTimeTaskId === "function") {
    setActiveQuestionTimeTaskId(task.id || "");
  }
  enqueueUpdate({
    source: "task",
    title: narration.title || "Question waiting",
    displayText: narration.displayText,
    spokenText: narration.spokenText,
    status: task.status || "",
    brainLabel: task.requestedBrainLabel || task.requestedBrainId || "",
    model: task.model || "",
    questionTime: true,
    onComplete: () => {
      if (typeof window.requestImmediateVoiceQuestionCapture === "function") {
        window.requestImmediateVoiceQuestionCapture(task);
      }
    }
  }, { priority: true });
  activateTab("novaTab");
  activateNovaSubtab("novaQuestionsPanel");
  hintEl.textContent = "Replaying the active question through the avatar.";
  return true;
}

function buildVoiceQuestionInvitation(task = {}) {
  const taskRef = String(task.codename || formatEntityRef("task", task.id || "unknown")).trim();
  const botName = getBotName();
  const variants = [
    `I have a question about ${taskRef}. Do you have a moment? Say yes ${botName} and I'll ask it.`,
    `Quick check in. I have a question waiting for ${taskRef}. If now works, say yes ${botName}.`,
    `I need your direction on ${taskRef}. Say yes ${botName} when you have a moment and I'll start question time.`,
    `I have a follow up question. If you're ready, say yes ${botName} and I'll ask it.`
  ];
  const seed = hashId([
    task.id || "",
    task.updatedAt || task.createdAt || 0,
    task.questionForUser || ""
  ].join(":"));
  return annotateNovaEmotion(variants[seed % variants.length], "shrug");
}

function queueVoiceQuestionInvitation(task = {}) {
  if (!task?.id || String(task.status || "") !== "waiting_for_user") {
    return false;
  }
  if (!voiceListeningEnabled || !speechRecognitionSupported) {
    return false;
  }
  const taskId = String(task.id || "").trim();
  if (!taskId) {
    return false;
  }
  if (
    String(pendingVoiceQuestionInviteTaskId || "").trim() === taskId
    || String(pendingVoiceQuestionTaskId || "").trim() === taskId
  ) {
    return true;
  }
  const narration = buildTaskNarration(task);
  enqueueUpdate({
    source: "task",
    title: "Question waiting",
    displayText: narration.displayText,
    spokenText: buildVoiceQuestionInvitation(task),
    status: task.status || "",
    brainLabel: task.requestedBrainLabel || task.requestedBrainId || "",
    model: task.model || "",
    onComplete: () => {
      if (typeof window.armPendingVoiceQuestionInvite === "function") {
        window.armPendingVoiceQuestionInvite(task);
      }
    }
  }, { priority: true });
  hintEl.textContent = "Nova is waiting for a spoken yes before starting question time.";
  return true;
}

async function loadRegressionSuites() {
  if (!regressionSuiteListEl || !regressionResultsEl) {
    return;
  }
  regressionHintEl.textContent = "Loading regression suites...";
  try {
    const r = await fetch("/api/regressions/list");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load regression suites");
    }
    observerApp.regressionSuites = Array.isArray(j.suites) ? j.suites : [];
    observerApp.latestRegressionReport = j.latest || null;
    observerApp.activeRegressionRun = j.activeRun || null;
    renderRegressionSuiteList(regressionSuiteListEl, observerApp.regressionSuites, observerApp.activeRegressionRun);
    renderRegressionResults(regressionResultsEl, observerApp.latestRegressionReport);
    refreshRegressionCommandUi();
    regressionSuiteListEl.querySelectorAll("[data-run-regression-suite]").forEach((button) => {
      button.onclick = async () => {
        await runRegressionSuites(button.dataset.runRegressionSuite);
      };
    });
    runAllRegressionsBtn.disabled = Boolean(observerApp.activeRegressionRun);
    regressionHintEl.textContent = observerApp.activeRegressionRun
      ? `Regression run in progress since ${formatDateTime(observerApp.activeRegressionRun.startedAt)}.`
      : "Regression suites are ready.";
  } catch (error) {
    regressionHintEl.textContent = `Regression suite load failed: ${error.message}`;
    renderRegressionSuiteList(regressionSuiteListEl, [], null);
    renderRegressionResults(regressionResultsEl, null);
    refreshRegressionCommandUi();
  }
}

async function runRegressionSuites(suiteId = "all") {
  if (!regressionSuiteListEl || !regressionResultsEl) {
    return null;
  }
  const suiteLabel = suiteId === "all" ? "all suites" : `suite ${suiteId}`;
  regressionHintEl.textContent = `Running ${suiteLabel}...`;
  observerApp.activeRegressionRun = {
    suiteId,
    startedAt: Date.now()
  };
  renderRegressionSuiteList(regressionSuiteListEl, observerApp.regressionSuites || [], observerApp.activeRegressionRun);
  runAllRegressionsBtn.disabled = true;
  try {
    const r = await pluginAdminFetch("/api/regressions/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suiteId })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to run regressions");
    }
    observerApp.latestRegressionReport = j.report || null;
    observerApp.activeRegressionRun = j.activeRun || null;
    renderRegressionResults(regressionResultsEl, observerApp.latestRegressionReport);
    regressionHintEl.textContent = j.report?.passed
      ? "Regression run passed."
      : (j.report?.failedSuites
        ? `${j.report.failedSuites} suite failed in the latest regression run.`
        : "Regression run completed.");
    return j.report || null;
  } catch (error) {
    regressionHintEl.textContent = `Regression run failed: ${error.message}`;
    throw error;
  } finally {
    observerApp.activeRegressionRun = null;
    renderRegressionSuiteList(regressionSuiteListEl, observerApp.regressionSuites || [], observerApp.activeRegressionRun);
    regressionSuiteListEl.querySelectorAll("[data-run-regression-suite]").forEach((button) => {
      button.onclick = async () => {
        await runRegressionSuites(button.dataset.runRegressionSuite);
      };
    });
    runAllRegressionsBtn.disabled = false;
  }
}

async function enqueueTaskFromPrompt({ message, sessionId, brain, attachments, requestedBrainId, plannedTasks = [], sourceIdentity = null }) {
  const r = await pluginAdminFetch("/api/tasks/enqueue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      sessionId,
      requestedBrainId: requestedBrainId || "worker",
      intakeBrainId: brain?.id || "bitnet",
      intakeReviewed: true,
      internetEnabled: true,
      forceToolUse: forceToolUseEl.checked,
      requireWorkerPreflight: requireWorkerPreflightEl.checked,
      attachments,
      plannedTasks,
      sourceIdentity
    })
  });
  const j = await r.json();
  if (!r.ok || !j.ok) {
    throw new Error(j.error || "failed to enqueue task");
  }
  return j.task;
}

async function triagePrompt({ message, brain, sourceIdentity = null }) {
  const r = await pluginAdminFetch("/api/tasks/triage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      intakeBrainId: brain?.id || "bitnet",
      internetEnabled: true,
      forceToolUse: forceToolUseEl.checked,
      sessionId: document.getElementById("sessionId")?.value || "Main",
      sourceIdentity
    })
  });
  const j = await r.json();
  if (!r.ok || !j.ok) {
    throw new Error(j.error || "failed to triage task");
  }
  return j.triage;
}

function triagePromptLocally({ message, brain }) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const asksForSummary = /\b(summarize|summary|overview|report|inventory|list all|each project|all projects|across)\b/.test(lower);
  const asksForPlanning = /\b(plan|compare|analyse|analyze|diagnose|investigate|research|design|strategy)\b/.test(lower);
  const asksForWeb = /\b(web|website|url|http|search|latest|news|current|online|internet|fetch)\b/.test(lower);
  const asksForFiles = /\b(file|folder|repo|repository|workspace|mount|directory|read|inspect|open|look at)\b/.test(lower);
  const multiStep = /\b(and|then|also|after that|plus)\b/.test(lower) || (text.match(/[?]/g) || []).length > 1;
  const asksForCode = /\b(code|refactor|debug|fix|implement|write a script|write code|function|component|class|patch|unit test|run tests?)\b/.test(lower);

  let complexity = 0;
  if (wordCount > 10) complexity += 1;
  if (wordCount > 22) complexity += 1;
  if (wordCount > 38) complexity += 1;
  if (asksForFiles) complexity += 1;
  if (asksForSummary) complexity += 2;
  if (asksForPlanning) complexity += 2;
  if (asksForWeb) complexity += 2;
  if (multiStep) complexity += 2;

  if (asksForCode) {
    return { predictedMode: "queue", ack: "Let me get back to you on that one.", complexity };
  }
  if (brain?.id === "fast" && complexity >= 5) {
    return { predictedMode: "queue", ack: "Let me get back to you on that one.", complexity };
  }
  return { predictedMode: "direct", ack: "", complexity };
}

async function dispatchNextTask() {
  if (queueDispatchInFlight || runInFlight) {
    return;
  }
  queueDispatchInFlight = true;
  dispatchNextBtn.disabled = true;
  try {
    const r = await pluginAdminFetch("/api/tasks/dispatch-next", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const j = await r.json();
    if (!j.ok && !j.dispatched) {
      throw new Error(j.error || "dispatch failed");
    }
    await loadTaskQueue();
  } finally {
    queueDispatchInFlight = false;
    dispatchNextBtn.disabled = false;
  }
}

async function readFileAsBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function installUploadedPluginPackage() {
  if (!pluginUploadInputEl || !installPluginUploadBtn || !pluginUploadStatusEl || !pluginUploadResultEl) {
    return;
  }
  const file = Array.from(pluginUploadInputEl.files || [])[0] || null;
  if (!file) {
    pluginUploadStatusEl.textContent = "Choose a plugin package first.";
    return;
  }
  installPluginUploadBtn.disabled = true;
  pluginUploadStatusEl.textContent = `Uploading ${file.name}...`;
  try {
    const autoRestart = pluginUploadAutoRestartEl?.checked === true;
    const attachment = {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: Number(file.size || 0),
      contentBase64: await readFileAsBase64(file)
    };
    const response = await pluginAdminFetch("/api/plugins/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attachment, autoRestart })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "failed to install plugin package");
    }
    const warningText = String(payload.warning || "").trim();
    pluginUploadStatusEl.textContent = String(
      warningText
        || payload.result?.message
        || "Plugin package installed. Restart Observer before enabling it."
    ).trim();
    pluginUploadResultEl.textContent = JSON.stringify(payload, null, 2);
    pluginUploadInputEl.value = "";
  } catch (error) {
    pluginUploadStatusEl.textContent = `Plugin install failed: ${error.message}`;
    pluginUploadResultEl.textContent = String(error?.message || error || "unknown error");
  } finally {
    installPluginUploadBtn.disabled = false;
  }
}

function stopPayloadSpeech() {
  const shouldResumeVoice = voicePausedForTts && voiceListeningEnabled;
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  activeUtterance = null;
  pendingUtteranceChunks = [];
  speechCompletionHandler = null;
  if (window.agentAvatar?.endSpeech) {
    window.agentAvatar.endSpeech();
  }
  if (shouldResumeVoice) {
    window.setTimeout(() => resumeVoiceListeningAfterTts(), 120);
  }
}

function chooseVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = refreshKnownVoices();
  const configuredPreferences = Array.isArray(runtimeOptions?.app?.voicePreferences)
    ? runtimeOptions.app.voicePreferences
    : [];

  for (const preferredName of configuredPreferences) {
    const exactMatch = voices.find((voice) => voice.name.toLowerCase() === preferredName.toLowerCase());
    if (exactMatch) {
      return exactMatch;
    }
    const partialMatch = voices.find((voice) => `${voice.name} ${voice.voiceURI}`.toLowerCase().includes(preferredName.toLowerCase()));
    if (partialMatch) {
      return partialMatch;
    }
  }

  return voices.find((voice) => /zira/i.test(`${voice.name} ${voice.voiceURI}`))
    || voices.find((voice) => /catherine/i.test(`${voice.name} ${voice.voiceURI}`))
    || voices.find((voice) => /aria|jenny|libby|natasha|sonia|hazel/i.test(voice.name))
    || voices.find((voice) => /female|woman/i.test(`${voice.name} ${voice.voiceURI}`))
    || voices.find((voice) => /en(-|_)?GB/i.test(voice.lang))
    || voices.find((voice) => /en(-|_)?AU/i.test(voice.lang))
    || voices.find((voice) => /en(-|_)?US/i.test(voice.lang))
    || voices.find((voice) => /english/i.test(`${voice.name} ${voice.lang}`))
    || voices[0]
    || null;
}

function splitIntoSpeechChunks(text, maxLen = 280) {
  if (text.length <= maxLen) return [text];
  const parts = text.split(/([.!?]+)\s+/);
  const sentences = [];
  for (let index = 0; index < parts.length; index += 2) {
    const sentence = ((parts[index] || "") + (parts[index + 1] || "")).trim();
    if (sentence) sentences.push(sentence);
  }
  if (!sentences.length) return [text];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= maxLen) {
      current += " " + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

function presentPayloadSpeech(rawText, options = {}) {
  const prepared = window.agentAvatar?.prepareResponseText
    ? window.agentAvatar.prepareResponseText(rawText)
    : {
        cleanText: window.agentAvatar?.stripTags ? window.agentAvatar.stripTags(rawText) : rawText,
        spokenText: window.agentAvatar?.stripTags ? window.agentAvatar.stripTags(rawText) : rawText,
        clipNames: []
      };
  const cleanText = String(prepared.spokenText || prepared.cleanText || "").trim();

  stopPayloadSpeech();

  const voiceCaptureActive = Boolean(voiceListeningEnabled && (voiceWakeActive || voiceFinalBuffer || voiceInterimBuffer));

  if (!cleanText) {
    window.agentAvatar?.applyResponseText?.(rawText);
    options.onComplete?.();
    return;
  }

  if (voiceCaptureActive && options.bypassVoiceCaptureBlock !== true) {
    window.agentAvatar?.applyResponseText?.(rawText);
    options.onComplete?.();
    return;
  }

  if (!("speechSynthesis" in window)) {
    window.agentAvatar?.applyResponseText?.(rawText);
    options.onComplete?.();
    return;
  }

  const completeSpeechAttempt = () => {
    const handler = speechCompletionHandler;
    speechCompletionHandler = null;
    handler?.();
    window.setTimeout(() => {
      showQueuedUpdate();
    }, 80);
  };

  // Split into sentence-sized chunks to avoid Chrome/Edge TTS cutoff on long responses
  const chunks = splitIntoSpeechChunks(cleanText);
  pendingUtteranceChunks = chunks.slice(1);
  let avatarStarted = false;

  const speakChunk = (chunkText, attempt = 0) => {
    const utterance = new SpeechSynthesisUtterance(chunkText);
    const voice = chooseVoice();
    let started = false;
    let retryTimer = null;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || "en-AU";
    } else {
      utterance.lang = "en-AU";
    }
    utterance.rate = 1.16;
    utterance.pitch = 1;
    utterance.onstart = () => {
      started = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (!avatarStarted) {
        avatarStarted = true;
        if (options.bypassVoiceCaptureBlock !== true) {
          pauseVoiceListeningForTts();
        }
        options.onStart?.();
        window.agentAvatar?.beginSpeech?.(prepared.clipNames);
      }
    };
    utterance.onend = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (activeUtterance === utterance) {
        activeUtterance = null;
      }
      const next = pendingUtteranceChunks.shift();
      if (next !== undefined) {
        window.setTimeout(() => speakChunk(next), 50);
      } else {
        window.agentAvatar?.endSpeech?.();
        if (options.bypassVoiceCaptureBlock !== true) {
          resumeVoiceListeningAfterTts();
        }
        completeSpeechAttempt();
      }
    };
    utterance.onerror = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (activeUtterance === utterance) {
        activeUtterance = null;
      }
      if (!started && attempt < 1) {
        window.setTimeout(() => speakChunk(chunkText, attempt + 1), 180);
        return;
      }
      pendingUtteranceChunks = [];
      window.agentAvatar?.endSpeech?.();
      if (options.bypassVoiceCaptureBlock !== true) {
        resumeVoiceListeningAfterTts();
      }
      completeSpeechAttempt();
    };

    activeUtterance = utterance;

    try {
      window.speechSynthesis.resume();
    } catch {
      // ignore browser-specific failures
    }
    window.speechSynthesis.speak(utterance);

    retryTimer = window.setTimeout(() => {
      if (!started && activeUtterance === utterance && attempt < 1) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore browser-specific failures
        }
        activeUtterance = null;
        window.setTimeout(() => speakChunk(chunkText, attempt + 1), 180);
      }
    }, speechUnlocked ? 1200 : 1800);
  };

  speechCompletionHandler = typeof options.onComplete === "function" ? options.onComplete : null;
  window.setTimeout(() => speakChunk(chunks[0]), 50);
}

function speakAcknowledgement(text) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    renderPassivePayload("Acknowledged", text);
    presentPayloadSpeech(text, {
      onStart: () => {
        window.setTimeout(finish, 220);
      },
      onComplete: finish
    });
    window.setTimeout(finish, 500);
  });
}

function speakWakeAcknowledgement(text) {
  const message = String(text || "").trim();
  if (!message) {
    return;
  }
  renderPassivePayload("Acknowledged", message);
  presentPayloadSpeech(message, {
    bypassVoiceCaptureBlock: true
  });
}

function queueAcknowledgement(text) {
  let message = String(text || "").trim();
  if (message === "Iâ€™m working on it." || message === "I'm working on it.") {
    message = pickLanguageVariant("acknowledgements.directWorking", "Let me think for a minute.");
  }
  if (!message) {
    return;
  }
  renderPassivePayload("Acknowledged", message);
  presentPayloadSpeech(message, {});
}

function populateBrainOptions() {
  const brains = Array.isArray(runtimeOptions.brains) ? runtimeOptions.brains : [];
  if (cronBrainSelectEl) {
    cronBrainSelectEl.innerHTML = brains
      .filter((brain) => brain.cronCapable)
      .map((brain) => `<option value="${escapeHtml(brain.id)}">${escapeHtml(brain.label)}</option>`)
      .join("");
    if (!cronBrainSelectEl.value) {
      cronBrainSelectEl.value = "worker";
    }
  }
}

function getDefaultMountIds() {
  return Array.isArray(runtimeOptions.defaults?.mountIds) ? runtimeOptions.defaults.mountIds : [];
}

function getSelectedMountIds() {
  return getDefaultMountIds();
}

function saveAccessSettings() {
  const payload = {
    forceToolUse: forceToolUseEl.checked,
    queueHandoff: queueHandoffEl.checked,
    requireWorkerPreflight: requireWorkerPreflightEl.checked
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

function loadSavedAccessSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        forceToolUseEl.checked = true;
        queueHandoffEl.checked = true;
        requireWorkerPreflightEl.checked = false;
        return;
      }
    const parsed = JSON.parse(raw);
    forceToolUseEl.checked = parsed.forceToolUse !== false;
    queueHandoffEl.checked = parsed.queueHandoff !== false;
    requireWorkerPreflightEl.checked = parsed.requireWorkerPreflight === true;
  } catch {
    forceToolUseEl.checked = true;
    queueHandoffEl.checked = true;
    requireWorkerPreflightEl.checked = false;
  }
}

function updateAccessSummary() {
  const defaultMounts = (runtimeOptions.mounts || []).filter((mount) => getDefaultMountIds().includes(mount.id));
  const queueEnabled = queueHandoffEl.checked;
  const fixedAccessText = `Runs use ${runtimeOptions.networks?.internet || "internet network"} with the standard input, workspace, and output layout${defaultMounts.length ? ` and fixed access to: ${defaultMounts.map((mount) => mount.label).join(", ")}` : ""}.`;

  internetSummaryEl.textContent = "Enabled";
  internetSummaryEl.className = "summary-pill on";
  networkSummaryTextEl.textContent = fixedAccessText;

  profileSummaryEl.textContent = queueEnabled ? "Queued" : "Direct";
  profileSummaryTextEl.textContent = queueEnabled
    ? `${getBotName()} can browse the web and work within the standard input, workspace, and output layout before triage routes the request.`
    : `${getBotName()} can browse the web and work directly within the standard input, workspace, and output layout without queue handoff.`;

  resultAuditEl.textContent = [
    forceToolUseEl.checked ? "Tool-required mode is on." : "Tool-required mode is off.",
    requireWorkerPreflightEl.checked ? "Worker preflight is required for queued user tasks." : ""
  ].filter(Boolean).join(" ");
}

async function loadTree() {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  const scope = scopeSelect.value;
  updateStateScopeView();
  if (scope === "taskfiles") {
    return loadTaskFiles({ preserveSelection: true });
  }
  fileListEl.innerHTML = "Loading files...";
  fileContentEl.textContent = "Select a file to inspect.";
  selectedFileEl.value = "";
  activeFileKey = "";

  try {
    const r = await fetch(`/api/inspect/tree?scope=${encodeURIComponent(scope)}`);
    const j = await r.json();
    const entries = (j.entries || []).filter((entry) => String(entry.relativePath || "") !== ".");
    const files = entries.filter((entry) => entry.type === "file");

    if (!entries.length) {
      fileListEl.innerHTML = `<div class="panel-subtle">No files found in this scope.</div>`;
      return;
    }

    fileListEl.innerHTML = entries.map((entry) => {
      const rel = String(entry.relativePath || entry.path || "").trim();
      const isFile = entry.type === "file";
      return `<button class="file-item${isFile ? "" : " is-dir"}" data-file="${escapeHtml(rel)}" data-type="${escapeHtml(entry.type || "")}"${isFile ? "" : " disabled"}><span>${escapeHtml(rel)}</span><span class="file-type">${entry.type}</span></button>`;
    }).join("");

    fileListEl.querySelectorAll(".file-item").forEach((button) => {
      if (button.dataset.type !== "file") {
        return;
      }
      button.onclick = () => loadFile(button.dataset.file);
    });

    if (!files.length) {
      fileContentEl.textContent = "This scope currently contains directories but no readable files.";
    }
  } catch (error) {
    fileListEl.innerHTML = `<div class="panel-subtle">Failed to load files: ${escapeHtml(error.message)}</div>`;
  }
}

async function loadCronJobs() {
  cronListEl.textContent = "Loading scheduled jobs...";
  try {
    const r = await fetch("/api/cron/list");
    const j = await r.json();
    const jobs = Array.isArray(j.jobs) ? j.jobs : [];
    window.dispatchEvent(new CustomEvent("observer:cron-state", {
      detail: {
        jobs,
        at: Date.now(),
        source: "loadCronJobs"
      }
    }));
    if (!jobs.length) {
      cronListEl.textContent = "No scheduled jobs found.";
      return;
    }
    cronListEl.innerHTML = jobs.map((job) => {
      const everyText = job.schedule?.kind === "every"
        ? `Every ${formatDurationMs(job.schedule?.everyMs)}`
        : (job.schedule?.kind || "custom");
      const lastRun = formatDateTime(job.state?.lastRunAtMs);
      const lastStatus = job.state?.lastStatus || "idle";
      const nextRun = formatDateTime(job.state?.nextRunAtMs);
      const brain = job.agentId || "worker";
      const isEnabled = job.enabled !== false;
      const canToggle = Boolean(job.id);
      const canRemove = Boolean(job.id) && job.status !== "in_progress";
      return `
        <div class="cron-item">
          <div class="cron-head">
            <strong>${escapeHtml(job.name || "(unnamed job)")}</strong>
            <div class="cron-head-actions">
              <span class="summary-pill ${isEnabled ? "on" : "off"}">${isEnabled ? "Enabled" : "Disabled"}</span>
              ${canToggle ? `<button class="secondary" type="button" data-cron-toggle="${escapeAttr(job.id)}">${isEnabled ? "Disable" : "Enable"}</button>` : ""}
              ${canRemove ? `<button class="secondary" type="button" data-cron-remove="${escapeAttr(job.id)}">Remove</button>` : ""}
            </div>
          </div>
          <div class="cron-grid">
            <div class="cron-mini"><strong>Brain</strong>${escapeHtml(brain)}</div>
            <div class="cron-mini"><strong>Frequency</strong>${escapeHtml(everyText)}</div>
            <div class="cron-mini"><strong>Last Run</strong>${escapeHtml(lastRun)}</div>
            <div class="cron-mini"><strong>Status</strong>${escapeHtml(lastStatus)}</div>
          </div>
          <div class="micro">Next run: ${escapeHtml(nextRun)}</div>
          <div class="micro" style="margin-top: 6px;">${escapeHtml(job.message || "")}</div>
        </div>
      `;
    }).join("");
    cronListEl.querySelectorAll("[data-cron-toggle]").forEach((button) => {
      button.onclick = () => toggleCronJob(button.dataset.cronToggle);
    });
    cronListEl.querySelectorAll("[data-cron-remove]").forEach((button) => {
      button.onclick = () => removeCronJob(button.dataset.cronRemove);
    });
  } catch (error) {
    window.dispatchEvent(new CustomEvent("observer:cron-state", {
      detail: {
        jobs: [],
        at: Date.now(),
        source: "loadCronJobs",
        error: String(error?.message || error || "cron load failed")
      }
    }));
    cronListEl.textContent = `Failed to load scheduled jobs: ${error.message}`;
  }
}

async function toggleCronJob(seriesId) {
  cronHintEl.textContent = "Updating scheduled job...";
  try {
    const r = await fetch("/api/cron/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seriesId })
    });
    const j = await r.json();
    if (!j.ok) {
      throw new Error(j.error || "toggle failed");
    }
    cronHintEl.textContent = j.message || "Scheduled job updated.";
    await loadCronJobs();
  } catch (error) {
    cronHintEl.textContent = `Toggle failed: ${error.message}`;
  }
}

async function removeCronJob(seriesId) {
  cronHintEl.textContent = "Removing scheduled job...";
  try {
    const r = await fetch("/api/cron/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seriesId })
    });
    const j = await r.json();
    if (!j.ok) {
      throw new Error(j.error || "remove failed");
    }
    cronHintEl.textContent = j.message || "Scheduled job removed.";
    await loadCronJobs();
  } catch (error) {
    cronHintEl.textContent = `Remove failed: ${error.message}`;
  }
}

async function pollCronEvents() {
  try {
    const r = await fetch(`/api/cron/events?sinceTs=${encodeURIComponent(String(latestCronEventTs))}&limit=8`);
    const j = await r.json();
    const events = Array.isArray(j.events) ? j.events : [];
    if (!events.length) {
      return;
    }

    for (const event of events) {
      latestCronEventTs = Math.max(latestCronEventTs, Number(event.ts || 0));
      saveEventCursor(CRON_CURSOR_KEY, latestCronEventTs);
      const summary = formatCronObservation(event);
      const title = String(event.name || "").trim() || "Scheduled job update";
      enqueueUpdate({
        source: "cron",
        title,
        displayText: summary,
        spokenText: summary,
        status: event.status || "",
        model: event.model || ""
      });
    }
  } catch {
    // passive polling only
  }
}

function pickTaskPhrase(task, variants) {
  const seed = hashId([
    task.id || "",
    task.status || "",
    task.updatedAt || task.completedAt || task.createdAt || 0,
    task.heartbeatCount || 0
  ].join(":"));
  return variants[seed % variants.length];
}

function isRemoteParallelMode() {
  return Boolean(runtimeOptions?.queue?.remoteParallel);
}

function annotateNovaEmotion(text, emotion = "") {
  const raw = String(text || "").trim();
  const normalizedEmotion = String(emotion || "").trim().toLowerCase();
  if (!raw || !normalizedEmotion || /\[nova:(emotion|animation)=/i.test(raw)) {
    return raw;
  }
  return `[nova:emotion=${normalizedEmotion}] ${raw}`;
}

function isRepairManagementTask(task) {
  return String(task?.internalJobType || "").trim().toLowerCase() === "escalation_review";
}

function buildTaskNarration(task) {
  const taskRef = task.codename || formatEntityRef("task", task.id || "unknown");
  const brainLabel = task.requestedBrainLabel || task.requestedBrainId || "the agent";
  const resultSummary = buildConcreteTaskNarrationDetail(task);
  const progressNote = String(task.progressNote || "").trim();
  const noteText = String(task.notes || "").trim();
  const abortRequested = Boolean(task.abortRequestedAt);
  const plainQuestionTask = String(task?.status || "").trim().toLowerCase() === "waiting_for_user"
    && String(task?.internalJobType || "").trim().toLowerCase() === "question_maintenance"
    && Boolean(String(task?.questionForUser || "").trim());
  const repairManagementTask = isRepairManagementTask(task);

  if (task.status === "waiting_for_user") {
    const question = String(task.questionForUser || resultSummary || noteText || "I need a direction before I can continue.").trim();
    return {
      title: "Question waiting",
      displayText: plainQuestionTask ? question : `${taskRef} is waiting for your direction.\n\n${question}`,
      spokenText: annotateNovaEmotion(plainQuestionTask ? question : `${taskRef} is waiting for your direction. ${question}`, "shrug")
    };
  }

  if (repairManagementTask && task.status === "completed") {
    const detail = resultSummary || noteText || "I finished the repair review and recorded the next recovery step.";
    return {
      title: "Repair review",
      displayText: `${taskRef} finished a repair review.\n\n${detail}`,
      spokenText: annotateNovaEmotion(`${taskRef} finished a repair review. ${detail}`, "reflect")
    };
  }

  if (repairManagementTask && task.status === "failed") {
    const detail = resultSummary || noteText || "The repair review did not produce a safe next step.";
    return {
      title: "Repair review issue",
      displayText: `${taskRef} hit a problem during repair review.\n\n${detail}`,
      spokenText: annotateNovaEmotion(`${taskRef} hit a problem during repair review. ${detail}`, "reflect")
    };
  }

  if (task.status === "completed") {
    const opener = pickTaskPhrase(task, getLanguageVariants("taskNarration.completedOpeners", [
      `I've finished {{taskRef}}.`,
      `{{taskRef}} is done.`,
      `I wrapped up {{taskRef}}.`
    ], { taskRef }));
    return {
      title: "Task complete",
      displayText: resultSummary ? `${opener}\n\n${resultSummary}` : opener,
      spokenText: annotateNovaEmotion(resultSummary ? `${opener} ${resultSummary}` : opener, "celebrate")
    };
  }

  if (task.status === "failed") {
    const opener = pickTaskPhrase(task, getLanguageVariants("taskNarration.failedOpeners", [
      `I ran into a problem with {{taskRef}}.`,
      `{{taskRef}} hit an issue.`,
      `Something went wrong while I was working on {{taskRef}}.`
    ], { taskRef }));
    const detail = resultSummary || noteText || pickLanguageVariant("taskNarration.failedFallback", "I wasn't able to finish it cleanly.");
    return {
      title: "Task issue",
      displayText: `${opener}\n\n${detail}`,
      spokenText: annotateNovaEmotion(`${opener} ${detail}`, "angry")
    };
  }

  if (task.recovered) {
    const opener = pickTaskPhrase(task, getLanguageVariants("taskNarration.recoveredOpeners", [
      `I'm picking {{taskRef}} back up.`,
      `{{taskRef}} is back in motion.`,
      `I've recovered {{taskRef}} and I'm trying again.`
    ], { taskRef }));
    const detail = noteText || pickLanguageVariant("taskNarration.recoveredFallback", "It had stalled, so I restarted it.");
    return {
      title: "Task recovered",
      displayText: `${opener}\n\n${detail}`,
      spokenText: annotateNovaEmotion(`${opener} ${detail}`, "reflect")
    };
  }

  if (task.escalated || task.status === "escalated") {
    const opener = pickTaskPhrase(task, getLanguageVariants("taskNarration.escalatedOpeners", [
      `I'm taking {{taskRef}} into a deeper pass.`,
      `{{taskRef}} needs a closer look, so I'm digging further.`,
      `I'm giving {{taskRef}} a deeper pass now.`
    ], { taskRef }));
    const detail = pickLanguageVariant("taskNarration.escalatedDetail", "I'll follow up once I have the result.", { brainLabel });
    return {
      title: "Task escalated",
      displayText: `${opener}\n\n${detail}`,
      spokenText: annotateNovaEmotion(`${opener} ${detail}`, "scheme")
    };
  }

  if (abortRequested && task.status === "in_progress") {
    const opener = pickTaskPhrase(task, getLanguageVariants("taskNarration.canceledOpeners", [
      `I've dropped {{taskRef}}.`,
      `{{taskRef}} is stopping.`,
      `I pulled {{taskRef}} from the line.`
    ], { taskRef }));
    const detail = progressNote || noteText || pickLanguageVariant("taskNarration.canceledFallback", "Abort requested. Stopping active work.");
    return {
      title: "Stopping task",
      displayText: `${opener}\n\n${detail}`,
      spokenText: annotateNovaEmotion(`${opener} ${detail}`, "angry")
    };
  }

  if (task.status === "in_progress" || progressNote) {
    const opener = pickTaskPhrase(task, getLanguageVariants("taskNarration.inProgressOpeners", [
      `I'm working on {{taskRef}}, hang tight.`,
      `{{taskRef}} is in progress. Hang tight.`,
      `Still on {{taskRef}}. Give me a moment.`
    ], { taskRef }));
    const detail = /fast/i.test(brainLabel)
      ? pickLanguageVariant("taskNarration.inProgressFastDetail", "I am fast tracking this one.")
      : pickLanguageVariant("taskNarration.inProgressDefaultDetail", "This may take some time.");
    return {
      title: "Working on it",
      displayText: `${opener}\n\n${detail}`,
      spokenText: annotateNovaEmotion(`${opener} ${detail}`, "explain")
    };
  }

  const opener = pickTaskPhrase(task, getLanguageVariants("taskNarration.queuedOpeners", [
    `I've queued {{taskRef}}.`,
    `{{taskRef}} is lined up.`,
    `I've added {{taskRef}} to the queue.`
  ], { taskRef }));
  const detail = noteText || pickLanguageVariant("taskNarration.queuedFallback", "It will be handled by {{brainLabel}}.", { brainLabel });
  return {
    title: "Task queued",
    displayText: `${opener}\n\n${detail}`,
    spokenText: annotateNovaEmotion(`${opener} ${detail}`, "scheme")
  };
}

function reportTaskEvent(task, explicitTitle = "", options = {}) {
  if (isRemoteParallelMode() && task?.status === "in_progress") {
    return;
  }
  if (String(task?.internalJobType || "").trim().toLowerCase() === "opportunity_scan") {
    return;
  }
  if (!rememberTaskEvent(task)) {
    return;
  }
  if (task?.id && (task.status === "in_progress" || task.progressNote)) {
    const heartbeatTs = Number(task.lastHeartbeatAt || task.updatedAt || task.createdAt || 0);
    if (heartbeatTs > 0) {
      announcedTaskHeartbeatTs.set(task.id, heartbeatTs);
    }
  }
  latestTaskEventTs = Math.max(latestTaskEventTs, Number(task.updatedAt || task.createdAt || 0));
  saveEventCursor(TASK_CURSOR_KEY, latestTaskEventTs);
  if (questionTimeActive && task?.status === "waiting_for_user") {
    return;
  }
  if (task.status === "waiting_for_user" && queueVoiceQuestionInvitation(task)) {
    return;
  }
  const narration = buildTaskNarration(task);
  const title = explicitTitle || narration.title;
  enqueueUpdate({
    source: "task",
    title,
    displayText: narration.displayText,
    spokenText: narration.spokenText,
    status: task.status || "",
    brainLabel: task.requestedBrainLabel || task.requestedBrainId || "",
    model: task.model || ""
  }, options);
  if (task.status === "waiting_for_user" && typeof window.maybeStartVoiceQuestionWindow === "function") {
    window.maybeStartVoiceQuestionWindow(task);
  }
}

function syncInProgressTaskUpdates(tasks) {
  if (isRemoteParallelMode()) {
    return;
  }
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task?.id) {
      continue;
    }
    const heartbeatTs = Number(task.lastHeartbeatAt || task.updatedAt || task.createdAt || 0);
    const lastAnnouncedTs = Number(announcedTaskHeartbeatTs.get(task.id) || 0);
    if (heartbeatTs > lastAnnouncedTs) {
      reportTaskEvent(task);
    }
  }
}

async function pollTaskEvents() {
  try {
    const r = await fetch(`/api/tasks/events?sinceTs=${encodeURIComponent(String(latestTaskEventTs))}&limit=12`);
    const j = await r.json();
    const tasks = Array.isArray(j.tasks) ? j.tasks : [];
    if (!tasks.length) {
      return;
    }
    for (const task of tasks) {
      if (isRemoteParallelMode() && task.status === "in_progress") {
        continue;
      }
      if (task.status === "completed" || task.status === "failed" || task.status === "in_progress" || task.status === "waiting_for_user") {
        reportTaskEvent(task);
      }
    }
    loadTaskQueue();
  } catch {
    // passive polling only
  }
}

async function loadFile(file) {
  if (!hasCoreStateBrowserUi()) {
    return;
  }
  const scope = scopeSelect.value;
  activeFileKey = file;
  selectedFileEl.value = file;
  fileContentEl.textContent = "Loading file...";
  fileListEl.querySelectorAll(".file-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.file === file);
  });

  try {
    const r = await fetch(`/api/inspect/file?scope=${encodeURIComponent(scope)}&file=${encodeURIComponent(file)}`);
    const j = await r.json();
    fileContentEl.textContent = j.content || "(empty file)";
  } catch (error) {
    fileContentEl.textContent = `Failed to load file: ${error.message}`;
  }
}

async function refreshStatus() {
  try {
    const r = await fetch("/api/runtime/status");
    const j = await r.json();

    const gatewayTone = j.gateway?.running ? "tone-ok" : "tone-bad";
    const ollamaTone = j.ollama?.running ? "tone-ok" : "tone-warn";
    const qdrantTone = !j.qdrant?.enabled
      ? "tone-warn"
      : j.qdrant?.running
        ? (j.qdrant?.collectionReady === false ? "tone-warn" : "tone-ok")
        : "tone-bad";
    const gpu = formatGpuStatus(j.gpu);

    setStatus(gatewayStatusEl, j.gateway?.running ? `Running (${j.gateway.status})` : `Down (${j.gateway?.status || "missing"})`, gatewayTone);
    setStatus(ollamaStatusEl, j.ollama?.running ? `Running (${j.ollama.status})` : `Down (${j.ollama?.status || "missing"})`, ollamaTone);
    setStatus(
      qdrantStatusEl,
      !j.qdrant?.enabled
        ? "Not configured"
        : j.qdrant?.running
          ? (j.qdrant?.collectionReady === false
            ? `Online (${j.qdrant?.collectionCount || 0} collections)`
            : `Ready (${j.qdrant?.collectionName || "observer_chunks"})`)
          : `Down (${j.qdrant?.status || "missing"})`,
      qdrantTone
    );
    if (qdrantDetailsEl) {
      qdrantDetailsEl.textContent = renderQdrantDetails(j.qdrant);
    }
    setStatus(gpuStatusEl, gpu.text, gpu.tone);
    checkedAtEl.textContent = formatTime(j.checkedAt);
    const remoteEndpoints = Array.isArray(j.ollamaEndpoints)
      ? j.ollamaEndpoints.filter((entry) => String(entry.baseUrl || "") !== "http://127.0.0.1:11434")
      : [];
    if (!remoteEndpoints.length) {
      remoteBrainStatusEl.innerHTML = `<div class="panel-subtle">No remote endpoints configured.</div>`;
    } else {
      remoteBrainStatusEl.innerHTML = remoteEndpoints.map((entry) => {
        const ok = entry.running === true;
        const statusClass = ok ? "tone-ok" : "tone-bad";
        const endpointLabel = String(entry.baseUrl || "remote endpoint").replace(/^https?:\/\//i, "");
        const statusText = ok
          ? `Online (${entry.status || 200})`
          : `Offline${entry.error ? ` (${escapeHtml(entry.error)})` : ""}`;
        const brainIds = Array.isArray(entry.brainIds) ? entry.brainIds : [];
        return `
          <article class="card remote-status-card">
            <div class="metric-label">${escapeHtml(endpointLabel)}</div>
            <div class="metric-value ${statusClass}">${statusText}</div>
            <div class="micro">Models: ${escapeHtml(String(entry.modelCount || 0))}</div>
            <div class="micro">Brains: ${escapeHtml(brainIds.join(", ") || "none")}</div>
          </article>
        `;
      }).join("");
    }
    const brainActivity = Array.isArray(j.brainActivity) ? j.brainActivity : [];
    lastBrainActivity = brainActivity;
    window.dispatchEvent(new CustomEvent("observer:brain-activity", {
      detail: {
        brainActivity,
        source: "refreshStatus",
        at: Date.now()
      }
    }));
    if (!brainActivity.length) {
      brainLoadStatusEl.innerHTML = `<div class="panel-subtle">No brain activity available.</div>`;
    } else {
      const laneGroups = new Map();
      brainActivity.forEach((entry) => {
        const lane = String(entry.queueLane || "").trim();
        if (!lane) return;
        if (!laneGroups.has(lane)) {
          laneGroups.set(lane, []);
        }
        laneGroups.get(lane).push(entry);
      });
      brainLoadStatusEl.innerHTML = brainActivity.map((entry) => {
        const active = entry.active === true;
        const healthy = entry.endpointHealthy !== false;
        const tone = !healthy ? "tone-bad" : active ? "tone-warn" : "tone-ok";
        const state = !healthy ? "Offline" : active ? "Busy" : "Idle";
        const lane = String(entry.queueLane || "").trim();
        const sameLanePeers = lane
          ? (laneGroups.get(lane) || []).filter((peer) => String(peer.id || "") !== String(entry.id || ""))
          : [];
        const activePeer = sameLanePeers.find((peer) => peer.active === true) || null;
        const queueBits = [
          Number(entry.queuedCount || 0) ? `${entry.queuedCount} queued` : "",
          Number(entry.waitingCount || 0) ? `${entry.waitingCount} waiting` : "",
          Number(entry.inProgressCount || 0) ? `${entry.inProgressCount} active` : "",
          Number(entry.failedCount || 0) ? `${entry.failedCount} failed` : ""
        ].filter(Boolean).join(" | ") || "No assigned work";
        const idleText = Number(entry.idleForMs || 0) ? `${formatDurationMs(entry.idleForMs)} idle` : "No recent activity";
        const laneLabel = lane || "-";
        const laneSharingText = !lane || !sameLanePeers.length
          ? "Dedicated lane"
          : `Shared lane with ${sameLanePeers.length} other brain${sameLanePeers.length === 1 ? "" : "s"}`;
        const laneStatusText = !lane
          ? "No queue lane assigned"
          : active
            ? "This lane is currently executing here."
            : activePeer
              ? `Lane busy on ${String(activePeer.label || activePeer.id || "another brain")}.`
              : "Lane currently free to dispatch.";
        return `
          <article class="card brain-load-card">
            <div class="metric-label">${escapeHtml(String(entry.label || entry.id || "brain"))}</div>
            <div class="metric-value ${tone}">${escapeHtml(state)}</div>
            <div class="micro">${escapeHtml(String(entry.model || ""))}</div>
            <div class="micro">Lane: ${escapeHtml(laneLabel)}</div>
            <div class="micro">${escapeHtml(laneSharingText)}</div>
            <div class="micro">${escapeHtml(queueBits)}</div>
            <div class="micro lane-status-line">${escapeHtml(laneStatusText)}</div>
            <div class="micro">${escapeHtml(idleText)}</div>
          </article>
        `;
      }).join("");
    }
    updateRemotePlannerHealthIndicator(brainActivity);
    updateRunButtonState();
  } catch (error) {
    setStatus(gatewayStatusEl, "Status check failed", "tone-bad");
    setStatus(ollamaStatusEl, "Status check failed", "tone-bad");
    setStatus(qdrantStatusEl, "Status check failed", "tone-bad");
    if (qdrantDetailsEl) {
      qdrantDetailsEl.textContent = "Retrieval details unavailable.";
    }
    setStatus(gpuStatusEl, "Status check failed", "tone-bad");
    checkedAtEl.textContent = "Error";
    remoteBrainStatusEl.innerHTML = `<div class="panel-subtle">Remote status check failed: ${escapeHtml(error.message)}</div>`;
    brainLoadStatusEl.innerHTML = `<div class="panel-subtle">Brain activity check failed: ${escapeHtml(error.message)}</div>`;
    updateRunButtonState();
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const DEFAULT_AVATAR_REACTION_CATALOG = [
  { emotion: "idle", clip: "Charged_Ground_Slam", label: "Idle" },
  { emotion: "calm", clip: "Cheer_with_Both_Hands_Up", label: "Calm idle" },
  { emotion: "agree", clip: "Talk_with_Left_Hand_Raised", label: "Agree" },
  { emotion: "angry", clip: "Head_Hold_in_Pain", label: "Angry stomp" },
  { emotion: "love", clip: "Agree_Gesture", label: "Big heart" },
  { emotion: "celebrate", clip: "Angry_Stomp", label: "Celebrate" },
  { emotion: "confused", clip: "Walking", label: "Confused" },
  { emotion: "dance", clip: "Idle_3", label: "Dance" },
  { emotion: "sass", clip: "Big_Heart_Gesture", label: "Hand on hip" },
  { emotion: "hurt", clip: "Scheming_Hand_Rub", label: "Hurt" },
  { emotion: "reflect", clip: "Idle_6", label: "Reflect" },
  { emotion: "run", clip: "Shrug", label: "Run" },
  { emotion: "scheme", clip: "Wave_One_Hand", label: "Scheme" },
  { emotion: "shrug", clip: "Confused_Scratch", label: "Shrug" },
  { emotion: "rant", clip: "Stand_Talking_Angry", label: "Angry talk" },
  { emotion: "passionate", clip: "Mirror_Viewing", label: "Passionate talk" },
  { emotion: "explain", clip: "FunnyDancing_01", label: "Explain" },
  { emotion: "walk", clip: "Hand_on_Hip_Gesture", label: "Walk" },
  { emotion: "wave", clip: "Talk_Passionately", label: "Wave" },
  { emotion: "slam", clip: "Running", label: "Ground slam" }
];

const DEFAULT_AVATAR_TALKING_CLIPS = [
  "Mirror_Viewing",
  "Talk_with_Left_Hand_Raised",
  "FunnyDancing_01"
];

function ensureReactionPathDraft(appConfig) {
  if (!appConfig || typeof appConfig !== "object") {
    return {};
  }
  if (!appConfig.reactionPathsByModel || typeof appConfig.reactionPathsByModel !== "object") {
    appConfig.reactionPathsByModel = {};
  }
  return appConfig.reactionPathsByModel;
}

function getReactionProfileDraft(appConfig, modelPath) {
  const key = String(modelPath || "").trim();
  const store = ensureReactionPathDraft(appConfig);
  const existing = store[key];
  if (existing && typeof existing === "object") {
    if (!existing.paths || typeof existing.paths !== "object") {
      existing.paths = {};
    }
    if (!Array.isArray(existing.talkingClips)) {
      existing.talkingClips = [];
    }
    const normalizedIdle = String(existing.paths.idle || existing.idleClip || "").trim();
    if (normalizedIdle) {
      existing.idleClip = normalizedIdle;
      existing.paths.idle = normalizedIdle;
    }
    return existing;
  }
  const defaults = Object.fromEntries(DEFAULT_AVATAR_REACTION_CATALOG.map((entry) => [entry.emotion, entry.clip]));
  const profile = {
    idleClip: defaults.idle || DEFAULT_AVATAR_REACTION_CATALOG[0].clip,
    talkingClips: [...DEFAULT_AVATAR_TALKING_CLIPS],
    paths: defaults
  };
  if (key) {
    store[key] = profile;
  }
  return profile;
}

function formatReactionPathsForTextarea(paths = {}) {
  const mapped = paths && typeof paths === "object" ? paths : {};
  const lines = DEFAULT_AVATAR_REACTION_CATALOG.map((entry) => {
    const clip = String(mapped?.[entry.emotion] || entry.clip).trim();
    return `${entry.emotion}=${clip}`;
  });
  const known = new Set(DEFAULT_AVATAR_REACTION_CATALOG.map((entry) => entry.emotion));
  Object.entries(mapped)
    .map(([emotion, clip]) => [String(emotion || "").trim().toLowerCase(), String(clip || "").trim()])
    .filter(([emotion, clip]) => emotion && clip && !known.has(emotion))
    .sort((left, right) => left[0].localeCompare(right[0]))
    .forEach(([emotion, clip]) => lines.push(`${emotion}=${clip}`));
  return lines.join("\n");
}

function parseReactionPathsTextarea(value) {
  const entries = {};
  String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        return;
      }
      const emotion = line.slice(0, separatorIndex).trim().toLowerCase();
      const clip = line.slice(separatorIndex + 1).trim();
      if (emotion && clip) {
        entries[emotion] = clip;
      }
    });
  return entries;
}

function applyAppConfigToStage(appConfig = {}) {
  const botName = String(appConfig?.botName || "Agent").trim() || "Agent";
  const avatarModelPath = String(appConfig?.avatarModelPath || "/assets/characters/Nova.glb").trim() || "/assets/characters/Nova.glb";
  const backgroundImagePath = String(appConfig?.backgroundImagePath || "").trim();
  const stylizationFilterPreset = String(appConfig?.stylizationFilterPreset || appConfig?.stylizationPreset || "none").trim().toLowerCase();
  const stylizationFilters = {
    none: "",
    soft: "contrast(0.94) saturate(0.9) brightness(1.03) blur(0.2px)",
    cinematic: "contrast(1.08) saturate(0.86) sepia(0.08) brightness(0.98)",
    noir: "grayscale(0.96) contrast(1.12) brightness(0.96)",
    vivid: "saturate(1.22) contrast(1.05) brightness(1.02)",
    toon: "contrast(1.06) saturate(1.04)",
    dream: "saturate(1.12) brightness(1.06) contrast(0.94)",
    retro_vhs: "sepia(0.22) saturate(0.72) contrast(1.08) brightness(0.96) hue-rotate(-14deg)",
    haunted: "saturate(0.62) contrast(1.16) brightness(0.92) hue-rotate(24deg)",
    surveillance: "grayscale(0.7) contrast(1.24) brightness(0.88) sepia(0.18) hue-rotate(36deg)",
    crystal: "saturate(1.35) contrast(1.14) brightness(1.05) hue-rotate(-18deg)",
    whimsical: "saturate(0.58) contrast(0.72) brightness(1.16) sepia(0.28) hue-rotate(-18deg) blur(0.45px)"
  };
  document.title = botName;
  appTitleEl.textContent = botName;
  avatarCanvasEl.dataset.modelPath = avatarModelPath;
  avatarCanvasEl.dataset.skyboxPath = backgroundImagePath;
  avatarCanvasEl.style.filter = stylizationFilters[stylizationFilterPreset] || "";
}

function renderNovaConfigEditor() {
  if (!novaIdentitySettingsListEl || !novaTrustSettingsListEl) {
    return;
  }
  if (!novaConfigDraft?.app) {
    const unavailable = `<div class="panel-subtle">Nova settings are unavailable.</div>`;
    novaIdentitySettingsListEl.innerHTML = unavailable;
    novaTrustSettingsListEl.innerHTML = unavailable;
    return;
  }
  const app = novaConfigDraft.app;
  const assets = novaConfigDraft.assets && typeof novaConfigDraft.assets === "object" ? novaConfigDraft.assets : {};
  const modelOptions = Array.isArray(assets.characters) ? assets.characters : [];
  const selectedModelPath = String(app.avatarModelPath || "").trim();
  const reactionProfile = getReactionProfileDraft(app, selectedModelPath);
  const trust = app.trust && typeof app.trust === "object"
    ? app.trust
    : { emailCommandMinLevel: "trusted", voiceCommandMinLevel: "trusted", records: [], emailSources: [], voiceProfiles: [] };
  const trustRecords = Array.isArray(trust.records) ? trust.records : [];
  const renderAssetOptions = (options, selectedValue, emptyLabel = "") => {
    const normalizedOptions = options.map((value) => String(value || "").trim()).filter(Boolean);
    const withSelected = selectedValue && !normalizedOptions.includes(selectedValue)
      ? [selectedValue, ...normalizedOptions]
      : normalizedOptions;
    const rendered = [];
    if (emptyLabel) {
      rendered.push(`<option value="">${escapeHtml(emptyLabel)}</option>`);
    }
    rendered.push(...withSelected.map((value) => (
      `<option value="${escapeAttr(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(value.replace(/^\/assets\//, ""))}</option>`
    )));
    return rendered.join("");
  };
  const renderTrustLevelOptions = (selectedValue = "unknown") => {
    const normalized = normalizeTrustLevel(selectedValue, "unknown");
    return ["unknown", "known", "trusted"].map((level) => (
      `<option value="${escapeAttr(level)}" ${level === normalized ? "selected" : ""}>${escapeHtml(trustLevelLabel(level))}</option>`
    )).join("");
  };
  const renderCommandThresholdOptions = (selectedValue = "trusted") => {
    return `<option value="trusted" selected>${escapeHtml(trustLevelLabel("trusted"))}</option>`;
  };
  novaIdentitySettingsListEl.innerHTML = `
    <label class="stack-field">
      <strong>Name</strong>
      <span class="micro">Used in the title, wake phrase, and UI labels.</span>
      <input type="text" data-nova-field="botName" value="${escapeAttr(String(app.botName || ""))}" placeholder="Nova" />
    </label>
    <label class="stack-field">
      <strong>Avatar model</strong>
      <span class="micro">Choose from GLB files currently present in <code>public/assets</code>.</span>
      <select data-nova-field="avatarModelPath">${renderAssetOptions(modelOptions, selectedModelPath)}</select>
    </label>
    <label class="stack-field">
      <strong>Voice preferences</strong>
      <span class="micro">One preferred voice per line. Nova uses the first matching installed system voice.</span>
      <textarea data-nova-field="voicePreferences" rows="6" placeholder="Zira&#10;Catherine&#10;Aria">${escapeHtml((Array.isArray(app.voicePreferences) ? app.voicePreferences : []).join("\n"))}</textarea>
    </label>
    <div class="brain-editor-card">
      <div class="panel-head compact">
        <div>
          <strong>Reaction mapping for this model</strong>
          <div class="micro">The selected model keeps its own idle clip, talking loop list, and emotion-to-clip path map.</div>
        </div>
      </div>
      <div class="stack-list">
        <div class="micro">Editing: <code>${escapeHtml(selectedModelPath || "No model selected")}</code></div>
        <label class="stack-field">
          <strong>Idle clip</strong>
          <input type="text" data-nova-reaction-idle value="${escapeAttr(String(reactionProfile.idleClip || ""))}" placeholder="Charged_Ground_Slam" />
        </label>
        <label class="stack-field">
          <strong>Talking clips</strong>
          <span class="micro">One clip per line. Nova rotates through these while speaking.</span>
          <textarea data-nova-reaction-talking rows="4" placeholder="Mirror_Viewing&#10;Talk_with_Left_Hand_Raised&#10;FunnyDancing_01">${escapeHtml((Array.isArray(reactionProfile.talkingClips) ? reactionProfile.talkingClips : []).join("\n"))}</textarea>
        </label>
        <label class="stack-field">
          <strong>Reaction paths</strong>
          <span class="micro">Use <code>emotion=Clip_Name</code> per line. These map directly from <code>[nova:emotion=...]</code> tags.</span>
          <textarea data-nova-reaction-paths rows="12" placeholder="agree=Talk_with_Left_Hand_Raised&#10;confused=Walking">${escapeHtml(formatReactionPathsForTextarea(reactionProfile.paths))}</textarea>
        </label>
      </div>
    </div>
  `;
  novaTrustSettingsListEl.innerHTML = `
    <section class="brain-editor-card">
      <div class="panel-head compact">
        <div>
          <strong>Source trust</strong>
          <div class="micro">Each trust record can hold both the email match and the captured voice pattern for the same person.</div>
        </div>
      </div>
      <div class="stack-list">
        <label class="stack-field">
          <strong>Email command minimum</strong>
          <span class="micro">Fixed policy: only trusted sources may execute commands. Explicit email commands should start with <code>Nova:</code>, <code>Nova,</code>, or <code>Nova -</code>.</span>
          <select data-nova-trust-threshold="emailCommandMinLevel">${renderCommandThresholdOptions(trust.emailCommandMinLevel || "trusted")}</select>
        </label>
        <label class="stack-field">
          <strong>Voice command minimum</strong>
          <span class="micro">Fixed policy: only trusted captured speakers may execute commands once voice profiles exist.</span>
          <select data-nova-trust-threshold="voiceCommandMinLevel">${renderCommandThresholdOptions(trust.voiceCommandMinLevel || "trusted")}</select>
        </label>
        <div class="stack-field">
          <strong>Trust records</strong>
          <span class="micro">Use one record per person. Email matching and voice capture live together here.</span>
          <div class="stack-list">
            ${trustRecords.length ? trustRecords.map((record, index) => `
              <div class="brain-editor-card">
                <label class="stack-field">
                  <strong>Label</strong>
                  <input type="text" data-nova-trust-record-field="${escapeAttr(index)}:label" value="${escapeAttr(String(record.label || ""))}" placeholder="Person label" />
                </label>
                <label class="stack-field">
                  <strong>Email</strong>
                  <input type="email" data-nova-trust-record-field="${escapeAttr(index)}:email" value="${escapeAttr(String(record.email || ""))}" placeholder="name@example.com" />
                </label>
                <label class="stack-field">
                  <strong>Trust level</strong>
                  <select data-nova-trust-record-field="${escapeAttr(index)}:trustLevel">${renderTrustLevelOptions(record.trustLevel || "known")}</select>
                </label>
                <label class="stack-field">
                  <strong>Voice threshold</strong>
                  <input type="number" min="0.45" max="0.99" step="0.01" data-nova-trust-record-field="${escapeAttr(index)}:threshold" value="${escapeAttr(String(Number(record.threshold || 0.82).toFixed(2)))}" title="Voice match threshold" />
                </label>
                <label class="stack-field">
                  <strong>Aliases</strong>
                  <input type="text" data-nova-trust-record-field="${escapeAttr(index)}:aliases" value="${escapeAttr((Array.isArray(record.aliases) ? record.aliases : []).join(", "))}" placeholder="Display-name aliases, comma separated" />
                </label>
                <div class="micro">${escapeHtml(Array.isArray(record.signature) && record.signature.length ? `${record.signature.length} signature bins captured.${record.updatedAt ? ` Updated ${formatDateTime(record.updatedAt)}.` : ""}` : "No voice signature captured yet. Email matching still works without one.")}</div>
                <label class="stack-field">
                  <strong>Notes</strong>
                  <textarea rows="2" data-nova-trust-record-field="${escapeAttr(index)}:notes" placeholder="Notes">${escapeHtml(String(record.notes || ""))}</textarea>
                </label>
                <div class="controls" style="grid-template-columns: 1fr 1fr;">
                  <button type="button" class="secondary" data-nova-capture-trust-record="${escapeAttr(index)}">Capture voice</button>
                  <button type="button" class="secondary" data-nova-remove-trust-record="${escapeAttr(index)}">Remove record</button>
                </div>
              </div>
            `).join("") : `<div class="panel-subtle">No trust records configured yet.</div>`}
          </div>
          <button type="button" class="secondary" data-nova-add-trust-record>Add trust record</button>
        </div>
      </div>
    </section>
  `;
  const novaSettingsRootEls = [
    novaIdentitySettingsListEl,
    novaTrustSettingsListEl
  ];
  novaSettingsRootEls.forEach((rootEl) => {
    rootEl.querySelectorAll("[data-nova-field]").forEach((input) => {
      input.onchange = () => {
        const field = String(input.dataset.novaField || "").trim();
        if (!field || !novaConfigDraft?.app) {
          return;
        }
        if (field === "voicePreferences") {
          novaConfigDraft.app.voicePreferences = String(input.value || "")
            .split(/\r?\n/)
            .map((value) => String(value || "").trim())
            .filter(Boolean);
          return;
        }
        novaConfigDraft.app[field] = String(input.value || "");
        if (field === "avatarModelPath") {
          getReactionProfileDraft(novaConfigDraft.app, String(input.value || ""));
          renderNovaConfigEditor();
        }
        if (field === "botName" || field === "avatarModelPath" || field === "backgroundImagePath" || field === "stylizationFilterPreset" || field === "stylizationEffectPreset") {
          applyAppConfigToStage(novaConfigDraft.app);
        }
      };
    });
    rootEl.querySelectorAll("[data-nova-reaction-idle]").forEach((input) => {
      input.onchange = () => {
        const profile = getReactionProfileDraft(novaConfigDraft?.app, selectedModelPath);
        const idleClip = String(input.value || "").trim();
        profile.idleClip = idleClip;
        if (!profile.paths || typeof profile.paths !== "object") {
          profile.paths = {};
        }
        profile.paths.idle = idleClip;
      };
    });
    rootEl.querySelectorAll("[data-nova-reaction-talking]").forEach((input) => {
      input.onchange = () => {
        const profile = getReactionProfileDraft(novaConfigDraft?.app, selectedModelPath);
        profile.talkingClips = String(input.value || "")
          .split(/\r?\n/)
          .map((value) => String(value || "").trim())
          .filter(Boolean);
      };
    });
    rootEl.querySelectorAll("[data-nova-reaction-paths]").forEach((input) => {
      input.onchange = () => {
        const profile = getReactionProfileDraft(novaConfigDraft?.app, selectedModelPath);
        profile.paths = parseReactionPathsTextarea(input.value || "");
        profile.idleClip = String(profile.paths.idle || profile.idleClip || "").trim();
      };
    });
  });
  const ensureTrustDraft = () => {
    if (!novaConfigDraft?.app) {
      return null;
    }
    if (!novaConfigDraft.app.trust || typeof novaConfigDraft.app.trust !== "object") {
      novaConfigDraft.app.trust = {
        emailCommandMinLevel: "trusted",
        voiceCommandMinLevel: "trusted",
        records: [],
        emailSources: [],
        voiceProfiles: []
      };
    }
    if (!Array.isArray(novaConfigDraft.app.trust.records)) {
      novaConfigDraft.app.trust.records = [];
    }
    novaConfigDraft.app.trust.emailSources = [];
    novaConfigDraft.app.trust.voiceProfiles = [];
    return novaConfigDraft.app.trust;
  };
  novaTrustSettingsListEl.querySelectorAll("[data-nova-trust-threshold]").forEach((input) => {
    input.onchange = () => {
      const trustDraft = ensureTrustDraft();
      const field = String(input.dataset.novaTrustThreshold || "").trim();
      if (!trustDraft || !field) {
        return;
      }
      trustDraft[field] = normalizeTrustLevel(String(input.value || ""), "trusted");
    };
  });
  novaTrustSettingsListEl.querySelectorAll("[data-nova-trust-record-field]").forEach((input) => {
    input.onchange = () => {
      const trustDraft = ensureTrustDraft();
      const descriptor = String(input.dataset.novaTrustRecordField || "").trim();
      const [indexText, field] = descriptor.split(":");
      const index = Number(indexText);
      if (!trustDraft || !field || !Number.isInteger(index) || !trustDraft.records[index]) {
        return;
      }
      if (field === "aliases") {
        trustDraft.records[index].aliases = String(input.value || "")
          .split(",")
          .map((value) => String(value || "").trim())
          .filter(Boolean);
        return;
      }
      if (field === "trustLevel") {
        trustDraft.records[index].trustLevel = normalizeTrustLevel(String(input.value || ""), "known");
        return;
      }
      if (field === "threshold") {
        trustDraft.records[index].threshold = Math.max(0.45, Math.min(Number(input.value || 0.82), 0.99));
        return;
      }
      trustDraft.records[index][field] = String(input.value || "");
    };
  });
  novaTrustSettingsListEl.querySelectorAll("[data-nova-remove-trust-record]").forEach((button) => {
    button.onclick = () => {
      const trustDraft = ensureTrustDraft();
      const index = Number(button.dataset.novaRemoveTrustRecord);
      if (!trustDraft || !Number.isInteger(index)) {
        return;
      }
      trustDraft.records.splice(index, 1);
      renderNovaConfigEditor();
    };
  });
  novaTrustSettingsListEl.querySelectorAll("[data-nova-add-trust-record]").forEach((button) => {
    button.onclick = () => {
      const trustDraft = ensureTrustDraft();
      if (!trustDraft) {
        return;
      }
      trustDraft.records.push({
        id: `trust-record-${hashId(`${Date.now()}-${trustDraft.records.length}`)}`,
        label: "",
        email: "",
        aliases: [],
        trustLevel: "known",
        threshold: 0.82,
        signature: [],
        notes: ""
      });
      renderNovaConfigEditor();
    };
  });
  novaTrustSettingsListEl.querySelectorAll("[data-nova-capture-trust-record]").forEach((button) => {
    button.onclick = async () => {
      const trustDraft = ensureTrustDraft();
      const index = Number(button.dataset.novaCaptureTrustRecord);
      if (!trustDraft || !Number.isInteger(index) || !trustDraft.records[index]) {
        return;
      }
      if (typeof captureVoiceTrustProfileSignature !== "function") {
        novaHintEl.textContent = "Voice capture is unavailable in this browser.";
        return;
      }
      button.disabled = true;
      novaHintEl.textContent = `Listening for ${trustDraft.records[index].label || `trust record ${index + 1}`}... speak naturally for about 3 seconds.`;
      try {
        const signature = await captureVoiceTrustProfileSignature({ durationMs: 3200 });
        trustDraft.records[index].signature = signature;
        const now = Date.now();
        trustDraft.records[index].capturedAt = Number(trustDraft.records[index].capturedAt || now);
        trustDraft.records[index].updatedAt = now;
        renderNovaConfigEditor();
        await saveNovaConfig();
        novaHintEl.textContent = `Captured and stored voice signature for ${trustDraft.records[index].label || `trust record ${index + 1}`}.`;
      } catch (error) {
        novaHintEl.textContent = `Voice capture failed: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    };
  });
}

async function loadNovaConfig() {
  if (!novaHintEl) {
    return;
  }
  novaHintEl.textContent = "Loading Nova settings...";
  try {
    const r = await fetch("/api/app/config");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load Nova settings");
    }
    novaConfigDraft = cloneJson(j);
    renderNovaConfigEditor();
    applyAppConfigToStage(novaConfigDraft.app || {});
    await observerApp.refreshPluginNovaTabs?.({ silent: true });
    novaHintEl.textContent = "Nova settings loaded.";
  } catch (error) {
    novaConfigDraft = null;
    renderNovaConfigEditor();
    await observerApp.refreshPluginNovaTabs?.({ silent: true });
    novaHintEl.textContent = `Failed to load Nova settings: ${error.message}`;
  }
}


async function saveNovaConfig() {
  if (!novaConfigDraft?.app || !novaHintEl || !saveNovaBtn) {
    return;
  }
  if (novaConfigDraft.app.trust && typeof novaConfigDraft.app.trust === "object" && Array.isArray(novaConfigDraft.app.trust.records)) {
    novaConfigDraft.app.trust.emailSources = [];
    novaConfigDraft.app.trust.voiceProfiles = [];
  }
  saveNovaBtn.disabled = true;
  novaHintEl.textContent = "Saving Nova settings...";
  try {
    const r = await pluginAdminFetch("/api/app/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app: novaConfigDraft.app })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to save Nova settings");
    }
    await loadNovaConfig();
    await loadRuntimeOptions();
    if (window.agentAvatar?.reloadAppearance) {
      await window.agentAvatar.reloadAppearance(j.app || {});
    }
    novaHintEl.textContent = j.message || "Nova settings saved.";
  } catch (error) {
    novaHintEl.textContent = `Save failed: ${error.message}`;
  } finally {
    saveNovaBtn.disabled = false;
  }
}

function getBrainRouteKeys() {
  return ["code", "document", "general", "background", "creative", "vision", "retrieval"];
}

function getDraftBrainRecords() {
  const builtIn = Array.isArray(brainConfigDraft?.builtInBrains) ? brainConfigDraft.builtInBrains : [];
  const custom = Array.isArray(brainConfigDraft?.brains?.custom) ? brainConfigDraft.brains.custom : [];
  return [
    ...builtIn.map((brain) => ({
      id: brain.id,
      label: brain.label,
      kind: brain.kind,
      model: brain.model,
      builtIn: true
    })),
    ...custom.map((brain) => ({
      id: brain.id,
      label: brain.label,
      kind: brain.kind,
      model: brain.model,
      builtIn: false
    }))
  ];
}

function syncBuiltInBrainOverrides() {
  if (!brainConfigDraft?.brains) {
    return;
  }
  const builtInBrains = Array.isArray(brainConfigDraft.builtInBrains) ? brainConfigDraft.builtInBrains : [];
  brainConfigDraft.brains.builtIn = builtInBrains
    .map((brain) => ({
      id: String(brain?.id || "").trim(),
      model: String(brain?.model || "").trim()
    }))
    .filter((brain) => brain.id);
}

function updateRemotePlannerHealthIndicator(brainActivity) {
  const selectedId = brainConfigDraft?.routing?.remoteTriageBrainId || "";
  const routingTabBtn = document.querySelector('[data-brain-subtab-target="brainsRoutingPanel"]');
  if (!selectedId) {
    remotePlannerSelectEl?.classList.remove("input-warn");
    routingTabBtn?.classList.remove("has-alert");
    return;
  }
  const entry = Array.isArray(brainActivity)
    ? brainActivity.find((b) => String(b.id || "") === selectedId)
    : null;
  const isUnhealthy = !entry || entry.endpointHealthy === false;
  remotePlannerSelectEl?.classList.toggle("input-warn", isUnhealthy);
  routingTabBtn?.classList.toggle("has-alert", isUnhealthy);
}

function renderBrainConfigEditor() {
  if (!brainConfigDraft) {
    brainEndpointsListEl.innerHTML = `<div class="panel-subtle">Brain configuration unavailable.</div>`;
    brainAssignmentsListEl.innerHTML = `<div class="panel-subtle">Brain configuration unavailable.</div>`;
    customBrainsListEl.innerHTML = `<div class="panel-subtle">Brain configuration unavailable.</div>`;
    routingMapListEl.innerHTML = `<div class="panel-subtle">Brain configuration unavailable.</div>`;
    return;
  }

  const endpoints = Object.entries(brainConfigDraft.brains?.endpoints || {});
  const endpointOptions = endpoints.map(([id, entry]) => `<option value="${escapeAttr(id)}">${escapeHtml(entry.label || id)} (${escapeHtml(id)})</option>`).join("");
  const enabledIds = new Set(Array.isArray(brainConfigDraft.brains?.enabledIds) ? brainConfigDraft.brains.enabledIds : []);
  const builtInBrains = Array.isArray(brainConfigDraft.builtInBrains) ? brainConfigDraft.builtInBrains : [];
  const customBrains = Array.isArray(brainConfigDraft.brains?.custom) ? brainConfigDraft.brains.custom : [];
  const plannerCandidates = getDraftBrainRecords().filter((brain) => brain.kind !== "worker");

  brainEndpointsListEl.innerHTML = endpoints.map(([id, entry]) => `
    <div class="brain-row" data-endpoint-id="${escapeAttr(id)}">
      <div class="brain-row-grid">
        <label class="stack-field">
          <span class="micro">Endpoint id</span>
          <input data-endpoint-field="id" value="${escapeAttr(id)}" ${id === "local" ? "disabled" : ""} />
        </label>
        <label class="stack-field">
          <span class="micro">Label</span>
          <input data-endpoint-field="label" value="${escapeAttr(entry.label || id)}" ${id === "local" ? "disabled" : ""} />
        </label>
        <label class="stack-field">
          <span class="micro">Base URL</span>
          <input data-endpoint-field="baseUrl" value="${escapeAttr(entry.baseUrl || "")}" ${id === "local" ? "disabled" : ""} />
        </label>
      </div>
      <div class="brain-row-actions">
        <span class="brain-pill">${id === "local" ? "Required local endpoint" : "Remote endpoint"}</span>
        ${id === "local" ? "" : `<button class="secondary" type="button" data-remove-endpoint="${escapeAttr(id)}">Remove</button>`}
      </div>
    </div>
  `).join("");

  brainAssignmentsListEl.innerHTML = builtInBrains.map((brain) => `
    <div class="brain-assignment-row">
      <div>
        <strong>${escapeHtml(brain.label)}</strong>
        <div class="micro">${escapeHtml(brain.model)} · ${escapeHtml(brain.description || brain.kind)}</div>
      </div>
      <label class="stack-field">
        <span class="micro">Endpoint</span>
        <select data-assignment-brain="${escapeAttr(brain.id)}">${endpointOptions}</select>
      </label>
    </div>
  `).join("");

  brainAssignmentsListEl.innerHTML = builtInBrains.map((brain) => `
    <div class="brain-row">
      <div class="brain-row-actions">
        <label class="toggle">
          <input
            type="checkbox"
            data-built-in-brain="${escapeAttr(brain.id)}"
            data-built-in-field="enabled"
            ${enabledIds.has(brain.id) ? "checked" : ""}
          />
          <span>
            <strong>${escapeHtml(brain.label)}</strong>
            <div class="micro">${escapeHtml(brain.id)} - ${escapeHtml(brain.description || brain.kind)}</div>
          </span>
        </label>
      </div>
      <div class="brain-row-grid">
        <label class="stack-field">
          <span class="micro">Model</span>
          <input
            data-built-in-brain="${escapeAttr(brain.id)}"
            data-built-in-field="model"
            value="${escapeAttr(brain.model || "")}"
          />
        </label>
        <label class="stack-field">
          <span class="micro">Endpoint</span>
          <select data-assignment-brain="${escapeAttr(brain.id)}">${endpointOptions}</select>
        </label>
      </div>
    </div>
  `).join("");

  customBrainsListEl.innerHTML = customBrains.length
    ? customBrains.map((brain, index) => `
      <div class="brain-row" data-custom-index="${index}">
        <div class="brain-row-actions">
          <label class="toggle">
            <input type="checkbox" data-custom-field="enabled" ${enabledIds.has(brain.id) ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(brain.label || brain.id)}</strong>
              <div class="micro">${escapeHtml(brain.kind)} · ${escapeHtml(brain.model)}</div>
            </span>
          </label>
          <button class="secondary" type="button" data-remove-custom="${index}">Remove</button>
        </div>
        <div class="brain-row-grid wide">
          <label class="stack-field">
            <span class="micro">Id</span>
            <input data-custom-field="id" value="${escapeAttr(brain.id || "")}" />
          </label>
          <label class="stack-field">
            <span class="micro">Label</span>
            <input data-custom-field="label" value="${escapeAttr(brain.label || "")}" />
          </label>
          <label class="stack-field">
            <span class="micro">Kind</span>
            <select data-custom-field="kind">
              <option value="helper" ${brain.kind === "helper" ? "selected" : ""}>helper</option>
              <option value="worker" ${brain.kind === "worker" ? "selected" : ""}>worker</option>
              <option value="intake" ${brain.kind === "intake" ? "selected" : ""}>intake</option>
            </select>
          </label>
          <label class="stack-field">
            <span class="micro">Model</span>
            <input data-custom-field="model" value="${escapeAttr(brain.model || "")}" />
          </label>
        </div>
        <div class="brain-row-grid wide">
          <label class="stack-field">
            <span class="micro">Endpoint</span>
            <select data-custom-field="endpointId">${endpointOptions}</select>
          </label>
          <label class="stack-field">
            <span class="micro">Specialty</span>
            <input data-custom-field="specialty" value="${escapeAttr(brain.specialty || "")}" />
          </label>
          <label class="stack-field">
            <span class="micro">Queue lane</span>
            <input data-custom-field="queueLane" value="${escapeAttr(brain.queueLane || "")}" placeholder="optional" />
          </label>
        </div>
        <label class="stack-field">
          <span class="micro">Description</span>
          <input data-custom-field="description" value="${escapeAttr(brain.description || "")}" />
        </label>
        <div class="brain-row-actions">
          <label class="toggle">
            <input type="checkbox" data-custom-field="toolCapable" ${brain.toolCapable ? "checked" : ""} />
            <span><strong>Tool capable</strong></span>
          </label>
          <label class="toggle">
            <input type="checkbox" data-custom-field="cronCapable" ${brain.cronCapable ? "checked" : ""} />
            <span><strong>Scheduled-job capable</strong></span>
          </label>
        </div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No custom specialists configured.</div>`;

  routingEnabledToggleEl.checked = brainConfigDraft.routing?.enabled === true;
  remoteParallelToggleEl.checked = brainConfigDraft.queue?.remoteParallel !== false;
  escalationEnabledToggleEl.checked = brainConfigDraft.queue?.escalationEnabled !== false;
  routingFallbackAttemptsEl.value = String(brainConfigDraft.routing?.fallbackAttempts ?? 2);
  remotePlannerSelectEl.innerHTML = [`<option value="">None</option>`]
    .concat(plannerCandidates.map((brain) => `<option value="${escapeAttr(brain.id)}">${escapeHtml(brain.label || brain.id)} (${escapeHtml(brain.id)})</option>`))
    .join("");
  remotePlannerSelectEl.value = brainConfigDraft.routing?.remoteTriageBrainId || "";

  routingMapListEl.innerHTML = getBrainRouteKeys().map((routeKey) => `
    <div class="route-map-row">
      <label class="stack-field">
        <span class="micro">${escapeHtml(routeKey)}</span>
      </label>
      <input data-routing-key="${escapeAttr(routeKey)}" value="${escapeAttr((brainConfigDraft.routing?.specialistMap?.[routeKey] || []).join(", "))}" placeholder="brain ids, comma separated" />
    </div>
  `).join("");

  brainAssignmentsListEl.querySelectorAll("[data-assignment-brain]").forEach((select) => {
    const brainId = select.dataset.assignmentBrain;
    select.value = brainConfigDraft.brains?.assignments?.[brainId] || "local";
    select.onchange = () => {
      brainConfigDraft.brains.assignments[brainId] = select.value;
    };
  });

  brainAssignmentsListEl.querySelectorAll("[data-built-in-brain]").forEach((input) => {
    const brainId = input.dataset.builtInBrain;
    const field = input.dataset.builtInField;
    input.onchange = () => {
      const brain = Array.isArray(brainConfigDraft.builtInBrains)
        ? brainConfigDraft.builtInBrains.find((entry) => entry.id === brainId)
        : null;
      if (!brain) {
        return;
      }
      if (field === "enabled") {
        const enabled = new Set(brainConfigDraft.brains.enabledIds || []);
        if (input.checked) {
          enabled.add(brain.id);
        } else {
          enabled.delete(brain.id);
          if (brainConfigDraft.routing?.remoteTriageBrainId === brain.id) {
            brainConfigDraft.routing.remoteTriageBrainId = "";
            if (remotePlannerSelectEl) {
              remotePlannerSelectEl.value = "";
            }
          }
        }
        brainConfigDraft.brains.enabledIds = [...enabled];
        return;
      }
      if (field === "model") {
        brain.model = String(input.value || "").trim();
        syncBuiltInBrainOverrides();
      }
    };
  });

  brainEndpointsListEl.querySelectorAll("[data-endpoint-id]").forEach((row) => {
    const endpointId = row.dataset.endpointId;
    row.querySelectorAll("[data-endpoint-field]").forEach((input) => {
      input.onchange = () => {
        const field = input.dataset.endpointField;
        const current = brainConfigDraft.brains.endpoints[endpointId];
        if (!current || endpointId === "local") {
          return;
        }
        if (field === "id") {
          const nextId = String(input.value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
          if (!nextId || nextId === "local" || brainConfigDraft.brains.endpoints[nextId]) {
            renderBrainConfigEditor();
            return;
          }
          delete brainConfigDraft.brains.endpoints[endpointId];
          brainConfigDraft.brains.endpoints[nextId] = current;
          Object.keys(brainConfigDraft.brains.assignments || {}).forEach((brainId) => {
            if (brainConfigDraft.brains.assignments[brainId] === endpointId) {
              brainConfigDraft.brains.assignments[brainId] = nextId;
            }
          });
          (brainConfigDraft.brains.custom || []).forEach((brain) => {
            if (brain.endpointId === endpointId) {
              brain.endpointId = nextId;
            }
          });
          renderBrainConfigEditor();
          return;
        }
        current[field] = input.value;
      };
    });
  });

  brainEndpointsListEl.querySelectorAll("[data-remove-endpoint]").forEach((button) => {
    button.onclick = () => {
      const endpointId = button.dataset.removeEndpoint;
      delete brainConfigDraft.brains.endpoints[endpointId];
      Object.keys(brainConfigDraft.brains.assignments || {}).forEach((brainId) => {
        if (brainConfigDraft.brains.assignments[brainId] === endpointId) {
          brainConfigDraft.brains.assignments[brainId] = "local";
        }
      });
      (brainConfigDraft.brains.custom || []).forEach((brain) => {
        if (brain.endpointId === endpointId) {
          brain.endpointId = "local";
        }
      });
      renderBrainConfigEditor();
    };
  });

  customBrainsListEl.querySelectorAll("[data-custom-index]").forEach((row) => {
    const index = Number(row.dataset.customIndex || -1);
    row.querySelectorAll("[data-custom-field]").forEach((input) => {
      input.onchange = () => {
        const brain = brainConfigDraft.brains.custom[index];
        if (!brain) {
          return;
        }
        const field = input.dataset.customField;
        if (field === "enabled") {
          const enabled = new Set(brainConfigDraft.brains.enabledIds || []);
          if (input.checked) {
            enabled.add(brain.id);
          } else {
            enabled.delete(brain.id);
            if (brainConfigDraft.routing?.remoteTriageBrainId === brain.id) {
              brainConfigDraft.routing.remoteTriageBrainId = "";
              if (remotePlannerSelectEl) {
                remotePlannerSelectEl.value = "";
              }
            }
          }
          brainConfigDraft.brains.enabledIds = [...enabled];
          return;
        }
        if (field === "toolCapable" || field === "cronCapable") {
          brain[field] = input.checked;
          return;
        }
        if (field === "id") {
          const priorId = brain.id;
          const nextId = String(input.value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
          if (!nextId) {
            return;
          }
          brain.id = nextId;
          brainConfigDraft.brains.enabledIds = (brainConfigDraft.brains.enabledIds || []).map((value) => value === priorId ? nextId : value);
          Object.keys(brainConfigDraft.routing?.specialistMap || {}).forEach((routeKey) => {
            brainConfigDraft.routing.specialistMap[routeKey] = (brainConfigDraft.routing.specialistMap[routeKey] || []).map((value) => value === priorId ? nextId : value);
          });
          if (brainConfigDraft.routing?.remoteTriageBrainId === priorId) {
            brainConfigDraft.routing.remoteTriageBrainId = nextId;
          }
          renderBrainConfigEditor();
          return;
        }
        brain[field] = input.value;
      };
      if (input.tagName === "SELECT" && input.dataset.customField === "endpointId") {
        input.value = brainConfigDraft.brains.custom[index]?.endpointId || "local";
      }
    });
  });

  customBrainsListEl.querySelectorAll("[data-remove-custom]").forEach((button) => {
    button.onclick = () => {
      const index = Number(button.dataset.removeCustom || -1);
      const removed = brainConfigDraft.brains.custom[index];
      if (!removed) {
        return;
      }
      brainConfigDraft.brains.custom.splice(index, 1);
      brainConfigDraft.brains.enabledIds = (brainConfigDraft.brains.enabledIds || []).filter((id) => id !== removed.id);
      Object.keys(brainConfigDraft.routing?.specialistMap || {}).forEach((routeKey) => {
        brainConfigDraft.routing.specialistMap[routeKey] = (brainConfigDraft.routing.specialistMap[routeKey] || []).filter((id) => id !== removed.id);
      });
      if (brainConfigDraft.routing?.remoteTriageBrainId === removed.id) {
        brainConfigDraft.routing.remoteTriageBrainId = "";
      }
      renderBrainConfigEditor();
    };
  });

  routingEnabledToggleEl.onchange = () => { brainConfigDraft.routing.enabled = routingEnabledToggleEl.checked; };
  remoteParallelToggleEl.onchange = () => { brainConfigDraft.queue.remoteParallel = remoteParallelToggleEl.checked; };
  escalationEnabledToggleEl.onchange = () => { brainConfigDraft.queue.escalationEnabled = escalationEnabledToggleEl.checked; };
  remotePlannerSelectEl.onchange = () => {
    brainConfigDraft.routing.remoteTriageBrainId = remotePlannerSelectEl.value;
    updateRemotePlannerHealthIndicator(lastBrainActivity);
  };
  routingFallbackAttemptsEl.onchange = () => {
    brainConfigDraft.routing.fallbackAttempts = Math.max(0, Math.min(Number(routingFallbackAttemptsEl.value || 0), 4));
  };
  routingMapListEl.querySelectorAll("[data-routing-key]").forEach((input) => {
    input.onchange = () => {
      brainConfigDraft.routing.specialistMap[input.dataset.routingKey] = String(input.value || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    };
  });
  updateRemotePlannerHealthIndicator(lastBrainActivity);
}

async function loadBrainConfig() {
  brainsHintEl.textContent = "Loading brain configuration...";
  try {
    const r = await fetch("/api/brains/config");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load brain configuration");
    }
    brainConfigDraft = cloneJson(j);
    renderBrainConfigEditor();
    brainsHintEl.textContent = "Brain configuration loaded.";
  } catch (error) {
    brainsHintEl.textContent = `Failed to load brain configuration: ${error.message}`;
  }
}

function addBrainEndpointDraft() {
  if (!brainConfigDraft) {
    return;
  }
  let index = 2;
  let endpointId = `lan_${index}`;
  while (brainConfigDraft.brains.endpoints[endpointId]) {
    index += 1;
    endpointId = `lan_${index}`;
  }
  brainConfigDraft.brains.endpoints[endpointId] = {
    label: `LAN Ollama ${index}`,
    baseUrl: `http://192.168.0.${70 + index}:11434`
  };
  renderBrainConfigEditor();
}

function addCustomBrainDraft() {
  if (!brainConfigDraft) {
    return;
  }
  let index = (brainConfigDraft.brains.custom || []).length + 1;
  let brainId = `specialist_${index}`;
  const usedIds = new Set(getDraftBrainRecords().map((brain) => brain.id));
  while (usedIds.has(brainId)) {
    index += 1;
    brainId = `specialist_${index}`;
  }
  const endpointIds = Object.keys(brainConfigDraft.brains.endpoints || {});
  const remoteEndpointId = endpointIds.find((id) => id !== "local") || "local";
  brainConfigDraft.brains.custom.push({
    id: brainId,
    label: `Specialist ${index}`,
    kind: "worker",
    model: "",
    endpointId: remoteEndpointId,
    queueLane: "",
    specialty: "",
    toolCapable: true,
    cronCapable: false,
    description: ""
  });
  brainConfigDraft.brains.enabledIds = [...new Set([...(brainConfigDraft.brains.enabledIds || []), brainId])];
  renderBrainConfigEditor();
}

async function saveBrainConfig() {
  if (!brainConfigDraft) {
    return;
  }
  saveBrainsBtn.disabled = true;
  brainsHintEl.textContent = "Saving brain configuration...";
  try {
    syncBuiltInBrainOverrides();
    const payload = {
      brains: {
        enabledIds: brainConfigDraft.brains?.enabledIds || [],
        endpoints: brainConfigDraft.brains?.endpoints || {},
        assignments: brainConfigDraft.brains?.assignments || {},
        custom: brainConfigDraft.brains?.custom || [],
        builtIn: brainConfigDraft.brains?.builtIn || []
      },
      routing: brainConfigDraft.routing || {},
      queue: brainConfigDraft.queue || {}
    };
    const r = await pluginAdminFetch("/api/brains/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to save brain configuration");
    }
    brainConfigDraft = cloneJson(j);
    brainsHintEl.textContent = j.message || "Brain configuration saved.";
    renderBrainConfigEditor();
    await loadRuntimeOptions();
    await refreshStatus();
  } catch (error) {
    brainsHintEl.textContent = `Save failed: ${error.message}`;
  } finally {
    saveBrainsBtn.disabled = false;
  }
}

function renderToolConfigEditor() {
  if (!toolConfigDraft) {
    toolCatalogListEl.innerHTML = `<div class="panel-subtle">Tool configuration unavailable.</div>`;
    installedSkillsListEl.innerHTML = `<div class="panel-subtle">Skill approval configuration unavailable.</div>`;
    capabilityRequestsListEl.innerHTML = `<div class="panel-subtle">Capability request state unavailable.</div>`;
    return;
  }

  const tools = Array.isArray(toolConfigDraft.tools) ? toolConfigDraft.tools : [];
  const installedSkills = Array.isArray(toolConfigDraft.installedSkills) ? toolConfigDraft.installedSkills : [];
  const toolRequests = Array.isArray(toolConfigDraft.toolRequests) ? toolConfigDraft.toolRequests : [];
  const skillRequests = Array.isArray(toolConfigDraft.skillRequests) ? toolConfigDraft.skillRequests : [];

  toolCatalogListEl.innerHTML = tools.length
    ? tools.map((tool, index) => `
      <div class="brain-row" data-tool-index="${index}">
        <div class="brain-row-actions">
          <label class="toggle">
            <input type="checkbox" data-tool-field="approved" ${tool.approved !== false ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(tool.name)}</strong>
              <div class="micro">${escapeHtml((tool.scopes || []).join(" + ") || "tool")} · ${escapeHtml(tool.risk || "normal")} risk</div>
            </span>
          </label>
          <span class="brain-pill">${escapeHtml(tool.defaultApproved !== false ? "default on" : "default off")}</span>
        </div>
        <div class="micro">${escapeHtml(tool.description || "No description.")}</div>
        <div class="micro">${escapeHtml(tool.source === "plugin" ? `Owned by plugin: ${tool.pluginName || tool.pluginId || "unknown"}` : "Owned by core system")}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No tools are currently available.</div>`;

  installedSkillsListEl.innerHTML = installedSkills.length
    ? installedSkills.map((skill, index) => `
      <div class="brain-row" data-skill-index="${index}">
        <div class="brain-row-actions">
          <label class="toggle">
            <input type="checkbox" data-skill-field="approved" ${skill.approved ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(skill.name || skill.slug)}</strong>
              <div class="micro">${escapeHtml(skill.slug)}${skill.containerPath ? ` · ${escapeHtml(skill.containerPath)}` : ""}</div>
            </span>
          </label>
          <span class="brain-pill">${skill.approved ? "approved" : "installed only"}</span>
        </div>
        <div class="micro">${escapeHtml(skill.description || "No description.")}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No extra skills installed.</div>`;

  const capabilityRequests = [
    ...skillRequests.map((request) => ({ ...request, requestType: "skill" })),
    ...toolRequests.map((request) => ({ ...request, requestType: "tool" }))
  ].sort((left, right) => Number(right.updatedAt || right.requestedAt || 0) - Number(left.updatedAt || left.requestedAt || 0));

  capabilityRequestsListEl.innerHTML = capabilityRequests.length
    ? capabilityRequests.map((request) => `
      <div class="brain-row">
        <div class="brain-row-actions">
          <span>
            <strong>${escapeHtml(request.requestType === "skill" ? (request.slug || request.skillSlug || "skill request") : (request.requestedTool || "tool request"))}</strong>
            <div class="micro">${escapeHtml(request.requestType === "skill" ? "skill install request" : "tool addition request")}${request.skillSlug ? ` Â· skill ${escapeHtml(request.skillSlug)}` : ""}</div>
          </span>
          <span class="brain-pill">${escapeHtml(String(request.requestCount || 1))}x</span>
        </div>
        <div class="micro">${escapeHtml(request.reason || request.summary || "No reason recorded.")}</div>
        <div class="micro">${escapeHtml(request.taskSummary || "No task summary recorded.")}</div>
        <div class="micro">${escapeHtml(formatDateTime(request.updatedAt || request.requestedAt || 0))}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No open capability requests.</div>`;

  toolCatalogListEl.querySelectorAll("[data-tool-index]").forEach((row) => {
    const index = Number(row.dataset.toolIndex || -1);
    row.querySelectorAll("[data-tool-field]").forEach((input) => {
      input.onchange = () => {
        const tool = toolConfigDraft.tools[index];
        if (!tool) {
          return;
        }
        if (input.dataset.toolField === "approved") {
          tool.approved = input.checked;
        }
      };
    });
  });

  installedSkillsListEl.querySelectorAll("[data-skill-index]").forEach((row) => {
    const index = Number(row.dataset.skillIndex || -1);
    row.querySelectorAll("[data-skill-field]").forEach((input) => {
      input.onchange = () => {
        const skill = toolConfigDraft.installedSkills[index];
        if (!skill) {
          return;
        }
        if (input.dataset.skillField === "approved") {
          skill.approved = input.checked;
          const statePill = row.querySelector(".brain-pill");
          if (statePill) {
            statePill.textContent = input.checked ? "approved" : "installed only";
          }
        }
      };
    });
  });
}

async function loadToolConfig() {
  toolsHintEl.textContent = "Loading tool configuration...";
  try {
    const r = await fetch("/api/tools/config");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load tool configuration");
    }
    toolConfigDraft = cloneJson(j);
    renderToolConfigEditor();
    const openRequestCount = (Array.isArray(j.toolRequests) ? j.toolRequests.length : 0) + (Array.isArray(j.skillRequests) ? j.skillRequests.length : 0);
    toolsHintEl.textContent = openRequestCount
      ? `Tool configuration loaded. ${openRequestCount} open capability request${openRequestCount === 1 ? "" : "s"}.`
      : "Tool configuration loaded.";
  } catch (error) {
    toolsHintEl.textContent = `Failed to load tool configuration: ${error.message}`;
  }
}

async function saveToolConfig() {
  if (!toolConfigDraft) {
    return;
  }
  saveToolsBtn.disabled = true;
  toolsHintEl.textContent = "Saving tool configuration...";
  try {
    // Sync from the live DOM before building the payload so the save path
    // does not depend on prior onchange handlers having already fired.
    toolCatalogListEl.querySelectorAll("[data-tool-index]").forEach((row) => {
      const index = Number(row.dataset.toolIndex || -1);
      const tool = Array.isArray(toolConfigDraft.tools) ? toolConfigDraft.tools[index] : null;
      if (!tool) {
        return;
      }
      const approvedInput = row.querySelector('[data-tool-field="approved"]');
      if (approvedInput) {
        tool.approved = approvedInput.checked;
      }
    });
    installedSkillsListEl.querySelectorAll("[data-skill-index]").forEach((row) => {
      const index = Number(row.dataset.skillIndex || -1);
      const skill = Array.isArray(toolConfigDraft.installedSkills) ? toolConfigDraft.installedSkills[index] : null;
      if (!skill) {
        return;
      }
      const approvedInput = row.querySelector('[data-skill-field="approved"]');
      if (approvedInput) {
        skill.approved = approvedInput.checked;
      }
    });
    const payload = {
      toolApprovals: Object.fromEntries(
        (Array.isArray(toolConfigDraft.tools) ? toolConfigDraft.tools : []).map((tool) => [tool.name, tool.approved !== false])
      ),
      skillApprovals: Object.fromEntries(
        (Array.isArray(toolConfigDraft.installedSkills) ? toolConfigDraft.installedSkills : []).map((skill) => [skill.slug, skill.approved === true])
      )
    };
    const r = await fetch("/api/tools/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to save tool configuration");
    }
    toolConfigDraft = cloneJson(j);
    renderToolConfigEditor();
    toolsHintEl.textContent = j.message || "Tool configuration saved.";
  } catch (error) {
    toolsHintEl.textContent = `Save failed: ${error.message}`;
  } finally {
    saveToolsBtn.disabled = false;
  }
}

let pluginCatalogDraft = null;
let pluginPermissionRulesDraft = null;
let pluginTaskLifecycleLastTaskId = "";
let pluginDynamicPanelDraftByKey = new Map();
let pluginDynamicPanelIndex = new Map();
let pluginDynamicPanelEventsBound = false;
let pluginAdminTokenCache = "";
let pluginTopLevelTabModuleByScript = new Map();
let pluginNovaTabModuleByScript = new Map();
let pluginSecretsTabModuleByScript = new Map();

async function getAdminUiToken(forceRefresh = false) {
  if (!forceRefresh && pluginAdminTokenCache) {
    return pluginAdminTokenCache;
  }
  const tokenRes = await fetch("/api/admin-token");
  const tokenJson = await tokenRes.json().catch(() => ({}));
  const token = String(tokenJson?.token || "").trim();
  if (!token) {
    throw new Error(tokenJson?.error || "admin token unavailable");
  }
  pluginAdminTokenCache = token;
  return token;
}

async function pluginAdminFetch(url = "", options = {}) {
  const token = await getAdminUiToken();
  const headers = {
    ...(options?.headers && typeof options.headers === "object" ? options.headers : {}),
    "x-admin-token": token
  };
  return fetch(url, {
    ...options,
    headers
  });
}

function getInstalledPlugins() {
  return Array.isArray(pluginCatalogDraft?.plugins)
    ? pluginCatalogDraft.plugins.filter((plugin) => plugin && typeof plugin === "object")
    : [];
}

function isPluginInstalled(pluginId = "") {
  const normalizedId = String(pluginId || "").trim().toLowerCase();
  if (!normalizedId) {
    return false;
  }
  return getInstalledPlugins().some((plugin) =>
    String(plugin.id || "").trim().toLowerCase() === normalizedId
    && plugin.enabled !== false
  );
}

function normalizePluginUiToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizePluginUiTabs() {
  const tabs = Array.isArray(pluginCatalogDraft?.uiTabs)
    ? pluginCatalogDraft.uiTabs
    : [];
  return tabs
    .filter((tab) => tab && typeof tab === "object")
    .map((tab) => ({
      id: normalizePluginUiToken(tab.id || tab.name || tab.title),
      pluginId: normalizePluginUiToken(tab.pluginId || ""),
      title: String(tab.title || tab.id || "Plugin").trim() || "Plugin",
      icon: String(tab.icon || tab.title || "P").trim().slice(0, 4) || "P",
      order: Number.isFinite(Number(tab.order)) ? Number(tab.order) : 100,
      scriptUrl: String(tab.scriptUrl || tab.script || "").trim(),
      enabled: tab.enabled !== false
    }))
    .filter((tab) => tab.id && tab.pluginId && tab.scriptUrl && tab.scriptUrl.startsWith("/") && tab.enabled !== false && isPluginInstalled(tab.pluginId))
    .sort((left, right) => {
      const orderDelta = Number(left.order || 100) - Number(right.order || 100);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return String(left.title || left.id).localeCompare(String(right.title || right.id));
    });
}

function normalizePluginUiSecretsTabs() {
  const tabs = Array.isArray(pluginCatalogDraft?.uiSecretsTabs)
    ? pluginCatalogDraft.uiSecretsTabs
    : [];
  return tabs
    .filter((tab) => tab && typeof tab === "object")
    .map((tab) => ({
      id: normalizePluginUiToken(tab.id || tab.name || tab.title),
      pluginId: normalizePluginUiToken(tab.pluginId || ""),
      title: String(tab.title || tab.id || "Plugin").trim() || "Plugin",
      order: Number.isFinite(Number(tab.order)) ? Number(tab.order) : 100,
      scriptUrl: String(tab.scriptUrl || tab.script || "").trim(),
      enabled: tab.enabled !== false
    }))
    .filter((tab) => tab.id && tab.pluginId && tab.scriptUrl && tab.scriptUrl.startsWith("/") && tab.enabled !== false && isPluginInstalled(tab.pluginId))
    .sort((left, right) => {
      const orderDelta = Number(left.order || 100) - Number(right.order || 100);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return String(left.title || left.id).localeCompare(String(right.title || right.id));
    });
}

function normalizePluginUiNovaTabs() {
  const tabs = Array.isArray(pluginCatalogDraft?.uiNovaTabs)
    ? pluginCatalogDraft.uiNovaTabs
    : [];
  return tabs
    .filter((tab) => tab && typeof tab === "object")
    .map((tab) => ({
      id: normalizePluginUiToken(tab.id || tab.name || tab.title),
      pluginId: normalizePluginUiToken(tab.pluginId || ""),
      title: String(tab.title || tab.id || "Plugin").trim() || "Plugin",
      order: Number.isFinite(Number(tab.order)) ? Number(tab.order) : 100,
      scriptUrl: String(tab.scriptUrl || tab.script || "").trim(),
      enabled: tab.enabled !== false
    }))
    .filter((tab) => tab.id && tab.pluginId && tab.scriptUrl && tab.scriptUrl.startsWith("/") && tab.enabled !== false && isPluginInstalled(tab.pluginId))
    .sort((left, right) => {
      const orderDelta = Number(left.order || 100) - Number(right.order || 100);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return String(left.title || left.id).localeCompare(String(right.title || right.id));
    });
}

async function mountPluginTopLevelTab(tab = {}, mountEl = null) {
  if (!tab.scriptUrl || !(mountEl instanceof HTMLElement)) {
    return;
  }
  const cacheKey = String(tab.scriptUrl || "").trim();
  if (!cacheKey) {
    return;
  }
  let moduleExports = pluginTopLevelTabModuleByScript.get(cacheKey);
  if (!moduleExports) {
    moduleExports = await import(`${cacheKey}${cacheKey.includes("?") ? "&" : "?"}v=${Date.now()}`);
    pluginTopLevelTabModuleByScript.set(cacheKey, moduleExports);
  }
  if (typeof moduleExports?.mountPluginTab === "function") {
    await moduleExports.mountPluginTab({
      tab,
      root: mountEl,
      observerApp: window.ObserverApp || {},
      pluginAdminFetch
    });
  }
}

async function mountPluginSecretsTab(tab = {}, mountEl = null) {
  if (!tab.scriptUrl || !(mountEl instanceof HTMLElement)) {
    return;
  }
  const cacheKey = String(tab.scriptUrl || "").trim();
  if (!cacheKey) {
    return;
  }
  let moduleExports = pluginSecretsTabModuleByScript.get(cacheKey);
  if (!moduleExports) {
    moduleExports = await import(`${cacheKey}${cacheKey.includes("?") ? "&" : "?"}v=${Date.now()}`);
    pluginSecretsTabModuleByScript.set(cacheKey, moduleExports);
  }
  if (typeof moduleExports?.mountPluginTab === "function") {
    await moduleExports.mountPluginTab({
      tab,
      root: mountEl,
      observerApp: window.ObserverApp || {},
      pluginAdminFetch
    });
  }
}

async function mountPluginNovaTab(tab = {}, mountEl = null) {
  if (!tab.scriptUrl || !(mountEl instanceof HTMLElement)) {
    return;
  }
  const cacheKey = String(tab.scriptUrl || "").trim();
  if (!cacheKey) {
    return;
  }
  let moduleExports = pluginNovaTabModuleByScript.get(cacheKey);
  if (!moduleExports) {
    moduleExports = await import(`${cacheKey}${cacheKey.includes("?") ? "&" : "?"}v=${Date.now()}`);
    pluginNovaTabModuleByScript.set(cacheKey, moduleExports);
  }
  if (typeof moduleExports?.mountPluginTab === "function") {
    await moduleExports.mountPluginTab({
      tab,
      root: mountEl,
      observerApp: window.ObserverApp || {},
      pluginAdminFetch
    });
  }
}

async function refreshPluginNovaTabs(options = {}) {
  const tabs = normalizePluginUiNovaTabs();
  for (const tab of tabs) {
    const panelId = `pluginNovaTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const mountEl = document.getElementById(`${panelId}_mount`);
    if (!(mountEl instanceof HTMLElement)) {
      continue;
    }
    const cacheKey = String(tab.scriptUrl || "").trim();
    const moduleExports = cacheKey ? pluginNovaTabModuleByScript.get(cacheKey) : null;
    if (typeof moduleExports?.refreshPluginTab === "function") {
      try {
        await moduleExports.refreshPluginTab({
          tab,
          root: mountEl,
          observerApp: window.ObserverApp || {},
          pluginAdminFetch,
          options
        });
      } catch {
        // Plugin refresh should not block the rest of the UI.
      }
    }
  }
}

async function refreshPluginSecretsTabs(options = {}) {
  const tabs = normalizePluginUiSecretsTabs();
  for (const tab of tabs) {
    const panelId = `pluginSecretsTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const mountEl = document.getElementById(`${panelId}_mount`);
    if (!(mountEl instanceof HTMLElement)) {
      continue;
    }
    const cacheKey = String(tab.scriptUrl || "").trim();
    const moduleExports = cacheKey ? pluginSecretsTabModuleByScript.get(cacheKey) : null;
    if (typeof moduleExports?.refreshPluginTab === "function") {
      try {
        await moduleExports.refreshPluginTab({
          tab,
          root: mountEl,
          observerApp: window.ObserverApp || {},
          pluginAdminFetch,
          options
        });
      } catch {
        // Plugin refresh should not block the rest of the UI.
      }
    }
  }
}

async function renderPluginTopLevelTabs() {
  if (!tabBarEl || !(panelDrawerEl instanceof HTMLElement)) {
    return;
  }
  const tabs = normalizePluginUiTabs();
  const drawerContentEl = panelDrawerEl.querySelector(".drawer-content");
  if (!(drawerContentEl instanceof HTMLElement)) {
    return;
  }
  const existingButtons = Array.from(tabBarEl.querySelectorAll("[data-plugin-top-level-tab='true']"));
  const existingPanels = Array.from(document.querySelectorAll(".tab-panel[data-plugin-top-level-tab='true']"));
  existingButtons.forEach((button) => button.remove());
  existingPanels.forEach((panel) => {
    if (panel.classList.contains("active")) {
      activateTab("novaTab");
    }
    panel.remove();
  });

  if (!tabs.length) {
    return;
  }

  const insertionButton = tabBarEl.querySelector("[data-tab-target='queueTab']");
  const insertionPanel = drawerContentEl.querySelector("#queueTab");
  for (const tab of tabs) {
    const panelId = `pluginTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const button = document.createElement("button");
    button.className = "tab-button";
    button.type = "button";
    button.dataset.tabTarget = panelId;
    button.dataset.pluginTopLevelTab = "true";
    button.setAttribute("aria-label", tab.title);
    button.setAttribute("title", tab.title);
    button.innerHTML = `<span class="tab-icon">${escapeHtml(tab.icon || tab.title.slice(0, 1).toUpperCase())}</span>`;
    button.onclick = () => activateTab(panelId);
    if (insertionButton) {
      tabBarEl.insertBefore(button, insertionButton);
    } else {
      tabBarEl.appendChild(button);
    }

    const panel = document.createElement("div");
    panel.id = panelId;
    panel.className = "tab-panel";
    panel.dataset.pluginTopLevelTab = "true";
    panel.dataset.pluginId = tab.pluginId;
    panel.innerHTML = `<div class="tab-stack"><div id="${panelId}_mount" class="plugin-tab-mount"><div class="hint">Loading ${escapeHtml(tab.title)}...</div></div></div>`;
    if (insertionPanel) {
      drawerContentEl.insertBefore(panel, insertionPanel);
    } else {
      drawerContentEl.appendChild(panel);
    }

    const mountEl = panel.querySelector(`#${panelId}_mount`);
    try {
      await mountPluginTopLevelTab(tab, mountEl);
    } catch (error) {
      if (mountEl) {
        mountEl.innerHTML = `<div class="hint">Failed to load ${escapeHtml(tab.title)}: ${escapeHtml(error.message)}</div>`;
      }
    }
  }
}

async function renderPluginSecretsTabs() {
  const secretsTabEl = document.getElementById("secretsTab");
  if (!(secretsTabEl instanceof HTMLElement)) {
    return;
  }
  const subtabBarEl = secretsTabEl.querySelector(".secrets-subtab-bar");
  if (!(subtabBarEl instanceof HTMLElement)) {
    return;
  }
  const existingButtons = Array.from(subtabBarEl.querySelectorAll("[data-plugin-secrets-tab='true']"));
  const existingPanels = Array.from(secretsTabEl.querySelectorAll(".secrets-subtab-panel[data-plugin-secrets-tab='true']"));
  existingButtons.forEach((button) => button.remove());
  existingPanels.forEach((panel) => panel.remove());

  const tabs = normalizePluginUiSecretsTabs();
  if (!tabs.length) {
    activateSecretsSubtab(activeSecretsSubtabId || "secretsOverviewPanel");
    return;
  }

  const insertionButton = subtabBarEl.querySelector("[data-secrets-subtab-target='secretsRetrievalPanel']");
  const insertionPanel = secretsTabEl.querySelector("#secretsRetrievalPanel");
  const insertionPanelParent = insertionPanel?.parentElement || null;
  for (const tab of tabs) {
    const panelId = `pluginSecretsTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const button = document.createElement("button");
    button.className = "secrets-subtab-button";
    button.type = "button";
    button.dataset.secretsSubtabTarget = panelId;
    button.dataset.pluginSecretsTab = "true";
    button.textContent = tab.title;
    button.onclick = () => activateSecretsSubtab(panelId);
    if (insertionButton) {
      subtabBarEl.insertBefore(button, insertionButton);
    } else {
      subtabBarEl.appendChild(button);
    }

    const panel = document.createElement("section");
    panel.id = panelId;
    panel.className = "secrets-subtab-panel";
    panel.dataset.pluginSecretsTab = "true";
    panel.dataset.pluginId = tab.pluginId;
    panel.innerHTML = `<div id="${panelId}_mount" class="plugin-tab-mount"><div class="panel-subtle">Loading ${escapeHtml(tab.title)}...</div></div>`;
    if (insertionPanel && insertionPanelParent) {
      insertionPanelParent.insertBefore(panel, insertionPanel);
    } else {
      secretsTabEl.appendChild(panel);
    }

    const mountEl = panel.querySelector(`#${panelId}_mount`);
    try {
      await mountPluginSecretsTab(tab, mountEl);
    } catch (error) {
      if (mountEl) {
        mountEl.innerHTML = `<div class="panel-subtle">Failed to load ${escapeHtml(tab.title)}: ${escapeHtml(error.message)}</div>`;
      }
    }
  }
  activateSecretsSubtab(activeSecretsSubtabId || "secretsOverviewPanel");
}

async function renderPluginNovaTabs() {
  const novaTabEl = document.getElementById("novaTab");
  if (!(novaTabEl instanceof HTMLElement)) {
    return;
  }
  const subtabBarEl = novaTabEl.querySelector(".nova-subtab-bar");
  if (!(subtabBarEl instanceof HTMLElement)) {
    return;
  }
  const existingButtons = Array.from(subtabBarEl.querySelectorAll("[data-plugin-nova-tab='true']"));
  const existingPanels = Array.from(novaTabEl.querySelectorAll(".nova-subtab-panel[data-plugin-nova-tab='true']"));
  existingButtons.forEach((button) => button.remove());
  existingPanels.forEach((panel) => panel.remove());

  const tabs = normalizePluginUiNovaTabs();
  if (!tabs.length) {
    activateNovaSubtab(activeNovaSubtabId || "novaIdentityPanel");
    return;
  }

  for (const tab of tabs) {
    const panelId = `pluginNovaTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const button = document.createElement("button");
    button.className = "nova-subtab-button";
    button.type = "button";
    button.dataset.novaSubtabTarget = panelId;
    button.dataset.pluginNovaTab = "true";
    button.textContent = tab.title;
    button.onclick = () => activateNovaSubtab(panelId);
    subtabBarEl.appendChild(button);

    const panel = document.createElement("section");
    panel.id = panelId;
    panel.className = "nova-subtab-panel";
    panel.dataset.pluginNovaTab = "true";
    panel.dataset.pluginId = tab.pluginId;
    panel.innerHTML = `<div id="${panelId}_mount" class="plugin-tab-mount"><div class="panel-subtle">Loading ${escapeHtml(tab.title)}...</div></div>`;
    novaTabEl.appendChild(panel);

    const mountEl = panel.querySelector(`#${panelId}_mount`);
    try {
      await mountPluginNovaTab(tab, mountEl);
    } catch (error) {
      if (mountEl) {
        mountEl.innerHTML = `<div class="panel-subtle">Failed to load ${escapeHtml(tab.title)}: ${escapeHtml(error.message)}</div>`;
      }
    }
  }
  activateNovaSubtab(activeNovaSubtabId || "novaIdentityPanel");
}

function toPluginUiCamelCase(value = "") {
  const normalized = normalizePluginUiToken(value);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/[-_.]+([a-z0-9])/g, (_match, next) => String(next || "").toUpperCase());
}

function normalizePluginUiPanels() {
  const panels = Array.isArray(pluginCatalogDraft?.uiPanels)
    ? pluginCatalogDraft.uiPanels
    : [];
  const normalizedPanels = [];
  for (const panel of panels) {
    if (!panel || typeof panel !== "object") {
      continue;
    }
    const panelId = normalizePluginUiToken(panel.id || panel.panelId || panel.name || panel.title);
    const pluginId = normalizePluginUiToken(panel.pluginId || panel.plugin || "");
    if (!panelId || !pluginId) {
      continue;
    }
    const normalizedFields = Array.isArray(panel.fields)
      ? panel.fields.map((field) => {
        if (!field || typeof field !== "object") {
          return null;
        }
        const fieldId = normalizePluginUiToken(field.id || field.name || field.label);
        if (!fieldId) {
          return null;
        }
        const type = normalizePluginUiToken(field.type || "text");
        return {
          id: fieldId,
          label: String(field.label || fieldId).trim() || fieldId,
          type: ["text", "number", "checkbox", "textarea"].includes(type) ? type : "text",
          placeholder: String(field.placeholder || "").trim(),
          required: field.required === true,
          format: normalizePluginUiToken(field.format || ""),
          defaultValue: field.defaultValue
        };
      }).filter(Boolean)
      : [];
    const normalizedActions = Array.isArray(panel.actions)
      ? panel.actions.map((action) => {
        if (!action || typeof action !== "object") {
          return null;
        }
        const actionId = normalizePluginUiToken(action.id || action.name || action.label);
        const endpoint = String(action.endpoint || "").trim();
        if (!actionId || !endpoint) {
          return null;
        }
        const method = String(action.method || "GET").trim().toUpperCase() || "GET";
        return {
          id: actionId,
          label: String(action.label || actionId).trim() || actionId,
          method,
          endpoint,
          queryFields: Array.isArray(action.queryFields)
            ? action.queryFields.map((entry) => normalizePluginUiToken(entry)).filter(Boolean)
            : [],
          bodyFields: Array.isArray(action.bodyFields)
            ? action.bodyFields.map((entry) => normalizePluginUiToken(entry)).filter(Boolean)
            : [],
          staticBody: action.staticBody && typeof action.staticBody === "object"
            ? cloneJson(action.staticBody)
            : {},
          expects: normalizePluginUiToken(action.expects || "json") || "json",
          confirm: String(action.confirm || "").trim()
        };
      }).filter(Boolean)
      : [];
    normalizedPanels.push({
      id: panelId,
      pluginId,
      pluginName: String(panel.pluginName || panel.pluginId || pluginId).trim() || pluginId,
      title: String(panel.title || panel.name || panelId).trim() || panelId,
      description: String(panel.description || "").trim(),
      fields: normalizedFields,
      actions: normalizedActions
    });
  }
  return normalizedPanels.sort((left, right) => {
    const pluginCompare = String(left.pluginName || left.pluginId || "")
      .localeCompare(String(right.pluginName || right.pluginId || ""));
    if (pluginCompare !== 0) {
      return pluginCompare;
    }
    return String(left.title || left.id || "").localeCompare(String(right.title || right.id || ""));
  });
}

function pluginUiPanelKey(panel = {}) {
  const pluginId = normalizePluginUiToken(panel.pluginId || "");
  const panelId = normalizePluginUiToken(panel.id || "");
  if (!pluginId || !panelId) {
    return "";
  }
  return `${pluginId}:${panelId}`;
}

function ensurePluginDynamicPanelDraft(panel = {}) {
  const key = pluginUiPanelKey(panel);
  if (!key) {
    return {};
  }
  const existing = pluginDynamicPanelDraftByKey.get(key);
  if (existing && typeof existing === "object") {
    return existing;
  }
  const nextDraft = {};
  for (const field of Array.isArray(panel.fields) ? panel.fields : []) {
    if (!field?.id) {
      continue;
    }
    if (field.type === "checkbox") {
      nextDraft[field.id] = field.defaultValue === true;
      continue;
    }
    if (field.type === "number") {
      if (field.defaultValue == null || field.defaultValue === "") {
        nextDraft[field.id] = "";
      } else {
        const parsed = Number(field.defaultValue);
        nextDraft[field.id] = Number.isFinite(parsed) ? parsed : "";
      }
      continue;
    }
    if (field.defaultValue == null) {
      nextDraft[field.id] = "";
      continue;
    }
    if (field.format === "json" && typeof field.defaultValue === "object") {
      nextDraft[field.id] = cloneJson(field.defaultValue);
      continue;
    }
    nextDraft[field.id] = String(field.defaultValue);
  }
  pluginDynamicPanelDraftByKey.set(key, nextDraft);
  return nextDraft;
}

function prunePluginDynamicPanelDraft(allowedKeys = []) {
  const allowed = new Set(
    (Array.isArray(allowedKeys) ? allowedKeys : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
  );
  for (const key of pluginDynamicPanelDraftByKey.keys()) {
    if (!allowed.has(key)) {
      pluginDynamicPanelDraftByKey.delete(key);
    }
  }
}

function pluginFieldDisplayValue(panelKey = "", field = {}) {
  const draft = pluginDynamicPanelDraftByKey.get(panelKey) || {};
  const hasValue = Object.prototype.hasOwnProperty.call(draft, field.id);
  const rawValue = hasValue ? draft[field.id] : field.defaultValue;
  if (field.type === "checkbox") {
    return rawValue === true;
  }
  if (field.type === "number") {
    if (rawValue == null || rawValue === "") {
      return "";
    }
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? String(parsed) : "";
  }
  if (rawValue == null) {
    return "";
  }
  if (field.format === "json") {
    if (typeof rawValue === "string") {
      return rawValue;
    }
    try {
      return JSON.stringify(rawValue, null, 2);
    } catch {
      return "";
    }
  }
  return String(rawValue);
}

function renderPluginDynamicPanelField(panelKey = "", field = {}) {
  const fieldId = String(field.id || "").trim();
  if (!fieldId) {
    return "";
  }
  if (field.type === "checkbox") {
    const checked = pluginFieldDisplayValue(panelKey, field) === true;
    return `
      <label class="micro plugin-ui-checkbox">
        <input
          type="checkbox"
          data-plugin-ui-panel-key="${escapeAttr(panelKey)}"
          data-plugin-ui-field-id="${escapeAttr(fieldId)}"
          ${checked ? "checked" : ""}
        />
        ${escapeHtml(field.label || fieldId)}${field.required ? " *" : ""}
      </label>
    `;
  }
  const placeholder = String(field.placeholder || "").trim();
  const currentValue = pluginFieldDisplayValue(panelKey, field);
  const minAttr = field.min == null || Number.isNaN(Number(field.min)) ? "" : ` min="${escapeAttr(String(Number(field.min)))}"`;
  const maxAttr = field.max == null || Number.isNaN(Number(field.max)) ? "" : ` max="${escapeAttr(String(Number(field.max)))}"`;
  const stepAttr = field.step == null || Number.isNaN(Number(field.step)) ? "" : ` step="${escapeAttr(String(Number(field.step)))}"`;
  const requiredMarker = field.required ? " *" : "";
  if (field.type === "textarea") {
    return `
      <label class="stack-field plugin-ui-field">
        <strong>${escapeHtml(field.label || fieldId)}${requiredMarker}</strong>
        <textarea
          rows="4"
          data-plugin-ui-panel-key="${escapeAttr(panelKey)}"
          data-plugin-ui-field-id="${escapeAttr(fieldId)}"
          placeholder="${escapeAttr(placeholder)}"
        >${escapeHtml(String(currentValue || ""))}</textarea>
      </label>
    `;
  }
  const inputType = field.type === "number" ? "number" : "text";
  return `
    <label class="stack-field plugin-ui-field">
      <strong>${escapeHtml(field.label || fieldId)}${requiredMarker}</strong>
      <input
        type="${escapeAttr(inputType)}"
        data-plugin-ui-panel-key="${escapeAttr(panelKey)}"
        data-plugin-ui-field-id="${escapeAttr(fieldId)}"
        value="${escapeAttr(String(currentValue || ""))}"
        placeholder="${escapeAttr(placeholder)}"${minAttr}${maxAttr}${stepAttr}
      />
    </label>
  `;
}

function normalizePluginDynamicInputValue(field = {}, element = null) {
  if (!element) {
    return "";
  }
  if (field.type === "checkbox") {
    return element.checked === true;
  }
  if (field.type === "number") {
    const rawValue = String(element.value || "").trim();
    if (!rawValue) {
      return "";
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${field.label || field.id || "Field"} must be a valid number.`);
    }
    return parsed;
  }
  const rawText = String(element.value || "");
  if (field.format === "json") {
    const trimmed = rawText.trim();
    if (!trimmed) {
      return "";
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`${field.label || field.id || "Field"} must contain valid JSON.`);
    }
  }
  return rawText.trim();
}

function shouldIncludePluginDynamicValue(value) {
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return true;
  }
  return true;
}

function pluginDynamicValueToQueryValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pluginDynamicPayloadKeys(fieldId = "") {
  const normalizedFieldId = normalizePluginUiToken(fieldId);
  if (!normalizedFieldId) {
    return [];
  }
  const keys = new Set([normalizedFieldId]);
  const camelCaseKey = toPluginUiCamelCase(normalizedFieldId);
  if (camelCaseKey) {
    keys.add(camelCaseKey);
  }
  if (normalizedFieldId.endsWith("_json")) {
    const base = normalizedFieldId.slice(0, -5);
    if (base) {
      keys.add(base);
      const camelBase = toPluginUiCamelCase(base);
      if (camelBase) {
        keys.add(camelBase);
      }
    }
  }
  if (camelCaseKey && camelCaseKey.endsWith("Json")) {
    const camelBase = camelCaseKey.slice(0, -4);
    if (camelBase) {
      keys.add(camelBase);
    }
  }
  return [...keys].filter(Boolean);
}

function updatePluginDynamicPanelDraft(panelKey = "", fieldId = "", value = "") {
  const normalizedPanelKey = String(panelKey || "").trim();
  const normalizedFieldId = normalizePluginUiToken(fieldId);
  if (!normalizedPanelKey || !normalizedFieldId) {
    return;
  }
  const existing = pluginDynamicPanelDraftByKey.get(normalizedPanelKey) || {};
  pluginDynamicPanelDraftByKey.set(normalizedPanelKey, {
    ...existing,
    [normalizedFieldId]: value
  });
}

function pluginDynamicPanelElements(panelKey = "") {
  if (!pluginDynamicPanelsListEl) {
    return {
      panelRoot: null,
      statusEl: null,
      resultEl: null
    };
  }
  const panelRoot = pluginDynamicPanelsListEl.querySelector(`[data-plugin-ui-panel-key="${panelKey}"]`);
  if (!panelRoot) {
    return {
      panelRoot: null,
      statusEl: null,
      resultEl: null
    };
  }
  return {
    panelRoot,
    statusEl: panelRoot.querySelector("[data-plugin-ui-status]"),
    resultEl: panelRoot.querySelector("[data-plugin-ui-result]")
  };
}

function setPluginDynamicPanelStatus(panelKey = "", message = "") {
  const { statusEl } = pluginDynamicPanelElements(panelKey);
  if (statusEl) {
    statusEl.textContent = String(message || "").trim() || "Ready.";
  }
}

function setPluginDynamicPanelResult(panelKey = "", payload = null) {
  const { resultEl } = pluginDynamicPanelElements(panelKey);
  if (!resultEl) {
    return;
  }
  if (typeof payload === "string") {
    resultEl.textContent = payload;
    return;
  }
  resultEl.textContent = JSON.stringify(payload == null ? {} : payload, null, 2);
}

function renderPluginDynamicPanels() {
  if (!pluginDynamicPanelsListEl) {
    return;
  }
  const panels = normalizePluginUiPanels();
  const panelKeys = [];
  pluginDynamicPanelIndex = new Map();
  for (const panel of panels) {
    const panelKey = pluginUiPanelKey(panel);
    if (!panelKey) {
      continue;
    }
    panelKeys.push(panelKey);
    pluginDynamicPanelIndex.set(panelKey, panel);
    ensurePluginDynamicPanelDraft(panel);
  }
  prunePluginDynamicPanelDraft(panelKeys);
  if (!panels.length) {
    pluginDynamicPanelsListEl.innerHTML = `<div class="panel-subtle">No plugin UI panels are currently registered.</div>`;
    return;
  }
  pluginDynamicPanelsListEl.innerHTML = panels.map((panel) => {
    const panelKey = pluginUiPanelKey(panel);
    const actions = Array.isArray(panel.actions) ? panel.actions : [];
    const fields = Array.isArray(panel.fields) ? panel.fields : [];
    const actionSummary = actions.length
      ? actions.map((action) =>
        `${String(action.method || "GET").toUpperCase()} ${String(action.endpoint || "").trim()}`
      ).join(" | ")
      : "No actions registered";
    return `
      <div class="brain-row plugin-ui-panel" data-plugin-ui-panel-key="${escapeAttr(panelKey)}">
        <div class="brain-row-actions">
          <span>
            <strong>${escapeHtml(String(panel.title || panel.id || "Plugin Panel"))}</strong>
            <div class="micro">${escapeHtml(String(panel.pluginName || panel.pluginId || "Plugin"))} (${escapeHtml(String(panel.pluginId || ""))})</div>
          </span>
          <span class="brain-pill">${escapeHtml(`${actions.length} action${actions.length === 1 ? "" : "s"}`)}</span>
        </div>
        <div class="micro">${escapeHtml(String(panel.description || "No description provided."))}</div>
        <div class="plugin-ui-fields">
          ${fields.length
            ? fields.map((field) => renderPluginDynamicPanelField(panelKey, field)).join("")
            : `<div class="panel-subtle">No configurable fields.</div>`}
        </div>
        <div class="plugin-ui-actions">
          ${actions.length
            ? actions.map((action) => `
              <button
                class="secondary"
                type="button"
                data-plugin-ui-panel-key="${escapeAttr(panelKey)}"
                data-plugin-ui-action-id="${escapeAttr(String(action.id || ""))}"
              >${escapeHtml(String(action.label || action.id || "Run"))}</button>
            `).join("")
            : `<div class="panel-subtle">No actions registered.</div>`}
        </div>
        <div class="micro">${escapeHtml(actionSummary)}</div>
        <div class="micro" data-plugin-ui-status>Ready.</div>
        <pre class="json-box plugin-ui-result" data-plugin-ui-result>No action run yet.</pre>
      </div>
    `;
  }).join("");
}

async function runPluginDynamicPanelAction(button = null) {
  if (!button || !pluginDynamicPanelsListEl) {
    return;
  }
  const panelKey = String(button.dataset.pluginUiPanelKey || "").trim();
  const actionId = normalizePluginUiToken(button.dataset.pluginUiActionId || "");
  if (!panelKey || !actionId) {
    return;
  }
  const panel = pluginDynamicPanelIndex.get(panelKey);
  if (!panel) {
    return;
  }
  const action = (Array.isArray(panel.actions) ? panel.actions : [])
    .find((entry) => normalizePluginUiToken(entry.id) === actionId);
  if (!action) {
    return;
  }
  const { panelRoot } = pluginDynamicPanelElements(panelKey);
  if (!panelRoot) {
    return;
  }
  button.disabled = true;
  try {
    const fieldValues = {};
    for (const field of Array.isArray(panel.fields) ? panel.fields : []) {
      const input = panelRoot.querySelector(`[data-plugin-ui-field-id="${field.id}"]`);
      if (!input) {
        continue;
      }
      const value = normalizePluginDynamicInputValue(field, input);
      fieldValues[field.id] = value;
      updatePluginDynamicPanelDraft(panelKey, field.id, value);
    }
    const referencedFieldIds = new Set([
      ...(Array.isArray(action.queryFields) ? action.queryFields : []),
      ...(Array.isArray(action.bodyFields) ? action.bodyFields : [])
    ]);
    for (const field of Array.isArray(panel.fields) ? panel.fields : []) {
      if (!field.required || !referencedFieldIds.has(field.id)) {
        continue;
      }
      if (!shouldIncludePluginDynamicValue(fieldValues[field.id])) {
        throw new Error(`${field.label || field.id || "Required field"} is required.`);
      }
    }
    if (action.confirm && typeof window !== "undefined" && typeof window.confirm === "function") {
      const confirmed = window.confirm(action.confirm);
      if (!confirmed) {
        setPluginDynamicPanelStatus(panelKey, "Action cancelled.");
        return;
      }
    }
    const method = String(action.method || "GET").trim().toUpperCase() || "GET";
    const query = new URLSearchParams();
    for (const fieldId of Array.isArray(action.queryFields) ? action.queryFields : []) {
      const value = fieldValues[fieldId];
      if (!shouldIncludePluginDynamicValue(value)) {
        continue;
      }
      for (const key of pluginDynamicPayloadKeys(fieldId)) {
        query.set(key, pluginDynamicValueToQueryValue(value));
      }
    }
    const queryString = query.toString();
    const endpoint = String(action.endpoint || "").trim();
    const requestPath = queryString
      ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}${queryString}`
      : endpoint;
    let requestBody = null;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const body = cloneJson(action.staticBody || {});
      for (const fieldId of Array.isArray(action.bodyFields) ? action.bodyFields : []) {
        const value = fieldValues[fieldId];
        if (!shouldIncludePluginDynamicValue(value)) {
          continue;
        }
        for (const key of pluginDynamicPayloadKeys(fieldId)) {
          body[key] = value;
        }
      }
      requestBody = JSON.stringify(body);
    }
    setPluginDynamicPanelStatus(panelKey, `Running ${action.label || action.id || "action"}...`);
    const runFetch = /^\/api\/plugins(?:\/|$)/i.test(requestPath)
      ? pluginAdminFetch
      : fetch;
    const response = await runFetch(requestPath, {
      method,
      headers: requestBody == null ? {} : { "content-type": "application/json" },
      body: requestBody
    });
    const rawBody = await response.text();
    const expectsText = action.expects === "text";
    let payload = rawBody;
    if (!expectsText) {
      if (!rawBody) {
        payload = {};
      } else {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = {
            ok: response.ok,
            raw: rawBody
          };
        }
      }
    }
    const payloadError = !expectsText && payload && typeof payload === "object"
      ? String(payload.error || payload.message || "").trim()
      : "";
    if (!response.ok || payloadError) {
      throw new Error(payloadError || rawBody || `request failed (${response.status})`);
    }
    setPluginDynamicPanelStatus(panelKey, `Completed ${action.label || action.id || "action"}.`);
    setPluginDynamicPanelResult(panelKey, payload);
    if (/^\/api\/plugins\/[^/]+\/toggle(?:\?|$)/i.test(requestPath)) {
      await loadPluginManagerPanel({ silent: true });
    }
  } catch (error) {
    setPluginDynamicPanelStatus(panelKey, `Action failed: ${error.message}`);
    setPluginDynamicPanelResult(panelKey, String(error?.message || error || "unknown error"));
  } finally {
    button.disabled = false;
  }
}

function bindPluginDynamicPanelEvents() {
  if (!pluginDynamicPanelsListEl || pluginDynamicPanelEventsBound) {
    return;
  }
  pluginDynamicPanelsListEl.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const panelKey = String(target.getAttribute("data-plugin-ui-panel-key") || "").trim();
    const fieldId = normalizePluginUiToken(target.getAttribute("data-plugin-ui-field-id") || "");
    if (!panelKey || !fieldId) {
      return;
    }
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      updatePluginDynamicPanelDraft(panelKey, fieldId, target.checked === true);
      return;
    }
    if ("value" in target) {
      updatePluginDynamicPanelDraft(panelKey, fieldId, String(target.value || ""));
    }
  });

  pluginDynamicPanelsListEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const actionButton = target.closest("[data-plugin-ui-action-id]");
    if (!(actionButton instanceof HTMLButtonElement)) {
      return;
    }
    runPluginDynamicPanelAction(actionButton).catch((error) => {
      console.warn("plugin dynamic panel action failed", error);
    });
  });
  pluginDynamicPanelEventsBound = true;
}

function setPluginControlsAvailability() {
  const hasPermissionRules = isPluginInstalled("security");
  if (refreshPluginPermissionsBtn) {
    refreshPluginPermissionsBtn.disabled = !hasPermissionRules;
  }
  if (savePluginPermissionsBtn) {
    savePluginPermissionsBtn.disabled = !hasPermissionRules;
  }
  if (pluginPermissionRulesEditorEl) {
    pluginPermissionRulesEditorEl.disabled = !hasPermissionRules;
    if (!hasPermissionRules) {
      pluginPermissionRulesEditorEl.value = "";
    }
  }
  if (pluginPermissionRulesStatusEl && !hasPermissionRules) {
    pluginPermissionRulesStatusEl.textContent = "Permission Rules plugin is not installed.";
  }

  const hasSessionMemory = isPluginInstalled("session-memory");
  if (refreshPluginSessionMemoryBtn) {
    refreshPluginSessionMemoryBtn.disabled = !hasSessionMemory;
  }
  if (capturePluginSessionMemoryBtn) {
    capturePluginSessionMemoryBtn.disabled = !hasSessionMemory;
  }
  if (pluginSessionTaskIdEl) {
    pluginSessionTaskIdEl.disabled = !hasSessionMemory;
    if (!hasSessionMemory) {
      pluginSessionTaskIdEl.value = "";
    }
  }
  if (!hasSessionMemory) {
    if (pluginSessionMemoryStatusEl) {
      pluginSessionMemoryStatusEl.textContent = "Session Memory plugin is not installed.";
    }
    if (pluginSessionMemoryResultEl) {
      pluginSessionMemoryResultEl.textContent = "Session Memory plugin is not installed.";
    }
  }

  const hasTaskLifecycle = isPluginInstalled("task-lifecycle");
  if (refreshPluginTaskLifecycleBtn) {
    refreshPluginTaskLifecycleBtn.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleTaskIdEl) {
    pluginTaskLifecycleTaskIdEl.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleTimeoutMsEl) {
    pluginTaskLifecycleTimeoutMsEl.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleCreateMessageEl) {
    pluginTaskLifecycleCreateMessageEl.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleCreateBtn) {
    pluginTaskLifecycleCreateBtn.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleOutputBtn) {
    pluginTaskLifecycleOutputBtn.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleWaitBtn) {
    pluginTaskLifecycleWaitBtn.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleStopBtn) {
    pluginTaskLifecycleStopBtn.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleForceStopEl) {
    pluginTaskLifecycleForceStopEl.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleAnswerEl) {
    pluginTaskLifecycleAnswerEl.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleAnswerBtn) {
    pluginTaskLifecycleAnswerBtn.disabled = !hasTaskLifecycle;
  }
  if (!hasTaskLifecycle) {
    if (pluginTaskLifecycleStatusEl) {
      pluginTaskLifecycleStatusEl.textContent = "Task Lifecycle plugin is not installed.";
    }
    if (pluginTaskLifecycleResultEl) {
      pluginTaskLifecycleResultEl.textContent = "Task Lifecycle plugin is not installed.";
    }
  }

  const hasCronHardening = isPluginInstalled("security");
  if (refreshPluginCronBtn) {
    refreshPluginCronBtn.disabled = !hasCronHardening;
  }
  if (!hasCronHardening && pluginCronStatusEl) {
    pluginCronStatusEl.textContent = "Cron Hardening plugin is not installed.";
  }
}

function renderPluginManagerPanel() {
  if (!pluginInventoryListEl || !pluginCapabilityListEl || !pluginRouteListEl) {
    return;
  }
  bindPluginDynamicPanelEvents();
  const plugins = getInstalledPlugins();
  if (!plugins.length) {
    pluginInventoryListEl.innerHTML = `<div class="panel-subtle">No plugins are currently loaded.</div>`;
    pluginCapabilityListEl.innerHTML = `<div class="panel-subtle">No plugin capabilities are currently registered.</div>`;
    pluginRouteListEl.innerHTML = `<div class="panel-subtle">No plugin routes are currently registered.</div>`;
    renderPluginDynamicPanels();
    setPluginControlsAvailability();
    return;
  }

  pluginInventoryListEl.innerHTML = plugins.map((plugin) => {
    const enabled = plugin.enabled !== false;
    const pluginId = String(plugin.id || "").trim();
    const capabilityCount = Number(plugin.capabilityCount || (Array.isArray(plugin.capabilities) ? plugin.capabilities.length : 0) || 0);
    const routeCount = Number(plugin.routeCount || (Array.isArray(plugin.routes) ? plugin.routes.length : 0) || 0);
    const hookCount = Number(plugin.hookCount || (Array.isArray(plugin.hooks) ? plugin.hooks.length : 0) || 0);
    return `
      <div class="brain-row">
        <div class="brain-row-actions">
          <label class="toggle plugin-toggle-row">
            <input type="checkbox" data-plugin-toggle-id="${escapeAttr(pluginId)}" ${enabled ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(String(plugin.name || plugin.id || "Plugin"))}</strong>
              <div class="micro">${escapeHtml(pluginId)} - v${escapeHtml(String(plugin.version || "0.0.0"))}</div>
            </span>
          </label>
          <span class="brain-pill plugin-enabled-pill ${enabled ? "on" : "off"}">${enabled ? "enabled" : "disabled"}</span>
        </div>
        <div class="micro">${escapeHtml(String(plugin.description || "No description provided."))}</div>
        <div class="micro">${escapeHtml(`${capabilityCount} cap${capabilityCount === 1 ? "" : "s"} - ${routeCount} route${routeCount === 1 ? "" : "s"} - ${hookCount} hook${hookCount === 1 ? "" : "s"}`)}</div>
      </div>
    `;
  }).join("");
  pluginInventoryListEl.querySelectorAll("[data-plugin-toggle-id]").forEach((inputEl) => {
    if (!(inputEl instanceof HTMLInputElement)) {
      return;
    }
    inputEl.onchange = async () => {
      const pluginId = String(inputEl.dataset.pluginToggleId || "").trim();
      if (!pluginId) {
        return;
      }
      const enabled = inputEl.checked === true;
      inputEl.disabled = true;
      pluginsHintEl.textContent = `${enabled ? "Enabling" : "Disabling"} ${pluginId}...`;
      try {
        const response = await pluginAdminFetch(`/api/plugins/${encodeURIComponent(pluginId)}/toggle`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `failed to toggle ${pluginId}`);
        }
        await loadPluginManagerPanel({ silent: true });
        pluginsHintEl.textContent = `${pluginId} ${enabled ? "enabled" : "disabled"}.`;
      } catch (error) {
        inputEl.checked = !enabled;
        pluginsHintEl.textContent = `Toggle failed for ${pluginId}: ${error.message}`;
      } finally {
        inputEl.disabled = false;
      }
    };
  });

  const capabilityProviders = new Map();
  for (const plugin of plugins) {
    const pluginLabel = String(plugin.name || plugin.id || "Plugin").trim() || "Plugin";
    const capabilities = Array.isArray(plugin.capabilities) ? plugin.capabilities : [];
    for (const capability of capabilities) {
      const capabilityName = String(capability || "").trim();
      if (!capabilityName) {
        continue;
      }
      const providers = capabilityProviders.get(capabilityName) || [];
      providers.push(pluginLabel);
      capabilityProviders.set(capabilityName, [...new Set(providers)]);
    }
  }
  const capabilityEntries = [...capabilityProviders.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  pluginCapabilityListEl.innerHTML = capabilityEntries.length
    ? capabilityEntries.map(([capabilityName, providers]) => `
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>${escapeHtml(capabilityName)}</strong>
          <span class="brain-pill">${escapeHtml(`${providers.length} provider${providers.length === 1 ? "" : "s"}`)}</span>
        </div>
        <div class="micro">${escapeHtml(providers.join(", "))}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No plugin capabilities are currently registered.</div>`;

  const routePlugins = plugins
    .map((plugin) => ({
      id: String(plugin.id || "").trim(),
      name: String(plugin.name || plugin.id || "Plugin").trim() || "Plugin",
      routes: Array.isArray(plugin.routes) ? plugin.routes : []
    }))
    .filter((entry) => entry.routes.length);

  pluginRouteListEl.innerHTML = routePlugins.length
    ? routePlugins.map((plugin) => `
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>${escapeHtml(plugin.name)}</strong>
          <span class="brain-pill">${escapeHtml(`${plugin.routes.length} route${plugin.routes.length === 1 ? "" : "s"}`)}</span>
        </div>
        <div class="micro">${escapeHtml(plugin.id)}</div>
        <div class="plugin-route-stack">
          ${plugin.routes.map((route) => `
            <div class="plugin-route-item">
              <span class="plugin-route-method">${escapeHtml(String(route.method || "GET").toUpperCase())}</span>
              <span>${escapeHtml(String(route.path || ""))}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No plugin routes are currently registered.</div>`;

  renderPluginDynamicPanels();
  setPluginControlsAvailability();
}

async function loadPluginPermissionRules(options = {}) {
  if (!pluginPermissionRulesEditorEl || !pluginPermissionRulesStatusEl) {
    return;
  }
  if (!isPluginInstalled("security")) {
    setPluginControlsAvailability();
    return;
  }
  if (!options.silent) {
    pluginPermissionRulesStatusEl.textContent = "Loading permission rules...";
  }
  try {
    const r = await pluginAdminFetch("/api/plugins/security/permissions/rules");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load permission rules");
    }
    pluginPermissionRulesDraft = cloneJson(j.rules || {});
    pluginPermissionRulesEditorEl.value = `${JSON.stringify(pluginPermissionRulesDraft, null, 2)}\n`;
    const ruleCount = Array.isArray(pluginPermissionRulesDraft.rules) ? pluginPermissionRulesDraft.rules.length : 0;
    pluginPermissionRulesStatusEl.textContent = `Loaded permission rules (${ruleCount} rule${ruleCount === 1 ? "" : "s"}).`;
  } catch (error) {
    pluginPermissionRulesStatusEl.textContent = `Failed to load permission rules: ${error.message}`;
  }
}

async function savePluginPermissionRules() {
  if (!pluginPermissionRulesEditorEl || !pluginPermissionRulesStatusEl || !savePluginPermissionsBtn) {
    return;
  }
  if (!isPluginInstalled("security")) {
    setPluginControlsAvailability();
    return;
  }
  const rawValue = String(pluginPermissionRulesEditorEl.value || "").trim();
  if (!rawValue) {
    pluginPermissionRulesStatusEl.textContent = "Enter rules JSON first.";
    return;
  }
  savePluginPermissionsBtn.disabled = true;
  pluginPermissionRulesStatusEl.textContent = "Saving permission rules...";
  try {
    const parsed = JSON.parse(rawValue);
    const r = await pluginAdminFetch("/api/plugins/security/permissions/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed)
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to save permission rules");
    }
    pluginPermissionRulesDraft = cloneJson(j.rules || {});
    pluginPermissionRulesEditorEl.value = `${JSON.stringify(pluginPermissionRulesDraft, null, 2)}\n`;
    const ruleCount = Array.isArray(pluginPermissionRulesDraft.rules) ? pluginPermissionRulesDraft.rules.length : 0;
    pluginPermissionRulesStatusEl.textContent = `Saved permission rules (${ruleCount} rule${ruleCount === 1 ? "" : "s"}).`;
  } catch (error) {
    pluginPermissionRulesStatusEl.textContent = `Save failed: ${error.message}`;
  } finally {
    savePluginPermissionsBtn.disabled = false;
  }
}

function getPluginLifecycleTaskId() {
  const value = String(pluginTaskLifecycleTaskIdEl?.value || "").trim();
  if (value) {
    pluginTaskLifecycleLastTaskId = value;
    return value;
  }
  return String(pluginTaskLifecycleLastTaskId || "").trim();
}

function setPluginLifecycleTaskId(taskId = "") {
  const normalized = String(taskId || "").trim();
  if (!normalized) {
    return;
  }
  pluginTaskLifecycleLastTaskId = normalized;
  if (pluginTaskLifecycleTaskIdEl) {
    pluginTaskLifecycleTaskIdEl.value = normalized;
  }
}

async function requestPluginLifecycle(path, options = {}) {
  const response = await pluginAdminFetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `request failed (${response.status})`);
  }
  return payload;
}

async function loadPluginTaskLifecycleOutput() {
  if (!pluginTaskLifecycleStatusEl || !pluginTaskLifecycleResultEl) {
    return;
  }
  if (!isPluginInstalled("task-lifecycle")) {
    setPluginControlsAvailability();
    return;
  }
  const taskId = getPluginLifecycleTaskId();
  if (!taskId) {
    pluginTaskLifecycleStatusEl.textContent = "Enter a task ID first.";
    return;
  }
  pluginTaskLifecycleStatusEl.textContent = `Loading task output for ${taskId}...`;
  try {
    const payload = await requestPluginLifecycle(`/api/plugins/tasks/output?taskId=${encodeURIComponent(taskId)}`);
    setPluginLifecycleTaskId(payload.output?.taskId || taskId);
    const status = String(payload.output?.status || "").trim() || "unknown";
    pluginTaskLifecycleStatusEl.textContent = `Loaded ${taskId} (${status}).`;
    pluginTaskLifecycleResultEl.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    pluginTaskLifecycleStatusEl.textContent = `Failed to load task output: ${error.message}`;
    pluginTaskLifecycleResultEl.textContent = String(error?.message || error || "unknown error");
  }
}

async function waitForPluginTaskLifecycleTask() {
  if (!pluginTaskLifecycleStatusEl || !pluginTaskLifecycleResultEl || !pluginTaskLifecycleWaitBtn) {
    return;
  }
  if (!isPluginInstalled("task-lifecycle")) {
    setPluginControlsAvailability();
    return;
  }
  const taskId = getPluginLifecycleTaskId();
  if (!taskId) {
    pluginTaskLifecycleStatusEl.textContent = "Enter a task ID first.";
    return;
  }
  const timeoutMs = Math.max(1000, Math.min(Number(pluginTaskLifecycleTimeoutMsEl?.value || 30000), 10 * 60 * 1000));
  pluginTaskLifecycleWaitBtn.disabled = true;
  pluginTaskLifecycleStatusEl.textContent = `Waiting for ${taskId} (${timeoutMs}ms timeout)...`;
  try {
    const payload = await requestPluginLifecycle(
      `/api/plugins/tasks/wait?taskId=${encodeURIComponent(taskId)}&timeoutMs=${encodeURIComponent(String(timeoutMs))}`
    );
    setPluginLifecycleTaskId(payload.output?.taskId || taskId);
    const status = String(payload.status || payload.output?.status || "").trim() || "unknown";
    pluginTaskLifecycleStatusEl.textContent = payload.done
      ? `Task ${taskId} reached ${status}.`
      : `Task ${taskId} is still ${status}.`;
    pluginTaskLifecycleResultEl.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    pluginTaskLifecycleStatusEl.textContent = `Wait failed: ${error.message}`;
    pluginTaskLifecycleResultEl.textContent = String(error?.message || error || "unknown error");
  } finally {
    pluginTaskLifecycleWaitBtn.disabled = false;
  }
}

async function createPluginLifecycleTask() {
  if (!pluginTaskLifecycleStatusEl || !pluginTaskLifecycleResultEl || !pluginTaskLifecycleCreateBtn) {
    return;
  }
  if (!isPluginInstalled("task-lifecycle")) {
    setPluginControlsAvailability();
    return;
  }
  const message = String(pluginTaskLifecycleCreateMessageEl?.value || "").trim();
  if (!message) {
    pluginTaskLifecycleStatusEl.textContent = "Enter a message for the task first.";
    return;
  }
  pluginTaskLifecycleCreateBtn.disabled = true;
  pluginTaskLifecycleStatusEl.textContent = "Creating queued task...";
  try {
    const payload = await requestPluginLifecycle("/api/plugins/tasks/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        sessionId: "Main",
        internetEnabled: true,
        selectedMountIds: getSelectedMountIds(),
        forceToolUse: forceToolUseEl.checked,
        requireWorkerPreflight: requireWorkerPreflightEl.checked,
        notes: "Task created via Plugins > Task Lifecycle panel."
      })
    });
    const taskId = String(payload.task?.id || "").trim();
    if (taskId) {
      setPluginLifecycleTaskId(taskId);
    }
    pluginTaskLifecycleStatusEl.textContent = taskId
      ? `Created task ${taskId}.`
      : "Created task.";
    pluginTaskLifecycleResultEl.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    pluginTaskLifecycleStatusEl.textContent = `Create failed: ${error.message}`;
    pluginTaskLifecycleResultEl.textContent = String(error?.message || error || "unknown error");
  } finally {
    pluginTaskLifecycleCreateBtn.disabled = false;
  }
}

async function stopPluginLifecycleTask() {
  if (!pluginTaskLifecycleStatusEl || !pluginTaskLifecycleResultEl || !pluginTaskLifecycleStopBtn) {
    return;
  }
  if (!isPluginInstalled("task-lifecycle")) {
    setPluginControlsAvailability();
    return;
  }
  const taskId = getPluginLifecycleTaskId();
  if (!taskId) {
    pluginTaskLifecycleStatusEl.textContent = "Enter a task ID first.";
    return;
  }
  const force = pluginTaskLifecycleForceStopEl?.checked === true;
  pluginTaskLifecycleStopBtn.disabled = true;
  pluginTaskLifecycleStatusEl.textContent = `Stopping ${taskId}...`;
  try {
    const payload = await requestPluginLifecycle("/api/plugins/tasks/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        force,
        reason: force
          ? "Force-stopped from Plugins > Task Lifecycle panel."
          : "Stopped from Plugins > Task Lifecycle panel."
      })
    });
    setPluginLifecycleTaskId(String(payload.task?.id || taskId).trim());
    pluginTaskLifecycleStatusEl.textContent = `Stop request applied to ${taskId}.`;
    pluginTaskLifecycleResultEl.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    pluginTaskLifecycleStatusEl.textContent = `Stop failed: ${error.message}`;
    pluginTaskLifecycleResultEl.textContent = String(error?.message || error || "unknown error");
  } finally {
    pluginTaskLifecycleStopBtn.disabled = false;
  }
}

async function answerPluginLifecycleTask() {
  if (!pluginTaskLifecycleStatusEl || !pluginTaskLifecycleResultEl || !pluginTaskLifecycleAnswerBtn) {
    return;
  }
  if (!isPluginInstalled("task-lifecycle")) {
    setPluginControlsAvailability();
    return;
  }
  const taskId = getPluginLifecycleTaskId();
  if (!taskId) {
    pluginTaskLifecycleStatusEl.textContent = "Enter a task ID first.";
    return;
  }
  const answer = String(pluginTaskLifecycleAnswerEl?.value || "").trim();
  if (!answer) {
    pluginTaskLifecycleStatusEl.textContent = "Enter an answer first.";
    return;
  }
  pluginTaskLifecycleAnswerBtn.disabled = true;
  pluginTaskLifecycleStatusEl.textContent = `Sending answer for ${taskId}...`;
  try {
    const payload = await requestPluginLifecycle("/api/plugins/tasks/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        answer,
        sessionId: "Main"
      })
    });
    setPluginLifecycleTaskId(String(payload.task?.id || taskId).trim());
    pluginTaskLifecycleStatusEl.textContent = `Answer recorded for ${taskId}.`;
    pluginTaskLifecycleResultEl.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    pluginTaskLifecycleStatusEl.textContent = `Answer failed: ${error.message}`;
    pluginTaskLifecycleResultEl.textContent = String(error?.message || error || "unknown error");
  } finally {
    pluginTaskLifecycleAnswerBtn.disabled = false;
  }
}

async function loadPluginSessionMemoryState(options = {}) {
  if (!pluginSessionMemoryStatusEl || !pluginSessionMemoryResultEl) {
    return;
  }
  if (!isPluginInstalled("session-memory")) {
    setPluginControlsAvailability();
    return;
  }
  if (!options.silent) {
    pluginSessionMemoryStatusEl.textContent = "Loading session memory state...";
  }
  try {
    const r = await pluginAdminFetch("/api/plugins/session-memory/state");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load session memory state");
    }
    const processedCount = Array.isArray(j.state?.processed) ? j.state.processed.length : 0;
    const memoryPath = String(j.memoryPath || "").trim();
    pluginSessionMemoryStatusEl.textContent = `${processedCount} task snapshot${processedCount === 1 ? "" : "s"} captured${memoryPath ? ` in ${memoryPath}` : ""}.`;
    pluginSessionMemoryResultEl.textContent = JSON.stringify(j, null, 2);
  } catch (error) {
    pluginSessionMemoryStatusEl.textContent = `Failed to load session memory state: ${error.message}`;
    pluginSessionMemoryResultEl.textContent = String(error?.message || error || "unknown error");
  }
}

async function capturePluginSessionMemoryTask() {
  if (!pluginSessionTaskIdEl || !pluginSessionMemoryStatusEl || !capturePluginSessionMemoryBtn) {
    return;
  }
  if (!isPluginInstalled("session-memory")) {
    setPluginControlsAvailability();
    return;
  }
  const taskId = String(pluginSessionTaskIdEl.value || "").trim();
  if (!taskId) {
    pluginSessionMemoryStatusEl.textContent = "Enter a task ID first.";
    return;
  }
  capturePluginSessionMemoryBtn.disabled = true;
  pluginSessionMemoryStatusEl.textContent = `Capturing session memory for ${taskId}...`;
  try {
    const r = await pluginAdminFetch("/api/plugins/session-memory/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to capture session memory");
    }
    const captured = j.result?.captured === true;
    const reason = String(j.result?.reason || "").trim();
    pluginSessionMemoryStatusEl.textContent = captured
      ? `Captured session memory for ${taskId}.`
      : `Capture skipped for ${taskId}${reason ? ` (${reason.replaceAll("_", " ")})` : ""}.`;
    pluginSessionMemoryResultEl.textContent = JSON.stringify(j, null, 2);
    await loadPluginSessionMemoryState({ silent: true });
  } catch (error) {
    pluginSessionMemoryStatusEl.textContent = `Capture failed: ${error.message}`;
    pluginSessionMemoryResultEl.textContent = String(error?.message || error || "unknown error");
  } finally {
    capturePluginSessionMemoryBtn.disabled = false;
  }
}

async function loadPluginCronHardeningStatus(options = {}) {
  if (!pluginCronStatusEl) {
    return;
  }
  if (!isPluginInstalled("security")) {
    setPluginControlsAvailability();
    return;
  }
  if (!options.silent) {
    pluginCronStatusEl.textContent = "Loading cron hardening status...";
  }
  try {
    const r = await pluginAdminFetch("/api/plugins/security/cron/status");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load cron hardening status");
    }
    pluginCronStatusEl.textContent = JSON.stringify(j.status || {}, null, 2);
  } catch (error) {
    pluginCronStatusEl.textContent = `Failed to load cron hardening status: ${error.message}`;
  }
}

async function loadPluginManagerPanel(options = {}) {
  if (!pluginsHintEl) {
    return;
  }
  window.dispatchEvent(new CustomEvent("observer:plugin-load-state", {
    detail: {
      phase: "started",
      at: Date.now(),
      source: "loadPluginManagerPanel"
    }
  }));
  if (!options.silent) {
    pluginsHintEl.textContent = "Loading plugin manager...";
  }
  let catalog = null;
  try {
    const r = await pluginAdminFetch("/api/plugins/list");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load plugin manager");
    }
    catalog = cloneJson(j);
  } catch (error) {
    pluginCatalogDraft = null;
    window.dispatchEvent(new CustomEvent("observer:plugin-load-state", {
      detail: {
        phase: "failed",
        at: Date.now(),
        source: "loadPluginManagerPanel",
        error: String(error?.message || error || "failed to load plugin manager")
      }
    }));
    await renderPluginTopLevelTabs();
    await renderPluginNovaTabs();
    await renderPluginSecretsTabs();
    if (observerApp && typeof observerApp === "object") {
      delete observerApp.loadProjectsPluginPanel;
      delete observerApp.refreshPluginNovaTabs;
      delete observerApp.refreshStateBrowserPlugin;
      delete observerApp.refreshPluginSecretsTabs;
    }
    renderPluginManagerPanel();
    pluginsHintEl.textContent = `Failed to load plugin manager: ${error.message}`;
    return;
  }

  pluginCatalogDraft = catalog;

  try {
    await renderPluginTopLevelTabs();
  } catch (error) {
    console.warn("failed to render plugin top-level tabs", error);
  }

  try {
    await renderPluginNovaTabs();
  } catch (error) {
    console.warn("failed to render plugin nova tabs", error);
  }

  try {
    await renderPluginSecretsTabs();
  } catch (error) {
    console.warn("failed to render plugin secrets tabs", error);
  }

  if (!isPluginInstalled("projects") && observerApp && typeof observerApp === "object") {
    delete observerApp.loadProjectsPluginPanel;
  }
  if (!isPluginInstalled("state-browser") && observerApp && typeof observerApp === "object") {
    delete observerApp.refreshStateBrowserPlugin;
  }
  if (observerApp && typeof observerApp === "object") {
    if (normalizePluginUiNovaTabs().length) {
      observerApp.refreshPluginNovaTabs = (options = {}) => refreshPluginNovaTabs(options);
    } else {
      delete observerApp.refreshPluginNovaTabs;
    }
    if (normalizePluginUiSecretsTabs().length) {
      observerApp.refreshPluginSecretsTabs = (options = {}) => refreshPluginSecretsTabs(options);
    } else {
      delete observerApp.refreshPluginSecretsTabs;
    }
  }

  try {
    renderPluginManagerPanel();
  } catch (error) {
    console.warn("failed to render plugin manager panel", error);
  }

  const pluginCount = getInstalledPlugins().length;
  const capabilityCount = Array.isArray(pluginCatalogDraft?.capabilities) ? pluginCatalogDraft.capabilities.length : 0;
  pluginsHintEl.textContent = `Loaded ${pluginCount} plugin${pluginCount === 1 ? "" : "s"} with ${capabilityCount} ${capabilityCount === 1 ? "capability" : "capabilities"}.`;
  window.dispatchEvent(new CustomEvent("observer:plugin-load-state", {
    detail: {
      phase: "completed",
      at: Date.now(),
      source: "loadPluginManagerPanel",
      pluginCount,
      capabilityCount
    }
  }));
  if (options.loadDiagnostics !== false) {
    const taskLifecyclePromise = getPluginLifecycleTaskId()
      ? loadPluginTaskLifecycleOutput()
      : Promise.resolve();
    await Promise.allSettled([
      loadPluginPermissionRules({ silent: true }),
      taskLifecyclePromise,
      loadPluginSessionMemoryState({ silent: true }),
      loadPluginCronHardeningStatus({ silent: true })
    ]);
  }
}

function renderSecretPresenceLabel(hasSecret) {
  return hasSecret ? "Stored" : "Missing";
}

function renderSecretPresenceTone(hasSecret) {
  return hasSecret ? "tone-ok" : "tone-warn";
}

function renderSecretsCatalogEditor() {
  if (!secretsOverviewListEl || !secretsRetrievalListEl || !secretsCustomListEl) {
    return;
  }
  if (!secretsCatalogDraft) {
    const unavailable = `<div class="panel-subtle">Secure keystore status is unavailable.</div>`;
    secretsOverviewListEl.innerHTML = unavailable;
    secretsRetrievalListEl.innerHTML = unavailable;
    secretsCustomListEl.innerHTML = unavailable;
    return;
  }
  const mail = secretsCatalogDraft.mail && typeof secretsCatalogDraft.mail === "object" ? secretsCatalogDraft.mail : { agents: [] };
  const wordpress = secretsCatalogDraft.wordpress && typeof secretsCatalogDraft.wordpress === "object" ? secretsCatalogDraft.wordpress : { sites: [] };
  const retrieval = secretsCatalogDraft.retrieval && typeof secretsCatalogDraft.retrieval === "object" ? secretsCatalogDraft.retrieval : {};
  const suggestedHandles = Array.isArray(secretsCatalogDraft.suggestedHandles) ? secretsCatalogDraft.suggestedHandles : [];
  const mailAgents = Array.isArray(mail.agents) ? mail.agents : [];
  const wordpressSites = Array.isArray(wordpress.sites) ? wordpress.sites : [];
  const mailStoredCount = mailAgents.filter((entry) => entry.hasSecret).length;
  const wordpressStoredCount = wordpressSites.filter((entry) => entry.hasSecret).length;
  const totalTracked = mailAgents.length + wordpressSites.length + (retrieval.apiKeyHandle ? 1 : 0);
  const totalStored = mailStoredCount + wordpressStoredCount + (retrieval.hasSecret ? 1 : 0);

  secretsOverviewListEl.innerHTML = `
    <div class="access-summary">
      <div class="summary-box">
        <strong>Keystore</strong>
        <div class="summary-pill">${escapeHtml(String(secretsCatalogDraft.serviceName || "openclaw-observer"))}</div>
        <div class="micro">System credential backend used by Nova.</div>
      </div>
      <div class="summary-box">
        <strong>Tracked handles</strong>
        <div class="summary-pill">${escapeHtml(String(totalTracked))}</div>
        <div class="micro">Named integration secrets currently mapped into the UI.</div>
      </div>
      <div class="summary-box">
        <strong>Stored</strong>
        <div class="summary-pill">${escapeHtml(String(totalStored))}</div>
        <div class="micro">Tracked integration secrets already present in the keystore.</div>
      </div>
    </div>
    <div class="stack-list">
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>Mail coverage</strong>
          <span class="brain-pill">${escapeHtml(`${mailStoredCount}/${mailAgents.length || 0}`)}</span>
        </div>
        <div class="micro">${mail.enabled ? "Mail is enabled." : "Mail is disabled."} Active agent: ${escapeHtml(mail.activeAgentId || "(none)")}. Configure passwords from the Mail plugin tab in Secrets.</div>
      </div>
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>WordPress coverage</strong>
          <span class="brain-pill">${escapeHtml(`${wordpressStoredCount}/${wordpressSites.length || 0}`)}</span>
        </div>
        <div class="micro">${wordpressSites.length ? "Bridge sites are being tracked through the WordPress plugin tab in Secrets." : "No WordPress bridge sites are configured."}</div>
      </div>
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>Retrieval coverage</strong>
          <span class="brain-pill">${escapeHtml(renderSecretPresenceLabel(retrieval.hasSecret))}</span>
        </div>
        <div class="micro">Qdrant collection: ${escapeHtml(retrieval.collectionName || "observer_chunks")} at ${escapeHtml(retrieval.qdrantUrl || "unconfigured")}.</div>
      </div>
    </div>
  `;

  if (retrieval.apiKeyHandle) {
    const inputId = `secret-input-${hashId(`retrieval:${retrieval.apiKeyHandle}`)}`;
    secretsRetrievalListEl.innerHTML = `
      <div class="secret-card">
        <div class="panel-head compact">
          <div>
            <strong>Qdrant API Key</strong>
            <div class="panel-subtle">${escapeHtml(retrieval.qdrantUrl || "http://127.0.0.1:6333")} | collection ${escapeHtml(retrieval.collectionName || "observer_chunks")}</div>
          </div>
          <span class="brain-pill ${renderSecretPresenceTone(retrieval.hasSecret)}">${escapeHtml(renderSecretPresenceLabel(retrieval.hasSecret))}</span>
        </div>
        <div class="micro"><strong>Handle:</strong> <code>${escapeHtml(retrieval.apiKeyHandle)}</code></div>
        <div class="controls secret-controls">
          <input id="${escapeAttr(inputId)}" type="password" placeholder="Enter Qdrant API key" />
          <button class="secondary" type="button" data-secret-set="${escapeAttr(retrieval.apiKeyHandle)}" data-secret-input-id="${escapeAttr(inputId)}">Store</button>
          <button class="secondary" type="button" data-secret-clear="${escapeAttr(retrieval.apiKeyHandle)}">Clear</button>
        </div>
      </div>
    `;
  } else {
    secretsRetrievalListEl.innerHTML = `<div class="panel-subtle">Retrieval is not configured with a tracked API key handle.</div>`;
  }

  secretsCustomListEl.innerHTML = `
    <div class="stack-list">
      <label class="stack-field">
        <strong>Handle</strong>
        <span class="micro">Use a known handle from the integrations above or inspect any other handle directly.</span>
        <input id="customSecretHandleInput" type="text" placeholder="mail/agent/nova/password" value="${escapeAttr(suggestedHandles[0] || "")}" />
      </label>
      <label class="stack-field">
        <strong>Value</strong>
        <span class="micro">Values are sent only to the local observer server and stored in the system keychain.</span>
        <input id="customSecretValueInput" type="password" placeholder="Enter secret value" />
      </label>
      <div class="controls secret-controls">
        <button class="secondary" type="button" id="inspectCustomSecretBtn">Inspect</button>
        <button class="secondary" type="button" id="storeCustomSecretBtn">Store</button>
        <button class="secondary" type="button" id="clearCustomSecretBtn">Clear</button>
      </div>
      <div class="brain-editor-card">
        <strong>Suggested handles</strong>
        <div class="secret-handle-pills">
          ${suggestedHandles.length
            ? suggestedHandles.map((handle) => `<button type="button" class="secondary secret-handle-pill" data-secret-fill-handle="${escapeAttr(handle)}">${escapeHtml(handle)}</button>`).join("")
            : `<div class="panel-subtle">No suggested handles available yet.</div>`}
        </div>
      </div>
      <div id="customSecretStatus" class="panel-subtle">Select a handle to inspect or update it.</div>
    </div>
  `;

  document.querySelectorAll("[data-secret-set]").forEach((button) => {
    button.onclick = async () => {
      const handle = String(button.dataset.secretSet || "").trim();
      const inputId = String(button.dataset.secretInputId || "").trim();
      const input = inputId ? document.getElementById(inputId) : null;
      const value = String(input?.value || "");
      if (!handle || !value) {
        secretsHintEl.textContent = "Choose a handle and enter a value first.";
        return;
      }
      await storeSecretHandle(handle, value);
      if (input) {
        input.value = "";
      }
    };
  });

  document.querySelectorAll("[data-secret-clear]").forEach((button) => {
    button.onclick = async () => {
      const handle = String(button.dataset.secretClear || "").trim();
      if (!handle) {
        return;
      }
      await clearSecretHandle(handle);
    };
  });

  document.querySelectorAll("[data-secret-fill-handle]").forEach((button) => {
    button.onclick = () => {
      const handleInput = document.getElementById("customSecretHandleInput");
      if (handleInput) {
        handleInput.value = String(button.dataset.secretFillHandle || "").trim();
      }
    };
  });

  const inspectCustomSecretBtn = document.getElementById("inspectCustomSecretBtn");
  const storeCustomSecretBtn = document.getElementById("storeCustomSecretBtn");
  const clearCustomSecretBtn = document.getElementById("clearCustomSecretBtn");
  const customSecretHandleInput = document.getElementById("customSecretHandleInput");
  const customSecretValueInput = document.getElementById("customSecretValueInput");
  const customSecretStatusEl = document.getElementById("customSecretStatus");

  if (inspectCustomSecretBtn) {
    inspectCustomSecretBtn.onclick = async () => {
      const handle = String(customSecretHandleInput?.value || "").trim();
      if (!handle) {
        customSecretStatusEl.textContent = "Enter a handle first.";
        return;
      }
      customSecretStatusEl.textContent = "Inspecting handle...";
      try {
        const r = await fetch(`/api/secrets/status?handle=${encodeURIComponent(handle)}`);
        const j = await r.json();
        if (!r.ok || !j.ok) {
          throw new Error(j.error || "failed to inspect handle");
        }
        customSecretStatusEl.textContent = `${j.secret.handle}: ${j.secret.hasSecret ? "stored in keystore" : "missing"}.`;
      } catch (error) {
        customSecretStatusEl.textContent = `Inspect failed: ${error.message}`;
      }
    };
  }
  if (storeCustomSecretBtn) {
    storeCustomSecretBtn.onclick = async () => {
      const handle = String(customSecretHandleInput?.value || "").trim();
      const value = String(customSecretValueInput?.value || "");
      if (!handle || !value) {
        customSecretStatusEl.textContent = "Enter both a handle and a value first.";
        return;
      }
      await storeSecretHandle(handle, value);
      if (customSecretValueInput) {
        customSecretValueInput.value = "";
      }
    };
  }
  if (clearCustomSecretBtn) {
    clearCustomSecretBtn.onclick = async () => {
      const handle = String(customSecretHandleInput?.value || "").trim();
      if (!handle) {
        customSecretStatusEl.textContent = "Enter a handle first.";
        return;
      }
      await clearSecretHandle(handle);
    };
  }
}

async function loadSecretsCatalog() {
  if (!secretsHintEl) {
    return;
  }
  secretsHintEl.textContent = "Loading secure keystore status...";
  try {
    const r = await fetch("/api/secrets/catalog");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load secrets catalog");
    }
    secretsCatalogDraft = cloneJson(j.catalog);
    renderSecretsCatalogEditor();
    observerApp.refreshPluginSecretsTabs?.({ source: "secrets-catalog" });
    const trackedCount = (Array.isArray(j.catalog?.suggestedHandles) ? j.catalog.suggestedHandles.length : 0);
    secretsHintEl.textContent = `Secure keystore status loaded. ${trackedCount} suggested handle${trackedCount === 1 ? "" : "s"} available.`;
  } catch (error) {
    secretsCatalogDraft = null;
    renderSecretsCatalogEditor();
    observerApp.refreshPluginSecretsTabs?.({ source: "secrets-catalog-error" });
    secretsHintEl.textContent = `Failed to load secrets catalog: ${error.message}`;
  }
}

async function storeSecretHandle(handle = "", value = "") {
  const normalizedHandle = String(handle || "").trim();
  if (!normalizedHandle || !String(value || "")) {
    return;
  }
  secretsHintEl.textContent = `Storing ${normalizedHandle}...`;
  try {
    const r = await fetch("/api/secrets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: normalizedHandle, value: String(value || "") })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to store secret");
    }
    secretsHintEl.textContent = `Stored ${j.secret.handle} in the secure keystore.`;
    const mailRefresh = typeof observerApp.loadMailStatus === "function"
      ? Promise.resolve(observerApp.loadMailStatus())
      : Promise.resolve();
    await Promise.all([
      loadSecretsCatalog(),
      mailRefresh,
      loadRuntimeOptions(),
      refreshStatus()
    ]);
  } catch (error) {
    secretsHintEl.textContent = `Store failed: ${error.message}`;
  }
}

async function clearSecretHandle(handle = "") {
  const normalizedHandle = String(handle || "").trim();
  if (!normalizedHandle) {
    return;
  }
  secretsHintEl.textContent = `Clearing ${normalizedHandle}...`;
  try {
    const r = await fetch("/api/secrets?handle=" + encodeURIComponent(normalizedHandle), {
      method: "DELETE",
      headers: { "content-type": "application/json" }
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to clear secret");
    }
    secretsHintEl.textContent = `Cleared ${j.secret.handle} from the secure keystore.`;
    const mailRefresh = typeof observerApp.loadMailStatus === "function"
      ? Promise.resolve(observerApp.loadMailStatus())
      : Promise.resolve();
    await Promise.all([
      loadSecretsCatalog(),
      mailRefresh,
      loadRuntimeOptions(),
      refreshStatus()
    ]);
  } catch (error) {
    secretsHintEl.textContent = `Clear failed: ${error.message}`;
  }
}

async function loadRuntimeOptions() {
  try {
    const r = await fetch("/api/runtime/options");
    const j = await r.json();
    runtimeOptions = j;
    applyAppConfigToStage(runtimeOptions?.app || {});
    window.dispatchEvent(new CustomEvent("observer:app-config", { detail: runtimeOptions.app || {} }));
    updateVoiceUi();
    populateBrainOptions();
    loadSavedAccessSettings();
    updateAccessSummary();
    updateQueueControlUi();
  } catch (error) {
    hintEl.textContent = `Failed to load runtime options: ${error.message}`;
  }
}

Object.assign(observerApp, {
  getAdminUiToken,
  adminFetch: pluginAdminFetch,
  loadStateInspector,
  loadTaskFile,
  loadTaskFiles,
  loadTaskQueue,
  loadTaskReshapeIssues,
  registerPluginEventHandler: (prefix, handler) => { pluginEventHandlers.set(String(prefix), handler); },
  registerTaskJobTypeHandler: (jobType, handler) => { taskJobTypeCompletedHandlers.set(String(jobType), handler); },
  replayWaitingQuestionThroughAvatar,
  loadRegressionSuites,
  runRegressionSuites,
  refreshRegressionCommandUi,
  enqueueTaskFromPrompt,
  triagePrompt,
  triagePromptLocally,
  dispatchNextTask,
  readFileAsBase64,
  stopPayloadSpeech,
  chooseVoice,
  presentPayloadSpeech,
  speakAcknowledgement,
  speakWakeAcknowledgement,
  queueAcknowledgement,
  populateBrainOptions,
  getDefaultMountIds,
  getSelectedMountIds,
  saveAccessSettings,
  loadSavedAccessSettings,
  updateAccessSummary,
  loadTree,
  loadCronJobs,
  pollCronEvents,
  annotateNovaEmotion,
  pickTaskPhrase,
  buildTaskNarration,
  isRemoteParallelMode,
  reportTaskEvent,
  syncInProgressTaskUpdates,
  pollTaskEvents,
  getNovaConfigDraft: () => novaConfigDraft,
  loadSecretsCatalog,
  resetToSimpleProjectState,
  loadBrainConfig,
  loadNovaConfig,
  renderSecretsCatalogEditor,
  loadToolConfig,
  loadPluginManagerPanel,
  installUploadedPluginPackage,
  loadPluginPermissionRules,
  savePluginPermissionRules,
  loadPluginTaskLifecycleOutput,
  waitForPluginTaskLifecycleTask,
  createPluginLifecycleTask,
  stopPluginLifecycleTask,
  answerPluginLifecycleTask,
  loadPluginSessionMemoryState,
  capturePluginSessionMemoryTask,
  loadPluginCronHardeningStatus,
  addBrainEndpointDraft,
  addCustomBrainDraft,
  applyAppConfigToStage,
  saveBrainConfig,
  saveNovaConfig,
  saveToolConfig,
  storeSecretHandle,
  clearSecretHandle,
  loadFile,
  refreshStatus,
  loadRuntimeOptions,
  setQueuePaused
});

// Live logs via SSE
const es = new EventSource("/events/logs");
es.onmessage = (ev) => {
  const { line } = JSON.parse(ev.data);
  logsEl.textContent += line + "\n";
  logsEl.scrollTop = logsEl.scrollHeight;
};
es.onerror = () => {
  hintEl.textContent = "Log stream disconnected. If this persists, reload the page and confirm the observer server is still running.";
};

const observerEvents = new EventSource("/events/observer");
observerEvents.onmessage = (ev) => {
  const data = JSON.parse(ev.data);
  const eventSeq = Number(data.eventSeq || data.task?.latestEventSeq || 0);
  if (eventSeq > 0) {
    if (eventSeq <= latestObserverEventSeq) {
      return;
    }
    latestObserverEventSeq = eventSeq;
  }
  if (data.type === "observer.connected") {
    return;
  }
  if (typeof data.type === "string" && !data.task) {
    window.dispatchEvent(new CustomEvent("observer:event", { detail: data }));
    for (const [prefix, handler] of pluginEventHandlers) {
      if (data.type === prefix || data.type.startsWith(`${prefix}.`)) {
        handler(data);
        return;
      }
    }
    return;
  }
  if (!data.task) {
    return;
  }
  latestTaskEventTs = Math.max(latestTaskEventTs, Number(data.task.updatedAt || data.task.createdAt || 0));
  saveEventCursor(TASK_CURSOR_KEY, latestTaskEventTs);
  if (data.type === "task.progress") {
    window.dispatchEvent(new CustomEvent("observer:task-event", { detail: data }));
    if (observerApp.isRemoteParallelMode && observerApp.isRemoteParallelMode()) {
      observerApp.loadTaskQueue();
      return;
    }
    observerApp.reportTaskEvent(data.task);
  } else if (data.type === "task.completed" || data.type === "task.escalated" || data.type === "task.recovered") {
    window.dispatchEvent(new CustomEvent("observer:task-event", { detail: data }));
    observerApp.reportTaskEvent(data.task);
    taskJobTypeCompletedHandlers.get(String(data.task?.internalJobType || ""))?.(data.task);
  }
  observerApp.loadTaskQueue();
};

if ("speechSynthesis" in window) {
  refreshKnownVoices();
  if (typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
    window.speechSynthesis.onvoiceschanged = () => {
      refreshKnownVoices();
    };
  }
  window.addEventListener("pointerdown", unlockSpeech, { once: true });
  window.addEventListener("keydown", unlockSpeech, { once: true });
}

})();

