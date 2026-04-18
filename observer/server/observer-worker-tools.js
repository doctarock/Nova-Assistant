export function createObserverWorkerTools(options = {}) {
  const {
    PROMPT_MEMORY_PERSONAL_DAILY_ROOT = "",
    OBSERVER_CONTAINER_INPUT_ROOT = "",
    TASK_QUEUE_IN_PROGRESS = "",
    PDFDocument = null,
    StandardFonts = null,
    appendVolumeText = async () => {},
    compactTaskText = (value = "") => String(value || ""),
    editContainerTextFile = async () => ({}),
    ensureAutonomousToolApproved = async () => {},
    ensureVolumeFile = async () => {},
    formatDayKey = (value = Date.now()) => new Date(value).toISOString().slice(0, 10),
    fs = null,
    getPluginManager = () => null,
    inspectSkillLibrarySkill = async () => null,
    listFilesInContainer = async () => [],
    listInstalledSkills = async () => [],
    moveContainerPath = async () => ({}),
    normalizeToolCallRecord = (value = {}) => value,
    normalizeToolName = (value = "") => String(value || "").trim(),
    parseToolCallArgs = (value = {}) => value,
    path = null,
    pdfParse = async () => ({}),
    readContainerFileBuffer = async () => ({ contentBase64: "", size: 0 }),
    readVolumeFile = async () => "",
    recordSkillInstallationRequest = async (value = {}) => value,
    recordToolAdditionRequest = async (value = {}) => value,
    resolveToolPath = (value = "") => String(value || ""),
    rgb = () => ({}),
    runObserverToolContainerNode = async () => {},
    runSandboxShell = async () => ({ ok: false, stdout: "", stderr: "" }),
    searchSkillLibrary = async () => [],
    toolMoveMail = async () => ({}),
    toolReadDocument = async () => ({}),
    toolSendMail = async () => ({}),
    writeContainerTextFile = async () => ({}),
    writeVolumeText = async () => {}
  } = options;
function getToolPathArg(args = {}, { defaultPath = "" } = {}) {
  const source = args && typeof args === "object" ? args : {};
  const value = String(
    source.path
    || source.target
    || source.filePath
    || source.filepath
    || source.file
    || source.filename
    || defaultPath
    || ""
  ).trim();
  if (!value) {
    throw new Error("path is required");
  }
  return value;
}

async function toolListFiles(args = {}) {
  const target = resolveToolPath(getToolPathArg(args, { defaultPath: "." }));
  const recursive = Boolean(args.recursive);
  const limit = Math.max(1, Math.min(Number(args.limit || 200), 500));
  return listFilesInContainer(target, { recursive, limit });
}

async function toolReadFile(args = {}) {
  return toolReadDocument(args, { internetEnabled: false });
}

function requireNonEmptyToolContent(content, { toolName = "write_file", targetPath = "" } = {}) {
  const normalized = String(content ?? "");
  if (!normalized.trim()) {
    throw new Error(`${toolName} content must be non-empty`);
  }
  return maybeDecodeEscapedMultilineWriteContent(normalized, { targetPath });
}

function requireValidPlanningDocContent(content = "", { toolName = "write_file", targetPath = "" } = {}) {
  const normalizedPath = String(targetPath || "").trim().toLowerCase();
  const isPlanningDoc = /\/(project-todo|project-role-tasks)\.md$/i.test(normalizedPath);
  if (!isPlanningDoc) {
    return;
  }
  const text = String(content ?? "").trim();
  // Must contain at least one checkbox line
  if (!/^\s*[-*]?\s*\[[ xX]\]/m.test(text)) {
    throw new Error(
      `${toolName} refused: writing to ${normalizedPath.split("/").pop()} requires at least one checkbox line (e.g. "- [ ] task" or "- [x] done"). ` +
      `Do not write summary sentences — write the full updated file with markdown checkbox lists.`
    );
  }
}

function maybeDecodeEscapedMultilineWriteContent(content = "", { targetPath = "" } = {}) {
  const text = String(content ?? "");
  if (!text || text.includes("\n") || !/\\n/.test(text)) {
    return text;
  }
  const normalizedTargetPath = String(targetPath || "").trim().toLowerCase();
  const markdownLikeTarget = /\.(md|mdx|markdown|txt|rst)$/i.test(normalizedTargetPath)
    || /\/(project-todo|project-role-tasks|directive|readme)\.md$/i.test(normalizedTargetPath);
  const looksLikeStructuredMarkdown = /^(#|##|- \[|[-*]\s+|[0-9]+\.\s+)/.test(text.trim())
    || /\b(project todo|active tasks|follow-up tasks|completed tasks)\b/i.test(text);
  if (!markdownLikeTarget && !looksLikeStructuredMarkdown) {
    return text;
  }
  const decoded = text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
  if (decoded.split(/\r?\n/).length <= text.split(/\r?\n/).length) {
    return text;
  }
  return decoded;
}

async function toolWriteFile(args = {}) {
  const target = resolveToolPath(getToolPathArg(args));
  if (!Object.prototype.hasOwnProperty.call(args, "content")) {
    throw new Error("write_file content is required");
  }
  const content = requireNonEmptyToolContent(args.content, { toolName: "write_file", targetPath: target });
  requireValidPlanningDocContent(content, { toolName: "write_file", targetPath: target });
  const append = Boolean(args.append);
  return writeContainerTextFile(target, content, { append, timeoutMs: 30000 });
}

async function writeContainerBinaryFile(targetPath, base64Buffer) {
  const buffer = Buffer.from(base64Buffer, "base64");
  const tempHostPath = path.join(TASK_QUEUE_IN_PROGRESS, `temp-bin-${Date.now()}-${Math.floor(Math.random() * 1000)}.bin`);
  await fs.writeFile(tempHostPath, buffer);
  try {
    const encodedTarget = Buffer.from(targetPath).toString("base64");
    const script = `
      const fs = require('fs');
      const path = Buffer.from('${encodedTarget}', 'base64').toString('utf8');
      const src = '/home/openclaw/observer-input/${path.basename(tempHostPath)}';
      fs.copyFileSync(src, path);
    `;
    const inContainerTempPath = `${OBSERVER_CONTAINER_INPUT_ROOT}/${path.basename(tempHostPath)}`;
    await runObserverToolContainerNode(script, {
      extraMounts: [[tempHostPath, inContainerTempPath, "ro"]]
    });
  } finally {
    await fs.unlink(tempHostPath).catch(() => {});
  }
}

function normalizeEditToolArgs(args = {}) {
  const source = args && typeof args === "object" ? args : {};
  const edits = Array.isArray(source.edits) && source.edits.length
    ? source.edits
    : (Array.isArray(source.replacements) ? source.replacements : []);
  const normalizedEdits = edits.map((entry) => ({
    oldText: String(entry?.oldText ?? entry?.old ?? entry?.find ?? ""),
    newText: String(entry?.newText ?? entry?.new ?? entry?.replace ?? ""),
    replaceAll: entry?.replaceAll === true || entry?.replace_all === true,
    expectedReplacements: entry?.expectedReplacements == null
      ? (entry?.expected_replacements == null ? null : Number(entry.expected_replacements))
      : Number(entry.expectedReplacements)
  })).filter((entry) => entry.oldText);
  return {
    edits: normalizedEdits,
    oldText: String(source.oldText ?? source.old ?? source.find ?? ""),
    newText: String(source.newText ?? source.new ?? source.replace ?? ""),
    hasContent: Object.prototype.hasOwnProperty.call(source, "content")
      || Object.prototype.hasOwnProperty.call(source, "fullContent"),
    content: Object.prototype.hasOwnProperty.call(source, "content")
      ? String(source.content ?? "")
      : (Object.prototype.hasOwnProperty.call(source, "fullContent")
        ? String(source.fullContent ?? "")
        : ""),
    replaceAll: source.replaceAll === true || source.replace_all === true,
    expectedReplacements: source.expectedReplacements == null
      ? (source.expected_replacements == null ? null : Number(source.expected_replacements))
      : Number(source.expectedReplacements)
  };
}

async function toolEditFile(args = {}) {
  const target = resolveToolPath(getToolPathArg(args));
  const normalizedArgs = normalizeEditToolArgs(args);
  if (
    normalizedArgs.hasContent
    && !normalizedArgs.edits.length
    && !normalizedArgs.oldText
  ) {
    const content = requireNonEmptyToolContent(normalizedArgs.content, { toolName: "edit_file", targetPath: target });
    requireValidPlanningDocContent(content, { toolName: "edit_file", targetPath: target });
    return writeContainerTextFile(
      target,
      content,
      { timeoutMs: 30000 }
    );
  }
  return editContainerTextFile(target, {
    ...normalizedArgs,
    timeoutMs: 30000
  });
}

async function toolMovePath(args = {}) {
  const from = resolveToolPath(args.fromPath || args.from);
  const to = resolveToolPath(args.toPath || args.to);
  return moveContainerPath(from, to, {
    overwrite: args.overwrite === true,
    timeoutMs: 30000
  });
}

async function toolShellCommand(args = {}) {
  const command = String(args.command || "").trim();
  if (!command) {
    throw new Error("command is required");
  }
  return runSandboxShell(command, {
    timeoutMs: Math.max(1000, Math.min(Number(args.timeoutMs || 60000), 180000))
  });
}

function normalizeDailyPersonalNotesDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return formatDayKey(Date.now());
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function renderDailyPersonalNotesTemplate(dayKey = "") {
  return [
    `# Personal Notes ${dayKey}`,
    "",
    "Daily personal notes, preferences, and relationship context worth retaining.",
    ""
  ].join("\n");
}

async function toolUpdateDailyPersonalNotes(args = {}) {
  const dayKey = normalizeDailyPersonalNotesDate(args.date || args.dayKey || args.day);
  if (!dayKey) {
    throw new Error("date must be in YYYY-MM-DD format");
  }
  const mode = String(args.mode || "append").trim().toLowerCase() === "replace" ? "replace" : "append";
  const noteText = String(args.content || "").replace(/\r/g, "").trim();
  if (!noteText) {
    throw new Error("content is required");
  }

  const filePath = path.join(PROMPT_MEMORY_PERSONAL_DAILY_ROOT, `${dayKey}.md`);
  await ensureVolumeFile(filePath, renderDailyPersonalNotesTemplate(dayKey));

  if (mode === "replace") {
    await writeVolumeText(filePath, `${renderDailyPersonalNotesTemplate(dayKey).replace(/\s+$/, "")}\n\n${noteText}\n`);
  } else {
    const existing = await readVolumeFile(filePath).catch(() => "");
    const separator = existing.trim() ? "\n\n" : "";
    await appendVolumeText(filePath, `${separator}${noteText}\n`);
  }

  return {
    ok: true,
    date: dayKey,
    mode,
    filePath
  };
}

async function toolWebFetch(args = {}, { internetEnabled } = {}) {
  const result = await toolReadDocument(args, { internetEnabled });
  return {
    url: result.url || String(args.url || "").trim(),
    ok: result.ok,
    status: result.status,
    contentType: result.contentType || "",
    body: result.content || "",
    chunk: result.chunk,
    kind: result.kind,
    warnings: result.warnings || []
  };
}

function getWordPressCapabilityOrThrow(name = "") {
  const capability = getPluginManager()?.getCapability?.(name);
  if (typeof capability !== "function") {
    throw new Error(`WordPress capability unavailable: ${name}`);
  }
  return capability;
}

async function toolListWordPressSites() {
  const sites = await getWordPressCapabilityOrThrow("wordpress.listSites")();
  return {
    text: Array.isArray(sites) && sites.length
      ? `Found ${sites.length} WordPress site${sites.length === 1 ? "" : "s"}.`
      : "No WordPress sites are configured.",
    sites: Array.isArray(sites) ? sites : []
  };
}

async function toolSaveWordPressSite(args = {}) {
  const site = await getWordPressCapabilityOrThrow("wordpress.saveSite")(args);
  return {
    text: `Saved WordPress site ${site?.label || site?.siteId || "site"}.`,
    site
  };
}

async function toolRemoveWordPressSite(args = {}) {
  const site = await getWordPressCapabilityOrThrow("wordpress.removeSite")(args);
  return {
    text: `Removed WordPress site ${site?.label || site?.siteId || "site"}.`,
    site
  };
}

async function toolWordPressTestConnection(args = {}) {
  return await getWordPressCapabilityOrThrow("wordpress.testConnection")(args);
}

async function toolWordPressGetDiagnostics(args = {}) {
  return await getWordPressCapabilityOrThrow("wordpress.getDiagnostics")(args);
}

async function toolWordPressGetHealth(args = {}) {
  return await getWordPressCapabilityOrThrow("wordpress.getHealth")(args);
}

async function toolWordPressGetMonitorStatus(args = {}) {
  return await getWordPressCapabilityOrThrow("wordpress.getMonitorStatus")(args);
}

async function toolWordPressListPlugins(args = {}) {
  return await getWordPressCapabilityOrThrow("wordpress.listPlugins")(args);
}

async function toolWordPressUpdatePlugins(args = {}) {
  return await getWordPressCapabilityOrThrow("wordpress.updatePlugins")(args);
}

async function toolWordPressManagePlugin(args = {}) {
  return await getWordPressCapabilityOrThrow("wordpress.managePlugin")(args);
}

async function toolWordPressRecoverSite(args = {}) {
  return await getWordPressCapabilityOrThrow("wordpress.recoverSite")(args);
}

async function toolWordPressRunMonitor(args = {}) {
  return await getWordPressCapabilityOrThrow("wordpress.runMonitor")(args);
}

async function toolWordPressUpsertPost(args = {}) {
  return await getWordPressCapabilityOrThrow("wordpress.upsertPost")(args);
}

const WORKER_TOOLS = [
  { name: "list_files", description: "List files in a directory", parameters: { path: "string", recursive: "boolean", limit: "number" } },
  { name: "read_document", description: "Read and normalize a document from a path or url. Cleans markdown/html/json/email-like content into a consumable text view and returns it in chunks.", parameters: { path: "string", url: "string", offset: "number", maxChars: "number", contentType: "string" } },
  { name: "read_file", description: "Read and normalize a text document from a path in chunks. Prefer read_document for general document work.", parameters: { path: "string", offset: "number", maxChars: "number", contentType: "string" } },
  { name: "write_file", description: "Write or append a UTF-8 text file", parameters: { path: "string", content: "string", append: "boolean" } },
  { name: "edit_file", description: "Apply targeted text replacements to an existing UTF-8 text file, or replace the whole file when content is provided", parameters: { path: "string", oldText: "string", newText: "string", replaceAll: "boolean", expectedReplacements: "number", edits: "array", content: "string" } },
  { name: "move_path", description: "Move or rename a file or directory inside the workspace or observer-output", parameters: { fromPath: "string", toPath: "string", overwrite: "boolean" } },
  { name: "update_daily_personal_notes", description: "Append or replace Nova's host-backed daily personal notes for a specific date. Use this for recreation reflections that should persist outside the sandbox workspace.", parameters: { date: "YYYY-MM-DD", content: "string", mode: "append|replace" } },
  { name: "shell_command", description: "Run a shell command inside the observer sandbox container workspace", parameters: { command: "string", timeoutMs: "number" } },
  { name: "web_fetch", description: "Fetch a webpage or text resource in chunks. Start with the first chunk, then request more using offset and maxChars only if needed.", parameters: { url: "string", offset: "number", maxChars: "number" } },
  { name: "search_skill_library", description: "Search the OpenClaw skill library for relevant tools or skills.", parameters: { query: "string", limit: "number" } },
  { name: "inspect_skill_library", description: "Inspect a specific OpenClaw skill by slug before deciding to install it.", parameters: { slug: "string" } },
  { name: "install_skill", description: "Request installation of an OpenClaw skill. This requires explicit user approval and should not be used autonomously.", parameters: { slug: "string" } },
  { name: "request_skill_installation", description: "Record a request to install an OpenClaw skill later when autonomous approval is not allowed.", parameters: { slug: "string", reason: "string", skillName: "string", taskSummary: "string" } },
  { name: "request_tool_addition", description: "Record a request for a missing built-in tool or capability discovered during work.", parameters: { requestedTool: "string", reason: "string", skillSlug: "string", skillName: "string", taskSummary: "string" } },
  { name: "list_installed_skills", description: "List OpenClaw skills already installed in the observer sandbox workspace." },
  { name: "export_pdf", description: "Export text to a PDF file", parameters: { path: "string", text: "string" } },
  { name: "read_pdf", description: "Read text from a PDF document", parameters: { path: "string" } },
  { name: "zip", description: "Zip a file or directory", parameters: { source: "string", destination: "string" } },
  { name: "unzip", description: "Unzip a zip archive", parameters: { source: "string", destination: "string" } }
];

function normalizePermissionApprovalDecision(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (["allow", "approved", "approve", "yes", "y", "true"].includes(normalized)) {
    return "allow";
  }
  if (["deny", "denied", "reject", "rejected", "no", "n", "false"].includes(normalized)) {
    return "deny";
  }
  return normalized;
}

function getTaskPermissionApprovalDecisions(context = {}) {
  const decisions = context?.taskContext?.taskMeta?.permissionApprovals?.decisions;
  if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) {
    return {};
  }
  return decisions;
}

function getPermissionApprovalDecisionForInvocation(context = {}, approval = {}) {
  const decisions = getTaskPermissionApprovalDecisions(context);
  const key = String(approval?.key || "").trim();
  const scopeKey = String(approval?.scopeKey || "").trim();
  const lookupKeys = [key, scopeKey].filter(Boolean);
  for (const lookupKey of lookupKeys) {
    const resolved = normalizePermissionApprovalDecision(decisions[lookupKey]);
    if (resolved === "allow" || resolved === "deny") {
      return {
        value: resolved,
        key: lookupKey
      };
    }
  }
  return {
    value: "",
    key: ""
  };
}

async function executeWorkerToolCall(toolCall, context) {
  const normalized = normalizeToolCallRecord(toolCall);
  const name = normalizeToolName(normalized?.function?.name || "");
  const args = parseToolCallArgs(normalized);
  const pluginManager = getPluginManager();
  const evaluateToolPermission = pluginManager?.getCapability("evaluateToolPermission");
  if (typeof evaluateToolPermission === "function") {
    const permissionDecision = await evaluateToolPermission({
      toolName: name,
      args,
      context: context && typeof context === "object" ? context : {}
    });
    const approvalMeta = permissionDecision?.approval && typeof permissionDecision.approval === "object"
      ? { ...permissionDecision.approval }
      : null;
    const approvalDecision = approvalMeta
      ? getPermissionApprovalDecisionForInvocation(context, approvalMeta)
      : { value: "", key: "" };
    let behavior = String(permissionDecision?.behavior || "allow").trim().toLowerCase();
    let decisionReason = String(permissionDecision?.reason || "").trim();
    if (approvalDecision.value === "allow") {
      behavior = "allow";
      decisionReason = compactTaskText(
        `${decisionReason || "permission rule requested approval"}; approved by user (${approvalDecision.key || "task-scoped approval"})`,
        280
      );
    } else if (approvalDecision.value === "deny") {
      behavior = "deny";
      decisionReason = compactTaskText(
        `${decisionReason || "permission rule requested approval"}; denied by user (${approvalDecision.key || "task-scoped approval"})`,
        280
      );
    }
    if (pluginManager && typeof pluginManager.runHook === "function") {
      await pluginManager.runHook("permissions:decision", {
        at: Date.now(),
        toolName: name,
        args,
        behavior,
        decisionReason,
        permissionDecision,
        approvalDecision,
        taskId: String(context?.taskContext?.taskId || "").trim(),
        sessionId: String(context?.taskContext?.sessionId || "").trim()
      }).catch(() => {});
    }
    if (behavior === "deny") {
      throw new Error(
        compactTaskText(
          `permission denied for ${name}: ${decisionReason || "blocked by permission rule"}`,
          280
        )
      );
    }
    if (behavior === "ask") {
      const permissionApproval = {
        ...(approvalMeta || {}),
        required: true,
        key: String(approvalMeta?.key || `${permissionDecision?.ruleId || "default"}:${name}`).trim(),
        scopeKey: String(approvalMeta?.scopeKey || `${permissionDecision?.ruleId || "default"}:${name}`).trim(),
        toolName: name,
        ruleId: String(permissionDecision?.ruleId || "").trim(),
        reason: compactTaskText(decisionReason || "approval required by permission rule", 260),
        command: compactTaskText(String(args.command || "").trim(), 240),
        path: compactTaskText(String(args.path || args.file || args.filePath || "").trim(), 220),
        url: compactTaskText(String(args.url || "").trim(), 220),
        argPreview: compactTaskText(
          String(approvalMeta?.argPreview || JSON.stringify(args || {})),
          420
        )
      };
      const approvalError = new Error(
        compactTaskText(
          `permission requires user approval for ${name}: ${permissionApproval.reason || "approval required by permission rule"}`,
          280
        )
      );
      approvalError.code = "permission_requires_user_approval";
      approvalError.permissionApprovalRequired = true;
      approvalError.permissionApproval = permissionApproval;
      throw approvalError;
    }
  }
  await ensureAutonomousToolApproved(name);
  if (name === "list_files") return toolListFiles(args);
  if (name === "read_document") return toolReadDocument(args, context);
  if (name === "read_file") return toolReadFile(args);
  if (name === "write_file") return toolWriteFile(args);
  if (name === "edit_file") return toolEditFile(args);
  if (name === "move_path") return toolMovePath(args);
  if (name === "update_daily_personal_notes") return toolUpdateDailyPersonalNotes(args);
  if (name === "shell_command") return toolShellCommand(args);
  if (name === "web_fetch") return toolWebFetch(args, context);
  if (name === "search_skill_library") return searchSkillLibrary(args.query, args.limit);
  if (name === "inspect_skill_library") return inspectSkillLibrarySkill(args.slug);
  if (name === "install_skill") throw new Error("install_skill requires explicit user approval");
  if (name === "request_skill_installation") return recordSkillInstallationRequest({ ...args, requestedBy: "worker", source: "worker-tool" });
  if (name === "request_tool_addition") return recordToolAdditionRequest({ ...args, requestedBy: "worker", source: "worker-tool" });
  if (name === "list_installed_skills") return { skills: await listInstalledSkills() };
  if (name === "send_mail") return toolSendMail(args);
  if (name === "move_mail") return toolMoveMail(args);
  if (name === "list_wordpress_sites") return toolListWordPressSites();
  if (name === "save_wordpress_site") return toolSaveWordPressSite(args);
  if (name === "remove_wordpress_site") return toolRemoveWordPressSite(args);
  if (name === "wordpress_test_connection") return toolWordPressTestConnection(args);
  if (name === "wordpress_get_diagnostics") return toolWordPressGetDiagnostics(args);
  if (name === "wordpress_get_health") return toolWordPressGetHealth(args);
  if (name === "wordpress_get_monitor_status") return toolWordPressGetMonitorStatus(args);
  if (name === "wordpress_list_plugins") return toolWordPressListPlugins(args);
  if (name === "wordpress_update_plugins") return toolWordPressUpdatePlugins(args);
  if (name === "wordpress_manage_plugin") return toolWordPressManagePlugin(args);
  if (name === "wordpress_recover_site") return toolWordPressRecoverSite(args);
  if (name === "wordpress_run_monitor") return toolWordPressRunMonitor(args);
  if (name === "wordpress_upsert_post") return toolWordPressUpsertPost(args);
  if (name === "export_pdf") return toolExportPdf(args);
  if (name === "read_pdf") return toolReadPdf(args);
  if (name === "zip") return toolZip(args);
  if (name === "unzip") return toolUnzip(args);
  // Fallback: try plugin-registered intake tools (e.g. record_philosophy)
  const pm = getPluginManager();
  if (pm && typeof pm.runHook === "function") {
    const pluginResult = await pm.runHook("intake:tool-call", {
      handled: false,
      name,
      args,
      toolCall: normalized,
      normalized,
      result: null
    });
    if (pluginResult?.handled === true) {
      return pluginResult.result ?? null;
    }
  }
  throw new Error(`unknown tool: ${name}`);
}

async function toolExportPdf(args = {}) {
  const target = resolveToolPath(getToolPathArg(args));
  const text = String(args.text || "");
  
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  
  page.drawText(text, {
    x: 50,
    y: height - 50,
    size: 12,
    font: font,
    color: rgb(0, 0, 0),
    maxWidth: width - 100,
    lineHeight: 16
  });
  
  const pdfBytes = await pdfDoc.save();
  const base64Buffer = Buffer.from(pdfBytes).toString("base64");
  
  await writeContainerBinaryFile(target, base64Buffer);
  
  return { success: true, path: target };
}

async function toolReadPdf(args = {}) {
  const target = resolveToolPath(getToolPathArg(args));
  const maxReadBytes = 10 * 1024 * 1024;
  
  const bufferResult = await readContainerFileBuffer(target, { maxBytes: maxReadBytes });
  const data = await pdfParse(bufferResult);
  
  return { text: data.text, numpages: data.numpages, info: data.info };
}

async function runSandboxArchiveCommand(command = "", args = [], { timeoutMs = 60000 } = {}) {
  return runObserverToolContainerNode(`
const { spawn } = require("child_process");

async function readPayload() {
  return JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
}

async function main() {
  const payload = await readPayload();
  const command = String(payload.command || "").trim();
  const args = Array.isArray(payload.args)
    ? payload.args.map((entry) => String(entry == null ? "" : entry))
    : [];
  if (!command) {
    throw new Error("command is required");
  }
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk || ""); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk || ""); });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => resolve(Number.isFinite(exitCode) ? exitCode : 1));
  });
  process.stdout.write(JSON.stringify({ code, stdout, stderr }));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, {
    command,
    args: Array.isArray(args) ? args.map((entry) => String(entry == null ? "" : entry)) : []
  }, {
    timeoutMs
  });
}

async function toolZip(args = {}) {
  const source = resolveToolPath(args.source);
  const destination = resolveToolPath(args.destination);

  const result = await runSandboxArchiveCommand("zip", ["-r", destination, source], {
    timeoutMs: 60000
  });

  return { success: Number(result.code || 0) === 0, stdout: result.stdout, stderr: result.stderr };
}

async function toolUnzip(args = {}) {
  const source = resolveToolPath(args.source);
  const destination = resolveToolPath(args.destination);

  const result = await runSandboxArchiveCommand("unzip", [source, "-d", destination], {
    timeoutMs: 60000
  });

  return { success: Number(result.code || 0) === 0, stdout: result.stdout, stderr: result.stderr };
}
  return {
    executeWorkerToolCall,
    WORKER_TOOLS
  };
}

export function requireNonEmptyToolContent(content, { toolName = "write_file", targetPath = "" } = {}) {
  const normalized = String(content ?? "");
  if (!normalized.trim()) {
    throw new Error(`${toolName} content must be non-empty`);
  }
  const text = normalized;
  if (!text || text.includes("\n") || !/\\n/.test(text)) {
    return text;
  }
  const normalizedTargetPath = String(targetPath || "").trim().toLowerCase();
  const markdownLikeTarget = /\.(md|mdx|markdown|txt|rst)$/i.test(normalizedTargetPath)
    || /\/(project-todo|project-role-tasks|directive|readme)\.md$/i.test(normalizedTargetPath);
  const looksLikeStructuredMarkdown = /^(#|##|- \[|[-*]\s+|[0-9]+\.\s+)/.test(text.trim())
    || /\b(project todo|active tasks|follow-up tasks|completed tasks)\b/i.test(text);
  if (!markdownLikeTarget && !looksLikeStructuredMarkdown) {
    return text;
  }
  const decoded = text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  if (decoded.split(/\r?\n/).length <= text.split(/\r?\n/).length) {
    return text;
  }
  return decoded;
}
