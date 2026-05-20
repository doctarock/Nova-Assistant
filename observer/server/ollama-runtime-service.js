export function createOllamaRuntimeService({
  agentRunTimeoutMs,
  buildJsonRepairCandidates,
  buildLocalGroundedTaskLoopRepair,
  buildLocalRepeatedToolLoopRepair,
  buildTranscriptForPrompt,
  choosePlannerRepairBrain,
  clearOllamaEndpointTransportFailure,
  collectBalancedJsonCandidates,
  defaultModelTemperature,
  findBrainByIdExact,
  formatOllamaTransportError,
  getBrain,
  getBrainQueueLane,
  getProjectsRuntime,
  getRoutingConfig,
  isCpuQueueLane,
  isRetriableOllamaTransportError,
  localOllamaBaseUrl,
  markOllamaEndpointTransportFailure,
  maxModelTemperature,
  modelKeepAlive,
  normalizeOllamaBaseUrl,
  normalizeWorkerDecisionEnvelope,
  ollamaEmptyResponseRetryCount,
  ollamaSidecarLeaseWaitMs,
  ollamaTransportRetryCount,
  ollamaTransportRetryDelayMs,
  parseFirstJsonCandidateFromList,
  stripAnsi,
  waitMs,
  workerDecisionJsonSchema
} = {}) {
  const leaseStateByResource = new Map();

  async function runOllamaPrompt(model, prompt, {
    timeoutMs = agentRunTimeoutMs,
    signal = null,
    baseUrl = localOllamaBaseUrl,
    provider = "",
    apiKeyEnv = "",
    images = [],
    brainId = "",
    laneHint = "",
    leaseOwnerId = "",
    leaseWaitMs = 0,
    leaseScope = "auto"
  } = {}) {
    return runOllamaJsonGenerate(model, prompt, {
      timeoutMs,
      keepAlive: modelKeepAlive,
      options: {},
      baseUrl,
      provider,
      apiKeyEnv,
      images,
      signal,
      brainId,
      laneHint,
      leaseOwnerId,
      leaseWaitMs,
      leaseScope,
      format: workerDecisionJsonSchema
    });
  }

  async function runOllamaJsonGenerate(model, prompt, {
    timeoutMs = agentRunTimeoutMs,
    keepAlive = "",
    options = {},
    baseUrl = localOllamaBaseUrl,
    provider = "",
    apiKeyEnv = "",
    images = [],
    signal = null,
    format = "json",
    brainId = "",
    laneHint = "",
    leaseOwnerId = "",
    leaseWaitMs = 0,
    leaseScope = "auto"
  } = {}) {
    return runOllamaGenerate(model, prompt, {
      timeoutMs,
      keepAlive,
      options,
      baseUrl,
      provider,
      apiKeyEnv,
      images,
      signal,
      format,
      brainId,
      laneHint,
      leaseOwnerId,
      leaseWaitMs,
      leaseScope
    });
  }

  function getLeaseState(resourceKey = "") {
    const key = String(resourceKey || "").trim();
    if (!key) {
      return null;
    }
    if (!leaseStateByResource.has(key)) {
      leaseStateByResource.set(key, {
        active: null,
        queue: []
      });
    }
    return leaseStateByResource.get(key);
  }

  function pruneLeaseState(resourceKey = "") {
    const key = String(resourceKey || "").trim();
    const state = key ? leaseStateByResource.get(key) : null;
    if (state && !state.active && !state.queue.length) {
      leaseStateByResource.delete(key);
    }
  }

  function removeQueuedLeaseWaiter(resourceKey = "", waiter = null) {
    const key = String(resourceKey || "").trim();
    const state = key ? leaseStateByResource.get(key) : null;
    if (!state || !waiter) {
      return;
    }
    const index = state.queue.indexOf(waiter);
    if (index >= 0) {
      state.queue.splice(index, 1);
    }
    pruneLeaseState(key);
  }

  function releaseLease(resourceKey = "", token = null) {
    const key = String(resourceKey || "").trim();
    const state = key ? leaseStateByResource.get(key) : null;
    if (!state || !token || state.active !== token) {
      return;
    }
    state.active = null;
    while (state.queue.length) {
      const nextWaiter = state.queue.shift();
      if (!nextWaiter || nextWaiter.settled) {
        continue;
      }
      nextWaiter.settled = true;
      if (typeof nextWaiter.cleanup === "function") {
        nextWaiter.cleanup();
      }
      state.active = nextWaiter.token;
      nextWaiter.resolve({
        ok: true,
        waitMs: Date.now() - Number(nextWaiter.enqueuedAt || Date.now()),
        queued: true,
        release: () => releaseLease(key, nextWaiter.token)
      });
      return;
    }
    pruneLeaseState(key);
  }

  async function resolveLeaseResourceKey({
    brainId = "",
    laneHint = "",
    baseUrl = localOllamaBaseUrl,
    leaseScope = "auto"
  } = {}) {
    const scope = String(leaseScope || "auto").trim().toLowerCase();
    if (scope === "none") {
      return "";
    }
    const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
    const normalizedLocalBaseUrl = normalizeOllamaBaseUrl(localOllamaBaseUrl);
    if (scope === "auto" && normalizedBaseUrl === normalizedLocalBaseUrl) {
      return `endpoint:${normalizedBaseUrl}`;
    }
    const explicitLane = String(laneHint || "").trim();
    if (scope !== "endpoint" && explicitLane) {
      return `lane:${explicitLane}`;
    }
    const targetBrainId = String(brainId || "").trim();
    if (scope !== "endpoint" && targetBrainId && typeof findBrainByIdExact === "function" && typeof getBrainQueueLane === "function") {
      try {
        const brain = await findBrainByIdExact(targetBrainId);
        const derivedLane = brain ? String(getBrainQueueLane(brain) || brain.queueLane || "").trim() : "";
        if (derivedLane) {
          return `lane:${derivedLane}`;
        }
      } catch {
        // Fall through to endpoint lease.
      }
    }
    return `endpoint:${normalizedBaseUrl}`;
  }

  async function acquireLease({
    resourceKey = "",
    ownerId = "",
    waitTimeoutMs = 0,
    signal = null
  } = {}) {
    const key = String(resourceKey || "").trim();
    if (!key) {
      return {
        ok: true,
        waitMs: 0,
        queued: false,
        release: () => {}
      };
    }
    const normalizedOwnerId = String(ownerId || "").trim();
    const state = getLeaseState(key);
    const activeOwnerId = String(state?.active?.ownerId || "").trim();
    if (normalizedOwnerId && activeOwnerId && activeOwnerId === normalizedOwnerId) {
      return {
        ok: false,
        busy: true,
        sameOwner: true,
        waitMs: 0
      };
    }
    if (!state.active) {
      const token = {
        id: Symbol(key),
        ownerId: normalizedOwnerId,
        acquiredAt: Date.now()
      };
      state.active = token;
      return {
        ok: true,
        waitMs: 0,
        queued: false,
        release: () => releaseLease(key, token)
      };
    }
    const waiter = {
      token: {
        id: Symbol(key),
        ownerId: normalizedOwnerId,
        acquiredAt: 0
      },
      enqueuedAt: Date.now(),
      settled: false,
      resolve: null,
      cleanup: null
    };
    return new Promise((resolve) => {
      let timeoutId = null;
      const onAbort = () => {
        if (waiter.settled) {
          return;
        }
        waiter.settled = true;
        waiter.cleanup?.();
        removeQueuedLeaseWaiter(key, waiter);
        resolve({
          ok: false,
          aborted: true,
          waitMs: Date.now() - waiter.enqueuedAt
        });
      };
      waiter.cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      };
      waiter.resolve = (value) => {
        waiter.token.acquiredAt = Date.now();
        resolve(value);
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      if (Number(waitTimeoutMs || 0) > 0) {
        timeoutId = setTimeout(() => {
          if (waiter.settled) {
            return;
          }
          waiter.settled = true;
          waiter.cleanup?.();
          removeQueuedLeaseWaiter(key, waiter);
          resolve({
            ok: false,
            busy: true,
            waitMs: Date.now() - waiter.enqueuedAt
          });
        }, Number(waitTimeoutMs));
      }
      state.queue.push(waiter);
    });
  }

  function normalizeGenerationOptions(options = {}) {
    const normalized = options && typeof options === "object" ? { ...options } : {};
    const requestedTemperature = Number(normalized.temperature);
    if (Number.isFinite(requestedTemperature)) {
      normalized.temperature = Math.min(Math.max(requestedTemperature, 0), maxModelTemperature);
    } else {
      normalized.temperature = defaultModelTemperature;
    }
    return normalized;
  }

  function normalizeProviderId(value = "") {
    const normalized = String(value || "ollama").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    if (["openai", "openai-compatible", "openrouter", "lmstudio", "vllm"].includes(normalized)) {
      return "openai-compatible";
    }
    return normalized || "ollama";
  }

  function normalizeProviderBaseUrl(value = "", provider = "ollama") {
    const raw = String(value || "").trim();
    if (!raw) {
      return normalizeProviderId(provider) === "ollama" ? localOllamaBaseUrl : "https://api.openai.com/v1";
    }
    return (/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, "");
  }

  async function resolveModelTarget({
    model = "",
    baseUrl = localOllamaBaseUrl,
    provider = "",
    apiKeyEnv = "",
    brainId = ""
  } = {}) {
    let brain = null;
    const targetBrainId = String(brainId || "").trim();
    if (targetBrainId && typeof findBrainByIdExact === "function") {
      try {
        brain = await findBrainByIdExact(targetBrainId);
      } catch {
        brain = null;
      }
    }
    const resolvedProvider = normalizeProviderId(provider || brain?.provider || "ollama");
    const requestedBaseUrl = String(baseUrl || "").trim();
    const brainBaseUrl = String(brain?.baseUrl || brain?.ollamaBaseUrl || "").trim();
    const resolvedBaseUrl = resolvedProvider !== "ollama"
      && brainBaseUrl
      && (!requestedBaseUrl || normalizeOllamaBaseUrl(requestedBaseUrl) === normalizeOllamaBaseUrl(localOllamaBaseUrl))
        ? brainBaseUrl
        : (requestedBaseUrl || brainBaseUrl);
    return {
      provider: resolvedProvider,
      model: String(model || brain?.model || "").trim(),
      baseUrl: normalizeProviderBaseUrl(resolvedBaseUrl, resolvedProvider),
      apiKeyEnv: String(apiKeyEnv || brain?.apiKeyEnv || "").trim()
    };
  }

  function resolveProviderApiKey({ provider = "", apiKeyEnv = "" } = {}) {
    const envName = String(apiKeyEnv || "").trim();
    if (envName && String(process.env[envName] || "").trim()) {
      return String(process.env[envName] || "").trim();
    }
    if (normalizeProviderId(provider) === "openai-compatible") {
      return String(process.env.OPENAI_API_KEY || "").trim();
    }
    return "";
  }

  async function runOpenAiCompatibleGenerate(model, prompt, {
    timeoutMs = agentRunTimeoutMs,
    options = {},
    baseUrl = "",
    signal = null,
    format = "",
    provider = "openai-compatible",
    apiKeyEnv = ""
  } = {}) {
    const normalizedOptions = normalizeGenerationOptions(options);
    const normalizedBaseUrl = normalizeProviderBaseUrl(baseUrl, provider);
    const controller = new AbortController();
    const abortExternal = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", abortExternal, { once: true });
      }
    }
    const timeout = Number(timeoutMs || 0) > 0
      ? setTimeout(() => controller.abort(), Number(timeoutMs))
      : null;
    try {
      const apiKey = resolveProviderApiKey({ provider, apiKeyEnv });
      const headers = { "content-type": "application/json" };
      if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
      }
      const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: String(prompt || "") }],
          temperature: normalizedOptions.temperature,
          stream: false,
          ...(format ? { response_format: { type: "json_object" } } : {})
        }),
        signal: controller.signal
      });
      let parsed = {};
      try {
        parsed = await response.json();
      } catch {
        parsed = {};
      }
      if (!response.ok) {
        return {
          ok: false,
          code: response.status,
          text: "",
          stderr: String(parsed?.error?.message || parsed?.error || `Provider API returned ${response.status}`),
          timedOut: false
        };
      }
      const responseText = stripAnsi(parsed?.choices?.[0]?.message?.content || parsed?.output_text || "");
      if (!responseText.trim()) {
        return {
          ok: false,
          code: 0,
          text: "",
          stderr: "empty model response",
          timedOut: false
        };
      }
      return {
        ok: true,
        code: response.status,
        text: responseText,
        stderr: "",
        timedOut: false
      };
    } catch (error) {
      const externallyAborted = Boolean(signal?.aborted);
      return {
        ok: false,
        code: error?.name === "AbortError" ? 124 : 0,
        text: "",
        stderr: error?.name === "AbortError"
          ? (externallyAborted ? "task aborted by user" : `Observer timeout after ${Math.round(Number(timeoutMs || 0) / 1000)}s`)
          : formatOllamaTransportError(error),
        timedOut: error?.name === "AbortError" && !externallyAborted
      };
    } finally {
      if (signal) {
        signal.removeEventListener("abort", abortExternal);
      }
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  async function runOllamaGenerate(model, prompt, {
    timeoutMs = agentRunTimeoutMs,
    keepAlive = "",
    options = {},
    baseUrl = localOllamaBaseUrl,
    provider = "",
    apiKeyEnv = "",
    images = [],
    signal = null,
    format = "",
    brainId = "",
    laneHint = "",
    leaseOwnerId = "",
    leaseWaitMs = 0,
    leaseScope = "auto"
  } = {}) {
    const target = await resolveModelTarget({ model, baseUrl, provider, apiKeyEnv, brainId });
    if (target.provider !== "ollama") {
      return runOpenAiCompatibleGenerate(target.model || model, prompt, {
        timeoutMs,
        options,
        baseUrl: target.baseUrl,
        signal,
        format,
        provider: target.provider,
        apiKeyEnv: target.apiKeyEnv
      });
    }
    const normalizedOptions = normalizeGenerationOptions(options);
    const normalizedBaseUrl = normalizeOllamaBaseUrl(target.baseUrl || baseUrl);
    const resourceKey = await resolveLeaseResourceKey({
      brainId,
      laneHint,
      baseUrl: normalizedBaseUrl,
      leaseScope
    });
    const controller = new AbortController();
    const abortExternal = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", abortExternal, { once: true });
      }
    }
    const timeout = Number(timeoutMs || 0) > 0
      ? setTimeout(() => controller.abort(), Number(timeoutMs))
      : null;
    const lease = await acquireLease({
      resourceKey,
      ownerId: leaseOwnerId,
      waitTimeoutMs: Number(leaseWaitMs || 0),
      signal: controller.signal
    });
    if (!lease.ok) {
      const externallyAborted = Boolean(signal?.aborted);
      const resourceLabel = String(resourceKey || normalizedBaseUrl).replace(/^lane:/, "").replace(/^endpoint:/, "");
      if (signal) {
        signal.removeEventListener("abort", abortExternal);
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      if (lease.aborted) {
        return {
          ok: false,
          code: 124,
          text: "",
          stderr: externallyAborted ? "task aborted by user" : `Observer timeout after ${Math.round(Number(timeoutMs || 0) / 1000)}s`,
          timedOut: !externallyAborted,
          busy: false,
          resourceKey,
          leaseWaitMs: Number(lease.waitMs || 0)
        };
      }
      return {
        ok: false,
        code: 0,
        text: "",
        stderr: lease.sameOwner
          ? `Ollama resource ${resourceLabel} is already busy with this task`
          : `Ollama resource ${resourceLabel} is busy`,
        timedOut: false,
        busy: true,
        resourceKey,
        leaseWaitMs: Number(lease.waitMs || 0)
      };
    }
    try {
      for (let attempt = 0; attempt <= ollamaTransportRetryCount; attempt += 1) {
        try {
          const response = await fetch(`${normalizedBaseUrl}/api/generate`, {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              model: target.model || model,
              prompt,
              stream: false,
              think: false,
              ...(format ? { format } : {}),
              ...(keepAlive ? { keep_alive: keepAlive } : {}),
              ...(Array.isArray(images) && images.length ? { images } : {}),
              options: normalizedOptions
            }),
            signal: controller.signal
          });
          let parsed = {};
          try {
            parsed = await response.json();
          } catch {
            parsed = {};
          }
          if (!response.ok) {
            return {
              ok: false,
              code: response.status,
              text: "",
              stderr: String(parsed?.error || `Ollama API returned ${response.status}`),
              timedOut: false
            };
          }
          const responseText = stripAnsi(parsed.response || "");
          if (!responseText.trim()) {
            const thinkingText = stripAnsi(parsed.thinking || parsed.message?.content || "");
            if (attempt < ollamaEmptyResponseRetryCount) {
              await waitMs(ollamaTransportRetryDelayMs * (attempt + 1));
              continue;
            }
            return {
              ok: false,
              code: 0,
              text: "",
              stderr: thinkingText.trim()
                ? "empty model response (thinking-only output)"
                : "empty model response",
              timedOut: false
            };
          }
          clearOllamaEndpointTransportFailure(normalizedBaseUrl);
          return {
            ok: true,
            code: response.status,
            text: responseText,
            stderr: "",
            timedOut: false
          };
        } catch (error) {
          if (error?.name === "AbortError") {
            throw error;
          }
          const retriable = isRetriableOllamaTransportError(error);
          if (retriable && attempt < ollamaTransportRetryCount) {
            await waitMs(ollamaTransportRetryDelayMs * (attempt + 1));
            continue;
          }
          markOllamaEndpointTransportFailure(normalizedBaseUrl, error);
          return {
            ok: false,
            code: 0,
            text: "",
            stderr: formatOllamaTransportError(error),
            timedOut: false
          };
        }
      }
      return {
        ok: false,
        code: 0,
        text: "",
        stderr: "failed to reach Ollama API",
        timedOut: false
      };
    } catch (error) {
      const externallyAborted = Boolean(signal?.aborted);
      return {
        ok: false,
        code: error?.name === "AbortError" ? 124 : 0,
        text: "",
        stderr: error?.name === "AbortError"
          ? (externallyAborted ? "task aborted by user" : `Observer timeout after ${Math.round(Number(timeoutMs || 0) / 1000)}s`)
          : formatOllamaTransportError(error),
        timedOut: error?.name === "AbortError" && !externallyAborted
      };
    } finally {
      if (signal) {
        signal.removeEventListener("abort", abortExternal);
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      lease.release();
    }
  }

  function extractJsonObject(text = "") {
    const raw = String(text || "")
      .replace(/<\/?think>/gi, "\n")
      .trim();
    if (!raw) {
      throw new Error("empty model response");
    }
    const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
    const candidate = fencedMatch ? fencedMatch[1].trim() : raw;
    const errors = [];
    const directCandidates = buildJsonRepairCandidates(candidate);
    const directParsed = parseFirstJsonCandidateFromList(directCandidates, errors);
    if (directParsed.ok) {
      return directParsed.value;
    }
    const balancedCandidates = collectBalancedJsonCandidates(directCandidates);
    if (!balancedCandidates.length) {
      throw new Error("model did not return JSON");
    }
    const balancedParsed = parseFirstJsonCandidateFromList(balancedCandidates, errors);
    if (balancedParsed.ok) {
      return balancedParsed.value;
    }
    throw errors[errors.length - 1] || new Error("model did not return JSON");
  }

  async function retryJsonEnvelope(model, rawText, schemaHint, {
    timeoutMs = 45000,
    options = undefined,
    baseUrl = localOllamaBaseUrl,
    provider = "",
    apiKeyEnv = "",
    brainId = "",
    leaseOwnerId = "",
    leaseWaitMs = ollamaSidecarLeaseWaitMs
  } = {}) {
    const repairPrompt = [
      "Rewrite the previous response as one JSON object only.",
      "Return JSON only. No markdown fences. No explanation outside JSON.",
      schemaHint,
      "If the previous response was prose, place it in assistant_message and final_text, with tool_calls as [].",
      "If the previous response implies tool use, convert it into valid OpenAI-style tool_calls.",
      "Never return a top-level role=tool or tool_results object; convert tool echoes into a valid assistant envelope.",
      "Do not wrap the real envelope inside assistant_message, final_text, or any other string field.",
      "If the previous response already contains a JSON envelope inside a quoted string, extract that envelope and return it as the top-level object.",
      "",
      "Previous response:",
      String(rawText || "").slice(0, 12000)
    ].join("\n");
    const retry = await runOllamaJsonGenerate(model, repairPrompt, {
      timeoutMs,
      keepAlive: modelKeepAlive,
      options,
      baseUrl,
      provider,
      apiKeyEnv,
      brainId,
      leaseOwnerId,
      leaseWaitMs,
      format: workerDecisionJsonSchema
    });
    if (!retry.ok) {
      return { ok: false, text: "", error: retry.stderr || "JSON retry failed" };
    }
    return { ok: true, text: retry.text || "", error: "" };
  }

  async function debugJsonEnvelopeWithPlanner({
    model,
    rawText,
    parseError,
    schemaHint,
    baseUrl = localOllamaBaseUrl,
    provider = "",
    apiKeyEnv = "",
    leaseOwnerId = ""
  } = {}) {
    const routing = getRoutingConfig();
    const plannerIdCandidates = [
      String(routing.remoteTriageBrainId || "").trim(),
      "toolrouter"
    ].filter(Boolean);
    const plannerBrain = await choosePlannerRepairBrain(plannerIdCandidates, {
      preferRemote: normalizeOllamaBaseUrl(baseUrl) !== localOllamaBaseUrl
    });
    const debugBrain = plannerBrain?.id
      ? plannerBrain
      : {
          model,
          ollamaBaseUrl: baseUrl
        };
    const debugPrompt = [
      "You are repairing a malformed worker JSON envelope for Nova.",
      "Return one valid JSON object only. No prose, no markdown, no code fences.",
      schemaHint,
      "Repair the structure conservatively. Preserve the original intent.",
      "If the content implies tool use, return valid OpenAI-style tool_calls.",
      "If it is only prose, put it in assistant_message and final_text with tool_calls as [].",
      "Never return a top-level role=tool or tool_results object; convert tool echoes into a valid assistant envelope.",
      "Do not leave the actual envelope nested inside assistant_message, final_text, or another quoted field.",
      "If the malformed response contains a JSON envelope inside a string, extract it and return it as the top-level object.",
      `Parse error: ${String(parseError || "unknown parse error").trim()}`,
      "",
      "Malformed response:",
      String(rawText || "").slice(0, 12000)
    ].join("\n");
    const repaired = await runOllamaJsonGenerate(debugBrain.model, debugPrompt, {
      timeoutMs: 30000,
      keepAlive: modelKeepAlive,
      baseUrl: debugBrain.ollamaBaseUrl || baseUrl,
      provider: debugBrain.provider || provider,
      apiKeyEnv: debugBrain.apiKeyEnv || apiKeyEnv,
      brainId: plannerBrain?.id || "",
      leaseOwnerId,
      leaseWaitMs: ollamaSidecarLeaseWaitMs,
      format: workerDecisionJsonSchema
    });
    if (!repaired.ok) {
      return { ok: false, text: "", error: repaired.stderr || "planner JSON repair failed", plannerBrainId: plannerBrain?.id || "" };
    }
    return { ok: true, text: repaired.text || "", error: "", plannerBrainId: plannerBrain?.id || "" };
  }

  async function replanRepeatedToolLoopWithPlanner({
    message,
    transcript = [],
    repeatedToolCallSignature = "",
    executedTools = [],
    inspectedTargets = [],
    baseUrl = localOllamaBaseUrl,
    provider = "",
    apiKeyEnv = "",
    leaseOwnerId = ""
  } = {}) {
    const localRepair = buildLocalRepeatedToolLoopRepair({
      message,
      repeatedToolCallSignature,
      inspectedTargets
    });
    if (localRepair) {
      return localRepair;
    }
    const localGroundedRepair = buildLocalGroundedTaskLoopRepair({
      message,
      repeatedToolCallSignature,
      inspectedTargets
    });
    if (localGroundedRepair) {
      return localGroundedRepair;
    }
    const routing = getRoutingConfig();
    const plannerIdCandidates = [
      String(routing.remoteTriageBrainId || "").trim(),
      "helper",
      "toolrouter"
    ].filter(Boolean);
    const plannerBrain = await choosePlannerRepairBrain(plannerIdCandidates, {
      preferRemote: normalizeOllamaBaseUrl(baseUrl) !== localOllamaBaseUrl
    });
    const debugBrain = plannerBrain?.id
      ? plannerBrain
      : await getBrain("bitnet");
    const projectsRuntime = getProjectsRuntime();
    const inspectFirstTarget = projectsRuntime?.extractTaskDirectiveValue?.(message, "Inspect first:");
    const inspectSecondTarget = projectsRuntime?.extractTaskDirectiveValue?.(message, "Inspect second if needed:");
    const inspectThirdTarget = projectsRuntime?.extractTaskDirectiveValue?.(message, "Inspect third if needed:");
    const prompt = [
      "You are Nova's tool-plan repair helper.",
      "Return one valid JSON object only. No prose, no markdown, no code fences.",
      "Use exactly this schema:",
      "{\"assistant_message\":\"...\",\"tool_calls\":[{\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"tool_name\",\"arguments\":\"{\\\"key\\\":\\\"value\\\"}\"}}],\"final\":false}",
      "Choose exactly one next move.",
      "Do not repeat the same tool call with the same arguments.",
      "Prefer a concrete inspection or execution step that advances the task immediately.",
      "If the repeated plan was reading a planning file again, switch to a concrete implementation file or directory.",
      "If the task already required PROJECT-TODO.md, PROJECT-ROLE-TASKS.md, and a named concrete file, treat that startup bundle as already done and advance to the next concrete target or edit step instead of repeating it.",
      "Recent transcript:",
      buildTranscriptForPrompt(transcript.slice(-5)),
      "",
      `User request: ${String(message || "").trim()}`,
      `Repeated tool signature: ${String(repeatedToolCallSignature || "").trim()}`,
      `Tools already executed: ${(Array.isArray(executedTools) ? executedTools.join(", ") : "") || "none"}`,
      `Inspected targets: ${(Array.isArray(inspectedTargets) ? inspectedTargets.join(", ") : "") || "none"}`,
      `Inspect first target: ${inspectFirstTarget || "none"}`,
      `Inspect second target: ${inspectSecondTarget || "none"}`,
      `Inspect third target: ${inspectThirdTarget || "none"}`
    ].join("\n");
    const repaired = await runOllamaJsonGenerate(debugBrain.model, prompt, {
      timeoutMs: 45000,
      keepAlive: modelKeepAlive,
      baseUrl: debugBrain.ollamaBaseUrl || baseUrl,
      provider: debugBrain.provider || provider,
      apiKeyEnv: debugBrain.apiKeyEnv || apiKeyEnv,
      brainId: plannerBrain?.id || "",
      leaseOwnerId,
      leaseWaitMs: ollamaSidecarLeaseWaitMs,
      options: plannerBrain && isCpuQueueLane(plannerBrain) ? { num_gpu: 0 } : undefined,
      format: workerDecisionJsonSchema
    });
    if (!repaired.ok) {
      return { ok: false, decision: null, error: repaired.stderr || "planner tool-loop repair failed", plannerBrainId: plannerBrain?.id || "" };
    }
    try {
      const decision = normalizeWorkerDecisionEnvelope(extractJsonObject(repaired.text));
      const toolCalls = Array.isArray(decision?.tool_calls) ? decision.tool_calls : [];
      if (decision?.final || !toolCalls.length) {
        return { ok: false, decision: null, error: "planner did not return a replacement tool plan", plannerBrainId: plannerBrain?.id || "" };
      }
      return { ok: true, decision, error: "", plannerBrainId: plannerBrain?.id || "" };
    } catch (error) {
      return { ok: false, decision: null, error: error.message || "planner tool-loop repair parse failed", plannerBrainId: plannerBrain?.id || "" };
    }
  }

  return {
    debugJsonEnvelopeWithPlanner,
    extractJsonObject,
    replanRepeatedToolLoopWithPlanner,
    retryJsonEnvelope,
    runOllamaGenerate,
    runOllamaJsonGenerate,
    runOllamaPrompt
  };
}
