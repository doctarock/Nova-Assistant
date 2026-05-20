(() => {
const observerApp = window.ObserverApp || (window.ObserverApp = {});
const {
  activateTab,
  activateNovaSubtab,
  activateSecretsSubtab,
  activateSystemSubtab,
  escapeAttr,
  escapeHtml
} = observerApp;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function getSelectedMountIdsForPlugin() {
  return typeof observerApp.getSelectedMountIds === "function"
    ? observerApp.getSelectedMountIds()
    : [];
}
let pluginCatalogDraft = null;
let pluginPermissionRulesDraft = null;
let pluginTaskLifecycleLastTaskId = "";
let pluginDynamicPanelDraftByKey = new Map();
let pluginDynamicPanelIndex = new Map();
let pluginDynamicPanelEventsBound = false;
let pluginAdminTokenCache = "";
let pluginTopLevelTabModuleByScript = new Map();
let pluginNovaTabModuleByScript = new Map();
let pluginSecretsTabModuleByScript = new Map();
let pluginSystemTabModuleByScript = new Map();

async function getAdminUiToken(forceRefresh = false) {
  if (!forceRefresh && pluginAdminTokenCache) {
    return pluginAdminTokenCache;
  }
  const tokenRes = await fetch("/api/admin-token");
  const tokenJson = await tokenRes.json().catch(() => ({}));
  const token = String(tokenJson?.token || "").trim();
  if (!token) {
    throw new Error(tokenJson?.error || "admin token unavailable");
  }
  pluginAdminTokenCache = token;
  return token;
}

async function pluginAdminFetch(url = "", options = {}) {
  const token = await getAdminUiToken();
  const headers = {
    ...(options?.headers && typeof options.headers === "object" ? options.headers : {}),
    "x-admin-token": token
  };
  return fetch(url, {
    ...options,
    headers
  });
}

function getInstalledPlugins() {
  return Array.isArray(pluginCatalogDraft?.plugins)
    ? pluginCatalogDraft.plugins.filter((plugin) => plugin && typeof plugin === "object")
    : [];
}

function isPluginInstalled(pluginId = "") {
  const normalizedId = String(pluginId || "").trim().toLowerCase();
  if (!normalizedId) {
    return false;
  }
  return getInstalledPlugins().some((plugin) =>
    String(plugin.id || "").trim().toLowerCase() === normalizedId
    && plugin.enabled !== false
  );
}

function normalizePluginUiToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizePluginUiTabs() {
  const tabs = Array.isArray(pluginCatalogDraft?.uiTabs)
    ? pluginCatalogDraft.uiTabs
    : [];
  return tabs
    .filter((tab) => tab && typeof tab === "object")
    .map((tab) => ({
      id: normalizePluginUiToken(tab.id || tab.name || tab.title),
      pluginId: normalizePluginUiToken(tab.pluginId || ""),
      title: String(tab.title || tab.id || "Plugin").trim() || "Plugin",
      icon: String(tab.icon || tab.title || "P").trim().slice(0, 4) || "P",
      order: Number.isFinite(Number(tab.order)) ? Number(tab.order) : 100,
      scriptUrl: String(tab.scriptUrl || tab.script || "").trim(),
      enabled: tab.enabled !== false
    }))
    .filter((tab) => tab.id && tab.pluginId && tab.scriptUrl && tab.scriptUrl.startsWith("/") && tab.enabled !== false && isPluginInstalled(tab.pluginId))
    .sort((left, right) => {
      const orderDelta = Number(left.order || 100) - Number(right.order || 100);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return String(left.title || left.id).localeCompare(String(right.title || right.id));
    });
}

function normalizePluginUiSecretsTabs() {
  const tabs = Array.isArray(pluginCatalogDraft?.uiSecretsTabs)
    ? pluginCatalogDraft.uiSecretsTabs
    : [];
  return tabs
    .filter((tab) => tab && typeof tab === "object")
    .map((tab) => ({
      id: normalizePluginUiToken(tab.id || tab.name || tab.title),
      pluginId: normalizePluginUiToken(tab.pluginId || ""),
      title: String(tab.title || tab.id || "Plugin").trim() || "Plugin",
      order: Number.isFinite(Number(tab.order)) ? Number(tab.order) : 100,
      scriptUrl: String(tab.scriptUrl || tab.script || "").trim(),
      enabled: tab.enabled !== false
    }))
    .filter((tab) => tab.id && tab.pluginId && tab.scriptUrl && tab.scriptUrl.startsWith("/") && tab.enabled !== false && isPluginInstalled(tab.pluginId))
    .sort((left, right) => {
      const orderDelta = Number(left.order || 100) - Number(right.order || 100);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return String(left.title || left.id).localeCompare(String(right.title || right.id));
    });
}

function normalizePluginUiNovaTabs() {
  const tabs = Array.isArray(pluginCatalogDraft?.uiNovaTabs)
    ? pluginCatalogDraft.uiNovaTabs
    : [];
  return tabs
    .filter((tab) => tab && typeof tab === "object")
    .map((tab) => ({
      id: normalizePluginUiToken(tab.id || tab.name || tab.title),
      pluginId: normalizePluginUiToken(tab.pluginId || ""),
      title: String(tab.title || tab.id || "Plugin").trim() || "Plugin",
      order: Number.isFinite(Number(tab.order)) ? Number(tab.order) : 100,
      scriptUrl: String(tab.scriptUrl || tab.script || "").trim(),
      enabled: tab.enabled !== false
    }))
    .filter((tab) => tab.id && tab.pluginId && tab.scriptUrl && tab.scriptUrl.startsWith("/") && tab.enabled !== false && isPluginInstalled(tab.pluginId))
    .sort((left, right) => {
      const orderDelta = Number(left.order || 100) - Number(right.order || 100);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return String(left.title || left.id).localeCompare(String(right.title || right.id));
    });
}

function normalizePluginUiSystemTabs() {
  const tabs = Array.isArray(pluginCatalogDraft?.uiSystemTabs)
    ? pluginCatalogDraft.uiSystemTabs
    : [];
  return tabs
    .filter((tab) => tab && typeof tab === "object")
    .map((tab) => ({
      id: normalizePluginUiToken(tab.id || tab.name || tab.title),
      pluginId: normalizePluginUiToken(tab.pluginId || ""),
      title: String(tab.title || tab.id || "Plugin").trim() || "Plugin",
      order: Number.isFinite(Number(tab.order)) ? Number(tab.order) : 100,
      scriptUrl: String(tab.scriptUrl || tab.script || "").trim(),
      enabled: tab.enabled !== false
    }))
    .filter((tab) => tab.id && tab.pluginId && tab.scriptUrl && tab.scriptUrl.startsWith("/") && tab.enabled !== false && isPluginInstalled(tab.pluginId))
    .sort((left, right) => {
      const orderDelta = Number(left.order || 100) - Number(right.order || 100);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return String(left.title || left.id).localeCompare(String(right.title || right.id));
    });
}

async function mountPluginTopLevelTab(tab = {}, mountEl = null) {
  if (!tab.scriptUrl || !(mountEl instanceof HTMLElement)) {
    return;
  }
  const cacheKey = String(tab.scriptUrl || "").trim();
  if (!cacheKey) {
    return;
  }
  let moduleExports = pluginTopLevelTabModuleByScript.get(cacheKey);
  if (!moduleExports) {
    moduleExports = await import(`${cacheKey}${cacheKey.includes("?") ? "&" : "?"}v=${Date.now()}`);
    pluginTopLevelTabModuleByScript.set(cacheKey, moduleExports);
  }
  if (typeof moduleExports?.mountPluginTab === "function") {
    await moduleExports.mountPluginTab({
      tab,
      root: mountEl,
      observerApp: window.ObserverApp || {},
      pluginAdminFetch
    });
  }
}

async function mountPluginSecretsTab(tab = {}, mountEl = null) {
  if (!tab.scriptUrl || !(mountEl instanceof HTMLElement)) {
    return;
  }
  const cacheKey = String(tab.scriptUrl || "").trim();
  if (!cacheKey) {
    return;
  }
  let moduleExports = pluginSecretsTabModuleByScript.get(cacheKey);
  if (!moduleExports) {
    moduleExports = await import(`${cacheKey}${cacheKey.includes("?") ? "&" : "?"}v=${Date.now()}`);
    pluginSecretsTabModuleByScript.set(cacheKey, moduleExports);
  }
  if (typeof moduleExports?.mountPluginTab === "function") {
    await moduleExports.mountPluginTab({
      tab,
      root: mountEl,
      observerApp: window.ObserverApp || {},
      pluginAdminFetch
    });
  }
}

async function mountPluginNovaTab(tab = {}, mountEl = null) {
  if (!tab.scriptUrl || !(mountEl instanceof HTMLElement)) {
    return;
  }
  const cacheKey = String(tab.scriptUrl || "").trim();
  if (!cacheKey) {
    return;
  }
  let moduleExports = pluginNovaTabModuleByScript.get(cacheKey);
  if (!moduleExports) {
    moduleExports = await import(`${cacheKey}${cacheKey.includes("?") ? "&" : "?"}v=${Date.now()}`);
    pluginNovaTabModuleByScript.set(cacheKey, moduleExports);
  }
  if (typeof moduleExports?.mountPluginTab === "function") {
    await moduleExports.mountPluginTab({
      tab,
      root: mountEl,
      observerApp: window.ObserverApp || {},
      pluginAdminFetch
    });
  }
}

async function mountPluginSystemTab(tab = {}, mountEl = null) {
  if (!tab.scriptUrl || !(mountEl instanceof HTMLElement)) {
    return;
  }
  const cacheKey = String(tab.scriptUrl || "").trim();
  if (!cacheKey) {
    return;
  }
  let moduleExports = pluginSystemTabModuleByScript.get(cacheKey);
  if (!moduleExports) {
    moduleExports = await import(`${cacheKey}${cacheKey.includes("?") ? "&" : "?"}v=${Date.now()}`);
    pluginSystemTabModuleByScript.set(cacheKey, moduleExports);
  }
  if (typeof moduleExports?.mountPluginTab === "function") {
    await moduleExports.mountPluginTab({
      tab,
      root: mountEl,
      observerApp: window.ObserverApp || {},
      pluginAdminFetch
    });
  }
}

async function refreshPluginNovaTabs(options = {}) {
  const tabs = normalizePluginUiNovaTabs();
  for (const tab of tabs) {
    const panelId = `pluginNovaTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const mountEl = document.getElementById(`${panelId}_mount`);
    if (!(mountEl instanceof HTMLElement)) {
      continue;
    }
    const cacheKey = String(tab.scriptUrl || "").trim();
    const moduleExports = cacheKey ? pluginNovaTabModuleByScript.get(cacheKey) : null;
    if (typeof moduleExports?.refreshPluginTab === "function") {
      try {
        await moduleExports.refreshPluginTab({
          tab,
          root: mountEl,
          observerApp: window.ObserverApp || {},
          pluginAdminFetch,
          options
        });
      } catch {
        // Plugin refresh should not block the rest of the UI.
      }
    }
  }
}

async function refreshPluginSecretsTabs(options = {}) {
  const tabs = normalizePluginUiSecretsTabs();
  for (const tab of tabs) {
    const panelId = `pluginSecretsTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const mountEl = document.getElementById(`${panelId}_mount`);
    if (!(mountEl instanceof HTMLElement)) {
      continue;
    }
    const cacheKey = String(tab.scriptUrl || "").trim();
    const moduleExports = cacheKey ? pluginSecretsTabModuleByScript.get(cacheKey) : null;
    if (typeof moduleExports?.refreshPluginTab === "function") {
      try {
        await moduleExports.refreshPluginTab({
          tab,
          root: mountEl,
          observerApp: window.ObserverApp || {},
          pluginAdminFetch,
          options
        });
      } catch {
        // Plugin refresh should not block the rest of the UI.
      }
    }
  }
}

async function refreshPluginSystemTabs(options = {}) {
  const tabs = normalizePluginUiSystemTabs();
  for (const tab of tabs) {
    const panelId = `pluginSystemTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const mountEl = document.getElementById(`${panelId}_mount`);
    if (!(mountEl instanceof HTMLElement)) {
      continue;
    }
    const cacheKey = String(tab.scriptUrl || "").trim();
    const moduleExports = cacheKey ? pluginSystemTabModuleByScript.get(cacheKey) : null;
    if (typeof moduleExports?.refreshPluginTab === "function") {
      try {
        await moduleExports.refreshPluginTab({
          tab,
          root: mountEl,
          observerApp: window.ObserverApp || {},
          pluginAdminFetch,
          options
        });
      } catch {
        // Plugin refresh should not block the rest of the UI.
      }
    }
  }
}

async function renderPluginTopLevelTabs() {
  if (!tabBarEl || !(panelDrawerEl instanceof HTMLElement)) {
    return;
  }
  const tabs = normalizePluginUiTabs();
  const drawerContentEl = panelDrawerEl.querySelector(".drawer-content");
  if (!(drawerContentEl instanceof HTMLElement)) {
    return;
  }
  const existingButtons = Array.from(tabBarEl.querySelectorAll("[data-plugin-top-level-tab='true']"));
  const existingPanels = Array.from(document.querySelectorAll(".tab-panel[data-plugin-top-level-tab='true']"));
  existingButtons.forEach((button) => button.remove());
  existingPanels.forEach((panel) => {
    if (panel.classList.contains("active")) {
      activateTab("novaTab");
    }
    panel.remove();
  });

  if (!tabs.length) {
    return;
  }

  const insertionButton = tabBarEl.querySelector("[data-tab-target='queueTab']");
  const insertionPanel = drawerContentEl.querySelector("#queueTab");
  for (const tab of tabs) {
    const panelId = `pluginTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const button = document.createElement("button");
    button.className = "tab-button";
    button.type = "button";
    button.dataset.tabTarget = panelId;
    button.dataset.pluginTopLevelTab = "true";
    button.setAttribute("aria-label", tab.title);
    button.setAttribute("title", tab.title);
    button.innerHTML = `<span class="tab-icon">${escapeHtml(tab.icon || tab.title.slice(0, 1).toUpperCase())}</span>`;
    button.onclick = () => activateTab(panelId);
    if (insertionButton) {
      tabBarEl.insertBefore(button, insertionButton);
    } else {
      tabBarEl.appendChild(button);
    }

    const panel = document.createElement("div");
    panel.id = panelId;
    panel.className = "tab-panel";
    panel.dataset.pluginTopLevelTab = "true";
    panel.dataset.pluginId = tab.pluginId;
    panel.innerHTML = `<div class="tab-stack"><div id="${panelId}_mount" class="plugin-tab-mount"><div class="hint">Loading ${escapeHtml(tab.title)}...</div></div></div>`;
    if (insertionPanel) {
      drawerContentEl.insertBefore(panel, insertionPanel);
    } else {
      drawerContentEl.appendChild(panel);
    }

    const mountEl = panel.querySelector(`#${panelId}_mount`);
    try {
      await mountPluginTopLevelTab(tab, mountEl);
    } catch (error) {
      if (mountEl) {
        mountEl.innerHTML = `<div class="hint">Failed to load ${escapeHtml(tab.title)}: ${escapeHtml(error.message)}</div>`;
      }
    }
  }
}

async function renderPluginSecretsTabs() {
  const secretsTabEl = document.getElementById("secretsTab");
  if (!(secretsTabEl instanceof HTMLElement)) {
    return;
  }
  const subtabBarEl = secretsTabEl.querySelector(".secrets-subtab-bar");
  if (!(subtabBarEl instanceof HTMLElement)) {
    return;
  }
  const existingButtons = Array.from(subtabBarEl.querySelectorAll("[data-plugin-secrets-tab='true']"));
  const existingPanels = Array.from(secretsTabEl.querySelectorAll(".secrets-subtab-panel[data-plugin-secrets-tab='true']"));
  existingButtons.forEach((button) => button.remove());
  existingPanels.forEach((panel) => panel.remove());

  const tabs = normalizePluginUiSecretsTabs();
  if (!tabs.length) {
    activateSecretsSubtab(activeSecretsSubtabId || "secretsOverviewPanel");
    return;
  }

  const insertionButton = subtabBarEl.querySelector("[data-secrets-subtab-target='secretsRetrievalPanel']");
  const insertionPanel = secretsTabEl.querySelector("#secretsRetrievalPanel");
  const insertionPanelParent = insertionPanel?.parentElement || null;
  for (const tab of tabs) {
    const panelId = `pluginSecretsTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const button = document.createElement("button");
    button.className = "secrets-subtab-button";
    button.type = "button";
    button.dataset.secretsSubtabTarget = panelId;
    button.dataset.pluginSecretsTab = "true";
    button.textContent = tab.title;
    button.onclick = () => activateSecretsSubtab(panelId);
    if (insertionButton) {
      subtabBarEl.insertBefore(button, insertionButton);
    } else {
      subtabBarEl.appendChild(button);
    }

    const panel = document.createElement("section");
    panel.id = panelId;
    panel.className = "secrets-subtab-panel";
    panel.dataset.pluginSecretsTab = "true";
    panel.dataset.pluginId = tab.pluginId;
    panel.innerHTML = `<div id="${panelId}_mount" class="plugin-tab-mount"><div class="panel-subtle">Loading ${escapeHtml(tab.title)}...</div></div>`;
    if (insertionPanel && insertionPanelParent) {
      insertionPanelParent.insertBefore(panel, insertionPanel);
    } else {
      secretsTabEl.appendChild(panel);
    }

    const mountEl = panel.querySelector(`#${panelId}_mount`);
    try {
      await mountPluginSecretsTab(tab, mountEl);
    } catch (error) {
      if (mountEl) {
        mountEl.innerHTML = `<div class="panel-subtle">Failed to load ${escapeHtml(tab.title)}: ${escapeHtml(error.message)}</div>`;
      }
    }
  }
  activateSecretsSubtab(activeSecretsSubtabId || "secretsOverviewPanel");
}

async function renderPluginNovaTabs() {
  const novaTabEl = document.getElementById("novaTab");
  if (!(novaTabEl instanceof HTMLElement)) {
    return;
  }
  const subtabBarEl = novaTabEl.querySelector(".nova-subtab-bar");
  if (!(subtabBarEl instanceof HTMLElement)) {
    return;
  }
  const existingButtons = Array.from(subtabBarEl.querySelectorAll("[data-plugin-nova-tab='true']"));
  const existingPanels = Array.from(novaTabEl.querySelectorAll(".nova-subtab-panel[data-plugin-nova-tab='true']"));
  existingButtons.forEach((button) => button.remove());
  existingPanels.forEach((panel) => panel.remove());

  const tabs = normalizePluginUiNovaTabs();
  if (!tabs.length) {
    activateNovaSubtab(activeNovaSubtabId || "novaIdentityPanel");
    return;
  }

  for (const tab of tabs) {
    const panelId = `pluginNovaTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const button = document.createElement("button");
    button.className = "nova-subtab-button";
    button.type = "button";
    button.dataset.novaSubtabTarget = panelId;
    button.dataset.pluginNovaTab = "true";
    button.textContent = tab.title;
    button.onclick = () => activateNovaSubtab(panelId);
    subtabBarEl.appendChild(button);

    const panel = document.createElement("section");
    panel.id = panelId;
    panel.className = "nova-subtab-panel";
    panel.dataset.pluginNovaTab = "true";
    panel.dataset.pluginId = tab.pluginId;
    panel.innerHTML = `<div id="${panelId}_mount" class="plugin-tab-mount"><div class="panel-subtle">Loading ${escapeHtml(tab.title)}...</div></div>`;
    novaTabEl.appendChild(panel);

    const mountEl = panel.querySelector(`#${panelId}_mount`);
    try {
      await mountPluginNovaTab(tab, mountEl);
    } catch (error) {
      if (mountEl) {
        mountEl.innerHTML = `<div class="panel-subtle">Failed to load ${escapeHtml(tab.title)}: ${escapeHtml(error.message)}</div>`;
      }
    }
  }
  activateNovaSubtab(activeNovaSubtabId || "novaIdentityPanel");
}

async function renderPluginSystemTabs() {
  const systemTabEl = document.getElementById("systemTab");
  if (!(systemTabEl instanceof HTMLElement)) {
    return;
  }
  const subtabBarEl = systemTabEl.querySelector(".system-subtab-bar");
  if (!(subtabBarEl instanceof HTMLElement)) {
    return;
  }
  const existingButtons = Array.from(subtabBarEl.querySelectorAll("[data-plugin-system-tab='true']"));
  const existingPanels = Array.from(systemTabEl.querySelectorAll(".system-subtab-panel[data-plugin-system-tab='true']"));
  existingButtons.forEach((button) => button.remove());
  existingPanels.forEach((panel) => panel.remove());

  const tabs = normalizePluginUiSystemTabs();
  if (!tabs.length) {
    activateSystemSubtab?.(activeSystemSubtabId || "systemGatewayPanel");
    return;
  }

  for (const tab of tabs) {
    const panelId = `pluginSystemTab_${tab.pluginId}_${tab.id}`.replace(/[^a-z0-9_-]+/gi, "_");
    const button = document.createElement("button");
    button.className = "system-subtab-button";
    button.type = "button";
    button.dataset.systemSubtabTarget = panelId;
    button.dataset.pluginSystemTab = "true";
    button.textContent = tab.title;
    button.onclick = () => activateSystemSubtab?.(panelId);
    subtabBarEl.appendChild(button);

    const panel = document.createElement("section");
    panel.id = panelId;
    panel.className = "system-subtab-panel";
    panel.dataset.pluginSystemTab = "true";
    panel.dataset.pluginId = tab.pluginId;
    panel.innerHTML = `<div id="${panelId}_mount" class="plugin-tab-mount"><div class="panel-subtle">Loading ${escapeHtml(tab.title)}...</div></div>`;
    systemTabEl.querySelector(".inspector")?.appendChild(panel);

    const mountEl = panel.querySelector(`#${panelId}_mount`);
    try {
      await mountPluginSystemTab(tab, mountEl);
    } catch (error) {
      if (mountEl) {
        mountEl.innerHTML = `<div class="panel-subtle">Failed to load ${escapeHtml(tab.title)}: ${escapeHtml(error.message)}</div>`;
      }
    }
  }
  activateSystemSubtab?.(activeSystemSubtabId || "systemGatewayPanel");
}

function toPluginUiCamelCase(value = "") {
  const normalized = normalizePluginUiToken(value);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/[-_.]+([a-z0-9])/g, (_match, next) => String(next || "").toUpperCase());
}

function normalizePluginUiPanels() {
  const panels = Array.isArray(pluginCatalogDraft?.uiPanels)
    ? pluginCatalogDraft.uiPanels
    : [];
  const normalizedPanels = [];
  for (const panel of panels) {
    if (!panel || typeof panel !== "object") {
      continue;
    }
    const panelId = normalizePluginUiToken(panel.id || panel.panelId || panel.name || panel.title);
    const pluginId = normalizePluginUiToken(panel.pluginId || panel.plugin || "");
    if (!panelId || !pluginId) {
      continue;
    }
    const normalizedFields = Array.isArray(panel.fields)
      ? panel.fields.map((field) => {
        if (!field || typeof field !== "object") {
          return null;
        }
        const fieldId = normalizePluginUiToken(field.id || field.name || field.label);
        if (!fieldId) {
          return null;
        }
        const type = normalizePluginUiToken(field.type || "text");
        return {
          id: fieldId,
          label: String(field.label || fieldId).trim() || fieldId,
          type: ["text", "number", "checkbox", "textarea"].includes(type) ? type : "text",
          placeholder: String(field.placeholder || "").trim(),
          required: field.required === true,
          format: normalizePluginUiToken(field.format || ""),
          defaultValue: field.defaultValue
        };
      }).filter(Boolean)
      : [];
    const normalizedActions = Array.isArray(panel.actions)
      ? panel.actions.map((action) => {
        if (!action || typeof action !== "object") {
          return null;
        }
        const actionId = normalizePluginUiToken(action.id || action.name || action.label);
        const endpoint = String(action.endpoint || "").trim();
        if (!actionId || !endpoint) {
          return null;
        }
        const method = String(action.method || "GET").trim().toUpperCase() || "GET";
        return {
          id: actionId,
          label: String(action.label || actionId).trim() || actionId,
          method,
          endpoint,
          queryFields: Array.isArray(action.queryFields)
            ? action.queryFields.map((entry) => normalizePluginUiToken(entry)).filter(Boolean)
            : [],
          bodyFields: Array.isArray(action.bodyFields)
            ? action.bodyFields.map((entry) => normalizePluginUiToken(entry)).filter(Boolean)
            : [],
          staticBody: action.staticBody && typeof action.staticBody === "object"
            ? cloneJson(action.staticBody)
            : {},
          expects: normalizePluginUiToken(action.expects || "json") || "json",
          confirm: String(action.confirm || "").trim()
        };
      }).filter(Boolean)
      : [];
    normalizedPanels.push({
      id: panelId,
      pluginId,
      pluginName: String(panel.pluginName || panel.pluginId || pluginId).trim() || pluginId,
      title: String(panel.title || panel.name || panelId).trim() || panelId,
      description: String(panel.description || "").trim(),
      fields: normalizedFields,
      actions: normalizedActions
    });
  }
  return normalizedPanels.sort((left, right) => {
    const pluginCompare = String(left.pluginName || left.pluginId || "")
      .localeCompare(String(right.pluginName || right.pluginId || ""));
    if (pluginCompare !== 0) {
      return pluginCompare;
    }
    return String(left.title || left.id || "").localeCompare(String(right.title || right.id || ""));
  });
}

function pluginUiPanelKey(panel = {}) {
  const pluginId = normalizePluginUiToken(panel.pluginId || "");
  const panelId = normalizePluginUiToken(panel.id || "");
  if (!pluginId || !panelId) {
    return "";
  }
  return `${pluginId}:${panelId}`;
}

function ensurePluginDynamicPanelDraft(panel = {}) {
  const key = pluginUiPanelKey(panel);
  if (!key) {
    return {};
  }
  const existing = pluginDynamicPanelDraftByKey.get(key);
  if (existing && typeof existing === "object") {
    return existing;
  }
  const nextDraft = {};
  for (const field of Array.isArray(panel.fields) ? panel.fields : []) {
    if (!field?.id) {
      continue;
    }
    if (field.type === "checkbox") {
      nextDraft[field.id] = field.defaultValue === true;
      continue;
    }
    if (field.type === "number") {
      if (field.defaultValue == null || field.defaultValue === "") {
        nextDraft[field.id] = "";
      } else {
        const parsed = Number(field.defaultValue);
        nextDraft[field.id] = Number.isFinite(parsed) ? parsed : "";
      }
      continue;
    }
    if (field.defaultValue == null) {
      nextDraft[field.id] = "";
      continue;
    }
    if (field.format === "json" && typeof field.defaultValue === "object") {
      nextDraft[field.id] = cloneJson(field.defaultValue);
      continue;
    }
    nextDraft[field.id] = String(field.defaultValue);
  }
  pluginDynamicPanelDraftByKey.set(key, nextDraft);
  return nextDraft;
}

function prunePluginDynamicPanelDraft(allowedKeys = []) {
  const allowed = new Set(
    (Array.isArray(allowedKeys) ? allowedKeys : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
  );
  for (const key of pluginDynamicPanelDraftByKey.keys()) {
    if (!allowed.has(key)) {
      pluginDynamicPanelDraftByKey.delete(key);
    }
  }
}

function pluginFieldDisplayValue(panelKey = "", field = {}) {
  const draft = pluginDynamicPanelDraftByKey.get(panelKey) || {};
  const hasValue = Object.prototype.hasOwnProperty.call(draft, field.id);
  const rawValue = hasValue ? draft[field.id] : field.defaultValue;
  if (field.type === "checkbox") {
    return rawValue === true;
  }
  if (field.type === "number") {
    if (rawValue == null || rawValue === "") {
      return "";
    }
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? String(parsed) : "";
  }
  if (rawValue == null) {
    return "";
  }
  if (field.format === "json") {
    if (typeof rawValue === "string") {
      return rawValue;
    }
    try {
      return JSON.stringify(rawValue, null, 2);
    } catch {
      return "";
    }
  }
  return String(rawValue);
}

function renderPluginDynamicPanelField(panelKey = "", field = {}) {
  const fieldId = String(field.id || "").trim();
  if (!fieldId) {
    return "";
  }
  if (field.type === "checkbox") {
    const checked = pluginFieldDisplayValue(panelKey, field) === true;
    return `
      <label class="micro plugin-ui-checkbox">
        <input
          type="checkbox"
          data-plugin-ui-panel-key="${escapeAttr(panelKey)}"
          data-plugin-ui-field-id="${escapeAttr(fieldId)}"
          ${checked ? "checked" : ""}
        />
        ${escapeHtml(field.label || fieldId)}${field.required ? " *" : ""}
      </label>
    `;
  }
  const placeholder = String(field.placeholder || "").trim();
  const currentValue = pluginFieldDisplayValue(panelKey, field);
  const minAttr = field.min == null || Number.isNaN(Number(field.min)) ? "" : ` min="${escapeAttr(String(Number(field.min)))}"`;
  const maxAttr = field.max == null || Number.isNaN(Number(field.max)) ? "" : ` max="${escapeAttr(String(Number(field.max)))}"`;
  const stepAttr = field.step == null || Number.isNaN(Number(field.step)) ? "" : ` step="${escapeAttr(String(Number(field.step)))}"`;
  const requiredMarker = field.required ? " *" : "";
  if (field.type === "textarea") {
    return `
      <label class="stack-field plugin-ui-field">
        <strong>${escapeHtml(field.label || fieldId)}${requiredMarker}</strong>
        <textarea
          rows="4"
          data-plugin-ui-panel-key="${escapeAttr(panelKey)}"
          data-plugin-ui-field-id="${escapeAttr(fieldId)}"
          placeholder="${escapeAttr(placeholder)}"
        >${escapeHtml(String(currentValue || ""))}</textarea>
      </label>
    `;
  }
  const inputType = field.type === "number" ? "number" : "text";
  return `
    <label class="stack-field plugin-ui-field">
      <strong>${escapeHtml(field.label || fieldId)}${requiredMarker}</strong>
      <input
        type="${escapeAttr(inputType)}"
        data-plugin-ui-panel-key="${escapeAttr(panelKey)}"
        data-plugin-ui-field-id="${escapeAttr(fieldId)}"
        value="${escapeAttr(String(currentValue || ""))}"
        placeholder="${escapeAttr(placeholder)}"${minAttr}${maxAttr}${stepAttr}
      />
    </label>
  `;
}

function normalizePluginDynamicInputValue(field = {}, element = null) {
  if (!element) {
    return "";
  }
  if (field.type === "checkbox") {
    return element.checked === true;
  }
  if (field.type === "number") {
    const rawValue = String(element.value || "").trim();
    if (!rawValue) {
      return "";
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${field.label || field.id || "Field"} must be a valid number.`);
    }
    return parsed;
  }
  const rawText = String(element.value || "");
  if (field.format === "json") {
    const trimmed = rawText.trim();
    if (!trimmed) {
      return "";
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`${field.label || field.id || "Field"} must contain valid JSON.`);
    }
  }
  return rawText.trim();
}

function shouldIncludePluginDynamicValue(value) {
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return true;
  }
  return true;
}

function pluginDynamicValueToQueryValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pluginDynamicPayloadKeys(fieldId = "") {
  const normalizedFieldId = normalizePluginUiToken(fieldId);
  if (!normalizedFieldId) {
    return [];
  }
  const keys = new Set([normalizedFieldId]);
  const camelCaseKey = toPluginUiCamelCase(normalizedFieldId);
  if (camelCaseKey) {
    keys.add(camelCaseKey);
  }
  if (normalizedFieldId.endsWith("_json")) {
    const base = normalizedFieldId.slice(0, -5);
    if (base) {
      keys.add(base);
      const camelBase = toPluginUiCamelCase(base);
      if (camelBase) {
        keys.add(camelBase);
      }
    }
  }
  if (camelCaseKey && camelCaseKey.endsWith("Json")) {
    const camelBase = camelCaseKey.slice(0, -4);
    if (camelBase) {
      keys.add(camelBase);
    }
  }
  return [...keys].filter(Boolean);
}

function updatePluginDynamicPanelDraft(panelKey = "", fieldId = "", value = "") {
  const normalizedPanelKey = String(panelKey || "").trim();
  const normalizedFieldId = normalizePluginUiToken(fieldId);
  if (!normalizedPanelKey || !normalizedFieldId) {
    return;
  }
  const existing = pluginDynamicPanelDraftByKey.get(normalizedPanelKey) || {};
  pluginDynamicPanelDraftByKey.set(normalizedPanelKey, {
    ...existing,
    [normalizedFieldId]: value
  });
}

function pluginDynamicPanelElements(panelKey = "") {
  if (!pluginDynamicPanelsListEl) {
    return {
      panelRoot: null,
      statusEl: null,
      resultEl: null
    };
  }
  const panelRoot = pluginDynamicPanelsListEl.querySelector(`[data-plugin-ui-panel-key="${panelKey}"]`);
  if (!panelRoot) {
    return {
      panelRoot: null,
      statusEl: null,
      resultEl: null
    };
  }
  return {
    panelRoot,
    statusEl: panelRoot.querySelector("[data-plugin-ui-status]"),
    resultEl: panelRoot.querySelector("[data-plugin-ui-result]")
  };
}

function setPluginDynamicPanelStatus(panelKey = "", message = "") {
  const { statusEl } = pluginDynamicPanelElements(panelKey);
  if (statusEl) {
    statusEl.textContent = String(message || "").trim() || "Ready.";
  }
}

function setPluginDynamicPanelResult(panelKey = "", payload = null) {
  const { resultEl } = pluginDynamicPanelElements(panelKey);
  if (!resultEl) {
    return;
  }
  if (typeof payload === "string") {
    resultEl.textContent = payload;
    return;
  }
  resultEl.textContent = JSON.stringify(payload == null ? {} : payload, null, 2);
}

function renderPluginDynamicPanels() {
  if (!pluginDynamicPanelsListEl) {
    return;
  }
  const panels = normalizePluginUiPanels();
  const panelKeys = [];
  pluginDynamicPanelIndex = new Map();
  for (const panel of panels) {
    const panelKey = pluginUiPanelKey(panel);
    if (!panelKey) {
      continue;
    }
    panelKeys.push(panelKey);
    pluginDynamicPanelIndex.set(panelKey, panel);
    ensurePluginDynamicPanelDraft(panel);
  }
  prunePluginDynamicPanelDraft(panelKeys);
  if (!panels.length) {
    pluginDynamicPanelsListEl.innerHTML = `<div class="panel-subtle">No plugin UI panels are currently registered.</div>`;
    return;
  }
  pluginDynamicPanelsListEl.innerHTML = panels.map((panel) => {
    const panelKey = pluginUiPanelKey(panel);
    const actions = Array.isArray(panel.actions) ? panel.actions : [];
    const fields = Array.isArray(panel.fields) ? panel.fields : [];
    const actionSummary = actions.length
      ? actions.map((action) =>
        `${String(action.method || "GET").toUpperCase()} ${String(action.endpoint || "").trim()}`
      ).join(" | ")
      : "No actions registered";
    return `
      <div class="brain-row plugin-ui-panel" data-plugin-ui-panel-key="${escapeAttr(panelKey)}">
        <div class="brain-row-actions">
          <span>
            <strong>${escapeHtml(String(panel.title || panel.id || "Plugin Panel"))}</strong>
            <div class="micro">${escapeHtml(String(panel.pluginName || panel.pluginId || "Plugin"))} (${escapeHtml(String(panel.pluginId || ""))})</div>
          </span>
          <span class="brain-pill">${escapeHtml(`${actions.length} action${actions.length === 1 ? "" : "s"}`)}</span>
        </div>
        <div class="micro">${escapeHtml(String(panel.description || "No description provided."))}</div>
        <div class="plugin-ui-fields">
          ${fields.length
            ? fields.map((field) => renderPluginDynamicPanelField(panelKey, field)).join("")
            : `<div class="panel-subtle">No configurable fields.</div>`}
        </div>
        <div class="plugin-ui-actions">
          ${actions.length
            ? actions.map((action) => `
              <button
                class="secondary"
                type="button"
                data-plugin-ui-panel-key="${escapeAttr(panelKey)}"
                data-plugin-ui-action-id="${escapeAttr(String(action.id || ""))}"
              >${escapeHtml(String(action.label || action.id || "Run"))}</button>
            `).join("")
            : `<div class="panel-subtle">No actions registered.</div>`}
        </div>
        <div class="micro">${escapeHtml(actionSummary)}</div>
        <div class="micro" data-plugin-ui-status>Ready.</div>
        <pre class="json-box plugin-ui-result" data-plugin-ui-result>No action run yet.</pre>
      </div>
    `;
  }).join("");
}

async function runPluginDynamicPanelAction(button = null) {
  if (!button || !pluginDynamicPanelsListEl) {
    return;
  }
  const panelKey = String(button.dataset.pluginUiPanelKey || "").trim();
  const actionId = normalizePluginUiToken(button.dataset.pluginUiActionId || "");
  if (!panelKey || !actionId) {
    return;
  }
  const panel = pluginDynamicPanelIndex.get(panelKey);
  if (!panel) {
    return;
  }
  const action = (Array.isArray(panel.actions) ? panel.actions : [])
    .find((entry) => normalizePluginUiToken(entry.id) === actionId);
  if (!action) {
    return;
  }
  const { panelRoot } = pluginDynamicPanelElements(panelKey);
  if (!panelRoot) {
    return;
  }
  button.disabled = true;
  try {
    const fieldValues = {};
    for (const field of Array.isArray(panel.fields) ? panel.fields : []) {
      const input = panelRoot.querySelector(`[data-plugin-ui-field-id="${field.id}"]`);
      if (!input) {
        continue;
      }
      const value = normalizePluginDynamicInputValue(field, input);
      fieldValues[field.id] = value;
      updatePluginDynamicPanelDraft(panelKey, field.id, value);
    }
    const referencedFieldIds = new Set([
      ...(Array.isArray(action.queryFields) ? action.queryFields : []),
      ...(Array.isArray(action.bodyFields) ? action.bodyFields : [])
    ]);
    for (const field of Array.isArray(panel.fields) ? panel.fields : []) {
      if (!field.required || !referencedFieldIds.has(field.id)) {
        continue;
      }
      if (!shouldIncludePluginDynamicValue(fieldValues[field.id])) {
        throw new Error(`${field.label || field.id || "Required field"} is required.`);
      }
    }
    if (action.confirm && typeof window !== "undefined" && typeof window.confirm === "function") {
      const confirmed = window.confirm(action.confirm);
      if (!confirmed) {
        setPluginDynamicPanelStatus(panelKey, "Action cancelled.");
        return;
      }
    }
    const method = String(action.method || "GET").trim().toUpperCase() || "GET";
    const query = new URLSearchParams();
    for (const fieldId of Array.isArray(action.queryFields) ? action.queryFields : []) {
      const value = fieldValues[fieldId];
      if (!shouldIncludePluginDynamicValue(value)) {
        continue;
      }
      for (const key of pluginDynamicPayloadKeys(fieldId)) {
        query.set(key, pluginDynamicValueToQueryValue(value));
      }
    }
    const queryString = query.toString();
    const endpoint = String(action.endpoint || "").trim();
    const requestPath = queryString
      ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}${queryString}`
      : endpoint;
    let requestBody = null;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const body = cloneJson(action.staticBody || {});
      for (const fieldId of Array.isArray(action.bodyFields) ? action.bodyFields : []) {
        const value = fieldValues[fieldId];
        if (!shouldIncludePluginDynamicValue(value)) {
          continue;
        }
        for (const key of pluginDynamicPayloadKeys(fieldId)) {
          body[key] = value;
        }
      }
      requestBody = JSON.stringify(body);
    }
    setPluginDynamicPanelStatus(panelKey, `Running ${action.label || action.id || "action"}...`);
    const runFetch = /^\/api\/plugins(?:\/|$)/i.test(requestPath)
      ? pluginAdminFetch
      : fetch;
    const response = await runFetch(requestPath, {
      method,
      headers: requestBody == null ? {} : { "content-type": "application/json" },
      body: requestBody
    });
    const rawBody = await response.text();
    const expectsText = action.expects === "text";
    let payload = rawBody;
    if (!expectsText) {
      if (!rawBody) {
        payload = {};
      } else {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = {
            ok: response.ok,
            raw: rawBody
          };
        }
      }
    }
    const payloadError = !expectsText && payload && typeof payload === "object"
      ? String(payload.error || payload.message || "").trim()
      : "";
    if (!response.ok || payloadError) {
      throw new Error(payloadError || rawBody || `request failed (${response.status})`);
    }
    setPluginDynamicPanelStatus(panelKey, `Completed ${action.label || action.id || "action"}.`);
    setPluginDynamicPanelResult(panelKey, payload);
    if (/^\/api\/plugins\/[^/]+\/toggle(?:\?|$)/i.test(requestPath)) {
      await loadPluginManagerPanel({ silent: true });
    }
  } catch (error) {
    setPluginDynamicPanelStatus(panelKey, `Action failed: ${error.message}`);
    setPluginDynamicPanelResult(panelKey, String(error?.message || error || "unknown error"));
  } finally {
    button.disabled = false;
  }
}

function bindPluginDynamicPanelEvents() {
  if (!pluginDynamicPanelsListEl || pluginDynamicPanelEventsBound) {
    return;
  }
  pluginDynamicPanelsListEl.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const panelKey = String(target.getAttribute("data-plugin-ui-panel-key") || "").trim();
    const fieldId = normalizePluginUiToken(target.getAttribute("data-plugin-ui-field-id") || "");
    if (!panelKey || !fieldId) {
      return;
    }
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      updatePluginDynamicPanelDraft(panelKey, fieldId, target.checked === true);
      return;
    }
    if ("value" in target) {
      updatePluginDynamicPanelDraft(panelKey, fieldId, String(target.value || ""));
    }
  });

  pluginDynamicPanelsListEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const actionButton = target.closest("[data-plugin-ui-action-id]");
    if (!(actionButton instanceof HTMLButtonElement)) {
      return;
    }
    runPluginDynamicPanelAction(actionButton).catch((error) => {
      console.warn("plugin dynamic panel action failed", error);
    });
  });
  pluginDynamicPanelEventsBound = true;
}

function setPluginControlsAvailability() {
  const hasPermissionRules = isPluginInstalled("security");
  if (refreshPluginPermissionsBtn) {
    refreshPluginPermissionsBtn.disabled = !hasPermissionRules;
  }
  if (savePluginPermissionsBtn) {
    savePluginPermissionsBtn.disabled = !hasPermissionRules;
  }
  if (pluginPermissionRulesEditorEl) {
    pluginPermissionRulesEditorEl.disabled = !hasPermissionRules;
    if (!hasPermissionRules) {
      pluginPermissionRulesEditorEl.value = "";
    }
  }
  if (pluginPermissionRulesStatusEl && !hasPermissionRules) {
    pluginPermissionRulesStatusEl.textContent = "Permission Rules plugin is not installed.";
  }

  const hasSessionMemory = isPluginInstalled("session-memory");
  if (refreshPluginSessionMemoryBtn) {
    refreshPluginSessionMemoryBtn.disabled = !hasSessionMemory;
  }
  if (capturePluginSessionMemoryBtn) {
    capturePluginSessionMemoryBtn.disabled = !hasSessionMemory;
  }
  if (pluginSessionTaskIdEl) {
    pluginSessionTaskIdEl.disabled = !hasSessionMemory;
    if (!hasSessionMemory) {
      pluginSessionTaskIdEl.value = "";
    }
  }
  if (!hasSessionMemory) {
    if (pluginSessionMemoryStatusEl) {
      pluginSessionMemoryStatusEl.textContent = "Session Memory plugin is not installed.";
    }
    if (pluginSessionMemoryResultEl) {
      pluginSessionMemoryResultEl.textContent = "Session Memory plugin is not installed.";
    }
  }

  const hasTaskLifecycle = isPluginInstalled("task-lifecycle");
  if (refreshPluginTaskLifecycleBtn) {
    refreshPluginTaskLifecycleBtn.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleTaskIdEl) {
    pluginTaskLifecycleTaskIdEl.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleTimeoutMsEl) {
    pluginTaskLifecycleTimeoutMsEl.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleCreateMessageEl) {
    pluginTaskLifecycleCreateMessageEl.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleCreateBtn) {
    pluginTaskLifecycleCreateBtn.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleOutputBtn) {
    pluginTaskLifecycleOutputBtn.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleWaitBtn) {
    pluginTaskLifecycleWaitBtn.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleStopBtn) {
    pluginTaskLifecycleStopBtn.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleForceStopEl) {
    pluginTaskLifecycleForceStopEl.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleAnswerEl) {
    pluginTaskLifecycleAnswerEl.disabled = !hasTaskLifecycle;
  }
  if (pluginTaskLifecycleAnswerBtn) {
    pluginTaskLifecycleAnswerBtn.disabled = !hasTaskLifecycle;
  }
  if (!hasTaskLifecycle) {
    if (pluginTaskLifecycleStatusEl) {
      pluginTaskLifecycleStatusEl.textContent = "Task Lifecycle plugin is not installed.";
    }
    if (pluginTaskLifecycleResultEl) {
      pluginTaskLifecycleResultEl.textContent = "Task Lifecycle plugin is not installed.";
    }
  }

  const hasCronHardening = isPluginInstalled("security");
  if (refreshPluginCronBtn) {
    refreshPluginCronBtn.disabled = !hasCronHardening;
  }
  if (!hasCronHardening && pluginCronStatusEl) {
    pluginCronStatusEl.textContent = "Cron Hardening plugin is not installed.";
  }
}

function renderPluginManagerPanel() {
  if (!pluginInventoryListEl || !pluginCapabilityListEl || !pluginRouteListEl) {
    return;
  }
  bindPluginDynamicPanelEvents();
  const plugins = getInstalledPlugins();
  if (!plugins.length) {
    pluginInventoryListEl.innerHTML = `<div class="panel-subtle">No plugins are currently loaded.</div>`;
    pluginCapabilityListEl.innerHTML = `<div class="panel-subtle">No plugin capabilities are currently registered.</div>`;
    pluginRouteListEl.innerHTML = `<div class="panel-subtle">No plugin routes are currently registered.</div>`;
    renderPluginDynamicPanels();
    setPluginControlsAvailability();
    return;
  }

  pluginInventoryListEl.innerHTML = plugins.map((plugin) => {
    const enabled = plugin.enabled !== false;
    const pluginId = String(plugin.id || "").trim();
    const capabilityCount = Number(plugin.capabilityCount || (Array.isArray(plugin.capabilities) ? plugin.capabilities.length : 0) || 0);
    const routeCount = Number(plugin.routeCount || (Array.isArray(plugin.routes) ? plugin.routes.length : 0) || 0);
    const hookCount = Number(plugin.hookCount || (Array.isArray(plugin.hooks) ? plugin.hooks.length : 0) || 0);
    return `
      <div class="brain-row">
        <div class="brain-row-actions">
          <label class="toggle plugin-toggle-row">
            <input type="checkbox" data-plugin-toggle-id="${escapeAttr(pluginId)}" ${enabled ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(String(plugin.name || plugin.id || "Plugin"))}</strong>
              <div class="micro">${escapeHtml(pluginId)} - v${escapeHtml(String(plugin.version || "0.0.0"))}</div>
            </span>
          </label>
          <span class="brain-pill plugin-enabled-pill ${enabled ? "on" : "off"}">${enabled ? "enabled" : "disabled"}</span>
        </div>
        <div class="micro">${escapeHtml(String(plugin.description || "No description provided."))}</div>
        <div class="micro">${escapeHtml(`${capabilityCount} cap${capabilityCount === 1 ? "" : "s"} - ${routeCount} route${routeCount === 1 ? "" : "s"} - ${hookCount} hook${hookCount === 1 ? "" : "s"}`)}</div>
      </div>
    `;
  }).join("");
  pluginInventoryListEl.querySelectorAll("[data-plugin-toggle-id]").forEach((inputEl) => {
    if (!(inputEl instanceof HTMLInputElement)) {
      return;
    }
    inputEl.onchange = async () => {
      const pluginId = String(inputEl.dataset.pluginToggleId || "").trim();
      if (!pluginId) {
        return;
      }
      const enabled = inputEl.checked === true;
      inputEl.disabled = true;
      pluginsHintEl.textContent = `${enabled ? "Enabling" : "Disabling"} ${pluginId}...`;
      try {
        const response = await pluginAdminFetch(`/api/plugins/${encodeURIComponent(pluginId)}/toggle`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `failed to toggle ${pluginId}`);
        }
        await loadPluginManagerPanel({ silent: true });
        pluginsHintEl.textContent = `${pluginId} ${enabled ? "enabled" : "disabled"}.`;
      } catch (error) {
        inputEl.checked = !enabled;
        pluginsHintEl.textContent = `Toggle failed for ${pluginId}: ${error.message}`;
      } finally {
        inputEl.disabled = false;
      }
    };
  });

  const capabilityProviders = new Map();
  for (const plugin of plugins) {
    const pluginLabel = String(plugin.name || plugin.id || "Plugin").trim() || "Plugin";
    const capabilities = Array.isArray(plugin.capabilities) ? plugin.capabilities : [];
    for (const capability of capabilities) {
      const capabilityName = String(capability || "").trim();
      if (!capabilityName) {
        continue;
      }
      const providers = capabilityProviders.get(capabilityName) || [];
      providers.push(pluginLabel);
      capabilityProviders.set(capabilityName, [...new Set(providers)]);
    }
  }
  const capabilityEntries = [...capabilityProviders.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  pluginCapabilityListEl.innerHTML = capabilityEntries.length
    ? capabilityEntries.map(([capabilityName, providers]) => `
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>${escapeHtml(capabilityName)}</strong>
          <span class="brain-pill">${escapeHtml(`${providers.length} provider${providers.length === 1 ? "" : "s"}`)}</span>
        </div>
        <div class="micro">${escapeHtml(providers.join(", "))}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No plugin capabilities are currently registered.</div>`;

  const routePlugins = plugins
    .map((plugin) => ({
      id: String(plugin.id || "").trim(),
      name: String(plugin.name || plugin.id || "Plugin").trim() || "Plugin",
      routes: Array.isArray(plugin.routes) ? plugin.routes : []
    }))
    .filter((entry) => entry.routes.length);

  pluginRouteListEl.innerHTML = routePlugins.length
    ? routePlugins.map((plugin) => `
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>${escapeHtml(plugin.name)}</strong>
          <span class="brain-pill">${escapeHtml(`${plugin.routes.length} route${plugin.routes.length === 1 ? "" : "s"}`)}</span>
        </div>
        <div class="micro">${escapeHtml(plugin.id)}</div>
        <div class="plugin-route-stack">
          ${plugin.routes.map((route) => `
            <div class="plugin-route-item">
              <span class="plugin-route-method">${escapeHtml(String(route.method || "GET").toUpperCase())}</span>
              <span>${escapeHtml(String(route.path || ""))}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No plugin routes are currently registered.</div>`;

  renderPluginDynamicPanels();
  setPluginControlsAvailability();
}

async function loadPluginPermissionRules(options = {}) {
  if (!pluginPermissionRulesEditorEl || !pluginPermissionRulesStatusEl) {
    return;
  }
  if (!isPluginInstalled("security")) {
    setPluginControlsAvailability();
    return;
  }
  if (!options.silent) {
    pluginPermissionRulesStatusEl.textContent = "Loading permission rules...";
  }
  try {
    const r = await pluginAdminFetch("/api/plugins/security/permissions/rules");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load permission rules");
    }
    pluginPermissionRulesDraft = cloneJson(j.rules || {});
    pluginPermissionRulesEditorEl.value = `${JSON.stringify(pluginPermissionRulesDraft, null, 2)}\n`;
    const ruleCount = Array.isArray(pluginPermissionRulesDraft.rules) ? pluginPermissionRulesDraft.rules.length : 0;
    pluginPermissionRulesStatusEl.textContent = `Loaded permission rules (${ruleCount} rule${ruleCount === 1 ? "" : "s"}).`;
  } catch (error) {
    pluginPermissionRulesStatusEl.textContent = `Failed to load permission rules: ${error.message}`;
  }
}

async function savePluginPermissionRules() {
  if (!pluginPermissionRulesEditorEl || !pluginPermissionRulesStatusEl || !savePluginPermissionsBtn) {
    return;
  }
  if (!isPluginInstalled("security")) {
    setPluginControlsAvailability();
    return;
  }
  const rawValue = String(pluginPermissionRulesEditorEl.value || "").trim();
  if (!rawValue) {
    pluginPermissionRulesStatusEl.textContent = "Enter rules JSON first.";
    return;
  }
  savePluginPermissionsBtn.disabled = true;
  pluginPermissionRulesStatusEl.textContent = "Saving permission rules...";
  try {
    const parsed = JSON.parse(rawValue);
    const r = await pluginAdminFetch("/api/plugins/security/permissions/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed)
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to save permission rules");
    }
    pluginPermissionRulesDraft = cloneJson(j.rules || {});
    pluginPermissionRulesEditorEl.value = `${JSON.stringify(pluginPermissionRulesDraft, null, 2)}\n`;
    const ruleCount = Array.isArray(pluginPermissionRulesDraft.rules) ? pluginPermissionRulesDraft.rules.length : 0;
    pluginPermissionRulesStatusEl.textContent = `Saved permission rules (${ruleCount} rule${ruleCount === 1 ? "" : "s"}).`;
  } catch (error) {
    pluginPermissionRulesStatusEl.textContent = `Save failed: ${error.message}`;
  } finally {
    savePluginPermissionsBtn.disabled = false;
  }
}

function getPluginLifecycleTaskId() {
  const value = String(pluginTaskLifecycleTaskIdEl?.value || "").trim();
  if (value) {
    pluginTaskLifecycleLastTaskId = value;
    return value;
  }
  return String(pluginTaskLifecycleLastTaskId || "").trim();
}

function setPluginLifecycleTaskId(taskId = "") {
  const normalized = String(taskId || "").trim();
  if (!normalized) {
    return;
  }
  pluginTaskLifecycleLastTaskId = normalized;
  if (pluginTaskLifecycleTaskIdEl) {
    pluginTaskLifecycleTaskIdEl.value = normalized;
  }
}

async function requestPluginLifecycle(path, options = {}) {
  const response = await pluginAdminFetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `request failed (${response.status})`);
  }
  return payload;
}

async function loadPluginTaskLifecycleOutput() {
  if (!pluginTaskLifecycleStatusEl || !pluginTaskLifecycleResultEl) {
    return;
  }
  if (!isPluginInstalled("task-lifecycle")) {
    setPluginControlsAvailability();
    return;
  }
  const taskId = getPluginLifecycleTaskId();
  if (!taskId) {
    pluginTaskLifecycleStatusEl.textContent = "Enter a task ID first.";
    return;
  }
  pluginTaskLifecycleStatusEl.textContent = `Loading task output for ${taskId}...`;
  try {
    const payload = await requestPluginLifecycle(`/api/plugins/tasks/output?taskId=${encodeURIComponent(taskId)}`);
    setPluginLifecycleTaskId(payload.output?.taskId || taskId);
    const status = String(payload.output?.status || "").trim() || "unknown";
    pluginTaskLifecycleStatusEl.textContent = `Loaded ${taskId} (${status}).`;
    pluginTaskLifecycleResultEl.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    pluginTaskLifecycleStatusEl.textContent = `Failed to load task output: ${error.message}`;
    pluginTaskLifecycleResultEl.textContent = String(error?.message || error || "unknown error");
  }
}

async function waitForPluginTaskLifecycleTask() {
  if (!pluginTaskLifecycleStatusEl || !pluginTaskLifecycleResultEl || !pluginTaskLifecycleWaitBtn) {
    return;
  }
  if (!isPluginInstalled("task-lifecycle")) {
    setPluginControlsAvailability();
    return;
  }
  const taskId = getPluginLifecycleTaskId();
  if (!taskId) {
    pluginTaskLifecycleStatusEl.textContent = "Enter a task ID first.";
    return;
  }
  const timeoutMs = Math.max(1000, Math.min(Number(pluginTaskLifecycleTimeoutMsEl?.value || 30000), 10 * 60 * 1000));
  pluginTaskLifecycleWaitBtn.disabled = true;
  pluginTaskLifecycleStatusEl.textContent = `Waiting for ${taskId} (${timeoutMs}ms timeout)...`;
  try {
    const payload = await requestPluginLifecycle(
      `/api/plugins/tasks/wait?taskId=${encodeURIComponent(taskId)}&timeoutMs=${encodeURIComponent(String(timeoutMs))}`
    );
    setPluginLifecycleTaskId(payload.output?.taskId || taskId);
    const status = String(payload.status || payload.output?.status || "").trim() || "unknown";
    pluginTaskLifecycleStatusEl.textContent = payload.done
      ? `Task ${taskId} reached ${status}.`
      : `Task ${taskId} is still ${status}.`;
    pluginTaskLifecycleResultEl.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    pluginTaskLifecycleStatusEl.textContent = `Wait failed: ${error.message}`;
    pluginTaskLifecycleResultEl.textContent = String(error?.message || error || "unknown error");
  } finally {
    pluginTaskLifecycleWaitBtn.disabled = false;
  }
}

async function createPluginLifecycleTask() {
  if (!pluginTaskLifecycleStatusEl || !pluginTaskLifecycleResultEl || !pluginTaskLifecycleCreateBtn) {
    return;
  }
  if (!isPluginInstalled("task-lifecycle")) {
    setPluginControlsAvailability();
    return;
  }
  const message = String(pluginTaskLifecycleCreateMessageEl?.value || "").trim();
  if (!message) {
    pluginTaskLifecycleStatusEl.textContent = "Enter a message for the task first.";
    return;
  }
  pluginTaskLifecycleCreateBtn.disabled = true;
  pluginTaskLifecycleStatusEl.textContent = "Creating queued task...";
  try {
    const payload = await requestPluginLifecycle("/api/plugins/tasks/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        sessionId: "Main",
        internetEnabled: true,
        selectedMountIds: getSelectedMountIdsForPlugin(),
        forceToolUse: forceToolUseEl.checked,
        requireWorkerPreflight: requireWorkerPreflightEl.checked,
        notes: "Task created via Plugins > Task Lifecycle panel."
      })
    });
    const taskId = String(payload.task?.id || "").trim();
    if (taskId) {
      setPluginLifecycleTaskId(taskId);
    }
    pluginTaskLifecycleStatusEl.textContent = taskId
      ? `Created task ${taskId}.`
      : "Created task.";
    pluginTaskLifecycleResultEl.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    pluginTaskLifecycleStatusEl.textContent = `Create failed: ${error.message}`;
    pluginTaskLifecycleResultEl.textContent = String(error?.message || error || "unknown error");
  } finally {
    pluginTaskLifecycleCreateBtn.disabled = false;
  }
}

async function stopPluginLifecycleTask() {
  if (!pluginTaskLifecycleStatusEl || !pluginTaskLifecycleResultEl || !pluginTaskLifecycleStopBtn) {
    return;
  }
  if (!isPluginInstalled("task-lifecycle")) {
    setPluginControlsAvailability();
    return;
  }
  const taskId = getPluginLifecycleTaskId();
  if (!taskId) {
    pluginTaskLifecycleStatusEl.textContent = "Enter a task ID first.";
    return;
  }
  const force = pluginTaskLifecycleForceStopEl?.checked === true;
  pluginTaskLifecycleStopBtn.disabled = true;
  pluginTaskLifecycleStatusEl.textContent = `Stopping ${taskId}...`;
  try {
    const payload = await requestPluginLifecycle("/api/plugins/tasks/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        force,
        reason: force
          ? "Force-stopped from Plugins > Task Lifecycle panel."
          : "Stopped from Plugins > Task Lifecycle panel."
      })
    });
    setPluginLifecycleTaskId(String(payload.task?.id || taskId).trim());
    pluginTaskLifecycleStatusEl.textContent = `Stop request applied to ${taskId}.`;
    pluginTaskLifecycleResultEl.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    pluginTaskLifecycleStatusEl.textContent = `Stop failed: ${error.message}`;
    pluginTaskLifecycleResultEl.textContent = String(error?.message || error || "unknown error");
  } finally {
    pluginTaskLifecycleStopBtn.disabled = false;
  }
}

async function answerPluginLifecycleTask() {
  if (!pluginTaskLifecycleStatusEl || !pluginTaskLifecycleResultEl || !pluginTaskLifecycleAnswerBtn) {
    return;
  }
  if (!isPluginInstalled("task-lifecycle")) {
    setPluginControlsAvailability();
    return;
  }
  const taskId = getPluginLifecycleTaskId();
  if (!taskId) {
    pluginTaskLifecycleStatusEl.textContent = "Enter a task ID first.";
    return;
  }
  const answer = String(pluginTaskLifecycleAnswerEl?.value || "").trim();
  if (!answer) {
    pluginTaskLifecycleStatusEl.textContent = "Enter an answer first.";
    return;
  }
  pluginTaskLifecycleAnswerBtn.disabled = true;
  pluginTaskLifecycleStatusEl.textContent = `Sending answer for ${taskId}...`;
  try {
    const payload = await requestPluginLifecycle("/api/plugins/tasks/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        answer,
        sessionId: "Main"
      })
    });
    setPluginLifecycleTaskId(String(payload.task?.id || taskId).trim());
    pluginTaskLifecycleStatusEl.textContent = `Answer recorded for ${taskId}.`;
    pluginTaskLifecycleResultEl.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    pluginTaskLifecycleStatusEl.textContent = `Answer failed: ${error.message}`;
    pluginTaskLifecycleResultEl.textContent = String(error?.message || error || "unknown error");
  } finally {
    pluginTaskLifecycleAnswerBtn.disabled = false;
  }
}

async function loadPluginSessionMemoryState(options = {}) {
  if (!pluginSessionMemoryStatusEl || !pluginSessionMemoryResultEl) {
    return;
  }
  if (!isPluginInstalled("session-memory")) {
    setPluginControlsAvailability();
    return;
  }
  if (!options.silent) {
    pluginSessionMemoryStatusEl.textContent = "Loading session memory state...";
  }
  try {
    const r = await pluginAdminFetch("/api/plugins/session-memory/state");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load session memory state");
    }
    const processedCount = Array.isArray(j.state?.processed) ? j.state.processed.length : 0;
    const memoryPath = String(j.memoryPath || "").trim();
    pluginSessionMemoryStatusEl.textContent = `${processedCount} task snapshot${processedCount === 1 ? "" : "s"} captured${memoryPath ? ` in ${memoryPath}` : ""}.`;
    pluginSessionMemoryResultEl.textContent = JSON.stringify(j, null, 2);
  } catch (error) {
    pluginSessionMemoryStatusEl.textContent = `Failed to load session memory state: ${error.message}`;
    pluginSessionMemoryResultEl.textContent = String(error?.message || error || "unknown error");
  }
}

async function capturePluginSessionMemoryTask() {
  if (!pluginSessionTaskIdEl || !pluginSessionMemoryStatusEl || !capturePluginSessionMemoryBtn) {
    return;
  }
  if (!isPluginInstalled("session-memory")) {
    setPluginControlsAvailability();
    return;
  }
  const taskId = String(pluginSessionTaskIdEl.value || "").trim();
  if (!taskId) {
    pluginSessionMemoryStatusEl.textContent = "Enter a task ID first.";
    return;
  }
  capturePluginSessionMemoryBtn.disabled = true;
  pluginSessionMemoryStatusEl.textContent = `Capturing session memory for ${taskId}...`;
  try {
    const r = await pluginAdminFetch("/api/plugins/session-memory/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to capture session memory");
    }
    const captured = j.result?.captured === true;
    const reason = String(j.result?.reason || "").trim();
    pluginSessionMemoryStatusEl.textContent = captured
      ? `Captured session memory for ${taskId}.`
      : `Capture skipped for ${taskId}${reason ? ` (${reason.replaceAll("_", " ")})` : ""}.`;
    pluginSessionMemoryResultEl.textContent = JSON.stringify(j, null, 2);
    await loadPluginSessionMemoryState({ silent: true });
  } catch (error) {
    pluginSessionMemoryStatusEl.textContent = `Capture failed: ${error.message}`;
    pluginSessionMemoryResultEl.textContent = String(error?.message || error || "unknown error");
  } finally {
    capturePluginSessionMemoryBtn.disabled = false;
  }
}

async function loadPluginCronHardeningStatus(options = {}) {
  if (!pluginCronStatusEl) {
    return;
  }
  if (!isPluginInstalled("security")) {
    setPluginControlsAvailability();
    return;
  }
  if (!options.silent) {
    pluginCronStatusEl.textContent = "Loading cron hardening status...";
  }
  try {
    const r = await pluginAdminFetch("/api/plugins/security/cron/status");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load cron hardening status");
    }
    pluginCronStatusEl.textContent = JSON.stringify(j.status || {}, null, 2);
  } catch (error) {
    pluginCronStatusEl.textContent = `Failed to load cron hardening status: ${error.message}`;
  }
}

async function loadPluginManagerPanel(options = {}) {
  if (!pluginsHintEl) {
    return;
  }
  window.dispatchEvent(new CustomEvent("observer:plugin-load-state", {
    detail: {
      phase: "started",
      at: Date.now(),
      source: "loadPluginManagerPanel"
    }
  }));
  if (!options.silent) {
    pluginsHintEl.textContent = "Loading plugin manager...";
  }
  let catalog = null;
  try {
    const r = await pluginAdminFetch("/api/plugins/list");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load plugin manager");
    }
    catalog = cloneJson(j);
  } catch (error) {
    pluginCatalogDraft = null;
    window.dispatchEvent(new CustomEvent("observer:plugin-load-state", {
      detail: {
        phase: "failed",
        at: Date.now(),
        source: "loadPluginManagerPanel",
        error: String(error?.message || error || "failed to load plugin manager")
      }
    }));
    await renderPluginTopLevelTabs();
    await renderPluginNovaTabs();
    await renderPluginSecretsTabs();
    await renderPluginSystemTabs();
    if (observerApp && typeof observerApp === "object") {
      delete observerApp.loadProjectsPluginPanel;
      delete observerApp.refreshPluginNovaTabs;
      delete observerApp.refreshStateBrowserPlugin;
      delete observerApp.refreshPluginSecretsTabs;
      delete observerApp.refreshPluginSystemTabs;
    }
    renderPluginManagerPanel();
    pluginsHintEl.textContent = `Failed to load plugin manager: ${error.message}`;
    return;
  }

  pluginCatalogDraft = catalog;

  try {
    await renderPluginTopLevelTabs();
  } catch (error) {
    console.warn("failed to render plugin top-level tabs", error);
  }

  try {
    await renderPluginNovaTabs();
  } catch (error) {
    console.warn("failed to render plugin nova tabs", error);
  }

  try {
    await renderPluginSecretsTabs();
  } catch (error) {
    console.warn("failed to render plugin secrets tabs", error);
  }

  try {
    await renderPluginSystemTabs();
  } catch (error) {
    console.warn("failed to render plugin system tabs", error);
  }

  if (!isPluginInstalled("projects") && observerApp && typeof observerApp === "object") {
    delete observerApp.loadProjectsPluginPanel;
  }
  if (!isPluginInstalled("state-browser") && observerApp && typeof observerApp === "object") {
    delete observerApp.refreshStateBrowserPlugin;
  }
  if (observerApp && typeof observerApp === "object") {
    if (normalizePluginUiNovaTabs().length) {
      observerApp.refreshPluginNovaTabs = (options = {}) => refreshPluginNovaTabs(options);
    } else {
      delete observerApp.refreshPluginNovaTabs;
    }
    if (normalizePluginUiSecretsTabs().length) {
      observerApp.refreshPluginSecretsTabs = (options = {}) => refreshPluginSecretsTabs(options);
    } else {
      delete observerApp.refreshPluginSecretsTabs;
    }
    if (normalizePluginUiSystemTabs().length) {
      observerApp.refreshPluginSystemTabs = (options = {}) => refreshPluginSystemTabs(options);
    } else {
      delete observerApp.refreshPluginSystemTabs;
    }
  }

  try {
    renderPluginManagerPanel();
  } catch (error) {
    console.warn("failed to render plugin manager panel", error);
  }

  const pluginCount = getInstalledPlugins().length;
  const capabilityCount = Array.isArray(pluginCatalogDraft?.capabilities) ? pluginCatalogDraft.capabilities.length : 0;
  pluginsHintEl.textContent = `Loaded ${pluginCount} plugin${pluginCount === 1 ? "" : "s"} with ${capabilityCount} ${capabilityCount === 1 ? "capability" : "capabilities"}.`;
  window.dispatchEvent(new CustomEvent("observer:plugin-load-state", {
    detail: {
      phase: "completed",
      at: Date.now(),
      source: "loadPluginManagerPanel",
      pluginCount,
      capabilityCount
    }
  }));
  if (options.loadDiagnostics !== false) {
    const taskLifecyclePromise = getPluginLifecycleTaskId()
      ? loadPluginTaskLifecycleOutput()
      : Promise.resolve();
    await Promise.allSettled([
      loadPluginPermissionRules({ silent: true }),
      taskLifecyclePromise,
      loadPluginSessionMemoryState({ silent: true }),
      loadPluginCronHardeningStatus({ silent: true })
    ]);
  }
}
Object.assign(observerApp, {
  getAdminUiToken,
  adminFetch: pluginAdminFetch,
  loadPluginManagerPanel,
  loadPluginPermissionRules,
  savePluginPermissionRules,
  loadPluginTaskLifecycleOutput,
  waitForPluginTaskLifecycleTask,
  createPluginLifecycleTask,
  stopPluginLifecycleTask,
  answerPluginLifecycleTask,
  loadPluginSessionMemoryState,
  capturePluginSessionMemoryTask,
  loadPluginCronHardeningStatus
});

})();
