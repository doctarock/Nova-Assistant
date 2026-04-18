const ENDPOINT_HEALTH_TTL_MS = 45_000;
let endpointHealthCache = { results: [], cachedAt: 0, brainSignature: "" };

function buildBrainPayload(brain, context) {
  return {
    id: brain.id,
    label: brain.label,
    kind: brain.kind,
    model: brain.model,
    endpointId: brain.endpointId || "local",
    endpointLabel: brain.endpointLabel || "Local Ollama",
    baseUrl: brain.ollamaBaseUrl || context.localOllamaBaseUrl,
    remote: brain.remote === true,
    queueLane: brain.queueLane || context.getBrainQueueLane(brain),
    specialty: brain.specialty || "",
    toolCapable: brain.toolCapable,
    cronCapable: brain.cronCapable,
    description: brain.description
  };
}

export function registerRuntimeRoutes(context = {}) {
  const app = context.app;

  app.get("/events/logs", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    context.clients.add(res);
    res.write(`data: ${JSON.stringify({ ts: Date.now(), line: "[observer] connected" })}\n\n`);

    req.on("close", () => {
      context.clients.delete(res);
    });
  });

  app.get("/events/observer", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    context.observerEventClients.add(res);
    res.write(`data: ${JSON.stringify({ ts: Date.now(), type: "observer.connected" })}\n\n`);

    req.on("close", () => {
      context.observerEventClients.delete(res);
    });
  });

  app.get("/api/runtime/status", async (req, res) => {
    try {
      const brains = await context.listAvailableBrains();
      const [ollama, gpu, brainActivity, qdrant] = await Promise.all([
        context.inspectContainer(context.ollamaContainer),
        context.queryGpuStatus(),
        context.buildBrainActivitySnapshot(),
        context.getQdrantStatus ? context.getQdrantStatus() : Promise.resolve(null)
      ]);
      const uniqueEndpointBrains = [...new Map(brains.map((brain) => [brain.ollamaBaseUrl, brain])).values()];
      const brainSignature = uniqueEndpointBrains.map((b) => b.ollamaBaseUrl).sort().join("|");
      const cacheAge = Date.now() - endpointHealthCache.cachedAt;
      let endpointChecks;
      if (cacheAge < ENDPOINT_HEALTH_TTL_MS && endpointHealthCache.brainSignature === brainSignature && endpointHealthCache.results.length) {
        endpointChecks = endpointHealthCache.results;
      } else {
        endpointChecks = await Promise.all(
          uniqueEndpointBrains.map(async (brain) => ({
            brainIds: brains.filter((entry) => entry.ollamaBaseUrl === brain.ollamaBaseUrl).map((entry) => entry.id),
            ...(await context.inspectOllamaEndpoint(brain.ollamaBaseUrl))
          }))
        );
        endpointHealthCache = { results: endpointChecks, cachedAt: Date.now(), brainSignature };
      }
      const intakeBrain = brains.find((brain) => brain.id === "bitnet") || brains[0];
      const workerBrain = brains.find((brain) => brain.id === "worker")
        || brains.find((brain) => brain.kind === "worker")
        || brains[0];

      res.json({
        ok: ollama.running,
        gateway: {
          name: "local-runtime",
          exists: true,
          running: true,
          status: "running"
        },
        intake: {
          label: intakeBrain?.label || "Intake",
          model: intakeBrain?.model || "",
          endpointId: intakeBrain?.endpointId || "local",
          baseUrl: intakeBrain?.ollamaBaseUrl || context.localOllamaBaseUrl,
          running: true
        },
        worker: {
          label: workerBrain?.label || "Worker",
          model: workerBrain?.model || "",
          endpointId: workerBrain?.endpointId || "local",
          baseUrl: workerBrain?.ollamaBaseUrl || context.localOllamaBaseUrl,
          running: endpointChecks.some(
            (entry) => entry.baseUrl === (workerBrain?.ollamaBaseUrl || context.localOllamaBaseUrl) && entry.running
          )
        },
        ollama,
        qdrant,
        ollamaEndpoints: endpointChecks,
        brains,
        brainActivity,
        gpu,
        checkedAt: Date.now()
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/runtime/options", async (req, res) => {
    const observerConfig = context.getObserverConfig();
    const brains = await context.listAvailableBrains();
    res.json({
      ok: true,
      app: {
        ...observerConfig.app,
        trust: context.getAppTrustConfig()
      },
      language: context.getObserverLanguage(),
      lexicon: context.getObserverLexicon(),
      defaults: observerConfig.defaults,
      queue: context.getQueueConfig(),
      projects: context.getProjectConfig(),
      routing: context.getRoutingConfig(),
      networks: observerConfig.networks,
      mail: await context.buildMailStatus(),
      brains: brains.map((brain) => buildBrainPayload(brain, context)),
      brainEndpoints: Object.values(context.getConfiguredBrainEndpoints()),
      mounts: observerConfig.mounts.map((mount) => ({
        id: mount.id,
        label: mount.label,
        containerPath: mount.containerPath,
        mode: mount.mode || "ro",
        description: mount.description || ""
      }))
    });
  });

  app.post("/api/queue/control", async (req, res) => {
    try {
      const payload = req.body && typeof req.body === "object" ? req.body : {};
      const paused = payload.paused === true;
      context.setObserverConfig({
        ...context.getObserverConfig(),
        queue: {
          ...context.getQueueConfig(),
          paused
        }
      });
      await context.saveObserverConfig();
      context.broadcast(`[observer] queue dispatch ${paused ? "paused" : "resumed"}.`);
      if (!paused) {
        context.scheduleTaskDispatch(50);
      }
      res.json({
        ok: true,
        queue: context.getQueueConfig(),
        message: paused
          ? "Queue paused. Queued tasks will remain queued until resumed."
          : "Queue resumed."
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}
