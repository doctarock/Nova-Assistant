import { compressShellOutput } from "./output-semantic-compression.js";

// Replace fenced code blocks / raw output sections over the threshold with a compressed summary.
// This reduces noise when task messages contain embedded sample output or paste dumps.
const INLINE_COMPRESS_THRESHOLD = 600;

function compressInlineBlocks(text = "") {
  return String(text || "").replace(
    /```[\w]*\n([\s\S]*?)```/g,
    (match, inner) => {
      if (inner.length < INLINE_COMPRESS_THRESHOLD) return match;
      const compressed = compressShellOutput(inner, "inline-block");
      const density = compressed.informationDensity ?? "?";
      const findings = (compressed.keyLines || []).slice(0, 3).join("; ");
      return `[compressed block: ${inner.length} chars → density ${density}%${findings ? ` | ${findings}` : ""}]`;
    }
  );
}

export function createObserverQueuedTaskPrompting(context = {}) {
  const {
    buildProjectQueuedTaskExecutionPrompt = null,
    OBSERVER_CONTAINER_OUTPUT_ROOT,
    extractTaskDirectiveValue,
    inferTaskCapabilityProfile,
    isProjectCycleMessage = () => false,
    isProjectCycleTask = () => false,
    inferTaskSpecialty,
    summarizeTaskCapabilities,
    runPluginHook = async (_, payload) => payload
  } = context;

  async function buildQueuedTaskExecutionPrompt(taskPrompt = "", task = {}) {
    const basePrompt = compressInlineBlocks(String(taskPrompt || "").trim());
    if (!basePrompt) {
      return "";
    }
    const internalJobType = String(task?.internalJobType || "").trim();
    const capabilitySummary = summarizeTaskCapabilities(
      inferTaskCapabilityProfile({
        message: basePrompt,
        taskSpecialty: inferTaskSpecialty(task),
        forceToolUse: Boolean(task?.forceToolUse || task?.internalJobType === "project_cycle"),
        preset: "queued-task",
        internalJobType
      })
    );
    const capabilityNote = capabilitySummary
      ? ` Predicted capability focus: ${capabilitySummary}.`
      : "";
    const isExplicitProjectCycle = isProjectCycleTask(task)
      || (!internalJobType && isProjectCycleMessage(basePrompt));
    if (isExplicitProjectCycle && typeof buildProjectQueuedTaskExecutionPrompt === "function") {
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
    const baseResult = `${basePrompt}\n\nThis work item came from the shared task queue.${capabilityNote} If you complete meaningful work, summarize it clearly and write any user-facing artifacts into ${OBSERVER_CONTAINER_OUTPUT_ROOT}.`;

    // Allow plugins to append enrichment lines to the task execution prompt
    // (e.g. sprint phase context, autoplan hints specific to this task type)
    const enrichResult = await runPluginHook("queue:task-enrich", {
      suffix: [],
      taskId: String(task?.id || "").trim(),
      taskPrompt: basePrompt,
      internalJobType,
      brainId: String(task?.requestedBrainId || "").trim()
    }).catch(() => ({ suffix: [] }));
    const suffix = Array.isArray(enrichResult?.suffix) ? enrichResult.suffix.filter(Boolean) : [];
    return suffix.length ? `${baseResult}\n${suffix.join("\n")}` : baseResult;
  }

  return {
    buildQueuedTaskExecutionPrompt,
    isProjectCycleMessage,
    isProjectCycleTask
  };
}
