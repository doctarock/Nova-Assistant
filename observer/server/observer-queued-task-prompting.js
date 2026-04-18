export function createObserverQueuedTaskPrompting(context = {}) {
  const {
    buildProjectQueuedTaskExecutionPrompt = null,
    OBSERVER_CONTAINER_OUTPUT_ROOT,
    extractTaskDirectiveValue,
    inferTaskCapabilityProfile,
    isProjectCycleMessage = () => false,
    isProjectCycleTask = () => false,
    inferTaskSpecialty,
    summarizeTaskCapabilities
  } = context;

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
    if ((isProjectCycleTask(task) || isProjectCycleMessage(basePrompt)) && typeof buildProjectQueuedTaskExecutionPrompt === "function") {
      const projectPrompt = buildProjectQueuedTaskExecutionPrompt({
        capabilitySummary,
        expectedFirstMove: extractTaskDirectiveValue(basePrompt, "Expected first move:"),
        observerContainerOutputRoot: OBSERVER_CONTAINER_OUTPUT_ROOT,
        task,
        taskPrompt: basePrompt
      });
      if (String(projectPrompt || "").trim()) {
        return projectPrompt;
      }
    }
    return `${basePrompt}\n\nThis work item came from the shared task queue.${capabilityNote} If you complete meaningful work, summarize it clearly and write any user-facing artifacts into ${OBSERVER_CONTAINER_OUTPUT_ROOT}.`;
  }

  return {
    buildQueuedTaskExecutionPrompt,
    isProjectCycleMessage,
    isProjectCycleTask
  };
}
