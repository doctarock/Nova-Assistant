export function createObserverFailureDomain(options = {}) {
  const {
    appendDailyOperationalMemory = async () => {},
    compactTaskText = (value = "") => String(value || ""),
    failureTelemetryLogPath = "",
    fs = null,
    getProjectNoChangeMinimumTargets = () => 3,
    getProjectsRuntime = () => null,
    looksLikePlaceholderTaskMessage = () => false,
    pathModule = null,
    queueMaintenanceLogPath = ""
  } = options;

  function classifyFailureText(text = "") {
    const lower = String(text || "").toLowerCase();
    if (/\bfetch failed\b/.test(lower)) return "tool_fetch_failed";
    if (/\btimeout\b|\btimed out\b/.test(lower)) return "timeout";
    if (/\binvalid json\b|\bjson parse\b|\bmalformed json\b/.test(lower)) return "invalid_json";
    if (/\btool plan repeated\b|\brepeated tool plan\b/.test(lower)) return "repeated_tool_plan";
    if (/\blow-value tool loop\b|\btool loop\b|\busing tools without concrete progress\b/.test(lower)) return "low_value_tool_loop";
    if (/\bno inspection\b|\bwithout any concrete inspection\b/.test(lower)) return "no_inspection";
    if (/\bspeculative\b|\bfuture-tense\b/.test(lower)) return "speculative_completion";
    if (/\bno concrete outcome\b/.test(lower)) return "no_concrete_outcome";
    if (/\bno-change conclusion before inspecting enough\b/.test(lower)) return "no_change_insufficient_inspection";
    if (/\bno-change conclusion without naming the inspected targets\b|\bno change was possible without naming the inspected targets\b/.test(lower)) return "no_change_missing_targets";
    if (/\bno-change conclusion\b/.test(lower) && /\bobjective explicitly required a concrete improvement\b/.test(lower)) return "project_no_change_disallowed";
    if (/\bproject-cycle finalization\b/.test(lower) && /\bno concrete project file change was recorded\b/.test(lower)) return "project_missing_concrete_change";
    if (/\bproject-cycle finalization\b/.test(lower) && /\bproject-todo\.md was not updated\b/.test(lower)) return "project_missing_todo_update";
    if (/\bproject-cycle finalization\b/.test(lower) && /\bdocumentation-only changes\b/.test(lower)) return "project_documentation_only_mismatch";
    if (/\binvalid envelope\b|\bechoed tool results\b/.test(lower)) return "invalid_envelope";
    if (/\bempty final response\b/.test(lower)) return "empty_final_response";
    if (/\bstalled\b/.test(lower)) return "stalled";
    return "unknown";
  }

  function extractProjectCycleObjectiveText(task = {}) {
    const message = String(task?.message || "").trim();
    return getProjectsRuntime()?.extractTaskDirectiveValue?.(message, "Objective:")
      || getProjectsRuntime()?.extractTaskDirectiveValue?.(message, "Goal:")
      || message;
  }

  function isProjectCyclePlanningObjective(task = {}) {
    return /\b(plan|roadmap|approach|design|architecture)\b/i.test(extractProjectCycleObjectiveText(task));
  }

  function isCapabilityMismatchFailure(classification = "", task = {}) {
    const normalized = String(classification || "").trim().toLowerCase();
    if (["no_inspection", "no_concrete_outcome", "speculative_completion", "repeated_tool_plan", "low_value_tool_loop"].includes(normalized)) {
      if (normalized === "low_value_tool_loop") {
        const diagnostics = task?.toolLoopDiagnostics && typeof task.toolLoopDiagnostics === "object" ? task.toolLoopDiagnostics : null;
        const hadConcreteProgress = diagnostics && (Number(diagnostics.concreteProgressStepCount || 0) > 0 || (Array.isArray(diagnostics.uniqueConcreteInspectionTargets) && diagnostics.uniqueConcreteInspectionTargets.length > 0));
        if (hadConcreteProgress) {
          const objectiveText = extractProjectCycleObjectiveText(task);
          const objectiveRequiresConcreteImprovementFn = getProjectsRuntime()?.objectiveRequiresConcreteImprovement;
          if (typeof objectiveRequiresConcreteImprovementFn === "function" && !objectiveRequiresConcreteImprovementFn(objectiveText)) {
            return false;
          }
        }
      }
      return true;
    }
    const summary = [
      String(task?.resultSummary || "").trim(),
      String(task?.reviewSummary || "").trim(),
      String(task?.workerSummary || "").trim(),
      String(task?.notes || "").trim()
    ].join(" ").toLowerCase();
    return /\b(could not inspect|tool unavailable|missing capability|lacked capability|unsupported tool)\b/.test(summary);
  }

  function isTransportFailoverFailure(classification = "", task = {}) {
    const normalized = String(classification || "").trim().toLowerCase();
    if (normalized === "tool_fetch_failed") {
      return true;
    }
    if (normalized !== "timeout") {
      return false;
    }
    const summary = [
      String(task?.resultSummary || "").trim(),
      String(task?.reviewSummary || "").trim(),
      String(task?.workerSummary || "").trim(),
      String(task?.notes || "").trim()
    ].join(" ").toLowerCase();
    return (
      summary.includes("headers timeout")
      || summary.includes("fetch failed")
      || summary.includes("failed to reach ollama api")
      || summary.includes("transport failure")
      || summary.includes("ollama api")
    );
  }

  function buildCapabilityMismatchRetryMessage(task = {}, failureClassification = "") {
    const baseMessage = String(task?.message || "").trim();
    if (!baseMessage) {
      return "";
    }
    const minConcreteTargets = getProjectNoChangeMinimumTargets();
    const projectPath = String(task?.projectPath || "").trim();
    const primaryTarget = String(task?.projectWorkPrimaryTarget || "").trim();
    const secondaryTarget = String(task?.projectWorkSecondaryTarget || "").trim();
    const tertiaryTarget = String(task?.projectWorkTertiaryTarget || "").trim();
    const expectedFirstMove = String(task?.projectWorkExpectedFirstMove || "").trim()
      || getProjectsRuntime()?.extractTaskDirectiveValue?.(baseMessage, "Expected first move:");
    const inspectFirst = getProjectsRuntime()?.extractTaskDirectiveValue?.(baseMessage, "Inspect first:")
      || (projectPath && primaryTarget ? `${projectPath}/${primaryTarget}` : "");
    const inspectSecond = getProjectsRuntime()?.extractTaskDirectiveValue?.(baseMessage, "Inspect second if needed:")
      || (projectPath && secondaryTarget ? `${projectPath}/${secondaryTarget}` : "");
    const inspectThird = getProjectsRuntime()?.extractTaskDirectiveValue?.(baseMessage, "Inspect third if needed:")
      || (projectPath && tertiaryTarget ? `${projectPath}/${tertiaryTarget}` : "");
    const retryLines = [];
    const normalizedFailure = String(failureClassification || "").trim().toLowerCase();

    if (normalizedFailure === "no_inspection") {
      retryLines.push("Retry note: the previous worker finished without any concrete inspection.");
      if (expectedFirstMove) {
        retryLines.push(`Start with this exact first move: ${expectedFirstMove}`);
      } else if (inspectFirst) {
        retryLines.push(`Start by inspecting this concrete target: ${inspectFirst}`);
      }
      retryLines.push("Do not return final=true before at least one successful inspection tool call.");
    } else if (normalizedFailure === "speculative_completion") {
      retryLines.push("Retry note: the previous worker stopped with speculative or future-tense language instead of completed work.");
      retryLines.push("Keep working with tools until you have a concrete change, artifact, or the exact no-change conclusion with inspected paths.");
    } else if (normalizedFailure === "no_concrete_outcome") {
      retryLines.push("Retry note: the previous worker finished without a concrete change, output artifact, or valid no-change conclusion.");
      retryLines.push("Either make one safe concrete improvement now or use the exact phrase 'no change is possible' with the inspected paths.");
    } else if (normalizedFailure === "no_change_insufficient_inspection") {
      retryLines.push("Retry note: the previous worker used a no-change conclusion before inspecting enough concrete implementation targets.");
      retryLines.push(`Inspect at least ${minConcreteTargets} distinct concrete implementation files or directories before using that conclusion again.`);
    } else if (normalizedFailure === "no_change_missing_targets") {
      retryLines.push("Retry note: the previous worker used a no-change conclusion without naming the inspected targets.");
      retryLines.push("Name the exact inspected files or directories in the conclusion.");
    } else if (normalizedFailure === "repeated_tool_plan") {
      retryLines.push("Retry note: the previous worker repeated the same tool plan without advancing the work.");
      if (inspectFirst) {
        retryLines.push(`Narrow this retry to ${inspectFirst} and continue from that concrete target instead of replaying the startup bundle.`);
        retryLines.push("Do not repeat the same inspection step twice. After the required read, make one concrete change or use the exact phrase 'no change is possible' with the inspected paths.");
        if (inspectSecond) {
          retryLines.push(`Only inspect ${inspectSecond} if the primary target truly requires it to complete the work.`);
        } else if (inspectThird) {
          retryLines.push(`Only inspect ${inspectThird} if the primary target truly requires it to complete the work.`);
        }
      } else if (inspectSecond) {
        retryLines.push(`Move to this next concrete target instead of replaying the startup bundle: ${inspectSecond}`);
      } else if (inspectThird) {
        retryLines.push(`Move to this next concrete target instead of replaying the startup bundle: ${inspectThird}`);
      } else {
        retryLines.push("Move to one different concrete file, directory, or edit step instead of repeating the same inspection loop.");
      }
    } else if (normalizedFailure === "low_value_tool_loop") {
      retryLines.push("Retry note: the previous worker kept using tools without converging to a concrete change, artifact, capability request, or valid no-change conclusion.");
      retryLines.push("Do not spend another pass on inspection-only steps once you already have enough evidence to act.");
      retryLines.push("If the fix is understood, use edit_file for targeted changes, write_file for new or fully rewritten files, or move_path for renames instead of more read-only inspection.");
      retryLines.push("For read_document, list_files, write_file, and edit_file, include the explicit full path in the path field on every tool call.");
      retryLines.push("Either make one concrete change, search the skill library for the missing capability, record a capability request, or conclude with the exact phrase 'no change is possible' and the inspected paths.");
    } else if (normalizedFailure === "project_no_change_disallowed") {
      retryLines.push("Retry note: the previous worker used a no-change conclusion even though this objective required a concrete improvement.");
      if (inspectFirst) {
        retryLines.push(`Continue from ${inspectFirst} and complete one concrete improvement before finishing.`);
      }
      retryLines.push("Do not use the no-change conclusion for this pass unless the objective itself is rewritten to a planning-only review.");
    } else if (normalizedFailure === "project_missing_concrete_change") {
      retryLines.push("Retry note: the previous worker tried to finish a project-cycle pass without a machine-verifiable project change.");
      if (inspectFirst) {
        retryLines.push(`Continue from ${inspectFirst} and complete one concrete project change before finishing.`);
      }
      retryLines.push("If this is a planning or export-readiness pass, update the project tracking docs directly and summarize that completed documentation change explicitly.");
    } else if (normalizedFailure === "project_missing_todo_update") {
      retryLines.push("Retry note: the previous worker made progress but did not update PROJECT-TODO.md before finishing.");
      if (projectPath) {
        retryLines.push(`Update ${projectPath}/PROJECT-TODO.md to check off the completed objective or rewrite it to reflect the remaining work.`);
        retryLines.push(`Keep ${projectPath}/PROJECT-ROLE-TASKS.md aligned with the confirmed next tasks for this pass.`);
      }
      retryLines.push("Finish only after the project tracking files reflect the completed work.");
    } else if (normalizedFailure === "project_documentation_only_mismatch") {
      retryLines.push("Retry note: the previous worker changed only documentation or planning files for an objective that required implementation work.");
      if (inspectFirst) {
        retryLines.push(`Return to ${inspectFirst} or another concrete implementation target and make one implementation change that matches the objective.`);
      }
      retryLines.push("Documentation updates can accompany the pass, but they cannot be the only completed change for this objective.");
    } else if (normalizedFailure === "invalid_envelope") {
      retryLines.push("Retry note: the previous worker echoed tool results instead of returning an assistant decision.");
      retryLines.push("Return either assistant tool_calls for more work or final=true with final_text. Do not output role=tool or tool_results as the top-level response.");
    } else if (normalizedFailure === "empty_final_response") {
      retryLines.push("Retry note: the previous worker ended the task without any usable final_text.");
      retryLines.push("Keep working until you can return a concrete final_text or another assistant tool envelope.");
    } else if (normalizedFailure === "stalled" || normalizedFailure === "timeout") {
      retryLines.push("Retry note: the previous worker stalled before reaching a concrete outcome.");
      if (expectedFirstMove) {
        retryLines.push(`Start with this exact first move: ${expectedFirstMove}`);
      } else if (inspectFirst) {
        retryLines.push(`Start by inspecting this concrete target: ${inspectFirst}`);
      }
      retryLines.push("Narrow the next pass to one concrete move before broadening the scope.");
    }

    if (!retryLines.length) {
      return baseMessage;
    }
    return [baseMessage, "", ...retryLines].join("\n");
  }

  async function appendFailureTelemetryEntry({ task, phase = "execution", summary = "", classification = "" } = {}) {
    const taskId = String(task?.id || "").trim();
    if (!taskId) {
      return;
    }
    const stamp = new Date().toISOString();
    const finalClassification = String(classification || classifyFailureText(summary)).trim() || "unknown";
    const cleanSummary = compactTaskText(String(summary || "").replace(/\s+/g, " ").trim(), 320) || "No summary available.";
    const rawMessage = String(task?.message || "").replace(/\s+/g, " ").trim();
    const rawOriginalMessage = String(task?.originalMessage || "").replace(/\s+/g, " ").trim();
    const displayMessageSource = looksLikePlaceholderTaskMessage(rawMessage) && rawOriginalMessage
      ? rawOriginalMessage
      : rawMessage;
    const message = compactTaskText(displayMessageSource, 220) || "(no task message)";
    const details = [
      `## ${stamp}`,
      `- Task: ${task?.codename || taskId} (${taskId})`,
      `- Phase: ${String(phase || "execution").trim() || "execution"}`,
      `- Classification: ${finalClassification}`,
      `- Brain: ${String(task?.requestedBrainId || "").trim() || "unknown"}`,
      `- Session: ${String(task?.sessionId || "").trim() || "unknown"}`,
      `- Status: ${String(task?.status || "").trim() || "unknown"}`,
      `- Message: ${message}`,
      `- Summary: ${cleanSummary}`
    ];
    if (task?.previousTaskId) {
      details.push(`- Previous task: ${String(task.previousTaskId).trim()}`);
    }
    if (task?.parentTaskId) {
      details.push(`- Parent task: ${String(task.parentTaskId).trim()}`);
    }
    if (task?.toolLoopDiagnostics?.summary) {
      details.push(`- Tool loop: ${String(task.toolLoopDiagnostics.summary).trim()}`);
    }
    await fs.mkdir(pathModule.dirname(failureTelemetryLogPath), { recursive: true });
    await fs.appendFile(failureTelemetryLogPath, `${details.join("\n")}\n\n`, "utf8");
  }

  async function appendQueueMaintenanceReport(title, lines = []) {
    const heading = String(title || "").trim();
    const bodyLines = Array.isArray(lines)
      ? lines.map((line) => String(line || "").trim()).filter(Boolean)
      : [];
    if (!heading && !bodyLines.length) {
      return;
    }
    const stamp = new Date().toISOString();
    const content = [
      `## ${stamp}`,
      heading,
      ...bodyLines.map((line) => `- ${line}`),
      ""
    ].join("\n");
    await fs.mkdir(pathModule.dirname(queueMaintenanceLogPath), { recursive: true });
    await fs.appendFile(queueMaintenanceLogPath, `${content}\n`, "utf8");
    if (bodyLines.length) {
      await appendDailyOperationalMemory(heading, bodyLines);
    }
  }

  return {
    appendFailureTelemetryEntry,
    appendQueueMaintenanceReport,
    buildCapabilityMismatchRetryMessage,
    classifyFailureText,
    extractProjectCycleObjectiveText,
    isCapabilityMismatchFailure,
    isProjectCyclePlanningObjective,
    isTransportFailoverFailure
  };
}
