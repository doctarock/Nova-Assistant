export function createObserverProjectCycleInspection(context = {}) {
  const {
    classifyFailureText,
    compactTaskText,
    extractContainerPathCandidates,
    normalizeContainerMountPathCandidate,
    normalizeTaskDirectivePath,
    path
  } = context;

  function buildFailureInvestigationTaskMessage(task, followUpMessage = "") {
    const cleanFollowUp = compactTaskText(String(followUpMessage || "").replace(/\s+/g, " ").trim(), 220);
    if (cleanFollowUp && !/^worker returned an invalid json/i.test(cleanFollowUp)) {
      return cleanFollowUp;
    }
    const taskId = String(task?.id || "").trim();
    const summary = compactTaskText(
      String(task?.reviewSummary || task?.resultSummary || task?.workerSummary || task?.notes || "").replace(/\s+/g, " ").trim(),
      220
    );
    const classification = classifyFailureText(summary);
    return compactTaskText(
      `Investigate ${classification} failure for ${task?.codename || taskId || "task"} and determine whether prompt, routing, or tool handling should change. Source task: ${taskId || "unknown"}.`,
      220
    );
  }

  function extractTaskDirectiveValue(message = "", label = "") {
    const prefix = String(label || "").trim().toLowerCase();
    if (!prefix) {
      return "";
    }
    for (const rawLine of String(message || "").split(/\r?\n/)) {
      const line = String(rawLine || "").trim();
      if (line.toLowerCase().startsWith(prefix)) {
        return line.slice(prefix.length).trim();
      }
    }
    return "";
  }

  function objectiveRequiresConcreteImprovement(objective = "") {
    const text = String(objective || "").trim().toLowerCase();
    if (!text) {
      return false;
    }
    return /^(make|create|add|implement|fix|update|improve|tighten|strengthen|expand|refactor|rewrite|repair|build|complete|finish|check|tick|mark)\b/.test(text)
      || /\bconcrete improvement\b/.test(text)
      || /\badvance the project meaningfully\b/.test(text);
  }

  function replaceTaskDirectiveValue(message = "", label = "", nextValue = "") {
    const normalizedLabel = String(label || "").trim();
    const normalizedValue = String(nextValue || "").trim();
    const lines = String(message || "").split(/\r?\n/);
    let replaced = false;
    const nextLines = lines.map((line) => {
      if (String(line || "").trim().toLowerCase().startsWith(normalizedLabel.toLowerCase())) {
        replaced = true;
        return normalizedValue ? `${normalizedLabel} ${normalizedValue}` : String(line || "");
      }
      return String(line || "");
    });
    if (!replaced && normalizedValue) {
      nextLines.push(`${normalizedLabel} ${normalizedValue}`);
    }
    return nextLines.join("\n").trim();
  }

  function removeTaskDirectiveValue(message = "", label = "") {
    const normalizedLabel = String(label || "").trim().toLowerCase();
    if (!normalizedLabel) {
      return String(message || "").trim();
    }
    return String(message || "")
      .split(/\r?\n/)
      .filter((line) => !String(line || "").trim().toLowerCase().startsWith(normalizedLabel))
      .join("\n")
      .trim();
  }

  function normalizeContainerPathForComparison(value = "") {
    return String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  }

  function extractProjectCycleProjectRoot(message = "") {
    const explicitRoot = normalizeTaskDirectivePath(extractTaskDirectiveValue(message, "Project root:"));
    if (explicitRoot.startsWith("/home/openclaw/")) {
      return explicitRoot;
    }
    const impliedMatch = String(message || "").match(/Advance\s+the\s+project\s+.+?\s+in\s+(\S+)/i);
    const impliedRoot = normalizeTaskDirectivePath(String(impliedMatch?.[1] || ""));
    if (impliedRoot.startsWith("/home/openclaw/")) {
      return impliedRoot;
    }
    return "";
  }

  function extractProjectCycleImplementationRoots(message = "") {
    const roots = new Set();
    const projectRoot = extractProjectCycleProjectRoot(message);
    const normalizedProjectRoot = normalizeContainerPathForComparison(projectRoot);
    if (normalizedProjectRoot.startsWith("/home/openclaw/")) {
      roots.add(normalizedProjectRoot);
    }
    const canonicalMatch = String(message || "").match(/Treat\s+(\S+)\s+as the canonical repository folder for implementation work\./i);
    const canonicalRoot = normalizeContainerPathForComparison(
      normalizeContainerMountPathCandidate(String(canonicalMatch?.[1] || "").replace(/[)."'\`,;:!?]+$/g, "").trim())
    );
    if (canonicalRoot.startsWith("/home/openclaw/")) {
      roots.add(canonicalRoot);
    }
    return [...roots];
  }

  function isPlanningDocumentPath(value = "") {
    const normalized = normalizeContainerPathForComparison(value).toLowerCase();
    return /\/project-todo\.md$/.test(normalized) || /\/project-role-tasks\.md$/.test(normalized);
  }

  function isConcreteImplementationInspectionTarget(target = "", { projectRoots = [] } = {}) {
    const normalizedTarget = String(target || "").trim();
    if (!normalizedTarget) {
      return false;
    }
    const candidatePaths = normalizedTarget.startsWith("/home/openclaw/")
      ? [normalizedTarget]
      : extractContainerPathCandidates(normalizedTarget);
    const normalizedRoots = (Array.isArray(projectRoots) ? projectRoots : [projectRoots])
      .map((value) => normalizeContainerPathForComparison(value))
      .filter(Boolean);
    for (const candidate of candidatePaths) {
      const normalizedCandidate = normalizeContainerPathForComparison(candidate);
      if (!normalizedCandidate || isPlanningDocumentPath(normalizedCandidate)) {
        continue;
      }
      if (normalizedRoots.some((root) => normalizedCandidate === root)) {
        continue;
      }
      if (normalizedRoots.length && !normalizedRoots.some((root) => normalizedCandidate.startsWith(`${root}/`))) {
        continue;
      }
      return true;
    }
    return false;
  }

  function buildProjectCycleCompletionPolicy(message = "", { minimumConcreteTargets = 3 } = {}) {
    const normalizedMessage = String(message || "").trim();
    const projectRootPath = extractProjectCycleProjectRoot(normalizedMessage);
    const projectRoots = extractProjectCycleImplementationRoots(normalizedMessage);
    const inspectFirstTarget = extractTaskDirectiveValue(normalizedMessage, "Inspect first:");
    const expectedFirstMove = extractTaskDirectiveValue(normalizedMessage, "Expected first move:");
    const objectiveText = extractTaskDirectiveValue(normalizedMessage, "Objective:");
    const requiresConcreteImprovement = objectiveRequiresConcreteImprovement(objectiveText);
    const normalizedProjectRoots = projectRoots
      .map((candidate) => normalizeContainerPathForComparison(candidate))
      .filter(Boolean);
    const projectTodoPath = projectRootPath
      ? normalizeContainerPathForComparison(`${projectRootPath}/PROJECT-TODO.md`)
      : "";
    return {
      isProjectCycleTask: /\/project-todo\.md\b/i.test(normalizedMessage)
        || /\bthis is a focused project work package\b/i.test(normalizedMessage),
      message: normalizedMessage,
      objectiveText,
      requiresConcreteImprovement,
      minimumConcreteTargets: Math.max(1, Number(minimumConcreteTargets || 3)),
      projectRootPath,
      projectRoots,
      normalizedProjectRoots,
      projectTodoPath,
      inspectFirstTarget,
      expectedFirstMove,
      noChangeAllowed: !requiresConcreteImprovement,
      requiresProjectTodoUpdate: requiresConcreteImprovement,
      requiresConcreteProjectChange: requiresConcreteImprovement
    };
  }

  function evaluateProjectCycleCompletionState({
    policy = null,
    message = "",
    finalText = "",
    inspectedTargets = [],
    changedWorkspaceFiles = [],
    changedOutputFiles = [],
    successfulToolNames = []
  } = {}) {
    const effectivePolicy = policy && typeof policy === "object"
      ? policy
      : buildProjectCycleCompletionPolicy(message);
    const normalizedSuccessfulToolNames = (Array.isArray(successfulToolNames) ? successfulToolNames : [])
      .map((name) => String(name || "").trim().toLowerCase())
      .filter(Boolean);
    const normalizedInspectedTargets = [...new Set((Array.isArray(inspectedTargets) ? inspectedTargets : [])
      .map((target) => normalizeContainerPathForComparison(target))
      .filter(Boolean))];
    const normalizedChangedWorkspaceFiles = (Array.isArray(changedWorkspaceFiles) ? changedWorkspaceFiles : [])
      .map((file) => ({
        ...file,
        normalizedPath: normalizeContainerPathForComparison(file?.containerPath || file?.fullPath || "")
      }))
      .filter((file) => file.normalizedPath);
    const normalizedChangedOutputFiles = (Array.isArray(changedOutputFiles) ? changedOutputFiles : [])
      .map((file) => ({
        ...file,
        normalizedPath: normalizeContainerPathForComparison(file?.containerPath || file?.fullPath || file?.path || "")
      }))
      .filter((file) => file.normalizedPath);
    const normalizedFinalText = String(finalText || "").trim();
    const usedInspectionTool = normalizedSuccessfulToolNames
      .some((name) => ["list_files", "read_document", "read_file", "shell_command", "web_fetch"].includes(name));
    const usedWriteTool = normalizedSuccessfulToolNames
      .some((name) => ["write_file", "edit_file", "move_path"].includes(name));
    const hasConcreteFileChange = normalizedChangedOutputFiles.length > 0 || normalizedChangedWorkspaceFiles.length > 0;
    const hasConcreteImplementationInspection = effectivePolicy.isProjectCycleTask
      ? normalizedInspectedTargets.some((target) =>
        isConcreteImplementationInspectionTarget(target, { projectRoots: effectivePolicy.projectRoots })
      )
      : usedInspectionTool;
    const changedConcreteProjectFiles = normalizedChangedWorkspaceFiles.filter((file) =>
      effectivePolicy.normalizedProjectRoots.some((root) => {
        if (!(file.normalizedPath === root || file.normalizedPath.startsWith(`${root}/`))) {
          return false;
        }
        const lower = file.normalizedPath.toLowerCase();
        return !lower.endsWith("/project-todo.md") && !lower.endsWith("/project-role-tasks.md");
      })
    );
    const changedProjectTodo = effectivePolicy.projectTodoPath
      ? normalizedChangedWorkspaceFiles.some((file) => file.normalizedPath === effectivePolicy.projectTodoPath)
      : false;
    const hasNoChangeConclusion = /\b(ready for export|no further advance|no further advances|no change is possible|no changes are possible)\b/i.test(normalizedFinalText);
    const namesInspectedTargets = normalizedInspectedTargets.length >= effectivePolicy.minimumConcreteTargets
      && normalizedInspectedTargets.some((target) => normalizedFinalText.toLowerCase().includes(String(target).toLowerCase().slice(0, 40)));
    const soundsSpeculative = /\b(i will|i'll|next step|should\b|plan to|would be to|highest-value improvement)\b/i.test(normalizedFinalText);
    const inspectedExpectedFirstTarget = didInspectNamedTarget(normalizedInspectedTargets, effectivePolicy.inspectFirstTarget);
    const blockingCodes = [];
    if (soundsSpeculative) {
      blockingCodes.push("speculative_final_text");
    }
    if (!usedInspectionTool && !hasConcreteFileChange) {
      blockingCodes.push("missing_grounded_inspection");
    }
    if (effectivePolicy.isProjectCycleTask && effectivePolicy.inspectFirstTarget && usedInspectionTool && !inspectedExpectedFirstTarget && !hasConcreteImplementationInspection) {
      blockingCodes.push("skipped_named_first_target");
    }
    if (effectivePolicy.isProjectCycleTask && !hasConcreteImplementationInspection) {
      blockingCodes.push("missing_concrete_implementation_inspection");
    }
    if (effectivePolicy.isProjectCycleTask && hasNoChangeConclusion && normalizedInspectedTargets.length < effectivePolicy.minimumConcreteTargets) {
      blockingCodes.push("no_change_insufficient_targets");
    }
    if (effectivePolicy.isProjectCycleTask && hasNoChangeConclusion && !namesInspectedTargets) {
      blockingCodes.push("no_change_missing_named_targets");
    }
    if (effectivePolicy.isProjectCycleTask && hasNoChangeConclusion && effectivePolicy.requiresConcreteImprovement) {
      blockingCodes.push("no_change_disallowed_for_objective");
    }
    if (effectivePolicy.isProjectCycleTask && effectivePolicy.requiresConcreteProjectChange && !hasNoChangeConclusion && !changedConcreteProjectFiles.length) {
      blockingCodes.push("missing_concrete_project_change");
    }
    if (effectivePolicy.isProjectCycleTask && effectivePolicy.requiresProjectTodoUpdate && !hasNoChangeConclusion && effectivePolicy.projectTodoPath && !changedProjectTodo) {
      blockingCodes.push("missing_project_todo_update");
    }
    if (!usedWriteTool && !normalizedChangedOutputFiles.length && !normalizedChangedWorkspaceFiles.length && !hasNoChangeConclusion) {
      blockingCodes.push("missing_machine_verifiable_outcome");
    }
    return {
      policy: effectivePolicy,
      usedInspectionTool,
      usedWriteTool,
      hasConcreteFileChange,
      hasConcreteImplementationInspection,
      changedConcreteProjectFiles: changedConcreteProjectFiles.map((file) => ({
        fullPath: String(file?.fullPath || "").trim(),
        containerPath: String(file?.containerPath || "").trim()
      })),
      changedProjectTodo,
      hasNoChangeConclusion,
      namesInspectedTargets,
      soundsSpeculative,
      inspectedExpectedFirstTarget,
      blockingCodes,
      eligibleForCompletion: blockingCodes.length === 0
    };
  }

  function didInspectNamedTarget(inspectedTargets = [], expectedTarget = "") {
    const normalizedExpected = normalizeContainerPathForComparison(expectedTarget).toLowerCase();
    if (!normalizedExpected) {
      return false;
    }
    return (Array.isArray(inspectedTargets) ? inspectedTargets : [])
      .some((target) => normalizeContainerPathForComparison(target).toLowerCase() === normalizedExpected);
  }

  return {
    buildFailureInvestigationTaskMessage,
    didInspectNamedTarget,
    extractProjectCycleImplementationRoots,
    extractProjectCycleProjectRoot,
    extractTaskDirectiveValue,
    buildProjectCycleCompletionPolicy,
    evaluateProjectCycleCompletionState,
    isConcreteImplementationInspectionTarget,
    isPlanningDocumentPath,
    normalizeContainerPathForComparison,
    objectiveRequiresConcreteImprovement,
    removeTaskDirectiveValue,
    replaceTaskDirectiveValue
  };
}
