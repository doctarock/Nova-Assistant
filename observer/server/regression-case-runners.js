import fs from "fs/promises";
import path from "path";

export function createRegressionCaseRunners({
  buildRegressionFailure,
  looksLikeLowSignalPlannerTaskMessage,
  normalizeSummaryComparisonText,
  looksLikeLowSignalCompletionSummary,
  tryBuildObserverNativeResponse,
  planIntakeWithBitNet,
  createQueuedTask,
  processNextQueuedTask,
  findTaskById,
  waitMs,
  listAllTasks,
  getWorkerQueueLane,
  fileExists,
  outputRoot
} = {}) {
  async function ensureRegressionOutputDir() {
    await fs.mkdir(path.join(outputRoot, "worker-regression"), { recursive: true });
  }

  async function readExpectedContentFile(testCase, failures) {
    const contentPath = String(testCase.expectedContentPath || testCase.expectedOutputPath || "").trim();
    if (!contentPath) {
      failures.push("Worker regression expected file content checks but no target file path was configured.");
      return null;
    }
    try {
      return await fs.readFile(contentPath, "utf8");
    } catch {
      failures.push(`Could not read expected content file ${contentPath}.`);
      return null;
    }
  }

  async function getActiveLocalWorkerTasks() {
    const { queued, inProgress } = await listAllTasks();
    return [...queued, ...inProgress].filter((task) => {
      const requestedBrainId = String(task.requestedBrainId || "").trim();
      const queueLane = String(task.queueLane || "").trim();
      return requestedBrainId === "worker" || queueLane === String(getWorkerQueueLane() || "").trim();
    });
  }

  async function waitForTaskSettlement(taskId, timeoutMs = 10 * 60 * 1000) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs || 0));
    while (Date.now() < deadline) {
      const task = await findTaskById(taskId);
      const status = String(task?.status || "").trim().toLowerCase();
      if (["completed", "failed", "closed", "waiting_for_user"].includes(status)) {
        return task;
      }
      if (status === "queued") {
        await processNextQueuedTask("worker");
      }
      await waitMs(1200);
    }
    return null;
  }

  async function runIntakeRegressionCase(testCase) {
    const nativeResponse = await tryBuildObserverNativeResponse(testCase.prompt);
    if (!nativeResponse) {
      return buildRegressionFailure("Prompt did not route to the native observer path.", {
        actual: { route: "non-native" }
      });
    }
    const failures = [];
    if (String(nativeResponse.type || "").trim() !== String(testCase.expectedType || "").trim()) {
      failures.push(`Expected native type ${testCase.expectedType}, got ${nativeResponse.type || "(none)"}.`);
    }
    return {
      passed: failures.length === 0,
      failures,
      actual: {
        route: "observer-native",
        type: String(nativeResponse.type || "").trim(),
        text: String(nativeResponse.text || "").trim()
      }
    };
  }

  async function runPlannerRegressionCase(testCase) {
    const plan = await planIntakeWithBitNet({
      message: testCase.prompt,
      sessionId: "planner-regression",
      internetEnabled: false,
      selectedMountIds: [],
      forceToolUse: false
    });
    const failures = [];
    if (String(plan.action || "").trim() !== String(testCase.expectedAction || "").trim()) {
      failures.push(`Expected planner action ${testCase.expectedAction}, got ${plan.action || "(none)"}.`);
    }
    const replyText = String(plan.replyText || "").trim();
    if (!replyText) {
      failures.push("Planner replyText was empty.");
    }
    const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
    if (testCase.expectedAction === "reply_only" && tasks.length) {
      failures.push("Reply-only planner case unexpectedly produced queued tasks.");
    }
    if (testCase.expectedAction === "enqueue" && !tasks.length) {
      failures.push("Enqueue planner case produced no tasks.");
    }
    if (testCase.expectedEvery) {
      const actualEvery = String(tasks[0]?.every || "").trim();
      if (actualEvery !== String(testCase.expectedEvery).trim()) {
        failures.push(`Expected planned cadence ${testCase.expectedEvery}, got ${actualEvery || "(none)"}.`);
      }
    }
    if (testCase.expectedDelay) {
      const actualDelay = String(tasks[0]?.delay || "").trim();
      if (actualDelay !== String(testCase.expectedDelay).trim()) {
        failures.push(`Expected planned delay ${testCase.expectedDelay}, got ${actualDelay || "(none)"}.`);
      }
    }
    if (testCase.requireShapedTask && tasks[0] && looksLikeLowSignalPlannerTaskMessage(tasks[0].message, testCase.prompt)) {
      failures.push("Planner task message was a near-copy of the prompt instead of a shaped work brief.");
    }
    return {
      passed: failures.length === 0,
      failures,
      actual: {
        action: String(plan.action || "").trim(),
        reason: String(plan.reason || "").trim(),
        replyText,
        tasks
      }
    };
  }

  async function runWorkerRegressionCase(testCase) {
    await ensureRegressionOutputDir();
    if (Array.isArray(testCase.seedFiles)) {
      for (const seed of testCase.seedFiles) {
        const seedPath = String(seed?.path || "").trim();
        if (!seedPath) {
          continue;
        }
        await fs.mkdir(path.dirname(seedPath), { recursive: true });
        await fs.writeFile(seedPath, String(seed?.content || ""), "utf8");
      }
    }
    if (testCase.expectedOutputPath) {
      await fs.rm(testCase.expectedOutputPath, { force: true });
    }
    const queuedTask = await createQueuedTask({
      message: testCase.prompt,
      sessionId: "local-worker-regression",
      requestedBrainId: "worker",
      intakeBrainId: "bitnet",
      internetEnabled: false,
      selectedMountIds: [],
      forceToolUse: true,
      notes: "Queued from automated local worker regression test.",
      taskMeta: {
        lockRequestedBrain: true
      }
    });
    const failures = [];
    if (String(queuedTask.requestedBrainId || "").trim() !== "worker") {
      return buildRegressionFailure(`Local worker regression was rerouted to ${queuedTask.requestedBrainId || "(none)"}.`, {
        taskId: queuedTask.id,
        actual: {
          requestedBrainId: String(queuedTask.requestedBrainId || "").trim(),
          queueLane: String(queuedTask.queueLane || "").trim(),
          specialistRoute: queuedTask.specialistRoute || null
        }
      });
    }
    await processNextQueuedTask("worker");
    const settledTask = await waitForTaskSettlement(queuedTask.id, 10 * 60 * 1000);
    if (!settledTask) {
      return buildRegressionFailure("Worker test task did not settle before timeout.", {
        taskId: queuedTask.id,
        actual: { status: "timeout" }
      });
    }
    const status = String(settledTask.status || "").trim().toLowerCase();
    if (status !== "completed") {
      failures.push(`Expected completed worker task, got ${status}.`);
    }
    const summary = String(
      settledTask.resultSummary
      || settledTask.reviewSummary
      || settledTask.workerSummary
      || settledTask.notes
      || ""
    ).trim();
    if (!summary) {
      failures.push("Worker task settled without any recorded outcome summary.");
    } else if (looksLikeLowSignalCompletionSummary(summary, settledTask)) {
      failures.push("Worker task summary was too vague or mostly repeated the request.");
    }
    if (testCase.expectedOutputPath && !(await fileExists(testCase.expectedOutputPath))) {
      failures.push(`Expected output file was not created: ${testCase.expectedOutputPath}`);
    }
    if (Array.isArray(testCase.expectedNamedTargets) && testCase.expectedNamedTargets.length) {
      const normalizedSummary = normalizeSummaryComparisonText(summary);
      for (const targetName of testCase.expectedNamedTargets) {
        if (!normalizedSummary.includes(normalizeSummaryComparisonText(targetName))) {
          failures.push(`No-change conclusion did not name inspected target ${targetName}.`);
        }
      }
    }
    if (Array.isArray(testCase.expectedSummaryIncludes) && testCase.expectedSummaryIncludes.length) {
      const normalizedSummary = normalizeSummaryComparisonText(summary);
      for (const expectedSnippet of testCase.expectedSummaryIncludes) {
        if (!normalizedSummary.includes(normalizeSummaryComparisonText(expectedSnippet))) {
          failures.push(`Worker summary did not mention ${expectedSnippet}.`);
        }
      }
    }
    const needsContentChecks = (
      Array.isArray(testCase.expectedFileIncludes) && testCase.expectedFileIncludes.length
    ) || (
      Array.isArray(testCase.expectedFileExcludes) && testCase.expectedFileExcludes.length
    );
    const fileContent = needsContentChecks
      ? await readExpectedContentFile(testCase, failures)
      : null;
    if (Array.isArray(testCase.expectedFileIncludes) && testCase.expectedFileIncludes.length && fileContent != null) {
      for (const expectedSnippet of testCase.expectedFileIncludes) {
        if (!String(fileContent).includes(String(expectedSnippet))) {
          failures.push(`Expected file content did not include ${expectedSnippet}.`);
        }
      }
    }
    if (Array.isArray(testCase.expectedFileExcludes) && testCase.expectedFileExcludes.length && fileContent != null) {
      for (const forbiddenSnippet of testCase.expectedFileExcludes) {
        if (String(fileContent).includes(String(forbiddenSnippet))) {
          failures.push(`Expected file content to exclude ${forbiddenSnippet}.`);
        }
      }
    }
    if (Array.isArray(testCase.expectedNonEmptyTaskFields) && testCase.expectedNonEmptyTaskFields.length) {
      for (const fieldName of testCase.expectedNonEmptyTaskFields) {
        if (!String(settledTask?.[fieldName] || "").trim()) {
          failures.push(`Expected settled task field ${fieldName} to be populated.`);
        }
      }
    }
    if (testCase.expectedTaskFields && typeof testCase.expectedTaskFields === "object") {
      for (const [fieldName, expectedValue] of Object.entries(testCase.expectedTaskFields)) {
        if (String(settledTask?.[fieldName] || "").trim() !== String(expectedValue || "").trim()) {
          failures.push(`Expected settled task field ${fieldName}=${expectedValue}, got ${settledTask?.[fieldName] || "(none)"}.`);
        }
      }
    }
    return {
      passed: failures.length === 0,
      failures,
      taskId: queuedTask.id,
      codename: settledTask.codename || queuedTask.codename || "",
      actual: {
        status,
        requestedBrainId: String(settledTask.requestedBrainId || queuedTask.requestedBrainId || "").trim(),
        creativeHandoffBrainId: String(settledTask.creativeHandoffBrainId || "").trim(),
        summary,
        outputFiles: Array.isArray(settledTask.outputFiles) ? settledTask.outputFiles : []
      }
    };
  }

  return {
    getActiveLocalWorkerTasks,
    runIntakeRegressionCase,
    runPlannerRegressionCase,
    runWorkerRegressionCase
  };
}
