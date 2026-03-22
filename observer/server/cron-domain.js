export function registerCronRoutes(context = {}) {
  const app = context.app;

  app.get("/api/cron/list", async (req, res) => {
    try {
      const projectConfig = context.getProjectConfig();
      const { queued, inProgress, done, failed } = await context.listAllTasks();
      const mailWatchRulesState = context.getMailWatchRulesState();
      const knownPeriodicDefinitions = [
        {
          id: "internal-opportunity-scan",
          name: "Idle workspace opportunity scan",
          message: "Idle workspace opportunity scan",
          everyMs: projectConfig.opportunityScanIntervalMs
        },
        {
          id: "internal-question-maintenance",
          name: "Prompt memory question maintenance",
          message: "Prompt memory question maintenance: ask one focused question, fill out USER.md, MEMORY.md, and PERSONAL.md when answers exist, and deepen those documents when core sections are already filled.",
          everyMs: context.questionMaintenanceIntervalMs
        },
        ...((Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [])
          .filter((rule) => rule && rule.enabled !== false && rule.id)
          .map((rule) => ({
            id: `mail-watch:${rule.id}`,
            name: `Mail watch: ${context.compactTaskText(String(rule.instruction || rule.id || "").trim(), 60)}`,
            message: `Mail watch: ${String(rule.instruction || "").trim()}`,
            everyMs: Number(rule.everyMs || 0) || 10 * 60 * 1000
          })))
      ];
      const queueBackedJobs = [...queued, ...inProgress, ...done, ...failed]
        .filter((task) => task.scheduler?.periodic)
        .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
        .map((task) => ({
          id: task.scheduler.seriesId,
          name: task.scheduler.name,
          message: task.message,
          source: "observer",
          queueBacked: true,
          enabled: task.scheduler.disabled !== true,
          agentId: "worker",
          schedule: {
            kind: "every",
            everyMs: task.scheduler.everyMs,
            anchorMs: Number(task.notBeforeAt || task.createdAt || 0)
          },
          state: {
            nextRunAtMs: Number(task.notBeforeAt || 0),
            runningAtMs: task.status === "in_progress" ? Number(task.startedAt || 0) : null
          },
          status: task.status
        }));
      const jobsById = new Map(queueBackedJobs.map((job) => [String(job.id || "").trim(), job]));
      for (const definition of knownPeriodicDefinitions) {
        const id = String(definition.id || "").trim();
        if (!id || jobsById.has(id)) {
          continue;
        }
        jobsById.set(id, {
          id,
          name: definition.name,
          message: definition.message,
          source: "observer",
          queueBacked: true,
          enabled: true,
          agentId: "worker",
          schedule: {
            kind: "every",
            everyMs: Number(definition.everyMs || 0),
            anchorMs: 0
          },
          state: {
            nextRunAtMs: 0,
            runningAtMs: null
          },
          status: "idle"
        });
      }
      const jobs = [...jobsById.values()]
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      res.json({ ok: true, jobs });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/cron/events", async (req, res) => {
    try {
      const sinceTs = Number(req.query.sinceTs || 0);
      const limit = Number(req.query.limit || 10);
      const events = await context.listCronRunEvents({ sinceTs, limit });
      res.json({ ok: true, events });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/cron/add", async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const every = String(req.body?.every || "").trim();
    const message = String(req.body?.message || "").trim();
    const brain = await context.getBrain("worker");

    if (!name || !every || !message) {
      return res.status(400).json({ ok: false, error: "name, every, and message are required" });
    }
    if (!brain.cronCapable || brain.kind !== "worker") {
      return res.status(400).json({ ok: false, error: `brain "${brain.id}" cannot be used for scheduled jobs` });
    }

    try {
      const everyMs = context.parseEveryToMs(every);
      if (!everyMs) {
        return res.status(400).json({ ok: false, error: "every must look like 5m, 2h, or 1d" });
      }
      const now = Date.now();
      const seriesId = `sched-${now}`;
      const task = await context.createQueuedTask({
        message,
        sessionId: "scheduler",
        requestedBrainId: "worker",
        intakeBrainId: "bitnet",
        internetEnabled: true,
        selectedMountIds: context.getObserverConfig().defaults.mountIds,
        forceToolUse: true,
        notes: `Queued periodic scheduler task "${name}".`,
        taskMeta: {
          scheduler: {
            periodic: true,
            name,
            seriesId,
            every,
            everyMs
          },
          notBeforeAt: now + everyMs
        }
      });

      res.json({
        ok: true,
        brain,
        job: {
          id: seriesId,
          name,
          message,
          every,
          everyMs,
          source: "observer",
          queueBacked: true,
          taskId: task.id,
          nextRunAtMs: Number(task.notBeforeAt || 0)
        },
        staggered: {
          applied: false,
          minGapMs: context.getCronMinGapMs("worker", everyMs),
          nextRunAtMs: Number(task.notBeforeAt || 0)
        }
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/cron/toggle", async (req, res) => {
    const seriesId = String(req.body?.seriesId || "").trim();
    if (!seriesId) {
      return res.status(400).json({ ok: false, error: "seriesId is required" });
    }
    try {
      const { queued, inProgress } = await context.listAllTasks();
      const tasks = [...queued, ...inProgress].filter(
        (task) => task.scheduler?.periodic && task.scheduler?.seriesId === seriesId
      );
      if (!tasks.length) {
        return res.status(404).json({ ok: false, error: "no tasks found for this scheduled job" });
      }
      const currentlyDisabled = tasks.some((task) => task.scheduler?.disabled === true);
      const nextDisabled = !currentlyDisabled;
      for (const task of tasks) {
        task.scheduler = {
          ...task.scheduler,
          disabled: nextDisabled
        };
        task.updatedAt = Date.now();
        await context.writeTask(task);
      }
      context.broadcast(
        `[observer] scheduled job "${tasks[0].scheduler.name || seriesId}" ${nextDisabled ? "disabled" : "enabled"}.`
      );
      res.json({
        ok: true,
        seriesId,
        enabled: !nextDisabled,
        message: `Scheduled job ${nextDisabled ? "disabled" : "enabled"}.`
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/cron/remove", async (req, res) => {
    const seriesId = String(req.body?.seriesId || "").trim();
    if (!seriesId) {
      return res.status(400).json({ ok: false, error: "seriesId is required" });
    }
    try {
      const { queued, inProgress, done, failed } = await context.listAllTasks();
      const tasks = [...queued, ...done, ...failed].filter(
        (task) => task.scheduler?.periodic && task.scheduler?.seriesId === seriesId
      );
      const inProgressTasks = inProgress.filter(
        (task) => task.scheduler?.periodic && task.scheduler?.seriesId === seriesId
      );
      if (!tasks.length && !inProgressTasks.length) {
        return res.status(404).json({ ok: false, error: "no tasks found for this scheduled job" });
      }
      if (inProgressTasks.length) {
        return res.json({
          ok: false,
          error: "cannot remove a scheduled job that is currently running",
          code: "job_in_progress"
        });
      }
      let removedCount = 0;
      for (const task of tasks) {
        await context.removeTaskRecord(task, "Scheduled job removed by user.");
        removedCount += 1;
      }
      context.broadcast(
        `[observer] scheduled job "${tasks[0]?.scheduler?.name || seriesId}" removed (${removedCount} task${removedCount === 1 ? "" : "s"}).`
      );
      res.json({
        ok: true,
        seriesId,
        removedCount,
        message: `Scheduled job removed (${removedCount} task${removedCount === 1 ? "" : "s"}).`
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}
