export function createObserverMaintenanceSupport(context = {}) {
  const {
    HELPER_SCOUT_TIMEOUT_MS,
    MAX_WAITING_QUESTION_COUNT,
    MODEL_KEEPALIVE,
    PROJECT_ROLE_PLAYBOOKS,
    appendDailyQuestionLog,
    applyQuestionMaintenanceAnswer,
    buildAllowedOpportunityReferences,
    buildDocumentIndexSnapshot,
    buildOpportunityWorkspaceSnapshot,
    buildWaitingQuestionLimitSummary,
    chooseIdleWorkerBrainForSpecialty,
    chooseQuestionMaintenanceBrain,
    chooseQuestionMaintenanceTarget,
    compactTaskText,
    createQueuedTask,
    deriveOpportunityAnchorData,
    ensurePromptWorkspaceScaffolding,
    extractJsonObject,
    findRecentCronTaskRuns,
    findTaskByMaintenanceKey,
    findTaskByOpportunityKey,
    getAgentPersonaName,
    getBrain,
    getObserverConfig,
    getPromptMemoryFileMap,
    getQuestionMaintenanceExpansions,
    getQuestionMaintenanceTargets,
    getWaitingQuestionBacklogCount,
    hashRef,
    isBogusOrMetaOpportunityMessage,
    isCpuQueueLane,
    isGeneratedObserverArtifactPath,
    isObserverOutputDocumentPath,
    listAllTasks,
    listContainerWorkspaceProjects,
    messageReferencesKnownOpportunitySource,
    readVolumeFile,
    runOllamaJsonGenerate,
    writeVolumeText
  } = context;

  async function queueHelperScoutTask(brain, now = Date.now()) {
    if (!brain?.id) {
      return null;
    }
    const maintenanceKey = `helper-scout:${brain.id}`;
    const existing = await findTaskByMaintenanceKey(maintenanceKey);
    if (existing && ["queued", "in_progress", "waiting_for_user"].includes(String(existing.status || "").toLowerCase())) {
      return existing;
    }
    const observerConfig = getObserverConfig();
    return createQueuedTask({
      message: "Scout for additional useful work packages that can be handed to worker brains. Focus on concise, actionable tasks.",
      sessionId: "helper-scout",
      requestedBrainId: brain.id,
      intakeBrainId: "bitnet",
      internetEnabled: false,
      selectedMountIds: Array.isArray(observerConfig?.defaults?.mountIds) ? observerConfig.defaults.mountIds : [],
      forceToolUse: false,
      notes: `Queued to keep idle helper brain ${brain.label || brain.id} generating additional work packages.`,
      taskMeta: {
        internalJobType: "helper_scout",
        maintenanceKey,
        helperBrainId: brain.id,
        helperQueuedAt: now
      }
    });
  }

  async function executeHelperScoutJob(task) {
    const helperBrain = await getBrain(String(task.requestedBrainId || "").trim() || "bitnet");
    const snapshot = await buildOpportunityWorkspaceSnapshot();
    const documentScanSummary = await buildDocumentIndexSnapshot();
    const workspaceProjects = await listContainerWorkspaceProjects();
    const urgentDocuments = Array.isArray(documentScanSummary?.urgentDocuments)
      ? documentScanSummary.urgentDocuments.filter((entry) => !isGeneratedObserverArtifactPath(entry?.path || entry?.relativePath || ""))
      : [];
    const allowedRefs = buildAllowedOpportunityReferences({
      workspaceProjects,
      recentFailed: snapshot?.recentFailed,
      recentDone: snapshot?.recentDone,
      urgentDocuments,
      workspaceMarkdown: snapshot?.workspaceMarkdown
    });
    const prompt = [
      "You are generating additional background work packages for an observer system.",
      `Your name is ${getAgentPersonaName()}.`,
      "Reply with JSON only.",
      "Do not use markdown fences, headings, or commentary outside the JSON object.",
      "Keep the JSON compact. Do not narrate how you evaluated every hat.",
      "Return at most 1 task proposal.",
      "Keep summary to one short sentence.",
      "Each proposal must be concise, actionable, and useful for a worker brain.",
      "Only propose tasks that can be delegated safely without user clarification.",
      "Do not propose meta-work about finding work, updating summaries, worker summaries, artifact summaries, or handing work to worker brains.",
      "Each task must reference a concrete source from the current snapshot, such as a project name, a file path, a document path, or a failed task id.",
      "Do not propose vague planning about daily tasks, personal notes, preferences, reminders, or generic work packages.",
      "Do not propose work that is already covered by a recent completed task unless there is a clearly unresolved concrete failure.",
      "Prefer returning no tasks over weak or repetitive suggestions.",
      "Review the workspace while wearing rotating professional hats. Consider each hat briefly, then keep only the single strongest grounded task, if any.",
      "For each hat, look for actual unfinished work in current projects, code, configs, or documents. Prefer tasks that end in a concrete artifact, code change, verification result, or user-facing improvement.",
      "If none of the hats reveal a strong grounded task, return zero tasks.",
      "When you do propose a task, make it specific enough that a worker can act immediately without inventing scope.",
      "Put the chosen hat name at the start of the reason so the operator can see why this task exists.",
      "Use specialtyHint from: code, document, general.",
      "Schema: {\"summary\":\"...\",\"tasks\":[{\"message\":\"...\",\"specialtyHint\":\"code|document|general\",\"reason\":\"...\"}]}",
      "",
      "Rotating hats playbook:",
      ...PROJECT_ROLE_PLAYBOOKS.map((entry) => `- ${entry.name}: ${entry.playbook}`),
      "",
      `Workspace projects: ${workspaceProjects.map((project) => project.name).join(", ") || "none"}`,
      `Recent failed tasks: ${(snapshot.recentFailed || []).map((entry) => `${entry.id}: ${entry.summary || entry.message}`).join(" | ") || "none"}`,
      `Recent completed tasks: ${(snapshot.recentDone || []).map((entry) => `${entry.id}: ${entry.summary || entry.message}`).join(" | ") || "none"}`,
      `Priority documents: ${urgentDocuments.slice(0, 6).map((entry) => `${entry.relativePath}: ${entry.summary || entry.heading}`).join(" | ") || "none"}`,
      `Relevant markdown: ${(snapshot.workspaceMarkdown || []).slice(0, 8).map((entry) => `${entry.path}: ${entry.heading || entry.summary}`).join(" | ") || "none"}`
    ].join("\n");
    const result = await runOllamaJsonGenerate(helperBrain.model, prompt, {
      timeoutMs: HELPER_SCOUT_TIMEOUT_MS,
      keepAlive: MODEL_KEEPALIVE,
      baseUrl: helperBrain.ollamaBaseUrl,
      options: isCpuQueueLane(helperBrain) ? { num_gpu: 0 } : undefined
    });
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        timedOut: result.timedOut,
        preset: "internal-helper-scout",
        brain: helperBrain,
        network: "local",
        mounts: [],
        attachments: [],
        outputFiles: [],
        parsed: null,
        stdout: "",
        stderr: result.stderr || "helper scout failed"
      };
    }
    let parsed = {};
    try {
      parsed = extractJsonObject(result.text);
    } catch (error) {
      return {
        ok: false,
        code: 0,
        timedOut: false,
        preset: "internal-helper-scout",
        brain: helperBrain,
        network: "local",
        mounts: [],
        attachments: [],
        outputFiles: [],
        parsed: null,
        stdout: result.text || "",
        stderr: `helper scout returned invalid JSON: ${error.message}`
      };
    }
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const created = [];
    const allowedSpecialties = new Set(["code", "document", "general"]);
    for (const proposal of tasks.slice(0, 1)) {
      const message = compactTaskText(String(proposal?.message || "").trim(), 220);
      const specialtyHintRaw = String(proposal?.specialtyHint || "").trim().toLowerCase();
      const specialtyHint = allowedSpecialties.has(specialtyHintRaw) ? specialtyHintRaw : "general";
      const reason = compactTaskText(String(proposal?.reason || "").trim(), 220);
      if (!message) {
        continue;
      }
      if (isBogusOrMetaOpportunityMessage(message)) {
        continue;
      }
      if (!messageReferencesKnownOpportunitySource(message, allowedRefs)) {
        continue;
      }
      const anchors = deriveOpportunityAnchorData(message, {
        workspaceProjects,
        recentFailed: snapshot?.recentFailed,
        urgentDocuments,
        workspaceMarkdown: snapshot?.workspaceMarkdown
      });
      if (!anchors || (!anchors.sourceTaskId && !anchors.sourceDocumentPath && !anchors.projectName)) {
        continue;
      }
      const opportunityKey = `helper-scout:${helperBrain.id}:${hashRef(`${message}|${specialtyHint}`)}`;
      if (await findTaskByOpportunityKey(opportunityKey)) {
        continue;
      }
      const preferredWorker = await chooseIdleWorkerBrainForSpecialty(specialtyHint || "general");
      const observerConfig = getObserverConfig();
      const createdTask = await createQueuedTask({
        message,
        sessionId: "helper-scout",
        requestedBrainId: preferredWorker?.id || "worker",
        intakeBrainId: "bitnet",
        internetEnabled: Boolean(observerConfig?.defaults?.internetEnabled),
        selectedMountIds: Array.isArray(observerConfig?.defaults?.mountIds) ? observerConfig.defaults.mountIds : [],
        forceToolUse: true,
        notes: `Queued from helper scout ${helperBrain.label || helperBrain.id}. ${reason}`.trim(),
        taskMeta: {
          opportunityKey,
          opportunityReason: reason,
          specialtyHint: specialtyHint || "general",
          helperScoutSourceBrainId: helperBrain.id,
          ...anchors
        }
      });
      created.push(createdTask);
    }
    const parsedSummary = compactTaskText(String(parsed.summary || "").trim(), 220);
    const createdSummary = created.length
      ? created
        .slice(0, 2)
        .map((entry) => compactTaskText(String(entry?.message || entry?.projectWorkFocus || entry?.notes || "").trim(), 120))
        .filter(Boolean)
        .join(" | ")
      : "";
    const summary = created.length
      ? compactTaskText(
        parsedSummary || `Helper scout ${helperBrain.label || helperBrain.id} queued ${created.length} grounded work package${created.length === 1 ? "" : "s"}${createdSummary ? `: ${createdSummary}` : "."}`,
        260
      )
      : `Helper scout ${helperBrain.label || helperBrain.id} found no grounded safe work packages worth queueing.`;
    return {
      ok: true,
      code: 0,
      timedOut: false,
      preset: "internal-helper-scout",
      brain: helperBrain,
      network: "local",
      mounts: [],
      attachments: [],
      outputFiles: [],
      parsed: {
        status: "ok",
        result: {
          payloads: [{ text: summary, mediaUrl: null }],
          meta: { durationMs: 0, createdCount: created.length, helperBrainId: helperBrain.id }
        }
      },
      stdout: summary,
      stderr: ""
    };
  }

  async function executeQuestionMaintenanceJob(task) {
    await ensurePromptWorkspaceScaffolding();
    const promptMemoryFileMap = typeof getPromptMemoryFileMap === "function"
      ? getPromptMemoryFileMap() || {}
      : {};
    const questionMaintenanceTargets = typeof getQuestionMaintenanceTargets === "function"
      ? getQuestionMaintenanceTargets() || []
      : [];
    const questionMaintenanceExpansions = typeof getQuestionMaintenanceExpansions === "function"
      ? getQuestionMaintenanceExpansions() || []
      : [];
    const fileContents = {};
    for (const [fileName, filePath] of Object.entries(promptMemoryFileMap)) {
      try {
        fileContents[fileName] = await readVolumeFile(filePath);
      } catch {
        fileContents[fileName] = "";
      }
    }

    const clarificationHistory = Array.isArray(task.clarificationHistory) ? task.clarificationHistory : [];
    const appliedClarificationCount = Math.max(0, Number(task.appliedClarificationCount || 0));
    const pendingTargetKey = String(task.questionTargetKey || "").trim();
    const pendingTarget = [...questionMaintenanceTargets, ...questionMaintenanceExpansions]
      .find((entry) => entry.key === pendingTargetKey) || null;
    let appliedNote = "";
    if (pendingTarget && clarificationHistory.length > appliedClarificationCount) {
      const latestAnswer = String(clarificationHistory[clarificationHistory.length - 1]?.answer || "").trim();
      const applied = applyQuestionMaintenanceAnswer(pendingTarget, latestAnswer, fileContents);
      Object.assign(fileContents, applied.fileContents);
      if (applied.updated) {
        const filePath = promptMemoryFileMap[pendingTarget.fileName];
        await writeVolumeText(filePath, String(fileContents[pendingTarget.fileName] || "").replace(/\s+$/, "") + "\n");
        appliedNote = `${applied.note} Recorded answer for ${pendingTarget.key}.`;
        await appendDailyQuestionLog({
          message: String(task.originalMessage || task.message || "Prompt memory maintenance").trim(),
          sessionId: task.sessionId || "scheduler",
          route: "question-maintenance:update",
          taskRefs: [task],
          notes: `${pendingTarget.key}: ${compactTaskText(latestAnswer, 220)}`
        });
      }
    }

    const recentRuns = task.scheduler?.seriesId
      ? await findRecentCronTaskRuns(task.scheduler.seriesId, 6)
      : [];
    const recentQuestionTargetKeys = [];
    const seenRecentQuestionTargetKeys = new Set();
    for (const candidate of [task, ...recentRuns]) {
      const key = String(candidate?.questionTargetKey || "").trim();
      if (!key || seenRecentQuestionTargetKeys.has(key)) {
        continue;
      }
      seenRecentQuestionTargetKeys.add(key);
      recentQuestionTargetKeys.push(key);
    }

    const nextTarget = chooseQuestionMaintenanceTarget(fileContents, {
      questionCycleIndex: Number(task.questionCycleIndex || 0) + 1,
      recentQuestionTargetKeys
    });
    if (!nextTarget) {
      return {
        ok: true,
        code: 0,
        timedOut: false,
        preset: "internal-question-maintenance",
        brain: await chooseQuestionMaintenanceBrain(),
        network: "local",
        mounts: [],
        attachments: [],
        outputFiles: [],
        parsed: { status: "ok", result: { payloads: [{ text: "Question maintenance found nothing to update or ask right now.", mediaUrl: null }], meta: { durationMs: 0 } } },
        stdout: "Question maintenance found nothing to update or ask right now.",
        stderr: "",
        taskMetaUpdates: {
          appliedClarificationCount: clarificationHistory.length,
          questionTargetKey: "",
          questionCycleIndex: Number(task.questionCycleIndex || 0)
        }
      };
    }

    const promptContext = [
      appliedNote,
      `Target file: ${nextTarget.fileName}`,
      nextTarget.mode === "field" ? `Field: ${nextTarget.label}` : `Section: ${nextTarget.section}`
    ].filter(Boolean).join("\n");
    const waitingQuestionCount = await getWaitingQuestionBacklogCount();
    if (waitingQuestionCount >= MAX_WAITING_QUESTION_COUNT) {
      const backlogSummary = buildWaitingQuestionLimitSummary(waitingQuestionCount);
      return {
        ok: true,
        code: 0,
        timedOut: false,
        preset: "internal-question-maintenance",
        brain: await chooseQuestionMaintenanceBrain(),
        network: "local",
        mounts: [],
        attachments: [],
        outputFiles: [],
        silentInternalSkip: true,
        parsed: {
          status: "ok",
          result: {
            payloads: [{ text: backlogSummary, mediaUrl: null }],
            meta: { durationMs: 0, skippedQuestionTargetKey: nextTarget.key, waitingQuestionCount }
          }
        },
        stdout: backlogSummary,
        stderr: "",
        taskMetaUpdates: {
          appliedClarificationCount: clarificationHistory.length,
          questionTargetKey: "",
          questionCycleIndex: Number(task.questionCycleIndex || 0)
        }
      };
    }

    return {
      ok: true,
      code: 0,
      timedOut: false,
      preset: "internal-question-maintenance",
      brain: await chooseQuestionMaintenanceBrain(),
      network: "local",
      mounts: [],
      attachments: [],
      outputFiles: [],
      waitingForUser: true,
      questionForUser: nextTarget.question,
      parsed: {
        status: "ok",
        result: {
          payloads: [{
            text: appliedNote
              ? `${appliedNote}\n\nNext question: ${nextTarget.question}`
              : "Prompt memory maintenance needs one answer.\n\nNext question: " + nextTarget.question,
            mediaUrl: null
          }],
          meta: { durationMs: 0, nextTargetKey: nextTarget.key }
        }
      },
      stdout: appliedNote || "Prompt memory maintenance prepared the next question.",
      stderr: "",
      taskMetaUpdates: {
        appliedClarificationCount: clarificationHistory.length,
        questionTargetKey: nextTarget.key,
        questionCycleIndex: Number(task.questionCycleIndex || 0) + 1
      }
    };
  }

  function buildDocumentOpportunity(entry) {
    if (!entry?.id || !entry?.relativePath) {
      return null;
    }
    if (String(entry.rootId || "").trim() === "output" || isObserverOutputDocumentPath(entry.path || entry.relativePath || "")) {
      return null;
    }
    if (!["finance", "schedule", "legal", "mail", "action", "notes"].includes(String(entry.category || ""))) {
      return null;
    }
    if (!(entry.actionCandidates?.length || entry.dueDates?.length || entry.watchHits?.length || Number(entry.priority || 0) >= 4)) {
      return null;
    }
    const reasonBits = [];
    if (entry.actionCandidates?.length) reasonBits.push(`actions: ${entry.actionCandidates.slice(0, 2).join("; ")}`);
    if (entry.dueDates?.length) reasonBits.push(`dates: ${entry.dueDates.slice(0, 2).map((value) => String(value).slice(0, 10)).join(", ")}`);
    if (entry.watchHits?.length) reasonBits.push(`watch hits: ${entry.watchHits.slice(0, 3).join(", ")}`);
    return {
      key: `doc-${hashRef(entry.id)}`,
      message: compactTaskText(`Review ${entry.relativePath} and handle the most useful next step. Summary: ${entry.summary || entry.heading}`, 220),
      specialtyHint: ["mail", "notes", "schedule"].includes(String(entry.category || "")) ? "document" : "general",
      sourceDocumentPath: String(entry.relativePath || "").trim(),
      reason: compactTaskText(`Document ${entry.relativePath} was flagged by the native document index${reasonBits.length ? ` (${reasonBits.join(" | ")})` : ""}.`, 220)
    };
  }

  async function findActiveProjectCycleTask(projectName = "") {
    const target = String(projectName || "").trim().toLowerCase();
    if (!target) {
      return null;
    }
    const { queued, inProgress } = await listAllTasks();
    const isPlaceholderFocus = (task) => {
      const focus = String(task?.projectWorkFocus || "").trim().toLowerCase();
      return focus === "none" || focus === "n/a" || focus === "na";
    };
    return [...queued, ...inProgress].find((task) =>
      String(task.internalJobType || "") === "project_cycle"
      && String(task.projectName || "").trim().toLowerCase() === target
      && !isPlaceholderFocus(task)
    ) || null;
  }

  return {
    buildDocumentOpportunity,
    executeHelperScoutJob,
    executeQuestionMaintenanceJob,
    findActiveProjectCycleTask,
    queueHelperScoutTask
  };
}
