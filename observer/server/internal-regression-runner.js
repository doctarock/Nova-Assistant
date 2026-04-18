export function createInternalRegressionRunner({
  createSkillLibraryService,
  createToolConfigService,
  buildRegressionFailure,
  classifyFailureText,
  extractJsonObject,
  normalizeWorkerDecisionEnvelope,
  parseToolCallArgs,
  buildRetryTaskMeta,
  normalizeProjectConfigInput,
  buildCapabilityMismatchRetryMessage,
  buildProjectCycleCompletionPolicy,
  isCapabilityMismatchFailure,
  chooseAutomaticRetryBrainId,
  extractTaskDirectiveValue,
  evaluateProjectCycleCompletionState,
  objectiveRequiresConcreteImprovement,
  buildToolLoopStepDiagnostics,
  buildToolLoopStopMessage,
  ensureClawhubCommandSucceeded,
  searchSkillLibrary,
  inspectSkillLibrarySkill,
  installSkillIntoWorkspace,
  listInstalledSkills,
  buildProjectPipelineCollection,
  chooseProjectCycleRecoveryBrain,
  chooseEscalationRetryBrainId,
  buildEscalationCloseRecommendation,
  buildProjectCycleFollowUpMessage,
  inferProjectCycleSpecialty,
  buildProjectDirectiveContent,
  buildProjectRoleTaskBoardContent,
  parseProjectDirectiveState,
  parseProjectTodoState,
  buildProjectTodoContent,
  buildProjectWorkPackages,
  getProjectWorkAttemptCooldownMs,
  chooseProjectWorkTargets,
  normalizeSummaryComparisonText,
  looksLikePlaceholderTaskMessage,
  isConcreteImplementationInspectionTarget,
  isEchoedToolResultEnvelope,
  collectTrackedWorkspaceTargets,
  shouldBypassWorkerPreflight,
  buildPostToolDecisionInstruction,
  buildWorkerSpecialtyPromptLines,
  buildQueuedTaskExecutionPrompt,
  buildTranscriptForPrompt,
  replanRepeatedToolLoopWithPlanner,
  normalizeToolCallRecord,
  normalizeToolName,
  normalizeContainerPathForComparison,
  extractInspectionTargetKey,
  resolveToolPath,
  requireNonEmptyToolContent,
  runPluginInternalRegressionCase,
  getObserverConfig,
  setObserverConfig
} = {}) {
  return async function runInternalRegressionCase(testCase) {
    const mode = String(testCase?.mode || "").trim();
    if (mode === "failure_classification") {
      const actualClassification = classifyFailureText(testCase.failureText);
      const failures = [];
      if (actualClassification !== String(testCase.expectedClassification || "").trim()) {
        failures.push(`Expected classification ${testCase.expectedClassification}, got ${actualClassification || "(none)"}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          failureText: String(testCase.failureText || "").trim(),
          classification: actualClassification
        }
      };
    }
    if (mode === "json_envelope_repair") {
      const failures = [];
      let parsed = null;
      let parseError = "";
      try {
        parsed = normalizeWorkerDecisionEnvelope(
          extractJsonObject(String(testCase.responseText || ""))
        );
      } catch (error) {
        parseError = String(error?.message || error || "").trim();
        failures.push(`Expected JSON envelope to parse, but it failed: ${parseError || "unknown error"}.`);
      }
      const toolCalls = Array.isArray(parsed?.tool_calls)
        ? parsed.tool_calls.map((call, index) => normalizeToolCallRecord(call, index))
        : [];
      if (parsed && Number.isFinite(Number(testCase.expectedToolCallCount))) {
        const expectedCount = Number(testCase.expectedToolCallCount);
        if (toolCalls.length !== expectedCount) {
          failures.push(`Expected ${expectedCount} tool call(s), got ${toolCalls.length}.`);
        }
      }
      const expectedToolNames = Array.isArray(testCase.expectedToolNames) ? testCase.expectedToolNames : [];
      expectedToolNames.forEach((expectedName, index) => {
        const actualName = String(toolCalls[index]?.function?.name || "").trim();
        if (actualName !== String(expectedName || "").trim()) {
          failures.push(`Expected tool call ${index + 1} to be ${expectedName}, got ${actualName || "(none)"}.`);
        }
      });
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          parseError,
          toolCalls: toolCalls.map((call) => ({
            id: String(call?.id || "").trim(),
            name: String(call?.function?.name || "").trim(),
            arguments: String(call?.function?.arguments || "").trim(),
            parsedArguments: parseToolCallArgs(call)
          }))
        }
      };
    }
    if (mode === "retry_meta") {
      const retryMeta = buildRetryTaskMeta(testCase.task, {});
      const failures = [];
      for (const key of ["projectWorkPrimaryTarget", "projectWorkSecondaryTarget", "projectWorkTertiaryTarget", "projectWorkExpectedFirstMove"]) {
        if (String(retryMeta?.[key] || "").trim() !== String(testCase.task?.[key] || "").trim()) {
          failures.push(`Retry metadata did not preserve ${key}.`);
        }
      }
      if (String(retryMeta?.creativeThroughputMode || "").trim() !== String(testCase.task?.creativeThroughputMode || "").trim()) {
        failures.push("Retry metadata did not preserve creativeThroughputMode.");
      }
      if (Boolean(retryMeta?.preferHigherThroughputCreativeLane) !== Boolean(testCase.task?.preferHigherThroughputCreativeLane)) {
        failures.push("Retry metadata did not preserve preferHigherThroughputCreativeLane.");
      }
      if (Boolean(retryMeta?.skipCreativeHandoff) !== Boolean(testCase.task?.skipCreativeHandoff)) {
        failures.push("Retry metadata did not preserve skipCreativeHandoff.");
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: retryMeta
      };
    }
    if (mode === "project_config") {
      const actual = normalizeProjectConfigInput(testCase.input);
      const failures = [];
      for (const [key, expectedValue] of Object.entries(testCase.expected || {})) {
        if (actual?.[key] !== expectedValue) {
          failures.push(`Expected project config ${key}=${expectedValue}, got ${actual?.[key]}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual
      };
    }
    if (mode === "project_work_retry_cooldown") {
      const actualCooldownMs = Number(getProjectWorkAttemptCooldownMs(testCase.task || {}, testCase.cooldownMs));
      const failures = [];
      if (actualCooldownMs !== Number(testCase.expectedCooldownMs)) {
        failures.push(`Expected project work retry cooldown ${Number(testCase.expectedCooldownMs)}, got ${actualCooldownMs}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          cooldownMs: actualCooldownMs
        }
      };
    }
    if (mode === "project_retry_threshold") {
      const previousProjects = getObserverConfig()?.projects;
      setObserverConfig({
        ...getObserverConfig(),
        projects: normalizeProjectConfigInput(testCase.projects)
      });
      try {
        const message = buildCapabilityMismatchRetryMessage({
          message: "Advance the project Example in /home/openclaw/.observer-sandbox/workspace/Example.\nThis is a focused project work package, not a full project sweep.",
          projectPath: "/home/openclaw/.observer-sandbox/workspace/Example"
        }, "no_change_insufficient_inspection");
        const failures = [];
        if (!String(message || "").includes(String(testCase.expectedIncludes || ""))) {
          failures.push(`Expected retry message to include ${testCase.expectedIncludes}.`);
        }
        return {
          passed: failures.length === 0,
          failures,
          actual: {
            message
          }
        };
      } finally {
        setObserverConfig({
          ...getObserverConfig(),
          projects: previousProjects
        });
      }
    }
    if (mode === "tool_call_args") {
      const actual = parseToolCallArgs(testCase.toolCall || {});
      const failures = [];
      for (const [key, expectedValue] of Object.entries(testCase.expected || {})) {
        const actualValue = actual?.[key];
        if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
          failures.push(`Expected parsed tool arg ${key}=${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual
      };
    }
    if (mode === "tool_path_resolution") {
      const failures = [];
      let actual = {
        path: String(testCase.path || "").trim(),
        resolved: "",
        error: ""
      };
      try {
        actual.resolved = resolveToolPath(actual.path);
      } catch (error) {
        actual.error = error?.message || String(error);
      }
      if (testCase.expectedResolved && actual.resolved !== String(testCase.expectedResolved || "")) {
        failures.push(`Expected resolved path ${testCase.expectedResolved}, got ${actual.resolved || "(none)"}.`);
      }
      if (testCase.expectedErrorIncludes && !String(actual.error || "").includes(String(testCase.expectedErrorIncludes || ""))) {
        failures.push(`Expected path resolution error to include ${testCase.expectedErrorIncludes}, got ${actual.error || "(none)"}.`);
      }
      if (!testCase.expectedErrorIncludes && actual.error) {
        failures.push(`Expected path resolution to succeed, got error ${actual.error}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual
      };
    }
    if (mode === "tool_content_guardrail") {
      const failures = [];
      let actual = {
        toolName: String(testCase.toolName || "write_file").trim() || "write_file",
        content: "",
        error: ""
      };
      try {
        actual.content = requireNonEmptyToolContent(testCase.content, {
          toolName: actual.toolName,
          targetPath: String(testCase.targetPath || "").trim()
        });
      } catch (error) {
        actual.error = error?.message || String(error);
      }
      if (testCase.expectedContent && actual.content !== String(testCase.expectedContent || "")) {
        failures.push(`Expected validated content ${JSON.stringify(testCase.expectedContent)}, got ${JSON.stringify(actual.content)}.`);
      }
      if (testCase.expectedErrorIncludes && !String(actual.error || "").includes(String(testCase.expectedErrorIncludes || ""))) {
        failures.push(`Expected content guardrail error to include ${testCase.expectedErrorIncludes}, got ${actual.error || "(none)"}.`);
      }
      if (!testCase.expectedErrorIncludes && actual.error) {
        failures.push(`Expected content guardrail to succeed, got error ${actual.error}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual
      };
    }
    if (mode === "project_retry_message") {
      const message = buildCapabilityMismatchRetryMessage(testCase.task || {}, String(testCase.failureClassification || "").trim());
      const failures = [];
      for (const expected of Array.isArray(testCase.expectedIncludes) ? testCase.expectedIncludes : []) {
        if (!String(message || "").includes(String(expected || ""))) {
          failures.push(`Expected retry message to include ${expected}.`);
        }
      }
      for (const unexpected of Array.isArray(testCase.unexpectedIncludes) ? testCase.unexpectedIncludes : []) {
        if (String(message || "").includes(String(unexpected || ""))) {
          failures.push(`Expected retry message to omit ${unexpected}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          message
        }
      };
    }
    if (mode === "capability_mismatch_failure") {
      const actual = isCapabilityMismatchFailure(String(testCase.failureClassification || "").trim(), testCase.task || {});
      const expected = Boolean(testCase.expectedCapabilityMismatch);
      const failures = [];
      if (actual !== expected) {
        failures.push(`Expected capability mismatch=${expected}, got ${actual}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          capabilityMismatch: actual
        }
      };
    }
    if (mode === "project_cycle_no_change_policy") {
      const objective = extractTaskDirectiveValue(String(testCase.message || "").trim(), "Objective:");
      const reject = objectiveRequiresConcreteImprovement(objective)
        && /\b(no change is possible|no changes are possible)\b/i.test(String(testCase.finalText || ""));
      const failures = [];
      if (reject !== Boolean(testCase.expectedReject)) {
        failures.push(`Expected no-change rejection=${Boolean(testCase.expectedReject)}, got ${reject}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          objective,
          reject
        }
      };
    }
    if (mode === "project_cycle_concrete_file_change_policy") {
      const message = String(testCase.message || "").trim();
      const projectRoot = normalizeContainerPathForComparison(
        String(extractTaskDirectiveValue(message, "Project root:") || "").trim().replace(/[.]+$/, "")
      );
      const changedWorkspaceFiles = Array.isArray(testCase.changedWorkspaceFiles) ? testCase.changedWorkspaceFiles : [];
      const changedConcreteProjectFiles = changedWorkspaceFiles.filter((file) => {
        const filePath = normalizeContainerPathForComparison(file?.containerPath || file?.fullPath || "");
        if (!projectRoot || !(filePath === projectRoot || filePath.startsWith(`${projectRoot}/`))) {
          return false;
        }
        const lower = filePath.toLowerCase();
        return !lower.endsWith("/project-todo.md") && !lower.endsWith("/project-role-tasks.md");
      });
      const failures = [];
      if (Number.isFinite(Number(testCase.expectedConcreteChangeCount))
        && changedConcreteProjectFiles.length !== Number(testCase.expectedConcreteChangeCount)) {
        failures.push(
          `Expected ${Number(testCase.expectedConcreteChangeCount)} concrete project file change(s), got ${changedConcreteProjectFiles.length}.`
        );
      }
      for (const expectedPath of Array.isArray(testCase.expectedConcretePaths) ? testCase.expectedConcretePaths : []) {
        const normalizedExpected = normalizeContainerPathForComparison(String(expectedPath || "").trim());
        if (!changedConcreteProjectFiles.some((file) =>
          normalizeContainerPathForComparison(file?.containerPath || file?.fullPath || "") === normalizedExpected
        )) {
          failures.push(`Expected concrete project file changes to include ${expectedPath}.`);
        }
      }
      for (const unexpectedPath of Array.isArray(testCase.unexpectedConcretePaths) ? testCase.unexpectedConcretePaths : []) {
        const normalizedUnexpected = normalizeContainerPathForComparison(String(unexpectedPath || "").trim());
        if (changedConcreteProjectFiles.some((file) =>
          normalizeContainerPathForComparison(file?.containerPath || file?.fullPath || "") === normalizedUnexpected
        )) {
          failures.push(`Expected concrete project file changes to omit ${unexpectedPath}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          projectRoot,
          changedConcreteProjectFiles: changedConcreteProjectFiles.map((file) => ({
            fullPath: String(file?.fullPath || "").trim(),
            containerPath: String(file?.containerPath || "").trim()
          }))
        }
      };
    }
    if (mode === "project_cycle_completion_policy") {
      const policy = buildProjectCycleCompletionPolicy(String(testCase.message || "").trim(), {
        minimumConcreteTargets: Number(testCase.minimumConcreteTargets || 3)
      });
      const actual = evaluateProjectCycleCompletionState({
        policy,
        message: String(testCase.message || "").trim(),
        finalText: String(testCase.finalText || "").trim(),
        inspectedTargets: Array.isArray(testCase.inspectedTargets) ? testCase.inspectedTargets : [],
        changedWorkspaceFiles: Array.isArray(testCase.changedWorkspaceFiles) ? testCase.changedWorkspaceFiles : [],
        changedOutputFiles: Array.isArray(testCase.changedOutputFiles) ? testCase.changedOutputFiles : [],
        successfulToolNames: Array.isArray(testCase.successfulToolNames) ? testCase.successfulToolNames : []
      });
      const failures = [];
      if (Object.prototype.hasOwnProperty.call(testCase, "expectedEligibleForCompletion")
        && actual.eligibleForCompletion !== Boolean(testCase.expectedEligibleForCompletion)) {
        failures.push(`Expected eligibleForCompletion=${Boolean(testCase.expectedEligibleForCompletion)}, got ${actual.eligibleForCompletion}.`);
      }
      for (const expectedCode of Array.isArray(testCase.expectedBlockingCodes) ? testCase.expectedBlockingCodes : []) {
        if (!actual.blockingCodes.includes(String(expectedCode || "").trim())) {
          failures.push(`Expected completion blocking code ${expectedCode}.`);
        }
      }
      for (const unexpectedCode of Array.isArray(testCase.unexpectedBlockingCodes) ? testCase.unexpectedBlockingCodes : []) {
        if (actual.blockingCodes.includes(String(unexpectedCode || "").trim())) {
          failures.push(`Expected completion blocking codes to omit ${unexpectedCode}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual
      };
    }
    if (mode === "project_cycle_waiting_policy") {
      const policy = buildProjectCycleCompletionPolicy(String(testCase.message || "").trim(), {
        minimumConcreteTargets: Number(testCase.minimumConcreteTargets || 3)
      });
      const completionState = evaluateProjectCycleCompletionState({
        policy,
        message: String(testCase.message || "").trim(),
        finalText: String(testCase.finalText || "").trim(),
        inspectedTargets: Array.isArray(testCase.inspectedTargets) ? testCase.inspectedTargets : [],
        changedWorkspaceFiles: Array.isArray(testCase.changedWorkspaceFiles) ? testCase.changedWorkspaceFiles : [],
        changedOutputFiles: Array.isArray(testCase.changedOutputFiles) ? testCase.changedOutputFiles : [],
        successfulToolNames: Array.isArray(testCase.successfulToolNames) ? testCase.successfulToolNames : []
      });
      const objective = extractTaskDirectiveValue(String(testCase.message || "").trim(), "Objective:");
      const waitingForUser = Boolean(testCase.waitingForUser);
      const requiresConcreteOutcome = Boolean(
        testCase.forceToolUse
        || String(testCase.preset || "").trim() === "queued-task"
        || /\b(project|repo|repository|code|implement|implementation|refactor|debug|bug|fix|patch|todo|fixme|script)\b/i.test(String(testCase.message || ""))
      );
      const reject = waitingForUser
        && requiresConcreteOutcome
        && !completionState.eligibleForCompletion;
      const failures = [];
      if (Object.prototype.hasOwnProperty.call(testCase, "expectedReject")
        && reject !== Boolean(testCase.expectedReject)) {
        failures.push(`Expected waiting rejection=${Boolean(testCase.expectedReject)}, got ${reject}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          objective,
          waitingForUser,
          requiresConcreteOutcome,
          eligibleForCompletion: completionState.eligibleForCompletion,
          blockingCodes: completionState.blockingCodes,
          reject
        }
      };
    }
    if (mode === "tool_loop_step_diagnostics") {
      const actual = buildToolLoopStepDiagnostics({
        step: 1,
        toolResults: Array.isArray(testCase.toolResults) ? testCase.toolResults : [],
        inspectionTargets: Array.isArray(testCase.inspectionTargets) ? testCase.inspectionTargets : [],
        newInspectionTargets: Array.isArray(testCase.newInspectionTargets) ? testCase.newInspectionTargets : [],
        newConcreteInspectionTargets: Array.isArray(testCase.newConcreteInspectionTargets) ? testCase.newConcreteInspectionTargets : [],
        changedWorkspaceFiles: Array.isArray(testCase.changedWorkspaceFiles) ? testCase.changedWorkspaceFiles : [],
        changedOutputFiles: Array.isArray(testCase.changedOutputFiles) ? testCase.changedOutputFiles : []
      });
      const failures = [];
      for (const [key, expectedValue] of Object.entries(testCase.expected || {})) {
        if (actual?.[key] !== expectedValue) {
          failures.push(`Expected step diagnostics ${key}=${expectedValue}, got ${actual?.[key]}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual
      };
    }
    if (mode === "project_cycle_specialty") {
      const actualSpecialty = inferProjectCycleSpecialty(testCase.project || {}, testCase.todoState || {}, String(testCase.focus || "").trim());
      const failures = [];
      if (actualSpecialty !== String(testCase.expectedSpecialty || "").trim()) {
        failures.push(`Expected project-cycle specialty ${testCase.expectedSpecialty}, got ${actualSpecialty || "(none)"}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          specialty: actualSpecialty
        }
      };
    }
    if (mode === "project_directive_state") {
      const actual = parseProjectDirectiveState(testCase.inspection || {}, String(testCase.directiveContent || ""));
      const failures = [];
      if (actual?.path !== String(testCase.expectedPath || "").trim()) {
        failures.push(`Expected directive path ${testCase.expectedPath}, got ${actual?.path || "(none)"}.`);
      }
      const uncheckedFocus = Array.isArray(actual?.uncheckedItems)
        ? actual.uncheckedItems.map((entry) => String(entry?.focus || "").trim())
        : [];
      for (const expectedFocus of Array.isArray(testCase.expectedUncheckedFocus) ? testCase.expectedUncheckedFocus : []) {
        if (!uncheckedFocus.includes(String(expectedFocus || "").trim())) {
          failures.push(`Expected directive unchecked focus ${expectedFocus}, got ${uncheckedFocus.join(" | ") || "(none)"}.`);
        }
      }
      if (Boolean(actual?.authoritative) !== Boolean(testCase.expectedAuthoritative)) {
        failures.push(`Expected directive authoritative=${Boolean(testCase.expectedAuthoritative)}, got ${Boolean(actual?.authoritative)}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual
      };
    }
    if (mode === "project_todo_seed") {
      const actual = buildProjectTodoContent(testCase.project || {}, testCase.inspection || {}, testCase.directiveState || {});
      const failures = [];
      for (const expectedText of Array.isArray(testCase.expectedIncludes) ? testCase.expectedIncludes : []) {
        if (!String(actual || "").includes(String(expectedText || ""))) {
          failures.push(`Expected todo content to include ${expectedText}.`);
        }
      }
      for (const unexpectedText of Array.isArray(testCase.unexpectedIncludes) ? testCase.unexpectedIncludes : []) {
        if (String(actual || "").includes(String(unexpectedText || ""))) {
          failures.push(`Expected todo content to omit ${unexpectedText}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          content: actual
        }
      };
    }
    if (mode === "project_todo_state") {
      const actual = parseProjectTodoState(String(testCase.todoContent || ""));
      const failures = [];
      if (Object.prototype.hasOwnProperty.call(testCase, "expectedUncheckedCount")
        && Number(actual?.unchecked?.length || 0) !== Number(testCase.expectedUncheckedCount)) {
        failures.push(`Expected unchecked todo count ${Number(testCase.expectedUncheckedCount)}, got ${Number(actual?.unchecked?.length || 0)}.`);
      }
      if (Object.prototype.hasOwnProperty.call(testCase, "expectedCheckedCount")
        && Number(actual?.checked?.length || 0) !== Number(testCase.expectedCheckedCount)) {
        failures.push(`Expected checked todo count ${Number(testCase.expectedCheckedCount)}, got ${Number(actual?.checked?.length || 0)}.`);
      }
      for (const expectedText of Array.isArray(testCase.expectedUncheckedIncludes) ? testCase.expectedUncheckedIncludes : []) {
        if (!Array.isArray(actual?.unchecked) || !actual.unchecked.includes(String(expectedText || "").trim())) {
          failures.push(`Expected unchecked todo items to include ${expectedText}.`);
        }
      }
      for (const expectedText of Array.isArray(testCase.expectedNormalizedIncludes) ? testCase.expectedNormalizedIncludes : []) {
        if (!String(actual?.normalizedContent || "").includes(String(expectedText || ""))) {
          failures.push(`Expected normalized todo content to include ${expectedText}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual
      };
    }
    if (mode === "project_directive_seed") {
      const actual = buildProjectDirectiveContent(testCase.project || {}, testCase.inspection || {});
      const failures = [];
      for (const expectedText of Array.isArray(testCase.expectedIncludes) ? testCase.expectedIncludes : []) {
        if (!String(actual || "").includes(String(expectedText || ""))) {
          failures.push(`Expected directive content to include ${expectedText}.`);
        }
      }
      for (const unexpectedText of Array.isArray(testCase.unexpectedIncludes) ? testCase.unexpectedIncludes : []) {
        if (String(actual || "").includes(String(unexpectedText || ""))) {
          failures.push(`Expected directive content to omit ${unexpectedText}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          content: actual
        }
      };
    }
    if (mode === "project_role_board_seed") {
      const actual = buildProjectRoleTaskBoardContent(testCase.project || {}, testCase.inspection || {}, testCase.directiveState || {});
      const failures = [];
      for (const expectedText of Array.isArray(testCase.expectedIncludes) ? testCase.expectedIncludes : []) {
        if (!String(actual || "").includes(String(expectedText || ""))) {
          failures.push(`Expected role board content to include ${expectedText}.`);
        }
      }
      for (const unexpectedText of Array.isArray(testCase.unexpectedIncludes) ? testCase.unexpectedIncludes : []) {
        if (String(actual || "").includes(String(unexpectedText || ""))) {
          failures.push(`Expected role board content to omit ${unexpectedText}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          content: actual
        }
      };
    }
    if (mode === "project_work_packages") {
      const actual = buildProjectWorkPackages(testCase.project || {}, testCase.todoState || {}, Number(testCase.limit) || 6);
      const failures = [];
      const focuses = Array.isArray(actual) ? actual.map((entry) => String(entry?.focus || "").trim()) : [];
      for (const expectedFocus of Array.isArray(testCase.expectedFocuses) ? testCase.expectedFocuses : []) {
        if (!focuses.includes(String(expectedFocus || "").trim())) {
          failures.push(`Expected work packages to include ${expectedFocus}, got ${focuses.join(" | ") || "(none)"}.`);
        }
      }
      for (const unexpectedFocus of Array.isArray(testCase.unexpectedFocuses) ? testCase.unexpectedFocuses : []) {
        if (focuses.includes(String(unexpectedFocus || "").trim())) {
          failures.push(`Expected work packages to omit ${unexpectedFocus}.`);
        }
      }
      if (Number.isFinite(Number(testCase.expectedCount)) && actual.length !== Number(testCase.expectedCount)) {
        failures.push(`Expected ${Number(testCase.expectedCount)} work package(s), got ${actual.length}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual
      };
    }
    if (mode === "project_work_targets") {
      const actual = chooseProjectWorkTargets(
        testCase.project || {},
        testCase.todoState || {},
        String(testCase.focus || "").trim(),
        { preferredTarget: String(testCase.preferredTarget || "").trim() }
      );
      const failures = [];
      for (const [key, expectedValue] of Object.entries(testCase.expected || {})) {
        if (String(actual?.[key] || "").trim() !== String(expectedValue || "").trim()) {
          failures.push(`Expected work target ${key}=${expectedValue}, got ${actual?.[key] || "(none)"}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual
      };
    }
    if (mode === "placeholder_task_message") {
      const actual = looksLikePlaceholderTaskMessage(String(testCase.message || ""));
      const failures = [];
      if (actual !== Boolean(testCase.expectedPlaceholder)) {
        failures.push(`Expected placeholder=${Boolean(testCase.expectedPlaceholder)}, got ${actual}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          placeholder: actual
        }
      };
    }
    if (mode === "tracked_workspace_targets") {
      const actual = collectTrackedWorkspaceTargets(String(testCase.message || ""));
      const failures = [];
      for (const expectedPath of Array.isArray(testCase.expectedContainerWorkspacePaths) ? testCase.expectedContainerWorkspacePaths : []) {
        if (!Array.isArray(actual?.containerWorkspacePaths) || !actual.containerWorkspacePaths.includes(String(expectedPath || "").trim())) {
          failures.push(`Expected tracked container workspace path ${expectedPath}, but it was missing.`);
        }
      }
      for (const expectedPath of Array.isArray(testCase.expectedHostPaths) ? testCase.expectedHostPaths : []) {
        if (!Array.isArray(actual?.hostPaths) || !actual.hostPaths.includes(String(expectedPath || "").trim())) {
          failures.push(`Expected tracked host path ${expectedPath}, but it was missing.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual
      };
    }
    if (mode === "worker_preflight_bypass") {
      const actual = shouldBypassWorkerPreflight(testCase.task || {});
      const failures = [];
      if (actual !== Boolean(testCase.expectedBypass)) {
        failures.push(`Expected worker preflight bypass=${Boolean(testCase.expectedBypass)}, got ${actual}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          bypass: actual
        }
      };
    }
    if (mode === "tool_loop_stop_message") {
      const rendered = buildToolLoopStopMessage(String(testCase.reason || "").trim(), testCase.diagnostics || {});
      const failures = [];
      for (const expectedSnippet of Array.isArray(testCase.mustInclude) ? testCase.mustInclude : []) {
        if (!rendered.includes(String(expectedSnippet))) {
          failures.push(`Tool-loop stop message did not include ${expectedSnippet}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          rendered
        }
      };
    }
    if (mode === "skill_library_command_failure") {
      const failures = [];
      let actualMessage = "";
      try {
        ensureClawhubCommandSucceeded(testCase.result || {}, String(testCase.action || "clawhub command"));
        failures.push("Expected skill command failure to throw, but it succeeded.");
      } catch (error) {
        actualMessage = String(error?.message || error || "").trim();
      }
      const expectedMessage = String(testCase.expectedMessageIncludes || "").trim();
      if (expectedMessage && !actualMessage.includes(expectedMessage)) {
        failures.push(`Expected skill command failure message to include ${expectedMessage}, got ${actualMessage || "(empty)"}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          message: actualMessage
        }
      };
    }
    if (mode === "skill_library_pipeline") {
      const query = String(testCase.query || "").trim();
      const limit = Math.max(1, Math.min(12, Number(testCase.limit) || 5));
      const search = await searchSkillLibrary(query, limit);
      const failures = [];
      const results = Array.isArray(search?.results) ? search.results : [];
      if (results.length < Math.max(1, Number(testCase.minResults) || 1)) {
        failures.push(`Expected at least ${Math.max(1, Number(testCase.minResults) || 1)} skill search result(s), got ${results.length}.`);
      }
      const expectedSearchSlugs = Array.isArray(testCase.expectedSearchSlugIncludes) ? testCase.expectedSearchSlugIncludes : [];
      for (const expectedSlug of expectedSearchSlugs) {
        const normalizedExpected = String(expectedSlug || "").trim();
        const hasExpected = results.some((entry) => {
          const slug = String(entry?.slug || "").trim();
          return slug === normalizedExpected
            || slug.startsWith(`${normalizedExpected}-`)
            || normalizedExpected.startsWith(`${slug}-`);
        });
        if (!hasExpected) {
          failures.push(`Skill search results did not include expected slug ${expectedSlug}.`);
        }
      }
      const selected = results.find((entry) => String(entry?.slug || "").trim()) || null;
      let inspected = null;
      let installed = null;
      let installedListEntry = null;
      if (!selected) {
        failures.push("Skill search returned no usable slug to inspect/install.");
      } else {
        inspected = await inspectSkillLibrarySkill(selected.slug);
        for (const fieldName of Array.isArray(testCase.expectedInspectFields) ? testCase.expectedInspectFields : []) {
          if (!String(inspected?.[fieldName] || "").trim()) {
            failures.push(`Inspected skill did not populate ${fieldName}.`);
          }
        }
        installed = await installSkillIntoWorkspace(selected.slug, { approvedByUser: false });
        const installedSkills = await listInstalledSkills();
        installedListEntry = installedSkills.find((entry) => String(entry?.slug || "").trim() === String(selected.slug || "").trim()) || null;
        if (!installedListEntry) {
          failures.push(`Installed skills list did not include ${selected.slug}.`);
        } else {
          for (const fieldName of Array.isArray(testCase.expectedInstalledFields) ? testCase.expectedInstalledFields : []) {
            if (!String(installedListEntry?.[fieldName] || "").trim()) {
              failures.push(`Installed skill listing did not populate ${fieldName}.`);
            }
          }
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          query,
          resultCount: results.length,
          selectedSlug: String(selected?.slug || "").trim(),
          searchResults: results,
          inspected,
          installed: installed ? {
            slug: installed.slug,
            installed: installed.installed,
            approved: installed.approved,
            containerPath: installed.containerPath
          } : null,
          listed: installedListEntry
        }
      };
    }
    if (mode === "skill_approval_persistence") {
      const files = new Map([
        ["skill-registry.json", JSON.stringify({ approved: {} })],
        ["tool-registry.json", JSON.stringify({ tools: {} })],
        ["capability-requests.json", JSON.stringify({ toolRequests: [], skillRequests: [] })]
      ]);
      const skillSlug = String(testCase.skillSlug || "browser-automation").trim();
      const skillName = String(testCase.skillName || "browser").trim() || skillSlug;
      const skillDescription = String(testCase.skillDescription || "browser automation skill").trim();
      const readVolumeFile = async (filePath) => {
        if (!files.has(filePath)) {
          throw new Error(`missing file ${filePath}`);
        }
        return files.get(filePath);
      };
      const writeVolumeText = async (filePath, content) => {
        files.set(filePath, content);
      };
      const makeServices = () => {
        const skillLibrary = createSkillLibraryService({
          ensureObserverToolContainer: async () => {},
          runObserverToolContainerNode: async () => ({ code: 0, stdout: "", stderr: "" }),
          readVolumeFile,
          writeVolumeText,
          readContainerFile: async (filePath) => {
            if (filePath === `/skills/${skillSlug}/SKILL.md`) {
              return `name: ${skillName}\ndescription: ${skillDescription}\n`;
            }
            throw new Error(`missing container file ${filePath}`);
          },
          listContainerFiles: async () => [{ type: "dir", path: `/skills/${skillSlug}`, name: skillSlug }],
          observerContainerWorkspaceRoot: "/workspace",
          observerContainerSkillsRoot: "/skills",
          skillRegistryPath: "skill-registry.json"
        });
        const toolConfig = createToolConfigService({
          buildToolCatalog: () => [{ name: "read_file", defaultApproved: true }],
          compactTaskText: (value) => String(value || "").trim(),
          normalizeToolName: (value) => String(value || "").trim(),
          sanitizeSkillSlug: (value) => String(value || "").trim().toLowerCase(),
          readVolumeFile,
          writeVolumeText,
          toolRegistryPath: "tool-registry.json",
          capabilityRequestsPath: "capability-requests.json",
          listInstalledSkills: skillLibrary.listInstalledSkills,
          containerSkillExists: skillLibrary.containerSkillExists,
          approveInstalledSkill: skillLibrary.approveInstalledSkill,
          revokeInstalledSkillApproval: skillLibrary.revokeInstalledSkillApproval
        });
        return { skillLibrary, toolConfig };
      };
      const failures = [];
      const firstPass = makeServices();
      await firstPass.toolConfig.updateToolConfig({
        skillApprovals: {
          [skillSlug]: true
        }
      });
      const secondPass = makeServices();
      const payload = await secondPass.toolConfig.buildToolConfigPayload();
      const approvedSkill = (Array.isArray(payload?.installedSkills) ? payload.installedSkills : [])
        .find((entry) => String(entry?.slug || "").trim() === skillSlug);
      if (!approvedSkill) {
        failures.push(`Reloaded tool config did not include ${skillSlug}.`);
      } else if (approvedSkill.approved !== true) {
        failures.push(`Reloaded tool config did not persist approval for ${skillSlug}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          persistedRegistry: JSON.parse(files.get("skill-registry.json") || "{}"),
          installedSkills: payload?.installedSkills || []
        }
      };
    }
    if (mode === "project_pipeline_trace") {
      const trace = buildProjectPipelineCollection(Array.isArray(testCase.tasks) ? testCase.tasks : [])[0] || null;
      const failures = [];
      if (!trace) {
        failures.push("Project pipeline trace did not produce a trace.");
      } else {
        if (Number(trace.attemptCount || 0) !== Number(testCase.expected?.attemptCount || 0)) {
          failures.push(`Expected attemptCount ${testCase.expected?.attemptCount}, got ${trace.attemptCount}.`);
        }
        if (String(trace.latestTaskId || "") !== String(testCase.expected?.latestTaskId || "")) {
          failures.push(`Expected latestTaskId ${testCase.expected?.latestTaskId}, got ${trace.latestTaskId || "(none)"}.`);
        }
        if (String(trace.finalStatus || "") !== String(testCase.expected?.finalStatus || "")) {
          failures.push(`Expected finalStatus ${testCase.expected?.finalStatus}, got ${trace.finalStatus || "(none)"}.`);
        }
        if (Number(trace.handoffCount || 0) !== Number(testCase.expected?.handoffCount || 0)) {
          failures.push(`Expected handoffCount ${testCase.expected?.handoffCount}, got ${trace.handoffCount}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: trace
      };
    }
    if (mode === "project_retry_brain_preference") {
      const brain = await chooseProjectCycleRecoveryBrain(
        testCase.task || {},
        String(testCase.failureClassification || "").trim(),
        String(testCase.specialty || "general").trim(),
        Array.isArray(testCase.attemptedBrains) ? testCase.attemptedBrains : []
      );
      const actualBrainId = String(brain?.id || "").trim();
      const failures = [];
      if (actualBrainId !== String(testCase.expectedBrainId || "").trim()) {
        failures.push(`Expected preferred retry brain ${testCase.expectedBrainId}, got ${actualBrainId || "(none)"}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          chosenBrainId: actualBrainId
        }
      };
    }
    if (mode === "automatic_retry_brain") {
      const actualBrainId = await chooseAutomaticRetryBrainId(
        testCase.task || {},
        String(testCase.failureClassification || "").trim()
      );
      const failures = [];
      if (actualBrainId !== String(testCase.expectedBrainId || "").trim()) {
        failures.push(`Expected automatic retry brain ${testCase.expectedBrainId}, got ${actualBrainId || "(none)"}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          chosenBrainId: actualBrainId
        }
      };
    }
    if (mode === "escalation_retry_brain") {
      const actualBrainId = chooseEscalationRetryBrainId({
        requestedBrainId: testCase.requestedBrainId,
        availableWorkers: testCase.availableWorkers,
        attemptedBrains: testCase.attemptedBrains
      });
      const failures = [];
      if (actualBrainId !== String(testCase.expectedBrainId || "").trim()) {
        failures.push(`Expected escalation retry worker ${testCase.expectedBrainId}, got ${actualBrainId || "(none)"}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          requestedBrainId: String(testCase.requestedBrainId || "").trim(),
          attemptedBrains: Array.isArray(testCase.attemptedBrains) ? testCase.attemptedBrains : [],
          availableWorkers: Array.isArray(testCase.availableWorkers) ? testCase.availableWorkers : [],
          chosenBrainId: actualBrainId
        }
      };
    }
    if (mode === "escalation_resolution") {
      const actualBrainId = chooseEscalationRetryBrainId({
        requestedBrainId: testCase.plannerDecision?.requestedBrainId,
        availableWorkers: testCase.availableWorkers,
        attemptedBrains: testCase.attemptedBrains
      });
      const plannerAction = String(testCase.plannerDecision?.action || "").trim().toLowerCase();
      const actualAction = plannerAction === "close" && actualBrainId ? "retry" : plannerAction;
      const failures = [];
      if (actualAction !== String(testCase.expectedAction || "").trim()) {
        failures.push(`Expected escalation action ${testCase.expectedAction}, got ${actualAction || "(none)"}.`);
      }
      if (String(testCase.expectedBrainId || "").trim() && actualBrainId !== String(testCase.expectedBrainId || "").trim()) {
        failures.push(`Expected escalation retry brain ${testCase.expectedBrainId}, got ${actualBrainId || "(none)"}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          plannerAction,
          actualAction,
          chosenBrainId: actualBrainId
        }
      };
    }
    if (mode === "escalation_close_summary") {
      const rendered = buildEscalationCloseRecommendation(testCase.task || {}, testCase.sourceTask || {}, String(testCase.reason || "").trim());
      const failures = [];
      for (const expectedSnippet of Array.isArray(testCase.mustInclude) ? testCase.mustInclude : []) {
        if (!rendered.includes(String(expectedSnippet))) {
          failures.push(`Escalation close summary did not include ${expectedSnippet}.`);
        }
      }
      for (const unexpectedSnippet of Array.isArray(testCase.mustNotInclude) ? testCase.mustNotInclude : []) {
        if (rendered.includes(String(unexpectedSnippet))) {
          failures.push(`Escalation close summary unexpectedly included ${unexpectedSnippet}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          rendered
        }
      };
    }
    if (mode === "project_cycle_follow_up_message") {
      const message = buildProjectCycleFollowUpMessage(testCase.task, {
        focusOverride: testCase.focusOverride,
        retryNote: testCase.retryNote
      });
      const failures = [];
      for (const expectedSnippet of Array.isArray(testCase.expectedMessageIncludes) ? testCase.expectedMessageIncludes : []) {
        if (!normalizeSummaryComparisonText(message).includes(normalizeSummaryComparisonText(expectedSnippet))) {
          failures.push(`Follow-up message did not preserve ${expectedSnippet}.`);
        }
      }
      for (const unexpectedSnippet of Array.isArray(testCase.unexpectedMessageIncludes) ? testCase.unexpectedMessageIncludes : []) {
        if (normalizeSummaryComparisonText(message).includes(normalizeSummaryComparisonText(unexpectedSnippet))) {
          failures.push(`Follow-up message unexpectedly kept ${unexpectedSnippet}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          message
        }
      };
    }
    if (mode === "concrete_inspection_target") {
      const targets = Array.isArray(testCase.targets) ? testCase.targets : [];
      const actualFlags = targets.map((target) => isConcreteImplementationInspectionTarget(target, { projectRoots: testCase.projectRoots }));
      const expectedFlags = Array.isArray(testCase.expectedConcreteFlags) ? testCase.expectedConcreteFlags : [];
      const failures = [];
      expectedFlags.forEach((flag, index) => {
        if (actualFlags[index] !== Boolean(flag)) {
          failures.push(`Expected concrete flag ${Boolean(flag)} for target ${targets[index] || "(missing)"}, got ${actualFlags[index]}.`);
        }
      });
      return {
        passed: failures.length === 0,
        failures,
        actual: targets.map((target, index) => ({
          target,
          concrete: actualFlags[index]
        }))
      };
    }
    if (mode === "echoed_tool_results") {
      const actualEchoed = isEchoedToolResultEnvelope(testCase.decision);
      const expectedEchoed = Boolean(testCase.expectedEchoed);
      const failures = [];
      if (actualEchoed !== expectedEchoed) {
        failures.push(`Expected echoed tool envelope ${expectedEchoed}, got ${actualEchoed}.`);
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          echoed: actualEchoed,
          decision: testCase.decision
        }
      };
    }
    if (mode === "post_tool_handoff") {
      const rendered = buildPostToolDecisionInstruction(
        Array.isArray(testCase.toolResults) ? testCase.toolResults : [],
        {
          inspectFirstTarget: String(testCase.inspectFirstTarget || "").trim(),
          expectedFirstMove: String(testCase.expectedFirstMove || "").trim(),
          stepDiagnostics: testCase.stepDiagnostics || null,
          lowValueStreak: Number(testCase.lowValueStreak || 0),
          requireConcreteConvergence: Boolean(testCase.requireConcreteConvergence),
          mentionsSkillsOrToolbelt: Boolean(testCase.mentionsSkillsOrToolbelt)
        }
      );
      const failures = [];
      for (const expectedSnippet of Array.isArray(testCase.mustInclude) ? testCase.mustInclude : []) {
        if (!rendered.includes(String(expectedSnippet))) {
          failures.push(`Post-tool handoff did not include ${expectedSnippet}.`);
        }
      }
      for (const unexpectedSnippet of Array.isArray(testCase.mustNotInclude) ? testCase.mustNotInclude : []) {
        if (rendered.includes(String(unexpectedSnippet))) {
          failures.push(`Post-tool handoff unexpectedly included ${unexpectedSnippet}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          rendered
        }
      };
    }
    if (mode === "worker_specialty_prompt_lines") {
      const lines = buildWorkerSpecialtyPromptLines(
        testCase.input && typeof testCase.input === "object" ? testCase.input : {}
      );
      const rendered = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
      const failures = [];
      for (const expectedSnippet of Array.isArray(testCase.mustInclude) ? testCase.mustInclude : []) {
        if (!rendered.includes(String(expectedSnippet))) {
          failures.push(`Worker specialty prompt did not include ${expectedSnippet}.`);
        }
      }
      for (const unexpectedSnippet of Array.isArray(testCase.mustNotInclude) ? testCase.mustNotInclude : []) {
        if (rendered.includes(String(unexpectedSnippet))) {
          failures.push(`Worker specialty prompt unexpectedly included ${unexpectedSnippet}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          rendered
        }
      };
    }
    if (mode === "queued_task_execution_prompt") {
      const rendered = buildQueuedTaskExecutionPrompt(
        String(testCase.taskPrompt || "").trim(),
        testCase.task || {}
      );
      const failures = [];
      for (const expectedSnippet of Array.isArray(testCase.mustInclude) ? testCase.mustInclude : []) {
        if (!rendered.includes(String(expectedSnippet))) {
          failures.push(`Queued task execution prompt did not include ${expectedSnippet}.`);
        }
      }
      for (const unexpectedSnippet of Array.isArray(testCase.mustNotInclude) ? testCase.mustNotInclude : []) {
        if (rendered.includes(String(unexpectedSnippet))) {
          failures.push(`Queued task execution prompt unexpectedly included ${unexpectedSnippet}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          rendered
        }
      };
    }
    if (mode === "transcript_rendering") {
      const rendered = buildTranscriptForPrompt(Array.isArray(testCase.transcript) ? testCase.transcript : []);
      const failures = [];
      for (const expectedSnippet of Array.isArray(testCase.mustInclude) ? testCase.mustInclude : []) {
        if (!rendered.includes(String(expectedSnippet))) {
          failures.push(`Transcript did not include ${expectedSnippet}.`);
        }
      }
      for (const unexpectedSnippet of Array.isArray(testCase.mustNotInclude) ? testCase.mustNotInclude : []) {
        if (rendered.includes(String(unexpectedSnippet))) {
          failures.push(`Transcript unexpectedly included ${unexpectedSnippet}.`);
        }
      }
      return {
        passed: failures.length === 0,
        failures,
        actual: {
          rendered
        }
      };
    }
    if (mode !== "tool_loop_repair") {
      if (typeof runPluginInternalRegressionCase === "function") {
        const pluginResult = await runPluginInternalRegressionCase(testCase);
        if (pluginResult && typeof pluginResult === "object") {
          return pluginResult;
        }
      }
      return buildRegressionFailure(`Unsupported internal regression mode: ${testCase?.mode || "(none)"}`);
    }
    const repeatedToolCalls = Array.isArray(testCase.repeatedToolCalls) ? testCase.repeatedToolCalls : [];
    if (!repeatedToolCalls.length) {
      return buildRegressionFailure("Internal tool-loop repair test did not define repeatedToolCalls.");
    }
    const repeatedSignature = JSON.stringify(
      repeatedToolCalls.map((toolCall) => ({
        name: String(toolCall?.name || "").trim(),
        arguments: String(toolCall?.arguments || "").trim()
      }))
    );
    const transcript = [
      {
        role: "assistant",
        assistant_message: "Inspecting the task with tools."
      },
      {
        role: "tool",
        tool_results: repeatedToolCalls.map((toolCall, index) => ({
          call_id: `call_${index + 1}`,
          name: String(toolCall?.name || "").trim(),
          ok: true,
          content: `Previously executed ${String(toolCall?.name || "").trim()} with the same arguments.`
        }))
      },
      {
        role: "assistant",
        assistant_message: "Inspecting the task with tools."
      }
    ];
    const repaired = await replanRepeatedToolLoopWithPlanner({
      message: String(testCase.prompt || "").trim(),
      transcript,
      repeatedToolCallSignature: repeatedSignature,
      executedTools: Array.isArray(testCase.executedTools) ? testCase.executedTools : [],
      inspectedTargets: Array.isArray(testCase.inspectedTargets) ? testCase.inspectedTargets : []
    });
    if (!repaired.ok || !repaired.decision) {
      return buildRegressionFailure(`Tool-loop repair planner (${repaired.plannerBrainId || "fallback-inline"}) did not return a usable replacement plan: ${repaired.error || "unknown error"}`, {
        actual: {
          repaired: false,
          error: repaired.error || "",
          plannerBrainId: repaired.plannerBrainId || ""
        }
      });
    }
    const toolCalls = Array.isArray(repaired.decision.tool_calls) ? repaired.decision.tool_calls.map((call, index) => normalizeToolCallRecord(call, index)) : [];
    const replannedSignature = JSON.stringify(
      toolCalls.map((toolCall) => ({
        name: String(toolCall?.function?.name || "").trim(),
        arguments: String(toolCall?.function?.arguments || "").trim()
      }))
    );
    const failures = [];
    if (repaired.decision.final === true) {
      failures.push("Tool-loop repair returned a final response instead of a replacement tool plan.");
    }
    if (!toolCalls.length) {
      failures.push("Tool-loop repair returned no tool calls.");
    }
    if (replannedSignature === repeatedSignature) {
      failures.push("Tool-loop repair returned the same tool signature again.");
    }
    const firstToolCall = toolCalls[0] || null;
    const firstToolName = normalizeToolName(firstToolCall?.function?.name || "");
    const firstToolTarget = normalizeContainerPathForComparison(
      extractInspectionTargetKey(firstToolName, parseToolCallArgs(firstToolCall))
    );
    const expectedFirstToolName = normalizeToolName(testCase.expectedFirstToolName || "");
    const expectedFirstToolTarget = normalizeContainerPathForComparison(testCase.expectedFirstToolTarget || "");
    if (expectedFirstToolName && firstToolName !== expectedFirstToolName) {
      failures.push(`Expected first replacement tool ${expectedFirstToolName}, got ${firstToolName || "(none)"}.`);
    }
    if (expectedFirstToolTarget && firstToolTarget !== expectedFirstToolTarget) {
      failures.push(`Expected first replacement target ${expectedFirstToolTarget}, got ${firstToolTarget || "(none)"}.`);
    }
    return {
      passed: failures.length === 0,
      failures,
      actual: {
        repaired: true,
        plannerBrainId: repaired.plannerBrainId || "",
        assistantMessage: String(repaired.decision.assistant_message || "").trim(),
        firstToolName,
        firstToolTarget,
        toolCalls: toolCalls.map((toolCall) => ({
          name: String(toolCall?.function?.name || "").trim(),
          arguments: String(toolCall?.function?.arguments || "").trim()
        }))
      }
    };
  };
}
