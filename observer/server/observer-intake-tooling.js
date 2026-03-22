export const OBSERVER_INTAKE_TOOLS = [
  { name: "get_time", description: "Get the current local time." },
  { name: "get_date", description: "Get the current local date." },
  { name: "get_prompt_memory_context", description: "Read the current prompt-memory files, including USER.md, MEMORY.md, PERSONAL.md, and TODAY.md." },
  { name: "update_prompt_memory_file", description: "Update a prompt-memory file directly. Allowed files: USER.md, MEMORY.md, PERSONAL.md, TODAY.md.", parameters: { file: "string", content: "string", mode: "replace|append" } },
  { name: "get_queue_status", description: "Get a summary of queued and in-progress tasks." },
  { name: "get_recent_activity", description: "Get a summary of recent observer activity." },
  { name: "get_mail_status", description: "Get mailbox availability and last mail check status." },
  { name: "get_inbox_summary", description: "Get a summary of current non-spam inbox emails." },
  { name: "get_today_inbox_summary", description: "Get a summary of today's non-spam inbox emails." },
  { name: "send_mail", description: "Send an email to a direct address using toEmail, plus subject and text." },
  { name: "move_mail", description: "Move a recent inbox email to trash or archive using destination plus one of messageId, uid, subjectContains, fromContains, or latest." },
  { name: "get_output_status", description: "Get a summary of files in observer-output." },
  { name: "get_completion_summary", description: "Get a summary of recent completed tasks." },
  { name: "get_failure_summary", description: "Get a summary of recent failed tasks." },
  { name: "get_document_overview", description: "Get a summary of indexed workspace documents and the highest-priority items." },
  { name: "search_documents", description: "Search indexed documents semantically or lexically for a query.", parameters: { query: "string" } },
  { name: "get_daily_briefing", description: "Get the current daily briefing assembled from documents, activity, and task state." },
  { name: "get_calendar_summary", description: "Get a summary of calendar events for today, tomorrow, this week, or upcoming events.", parameters: { scope: "today|tomorrow|week|upcoming", limit: "number" } },
  { name: "find_calendar_events", description: "Find calendar events by id, partial title, date (YYYY-MM-DD), or status.", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD", status: "active|completed|cancelled" } },
  { name: "create_calendar_event", description: "Create a calendar event, optionally repeating and optionally configured as a Nova action.", parameters: { title: "string", startAt: "ISO datetime", endAt: "ISO datetime", allDay: "boolean", location: "string", description: "string", type: "personal|nova_action", repeatFrequency: "none|daily|weekly|monthly|yearly", repeatInterval: "number", actionEnabled: "boolean", actionMessage: "string", requestedBrainId: "string" } },
  { name: "update_calendar_event", description: "Update an existing calendar event by eventId or by matching titleContains plus optional date.", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD", title: "string", startAt: "ISO datetime", endAt: "ISO datetime", allDay: "boolean", location: "string", description: "string", type: "personal|nova_action", repeatFrequency: "none|daily|weekly|monthly|yearly", repeatInterval: "number", actionEnabled: "boolean", actionMessage: "string", requestedBrainId: "string" } },
  { name: "remove_calendar_event", description: "Remove a calendar event by eventId or by matching titleContains plus optional date.", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD" } },
  { name: "set_calendar_event_state", description: "Mark a calendar event active, completed, or cancelled by eventId or matching titleContains plus optional date.", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD", status: "active|completed|cancelled" } },
  { name: "search_skill_library", description: "Search the OpenClaw skill library for relevant tools or skills.", parameters: { query: "string", limit: "number" } },
  { name: "inspect_skill_library", description: "Inspect a specific OpenClaw skill by slug before deciding to install it.", parameters: { slug: "string" } },
  { name: "install_skill", description: "Request installation of an OpenClaw skill. This requires explicit user approval and should not be used autonomously.", parameters: { slug: "string" } },
  { name: "request_skill_installation", description: "Record a request to install an OpenClaw skill later when autonomous approval is not allowed.", parameters: { slug: "string", reason: "string", skillName: "string", taskSummary: "string" } },
  { name: "request_tool_addition", description: "Record a request for a missing built-in tool or capability discovered during work.", parameters: { requestedTool: "string", reason: "string", skillSlug: "string", skillName: "string", taskSummary: "string" } },
  { name: "list_installed_skills", description: "List OpenClaw skills already installed in the observer sandbox workspace." }
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
      defaultApproved: true
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
      defaultApproved: entry.defaultApproved !== false
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function createObserverIntakeToolExecutor(context = {}) {
  const {
    buildCalendarSummary,
    buildCalendarToolEventPatch,
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
    ensureAutonomousToolApproved,
    findCalendarEventsByReference,
    formatDateForUser,
    formatDateTimeForUser,
    formatTimeForUser,
    inspectSkillLibrarySkill,
    listInstalledSkills,
    normalizeCalendarToolEventInput,
    normalizeToolCallRecord,
    normalizeToolName,
    parseToolCallArgs,
    readPromptMemoryContext,
    recordSkillInstallationRequest,
    recordToolAdditionRequest,
    removeCalendarEvent,
    saveCalendarEvent,
    searchSkillLibrary,
    summarizeCalendarEvent,
    toolMoveMail,
    toolSendMail,
    writePromptMemoryFile
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
    if (name === "get_calendar_summary") {
      const args = parseToolCallArgs(normalized);
      const lines = await buildCalendarSummary({
        scope: String(args.scope || "upcoming").trim().toLowerCase(),
        limit: Number(args.limit || 10) || 10
      });
      return { text: lines.join("\n") };
    }
    if (name === "find_calendar_events") {
      const args = parseToolCallArgs(normalized);
      const matches = await findCalendarEventsByReference({
        eventId: String(args.eventId || "").trim(),
        titleContains: String(args.titleContains || "").trim(),
        date: String(args.date || "").trim(),
        status: String(args.status || "").trim()
      });
      return {
        text: matches.length
          ? matches.map((entry) => `- ${entry.id}: ${summarizeCalendarEvent(entry)}`).join("\n")
          : "No matching calendar events found.",
        events: matches
      };
    }
    if (name === "create_calendar_event") {
      const args = parseToolCallArgs(normalized);
      const nextEvent = normalizeCalendarToolEventInput(args);
      if (!nextEvent.title || !nextEvent.startAt) {
        throw new Error("create_calendar_event requires title and startAt");
      }
      const saved = await saveCalendarEvent(nextEvent);
      return {
        text: `Created calendar event ${saved.id}: ${summarizeCalendarEvent(saved)}.`,
        event: saved
      };
    }
    if (name === "update_calendar_event") {
      const args = parseToolCallArgs(normalized);
      const matches = await findCalendarEventsByReference({
        eventId: String(args.eventId || "").trim(),
        titleContains: String(args.titleContains || "").trim(),
        date: String(args.date || "").trim()
      });
      if (!matches.length) {
        throw new Error("No matching calendar event found");
      }
      if (matches.length > 1) {
        throw new Error(`Multiple calendar events matched: ${matches.map((entry) => entry.id).join(", ")}`);
      }
      const saved = await saveCalendarEvent({
        ...matches[0],
        ...buildCalendarToolEventPatch(args)
      });
      return {
        text: `Updated calendar event ${saved.id}: ${summarizeCalendarEvent(saved)}.`,
        event: saved
      };
    }
    if (name === "remove_calendar_event") {
      const args = parseToolCallArgs(normalized);
      const matches = await findCalendarEventsByReference({
        eventId: String(args.eventId || "").trim(),
        titleContains: String(args.titleContains || "").trim(),
        date: String(args.date || "").trim()
      });
      if (!matches.length) {
        throw new Error("No matching calendar event found");
      }
      if (matches.length > 1) {
        throw new Error(`Multiple calendar events matched: ${matches.map((entry) => entry.id).join(", ")}`);
      }
      await removeCalendarEvent(matches[0].id);
      return {
        text: `Removed calendar event ${matches[0].id}: ${summarizeCalendarEvent(matches[0])}.`,
        removedEventId: matches[0].id
      };
    }
    if (name === "set_calendar_event_state") {
      const args = parseToolCallArgs(normalized);
      const status = String(args.status || "").trim().toLowerCase();
      if (!["active", "completed", "cancelled"].includes(status)) {
        throw new Error("status must be active, completed, or cancelled");
      }
      const matches = await findCalendarEventsByReference({
        eventId: String(args.eventId || "").trim(),
        titleContains: String(args.titleContains || "").trim(),
        date: String(args.date || "").trim()
      });
      if (!matches.length) {
        throw new Error("No matching calendar event found");
      }
      if (matches.length > 1) {
        throw new Error(`Multiple calendar events matched: ${matches.map((entry) => entry.id).join(", ")}`);
      }
      const now = Date.now();
      const saved = await saveCalendarEvent({
        ...matches[0],
        status,
        completedAt: status === "completed" ? now : 0,
        cancelledAt: status === "cancelled" ? now : 0
      });
      return {
        text: `Marked calendar event ${saved.id} as ${status}.`,
        event: saved
      };
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
    throw new Error(`unknown intake tool: ${name}`);
  }

  return {
    executeIntakeToolCall
  };
}
