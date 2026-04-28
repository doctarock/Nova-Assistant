function normalizeInstanceId(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "default";
}

function normalizeBaseUrl(value = "") {
  let raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

function normalizeEntityId(value = "") {
  return String(value || "").trim().toLowerCase();
}

async function callHa(instance, { method = "GET", path = "/api/", body = null, timeoutMs = 15000 } = {}) {
  const baseUrl = String(instance?.baseUrl || "").trim().replace(/\/+$/, "");
  const token = String(instance?.token || "").trim();
  if (!baseUrl) throw new Error("Home Assistant base URL is not configured");
  if (!token) throw new Error("Home Assistant token is not configured");

  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const bodyText = body != null ? JSON.stringify(body) : undefined;

  let response;
  try {
    response = await fetch(url, {
      method: String(method || "GET").trim().toUpperCase(),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: bodyText,
      signal: AbortSignal.timeout(Math.max(1000, Math.min(Number(timeoutMs || 15000), 120000)))
    });
  } catch (err) {
    throw new Error(`Home Assistant request failed: ${err.message}`);
  }

  const rawText = await response.text();
  let payload;
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { raw: rawText };
  }

  if (!response.ok) {
    const msg = payload?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(`Home Assistant returned ${response.status}: ${msg}`);
  }
  return payload;
}

export function createObserverIotDomain(context = {}) {
  const {
    fs,
    path: pathModule,
    registryPath = "",
    getSecret = async () => "",
    hasSecret = async () => false,
    setSecret = async () => {},
    deleteSecret = async () => {},
    // Lazy getter — pluginManager isn't available at domain creation time
    getRunHook = () => null
  } = context;

  let registryCache = null;

  async function hook(name, payload) {
    const runHook = getRunHook();
    if (typeof runHook !== "function") return payload;
    try {
      const result = await runHook(name, payload);
      return result !== undefined ? result : payload;
    } catch {
      return payload;
    }
  }

  function buildTokenHandle(instanceId = "") {
    return `iot/ha/${normalizeInstanceId(instanceId)}/token`;
  }

  async function loadRegistry() {
    if (registryCache) return registryCache;
    try {
      const raw = await fs.readFile(registryPath, "utf8");
      const parsed = JSON.parse(raw);
      registryCache = { instances: Array.isArray(parsed?.instances) ? parsed.instances : [] };
    } catch {
      registryCache = { instances: [] };
    }
    return registryCache;
  }

  async function persistRegistry() {
    if (!registryPath || !fs) return;
    const state = await loadRegistry();
    const data = {
      instances: state.instances.map((inst) => ({
        instanceId: inst.instanceId,
        label: inst.label,
        baseUrl: inst.baseUrl,
        tokenHandle: inst.tokenHandle
      }))
    };
    await fs.mkdir(pathModule.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  async function resolveInstance(instanceId = "") {
    const id = normalizeInstanceId(instanceId);
    const registry = await loadRegistry();
    const inst = registry.instances.find((i) => i.instanceId === id);
    if (!inst) throw new Error(`Home Assistant instance "${id}" is not configured`);
    const token = await getSecret(inst.tokenHandle || buildTokenHandle(id));
    return { ...inst, token: String(token || "").trim() };
  }

  // Public: plugins use this to make raw HA requests by instanceId.
  async function callHaForInstance(instanceId = "", options = {}) {
    const instance = await resolveInstance(instanceId);
    return callHa(instance, options);
  }

  async function listInstances() {
    const registry = await loadRegistry();
    return Promise.all(
      registry.instances.map(async (inst) => ({
        instanceId: inst.instanceId,
        label: inst.label,
        baseUrl: inst.baseUrl,
        tokenHandle: inst.tokenHandle,
        hasToken: await hasSecret(inst.tokenHandle || buildTokenHandle(inst.instanceId))
      }))
    );
  }

  async function saveInstance(args = {}) {
    const instanceId = normalizeInstanceId(args.instanceId || args.id || "default");
    const baseUrl = normalizeBaseUrl(args.baseUrl || args.url || "");
    if (!baseUrl) throw new Error("baseUrl is required (e.g. http://homeassistant.local:8123)");
    const label = String(args.label || args.name || instanceId).trim().slice(0, 120) || instanceId;
    const tokenHandle = buildTokenHandle(instanceId);
    const providedToken = String(args.token || args.longLivedToken || "").trim();
    const hasExistingToken = await hasSecret(tokenHandle);
    if (!providedToken && !hasExistingToken) throw new Error("token (long-lived access token) is required");
    if (providedToken) await setSecret(tokenHandle, providedToken);
    const registry = await loadRegistry();
    const existing = registry.instances.findIndex((i) => i.instanceId === instanceId);
    const record = { instanceId, label, baseUrl, tokenHandle };
    if (existing >= 0) registry.instances[existing] = record;
    else registry.instances.unshift(record);
    await persistRegistry();
    const result = { instanceId, label, baseUrl, tokenHandle, hasToken: true };
    await hook("iot:instance-saved", { instanceId, instance: result });
    return result;
  }

  async function removeInstance(args = {}) {
    const instanceId = normalizeInstanceId(args.instanceId || args.id || "");
    if (!instanceId) throw new Error("instanceId is required");
    const registry = await loadRegistry();
    const idx = registry.instances.findIndex((i) => i.instanceId === instanceId);
    if (idx < 0) throw new Error(`Instance "${instanceId}" not found`);
    const [removed] = registry.instances.splice(idx, 1);
    await deleteSecret(removed.tokenHandle || buildTokenHandle(instanceId));
    await persistRegistry();
    const result = { instanceId: removed.instanceId, label: removed.label };
    await hook("iot:instance-removed", { instanceId: removed.instanceId });
    return result;
  }

  async function testConnection(args = {}) {
    const instance = await resolveInstance(args.instanceId);
    const result = await callHa(instance, { path: "/api/", timeoutMs: Number(args.timeoutMs || 10000) });
    return {
      text: `Connected to Home Assistant at ${instance.baseUrl}. Version: ${result?.version || "unknown"}.`,
      version: result?.version,
      instance: { instanceId: instance.instanceId, label: instance.label, baseUrl: instance.baseUrl }
    };
  }

  async function listDevices(args = {}) {
    const instance = await resolveInstance(args.instanceId);
    const states = await callHa(instance, { path: "/api/states", timeoutMs: Number(args.timeoutMs || 20000) });
    const allStates = Array.isArray(states) ? states : [];
    const domain = String(args.domain || "").trim().toLowerCase();
    const filtered = domain
      ? allStates.filter((s) => String(s?.entity_id || "").startsWith(`${domain}.`))
      : allStates;

    const rawEntities = filtered.map((s) => ({
      entity_id: s.entity_id,
      state: s.state,
      friendly_name: s.attributes?.friendly_name,
      last_changed: s.last_changed
    }));

    // Plugins can annotate each entity with room, group, tags, etc.
    const enriched = await hook("iot:list-devices:enrich", {
      instanceId: instance.instanceId,
      domain: domain || null,
      entities: rawEntities
    });

    const entities = Array.isArray(enriched?.entities) ? enriched.entities : rawEntities;
    return {
      text: `Found ${entities.length} entit${entities.length === 1 ? "y" : "ies"}${domain ? ` in domain "${domain}"` : ""} on ${instance.label || instance.instanceId}.`,
      entities
    };
  }

  async function getState(args = {}) {
    const entityId = normalizeEntityId(args.entityId || args.entity_id || "");
    if (!entityId) throw new Error("entityId is required");
    const instance = await resolveInstance(args.instanceId);
    const state = await callHa(instance, { path: `/api/states/${entityId}`, timeoutMs: Number(args.timeoutMs || 10000) });
    return {
      text: `${entityId} is ${state.state}${state.attributes?.friendly_name ? ` (${state.attributes.friendly_name})` : ""}.`,
      entity_id: state.entity_id,
      state: state.state,
      attributes: state.attributes || {},
      last_changed: state.last_changed,
      last_updated: state.last_updated
    };
  }

  async function callService(args = {}) {
    const serviceDomain = String(args.domain || args.serviceDomain || "").trim().toLowerCase();
    const service = String(args.service || "").trim().toLowerCase();
    if (!serviceDomain) throw new Error("domain is required (e.g. light, switch, climate)");
    if (!service) throw new Error("service is required (e.g. turn_on, turn_off)");
    const instance = await resolveInstance(args.instanceId);
    let entityId = normalizeEntityId(args.entityId || args.entity_id || "");
    const serviceData = args.serviceData && typeof args.serviceData === "object" ? args.serviceData : {};

    // Plugins can resolve logical targets ("living room", "bedroom group") to entity lists.
    if (entityId) {
      const resolved = await hook("iot:resolve-target", {
        instanceId: instance.instanceId,
        target: entityId,
        entityIds: []
      });
      if (Array.isArray(resolved?.entityIds) && resolved.entityIds.length > 0) {
        // Use resolved entity list — pass as array to HA
        const body = { ...serviceData, entity_id: resolved.entityIds };
        const beforePayload = await hook("iot:before-service-call", {
          instanceId: instance.instanceId,
          domain: serviceDomain,
          service,
          entityId,
          entityIds: resolved.entityIds,
          body,
          skip: false
        });
        if (beforePayload?.skip === true) {
          return beforePayload.skipResult || { text: `Service call ${serviceDomain}.${service} skipped by plugin.`, skipped: true };
        }
        const finalBody = beforePayload?.body && typeof beforePayload.body === "object" ? beforePayload.body : body;
        const result = await callHa(instance, {
          method: "POST",
          path: `/api/services/${serviceDomain}/${service}`,
          body: finalBody,
          timeoutMs: Number(args.timeoutMs || 15000)
        });
        const changed = Array.isArray(result) ? result.length : 0;
        const response = {
          text: `Called ${serviceDomain}.${service} on ${resolved.entityIds.length} entities. ${changed} state${changed === 1 ? "" : "s"} changed.`,
          domain: serviceDomain,
          service,
          entityIds: resolved.entityIds,
          statesChanged: Array.isArray(result) ? result.map((s) => s.entity_id) : []
        };
        await hook("iot:after-service-call", { instanceId: instance.instanceId, domain: serviceDomain, service, entityId, entityIds: resolved.entityIds, body: finalBody, result: response });
        return response;
      }
    }

    // Standard single-entity or no-entity call
    const body = { ...serviceData, ...(entityId ? { entity_id: entityId } : {}) };
    const beforePayload = await hook("iot:before-service-call", {
      instanceId: instance.instanceId,
      domain: serviceDomain,
      service,
      entityId,
      entityIds: entityId ? [entityId] : [],
      body,
      skip: false
    });
    if (beforePayload?.skip === true) {
      return beforePayload.skipResult || { text: `Service call ${serviceDomain}.${service} skipped by plugin.`, skipped: true };
    }
    const finalBody = beforePayload?.body && typeof beforePayload.body === "object" ? beforePayload.body : body;
    const finalEntityId = beforePayload?.entityId !== undefined ? beforePayload.entityId : entityId;

    const result = await callHa(instance, {
      method: "POST",
      path: `/api/services/${serviceDomain}/${service}`,
      body: finalBody,
      timeoutMs: Number(args.timeoutMs || 15000)
    });
    const changed = Array.isArray(result) ? result.length : 0;
    const response = {
      text: `Called ${serviceDomain}.${service}${finalEntityId ? ` on ${finalEntityId}` : ""}. ${changed} state${changed === 1 ? "" : "s"} changed.`,
      domain: serviceDomain,
      service,
      entity_id: finalEntityId || undefined,
      statesChanged: Array.isArray(result) ? result.map((s) => s.entity_id) : []
    };
    await hook("iot:after-service-call", { instanceId: instance.instanceId, domain: serviceDomain, service, entityId: finalEntityId, entityIds: finalEntityId ? [finalEntityId] : [], body: finalBody, result: response });
    return response;
  }

  async function turnOn(args = {}) {
    return callService({ ...args, domain: "homeassistant", service: "turn_on" });
  }

  async function turnOff(args = {}) {
    return callService({ ...args, domain: "homeassistant", service: "turn_off" });
  }

  async function toggle(args = {}) {
    return callService({ ...args, domain: "homeassistant", service: "toggle" });
  }

  return {
    // Instance management
    listInstances,
    saveInstance,
    removeInstance,
    testConnection,
    // Device/entity operations
    listDevices,
    getState,
    callService,
    turnOn,
    turnOff,
    toggle,
    // Raw HA access for plugins and advanced workers
    callHaForInstance
  };
}
