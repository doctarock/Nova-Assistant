export const OBSERVER_INTAKE_TOOLS = [
  { name: "get_time", description: "Get the current local time." },
  { name: "get_date", description: "Get the current local date." },
  { name: "get_prompt_memory_context", description: "Read the current prompt-memory files, including USER.md, MEMORY.md, PERSONAL.md, and TODAY.md." },
  { name: "update_prompt_memory_file", description: "Update a prompt-memory file directly. Allowed files: USER.md, MEMORY.md, PERSONAL.md, TODAY.md.", parameters: { file: "string", content: "string", mode: "replace|append" } },
  { name: "get_queue_status", description: "Get a summary of queued and in-progress tasks." },
  { name: "get_recent_activity", description: "Get a summary of recent observer activity." },
  { name: "get_output_status", description: "Get a summary of files in observer-output." },
  { name: "get_completion_summary", description: "Get a summary of recent completed tasks." },
  { name: "get_failure_summary", description: "Get a summary of recent failed tasks." },
  { name: "get_document_overview", description: "Get a summary of indexed workspace documents and the highest-priority items." },
  { name: "search_documents", description: "Search indexed documents semantically or lexically for a query.", parameters: { query: "string" } },
  { name: "get_daily_briefing", description: "Get the current daily briefing assembled from documents, activity, and task state." },
  { name: "search_skill_library", description: "Search the OpenClaw skill library for relevant tools or skills.", parameters: { query: "string", limit: "number" } },
  { name: "inspect_skill_library", description: "Inspect a specific OpenClaw skill by slug before deciding to install it.", parameters: { slug: "string" } },
  { name: "install_skill", description: "Request installation of an OpenClaw skill. This requires explicit user approval and should not be used autonomously.", parameters: { slug: "string" } },
  { name: "request_skill_installation", description: "Record a request to install an OpenClaw skill later when autonomous approval is not allowed.", parameters: { slug: "string", reason: "string", skillName: "string", taskSummary: "string" } },
  { name: "request_tool_addition", description: "Record a request for a missing built-in tool or capability discovered during work.", parameters: { requestedTool: "string", reason: "string", skillSlug: "string", skillName: "string", taskSummary: "string" } },
  { name: "list_installed_skills", description: "List OpenClaw skills already installed in the observer sandbox workspace." },
  { name: "get_scheduled_jobs", description: "Get a summary of scheduled jobs, recurring tasks, and recent cron run events." },
  { name: "get_system_status", description: "Get the current system health status: which plugins are loaded and enabled." },
  { name: "get_host_system_status", description: "Get host machine system stats: CPU load, memory usage, uptime, platform. Use for questions about RAM, system health, or machine load." },
  { name: "get_gpu_status", description: "Get GPU utilization, VRAM usage, and temperature from the host machine. Use for questions about the GPU, VRAM, or video card." },
  { name: "get_running_processes", description: "List the top running processes on the host machine by CPU and memory. Use for questions about what's running, process list, or active applications.", parameters: { filter: "string", limit: "number" } },
  { name: "get_weather", description: "Get the current weather forecast. Use for questions about the weather, temperature, rain, or forecast. Requires OPEN_WEATHER_API_KEY to be configured.", parameters: { date: "today|tomorrow|week" } }
];

export function buildObserverToolCatalog({ workerTools = [], intakeTools = OBSERVER_INTAKE_TOOLS } = {}) {
  const catalog = new Map();
  const addTool = (tool, scope) => {
    const name = String(tool?.name || "").trim();
    if (!name) {
      return;
    }
    const existing = catalog.get(name) || {
      name,
      description: String(tool?.description || "").trim(),
      scopes: new Set(),
      parameters: tool?.parameters || {},
      risk: "normal",
      defaultApproved: true,
      source: String(tool?.source || "core").trim() === "plugin" ? "plugin" : "core",
      pluginId: String(tool?.pluginId || "").trim(),
      pluginName: String(tool?.pluginName || "").trim()
    };
    existing.scopes.add(scope);
    if (!existing.description && tool?.description) {
      existing.description = String(tool.description).trim();
    }
    if (tool?.parameters && Object.keys(tool.parameters).length) {
      existing.parameters = tool.parameters;
    }
    if (["shell_command", "write_file", "edit_file", "move_path", "send_mail", "move_mail", "save_wordpress_site", "remove_wordpress_site", "wordpress_test_connection", "wordpress_upsert_post"].includes(name)) {
      existing.risk = "high";
    } else if (["web_fetch", "read_document", "read_file", "search_skill_library", "inspect_skill_library", "search_documents", "request_skill_installation", "request_tool_addition"].includes(name)) {
      existing.risk = "medium";
    }
    if (name === "install_skill") {
      existing.risk = "approval";
      existing.defaultApproved = false;
    }
    if (existing.source !== "plugin" && String(tool?.source || "").trim() === "plugin") {
      existing.source = "plugin";
      existing.pluginId = String(tool?.pluginId || "").trim();
      existing.pluginName = String(tool?.pluginName || "").trim();
    }
    catalog.set(name, existing);
  };
  for (const tool of workerTools) {
    addTool(tool, "worker");
  }
  for (const tool of intakeTools) {
    addTool(tool, "intake");
  }
  return [...catalog.values()]
    .map((entry) => ({
      name: entry.name,
      description: entry.description,
      scopes: [...entry.scopes].sort(),
      parameters: entry.parameters || {},
      risk: entry.risk,
      defaultApproved: entry.defaultApproved !== false,
      source: entry.source,
      pluginId: entry.pluginId || "",
      pluginName: entry.pluginName || ""
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function createObserverIntakeToolExecutor(context = {}) {
  const {
    buildCompletionSummary,
    buildDailyBriefingSummary,
    buildDocumentOverviewSummary,
    buildDocumentSearchSummary,
    buildFailureSummary,
    buildInboxSummary,
    buildMailStatusSummary,
    buildOutputStatusSummary,
    buildQueueStatusSummary,
    buildRecentActivitySummary,
    buildScheduledJobsSummary,
    buildSystemStatusSummary,
    ensureAutonomousToolApproved,
    executePluginIntakeToolCall,
    formatDateForUser,
    formatDateTimeForUser,
    formatTimeForUser,
    inspectSkillLibrarySkill,
    listInstalledSkills,
    normalizeToolCallRecord,
    normalizeToolName,
    parseToolCallArgs,
    readPromptMemoryContext,
    recordSkillInstallationRequest,
    recordToolAdditionRequest,
    searchSkillLibrary,
    toolMoveMail,
    toolSendMail,
    writePromptMemoryFile,
    buildHostSystemStatusSummary,
    buildGpuStatusSummary,
    buildRunningProcessesSummary,
    buildWeatherSummary
  } = context;

  async function executeIntakeToolCall(toolCall) {
    const normalized = normalizeToolCallRecord(toolCall);
    const name = normalizeToolName(normalized?.function?.name || "");
    await ensureAutonomousToolApproved(name);
    if (name === "get_prompt_memory_context") {
      const entries = await readPromptMemoryContext();
      return {
        text: entries.map((entry) => [
          `${entry.fileName} (${entry.filePath})`,
          entry.content || "(empty)"
        ].join("\n")).join("\n\n"),
        entries
      };
    }
    if (name === "update_prompt_memory_file") {
      const args = parseToolCallArgs(normalized);
      const result = await writePromptMemoryFile(args);
      return {
        text: `Updated ${result.fileName} using ${result.mode} mode.`,
        ...result
      };
    }
    if (name === "get_time") {
      return {
        text: `It is currently ${formatTimeForUser()}. Local date and time: ${formatDateTimeForUser(Date.now())}.`
      };
    }
    if (name === "get_date") {
      return {
        text: `Today is ${formatDateForUser()}. Local date and time: ${formatDateTimeForUser(Date.now())}.`
      };
    }
    if (name === "get_queue_status") {
      return { text: (await buildQueueStatusSummary()).join("\n") };
    }
    if (name === "get_recent_activity") {
      return { text: (await buildRecentActivitySummary()).join("\n") };
    }
    if (name === "get_mail_status") {
      return { text: (await buildMailStatusSummary()).join("\n") };
    }
    if (name === "get_inbox_summary") {
      return { text: (await buildInboxSummary({ todayOnly: false })).join("\n") };
    }
    if (name === "get_today_inbox_summary") {
      return { text: (await buildInboxSummary({ todayOnly: true })).join("\n") };
    }
    if (name === "send_mail") {
      return await toolSendMail(parseToolCallArgs(normalized));
    }
    if (name === "move_mail") {
      return await toolMoveMail(parseToolCallArgs(normalized));
    }
    if (name === "get_output_status") {
      return { text: (await buildOutputStatusSummary()).join("\n") };
    }
    if (name === "get_completion_summary") {
      return { text: (await buildCompletionSummary()).join("\n") };
    }
    if (name === "get_failure_summary") {
      return { text: (await buildFailureSummary()).join("\n") };
    }
    if (name === "get_document_overview") {
      return { text: (await buildDocumentOverviewSummary()).join("\n") };
    }
    if (name === "search_documents") {
      const args = parseToolCallArgs(normalized);
      return { text: (await buildDocumentSearchSummary(String(args.query || "").trim())).join("\n") };
    }
    if (name === "get_daily_briefing") {
      return { text: (await buildDailyBriefingSummary()).join("\n") };
    }
    if (name === "get_scheduled_jobs") {
      if (typeof buildScheduledJobsSummary === "function") {
        return { text: (await buildScheduledJobsSummary()).join("\n") };
      }
    }
    if (name === "get_system_status") {
      if (typeof buildSystemStatusSummary === "function") {
        return { text: (await buildSystemStatusSummary()).join("\n") };
      }
    }
    if (name === "search_skill_library") {
      const args = parseToolCallArgs(normalized);
      const result = await searchSkillLibrary(args.query, args.limit);
      const lines = [`Found ${result.results.length} skill match${result.results.length === 1 ? "" : "es"} for "${result.query}".`];
      for (const entry of result.results) {
        lines.push(`- ${entry.slug}: ${entry.summary}`);
      }
      return { text: lines.join("\n"), ...result };
    }
    if (name === "inspect_skill_library") {
      const args = parseToolCallArgs(normalized);
      const result = await inspectSkillLibrarySkill(args.slug);
      return {
        text: [
          `${result.slug}${result.version ? ` v${result.version}` : ""}`,
          result.summary || result.description || "No summary provided.",
          result.installed ? "Installed already." : "Not installed yet."
        ].join("\n"),
        ...result
      };
    }
    if (name === "install_skill") {
      throw new Error("install_skill requires explicit user approval");
    }
    if (name === "request_skill_installation") {
      const args = parseToolCallArgs(normalized);
      const request = await recordSkillInstallationRequest({ ...args, requestedBy: "intake", source: "intake-tool" });
      return {
        text: `Recorded a skill-install request for ${request.slug}.`,
        request
      };
    }
    if (name === "request_tool_addition") {
      const args = parseToolCallArgs(normalized);
      const request = await recordToolAdditionRequest({ ...args, requestedBy: "intake", source: "intake-tool" });
      return {
        text: `Recorded a tool request for ${request.requestedTool}.`,
        request
      };
    }
    if (name === "list_installed_skills") {
      const skills = await listInstalledSkills();
      return {
        text: skills.length
          ? `Installed skills:\n${skills.map((skill) => `- ${skill.slug}: ${skill.description || skill.name}`).join("\n")}`
          : "No extra OpenClaw skills are installed yet.",
        skills
      };
    }
    if (name === "get_host_system_status") {
      if (typeof buildHostSystemStatusSummary === "function") {
        return { text: (await buildHostSystemStatusSummary()).join("\n") };
      }
    }
    if (name === "get_gpu_status") {
      if (typeof buildGpuStatusSummary === "function") {
        return { text: (await buildGpuStatusSummary()).join("\n") };
      }
    }
    if (name === "get_running_processes") {
      if (typeof buildRunningProcessesSummary === "function") {
        const args = parseToolCallArgs(normalized);
        return { text: (await buildRunningProcessesSummary({ filter: args.filter, limit: args.limit })).join("\n") };
      }
    }
    if (name === "get_weather") {
      if (typeof buildWeatherSummary === "function") {
        const args = parseToolCallArgs(normalized);
        return { text: (await buildWeatherSummary({ date: args.date || "today" })).join("\n") };
      }
    }
    if (typeof executePluginIntakeToolCall === "function") {
      const pluginResult = await executePluginIntakeToolCall({
        name,
        args: parseToolCallArgs(normalized),
        toolCall,
        normalized
      });
      if (pluginResult !== undefined && pluginResult !== null) {
        return pluginResult;
      }
    }
    throw new Error(`unknown intake tool: ${name}`);
  }

  return {
    executeIntakeToolCall
  };
}
