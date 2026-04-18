export function createObserverRuntimeSupport(options = {}) {
  const {
    clients = new Set(),
    compactHookText = (value = "") => String(value || ""),
    fs = null,
    getObserverConfig = () => ({}),
    getPluginManager = () => null,
    getTaskDispatchScheduled = () => false,
    observerEventClients = new Set(),
    pathModule = null,
    processQueuedTasksToCapacity = async () => {},
    publicRoot = "",
    recoverStaleTaskDispatchLock = async () => {},
    sanitizeHookToken = (value = "") => String(value || ""),
    setTaskDispatchScheduled = () => {}
  } = options;

  function defaultAppRoomTextures() {
    return {
      roomDay: "/assets/textures/room-day.png",
      roomNight: "/assets/textures/room-night.png",
      desk: "/assets/textures/desk.png",
      shelf: "/assets/textures/shelf.png"
    };
  }

  function defaultAppPropSlots() {
    return {
      leftShelf: { modelPath: "/assets/props/book-stack.glb", scale: 1 },
      rightShelf: { modelPath: "/assets/props/plant.glb", scale: 1 },
      deskLeft: { modelPath: "/assets/props/mug.glb", scale: 1 },
      deskRight: { modelPath: "/assets/props/notebook.glb", scale: 1 }
    };
  }

  function defaultAppReactionPathsByModel() {
    return {
      "/assets/characters/nova.glb": { idle: "/assets/characters/reactions/nova-idle.glb" }
    };
  }

  function normalizePropScale(value, fallback = 1) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  }

  function normalizeReactionPathProfile(value = {}) {
    return {
      idle: String(value?.idle || "").trim(),
      positive: String(value?.positive || "").trim(),
      negative: String(value?.negative || "").trim(),
      thinking: String(value?.thinking || "").trim()
    };
  }

  function normalizeReactionPathsByModel(value, allowedModelPaths = []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return defaultAppReactionPathsByModel();
    }
    const allowed = new Set((Array.isArray(allowedModelPaths) ? allowedModelPaths : []).map((entry) => String(entry || "").trim()).filter(Boolean));
    const entries = Object.entries(value)
      .map(([modelPath, profile]) => [String(modelPath || "").trim(), normalizeReactionPathProfile(profile)])
      .filter(([modelPath]) => !allowed.size || allowed.has(modelPath));
    return entries.length ? Object.fromEntries(entries) : defaultAppReactionPathsByModel();
  }

  function normalizeStylizationFilterPreset(value, fallback = "none") {
    const normalized = String(value || "").trim().toLowerCase();
    return ["none", "soft", "anime", "cinematic"].includes(normalized) ? normalized : fallback;
  }

  function normalizeStylizationEffectPreset(value, fallback = "none") {
    const normalized = String(value || "").trim().toLowerCase();
    return ["none", "glow", "grain", "comic"].includes(normalized) ? normalized : fallback;
  }

  async function walkAssetDirectory(dirPath, relativePrefix = "") {
    let entries = [];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const files = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = pathModule.join(dirPath, entry.name);
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...await walkAssetDirectory(entryPath, relativePath));
        continue;
      }
      if (entry.isFile()) {
        files.push(relativePath.replaceAll("\\", "/"));
      }
    }
    return files;
  }

  async function listPublicAssetChoices() {
    const files = await walkAssetDirectory(pathModule.join(publicRoot, "assets"));
    const toPublicPath = (fileName) => `/assets/${fileName}`;
    const filterByPath = (pattern) => files
      .filter((name) => pattern.test(name))
      .sort((left, right) => left.localeCompare(right))
      .map(toPublicPath);
    const characters = filterByPath(/^characters\/.+\.glb$/i);
    const props = filterByPath(/^props\/.+\.glb$/i);
    const skies = filterByPath(/^skies\/.+\.(png|jpg|jpeg)$/i);
    const textures = filterByPath(/^textures\/.+\.(png|jpg|jpeg)$/i);
    return {
      characters,
      props,
      skies,
      textures,
      models: characters,
      backgrounds: skies
    };
  }

  function broadcast(line) {
    const msg = `data: ${JSON.stringify({ ts: Date.now(), line })}\n\n`;
    for (const res of clients) {
      res.write(msg);
    }
  }

  function classifySubsystemForObserverEventType(eventType = "") {
    const prefix = String(eventType || "").trim().toLowerCase().split(".")[0];
    if (!prefix) {
      return "runtime";
    }
    if (prefix === "task") {
      return "queue";
    }
    if (["mail", "todo", "calendar", "cron", "projects", "project", "runtime", "plugin", "voice", "trust", "tools"].includes(prefix)) {
      return prefix === "project" ? "projects" : prefix;
    }
    return "runtime";
  }

  function summarizeObserverEventForHook(payload = {}) {
    const eventType = String(payload?.type || "").trim();
    const task = payload?.task && typeof payload.task === "object" ? payload.task : null;
    const mail = payload?.mail && typeof payload.mail === "object" ? payload.mail : null;
    const todo = payload?.todo && typeof payload.todo === "object" ? payload.todo : null;
    return {
      ts: Number(payload?.ts || Date.now()),
      type: eventType,
      subsystem: classifySubsystemForObserverEventType(eventType),
      taskId: String(task?.id || "").trim(),
      taskStatus: String(task?.status || "").trim(),
      mailId: String(mail?.id || "").trim(),
      mailSubject: compactHookText(String(mail?.subject || "").trim(), 180),
      todoId: String(todo?.id || "").trim(),
      todoStatus: String(todo?.status || "").trim()
    };
  }

  function broadcastObserverEvent(event) {
    const payload = {
      ts: Date.now(),
      ...event
    };
    const msg = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of observerEventClients) {
      res.write(msg);
    }
    const hookPayload = summarizeObserverEventForHook(payload);
    const eventTypeToken = sanitizeHookToken(String(payload?.type || "").replace(/\./g, "-"));
    const pluginManager = getPluginManager();
    void pluginManager?.runHook?.("observer:event", hookPayload);
    if (eventTypeToken) {
      void pluginManager?.runHook?.(`observer:event:${eventTypeToken}`, hookPayload);
    }
    const subsystemToken = sanitizeHookToken(hookPayload.subsystem || "");
    if (subsystemToken) {
      void pluginManager?.runHook?.(`subsystem:${subsystemToken}:event`, hookPayload);
    }
  }

  function scheduleTaskDispatch(delayMs = 150) {
    if (getObserverConfig()?.queue?.paused === true) {
      return;
    }
    if (getTaskDispatchScheduled()) {
      return;
    }
    setTaskDispatchScheduled(true);
    setTimeout(async () => {
      setTaskDispatchScheduled(false);
      try {
        await recoverStaleTaskDispatchLock();
        await processQueuedTasksToCapacity();
      } catch (error) {
        broadcast(`[observer] task dispatch error: ${error.message}`);
      }
    }, delayMs);
  }

  return {
    broadcast,
    broadcastObserverEvent,
    defaultAppPropSlots,
    defaultAppReactionPathsByModel,
    defaultAppRoomTextures,
    listPublicAssetChoices,
    normalizePropScale,
    normalizeReactionPathsByModel,
    normalizeStylizationEffectPreset,
    normalizeStylizationFilterPreset,
    scheduleTaskDispatch
  };
}
