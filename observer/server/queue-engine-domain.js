export function registerQueueEngineRoutes(context = {}) {
  const app = context.app;

  app.get("/api/tasks/list", async (req, res) => {
    try {
      const tasks = await context.listAllTasks();
      res.json({ ok: true, root: context.taskQueueRoot, ...tasks });
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
