(() => {
const observerApp = window.ObserverApp || (window.ObserverApp = {});
const taskHistoryCache = observerApp.taskHistoryCache || (observerApp.taskHistoryCache = new Map());
const taskHistoryExpandedIds = observerApp.taskHistoryExpandedIds || (observerApp.taskHistoryExpandedIds = new Set());
const taskHistoryLoadingIds = observerApp.taskHistoryLoadingIds || (observerApp.taskHistoryLoadingIds = new Set());
const taskHistoryErrorById = observerApp.taskHistoryErrorById || (observerApp.taskHistoryErrorById = new Map());

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildMenuIcon(shapes = []) {
  return [
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
    ...shapes,
    "</svg>"
  ].join("");
}

const menuTabIconMap = {
  gatewayTab: buildMenuIcon([
    '<circle cx="12" cy="12" r="7" />',
    '<path d="M12 12l4-4" />',
    '<path d="M12 8V4" />',
    '<circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none" />'
  ]),
  queueTab: buildMenuIcon([
    '<rect x="4" y="5" width="3" height="3" rx="1" />',
    '<path d="M10 6.5h10" />',
    '<rect x="4" y="10.5" width="3" height="3" rx="1" />',
    '<path d="M10 12h10" />',
    '<rect x="4" y="16" width="3" height="3" rx="1" />',
    '<path d="M10 17.5h10" />'
  ]),
  novaTab: buildMenuIcon([
    '<path d="M12 3v18" />',
    '<path d="M5 18 12 3l7 15" />',
    '<path d="M8.5 12h7" />'
  ]),
  brainsTab: buildMenuIcon([
    '<circle cx="6" cy="12" r="2" />',
    '<circle cx="12" cy="12" r="2" />',
    '<circle cx="18" cy="6" r="2" />',
    '<circle cx="18" cy="18" r="2" />',
    '<path d="M8 12h2" />',
    '<path d="M13.5 10.5l3-3" />',
    '<path d="M13.5 13.5l3 3" />'
  ]),
  toolsTab: buildMenuIcon([
    '<path d="M14.7 6.3a3.5 3.5 0 0 0-4.4 4.4L4 17.1 6.9 20l6.3-6.3a3.5 3.5 0 0 0 4.4-4.4l-2.7 1-1.9-1.9Z" />'
  ]),
  projectsTab: buildMenuIcon([
    '<path d="M5 6h14" />',
    '<path d="M5 12h10" />',
    '<path d="M5 18h8" />',
    '<circle cx="18" cy="12" r="3" />'
  ]),
  cronTab: buildMenuIcon([
    '<circle cx="12" cy="13" r="7" />',
    '<path d="M12 10v3l3 2" />',
    '<path d="M9 3h6" />',
    '<path d="M15.5 5.5 17 4" />'
  ]),
  calendarTab: buildMenuIcon([
    '<rect x="4" y="5" width="16" height="15" rx="2" />',
    '<path d="M8 3v4" />',
    '<path d="M16 3v4" />',
    '<path d="M4 9h16" />',
    '<path d="M8 13h3" />',
    '<path d="M13 13h3" />',
    '<path d="M8 17h3" />'
  ]),
  mailTab: buildMenuIcon([
    '<rect x="4" y="6" width="16" height="12" rx="2" />',
    '<path d="M4.5 7 12 13l7.5-6" />'
  ]),
  testsTab: buildMenuIcon([
    '<path d="M12 3 5 6v6c0 4.5 2.9 7.8 7 9 4.1-1.2 7-4.5 7-9V6l-7-3Z" />',
    '<path d="m9 12 2 2 4-4" />'
  ]),
  stateTab: buildMenuIcon([
    '<ellipse cx="12" cy="5" rx="7" ry="3" />',
    '<path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />',
    '<path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />'
  ])
};

const panelToggleIcons = {
  open: buildMenuIcon([
    '<rect x="4" y="5" width="16" height="14" rx="2" />',
    '<path d="M9 5v14" />',
    '<path d="m14 9-3 3 3 3" />'
  ]),
  closed: buildMenuIcon([
    '<rect x="4" y="5" width="16" height="14" rx="2" />',
    '<path d="M9 5v14" />',
    '<path d="m12 9 3 3-3 3" />'
  ])
};

function applyTabIcons() {
  tabButtons.forEach((button) => {
    const target = button.dataset.tabTarget;
    const iconEl = button.querySelector(".tab-icon");
    if (iconEl && menuTabIconMap[target]) {
      iconEl.innerHTML = menuTabIconMap[target];
    }
  });
}

function formatTime(value) {
  if (!value) return "Pending";
  return new Date(value).toLocaleTimeString();
}

function formatDateTime(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function formatDurationMs(value) {
  const ms = Number(value || 0);
  if (!ms) return "-";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderClarificationHistory(task) {
  const history = Array.isArray(task?.clarificationHistory) ? task.clarificationHistory : [];
  const lastAnswer = String(task?.lastUserAnswer || "").trim();
  if (!history.length && !lastAnswer) {
    return "";
  }
  const recentHistory = history.slice(-2);
  const recent = recentHistory.map((entry, index) => (
    `<div class="history-body"><strong>Clarification ${history.length - recentHistory.length + index + 1}.</strong><br>${escapeHtml(String(entry?.question || "").trim() || "(question not captured)")}<br><strong>Answer:</strong> ${escapeHtml(String(entry?.answer || "").trim() || "(empty)")}</div>`
  )).join("");
  if (recent) {
    return recent;
  }
  return `<div class="history-body"><strong>Latest answer:</strong> ${escapeHtml(lastAnswer)}</div>`;
}

function formatTaskHistoryEventLabel(entry) {
  const eventType = String(entry?.eventType || "").trim();
  if (eventType === "task.created") return "Created";
  if (eventType === "task.moved") return "Moved";
  if (eventType === "task.state_written") return "State saved";
  if (eventType === "task.waiting") return "Waiting";
  if (eventType === "task.answered") return "Answered";
  if (eventType === "task.recovered") return "Recovered";
  if (eventType === "task.completed") return "Completed";
  if (eventType === "task.failed") return "Failed";
  if (eventType === "task.closed") return "Closed";
  if (eventType === "task.removed") return "Removed";
  return eventType ? eventType.replace(/^task\./, "").replaceAll("_", " ") : "Updated";
}

function formatTaskHistoryEventBody(entry) {
  const fromStatus = String(entry?.fromStatus || "").trim().replaceAll("_", " ");
  const toStatus = String(entry?.toStatus || "").trim().replaceAll("_", " ");
  const reason = String(entry?.reason || "").trim();
  const parts = [];
  if (fromStatus || toStatus) {
    parts.push(fromStatus && toStatus ? `${fromStatus} -> ${toStatus}` : (toStatus || fromStatus));
  }
  if (reason) {
    parts.push(reason);
  }
  return parts.join(" | ") || "No details recorded.";
}

function renderTaskBreadcrumbHistory(task) {
  const taskId = String(task?.id || "").trim();
  if (!taskId) {
    return "";
  }
  const expanded = taskHistoryExpandedIds.has(taskId);
  const loading = taskHistoryLoadingIds.has(taskId);
  const error = String(taskHistoryErrorById.get(taskId) || "").trim();
  const historyEntries = Array.isArray(taskHistoryCache.get(taskId)) ? taskHistoryCache.get(taskId) : [];
  const historyBody = !expanded
    ? ""
    : loading
      ? `<div class="micro">Loading history...</div>`
      : error
        ? `<div class="micro">${escapeHtml(error)}</div>`
        : historyEntries.length
          ? historyEntries.map((entry) => {
            const metaBits = [
              formatTaskHistoryEventLabel(entry),
              formatDateTime(entry?.at),
              entry?.brainId ? `Brain: ${String(entry.brainId)}` : ""
            ].filter(Boolean);
            return `
              <div class="queue-history-entry">
                <div class="history-meta">${metaBits.map((bit) => `<span>${escapeHtml(bit)}</span>`).join("")}</div>
                <div class="history-body">${escapeHtml(formatTaskHistoryEventBody(entry))}</div>
              </div>
            `;
          }).join("")
          : `<div class="micro">No breadcrumb history recorded yet.</div>`;
  return `
    <div class="queue-history">
      ${expanded ? `<div class="queue-history-list">${historyBody}</div>` : ""}
    </div>
  `;
}

function renderRegressionResults(targetEl, report) {
  if (!targetEl) {
    return;
  }
  if (!report || !Array.isArray(report.suites) || !report.suites.length) {
    targetEl.innerHTML = `<div class="panel-subtle">No regression results yet.</div>`;
    return;
  }
  targetEl.innerHTML = report.suites.map((suite) => {
    const suiteTone = suite.passed ? "ok" : (suite.blocked ? "warn" : "bad");
    const suiteMeta = [
      suite.label || suite.suiteId || "Suite",
      formatDateTime(suite.completedAt || report.completedAt),
      suite.durationMs ? formatDurationMs(suite.durationMs) : ""
    ].filter(Boolean);
    const caseItems = (Array.isArray(suite.results) ? suite.results : []).map((entry) => {
      const tone = entry.passed ? "ok" : "bad";
      const failures = Array.isArray(entry.failures) ? entry.failures : [];
      const actual = entry.actual && typeof entry.actual === "object"
        ? `<pre class="json-box regression-actual">${escapeHtml(JSON.stringify(entry.actual, null, 2))}</pre>`
        : "";
      return `
        <div class="history-item regression-case ${tone}">
          <div class="history-meta">
            <span>${escapeHtml(entry.label || entry.id || "Case")}</span>
            <span>${escapeHtml(entry.passed ? "Passed" : "Failed")}</span>
            <span>${escapeHtml(formatDurationMs(entry.durationMs || 0))}</span>
          </div>
          <div class="history-body">${escapeHtml(entry.prompt || "")}</div>
          ${failures.length ? `<div class="history-body">${escapeHtml(failures.join("\n"))}</div>` : ""}
          ${actual}
        </div>
      `;
    }).join("");
    return `
      <div class="history-item regression-suite ${suiteTone}">
        <div class="history-meta">${suiteMeta.map((bit) => `<span>${escapeHtml(bit)}</span>`).join("")}</div>
        <div class="history-body">${escapeHtml(suite.summary || "")}</div>
        ${caseItems || `<div class="panel-subtle">No case results recorded.</div>`}
      </div>
    `;
  }).join("");
}

function renderRegressionSuiteList(targetEl, suites = [], activeRun = null) {
  if (!targetEl) {
    return;
  }
  if (!Array.isArray(suites) || !suites.length) {
    targetEl.innerHTML = `<div class="panel-subtle">No regression suites are registered.</div>`;
    return;
  }
  targetEl.innerHTML = suites.map((suite) => {
    const disabled = activeRun ? "disabled" : "";
    const activeBadge = activeRun && (activeRun.suiteId === "all" || activeRun.suiteId === suite.id)
      ? `<span class="status-chip warn">Running</span>`
      : "";
    return `
      <div class="history-item regression-suite-card">
        <div class="queue-item-head">
          <div>
            <strong>${escapeHtml(suite.label || suite.id || "Suite")}</strong>
            <div class="micro">${escapeHtml(suite.description || "")}</div>
            <div class="micro">${escapeHtml(`${suite.caseCount || 0} case${suite.caseCount === 1 ? "" : "s"}`)}${suite.requiresIdleWorkerLane ? " - requires idle local worker lane" : ""}</div>
          </div>
          <div class="queue-item-actions">
            ${activeBadge}
            <button type="button" class="secondary" data-run-regression-suite="${escapeAttr(suite.id || "")}" ${disabled}>Run</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function getTaskOutcomeText(task) {
  if (isPlainQuestionTask(task)) {
    return "";
  }
  const resultSummary = String(task?.resultSummary || "").trim();
  const reviewSummary = String(task?.reviewSummary || "").trim();
  const workerSummary = String(task?.workerSummary || "").trim();
  if (resultSummary) {
    return resultSummary;
  }
  if (reviewSummary) {
    return reviewSummary;
  }
  if (workerSummary) {
    return workerSummary;
  }
  const status = String(task?.status || "").trim().toLowerCase();
  if (["completed", "failed", "closed"].includes(status)) {
    return "No outcome summary was recorded for this task.";
  }
  return "";
}

function renderTaskReshapeBadges(task) {
  const badges = [];
  const reshapeAttemptCount = Math.max(0, Number(task?.reshapeAttemptCount || 0));
  if (reshapeAttemptCount > 0) {
    badges.push(`<span class="status-chip warn">Reshape ${escapeHtml(`${reshapeAttemptCount}/3`)}</span>`);
  }
  if (task?.reshapeIssueKey) {
    badges.push(`<span class="status-chip">${escapeHtml(String(task.failureClassification || "issue").replaceAll("_", " "))}</span>`);
  }
  if (task?.criticalFailure === true) {
    badges.push(`<span class="status-chip bad">Critical</span>`);
  }
  if (task?.transportFailoverSuggested === true) {
    badges.push(`<span class="status-chip warn">Transport failover</span>`);
  }
  if (task?.capabilityMismatchSuspected === true) {
    badges.push(`<span class="status-chip">Capability mismatch</span>`);
  }
  return badges.join("");
}

function renderTaskReshapeMeta(task) {
  const lines = [];
  const reshapeAttemptCount = Math.max(0, Number(task?.reshapeAttemptCount || 0));
  if (reshapeAttemptCount > 0) {
    lines.push(`Reshaped ${reshapeAttemptCount}/3`);
  }
  if (task?.reshapeIssueKey) {
    lines.push(`Issue key: ${String(task.reshapeIssueKey).trim()}`);
  }
  if (task?.criticalFailureReason) {
    lines.push(`Critical reason: ${String(task.criticalFailureReason).trim()}`);
  }
  if (task?.transportFailoverSuggested === true) {
    lines.push("Transport failover suggested");
  }
  if (task?.capabilityMismatchSuspected === true) {
    lines.push("Capability mismatch suspected");
  }
  return lines.length ? `<div class="micro">${escapeHtml(lines.join(" | "))}</div>` : "";
}

function renderTaskReshapeIssuesList(targetEl, payload = {}) {
  if (!targetEl) {
    return;
  }
  const issues = Array.isArray(payload?.issues) ? payload.issues : [];
  if (!issues.length) {
    targetEl.innerHTML = `<div class="panel-subtle">No reshape issues recorded yet.</div>`;
    return;
  }
  targetEl.innerHTML = issues.map((issue) => {
    const attemptedBrains = Array.isArray(issue?.lastAttemptedBrains) ? issue.lastAttemptedBrains.filter(Boolean) : [];
    const workerChain = attemptedBrains.length ? attemptedBrains.join(" -> ") : (issue?.lastRequestedBrainLabel || issue?.lastRequestedBrainId || "unknown");
    const decisionText = [
      issue?.lastAction ? `Decision: ${String(issue.lastAction).replaceAll("_", " ")}` : "",
      issue?.lastPhase ? `Phase: ${String(issue.lastPhase).replaceAll("_", " ")}` : ""
    ].filter(Boolean).join(" | ");
    const badges = [
      `<span class="status-chip ${/critical/i.test(String(issue?.lastAction || "")) ? "bad" : "warn"}">${escapeHtml(String(issue?.classification || "unknown").replaceAll("_", " "))}</span>`,
      `<span class="status-chip">${escapeHtml(`${Number(issue?.occurrenceCount || 0)} hit${Number(issue?.occurrenceCount || 0) === 1 ? "" : "s"}`)}</span>`,
      `<span class="status-chip">${escapeHtml(`${Number(issue?.uniqueRootTaskCount || 0)} job${Number(issue?.uniqueRootTaskCount || 0) === 1 ? "" : "s"}`)}</span>`
    ].join("");
    return `
      <div class="queue-issue-card">
        <div class="queue-item-head">
          <strong>${escapeHtml(issue?.lastSourceTaskCodename || issue?.lastTaskCodename || issue?.lastTaskId || "Issue")}</strong>
          <div class="queue-item-actions">${badges}</div>
        </div>
        <div class="micro">${escapeHtml(`Last seen ${formatDateTime(issue?.lastSeenAt)}`)}</div>
        ${issue?.lastTaskMessage ? `<div class="micro">${escapeHtml(`Request: ${String(issue.lastTaskMessage).trim()}`)}</div>` : ""}
        <div class="micro">${escapeHtml(`Reviewed worker chain: ${workerChain}`)}</div>
        ${issue?.lastOutcomeSummary ? `<div class="history-body">${escapeHtml(`Outcome: ${String(issue.lastOutcomeSummary).trim()}`)}</div>` : ""}
        ${decisionText ? `<div class="micro">${escapeHtml(decisionText)}</div>` : ""}
        ${issue?.lastReason ? `<div class="history-body">${escapeHtml(`Why it was reviewed: ${String(issue.lastReason).trim()}`)}</div>` : ""}
        ${issue?.lastImprovement ? `<div class="history-body">${escapeHtml(`Next retry shape: ${String(issue.lastImprovement).trim()}`)}</div>` : ""}
      </div>
    `;
  }).join("");
}

function isPlainQuestionTask(task) {
  return String(task?.status || "").trim().toLowerCase() === "waiting_for_user"
    && String(task?.internalJobType || "").trim().toLowerCase() === "question_maintenance"
    && Boolean(String(task?.questionForUser || "").trim());
}

function fileLink(file) {
  return `/api/output/file?file=${encodeURIComponent(file.path)}`;
}

function setStatus(el, text, tone) {
  el.textContent = text;
  el.className = `metric-value ${tone || ""}`.trim();
}

function updateRunButtonState() {
  runBtn.disabled = runInFlight;
  if (runInFlight) {
    runBtn.textContent = "Running...";
    return;
  }
  runBtn.textContent = "Run agent";
}

function setPanelOpen(isOpen) {
  panelDrawerEl.classList.toggle("open", Boolean(isOpen));
  if (panelToggleIconEl) {
    panelToggleIconEl.innerHTML = isOpen ? panelToggleIcons.open : panelToggleIcons.closed;
  }
  if (panelToggleBtn) {
    panelToggleBtn.title = isOpen ? "Hide panel" : "Show panel";
    panelToggleBtn.setAttribute("aria-label", isOpen ? "Hide panel" : "Show panel");
  }
  try {
    localStorage.setItem(PANEL_OPEN_KEY, isOpen ? "1" : "0");
  } catch {}
}

function loadPanelOpenPreference() {
  try {
    return localStorage.getItem(PANEL_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function activateTab(tabId) {
  setPanelOpen(true);
  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tabTarget === tabId);
  });
}

function activateBrainSubtab(tabId) {
  brainSubtabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
  brainSubtabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.brainSubtabTarget === tabId);
  });
}

function activateNovaSubtab(tabId) {
  activeNovaSubtabId = tabId;
  novaSubtabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
  novaSubtabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.novaSubtabTarget === tabId);
  });
}

function activateProjectsSubtab(tabId) {
  activeProjectsSubtabId = tabId;
  projectsSubtabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
  projectsSubtabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.projectsSubtabTarget === tabId);
  });
}

function activateSecretsSubtab(tabId) {
  activeSecretsSubtabId = tabId || "secretsOverviewPanel";
  secretsSubtabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === activeSecretsSubtabId);
  });
  secretsSubtabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.secretsSubtabTarget === activeSecretsSubtabId);
  });
}

function activateQueueSubtab(tabId) {
  activeQueueSubtabId = tabId;
  queueSubtabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
  queueSubtabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.queueSubtabTarget === tabId);
  });
}

function activateJobsSubtab(tabId) {
  activeJobsSubtabId = tabId || "jobsSchedulesPanel";
  jobsSubtabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === activeJobsSubtabId);
  });
  jobsSubtabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.jobsSubtabTarget === activeJobsSubtabId);
  });
}

function formatGpuStatus(gpu) {
  if (!gpu?.available) {
    return { text: "Unavailable", tone: "tone-warn" };
  }

  const utilization = Number.isFinite(gpu.utilizationGpu) ? `${gpu.utilizationGpu}%` : "?";
  const memory = Number.isFinite(gpu.memoryUsedMiB) && Number.isFinite(gpu.memoryTotalMiB)
    ? `${gpu.memoryUsedMiB}/${gpu.memoryTotalMiB} MiB`
    : "?";
  const tone = gpu.utilizationGpu >= 80 ? "tone-warn" : "tone-ok";
  return {
    text: `${utilization} | ${memory}`,
    tone
  };
}

function renderPayloads(payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return {
      displayText: "",
      spokenText: "",
      rawText: ""
    };
  }

  const displayParts = [];
  const spokenParts = [];
  const rawParts = [];
  payloads.forEach((payload, index) => {
    const rawText = String(payload?.text || "").trim();
    if (!rawText) {
      return;
    }
    rawParts.push(rawText);
    const cleaned = window.agentAvatar?.stripTags ? window.agentAvatar.stripTags(rawText) : rawText;
    const prepared = window.agentAvatar?.prepareResponseText
      ? window.agentAvatar.prepareResponseText(rawText)
      : { spokenText: cleaned };
    displayParts.push(`Payload ${index + 1}\n\n${cleaned}`);
    if (prepared.spokenText) {
      spokenParts.push(prepared.spokenText);
    }
  });
  return {
    displayText: displayParts.join("\n\n"),
    spokenText: spokenParts.join("\n\n"),
    rawText: rawParts.join("\n\n")
  };
}

function renderPassivePayload(title, body) {
  payloadsEl.innerHTML = `<div class="payload"><strong>${escapeHtml(title)}</strong>\n\n${escapeHtml(body)}</div>`;
}

function joinHumanList(items) {
  const values = items.filter(Boolean);
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function summarizeCronToolActivity(summaryText) {
  const lines = String(summaryText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const toolNames = [];
  for (const line of lines) {
    if (!line.startsWith("{") || !line.includes('"name"')) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed?.name) {
        toolNames.push(String(parsed.name));
      }
    } catch {
      // ignore malformed lines
    }
  }
  const uniqueNames = [...new Set(toolNames)];
  if (!uniqueNames.length) {
    return null;
  }
  const labels = [];
  if (uniqueNames.some((name) => name === "read" || name === "memory_get")) {
    labels.push("checked memory and workspace notes");
  }
  if (uniqueNames.includes("process")) {
    labels.push("reviewed active processes");
  }
  if (uniqueNames.includes("cron")) {
    labels.push("looked over scheduled job status");
  }
  if (!labels.length) {
    labels.push(`used ${joinHumanList(uniqueNames)}`);
  }
  return `I completed a background check and ${joinHumanList(labels)}.`;
}

function formatCronObservation(event) {
  const jobRef = event.codename || formatEntityRef("job", event.jobId || "unknown");
  const rawSummary = String(event.summary || event.error || "").trim();
  const humanSummary = rawSummary ? summarizeCronToolActivity(rawSummary) : "";
  const summary = String(humanSummary || rawSummary || "").trim();
  const normalizedStatus = String(event.status || "unknown").toLowerCase();
  const statusText = normalizedStatus === "ok" || normalizedStatus === "completed"
    ? "finished"
    : normalizedStatus === "failed"
      ? "ran into a problem"
      : `ended with status ${normalizedStatus}`;
  const durationText = event.durationMs ? ` It took about ${Math.max(1, Math.round(Number(event.durationMs) / 1000))} seconds.` : "";
  if (summary) {
    const statusLead = normalizedStatus === "ok" || normalizedStatus === "completed"
      ? ""
      : `\n\n${jobRef} ${statusText}.${durationText}`.trimEnd();
    return `${summary}${statusLead}`;
  }
  const jobName = String(event.name || "").trim();
  const lead = jobName
    ? `${jobName} ${statusText}.`
    : `${jobRef} ${statusText}.`;
  return `${lead}${durationText}`;
}

function formatHistorySource(item) {
  if (item.source === "manual") return "Manual run";
  if (item.source === "cron") return "Scheduled job";
  if (item.source === "task") return "Queued task";
  return "Update";
}

function formatTaskSource(item) {
  const sourceIdentity = item?.sourceIdentity && typeof item.sourceIdentity === "object"
    ? item.sourceIdentity
    : null;
  const sourceBits = [
    item.requestedBrainLabel || item.requestedBrainId || "worker",
    sourceIdentity
      ? `${String(sourceIdentity.label || sourceIdentity.speakerLabel || sourceIdentity.email || sourceIdentity.kind || "source").trim()} (${String(sourceIdentity.trustLevel || "unknown").trim()})`
      : "",
    formatDateTime(item.updatedAt || item.createdAt)
  ].filter(Boolean);
  return sourceBits.join(" | ");
}

function getTaskStatusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (["completed", "ok", "done"].includes(normalized)) return "ok";
  if (["failed", "error", "no_text"].includes(normalized)) return "bad";
  if (["queued", "in_progress", "escalated", "progress", "waiting_for_user"].includes(normalized)) return "warn";
  return "";
}

function getTaskStatusLabel(task) {
  if (task.abortRequestedAt && String(task.status || "") === "in_progress") return "Stopping";
  if (task.escalated) return "Escalated";
  if (task.redirectOnly) return "Redirected";
  return String(task.status || "unknown").replaceAll("_", " ");
}

function getTaskEventKey(task) {
  return `${task.id || "unknown"}:${task.status || "unknown"}:${task.updatedAt || task.completedAt || task.createdAt || 0}`;
}

function hashId(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatEntityRef(kind, id) {
  const hash = hashId(id);
  const adjectives = [
    "Amber", "Brisk", "Cinder", "Dawn", "Ember", "Flint", "Golden", "Harbor",
    "Ivory", "Juniper", "Kindle", "Lumen", "Marlow", "North", "Opal", "Pine",
    "Quartz", "Rowan", "Sable", "Tawny", "Umber", "Velvet", "Willow", "Zephyr"
  ];
  const nouns = [
    "Beacon", "Bridge", "Circuit", "Drift", "Engine", "Field", "Grove", "Harbor",
    "Index", "Junction", "Key", "Lantern", "Matrix", "Node", "Orbit", "Path",
    "Queue", "Relay", "Signal", "Thread", "Unit", "Vector", "Watch", "Yard"
  ];
  const adjective = adjectives[hash % adjectives.length];
  const noun = nouns[Math.floor(hash / adjectives.length) % nouns.length];
  const suffix = String(hash % 1000).padStart(3, "0");
  const label = `${adjective} ${noun} ${suffix}`;
  if (kind === "job") return label;
  if (kind === "task") return label;
  return label;
}

function rememberTaskEvent(task) {
  const key = getTaskEventKey(task);
  if (seenTaskEventKeys.has(key)) {
    return false;
  }
  seenTaskEventKeys.add(key);
  if (seenTaskEventKeys.size > 300) {
    const firstKey = seenTaskEventKeys.values().next().value;
    if (firstKey) {
      seenTaskEventKeys.delete(firstKey);
    }
  }
  return true;
}

function renderHistory() {
  if (!historyEntries.length) {
    historyListEl.innerHTML = `<div class="panel-subtle">No history yet.</div>`;
    return;
  }

  historyListEl.innerHTML = historyEntries.map((entry) => {
    const metaBits = [
      formatHistorySource(entry),
      formatDateTime(entry.timestamp),
      entry.status ? `Status: ${entry.status}` : "",
      entry.brainLabel ? `Brain: ${entry.brainLabel}` : "",
      entry.model ? `Model: ${entry.model}` : ""
    ].filter(Boolean);
    return `
      <div class="history-item">
        <div class="history-meta">${metaBits.map((bit) => `<span>${escapeHtml(bit)}</span>`).join("")}</div>
        <span class="status-chip ${getTaskStatusTone(entry.status)}">${escapeHtml(String(entry.status || "unknown").replaceAll("_", " "))}</span>
        <strong>${escapeHtml(entry.title)}</strong>
        <div class="history-body">${escapeHtml(entry.displayText || entry.body || "")}</div>
      </div>
    `;
  }).join("");
}

function renderMailMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    mailMessagesEl.innerHTML = `<div class="panel-subtle">No mail messages yet.</div>`;
    return;
  }
  mailMessagesEl.innerHTML = messages.map((message) => `
    <article class="history-item">
      <div class="history-head">
        <strong>${escapeHtml(message.subject || "(no subject)")}</strong>
        <span class="history-source">${escapeHtml(formatDateTime(message.receivedAt))}</span>
      </div>
      <div class="micro">${escapeHtml(message.fromName || message.fromAddress || "Unknown sender")} → ${escapeHtml((message.to || []).join(", ") || message.agentEmail || "")}</div>
      <div class="history-body">${escapeHtml(String(message.text || "").trim() || "(empty message)")}</div>
    </article>
  `).join("");
}

function renderMailMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    mailMessagesEl.innerHTML = `<div class="panel-subtle">No mail messages yet.</div>`;
    return;
  }
  mailMessagesEl.innerHTML = messages.map((message) => {
    const categoryText = `Category: ${String(message?.triage?.category || "other")}`;
    const flags = [
      message?.triage?.likelySpam ? "Likely spam" : "",
      message?.triage?.automated ? "Automated" : ""
    ].filter(Boolean).join(" | ");
    const heuristics = Array.isArray(message?.triage?.reasons) ? message.triage.reasons.join(", ") : "";
    const trustLevel = String(message?.sourceIdentity?.trustLevel || "unknown").trim();
    const trustText = `Source trust: ${trustLevel}`;
    const command = message?.command && message.command.detected
      ? `Command: ${String(message.command.action || "detected").replaceAll("_", " ")}${message.command.taskCodename ? ` (${message.command.taskCodename})` : ""}`
      : "";
    const messageId = String(message?.id || "").trim();
    return `
      <article class="history-item">
        <div class="history-head">
          <strong>${escapeHtml(message.subject || "(no subject)")}</strong>
          <span class="history-source">${escapeHtml(formatDateTime(message.receivedAt))}</span>
          <button type="button" class="secondary mail-delete-btn" data-message-id="${escapeAttr(messageId)}">Delete</button>
        </div>
        <div class="micro">${escapeHtml(message.fromName || message.fromAddress || "Unknown sender")} -> ${escapeHtml((message.to || []).join(", ") || message.agentEmail || "")}</div>
        <div class="micro">${escapeHtml(categoryText)}${flags ? ` | ${escapeHtml(flags)}` : ""}</div>
        <div class="micro">${escapeHtml(trustText)}${command ? ` | ${escapeHtml(command)}` : ""}</div>
        ${heuristics ? `<div class="micro">${escapeHtml(`Heuristics: ${heuristics}`)}</div>` : ""}
        <div class="history-body">${escapeHtml(String(message.text || "").trim() || "(empty message)")}</div>
      </article>
    `;
  }).join("");
}

function enqueueUpdate(item, options = {}) {
  const entry = {
    id: `update-${++queueSequence}`,
    timestamp: Date.now(),
    source: "manual",
    title: "Agent update",
    displayText: "",
    spokenText: "",
    rawText: "",
    status: "",
    brainLabel: "",
    model: "",
    onComplete: null,
    questionTime: false,
    ...item
  };
  historyEntries.unshift(entry);
  historyEntries = historyEntries.slice(0, 120);
  renderHistory();
  if (options.priority) {
    updateQueue.unshift(entry);
  } else {
    updateQueue.push(entry);
  }
  showQueuedUpdate();
}

function showQueuedUpdate() {
  if (questionTimeActive && updateQueue.length && !updateQueue[0]?.questionTime) {
    return;
  }
  if (runInFlight || activeUtterance || queueDisplayActive || !updateQueue.length) {
    return;
  }

  const item = updateQueue.shift();
  queueDisplayActive = true;
  renderPassivePayload(item.title, item.displayText || item.body || "");
  const speak = observerApp.presentPayloadSpeech;
  const finalize = () => {
    queueDisplayActive = false;
    if (typeof item.onComplete === "function") {
      item.onComplete();
    }
    if (updateQueue.length && !questionTimeActive) {
      payloadsEl.innerHTML = `<div class="payload">Queued updates remaining: ${updateQueue.length}</div>`;
      window.setTimeout(showQueuedUpdate, 120);
    }
  };
  if (typeof speak !== "function") {
    finalize();
    return;
  }
  speak(item.rawText || item.spokenText || item.displayText || item.body || "", {
    onComplete() {
      finalize();
    }
  });
}

function renderAttachmentList() {
  if (!selectedAttachments.length) {
    attachmentListEl.textContent = "No files attached.";
    return;
  }

  attachmentListEl.innerHTML = selectedAttachments.map((file) => (
    `<div class="attachment-item"><strong>${escapeHtml(file.name)}</strong> <span class="micro">(${escapeHtml(formatBytes(file.size))}${file.type ? `, ${escapeHtml(file.type)}` : ""})</span></div>`
  )).join("");
}

function renderTaskList(targetEl, tasks) {
  if (!Array.isArray(tasks) || !tasks.length) {
    targetEl.innerHTML = `<div class="panel-subtle">None.</div>`;
    return;
  }
  targetEl.innerHTML = tasks.map((task) => `
    ${(() => {
      const plainQuestionTask = isPlainQuestionTask(task);
      const title = plainQuestionTask
        ? String(task.questionForUser || "").trim()
        : String(task.message || "(empty task)");
      const questionBody = task.status === "waiting_for_user" && task.questionForUser && !plainQuestionTask
        ? `<div class="history-body">${escapeHtml(task.questionForUser)}</div>`
        : "";
      const outcomeText = plainQuestionTask ? "" : getTaskOutcomeText(task);
      return `
    <div class="queue-item">
      <div class="queue-item-head">
        <div class="queue-item-actions">
          <span class="status-chip ${getTaskStatusTone(task.status)}">${escapeHtml(getTaskStatusLabel(task))}</span>
          ${renderTaskReshapeBadges(task)}
        </div>
        <div class="queue-item-actions">
          ${task.status === "in_progress"
            ? `<button type="button" class="secondary" data-abort-task="${escapeAttr(task.id || "")}" ${task.abortRequestedAt ? "disabled" : ""}>${task.abortRequestedAt ? "Stopping..." : "Abort"}</button><button type="button" class="secondary" data-force-abort-task="${escapeAttr(task.id || "")}">Force clear</button>`
            : task.status === "waiting_for_user"
              ? `<button type="button" class="secondary" data-toggle-answer="${escapeAttr(task.id || "")}">Answer</button><button type="button" class="secondary" data-remove-task="${escapeAttr(task.id || "")}">Remove</button>`
              : `<button type="button" class="secondary" data-remove-task="${escapeAttr(task.id || "")}">Remove</button>`}
          <button type="button" class="secondary" data-toggle-task-history="${escapeAttr(task.id || "")}">${taskHistoryExpandedIds.has(String(task.id || "").trim()) ? "Hide history" : "History"}</button>
        </div>
      </div>
      <strong>${escapeHtml(title)}</strong>
      <div class="micro">Code: ${escapeHtml(task.codename || formatEntityRef("task", task.id || "unknown"))}</div>
      <div class="micro">${escapeHtml(formatTaskSource(task))}</div>
      <div class="micro">Session: ${escapeHtml(task.sessionId || "Main")}</div>
      ${renderTaskReshapeMeta(task)}
      ${outcomeText ? `<div class="history-body">${escapeHtml(outcomeText)}</div>` : ""}
      ${questionBody}
      ${task.status === "waiting_for_user" ? `
        <div class="queue-answer" data-answer-box="${escapeAttr(task.id || "")}" hidden>
          <textarea class="queue-answer-input" data-answer-input="${escapeAttr(task.id || "")}" rows="3" placeholder="Type your answer here"></textarea>
          <div class="queue-item-actions">
            <button type="button" class="secondary" data-submit-answer="${escapeAttr(task.id || "")}">Send answer</button>
            <button type="button" class="secondary" data-cancel-answer="${escapeAttr(task.id || "")}">Cancel</button>
          </div>
          <div class="micro" data-answer-status="${escapeAttr(task.id || "")}"></div>
        </div>
      ` : ""}
      ${renderClarificationHistory(task)}
      ${renderTaskBreadcrumbHistory(task)}
      ${Array.isArray(task.escalationTrail) && task.escalationTrail.length ? `<div class="micro">Escalations: ${escapeHtml(task.escalationTrail.map((step) => `${step.from} -> ${step.to}`).join(", "))}</div>` : ""}
    </div>
      `;
    })()}
  `).join("");
  targetEl.querySelectorAll("[data-remove-task]").forEach((button) => {
    button.onclick = async () => {
      const taskId = button.dataset.removeTask;
      const wasWaitingTask = Array.isArray(latestTaskSnapshot?.waiting)
        && latestTaskSnapshot.waiting.some((task) => String(task?.id || "").trim() === String(taskId || "").trim());
      button.disabled = true;
      try {
        const r = await fetch("/api/tasks/remove", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskId })
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
        if (wasWaitingTask) {
          waitingQuestionAnswerDrafts.delete(String(taskId || "").trim());
          if (typeof window.clearPendingVoiceQuestionWindow === "function") {
            window.clearPendingVoiceQuestionWindow({ preserveStatus: true, preserveQuestionTime: true });
          }
        }
        await loadTaskQueue();
      } catch (error) {
        const message = String(error?.message || "failed to remove task");
        if (/task not found/i.test(message)) {
          if (wasWaitingTask) {
            waitingQuestionAnswerDrafts.delete(String(taskId || "").trim());
          }
          hintEl.textContent = "That task was already cleared. Refreshing the queue.";
          await loadTaskQueue();
        } else {
          hintEl.textContent = `Task removal failed: ${message}`;
          button.disabled = false;
        }
      }
    };
  });
  targetEl.querySelectorAll("[data-abort-task]").forEach((button) => {
    button.onclick = async () => {
      const taskId = button.dataset.abortTask;
      button.disabled = true;
      try {
        const r = await fetch("/api/tasks/abort", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskId })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) {
          throw new Error(j.error || "failed to abort task");
        }
        await loadTaskQueue();
      } catch (error) {
        const message = String(error?.message || "failed to abort task");
        if (/task not found/i.test(message)) {
          hintEl.textContent = "That task is no longer active. Refreshing the queue.";
          await loadTaskQueue();
        } else {
          hintEl.textContent = `Task abort failed: ${message}`;
          button.disabled = false;
        }
      }
    };
  });
  targetEl.querySelectorAll("[data-force-abort-task]").forEach((button) => {
    button.onclick = async () => {
      const taskId = button.dataset.forceAbortTask;
      const confirmed = typeof window === "undefined"
        || typeof window.confirm !== "function"
        || window.confirm("Force clear this running task? This immediately removes it from the in-progress lane even if the worker is stuck.");
      if (!confirmed) {
        return;
      }
      button.disabled = true;
      try {
        const r = await fetch("/api/tasks/abort", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            taskId,
            force: true,
            reason: "Force-cleared by user."
          })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) {
          throw new Error(j.error || "failed to force clear task");
        }
        await loadTaskQueue();
      } catch (error) {
        const message = String(error?.message || "failed to force clear task");
        if (/task not found/i.test(message) || /not currently in progress/i.test(message)) {
          hintEl.textContent = "That task is no longer running. Refreshing the queue.";
          await loadTaskQueue();
        } else {
          hintEl.textContent = `Force clear failed: ${message}`;
          button.disabled = false;
        }
      }
    };
  });
  targetEl.querySelectorAll("[data-toggle-answer]").forEach((button) => {
    button.onclick = async () => {
      const taskId = button.dataset.toggleAnswer;
      const answerBox = targetEl.querySelector(`[data-answer-box="${CSS.escape(taskId)}"]`);
      const answerInput = targetEl.querySelector(`[data-answer-input="${CSS.escape(taskId)}"]`);
      if (!answerBox || !answerInput) {
        return;
      }
      answerBox.hidden = false;
      answerInput.focus();
    };
  });
  targetEl.querySelectorAll("[data-cancel-answer]").forEach((button) => {
    button.onclick = () => {
      const taskId = button.dataset.cancelAnswer;
      const answerBox = targetEl.querySelector(`[data-answer-box="${CSS.escape(taskId)}"]`);
      const answerInput = targetEl.querySelector(`[data-answer-input="${CSS.escape(taskId)}"]`);
      const statusEl = targetEl.querySelector(`[data-answer-status="${CSS.escape(taskId)}"]`);
      if (answerBox) answerBox.hidden = true;
      if (answerInput) answerInput.value = "";
      if (statusEl) statusEl.textContent = "";
    };
  });
  targetEl.querySelectorAll("[data-submit-answer]").forEach((button) => {
    button.onclick = async () => {
      const taskId = button.dataset.submitAnswer;
      const answerBox = targetEl.querySelector(`[data-answer-box="${CSS.escape(taskId)}"]`);
      const answerInput = targetEl.querySelector(`[data-answer-input="${CSS.escape(taskId)}"]`);
      const statusEl = targetEl.querySelector(`[data-answer-status="${CSS.escape(taskId)}"]`);
      const answer = String(answerInput?.value || "").trim();
      if (!answer) {
        if (statusEl) statusEl.textContent = "Type an answer first.";
        return;
      }
      button.disabled = true;
      if (statusEl) statusEl.textContent = "Sending...";
      try {
        const r = await fetch("/api/tasks/answer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            taskId,
            answer,
            sessionId: document.getElementById("sessionId")?.value || "Main"
          })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) {
          throw new Error(j.error || "failed to answer task");
        }
        waitingQuestionAnswerDrafts.delete(String(taskId || "").trim());
        if (typeof window.clearPendingVoiceQuestionWindow === "function") {
          window.clearPendingVoiceQuestionWindow({ preserveStatus: true, preserveQuestionTime: true });
        }
        hintEl.textContent = "Follow-up answer saved and the task has been re-queued.";
        if (statusEl) statusEl.textContent = "Saved.";
        if (answerBox) answerBox.hidden = true;
        await loadTaskQueue();
      } catch (error) {
        const message = String(error?.message || "failed to answer task");
        if (/task not found/i.test(message)) {
          waitingQuestionAnswerDrafts.delete(String(taskId || "").trim());
          hintEl.textContent = "That question was already replaced with a newer one. Refreshing the queue.";
          if (statusEl) statusEl.textContent = "That question was already replaced. Refreshing.";
          await loadTaskQueue();
        } else {
          hintEl.textContent = `Task answer failed: ${message}`;
          if (statusEl) statusEl.textContent = message;
        }
      } finally {
        button.disabled = false;
      }
    };
  });
  targetEl.querySelectorAll("[data-toggle-task-history]").forEach((button) => {
    button.onclick = async () => {
      const taskId = String(button.dataset.toggleTaskHistory || "").trim();
      if (!taskId) {
        return;
      }
      if (taskHistoryExpandedIds.has(taskId)) {
        taskHistoryExpandedIds.delete(taskId);
        if (typeof observerApp.loadTaskQueue === "function") {
          observerApp.loadTaskQueue();
        }
        return;
      }
      taskHistoryExpandedIds.add(taskId);
      taskHistoryErrorById.delete(taskId);
      if (typeof observerApp.loadTaskQueue === "function") {
        observerApp.loadTaskQueue();
      }
      if (taskHistoryCache.has(taskId) || taskHistoryLoadingIds.has(taskId)) {
        return;
      }
      taskHistoryLoadingIds.add(taskId);
      try {
        const r = await fetch(`/api/tasks/history?taskId=${encodeURIComponent(taskId)}&limit=8`);
        const j = await r.json();
        if (!r.ok || !j.ok) {
          throw new Error(j.error || "failed to load task history");
        }
        taskHistoryCache.set(taskId, Array.isArray(j.history) ? j.history.slice().reverse() : []);
      } catch (error) {
        taskHistoryErrorById.set(taskId, String(error?.message || "failed to load task history"));
      } finally {
        taskHistoryLoadingIds.delete(taskId);
        if (typeof observerApp.loadTaskQueue === "function") {
          observerApp.loadTaskQueue();
        }
      }
    };
  });
}

function renderTodoList(payload = {}) {
  const open = Array.isArray(payload?.open) ? payload.open : [];
  const completed = Array.isArray(payload?.completed) ? payload.completed : [];
  const summary = payload?.summary && typeof payload.summary === "object" ? payload.summary : {};

  if (todoHintEl) {
    todoHintEl.textContent = `${Number(summary.openCount || open.length)} open item${Number(summary.openCount || open.length) === 1 ? "" : "s"}${completed.length ? `, ${completed.length} completed.` : "."}`;
  }

  if (todoOpenListEl) {
    todoOpenListEl.innerHTML = open.length
      ? open.map((item) => `
        <div class="queue-item">
          <div class="queue-item-head">
            <label class="todo-check">
              <input type="checkbox" data-complete-todo="${escapeAttr(item.id || "")}" />
              <strong>${escapeHtml(item.text || "")}</strong>
            </label>
            <div class="queue-item-actions">
              <button type="button" class="secondary" data-remove-todo="${escapeAttr(item.id || "")}">Remove</button>
            </div>
          </div>
          <div class="micro">${escapeHtml(`Added by ${item.createdBy || "user"} · ${formatDateTime(item.updatedAt || item.createdAt)}`)}</div>
          ${item.linkedTaskCodename ? `<div class="micro">${escapeHtml(`Linked task: ${item.linkedTaskCodename}`)}</div>` : ""}
        </div>
      `).join("")
      : `<div class="panel-subtle">No open to do items.</div>`;
  }

  if (todoCompletedListEl) {
    todoCompletedListEl.innerHTML = completed.length
      ? completed.slice(0, 12).map((item) => `
        <div class="queue-item">
          <div class="queue-item-head">
            <div class="queue-item-actions">
              <span class="status-chip tone-ok">Completed</span>
            </div>
            <div class="queue-item-actions">
              <button type="button" class="secondary" data-remove-todo="${escapeAttr(item.id || "")}">Remove</button>
            </div>
          </div>
          <strong>${escapeHtml(item.text || "")}</strong>
          <div class="micro">${escapeHtml(`Completed ${formatDateTime(item.completedAt || item.updatedAt || item.createdAt)}`)}</div>
          ${item.linkedTaskCodename ? `<div class="micro">${escapeHtml(`Linked task: ${item.linkedTaskCodename}`)}</div>` : ""}
        </div>
      `).join("")
      : `<div class="panel-subtle">No completed items yet.</div>`;
  }

  const bindRemoveButtons = (targetEl) => {
    targetEl?.querySelectorAll("[data-remove-todo]").forEach((button) => {
      button.onclick = async () => {
        const todoId = String(button.dataset.removeTodo || "").trim();
        if (!todoId) {
          return;
        }
        button.disabled = true;
        try {
          const r = await fetch(`/api/todos/${encodeURIComponent(todoId)}/remove`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              removedBy: "user",
              sessionId: document.getElementById("sessionId")?.value || "Main"
            })
          });
          const j = await r.json();
          if (!r.ok || !j.ok) {
            throw new Error(j.error || "failed to remove to do item");
          }
          if (typeof observerApp.loadTodoList === "function") {
            await observerApp.loadTodoList();
          }
        } catch (error) {
          hintEl.textContent = `To do removal failed: ${String(error?.message || "unknown error")}`;
          button.disabled = false;
        }
      };
    });
  };

  todoOpenListEl?.querySelectorAll("[data-complete-todo]").forEach((checkbox) => {
    checkbox.onchange = async () => {
      const todoId = String(checkbox.dataset.completeTodo || "").trim();
      if (!todoId || !checkbox.checked) {
        return;
      }
      checkbox.disabled = true;
      try {
        const r = await fetch(`/api/todos/${encodeURIComponent(todoId)}/state`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "completed",
            completedBy: "user",
            sessionId: document.getElementById("sessionId")?.value || "Main"
          })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) {
          throw new Error(j.error || "failed to complete to do item");
        }
        if (typeof observerApp.loadTodoList === "function") {
          await observerApp.loadTodoList();
        }
      } catch (error) {
        hintEl.textContent = `To do update failed: ${String(error?.message || "unknown error")}`;
        checkbox.checked = false;
        checkbox.disabled = false;
      }
    };
  });

  bindRemoveButtons(todoOpenListEl);
  bindRemoveButtons(todoCompletedListEl);
}

function toWorkspaceRelativePath(task) {
  const workspacePath = String(task?.workspacePath || task?.path || "").trim();
  if (workspacePath.startsWith("/workspace-dev/")) {
    return workspacePath.slice("/workspace-dev/".length);
  }
  if (
    workspacePath.startsWith("task-queue/")
    || workspacePath.startsWith("observer-task-queue/")
    || workspacePath.startsWith("observer-task-queue/")
  ) {
    return workspacePath;
  }
  const filePath = String(task?.filePath || "").trim().replaceAll("\\", "/");
  const marker = "/workspace-dev/";
  const markerIndex = filePath.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return filePath.slice(markerIndex + marker.length);
  }
  return "";
}

function buildTaskFileEntries(taskSnapshot = latestTaskSnapshot) {
  const groups = [
    { statusLabel: "queued", tasks: taskSnapshot.queued || [] },
    { statusLabel: "waiting", tasks: taskSnapshot.waiting || [] },
    { statusLabel: "in progress", tasks: taskSnapshot.inProgress || [] },
    { statusLabel: "done", tasks: taskSnapshot.done || [] },
    { statusLabel: "failed", tasks: taskSnapshot.failed || [] }
  ];
  return groups.flatMap((group) => group.tasks.map((task) => {
    const relativePath = toWorkspaceRelativePath(task);
    if (!relativePath) {
      return null;
    }
    return {
      id: task.id || relativePath,
      relativePath,
      statusLabel: group.statusLabel,
      updatedAt: Number(task.updatedAt || task.createdAt || 0)
    };
  }).filter(Boolean)).sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
}

function renderTaskFilesList(files) {
  if (!Array.isArray(files) || !files.length) {
    taskFilesListEl.innerHTML = `<div class="panel-subtle">No task files found.</div>`;
    taskFileContentEl.textContent = "No task file selected.";
    return;
  }
  taskFilesListEl.innerHTML = files.map((file) => `
    <button class="file-item ${file.relativePath === activeTaskFilePath ? "active" : ""}" data-task-file="${escapeAttr(file.relativePath)}">
      <span>${escapeHtml(file.relativePath)}</span>
      <span class="file-type">${escapeHtml(file.statusLabel)}</span>
    </button>
  `).join("");
  taskFilesListEl.querySelectorAll("[data-task-file]").forEach((button) => {
    button.onclick = () => observerApp.loadTaskFile?.(button.dataset.taskFile);
  });
}

Object.assign(observerApp, {
  applyTabIcons,
  escapeHtml,
  formatTime,
  formatDateTime,
  formatDurationMs,
  escapeAttr,
  formatBytes,
  fileLink,
  setStatus,
  updateRunButtonState,
  setPanelOpen,
  loadPanelOpenPreference,
  activateTab,
  activateNovaSubtab,
  activateBrainSubtab,
  activateProjectsSubtab,
  activateSecretsSubtab,
  activateQueueSubtab,
  activateJobsSubtab,
  formatGpuStatus,
  renderPayloads,
  renderPassivePayload,
  joinHumanList,
  summarizeCronToolActivity,
  formatCronObservation,
  formatHistorySource,
  formatTaskSource,
  getTaskStatusTone,
  getTaskStatusLabel,
  getTaskEventKey,
  hashId,
  formatEntityRef,
  rememberTaskEvent,
  renderHistory,
  renderMailMessages,
  enqueueUpdate,
  showQueuedUpdate,
  renderAttachmentList,
  renderTaskList,
  renderTodoList,
  renderTaskReshapeIssuesList,
  renderRegressionResults,
  renderRegressionSuiteList,
  toWorkspaceRelativePath,
  buildTaskFileEntries,
  renderTaskFilesList
});
})();
