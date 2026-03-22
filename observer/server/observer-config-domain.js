function buildAvailableBrainPayload(brain, context) {
  return {
    id: brain.id,
    label: brain.label,
    kind: brain.kind,
    model: brain.model,
    endpointId: brain.endpointId || "local",
    queueLane: brain.queueLane || context.getBrainQueueLane(brain),
    specialty: brain.specialty || "",
    description: brain.description || ""
  };
}

export function registerObserverConfigRoutes(context = {}) {
  const app = context.app;

  app.get("/api/app/config", async (req, res) => {
    const observerConfig = context.getObserverConfig();
    const assets = await context.listPublicAssetChoices();
    res.json({
      ok: true,
      app: {
        botName: String(observerConfig?.app?.botName || "Agent").trim() || "Agent",
        avatarModelPath: String(observerConfig?.app?.avatarModelPath || "/assets/characters/Nova.glb").trim() || "/assets/characters/Nova.glb",
        backgroundImagePath: String(observerConfig?.app?.backgroundImagePath || "").trim(),
        stylizationFilterPreset: context.normalizeStylizationFilterPreset(
          observerConfig?.app?.stylizationFilterPreset ?? observerConfig?.app?.stylizationPreset,
          "none"
        ),
        stylizationEffectPreset: context.normalizeStylizationEffectPreset(
          observerConfig?.app?.stylizationEffectPreset ?? observerConfig?.app?.stylizationPreset,
          "none"
        ),
        reactionPathsByModel: {
          ...context.defaultAppReactionPathsByModel(),
          ...context.normalizeReactionPathsByModel(observerConfig?.app?.reactionPathsByModel)
        },
        roomTextures: {
          ...context.defaultAppRoomTextures(),
          ...(observerConfig?.app?.roomTextures && typeof observerConfig.app.roomTextures === "object"
            ? observerConfig.app.roomTextures
            : {})
        },
        propSlots: {
          ...context.defaultAppPropSlots(),
          ...(observerConfig?.app?.propSlots && typeof observerConfig.app.propSlots === "object"
            ? observerConfig.app.propSlots
            : {})
        },
        voicePreferences: Array.isArray(observerConfig?.app?.voicePreferences)
          ? observerConfig.app.voicePreferences.map((value) => String(value)).filter(Boolean)
          : [],
        trust: context.getAppTrustConfig()
      },
      assets
    });
  });

  app.post("/api/app/config", async (req, res) => {
    try {
      const payload = req.body && typeof req.body === "object" ? req.body : {};
      const nextApp = payload?.app && typeof payload.app === "object" ? payload.app : {};
      const observerConfig = context.getObserverConfig();
      const assets = await context.listPublicAssetChoices();
      const modelChoices = new Set(assets.models);
      const backgroundChoices = new Set(assets.backgrounds);
      const requestedModelPath = String(nextApp.avatarModelPath || "/assets/characters/Nova.glb").trim();
      const requestedBackgroundPath = String(nextApp.backgroundImagePath || "").trim();
      const roomTextures = nextApp?.roomTextures && typeof nextApp.roomTextures === "object" ? nextApp.roomTextures : {};
      const propSlots = nextApp?.propSlots && typeof nextApp.propSlots === "object" ? nextApp.propSlots : {};
      const textureChoices = new Set(Array.isArray(assets.textures) ? assets.textures : []);
      const propChoices = new Set(Array.isArray(assets.props) ? assets.props : []);
      const reactionPathsByModel = context.normalizeReactionPathsByModel(nextApp?.reactionPathsByModel, assets.models);
      const nextTrustInput = nextApp.trust && typeof nextApp.trust === "object"
        ? {
            ...context.getAppTrustConfig(),
            ...nextApp.trust,
            records: Array.isArray(nextApp.trust.records)
              ? nextApp.trust.records
              : context.getAppTrustConfig().records,
            voiceProfiles: Array.isArray(nextApp.trust.voiceProfiles)
              ? nextApp.trust.voiceProfiles
              : context.getAppTrustConfig().voiceProfiles
          }
        : context.getAppTrustConfig();
      const nextTrust = context.normalizeAppTrustConfig(nextTrustInput);

      context.setVoicePatternStore({
        profiles: Array.isArray(nextTrust.voiceProfiles)
          ? nextTrust.voiceProfiles
            .map((entry, index) => context.normalizeVoiceTrustProfile(entry, index))
            .filter((entry) => entry.label || entry.signature.length)
          : []
      });
      context.setObserverConfig({
        ...observerConfig,
        app: {
          ...observerConfig.app,
          botName: String(nextApp.botName || "Agent").trim() || "Agent",
          avatarModelPath: modelChoices.has(requestedModelPath)
            ? requestedModelPath
            : (assets.models[0] || "/assets/characters/Nova.glb"),
          backgroundImagePath: requestedBackgroundPath && backgroundChoices.has(requestedBackgroundPath)
            ? requestedBackgroundPath
            : "",
          stylizationFilterPreset: context.normalizeStylizationFilterPreset(
            nextApp.stylizationFilterPreset ?? nextApp.stylizationPreset,
            "none"
          ),
          stylizationEffectPreset: context.normalizeStylizationEffectPreset(
            nextApp.stylizationEffectPreset ?? nextApp.stylizationPreset,
            "none"
          ),
          reactionPathsByModel,
          roomTextures: Object.fromEntries(
            Object.keys(context.defaultAppRoomTextures()).map((key) => {
              const value = String(roomTextures?.[key] || "").trim();
              return [key, value && textureChoices.has(value) ? value : ""];
            })
          ),
          propSlots: Object.fromEntries(
            Object.keys(context.defaultAppPropSlots()).map((key) => {
              const rawValue = propSlots?.[key];
              const model = String(
                (rawValue && typeof rawValue === "object" ? rawValue.model : rawValue) || ""
              ).trim();
              const scale = context.normalizePropScale(
                rawValue && typeof rawValue === "object" ? rawValue.scale : 1,
                1
              );
              return [key, {
                model: model && propChoices.has(model) ? model : "",
                scale
              }];
            })
          ),
          voicePreferences: Array.isArray(nextApp.voicePreferences)
            ? nextApp.voicePreferences.map((value) => String(value)).map((value) => value.trim()).filter(Boolean)
            : [],
          trust: {
            ...nextTrust,
            records: nextTrust.records.map((entry, index) => context.sanitizeTrustRecordForConfig(entry, index)),
            voiceProfiles: []
          }
        }
      });
      await context.saveVoicePatternStore();
      await context.saveObserverConfig();
      res.json({
        ok: true,
        message: "Nova settings saved.",
        app: {
          ...context.getObserverConfig().app,
          trust: context.getAppTrustConfig()
        }
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/brains/config", async (req, res) => {
    try {
      const brains = await context.listAvailableBrains();
      res.json({
        ok: true,
        ...context.buildBrainConfigPayload(),
        availableBrains: brains.map((brain) => buildAvailableBrainPayload(brain, context))
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/brains/config", async (req, res) => {
    try {
      const payload = req.body && typeof req.body === "object" ? req.body : {};
      const nextBrains = payload?.brains && typeof payload.brains === "object" ? payload.brains : {};
      const nextRouting = payload?.routing && typeof payload.routing === "object" ? payload.routing : {};
      const nextQueue = payload?.queue && typeof payload.queue === "object" ? payload.queue : {};

      const builtInBrainIds = context.agentBrains.map((brain) => brain.id);
      const configuredEndpoints = nextBrains?.endpoints && typeof nextBrains.endpoints === "object"
        ? nextBrains.endpoints
        : {};
      const serializedEndpoints = Object.fromEntries(
        Object.entries(configuredEndpoints)
          .map(([id, entry]) => [context.sanitizeConfigId(id), context.serializeBrainEndpointConfig(entry, id)])
          .filter(([id, entry]) => id && entry.baseUrl)
      );
      serializedEndpoints.local = {
        label: String(serializedEndpoints.local?.label || "Local Ollama"),
        baseUrl: context.localOllamaBaseUrl
      };
      const knownEndpointIds = new Set(Object.keys(serializedEndpoints));

      const serializedCustomBrains = (Array.isArray(nextBrains?.custom) ? nextBrains.custom : [])
        .map((entry, index) => context.serializeCustomBrainConfig(entry, index, knownEndpointIds))
        .filter(Boolean);
      const customBrainIds = serializedCustomBrains.map((brain) => brain.id);
      const allKnownBrainIds = new Set([...builtInBrainIds, ...customBrainIds]);

      const requestedEnabledIds = context.sanitizeStringList(
        Array.isArray(nextBrains?.enabledIds) ? nextBrains.enabledIds : []
      );
      const enabledIds = requestedEnabledIds.length
        ? requestedEnabledIds.filter((id) => allKnownBrainIds.has(id))
        : [...builtInBrainIds, ...customBrainIds];

      const rawAssignments = nextBrains?.assignments && typeof nextBrains.assignments === "object"
        ? nextBrains.assignments
        : {};
      const assignments = {};
      for (const brainId of builtInBrainIds) {
        const endpointId = String(rawAssignments?.[brainId] || "local").trim();
        assignments[brainId] = knownEndpointIds.has(endpointId) ? endpointId : "local";
      }
      for (const brainId of customBrainIds) {
        const customBrain = serializedCustomBrains.find((entry) => entry.id === brainId);
        assignments[brainId] = customBrain?.endpointId || "local";
      }

      const sanitizeRouteList = (value) => context.sanitizeStringList(
        Array.isArray(value) ? value : String(value || "").split(",")
      ).filter((id) => allKnownBrainIds.has(id));
      const observerConfig = context.getObserverConfig();
      const routing = {
        enabled: nextRouting?.enabled === true,
        remoteTriageBrainId: allKnownBrainIds.has(String(nextRouting?.remoteTriageBrainId || "").trim())
          ? String(nextRouting.remoteTriageBrainId).trim()
          : "",
        specialistMap: {
          code: sanitizeRouteList(nextRouting?.specialistMap?.code),
          document: sanitizeRouteList(nextRouting?.specialistMap?.document),
          general: sanitizeRouteList(nextRouting?.specialistMap?.general),
          background: sanitizeRouteList(nextRouting?.specialistMap?.background),
          creative: sanitizeRouteList(nextRouting?.specialistMap?.creative),
          vision: sanitizeRouteList(nextRouting?.specialistMap?.vision),
          retrieval: sanitizeRouteList(nextRouting?.specialistMap?.retrieval)
        },
        fallbackAttempts: Math.max(0, Math.min(Number(nextRouting?.fallbackAttempts || 0), 4))
      };

      context.setObserverConfig({
        ...observerConfig,
        brains: {
          ...observerConfig.brains,
          enabledIds,
          endpoints: serializedEndpoints,
          assignments,
          custom: serializedCustomBrains
        },
        routing,
        queue: {
          remoteParallel: nextQueue?.remoteParallel !== false,
          escalationEnabled: nextQueue?.escalationEnabled !== false,
          paused: Object.prototype.hasOwnProperty.call(nextQueue, "paused")
            ? nextQueue?.paused === true
            : observerConfig?.queue?.paused === true
        }
      });

      await context.saveObserverConfig();
      const brains = await context.listAvailableBrains();
      res.json({
        ok: true,
        message: "Brain configuration saved.",
        ...context.buildBrainConfigPayload(),
        availableBrains: brains.map((brain) => buildAvailableBrainPayload(brain, context))
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/projects/config", async (req, res) => {
    try {
      res.json({
        ok: true,
        ...context.buildProjectConfigPayload(),
        state: await context.buildProjectSystemStatePayload()
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/projects/config", async (req, res) => {
    try {
      const payload = req.body && typeof req.body === "object" ? req.body : {};
      const nextProjects = payload?.projects && typeof payload.projects === "object" ? payload.projects : {};
      context.setObserverConfig({
        ...context.getObserverConfig(),
        projects: context.normalizeProjectConfigInput(nextProjects)
      });
      await context.saveObserverConfig();
      res.json({
        ok: true,
        message: "Project configuration saved.",
        ...context.buildProjectConfigPayload(),
        state: await context.buildProjectSystemStatePayload()
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/projects/state", async (req, res) => {
    try {
      res.json({
        ok: true,
        state: await context.buildProjectSystemStatePayload()
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/projects/pipelines", async (req, res) => {
    try {
      const limit = Number(req.query.limit || 24);
      res.json({
        ok: true,
        pipelines: await context.listProjectPipelines({ limit })
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/projects/pipeline", async (req, res) => {
    try {
      const taskId = String(req.query.taskId || "").trim();
      const projectWorkKey = String(req.query.projectWorkKey || "").trim();
      if (!taskId && !projectWorkKey) {
        return res.status(400).json({ ok: false, error: "taskId or projectWorkKey is required" });
      }
      const pipeline = await context.getProjectPipelineTrace({ taskId, projectWorkKey });
      if (!pipeline) {
        return res.status(404).json({ ok: false, error: "project pipeline not found" });
      }
      res.json({
        ok: true,
        pipeline
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/tools/config", async (req, res) => {
    try {
      res.json({
        ok: true,
        ...(await context.buildToolConfigPayload())
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/tools/config", async (req, res) => {
    try {
      const payload = req.body && typeof req.body === "object" ? req.body : {};
      res.json({
        ok: true,
        message: "Tool approval configuration saved.",
        ...(await context.updateToolConfig(payload))
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/secrets/status", async (req, res) => {
    try {
      const handle = String(req.query.handle || "").trim();
      if (!handle) {
        throw new Error("handle is required");
      }
      res.json({
        ok: true,
        secret: await context.getSecretStatus(handle)
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/secrets/catalog", async (req, res) => {
    try {
      res.json({
        ok: true,
        catalog: await context.buildSecretsCatalog()
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/secrets", async (req, res) => {
    try {
      const handle = String(req.body?.handle || "").trim();
      const value = String(req.body?.value || "");
      if (!handle) {
        throw new Error("handle is required");
      }
      if (!value) {
        throw new Error("value is required");
      }
      res.json({
        ok: true,
        secret: await context.setSecretValue(handle, value)
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/secrets", async (req, res) => {
    try {
      const handle = String(req.body?.handle || req.query?.handle || "").trim();
      if (!handle) {
        throw new Error("handle is required");
      }
      res.json({
        ok: true,
        secret: await context.deleteSecretValue(handle)
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}
