export function createObserverConfigSecretsDomain(options = {}) {
  const {
    buildMailAgentPasswordHandle = (agentId = "") => String(agentId || ""),
    buildQdrantApiKeyHandleBase = () => "",
    configPath = "",
    defaultQdrantCollection = "observer_chunks",
    defaultQdrantUrl = "http://127.0.0.1:6333",
    fs = null,
    getMailAgents = () => [],
    getObserverConfig = () => ({}),
    getIotInstances = async () => [],
    getPluginManager = () => null,
    hasMailPassword = async () => false,
    invalidateObserverConfigCaches = () => {},
    observerSecrets = null,
    processObject = process
  } = options;

  function sanitizeConfigId(value = "", fallback = "") {
    const trimmed = String(value || "").trim().toLowerCase();
    const sanitized = trimmed.replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
    return sanitized || String(fallback || "").trim().toLowerCase();
  }

  function sanitizeStringList(values = []) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean))];
  }

  async function setSecretValue(handle = "", value = "") {
    const result = await observerSecrets.setSecret(handle, value);
    return {
      handle: result.handle,
      hasSecret: true,
      backend: "system-keychain"
    };
  }

  async function getSecretStatus(handle = "") {
    const normalizedHandle = observerSecrets.normalizeSecretHandle(handle);
    return {
      handle: normalizedHandle,
      hasSecret: normalizedHandle ? await observerSecrets.hasSecret(normalizedHandle) : false,
      backend: "system-keychain"
    };
  }

  async function deleteSecretValue(handle = "") {
    const result = await observerSecrets.deleteSecret(handle);
    return {
      handle: result.handle,
      hasSecret: false,
      deleted: result.deleted,
      backend: "system-keychain"
    };
  }

  function buildQdrantApiKeyHandle() {
    return observerSecrets.normalizeSecretHandle(
      processObject.env.QDRANT_API_KEY_HANDLE || buildQdrantApiKeyHandleBase()
    );
  }

  async function migrateLegacyQdrantApiKey(config = {}) {
    const apiKey = String(config?.apiKey || "").trim();
    const apiKeyHandle = observerSecrets.normalizeSecretHandle(
      config?.apiKeyHandle || buildQdrantApiKeyHandle()
    );
    if (apiKey && apiKeyHandle) {
      await observerSecrets.setSecret(apiKeyHandle, apiKey);
    }
    return apiKeyHandle;
  }

  function getRetrievalConfig() {
    const observerConfig = getObserverConfig();
    const configured = observerConfig?.retrieval && typeof observerConfig.retrieval === "object"
      ? observerConfig.retrieval
      : {};
    return {
      qdrantUrl: String(configured.qdrantUrl || defaultQdrantUrl).trim() || defaultQdrantUrl,
      collectionName: String(configured.collectionName || defaultQdrantCollection).trim() || defaultQdrantCollection,
      apiKeyHandle: observerSecrets.normalizeSecretHandle(
        configured.apiKeyHandle || buildQdrantApiKeyHandle()
      )
    };
  }

  async function resolveQdrantApiKey() {
    const retrievalConfig = getRetrievalConfig();
    if (retrievalConfig.apiKeyHandle) {
      const stored = await observerSecrets.getSecret(retrievalConfig.apiKeyHandle);
      if (String(stored || "").trim()) {
        return String(stored || "").trim();
      }
    }
    return String(processObject.env.QDRANT_API_KEY || "").trim();
  }

  async function hasQdrantApiKey() {
    return Boolean(String(await resolveQdrantApiKey()).trim());
  }

  async function buildSecretsCatalog() {
    const observerConfig = getObserverConfig();
    const configuredMailAgents = await Promise.resolve()
      .then(() => getMailAgents())
      .catch(() => []);
    const mailAgentList = Array.isArray(configuredMailAgents) ? configuredMailAgents : [];
    const mailAgents = await Promise.all(mailAgentList.map(async (agent) => ({
      id: agent.id,
      label: agent.label,
      email: agent.email,
      user: agent.user,
      passwordHandle: observerSecrets.normalizeSecretHandle(
        agent.passwordHandle || buildMailAgentPasswordHandle(String(agent.id || "").trim())
      ),
      hasSecret: await hasMailPassword(agent),
      active: String(observerConfig?.mail?.activeAgentId || "").trim() === agent.id
    })));
    const iotInstances = await Promise.resolve().then(() => getIotInstances()).catch(() => []);
    const pluginManager = getPluginManager();
    const listWordPressSitesCapability = pluginManager?.getCapability?.("wordpress.listSites");
    const buildWordPressSecretsCatalogCapability = pluginManager?.getCapability?.("wordpress.buildSecretsCatalogData");
    const wordpressSecretsCatalog = typeof buildWordPressSecretsCatalogCapability === "function"
      ? await buildWordPressSecretsCatalogCapability()
      : {
          sites: typeof listWordPressSitesCapability === "function" ? await listWordPressSitesCapability() : [],
          handles: []
        };
    const wordpressSites = Array.isArray(wordpressSecretsCatalog?.sites) ? wordpressSecretsCatalog.sites : [];
    const retrieval = getRetrievalConfig();
    return {
      serviceName: observerSecrets.serviceName,
      mail: {
        enabled: observerConfig?.mail?.enabled === true,
        activeAgentId: String(observerConfig?.mail?.activeAgentId || "").trim(),
        agents: mailAgents
      },
      wordpress: {
        sites: wordpressSites
      },
      iot: {
        instances: Array.isArray(iotInstances) ? iotInstances : []
      },
      retrieval: {
        qdrantUrl: retrieval.qdrantUrl,
        collectionName: retrieval.collectionName,
        apiKeyHandle: retrieval.apiKeyHandle,
        hasSecret: await hasQdrantApiKey()
      },
      suggestedHandles: [
        buildQdrantApiKeyHandle(),
        ...mailAgents.map((agent) => agent.passwordHandle),
        ...(Array.isArray(wordpressSecretsCatalog?.handles)
          ? wordpressSecretsCatalog.handles
          : wordpressSites.map((site) => String(site.sharedSecretHandle || "").trim()).filter(Boolean)),
        ...(Array.isArray(iotInstances)
          ? iotInstances.map((inst) => String(inst.tokenHandle || "").trim()).filter(Boolean)
          : [])
      ].filter(Boolean)
    };
  }

  async function readJsonFileIfExists(filePath = "") {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  async function readTextFileIfExists(filePath = "") {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch {
      return "";
    }
  }

  async function saveObserverConfig() {
    const observerConfig = getObserverConfig();
    const serializedConfig = {
      ...observerConfig,
      retrieval: observerConfig?.retrieval && typeof observerConfig.retrieval === "object"
        ? {
            ...observerConfig.retrieval,
            apiKey: "",
            apiKeyHandle: observerSecrets.normalizeSecretHandle(
              observerConfig?.retrieval?.apiKeyHandle || buildQdrantApiKeyHandle()
            )
          }
        : observerConfig.retrieval,
      mail: observerConfig?.mail && typeof observerConfig.mail === "object"
        ? {
            ...observerConfig.mail,
            agents: Object.fromEntries(
              Object.entries(observerConfig.mail.agents || {}).map(([id, agent]) => [String(id), {
                ...agent,
                password: "",
                passwordHandle: observerSecrets.normalizeSecretHandle(
                  agent?.passwordHandle || (id ? buildMailAgentPasswordHandle(String(id || "").trim()) : "")
                )
              }])
            )
          }
        : observerConfig.mail
    };
    await fs.writeFile(configPath, `${JSON.stringify(serializedConfig, null, 2)}\n`, "utf8");
    invalidateObserverConfigCaches();
  }

  return {
    buildQdrantApiKeyHandle,
    buildSecretsCatalog,
    deleteSecretValue,
    getRetrievalConfig,
    getSecretStatus,
    hasQdrantApiKey,
    migrateLegacyQdrantApiKey,
    readJsonFileIfExists,
    readTextFileIfExists,
    resolveQdrantApiKey,
    sanitizeConfigId,
    sanitizeStringList,
    saveObserverConfig,
    setSecretValue
  };
}
