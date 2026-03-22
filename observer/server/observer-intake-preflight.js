export function createObserverIntakePreflight(context = {}) {
  const {
    MODEL_KEEPALIVE,
    compactTaskText,
    extractFileReferenceCandidates,
    extractJsonObject,
    getBrain,
    isCpuQueueLane,
    listHealthyRoutingHelpers,
    listIdleHelperBrains,
    looksLikePlaceholderTaskMessage,
    normalizeContainerMountPathCandidate,
    normalizeUserRequest,
    normalizeWindowsPathCandidate,
    normalizeWorkspaceRelativePathCandidate,
    planIntakeWithBitNet,
    runOllamaJsonGenerate,
    tryBuildObserverNativeResponse
  } = context;
async function chooseQuestionMaintenanceBrain() {
  const helpers = await listHealthyRoutingHelpers();
  const preferredOrder = ["remote_cpu", "lappy_cpu", "helper"];
  for (const brainId of preferredOrder) {
    const matched = helpers.find((brain) => String(brain.id || "").trim() === brainId);
    if (matched) {
      return matched;
    }
  }
  return helpers[0] || await getBrain("helper");
}

async function chooseIdlePromptRewriteBrain() {
  const idleHelpers = await listIdleHelperBrains(8);
  if (!idleHelpers.length) {
    return null;
  }
  const preferredOrder = ["lappy_cpu2", "remote_cpu", "helper", "lappy_cpu1"];
  for (const brainId of preferredOrder) {
    const matched = idleHelpers.find((brain) => String(brain.id || "").trim() === brainId);
    if (matched) {
      return matched;
    }
  }
  return idleHelpers[0] || null;
}

async function maybeRewritePromptWithIdleBrain({ message = "", sessionId = "Main", source = "text" } = {}) {
  const original = normalizeUserRequest(message);
  if (!String(original || "").trim()) {
    return {
      ok: true,
      used: false,
      skipped: true,
      reason: "empty",
      message: original,
      originalMessage: original
    };
  }
  const helperBrain = await chooseIdlePromptRewriteBrain();
  if (!helperBrain) {
    return {
      ok: true,
      used: false,
      skipped: true,
      reason: "no_idle_brain",
      message: original,
      originalMessage: original
    };
  }
  const prompt = [
    "You clean up Nova user prompts before intake.",
    "Rewrite the prompt to fix obvious speech-to-text mistakes, punctuation, casing, and phrasing.",
    "Preserve the user's intent exactly. Do not add new requests or remove important constraints.",
    "If a word is ambiguous, prefer the safest interpretation and keep the request practical.",
    "Return JSON only using this schema exactly:",
    "{\"rewritten_prompt\":\"...\",\"changed\":true,\"notes\":[\"...\"]}",
    `Session: ${String(sessionId || "Main").trim() || "Main"}`,
    `Source: ${String(source || "text").trim() || "text"}`,
    `Original prompt: ${original}`
  ].join("\n");
  const result = await runOllamaJsonGenerate(helperBrain.model, prompt, {
    timeoutMs: 6000,
    keepAlive: MODEL_KEEPALIVE,
    baseUrl: helperBrain.ollamaBaseUrl,
    options: isCpuQueueLane(helperBrain) ? { num_gpu: 0 } : undefined
  });
  if (!result.ok) {
    return {
      ok: false,
      used: false,
      skipped: true,
      reason: "generation_failed",
      message: original,
      originalMessage: original,
      brainId: helperBrain.id,
      error: result.stderr || "prompt rewrite failed"
    };
  }
  try {
    const parsed = extractJsonObject(result.text);
    const rewritten = normalizeUserRequest(String(parsed?.rewritten_prompt || "").trim());
    const normalizedRewritten = compactTaskText(rewritten, 4000);
    const normalizedOriginal = compactTaskText(original, 4000);
    const looksLikePlaceholderRewrite = looksLikePlaceholderTaskMessage(normalizedRewritten);
    if (!normalizedRewritten) {
      return {
        ok: true,
        used: false,
        skipped: true,
        reason: "empty_rewrite",
        message: normalizedOriginal,
        originalMessage: normalizedOriginal,
        brainId: helperBrain.id,
        brainLabel: helperBrain.label
      };
    }
    if (looksLikePlaceholderRewrite) {
      return {
        ok: true,
        used: false,
        skipped: true,
        reason: "placeholder_rewrite",
        message: normalizedOriginal,
        originalMessage: normalizedOriginal,
        brainId: helperBrain.id,
        brainLabel: helperBrain.label,
        notes: Array.isArray(parsed?.notes)
          ? parsed.notes.map((entry) => compactTaskText(String(entry || "").trim(), 120)).filter(Boolean).slice(0, 4)
          : []
      };
    }
    return {
      ok: true,
      used: normalizedRewritten !== normalizedOriginal,
      skipped: false,
      reason: normalizedRewritten !== normalizedOriginal ? "rewritten" : "unchanged",
      message: normalizedRewritten,
      originalMessage: normalizedOriginal,
      brainId: helperBrain.id,
      brainLabel: helperBrain.label,
      notes: Array.isArray(parsed?.notes)
        ? parsed.notes.map((entry) => compactTaskText(String(entry || "").trim(), 120)).filter(Boolean).slice(0, 3)
        : []
    };
  } catch (error) {
    return {
      ok: false,
      used: false,
      skipped: true,
      reason: "invalid_json",
      message: original,
      originalMessage: original,
      brainId: helperBrain.id,
      error: error.message
    };
  }
}

function shouldRunWorkerPreflight(task = {}) {
  if (!String(task?.message || "").trim()) {
    return false;
  }
  if (String(task?.status || "").trim() !== "queued") {
    return false;
  }
  if (String(task?.internalJobType || "").trim()) {
    return false;
  }
  if (task?.scheduler?.periodic) {
    return false;
  }
  return true;
}

function extractConcreteTaskFileTargets(message = "") {
  return [...new Set(
    extractFileReferenceCandidates(message)
      .map((candidate) => (
        normalizeWindowsPathCandidate(candidate)
        || normalizeContainerMountPathCandidate(candidate)
        || normalizeWorkspaceRelativePathCandidate(candidate)
        || ""
      ))
      .filter(Boolean)
  )];
}

function shouldBypassWorkerPreflight(task = {}) {
  const message = String(task?.message || "").trim();
  const lower = message.toLowerCase();
  if (!message) {
    return false;
  }
  if (/^\s*(what|how|why|when|where|who)\b/.test(lower)) {
    return false;
  }
  const fileTargets = extractConcreteTaskFileTargets(message);
  if (!fileTargets.length) {
    return false;
  }
  const hasActionVerb = /\b(edit|replace|update|modify|rewrite|revise|write|create|compare|inspect|read|extract|produce)\b/.test(lower);
  if (!hasActionVerb) {
    return false;
  }
  const hasExplicitExecutionSignal = /^(edit|update|rewrite|revise|write|create|compare|inspect|read|extract|produce)\b/.test(lower)
    || /\b(by replacing|replace\b|replacing\b|edit in place|keep the rest|unchanged|mention the edited file|mention the file written)\b/.test(lower)
    || String(task?.sessionId || "").trim() === "local-worker-regression";
  if (hasExplicitExecutionSignal) {
    return true;
  }
  return task?.forceToolUse === true && fileTargets.length >= 1;
}

async function runWorkerTaskPreflight(task = {}) {
  if (!shouldRunWorkerPreflight(task)) {
    return {
      ok: true,
      action: "skip",
      optimizedMessage: String(task?.message || "").trim()
    };
  }
  if (shouldBypassWorkerPreflight(task)) {
    return {
      ok: true,
      action: "proceed",
      reason: "clear_file_execution_request",
      optimizedMessage: String(task?.message || "").trim()
    };
  }
  const strictPreflight = task?.requireWorkerPreflight === true;
  let helperBrain = await chooseIdlePromptRewriteBrain();
  if (!helperBrain && strictPreflight) {
    helperBrain = await getBrain("bitnet");
  }
  if (!helperBrain) {
    return {
      ok: true,
      action: "skip",
      reason: "no_idle_brain",
      optimizedMessage: String(task?.message || "").trim()
    };
  }
  const prompt = [
    "You are Nova's worker preflight gate.",
    "Decide whether this task is clear enough for a worker to execute right now.",
    "If it is clear, rewrite it into a concise optimized worker-ready task while preserving intent.",
    "If it is unclear, do not guess. Ask exactly one focused clarification question for the user.",
    "Prefer asking about the specific ambiguous word or phrase, for example: What did you mean by \"...\"?",
    "Return JSON only with this schema exactly:",
    "{\"decision\":\"proceed|clarify\",\"optimized_message\":\"...\",\"question\":\"...\",\"reason\":\"...\"}",
    `Task message: ${String(task.message || "").trim()}`,
    String(task.originalMessage || "").trim() && String(task.originalMessage || "").trim() !== String(task.message || "").trim()
      ? `Original user wording: ${String(task.originalMessage || "").trim()}`
      : "",
    Array.isArray(task.clarificationHistory) && task.clarificationHistory.length
      ? `Clarification history:\n${task.clarificationHistory.map((entry, index) => `${index + 1}. Q: ${compactTaskText(String(entry?.question || "").trim(), 200)} | A: ${compactTaskText(String(entry?.answer || "").trim(), 200)}`).join("\n")}`
      : ""
  ].filter(Boolean).join("\n");
  const result = await runOllamaJsonGenerate(helperBrain.model, prompt, {
    timeoutMs: 6500,
    keepAlive: MODEL_KEEPALIVE,
    baseUrl: helperBrain.ollamaBaseUrl,
    options: isCpuQueueLane(helperBrain) ? { num_gpu: 0 } : undefined
  });
  if (!result.ok) {
    if (strictPreflight) {
      const fallbackText = compactTaskText(String(task?.originalMessage || task?.message || "").trim(), 180);
      return {
        ok: false,
        action: "clarify",
        question: fallbackText ? `What did you mean by "${fallbackText}"?` : "What did you mean by that request?",
        reason: result.stderr || "preflight_failed",
        optimizedMessage: String(task?.message || "").trim()
      };
    }
    return {
      ok: false,
      action: "skip",
      reason: result.stderr || "preflight_failed",
      optimizedMessage: String(task?.message || "").trim()
    };
  }
  try {
    const parsed = extractJsonObject(result.text);
    const decision = String(parsed?.decision || "").trim().toLowerCase();
    const optimizedMessage = compactTaskText(String(parsed?.optimized_message || task?.message || "").trim(), 4000) || String(task?.message || "").trim();
    const question = compactTaskText(String(parsed?.question || "").trim(), 1000);
    const reason = compactTaskText(String(parsed?.reason || "").trim(), 220);
    const normalizedOriginalMessage = String(task?.message || "").trim();
    const safeOptimizedMessage = looksLikePlaceholderTaskMessage(optimizedMessage)
      ? normalizedOriginalMessage
      : optimizedMessage;
    if (decision === "clarify" && question) {
      return {
        ok: true,
        action: "clarify",
        question,
        reason,
        optimizedMessage: safeOptimizedMessage
      };
    }
    return {
      ok: true,
      action: "proceed",
      optimizedMessage: safeOptimizedMessage,
      reason
    };
  } catch (error) {
    if (strictPreflight) {
      const fallbackText = compactTaskText(String(task?.originalMessage || task?.message || "").trim(), 180);
      return {
        ok: false,
        action: "clarify",
        question: fallbackText ? `What did you mean by "${fallbackText}"?` : "What did you mean by that request?",
        reason: error.message,
        optimizedMessage: String(task?.message || "").trim()
      };
    }
    return {
      ok: false,
      action: "skip",
      reason: error.message,
      optimizedMessage: String(task?.message || "").trim()
    };
  }
}

async function runIntakeWithOptionalRewrite({
  message = "",
  sessionId = "Main",
  internetEnabled = true,
  selectedMountIds = [],
  forceToolUse = false,
  sourceIdentity = null
} = {}) {
  const originalMessage = normalizeUserRequest(message);
  if (!originalMessage) {
    return {
      effectiveMessage: originalMessage,
      originalMessage,
      nativeResponse: null,
      intakePlan: null,
      rewrite: null
    };
  }
  const firstNativeResponse = await tryBuildObserverNativeResponse(originalMessage);
  if (firstNativeResponse) {
    return {
      effectiveMessage: originalMessage,
      originalMessage,
      nativeResponse: firstNativeResponse,
      intakePlan: null,
      rewrite: null
    };
  }

  const firstIntakePlan = await planIntakeWithBitNet({
    message: originalMessage,
    sessionId,
    internetEnabled,
    selectedMountIds,
    forceToolUse
  });
  if (firstIntakePlan.action === "reply_only") {
    return {
      effectiveMessage: originalMessage,
      originalMessage,
      nativeResponse: null,
      intakePlan: firstIntakePlan,
      rewrite: null
    };
  }

  const rewrite = await maybeRewritePromptWithIdleBrain({
    message: originalMessage,
    sessionId,
    source: sourceIdentity ? "voice" : "text"
  });
  const rewrittenMessage = normalizeUserRequest(String(rewrite?.message || originalMessage).trim()) || originalMessage;
  const rewriteApplied = Boolean(rewrite && rewrite.used === true && rewrittenMessage && rewrittenMessage !== originalMessage);
  if (!rewriteApplied) {
    return {
      effectiveMessage: originalMessage,
      originalMessage,
      nativeResponse: null,
      intakePlan: firstIntakePlan,
      rewrite
    };
  }

  const rewrittenNativeResponse = await tryBuildObserverNativeResponse(rewrittenMessage);
  if (rewrittenNativeResponse) {
    return {
      effectiveMessage: rewrittenMessage,
      originalMessage,
      nativeResponse: rewrittenNativeResponse,
      intakePlan: null,
      rewrite
    };
  }

  const secondIntakePlan = await planIntakeWithBitNet({
    message: rewrittenMessage,
    sessionId,
    internetEnabled,
    selectedMountIds,
    forceToolUse
  });
  return {
    effectiveMessage: rewrittenMessage,
    originalMessage,
    nativeResponse: null,
    intakePlan: secondIntakePlan,
    rewrite
  };
}
  return {
    chooseQuestionMaintenanceBrain,
    extractConcreteTaskFileTargets,
    maybeRewritePromptWithIdleBrain,
    runIntakeWithOptionalRewrite,
    runWorkerTaskPreflight,
    shouldBypassWorkerPreflight
  };
}
