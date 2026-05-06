function getTaskDisplayTimestamp(task = {}) {
  return Number(task?.updatedAt || task?.completedAt || task?.startedAt || task?.createdAt || 0);
}

function sortTasksByDisplayTime(tasks = []) {
  return [...tasks].sort((left, right) => getTaskDisplayTimestamp(right) - getTaskDisplayTimestamp(left));
}

function isEscalationReviewTask(task = {}) {
  return String(task?.internalJobType || "").trim().toLowerCase() === "escalation_review";
}

function isRepairFollowUpTask(task = {}) {
  if (isEscalationReviewTask(task)) {
    return false;
  }
  return Boolean(String(task?.previousTaskId || "").trim())
    || Boolean(String(task?.escalationParentTaskId || "").trim())
    || Boolean(String(task?.reshapeSourcePhase || "").trim())
    || Math.max(0, Number(task?.reshapeAttemptCount || 0)) > 0;
}

function buildRepairMonitor(tasks = {}) {
  const queued = Array.isArray(tasks?.queued) ? tasks.queued : [];
  const inProgress = Array.isArray(tasks?.inProgress) ? tasks.inProgress : [];
  const done = Array.isArray(tasks?.done) ? tasks.done : [];
  const failed = Array.isArray(tasks?.failed) ? tasks.failed : [];

  const activeFollowUps = sortTasksByDisplayTime([...queued, ...inProgress].filter(isRepairFollowUpTask));
  const reviewJobs = sortTasksByDisplayTime([...queued, ...inProgress, ...done, ...failed].filter(isEscalationReviewTask));
  const recentOutcomes = sortTasksByDisplayTime([...done, ...failed].filter(isRepairFollowUpTask));

  return {
    active: activeFollowUps.slice(0, 12),
    reviews: reviewJobs.slice(0, 12),
    recent: recentOutcomes.slice(0, 12),
    summary: {
      activeFollowUpCount: activeFollowUps.length,
      activeReviewCount: [...queued, ...inProgress].filter(isEscalationReviewTask).length,
      reviewCount: reviewJobs.length,
      recentOutcomeCount: recentOutcomes.length,
      totalVisible: activeFollowUps.length + reviewJobs.length + recentOutcomes.length
    }
  };
}

function buildTaskQueuePresentation(tasks = {}) {
  const queued = Array.isArray(tasks?.queued) ? tasks.queued : [];
  const inProgress = Array.isArray(tasks?.inProgress) ? tasks.inProgress : [];
  const done = Array.isArray(tasks?.done) ? tasks.done : [];
  const failed = Array.isArray(tasks?.failed) ? tasks.failed : [];

  return {
    ...tasks,
    queued: queued.filter((task) => !isEscalationReviewTask(task)),
    inProgress: inProgress.filter((task) => !isEscalationReviewTask(task)),
    done: done.filter((task) => !isEscalationReviewTask(task)),
    failed: failed.filter((task) => !isEscalationReviewTask(task)),
    repairMonitor: buildRepairMonitor(tasks)
  };
}

export function registerQueueEngineRoutes(context = {}) {
  const app = context.app;

  app.get("/api/tasks/list", async (req, res) => {
    try {
      const tasks = await context.listAllTasks();
      res.json({ ok: true, root: context.taskQueueRoot, ...buildTaskQueuePresentation(tasks) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/tasks/events", async (req, res) => {
    try {
      const sinceTs = Number(req.query.sinceTs || 0);
      const limit = Number(req.query.limit || 20);
      const tasks = await context.listTaskEvents({ sinceTs, limit });
      res.json({ ok: true, tasks });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/tasks/history", async (req, res) => {
    try {
      const taskId = String(req.query.taskId || "").trim();
      const limit = Number(req.query.limit || 40);
      if (!taskId) {
        return res.status(400).json({ ok: false, error: "taskId is required" });
      }
      const [task, history] = await Promise.all([
        context.findTaskById(taskId),
        context.readTaskHistory(taskId, { limit })
      ]);
      res.json({
        ok: true,
        taskId,
        task,
        history
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/tasks/transactions", async (req, res) => {
    try {
      const taskId = String(req.query.taskId || "").trim();
      if (!taskId) {
        return res.status(400).json({ ok: false, error: "taskId is required" });
      }
      const transactions = typeof context.listTransactionsForTask === "function"
        ? await context.listTransactionsForTask(taskId)
        : [];
      res.json({ ok: true, taskId, transactions });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/tasks/debug-packet", async (req, res) => {
    try {
      const taskId = String(req.query.taskId || "").trim();
      const limit = Number(req.query.limit || 80);
      if (!taskId) {
        return res.status(400).json({ ok: false, error: "taskId is required" });
      }
      if (typeof context.buildTaskDebugPacket !== "function") {
        return res.status(501).json({ ok: false, error: "task debug packet is unavailable" });
      }
      const packet = await context.buildTaskDebugPacket(taskId, { limit });
      res.json(packet);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/tasks/provider-history/validate", async (req, res) => {
    try {
      const taskId = String(req.query.taskId || "").trim();
      const limit = Number(req.query.limit || 200);
      if (!taskId) {
        return res.status(400).json({ ok: false, error: "taskId is required" });
      }
      if (typeof context.validateProviderHistory !== "function") {
        return res.status(501).json({ ok: false, error: "provider history validation is unavailable" });
      }
      const result = await context.validateProviderHistory(taskId, { limit });
      res.status(result.ok ? 200 : 422).json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/tasks/transactions/:transactionId/rollback", async (req, res) => {
    try {
      const transactionId = String(req.params.transactionId || "").trim();
      if (!transactionId) {
        return res.status(400).json({ ok: false, error: "transactionId is required" });
      }
      if (typeof context.rollbackTransaction !== "function") {
        return res.status(501).json({ ok: false, error: "transaction rollback is unavailable" });
      }
      const transaction = await context.rollbackTransaction(transactionId, {
        force: req.body?.force === true
      });
      res.json({ ok: true, transaction });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/tasks/transactions/:transactionId/approve", async (req, res) => {
    try {
      const transactionId = String(req.params.transactionId || "").trim();
      if (!transactionId) {
        return res.status(400).json({ ok: false, error: "transactionId is required" });
      }
      if (typeof context.approveTransaction !== "function") {
        return res.status(501).json({ ok: false, error: "transaction approval is unavailable" });
      }
      const approved = await context.approveTransaction(transactionId, {
        actor: String(req.body?.actor || "user").trim(),
        notes: String(req.body?.notes || "").trim()
      });
      const SANDBOX_OPS = ["write_file", "edit_file", "move_path"];
      if (!SANDBOX_OPS.includes(String(approved.operation || ""))) {
        return res.json({ ok: true, transaction: approved });
      }
      if (typeof context.applyApprovedTransaction !== "function") {
        return res.status(501).json({ ok: false, error: "transaction apply is unavailable" });
      }
      const result = await context.applyApprovedTransaction(transactionId);
      res.json({ ok: true, transaction: result.transaction });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/tasks/transactions/:transactionId/reject", async (req, res) => {
    try {
      const transactionId = String(req.params.transactionId || "").trim();
      if (!transactionId) {
        return res.status(400).json({ ok: false, error: "transactionId is required" });
      }
      if (typeof context.rejectTransaction !== "function") {
        return res.status(501).json({ ok: false, error: "transaction rejection is unavailable" });
      }
      const transaction = await context.rejectTransaction(transactionId, {
        actor: String(req.body?.actor || "user").trim(),
        notes: String(req.body?.notes || req.body?.reason || "").trim(),
        reason: String(req.body?.reason || "").trim()
      });
      res.json({ ok: true, transaction });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/tasks/reshape-issues", async (req, res) => {
    try {
      const limit = Number(req.query.limit || 12);
      const payload = await context.listTaskReshapeIssues({ limit });
      res.json({ ok: true, ...payload });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/tasks/reshape-issues/reset", async (req, res) => {
    try {
      const result = await context.resetTaskReshapeIssueState();
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  const ENQUEUE_MAX_MESSAGE_LENGTH = 8000;
  const ENQUEUE_MAX_ATTACHMENTS = 20;
  const ENQUEUE_MAX_PLANNED_TASKS = 50;

  app.post("/api/tasks/enqueue", async (req, res) => {
    const originalMessage = context.normalizeUserRequest(req.body?.message);
    const sessionId = String(req.body?.sessionId || "Main").trim();
    const requestedBrainId = String(req.body?.requestedBrainId || "worker");
    const intakeBrainId = String(req.body?.intakeBrainId || "bitnet").trim();
    const internetEnabled = req.body?.internetEnabled == null
      ? context.getObserverConfig().defaults.internetEnabled
      : Boolean(req.body?.internetEnabled);
    const selectedMountIds = Array.isArray(context.getObserverConfig().defaults.mountIds)
      ? context.getObserverConfig().defaults.mountIds.map((value) => String(value))
      : [];
    const forceToolUse = Boolean(req.body?.forceToolUse);
    const requireWorkerPreflight = Boolean(req.body?.requireWorkerPreflight);
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    let plannedTasks = Array.isArray(req.body?.plannedTasks) ? req.body.plannedTasks : [];
    const intakeReviewed = req.body?.intakeReviewed === true;
    const lockRequestedBrain = req.body?.lockRequestedBrain === true;
    const sourceIdentity = context.normalizeSourceIdentityRecord(req.body?.sourceIdentity);
    let message = originalMessage;

    if (!message) {
      return res.status(400).json({ ok: false, error: "message is required" });
    }
    if (message.length > ENQUEUE_MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ ok: false, error: `message must not exceed ${ENQUEUE_MAX_MESSAGE_LENGTH} characters` });
    }
    if (attachments.length > ENQUEUE_MAX_ATTACHMENTS) {
      return res.status(400).json({ ok: false, error: `attachments must not exceed ${ENQUEUE_MAX_ATTACHMENTS} items` });
    }
    if (plannedTasks.length > ENQUEUE_MAX_PLANNED_TASKS) {
      return res.status(400).json({ ok: false, error: `plannedTasks must not exceed ${ENQUEUE_MAX_PLANNED_TASKS} items` });
    }
    context.noteInteractiveActivity();

    try {
      if (!intakeReviewed && typeof context.runIntakeWithOptionalRewrite === "function") {
        const intakeResult = await context.runIntakeWithOptionalRewrite({
          message,
          sessionId,
          internetEnabled,
          selectedMountIds,
          forceToolUse,
          sourceIdentity
        });
        message = String(intakeResult?.effectiveMessage || message).trim() || message;
        if (intakeResult?.nativeResponse) {
          return res.status(409).json({
            ok: false,
            code: "intake_resolved",
            error: "request resolved during intake review and should not be enqueued directly",
            triage: {
              mode: "observer-native",
              action: "reply_only",
              effectiveMessage: message,
              nativeResponse: intakeResult.nativeResponse,
              rewrite: intakeResult.rewrite || null
            }
          });
        }
        const intakePlan = intakeResult?.intakePlan;
        if (intakePlan?.action && intakePlan.action !== "enqueue") {
          return res.status(409).json({
            ok: false,
            code: "intake_not_enqueue",
            error: "request did not remain queue-bound after intake review",
            triage: {
              mode: intakePlan.action,
              action: intakePlan.action,
              replyText: intakePlan.replyText || "",
              intakeReason: intakePlan.reason || "",
              effectiveMessage: message,
              rewrite: intakeResult.rewrite || null
            }
          });
        }
        if (!plannedTasks.length && Array.isArray(intakePlan?.tasks) && intakePlan.tasks.length) {
          plannedTasks = intakePlan.tasks;
        }
      }
      const requestedBrain = await context.getBrain(requestedBrainId);
      if (!requestedBrain.toolCapable || requestedBrain.kind !== "worker") {
        return res.status(400).json({ ok: false, error: `brain "${requestedBrain.id}" cannot process queued tool tasks` });
      }
      const helperAnalysis = req.body?.helperAnalysis && typeof req.body.helperAnalysis === "object"
        ? req.body.helperAnalysis
        : await context.getHelperAnalysisForRequest({ message, sessionId, waitMs: 900 });
      const taskRequests = plannedTasks.length
        ? plannedTasks.map((entry) => ({
            message: String(entry?.message || "").trim(),
            every: entry?.every ? String(entry.every).trim() : "",
            delay: entry?.delay ? String(entry.delay).trim() : ""
          })).filter((entry) => entry.message)
        : [{ message, every: "", delay: "" }];

      const createdTasks = [];
      for (const taskRequest of taskRequests) {
        const existingTask = await context.findRecentDuplicateQueuedTask({
          message: taskRequest.message,
          sessionId,
          requestedBrainId,
          intakeBrainId
        });
        if (existingTask) {
          const shouldRefreshExistingTask = (
            (helperAnalysis && !existingTask.helperAnalysis?.summary && !existingTask.helperAnalysis?.intent)
            || Boolean(existingTask.forceToolUse) !== forceToolUse
            || Boolean(existingTask.requireWorkerPreflight) !== requireWorkerPreflight
          );
          if (shouldRefreshExistingTask) {
            const updatedTask = {
              ...existingTask,
              updatedAt: Date.now(),
              helperAnalysis: helperAnalysis || existingTask.helperAnalysis,
              forceToolUse,
              requireWorkerPreflight
            };
            await context.writeTask(updatedTask);
            createdTasks.push({
              ...updatedTask,
              filePath: context.taskPathForStatus(updatedTask.id, updatedTask.status),
              workspacePath: context.workspaceTaskPath(updatedTask.status, updatedTask.id)
            });
            continue;
          }
          createdTasks.push(existingTask);
          continue;
        }
        const delayMs = context.parseEveryToMs(taskRequest.delay);
        const everyMs = context.parseEveryToMs(taskRequest.every);
        const task = await context.createQueuedTask({
          message: taskRequest.message,
          sessionId,
          requestedBrainId,
          intakeBrainId,
          internetEnabled,
          selectedMountIds,
          forceToolUse,
          requireWorkerPreflight,
          attachments,
          helperAnalysis,
          notes: taskRequest.every
            ? "Observer queued periodic scheduler task."
            : "Observer queued task for deferred processing.",
          taskMeta: {
            ...(sourceIdentity ? { sourceIdentity } : {}),
            ...(lockRequestedBrain ? { lockRequestedBrain: true } : {}),
            ...(delayMs ? { notBeforeAt: Date.now() + delayMs } : {}),
            ...(everyMs ? {
              scheduler: {
                periodic: true,
                name: taskRequest.message.slice(0, 80),
                seriesId: `sched-${Date.now()}-${createdTasks.length + 1}`,
                every: taskRequest.every,
                everyMs
              },
              notBeforeAt: Date.now() + everyMs
            } : {})
          }
        });
        createdTasks.push(task);
      }
      await context.appendDailyQuestionLog({
        message,
        sessionId,
        route: `queued:${requestedBrainId}`,
        taskRefs: createdTasks,
        notes: createdTasks.length > 1
          ? `${createdTasks.length} queued tasks created from this request.`
          : "Queued task created from this request."
      });
      res.json({ ok: true, task: createdTasks[0] || null, tasks: createdTasks, deduped: createdTasks.length === 1 && createdTasks[0]?.id !== undefined && plannedTasks.length === 0 && createdTasks[0]?.message === message });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/tasks/dispatch-next", async (req, res) => {
    const preferredBrainId = String(req.body?.brainId || "").trim();
    try {
      const response = await context.processNextQueuedTask(preferredBrainId);
      res.status(response.ok ? 200 : 500).json(response);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/tasks/remove", async (req, res) => {
    const taskId = String(req.body?.taskId || "").trim();
    if (!taskId) {
      return res.status(400).json({ ok: false, error: "taskId is required" });
    }

    try {
      const task = await context.findTaskById(taskId);
      if (!task) {
        return res.status(404).json({ ok: false, error: "task not found" });
      }
      if (String(task.status || "") === "in_progress") {
        return res.json({
          ok: false,
          error: "cannot remove a task that is currently in progress",
          code: "task_in_progress",
          refreshQueue: true
        });
      }
      await context.removeTaskRecord(task, "Task removed by user.");
      context.broadcastObserverEvent({
        type: "task.removed",
        task: {
          ...task,
          removed: true,
          updatedAt: Date.now()
        }
      });
      res.json({ ok: true, taskId, removed: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/tasks/abort", async (req, res) => {
    const taskId = String(req.body?.taskId || "").trim();
    const reason = String(req.body?.reason || "Aborted by user.").trim();
    const force = req.body?.force === true;
    if (!taskId) {
      return res.status(400).json({ ok: false, error: "taskId is required" });
    }

    try {
      const task = force
        ? await context.forceStopTask(taskId, reason || "Force-cleared by user.")
        : await context.abortActiveTask(taskId, reason);
      res.json({ ok: true, task });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/tasks/dead", async (req, res) => {
    try {
      const tasks = await context.listAllTasks();
      const dead = Array.isArray(tasks?.failed) ? tasks.failed : [];
      res.json({ ok: true, dead, count: dead.length });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/tasks/dead/requeue", async (req, res) => {
    const taskId = String(req.body?.taskId || "").trim();
    const reason = String(req.body?.reason || "Requeued from dead letter queue by user.").trim();
    if (!taskId) {
      return res.status(400).json({ ok: false, error: "taskId is required" });
    }
    try {
      const task = await context.findTaskById(taskId);
      if (!task) {
        return res.status(404).json({ ok: false, error: "task not found" });
      }
      if (String(task.status || "").toLowerCase() !== "failed") {
        return res.status(400).json({
          ok: false,
          error: `task status is "${task.status}", expected "failed"`,
          code: "not_dead"
        });
      }
      const now = Date.now();
      const requeuedTask = await context.persistTaskTransition({
        previousTask: task,
        nextTask: {
          ...task,
          status: "queued",
          updatedAt: now,
          completedAt: null,
          startedAt: null,
          stalledAt: null,
          resultSummary: null,
          reshapeAttemptCount: 0,
          dispatchCount: 0,
          notes: `${reason} (requeued from dead letter at ${new Date(now).toISOString()})`
        },
        eventType: "task.requeued",
        reason
      });
      context.broadcastObserverEvent({ type: "task.requeued", task: requeuedTask });
      res.json({ ok: true, task: requeuedTask });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/tasks/answer", async (req, res) => {
    const taskId = String(req.body?.taskId || "").trim();
    const answer = String(req.body?.answer || "").trim();
    const sessionId = String(req.body?.sessionId || "Main").trim();
    if (!taskId) {
      return res.status(400).json({ ok: false, error: "taskId is required" });
    }
    if (!answer) {
      return res.status(400).json({ ok: false, error: "answer is required" });
    }

    try {
      const task = await context.answerWaitingTask(taskId, answer, sessionId);
      res.json({ ok: true, task });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

}
