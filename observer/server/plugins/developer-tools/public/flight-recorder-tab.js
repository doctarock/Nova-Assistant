let flightRecorderRoot = null;
let pluginAdminFetchRef = null;
let currentTaskId = "";
let currentPacket = null;

function h(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getElements(root = flightRecorderRoot) {
  if (!(root instanceof HTMLElement)) return {};
  return {
    taskIdInput: root.querySelector("#frTaskIdInput"),
    loadBtn: root.querySelector("#frLoadBtn"),
    validateBtn: root.querySelector("#frValidateBtn"),
    statusEl: root.querySelector("#frStatus"),
    packetEl: root.querySelector("#frPacket")
  };
}

function renderStatus(root, message = "", isError = false) {
  const { statusEl } = getElements(root);
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = isError ? "fr-status fr-status-error" : "fr-status";
}

function formatTs(ts) {
  if (!ts) return "-";
  try {
    return new Date(Number(ts)).toLocaleTimeString();
  } catch {
    return String(ts);
  }
}

function renderTimeline(events) {
  if (!Array.isArray(events) || !events.length) return "<em>No timeline events.</em>";
  return `<table class="fr-table">
    <thead><tr><th>Seq</th><th>Type</th><th>Status</th><th>Time</th></tr></thead>
    <tbody>${events.map((e) => `<tr>
      <td>${h(String(e.eventSeq ?? ""))}</td>
      <td>${h(String(e.type || e.eventType || ""))}</td>
      <td>${h(String(e.status || ""))}</td>
      <td>${h(formatTs(e.at))}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderProviderHistory(entries) {
  if (!Array.isArray(entries) || !entries.length) return "<em>No provider history.</em>";
  return `<table class="fr-table">
    <thead><tr><th>Step</th><th>Provider</th><th>Model</th><th>Role</th><th>OK</th><th>Time</th></tr></thead>
    <tbody>${entries.map((e) => `<tr>
      <td>${h(String(e.step ?? ""))}</td>
      <td>${h(String(e.provider || ""))}</td>
      <td>${h(String(e.model || ""))}</td>
      <td>${h(String(e.role || ""))}</td>
      <td>${e.ok ? "&#x2713;" : "&#x2717;"}</td>
      <td>${h(formatTs(e.at))}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderToolSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return "<em>No tool steps.</em>";
  return `<table class="fr-table">
    <thead><tr><th>Step</th><th>Tool</th><th>OK</th><th>TxID</th><th>Duration</th><th>Time</th></tr></thead>
    <tbody>${steps.map((s) => `<tr>
      <td>${h(String(s.step ?? ""))}</td>
      <td>${h(String(s.name || ""))}</td>
      <td>${s.semanticOk ? "&#x2713;" : "&#x2717;"}</td>
      <td>${h(String(s.transactionId || ""))}</td>
      <td>${h(String(s.durationMs ? `${s.durationMs}ms` : ""))}</td>
      <td>${h(formatTs(s.at))}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderTransactions(transactions, root) {
  if (!Array.isArray(transactions) || !transactions.length) return "<em>No transactions.</em>";
  return `<table class="fr-table">
    <thead><tr><th>ID</th><th>Op</th><th>Path</th><th>Status</th><th>Risk</th><th>Time</th><th></th></tr></thead>
    <tbody>${transactions.map((t) => `<tr data-txn-id="${h(t.id || "")}">
      <td class="fr-id">${h((t.id || "").slice(0, 20))}</td>
      <td>${h(String(t.operation || ""))}</td>
      <td class="fr-path">${h(String(t.target?.path || ""))}</td>
      <td class="fr-status-cell fr-status-${h(String(t.status || ""))}">${h(String(t.status || ""))}</td>
      <td>${h(String(t.risk?.level || ""))}</td>
      <td>${h(formatTs(t.createdAt))}</td>
      <td>${t.status === "applied" && t.checkpoint?.reversible
        ? `<button class="fr-rollback-btn" data-txn-id="${h(t.id || "")}">Rollback</button>`
        : ""
      }</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderHookTraces(traces) {
  if (!Array.isArray(traces) || !traces.length) return "<em>No hook traces.</em>";
  return `<table class="fr-table">
    <thead><tr><th>Hook</th><th>Plugin</th><th>Effect</th><th>Time</th></tr></thead>
    <tbody>${traces.map((t) => `<tr>
      <td>${h(String(t.hook || ""))}</td>
      <td>${h(String(t.pluginId || ""))}</td>
      <td>${h(String(t.effect || ""))}</td>
      <td>${h(formatTs(t.at))}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderReadBasis(entries) {
  if (!Array.isArray(entries) || !entries.length) return "<em>No read-basis entries.</em>";
  return `<table class="fr-table">
    <thead><tr><th>Tool Call</th><th>Path</th><th>Scope</th><th>Size</th><th>Source</th><th>Time</th></tr></thead>
    <tbody>${entries.map((e) => `<tr>
      <td class="fr-id">${h(String(e.toolCallId || ""))}</td>
      <td class="fr-path">${h(String(e.path || ""))}</td>
      <td>${h(String(e.scope || ""))}</td>
      <td>${h(e.size ? `${e.size}B` : "")}</td>
      <td>${h(String(e.source || ""))}</td>
      <td>${h(formatTs(e.at))}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderProviderSummary(summary) {
  if (!summary) return "";
  const cont = summary.continuation || {};
  const outcomeHtml = summary.lastRunOutcome
    ? `<span><b>Last run:</b> ${h(String(summary.lastRunOutcome || ""))}${summary.lastRunStopReason ? ` - ${h(String(summary.lastRunStopReason || ""))}` : ""}</span>`
    : "";
  return `<div class="fr-summary">
    <span><b>Provider:</b> ${h(String(summary.provider || ""))}</span>
    <span><b>Model:</b> ${h(String(summary.model || ""))}</span>
    <span><b>Same-provider resume:</b> ${cont.sameProviderResumeAvailable ? "&#x2713;" : "&#x2717;"}</span>
    <span><b>Cross-provider resume:</b> ${cont.crossProviderResumeAvailable ? "&#x2713;" : "&#x2717;"}</span>
    ${outcomeHtml}
  </div>`;
}

function renderPacket(packet, root) {
  const { packetEl } = getElements(root);
  if (!packetEl) return;
  if (!packet || !packet.ok) {
    packetEl.innerHTML = `<em>No data.</em>`;
    return;
  }
  const txnHtml = renderTransactions(packet.transactions, root);
  packetEl.innerHTML = `
    <div class="fr-section">
      <h3>Provider Summary</h3>
      ${renderProviderSummary(packet.providerSummary)}
    </div>
    <div class="fr-section">
      <h3>Timeline (${(packet.timeline || []).length})</h3>
      ${renderTimeline(packet.timeline)}
    </div>
    <div class="fr-section">
      <h3>Provider History (${(packet.providerHistory || []).length})</h3>
      ${renderProviderHistory(packet.providerHistory)}
    </div>
    <div class="fr-section">
      <h3>Tool Steps (${(packet.toolSteps || []).length})</h3>
      ${renderToolSteps(packet.toolSteps)}
    </div>
    <div class="fr-section" id="frTransactionSection">
      <h3>Transactions (${(packet.transactions || []).length})</h3>
      ${txnHtml}
    </div>
    <div class="fr-section">
      <h3>Read Basis (${(packet.readBasis || []).length})</h3>
      ${renderReadBasis(packet.readBasis)}
    </div>
    <div class="fr-section">
      <h3>Hook Traces (${(packet.hookTrace || []).length})</h3>
      ${renderHookTraces(packet.hookTrace)}
    </div>
  `;
  packetEl.querySelectorAll(".fr-rollback-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleRollback(btn.dataset.txnId, root));
  });
}

async function handleRollback(transactionId, root) {
  if (!transactionId || !pluginAdminFetchRef) return;
  if (!confirm(`Roll back transaction ${transactionId}?`)) return;
  renderStatus(root, "Rolling back...");
  try {
    const result = await pluginAdminFetchRef(`/api/tasks/transactions/${encodeURIComponent(transactionId)}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: false })
    });
    const data = await result.json();
    if (data.ok) {
      renderStatus(root, `Rolled back ${transactionId}`);
      if (currentTaskId) await loadPacket(currentTaskId, root);
    } else {
      renderStatus(root, `Rollback failed: ${data.error || "unknown"}`, true);
    }
  } catch (error) {
    renderStatus(root, `Rollback error: ${error.message}`, true);
  }
}

async function loadPacket(taskId, root) {
  if (!taskId || !pluginAdminFetchRef) return;
  renderStatus(root, "Loading...");
  try {
    const result = await pluginAdminFetchRef(`/api/plugins/developer-tools/task-debug?taskId=${encodeURIComponent(taskId)}&limit=80`);
    const data = await result.json();
    currentPacket = data;
    renderPacket(data, root);
    renderStatus(root, data.ok ? `Loaded task ${taskId}` : `Error: ${data.error || "unknown"}`);
  } catch (error) {
    renderStatus(root, `Load error: ${error.message}`, true);
  }
}

async function handleValidate(root) {
  if (!currentTaskId || !pluginAdminFetchRef) return;
  renderStatus(root, "Validating provider history...");
  try {
    const result = await pluginAdminFetchRef(`/api/tasks/provider-history/validate?taskId=${encodeURIComponent(currentTaskId)}`);
    const data = await result.json();
    if (data.ok) {
      renderStatus(root, `Provider history OK - ${data.providerRecordCount} provider records, ${data.toolStepCount} tool steps.`);
    } else {
      renderStatus(root, `Validation failures (${data.failureCount}): ${(data.failures || []).slice(0, 3).join("; ")}`, true);
    }
  } catch (error) {
    renderStatus(root, `Validate error: ${error.message}`, true);
  }
}

function ensureMarkup(root = flightRecorderRoot) {
  if (!(root instanceof HTMLElement) || root.dataset.frMounted === "1") return;
  root.dataset.frMounted = "1";
  root.innerHTML = `
    <style>
      .fr-controls { display: flex; gap: 8px; align-items: center; padding: 12px 0; flex-wrap: wrap; }
      .fr-controls input { flex: 1; min-width: 200px; }
      .fr-status { padding: 4px 0; font-size: 0.85em; color: var(--text-muted, #888); min-height: 1.4em; }
      .fr-status-error { color: var(--danger, #c33); }
      .fr-summary { display: flex; gap: 16px; flex-wrap: wrap; padding: 6px 0; font-size: 0.9em; }
      .fr-section { margin-bottom: 20px; }
      .fr-section h3 { margin: 0 0 6px; font-size: 0.95em; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.05em; }
      .fr-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
      .fr-table th, .fr-table td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border, #333); }
      .fr-table th { font-weight: 600; color: var(--text-muted, #888); }
      .fr-id, .fr-path { font-family: monospace; font-size: 0.8em; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fr-status-applied { color: var(--success, #4a4); }
      .fr-status-failed, .fr-status-rollback_failed { color: var(--danger, #c33); }
      .fr-status-rolled_back { color: var(--text-muted, #888); }
      .fr-rollback-btn { font-size: 0.8em; padding: 2px 8px; cursor: pointer; }
    </style>
    <div class="inspector">
      <div class="panel-head">
        <div>
          <h2>Flight Recorder</h2>
          <div class="panel-subtle">Inspect provider history, tool steps, transactions, and hook traces for a task.</div>
        </div>
      </div>
      <div class="fr-controls">
        <input id="frTaskIdInput" type="text" placeholder="Task ID (e.g. task-...)" />
        <button id="frLoadBtn">Load</button>
        <button id="frValidateBtn">Validate History</button>
      </div>
      <div id="frStatus" class="fr-status"></div>
      <div id="frPacket"></div>
    </div>
  `;
  const { taskIdInput, loadBtn, validateBtn } = getElements(root);
  if (taskIdInput) {
    taskIdInput.addEventListener("input", () => {
      currentTaskId = taskIdInput.value.trim();
    });
    taskIdInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadBtn?.click();
    });
  }
  if (loadBtn) {
    loadBtn.addEventListener("click", () => {
      if (currentTaskId) loadPacket(currentTaskId, root);
    });
  }
  if (validateBtn) {
    validateBtn.addEventListener("click", () => handleValidate(root));
  }
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;
  flightRecorderRoot = root;
  pluginAdminFetchRef = context?.pluginAdminFetch || null;
  ensureMarkup(root);
}
