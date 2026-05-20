(() => {
const observerApp = window.ObserverApp || (window.ObserverApp = {});
const {
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
  renderRepairTaskList,
  renderTaskReshapeIssuesList,
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
let runtimeAdminTokenCache = "";

async function getAdminUiToken(forceRefresh = false) {
  if (!forceRefresh && runtimeAdminTokenCache) {
    return runtimeAdminTokenCache;
  }
  const tokenRes = await fetch("/api/admin-token");
  const tokenJson = await tokenRes.json().catch(() => ({}));
  const token = String(tokenJson?.token || "").trim();
  if (!token) {
    throw new Error(tokenJson?.error || "admin token unavailable");
  }
  runtimeAdminTokenCache = token;
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

function renderQdrantDetails(status = {}) {
  const docs = Math.max(0, Number(status?.indexedDocumentCount || 0));
  const chunks = Math.max(0, Number(status?.indexedChunkCount || 0));
  const syncLabel = Number(status?.lastSyncAt || 0)
    ? formatDateTime(status.lastSyncAt)
    : "Never";
  const authLabel = status?.enabled ? (status?.hasApiKey ? "Auth key stored" : "No auth key") : "Auth n/a";
  return `${docs} docs | ${chunks} chunks | ${authLabel} | Sync ${syncLabel}`;
}

async function resetToSimpleProjectState() {
  const hasCoreUi = observerApp.hasCoreStateBrowserUi?.() === true;
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
    if (hasCoreUi && observerApp.isTaskFilesScopeSelected?.()) {
      taskFileContentEl.textContent = summaryLines.length ? summaryLines.join("\n") : (j.message || "Reset complete.");
    } else if (hasCoreUi) {
      fileContentEl.textContent = summaryLines.length ? summaryLines.join("\n") : (j.message || "Reset complete.");
    }

    const refreshTasks = [
      loadTaskQueue()
    ];
    if (hasCoreUi) {
      refreshTasks.push(observerApp.loadStateInspector({ preserveSelection: false }));
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
    if (hasCoreUi && observerApp.isTaskFilesScopeSelected?.()) {
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
    observerApp.loadTaskFiles?.({ preserveSelection: true });
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
    String(activeQuestionTimeTaskId || "").trim() === taskId
    || String(pendingVoiceQuestionInviteTaskId || "").trim() === taskId
    || String(pendingVoiceQuestionTaskId || "").trim() === taskId
  ) {
    return true;
  }
  const narration = buildTaskNarration(task);
  if (typeof setQuestionTimeActive === "function") {
    setQuestionTimeActive(true);
  }
  if (typeof setActiveQuestionTimeTaskId === "function") {
    setActiveQuestionTimeTaskId(taskId);
  }
  enqueueUpdate({
    source: "task",
    title: "Question waiting",
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
  hintEl.textContent = "Nova asked a waiting question and is listening for the answer.";
  return true;
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
    const adminFetch = typeof observerApp.adminFetch === "function"
      ? observerApp.adminFetch.bind(observerApp)
      : pluginAdminFetch;
    const response = await adminFetch("/api/plugins/install", {
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
    observerApp.updateRemotePlannerHealthIndicator?.(brainActivity);
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

async function loadRuntimeOptions() {
  try {
    const r = await fetch("/api/runtime/options");
    const j = await r.json();
    runtimeOptions = j;
    observerApp.applyAppConfigToStage?.(runtimeOptions?.app || {});
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
  loadTaskQueue,
  loadTaskReshapeIssues,
  registerPluginEventHandler: (prefix, handler) => { pluginEventHandlers.set(String(prefix), handler); },
  registerTaskJobTypeHandler: (jobType, handler) => { taskJobTypeCompletedHandlers.set(String(jobType), handler); },
  replayWaitingQuestionThroughAvatar,
  enqueueTaskFromPrompt,
  triagePrompt,
  triagePromptLocally,
  dispatchNextTask,
  readFileAsBase64,
  populateBrainOptions,
  getDefaultMountIds,
  getSelectedMountIds,
  saveAccessSettings,
  loadSavedAccessSettings,
  updateAccessSummary,
  loadCronJobs,
  pollCronEvents,
  annotateNovaEmotion,
  pickTaskPhrase,
  buildTaskNarration,
  isRemoteParallelMode,
  reportTaskEvent,
  syncInProgressTaskUpdates,
  pollTaskEvents,
  resetToSimpleProjectState,
  installUploadedPluginPackage,
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
  } else if (data.type === "task.completed" || data.type === "task.escalated" || data.type === "task.recovered" || data.type === "task.waiting") {
    window.dispatchEvent(new CustomEvent("observer:task-event", { detail: data }));
    observerApp.reportTaskEvent(data.task);
    if (data.type !== "task.waiting") {
      taskJobTypeCompletedHandlers.get(String(data.task?.internalJobType || ""))?.(data.task);
    }
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

