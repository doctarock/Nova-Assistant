(() => {
const observerApp = window.ObserverApp || (window.ObserverApp = {});
const {
  captureVoiceTrustProfileSignature,
  escapeAttr,
  escapeHtml,
  formatDateTime,
  hashId,
  normalizeTrustLevel,
  trustLevelLabel
} = observerApp;

async function configAdminFetch(url = "", options = {}) {
  if (typeof observerApp.adminFetch === "function") {
    return observerApp.adminFetch(url, options);
  }
  return fetch(url, options);
}
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const DEFAULT_AVATAR_REACTION_CATALOG = [
  { emotion: "idle", clip: "Charged_Ground_Slam", label: "Idle" },
  { emotion: "calm", clip: "Cheer_with_Both_Hands_Up", label: "Calm idle" },
  { emotion: "agree", clip: "Talk_with_Left_Hand_Raised", label: "Agree" },
  { emotion: "angry", clip: "Head_Hold_in_Pain", label: "Angry stomp" },
  { emotion: "love", clip: "Agree_Gesture", label: "Big heart" },
  { emotion: "celebrate", clip: "Angry_Stomp", label: "Celebrate" },
  { emotion: "confused", clip: "Walking", label: "Confused" },
  { emotion: "dance", clip: "Idle_3", label: "Dance" },
  { emotion: "sass", clip: "Big_Heart_Gesture", label: "Hand on hip" },
  { emotion: "hurt", clip: "Scheming_Hand_Rub", label: "Hurt" },
  { emotion: "reflect", clip: "Idle_6", label: "Reflect" },
  { emotion: "run", clip: "Shrug", label: "Run" },
  { emotion: "scheme", clip: "Wave_One_Hand", label: "Scheme" },
  { emotion: "shrug", clip: "Confused_Scratch", label: "Shrug" },
  { emotion: "rant", clip: "Stand_Talking_Angry", label: "Angry talk" },
  { emotion: "passionate", clip: "Mirror_Viewing", label: "Passionate talk" },
  { emotion: "explain", clip: "FunnyDancing_01", label: "Explain" },
  { emotion: "walk", clip: "Hand_on_Hip_Gesture", label: "Walk" },
  { emotion: "wave", clip: "Talk_Passionately", label: "Wave" },
  { emotion: "slam", clip: "Running", label: "Ground slam" }
];

const DEFAULT_AVATAR_TALKING_CLIPS = [
  "Mirror_Viewing",
  "Talk_with_Left_Hand_Raised",
  "FunnyDancing_01"
];

function ensureReactionPathDraft(appConfig) {
  if (!appConfig || typeof appConfig !== "object") {
    return {};
  }
  if (!appConfig.reactionPathsByModel || typeof appConfig.reactionPathsByModel !== "object") {
    appConfig.reactionPathsByModel = {};
  }
  return appConfig.reactionPathsByModel;
}

function getReactionProfileDraft(appConfig, modelPath) {
  const key = String(modelPath || "").trim();
  const store = ensureReactionPathDraft(appConfig);
  const existing = store[key];
  if (existing && typeof existing === "object") {
    if (!existing.paths || typeof existing.paths !== "object") {
      existing.paths = {};
    }
    if (!Array.isArray(existing.talkingClips)) {
      existing.talkingClips = [];
    }
    const normalizedIdle = String(existing.paths.idle || existing.idleClip || "").trim();
    if (normalizedIdle) {
      existing.idleClip = normalizedIdle;
      existing.paths.idle = normalizedIdle;
    }
    return existing;
  }
  const defaults = Object.fromEntries(DEFAULT_AVATAR_REACTION_CATALOG.map((entry) => [entry.emotion, entry.clip]));
  const profile = {
    idleClip: defaults.idle || DEFAULT_AVATAR_REACTION_CATALOG[0].clip,
    talkingClips: [...DEFAULT_AVATAR_TALKING_CLIPS],
    paths: defaults
  };
  if (key) {
    store[key] = profile;
  }
  return profile;
}

function formatReactionPathsForTextarea(paths = {}) {
  const mapped = paths && typeof paths === "object" ? paths : {};
  const lines = DEFAULT_AVATAR_REACTION_CATALOG.map((entry) => {
    const clip = String(mapped?.[entry.emotion] || entry.clip).trim();
    return `${entry.emotion}=${clip}`;
  });
  const known = new Set(DEFAULT_AVATAR_REACTION_CATALOG.map((entry) => entry.emotion));
  Object.entries(mapped)
    .map(([emotion, clip]) => [String(emotion || "").trim().toLowerCase(), String(clip || "").trim()])
    .filter(([emotion, clip]) => emotion && clip && !known.has(emotion))
    .sort((left, right) => left[0].localeCompare(right[0]))
    .forEach(([emotion, clip]) => lines.push(`${emotion}=${clip}`));
  return lines.join("\n");
}

function parseReactionPathsTextarea(value) {
  const entries = {};
  String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        return;
      }
      const emotion = line.slice(0, separatorIndex).trim().toLowerCase();
      const clip = line.slice(separatorIndex + 1).trim();
      if (emotion && clip) {
        entries[emotion] = clip;
      }
    });
  return entries;
}

function applyAppConfigToStage(appConfig = {}) {
  const botName = String(appConfig?.botName || "Agent").trim() || "Agent";
  const avatarModelPath = String(appConfig?.avatarModelPath || "/assets/characters/Nova.glb").trim() || "/assets/characters/Nova.glb";
  const backgroundImagePath = String(appConfig?.backgroundImagePath || "").trim();
  const stylizationFilterPreset = String(appConfig?.stylizationFilterPreset || appConfig?.stylizationPreset || "none").trim().toLowerCase();
  const stylizationFilters = {
    none: "",
    soft: "contrast(0.94) saturate(0.9) brightness(1.03) blur(0.2px)",
    cinematic: "contrast(1.08) saturate(0.86) sepia(0.08) brightness(0.98)",
    noir: "grayscale(0.96) contrast(1.12) brightness(0.96)",
    vivid: "saturate(1.22) contrast(1.05) brightness(1.02)",
    toon: "contrast(1.06) saturate(1.04)",
    dream: "saturate(1.12) brightness(1.06) contrast(0.94)",
    retro_vhs: "sepia(0.22) saturate(0.72) contrast(1.08) brightness(0.96) hue-rotate(-14deg)",
    haunted: "saturate(0.62) contrast(1.16) brightness(0.92) hue-rotate(24deg)",
    surveillance: "grayscale(0.7) contrast(1.24) brightness(0.88) sepia(0.18) hue-rotate(36deg)",
    crystal: "saturate(1.35) contrast(1.14) brightness(1.05) hue-rotate(-18deg)",
    whimsical: "saturate(0.58) contrast(0.72) brightness(1.16) sepia(0.28) hue-rotate(-18deg) blur(0.45px)"
  };
  document.title = botName;
  appTitleEl.textContent = botName;
  avatarCanvasEl.dataset.modelPath = avatarModelPath;
  avatarCanvasEl.dataset.skyboxPath = backgroundImagePath;
  avatarCanvasEl.style.filter = stylizationFilters[stylizationFilterPreset] || "";
}

function renderNovaConfigEditor() {
  if (!novaIdentitySettingsListEl || !novaTrustSettingsListEl) {
    return;
  }
  if (!novaConfigDraft?.app) {
    const unavailable = `<div class="panel-subtle">Nova settings are unavailable.</div>`;
    novaIdentitySettingsListEl.innerHTML = unavailable;
    novaTrustSettingsListEl.innerHTML = unavailable;
    return;
  }
  const app = novaConfigDraft.app;
  const assets = novaConfigDraft.assets && typeof novaConfigDraft.assets === "object" ? novaConfigDraft.assets : {};
  const modelOptions = Array.isArray(assets.characters) ? assets.characters : [];
  const selectedModelPath = String(app.avatarModelPath || "").trim();
  const reactionProfile = getReactionProfileDraft(app, selectedModelPath);
  const trust = app.trust && typeof app.trust === "object"
    ? app.trust
    : { emailCommandMinLevel: "trusted", voiceCommandMinLevel: "trusted", records: [], emailSources: [], voiceProfiles: [] };
  const trustRecords = Array.isArray(trust.records) ? trust.records : [];
  const renderAssetOptions = (options, selectedValue, emptyLabel = "") => {
    const normalizedOptions = options.map((value) => String(value || "").trim()).filter(Boolean);
    const withSelected = selectedValue && !normalizedOptions.includes(selectedValue)
      ? [selectedValue, ...normalizedOptions]
      : normalizedOptions;
    const rendered = [];
    if (emptyLabel) {
      rendered.push(`<option value="">${escapeHtml(emptyLabel)}</option>`);
    }
    rendered.push(...withSelected.map((value) => (
      `<option value="${escapeAttr(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(value.replace(/^\/assets\//, ""))}</option>`
    )));
    return rendered.join("");
  };
  const renderTrustLevelOptions = (selectedValue = "unknown") => {
    const normalized = normalizeTrustLevel(selectedValue, "unknown");
    return ["unknown", "known", "trusted"].map((level) => (
      `<option value="${escapeAttr(level)}" ${level === normalized ? "selected" : ""}>${escapeHtml(trustLevelLabel(level))}</option>`
    )).join("");
  };
  const renderCommandThresholdOptions = (selectedValue = "trusted") => {
    return `<option value="trusted" selected>${escapeHtml(trustLevelLabel("trusted"))}</option>`;
  };
  novaIdentitySettingsListEl.innerHTML = `
    <label class="stack-field">
      <strong>Name</strong>
      <span class="micro">Used in the title, wake phrase, and UI labels.</span>
      <input type="text" data-nova-field="botName" value="${escapeAttr(String(app.botName || ""))}" placeholder="Nova" />
    </label>
    <label class="stack-field">
      <strong>Avatar model</strong>
      <span class="micro">Choose from GLB files currently present in <code>public/assets</code>.</span>
      <select data-nova-field="avatarModelPath">${renderAssetOptions(modelOptions, selectedModelPath)}</select>
    </label>
    <label class="stack-field">
      <strong>Voice preferences</strong>
      <span class="micro">One preferred voice per line. Nova uses the first matching installed system voice.</span>
      <textarea data-nova-field="voicePreferences" rows="6" placeholder="Zira&#10;Catherine&#10;Aria">${escapeHtml((Array.isArray(app.voicePreferences) ? app.voicePreferences : []).join("\n"))}</textarea>
    </label>
    <div class="brain-editor-card">
      <div class="panel-head compact">
        <div>
          <strong>Reaction mapping for this model</strong>
          <div class="micro">The selected model keeps its own idle clip, talking loop list, and emotion-to-clip path map.</div>
        </div>
      </div>
      <div class="stack-list">
        <div class="micro">Editing: <code>${escapeHtml(selectedModelPath || "No model selected")}</code></div>
        <label class="stack-field">
          <strong>Idle clip</strong>
          <input type="text" data-nova-reaction-idle value="${escapeAttr(String(reactionProfile.idleClip || ""))}" placeholder="Charged_Ground_Slam" />
        </label>
        <label class="stack-field">
          <strong>Talking clips</strong>
          <span class="micro">One clip per line. Nova rotates through these while speaking.</span>
          <textarea data-nova-reaction-talking rows="4" placeholder="Mirror_Viewing&#10;Talk_with_Left_Hand_Raised&#10;FunnyDancing_01">${escapeHtml((Array.isArray(reactionProfile.talkingClips) ? reactionProfile.talkingClips : []).join("\n"))}</textarea>
        </label>
        <label class="stack-field">
          <strong>Reaction paths</strong>
          <span class="micro">Use <code>emotion=Clip_Name</code> per line. These map directly from <code>[nova:emotion=...]</code> tags.</span>
          <textarea data-nova-reaction-paths rows="12" placeholder="agree=Talk_with_Left_Hand_Raised&#10;confused=Walking">${escapeHtml(formatReactionPathsForTextarea(reactionProfile.paths))}</textarea>
        </label>
      </div>
    </div>
  `;
  novaTrustSettingsListEl.innerHTML = `
    <section class="brain-editor-card">
      <div class="panel-head compact">
        <div>
          <strong>Source trust</strong>
          <div class="micro">Each trust record can hold both the email match and the captured voice pattern for the same person.</div>
        </div>
      </div>
      <div class="stack-list">
        <label class="stack-field">
          <strong>Email command minimum</strong>
          <span class="micro">Fixed policy: only trusted sources may execute commands. Explicit email commands should start with <code>Nova:</code>, <code>Nova,</code>, or <code>Nova -</code>.</span>
          <select data-nova-trust-threshold="emailCommandMinLevel">${renderCommandThresholdOptions(trust.emailCommandMinLevel || "trusted")}</select>
        </label>
        <label class="stack-field">
          <strong>Voice command minimum</strong>
          <span class="micro">Fixed policy: only trusted captured speakers may execute commands once voice profiles exist.</span>
          <select data-nova-trust-threshold="voiceCommandMinLevel">${renderCommandThresholdOptions(trust.voiceCommandMinLevel || "trusted")}</select>
        </label>
        <div class="stack-field">
          <strong>Trust records</strong>
          <span class="micro">Use one record per person. Email matching and voice capture live together here.</span>
          <div class="stack-list">
            ${trustRecords.length ? trustRecords.map((record, index) => `
              <div class="brain-editor-card">
                <label class="stack-field">
                  <strong>Label</strong>
                  <input type="text" data-nova-trust-record-field="${escapeAttr(index)}:label" value="${escapeAttr(String(record.label || ""))}" placeholder="Person label" />
                </label>
                <label class="stack-field">
                  <strong>Email</strong>
                  <input type="email" data-nova-trust-record-field="${escapeAttr(index)}:email" value="${escapeAttr(String(record.email || ""))}" placeholder="name@example.com" />
                </label>
                <label class="stack-field">
                  <strong>Trust level</strong>
                  <select data-nova-trust-record-field="${escapeAttr(index)}:trustLevel">${renderTrustLevelOptions(record.trustLevel || "known")}</select>
                </label>
                <label class="stack-field">
                  <strong>Voice threshold</strong>
                  <input type="number" min="0.45" max="0.99" step="0.01" data-nova-trust-record-field="${escapeAttr(index)}:threshold" value="${escapeAttr(String(Number(record.threshold || 0.82).toFixed(2)))}" title="Voice match threshold" />
                </label>
                <label class="stack-field">
                  <strong>Aliases</strong>
                  <input type="text" data-nova-trust-record-field="${escapeAttr(index)}:aliases" value="${escapeAttr((Array.isArray(record.aliases) ? record.aliases : []).join(", "))}" placeholder="Display-name aliases, comma separated" />
                </label>
                <div class="micro">${escapeHtml(Array.isArray(record.signature) && record.signature.length ? `${record.signature.length} signature bins captured.${record.updatedAt ? ` Updated ${formatDateTime(record.updatedAt)}.` : ""}` : "No voice signature captured yet. Email matching still works without one.")}</div>
                <label class="stack-field">
                  <strong>Notes</strong>
                  <textarea rows="2" data-nova-trust-record-field="${escapeAttr(index)}:notes" placeholder="Notes">${escapeHtml(String(record.notes || ""))}</textarea>
                </label>
                <div class="controls" style="grid-template-columns: 1fr 1fr;">
                  <button type="button" class="secondary" data-nova-capture-trust-record="${escapeAttr(index)}">Capture voice</button>
                  <button type="button" class="secondary" data-nova-remove-trust-record="${escapeAttr(index)}">Remove record</button>
                </div>
              </div>
            `).join("") : `<div class="panel-subtle">No trust records configured yet.</div>`}
          </div>
          <button type="button" class="secondary" data-nova-add-trust-record>Add trust record</button>
        </div>
      </div>
    </section>
  `;
  const novaSettingsRootEls = [
    novaIdentitySettingsListEl,
    novaTrustSettingsListEl
  ];
  novaSettingsRootEls.forEach((rootEl) => {
    rootEl.querySelectorAll("[data-nova-field]").forEach((input) => {
      input.onchange = () => {
        const field = String(input.dataset.novaField || "").trim();
        if (!field || !novaConfigDraft?.app) {
          return;
        }
        if (field === "voicePreferences") {
          novaConfigDraft.app.voicePreferences = String(input.value || "")
            .split(/\r?\n/)
            .map((value) => String(value || "").trim())
            .filter(Boolean);
          return;
        }
        novaConfigDraft.app[field] = String(input.value || "");
        if (field === "avatarModelPath") {
          getReactionProfileDraft(novaConfigDraft.app, String(input.value || ""));
          renderNovaConfigEditor();
        }
        if (field === "botName" || field === "avatarModelPath" || field === "backgroundImagePath" || field === "stylizationFilterPreset" || field === "stylizationEffectPreset") {
          applyAppConfigToStage(novaConfigDraft.app);
        }
      };
    });
    rootEl.querySelectorAll("[data-nova-reaction-idle]").forEach((input) => {
      input.onchange = () => {
        const profile = getReactionProfileDraft(novaConfigDraft?.app, selectedModelPath);
        const idleClip = String(input.value || "").trim();
        profile.idleClip = idleClip;
        if (!profile.paths || typeof profile.paths !== "object") {
          profile.paths = {};
        }
        profile.paths.idle = idleClip;
      };
    });
    rootEl.querySelectorAll("[data-nova-reaction-talking]").forEach((input) => {
      input.onchange = () => {
        const profile = getReactionProfileDraft(novaConfigDraft?.app, selectedModelPath);
        profile.talkingClips = String(input.value || "")
          .split(/\r?\n/)
          .map((value) => String(value || "").trim())
          .filter(Boolean);
      };
    });
    rootEl.querySelectorAll("[data-nova-reaction-paths]").forEach((input) => {
      input.onchange = () => {
        const profile = getReactionProfileDraft(novaConfigDraft?.app, selectedModelPath);
        profile.paths = parseReactionPathsTextarea(input.value || "");
        profile.idleClip = String(profile.paths.idle || profile.idleClip || "").trim();
      };
    });
  });
  const ensureTrustDraft = () => {
    if (!novaConfigDraft?.app) {
      return null;
    }
    if (!novaConfigDraft.app.trust || typeof novaConfigDraft.app.trust !== "object") {
      novaConfigDraft.app.trust = {
        emailCommandMinLevel: "trusted",
        voiceCommandMinLevel: "trusted",
        records: [],
        emailSources: [],
        voiceProfiles: []
      };
    }
    if (!Array.isArray(novaConfigDraft.app.trust.records)) {
      novaConfigDraft.app.trust.records = [];
    }
    novaConfigDraft.app.trust.emailSources = [];
    novaConfigDraft.app.trust.voiceProfiles = [];
    return novaConfigDraft.app.trust;
  };
  novaTrustSettingsListEl.querySelectorAll("[data-nova-trust-threshold]").forEach((input) => {
    input.onchange = () => {
      const trustDraft = ensureTrustDraft();
      const field = String(input.dataset.novaTrustThreshold || "").trim();
      if (!trustDraft || !field) {
        return;
      }
      trustDraft[field] = normalizeTrustLevel(String(input.value || ""), "trusted");
    };
  });
  novaTrustSettingsListEl.querySelectorAll("[data-nova-trust-record-field]").forEach((input) => {
    input.onchange = () => {
      const trustDraft = ensureTrustDraft();
      const descriptor = String(input.dataset.novaTrustRecordField || "").trim();
      const [indexText, field] = descriptor.split(":");
      const index = Number(indexText);
      if (!trustDraft || !field || !Number.isInteger(index) || !trustDraft.records[index]) {
        return;
      }
      if (field === "aliases") {
        trustDraft.records[index].aliases = String(input.value || "")
          .split(",")
          .map((value) => String(value || "").trim())
          .filter(Boolean);
        return;
      }
      if (field === "trustLevel") {
        trustDraft.records[index].trustLevel = normalizeTrustLevel(String(input.value || ""), "known");
        return;
      }
      if (field === "threshold") {
        trustDraft.records[index].threshold = Math.max(0.45, Math.min(Number(input.value || 0.82), 0.99));
        return;
      }
      trustDraft.records[index][field] = String(input.value || "");
    };
  });
  novaTrustSettingsListEl.querySelectorAll("[data-nova-remove-trust-record]").forEach((button) => {
    button.onclick = () => {
      const trustDraft = ensureTrustDraft();
      const index = Number(button.dataset.novaRemoveTrustRecord);
      if (!trustDraft || !Number.isInteger(index)) {
        return;
      }
      trustDraft.records.splice(index, 1);
      renderNovaConfigEditor();
    };
  });
  novaTrustSettingsListEl.querySelectorAll("[data-nova-add-trust-record]").forEach((button) => {
    button.onclick = () => {
      const trustDraft = ensureTrustDraft();
      if (!trustDraft) {
        return;
      }
      trustDraft.records.push({
        id: `trust-record-${hashId(`${Date.now()}-${trustDraft.records.length}`)}`,
        label: "",
        email: "",
        aliases: [],
        trustLevel: "known",
        threshold: 0.82,
        signature: [],
        notes: ""
      });
      renderNovaConfigEditor();
    };
  });
  novaTrustSettingsListEl.querySelectorAll("[data-nova-capture-trust-record]").forEach((button) => {
    button.onclick = async () => {
      const trustDraft = ensureTrustDraft();
      const index = Number(button.dataset.novaCaptureTrustRecord);
      if (!trustDraft || !Number.isInteger(index) || !trustDraft.records[index]) {
        return;
      }
      if (typeof captureVoiceTrustProfileSignature !== "function") {
        novaHintEl.textContent = "Voice capture is unavailable in this browser.";
        return;
      }
      button.disabled = true;
      novaHintEl.textContent = `Listening for ${trustDraft.records[index].label || `trust record ${index + 1}`}... speak naturally for about 3 seconds.`;
      try {
        const signature = await captureVoiceTrustProfileSignature({ durationMs: 3200 });
        trustDraft.records[index].signature = signature;
        const now = Date.now();
        trustDraft.records[index].capturedAt = Number(trustDraft.records[index].capturedAt || now);
        trustDraft.records[index].updatedAt = now;
        renderNovaConfigEditor();
        await saveNovaConfig();
        novaHintEl.textContent = `Captured and stored voice signature for ${trustDraft.records[index].label || `trust record ${index + 1}`}.`;
      } catch (error) {
        novaHintEl.textContent = `Voice capture failed: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    };
  });
}

async function loadNovaConfig() {
  if (!novaHintEl) {
    return;
  }
  novaHintEl.textContent = "Loading Nova settings...";
  try {
    const r = await fetch("/api/app/config");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load Nova settings");
    }
    novaConfigDraft = cloneJson(j);
    renderNovaConfigEditor();
    applyAppConfigToStage(novaConfigDraft.app || {});
    await observerApp.refreshPluginNovaTabs?.({ silent: true });
    novaHintEl.textContent = "Nova settings loaded.";
  } catch (error) {
    novaConfigDraft = null;
    renderNovaConfigEditor();
    await observerApp.refreshPluginNovaTabs?.({ silent: true });
    novaHintEl.textContent = `Failed to load Nova settings: ${error.message}`;
  }
}


async function saveNovaConfig() {
  if (!novaConfigDraft?.app || !novaHintEl || !saveNovaBtn) {
    return;
  }
  if (novaConfigDraft.app.trust && typeof novaConfigDraft.app.trust === "object" && Array.isArray(novaConfigDraft.app.trust.records)) {
    novaConfigDraft.app.trust.emailSources = [];
    novaConfigDraft.app.trust.voiceProfiles = [];
  }
  saveNovaBtn.disabled = true;
  novaHintEl.textContent = "Saving Nova settings...";
  try {
    const r = await configAdminFetch("/api/app/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app: novaConfigDraft.app })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to save Nova settings");
    }
    await loadNovaConfig();
    await observerApp.loadRuntimeOptions?.();
    if (window.agentAvatar?.reloadAppearance) {
      await window.agentAvatar.reloadAppearance(j.app || {});
    }
    novaHintEl.textContent = j.message || "Nova settings saved.";
  } catch (error) {
    novaHintEl.textContent = `Save failed: ${error.message}`;
  } finally {
    saveNovaBtn.disabled = false;
  }
}

function getBrainRouteKeys() {
  return ["code", "document", "general", "background", "creative", "vision", "retrieval", "fast_worker"];
}

function getBrainSpecialtyOptions() {
  return [
    { value: "", label: "Auto / none" },
    { value: "general", label: "General" },
    { value: "code", label: "Code" },
    { value: "document", label: "Document" },
    { value: "background", label: "Background" },
    { value: "creative", label: "Creative" },
    { value: "vision", label: "Vision" },
    { value: "retrieval", label: "Retrieval" },
    { value: "routing", label: "Routing" },
    { value: "planner", label: "Planner" },
    { value: "fast_worker", label: "Fast worker" }
  ];
}

function getAllowedBrainSpecialtiesForKind(kind = "worker") {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  if (normalizedKind === "helper") {
    return new Set(["", "general", "routing", "planner", "fast_worker"]);
  }
  if (normalizedKind === "intake") {
    return new Set(["", "general", "routing", "planner"]);
  }
  return new Set(["", "general", "code", "document", "background", "creative", "vision", "retrieval", "fast_worker"]);
}

function isBrainSpecialtyAllowedForKind(kind = "worker", specialty = "") {
  return getAllowedBrainSpecialtiesForKind(kind).has(String(specialty || "").trim().toLowerCase());
}

function normalizeBrainSpecialtyForKind(kind = "worker", specialty = "") {
  const normalized = String(specialty || "").trim().toLowerCase();
  return isBrainSpecialtyAllowedForKind(kind, normalized) ? normalized : "";
}

function renderBrainSpecialtyOptions(selectedValue = "", kind = "worker") {
  const selected = String(selectedValue || "").trim().toLowerCase();
  const allowed = getAllowedBrainSpecialtiesForKind(kind);
  return getBrainSpecialtyOptions().map((option) => `
    <option
      value="${escapeAttr(option.value)}"
      ${selected === option.value ? "selected" : ""}
      ${allowed.has(option.value) ? "" : "disabled"}
    >${escapeHtml(option.label)}</option>
  `).join("");
}

function getDraftBrainRecords() {
  const builtIn = Array.isArray(brainConfigDraft?.builtInBrains) ? brainConfigDraft.builtInBrains : [];
  const custom = Array.isArray(brainConfigDraft?.brains?.custom) ? brainConfigDraft.brains.custom : [];
  return [
    ...builtIn.map((brain) => ({
      id: brain.id,
      label: brain.label,
      kind: brain.kind,
      model: brain.model,
      builtIn: true
    })),
    ...custom.map((brain) => ({
      id: brain.id,
      label: brain.label,
      kind: brain.kind,
      model: brain.model,
      builtIn: false
    }))
  ];
}

function syncBuiltInBrainOverrides() {
  if (!brainConfigDraft?.brains) {
    return;
  }
  const builtInBrains = Array.isArray(brainConfigDraft.builtInBrains) ? brainConfigDraft.builtInBrains : [];
  brainConfigDraft.brains.builtIn = builtInBrains
    .map((brain) => ({
      id: String(brain?.id || "").trim(),
      model: String(brain?.model || "").trim()
    }))
    .filter((brain) => brain.id);
}

function updateRemotePlannerHealthIndicator(brainActivity) {
  const selectedId = brainConfigDraft?.routing?.remoteTriageBrainId || "";
  const routingTabBtn = document.querySelector('[data-brain-subtab-target="brainsRoutingPanel"]');
  if (!selectedId) {
    remotePlannerSelectEl?.classList.remove("input-warn");
    routingTabBtn?.classList.remove("has-alert");
    return;
  }
  const entry = Array.isArray(brainActivity)
    ? brainActivity.find((b) => String(b.id || "") === selectedId)
    : null;
  const isUnhealthy = !entry || entry.endpointHealthy === false;
  remotePlannerSelectEl?.classList.toggle("input-warn", isUnhealthy);
  routingTabBtn?.classList.toggle("has-alert", isUnhealthy);
}

function renderBrainConfigEditor() {
  if (!brainConfigDraft) {
    brainEndpointsListEl.innerHTML = `<div class="panel-subtle">Brain configuration unavailable.</div>`;
    brainAssignmentsListEl.innerHTML = `<div class="panel-subtle">Brain configuration unavailable.</div>`;
    customBrainsListEl.innerHTML = `<div class="panel-subtle">Brain configuration unavailable.</div>`;
    routingMapListEl.innerHTML = `<div class="panel-subtle">Brain configuration unavailable.</div>`;
    return;
  }

  const endpoints = Object.entries(brainConfigDraft.brains?.endpoints || {});
  const endpointOptions = endpoints.map(([id, entry]) => `<option value="${escapeAttr(id)}">${escapeHtml(entry.label || id)} (${escapeHtml(id)})</option>`).join("");
  const enabledIds = new Set(Array.isArray(brainConfigDraft.brains?.enabledIds) ? brainConfigDraft.brains.enabledIds : []);
  const builtInBrains = Array.isArray(brainConfigDraft.builtInBrains) ? brainConfigDraft.builtInBrains : [];
  const customBrains = Array.isArray(brainConfigDraft.brains?.custom) ? brainConfigDraft.brains.custom : [];
  const plannerCandidates = getDraftBrainRecords().filter((brain) => brain.kind !== "worker");

  brainEndpointsListEl.innerHTML = endpoints.map(([id, entry]) => `
    <div class="brain-row" data-endpoint-id="${escapeAttr(id)}">
      <div class="brain-row-grid">
        <label class="stack-field">
          <span class="micro">Endpoint id</span>
          <input data-endpoint-field="id" value="${escapeAttr(id)}" ${id === "local" ? "disabled" : ""} />
        </label>
        <label class="stack-field">
          <span class="micro">Label</span>
          <input data-endpoint-field="label" value="${escapeAttr(entry.label || id)}" ${id === "local" ? "disabled" : ""} />
        </label>
        <label class="stack-field">
          <span class="micro">Base URL</span>
          <input data-endpoint-field="baseUrl" value="${escapeAttr(entry.baseUrl || "")}" ${id === "local" ? "disabled" : ""} />
        </label>
      </div>
      <div class="brain-row-actions">
        <span class="brain-pill">${id === "local" ? "Required local endpoint" : "Remote endpoint"}</span>
        ${id === "local" ? "" : `<button class="secondary" type="button" data-remove-endpoint="${escapeAttr(id)}">Remove</button>`}
      </div>
    </div>
  `).join("");

  brainAssignmentsListEl.innerHTML = builtInBrains.map((brain) => `
    <div class="brain-assignment-row">
      <div>
        <strong>${escapeHtml(brain.label)}</strong>
        <div class="micro">${escapeHtml(brain.model)} · ${escapeHtml(brain.description || brain.kind)}</div>
      </div>
      <label class="stack-field">
        <span class="micro">Endpoint</span>
        <select data-assignment-brain="${escapeAttr(brain.id)}">${endpointOptions}</select>
      </label>
    </div>
  `).join("");

  brainAssignmentsListEl.innerHTML = builtInBrains.map((brain) => `
    <div class="brain-row">
      <div class="brain-row-actions">
        <label class="toggle">
          <input
            type="checkbox"
            data-built-in-brain="${escapeAttr(brain.id)}"
            data-built-in-field="enabled"
            ${enabledIds.has(brain.id) ? "checked" : ""}
          />
          <span>
            <strong>${escapeHtml(brain.label)}</strong>
            <div class="micro">${escapeHtml(brain.id)} - ${escapeHtml(brain.description || brain.kind)}</div>
          </span>
        </label>
      </div>
      <div class="brain-row-grid">
        <label class="stack-field">
          <span class="micro">Model</span>
          <input
            data-built-in-brain="${escapeAttr(brain.id)}"
            data-built-in-field="model"
            value="${escapeAttr(brain.model || "")}"
          />
        </label>
        <label class="stack-field">
          <span class="micro">Endpoint</span>
          <select data-assignment-brain="${escapeAttr(brain.id)}">${endpointOptions}</select>
        </label>
      </div>
    </div>
  `).join("");

  customBrainsListEl.innerHTML = customBrains.length
    ? customBrains.map((brain, index) => {
      const normalizedSpecialty = normalizeBrainSpecialtyForKind(brain.kind || "worker", brain.specialty || "");
      if (normalizedSpecialty !== String(brain.specialty || "").trim().toLowerCase()) {
        brain.specialty = normalizedSpecialty;
      }
      return `
      <div class="brain-row" data-custom-index="${index}">
        <div class="brain-row-actions">
          <label class="toggle">
            <input type="checkbox" data-custom-field="enabled" ${enabledIds.has(brain.id) ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(brain.label || brain.id)}</strong>
              <div class="micro">${escapeHtml(brain.kind)} · ${escapeHtml(brain.model)}</div>
            </span>
          </label>
          <button class="secondary" type="button" data-remove-custom="${index}">Remove</button>
        </div>
        <div class="brain-row-grid wide">
          <label class="stack-field">
            <span class="micro">Id</span>
            <input data-custom-field="id" value="${escapeAttr(brain.id || "")}" />
          </label>
          <label class="stack-field">
            <span class="micro">Label</span>
            <input data-custom-field="label" value="${escapeAttr(brain.label || "")}" />
          </label>
          <label class="stack-field">
            <span class="micro">Kind</span>
            <select data-custom-field="kind">
              <option value="helper" ${brain.kind === "helper" ? "selected" : ""}>helper</option>
              <option value="worker" ${brain.kind === "worker" ? "selected" : ""}>worker</option>
              <option value="intake" ${brain.kind === "intake" ? "selected" : ""}>intake</option>
            </select>
          </label>
          <label class="stack-field">
            <span class="micro">Model</span>
            <input data-custom-field="model" value="${escapeAttr(brain.model || "")}" />
          </label>
        </div>
        <div class="brain-row-grid wide">
          <label class="stack-field">
            <span class="micro">Endpoint</span>
            <select data-custom-field="endpointId">${endpointOptions}</select>
          </label>
          <label class="stack-field">
            <span class="micro">Specialty</span>
            <select data-custom-field="specialty">${renderBrainSpecialtyOptions(brain.specialty || "", brain.kind || "worker")}</select>
          </label>
          <label class="stack-field">
            <span class="micro">Queue lane</span>
            <input data-custom-field="queueLane" value="${escapeAttr(brain.queueLane || "")}" placeholder="optional" />
          </label>
        </div>
        <label class="stack-field">
          <span class="micro">Description</span>
          <input data-custom-field="description" value="${escapeAttr(brain.description || "")}" />
        </label>
        <div class="brain-row-actions">
          <label class="toggle">
            <input type="checkbox" data-custom-field="toolCapable" ${brain.toolCapable ? "checked" : ""} />
            <span><strong>Tool capable</strong></span>
          </label>
          <label class="toggle">
            <input type="checkbox" data-custom-field="cronCapable" ${brain.cronCapable ? "checked" : ""} />
            <span><strong>Scheduled-job capable</strong></span>
          </label>
        </div>
      </div>
    `;
    }).join("")
    : `<div class="panel-subtle">No custom specialists configured.</div>`;

  routingEnabledToggleEl.checked = brainConfigDraft.routing?.enabled === true;
  remoteParallelToggleEl.checked = brainConfigDraft.queue?.remoteParallel !== false;
  escalationEnabledToggleEl.checked = brainConfigDraft.queue?.escalationEnabled !== false;
  routingFallbackAttemptsEl.value = String(brainConfigDraft.routing?.fallbackAttempts ?? 2);
  remotePlannerSelectEl.innerHTML = [`<option value="">None</option>`]
    .concat(plannerCandidates.map((brain) => `<option value="${escapeAttr(brain.id)}">${escapeHtml(brain.label || brain.id)} (${escapeHtml(brain.id)})</option>`))
    .join("");
  remotePlannerSelectEl.value = brainConfigDraft.routing?.remoteTriageBrainId || "";

  routingMapListEl.innerHTML = `
    <div class="panel-subtle">
      Optional advanced route order. Specialty on each brain decides which workers are eligible; these fields only force the order for a specialty when you need a specific brain tried first. Leave a field blank to let Nova choose from matching worker specialties by score, health, and lane load.
    </div>
    ${getBrainRouteKeys().map((routeKey) => `
    <div class="route-map-row">
      <label class="stack-field">
        <span class="micro">${escapeHtml(routeKey)}</span>
      </label>
      <input data-routing-key="${escapeAttr(routeKey)}" value="${escapeAttr((brainConfigDraft.routing?.specialistMap?.[routeKey] || []).join(", "))}" placeholder="brain ids, comma separated" />
    </div>
  `).join("")}`;

  brainAssignmentsListEl.querySelectorAll("[data-assignment-brain]").forEach((select) => {
    const brainId = select.dataset.assignmentBrain;
    select.value = brainConfigDraft.brains?.assignments?.[brainId] || "local";
    select.onchange = () => {
      brainConfigDraft.brains.assignments[brainId] = select.value;
    };
  });

  brainAssignmentsListEl.querySelectorAll("[data-built-in-brain]").forEach((input) => {
    const brainId = input.dataset.builtInBrain;
    const field = input.dataset.builtInField;
    input.onchange = () => {
      const brain = Array.isArray(brainConfigDraft.builtInBrains)
        ? brainConfigDraft.builtInBrains.find((entry) => entry.id === brainId)
        : null;
      if (!brain) {
        return;
      }
      if (field === "enabled") {
        const enabled = new Set(brainConfigDraft.brains.enabledIds || []);
        if (input.checked) {
          enabled.add(brain.id);
        } else {
          enabled.delete(brain.id);
          if (brainConfigDraft.routing?.remoteTriageBrainId === brain.id) {
            brainConfigDraft.routing.remoteTriageBrainId = "";
            if (remotePlannerSelectEl) {
              remotePlannerSelectEl.value = "";
            }
          }
        }
        brainConfigDraft.brains.enabledIds = [...enabled];
        return;
      }
      if (field === "model") {
        brain.model = String(input.value || "").trim();
        syncBuiltInBrainOverrides();
      }
    };
  });

  brainEndpointsListEl.querySelectorAll("[data-endpoint-id]").forEach((row) => {
    const endpointId = row.dataset.endpointId;
    row.querySelectorAll("[data-endpoint-field]").forEach((input) => {
      input.onchange = () => {
        const field = input.dataset.endpointField;
        const current = brainConfigDraft.brains.endpoints[endpointId];
        if (!current || endpointId === "local") {
          return;
        }
        if (field === "id") {
          const nextId = String(input.value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
          if (!nextId || nextId === "local" || brainConfigDraft.brains.endpoints[nextId]) {
            renderBrainConfigEditor();
            return;
          }
          delete brainConfigDraft.brains.endpoints[endpointId];
          brainConfigDraft.brains.endpoints[nextId] = current;
          Object.keys(brainConfigDraft.brains.assignments || {}).forEach((brainId) => {
            if (brainConfigDraft.brains.assignments[brainId] === endpointId) {
              brainConfigDraft.brains.assignments[brainId] = nextId;
            }
          });
          (brainConfigDraft.brains.custom || []).forEach((brain) => {
            if (brain.endpointId === endpointId) {
              brain.endpointId = nextId;
            }
          });
          renderBrainConfigEditor();
          return;
        }
        current[field] = input.value;
      };
    });
  });

  brainEndpointsListEl.querySelectorAll("[data-remove-endpoint]").forEach((button) => {
    button.onclick = () => {
      const endpointId = button.dataset.removeEndpoint;
      delete brainConfigDraft.brains.endpoints[endpointId];
      Object.keys(brainConfigDraft.brains.assignments || {}).forEach((brainId) => {
        if (brainConfigDraft.brains.assignments[brainId] === endpointId) {
          brainConfigDraft.brains.assignments[brainId] = "local";
        }
      });
      (brainConfigDraft.brains.custom || []).forEach((brain) => {
        if (brain.endpointId === endpointId) {
          brain.endpointId = "local";
        }
      });
      renderBrainConfigEditor();
    };
  });

  customBrainsListEl.querySelectorAll("[data-custom-index]").forEach((row) => {
    const index = Number(row.dataset.customIndex || -1);
    row.querySelectorAll("[data-custom-field]").forEach((input) => {
      input.onchange = () => {
        const brain = brainConfigDraft.brains.custom[index];
        if (!brain) {
          return;
        }
        const field = input.dataset.customField;
        if (field === "enabled") {
          const enabled = new Set(brainConfigDraft.brains.enabledIds || []);
          if (input.checked) {
            enabled.add(brain.id);
          } else {
            enabled.delete(brain.id);
            if (brainConfigDraft.routing?.remoteTriageBrainId === brain.id) {
              brainConfigDraft.routing.remoteTriageBrainId = "";
              if (remotePlannerSelectEl) {
                remotePlannerSelectEl.value = "";
              }
            }
          }
          brainConfigDraft.brains.enabledIds = [...enabled];
          return;
        }
        if (field === "toolCapable" || field === "cronCapable") {
          brain[field] = input.checked;
          return;
        }
        if (field === "id") {
          const priorId = brain.id;
          const nextId = String(input.value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
          if (!nextId) {
            return;
          }
          brain.id = nextId;
          brainConfigDraft.brains.enabledIds = (brainConfigDraft.brains.enabledIds || []).map((value) => value === priorId ? nextId : value);
          Object.keys(brainConfigDraft.routing?.specialistMap || {}).forEach((routeKey) => {
            brainConfigDraft.routing.specialistMap[routeKey] = (brainConfigDraft.routing.specialistMap[routeKey] || []).map((value) => value === priorId ? nextId : value);
          });
          if (brainConfigDraft.routing?.remoteTriageBrainId === priorId) {
            brainConfigDraft.routing.remoteTriageBrainId = nextId;
          }
          renderBrainConfigEditor();
          return;
        }
        if (field === "kind") {
          brain.kind = input.value;
          brain.specialty = normalizeBrainSpecialtyForKind(brain.kind, brain.specialty || "");
          renderBrainConfigEditor();
          return;
        }
        if (field === "specialty") {
          brain.specialty = normalizeBrainSpecialtyForKind(brain.kind || "worker", input.value);
          if (brain.specialty !== input.value) {
            renderBrainConfigEditor();
          }
          return;
        }
        brain[field] = input.value;
      };
      if (input.tagName === "SELECT" && input.dataset.customField === "endpointId") {
        input.value = brainConfigDraft.brains.custom[index]?.endpointId || "local";
      }
    });
  });

  customBrainsListEl.querySelectorAll("[data-remove-custom]").forEach((button) => {
    button.onclick = () => {
      const index = Number(button.dataset.removeCustom || -1);
      const removed = brainConfigDraft.brains.custom[index];
      if (!removed) {
        return;
      }
      brainConfigDraft.brains.custom.splice(index, 1);
      brainConfigDraft.brains.enabledIds = (brainConfigDraft.brains.enabledIds || []).filter((id) => id !== removed.id);
      Object.keys(brainConfigDraft.routing?.specialistMap || {}).forEach((routeKey) => {
        brainConfigDraft.routing.specialistMap[routeKey] = (brainConfigDraft.routing.specialistMap[routeKey] || []).filter((id) => id !== removed.id);
      });
      if (brainConfigDraft.routing?.remoteTriageBrainId === removed.id) {
        brainConfigDraft.routing.remoteTriageBrainId = "";
      }
      renderBrainConfigEditor();
    };
  });

  routingEnabledToggleEl.onchange = () => { brainConfigDraft.routing.enabled = routingEnabledToggleEl.checked; };
  remoteParallelToggleEl.onchange = () => { brainConfigDraft.queue.remoteParallel = remoteParallelToggleEl.checked; };
  escalationEnabledToggleEl.onchange = () => { brainConfigDraft.queue.escalationEnabled = escalationEnabledToggleEl.checked; };
  remotePlannerSelectEl.onchange = () => {
    brainConfigDraft.routing.remoteTriageBrainId = remotePlannerSelectEl.value;
    updateRemotePlannerHealthIndicator(lastBrainActivity);
  };
  routingFallbackAttemptsEl.onchange = () => {
    brainConfigDraft.routing.fallbackAttempts = Math.max(0, Math.min(Number(routingFallbackAttemptsEl.value || 0), 4));
  };
  routingMapListEl.querySelectorAll("[data-routing-key]").forEach((input) => {
    input.onchange = () => {
      brainConfigDraft.routing.specialistMap[input.dataset.routingKey] = String(input.value || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    };
  });
  updateRemotePlannerHealthIndicator(lastBrainActivity);
}

async function loadBrainConfig() {
  brainsHintEl.textContent = "Loading brain configuration...";
  try {
    const r = await fetch("/api/brains/config");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load brain configuration");
    }
    brainConfigDraft = cloneJson(j);
    renderBrainConfigEditor();
    brainsHintEl.textContent = "Brain configuration loaded.";
  } catch (error) {
    brainsHintEl.textContent = `Failed to load brain configuration: ${error.message}`;
  }
}

function addBrainEndpointDraft() {
  if (!brainConfigDraft) {
    return;
  }
  let index = 2;
  let endpointId = `lan_${index}`;
  while (brainConfigDraft.brains.endpoints[endpointId]) {
    index += 1;
    endpointId = `lan_${index}`;
  }
  brainConfigDraft.brains.endpoints[endpointId] = {
    label: `LAN Ollama ${index}`,
    baseUrl: `http://192.168.0.${70 + index}:11434`
  };
  renderBrainConfigEditor();
}

function addCustomBrainDraft() {
  if (!brainConfigDraft) {
    return;
  }
  let index = (brainConfigDraft.brains.custom || []).length + 1;
  let brainId = `specialist_${index}`;
  const usedIds = new Set(getDraftBrainRecords().map((brain) => brain.id));
  while (usedIds.has(brainId)) {
    index += 1;
    brainId = `specialist_${index}`;
  }
  const endpointIds = Object.keys(brainConfigDraft.brains.endpoints || {});
  const remoteEndpointId = endpointIds.find((id) => id !== "local") || "local";
  brainConfigDraft.brains.custom.push({
    id: brainId,
    label: `Specialist ${index}`,
    kind: "worker",
    model: "",
    endpointId: remoteEndpointId,
    queueLane: "",
    specialty: "fast_worker",
    toolCapable: true,
    cronCapable: false,
    description: ""
  });
  brainConfigDraft.brains.enabledIds = [...new Set([...(brainConfigDraft.brains.enabledIds || []), brainId])];
  renderBrainConfigEditor();
}

async function saveBrainConfig() {
  if (!brainConfigDraft) {
    return;
  }
  saveBrainsBtn.disabled = true;
  brainsHintEl.textContent = "Saving brain configuration...";
  try {
    syncBuiltInBrainOverrides();
    if (Array.isArray(brainConfigDraft.brains?.custom)) {
      brainConfigDraft.brains.custom = brainConfigDraft.brains.custom.map((brain) => ({
        ...brain,
        specialty: normalizeBrainSpecialtyForKind(brain?.kind || "worker", brain?.specialty || "")
      }));
    }
    const payload = {
      brains: {
        enabledIds: brainConfigDraft.brains?.enabledIds || [],
        endpoints: brainConfigDraft.brains?.endpoints || {},
        assignments: brainConfigDraft.brains?.assignments || {},
        custom: brainConfigDraft.brains?.custom || [],
        builtIn: brainConfigDraft.brains?.builtIn || []
      },
      routing: brainConfigDraft.routing || {},
      queue: brainConfigDraft.queue || {}
    };
    const r = await configAdminFetch("/api/brains/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to save brain configuration");
    }
    brainConfigDraft = cloneJson(j);
    brainsHintEl.textContent = j.message || "Brain configuration saved.";
    renderBrainConfigEditor();
    await observerApp.loadRuntimeOptions?.();
    await observerApp.refreshStatus?.();
  } catch (error) {
    brainsHintEl.textContent = `Save failed: ${error.message}`;
  } finally {
    saveBrainsBtn.disabled = false;
  }
}

function renderToolConfigEditor() {
  if (!toolConfigDraft) {
    toolCatalogListEl.innerHTML = `<div class="panel-subtle">Tool configuration unavailable.</div>`;
    installedSkillsListEl.innerHTML = `<div class="panel-subtle">Skill approval configuration unavailable.</div>`;
    capabilityRequestsListEl.innerHTML = `<div class="panel-subtle">Capability request state unavailable.</div>`;
    return;
  }

  const tools = Array.isArray(toolConfigDraft.tools) ? toolConfigDraft.tools : [];
  const installedSkills = Array.isArray(toolConfigDraft.installedSkills) ? toolConfigDraft.installedSkills : [];
  const toolRequests = Array.isArray(toolConfigDraft.toolRequests) ? toolConfigDraft.toolRequests : [];
  const skillRequests = Array.isArray(toolConfigDraft.skillRequests) ? toolConfigDraft.skillRequests : [];

  toolCatalogListEl.innerHTML = tools.length
    ? tools.map((tool, index) => `
      <div class="brain-row" data-tool-index="${index}">
        <div class="brain-row-actions">
          <label class="toggle">
            <input type="checkbox" data-tool-field="approved" ${tool.approved !== false ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(tool.name)}</strong>
              <div class="micro">${escapeHtml((tool.scopes || []).join(" + ") || "tool")} · ${escapeHtml(tool.risk || "normal")} risk</div>
            </span>
          </label>
          <span class="brain-pill">${escapeHtml(tool.defaultApproved !== false ? "default on" : "default off")}</span>
        </div>
        <div class="micro">${escapeHtml(tool.description || "No description.")}</div>
        <div class="micro">${escapeHtml(tool.source === "plugin" ? `Owned by plugin: ${tool.pluginName || tool.pluginId || "unknown"}` : "Owned by core system")}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No tools are currently available.</div>`;

  installedSkillsListEl.innerHTML = installedSkills.length
    ? installedSkills.map((skill, index) => `
      <div class="brain-row" data-skill-index="${index}">
        <div class="brain-row-actions">
          <label class="toggle">
            <input type="checkbox" data-skill-field="approved" ${skill.approved ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(skill.name || skill.slug)}</strong>
              <div class="micro">${escapeHtml(skill.slug)}${skill.containerPath ? ` · ${escapeHtml(skill.containerPath)}` : ""}</div>
            </span>
          </label>
          <span class="brain-pill">${skill.approved ? "approved" : "installed only"}</span>
        </div>
        <div class="micro">${escapeHtml(skill.description || "No description.")}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No extra skills installed.</div>`;

  const capabilityRequests = [
    ...skillRequests.map((request) => ({ ...request, requestType: "skill" })),
    ...toolRequests.map((request) => ({ ...request, requestType: "tool" }))
  ].sort((left, right) => Number(right.updatedAt || right.requestedAt || 0) - Number(left.updatedAt || left.requestedAt || 0));

  capabilityRequestsListEl.innerHTML = capabilityRequests.length
    ? capabilityRequests.map((request) => `
      <div class="brain-row">
        <div class="brain-row-actions">
          <span>
            <strong>${escapeHtml(request.requestType === "skill" ? (request.slug || request.skillSlug || "skill request") : (request.requestedTool || "tool request"))}</strong>
            <div class="micro">${escapeHtml(request.requestType === "skill" ? "skill install request" : "tool addition request")}${request.skillSlug ? ` Â· skill ${escapeHtml(request.skillSlug)}` : ""}</div>
          </span>
          <span class="brain-pill">${escapeHtml(String(request.requestCount || 1))}x</span>
        </div>
        <div class="micro">${escapeHtml(request.reason || request.summary || "No reason recorded.")}</div>
        <div class="micro">${escapeHtml(request.taskSummary || "No task summary recorded.")}</div>
        <div class="micro">${escapeHtml(formatDateTime(request.updatedAt || request.requestedAt || 0))}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No open capability requests.</div>`;

  toolCatalogListEl.querySelectorAll("[data-tool-index]").forEach((row) => {
    const index = Number(row.dataset.toolIndex || -1);
    row.querySelectorAll("[data-tool-field]").forEach((input) => {
      input.onchange = () => {
        const tool = toolConfigDraft.tools[index];
        if (!tool) {
          return;
        }
        if (input.dataset.toolField === "approved") {
          tool.approved = input.checked;
        }
      };
    });
  });

  installedSkillsListEl.querySelectorAll("[data-skill-index]").forEach((row) => {
    const index = Number(row.dataset.skillIndex || -1);
    row.querySelectorAll("[data-skill-field]").forEach((input) => {
      input.onchange = () => {
        const skill = toolConfigDraft.installedSkills[index];
        if (!skill) {
          return;
        }
        if (input.dataset.skillField === "approved") {
          skill.approved = input.checked;
          const statePill = row.querySelector(".brain-pill");
          if (statePill) {
            statePill.textContent = input.checked ? "approved" : "installed only";
          }
        }
      };
    });
  });
}

async function loadAgentSkills() {
  if (agentSkillsListEl) agentSkillsListEl.innerHTML = `<div class="panel-subtle">Loading agent skills...</div>`;
  try {
    const res = await fetch("/api/agent-skills");
    const j = await res.json();
    const skills = Array.isArray(j.skills) ? j.skills : [];
    if (!agentSkillsListEl) return;
    agentSkillsListEl.innerHTML = skills.length
      ? skills.map((skill) => {
          const tags = Array.isArray(skill.tags) && skill.tags.length
            ? skill.tags.map((t) => `<span class="brain-pill">${escapeHtml(t)}</span>`).join(" ")
            : "";
          const brain = skill.preferredBrainId
            ? `<span class="brain-pill">${escapeHtml(skill.preferredBrainId)}</span>`
            : "";
          return `
            <div class="brain-row">
              <div class="brain-row-actions">
                <span>
                  <strong>${escapeHtml(skill.name || skill.id)}</strong>
                  <div class="micro">${escapeHtml(skill.id)}</div>
                </span>
                <span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">${brain}${tags}</span>
              </div>
              <div class="micro">${escapeHtml(skill.description || "No description.")}</div>
            </div>
          `;
        }).join("")
      : `<div class="panel-subtle">No agent skills found. Add JSON files to the agent-skills/ directory.</div>`;
  } catch (error) {
    if (agentSkillsListEl) agentSkillsListEl.innerHTML = `<div class="panel-subtle">Failed to load agent skills: ${escapeHtml(String(error?.message || error))}</div>`;
  }
}

async function loadToolConfig() {
  toolsHintEl.textContent = "Loading tool configuration...";
  try {
    const r = await fetch("/api/tools/config");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load tool configuration");
    }
    toolConfigDraft = cloneJson(j);
    renderToolConfigEditor();
    const openRequestCount = (Array.isArray(j.toolRequests) ? j.toolRequests.length : 0) + (Array.isArray(j.skillRequests) ? j.skillRequests.length : 0);
    toolsHintEl.textContent = openRequestCount
      ? `Tool configuration loaded. ${openRequestCount} open capability request${openRequestCount === 1 ? "" : "s"}.`
      : "Tool configuration loaded.";
  } catch (error) {
    toolsHintEl.textContent = `Failed to load tool configuration: ${error.message}`;
  }
}

async function saveToolConfig() {
  if (!toolConfigDraft) {
    return;
  }
  saveToolsBtn.disabled = true;
  toolsHintEl.textContent = "Saving tool configuration...";
  try {
    // Sync from the live DOM before building the payload so the save path
    // does not depend on prior onchange handlers having already fired.
    toolCatalogListEl.querySelectorAll("[data-tool-index]").forEach((row) => {
      const index = Number(row.dataset.toolIndex || -1);
      const tool = Array.isArray(toolConfigDraft.tools) ? toolConfigDraft.tools[index] : null;
      if (!tool) {
        return;
      }
      const approvedInput = row.querySelector('[data-tool-field="approved"]');
      if (approvedInput) {
        tool.approved = approvedInput.checked;
      }
    });
    installedSkillsListEl.querySelectorAll("[data-skill-index]").forEach((row) => {
      const index = Number(row.dataset.skillIndex || -1);
      const skill = Array.isArray(toolConfigDraft.installedSkills) ? toolConfigDraft.installedSkills[index] : null;
      if (!skill) {
        return;
      }
      const approvedInput = row.querySelector('[data-skill-field="approved"]');
      if (approvedInput) {
        skill.approved = approvedInput.checked;
      }
    });
    const payload = {
      toolApprovals: Object.fromEntries(
        (Array.isArray(toolConfigDraft.tools) ? toolConfigDraft.tools : []).map((tool) => [tool.name, tool.approved !== false])
      ),
      skillApprovals: Object.fromEntries(
        (Array.isArray(toolConfigDraft.installedSkills) ? toolConfigDraft.installedSkills : []).map((skill) => [skill.slug, skill.approved === true])
      )
    };
    const r = await fetch("/api/tools/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to save tool configuration");
    }
    toolConfigDraft = cloneJson(j);
    renderToolConfigEditor();
    toolsHintEl.textContent = j.message || "Tool configuration saved.";
  } catch (error) {
    toolsHintEl.textContent = `Save failed: ${error.message}`;
  } finally {
    saveToolsBtn.disabled = false;
  }
}
Object.assign(observerApp, {
  getNovaConfigDraft: () => novaConfigDraft,
  updateRemotePlannerHealthIndicator,
  loadBrainConfig,
  loadNovaConfig,
  loadToolConfig,
  loadAgentSkills,
  addBrainEndpointDraft,
  addCustomBrainDraft,
  applyAppConfigToStage,
  saveBrainConfig,
  saveNovaConfig,
  saveToolConfig
});

})();
