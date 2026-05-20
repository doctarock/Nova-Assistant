export function createObserverRuntimeAccessors({
  getObserverConfig,
  getPluginManager,
  normalizeProjectsConfigForBootstrap
} = {}) {
  function getRoutingConfig() {
    const observerConfig = getObserverConfig();
    const specialistMap = observerConfig?.routing?.specialistMap && typeof observerConfig.routing.specialistMap === "object"
      ? observerConfig.routing.specialistMap
      : {};
    return {
      enabled: observerConfig?.routing?.enabled === true,
      remoteTriageBrainId: String(observerConfig?.routing?.remoteTriageBrainId || "").trim(),
      fallbackAttempts: Math.max(0, Math.min(Number(observerConfig?.routing?.fallbackAttempts || 2), 4)),
      specialistMap: {
        code: Array.isArray(specialistMap.code) ? specialistMap.code.map((value) => String(value)).filter(Boolean) : [],
        document: Array.isArray(specialistMap.document) ? specialistMap.document.map((value) => String(value)).filter(Boolean) : [],
        general: Array.isArray(specialistMap.general) ? specialistMap.general.map((value) => String(value)).filter(Boolean) : [],
        background: Array.isArray(specialistMap.background) ? specialistMap.background.map((value) => String(value)).filter(Boolean) : [],
        creative: Array.isArray(specialistMap.creative) ? specialistMap.creative.map((value) => String(value)).filter(Boolean) : [],
        vision: Array.isArray(specialistMap.vision) ? specialistMap.vision.map((value) => String(value)).filter(Boolean) : [],
        retrieval: Array.isArray(specialistMap.retrieval) ? specialistMap.retrieval.map((value) => String(value)).filter(Boolean) : [],
        fast_worker: Array.isArray(specialistMap.fast_worker) ? specialistMap.fast_worker.map((value) => String(value)).filter(Boolean) : []
      }
    };
  }

  function getQueueConfig() {
    const observerConfig = getObserverConfig();
    const configured = observerConfig?.queue && typeof observerConfig.queue === "object"
      ? observerConfig.queue
      : {};
    return {
      remoteParallel: configured.remoteParallel !== false,
      escalationEnabled: configured.escalationEnabled !== false,
      paused: configured.paused === true
    };
  }

  function getCapabilityRuntime(capabilityName = "") {
    const provider = getPluginManager()?.getCapability?.(capabilityName);
    if (typeof provider !== "function") {
      return null;
    }
    try {
      const runtime = provider();
      return runtime && typeof runtime === "object" ? runtime : null;
    } catch {
      return null;
    }
  }

  function getMailRuntime() {
    return getCapabilityRuntime("mail.runtime");
  }

  function getMailRuntimeFn(name = "") {
    const runtime = getMailRuntime();
    const fn = runtime?.[name];
    return typeof fn === "function" ? fn : null;
  }

  function requireMailRuntimeFn(name = "") {
    const fn = getMailRuntimeFn(name);
    if (typeof fn === "function") {
      return fn;
    }
    throw new Error(`mail runtime unavailable: ${String(name || "").trim() || "unknown"}`);
  }

  function getProjectsRuntime() {
    return getCapabilityRuntime("projects.runtime");
  }

  function getProjectsRuntimeFn(name = "") {
    const runtime = getProjectsRuntime();
    const fn = runtime?.[name];
    return typeof fn === "function" ? fn : null;
  }

  function requireProjectsRuntimeFn(name = "") {
    const fn = getProjectsRuntimeFn(name);
    if (typeof fn === "function") {
      return fn;
    }
    throw new Error(`projects runtime unavailable: ${String(name || "").trim() || "unknown"}`);
  }

  function normalizeProjectConfigInput(...args) {
    const runtimeFn = getProjectsRuntimeFn("normalizeProjectConfigInput");
    if (typeof runtimeFn === "function") {
      return runtimeFn(...args);
    }
    return normalizeProjectsConfigForBootstrap(...args);
  }

  function getProjectConfig(...args) {
    const runtimeFn = getProjectsRuntimeFn("getProjectConfig");
    if (typeof runtimeFn === "function") {
      return runtimeFn(...args);
    }
    const observerConfig = getObserverConfig();
    const configured = observerConfig?.projects && typeof observerConfig.projects === "object"
      ? observerConfig.projects
      : {};
    return normalizeProjectsConfigForBootstrap(configured);
  }

  function getProjectNoChangeMinimumTargets(...args) {
    const runtimeFn = getProjectsRuntimeFn("getProjectNoChangeMinimumTargets");
    if (typeof runtimeFn === "function") {
      return runtimeFn(...args);
    }
    return getProjectConfig().noChangeMinimumConcreteTargets;
  }

  function getProjectRolePlaybooks() {
    const playbooks = getProjectsRuntime()?.getProjectRolePlaybooks?.();
    return Array.isArray(playbooks) ? playbooks : [];
  }

  function getPluginCapability(name = "") {
    const pluginManager = getPluginManager();
    if (!pluginManager || typeof pluginManager.getCapability !== "function") {
      return null;
    }
    return pluginManager.getCapability(name);
  }

  function isPluginEnabled(pluginId = "") {
    const normalizedId = String(pluginId || "").trim();
    const pluginManager = getPluginManager();
    if (!normalizedId || !pluginManager || typeof pluginManager.listPlugins !== "function") {
      return false;
    }
    const plugin = pluginManager.listPlugins().find((entry) => String(entry?.id || "").trim() === normalizedId);
    return plugin?.enabled === true;
  }

  async function invokeCapability(name = "", ...args) {
    const provider = getPluginCapability(name);
    if (typeof provider !== "function") {
      throw new Error(`capability unavailable: ${String(name || "unknown")}`);
    }
    return await provider(...args);
  }

  async function invokeOptionalCapability(name = "", fallback = null, ...args) {
    const provider = getPluginCapability(name);
    if (typeof provider !== "function") {
      return fallback;
    }
    return await provider(...args);
  }

  return {
    getMailRuntime,
    getMailRuntimeFn,
    getPluginCapability,
    getProjectConfig,
    getProjectNoChangeMinimumTargets,
    getProjectRolePlaybooks,
    getProjectsRuntime,
    getProjectsRuntimeFn,
    getQueueConfig,
    getRoutingConfig,
    invokeCapability,
    invokeOptionalCapability,
    isPluginEnabled,
    normalizeProjectConfigInput,
    requireMailRuntimeFn,
    requireProjectsRuntimeFn
  };
}
