export function createPromptReviewService({
  buildIntakeSystemPrompt,
  buildPromptReviewSampleMessage,
  buildWorkerSystemPrompt,
  getBrain,
  getBrainQueueLane,
  listAvailableBrains
} = {}) {
  async function generateReview({
    internetEnabled = true,
    selectedMountIds = []
  } = {}) {
    const normalizedMountIds = Array.isArray(selectedMountIds)
      ? selectedMountIds.map((value) => String(value))
      : [];
    const enabledInternet = internetEnabled !== false;
    const brains = await listAvailableBrains();
    const intakeBrain = await getBrain("bitnet");
    const entries = [
      {
        id: intakeBrain?.id || "intake",
        label: intakeBrain?.label || "Intake",
        kind: intakeBrain?.kind || "intake",
        model: intakeBrain?.model || "",
        scenario: "Direct reply or queue decision",
        sampleMessage: "Help me figure out whether this needs a direct answer or a deeper queued pass.",
        prompt: await buildIntakeSystemPrompt({
          internetEnabled: enabledInternet,
          selectedMountIds: normalizedMountIds,
          forceToolUse: true,
          sessionId: "Main"
        })
      }
    ];
    const workerBrains = brains
      .filter((brain) => brain.kind === "worker" && brain.toolCapable)
      .sort((left, right) => String(left.label || left.id).localeCompare(String(right.label || right.id)));
    for (const brain of workerBrains) {
      const sampleMessage = buildPromptReviewSampleMessage(brain);
      entries.push({
        id: brain.id,
        label: brain.label,
        kind: brain.kind,
        model: brain.model,
        specialty: brain.specialty || "general",
        queueLane: brain.queueLane || getBrainQueueLane(brain),
        scenario: "Queued execution sample",
        sampleMessage,
        prompt: await buildWorkerSystemPrompt({
          message: sampleMessage,
          brain,
          internetEnabled: enabledInternet,
          selectedMountIds: normalizedMountIds,
          forceToolUse: true,
          preset: "queued-task",
          runtimeNotesExtra: [
            "Review sample context: this is a prompt review preview, not a live task."
          ]
        })
      });
    }
    return {
      generatedAt: Date.now(),
      entries
    };
  }

  return { generateReview };
}

export function createPluginTaskLifecycleRuntimeService({
  abortActiveTask,
  answerWaitingTask,
  createQueuedTask,
  findTaskById,
  forceStopTask,
  readTaskHistory
} = {}) {
  return {
    findTaskById: async (taskId = "") => await findTaskById(String(taskId || "").trim()),
    readTaskHistory: async (taskId = "", options = {}) => await readTaskHistory(String(taskId || "").trim(), options),
    stopTask: async ({ taskId = "", reason = "Stopped by plugin lifecycle endpoint.", force = false } = {}) => {
      const normalizedTaskId = String(taskId || "").trim();
      const normalizedReason = String(reason || "").trim() || "Stopped by plugin lifecycle endpoint.";
      if (force) {
        return await forceStopTask(normalizedTaskId, normalizedReason);
      }
      return await abortActiveTask(normalizedTaskId, normalizedReason);
    },
    answerTask: async ({ taskId = "", answer = "", sessionId = "Main" } = {}) => {
      return await answerWaitingTask(
        String(taskId || "").trim(),
        String(answer || "").trim(),
        String(sessionId || "Main").trim() || "Main"
      );
    },
    createTask: async (payload = {}) => await createQueuedTask(payload && typeof payload === "object" ? payload : {})
  };
}

export function createPluginObservedTriageTaskRequest({
  compactHookText,
  getPluginManager,
  observerTriageTaskRequest
} = {}) {
  return function triageTaskRequest(...args) {
    const pluginManager = getPluginManager?.();
    const request = args?.[0] && typeof args[0] === "object" ? args[0] : {};
    void pluginManager?.runHook?.("subsystem:intake:triage-started", {
      at: Date.now(),
      intakeBrainId: compactHookText(String(request.intakeBrainId || "").trim(), 64),
      messagePreview: compactHookText(String(request.message || "").trim(), 220),
      internetEnabled: request.internetEnabled !== false,
      forceToolUse: request.forceToolUse === true
    });
    try {
      const triage = observerTriageTaskRequest(...args);
      void pluginManager?.runHook?.("subsystem:intake:triage-completed", {
        at: Date.now(),
        mode: compactHookText(String(triage?.mode || "").trim(), 64),
        brainId: compactHookText(String(triage?.brainId || "").trim(), 64),
        complexity: Number(triage?.complexity || 0) || 0
      });
      return triage;
    } catch (error) {
      void pluginManager?.runHook?.("subsystem:intake:triage-failed", {
        at: Date.now(),
        error: compactHookText(String(error?.message || error || "unknown error"), 220)
      });
      throw error;
    }
  };
}

export function createPluginHookedQueueProcessors({
  getPluginManager,
  getProcessNextQueuedTaskExecutor,
  getProcessQueuedTasksToCapacityExecutor
} = {}) {
  async function processNextQueuedTask(...args) {
    try {
      return await getProcessNextQueuedTaskExecutor()(...args);
    } catch (error) {
      await getPluginManager()?.runHook?.("queue:task-processed", {
        at: Date.now(),
        source: "processNextQueuedTask",
        ok: false,
        error: String(error?.message || error || "unknown error")
      });
      throw error;
    }
  }

  async function processQueuedTasksToCapacity(...args) {
    try {
      return await getProcessQueuedTasksToCapacityExecutor()(...args);
    } catch (error) {
      await getPluginManager()?.runHook?.("queue:batch-processed", {
        at: Date.now(),
        source: "processQueuedTasksToCapacity",
        ok: false,
        tasks: [],
        count: 0,
        error: String(error?.message || error || "unknown error")
      });
      throw error;
    }
  }

  return {
    processNextQueuedTask,
    processQueuedTasksToCapacity
  };
}
