export function createPluginToolCatalogService({
  buildObserverToolCatalog,
  getPluginManager,
  getWorkerTools,
  intakeTools
} = {}) {
  let pluginToolCatalogCache = [];

  function normalizePluginToolEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const normalized = {
      name: String(entry.name || "").trim(),
      description: String(entry.description || "").trim(),
      parameters: entry.parameters && typeof entry.parameters === "object" ? entry.parameters : {},
      scopes: Array.isArray(entry.scopes)
        ? entry.scopes.map((scope) => String(scope || "").trim().toLowerCase()).filter(Boolean)
        : [String(entry.scope || "intake").trim().toLowerCase()].filter(Boolean),
      risk: String(entry.risk || "normal").trim().toLowerCase() || "normal",
      defaultApproved: entry.defaultApproved !== false,
      source: String(entry.source || "plugin").trim() === "core" ? "core" : "plugin",
      pluginId: String(entry.pluginId || "").trim(),
      pluginName: String(entry.pluginName || "").trim()
    };
    return normalized.name ? normalized : null;
  }

  function collectPluginToolsSync(scope = "") {
    const pluginManager = getPluginManager?.();
    if (pluginManager && typeof pluginManager.listTools === "function") {
      pluginToolCatalogCache = pluginManager.listTools();
    }
    const normalizedScope = String(scope || "").trim().toLowerCase();
    const tools = Array.isArray(pluginToolCatalogCache) ? pluginToolCatalogCache.slice() : [];
    if (!normalizedScope) {
      return tools;
    }
    return tools.filter((entry) => Array.isArray(entry.scopes) && entry.scopes.includes(normalizedScope));
  }

  async function refreshPluginToolCatalogCache() {
    const pluginManager = getPluginManager?.();
    if (!pluginManager) {
      pluginToolCatalogCache = [];
      return;
    }
    let tools = [];
    if (typeof pluginManager.listTools === "function") {
      tools = pluginManager.listTools();
    } else if (typeof pluginManager.runHook === "function") {
      const payload = await pluginManager.runHook("intake:tools:list", { tools: [] });
      tools = Array.isArray(payload?.tools) ? payload.tools : [];
    }
    pluginToolCatalogCache = tools
      .map(normalizePluginToolEntry)
      .filter(Boolean);
  }

  function resetPluginToolCatalogCache() {
    pluginToolCatalogCache = [];
  }

  async function executePluginIntakeToolCall({ name = "", args = {}, toolCall = null, normalized = null } = {}) {
    const pluginManager = getPluginManager?.();
    if (!pluginManager || typeof pluginManager.runHook !== "function") {
      return null;
    }
    const result = await pluginManager.runHook("intake:tool-call", {
      handled: false,
      name: String(name || "").trim(),
      args: args && typeof args === "object" ? args : {},
      toolCall,
      normalized,
      result: null
    });
    if (result?.handled === true) {
      return result.result ?? null;
    }
    return null;
  }

  function buildToolCatalog() {
    const suppliedWorkerTools = getWorkerTools?.();
    const workerTools = Array.isArray(suppliedWorkerTools) ? suppliedWorkerTools : [];
    const configuredIntakeTools = Array.isArray(intakeTools) ? intakeTools : [];
    const pluginWorkerTools = collectPluginToolsSync("worker");
    const pluginIntakeTools = collectPluginToolsSync("intake");
    return buildObserverToolCatalog({
      workerTools: [...workerTools, ...pluginWorkerTools],
      intakeTools: [...configuredIntakeTools, ...pluginIntakeTools]
    });
  }

  return {
    buildToolCatalog,
    collectPluginToolsSync,
    executePluginIntakeToolCall,
    refreshPluginToolCatalogCache,
    resetPluginToolCatalogCache
  };
}
