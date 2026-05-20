(() => {
const observerApp = window.ObserverApp || (window.ObserverApp = {});
const {
  escapeAttr,
  escapeHtml,
  formatDateTime,
  renderRegressionResults,
  renderRegressionSuiteList
} = observerApp;

async function regressionAdminFetch(url = "", options = {}) {
  if (typeof observerApp.adminFetch === "function") {
    return observerApp.adminFetch(url, options);
  }
  return fetch(url, options);
}
function quotePowerShellArg(value) {
  return `'${String(value == null ? "" : value).replace(/'/g, "''")}'`;
}

function buildRegressionCommandLine(suiteId = "all") {
  const normalizedSuiteId = String(suiteId || "all").trim() || "all";
  return `node nova-observer/run-regressions.js --suite ${quotePowerShellArg(normalizedSuiteId)}`;
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
    const r = await regressionAdminFetch("/api/regressions/run", {
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
Object.assign(observerApp, {
  loadRegressionSuites,
  runRegressionSuites,
  refreshRegressionCommandUi
});

})();