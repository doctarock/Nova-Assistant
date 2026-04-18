export function createObserverTaskExecutionSupport(context = {}) {
  const {
    MODEL_KEEPALIVE,
    PROMPT_USER_PATH,
    chooseHealthyRemoteTriageBrain,
    chooseIntakePlanningBrain,
    compactTaskText,
    extractContainerPathCandidates,
    extractJsonObject,
    fs,
    getAgentPersonaName,
    getBrain,
    getBrainQueueLane,
    getOllamaEndpointHealth,
    getQueueLaneLoadSnapshot,
    getRoutingConfig,
    isImageMimeType,
    isPathWithinAllowedRoots,
    listAvailableBrains,
    looksLikeCapabilityRefusalCompletionSummary,
    looksLikeLowSignalCompletionSummary,
    normalizeAgentSelfReference,
    path,
    readVolumeFile,
    resolveSourcePathFromContainerPath,
    runOllamaGenerate,
    runOllamaJsonGenerate,
    summarizePayloadText
  } = context;
function normalizeUserRequest(message = "") {
  const raw = String(message || "").trim();
  if (!raw) {
    return raw;
  }
  const lower = raw.toLowerCase();

  if (/\b(what did you get up to last night|what were you up to last night|what did you do last night)\b/.test(lower)) {
    return "Tell me what work you completed last night, which scheduled jobs ran, their outcomes, what files you created or changed, and what is still pending.";
  }

  if (/\b(what have you been up to|what have you been doing|what did you work on today)\b/.test(lower)) {
    return "Tell me what work you completed recently, which scheduled jobs ran, their outcomes, what files you created or changed, and what is still in progress.";
  }

  if (/\bwhat did you work on\b/.test(lower) && /\b(last night|today|recently)\b/.test(lower)) {
    return raw
      .replace(/\bwhat did you work on\b/i, "Tell me what work you completed")
      .replace(/\?+$/, "")
      .concat(", including scheduled job activity, outcomes, and changed files.");
  }

  return raw;
}

function looksLikePlaceholderTaskMessage(value = "") {
  return /^(?:\.{3,}|\u2026+|\[\.\.\.\]|\(\.\.\.\)|placeholder|same|unchanged)$/i.test(String(value || "").trim());
}

function looksLikeResearchOrScienceTask(text = "") {
  return /\b(research|scientific|science|literature review|evidence synthesis|peer[- ]reviewed|citations?|references|study|studies|journal|paper|papers|methodology|hypothesis|dataset|analysis|biology|biological|biochem(?:istry)?|chemistry|chemical|metabolic|pathway|pathways|genetic|genomics|proteomics|clinical|bioinformatics)\b/.test(String(text || "").toLowerCase());
}

function inferTaskSpecialty(task = {}) {
  const hinted = String(task.specialtyHint || task.opportunitySpecialty || "").trim().toLowerCase();
  if (["code", "document", "general", "background", "creative", "vision", "retrieval"].includes(hinted)) {
    return hinted;
  }
  const internalJobType = String(task.internalJobType || "").trim().toLowerCase();
  const text = `${String(task.message || "").trim()}\n${String(task.notes || "").trim()}`.toLowerCase();
  if (internalJobType === "project_cycle" && /\b(manuscript|novel|novella|story|scene|chapter|outline|arc|draft|voice|pacing|dialogue|reading copy|front matter|end matter|character|worldbuild|setting|narrative|fiction|plot|prose)\b/.test(text)) {
    return "creative";
  }
  if (internalJobType === "project_cycle" && looksLikeResearchOrScienceTask(text)) {
    return "retrieval";
  }
  if (internalJobType === "project_cycle" && /\b(code|implement|refactor|debug|bug|fix|patch|test|tests|api|backend|frontend|script|build|deploy|repo|repository)\b/.test(text)) {
    return "code";
  }
  if (internalJobType === "project_cycle") {
    return "background";
  }
  if (["opportunity_scan", "mail_watch"].includes(internalJobType)) {
    return "background";
  }
  if (Array.isArray(task.attachments) && task.attachments.some((attachment) => isImageMimeType(attachment?.type || ""))) {
    return "vision";
  }
  if (/\b(image|images|vision|photo|picture|screenshot|see this|look at this image|analyze this image)\b/.test(text)) {
    return "vision";
  }
  if (/\b(creative|brainstorm|brain storm|story|poem|rewrite creatively|marketing copy|campaign|tagline|slogan|copywriting|narrative)\b/.test(text)) {
    return "creative";
  }
  if (/\b(retrieval|embedding|embed|semantic search|vector|similarity search)\b/.test(text)) {
    return "retrieval";
  }
  if (looksLikeResearchOrScienceTask(text)) {
    return "retrieval";
  }
  if (/\b(code|coder|coding|implement|implementation|refactor|debug|bug|fix|patch|repo|repository|project|function|component|class|api|test|tests|todo|fixme|script)\b/.test(text)) {
    return "code";
  }
  if (/\b(document|documents|attachment|attachments|summari[sz]e|summary|review this file|review this document|read this|report|briefing|inbox|email|mail)\b/.test(text)) {
    return "document";
  }
  return "general";
}

function inferTaskCapabilityProfile({
  message = "",
  taskSpecialty = "",
  forceToolUse = false,
  preset = "autonomous"
} = {}) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const specialty = String(taskSpecialty || "").trim().toLowerCase();
  const isProjectCycle = text.includes("/PROJECT-TODO.md");
  const isQueuedExecution = String(preset || "").trim().toLowerCase() === "queued-task";
  const looksCodeHeavy = forceToolUse || /\b(project|repo|repository|code|implement|implementation|refactor|debug|bug|fix|patch|todo|fixme|script|test|tests|api|backend|frontend)\b/.test(lower);
  const looksResearchHeavy = specialty === "retrieval" || looksLikeResearchOrScienceTask(lower);
  const capabilities = [];
  const seen = new Set();

  const addCapability = (id, label, preferredTools = [], reason = "", instruction = "") => {
    const normalizedId = String(id || "").trim().toLowerCase();
    if (!normalizedId || seen.has(normalizedId)) {
      return;
    }
    seen.add(normalizedId);
    capabilities.push({
      id: normalizedId,
      label: String(label || "").trim(),
      preferredTools: preferredTools.map((entry) => String(entry || "").trim()).filter(Boolean),
      reason: compactTaskText(String(reason || "").trim(), 160),
      instruction: compactTaskText(String(instruction || "").trim(), 220)
    });
  };

  if (/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)\b/.test(lower) || /\b(zip|unzip|archive|extract|unpack|tarball|bundle)\b/.test(lower)) {
    addCapability(
      "archive_extract",
      "Archive extraction",
      ["unzip", "list_files", "read_document", "shell_command"],
      "The task mentions a packaged archive or extracted project input.",
      "Inspect the archive path early and prefer unzip before treating extraction as a missing capability."
    );
  }

  if (isProjectCycle || looksCodeHeavy || /\b(source|src|package\.json|readme|directive|todo|fixme|workspace)\b/.test(lower)) {
    addCapability(
      "repo_inspection",
      "Repo inspection",
      ["list_files", "read_document", "read_file", "shell_command"],
      "The task needs grounded workspace inspection before any conclusion.",
      "Use list_files and targeted reads to converge on a concrete project file or directory quickly."
    );
  }

  if (looksResearchHeavy) {
    addCapability(
      "evidence_synthesis",
      "Evidence synthesis",
      ["read_document", "web_fetch", "edit_file"],
      "The task looks research-heavy and should stay grounded in traceable evidence.",
      "Capture citations or source references you actually read, then separate verified findings from assumptions."
    );
  }

  if (isProjectCycle || isQueuedExecution || /\b(edit|update|write|rewrite|create|fix|implement|refactor|patch|improve|rename)\b/.test(lower)) {
    addCapability(
      "file_edit",
      "File editing",
      ["edit_file", "write_file", "move_path"],
      "The task likely expects a concrete file mutation or artifact.",
      "Once the right target is clear, prefer edit_file for surgical changes and write_file only for new or full-file content."
    );
  }

  if (isProjectCycle || looksCodeHeavy || /\b(test|validate|verify|build|run|script|cli|shell|command|npm|node|python|pytest)\b/.test(lower)) {
    addCapability(
      "shell_validation",
      "Shell validation",
      ["shell_command", "read_document", "read_file"],
      "The task may need command-based inspection or brief validation after edits.",
      "Use shell_command for compact inspection or validation once you have a concrete target."
    );
  }

  if (specialty === "document" || specialty === "creative" || /\b(readme|directive|document|summary|manuscript|outline|briefing|notes|markdown|md\b|pdf)\b/.test(lower)) {
    addCapability(
      "document_review",
      "Document review",
      ["read_document", "read_file", "edit_file"],
      "The task references documents where normalized reads are more useful than raw shell output.",
      "Prefer read_document for long or structured documents, then edit only once the concrete revision is clear."
    );
  }

  if (/\b(skill library|skills library|missing tool|missing capability|request tool|request skill|toolbelt)\b/.test(lower)) {
    addCapability(
      "capability_recovery",
      "Capability recovery",
      ["search_skill_library", "inspect_skill_library", "request_skill_installation", "request_tool_addition"],
      "The task itself suggests a missing capability may be the blocker.",
      "If the blocker is real, verify the available tool names first, then record a skill or tool request instead of repeating inspection."
    );
  }

  if (/\b(web|website|url|http|https|browse|search the web|internet|fetch)\b/.test(lower)) {
    addCapability(
      "web_research",
      "Web research",
      ["web_fetch", "read_document"],
      "The task references online material or fetchable URLs.",
      "Only use web_fetch when the task actually depends on online content or a named URL."
    );
  }

  return capabilities;
}

function buildTaskCapabilityPromptLines(profile = []) {
  const capabilities = Array.isArray(profile) ? profile.filter(Boolean) : [];
  if (!capabilities.length) {
    return [];
  }
  const lines = ["Predicted capability focus for this task:"];
  for (const capability of capabilities.slice(0, 5)) {
    const tools = capability.preferredTools.length ? `prefer ${capability.preferredTools.join(", ")}` : "use the matching observer tools";
    const reason = capability.reason ? ` ${capability.reason}` : "";
    lines.push(`- ${capability.label}: ${tools}.${reason}`);
  }
  for (const capability of capabilities.slice(0, 4)) {
    if (capability.instruction) {
      lines.push(`Capability note: ${capability.instruction}`);
    }
  }
  return lines;
}

function summarizeTaskCapabilities(profile = []) {
  const capabilities = Array.isArray(profile) ? profile.filter(Boolean) : [];
  if (!capabilities.length) {
    return "";
  }
  return capabilities.slice(0, 4).map((capability) => {
    const toolLead = capability.preferredTools[0] ? `${capability.label} via ${capability.preferredTools[0]}` : capability.label;
    return compactTaskText(toolLead, 80);
  }).join("; ");
}

function isCreativeOnlyBrain(brain = {}) {
  const id = String(brain?.id || "").trim().toLowerCase();
  const specialty = String(brain?.specialty || "").trim().toLowerCase();
  return id === "creative_worker" || specialty === "creative";
}

async function chooseCreativeHandoffBrain({ excludeBrainId = "" } = {}) {
  const normalizedExcludeId = String(excludeBrainId || "").trim();
  const routing = getRoutingConfig();
  const brains = await listAvailableBrains();
  const configuredCreativeIds = Array.isArray(routing?.specialistMap?.creative)
    ? routing.specialistMap.creative.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const ordered = [
    ...configuredCreativeIds.map((id) => brains.find((brain) => String(brain?.id || "").trim() === id)).filter(Boolean),
    ...brains.filter((brain) =>
      isCreativeOnlyBrain(brain)
      && !configuredCreativeIds.includes(String(brain?.id || "").trim())
    )
  ];
  return ordered.find((brain) =>
    brain
    && brain.kind === "worker"
    && String(brain.id || "").trim() !== normalizedExcludeId
    && isCreativeOnlyBrain(brain)
  ) || null;
}

function detectCreativeTaskMode(message = "") {
  const lower = String(message || "").toLowerCase();
  if (/\b(brainstorm|ideas|hooks|premise|titles?|alternatives?|options)\b/.test(lower)) return "brainstorm";
  if (/\b(outline|beat sheet|beats|chapter plan|scene list|structure|arc)\b/.test(lower)) return "outline";
  if (/\b(revise|revision|rewrite|redraft|expand|author|write|draft|scene|chapter|manuscript|novella|story)\b/.test(lower)) return "draft";
  if (/\b(edit|tighten|trim|polish|line edit|copy edit|voice pass|pacing|clarity)\b/.test(lower)) return "polish";
  return "draft";
}

function limitCreativeDraftText(text = "", maxChars = 7000) {
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (raw.length <= maxChars) {
    return raw;
  }
  return `${raw.slice(0, maxChars).trim()}\n\n[truncated]`;
}

async function buildCreativeHandoffContextBlocks(task = {}, trackedWorkspacePaths = []) {
  const blocks = [];
  const seen = new Set();
  const candidates = [
    ...extractContainerPathCandidates(String(task.message || "").trim())
      .map((candidate) => resolveSourcePathFromContainerPath(candidate))
      .filter(Boolean),
    ...(Array.isArray(trackedWorkspacePaths) ? trackedWorkspacePaths : [])
  ];
  for (const candidate of candidates) {
    const resolved = path.resolve(String(candidate || "").trim() || ".");
    if (!resolved || seen.has(resolved) || !isPathWithinAllowedRoots(resolved)) {
      continue;
    }
    seen.add(resolved);
    if (blocks.length >= 3) {
      break;
    }
    let stats;
    try {
      stats = await fs.stat(resolved);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      try {
        const entries = (await fs.readdir(resolved, { withFileTypes: true }))
          .filter((entry) => ![".git", "node_modules"].includes(entry.name))
          .slice(0, 12)
          .map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${entry.name}`);
        blocks.push([
          `Context directory: ${resolved}`,
          entries.length ? `Entries: ${entries.join(", ")}` : "Entries: none"
        ].join("\n"));
      } catch {
        continue;
      }
      continue;
    }
    if (!stats.isFile()) {
      continue;
    }
    const ext = path.extname(resolved).toLowerCase();
    if (![".md", ".txt", ".json", ".html", ".htm", ".js", ".ts", ".jsx", ".tsx", ".css", ".scss", ".yaml", ".yml"].includes(ext)) {
      continue;
    }
    try {
      const content = await fs.readFile(resolved, "utf8");
      blocks.push([
        `Context file: ${resolved}`,
        limitCreativeDraftText(content, 2600)
      ].join("\n"));
    } catch {
      continue;
    }
  }
  return blocks;
}

function normalizeCreativeHandoffPacket(packet = {}, fallbackDraftText = "") {
  const mode = ["brainstorm", "outline", "draft", "polish"].includes(String(packet?.mode || "").trim().toLowerCase())
    ? String(packet.mode).trim().toLowerCase()
    : "draft";
  const summary = compactTaskText(String(packet?.summary || "").trim(), 220) || "Creative handoff prepared.";
  const deliverable = compactTaskText(String(packet?.deliverable || "").trim(), 240) || "Apply the creative packet concretely to the task.";
  const targetFiles = Array.isArray(packet?.targetFiles)
    ? packet.targetFiles.map((value) => compactTaskText(String(value || "").trim(), 220)).filter(Boolean).slice(0, 4)
    : [];
  const instructions = Array.isArray(packet?.instructions)
    ? packet.instructions.map((value) => compactTaskText(String(value || "").trim(), 220)).filter(Boolean).slice(0, 6)
    : [];
  const revisionNotes = Array.isArray(packet?.revisionNotes)
    ? packet.revisionNotes.map((value) => compactTaskText(String(value || "").trim(), 180)).filter(Boolean).slice(0, 6)
    : [];
  const continuityNotes = Array.isArray(packet?.continuityNotes)
    ? packet.continuityNotes.map((value) => compactTaskText(String(value || "").trim(), 180)).filter(Boolean).slice(0, 6)
    : [];
  const draftText = limitCreativeDraftText(String(packet?.draftText || fallbackDraftText || ""));
  return {
    mode,
    summary,
    deliverable,
    targetFiles,
    instructions,
    revisionNotes,
    continuityNotes,
    draftText
  };
}

function renderCreativeHandoffPacket(packet = {}) {
  const lines = [
    "Creative handoff packet:",
    `Mode: ${String(packet.mode || "draft").trim() || "draft"}`,
    `Summary: ${String(packet.summary || "").trim() || "Creative handoff prepared."}`,
    `Deliverable: ${String(packet.deliverable || "").trim() || "Apply the creative packet concretely to the task."}`
  ];
  if (Array.isArray(packet.targetFiles) && packet.targetFiles.length) {
    lines.push(`Target files: ${packet.targetFiles.join(", ")}`);
  }
  if (Array.isArray(packet.instructions) && packet.instructions.length) {
    lines.push("Worker instructions:");
    for (const entry of packet.instructions) {
      lines.push(`- ${entry}`);
    }
  }
  if (Array.isArray(packet.revisionNotes) && packet.revisionNotes.length) {
    lines.push("Revision notes:");
    for (const entry of packet.revisionNotes) {
      lines.push(`- ${entry}`);
    }
  }
  if (Array.isArray(packet.continuityNotes) && packet.continuityNotes.length) {
    lines.push("Continuity notes:");
    for (const entry of packet.continuityNotes) {
      lines.push(`- ${entry}`);
    }
  }
  if (String(packet.draftText || "").trim()) {
    lines.push("Draft text:");
    lines.push("<<<CREATIVE_DRAFT");
    lines.push(String(packet.draftText || "").trim());
    lines.push("CREATIVE_DRAFT");
  }
  return lines.join("\n");
}

async function executeCreativeHandoffPass({
  task = {},
  trackedWorkspacePaths = [],
  abortSignal = null
} = {}) {
  const creativeBrainId = String(task.creativeHandoffBrainId || "").trim();
  if (!creativeBrainId) {
    return { used: false, reason: "no_creative_handoff_brain" };
  }
  const creativeBrain = await getBrain(creativeBrainId);
  if (!creativeBrain) {
    return { used: false, reason: "creative_brain_missing" };
  }
  const health = await getOllamaEndpointHealth(creativeBrain.ollamaBaseUrl).catch(() => null);
  if (!health?.running) {
    return { used: false, reason: "creative_brain_unavailable", brainId: creativeBrain.id, brainLabel: creativeBrain.label };
  }
  const mode = detectCreativeTaskMode(String(task.message || "").trim());
  const contextBlocks = await buildCreativeHandoffContextBlocks(task, trackedWorkspacePaths);
  const prompt = [
    "You are Nova's creative drafting specialist.",
    "You cannot use tools or modify files directly.",
    "Create a structured handoff packet for a separate tool-capable worker who will apply your writing to the workspace.",
    "Return JSON only. No markdown fences.",
    "Write real prose when the task calls for drafting, revising, or polishing. Do not answer with vague notes when you can provide usable text.",
    "If the task is brainstorming, provide concrete options in draftText rather than empty commentary.",
    "If the task is outlining, provide a clean outline or scene plan in draftText.",
    "If the task is drafting or revising, provide the best candidate prose you can in draftText.",
    "Keep summary and deliverable concise.",
    "Use this schema exactly:",
    "{\"mode\":\"brainstorm|outline|draft|polish\",\"summary\":\"...\",\"deliverable\":\"...\",\"targetFiles\":[\"...\"],\"instructions\":[\"...\"],\"revisionNotes\":[\"...\"],\"continuityNotes\":[\"...\"],\"draftText\":\"...\"}",
    `Detected mode: ${mode}`,
    `Original task: ${String(task.message || "").trim()}`,
    `Task notes: ${String(task.notes || "").trim() || "none"}`,
    task.helperAnalysis?.summary ? `Helper summary: ${task.helperAnalysis.summary}` : "",
    task.helperAnalysis?.intent ? `Helper intent: ${task.helperAnalysis.intent}` : "",
    contextBlocks.length ? "" : "Context excerpts: none.",
    ...contextBlocks
  ].filter(Boolean).join("\n\n");
  const result = await runOllamaJsonGenerate(creativeBrain.model, prompt, {
    timeoutMs: 45000,
    keepAlive: MODEL_KEEPALIVE,
    baseUrl: creativeBrain.ollamaBaseUrl,
    signal: abortSignal,
    brainId: creativeBrain.id,
    leaseOwnerId: task?.id ? `task:${String(task.id).trim()}` : `creative-handoff:${String(task?.sessionId || "Main").trim() || "Main"}`,
    leaseWaitMs: 2500
  });
  if (!result.ok) {
    return {
      used: false,
      reason: "creative_generation_failed",
      brainId: creativeBrain.id,
      brainLabel: creativeBrain.label,
      error: result.stderr || "creative handoff failed"
    };
  }
  try {
    const parsed = extractJsonObject(result.text);
    return {
      used: true,
      reason: "creative_packet_ready",
      brainId: creativeBrain.id,
      brainLabel: creativeBrain.label,
      packet: normalizeCreativeHandoffPacket(parsed)
    };
  } catch {
    return {
      used: true,
      reason: "creative_packet_fallback_text",
      brainId: creativeBrain.id,
      brainLabel: creativeBrain.label,
      packet: normalizeCreativeHandoffPacket({ mode }, result.text)
    };
  }
}

function isVisionOnlyBrain(brain = {}) {
  const id = String(brain?.id || "").trim().toLowerCase();
  const specialty = String(brain?.specialty || "").trim().toLowerCase();
  return id === "vision_worker" || specialty === "vision";
}

function canBrainHandleSpecialty(brain = {}, specialty = "general") {
  if (!brain) {
    return false;
  }
  if (specialty !== "vision" && isVisionOnlyBrain(brain)) {
    return false;
  }
  if (specialty === "creative") {
    return true;
  }
  if (isCreativeOnlyBrain(brain)) {
    return false;
  }
  return true;
}

function scoreBrainForSpecialty(brain, specialty = "general") {
  if (!canBrainHandleSpecialty(brain, specialty)) {
    return 0;
  }
  const text = `${String(brain.id || "").toLowerCase()} ${String(brain.label || "").toLowerCase()} ${String(brain.description || "").toLowerCase()} ${String(brain.specialty || "").toLowerCase()}`;
  if (String(brain.specialty || "").toLowerCase() === specialty) {
    return 100;
  }
  if (specialty === "code" && /\b(code|coder|coding)\b/.test(text)) return 80;
  if (specialty === "document" && /\b(doc|document|summary|mail|email|review)\b/.test(text)) return 80;
  if (specialty === "background" && /\b(background|maintenance|scan|cleanup)\b/.test(text)) return 80;
  if (specialty === "creative" && /\b(creative|brainstorm|story|marketing|copy)\b/.test(text)) return 80;
  if (specialty === "vision" && /\b(vision|image|photo|screenshot|visual)\b/.test(text)) return 80;
  if (specialty === "retrieval" && /\b(retrieval|embed|embedding|vector|search)\b/.test(text)) return 80;
  if (specialty === "general" && /\b(general|worker)\b/.test(text)) return 70;
  return 0;
}

function normalizeCreativeThroughputMode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["conservative", "auto", "fast"].includes(normalized) ? normalized : "auto";
}

function taskPrefersHigherThroughputCreativeLane(task = {}, specialty = "general") {
  return specialty === "creative"
    && normalizeCreativeThroughputMode(task?.creativeThroughputMode) !== "conservative"
    && task?.preferHigherThroughputCreativeLane === true;
}

function scoreBrainForThroughputPreference(brain = {}, task = {}, specialty = "general") {
  if (!taskPrefersHigherThroughputCreativeLane(task, specialty) || !brain) {
    return 0;
  }
  const brainId = String(brain.id || "").trim().toLowerCase();
  const endpointId = String(brain.endpointId || "").trim().toLowerCase();
  const queueLane = String(brain.queueLane || getBrainQueueLane(brain)).trim().toLowerCase();
  const model = String(brain.model || "").trim().toLowerCase();
  let score = 0;
  if (brainId && brainId !== "worker") score += 80;
  if (endpointId && endpointId !== "local") score += 40;
  if (queueLane && !/^(|default)$/.test(queueLane) && !queueLane.includes("local")) score += 20;
  if (/\b(9b|14b|32b|70b)\b/.test(model)) score += 5;
  return score;
}

function preferHigherThroughputCreativeWorker(task = {}, preferredBrain = null, orderedBrains = [], specialty = "general", laneLoad = new Map()) {
  if (!taskPrefersHigherThroughputCreativeLane(task, specialty) || !preferredBrain || !Array.isArray(orderedBrains) || !orderedBrains.length) {
    return preferredBrain;
  }
  const preferredThroughput = scoreBrainForThroughputPreference(preferredBrain, task, specialty);
  const preferredSpecialtyScore = scoreBrainForSpecialty(preferredBrain, specialty);
  const betterCandidate = orderedBrains
    .filter((brain) => brain && brain.id !== preferredBrain.id)
    .map((brain) => ({
      brain,
      throughput: scoreBrainForThroughputPreference(brain, task, specialty),
      specialtyScore: scoreBrainForSpecialty(brain, specialty),
      load: Number(laneLoad.get(String(brain.queueLane || getBrainQueueLane(brain)).trim()) || 0)
    }))
    .filter((entry) => entry.throughput > preferredThroughput && entry.specialtyScore >= preferredSpecialtyScore)
    .sort((left, right) => {
      if (right.throughput !== left.throughput) {
        return right.throughput - left.throughput;
      }
      if (left.load !== right.load) {
        return left.load - right.load;
      }
      if (right.specialtyScore !== left.specialtyScore) {
        return right.specialtyScore - left.specialtyScore;
      }
      return String(left.brain.id || "").localeCompare(String(right.brain.id || ""));
    })[0];
  return betterCandidate?.brain || preferredBrain;
}

function chooseLessLoadedEquivalentWorker(preferredBrain, orderedBrains = [], specialty = "general", laneLoad = new Map()) {
  if (!preferredBrain || !Array.isArray(orderedBrains) || !orderedBrains.length) {
    return preferredBrain;
  }
  const preferredScore = scoreBrainForSpecialty(preferredBrain, specialty);
  const preferredLane = String(preferredBrain.queueLane || getBrainQueueLane(preferredBrain)).trim();
  const preferredLoad = Number(laneLoad.get(preferredLane) || 0);
  const equivalentCandidates = orderedBrains.filter((brain) => {
    if (!brain || brain.id === preferredBrain.id) {
      return false;
    }
    const brainLane = String(brain.queueLane || getBrainQueueLane(brain)).trim();
    if (!brainLane || brainLane === preferredLane) {
      return false;
    }
    return scoreBrainForSpecialty(brain, specialty) === preferredScore;
  });
  if (!equivalentCandidates.length) {
    return preferredBrain;
  }
  const betterCandidate = equivalentCandidates
    .map((brain) => ({
      brain,
      load: Number(laneLoad.get(String(brain.queueLane || getBrainQueueLane(brain)).trim()) || 0)
    }))
    .sort((left, right) => {
      if (left.load !== right.load) {
        return left.load - right.load;
      }
      return String(left.brain.id || "").localeCompare(String(right.brain.id || ""));
    })[0];
  if (betterCandidate && betterCandidate.load < preferredLoad) {
    return betterCandidate.brain;
  }
  return preferredBrain;
}

function preferHigherReliabilityProjectCycleWorker(task = {}, preferredBrain = null, orderedBrains = []) {
  const internalJobType = String(task?.internalJobType || "").trim().toLowerCase();
  if (internalJobType !== "project_cycle") {
    return preferredBrain;
  }
  const preferredBrainId = String(preferredBrain?.id || "").trim();
  if (preferredBrainId === "code_worker") {
    return orderedBrains.find((brain) => String(brain?.id || "").trim() === "lappy_coder") || preferredBrain;
  }
  return preferredBrain;
}

async function selectSpecialistBrainRoute(task = {}, { preferredBrainId = "" } = {}) {
  const routing = getRoutingConfig();
  const availableBrains = await listAvailableBrains();
  const workerCandidates = availableBrains.filter((brain) => brain.kind === "worker" && brain.toolCapable);
  const healthEntries = await Promise.all(workerCandidates.map(async (brain) => ({
    brain,
    health: await getOllamaEndpointHealth(brain.ollamaBaseUrl)
  })));
  const allHealthyWorkers = healthEntries
    .filter((entry) => entry.health.running)
    .map((entry) => entry.brain);
  const specialty = inferTaskSpecialty(task);
  const workers = allHealthyWorkers.filter((brain) => canBrainHandleSpecialty(brain, specialty));
  const defaultWorker = workers.find((brain) => brain.id === "worker") || allHealthyWorkers.find((brain) => brain.id === "worker") || workers[0] || allHealthyWorkers[0] || null;
  if (!defaultWorker) {
    return {
      specialty: "general",
      preferredBrainId: "worker",
      fallbackBrainIds: [],
      strategy: "default"
    };
  }
  if (!routing.enabled) {
    return {
      specialty,
      preferredBrainId: preferredBrainId || defaultWorker.id,
      fallbackBrainIds: [],
      strategy: "disabled"
    };
  }

  const prefersFastCreativeLane = taskPrefersHigherThroughputCreativeLane(task, specialty);
  const laneLoad = await getQueueLaneLoadSnapshot();
  const remoteTriageBrain = await chooseHealthyRemoteTriageBrain({
    availableBrains,
    laneLoad
  });
  const configuredOrder = (routing.specialistMap[specialty] || [])
    .filter((id) => !(prefersFastCreativeLane && String(id || "").trim() === "worker"));
  const candidates = configuredOrder
    .map((id) => workers.find((brain) => brain.id === id))
    .filter(Boolean);
  const scored = workers
    .filter((brain) => !candidates.some((entry) => entry.id === brain.id))
    .map((brain) => ({ brain, score: scoreBrainForSpecialty(brain, specialty) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.brain);
  const remainingWorkers = workers.filter((brain) =>
    !candidates.some((entry) => entry.id === brain.id)
    && !scored.some((entry) => entry.id === brain.id)
  );
  const ordered = [...candidates, ...scored, ...remainingWorkers].sort((left, right) => {
    const leftConfiguredIndex = configuredOrder.indexOf(left.id);
    const rightConfiguredIndex = configuredOrder.indexOf(right.id);
    const normalizedLeftIndex = leftConfiguredIndex === -1 ? Number.MAX_SAFE_INTEGER : leftConfiguredIndex;
    const normalizedRightIndex = rightConfiguredIndex === -1 ? Number.MAX_SAFE_INTEGER : rightConfiguredIndex;
    if (normalizedLeftIndex !== normalizedRightIndex) {
      return normalizedLeftIndex - normalizedRightIndex;
    }
    const leftScore = scoreBrainForSpecialty(left, specialty);
    const rightScore = scoreBrainForSpecialty(right, specialty);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    const leftThroughput = scoreBrainForThroughputPreference(left, task, specialty);
    const rightThroughput = scoreBrainForThroughputPreference(right, task, specialty);
    if (leftThroughput !== rightThroughput) {
      return rightThroughput - leftThroughput;
    }
    const leftLoad = Number(laneLoad.get(String(left.queueLane || getBrainQueueLane(left)).trim()) || 0);
    const rightLoad = Number(laneLoad.get(String(right.queueLane || getBrainQueueLane(right)).trim()) || 0);
    if (leftLoad !== rightLoad) {
      return leftLoad - rightLoad;
    }
    const leftIsLocalWorker = left.id === "worker" ? 1 : 0;
    const rightIsLocalWorker = right.id === "worker" ? 1 : 0;
    if (specialty !== "general" && specialty !== "background" && leftIsLocalWorker !== rightIsLocalWorker) {
      return leftIsLocalWorker - rightIsLocalWorker;
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
  if (!ordered.some((brain) => brain.id === defaultWorker.id)) {
    ordered.push(defaultWorker);
  }
  const remoteTriageHealthy = remoteTriageBrain ? await getOllamaEndpointHealth(remoteTriageBrain.ollamaBaseUrl) : null;
  if (remoteTriageBrain && remoteTriageHealthy?.running && remoteTriageBrain.id !== preferredBrainId) {
    try {
      const prompt = [
        "You are Nova's routing planner.",
        "Return JSON only.",
        "Choose the best worker brain for this queued task.",
        "If multiple workers are equally suitable, prefer the one on the less busy queue lane.",
        "Use this schema exactly:",
        "{\"preferredBrainId\":\"...\",\"fallbackBrainIds\":[\"...\"],\"reason\":\"...\"}",
        `Task message: ${String(task.message || "").trim()}`,
        `Task notes: ${String(task.notes || "").trim()}`,
        `Internal job type: ${String(task.internalJobType || "").trim() || "none"}`,
        `Inferred specialty: ${specialty}`,
        prefersFastCreativeLane
          ? "Throughput preference: this is a safe creative micro-task. Prefer an idle non-local tool-capable worker lane and avoid the local default worker when an equivalent remote lane is available."
          : "",
        `Queue lane load: ${ordered.map((brain) => `${brain.id}=${Number(laneLoad.get(String(brain.queueLane || getBrainQueueLane(brain)).trim()) || 0)}`).join("; ")}`,
        `Available workers: ${ordered.map((brain) => `${brain.id} (${brain.label}; ${brain.model}; specialty=${brain.specialty || "general"}; lane=${String(brain.queueLane || getBrainQueueLane(brain)).trim() || "default"})`).join("; ")}`
      ].join("\n");
      const result = await runOllamaJsonGenerate(remoteTriageBrain.model, prompt, {
        timeoutMs: 20000,
        keepAlive: MODEL_KEEPALIVE,
        baseUrl: remoteTriageBrain.ollamaBaseUrl,
        brainId: remoteTriageBrain.id,
        leaseOwnerId: task?.id ? `task:${String(task.id).trim()}` : `route:${String(task?.sessionId || "Main").trim() || "Main"}`,
        leaseWaitMs: 2500
      });
      if (result.ok) {
        const planned = extractJsonObject(result.text);
        const preferredByRouter = ordered.find((brain) => brain.id === String(planned.preferredBrainId || "").trim());
        if (preferredByRouter) {
          const balancedPreferred = preferHigherReliabilityProjectCycleWorker(
            task,
            preferHigherThroughputCreativeWorker(
              task,
              chooseLessLoadedEquivalentWorker(preferredByRouter, ordered, specialty, laneLoad),
              ordered,
              specialty,
              laneLoad
            ),
            ordered
          );
          const fallbackByRouter = Array.isArray(planned.fallbackBrainIds)
            ? planned.fallbackBrainIds.map((id) => String(id)).filter((id) => ordered.some((brain) => brain.id === id) && id !== balancedPreferred.id).slice(0, routing.fallbackAttempts)
            : [];
          return {
            specialty,
            preferredBrainId: balancedPreferred.id,
            fallbackBrainIds: fallbackByRouter,
            strategy: "remote-triage",
            routedByBrainId: remoteTriageBrain.id,
            reason: compactTaskText(String(planned.reason || "").trim(), 180)
          };
        }
      }
    } catch {
      // fall back to heuristic routing
    }
  }
  const isSoftLocalPreference = String(preferredBrainId || "").trim() === "worker"
    && (specialty === "code" || specialty === "document" || specialty === "creative" || specialty === "vision" || specialty === "background");
  const explicitPreferredBrainId = isSoftLocalPreference ? "" : String(preferredBrainId || "").trim();
  const initiallyPreferred = explicitPreferredBrainId
    ? ordered.find((brain) => brain.id === explicitPreferredBrainId) || defaultWorker
    : ordered[0] || defaultWorker;
  const preferred = preferHigherReliabilityProjectCycleWorker(
    task,
    preferHigherThroughputCreativeWorker(
      task,
      chooseLessLoadedEquivalentWorker(initiallyPreferred, ordered, specialty, laneLoad),
      ordered,
      specialty,
      laneLoad
    ),
    ordered
  );
  const fallbacks = ordered
    .filter((brain) => brain.id !== preferred.id)
    .slice(0, routing.fallbackAttempts)
    .map((brain) => brain.id);
  return {
    specialty,
    preferredBrainId: preferred.id,
    fallbackBrainIds: fallbacks,
    strategy: "heuristic"
  };
}

function triageTaskRequest({
  message = "",
  intakeBrainId = "bitnet",
  internetEnabled = true,
  selectedMountIds = [],
  forceToolUse = false
} = {}) {
  return {
    intakeBrainId,
    brainId: "worker",
    mode: "queue",
    reason: forceToolUse ? "tool-capable worker required" : "CPU intake routes work to the worker",
    complexity: String(message || "").trim().split(/\s+/).filter(Boolean).length,
    signals: {
      internetEnabled,
      selectedMountCount: selectedMountIds.length,
      forceToolUse
    }
  };
}

async function readUserProfileSummary() {
  try {
    const raw = await readVolumeFile(PROMPT_USER_PATH);
    const lines = String(raw || "").split(/\r?\n/);
    let name = "";
    let shortName = "";
    let timezone = "";
    for (const line of lines) {
      const match = line.match(/^\s*-\s*([^:]+):\s*(.*)\s*$/);
      if (!match) {
        continue;
      }
      const key = String(match[1] || "").trim().toLowerCase();
      const value = String(match[2] || "").trim();
      if (!value) {
        continue;
      }
      if (key === "name") {
        name = value;
      } else if (key === "preferred short name") {
        shortName = value;
      } else if (key === "timezone") {
        timezone = value;
      }
    }
    return {
      name,
      shortName,
      timezone
    };
  } catch {
    return {
      name: "",
      shortName: "",
      timezone: ""
    };
  }
}

function buildHeuristicCompletionSummary({ task, workerSummary, outputFiles, ok }) {
  const files = Array.isArray(outputFiles) ? outputFiles : [];
  const topFiles = files.slice(0, 4).map((file) => file.path || file.name).filter(Boolean);
  const cleanWorkerSummary = compactTaskText(String(workerSummary || "").trim(), 240);
  if (!ok) {
    return cleanWorkerSummary || compactTaskText(`I could not complete "${String(task?.message || "").trim()}".`, 240);
  }
  if (topFiles.length) {
    return compactTaskText(`I created or updated ${topFiles.join(", ")}${files.length > topFiles.length ? ", and other output files" : ""}.`, 260);
  }
  if (cleanWorkerSummary && !looksLikeLowSignalCompletionSummary(cleanWorkerSummary, task)) {
    return cleanWorkerSummary;
  }
  if (String(task?.projectName || "").trim()) {
    return compactTaskText(`I finished the latest pass on ${String(task.projectName).trim()}, but the worker did not report a concrete outcome clearly.`, 240);
  }
  return compactTaskText("I finished the task, but the completion note was too vague to be useful.", 240);
}

async function buildCompletionReviewSummary({ task, runResponse, workerSummary, artifactSummary }) {
  const intakeBrain = await chooseIntakePlanningBrain({
    preferRemote: Boolean(task?.brain?.remote || runResponse?.brain?.remote || false)
  }) || await getBrain("bitnet");
  const fallback = buildHeuristicCompletionSummary({
    task,
    workerSummary: workerSummary || artifactSummary || runResponse?.stderr || runResponse?.error || "",
    outputFiles: runResponse?.outputFiles || [],
    ok: Boolean(runResponse?.ok)
  });
  const internalJobType = String(task?.internalJobType || "").trim().toLowerCase();
  if (["helper_scout", "escalation_review"].includes(internalJobType)) {
    const internalSummary = compactTaskText(
      workerSummary
      || artifactSummary
      || summarizePayloadText(runResponse?.parsed)
      || runResponse?.stderr
      || runResponse?.error
      || "",
      420
    );
    if (internalSummary && !looksLikeLowSignalCompletionSummary(internalSummary, task)) {
      return internalSummary;
    }
    return fallback;
  }
  if (!runResponse?.ok) {
    return fallback;
  }
  const prompt = [
    "You are the observer intake model writing a completion note for the user after another worker already finished the task.",
    `Your name is ${getAgentPersonaName()}.`,
    "You are not being asked to perform the task, judge whether it should be done, or explain your capabilities.",
    "Treat the worker summary, artifact summary, and output files as evidence of already-completed work.",
    "If the evidence is thin or unclear, summarize the visible result conservatively instead of refusing.",
    "Never say you are unable to help, cannot assist, lack capabilities, or cannot generate/review/summarize the work.",
    "Write a concise first-person explanation of what was completed.",
    "Speak in first person only. Do not refer to yourself by name or in the third person.",
    "Do not mention internal models, brains, routing, or tool calls.",
    "Prefer explaining the outcome over listing filenames.",
    "Mention the most relevant output files only if they help the user understand what changed.",
    "If follow-up is needed, say so plainly in one short sentence.",
    "Do not describe intended, proposed, or future work as if it was completed.",
    "Do not restate the original request or path as the main substance of the note.",
    "If the worker only inspected files and concluded no change was possible, say that plainly.",
    "Keep it under 90 words and return plain text only.",
    `Original request: ${String(task?.message || "").trim()}`,
    `Worker summary: ${String(workerSummary || "").trim() || "(none)"}`,
    `Artifact summary: ${String(artifactSummary || "").trim() || "(none)"}`,
    `Output files: ${Array.isArray(runResponse?.outputFiles) && runResponse.outputFiles.length ? runResponse.outputFiles.slice(0, 8).map((file) => file.path || file.name).join(", ") : "none"}`
  ].join("\n");
  const result = await runOllamaGenerate(intakeBrain.model, prompt, {
    timeoutMs: 45000,
    keepAlive: MODEL_KEEPALIVE,
    options: {
      num_gpu: 0
    },
    baseUrl: intakeBrain.ollamaBaseUrl,
    brainId: intakeBrain.id,
    leaseOwnerId: task?.id ? `task:${String(task.id).trim()}` : `completion-review:${String(task?.sessionId || "Main").trim() || "Main"}`,
    leaseWaitMs: 2500
  });
  if (!result.ok) {
    return fallback;
  }
  const review = compactTaskText(normalizeAgentSelfReference(result.text), 420);
  if (!review) {
    return fallback;
  }
  if (/\bplease provide your next instructions\b/i.test(review) || /\bsummary of the observer activity\b/i.test(review)) {
    return fallback;
  }
  if (looksLikeCapabilityRefusalCompletionSummary(review)) {
    return fallback;
  }
  if (looksLikeLowSignalCompletionSummary(review, task)) {
    return fallback;
  }
  return review;
}
  // Tool families: each entry defines which tool names belong together and the signal
  // predicate that determines whether they're needed. Order matters only for grouping.
  const TOOL_FAMILIES = [
    // Always-on core: basic file ops used by virtually every task
    {
      id: "core",
      names: ["list_files", "read_file", "read_document", "edit_file", "write_file", "move_path"],
      always: true,
      match: () => true
    },
    // Shell / code validation
    {
      id: "shell",
      names: ["shell_command"],
      always: false,
      match: (lower) => /\b(shell|command|run|script|test|build|deploy|validate|compile|npm|node|python|bash|cli|check|verify|pytest|make)\b/.test(lower)
        || /\b(code|implement|refactor|debug|bug|fix|patch|repo|repository)\b/.test(lower)
    },
    // Web fetching
    {
      id: "web",
      names: ["web_fetch"],
      always: false,
      match: (lower) => /\b(web|website|url|http|https|browse|internet|fetch|search the web|online)\b/.test(lower),
      // Philosophy loops may need web_fetch to look up references or verify claims
      matchJobType: (jobType) => jobType === "philosophy_loop"
    },
    // Email
    {
      id: "mail",
      names: ["send_mail", "move_mail"],
      always: false,
      match: (lower) => /\b(mail|email|inbox|send|forward|archive)\b/.test(lower)
    },
    // Archives
    {
      id: "archive",
      names: ["zip", "unzip"],
      always: false,
      match: (lower) => /\.(zip|tar|tgz|tar\.gz|7z)\b/.test(lower) || /\b(zip|unzip|archive|extract|unpack|compress|tarball|bundle)\b/.test(lower)
    },
    // PDF
    {
      id: "pdf",
      names: ["export_pdf", "read_pdf"],
      always: false,
      match: (lower) => /\bpdf\b/.test(lower)
    },
    // WordPress
    {
      id: "wordpress",
      names: ["list_wordpress_sites", "save_wordpress_site", "remove_wordpress_site", "wordpress_test_connection", "wordpress_upsert_post"],
      always: false,
      match: (lower) => /\b(wordpress|wp[-_]|blog post|cms|site config)\b/.test(lower)
    },
    // Skill library / tool management
    {
      id: "skills",
      names: ["search_skill_library", "inspect_skill_library", "install_skill", "request_skill_installation", "request_tool_addition", "list_installed_skills"],
      always: false,
      match: (lower) => /\b(skill library|skills library|openclaw skills|toolbelt|missing tool|missing capability|install skill|clawhub)\b/.test(lower)
    },
    // Personal notes
    {
      id: "personal_notes",
      names: ["update_daily_personal_notes"],
      always: false,
      match: (lower) => /\b(personal notes?|daily notes?|recreation|diary|reflect|update.*notes?)\b/.test(lower)
    }
  ];

  /**
   * Selects the minimal set of tools needed for a given task.
   *
   * Returns { tools, pluginTools, confident } where:
   * - tools: filtered worker tools (or full list if not confident)
   * - pluginTools: filtered plugin tools (or full plugin list if not confident)
   * - confident: true when the prediction is specific enough to omit broad swaths of unrelated tools
   *
   * Plugin tools are included when their name or description keywords appear in the
   * task text, or when internalJobType matches a known plugin job type.
   */
  function selectToolsForTask(message = "", internalJobType = "", workerTools = [], pluginTools = []) {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    const jobType = String(internalJobType || "").trim().toLowerCase();

    // Build the included tool name set from matching families
    const included = new Set();
    let optionalFamiliesMatched = 0;
    const totalOptionalFamilies = TOOL_FAMILIES.filter((f) => !f.always).length;

    for (const family of TOOL_FAMILIES) {
      if (family.always || family.match(lower) || family.matchJobType?.(jobType)) {
        for (const name of family.names) included.add(name);
        if (!family.always) optionalFamiliesMatched++;
      }
    }

    // Confidence: we're confident when only a small fraction of optional families matched.
    // If >= half the optional families are needed, the task is too broad and the full list is safer.
    const confident = optionalFamiliesMatched <= Math.max(1, Math.floor(totalOptionalFamilies / 2));

    if (!confident) {
      return { tools: workerTools, pluginTools, confident: false };
    }

    // Filter worker tools to those in the included set, preserving original order
    const filteredWorkerTools = workerTools.filter((tool) => included.has(String(tool?.name || "").trim()));

    // Plugin tools: include when the task references the tool's name or a keyword from its description,
    // or when the internalJobType matches a known plugin job pattern.
    const filteredPluginTools = pluginTools.filter((tool) => {
      const toolName = String(tool?.name || "").trim().toLowerCase();
      const desc = String(tool?.description || "").trim().toLowerCase();
      if (lower.includes(toolName)) return true;
      // Match significant words from the tool description (3+ chars, not stop words)
      const descWords = desc.split(/\W+/).filter((w) => w.length >= 4 && !/^(this|that|with|from|into|your|when|then|will|have|been|each|they|them|their|after|before|only|also|both|some|more|most|such|well|just|like|than|over|make|take|call|used|use|can|for|the|and|not|you|are|but|all|any|its)$/.test(w));
      if (descWords.some((word) => lower.includes(word))) return true;
      // Job-type hints: philosophy_loop → record_philosophy
      if (jobType === "philosophy_loop" && toolName === "record_philosophy") return true;
      return false;
    });

    return { tools: filteredWorkerTools, pluginTools: filteredPluginTools, confident: true };
  }

  return {
    buildCompletionReviewSummary,
    buildTaskCapabilityPromptLines,
    canBrainHandleSpecialty,
    chooseCreativeHandoffBrain,
    chooseLessLoadedEquivalentWorker,
    executeCreativeHandoffPass,
    inferTaskCapabilityProfile,
    inferTaskSpecialty,
    isCreativeOnlyBrain,
    isVisionOnlyBrain,
    looksLikePlaceholderTaskMessage,
    normalizeUserRequest,
    preferHigherReliabilityProjectCycleWorker,
    readUserProfileSummary,
    renderCreativeHandoffPacket,
    scoreBrainForSpecialty,
    selectSpecialistBrainRoute,
    selectToolsForTask,
    summarizeTaskCapabilities,
    triageTaskRequest
  };
}
