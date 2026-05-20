export function createObserverNativeResponseHelpers(context = {}) {
  const {
    PROMPT_USER_PATH,
    addTodoItem,
    answerWaitingTask,
    buildCalendarSummary,
    buildChunkedTextPayload,
    buildCompletionSummary,
    buildDailyBriefingSummary,
    buildDocumentOverviewSummary,
    buildDocumentSearchSummary,
    buildFailureSummary,
    buildFinanceSummary,
    buildInboxSummary,
    buildMailStatusSummary,
    buildOutputStatusSummary,
    buildProjectStatusSummary,
    buildQueueStatusSummary,
    buildRecentActivitySummary,
    buildScheduledJobsSummary,
    buildSystemStatusSummary,
    buildToolConfigPayload,
    buildTodoSummaryLines,
    ensureUniqueOutputPath,
    extractDocumentSearchQuery,
    extractFileReferenceCandidates,
    extractQuotedSegments,
    findTodoItemByReference,
    formatDateForUser,
    formatDateTimeForUser,
    formatTimeForUser,
    fs,
    getActiveMailAgent,
    getCalendarSummaryScopeFromMessage,
    installSkillIntoWorkspace,
    inspectSkillLibrarySkill,
    isActivitySummaryRequest,
    isCalendarSummaryRequest,
    isCompletionSummaryRequest,
    isDailyBriefingRequest,
    isDateRequest,
    isDirectReadFileRequest,
    isDocumentOverviewRequest,
    isDocumentSearchRequest,
    isFailureSummaryRequest,
    isFinanceSummaryRequest,
    isHelpRequest,
    isInboxSummaryRequest,
    isMailStatusRequest,
    isOutputStatusRequest,
    isPathWithinAllowedRoots,
    isProjectStatusRequest,
    isQueueStatusRequest,
    isScheduledJobsRequest,
    isSystemStatusRequest,
    isTimeRequest,
    isTodayInboxSummaryRequest,
    isUserIdentityRequest,
    listInstalledSkills,
    listAllTasks,
    listObserverOutputFiles,
    listTodoItems,
    normalizeContainerMountPathCandidate,
    normalizeDocumentContent,
    normalizeTodoReference,
    normalizeWindowsPathCandidate,
    normalizeWorkspaceRelativePathCandidate,
    outputNameCandidateFromSource,
    parseDirectMailRequest,
    parseStandingMailWatchRequest,
    path,
    readUserProfileSummary,
    removeTodoItem,
    resolveSourcePathFromContainerPath,
    sanitizeSkillSlug,
    searchSkillLibrary,
    setTodoItemStatus,
    toolSendMail,
    upsertMailWatchRule
  } = context;

  function humanizeToolName(name = "") {
    return String(name || "")
      .trim()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function buildToolExample(tool = {}) {
    const name = String(tool?.name || "").trim();
    if (!name) return "";
    const examples = {
      get_queue_status: "queue status",
      get_recent_activity: "recent activity",
      get_completion_summary: "completion summary",
      get_failure_summary: "failure summary",
      get_daily_briefing: "daily briefing",
      get_system_status: "system status",
      get_scheduled_jobs: "scheduled jobs",
      get_project_status: "project status",
      get_project_pipeline: "show project pipeline for <project>",
      search_documents: "search documents for <topic>",
      get_document_overview: "document overview",
      search_skill_library: "search skill library for <capability>",
      list_installed_skills: "list installed skills",
      sprint_create: "create a sprint called <name>",
      sprint_status: "show sprint status for <name>",
      sprint_advance: "advance sprint <name>",
      sprint_list: "list active sprints",
      sprint_ship_checklist: "ship checklist for sprint <name>",
      sprint_complete: "complete sprint <name>",
      get_time: "what time is it?",
      get_date: "what date is it?",
      get_gpu_status: "GPU status",
      get_host_system_status: "host system status",
      get_running_processes: "what is running?",
      get_weather: "weather today"
    };
    if (examples[name]) return examples[name];
    return humanizeToolName(name);
  }

  async function buildHelpResponseLines() {
    const fallbackLines = [
      "Here is what I can help you with:",
      "- Status: queue status, recent activity, completion summary, failure summary, daily briefing, system status.",
      "- Work: queue implementation tasks, inspect files, edit code, validate changes, and report outcomes.",
      "- Projects: project status, active workspace projects, project pipeline traces.",
      "- Sprints: create a sprint, list sprints, show sprint status, advance a sprint, get a ship checklist, complete a sprint.",
      "- Documents: document overview, search documents, read or summarize files.",
      "- Skills: search skill library, list installed skills, request missing capabilities.",
      "- Memory: read or update USER.md, MEMORY.md, TODAY.md, and PERSONAL.md.",
      "- System: scheduled jobs, GPU status, host status, running processes, weather."
    ];
    if (typeof buildToolConfigPayload !== "function") {
      return fallbackLines;
    }
    try {
      const payload = await buildToolConfigPayload();
      const tools = Array.isArray(payload?.tools) ? payload.tools : [];
      if (!tools.length) {
        return fallbackLines;
      }
      const approved = tools.filter((tool) => tool?.approved !== false);
      const intakeTools = approved.filter((tool) => Array.isArray(tool?.scopes) && tool.scopes.includes("intake"));
      const workerTools = approved.filter((tool) => Array.isArray(tool?.scopes) && tool.scopes.includes("worker"));
      const pluginTools = approved.filter((tool) => String(tool?.source || "").trim() === "plugin");
      const sprintTools = approved.filter((tool) => String(tool?.pluginId || "").trim() === "sprint" || String(tool?.name || "").startsWith("sprint_"));
      const projectTools = approved.filter((tool) => String(tool?.pluginId || "").trim() === "projects" || String(tool?.name || "").startsWith("get_project_"));
      const visibleExamples = [
        ...new Set([
          ...intakeTools
            .filter((tool) => /^(get_queue_status|get_recent_activity|get_completion_summary|get_failure_summary|get_daily_briefing|get_system_status|get_scheduled_jobs|get_document_overview|search_documents|get_gpu_status|get_host_system_status|get_running_processes|get_weather)$/.test(String(tool.name || "")))
            .map(buildToolExample),
          ...projectTools.map(buildToolExample),
          ...sprintTools.map(buildToolExample)
        ].filter(Boolean))
      ].slice(0, 18);
      const pluginNames = [...new Set(pluginTools.map((tool) => String(tool.pluginName || tool.pluginId || "").trim()).filter(Boolean))].slice(0, 10);
      return [
        "Here is what I can help you with:",
        "- Ask for status: queue status, recent activity, completion summary, failure summary, daily briefing, system status.",
        "- Give me work: I can queue tasks, inspect files, edit code, validate changes, and report what changed.",
        visibleExamples.length ? `- Try commands like: ${visibleExamples.join("; ")}.` : "",
        pluginNames.length ? `- Plugin command groups currently available: ${pluginNames.join(", ")}.` : "",
        `- Tool catalog: ${approved.length} approved tool${approved.length === 1 ? "" : "s"} available (${intakeTools.length} intake, ${workerTools.length} worker).`,
        "- You can also ask: \"what tools are available?\", \"show project status\", \"create a sprint called ...\", or \"search documents for ...\"."
      ].filter(Boolean);
    } catch {
      return fallbackLines;
    }
  }

  async function tryHandleCopyToOutputRequest(message = "") {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    if (!/\b(copy|duplicate|export|archive|package|bundle)\b/.test(lower)) {
      return null;
    }
    if (!/\b(output folder|observer-output|output directory|output)\b/.test(lower)) {
      return null;
    }

    const pathCandidates = new Set();
    for (const segment of extractQuotedSegments(text)) {
      const windowsPath = normalizeWindowsPathCandidate(segment);
      const containerPath = normalizeContainerMountPathCandidate(segment);
      if (windowsPath) pathCandidates.add(windowsPath);
      if (containerPath) pathCandidates.add(containerPath);
    }

    for (const token of text.split(/\s+/)) {
      const trimmed = token.replace(/[.,;:!?]+$/g, "");
      const windowsPath = normalizeWindowsPathCandidate(trimmed);
      const containerPath = normalizeContainerMountPathCandidate(trimmed);
      if (windowsPath) pathCandidates.add(windowsPath);
      if (containerPath) pathCandidates.add(containerPath);
    }

    for (const candidate of pathCandidates) {
      const sourcePath = candidate.startsWith("/")
        ? resolveSourcePathFromContainerPath(candidate)
        : path.resolve(candidate);
      if (!sourcePath) {
        continue;
      }
      try {
        const stats = await fs.stat(sourcePath);
        const outputTarget = await ensureUniqueOutputPath(outputNameCandidateFromSource(sourcePath));
        if (stats.isDirectory()) {
          await fs.cp(sourcePath, outputTarget.path, { recursive: true, force: true });
        } else if (stats.isFile()) {
          await fs.copyFile(sourcePath, outputTarget.path);
        } else {
          continue;
        }
        const files = await listObserverOutputFiles();
        return {
          type: "copy_to_output",
          title: "Output copy completed",
          text: `I copied ${path.basename(sourcePath)} into observer-output/${outputTarget.name}.`,
          detail: `Source: ${sourcePath}\nDestination: ${outputTarget.path}`,
          outputFiles: files
        };
      } catch {
        // try next candidate
      }
    }

    return null;
  }

  async function tryHandleReadFileRequest(message = "") {
    const text = String(message || "").trim();
    if (!isDirectReadFileRequest(text)) {
      return null;
    }

    const candidates = extractFileReferenceCandidates(text);
    for (const candidate of candidates) {
      const sourcePath = normalizeWindowsPathCandidate(candidate)
        || resolveSourcePathFromContainerPath(normalizeContainerMountPathCandidate(candidate))
        || normalizeWorkspaceRelativePathCandidate(candidate);
      if (!sourcePath || !isPathWithinAllowedRoots(sourcePath)) {
        continue;
      }
      try {
        const stats = await fs.stat(sourcePath);
        if (!stats.isFile()) {
          continue;
        }
        const raw = await fs.readFile(sourcePath);
        const normalized = await normalizeDocumentContent({
          buffer: raw,
          sourceLabel: sourcePath,
          sourceName: path.basename(sourcePath),
          contentType: ""
        });
        const chunked = buildChunkedTextPayload(normalized.text || "", {});
        const truncated = chunked.chunk.hasMore;
        const display = truncated ? `${chunked.content}\n\n[chunked]` : chunked.content;
        return {
          type: "read_file",
          title: "Document contents",
          text: `Contents of ${sourcePath}:\n\n${display}`,
          detail: [
            `Read ${sourcePath} as ${normalized.kind || "text"}${normalized.contentType ? ` (${normalized.contentType})` : ""}.`,
            truncated
              ? `Showing chunk ${chunked.chunk.chunkIndex} of ${chunked.chunk.totalChunks} (${chunked.chunk.returnedChars} of ${chunked.chunk.totalChars} characters). Next chunk starts at offset ${chunked.chunk.nextOffset}.`
              : "",
            Array.isArray(normalized.warnings) && normalized.warnings.length
              ? `Notes: ${normalized.warnings.join("; ")}`
              : ""
          ].filter(Boolean).join(" "),
          outputFiles: []
        };
      } catch {
        // try next candidate
      }
    }

    return null;
  }

  async function tryHandleDirectMailRequest(message = "") {
    const parsed = parseDirectMailRequest(message);
    if (!parsed) {
      return null;
    }
    let messageText = String(parsed.text || "").trim();
    let subjectText = String(parsed.subject || "").trim();
    if (!messageText && parsed.wantsTestEmail) {
      messageText = "This is a test email from Nova.";
      if (!subjectText) {
        subjectText = "Test email from Nova";
      }
    }
    if (!messageText && parsed.wantsReport) {
      const [recentActivity, completions, queueStatus] = await Promise.all([
        buildRecentActivitySummary(),
        buildCompletionSummary(),
        buildQueueStatusSummary()
      ]);
      messageText = [
        "Report from Nova",
        "",
        ...recentActivity.slice(0, 4),
        "",
        ...completions.slice(0, 4),
        "",
        ...queueStatus.slice(0, 3)
      ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    if (!messageText) {
      return {
        type: "send_mail_missing_text",
        title: "Mail draft needs text",
        text: "I can send that email, but I still need the message text.",
        detail: "Provide the text or body you want me to send.",
        outputFiles: []
      };
    }
    const result = await toolSendMail({
      ...parsed,
      subject: subjectText,
      text: messageText
    });
    const destination = result.to || parsed.toEmail || "the destination mailbox";
    return {
      type: "send_mail",
      title: "Email sent",
      text: `I sent the email to ${destination}.`,
      detail: `Subject: ${result.subject || subjectText || `Message from ${getActiveMailAgent()?.label || "Nova"}`}\nMessage ID: ${result.messageId || "unknown"}`,
      outputFiles: []
    };
  }

  async function tryHandleStandingMailWatchRequest(message = "") {
    const parsed = parseStandingMailWatchRequest(message);
    if (!parsed) {
      return null;
    }
    const rule = await upsertMailWatchRule(parsed);
    return {
      type: "mail_watch_rule",
      title: "Mail watch enabled",
      text: "I'll keep an eye on copied emails, forward the clearly good ones, trash the definite junk, and ask you about the unsure ones.",
      detail: "Standing instruction saved. I'll apply it the next time mail is grabbed and keep using it on future grabs.",
      outputFiles: []
    };
  }

  function looksLikeMailWatchWaitingAnswer(message = "") {
    const lower = String(message || "").trim().toLowerCase();
    if (!lower) {
      return false;
    }
    return /\b(add|create|make|save|remember)\b[\s\S]*\b(email|mail)\s+rule\b/.test(lower)
      || (/\b(always|from now on|going forward|future|every time)\b/.test(lower) && /\b(trash|archive|forward|keep)\b/.test(lower))
      || (/\b(trash|delete|junk|bin|remove|archive|forward|keep|leave|ignore|do nothing)\b/.test(lower) && /\b(it|this|that|email|message)\b/.test(lower));
  }

  async function tryHandleMailWatchWaitingAnswer(message = "") {
    const text = String(message || "").trim();
    if (!looksLikeMailWatchWaitingAnswer(text)) {
      return null;
    }
    const tasks = typeof listAllTasks === "function" ? await listAllTasks() : { waiting: [] };
    const waitingTasks = Array.isArray(tasks?.waiting) ? tasks.waiting : [];
    const candidates = waitingTasks
      .filter((task) => String(task?.internalJobType || "").trim() === "mail_watch_question")
      .sort((left, right) => Number(right?.updatedAt || right?.createdAt || 0) - Number(left?.updatedAt || left?.createdAt || 0));
    if (!candidates.length) {
      if (/\b(email|mail)\s+rule\b/i.test(text)) {
        return {
          type: "mail_watch_rule_missing_context",
          title: "No email waiting",
          text: "I can add that while vetting an unsure email, but I do not have a pending email decision right now.",
          detail: "Wait for the next unsure email prompt or use a standing mail-watch instruction."
        };
      }
      return null;
    }
    if (candidates.length > 1) {
      return {
        type: "mail_watch_rule_ambiguous",
        title: "Multiple emails waiting",
        text: "I have more than one unsure email waiting, so I need you to answer the one in the Questions panel first.",
        detail: `${candidates.length} mail-watch questions are currently waiting for direction.`
      };
    }
    const resolved = await answerWaitingTask(candidates[0].id, text, "Main");
    const createdMailRules = Array.isArray(resolved?.createdMailRules) ? resolved.createdMailRules : [];
    const handledAction = String(resolved?.handledAction || "").trim();
    const actionText = handledAction === "trash"
      ? "trashed"
      : handledAction === "archive"
        ? "archived"
        : handledAction === "forward"
          ? "forwarded"
          : "kept";
    return {
      type: createdMailRules.length ? "mail_watch_rule_added" : "mail_watch_answered",
      title: createdMailRules.length ? "Email rule added" : "Email handled",
      text: createdMailRules.length
        ? `I ${actionText} the waiting email and saved ${createdMailRules.length === 1 ? "an email rule" : `${createdMailRules.length} email rules`} for future matching mail.`
        : `I ${actionText} the waiting email.`,
      detail: [
        resolved?.handledMessageCount ? `Affected messages: ${resolved.handledMessageCount}` : "",
        handledAction ? `Action: ${handledAction}` : "",
        createdMailRules.length
          ? createdMailRules.map((rule) => `- ${rule.id}: ${String(rule.instruction || "").trim()}`).join("\n")
          : ""
      ].filter(Boolean).join("\n")
    };
  }

  async function tryHandleSkillLibraryRequest(message = "") {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    const mentionsSkills = /\b(skill library|skills library|tool library|tools library|openclaw skills|clawhub|skill|skills)\b/.test(lower)
      || /\b(useful tools in the library|tools in the library|tools from the library)\b/.test(lower);
    if (!mentionsSkills) {
      return null;
    }
    if (/\blist installed skills\b|\bwhat skills do you have\b|\bshow installed skills\b/.test(lower)) {
      const skills = await listInstalledSkills();
      return {
        type: "installed_skills",
        title: "Installed skills",
        text: skills.length
          ? `I currently have ${skills.length} installed OpenClaw skill${skills.length === 1 ? "" : "s"}.`
          : "I don't have any extra OpenClaw skills installed yet.",
        detail: skills.length
          ? skills.map((skill) => `- ${skill.slug}: ${skill.description || skill.name}${skill.approved ? " [approved]" : " [installed only]"}`).join("\n")
          : "No extra OpenClaw skills are installed yet."
      };
    }
    const installMatch = text.match(/\binstall(?: the)?(?: openclaw)? skill\s+([a-z0-9._-]+)/i);
    if (installMatch) {
      const slug = sanitizeSkillSlug(installMatch[1]);
      const result = await installSkillIntoWorkspace(slug, { approvedByUser: true });
      return {
        type: "skill_install",
        title: "Skill installed",
        text: `I installed ${result.slug}.`,
        detail: `It is now available at ${result.containerPath} and marked approved. I can read skills/${result.slug}/SKILL.md and follow it when relevant.`
      };
    }
    const inspectMatch = text.match(/\b(?:inspect|show|describe)\s+(?:the\s+)?(?:openclaw\s+)?skill\s+([a-z0-9._-]+)/i);
    if (inspectMatch) {
      const result = await inspectSkillLibrarySkill(inspectMatch[1]);
      return {
        type: "skill_inspect",
        title: "Skill details",
        text: `${result.slug}${result.version ? ` v${result.version}` : ""}`,
        detail: [
          result.summary || result.description || "No summary available.",
          result.owner ? `Owner: ${result.owner}` : "",
          result.installed ? "Already installed." : "Not installed yet."
        ].filter(Boolean).join("\n")
      };
    }
    const searchMatch = text.match(/\b(?:search|find|look for)\b[\s\S]*?\b(?:skill library|skills library|openclaw skills|clawhub|skills)\b(?:[\s\S]*?\bfor\b)?\s+(.+)$/i)
      || text.match(/\b(?:search|find|look for)\b[\s\S]*?\b(?:tool library|tools library|tools in the library|useful tools in the library)\b(?:[\s\S]*?\bfor\b)?\s+(.+)$/i)
      || text.match(/\b(?:find|search)\s+skills?\s+(?:for\s+)?(.+)$/i);
    if (searchMatch) {
      const query = String(searchMatch[1] || "").trim().replace(/[?.!]+$/, "");
      if (!query) {
        return null;
      }
      const result = await searchSkillLibrary(query, 6);
      return {
        type: "skill_search",
        title: "Skill search",
        text: result.results.length
          ? `I found ${result.results.length} matching OpenClaw skill${result.results.length === 1 ? "" : "s"} for "${result.query}".`
          : `I couldn't find any OpenClaw skills for "${result.query}".`,
        detail: result.results.length
          ? result.results.map((entry) => `- ${entry.slug}: ${entry.summary}`).join("\n")
          : "No matches returned."
      };
    }
    return null;
  }

  function extractTodoAddRequest(message = "") {
    const text = String(message || "").trim();
    const patterns = [
      /^(?:can you\s+|could you\s+|please\s+)?(?:add|put|create|make|append|save|stick|throw|jot down|write down|note down)\s+(.+?)\s+(?:to\s+|in\s+|on\s+|into\s+)?(?:(?:my|the)\s+)?(?:to[\s-]?do|todo|backlog|checklist|task list)\s*(?:list|items?)?[.!?]*$/i,
      /^(?:can you\s+|could you\s+|please\s+)?(?:add|put|create|make|append|save|stick|throw|jot down|write down|note down)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:to[\s-]?do|todo|backlog|checklist|task list)\s*(?:list\s*)?(?:item|task|entry)?\s*(?:[:\-]\s*|\bcalled\s+|\bnamed\s+|\bfor\s+)(.+)$/i,
      /^(?:to[\s-]?do|todo)\s*[:\-]\s*(.+)$/i,
      /^(?:remind me to|don'?t forget to|note to self:?)\s+(.+)$/i,
      /^(?:can you\s+|could you\s+|please\s+)?(?:add|note|remember)\s+(.+?)\s+as an? (?:action item|task|to[\s-]?do)[.!?]*$/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return normalizeTodoReference(match[1]);
      }
    }
    return "";
  }

  function isIncompleteTodoAddRequest(message = "") {
    const lower = String(message || "").trim().toLowerCase();
    if (!lower || !/\b(add|put|create|make|append|save|jot down|write down|note down)\b/.test(lower)) {
      return false;
    }
    return /\b(?:new\s+)?(?:to[\s-]?do|todo|backlog|checklist|task list)\s*(?:list\s*)?(?:item|task|entry)?\b/.test(lower)
      && !extractTodoAddRequest(message);
  }

  function extractTodoCompleteRequest(message = "") {
    const text = String(message || "").trim();
    const patterns = [
      /^(?:can you\s+|could you\s+|please\s+)?(?:mark|check off|complete|finish|tick off|close)\s+(.+?)\s+(?:on\s+|in\s+)?(?:(?:my|the)\s+)?(?:to[\s-]?do|todo)\s*(?:list)?[.!?]*$/i,
      /^(?:can you\s+|could you\s+|please\s+)?(?:mark|set)\s+(.+?)\s+as\s+(?:done|complete|finished|completed)[.!?]*$/i,
      /^(?:done(?: with)?|finished(?: with)?|completed?)\s+(.+)[.!?]*$/i,
      /^(?:i(?:'?ve)?\s+)?(?:done|finished|completed)\s+(.+)[.!?]*$/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return normalizeTodoReference(match[1]);
      }
    }
    return "";
  }

  function extractTodoRemoveRequest(message = "") {
    const text = String(message || "").trim();
    const patterns = [
      /^(?:can you\s+|could you\s+|please\s+)?(?:remove|delete|clear|drop|cancel|scrap|scratch|discard)\s+(.+?)\s+(?:from\s+|off\s+)?(?:(?:my|the)\s+)?(?:to[\s-]?do|todo)\s*(?:list)?[.!?]*$/i,
      /^(?:can you\s+|could you\s+|please\s+)?(?:remove|delete|clear|drop|cancel)\s+(?:the\s+)?(?:to[\s-]?do|todo)\s+(.+?)[.!?]*$/i,
      /^(?:take|strike)\s+(.+?)\s+off\s+(?:(?:my|the)\s+)?(?:to[\s-]?do|todo)\s*(?:list)?[.!?]*$/i,
      /^(?:never mind|forget it|ignore)\s+(?:about\s+)?(.+?)\s+(?:on\s+)?(?:(?:my|the)\s+)?(?:to[\s-]?do|todo)\s*(?:list)?[.!?]*$/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return normalizeTodoReference(match[1]);
      }
    }
    return "";
  }

  function isTodoSummaryRequest(message = "") {
    const lower = String(message || "").toLowerCase().trim();
    return /\b(to[\s-]?do list|todo list|todos|to dos|personal backlog|checklist|action items?|task list|my tasks)\b/.test(lower)
      && /\b(show|list|what'?s on|what is on|what are|my|open|current|pending|remaining|read|give me|tell me)\b/.test(lower);
  }

  async function tryHandleTodoRequest(message = "") {
    const text = String(message || "").trim();
    if (!text) {
      return null;
    }

    const completeRef = extractTodoCompleteRequest(text);
    if (completeRef) {
      const matched = await findTodoItemByReference(completeRef);
      if (!matched) {
        return {
          type: "todo_complete_missing",
          title: "To do not found",
          text: `I couldn't find a to do item matching "${completeRef}".`,
          detail: "Try the exact item text or use the queue panel to manage the list."
        };
      }
      const result = await setTodoItemStatus(matched.id, "completed", {
        completedBy: "user",
        sessionId: "Main"
      });
      return {
        type: "todo_complete",
        title: "To do completed",
        text: `Marked complete: ${result.todo.text}.`,
        detail: result.resumedTask
          ? `I resumed ${result.resumedTask.codename || result.resumedTask.id} after you completed that action.`
          : "The item has been checked off."
      };
    }

    const removeRef = extractTodoRemoveRequest(text);
    if (removeRef) {
      const matched = await findTodoItemByReference(removeRef);
      if (!matched) {
        return {
          type: "todo_remove_missing",
          title: "To do not found",
          text: `I couldn't find a to do item matching "${removeRef}".`,
          detail: "Try the exact item text or use the queue panel to manage the list."
        };
      }
      const result = await removeTodoItem(matched.id, {
        removedBy: "user",
        sessionId: "Main"
      });
      return {
        type: "todo_remove",
        title: "To do removed",
        text: `Removed from your to do list: ${result.todo.text}.`,
        detail: result.closedTask
          ? `I also closed the linked waiting task ${result.closedTask.codename || result.closedTask.id}.`
          : "The item has been removed."
      };
    }

    const addText = extractTodoAddRequest(text);
    if (addText) {
      const item = await addTodoItem({
        text: addText,
        createdBy: "user",
        source: "native"
      });
      const summary = await listTodoItems();
      return {
        type: "todo_add",
        title: "To do added",
        text: `Added to your to do list: ${item.text}.`,
        detail: `${summary.open.length} open item${summary.open.length === 1 ? "" : "s"} in the backlog.`
      };
    }

    if (isIncompleteTodoAddRequest(text)) {
      return {
        type: "todo_add_missing_text",
        title: "To do needs text",
        text: "What should I add to your to do list?",
        detail: "I heard the add-to-do request, but not the actual item text."
      };
    }

    if (isTodoSummaryRequest(text)) {
      const lines = await buildTodoSummaryLines();
      return {
        type: "todo_summary",
        title: "To do list",
        text: lines[0],
        detail: lines.join("\n")
      };
    }

    return null;
  }

  function getLastAgentText(recentExchanges = []) {
    const exchanges = Array.isArray(recentExchanges) ? recentExchanges : [];
    for (let index = exchanges.length - 1; index >= 0; index -= 1) {
      const exchange = exchanges[index];
      if (String(exchange?.role || "").trim() === "agent") {
        return String(exchange.text || "").trim();
      }
    }
    return "";
  }

  function cleanConversationalFragment(message = "") {
    return String(message || "")
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .replace(/[.?!]+$/g, "")
      .trim();
  }

  function isShortConversationalFragment(message = "") {
    const text = cleanConversationalFragment(message);
    if (!text || text.length > 80 || /[?]/.test(text)) {
      return false;
    }
    return text.split(/\s+/).filter(Boolean).length <= 8;
  }

  async function tryHandleConversationalRequest(message = "", options = {}) {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    const lastAgentText = getLastAgentText(options?.recentExchanges).toLowerCase();

    if (/^knock[\s-]?knock[.!?]*$/i.test(text)) {
      return {
        type: "conversation",
        title: "Conversation",
        text: "Who's there?",
        detail: "Knock-knock joke opener."
      };
    }

    if (/\bwho'?s there\??$/i.test(lastAgentText) && isShortConversationalFragment(text)) {
      const fragment = cleanConversationalFragment(text);
      return {
        type: "conversation",
        title: "Conversation",
        text: `${fragment} who?`,
        detail: "Knock-knock joke setup."
      };
    }

    if (/\bwho\??$/i.test(lastAgentText) && isShortConversationalFragment(text)) {
      return {
        type: "conversation",
        title: "Conversation",
        text: "Ha. Alright, you got me.",
        detail: "Knock-knock joke punchline."
      };
    }

    if (/^(hi|hello|hey|hiya|yo|good morning|good afternoon|good evening)[.!?]*$/i.test(text)) {
      return {
        type: "conversation",
        title: "Conversation",
        text: "Hey. I'm here.",
        detail: "Greeting handled directly."
      };
    }

    if (/^(thanks|thank you|cheers|ta|appreciate it)[.!?]*$/i.test(text)) {
      return {
        type: "conversation",
        title: "Conversation",
        text: "You're welcome.",
        detail: "Acknowledgement handled directly."
      };
    }

    if (/^(?:tell me a joke|say something funny|make me laugh)[.!?]*$/i.test(text)) {
      return {
        type: "conversation",
        title: "Conversation",
        text: "Knock knock.",
        detail: "Light joke request handled directly."
      };
    }

    if (/^(?:how are you|how are you doing|how'?s it going|how are things)[.!?]*$/i.test(lower)) {
      return {
        type: "conversation",
        title: "Conversation",
        text: "I'm doing okay. A little more conversational now, which feels like progress.",
        detail: "Casual wellbeing question handled directly."
      };
    }

    return null;
  }

  async function tryBuildObserverNativeResponse(message = "", options = {}) {
    const text = String(message || "").trim();
    if (!text) {
      return null;
    }

    const conversationalResponse = await tryHandleConversationalRequest(text, options);
    if (conversationalResponse) {
      return conversationalResponse;
    }
    if (options?.conversationOnly === true) {
      return null;
    }

    if (typeof isHelpRequest === "function" && isHelpRequest(text)) {
      const lines = await buildHelpResponseLines();
      return {
        type: "help",
        title: "What I can do",
        text: lines.join("\n"),
        detail: lines.join("\n")
      };
    }

    const copyResponse = await tryHandleCopyToOutputRequest(text);
    if (copyResponse) {
      return copyResponse;
    }

    const skillResponse = await tryHandleSkillLibraryRequest(text);
    if (skillResponse) {
      return skillResponse;
    }

    const todoResponse = await tryHandleTodoRequest(text);
    if (todoResponse) {
      return todoResponse;
    }

    const mailWatchWaitingResponse = await tryHandleMailWatchWaitingAnswer(text);
    if (mailWatchWaitingResponse) {
      return mailWatchWaitingResponse;
    }

    const standingMailWatchResponse = await tryHandleStandingMailWatchRequest(text);
    if (standingMailWatchResponse) {
      return standingMailWatchResponse;
    }

    const directMailResponse = await tryHandleDirectMailRequest(text);
    if (directMailResponse) {
      return directMailResponse;
    }

    const readFileResponse = await tryHandleReadFileRequest(text);
    if (readFileResponse) {
      return readFileResponse;
    }

    if (isTimeRequest(text)) {
      return {
        type: "time",
        title: "Current time",
        text: `It is currently ${formatTimeForUser()}.`,
        detail: `Local date and time: ${formatDateTimeForUser(Date.now())}`
      };
    }

    if (isDateRequest(text)) {
      return {
        type: "date",
        title: "Current date",
        text: `Today is ${formatDateForUser()}.`,
        detail: `Local date and time: ${formatDateTimeForUser(Date.now())}`
      };
    }

    if (isUserIdentityRequest(text)) {
      const profile = await readUserProfileSummary();
      const knownName = String(profile.name || profile.shortName || "").trim();
      const timezone = String(profile.timezone || "").trim();
      return {
        type: "user_identity",
        title: "User profile",
        text: knownName
          ? `My user is ${knownName}.`
          : "My user profile file exists, but the name is not filled in yet.",
        detail: [
          knownName ? `Name: ${knownName}` : "Name: not filled in",
          profile.shortName && profile.shortName !== knownName ? `Preferred short name: ${profile.shortName}` : "",
          timezone ? `Timezone: ${timezone}` : "Timezone: not filled in",
          `Profile file: ${PROMPT_USER_PATH}`
        ].filter(Boolean).join("\n")
      };
    }

    if (isQueueStatusRequest(text)) {
      const lines = await buildQueueStatusSummary();
      return {
        type: "queue_status",
        title: "Queue status",
        text: lines[0],
        detail: lines.join("\n")
      };
    }

    if (isActivitySummaryRequest(text)) {
      const lines = await buildRecentActivitySummary();
      return {
        type: "activity_summary",
        title: "Recent activity",
        text: lines[0] || "I don't have any recent activity to report yet.",
        detail: lines.join("\n")
      };
    }

    if (isMailStatusRequest(text)) {
      const lines = await buildMailStatusSummary();
      return {
        type: "mail_status",
        title: "Mailbox status",
        text: lines[0],
        detail: lines.join("\n")
      };
    }

    if (isInboxSummaryRequest(text)) {
      const lines = await buildInboxSummary({ todayOnly: isTodayInboxSummaryRequest(text) });
      return {
        type: "inbox_summary",
        title: isTodayInboxSummaryRequest(text) ? "Today's emails" : "Inbox summary",
        text: lines[0] || "I do not have any inbox emails to report right now.",
        detail: lines.join("\n")
      };
    }

    if (isOutputStatusRequest(text)) {
      const lines = await buildOutputStatusSummary();
      return {
        type: "output_status",
        title: "Generated files",
        text: lines[0],
        detail: lines.join("\n"),
        outputFiles: await listObserverOutputFiles()
      };
    }

    if (isCompletionSummaryRequest(text)) {
      const lines = await buildCompletionSummary();
      return {
        type: "completion_summary",
        title: "Recent completions",
        text: lines[0],
        detail: lines.join("\n")
      };
    }

    if (isFailureSummaryRequest(text)) {
      const lines = await buildFailureSummary();
      return {
        type: "failure_summary",
        title: "Recent failures",
        text: lines[0],
        detail: lines.join("\n")
      };
    }

    if (isDocumentOverviewRequest(text)) {
      const lines = await buildDocumentOverviewSummary();
      return {
        type: "document_overview",
        title: "Document overview",
        text: lines[0],
        detail: lines.join("\n")
      };
    }

    if (isDocumentSearchRequest(text)) {
      const query = extractDocumentSearchQuery(text);
      const lines = await buildDocumentSearchSummary(query);
      return {
        type: "document_search",
        title: "Document search",
        text: lines[0] || `I couldn't find any indexed documents matching "${query}".`,
        detail: lines.join("\n")
      };
    }

    if (isDailyBriefingRequest(text)) {
      const lines = await buildDailyBriefingSummary();
      return {
        type: "daily_briefing",
        title: "Daily briefing",
        text: lines[0],
        detail: lines.join("\n")
      };
    }

    if (isCalendarSummaryRequest(text)) {
      const scope = getCalendarSummaryScopeFromMessage(text);
      const lines = await buildCalendarSummary({ scope, limit: 12 });
      return {
        type: "calendar_summary",
        title: "Calendar",
        text: lines[0],
        detail: lines.join("\n")
      };
    }

    if (typeof isFinanceSummaryRequest === "function" && isFinanceSummaryRequest(text)) {
      if (typeof buildFinanceSummary === "function") {
        const lines = await buildFinanceSummary();
        return {
          type: "finance_summary",
          title: "Finance summary",
          text: lines[0] || "No finance data available.",
          detail: lines.join("\n")
        };
      }
    }

    if (typeof isProjectStatusRequest === "function" && isProjectStatusRequest(text)) {
      if (typeof buildProjectStatusSummary === "function") {
        const lines = await buildProjectStatusSummary({ message: text });
        return {
          type: "project_status",
          title: "Project status",
          text: lines[0] || "No active projects found.",
          detail: lines.join("\n")
        };
      }
    }

    if (typeof isScheduledJobsRequest === "function" && isScheduledJobsRequest(text)) {
      if (typeof buildScheduledJobsSummary === "function") {
        const lines = await buildScheduledJobsSummary();
        return {
          type: "scheduled_jobs",
          title: "Scheduled jobs",
          text: lines[0] || "No scheduled jobs found.",
          detail: lines.join("\n")
        };
      }
    }

    if (typeof isSystemStatusRequest === "function" && isSystemStatusRequest(text)) {
      if (typeof buildSystemStatusSummary === "function") {
        const lines = await buildSystemStatusSummary();
        return {
          type: "system_status",
          title: "System status",
          text: lines[0] || "System status unavailable.",
          detail: lines.join("\n")
        };
      }
    }

    return null;
  }

  return {
    extractTodoAddRequest,
    extractTodoCompleteRequest,
    extractTodoRemoveRequest,
    isTodoSummaryRequest,
    tryBuildObserverNativeResponse,
    tryHandleCopyToOutputRequest,
    tryHandleDirectMailRequest,
    tryHandleReadFileRequest,
    tryHandleConversationalRequest,
    tryHandleSkillLibraryRequest,
    tryHandleStandingMailWatchRequest,
    tryHandleTodoRequest
  };
}
