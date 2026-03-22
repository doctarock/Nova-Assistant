export function createObserverEscalationReview(context = {}) {
  const {
    MAX_TASK_RESHAPE_ATTEMPTS,
    MODEL_KEEPALIVE,
    buildConcreteReviewReason,
    buildEscalationCloseRecommendation,
    buildEscalationSplitProjectWorkKey,
    buildProjectCycleFollowUpMessage,
    buildRetryTaskMeta,
    canReshapeTask,
    chooseEscalationRetryBrainId,
    choosePlannerRepairBrain,
    compactTaskText,
    createQueuedTask,
    extractJsonObject,
    findTaskById,
    getBrain,
    getRoutingConfig,
    getTaskReshapeAttemptCount,
    listAvailableBrains,
    markTaskCriticalFailure,
    recordTaskReshapeReview,
    runOllamaJsonGenerate
  } = context;
async function executeEscalationReviewJob(task) {
  const routing = getRoutingConfig();
  const plannerBrain = await choosePlannerRepairBrain(
    [
      String(task.requestedBrainId || "").trim(),
      String(routing.remoteTriageBrainId || "").trim(),
      "helper"
    ].filter(Boolean),
    { preferRemote: true }
  ) || await getBrain("bitnet");
  const sourceTaskId = String(task.escalationSourceTaskId || task.previousTaskId || "").trim();
  const sourceTask = sourceTaskId ? await findTaskById(sourceTaskId) : null;
  const anchorTask = sourceTask || task;
  const attemptedBrains = Array.isArray(task.specialistAttemptedBrainIds)
    ? task.specialistAttemptedBrainIds.map((value) => String(value)).filter(Boolean)
    : [];
  const availableWorkers = (await listAvailableBrains())
    .filter((brain) => brain.kind === "worker" && brain.toolCapable)
    .map((brain) => brain.id);
  const escalationPrompt = [
    "You are Nova's escalation planner.",
    "Return JSON only.",
    "Decide what to do after all direct worker attempts failed.",
    "Use exactly this schema:",
    "{\"action\":\"retry|split|clarify|close\",\"reason\":\"...\",\"requestedBrainId\":\"...\",\"message\":\"...\",\"subTasks\":[\"...\"]}",
    `Original queued message: ${String(task.message || "").trim()}`,
    `Escalation notes: ${String(task.notes || "").trim()}`,
    `Source task id: ${sourceTaskId || "none"}`,
    `Source task summary: ${compactTaskText(String(sourceTask?.resultSummary || sourceTask?.reviewSummary || sourceTask?.workerSummary || ""), 300) || "none"}`,
    `Failure classification: ${String(task.failureClassification || sourceTask?.failureClassification || "").trim() || "unknown"}`,
    `Capability mismatch suspected: ${task.capabilityMismatchSuspected === true || sourceTask?.capabilityMismatchSuspected === true ? "yes" : "no"}`,
    `Brains already attempted: ${attemptedBrains.length ? attemptedBrains.join(", ") : "none"}`,
    `Available worker brains: ${availableWorkers.join(", ") || "none"}`,
    "Prefer retry only if you can materially improve the brief or pick an untried worker.",
    "If capability mismatch is suspected, prefer an untried worker that is a better execution fit over repeating the same route.",
    "Use split when the task is too broad and should become smaller concrete jobs.",
    "Use clarify when the user must answer something before progress is possible.",
    "Use close when no safe next step exists."
  ].join("\n");

  let decision = null;
  try {
    const result = await runOllamaJsonGenerate(plannerBrain.model, escalationPrompt, {
      timeoutMs: 20000,
      keepAlive: MODEL_KEEPALIVE,
      baseUrl: plannerBrain.ollamaBaseUrl
    });
    if (result.ok) {
      decision = extractJsonObject(result.text);
    }
  } catch {
    decision = null;
  }

  const action = String(decision?.action || "").trim().toLowerCase();
  const requestedBrainId = String(decision?.requestedBrainId || "").trim();
  const reason = compactTaskText(
    String(decision?.reason || "").trim(),
    220
  ) || buildConcreteReviewReason({
    task,
    sourceTask,
    attemptedBrains,
    classification: String(task.failureClassification || sourceTask?.failureClassification || "").trim(),
    fallback: "Escalation planner reviewed the failed worker chain."
  });
  const retryMessage = compactTaskText(String(decision?.message || "").trim(), 500);
  const subTasks = Array.isArray(decision?.subTasks)
    ? decision.subTasks.map((value) => compactTaskText(String(value || "").trim(), 280)).filter(Boolean).slice(0, 3)
    : [];
  const nextBrainId = chooseEscalationRetryBrainId({
    requestedBrainId,
    availableWorkers,
    attemptedBrains
  });
  const reshapeLimitReached = !canReshapeTask(anchorTask);
  const criticalLimitReason = `Critical failure after ${getTaskReshapeAttemptCount(anchorTask)}/${MAX_TASK_RESHAPE_ATTEMPTS} reshaped resubmission attempts. Escalation review will not queue another retry.`;

  if (action === "split" && subTasks.length) {
    if (reshapeLimitReached) {
      await recordTaskReshapeReview({
        task,
        sourceTask: anchorTask,
        phase: "escalation_review",
        action: "critical_close",
        reason: criticalLimitReason,
        improvement: reason,
        classification: String(anchorTask?.failureClassification || "").trim(),
        willResubmit: false,
        critical: true
      });
      if (sourceTask) {
        await markTaskCriticalFailure(sourceTask, criticalLimitReason);
      }
      return {
        ok: true,
        code: 0,
        brain: plannerBrain,
        parsed: {
          final: true,
          final_text: criticalLimitReason
        },
        stdout: "",
        stderr: "",
        outputFiles: []
      };
    }
    const splitBrainId = nextBrainId;
    if (!splitBrainId) {
      await recordTaskReshapeReview({
        task,
        sourceTask: anchorTask,
        phase: "escalation_review",
        action: "close",
        reason,
        classification: String(anchorTask?.failureClassification || "").trim(),
        willResubmit: false
      });
      return {
        ok: true,
        code: 0,
        brain: plannerBrain,
        parsed: {
          final: true,
          final_text: buildEscalationCloseRecommendation(task, sourceTask, `Escalation review could not queue split follow-up tasks because no untried worker remained. ${reason}`)
        },
        stdout: "",
        stderr: "",
        outputFiles: []
      };
    }
    const reshapeRecord = await recordTaskReshapeReview({
      task,
      sourceTask: anchorTask,
      phase: "escalation_review",
      action: "split_resubmit",
      reason,
      improvement: subTasks.join(" | "),
      classification: String(anchorTask?.failureClassification || "").trim(),
      willResubmit: true
    });
    for (const subTask of subTasks) {
      const splitMessage = String(task.internalJobType || "").trim() === "project_cycle"
        ? buildProjectCycleFollowUpMessage(task, { focusOverride: subTask, retryNote: reason })
        : [String(task.message || "").trim(), "", `Focused split objective: ${subTask}`, reason].filter(Boolean).join("\n");
      await createQueuedTask({
        message: splitMessage,
        sessionId: task.sessionId || "task-escalation",
        requestedBrainId: splitBrainId,
        intakeBrainId: task.intakeBrainId || "bitnet",
        internetEnabled: Boolean(task.internetEnabled),
        selectedMountIds: Array.isArray(task.mountIds) ? task.mountIds : [],
        forceToolUse: true,
        attachments: Array.isArray(task.attachments) ? task.attachments : [],
        helperAnalysis: task.helperAnalysis || null,
        notes: `Queued from escalation review of ${task.escalationSourceTaskId || task.previousTaskId || task.id}. ${reason}`.trim(),
        taskMeta: buildRetryTaskMeta(task, {
          escalationParentTaskId: task.id,
          escalationSourceTaskId: sourceTaskId || undefined,
          reshapeIssueKey: String(reshapeRecord?.issueKey || "").trim() || undefined,
          reshapeSourcePhase: "escalation_review",
          projectWorkFocus: String(task.internalJobType || "").trim() === "project_cycle" ? compactTaskText(subTask, 220) : undefined,
          projectWorkKey: String(task.internalJobType || "").trim() === "project_cycle"
            ? buildEscalationSplitProjectWorkKey(task, subTask)
            : undefined
        })
      });
    }
    return {
      ok: true,
      code: 0,
      brain: plannerBrain,
      parsed: {
        final: true,
        final_text: `Escalation review split this into ${subTasks.length} follow-up task${subTasks.length === 1 ? "" : "s"}. ${reason}`
      },
      stdout: "",
      stderr: "",
      outputFiles: []
    };
  }

  if (action === "retry" || (action === "close" && nextBrainId)) {
    if (reshapeLimitReached) {
      await recordTaskReshapeReview({
        task,
        sourceTask: anchorTask,
        phase: "escalation_review",
        action: "critical_close",
        reason: criticalLimitReason,
        improvement: retryMessage || reason,
        classification: String(anchorTask?.failureClassification || "").trim(),
        willResubmit: false,
        critical: true
      });
      if (sourceTask) {
        await markTaskCriticalFailure(sourceTask, criticalLimitReason);
      }
      return {
        ok: true,
        code: 0,
        brain: plannerBrain,
        parsed: {
          final: true,
          final_text: criticalLimitReason
        },
        stdout: "",
        stderr: "",
        outputFiles: []
      };
    }
    if (!nextBrainId) {
      await recordTaskReshapeReview({
        task,
        sourceTask: anchorTask,
        phase: "escalation_review",
        action: "close",
        reason,
        improvement: retryMessage,
        classification: String(anchorTask?.failureClassification || "").trim(),
        willResubmit: false
      });
      return {
        ok: true,
        code: 0,
        brain: plannerBrain,
        parsed: {
          final: true,
          final_text: buildEscalationCloseRecommendation(task, sourceTask, `Escalation review closed this out because no untried worker remained. ${reason}`)
        },
        stdout: "",
        stderr: "",
        outputFiles: []
      };
    }
    const reshapeRecord = await recordTaskReshapeReview({
      task,
      sourceTask: anchorTask,
      phase: "escalation_review",
      action: action === "close" ? "close_override_resubmit" : "retry_resubmit",
      reason,
      improvement: retryMessage || reason,
      classification: String(anchorTask?.failureClassification || "").trim(),
      willResubmit: true
    });
    await createQueuedTask({
      message: String(task.internalJobType || "").trim() === "project_cycle"
        ? buildProjectCycleFollowUpMessage(task, { retryNote: retryMessage || reason })
        : [String(task.message || "").trim(), "", compactTaskText(retryMessage || reason, 320)].filter(Boolean).join("\n"),
      sessionId: task.sessionId || "task-escalation",
      requestedBrainId: nextBrainId,
      intakeBrainId: task.intakeBrainId || "bitnet",
      internetEnabled: Boolean(task.internetEnabled),
      selectedMountIds: Array.isArray(task.mountIds) ? task.mountIds : [],
      forceToolUse: true,
      attachments: Array.isArray(task.attachments) ? task.attachments : [],
      helperAnalysis: task.helperAnalysis || null,
      notes: `Queued from escalation review of ${task.escalationSourceTaskId || task.previousTaskId || task.id}. ${reason}`.trim(),
      taskMeta: buildRetryTaskMeta(task, {
        escalationParentTaskId: task.id,
        escalationSourceTaskId: sourceTaskId || undefined,
        reshapeIssueKey: String(reshapeRecord?.issueKey || "").trim() || undefined,
        reshapeSourcePhase: "escalation_review",
        specialistAttemptedBrainIds: [...new Set(attemptedBrains)],
        escalationDepth: Number(task.escalationDepth || 0) + 1
      })
    });
    return {
      ok: true,
      code: 0,
      brain: plannerBrain,
      parsed: {
        final: true,
        final_text: action === "close"
          ? `Escalation review overrode a close decision and queued a retry on ${nextBrainId}. ${reason}`
          : `Escalation review queued a retry on ${nextBrainId}. ${reason}`
      },
      stdout: "",
      stderr: "",
      outputFiles: []
    };
  }

  if (action === "clarify") {
    await recordTaskReshapeReview({
      task,
      sourceTask: anchorTask,
      phase: "escalation_review",
      action: "clarify",
      reason,
      improvement: retryMessage,
      classification: String(anchorTask?.failureClassification || "").trim(),
      willResubmit: false
    });
    return {
      ok: true,
      code: 0,
      brain: plannerBrain,
      waitingForUser: true,
      questionForUser: compactTaskText(retryMessage || reason, 1000) || "I need more information before I can continue.",
      parsed: {
        final: true,
        final_text: `This task needs clarification before I can continue. ${reason}`
      },
      stdout: "",
      stderr: "",
      outputFiles: []
    };
  }

  await recordTaskReshapeReview({
    task,
    sourceTask: anchorTask,
    phase: "escalation_review",
    action: "close",
    reason,
    improvement: retryMessage,
    classification: String(anchorTask?.failureClassification || "").trim(),
    willResubmit: false
  });

  return {
    ok: true,
    code: 0,
    brain: plannerBrain,
    parsed: {
      final: true,
      final_text: buildEscalationCloseRecommendation(task, sourceTask, `Escalation review closed this out. ${reason}`)
    },
    stdout: "",
    stderr: "",
    outputFiles: []
  };
}
  return {
    executeEscalationReviewJob
  };
}
