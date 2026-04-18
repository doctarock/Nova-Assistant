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
  const deferHeavyInitialization = context?.deferHeavyInitialization === true;
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
  if (deferHeavyInitialization) {
    return;
  }
  await runDeferredObserverRuntimeInitialization(context);
}

export async function runDeferredObserverRuntimeInitialization(context = {}) {
  await context.ensureInitialDocumentIntelligence();
  await context.backfillRecentMaintenanceMemory();
}

export function startObserverHttpServer(context = {}) {
  const httpServer = context.app.listen(context.port, "127.0.0.1", () => {
    console.log(`[observer] UI listening on http://127.0.0.1:${context.port}`);
    console.log("[observer] running local intake + worker runtime");
    context.scheduleTaskDispatch(1000);

    scheduleDeferredTask(context, 1500, "warmup error", () => context.warmRuntimeBrains());
    scheduleDeferredTask(context, 2000, "sandbox error", () => context.ensureObserverToolContainer());
    if (typeof context.runDeferredRuntimeInitialization === "function") {
      scheduleDeferredTask(context, 2100, "deferred runtime initialization error", () => context.runDeferredRuntimeInitialization());
    }
    scheduleDeferredTask(context, 2300, "plugin runtime startup hook error", () =>
      context.runPluginRuntimeHook("runtime:startup", { source: "server_start" })
    );
    scheduleDeferredTask(context, 2600, "queue storage maintenance error", () => context.runQueueStorageMaintenance());
    scheduleDeferredTask(context, 2800, "internal periodic close error", () => context.closeCompletedInternalPeriodicTasks());
    scheduleDeferredTask(context, 3000, "retention error", () => context.archiveExpiredCompletedTasks());
    scheduleDeferredTask(context, 5000, "question maintenance job error", () => context.ensureQuestionMaintenanceJob());
    scheduleDeferredTask(context, 6000, "recreation job error", () => context.ensureRecreationJob());

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
      "question maintenance job error",
      () => context.ensureQuestionMaintenanceJob()
    );
    scheduleRepeatingTask(
      context,
      15 * 60 * 1000,
      "recreation job error",
      () => context.ensureRecreationJob()
    );
    scheduleRepeatingTask(context, 5 * 60 * 1000, "plugin runtime 5m hook error", () =>
      context.runPluginRuntimeHook("runtime:tick:5m")
    );

    setInterval(() => {
      context.tickObserverCronQueue();
    }, 15000);

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

  // --- Graceful shutdown ---
  const DRAIN_TIMEOUT_MS = 30_000;
  const DRAIN_POLL_MS = 1_000;
  let shuttingDown = false;

  async function gracefulShutdown(signal) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[observer] received ${signal}, starting graceful shutdown`);

    // Close all SSE streams so clients reconnect after restart
    for (const client of (context.clients || new Set())) {
      try { client.end(); } catch {}
    }
    for (const client of (context.observerEventClients || new Set())) {
      try { client.end(); } catch {}
    }

    // Stop accepting new HTTP connections
    httpServer.close(() => {
      console.log("[observer] HTTP server closed to new requests");
    });

    // Wait for in-progress tasks to drain
    let inProgressCount = 0;
    try {
      const tasks = await context.listAllTasks();
      inProgressCount = Array.isArray(tasks?.inProgress) ? tasks.inProgress.length : 0;
    } catch {}

    if (inProgressCount > 0) {
      console.log(`[observer] waiting for ${inProgressCount} in-progress task(s) to drain (max ${DRAIN_TIMEOUT_MS / 1000}s)`);
      const drainStart = Date.now();
      while (Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
        try {
          const tasks = await context.listAllTasks();
          inProgressCount = Array.isArray(tasks?.inProgress) ? tasks.inProgress.length : 0;
        } catch {
          inProgressCount = 0;
        }
        if (inProgressCount === 0) {
          break;
        }
      }
    }

    if (inProgressCount > 0) {
      console.warn(`[observer] shutdown timeout — ${inProgressCount} task(s) still in progress, forcing exit`);
    } else {
      console.log("[observer] all tasks drained, exiting cleanly");
    }
    process.exit(0);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM").catch(() => process.exit(1)));
  process.on("SIGINT",  () => gracefulShutdown("SIGINT").catch(() => process.exit(1)));

  return httpServer;
}
