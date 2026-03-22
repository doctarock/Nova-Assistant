function reportAsyncError(context, message, error) {
  context.broadcast(`[observer] ${message}: ${error.message}`);
}

function scheduleDeferredTask(context, delayMs, message, task) {
  setTimeout(() => {
    Promise.resolve(task()).catch((error) => {
      reportAsyncError(context, message, error);
    });
  }, delayMs);
}

function scheduleRepeatingTask(context, intervalMs, message, task) {
  setInterval(() => {
    Promise.resolve(task()).catch((error) => {
      reportAsyncError(context, message, error);
    });
  }, intervalMs);
}

export async function initializeObserverRuntime(context = {}) {
  await context.loadObserverConfig();
  await context.loadVoicePatternStore();
  await context.loadObserverLanguage();
  await context.loadObserverLexicon();
  await context.loadOpportunityScanState();
  await context.loadMailWatchRulesState();
  await context.loadDocumentRulesState();
  await context.loadMailQuarantineLog();
  await context.migrateLegacyPromptWorkspaceIfNeeded();
  await context.ensurePromptWorkspaceScaffolding();
  await context.ensureInitialDocumentIntelligence();
  await context.backfillRecentMaintenanceMemory();
}

export function startObserverHttpServer(context = {}) {
  const httpServer = context.app.listen(context.port, "127.0.0.1", () => {
    console.log(`Observer UI listening on http://127.0.0.1:${context.port}`);
    console.log("Running local CPU intake + Qwen worker runtime");
    context.scheduleTaskDispatch(1000);

    scheduleDeferredTask(context, 1500, "warmup error", () => context.warmRuntimeBrains());
    scheduleDeferredTask(context, 2000, "sandbox error", () => context.ensureObserverToolContainer());
    scheduleDeferredTask(context, 2300, "calendar job error", () => context.runCalendarDueEvents());
    scheduleDeferredTask(context, 2600, "queue storage maintenance error", () => context.runQueueStorageMaintenance());
    scheduleDeferredTask(context, 2800, "internal periodic close error", () => context.closeCompletedInternalPeriodicTasks());
    scheduleDeferredTask(context, 3000, "retention error", () => context.archiveExpiredCompletedTasks());
    scheduleDeferredTask(context, 4000, "opportunity job error", () => context.ensureOpportunityScanJob());
    scheduleDeferredTask(context, 4500, "mail watch job error", () => context.ensureAllMailWatchJobs());
    scheduleDeferredTask(context, 5000, "question maintenance job error", () => context.ensureQuestionMaintenanceJob());
    scheduleDeferredTask(context, 5500, "todo reminder error", () => context.maybeEmitTodoReminder());

    scheduleRepeatingTask(context, context.modelWarmIntervalMs, "warmup error", () => context.warmRuntimeBrains());
    scheduleRepeatingTask(
      context,
      5 * 60 * 1000,
      "internal periodic close error",
      () => context.closeCompletedInternalPeriodicTasks()
    );
    scheduleRepeatingTask(
      context,
      context.taskRetentionSweepMs,
      "retention error",
      () => context.archiveExpiredCompletedTasks()
    );
    scheduleRepeatingTask(
      context,
      context.taskRetentionSweepMs,
      "queue storage maintenance error",
      () => context.runQueueStorageMaintenance()
    );
    scheduleRepeatingTask(
      context,
      15 * 60 * 1000,
      "opportunity job error",
      () => context.ensureOpportunityScanJob()
    );
    scheduleRepeatingTask(
      context,
      15 * 60 * 1000,
      "mail watch job error",
      () => context.ensureAllMailWatchJobs()
    );
    scheduleRepeatingTask(
      context,
      15 * 60 * 1000,
      "question maintenance job error",
      () => context.ensureQuestionMaintenanceJob()
    );
    scheduleRepeatingTask(
      context,
      context.todoReminderCheckIntervalMs,
      "todo reminder error",
      () => context.maybeEmitTodoReminder()
    );
    scheduleRepeatingTask(context, 15000, "calendar job error", () => context.runCalendarDueEvents());

    setInterval(() => {
      context.tickObserverCronQueue();
    }, 15000);

    const observerConfig = context.getObserverConfig();
    if (observerConfig.mail.enabled) {
      scheduleDeferredTask(context, 2500, "mail startup poll error", () => (
        context.pollActiveMailbox({ emitEvents: false })
          .then(() => context.reconcileMailWatchWaitingQuestions())
      ));
      scheduleRepeatingTask(
        context,
        Math.max(5000, Number(observerConfig.mail.pollIntervalMs || 30000)),
        "mail poll error",
        () => (
          context.pollActiveMailbox({ emitEvents: true })
            .then(() => context.reconcileMailWatchWaitingQuestions())
        )
      );
    }
  });

  httpServer.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      console.error(`Observer UI could not start because http://127.0.0.1:${context.port} is already in use.`);
      setImmediate(() => process.exit(1));
      return;
    }
    console.error(error && error.stack ? error.stack : String(error));
    setImmediate(() => process.exit(1));
  });

  context.broadcast("[observer] local runtime log stream ready");
  return httpServer;
}
