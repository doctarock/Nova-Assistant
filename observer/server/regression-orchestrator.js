export function createRegressionOrchestrator({
  buildRegressionSuiteDefinitions,
  listPluginRegressionSuites = () => [],
  outputRoot,
  readLatestReport,
  writeLatestReport,
  getActiveLocalWorkerTasks,
  runIntakeRegressionCase,
  runPlannerRegressionCase,
  runWorkerRegressionCase,
  runInternalRegressionCase,
  buildRegressionFailure
} = {}) {
  let latestRegressionRunReport = null;
  let activeRegressionRun = null;

  function getRegressionSuiteDefinitions() {
    const resolvedCoreSuites = buildRegressionSuiteDefinitions({ outputRoot });
    const resolvedPluginSuites = listPluginRegressionSuites({ outputRoot });
    const coreSuites = Array.isArray(resolvedCoreSuites) ? resolvedCoreSuites : [];
    const pluginSuites = Array.isArray(resolvedPluginSuites) ? resolvedPluginSuites : [];
    return [...coreSuites, ...pluginSuites];
  }

  function listRegressionSuites() {
    return getRegressionSuiteDefinitions().map((suite) => ({
      id: suite.id,
      label: suite.label,
      description: suite.description,
      caseCount: Array.isArray(suite.cases) ? suite.cases.length : 0,
      requiresIdleWorkerLane: suite.requiresIdleWorkerLane === true,
      cases: (Array.isArray(suite.cases) ? suite.cases : []).map((entry) => ({
        id: entry.id,
        label: entry.label,
        prompt: entry.prompt
      }))
    }));
  }

  function getLatestRegressionRunReport() {
    return latestRegressionRunReport;
  }

  function getActiveRegressionRun() {
    return activeRegressionRun;
  }

  async function saveLatestRegressionRunReport(report) {
    latestRegressionRunReport = report && typeof report === "object"
      ? JSON.parse(JSON.stringify(report))
      : null;
    await writeLatestReport(latestRegressionRunReport);
  }

  async function loadLatestRegressionRunReport() {
    try {
      latestRegressionRunReport = await readLatestReport();
    } catch {
      latestRegressionRunReport = null;
    }
    return latestRegressionRunReport;
  }

  async function runRegressionSuiteById(suiteId = "") {
    const suites = getRegressionSuiteDefinitions();
    const suite = suites.find((entry) => entry.id === String(suiteId || "").trim());
    if (!suite) {
      throw new Error(`Unknown regression suite: ${suiteId}`);
    }
    if (suite.requiresIdleWorkerLane) {
      const activeLocalWorkerTasks = await getActiveLocalWorkerTasks();
      if (activeLocalWorkerTasks.length) {
        const refs = activeLocalWorkerTasks.slice(0, 3).map((task) => task.codename || task.id).join(", ");
        return {
          suiteId: suite.id,
          label: suite.label,
          description: suite.description,
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 0,
          passed: false,
          blocked: true,
          summary: `Blocked because the local worker lane is not idle: ${refs}${activeLocalWorkerTasks.length > 3 ? ", and more" : ""}.`,
          results: []
        };
      }
    }
    const startedAt = Date.now();
    const results = [];
    for (const testCase of suite.cases) {
      const caseStartedAt = Date.now();
      let outcome;
      try {
        if (testCase.kind === "intake") {
          outcome = await runIntakeRegressionCase(testCase);
        } else if (testCase.kind === "planner") {
          outcome = await runPlannerRegressionCase(testCase);
        } else if (testCase.kind === "worker") {
          outcome = await runWorkerRegressionCase(testCase);
        } else if (testCase.kind === "internal") {
          outcome = await runInternalRegressionCase(testCase);
        } else {
          outcome = buildRegressionFailure(`Unsupported regression case kind: ${testCase.kind}`);
        }
      } catch (error) {
        outcome = buildRegressionFailure(error.message || "Regression case crashed.");
      }
      results.push({
        id: testCase.id,
        label: testCase.label,
        kind: testCase.kind,
        prompt: testCase.prompt,
        startedAt: caseStartedAt,
        completedAt: Date.now(),
        durationMs: Math.max(0, Date.now() - caseStartedAt),
        ...outcome
      });
    }
    const passedCount = results.filter((entry) => entry.passed).length;
    const failedCount = results.length - passedCount;
    return {
      suiteId: suite.id,
      label: suite.label,
      description: suite.description,
      startedAt,
      completedAt: Date.now(),
      durationMs: Math.max(0, Date.now() - startedAt),
      passed: failedCount === 0,
      blocked: false,
      passedCount,
      failedCount,
      summary: failedCount === 0
        ? `All ${passedCount} ${suite.label} regression case${passedCount === 1 ? "" : "s"} passed.`
        : `${failedCount} of ${results.length} ${suite.label} regression case${results.length === 1 ? "" : "s"} failed.`,
      results
    };
  }

  async function runRegressionSuites(requestedSuiteId = "all") {
    if (activeRegressionRun) {
      throw new Error("A regression run is already in progress.");
    }
    const suiteIds = requestedSuiteId === "all"
      ? getRegressionSuiteDefinitions().map((suite) => suite.id)
      : [String(requestedSuiteId || "").trim()];
    activeRegressionRun = {
      suiteId: requestedSuiteId,
      startedAt: Date.now()
    };
    try {
      const suites = [];
      for (const suiteId of suiteIds) {
        suites.push(await runRegressionSuiteById(suiteId));
      }
      const completedAt = Date.now();
      const failedSuites = suites.filter((suite) => suite.passed !== true).length;
      const report = {
        suiteId: requestedSuiteId,
        startedAt: activeRegressionRun.startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - Number(activeRegressionRun.startedAt || completedAt)),
        passed: failedSuites === 0,
        failedSuites,
        suites
      };
      await saveLatestRegressionRunReport(report);
      return report;
    } finally {
      activeRegressionRun = null;
    }
  }

  return {
    getActiveRegressionRun,
    getLatestRegressionRunReport,
    listRegressionSuites,
    loadLatestRegressionRunReport,
    runRegressionSuites
  };
}
