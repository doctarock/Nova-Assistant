export function createToolConfigService({
  buildToolCatalog,
  compactTaskText,
  normalizeToolName,
  sanitizeSkillSlug,
  readVolumeFile,
  writeVolumeText,
  toolRegistryPath,
  capabilityRequestsPath,
  listInstalledSkills,
  containerSkillExists,
  approveInstalledSkill,
  revokeInstalledSkillApproval
} = {}) {
  async function loadToolRegistryState() {
    const catalog = buildToolCatalog();
    const defaults = Object.fromEntries(catalog.map((tool) => [tool.name, { approved: tool.defaultApproved !== false }]));
    try {
      const content = await readVolumeFile(toolRegistryPath);
      const parsed = JSON.parse(content);
      const saved = parsed && typeof parsed.tools === "object" && parsed.tools ? parsed.tools : {};
      return {
        tools: {
          ...defaults,
          ...saved
        }
      };
    } catch {
      return { tools: defaults };
    }
  }

  async function saveToolRegistryState(state = null) {
    const nextState = state && typeof state === "object"
      ? state
      : await loadToolRegistryState();
    await writeVolumeText(toolRegistryPath, `${JSON.stringify(nextState, null, 2)}\n`);
  }

  function normalizeCapabilityRequestText(value = "", maxLength = 320) {
    return compactTaskText(String(value || "").replace(/\s+/g, " ").trim(), maxLength);
  }

  function normalizeCapabilityRequestEntry(entry = {}, kind = "tool") {
    const normalizedKind = kind === "skill" ? "skill" : "tool";
    const key = normalizedKind === "skill"
      ? sanitizeSkillSlug(entry.slug || entry.requestedSkill || "")
      : normalizeCapabilityRequestText(entry.requestedTool || entry.toolName || "", 120).toLowerCase();
    if (!key) {
      return null;
    }
    const now = Date.now();
    return {
      id: String(entry.id || `${normalizedKind}-request-${key.replace(/[^a-z0-9._-]+/g, "-")}`).trim(),
      kind: normalizedKind,
      status: String(entry.status || "open").trim().toLowerCase() || "open",
      requestedTool: normalizedKind === "tool"
        ? normalizeCapabilityRequestText(entry.requestedTool || entry.toolName || "", 120)
        : "",
      slug: normalizedKind === "skill"
        ? sanitizeSkillSlug(entry.slug || entry.requestedSkill || "")
        : "",
      skillSlug: sanitizeSkillSlug(entry.skillSlug || ""),
      skillName: normalizeCapabilityRequestText(entry.skillName || "", 120),
      summary: normalizeCapabilityRequestText(entry.summary || entry.reason || "", 320),
      reason: normalizeCapabilityRequestText(entry.reason || entry.summary || "", 500),
      taskSummary: normalizeCapabilityRequestText(entry.taskSummary || entry.task || "", 220),
      requestedBy: normalizeCapabilityRequestText(entry.requestedBy || "worker", 80) || "worker",
      requestedAt: Number(entry.requestedAt || now),
      updatedAt: Number(entry.updatedAt || entry.requestedAt || now),
      requestCount: Math.max(1, Number(entry.requestCount || 1)),
      source: normalizeCapabilityRequestText(entry.source || "", 120),
      key
    };
  }

  async function loadCapabilityRequestState() {
    try {
      const content = await readVolumeFile(capabilityRequestsPath);
      const parsed = JSON.parse(content);
      return {
        toolRequests: Array.isArray(parsed?.toolRequests)
          ? parsed.toolRequests.map((entry) => normalizeCapabilityRequestEntry(entry, "tool")).filter(Boolean)
          : [],
        skillRequests: Array.isArray(parsed?.skillRequests)
          ? parsed.skillRequests.map((entry) => normalizeCapabilityRequestEntry(entry, "skill")).filter(Boolean)
          : []
      };
    } catch {
      return {
        toolRequests: [],
        skillRequests: []
      };
    }
  }

  async function saveCapabilityRequestState(state = null) {
    const nextState = state && typeof state === "object"
      ? state
      : await loadCapabilityRequestState();
    await writeVolumeText(capabilityRequestsPath, `${JSON.stringify(nextState, null, 2)}\n`);
  }

  function upsertCapabilityRequest(list = [], entry = {}, kind = "tool") {
    const normalizedEntry = normalizeCapabilityRequestEntry(entry, kind);
    if (!normalizedEntry) {
      throw new Error(kind === "skill" ? "skill slug is required" : "requestedTool is required");
    }
    const existingIndex = list.findIndex((candidate) =>
      String(candidate?.status || "open").trim().toLowerCase() === "open"
      && String(candidate?.key || "").trim() === normalizedEntry.key
    );
    if (existingIndex >= 0) {
      const existing = normalizeCapabilityRequestEntry(list[existingIndex], kind);
      list[existingIndex] = {
        ...existing,
        ...normalizedEntry,
        id: existing.id,
        requestedAt: Number(existing.requestedAt || normalizedEntry.requestedAt || Date.now()),
        updatedAt: Date.now(),
        requestCount: Math.max(1, Number(existing.requestCount || 1)) + 1,
        status: "open"
      };
      return list[existingIndex];
    }
    list.unshift(normalizedEntry);
    if (list.length > 40) {
      list.splice(40);
    }
    return normalizedEntry;
  }

  async function recordToolAdditionRequest(args = {}) {
    const requestedTool = normalizeCapabilityRequestText(args.requestedTool || args.toolName || "", 120);
    if (!requestedTool) {
      throw new Error("requestedTool is required");
    }
    const state = await loadCapabilityRequestState();
    const saved = upsertCapabilityRequest(state.toolRequests, {
      requestedTool,
      skillSlug: args.skillSlug,
      skillName: args.skillName,
      summary: args.summary || args.reason,
      reason: args.reason || args.summary,
      taskSummary: args.taskSummary || args.task,
      requestedBy: args.requestedBy || "worker",
      source: args.source || "runtime"
    }, "tool");
    await saveCapabilityRequestState(state);
    return saved;
  }

  async function recordSkillInstallationRequest(args = {}) {
    const slug = sanitizeSkillSlug(args.slug || args.requestedSkill || "");
    if (!slug) {
      throw new Error("skill slug is required");
    }
    const state = await loadCapabilityRequestState();
    const saved = upsertCapabilityRequest(state.skillRequests, {
      slug,
      skillSlug: args.skillSlug || slug,
      skillName: args.skillName,
      summary: args.summary || args.reason,
      reason: args.reason || args.summary,
      taskSummary: args.taskSummary || args.task,
      requestedBy: args.requestedBy || "worker",
      source: args.source || "runtime"
    }, "skill");
    await saveCapabilityRequestState(state);
    return saved;
  }

  function summarizeCapabilityRequests(requests = [], kind = "tool") {
    return (Array.isArray(requests) ? requests : [])
      .filter((entry) => String(entry?.status || "open").trim().toLowerCase() === "open")
      .slice(0, 12)
      .map((entry) => normalizeCapabilityRequestEntry(entry, kind))
      .filter(Boolean);
  }

  async function resolveSkillInstallationRequest(slug = "", meta = {}) {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) {
      return false;
    }
    const state = await loadCapabilityRequestState();
    const existingIndex = state.skillRequests.findIndex((entry) =>
      String(entry?.status || "open").trim().toLowerCase() === "open"
      && String(entry?.key || "").trim() === safeSlug
    );
    if (existingIndex < 0) {
      return false;
    }
    state.skillRequests[existingIndex] = {
      ...state.skillRequests[existingIndex],
      status: "resolved",
      updatedAt: Date.now(),
      resolvedAt: Date.now(),
      resolution: "approved",
      ...meta
    };
    await saveCapabilityRequestState(state);
    return true;
  }

  async function isToolApprovedForAutonomousUse(name = "") {
    const toolName = normalizeToolName(name);
    if (!toolName) {
      return false;
    }
    const state = await loadToolRegistryState();
    const stored = state.tools?.[toolName];
    if (stored && Object.prototype.hasOwnProperty.call(stored, "approved")) {
      return stored.approved !== false;
    }
    const catalogEntry = buildToolCatalog().find((tool) => tool.name === toolName);
    return catalogEntry ? catalogEntry.defaultApproved !== false : true;
  }

  async function ensureAutonomousToolApproved(name = "") {
    const toolName = normalizeToolName(name);
    if (!(await isToolApprovedForAutonomousUse(toolName))) {
      throw new Error(`tool ${toolName} is disabled for autonomous use`);
    }
  }

  async function buildToolConfigPayload() {
    const catalog = buildToolCatalog();
    const state = await loadToolRegistryState();
    const installedSkills = await listInstalledSkills();
    const capabilityRequests = await loadCapabilityRequestState();
    return {
      tools: catalog.map((tool) => ({
        ...tool,
        approved: state.tools?.[tool.name]?.approved !== false
      })),
      installedSkills: installedSkills.map((skill) => ({
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        approved: Boolean(skill.approved),
        containerPath: skill.containerPath || ""
      })),
      toolRequests: summarizeCapabilityRequests(capabilityRequests.toolRequests, "tool"),
      skillRequests: summarizeCapabilityRequests(capabilityRequests.skillRequests, "skill")
    };
  }

  async function updateToolConfig(payload = {}) {
    const requestedApprovals = payload?.toolApprovals && typeof payload.toolApprovals === "object"
      ? payload.toolApprovals
      : {};
    const requestedSkillApprovals = payload?.skillApprovals && typeof payload.skillApprovals === "object"
      ? payload.skillApprovals
      : {};
    const state = await loadToolRegistryState();
    const knownTools = new Set(buildToolCatalog().map((tool) => tool.name));
    for (const [name, approved] of Object.entries(requestedApprovals)) {
      const normalizedName = normalizeToolName(name);
      if (!knownTools.has(normalizedName)) {
        continue;
      }
      state.tools[normalizedName] = {
        approved: approved !== false,
        updatedAt: Date.now(),
        source: "ui"
      };
    }
    await saveToolRegistryState(state);
    for (const [slug, approved] of Object.entries(requestedSkillApprovals)) {
      const safeSlug = sanitizeSkillSlug(slug);
      if (!safeSlug || !(await containerSkillExists(safeSlug))) {
        continue;
      }
      if (approved === false) {
        await revokeInstalledSkillApproval(safeSlug);
      } else {
        await approveInstalledSkill(safeSlug, { source: "ui", approvedBy: "user" });
        await resolveSkillInstallationRequest(safeSlug, { resolvedBy: "user", source: "ui" });
      }
    }
    return buildToolConfigPayload();
  }

  return {
    buildToolConfigPayload,
    ensureAutonomousToolApproved,
    isToolApprovedForAutonomousUse,
    loadCapabilityRequestState,
    loadToolRegistryState,
    recordSkillInstallationRequest,
    recordToolAdditionRequest,
    saveCapabilityRequestState,
    saveToolRegistryState,
    summarizeCapabilityRequests,
    updateToolConfig
  };
}
