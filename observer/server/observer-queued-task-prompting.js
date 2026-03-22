export function createObserverQueuedTaskPrompting(context = {}) {
  const {
    OBSERVER_CONTAINER_OUTPUT_ROOT,
    extractTaskDirectiveValue,
    inferTaskCapabilityProfile,
    inferTaskSpecialty,
    summarizeTaskCapabilities
  } = context;

  function isProjectCycleTask(task = {}) {
    return (
      String(task?.sessionId || "").trim() === "project-cycle"
      || String(task?.internalJobType || "").trim() === "project_cycle"
    );
  }

  function isProjectCycleMessage(message = "") {
    const text = String(message || "").trim().toLowerCase();
    return (
      /^advance the project\b/.test(text)
      || /\bthis is a focused project work package\b/.test(text)
      || /\/project-todo\.md\b/.test(text)
    );
  }

  function buildQueuedTaskExecutionPrompt(taskPrompt = "", task = {}) {
    const basePrompt = String(taskPrompt || "").trim();
    if (!basePrompt) {
      return "";
    }
    const capabilitySummary = summarizeTaskCapabilities(
      inferTaskCapabilityProfile({
        message: basePrompt,
        taskSpecialty: inferTaskSpecialty(task),
        forceToolUse: Boolean(task?.forceToolUse || task?.internalJobType === "project_cycle"),
        preset: "queued-task"
      })
    );
    const capabilityNote = capabilitySummary
      ? ` Predicted capability focus: ${capabilitySummary}.`
      : "";
    if (isProjectCycleTask(task) || isProjectCycleMessage(basePrompt)) {
      const expectedFirstMove = extractTaskDirectiveValue(basePrompt, "Expected first move:");
      const firstMoveNote = expectedFirstMove
        ? " Honor the named first move before falling back to generic planning-file rereads or broad repo listings."
        : "";
      return `${basePrompt}\n\nThis work item came from the shared task queue.${capabilityNote} Keep project changes inside the workspace while the project is still in progress. Do not write project deliverables to ${OBSERVER_CONTAINER_OUTPUT_ROOT} unless the whole project is complete and ready for export.${firstMoveNote} After the initial inspection, prefer edit_file for targeted project changes, write_file for new or fully rewritten project files, and move_path for renames instead of repeating read-only tool passes once the concrete edit is clear. Summarize the concrete workspace changes clearly.`;
    }
    return `${basePrompt}\n\nThis work item came from the shared task queue.${capabilityNote} If you complete meaningful work, summarize it clearly and write any user-facing artifacts into ${OBSERVER_CONTAINER_OUTPUT_ROOT}.`;
  }

  return {
    buildQueuedTaskExecutionPrompt,
    isProjectCycleMessage,
    isProjectCycleTask
  };
}
