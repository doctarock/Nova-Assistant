(() => {
const observerApp = window.ObserverApp || (window.ObserverApp = {});
const {
  escapeAttr,
  escapeHtml,
  hashId
} = observerApp;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}
function renderSecretPresenceLabel(hasSecret) {
  return hasSecret ? "Stored" : "Missing";
}

function renderSecretPresenceTone(hasSecret) {
  return hasSecret ? "tone-ok" : "tone-warn";
}

function renderSecretsCatalogEditor() {
  if (!secretsOverviewListEl || !secretsRetrievalListEl || !secretsCustomListEl) {
    return;
  }
  if (!secretsCatalogDraft) {
    const unavailable = `<div class="panel-subtle">Secure keystore status is unavailable.</div>`;
    secretsOverviewListEl.innerHTML = unavailable;
    secretsRetrievalListEl.innerHTML = unavailable;
    secretsCustomListEl.innerHTML = unavailable;
    return;
  }
  const mail = secretsCatalogDraft.mail && typeof secretsCatalogDraft.mail === "object" ? secretsCatalogDraft.mail : { agents: [] };
  const wordpress = secretsCatalogDraft.wordpress && typeof secretsCatalogDraft.wordpress === "object" ? secretsCatalogDraft.wordpress : { sites: [] };
  const retrieval = secretsCatalogDraft.retrieval && typeof secretsCatalogDraft.retrieval === "object" ? secretsCatalogDraft.retrieval : {};
  const suggestedHandles = Array.isArray(secretsCatalogDraft.suggestedHandles) ? secretsCatalogDraft.suggestedHandles : [];
  const mailAgents = Array.isArray(mail.agents) ? mail.agents : [];
  const wordpressSites = Array.isArray(wordpress.sites) ? wordpress.sites : [];
  const mailStoredCount = mailAgents.filter((entry) => entry.hasSecret).length;
  const wordpressStoredCount = wordpressSites.filter((entry) => entry.hasSecret).length;
  const totalTracked = mailAgents.length + wordpressSites.length + (retrieval.apiKeyHandle ? 1 : 0);
  const totalStored = mailStoredCount + wordpressStoredCount + (retrieval.hasSecret ? 1 : 0);

  secretsOverviewListEl.innerHTML = `
    <div class="access-summary">
      <div class="summary-box">
        <strong>Keystore</strong>
        <div class="summary-pill">${escapeHtml(String(secretsCatalogDraft.serviceName || "nova-observer"))}</div>
        <div class="micro">System credential backend used by Nova.</div>
      </div>
      <div class="summary-box">
        <strong>Tracked handles</strong>
        <div class="summary-pill">${escapeHtml(String(totalTracked))}</div>
        <div class="micro">Named integration secrets currently mapped into the UI.</div>
      </div>
      <div class="summary-box">
        <strong>Stored</strong>
        <div class="summary-pill">${escapeHtml(String(totalStored))}</div>
        <div class="micro">Tracked integration secrets already present in the keystore.</div>
      </div>
    </div>
    <div class="stack-list">
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>Mail coverage</strong>
          <span class="brain-pill">${escapeHtml(`${mailStoredCount}/${mailAgents.length || 0}`)}</span>
        </div>
        <div class="micro">${mail.enabled ? "Mail is enabled." : "Mail is disabled."} Active agent: ${escapeHtml(mail.activeAgentId || "(none)")}. Configure passwords from the Mail plugin tab in Secrets.</div>
      </div>
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>WordPress coverage</strong>
          <span class="brain-pill">${escapeHtml(`${wordpressStoredCount}/${wordpressSites.length || 0}`)}</span>
        </div>
        <div class="micro">${wordpressSites.length ? "Bridge sites are being tracked through the WordPress plugin tab in Secrets." : "No WordPress bridge sites are configured."}</div>
      </div>
      <div class="brain-row">
        <div class="brain-row-actions">
          <strong>Retrieval coverage</strong>
          <span class="brain-pill">${escapeHtml(renderSecretPresenceLabel(retrieval.hasSecret))}</span>
        </div>
        <div class="micro">Qdrant collection: ${escapeHtml(retrieval.collectionName || "observer_chunks")} at ${escapeHtml(retrieval.qdrantUrl || "unconfigured")}.</div>
      </div>
    </div>
  `;

  if (retrieval.apiKeyHandle) {
    const inputId = `secret-input-${hashId(`retrieval:${retrieval.apiKeyHandle}`)}`;
    secretsRetrievalListEl.innerHTML = `
      <div class="secret-card">
        <div class="panel-head compact">
          <div>
            <strong>Qdrant API Key</strong>
            <div class="panel-subtle">${escapeHtml(retrieval.qdrantUrl || "http://127.0.0.1:6333")} | collection ${escapeHtml(retrieval.collectionName || "observer_chunks")}</div>
          </div>
          <span class="brain-pill ${renderSecretPresenceTone(retrieval.hasSecret)}">${escapeHtml(renderSecretPresenceLabel(retrieval.hasSecret))}</span>
        </div>
        <div class="micro"><strong>Handle:</strong> <code>${escapeHtml(retrieval.apiKeyHandle)}</code></div>
        <div class="controls secret-controls">
          <input id="${escapeAttr(inputId)}" type="password" placeholder="Enter Qdrant API key" />
          <button class="secondary" type="button" data-secret-set="${escapeAttr(retrieval.apiKeyHandle)}" data-secret-input-id="${escapeAttr(inputId)}">Store</button>
          <button class="secondary" type="button" data-secret-clear="${escapeAttr(retrieval.apiKeyHandle)}">Clear</button>
        </div>
      </div>
    `;
  } else {
    secretsRetrievalListEl.innerHTML = `<div class="panel-subtle">Retrieval is not configured with a tracked API key handle.</div>`;
  }

  secretsCustomListEl.innerHTML = `
    <div class="stack-list">
      <label class="stack-field">
        <strong>Handle</strong>
        <span class="micro">Use a known handle from the integrations above or inspect any other handle directly.</span>
        <input id="customSecretHandleInput" type="text" placeholder="mail/agent/nova/password" value="${escapeAttr(suggestedHandles[0] || "")}" />
      </label>
      <label class="stack-field">
        <strong>Value</strong>
        <span class="micro">Values are sent only to the local observer server and stored in the system keychain.</span>
        <input id="customSecretValueInput" type="password" placeholder="Enter secret value" />
      </label>
      <div class="controls secret-controls">
        <button class="secondary" type="button" id="inspectCustomSecretBtn">Inspect</button>
        <button class="secondary" type="button" id="storeCustomSecretBtn">Store</button>
        <button class="secondary" type="button" id="clearCustomSecretBtn">Clear</button>
      </div>
      <div class="brain-editor-card">
        <strong>Suggested handles</strong>
        <div class="secret-handle-pills">
          ${suggestedHandles.length
            ? suggestedHandles.map((handle) => `<button type="button" class="secondary secret-handle-pill" data-secret-fill-handle="${escapeAttr(handle)}">${escapeHtml(handle)}</button>`).join("")
            : `<div class="panel-subtle">No suggested handles available yet.</div>`}
        </div>
      </div>
      <div id="customSecretStatus" class="panel-subtle">Select a handle to inspect or update it.</div>
    </div>
  `;

  document.querySelectorAll("[data-secret-set]").forEach((button) => {
    button.onclick = async () => {
      const handle = String(button.dataset.secretSet || "").trim();
      const inputId = String(button.dataset.secretInputId || "").trim();
      const input = inputId ? document.getElementById(inputId) : null;
      const value = String(input?.value || "");
      if (!handle || !value) {
        secretsHintEl.textContent = "Choose a handle and enter a value first.";
        return;
      }
      await storeSecretHandle(handle, value);
      if (input) {
        input.value = "";
      }
    };
  });

  document.querySelectorAll("[data-secret-clear]").forEach((button) => {
    button.onclick = async () => {
      const handle = String(button.dataset.secretClear || "").trim();
      if (!handle) {
        return;
      }
      await clearSecretHandle(handle);
    };
  });

  document.querySelectorAll("[data-secret-fill-handle]").forEach((button) => {
    button.onclick = () => {
      const handleInput = document.getElementById("customSecretHandleInput");
      if (handleInput) {
        handleInput.value = String(button.dataset.secretFillHandle || "").trim();
      }
    };
  });

  const inspectCustomSecretBtn = document.getElementById("inspectCustomSecretBtn");
  const storeCustomSecretBtn = document.getElementById("storeCustomSecretBtn");
  const clearCustomSecretBtn = document.getElementById("clearCustomSecretBtn");
  const customSecretHandleInput = document.getElementById("customSecretHandleInput");
  const customSecretValueInput = document.getElementById("customSecretValueInput");
  const customSecretStatusEl = document.getElementById("customSecretStatus");

  if (inspectCustomSecretBtn) {
    inspectCustomSecretBtn.onclick = async () => {
      const handle = String(customSecretHandleInput?.value || "").trim();
      if (!handle) {
        customSecretStatusEl.textContent = "Enter a handle first.";
        return;
      }
      customSecretStatusEl.textContent = "Inspecting handle...";
      try {
        const r = await fetch(`/api/secrets/status?handle=${encodeURIComponent(handle)}`);
        const j = await r.json();
        if (!r.ok || !j.ok) {
          throw new Error(j.error || "failed to inspect handle");
        }
        customSecretStatusEl.textContent = `${j.secret.handle}: ${j.secret.hasSecret ? "stored in keystore" : "missing"}.`;
      } catch (error) {
        customSecretStatusEl.textContent = `Inspect failed: ${error.message}`;
      }
    };
  }
  if (storeCustomSecretBtn) {
    storeCustomSecretBtn.onclick = async () => {
      const handle = String(customSecretHandleInput?.value || "").trim();
      const value = String(customSecretValueInput?.value || "");
      if (!handle || !value) {
        customSecretStatusEl.textContent = "Enter both a handle and a value first.";
        return;
      }
      await storeSecretHandle(handle, value);
      if (customSecretValueInput) {
        customSecretValueInput.value = "";
      }
    };
  }
  if (clearCustomSecretBtn) {
    clearCustomSecretBtn.onclick = async () => {
      const handle = String(customSecretHandleInput?.value || "").trim();
      if (!handle) {
        customSecretStatusEl.textContent = "Enter a handle first.";
        return;
      }
      await clearSecretHandle(handle);
    };
  }
}

async function loadSecretsCatalog() {
  if (!secretsHintEl) {
    return;
  }
  secretsHintEl.textContent = "Loading secure keystore status...";
  try {
    const r = await fetch("/api/secrets/catalog");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load secrets catalog");
    }
    secretsCatalogDraft = cloneJson(j.catalog);
    renderSecretsCatalogEditor();
    observerApp.refreshPluginSecretsTabs?.({ source: "secrets-catalog" });
    const trackedCount = (Array.isArray(j.catalog?.suggestedHandles) ? j.catalog.suggestedHandles.length : 0);
    secretsHintEl.textContent = `Secure keystore status loaded. ${trackedCount} suggested handle${trackedCount === 1 ? "" : "s"} available.`;
  } catch (error) {
    secretsCatalogDraft = null;
    renderSecretsCatalogEditor();
    observerApp.refreshPluginSecretsTabs?.({ source: "secrets-catalog-error" });
    secretsHintEl.textContent = `Failed to load secrets catalog: ${error.message}`;
  }
}

async function storeSecretHandle(handle = "", value = "") {
  const normalizedHandle = String(handle || "").trim();
  if (!normalizedHandle || !String(value || "")) {
    return;
  }
  secretsHintEl.textContent = `Storing ${normalizedHandle}...`;
  try {
    const r = await fetch("/api/secrets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: normalizedHandle, value: String(value || "") })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to store secret");
    }
    secretsHintEl.textContent = `Stored ${j.secret.handle} in the secure keystore.`;
    const mailRefresh = typeof observerApp.loadMailStatus === "function"
      ? Promise.resolve(observerApp.loadMailStatus())
      : Promise.resolve();
    await Promise.all([
      loadSecretsCatalog(),
      mailRefresh,
      observerApp.loadRuntimeOptions?.(),
      observerApp.refreshStatus?.()
    ]);
  } catch (error) {
    secretsHintEl.textContent = `Store failed: ${error.message}`;
  }
}

async function clearSecretHandle(handle = "") {
  const normalizedHandle = String(handle || "").trim();
  if (!normalizedHandle) {
    return;
  }
  secretsHintEl.textContent = `Clearing ${normalizedHandle}...`;
  try {
    const r = await fetch("/api/secrets?handle=" + encodeURIComponent(normalizedHandle), {
      method: "DELETE",
      headers: { "content-type": "application/json" }
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to clear secret");
    }
    secretsHintEl.textContent = `Cleared ${j.secret.handle} from the secure keystore.`;
    const mailRefresh = typeof observerApp.loadMailStatus === "function"
      ? Promise.resolve(observerApp.loadMailStatus())
      : Promise.resolve();
    await Promise.all([
      loadSecretsCatalog(),
      mailRefresh,
      observerApp.loadRuntimeOptions?.(),
      observerApp.refreshStatus?.()
    ]);
  } catch (error) {
    secretsHintEl.textContent = `Clear failed: ${error.message}`;
  }
}
Object.assign(observerApp, {
  loadSecretsCatalog,
  renderSecretsCatalogEditor,
  storeSecretHandle,
  clearSecretHandle
});

})();