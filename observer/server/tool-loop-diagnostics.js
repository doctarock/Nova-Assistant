export function createToolLoopDiagnosticsHelpers({
  compactTaskText,
  normalizeToolName
} = {}) {
  function buildFileSnapshotMap(files = []) {
    return new Map(
      (Array.isArray(files) ? files : [])
        .filter((file) => file?.fullPath)
        .map((file) => [file.fullPath, file])
    );
  }

  function diffFileSnapshots(previousMap = new Map(), nextFiles = []) {
    const nextSnapshotMap = buildFileSnapshotMap(nextFiles);
    const changed = [];
    for (const file of Array.isArray(nextFiles) ? nextFiles : []) {
      const previous = previousMap.get(file.fullPath);
      if (!previous) {
        changed.push({
          ...file,
          change: "created"
        });
        continue;
      }
      if (previous.modifiedAt !== file.modifiedAt || previous.size !== file.size) {
        changed.push({
          ...file,
          change: "modified"
        });
      }
    }
    for (const [fullPath, previous] of previousMap.entries()) {
      if (!nextSnapshotMap.has(fullPath)) {
        changed.push({
          ...previous,
          change: "removed"
        });
      }
    }
    return {
      changed,
      snapshotMap: nextSnapshotMap
    };
  }

  function isSemanticallySuccessfulToolResult(name = "", result = {}) {
    const normalizedName = normalizeToolName(name);
    if (!result || typeof result !== "object") {
      return true;
    }
    if (normalizedName === "shell_command") {
      return Number(result.code || 0) === 0 && result.timedOut !== true;
    }
    if (normalizedName === "web_fetch") {
      return result.ok !== false && Number(result.status || 200) < 400;
    }
    return true;
  }

  function buildToolSemanticFailureMessage(name = "", result = {}) {
    const normalizedName = normalizeToolName(name);
    if (normalizedName === "shell_command") {
      const exitCode = Number(result?.code || 0);
      const detail = compactTaskText(
        String(result?.stderr || result?.stdout || "").replace(/\s+/g, " ").trim(),
        220
      );
      return `shell_command exited with code ${exitCode}${detail ? `: ${detail}` : ""}`;
    }
    if (normalizedName === "web_fetch") {
      const status = Number(result?.status || 0);
      const detail = compactTaskText(
        String(result?.body || result?.content || "").replace(/\s+/g, " ").trim(),
        220
      );
      return `web_fetch returned HTTP ${status || "error"}${detail ? `: ${detail}` : ""}`;
    }
    return compactTaskText(String(result?.error || "tool returned an unusable result"), 220);
  }

  function incrementToolUsageCounter(counter = {}, name = "") {
    const normalizedName = normalizeToolName(name);
    if (!normalizedName) {
      return counter;
    }
    counter[normalizedName] = Number(counter[normalizedName] || 0) + 1;
    return counter;
  }

  function summarizeToolUsageCounts(counter = {}, limit = 3) {
    return Object.entries(counter || {})
      .map(([name, count]) => ({ name, count: Number(count || 0) }))
      .filter((entry) => entry.name && entry.count > 0)
      .sort((left, right) => {
        if (left.count !== right.count) {
          return right.count - left.count;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, Math.max(1, Number(limit || 3)));
  }

  function createToolLoopDiagnostics() {
    return {
      stepCount: 0,
      transportSuccessCount: 0,
      semanticSuccessCount: 0,
      noSemanticProgressStepCount: 0,
      lowValueStepCount: 0,
      concreteProgressStepCount: 0,
      inspectionOnlyStepCount: 0,
      workspaceChangeCount: 0,
      outputArtifactCount: 0,
      skillDiscoveryCount: 0,
      toolRequestCount: 0,
      repeatedInspectionCount: 0,
      uniqueInspectionTargets: [],
      uniqueConcreteInspectionTargets: [],
      toolUsage: {},
      requestedTools: [],
      requestedSkills: [],
      steps: [],
      stopReason: "",
      summary: ""
    };
  }

  function buildToolLoopStepDiagnostics({
    step = 0,
    transportSuccessCount = 0,
    toolResults = [],
    inspectionTargets = [],
    newInspectionTargets = [],
    newConcreteInspectionTargets = [],
    changedWorkspaceFiles = [],
    changedOutputFiles = []
  } = {}) {
    const normalizedResults = Array.isArray(toolResults) ? toolResults : [];
    const semanticSuccessCount = normalizedResults.filter((entry) => entry?.ok).length;
    const toolNames = normalizedResults.map((entry) => normalizeToolName(entry?.name || "")).filter(Boolean);
    const skillDiscoveryCount = toolNames.filter((name) => ["search_skill_library", "inspect_skill_library", "list_installed_skills"].includes(name)).length;
    const toolRequestCount = toolNames.filter((name) => ["request_skill_installation", "request_tool_addition"].includes(name)).length;
    const concreteChangeCount = (Array.isArray(changedWorkspaceFiles) ? changedWorkspaceFiles.length : 0)
      + (Array.isArray(changedOutputFiles) ? changedOutputFiles.length : 0);
    const inspectionOnly = semanticSuccessCount > 0
      && concreteChangeCount === 0
      && skillDiscoveryCount === 0
      && toolRequestCount === 0
      && toolNames.length > 0
      && toolNames.every((name) => ["list_files", "read_document", "read_file", "shell_command", "web_fetch"].includes(name));
    let progressKind = "none";
    if (concreteChangeCount > 0) {
      progressKind = "concrete";
    } else if (toolRequestCount > 0) {
      progressKind = "capability_request";
    } else if (skillDiscoveryCount > 0) {
      progressKind = "skill_discovery";
    } else if ((Array.isArray(newConcreteInspectionTargets) ? newConcreteInspectionTargets.length : 0) > 0) {
      progressKind = "concrete_inspection";
    } else if ((Array.isArray(newInspectionTargets) ? newInspectionTargets.length : 0) > 0) {
      progressKind = "exploration";
    } else if (semanticSuccessCount > 0) {
      progressKind = "inspection_repeat";
    }
    const concreteProgress = ["concrete", "capability_request", "skill_discovery", "concrete_inspection"].includes(progressKind);
    return {
      step: Number(step || 0),
      progressKind,
      concreteProgress,
      inspectionOnly,
      transportSuccessCount: Math.max(0, Number(transportSuccessCount || 0)),
      semanticSuccessCount,
      toolNames,
      inspectionTargets: (Array.isArray(inspectionTargets) ? inspectionTargets : []).slice(0, 4),
      newInspectionTargets: (Array.isArray(newInspectionTargets) ? newInspectionTargets : []).slice(0, 4),
      newConcreteInspectionTargets: (Array.isArray(newConcreteInspectionTargets) ? newConcreteInspectionTargets : []).slice(0, 4),
      changedWorkspaceFiles: (Array.isArray(changedWorkspaceFiles) ? changedWorkspaceFiles : []).slice(0, 4).map((file) => file.path || file.fullPath || ""),
      changedOutputFiles: (Array.isArray(changedOutputFiles) ? changedOutputFiles : []).slice(0, 4).map((file) => file.path || file.fullPath || ""),
      skillDiscoveryCount,
      toolRequestCount
    };
  }

  function recordToolLoopStepDiagnostics(diagnostics, stepDiagnostics) {
    const state = diagnostics && typeof diagnostics === "object" ? diagnostics : createToolLoopDiagnostics();
    const stepEntry = stepDiagnostics && typeof stepDiagnostics === "object" ? stepDiagnostics : {};
    state.stepCount += 1;
    state.transportSuccessCount += Number(stepEntry.transportSuccessCount || 0);
    state.semanticSuccessCount += Number(stepEntry.semanticSuccessCount || 0);
    if (Number(stepEntry.semanticSuccessCount || 0) === 0) {
      state.noSemanticProgressStepCount += 1;
    }
    if (stepEntry.concreteProgress) {
      state.concreteProgressStepCount += 1;
    } else {
      state.lowValueStepCount += 1;
    }
    if (stepEntry.inspectionOnly) {
      state.inspectionOnlyStepCount += 1;
    }
    state.workspaceChangeCount += (Array.isArray(stepEntry.changedWorkspaceFiles) ? stepEntry.changedWorkspaceFiles.length : 0);
    state.outputArtifactCount += (Array.isArray(stepEntry.changedOutputFiles) ? stepEntry.changedOutputFiles.length : 0);
    state.skillDiscoveryCount += Number(stepEntry.skillDiscoveryCount || 0);
    state.toolRequestCount += Number(stepEntry.toolRequestCount || 0);
    const repeatedInspectionCount = Math.max(
      0,
      (Array.isArray(stepEntry.inspectionTargets) ? stepEntry.inspectionTargets.length : 0)
        - (Array.isArray(stepEntry.newInspectionTargets) ? stepEntry.newInspectionTargets.length : 0)
    );
    state.repeatedInspectionCount += repeatedInspectionCount;
    for (const name of Array.isArray(stepEntry.toolNames) ? stepEntry.toolNames : []) {
      incrementToolUsageCounter(state.toolUsage, name);
    }
    for (const target of Array.isArray(stepEntry.newInspectionTargets) ? stepEntry.newInspectionTargets : []) {
      if (target && !state.uniqueInspectionTargets.includes(target)) {
        state.uniqueInspectionTargets.push(target);
      }
    }
    for (const target of Array.isArray(stepEntry.newConcreteInspectionTargets) ? stepEntry.newConcreteInspectionTargets : []) {
      if (target && !state.uniqueConcreteInspectionTargets.includes(target)) {
        state.uniqueConcreteInspectionTargets.push(target);
      }
    }
    state.steps.push(stepEntry);
    if (state.steps.length > 8) {
      state.steps.splice(0, state.steps.length - 8);
    }
    return state;
  }

  function buildToolLoopSummaryText(diagnostics = {}, {
    includeTopTools = true,
    includeOutcome = true
  } = {}) {
    const transportSuccessCount = Number(diagnostics.transportSuccessCount || 0);
    const semanticSuccessCount = Number(diagnostics.semanticSuccessCount || 0);
    const inspectionOnlyStepCount = Number(diagnostics.inspectionOnlyStepCount || 0);
    const workspaceChangeCount = Number(diagnostics.workspaceChangeCount || 0);
    const outputArtifactCount = Number(diagnostics.outputArtifactCount || 0);
    const toolRequestCount = Number(diagnostics.toolRequestCount || 0);
    const uniqueConcreteInspectionTargets = Number((diagnostics.uniqueConcreteInspectionTargets || []).length || 0);
    const parts = [
      `${transportSuccessCount} transport-ok tool call${transportSuccessCount === 1 ? "" : "s"}`,
      `${semanticSuccessCount} semantically successful`,
      `${inspectionOnlyStepCount} inspection-only step${inspectionOnlyStepCount === 1 ? "" : "s"}`,
      `${workspaceChangeCount} workspace write${workspaceChangeCount === 1 ? "" : "s"}`,
      `${outputArtifactCount} artifact output${outputArtifactCount === 1 ? "" : "s"}`,
      `${toolRequestCount} capability request${toolRequestCount === 1 ? "" : "s"}`
    ];
    if (includeOutcome) {
      parts.push(`${uniqueConcreteInspectionTargets} new concrete inspection target${uniqueConcreteInspectionTargets === 1 ? "" : "s"}`);
    }
    let summary = parts.join(", ");
    const topTools = includeTopTools ? summarizeToolUsageCounts(diagnostics.toolUsage, 3) : [];
    if (topTools.length) {
      summary += `. Top tools: ${topTools.map((entry) => `${entry.name} x${entry.count}`).join(", ")}`;
    }
    return summary;
  }

  function buildToolLoopStopMessage(reason = "", diagnostics = {}) {
    const normalizedReason = compactTaskText(String(reason || "").trim(), 220) || "worker stopped without converging";
    const summary = buildToolLoopSummaryText(diagnostics, { includeTopTools: true, includeOutcome: true });
    return `${normalizedReason}: ${summary}. Loop stopped because the worker never converged to an edit, artifact, capability request, or valid no-change conclusion.`;
  }

  return {
    buildFileSnapshotMap,
    buildToolLoopStepDiagnostics,
    buildToolLoopStopMessage,
    buildToolLoopSummaryText,
    buildToolSemanticFailureMessage,
    createToolLoopDiagnostics,
    diffFileSnapshots,
    isSemanticallySuccessfulToolResult,
    recordToolLoopStepDiagnostics
  };
}
