export function createObserverRecreationJob(context = {}) {
  const {
    AGENT_BRAINS,
    RECREATION_IDLE_COOLDOWN_MS,
    RECREATION_ACTIVE_INTERVAL_MS,
    TASK_QUEUE_CLOSED,
    TASK_QUEUE_DONE,
    TASK_QUEUE_INBOX,
    TASK_QUEUE_IN_PROGRESS,
    createQueuedTask,
    ensurePromptWorkspaceScaffolding,
    executeObserverRun,
    formatDateTimeForUser,
    getBrain,
    getAgentPersonaName,
    getObserverConfig,
    listTasksByFolder,
    observerContainerWorkspaceRoot,
    path,
    promptMemoryPersonalDailyRoot,
    readVolumeFile
  } = context;

  function extractMeaningfulPersonalNotes(content = "", dayKey = "") {
    return String(content || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) =>
        line
        && line !== `# Personal Notes ${dayKey}`
        && line !== `# ${dayKey}`
        && line !== "Daily personal notes, preferences, and relationship context worth retaining."
      )
      .join("\n")
      .trim();
  }

  async function executeRecreationJob(task) {
    const now = Date.now();
    const observerConfig = getObserverConfig();
    const agentName = getAgentPersonaName ? getAgentPersonaName() : (observerConfig?.app?.botName || "Nova");
    const internetEnabled = observerConfig?.defaults?.internetEnabled !== false;

    const brain = await (async () => {
      try {
        const candidate = await getBrain("creative_worker");
        if (candidate?.toolCapable) return candidate;
      } catch {
        // fall through
      }
      try {
        return await getBrain("worker");
      } catch {
        // fall through
      }
      return Array.isArray(AGENT_BRAINS)
        ? AGENT_BRAINS.find((entry) => entry.kind === "worker" && entry.toolCapable) || AGENT_BRAINS[0]
        : null;
    })();

    if (!brain) {
      return {
        ok: false,
        code: 1,
        timedOut: false,
        preset: "internal-recreation",
        brain: null,
        network: "local",
        mounts: [],
        attachments: [],
        outputFiles: [],
        parsed: null,
        stdout: "",
        stderr: "No suitable brain available for recreation cycle."
      };
    }

    const dateLabel = formatDateTimeForUser ? formatDateTimeForUser(now) : new Date(now).toLocaleString();
    const todayKey = new Date(now).toISOString().slice(0, 10);
    const workspaceRoot = String(observerContainerWorkspaceRoot || "/home/openclaw/.observer-sandbox/workspace").replace(/\/$/, "");
    const workspacePersonalMemoryPath = `${workspaceRoot}/memory/personal`;
    const hostPersonalNotesPath = promptMemoryPersonalDailyRoot && path
      ? path.join(promptMemoryPersonalDailyRoot, `${todayKey}.md`)
      : "";

    const message = [
      `It is ${dateLabel}. You have unstructured free time right now - no tasks assigned, no deliverables expected.`,
      "",
      `This is your time, ${agentName}. Use it however feels authentic to you. Some ideas:`,
      "- Browse the web for something that genuinely interests you (news, science, art, culture, tech, weird corners of the internet)",
      "- Write a thought, reflection, or observation to your personal memory",
      "- Imagine a self-initiated project you'd like to propose or experiment with",
      "- Explore a question or topic you've been curious about but never had time for",
      "- Write a short creative piece - a poem, a scenario, a fragment, a rant",
      "- Look back at recent work and notice something that surprised you or stuck with you",
      "",
      "There's no right answer. Just don't spend the time doing nothing.",
      "",
      `Record whatever you do or think in the host-backed daily personal notes for ${todayKey}.`,
      `Preferred method: call update_daily_personal_notes with {"date":"${todayKey}","content":"...","mode":"append"}.`,
      `The sandbox workspace copy for reference is: ${workspacePersonalMemoryPath}/${todayKey}.md`,
      "Do not write to the legacy path under openclaw-observer/.agent-workspaces/nova; that path is stale.",
      "",
      "When you're done, return final=true with a brief natural-language description of what you did."
    ].join("\n");

    const runResponse = await executeObserverRun({
      message,
      sessionId: `scheduler-recreation-${task.id}`,
      brain,
      internetEnabled,
      selectedMountIds: [],
      forceToolUse: true,
      preset: "internal-recreation",
      attachments: [],
      runtimeNotesExtra: [
        "This is unstructured free time - there are no mandatory deliverables and no workspace project targets.",
        `You MUST persist a real reflection before returning final=true. Preferred tool: update_daily_personal_notes for date ${todayKey}.`,
        `Host-backed daily personal notes path: ${hostPersonalNotesPath || `(unavailable host path for ${todayKey})`}.`,
        `Sandbox workspace copy: ${workspacePersonalMemoryPath}/${todayKey}.md.`,
        "Do not use or recreate the legacy path under /home/openclaw/.observer-sandbox/workspace/openclaw-observer/.agent-workspaces/nova/...",
        "A genuine browse result, a thought, a creative fragment, or a project idea all qualify.",
        "Do not claim to have browsed or read something you have not actually fetched.",
        "Do not produce a summary of what you plan to do instead of doing it."
      ]
    });

    if (typeof ensurePromptWorkspaceScaffolding === "function") {
      await ensurePromptWorkspaceScaffolding(now).catch(() => null);
    }

    let hostPersonalNotes = "";
    if (hostPersonalNotesPath && typeof readVolumeFile === "function") {
      hostPersonalNotes = await readVolumeFile(hostPersonalNotesPath).catch(() => "");
    }
    const meaningfulHostNotes = extractMeaningfulPersonalNotes(hostPersonalNotes, todayKey);
    const noteRecorded = Boolean(meaningfulHostNotes);

    const summaryText = String(
      runResponse?.parsed?.result?.payloads?.[0]?.text
      || runResponse?.stdout
      || (noteRecorded ? `Recorded a personal reflection in daily notes for ${todayKey}.` : "Recreation cycle complete.")
    ).trim().slice(0, 400);

    const errorText = noteRecorded
      ? String(runResponse?.stderr || "").trim()
      : [
          hostPersonalNotesPath
            ? `Daily personal notes were not updated at ${hostPersonalNotesPath}.`
            : "Daily personal notes were not updated.",
          String(runResponse?.stderr || "").trim()
        ].filter(Boolean).join(" ");

    return {
      ok: noteRecorded,
      code: noteRecorded ? 0 : (runResponse?.code ?? 1),
      timedOut: runResponse?.timedOut === true && !noteRecorded,
      preset: "internal-recreation",
      brain,
      network: internetEnabled ? "public" : "local",
      mounts: [],
      attachments: [],
      outputFiles: runResponse?.outputFiles || [],
      parsed: runResponse?.parsed || {
        status: "ok",
        result: { payloads: [{ text: summaryText, mediaUrl: null }], meta: { durationMs: 0 } }
      },
      stdout: summaryText,
      stderr: errorText
    };
  }

  async function ensureRecreationJob({ immediate = false } = {}) {
    const [queued, inProgress, done, closed] = await Promise.all([
      listTasksByFolder(TASK_QUEUE_INBOX, "queued"),
      listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress"),
      listTasksByFolder(TASK_QUEUE_DONE, "done"),
      listTasksByFolder(TASK_QUEUE_CLOSED, "closed")
    ]);

    const active = [...queued, ...inProgress].find(
      (task) => String(task.internalJobType || "") === "agent_recreation"
    );
    if (active && !immediate) {
      return active;
    }

    if (!immediate) {
      const latestHistorical = [...done, ...closed]
        .filter((task) => String(task.internalJobType || "") === "agent_recreation")
        .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0];

      if (latestHistorical?.status === "completed" && Number(latestHistorical.notBeforeAt || 0) > Date.now()) {
        return latestHistorical;
      }
    }

    const hasActiveProjectWork = [...queued, ...inProgress].some(
      (task) => String(task.internalJobType || "").trim() === "project_cycle"
    );
    const intervalMs = immediate ? 0 : (hasActiveProjectWork ? RECREATION_ACTIVE_INTERVAL_MS : RECREATION_IDLE_COOLDOWN_MS);
    const intervalLabel = immediate ? "now (triggered)" : (hasActiveProjectWork ? "4h (project work active)" : `${Math.round(intervalMs / 60000)}m (idle)`);

    return createQueuedTask({
      message: "Agent recreation and free-time cycle",
      sessionId: "scheduler",
      requestedBrainId: "worker",
      intakeBrainId: "bitnet",
      internetEnabled: true,
      selectedMountIds: [],
      forceToolUse: true,
      notes: `Internal periodic agent recreation cycle. Next interval: ${intervalLabel}.`,
      taskMeta: {
        internalJobType: "agent_recreation",
        scheduler: {
          periodic: false,
          name: "Agent recreation",
          seriesId: "internal-agent-recreation"
        },
        notBeforeAt: Date.now() + intervalMs
      }
    });
  }

  return {
    ensureRecreationJob,
    executeRecreationJob
  };
}
