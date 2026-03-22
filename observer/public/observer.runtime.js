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
  renderMailMessages,
  renderPassivePayload,
  renderRegressionResults,
  renderRegressionSuiteList,
  renderTodoList,
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

function renderQdrantDetails(status = {}) {
  const docs = Math.max(0, Number(status?.indexedDocumentCount || 0));
  const chunks = Math.max(0, Number(status?.indexedChunkCount || 0));
  const syncLabel = Number(status?.lastSyncAt || 0)
    ? formatDateTime(status.lastSyncAt)
    : "Never";
  const authLabel = status?.enabled ? (status?.hasApiKey ? "Auth key stored" : "No auth key") : "Auth n/a";
  return `${docs} docs | ${chunks} chunks | ${authLabel} | Sync ${syncLabel}`;
}

async function loadTaskFile(relativePath) {
  activeTaskFilePath = relativePath;
  selectedFileEl.value = relativePath || "";
  taskFileContentEl.textContent = "Loading task file...";
  renderTaskFilesList(buildTaskFileEntries());
  try {
    const normalizedPath = String(relativePath || "").trim();
    const isQueueFile = normalizedPath.startsWith("task-queue/")
      || normalizedPath.startsWith("observer-task-queue/")
      || normalizedPath.startsWith("observer-task-queue/");
    const scope = isQueueFile ? "queue" : "workspace";
    const requestPath = isQueueFile
      ? normalizedPath
          .replace(/^task-queue\//, "")
          .replace(/^observer-task-queue\//, "")
          .replace(/^observer-task-queue\//, "")
      : normalizedPath;
    const r = await fetch(`/api/inspect/file?scope=${encodeURIComponent(scope)}&file=${encodeURIComponent(requestPath)}`);
    const j = await r.json();
    taskFileContentEl.textContent = j.content || "(empty file)";
  } catch (error) {
    taskFileContentEl.textContent = `Failed to load task file: ${error.message}`;
  }
}

async function loadTaskFiles(options = {}) {
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

async function loadPromptReview() {
  promptReviewHintEl.textContent = "Loading prompt review...";
  promptReviewListEl.innerHTML = `<div class="panel-subtle">Loading prompt review...</div>`;
  try {
    const r = await fetch("/api/prompts/review");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load prompt review");
    }
    const entries = Array.isArray(j.entries) ? j.entries : [];
    promptReviewHintEl.textContent = entries.length
      ? `Showing ${entries.length} live prompt set${entries.length === 1 ? "" : "s"} generated from the current server configuration.`
      : "No prompt entries are available.";
    if (!entries.length) {
      promptReviewListEl.innerHTML = `<div class="panel-subtle">No prompt entries are available.</div>`;
      return;
    }
    promptReviewListEl.innerHTML = entries.map((entry) => `
      <section class="prompt-review-card">
        <div class="panel-head compact">
          <div>
            <h3>${escapeHtml(String(entry.label || entry.id || "Prompt"))}</h3>
            <div class="panel-subtle">${escapeHtml([
              String(entry.kind || "").trim(),
              String(entry.model || "").trim(),
              String(entry.specialty || "").trim() ? `specialty=${String(entry.specialty || "").trim()}` : "",
              String(entry.queueLane || "").trim() ? `lane=${String(entry.queueLane || "").trim()}` : ""
            ].filter(Boolean).join(" | "))}</div>
          </div>
        </div>
        <div class="micro"><strong>Scenario:</strong> ${escapeHtml(String(entry.scenario || "Review sample"))}</div>
        <div class="micro"><strong>Sample message:</strong> ${escapeHtml(String(entry.sampleMessage || "(none)"))}</div>
        <pre class="json-box prompt-review-text">${escapeHtml(String(entry.prompt || ""))}</pre>
      </section>
    `).join("");
  } catch (error) {
    promptReviewHintEl.textContent = `Prompt review failed: ${error.message}`;
    promptReviewListEl.innerHTML = `<div class="panel-subtle">Prompt review failed: ${escapeHtml(error.message)}</div>`;
  }
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
  updateStateScopeView();
  if (isTaskFilesScopeSelected()) {
    return loadTaskFiles({ preserveSelection: options.preserveSelection !== false });
  }
  return loadTree();
}

async function resetToSimpleProjectState() {
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
    const r = await fetch("/api/state/reset-simple-project", {
      method: "POST",
      headers: { "content-type": "application/json" }
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
    if (isTaskFilesScopeSelected()) {
      taskFileContentEl.textContent = summaryLines.length ? summaryLines.join("\n") : (j.message || "Reset complete.");
    } else {
      fileContentEl.textContent = summaryLines.length ? summaryLines.join("\n") : (j.message || "Reset complete.");
    }

    await Promise.all([
      loadStateInspector({ preserveSelection: false }),
      loadTaskQueue(),
      loadProjectConfig()
    ]);
  } catch (error) {
    const message = `Reset failed: ${error.message}`;
    if (stateResetHintEl) {
      stateResetHintEl.textContent = message;
    }
    if (isTaskFilesScopeSelected()) {
      taskFileContentEl.textContent = message;
    } else {
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

function updateQueueSummaryText(taskSnapshot = latestTaskSnapshot, todoSnapshot = latestTodoSnapshot) {
  const queued = Array.isArray(taskSnapshot?.queued) ? taskSnapshot.queued : [];
  const waiting = Array.isArray(taskSnapshot?.waiting) ? taskSnapshot.waiting : [];
  const inProgress = Array.isArray(taskSnapshot?.inProgress) ? taskSnapshot.inProgress : [];
  const done = Array.isArray(taskSnapshot?.done) ? taskSnapshot.done : [];
  const failed = Array.isArray(taskSnapshot?.failed) ? taskSnapshot.failed : [];
  const paused = runtimeOptions?.queue?.paused === true;
  queueSummaryEl.textContent = `${queued.length} queued, ${waiting.length} questions, ${inProgress.length} in progress, ${done.length} done, ${failed.length} failed.${paused ? " Queue paused." : ""}`;
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
  if (options.errorMessage) {
    taskQueueWaitingEl.innerHTML = `<div class="panel-subtle">${escapeHtml(String(options.errorMessage || "Question load failed."))}</div>`;
    return;
  }
  const questions = Array.isArray(waiting) ? waiting : [];
  const task = questions[0];
  if (!task) {
    taskQueueWaitingEl.innerHTML = `<div class="panel-subtle">No questions waiting.</div>`;
    return;
  }
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
        <textarea class="queue-answer-input" data-waiting-question-answer rows="4" placeholder="Type your answer here">${escapeHtml(draftAnswer)}</textarea>
        <div class="queue-item-actions">
          <button type="button" class="secondary" data-submit-waiting-question>Send answer</button>
          <button type="button" class="secondary" data-clear-waiting-question-answer>Clear</button>
          <button type="button" class="secondary" data-remove-waiting-question>Remove question</button>
        </div>
        <div class="micro" data-waiting-question-status></div>
      </div>
    </article>
  `;
  const answerInput = taskQueueWaitingEl.querySelector("[data-waiting-question-answer]");
  const submitButton = taskQueueWaitingEl.querySelector("[data-submit-waiting-question]");
  const clearButton = taskQueueWaitingEl.querySelector("[data-clear-waiting-question-answer]");
  const removeButton = taskQueueWaitingEl.querySelector("[data-remove-waiting-question]");
  const statusEl = taskQueueWaitingEl.querySelector("[data-waiting-question-status]");
  if (answerInput) {
    answerInput.addEventListener("input", () => {
      setWaitingQuestionDraft(task.id, answerInput.value);
    });
    answerInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        submitButton?.click();
      }
    });
  }
  if (clearButton && answerInput) {
    clearButton.onclick = () => {
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
        const r = await fetch("/api/tasks/answer", {
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
  if (removeButton) {
    removeButton.onclick = async () => {
      removeButton.disabled = true;
      if (submitButton) {
        submitButton.disabled = true;
      }
      if (statusEl) {
        statusEl.textContent = "Removing...";
      }
      try {
        const r = await fetch("/api/tasks/remove", {
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

async function loadTodoList() {
  try {
    const r = await fetch("/api/todos");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "todo list unavailable");
    }
    latestTodoSnapshot = {
      items: Array.isArray(j.items) ? j.items : [],
      open: Array.isArray(j.open) ? j.open : [],
      completed: Array.isArray(j.completed) ? j.completed : [],
      summary: j.summary || {
        openCount: Array.isArray(j.open) ? j.open.length : 0,
        completedCount: Array.isArray(j.completed) ? j.completed.length : 0
      }
    };
    renderTodoList(latestTodoSnapshot);
    if (calendarTodoCountEl) {
      calendarTodoCountEl.textContent = String(latestTodoSnapshot.open.length);
    }
    updateQueueSummaryText(latestTaskSnapshot, latestTodoSnapshot);
  } catch (error) {
    latestTodoSnapshot = { items: [], open: [], completed: [], summary: { openCount: 0, completedCount: 0 } };
    if (todoHintEl) {
      todoHintEl.textContent = `To do load failed: ${error.message}`;
    }
    if (todoOpenListEl) {
      todoOpenListEl.innerHTML = `<div class="panel-subtle">To do load failed.</div>`;
    }
    if (todoCompletedListEl) {
      todoCompletedListEl.innerHTML = `<div class="panel-subtle">To do load failed.</div>`;
    }
    if (calendarTodoCountEl) {
      calendarTodoCountEl.textContent = "0";
    }
    updateQueueSummaryText(latestTaskSnapshot, latestTodoSnapshot);
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
    latestTaskSnapshot = { queued, waiting, inProgress, done, failed };
    syncInProgressTaskUpdates(inProgress);
    renderTaskList(taskQueueQueuedEl, queued);
    renderWaitingQuestionsPanel(waiting);
    syncQuestionTimeAfterQueueLoad(waiting);
    renderTaskList(taskQueueInProgressEl, inProgress);
    renderTaskList(taskQueueDoneEl, done.slice(0, 10));
    renderTaskList(taskQueueFailedEl, failed.slice(0, 10));
    if (taskQueueQueuedCountEl) taskQueueQueuedCountEl.textContent = String(queued.length);
    if (novaQuestionsCountEl) novaQuestionsCountEl.textContent = String(waiting.length);
    if (taskQueueInProgressCountEl) taskQueueInProgressCountEl.textContent = String(inProgress.length);
    if (taskQueueDoneCountEl) taskQueueDoneCountEl.textContent = String(done.length);
    if (taskQueueFailedCountEl) taskQueueFailedCountEl.textContent = String(failed.length);
    if (questionTimeBtn) questionTimeBtn.disabled = waiting.length === 0;
    activateQueueSubtab(activeQueueSubtabId || "taskQueueQueuedPanel");
    updateQueueSummaryText(latestTaskSnapshot, latestTodoSnapshot);
    await loadTaskReshapeIssues();
    await loadTodoList();
    loadTaskFiles({ preserveSelection: true });
  } catch (error) {
    queueSummaryEl.textContent = `Queue load failed: ${error.message}`;
    taskQueueQueuedEl.innerHTML = `<div class="panel-subtle">Queue load failed.</div>`;
    renderWaitingQuestionsPanel([], { errorMessage: "Question load failed." });
    taskQueueInProgressEl.innerHTML = `<div class="panel-subtle">Queue load failed.</div>`;
    taskQueueDoneEl.innerHTML = `<div class="panel-subtle">Queue load failed.</div>`;
    taskQueueFailedEl.innerHTML = `<div class="panel-subtle">Queue load failed.</div>`;
    if (taskQueueQueuedCountEl) taskQueueQueuedCountEl.textContent = "0";
    if (novaQuestionsCountEl) novaQuestionsCountEl.textContent = "0";
    if (taskQueueInProgressCountEl) taskQueueInProgressCountEl.textContent = "0";
    if (taskQueueDoneCountEl) taskQueueDoneCountEl.textContent = "0";
    if (taskQueueFailedCountEl) taskQueueFailedCountEl.textContent = "0";
    if (calendarTodoCountEl) calendarTodoCountEl.textContent = "0";
    if (questionTimeBtn) questionTimeBtn.disabled = true;
    if (taskReshapeIssuesSummaryEl) taskReshapeIssuesSummaryEl.textContent = "Recurring issue summary unavailable.";
    if (taskReshapeIssuesListEl) taskReshapeIssuesListEl.innerHTML = `<div class="panel-subtle">Recurring issue load failed.</div>`;
    if (taskQueueIssuesCountEl) taskQueueIssuesCountEl.textContent = "0";
    taskFilesListEl.innerHTML = `<div class="panel-subtle">Task file load failed.</div>`;
    taskFileContentEl.textContent = `Failed to load task files: ${error.message}`;
    if (todoHintEl) todoHintEl.textContent = "To do list unavailable.";
    if (todoOpenListEl) todoOpenListEl.innerHTML = `<div class="panel-subtle">To do load failed.</div>`;
    if (todoCompletedListEl) todoCompletedListEl.innerHTML = `<div class="panel-subtle">To do load failed.</div>`;
  }
}

function replayWaitingQuestionThroughAvatar() {
  const waiting = Array.isArray(latestTaskSnapshot?.waiting) ? latestTaskSnapshot.waiting : [];
  const activeTaskId = String(activeQuestionTimeTaskId || "").trim();
  const task = (activeTaskId
    ? waiting.find((entry) => String(entry?.id || "").trim() === activeTaskId)
    : null) || waiting[0];
  if (!task) {
    setQuestionTimeActive(false);
    hintEl.textContent = "There is no active waiting question to replay.";
    return false;
  }
  const narration = buildTaskNarration(task);
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
    const r = await fetch("/api/regressions/run", {
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
  const r = await fetch("/api/tasks/enqueue", {
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
  const r = await fetch("/api/tasks/triage", {
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
    return { predictedMode: "queue", ack: "Let me check.", complexity };
  }
  if (brain?.id === "fast" && complexity >= 5) {
    return { predictedMode: "queue", ack: "Let me find out for you.", complexity };
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
    const r = await fetch("/api/tasks/dispatch-next", {
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

function stopPayloadSpeech() {
  const shouldResumeVoice = voicePausedForTts && voiceListeningEnabled;
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  activeUtterance = null;
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

  const finishSpeechAttempt = (utterance, retryTimer) => {
    if (retryTimer) {
      clearTimeout(retryTimer);
    }
    if (activeUtterance === utterance) {
      activeUtterance = null;
    }
    window.agentAvatar?.endSpeech?.();
    if (options.bypassVoiceCaptureBlock !== true) {
      resumeVoiceListeningAfterTts();
    }
  };

  const completeSpeechAttempt = () => {
    const handler = speechCompletionHandler;
    speechCompletionHandler = null;
    handler?.();
    window.setTimeout(() => {
      showQueuedUpdate();
    }, 80);
  };

  const speakOnce = (attempt = 0) => {
    const utterance = new SpeechSynthesisUtterance(cleanText);
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
      if (options.bypassVoiceCaptureBlock !== true) {
        pauseVoiceListeningForTts();
      }
      options.onStart?.();
      window.agentAvatar?.beginSpeech?.(prepared.clipNames);
    };
    utterance.onend = () => {
      finishSpeechAttempt(utterance, retryTimer);
      completeSpeechAttempt();
    };
    utterance.onerror = () => {
      finishSpeechAttempt(utterance, retryTimer);
      if (!started && attempt < 1) {
        window.setTimeout(() => speakOnce(attempt + 1), 180);
        return;
      }
      completeSpeechAttempt();
    };

    activeUtterance = utterance;
    speechCompletionHandler = typeof options.onComplete === "function" ? options.onComplete : null;

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
        speechCompletionHandler = null;
        window.setTimeout(() => speakOnce(attempt + 1), 180);
      }
    }, speechUnlocked ? 1200 : 1800);
  };

  window.setTimeout(() => speakOnce(0), 50);
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
    message = pickLanguageVariant("acknowledgements.directWorking", "I'm working on it.");
  }
  if (!message) {
    return;
  }
  renderPassivePayload("Acknowledged", message);
  presentPayloadSpeech(message, {});
}

function populateBrainOptions() {
  const brains = Array.isArray(runtimeOptions.brains) ? runtimeOptions.brains : [];
  cronBrainSelectEl.innerHTML = brains
    .filter((brain) => brain.cronCapable)
    .map((brain) => `<option value="${escapeHtml(brain.id)}">${escapeHtml(brain.label)}</option>`)
    .join("");
  calendarActionBrainEl.innerHTML = brains
    .filter((brain) => brain.kind === "worker" && brain.toolCapable)
    .map((brain) => `<option value="${escapeHtml(brain.id)}">${escapeHtml(brain.label)}</option>`)
    .join("");

  if (!cronBrainSelectEl.value) {
    cronBrainSelectEl.value = "worker";
  }
  if (!calendarActionBrainEl.value) {
    calendarActionBrainEl.value = "worker";
  }
}

function activateCalendarSubtab(targetId) {
  activeCalendarSubtabId = targetId || "calendarDailyPanel";
  calendarSubtabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.calendarSubtabTarget === activeCalendarSubtabId);
  });
  calendarSubtabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === activeCalendarSubtabId);
  });
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

function startOfCalendarMonth(timestamp = Date.now()) {
  const date = new Date(Number(timestamp || Date.now()));
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function formatCalendarDateKey(timestamp) {
  const date = new Date(Number(timestamp || 0));
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCalendarAgendaHeading(timestamp) {
  const date = new Date(Number(timestamp || 0));
  if (!Number.isFinite(date.getTime())) {
    return "Agenda";
  }
  const dayName = date.toLocaleDateString([], { weekday: "long" });
  const monthName = date.toLocaleDateString([], { month: "long" });
  const day = date.getDate();
  const mod10 = day % 10;
  const mod100 = day % 100;
  let suffix = "th";
  if (mod10 === 1 && mod100 !== 11) suffix = "st";
  else if (mod10 === 2 && mod100 !== 12) suffix = "nd";
  else if (mod10 === 3 && mod100 !== 13) suffix = "rd";
  return `${dayName}, ${day}${suffix} ${monthName} - Agenda`;
}

function formatCalendarInputValue(timestamp, allDay = false) {
  if (!Number(timestamp || 0)) {
    return "";
  }
  const date = new Date(Number(timestamp));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  if (allDay) {
    return `${year}-${month}-${day}T00:00`;
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseCalendarInputValue(value) {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function getCalendarSelectedDayTs() {
  const parsed = Date.parse(`${calendarSelectedDayKey}T00:00:00`);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function getCalendarDefaultStartAt() {
  const base = new Date(getCalendarSelectedDayTs());
  base.setHours(9, 0, 0, 0);
  return base.getTime();
}

function normalizeCalendarClientRepeat(repeat = {}) {
  const frequency = ["none", "daily", "weekly", "monthly", "yearly"].includes(String(repeat?.frequency || "none"))
    ? String(repeat.frequency || "none")
    : "none";
  const interval = Math.max(1, Math.min(Number(repeat?.interval || 1) || 1, 365));
  return { frequency, interval };
}

function advanceCalendarClientOccurrence(startAt, repeat, occurrenceAt) {
  const normalizedRepeat = normalizeCalendarClientRepeat(repeat);
  if (normalizedRepeat.frequency === "none") {
    return 0;
  }
  const next = new Date(Number(occurrenceAt || startAt || 0));
  if (!Number.isFinite(next.getTime())) {
    return 0;
  }
  if (normalizedRepeat.frequency === "daily") {
    next.setDate(next.getDate() + normalizedRepeat.interval);
  } else if (normalizedRepeat.frequency === "weekly") {
    next.setDate(next.getDate() + (normalizedRepeat.interval * 7));
  } else if (normalizedRepeat.frequency === "monthly") {
    next.setMonth(next.getMonth() + normalizedRepeat.interval);
  } else if (normalizedRepeat.frequency === "yearly") {
    next.setFullYear(next.getFullYear() + normalizedRepeat.interval);
  }
  return next.getTime();
}

function buildCalendarOccurrencesForRange(events, rangeStartAt, rangeEndAt) {
  const occurrences = [];
  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event || event.status === "cancelled") {
      return;
    }
    const startAt = Number(event.startAt || 0);
    if (!startAt) {
      return;
    }
    const repeat = normalizeCalendarClientRepeat(event.repeat);
    let occurrenceAt = startAt;
    let guard = 0;
    while (occurrenceAt && occurrenceAt <= rangeEndAt && guard < 400) {
      if (occurrenceAt >= rangeStartAt) {
        occurrences.push({
          eventId: event.id,
          at: occurrenceAt,
          dateKey: formatCalendarDateKey(occurrenceAt),
          event
        });
      }
      if (repeat.frequency === "none") {
        break;
      }
      occurrenceAt = advanceCalendarClientOccurrence(startAt, repeat, occurrenceAt);
      guard += 1;
    }
  });
  return occurrences.sort((left, right) => left.at - right.at);
}

function resetCalendarForm() {
  activeCalendarEventId = "";
  const startAt = getCalendarDefaultStartAt();
  const endAt = startAt + (60 * 60 * 1000);
  calendarTitleEl.value = "";
  calendarTypeEl.value = "personal";
  calendarStartAtEl.value = formatCalendarInputValue(startAt);
  calendarEndAtEl.value = formatCalendarInputValue(endAt);
  calendarAllDayEl.checked = false;
  calendarLocationEl.value = "";
  calendarDescriptionEl.value = "";
  calendarRepeatFrequencyEl.value = "none";
  calendarRepeatIntervalEl.value = "1";
  calendarActionEnabledEl.checked = false;
  calendarActionBrainEl.value = calendarActionBrainEl.value || "worker";
  calendarActionMessageEl.value = "";
  updateCalendarFormState();
}

function updateCalendarFormState() {
  const actionEnabled = calendarActionEnabledEl.checked || calendarTypeEl.value === "nova_action";
  calendarActionBrainEl.disabled = !actionEnabled;
  calendarActionMessageEl.disabled = !actionEnabled;
}

function populateCalendarForm(event) {
  if (!event) {
    resetCalendarForm();
    return;
  }
  activeCalendarEventId = String(event.id || "");
  calendarTitleEl.value = String(event.title || "");
  calendarTypeEl.value = String(event.type || "personal");
  calendarStartAtEl.value = formatCalendarInputValue(event.startAt, event.allDay);
  calendarEndAtEl.value = formatCalendarInputValue(event.endAt, event.allDay);
  calendarAllDayEl.checked = event.allDay === true;
  calendarLocationEl.value = String(event.location || "");
  calendarDescriptionEl.value = String(event.description || "");
  calendarRepeatFrequencyEl.value = String(event.repeat?.frequency || "none");
  calendarRepeatIntervalEl.value = String(event.repeat?.interval || 1);
  calendarActionEnabledEl.checked = event.action?.enabled === true;
  calendarActionBrainEl.value = String(event.action?.requestedBrainId || "worker");
  calendarActionMessageEl.value = String(event.action?.message || "");
  updateCalendarFormState();
  activateCalendarSubtab("calendarEditPanel");
}

function renderCalendarDayEvents() {
  const dayTs = getCalendarSelectedDayTs();
  const dayStartAt = new Date(dayTs);
  dayStartAt.setHours(0, 0, 0, 0);
  const dayEndAt = dayStartAt.getTime() + (24 * 60 * 60 * 1000) - 1;
  const occurrences = buildCalendarOccurrencesForRange(calendarEvents, dayStartAt.getTime(), dayEndAt)
    .filter((entry) => entry.dateKey === calendarSelectedDayKey);
  calendarDayHeadingEl.textContent = formatCalendarAgendaHeading(dayTs);
  calendarDaySummaryEl.textContent = "";
  if (!occurrences.length) {
    calendarDayEventsEl.innerHTML = `<div class="panel-subtle">No events</div>`;
    return;
  }
  calendarDayEventsEl.innerHTML = occurrences.map((entry) => {
    const event = entry.event;
    const timeLabel = event.allDay
      ? "All day"
      : new Date(entry.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const actionLabel = event.action?.enabled ? "Nova action" : "Personal";
    const status = String(event.status || "active");
    return `
      <button class="calendar-event-row ${activeCalendarEventId === event.id ? "active" : ""}" data-calendar-event-id="${escapeHtml(event.id)}">
        <strong>${escapeHtml(event.title || "Untitled event")}</strong>
        <span>${escapeHtml(timeLabel)} - ${escapeHtml(actionLabel)} - ${escapeHtml(status)}</span>
      </button>
    `;
  }).join("");
  calendarDayEventsEl.querySelectorAll("[data-calendar-event-id]").forEach((button) => {
    button.onclick = () => {
      const event = calendarEvents.find((entry) => String(entry.id || "") === String(button.dataset.calendarEventId || ""));
      if (event) {
        populateCalendarForm(event);
        renderCalendarDayEvents();
      }
    };
  });
}

function renderCalendarMonth() {
  const monthStartAt = startOfCalendarMonth(calendarMonthAnchorMs);
  calendarMonthAnchorMs = monthStartAt;
  const monthStart = new Date(monthStartAt);
  calendarMonthLabelEl.textContent = monthStart.toLocaleDateString([], { month: "long", year: "numeric" });
  const gridStart = new Date(monthStartAt);
  gridStart.setDate(1 - gridStart.getDay());
  const gridStartAt = gridStart.getTime();
  const gridEndAt = gridStartAt + ((42 * 24 * 60 * 60 * 1000) - 1);
  const occurrences = buildCalendarOccurrencesForRange(calendarEvents, gridStartAt, gridEndAt);
  const occurrencesByDay = new Map();
  occurrences.forEach((entry) => {
    const key = entry.dateKey;
    if (!occurrencesByDay.has(key)) {
      occurrencesByDay.set(key, []);
    }
    occurrencesByDay.get(key).push(entry);
  });
  const todayKey = formatCalendarDateKey(Date.now());
  if (!calendarSelectedDayKey) {
    calendarSelectedDayKey = todayKey;
  }
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(gridStartAt + (index * 24 * 60 * 60 * 1000));
    const dateKey = formatCalendarDateKey(cellDate.getTime());
    const dayEvents = occurrencesByDay.get(dateKey) || [];
    const isCurrentMonth = cellDate.getMonth() === monthStart.getMonth();
    const isToday = dateKey === todayKey;
    const isSelected = dateKey === calendarSelectedDayKey;
    cells.push(`
      <button class="calendar-day-cell ${isCurrentMonth ? "" : "outside"} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}" data-calendar-date="${escapeHtml(dateKey)}">
        <span class="calendar-day-number">${cellDate.getDate()}</span>
        <span class="calendar-day-count">${dayEvents.length ? `${dayEvents.length} item${dayEvents.length === 1 ? "" : "s"}` : ""}</span>
        <span class="calendar-day-preview">${escapeHtml(dayEvents.slice(0, 2).map((entry) => entry.event.title || "").join(" • "))}</span>
      </button>
    `);
  }
  calendarMonthGridEl.innerHTML = cells.join("");
  calendarMonthGridEl.querySelectorAll("[data-calendar-date]").forEach((button) => {
    button.onclick = () => {
      calendarSelectedDayKey = String(button.dataset.calendarDate || "");
      renderCalendarMonth();
      renderCalendarDayEvents();
      activateCalendarSubtab("calendarMonthlyPanel");
      if (!activeCalendarEventId) {
        resetCalendarForm();
      }
    };
  });
  renderCalendarDayEvents();
}

async function loadCalendarEvents() {
  calendarHintEl.textContent = "Loading calendar...";
  try {
    const r = await fetch("/api/calendar/events");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load calendar");
    }
    calendarEvents = Array.isArray(j.events) ? j.events : [];
    if (!calendarSelectedDayKey) {
      calendarSelectedDayKey = formatCalendarDateKey(Date.now());
    }
    activateCalendarSubtab(activeCalendarSubtabId || "calendarDailyPanel");
    renderCalendarMonth();
    if (activeCalendarEventId) {
      const activeEvent = calendarEvents.find((entry) => String(entry.id || "") === activeCalendarEventId);
      if (activeEvent) {
        populateCalendarForm(activeEvent);
      }
    } else {
      resetCalendarForm();
    }
    calendarHintEl.textContent = `Loaded ${calendarEvents.length} calendar event${calendarEvents.length === 1 ? "" : "s"}.`;
  } catch (error) {
    calendarHintEl.textContent = `Calendar load failed: ${error.message}`;
    calendarMonthGridEl.textContent = "Failed to load calendar.";
    calendarDayEventsEl.textContent = "Failed to load events.";
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

function buildTaskNarration(task) {
  const taskRef = task.codename || formatEntityRef("task", task.id || "unknown");
  const brainLabel = task.requestedBrainLabel || task.requestedBrainId || "the agent";
  const resultSummary = buildConcreteTaskNarrationDetail(task);
  const progressNote = String(task.progressNote || "").trim();
  const noteText = String(task.notes || "").trim();
  const abortRequested = Boolean(task.abortRequestedAt);
  const todoBackedWaiting = String(task?.waitingMode || "").trim().toLowerCase() === "todo"
    && Boolean(String(task?.todoItemId || "").trim());
  const plainQuestionTask = String(task?.status || "").trim().toLowerCase() === "waiting_for_user"
    && String(task?.internalJobType || "").trim().toLowerCase() === "question_maintenance"
    && Boolean(String(task?.questionForUser || "").trim());

  if (todoBackedWaiting) {
    return {
      title: "To do added",
      displayText: `${taskRef} is blocked on a user action, so I added it to your to do list.\n\n${String(task.todoText || task.questionForUser || noteText || "Follow up needed.").trim()}`,
      spokenText: annotateNovaEmotion(`${taskRef} is blocked on a user action, so I added it to your to do list. ${String(task.todoText || task.questionForUser || noteText || "Follow up needed.").trim()}`, "shrug")
    };
  }

  if (task.status === "waiting_for_user") {
    const question = String(task.questionForUser || resultSummary || noteText || "I need a direction before I can continue.").trim();
    return {
      title: "Question waiting",
      displayText: plainQuestionTask ? question : `${taskRef} is waiting for your direction.\n\n${question}`,
      spokenText: annotateNovaEmotion(plainQuestionTask ? question : `${taskRef} is waiting for your direction. ${question}`, "shrug")
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
    const detail = progressNote || noteText || "Abort requested. Stopping active work.";
    return {
      title: "Stopping task",
      displayText: `${taskRef} is stopping.\n\n${detail}`,
      spokenText: annotateNovaEmotion(`${taskRef} is stopping. ${detail}`, "angry")
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
  if (String(task?.waitingMode || "").trim().toLowerCase() === "todo" && String(task?.status || "").trim() === "waiting_for_user") {
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

function buildMailObservation(message) {
  const fromLabel = String(message?.fromName || message?.fromAddress || "Someone").trim();
  const subject = String(message?.subject || "(no subject)").trim();
  const text = String(message?.text || "").replace(/\s+/g, " ").trim();
  const preview = text.slice(0, 220).trim();
  const trust = String(message?.sourceIdentity?.trustLevel || "unknown").trim();
  const command = message?.command?.detected
    ? ` Email command ${String(message.command.action || "detected").replaceAll("_", " ")}.`
    : "";
  return {
    displayText: preview
      ? `${fromLabel} sent a ${trust} message: ${subject}\n\n${preview}${command}`
      : `${fromLabel} sent a ${trust} message: ${subject}${command}`,
    spokenText: preview
      ? `New ${trust} message from ${fromLabel}. ${subject}. ${preview}${command}`
      : `New ${trust} message from ${fromLabel}. ${subject}.${command}`
  };
}

async function loadMailStatus() {
  try {
    const r = await fetch("/api/mail/status");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "mail status unavailable");
    }

    const ready = Boolean(j.ready);
    setStatus(mailStatusEl, ready ? "Ready" : (j.enabled ? "Needs config" : "Disabled"), ready ? "tone-ok" : "tone-warn");
    mailAgentEl.textContent = j.activeAgentLabel && j.activeAgentEmail
      ? `${j.activeAgentLabel} <${j.activeAgentEmail}>`
      : (j.activeAgentLabel || j.activeAgentEmail || "-");
    mailDestinationSummaryEl.textContent = "Direct email";
    mailCheckedAtEl.textContent = j.lastCheckAt ? formatTime(j.lastCheckAt) : "Never";
    mailHintEl.textContent = j.lastError
      ? j.lastError
      : (ready
        ? `Mailbox is configured. Showing ${Number(j.recentMessageCount || 0)} recent inbox ${Number(j.recentMessageCount || 0) === 1 ? "message" : "messages"}. Trusted sources: ${Number(j.trustedSourceCount || 0)}. Known sources: ${Number(j.knownSourceCount || 0)}. Email commands need ${trustLevelLabel(j.emailCommandMinLevel || "trusted")}.`
        : "Store the active agent mailbox password in the Nova secure keystore to enable IMAP and SMTP.");
    if (mailSummariesEnabledEl) {
      mailSummariesEnabledEl.checked = j.sendSummariesEnabled !== false;
      mailSummariesEnabledEl.disabled = !ready;
    }

    mailToEmailEl.disabled = !ready;
    mailSubjectEl.disabled = !ready;
    mailBodyEl.disabled = !ready;
    mailSendBtn.disabled = !ready;
    mailPollBtn.disabled = !ready;

    renderMailMessages(Array.isArray(j.messages) ? j.messages : []);
  } catch (error) {
    setStatus(mailStatusEl, "Unavailable", "tone-bad");
    mailAgentEl.textContent = "-";
    mailDestinationSummaryEl.textContent = "-";
    mailCheckedAtEl.textContent = "Error";
    mailHintEl.textContent = `Mail status failed: ${error.message}`;
    if (mailSummariesEnabledEl) {
      mailSummariesEnabledEl.checked = true;
      mailSummariesEnabledEl.disabled = true;
    }
    mailToEmailEl.disabled = true;
    mailSubjectEl.disabled = true;
    mailBodyEl.disabled = true;
    mailSendBtn.disabled = true;
    mailPollBtn.disabled = true;
    renderMailMessages([]);
  }
}

async function pollMailInbox() {
  const r = await fetch("/api/mail/poll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  const j = await r.json();
  if (!r.ok || !j.ok) {
    throw new Error(j.error || "mail poll failed");
  }
  await loadMailStatus();
  return j;
}

async function sendMailMessage() {
  const toEmail = String(mailToEmailEl.value || "").trim();
  const subject = String(mailSubjectEl.value || "").trim();
  const text = String(mailBodyEl.value || "").trim();
  if (!toEmail || !text) {
    throw new Error("Enter a destination email and message.");
  }
  const r = await fetch("/api/mail/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toEmail, subject, text })
  });
  const j = await r.json();
  if (!r.ok || !j.ok) {
    throw new Error(j.error || "mail send failed");
  }
  mailToEmailEl.value = "";
  mailSubjectEl.value = "";
  mailBodyEl.value = "";
  mailHintEl.textContent = "Message sent.";
  await loadMailStatus();
  return j;
}

async function loadFile(file) {
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
  if (!novaIdentitySettingsListEl || !novaTrustSettingsListEl || !novaEnvironmentSettingsListEl || !novaPropsSettingsListEl) {
    return;
  }
  if (!novaConfigDraft?.app) {
    const unavailable = `<div class="panel-subtle">Nova settings are unavailable.</div>`;
    novaIdentitySettingsListEl.innerHTML = unavailable;
    novaTrustSettingsListEl.innerHTML = unavailable;
    novaEnvironmentSettingsListEl.innerHTML = unavailable;
    novaPropsSettingsListEl.innerHTML = unavailable;
    return;
  }
  const app = novaConfigDraft.app;
  const assets = novaConfigDraft.assets && typeof novaConfigDraft.assets === "object" ? novaConfigDraft.assets : {};
  const modelOptions = Array.isArray(assets.characters) ? assets.characters : [];
  const backgroundOptions = Array.isArray(assets.skies) ? assets.skies : [];
  const textureOptions = Array.isArray(assets.textures) ? assets.textures : [];
  const propOptions = Array.isArray(assets.props) ? assets.props : [];
  const selectedModelPath = String(app.avatarModelPath || "").trim();
  const selectedBackgroundPath = String(app.backgroundImagePath || "").trim();
  const selectedStylizationFilterPreset = String(app.stylizationFilterPreset || app.stylizationPreset || "none").trim().toLowerCase() || "none";
  const selectedStylizationEffectPreset = String(app.stylizationEffectPreset || app.stylizationPreset || "none").trim().toLowerCase() || "none";
  const reactionProfile = getReactionProfileDraft(app, selectedModelPath);
  const roomTextures = app.roomTextures && typeof app.roomTextures === "object" ? app.roomTextures : {};
  const propSlots = app.propSlots && typeof app.propSlots === "object" ? app.propSlots : {};
  const trust = app.trust && typeof app.trust === "object"
    ? app.trust
    : { emailCommandMinLevel: "trusted", voiceCommandMinLevel: "trusted", records: [], emailSources: [], voiceProfiles: [] };
  const trustRecords = Array.isArray(trust.records) ? trust.records : [];
  const textureFieldLabels = {
    walls: "Walls",
    floor: "Floor",
    ceiling: "Roof",
    windowFrame: "Window frame"
  };
  const propFieldLabels = {
    backWallLeft: "Back wall A",
    backWallRight: "Back wall B",
    wallLeft: "Wall slot A",
    wallRight: "Wall slot B",
    besideLeft: "Beside Nova A",
    besideRight: "Beside Nova B",
    outsideLeft: "Outside window A",
    outsideRight: "Outside window B"
  };
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
  novaEnvironmentSettingsListEl.innerHTML = `
    <label class="stack-field">
      <strong>Background image</strong>
      <span class="micro">Choose from PNG files in <code>public/assets</code>, or leave it on the built-in rotating sky.</span>
      <select data-nova-field="backgroundImagePath">${renderAssetOptions(backgroundOptions, selectedBackgroundPath, "Built-in rotating sky")}</select>
    </label>
    <label class="stack-field">
      <strong>Filter Layer</strong>
      <span class="micro">Canvas-level grade and color treatment.</span>
      <select data-nova-field="stylizationFilterPreset">
        <option value="none" ${selectedStylizationFilterPreset === "none" ? "selected" : ""}>None</option>
        <option value="soft" ${selectedStylizationFilterPreset === "soft" ? "selected" : ""}>Soft</option>
        <option value="cinematic" ${selectedStylizationFilterPreset === "cinematic" ? "selected" : ""}>Cinematic</option>
        <option value="noir" ${selectedStylizationFilterPreset === "noir" ? "selected" : ""}>Noir</option>
        <option value="vivid" ${selectedStylizationFilterPreset === "vivid" ? "selected" : ""}>Vivid</option>
        <option value="dream" ${selectedStylizationFilterPreset === "dream" ? "selected" : ""}>Dream Grade</option>
        <option value="retro_vhs" ${selectedStylizationFilterPreset === "retro_vhs" ? "selected" : ""}>Retro VHS Grade</option>
        <option value="haunted" ${selectedStylizationFilterPreset === "haunted" ? "selected" : ""}>Haunted</option>
        <option value="surveillance" ${selectedStylizationFilterPreset === "surveillance" ? "selected" : ""}>Surveillance</option>
        <option value="crystal" ${selectedStylizationFilterPreset === "crystal" ? "selected" : ""}>Crystal</option>
        <option value="whimsical" ${selectedStylizationFilterPreset === "whimsical" ? "selected" : ""}>Whimsical</option>
      </select>
    </label>
    <label class="stack-field">
      <strong>Effect Layer</strong>
      <span class="micro">Renderer/postprocessing effects like toon, bloom, or VHS noise.</span>
      <select data-nova-field="stylizationEffectPreset">
        <option value="none" ${selectedStylizationEffectPreset === "none" ? "selected" : ""}>None</option>
        <option value="toon" ${selectedStylizationEffectPreset === "toon" ? "selected" : ""}>Toon</option>
        <option value="dream" ${selectedStylizationEffectPreset === "dream" ? "selected" : ""}>Dream</option>
        <option value="retro_vhs" ${selectedStylizationEffectPreset === "retro_vhs" ? "selected" : ""}>Retro VHS</option>
        <option value="whimsical" ${selectedStylizationEffectPreset === "whimsical" ? "selected" : ""}>Whimsical</option>
      </select>
    </label>
    <div class="stack-list">
      ${Object.entries(textureFieldLabels).map(([field, label]) => `
        <label class="stack-field">
          <strong>${escapeHtml(label)}</strong>
          <select data-nova-room-texture="${escapeAttr(field)}">${renderAssetOptions(textureOptions, String(roomTextures?.[field] || "").trim(), "Use material color")}</select>
        </label>
      `).join("")}
    </div>
  `;
  novaPropsSettingsListEl.innerHTML = `
    <div class="stack-list">
      ${Object.entries(propFieldLabels).map(([field, label]) => `
        <div class="stack-field">
          <strong>${escapeHtml(label)}</strong>
          <select data-nova-prop-slot="${escapeAttr(field)}">${renderAssetOptions(propOptions, String((propSlots?.[field] && typeof propSlots[field] === "object" ? propSlots[field].model : propSlots?.[field]) || "").trim(), "Empty slot")}</select>
          <input type="range" min="0.2" max="3" step="0.05" data-nova-prop-scale="${escapeAttr(field)}" value="${escapeAttr(String(Number((propSlots?.[field] && typeof propSlots[field] === "object" ? propSlots[field].scale : 1) || 1).toFixed(2)))}" />
          <div class="micro" id="novaPropScaleValue-${escapeAttr(field)}">${escapeHtml(`${Number((propSlots?.[field] && typeof propSlots[field] === "object" ? propSlots[field].scale : 1) || 1).toFixed(2)}x`)}</div>
        </div>
      `).join("")}
    </div>
  `;
  const novaSettingsRootEls = [
    novaIdentitySettingsListEl,
    novaTrustSettingsListEl,
    novaEnvironmentSettingsListEl,
    novaPropsSettingsListEl
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
    rootEl.querySelectorAll("[data-nova-room-texture]").forEach((input) => {
      input.onchange = () => {
        const field = String(input.dataset.novaRoomTexture || "").trim();
        if (!field || !novaConfigDraft?.app) {
          return;
        }
        if (!novaConfigDraft.app.roomTextures || typeof novaConfigDraft.app.roomTextures !== "object") {
          novaConfigDraft.app.roomTextures = {};
        }
        novaConfigDraft.app.roomTextures[field] = String(input.value || "");
      };
    });
    rootEl.querySelectorAll("[data-nova-prop-slot]").forEach((input) => {
      input.onchange = () => {
        const field = String(input.dataset.novaPropSlot || "").trim();
        if (!field || !novaConfigDraft?.app) {
          return;
        }
        if (!novaConfigDraft.app.propSlots || typeof novaConfigDraft.app.propSlots !== "object") {
          novaConfigDraft.app.propSlots = {};
        }
        const current = novaConfigDraft.app.propSlots[field];
        const scale = current && typeof current === "object" ? Number(current.scale || 1) : 1;
        novaConfigDraft.app.propSlots[field] = {
          model: String(input.value || ""),
          scale
        };
      };
    });
    rootEl.querySelectorAll("[data-nova-prop-scale]").forEach((input) => {
      input.oninput = () => {
        const field = String(input.dataset.novaPropScale || "").trim();
        if (!field || !novaConfigDraft?.app) {
          return;
        }
        if (!novaConfigDraft.app.propSlots || typeof novaConfigDraft.app.propSlots !== "object") {
          novaConfigDraft.app.propSlots = {};
        }
        const current = novaConfigDraft.app.propSlots[field];
        const model = current && typeof current === "object" ? String(current.model || "") : "";
        const scale = Number(input.value || 1);
        novaConfigDraft.app.propSlots[field] = {
          model,
          scale
        };
        const valueEl = document.getElementById(`novaPropScaleValue-${field}`);
        if (valueEl) {
          valueEl.textContent = `${scale.toFixed(2)}x`;
        }
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
    novaHintEl.textContent = "Nova settings loaded.";
  } catch (error) {
    novaConfigDraft = null;
    renderNovaConfigEditor();
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
    const r = await fetch("/api/app/config", {
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
  remotePlannerSelectEl.onchange = () => { brainConfigDraft.routing.remoteTriageBrainId = remotePlannerSelectEl.value; };
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
    const payload = {
      brains: {
        enabledIds: brainConfigDraft.brains?.enabledIds || [],
        endpoints: brainConfigDraft.brains?.endpoints || {},
        assignments: brainConfigDraft.brains?.assignments || {},
        custom: brainConfigDraft.brains?.custom || []
      },
      routing: brainConfigDraft.routing || {},
      queue: brainConfigDraft.queue || {}
    };
    const r = await fetch("/api/brains/config", {
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
      </div>
    `).join("")
    : `<div class="panel-subtle">No built-in tools available.</div>`;

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

function projectDurationToDisplay(value, unit = "ms") {
  const raw = Number(value || 0);
  if (unit === "hours") return String((raw / (60 * 60 * 1000)).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"));
  if (unit === "seconds") return String((raw / 1000).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"));
  if (unit === "days") return String((raw / (24 * 60 * 60 * 1000)).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"));
  return String(raw);
}

function projectDisplayToDuration(value, unit = "ms") {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (unit === "hours") return Math.round(numeric * 60 * 60 * 1000);
  if (unit === "seconds") return Math.round(numeric * 1000);
  if (unit === "days") return Math.round(numeric * 24 * 60 * 60 * 1000);
  return Math.round(numeric);
}

function renderProjectConfigEditor() {
  if (!projectConfigDraft) {
    projectsOverviewSelectEl.innerHTML = `<option value="">Project overview unavailable</option>`;
    projectsOverviewSelectEl.disabled = true;
    projectsOverviewListEl.innerHTML = `<div class="panel-subtle">Project overview unavailable.</div>`;
    projectsCompletedListEl.innerHTML = `<div class="panel-subtle">Completed project jobs unavailable.</div>`;
    projectsSettingsListEl.innerHTML = `<div class="panel-subtle">Project configuration unavailable.</div>`;
    projectsStateSummaryEl.innerHTML = `<div class="panel-subtle">Project state unavailable.</div>`;
    projectsWorkspaceListEl.innerHTML = `<div class="panel-subtle">Project state unavailable.</div>`;
    projectsActiveTasksListEl.innerHTML = `<div class="panel-subtle">Project state unavailable.</div>`;
    projectsFailuresListEl.innerHTML = `<div class="panel-subtle">Project state unavailable.</div>`;
    projectsPoliciesListEl.innerHTML = `<div class="panel-subtle">Project state unavailable.</div>`;
    return;
  }

  const projects = projectConfigDraft.projects || {};
  const state = projectConfigDraft.state || {};
  const summary = state.summary || {};
  const projectPanels = Array.isArray(state.projectPanels) ? state.projectPanels : [];
  const workspaceProjects = Array.isArray(state.workspaceProjects) ? state.workspaceProjects : [];
  const activeTasks = Array.isArray(state.activeProjectTasks) ? state.activeProjectTasks : [];
  const recentFailures = Array.isArray(state.recentProjectFailures) ? state.recentProjectFailures : [];
  const recentImports = Array.isArray(state.recentImports) ? state.recentImports : [];
  const rolePlaybooks = Array.isArray(state.rolePlaybooks) ? state.rolePlaybooks : [];
  const policies = state.policies || {};
  const completedProjectJobs = projectPanels.flatMap((project) => {
    const recentJobs = Array.isArray(project?.recentJobs) ? project.recentJobs : [];
    const readyExports = Array.isArray(project?.history?.readyExports) ? project.history.readyExports : [];
    const latestReady = readyExports[0] || null;
    const settledJobs = recentJobs.filter((entry) => !["queued", "in_progress", "waiting_for_user"].includes(String(entry?.finalStatus || "").trim()));
    if (settledJobs.length) {
      return settledJobs.map((job) => ({
        projectName: String(project?.name || project?.sourceName || "(unnamed project)").trim() || "(unnamed project)",
        sourceName: String(project?.sourceName || "").trim(),
        stage: String(project?.currentStage || "").trim(),
        outputPath: String(latestReady?.path || "").trim(),
        outputAt: Number(latestReady?.occurredAt || 0),
        job
      }));
    }
    if (latestReady?.path) {
      return [{
        projectName: String(project?.name || project?.sourceName || "(unnamed project)").trim() || "(unnamed project)",
        sourceName: String(project?.sourceName || "").trim(),
        stage: "completed",
        outputPath: String(latestReady.path || "").trim(),
        outputAt: Number(latestReady.occurredAt || 0),
        job: null
      }];
    }
    return [];
  }).sort((left, right) => {
    const leftTime = Number(left?.job?.updatedAt || left?.outputAt || 0);
    const rightTime = Number(right?.job?.updatedAt || right?.outputAt || 0);
    return rightTime - leftTime;
  });
  const activeOverviewProjects = projectPanels.filter((project) =>
    String(project?.currentStage || "").trim().toLowerCase() !== "completed"
  );
  const fallbackOverviewProjects = activeOverviewProjects.length
    ? activeOverviewProjects
    : (projectPanels[0] ? [projectPanels[0]] : []);
  const projectOptionList = fallbackOverviewProjects.map((project, index) => ({
    key: getProjectOverviewKey(project, index),
    label: getProjectOverviewLabel(project)
  }));
  const selectedProjectKey = projectOptionList.some((entry) => entry.key === activeProjectOverviewKey)
    ? activeProjectOverviewKey
    : (projectOptionList[0]?.key || "");
  const selectedProjectIndex = projectOptionList.findIndex((entry) => entry.key === selectedProjectKey);
  const selectedProject = selectedProjectIndex >= 0 ? fallbackOverviewProjects[selectedProjectIndex] : null;

  activeProjectOverviewKey = selectedProjectKey;
  projectsOverviewSelectEl.disabled = !projectOptionList.length;
  projectsOverviewSelectEl.innerHTML = projectOptionList.length
    ? projectOptionList.map((entry) => `<option value="${escapeAttr(entry.key)}"${entry.key === selectedProjectKey ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")
    : `<option value="">No active projects</option>`;
  projectsOverviewSelectEl.onchange = () => {
    activeProjectOverviewKey = String(projectsOverviewSelectEl.value || "").trim();
    renderProjectConfigEditor();
  };

  projectsOverviewListEl.innerHTML = selectedProject
    ? renderProjectOverviewCard(selectedProject)
    : `<div class="panel-subtle">No active project overviews are available right now.</div>`;
  projectsCompletedListEl.innerHTML = completedProjectJobs.length
    ? completedProjectJobs.slice(0, 24).map((entry) => renderCompletedProjectJobCard(entry)).join("")
    : `<div class="panel-subtle">No completed or exported project jobs are recorded yet.</div>`;

  projectsSettingsListEl.innerHTML = `
    <div class="projects-settings-stack">
      <label class="project-setting-row stack-field">
        <strong>Max active work packages per project</strong>
        <span class="micro">Concurrent focused project-cycle packages allowed for one project.</span>
        <input type="number" min="1" max="12" step="1" data-project-field="maxActiveWorkPackagesPerProject" value="${escapeHtml(String(projects.maxActiveWorkPackagesPerProject || 6))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Project retry cooldown (hours)</strong>
        <span class="micro">Minimum delay before the same project work item is eligible again.</span>
        <input type="number" min="0" max="168" step="0.5" data-project-field="projectWorkRetryCooldownMs" data-project-unit="hours" value="${escapeHtml(projectDurationToDisplay(projects.projectWorkRetryCooldownMs, "hours"))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Idle scan wait after activity (seconds)</strong>
        <span class="micro">How long the system waits after activity before opportunity scanning can run.</span>
        <input type="number" min="5" max="3600" step="1" data-project-field="opportunityScanIdleMs" data-project-unit="seconds" value="${escapeHtml(projectDurationToDisplay(projects.opportunityScanIdleMs, "seconds"))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Opportunity scan interval (seconds)</strong>
        <span class="micro">How often the idle scan wakes up to inspect project opportunities.</span>
        <input type="number" min="10" max="3600" step="1" data-project-field="opportunityScanIntervalMs" data-project-unit="seconds" value="${escapeHtml(projectDurationToDisplay(projects.opportunityScanIntervalMs, "seconds"))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Opportunity retention window (days)</strong>
        <span class="micro">How long scan-memory entries are kept before pruning.</span>
        <input type="number" min="0.1" max="365" step="0.5" data-project-field="opportunityScanRetentionMs" data-project-unit="days" value="${escapeHtml(projectDurationToDisplay(projects.opportunityScanRetentionMs, "days"))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Queued backlog cap before scan skips</strong>
        <span class="micro">If the queue reaches this depth, opportunity scan will not add more project work.</span>
        <input type="number" min="1" max="50" step="1" data-project-field="opportunityScanMaxQueuedBacklog" value="${escapeHtml(String(projects.opportunityScanMaxQueuedBacklog || 5))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Minimum concrete targets for no-change</strong>
        <span class="micro">Project-cycle workers must inspect at least this many concrete targets before claiming no safe change.</span>
        <input type="number" min="1" max="6" step="1" data-project-field="noChangeMinimumConcreteTargets" value="${escapeHtml(String(projects.noChangeMinimumConcreteTargets || 3))}" />
      </label>
    </div>
    <div class="project-toggle-list">
      <label class="toggle project-toggle-row">
        <input type="checkbox" data-project-field="autoCreateProjectTodo" ${projects.autoCreateProjectTodo !== false ? "checked" : ""} />
        <span>
          <strong>Auto-create PROJECT-TODO.md</strong>
          <div class="micro">Seed missing project todo files from native inspection.</div>
        </span>
      </label>
      <label class="toggle project-toggle-row">
        <input type="checkbox" data-project-field="autoCreateProjectRoleTasks" ${projects.autoCreateProjectRoleTasks !== false ? "checked" : ""} />
        <span>
          <strong>Auto-create PROJECT-ROLE-TASKS.md</strong>
          <div class="micro">Seed missing role task boards from project inspection.</div>
        </span>
      </label>
      <label class="toggle project-toggle-row">
        <input type="checkbox" data-project-field="autoImportProjects" ${projects.autoImportProjects !== false ? "checked" : ""} />
        <span>
          <strong>Auto-import repository projects</strong>
          <div class="micro">Pull fresh projects into the workspace during idle rotation.</div>
        </span>
      </label>
      <label class="toggle project-toggle-row">
        <input type="checkbox" data-project-field="autoExportReadyProjects" ${projects.autoExportReadyProjects !== false ? "checked" : ""} />
        <span>
          <strong>Auto-export ready projects</strong>
          <div class="micro">Move completed workspace projects into observer output automatically.</div>
        </span>
      </label>
    </div>
  `;

  projectsSettingsListEl.querySelectorAll("[data-project-field]").forEach((input) => {
    input.onchange = () => {
      const field = String(input.dataset.projectField || "").trim();
      if (!field || !projectConfigDraft?.projects) {
        return;
      }
      if (input.type === "checkbox") {
        projectConfigDraft.projects[field] = input.checked;
        return;
      }
      const unit = String(input.dataset.projectUnit || "").trim();
      const numericValue = Number(input.value || 0);
      projectConfigDraft.projects[field] = unit
        ? projectDisplayToDuration(numericValue, unit)
        : Math.round(numericValue);
    };
  });

  projectsStateSummaryEl.innerHTML = `
    <div class="summary-box">
      <strong>Workspace projects</strong>
      <div class="summary-pill">${escapeHtml(String(summary.workspaceProjectCount || 0))}</div>
      <div class="micro">Projects currently present in the workspace container.</div>
    </div>
    <div class="summary-box">
      <strong>Active project tasks</strong>
      <div class="summary-pill">${escapeHtml(String(summary.activeProjectTaskCount || 0))}</div>
      <div class="micro">Queued or running project-cycle tasks.</div>
    </div>
    <div class="summary-box">
      <strong>Waiting project tasks</strong>
      <div class="summary-pill">${escapeHtml(String(summary.waitingProjectTaskCount || 0))}</div>
      <div class="micro">Project tasks currently blocked on a user answer.</div>
    </div>
    <div class="summary-box">
      <strong>Recent project failures</strong>
      <div class="summary-pill">${escapeHtml(String(summary.recentProjectFailureCount || 0))}</div>
      <div class="micro">Recent project-cycle failures captured in history.</div>
    </div>
  `;

  projectsWorkspaceListEl.innerHTML = workspaceProjects.length
    ? workspaceProjects.map((project) => `
      <div class="project-list-row">
        <strong>${escapeHtml(project.name || "(unnamed)")}</strong>
        <div class="micro">${escapeHtml(project.activeTaskCount ? `${project.activeTaskCount} active task${project.activeTaskCount === 1 ? "" : "s"}` : "Idle")}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No workspace projects are loaded right now.</div>`;

  projectsActiveTasksListEl.innerHTML = activeTasks.length
    ? activeTasks.map((task) => `
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>${escapeHtml(task.codename || task.id || "Task")}</strong>
          <span class="brain-pill">${escapeHtml(task.requestedBrainLabel || "worker")}</span>
        </div>
        <div class="micro">${escapeHtml(task.projectName || "(unknown project)")} · ${escapeHtml(String(task.status || "").replaceAll("_", " "))} · ${escapeHtml(formatDateTime(task.updatedAt))}</div>
        <div class="micro">${escapeHtml(task.focus || "No focus recorded.")}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No active project-cycle tasks.</div>`;

  projectsFailuresListEl.innerHTML = recentFailures.length
    ? recentFailures.map((task) => `
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>${escapeHtml(task.codename || task.id || "Task")}</strong>
          <span class="brain-pill">${escapeHtml(task.failureClassification || "unknown")}</span>
        </div>
        <div class="micro">${escapeHtml(task.projectName || "(unknown project)")} · ${escapeHtml(formatDateTime(task.updatedAt))}</div>
        <div class="micro">${escapeHtml(task.summary || "No summary recorded.")}</div>
        ${task.toolLoopSummary && task.toolLoopSummary !== task.summary ? `<div class="micro">${escapeHtml(task.toolLoopSummary)}</div>` : ""}
      </div>
    `).join("")
    : `<div class="panel-subtle">No recent project-cycle failures.</div>`;

  const importLines = recentImports.length
    ? recentImports.map((entry) => `<div class="micro">${escapeHtml(entry.sourceName || "(unknown)")} · ${escapeHtml(formatDateTime(entry.importedAt))}</div>`).join("")
    : `<div class="panel-subtle">No recent project imports recorded.</div>`;
  const playbookLines = rolePlaybooks.length
    ? rolePlaybooks.slice(0, 8).map((entry) => `<div class="micro"><strong>${escapeHtml(entry.name)}</strong>: ${escapeHtml(entry.playbook)}</div>`).join("")
    : `<div class="panel-subtle">No role playbooks registered.</div>`;
  const policyLines = [
    ...(Array.isArray(policies.targetScoring) ? policies.targetScoring.map((entry) => `<div class="micro">Target scoring: ${escapeHtml(entry)}</div>`) : []),
    ...(Array.isArray(policies.loopRepair) ? policies.loopRepair.map((entry) => `<div class="micro">Loop repair: ${escapeHtml(entry)}</div>`) : [])
  ].join("");
  projectsPoliciesListEl.innerHTML = `
    <div class="stack-list">
      <div>
        <strong>Recent imports</strong>
        ${importLines}
      </div>
      <div>
        <strong>Role playbooks (${escapeHtml(String(rolePlaybooks.length || 0))})</strong>
        ${playbookLines}
      </div>
      <div>
        <strong>Fixed policies</strong>
        ${policyLines || `<div class="panel-subtle">No project policies exposed.</div>`}
      </div>
    </div>
  `;

  projectsActiveTasksListEl.innerHTML = activeTasks.length
    ? activeTasks.map((task) => `
      <div class="project-list-row">
        <div class="project-item-title">
          <strong>${escapeHtml(task.codename || task.id || "Task")}</strong>
        </div>
        <div><span class="brain-pill">${escapeHtml(task.requestedBrainLabel || "worker")}</span></div>
        <div class="micro">${escapeHtml(task.projectName || "(unknown project)")} - ${escapeHtml(String(task.status || "").replaceAll("_", " "))} - ${escapeHtml(formatDateTime(task.updatedAt))}</div>
        <div class="micro">${escapeHtml(task.focus || "No focus recorded.")}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No active project-cycle tasks.</div>`;

  projectsFailuresListEl.innerHTML = recentFailures.length
    ? recentFailures.map((task) => `
      <div class="project-list-row">
        <div class="project-item-title">
          <strong>${escapeHtml(task.codename || task.id || "Task")}</strong>
        </div>
        <div><span class="brain-pill">${escapeHtml(task.failureClassification || "unknown")}</span></div>
        <div class="micro">${escapeHtml(task.projectName || "(unknown project)")} - ${escapeHtml(formatDateTime(task.updatedAt))}</div>
        <div class="micro">${escapeHtml(task.summary || "No summary recorded.")}</div>
        ${task.toolLoopSummary && task.toolLoopSummary !== task.summary ? `<div class="micro">${escapeHtml(task.toolLoopSummary)}</div>` : ""}
      </div>
    `).join("")
    : `<div class="panel-subtle">No recent project-cycle failures.</div>`;

  projectsPoliciesListEl.innerHTML = `
    <div class="projects-policy-stack">
      <div class="project-policy-group">
        <strong>Recent imports</strong>
        ${recentImports.length
          ? recentImports.map((entry) => `<div class="project-policy-line micro">${escapeHtml(entry.sourceName || "(unknown)")} - ${escapeHtml(formatDateTime(entry.importedAt))}</div>`).join("")
          : `<div class="panel-subtle">No recent project imports recorded.</div>`}
      </div>
      <div class="project-policy-group">
        <strong>Role playbooks (${escapeHtml(String(rolePlaybooks.length || 0))})</strong>
        ${rolePlaybooks.length
          ? rolePlaybooks.slice(0, 8).map((entry) => `<div class="project-policy-line micro"><strong>${escapeHtml(entry.name)}</strong><br>${escapeHtml(entry.playbook)}</div>`).join("")
          : `<div class="panel-subtle">No role playbooks registered.</div>`}
      </div>
      <div class="project-policy-group">
        <strong>Fixed policies</strong>
        ${[
          ...(Array.isArray(policies.targetScoring) ? policies.targetScoring.map((entry) => `<div class="project-policy-line micro"><strong>Target scoring</strong><br>${escapeHtml(entry)}</div>`) : []),
          ...(Array.isArray(policies.loopRepair) ? policies.loopRepair.map((entry) => `<div class="project-policy-line micro"><strong>Loop repair</strong><br>${escapeHtml(entry)}</div>`) : [])
        ].join("") || `<div class="panel-subtle">No project policies exposed.</div>`}
      </div>
    </div>
  `;
}

function getProjectOverviewKey(project = {}, index = 0) {
  const workspacePath = String(project?.workspace?.path || "").trim().toLowerCase();
  const sourcePath = String(project?.source?.path || "").trim().toLowerCase();
  const name = String(project?.name || "").trim().toLowerCase();
  const sourceName = String(project?.sourceName || "").trim().toLowerCase();
  return workspacePath || sourcePath || `${sourceName}::${name}` || `project-${index}`;
}

function getProjectOverviewLabel(project = {}) {
  const name = String(project?.name || project?.sourceName || "(unnamed project)").trim() || "(unnamed project)";
  const stage = formatProjectStageLabel(project?.currentStage);
  return `${name} | ${stage}`;
}

function formatProjectStageLabel(stage = "") {
  const normalized = String(stage || "").trim().toLowerCase();
  if (normalized === "active") return "Working";
  if (normalized === "workspace") return "In workspace";
  if (normalized === "completed") return "Ready output";
  if (normalized === "archived") return "Archived";
  if (normalized === "intake") return "In intake";
  return "History";
}

function projectStagePillClass(stage = "") {
  const normalized = String(stage || "").trim().toLowerCase();
  if (["active", "workspace", "completed"].includes(normalized)) return "on";
  if (normalized === "archived") return "";
  return "off";
}

function renderProjectMiniStat(label, value, hint = "", tone = "") {
  return `
    <div class="project-mini-stat ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value || 0))}</strong>
      ${hint ? `<div class="micro">${escapeHtml(hint)}</div>` : ""}
    </div>
  `;
}

function renderProjectChecklistPanel(title, bucket = {}, { objective = "", emptyText = "No items recorded." } = {}) {
  const checked = Array.isArray(bucket?.checked) ? bucket.checked : [];
  const unchecked = Array.isArray(bucket?.unchecked) ? bucket.unchecked : [];
  const checkedCount = Number(bucket?.checkedCount || checked.length);
  const uncheckedCount = Number(bucket?.uncheckedCount || unchecked.length);
  const total = checkedCount + uncheckedCount;
  const previewLines = [
    ...unchecked.slice(0, 3).map((item) => `<div class="project-check-item open">${escapeHtml(item)}</div>`),
    ...checked.slice(0, 2).map((item) => `<div class="project-check-item done">${escapeHtml(item)}</div>`)
  ];
  return `
    <div class="project-checklist-panel">
      <div class="project-checklist-head">
        <strong>${escapeHtml(title)}</strong>
        <span class="summary-pill ${uncheckedCount ? "" : "on"}">${escapeHtml(total ? `${checkedCount}/${total}` : "0/0")}</span>
      </div>
      <div class="micro">${escapeHtml(uncheckedCount ? `${uncheckedCount} open` : "Nothing open")}${checkedCount ? ` | ${escapeHtml(`${checkedCount} done`)}` : ""}</div>
      ${objective ? `<div class="project-directive-objective">${escapeHtml(objective)}</div>` : ""}
      ${previewLines.length ? previewLines.join("") : `<div class="panel-subtle">${escapeHtml(emptyText)}</div>`}
    </div>
  `;
}

function renderProjectTaskLine(task = {}, label = "Task") {
  const meta = [
    String(task?.requestedBrainLabel || "").trim(),
    String(task?.status || "").trim().replaceAll("_", " "),
    task?.updatedAt ? formatDateTime(task.updatedAt) : ""
  ].filter(Boolean).join(" | ");
  const roleMeta = String(task?.roleName || "").trim()
    ? `Role: ${String(task.roleName || "").trim()}${task?.roleReason ? ` | ${String(task.roleReason || "").trim()}` : ""}`
    : "";
  return `
    <div class="project-activity-item">
      <div class="history-meta">
        <span>${escapeHtml(String(task?.codename || task?.id || label).trim() || label)}</span>
        ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
      </div>
      <div class="history-body">${escapeHtml(String(task?.focus || "").trim() || "No focus recorded.")}</div>
      ${roleMeta ? `<div class="micro">${escapeHtml(roleMeta)}</div>` : ""}
      ${task?.summary ? `<div class="micro">${escapeHtml(String(task.summary || "").trim())}</div>` : ""}
    </div>
  `;
}

function renderProjectJobLine(job = {}) {
  const meta = [
    String(job?.latestRequestedBrainLabel || "").trim(),
    String(job?.finalStatus || "").trim().replaceAll("_", " "),
    job?.updatedAt ? formatDateTime(job.updatedAt) : ""
  ].filter(Boolean).join(" | ");
  const extra = [
    Number(job?.attemptCount || 0) > 1 ? `${Number(job.attemptCount || 0)} attempts` : "1 attempt",
    String(job?.finalFailureClassification || "").trim() && String(job?.finalFailureClassification || "").trim() !== "unknown"
      ? String(job.finalFailureClassification).trim()
      : ""
  ].filter(Boolean).join(" | ");
  const roleMeta = String(job?.roleName || "").trim()
    ? `Role: ${String(job.roleName || "").trim()}${job?.roleReason ? ` | ${String(job.roleReason || "").trim()}` : ""}`
    : "";
  return `
    <div class="project-activity-item">
      <div class="history-meta">
        <span>${escapeHtml(String(job?.latestCodename || job?.latestTaskId || "Job").trim() || "Job")}</span>
        ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
      </div>
      <div class="history-body">${escapeHtml(String(job?.focus || "").trim() || "No objective recorded.")}</div>
      ${roleMeta ? `<div class="micro">${escapeHtml(roleMeta)}</div>` : ""}
      ${extra ? `<div class="micro">${escapeHtml(extra)}</div>` : ""}
    </div>
  `;
}

function renderProjectRoleReportCard(role = {}) {
  const unchecked = Array.isArray(role?.unchecked) ? role.unchecked : [];
  const checked = Array.isArray(role?.checked) ? role.checked : [];
  const recommended = Array.isArray(role?.recommended) ? role.recommended : [];
  const status = String(role?.status || "").trim().toLowerCase();
  const pillClass = status === "completed" ? "on" : status === "active" ? "" : "off";
  const statusLabel = status === "completed"
    ? "Closed"
    : status === "active"
      ? "Working"
      : "Planned";
  const preview = unchecked.length ? unchecked : checked.length ? checked : recommended;
  return `
    <div class="project-role-card">
      <div class="project-role-head">
        <strong>${escapeHtml(String(role?.name || "Role").trim() || "Role")}</strong>
        <span class="summary-pill ${pillClass}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="micro">${escapeHtml(`${Number(role?.uncheckedCount || unchecked.length)} open | ${Number(role?.checkedCount || checked.length)} done`)}</div>
      ${role?.reason ? `<div class="project-role-reason">${escapeHtml(String(role.reason || "").trim())}</div>` : ""}
      ${preview.length
        ? preview.slice(0, 3).map((item) => `<div class="project-check-item ${unchecked.length ? "open" : checked.length ? "done" : ""}">${escapeHtml(String(item || "").trim())}</div>`).join("")
        : `<div class="panel-subtle">${escapeHtml(String(role?.playbook || "No role summary yet.").trim() || "No role summary yet.")}</div>`}
    </div>
  `;
}

function renderProjectArtifactLine(entry = {}, label = "History") {
  const meta = [
    label,
    entry?.occurredAt ? formatDateTime(entry.occurredAt) : "Unknown time"
  ].filter(Boolean).join(" | ");
  const extra = [
    String(entry?.reason || "").trim(),
    String(entry?.label || "").trim()
  ].filter(Boolean).join(" | ");
  return `
    <div class="project-activity-item">
      <div class="history-meta"><span>${escapeHtml(meta)}</span></div>
      <div class="history-body">${escapeHtml(String(entry?.path || "").trim() || "Path unavailable.")}</div>
      ${extra ? `<div class="micro">${escapeHtml(extra)}</div>` : ""}
    </div>
  `;
}

function renderCompletedProjectJobCard(entry = {}) {
  const job = entry?.job && typeof entry.job === "object" ? entry.job : null;
  const projectName = String(entry?.projectName || "(unnamed project)").trim() || "(unnamed project)";
  const sourceName = String(entry?.sourceName || "").trim();
  const statusLabel = job?.finalStatus
    ? String(job.finalStatus || "").trim().replaceAll("_", " ")
    : "exported";
  const when = job?.updatedAt
    ? formatDateTime(job.updatedAt)
    : (entry?.outputAt ? formatDateTime(entry.outputAt) : "Unknown time");
  const focus = String(job?.focus || "").trim() || "Exported project snapshot";
  const detailBits = [
    sourceName && sourceName !== projectName ? `Source: ${sourceName}` : "",
    String(entry?.stage || "").trim() ? `Panel: ${formatProjectStageLabel(entry.stage)}` : "",
    entry?.outputPath ? "Ready output recorded" : ""
  ].filter(Boolean).join(" | ");
  const attemptBits = job
    ? [
      Number(job?.attemptCount || 0) > 1 ? `${Number(job.attemptCount || 0)} attempts` : "1 attempt",
      String(job?.finalFailureClassification || "").trim() && String(job?.finalFailureClassification || "").trim() !== "unknown"
        ? String(job.finalFailureClassification).trim()
        : ""
    ].filter(Boolean).join(" | ")
    : "";
  return `
    <article class="project-overview-card">
      <div class="project-overview-head">
        <div class="project-overview-title">
          <div class="project-overview-title-row">
            <h4>${escapeHtml(projectName)}</h4>
            <span class="summary-pill on">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="panel-subtle">${escapeHtml(when)}</div>
          ${detailBits ? `<div class="micro">${escapeHtml(detailBits)}</div>` : ""}
        </div>
      </div>
      <div class="project-overview-grid">
        <section class="project-overview-section">
          <div class="project-section-head">
            <strong>Completed Work</strong>
          </div>
          <div class="project-activity-list">
            <div class="project-activity-item">
              <div class="history-body">${escapeHtml(focus)}</div>
              ${job?.roleName ? `<div class="micro">${escapeHtml(`Role: ${String(job.roleName || "").trim()}${job?.roleReason ? ` | ${String(job.roleReason || "").trim()}` : ""}`)}</div>` : ""}
              ${attemptBits ? `<div class="micro">${escapeHtml(attemptBits)}</div>` : ""}
            </div>
          </div>
        </section>
        <section class="project-overview-section">
          <div class="project-section-head">
            <strong>Output</strong>
          </div>
          <div class="project-activity-list">
            ${entry?.outputPath
              ? `<div class="project-activity-item"><div class="history-body">${escapeHtml(String(entry.outputPath || "").trim())}</div></div>`
              : `<div class="panel-subtle">No ready-output path recorded for this completed job.</div>`}
          </div>
        </section>
      </div>
    </article>
  `;
}

function renderProjectOverviewCard(project = {}) {
  const source = project?.source && typeof project.source === "object" ? project.source : {};
  const workspace = project?.workspace && typeof project.workspace === "object" ? project.workspace : {};
  const checklist = project?.checklist && typeof project.checklist === "object" ? project.checklist : {};
  const checklistTotals = checklist?.totals && typeof checklist.totals === "object" ? checklist.totals : {};
  const history = project?.history && typeof project.history === "object" ? project.history : {};
  const readyExports = Array.isArray(history.readyExports) ? history.readyExports : [];
  const archivedExports = Array.isArray(history.archivedExports) ? history.archivedExports : [];
  const backups = Array.isArray(history.backups) ? history.backups : [];
  const activeTasks = Array.isArray(project.activeTasks) ? project.activeTasks : [];
  const waitingTasks = Array.isArray(project.waitingTasks) ? project.waitingTasks : [];
  const recentJobs = Array.isArray(project.recentJobs) ? project.recentJobs : [];
  const roleReports = Array.isArray(project.roleReports) ? project.roleReports : [];
  const settledJobs = recentJobs.filter((entry) => !["queued", "in_progress", "waiting_for_user"].includes(String(entry?.finalStatus || "").trim()));
  const latestReady = readyExports[0] || null;
  const latestArchive = archivedExports[0] || null;
  const latestBackup = backups[0] || null;
  const currentLocation = workspace?.present
    ? `Workspace: ${workspace.path}`
    : source?.present
      ? `Intake: ${source.path}`
      : latestReady?.path
        ? `Latest ready output: ${latestReady.path}`
        : latestArchive?.path
          ? `Latest archive: ${latestArchive.path}`
          : latestBackup?.path
            ? `Latest backup: ${latestBackup.path}`
            : "No tracked location yet.";
  const intakeState = source?.present
    ? `Available${source.modifiedAt ? ` | ${formatDateTime(source.modifiedAt)}` : ""}`
    : String(project?.sourceName || "").trim()
      ? `Seen as ${String(project.sourceName).trim()}`
      : "Not seen";
  const workspaceState = workspace?.present
    ? `${workspace.activeTaskCount ? `${workspace.activeTaskCount} active` : "Idle"}${workspace.waitingTaskCount ? ` | ${workspace.waitingTaskCount} waiting` : ""}`
    : "Not in workspace";
  const outputState = latestReady
    ? `Ready | ${formatDateTime(latestReady.occurredAt)}`
    : latestArchive
      ? `Archived | ${formatDateTime(latestArchive.occurredAt)}`
      : "Not exported";
  const historyState = backups.length
    ? `${backups.length} backup${backups.length === 1 ? "" : "s"}${latestBackup?.occurredAt ? ` | ${formatDateTime(latestBackup.occurredAt)}` : ""}`
    : "No backups";
  const outputHistoryHtml = [
    ...readyExports.slice(0, 2).map((entry) => renderProjectArtifactLine(entry, "Ready export")),
    ...archivedExports.slice(0, 2).map((entry) => renderProjectArtifactLine(entry, "Archive")),
    ...backups.slice(0, 2).map((entry) => renderProjectArtifactLine(entry, "Backup"))
  ].join("");

  return `
    <article class="project-overview-card">
      <div class="project-overview-head">
        <div class="project-overview-title">
          <div class="project-overview-title-row">
            <h4>${escapeHtml(String(project?.name || project?.sourceName || "(unnamed project)").trim() || "(unnamed project)")}</h4>
            <span class="summary-pill ${projectStagePillClass(project?.currentStage)}">${escapeHtml(formatProjectStageLabel(project?.currentStage))}</span>
          </div>
          <div class="panel-subtle">${escapeHtml(project?.sourceName && project.sourceName !== project.name ? `Source project: ${project.sourceName}` : "Project overview")}</div>
          <div class="micro" title="${escapeAttr(currentLocation)}">${escapeHtml(currentLocation)}</div>
        </div>
        <div class="project-mini-stats">
          ${renderProjectMiniStat("Open items", checklistTotals?.openItems || 0, checklistTotals?.totalItems ? `${checklistTotals.completionPercent || 0}% complete` : "No checklist")}
          ${renderProjectMiniStat("Active jobs", project?.metrics?.activeJobs || 0, activeTasks.length ? `${activeTasks.length} live` : "No live work", activeTasks.length ? "tone-warn" : "")}
          ${renderProjectMiniStat("Completed jobs", project?.metrics?.completedJobs || 0, settledJobs.length ? `${settledJobs.length} recent` : "No finished jobs", "tone-ok")}
          ${renderProjectMiniStat("Failures", project?.metrics?.failedJobs || 0, archivedExports.length ? `${archivedExports.length} archived` : "No recent failures", (project?.metrics?.failedJobs || 0) ? "tone-bad" : "")}
        </div>
      </div>

      <div class="project-stage-grid">
        <div class="project-stage-card">
          <strong>Intake</strong>
          <div class="micro">${escapeHtml(intakeState)}</div>
        </div>
        <div class="project-stage-card">
          <strong>Workspace</strong>
          <div class="micro">${escapeHtml(workspaceState)}</div>
        </div>
        <div class="project-stage-card">
          <strong>Output</strong>
          <div class="micro">${escapeHtml(outputState)}</div>
        </div>
        <div class="project-stage-card">
          <strong>History</strong>
          <div class="micro">${escapeHtml(historyState)}</div>
        </div>
      </div>

      <div class="project-overview-grid">
        <section class="project-overview-section">
          <div class="project-section-head">
            <strong>Checklist Status</strong>
            <span class="micro">${escapeHtml(checklistTotals?.totalItems ? `${checklistTotals.completedItems || 0}/${checklistTotals.totalItems} requirements closed` : "No tracked requirements yet")}</span>
          </div>
          <div class="project-checklist-grid">
            ${renderProjectChecklistPanel("Todo", checklist?.todo, { emptyText: "No PROJECT-TODO.md items yet." })}
            ${renderProjectChecklistPanel("Roles", checklist?.roles, { emptyText: "No role-board items yet." })}
            ${renderProjectChecklistPanel("Directive", checklist?.directive, {
              objective: String(checklist?.directive?.objective || "").trim(),
              emptyText: "No directive checklist detected."
            })}
          </div>
        </section>

        <section class="project-overview-section">
          <div class="project-section-head">
            <strong>Working Roles</strong>
            <span class="micro">${escapeHtml(roleReports.length ? `${roleReports.length} active or planned role${roleReports.length === 1 ? "" : "s"}` : "No role report yet")}</span>
          </div>
          <div class="project-role-grid">
            ${roleReports.length
              ? roleReports.map((role) => renderProjectRoleReportCard(role)).join("")
              : `<div class="panel-subtle">Nova has not selected working roles for this project yet.</div>`}
          </div>
        </section>

        <section class="project-overview-section">
          <div class="project-section-head">
            <strong>Current Work</strong>
            <span class="micro">${escapeHtml(waitingTasks.length ? `${waitingTasks.length} waiting for Nova` : activeTasks.length ? `${activeTasks.length} active package${activeTasks.length === 1 ? "" : "s"}` : "No live work right now")}</span>
          </div>
          <div class="project-activity-list">
            ${activeTasks.length
              ? activeTasks.map((task) => renderProjectTaskLine(task, "Active task")).join("")
              : waitingTasks.length
                ? waitingTasks.map((task) => renderProjectTaskLine(task, "Waiting task")).join("")
                : `<div class="panel-subtle">No active project-cycle work is running for this project.</div>`}
          </div>
        </section>

        <section class="project-overview-section">
          <div class="project-section-head">
            <strong>Job History</strong>
            <span class="micro">${escapeHtml(settledJobs.length ? "Recent finished jobs for this project" : "No finished jobs recorded yet")}</span>
          </div>
          <div class="project-activity-list">
            ${settledJobs.length
              ? settledJobs.slice(0, 5).map((job) => renderProjectJobLine(job)).join("")
              : `<div class="panel-subtle">No completed or failed project jobs are recorded yet.</div>`}
          </div>
        </section>

        <section class="project-overview-section">
          <div class="project-section-head">
            <strong>Output History</strong>
            <span class="micro">${escapeHtml(readyExports.length ? `${readyExports.length} ready export${readyExports.length === 1 ? "" : "s"}` : backups.length ? `${backups.length} backup snapshot${backups.length === 1 ? "" : "s"}` : "No output history yet")}</span>
          </div>
          <div class="project-activity-list">
            ${outputHistoryHtml || `<div class="panel-subtle">No output or backup history recorded yet.</div>`}
          </div>
        </section>
      </div>
    </article>
  `;
}

async function loadProjectConfig() {
  projectsHintEl.textContent = "Loading project configuration...";
  try {
    const r = await fetch("/api/projects/config");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load project configuration");
    }
    projectConfigDraft = cloneJson(j);
    renderProjectConfigEditor();
    projectsHintEl.textContent = "Project configuration loaded.";
  } catch (error) {
    projectsHintEl.textContent = `Failed to load project configuration: ${error.message}`;
    projectConfigDraft = null;
    renderProjectConfigEditor();
  }
}

async function saveProjectConfig() {
  if (!projectConfigDraft) {
    return;
  }
  saveProjectsBtn.disabled = true;
  projectsHintEl.textContent = "Saving project configuration...";
  try {
    const r = await fetch("/api/projects/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projects: projectConfigDraft.projects || {}
      })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to save project configuration");
    }
    projectConfigDraft = cloneJson(j);
    renderProjectConfigEditor();
    projectsHintEl.textContent = j.message || "Project configuration saved.";
    await loadRuntimeOptions();
    await loadCronJobs();
    await loadTaskQueue();
  } catch (error) {
    projectsHintEl.textContent = `Save failed: ${error.message}`;
  } finally {
    saveProjectsBtn.disabled = false;
  }
}

function renderSecretPresenceLabel(hasSecret) {
  return hasSecret ? "Stored" : "Missing";
}

function renderSecretPresenceTone(hasSecret) {
  return hasSecret ? "tone-ok" : "tone-warn";
}

function renderSecretsCatalogEditor() {
  if (!secretsOverviewListEl || !secretsMailListEl || !secretsWordPressListEl || !secretsRetrievalListEl || !secretsCustomListEl) {
    return;
  }
  if (!secretsCatalogDraft) {
    const unavailable = `<div class="panel-subtle">Secure keystore status is unavailable.</div>`;
    secretsOverviewListEl.innerHTML = unavailable;
    secretsMailListEl.innerHTML = unavailable;
    secretsWordPressListEl.innerHTML = unavailable;
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
        <div class="micro">${mail.enabled ? "Mail is enabled." : "Mail is disabled."} Active agent: ${escapeHtml(mail.activeAgentId || "(none)")}.</div>
      </div>
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>WordPress coverage</strong>
          <span class="brain-pill">${escapeHtml(`${wordpressStoredCount}/${wordpressSites.length || 0}`)}</span>
        </div>
        <div class="micro">${wordpressSites.length ? "Bridge sites are being tracked below." : "No WordPress bridge sites are configured."}</div>
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

  secretsMailListEl.innerHTML = mailAgents.length
    ? mailAgents.map((agent) => {
      const inputId = `secret-input-${hashId(`mail:${agent.passwordHandle}`)}`;
      return `
        <div class="secret-card">
          <div class="panel-head compact">
            <div>
              <strong>${escapeHtml(agent.label || agent.id || "Mail agent")}</strong>
              <div class="panel-subtle">${escapeHtml(agent.email || agent.user || agent.id || "")}${agent.active ? " | active agent" : ""}</div>
            </div>
            <span class="brain-pill ${renderSecretPresenceTone(agent.hasSecret)}">${escapeHtml(renderSecretPresenceLabel(agent.hasSecret))}</span>
          </div>
          <div class="micro"><strong>Handle:</strong> <code>${escapeHtml(agent.passwordHandle || "")}</code></div>
          <div class="controls secret-controls">
            <input id="${escapeAttr(inputId)}" type="password" placeholder="Enter mailbox password" />
            <button class="secondary" type="button" data-secret-set="${escapeAttr(agent.passwordHandle || "")}" data-secret-input-id="${escapeAttr(inputId)}">Store</button>
            <button class="secondary" type="button" data-secret-clear="${escapeAttr(agent.passwordHandle || "")}">Clear</button>
          </div>
        </div>
      `;
    }).join("")
    : `<div class="panel-subtle">No mail agents are configured.</div>`;

  secretsWordPressListEl.innerHTML = wordpressSites.length
    ? wordpressSites.map((site) => {
      const handle = String(site.sharedSecretHandle || "").trim();
      const inputId = `secret-input-${hashId(`wp:${handle}`)}`;
      return `
        <div class="secret-card">
          <div class="panel-head compact">
            <div>
              <strong>${escapeHtml(site.label || site.siteId || "WordPress site")}</strong>
              <div class="panel-subtle">${escapeHtml(site.baseUrl || site.siteId || "")}</div>
            </div>
            <span class="brain-pill ${renderSecretPresenceTone(site.hasSecret)}">${escapeHtml(renderSecretPresenceLabel(site.hasSecret))}</span>
          </div>
          <div class="micro"><strong>Handle:</strong> <code>${escapeHtml(handle)}</code></div>
          <div class="controls secret-controls">
            <input id="${escapeAttr(inputId)}" type="password" placeholder="Enter WordPress shared secret" />
            <button class="secondary" type="button" data-secret-set="${escapeAttr(handle)}" data-secret-input-id="${escapeAttr(inputId)}">Store</button>
            <button class="secondary" type="button" data-secret-clear="${escapeAttr(handle)}">Clear</button>
          </div>
        </div>
      `;
    }).join("")
    : `<div class="panel-subtle">No WordPress bridge sites are configured.</div>`;

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
    const trackedCount = (Array.isArray(j.catalog?.suggestedHandles) ? j.catalog.suggestedHandles.length : 0);
    secretsHintEl.textContent = `Secure keystore status loaded. ${trackedCount} suggested handle${trackedCount === 1 ? "" : "s"} available.`;
  } catch (error) {
    secretsCatalogDraft = null;
    renderSecretsCatalogEditor();
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
    await Promise.all([
      loadSecretsCatalog(),
      loadMailStatus(),
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
    await Promise.all([
      loadSecretsCatalog(),
      loadMailStatus(),
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
  loadStateInspector,
  loadTaskFile,
  loadTaskFiles,
  loadTaskQueue,
  loadTodoList,
  loadTaskReshapeIssues,
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
  activateCalendarSubtab,
  formatCalendarDateKey,
  parseCalendarInputValue,
  resetCalendarForm,
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
  buildMailObservation,
  isRemoteParallelMode,
  reportTaskEvent,
  syncInProgressTaskUpdates,
  pollTaskEvents,
  loadMailStatus,
  loadSecretsCatalog,
  loadCalendarEvents,
  loadPromptReview,
  resetToSimpleProjectState,
  renderCalendarMonth,
  updateCalendarFormState,
  pollMailInbox,
  sendMailMessage,
  loadBrainConfig,
  loadNovaConfig,
  loadProjectConfig,
  renderSecretsCatalogEditor,
  loadToolConfig,
  addBrainEndpointDraft,
  addCustomBrainDraft,
  saveBrainConfig,
  saveNovaConfig,
  saveProjectConfig,
  saveToolConfig,
  storeSecretHandle,
  clearSecretHandle,
  loadFile,
  refreshStatus,
  loadRuntimeOptions,
  setQueuePaused
});
})();

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
  if (data.type === "observer.connected") {
    return;
  }
  if (data.type === "mail.message" && data.mail) {
    const observation = observerApp.buildMailObservation(data.mail);
    enqueueUpdate({
      source: "mail",
      title: "New mail",
      displayText: observation.displayText,
      spokenText: observation.spokenText,
      rawText: observation.displayText,
      status: "ok",
      brainLabel: data.mail.agentLabel || "Mail"
    }, { priority: true });
    observerApp.loadMailStatus();
    return;
  }
  if (data.type === "mail.command" && data.mail) {
    const commandText = String(data.mail?.command?.text || "").trim();
    const actionText = String(data.mail?.command?.action || "detected").replaceAll("_", " ");
    enqueueUpdate({
      source: "mail",
      title: "Mail command",
      displayText: `${String(data.mail.fromName || data.mail.fromAddress || "Someone")} sent a mail command.\n\nAction: ${actionText}${commandText ? `\nCommand: ${commandText}` : ""}`,
      spokenText: observerApp.annotateNovaEmotion(`${String(data.mail.fromName || data.mail.fromAddress || "Someone")} sent a mail command. Action ${actionText}.`, "wave"),
      rawText: commandText,
      status: data.mail?.command?.action === "auto_queue" ? "queued" : "warn",
      brainLabel: data.mail.agentLabel || "Mail"
    }, { priority: true });
    observerApp.loadMailStatus();
    return;
  }
  if (data.type === "mail.quarantined" && data.mail) {
    enqueueUpdate({
      source: "mail",
      title: "Mail quarantined",
      displayText: `${String(data.mail.fromName || data.mail.fromAddress || "Someone")} was quarantined before review.\n\n${String(data.mail.subject || "(no subject)")}`,
      spokenText: "",
      rawText: "",
      status: "warn",
      brainLabel: data.mail.agentLabel || "Mail"
    }, { priority: true });
    observerApp.loadMailStatus();
    return;
  }
  if (typeof data.type === "string" && data.type.startsWith("todo.")) {
    observerApp.loadTaskQueue?.();
    if (data.type === "todo.created" && data.todo?.createdBy === "nova") {
      enqueueUpdate({
        source: "task",
        title: "To do added",
        displayText: `I added this to your to do list.\n\n${String(data.todo.text || "").trim()}`,
        spokenText: observerApp.annotateNovaEmotion(`I added this to your to do list. ${String(data.todo.text || "").trim()}`, "shrug"),
        status: "waiting_for_user",
        brainLabel: "Nova"
      }, { priority: true });
    } else if (data.type === "todo.reminder") {
      enqueueUpdate({
        source: "task",
        title: "To do reminder",
        displayText: String(data.text || "You have open to do items."),
        spokenText: observerApp.annotateNovaEmotion(String(data.text || "You have open to do items."), "shrug"),
        status: "waiting_for_user",
        brainLabel: "Nova"
      }, { priority: true });
    }
    return;
  }
  if (!data.task) {
    return;
  }
  latestTaskEventTs = Math.max(latestTaskEventTs, Number(data.task.updatedAt || data.task.createdAt || 0));
  saveEventCursor(TASK_CURSOR_KEY, latestTaskEventTs);
  if (data.type === "task.progress") {
    if (observerApp.isRemoteParallelMode && observerApp.isRemoteParallelMode()) {
      observerApp.loadTaskQueue();
      return;
    }
    observerApp.reportTaskEvent(data.task);
  } else if (data.type === "task.completed" || data.type === "task.escalated" || data.type === "task.recovered") {
    observerApp.reportTaskEvent(data.task);
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
