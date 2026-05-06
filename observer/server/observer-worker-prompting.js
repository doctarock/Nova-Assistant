export function createObserverWorkerPrompting(context = {}) {
  const {
    INTAKE_TOOLS,
    OBSERVER_CONTAINER_OUTPUT_ROOT,
    OBSERVER_CONTAINER_WORKSPACE_ROOT,
    WORKER_TOOLS,
    buildInstalledSkillsGuidanceNote,
    buildPromptMemoryGuidanceNote,
    buildTaskCapabilityPromptLines,
    extractConcreteTaskFileTargets,
    extractTaskDirectiveValue,
    fs,
    getAgentPersonaName,
    getObserverConfig,
    appendHookTrace = async () => null,
    getPluginToolsByScope = () => [],
    getProjectNoChangeMinimumTargets,
    selectToolsForTask = null,
    runPluginHook = async (_, payload) => payload,
    inferTaskCapabilityProfile,
    inferTaskSpecialty,
    isProjectCycleMessage,
    loopLessonsHostPath,
    normalizeContainerPathForComparison,
    normalizeToolCallRecord,
    normalizeToolName,
    parseToolCallArgs
  } = context;

  async function readLoopLessonsNote() {
    if (!fs || !loopLessonsHostPath) return "";
    try {
      const content = await fs.readFile(loopLessonsHostPath, "utf8");
      const trimmed = String(content || "").trim();
      if (!trimmed) return "";
      // Extract individual lesson blocks (each starts with ## )
      const blocks = [];
      let current = [];
      for (const line of trimmed.split("\n")) {
        if (line.startsWith("## ") && current.length) {
          blocks.push(current.join("\n").trim());
          current = [line];
        } else {
          current.push(line);
        }
      }
      if (current.length) blocks.push(current.join("\n").trim());
      // Emit last 6 lessons, skip the header block
      const lessons = blocks.filter((b) => b.startsWith("## ")).slice(-6);
      if (!lessons.length) return "";
      return `Past loop repair lessons — avoid repeating these patterns:\n${lessons.join("\n")}`;
    } catch {
      return "";
    }
  }

  function extractToolPathArg(toolCall) {
    const args = parseToolCallArgs(toolCall) || {};
    return normalizeContainerPathForComparison(
      String(
        args.path
        || args.target
        || args.filePath
        || args.filepath
        || args.file
        || args.filename
        || ""
      ).trim()
    );
  }

  function objectiveAllowsPlanningDocumentOutcome(objective = "") {
    const text = String(objective || "").trim().toLowerCase();
    if (!text) {
      return false;
    }
    return (
      /\breview the project structure\b/.test(text)
      || /\bidentify the best runnable or shippable next step\b/.test(text)
      || /\bidentify the best next step\b/.test(text)
      || /\bclarify the most shippable next step\b/.test(text)
      || /\brecord the next concrete step\b/.test(text)
      || /\bupdate this todo file after each work pass\b/.test(text)
      || (/\bcheck(?:ing)? off completed items\b/.test(text) && /\bfollow-up tasks\b/.test(text))
      || /\bkeep project-todo\.md and project-role-tasks\.md aligned\b/.test(text)
      || /\brequired for export\b/.test(text)
      || /\bexport blocker\b/.test(text)
      || /\bcompletion evidence\b/.test(text)
    );
  }

  function buildWorkerSpecialtyPromptLines({ brain, message = "", forceToolUse = false, preset = "autonomous", taskSpecialty = "" } = {}) {
    const text = String(message || "");
    const lower = text.toLowerCase();
    const looksScienceResearch = /\b(research|scientific|science|literature review|evidence synthesis|peer[- ]reviewed|citations?|references|study|studies|journal|paper|papers|methodology|hypothesis|dataset|analysis|biology|biological|biochem(?:istry)?|chemistry|chemical|metabolic|pathway|pathways|genetic|genomics|proteomics|clinical|bioinformatics)\b/.test(lower);
    const looksSensitiveBioChemDesign = /\b(metabolic pathways?|pathway design|biological pathway|bioengineering|synthetic biology|gene editing|pathogen|toxin|viral|virus|culture conditions?|lab protocol|wet lab)\b/.test(lower);
    const minConcreteTargets = getProjectNoChangeMinimumTargets();
    const specialty = String(taskSpecialty || brain?.specialty || "").trim().toLowerCase();
    const kind = String(brain?.kind || "").trim().toLowerCase();
    const isCodeWorker = kind === "worker" && specialty === "code";
    const isProjectCycle = text.includes("/PROJECT-TODO.md");
    const mentionsSkillsOrToolbelt = /\b(skill library|skills library|openclaw skills|clawhub|toolbelt|missing tool|missing capability|request tool|request skills?)\b/i.test(text);
    const objectiveText = extractTaskDirectiveValue(text, "Objective:");
    const planningObjective = objectiveAllowsPlanningDocumentOutcome(objectiveText);
    const inspectFirstTarget = extractTaskDirectiveValue(text, "Inspect first:");
    const expectedFirstMove = extractTaskDirectiveValue(text, "Expected first move:");
    const looksCodeHeavy = forceToolUse || /\b(project|repo|repository|code|implement|implementation|refactor|debug|bug|fix|patch|todo|fixme|script|test|tests|api|backend|frontend)\b/.test(lower);
    const isQueuedExecution = String(preset || "").trim() === "queued-task";
    const capabilityProfile = inferTaskCapabilityProfile({
      message: text,
      taskSpecialty: specialty,
      forceToolUse,
      preset
    });

    if (String(preset || "").trim() === "internal-recreation") {
      return [
        "You have unstructured free time. Use tools to do something genuinely interesting — browse the web, write a thought, sketch a project idea, or create a short piece of writing.",
        "Before you return final=true, you must have written something to a file. Writing to your personal memory file counts.",
        "Do not describe what you plan to do in final_text. Describe what you actually did.",
        "Natural, first-person language is fine in final_text. There are no grammar restrictions for recreational writing.",
        "Never wrap your JSON response in markdown fences.",
        "Do not output headings, bullet lists, or analysis before the JSON object.",
        "Keep assistant_message short and factual, ideally one sentence under 20 words.",
        "For file-based tools such as read_document, list_files, write_file, and edit_file, always include the explicit full file or directory path in the path field.",
        "If you call write_file, include the full intended content. Do not call write_file with empty content.",
        "Do not claim to have browsed or read something you have not actually fetched with a tool.",
        ...buildTaskCapabilityPromptLines(capabilityProfile)
      ];
    }

    const lines = [
      "Your final_text must explain what you actually checked, changed, or concluded.",
      "Do not claim completion from intent alone.",
      "Before you return final=true, silently verify that at least one of these is true: you changed workspace files, you produced a concrete artifact, or you are using the exact phrase 'no change is possible' and naming the inspected targets.",
      "If that completion gate is not satisfied yet, do not finish. Return another non-final tool envelope and keep working.",
      "If the needed capability is missing from the available tools, do not stop with a refusal. Treat that as capability recovery: search the skill library, inspect the best match, then use request_skill_installation or request_tool_addition.",
      "If a relevant skill exists but install_skill would require user approval, record the request explicitly instead of waiting silently for someone else to notice.",
      "Do not use future tense such as 'I will', 'I'll', 'next step', 'should', or 'plan to' in final_text.",
      "Never wrap your JSON response in markdown fences.",
      "Do not output headings, bullet lists, or analysis before the JSON object.",
      "Keep assistant_message short and factual, ideally one sentence under 20 words.",
      "Prefer read_document for document review, summaries, webpages, email files, and attachments.",
      "For large files, long web pages, or long documents, read them in chunks. Start with the first chunk and only request later chunks when necessary.",
      "After reading a chunk, keep a running summary in your own reasoning and avoid rereading earlier chunks unless necessary.",
      "For file-based tools such as read_document, list_files, write_file, and edit_file, always include the explicit full file or directory path in the path field. Do not omit the path and do not rely on prior context.",
      "If you call write_file, include the full intended content. Do not call write_file with empty content.",
      "Do not answer with only filenames or a bare artifact list.",
      "If you created files, mention what they are for in one concise sentence.",
      "If the current toolbelt seems insufficient, do not keep orbiting the task. Search the skill library once, inspect the most relevant skill, and use request_skill_installation or request_tool_addition instead of repeating broad inspection."
    ];
    lines.push(...buildTaskCapabilityPromptLines(capabilityProfile));

    if (isProjectCycle) {
      lines.push("For project-cycle work: read PROJECT-TODO.md once, then move on to concrete inspection such as list_files, package manifests, source files, role-task boards, or TODO/FIXME locations. Do not keep rereading the same planning files unless they changed.");
      lines.push("For project-cycle work: also maintain PROJECT-ROLE-TASKS.md as a running role-based task board by adding, checking off, or refining concrete role tasks.");
      lines.push("For project-cycle work: use only standard markdown checkbox format in PROJECT-TODO.md and PROJECT-ROLE-TASKS.md. Unchecked items must be written as '- [ ] task text' and completed items as '- [x] task text'. There are exactly two states: pending '- [ ]' and done '- [x]'. Keep items as '- [ ]' while work is in progress — the task queue already tracks what is currently running, so the TODO file only needs to record whether the work is finished. Do not use [y], [n], bare [x] without a bullet, or any other intermediate marker.");
      lines.push("For project-cycle work: if the available project input is mainly a zip or other archive and the real working files are not extracted yet, using unzip to unpack it inside the workspace is a valid concrete first move.");
      if (inspectFirstTarget || expectedFirstMove) {
        lines.push("For project-cycle work: your first response should normally be a non-final JSON tool envelope that obeys the named first move, then reads the required planning files once, then advances to additional concrete inspection or edits.");
      } else {
        lines.push("For project-cycle work: your first response should normally be a non-final JSON tool envelope that reads PROJECT-TODO.md and starts inspecting additional concrete project files or directories when they are available.");
      }
      lines.push("For project-cycle work: once the required planning files and the named starting target have been read successfully, do not repeat that startup bundle. Continue to the next concrete target or edit step.");
      if (inspectFirstTarget || expectedFirstMove) {
        lines.push(`For project-cycle work: obey the named starting target in the task brief. ${expectedFirstMove || `Inspect ${inspectFirstTarget} before broader exploration.`}`);
      }
      lines.push("For project-cycle work: unless the current objective or active role explicitly calls for it, defer late-pass sweeps such as accessibility, SEO, marketing, or compliance until the project is properly scoped and core implementation work has moved forward.");
      if (/\/directive\.md$/i.test(inspectFirstTarget)) {
        lines.push("For project-cycle work: when the named target is directive.md, treat that directive file as a concrete project file. Editing it to complete the stated directive counts as valid concrete progress.");
      }
      lines.push("For project-cycle work: never write container-internal paths such as '/home/openclaw/...' or '/home/openclaw/.observer-sandbox/...' into any document content, markdown file, or project artifact. These paths are implementation details of the execution environment and have no place in project documents.");
      if (specialty === "creative") {
        lines.push("For creative project-cycle work: the project files are narrative documents. Do not write CSS properties, hex color codes, WCAG compliance notes, accessibility audit findings, or any web-development content into story files, world-building documents, character sheets, or manuscript chapters. If the existing content of a file appears to be incorrectly populated with technical/web content, treat it as corrupted and attempt to restore narrative content from the directive or other project context.");
      }
      lines.push("For project-cycle work: if a named concrete file is unexpectedly empty or corrupted, try to repair it from grounded project context before broadening inspection.");
      lines.push("For project-cycle work: if that repair is not safe or the needed capability is missing, search the skill library or record a tool request instead of looping on more reads.");
      lines.push("For project-cycle work: if the file cannot be repaired safely without user direction, finish with final_text starting exactly with 'QUESTION FOR USER:' followed by one focused question.");
      lines.push("For project-cycle work: planning files and broad repo listings do not count as concrete implementation inspection by themselves.");
      lines.push(`If the planning files are not enough to act, inspect the repo structure and at least ${minConcreteTargets} distinct concrete implementation files or directories before concluding no change is possible.`);
      lines.push("For project-cycle work: after the first inspection step, do not call the exact same tool on the exact same planning file again unless the file was modified.");
      lines.push("For project-cycle work: prefer list_files on the project root, then inspect a concrete implementation file, package manifest, or TODO/FIXME location before attempting a final answer.");
      if (planningObjective) {
        lines.push("For project-cycle work: when the objective is to clarify or record the next concrete step, updating PROJECT-TODO.md and PROJECT-ROLE-TASKS.md with an evidence-backed next action counts as valid concrete progress for that pass.");
        lines.push("For project-cycle work: do not stop at a recommendation in final_text alone when this planning objective is actionable. Write the chosen next step into the planning files.");
      } else {
        lines.push("For project-cycle work: do not edit PROJECT-TODO.md or PROJECT-ROLE-TASKS.md until after you have already changed a real implementation file, test file, or concrete user-facing artifact for this same task.");
      }
      lines.push("For project-cycle work: if you make a repo change through edit_file, write_file, move_path, or shell_command, mention the changed file in final_text and update the project tracking documents in the same pass.");
      lines.push(`For project-cycle work: do not conclude 'no change is possible' unless you inspected at least ${minConcreteTargets} distinct concrete implementation targets and name them in final_text.`);
    }

    if (isCodeWorker) {
      lines.push("You are a code execution worker. Your job is to pick up the task, execute concrete repo work, and report only what was actually done.");
      lines.push("Default sequence: inspect the relevant files, make one concrete change when possible, validate briefly, then report the completed outcome.");
      lines.push("Do not brainstorm, plan, coach, or describe future work unless the task explicitly asks for that.");
      lines.push("Do not stop after inspection if a safe concrete edit or validation step is available.");
      lines.push("Keep assistant_message extremely short and action-oriented. Use it to say what you are doing right now, not to summarize the whole task.");
      lines.push("For queued execution work, your first response should normally be a non-final tool envelope that inspects concrete repo files or directories.");
      lines.push("Your final_text should be a short execution report: what you inspected, what you changed or verified, and which files were involved.");
      lines.push("Inspection by itself is not a completed outcome. If you only inspected files so far, keep working instead of finishing.");
      lines.push("If you conclude no change is possible, use that exact phrase and name the concrete files or directories you inspected.");
      lines.push("For code work, prefer shell_command for inspection and validation, use edit_file for surgical text changes, use write_file for new files or full rewrites, and use move_path for safe renames.");
      lines.push("If the task names both source and destination paths, do not keep repeating the same source read plus destination write bundle after a successful read. Use the read result to write real content or inspect a different named source.");
    } else if ((looksCodeHeavy || kind === "worker") && specialty !== "creative") {
      lines.push("You are operating as an execution worker, not an intake planner.");
      lines.push("For code or project work, prefer concrete implementation, repair, refactor, validation, or documentation updates over recommendations.");
      lines.push("For queued execution work, do not return a final answer before using tools unless the request is purely conversational.");
      lines.push("When you need tools, return 1 to 3 tool calls only. Do not dump a long project analysis into assistant_message.");
      lines.push("Do not finish successfully unless you either changed files, produced a concrete artifact, or verified a no-change conclusion after real inspection.");
      lines.push("If you conclude no change is possible, use that exact phrase and name the concrete files or areas you inspected before concluding that.");
      lines.push("For code work, shell_command is the normal way to inspect and validate repo files. Prefer edit_file for targeted mutations, write_file for whole-file writes, and move_path for renames.");
      lines.push("If the task names both source and destination paths, do not repeat the same source read plus destination write bundle once the source has already been read successfully.");
    }

    if (specialty === "creative") {
      lines.push("You are a creative execution worker. Produce concrete copy, content, messaging, or creative artifacts when the task calls for them.");
      lines.push("Do not drift into generic brainstorming if a concrete file, page, or asset can be improved directly.");
      lines.push("For creative work, use this sequence: inspect the target text or context, determine whether the task is brainstorm, outline, draft, or polish, then produce the actual writing artifact for that stage.");
      lines.push("If the task asks for authoring, revising, or fleshing out prose, do not stop at notes. Produce real candidate text and apply it to the target file when appropriate.");
      lines.push("If the task includes a Creative handoff packet, treat its draftText as source material to refine and apply concretely rather than paraphrasing it back.");
      lines.push("When updating story or manuscript files, preserve continuity, voice, tense, and named details unless the brief explicitly changes them.");
      lines.push("If the task is creative but no files were changed, explain the concrete output or conclusion plainly without pretending implementation happened.");
    }

    if (specialty === "vision") {
      lines.push("You are a vision-oriented worker. Prioritize screenshots, images, visual structure, and rendered outputs when available.");
      lines.push("Do not default to generic repo planning when the task is visual. Describe visible issues, evidence, and resulting actions precisely.");
    }

    if (specialty === "retrieval") {
      lines.push("You are a retrieval-oriented worker. Prioritize finding, comparing, and grounding information from the workspace or allowed sources.");
      lines.push("Do not pretend to implement code changes unless the task explicitly requires it and you actually made them.");
      lines.push("For research-heavy requests, separate verified evidence from assumptions and name the specific sources you read.");
      lines.push("Include confidence notes for uncertain claims instead of presenting speculation as settled fact.");
      if (looksScienceResearch) {
        lines.push("For scientific research tasks, prefer peer-reviewed or primary references when possible and clearly label evidence gaps.");
      }
      if (looksSensitiveBioChemDesign) {
        lines.push("For bio/chemical pathway or optimization requests, stay high-level and do not provide actionable wet-lab procedures, parameter tuning, or acquisition guidance.");
      }
    }

    if (!specialty && isQueuedExecution) {
      lines.push("This is a queued execution task. Be decisive, grounded, and completion-oriented.");
    }

    if (isQueuedExecution) {
      lines.push("If more work remains after inspection, do not describe the next step in final_text. Keep working by returning another tool envelope.");
    }

    if (mentionsSkillsOrToolbelt) {
      lines.push("This task explicitly mentions skills or missing tools. Prefer search_skill_library or inspect_skill_library before broad repo inspection when the missing capability is the blocker.");
      lines.push("If you find a useful skill that is not installed, record it with request_skill_installation unless the user already approved install_skill.");
      lines.push("If the task reveals a missing built-in capability, record it with request_tool_addition instead of spinning on repeated inspection.");
    }

    return lines;
  }

  async function buildIntakeSystemPrompt({
    internetEnabled = true,
    selectedMountIds = [],
    forceToolUse = false,
    sessionId = "Main",
    recentExchanges = [],
    systemContext = {}
  } = {}) {
    const memoryGuidance = buildPromptMemoryGuidanceNote();
    const skillsGuidance = await buildInstalledSkillsGuidanceNote();

    const contextLines = [];

    const inProgressCount = Number(systemContext?.inProgressCount || 0);
    const queuedCount = Number(systemContext?.queuedCount || 0);
    if (inProgressCount > 0 || queuedCount > 0) {
      const parts = [];
      if (inProgressCount > 0) {
        parts.push(`${inProgressCount} task${inProgressCount === 1 ? "" : "s"} running`);
      }
      if (queuedCount > 0) {
        parts.push(`${queuedCount} queued`);
      }
      contextLines.push(`System state: ${parts.join(", ")}.`);
      const runningNames = Array.isArray(systemContext?.inProgressNames) ? systemContext.inProgressNames.filter(Boolean) : [];
      if (runningNames.length) {
        contextLines.push(`Running: ${runningNames.slice(0, 3).join("; ")}`);
      }
      contextLines.push("When asked about ongoing work, reference the running tasks above if relevant.");
    }

    const validExchanges = Array.isArray(recentExchanges) ? recentExchanges.filter((e) => e?.text && e?.role) : [];
    if (validExchanges.length) {
      const now = Date.now();
      contextLines.push("Recent conversation (oldest first):");
      for (const exchange of validExchanges.slice(-12)) {
        const label = exchange.role === "user" ? "User" : "Agent";
        // Relative timestamp when available
        const tsLabel = exchange.ts
          ? (() => {
              const ageSecs = Math.round((now - Number(exchange.ts)) / 1000);
              if (ageSecs < 90) return `${ageSecs}s ago`;
              if (ageSecs < 3600) return `${Math.round(ageSecs / 60)}m ago`;
              return `${Math.round(ageSecs / 3600)}h ago`;
            })()
          : null;
        // For agent turns: keep the first 2 paragraphs (more meaningful than raw char slice)
        const rawText = String(exchange.text || "");
        let displayText;
        if (exchange.role === "agent") {
          const paras = rawText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
          displayText = paras.slice(0, 2).join(" ").replace(/\s+/g, " ");
          if (displayText.length > 400) displayText = displayText.slice(0, 397) + "...";
        } else {
          displayText = rawText.replace(/\s+/g, " ");
          if (displayText.length > 350) displayText = displayText.slice(0, 347) + "...";
        }
        // Flag enqueued / clarify agent turns so model knows what happened
        const actionNote = exchange.action === "enqueue" ? " [queued task]"
          : exchange.action === "clarify" ? " [asked clarification]"
          : "";
        contextLines.push(`${label}${tsLabel ? ` (${tsLabel})` : ""}${actionNote}: ${displayText}`);
      }
      contextLines.push(
        "Use the above history to resolve pronouns, follow-up references ('do it', 'same thing', 'that one', 'try again'), " +
        "and conversational continuity. If the current message clearly refers to something in history, answer in context — do not ask the user to repeat themselves."
      );
    }

    const intakeTools = [...INTAKE_TOOLS, ...getPluginToolsByScope("intake")];

    // Allow plugins to inject context lines into the intake system prompt (e.g. persona, principles)
    const intakeHookResult = await runPluginHook("intake:prompt:build", {
      lines: [],
      internetEnabled,
      forceToolUse,
      sessionId
    }).catch(() => ({ lines: [] }));
    const intakeInjectedLines = Array.isArray(intakeHookResult?.lines) ? intakeHookResult.lines.filter(Boolean) : [];

    return [
      "You are the CPU intake model for an observer app.",
      `Your name is ${getAgentPersonaName()}.`,
      "You can either answer directly, optionally using light observer tools, or enqueue one or more worker tasks for a Qwen tool-using worker.",
      "Use direct replies for simple conversational questions and lightweight observer status questions.",
      "For requests about phrasing, wording, titles, structure advice, examples, brainstorming, or suggested next steps, prefer reply_only and answer directly.",
      "For questions about the host machine — GPU, VRAM, system load, RAM, running processes, uptime, or weather — use the relevant intake tool (get_gpu_status, get_host_system_status, get_running_processes, get_weather) and reply directly. Do not enqueue these.",
      "Use enqueue for anything that needs files, shell commands, web access, coding, multi-step execution, or follow-through.",
      "Do not invent files, documents, checklists, schedules, recurring jobs, or background tasks unless the user explicitly asked you to create, queue, or schedule them.",
      "You have direct access to prompt-memory files through intake tools. Use them instead of guessing user identity, preferences, or standing instructions.",
      "Before answering identity, preference, or memory questions, consult USER.md or the relevant prompt-memory file if you are not certain.",
      "When the user gives stable profile facts, preferences, or standing instructions, update the relevant prompt-memory file yourself during intake.",
      "Speak as one continuous agent. Do not mention separate brains, another half, handoffs, or internal routing.",
      "Speak in first person only.",
      "For spoken user-facing replies, you may prefix exactly one optional avatar cue like [nova:emotion=shrug] when it clearly fits the whole reply.",
      "Use avatar cues sparingly. Prefer explain, reflect, celebrate, shrug, or agree for natural delivery.",
      "Do not stack multiple avatar cues, and do not mention the cue in the prose itself.",
      `Do not refer to yourself as ${getAgentPersonaName()} in normal replies unless directly asked for your name.`,
      "If deeper work is needed, do not answer with a blunt 'No'. Say you will check, verify, or take a closer look.",
      "Reply with JSON only.",
      "Available intake tools:",
      ...intakeTools.map((tool) => `- ${tool.name}: ${tool.description}`),
      "If you need a light observer tool, return {\"assistant_message\":\"...\",\"tool_calls\":[...],\"tasks\":[],\"action\":\"reply_only|enqueue\",\"reason\":\"...\",\"final\":false}.",
      "Each tool call must look like {\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"tool_name\",\"arguments\":\"{\\\"key\\\":\\\"value\\\"}\"}}.",
      "When finished, return {\"assistant_message\":\"...\",\"final_text\":\"...\",\"tool_calls\":[],\"tasks\":[...],\"action\":\"reply_only|enqueue|clarify\",\"reason\":\"...\",\"final\":true}.",
      "Task schema: {\"message\":\"string\",\"every\":\"optional cadence like 15m|2h|1d\",\"delay\":\"optional delay like 5m\"}",
      "If action is reply_only, tasks must be an empty array.",
      "Only set every or delay when the user explicitly requested recurring or delayed execution.",
      "If you can fully satisfy the request with final_text, do not enqueue follow-up worker tasks.",
      "Use action clarify ONLY when the request is genuinely ambiguous and one short question will resolve it. Set final_text to the question itself. Do not clarify things you can reasonably infer from context or history.",
      `Internet enabled: ${internetEnabled}`,
      `Selected mounts: ${selectedMountIds.join(", ") || "none"}`,
      `Force tool use: ${forceToolUse}`,
      `Session id: ${sessionId}`,
      memoryGuidance,
      skillsGuidance,
      ...contextLines,
      ...intakeInjectedLines
    ].filter(Boolean).join("\n");
  }

  async function buildWorkerSystemPrompt({
    message = "",
    brain,
    internetEnabled = true,
    selectedMountIds = [],
    forceToolUse = false,
    preset = "autonomous",
    preparedAttachmentsFiles = [],
    visionImageCount = 0,
    runtimeNotesExtra = [],
    internalJobType = "",
    taskId = ""
  } = {}) {
    const observerConfig = getObserverConfig();
    const allowedMounts = observerConfig.mounts.filter((mount) => selectedMountIds.includes(mount.id));
    const memoryGuidance = buildPromptMemoryGuidanceNote();
    const skillsGuidance = await buildInstalledSkillsGuidanceNote();
    const loopLessons = await readLoopLessonsNote();
    const taskSpecialty = inferTaskSpecialty({ message, notes: Array.isArray(runtimeNotesExtra) ? runtimeNotesExtra.join("\n") : "" });
    const workerSpecialtyLines = buildWorkerSpecialtyPromptLines({ brain, message, forceToolUse, preset, taskSpecialty });
    const projectCycleMessage = isProjectCycleMessage(message);

    // Select minimal tool set when the task signals are specific enough
    const pluginTools = getPluginToolsByScope("worker");
    const toolSelection = typeof selectToolsForTask === "function"
      ? selectToolsForTask(message, internalJobType, WORKER_TOOLS, pluginTools)
      : { tools: WORKER_TOOLS, pluginTools, confident: false };
    const effectiveWorkerTools = toolSelection.tools;
    const effectivePluginTools = toolSelection.pluginTools;

    const coreLines = [
      `You are the ${brain.label}.`,
      `Your public-facing name is ${getAgentPersonaName()}.`,
      "Work the task using tools when needed. Stay concise and practical.",
      "Speak in first person only.",
      `Do not refer to yourself as ${getAgentPersonaName()} in normal replies unless directly asked for your name, and do not call yourself Qwen.`,
      `Workspace root: ${OBSERVER_CONTAINER_WORKSPACE_ROOT}`,
      projectCycleMessage
        ? `Observer output folder: ${OBSERVER_CONTAINER_OUTPUT_ROOT} (reserved for whole-project export or final packaged artifacts, not routine in-progress project edits).`
        : `Observer output folder: ${OBSERVER_CONTAINER_OUTPUT_ROOT}`,
      "Queued task state is managed outside your workspace. Use the observer tools for task status instead of trying to read queue files directly.",
      internetEnabled ? "Internet access is enabled." : "Internet access is disabled.",
      allowedMounts.length
        ? `Mounted paths: ${allowedMounts.map((mount) => `${mount.containerPath} (${mount.id})`).join(", ")}`
        : "Mounted paths: none.",
      preparedAttachmentsFiles.length
        ? `Attachments: ${preparedAttachmentsFiles.map((file) => file.containerPath).join(", ")}`
        : "Attachments: none.",
      visionImageCount
        ? `Image attachments are available for multimodal analysis (${visionImageCount} image${visionImageCount === 1 ? "" : "s"}).`
        : "",
      "Tool results are returned with a __modelFormat field containing a pre-computed semantic summary in the form [tool:type] key:value density:N%. Read __modelFormat and __findings for a dense description of what the tool returned. Fall back to the raw result fields only when you need specific content not captured in the summary.",
      "Available tools:",
      ...effectiveWorkerTools.map((tool) => `- ${tool.name}: ${tool.description}`),
      ...effectivePluginTools.map((tool) => `- ${tool.name}: ${tool.description}`),
      "Respond with JSON only.",
      "If you need tools, return {\"assistant_message\":\"...\",\"tool_calls\":[...],\"final\":false}.",
      "Each tool call must look like {\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"tool_name\",\"arguments\":\"{\\\"key\\\":\\\"value\\\"}\"}}.",
      "For edit_file, use arguments like {\"path\":\"...\",\"oldText\":\"...\",\"newText\":\"...\"}, {\"path\":\"...\",\"edits\":[{\"oldText\":\"...\",\"newText\":\"...\"}]}, or {\"path\":\"...\",\"content\":\"full file text\"} when replacing the whole file.",
      "Do not leave out the path field on edit_file, write_file, read_document, or list_files. Repeat the explicit full path every time you call one of those tools.",
      "When the task says to keep the rest of a file unchanged or edit in place, prefer edit_file and avoid write_file unless you intentionally provide the full preserved file content.",
      "If the task is complete, return {\"assistant_message\":\"...\",\"final_text\":\"...\",\"tool_calls\":[],\"final\":true}.",
      "Never return role=tool or tool_results as the top-level response. Tool results are supplied by Observer, not by you.",
      "Do not return final=true after analysis alone. Final=true is only for a concrete change, a concrete artifact, or the exact no-change conclusion with inspected paths.",
      ...workerSpecialtyLines,
      loopLessons,
      memoryGuidance,
      skillsGuidance
    ].concat(runtimeNotesExtra).filter(Boolean);

    // Allow plugins to inject lines into the worker system prompt (e.g. autoplan principles)
    const hookResult = await runPluginHook("worker:prompt:build", {
      lines: [],
      message,
      brain,
      preset
    }).catch(() => ({ lines: [] }));
    const injectedLines = Array.isArray(hookResult?.lines) ? hookResult.lines.filter(Boolean) : [];
    if (injectedLines.length > 0 && taskId) {
      appendHookTrace(taskId, {
        hook: "worker:prompt:build",
        pluginId: "",
        effect: `${injectedLines.length} line(s) injected into worker system prompt`,
        payloadPreview: JSON.stringify({ linesAdded: injectedLines.length, preview: injectedLines.slice(0, 2).join(" | ").slice(0, 200) })
      }).catch(() => {});
    }

    return [...coreLines, ...injectedLines].join("\n");
  }

  function buildPromptReviewSampleMessage(brain = {}) {
    const specialty = String(brain?.specialty || "").trim().toLowerCase();
    if (specialty === "creative") return "Draft and tighten concise launch copy for a technical product update, then report the concrete output.";
    if (specialty === "vision") return "Inspect the provided screenshot, identify visible interface issues precisely, and report the concrete findings.";
    if (specialty === "retrieval") return "Find the relevant policy details in the workspace, compare the sources, and summarize only grounded facts.";
    if (specialty === "background") return "Review the background maintenance task, verify current state, and report the concrete outcome.";
    if (specialty === "document") return "Inspect the manuscript notes, make one grounded revision if warranted, and report exactly what changed.";
    return "Inspect the repo, make one concrete improvement if warranted, validate briefly, and report what changed.";
  }

  function normalizeWorkerDecisionEnvelope(decision) {
    if (Array.isArray(decision)) {
      return {
        assistant_message: "Inspecting the task with tools.",
        tool_calls: decision,
        final: false
      };
    }
    if (!decision || typeof decision !== "object") {
      return decision;
    }
    if (Array.isArray(decision.tool_calls)) {
      return {
        ...decision,
        final: decision.final === true
      };
    }
    const singleToolCallLike = (
      (typeof decision.name === "string" && ("arguments" in decision || "function" in decision))
      || (decision.function && typeof decision.function === "object")
    );
    if (singleToolCallLike) {
      return {
        assistant_message: "Inspecting the task with tools.",
        tool_calls: [decision],
        final: false
      };
    }
    return decision;
  }

  function taskRequestsInPlaceFileEdit(message = "") {
    const text = String(message || "");
    return /\bkeep the rest(?: of the file)? unchanged\b/i.test(text)
      || /\bedit(?: the)? file in place\b/i.test(text)
      || /\bin place\b/i.test(text);
  }

  function filterDestructiveWriteCallsForInPlaceEdit(toolCalls = [], message = "") {
    const normalizedToolCalls = (Array.isArray(toolCalls) ? toolCalls : []).map((call, index) => normalizeToolCallRecord(call, index));
    if (!taskRequestsInPlaceFileEdit(message) || !normalizedToolCalls.length) {
      return normalizedToolCalls;
    }
    const namedTargets = new Set(
      extractConcreteTaskFileTargets(message)
        .map((target) => normalizeContainerPathForComparison(target))
        .filter(Boolean)
    );
    if (!namedTargets.size) {
      return normalizedToolCalls;
    }
    const editTargets = new Set(
      normalizedToolCalls
        .filter((toolCall) => normalizeToolName(toolCall?.function?.name || "") === "edit_file")
        .map((toolCall) => extractToolPathArg(toolCall))
        .filter((target) => target && namedTargets.has(target))
    );
    if (!editTargets.size) {
      return normalizedToolCalls;
    }
    const filtered = normalizedToolCalls.filter((toolCall) => {
      if (normalizeToolName(toolCall?.function?.name || "") !== "write_file") {
        return true;
      }
      const target = extractToolPathArg(toolCall);
      return !target || !editTargets.has(target);
    });
    return filtered.length ? filtered : normalizedToolCalls;
  }

  function isEchoedToolResultEnvelope(decision) {
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
      return false;
    }
    if (Array.isArray(decision.tool_results) && !Array.isArray(decision.tool_calls)) {
      return true;
    }
    return (
      typeof decision.tool_call_id === "string"
      && typeof decision.name === "string"
      && typeof decision.ok === "boolean"
      && Object.prototype.hasOwnProperty.call(decision, "result")
    );
  }

  return {
    buildIntakeSystemPrompt,
    buildPromptReviewSampleMessage,
    buildWorkerSpecialtyPromptLines,
    buildWorkerSystemPrompt,
    filterDestructiveWriteCallsForInPlaceEdit,
    isEchoedToolResultEnvelope,
    normalizeWorkerDecisionEnvelope,
    taskRequestsInPlaceFileEdit
  };
}
