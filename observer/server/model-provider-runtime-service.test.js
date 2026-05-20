import assert from "node:assert/strict";
import test from "node:test";
import { createOllamaRuntimeService } from "./ollama-runtime-service.js";

function createRuntime(overrides = {}) {
  return createOllamaRuntimeService({
    agentRunTimeoutMs: 1000,
    buildJsonRepairCandidates: (value) => [String(value || "")],
    buildLocalGroundedTaskLoopRepair: () => null,
    buildLocalRepeatedToolLoopRepair: () => null,
    buildTranscriptForPrompt: () => "",
    choosePlannerRepairBrain: async () => null,
    clearOllamaEndpointTransportFailure: () => {},
    collectBalancedJsonCandidates: (values) => values,
    defaultModelTemperature: 0.2,
    findBrainByIdExact: async () => null,
    formatOllamaTransportError: (error) => String(error?.message || error || "transport failed"),
    getBrain: async () => ({ id: "fallback", model: "fallback-model", ollamaBaseUrl: "http://127.0.0.1:11434" }),
    getBrainQueueLane: () => "",
    getProjectsRuntime: () => null,
    getRoutingConfig: () => ({}),
    isCpuQueueLane: () => false,
    isRetriableOllamaTransportError: () => false,
    localOllamaBaseUrl: "http://127.0.0.1:11434",
    markOllamaEndpointTransportFailure: () => {},
    maxModelTemperature: 0.4,
    modelKeepAlive: "",
    normalizeOllamaBaseUrl: (value = "") => (String(value || "http://127.0.0.1:11434").replace(/\/+$/, "")),
    normalizeWorkerDecisionEnvelope: (value) => value,
    ollamaEmptyResponseRetryCount: 0,
    ollamaSidecarLeaseWaitMs: 0,
    ollamaTransportRetryCount: 0,
    ollamaTransportRetryDelayMs: 0,
    parseFirstJsonCandidateFromList: () => ({ ok: false }),
    stripAnsi: (value = "") => String(value || ""),
    waitMs: async () => {},
    workerDecisionJsonSchema: { type: "object" },
    ...overrides
  });
}

test("OpenAI-compatible brains use chat completions instead of Ollama generate", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.TEST_PROVIDER_KEY;
  const requests = [];
  process.env.TEST_PROVIDER_KEY = "test-secret";
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: "{\"final\":true}" } }] };
      }
    };
  };

  try {
    const runtime = createRuntime({
      findBrainByIdExact: async (brainId) => ({
        id: brainId,
        provider: "openai-compatible",
        model: "gpt-test",
        baseUrl: "https://example.test/v1",
        ollamaBaseUrl: "https://example.test/v1",
        apiKeyEnv: "TEST_PROVIDER_KEY"
      })
    });
    const result = await runtime.runOllamaJsonGenerate("ignored-model", "Return JSON", {
      brainId: "openai-brain",
      format: { type: "object" }
    });

    assert.equal(result.ok, true);
    assert.equal(result.text, "{\"final\":true}");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://example.test/v1/chat/completions");
    assert.equal(requests[0].options.headers.authorization, "Bearer test-secret");
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.model, "ignored-model");
    assert.deepEqual(body.response_format, { type: "json_object" });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) {
      delete process.env.TEST_PROVIDER_KEY;
    } else {
      process.env.TEST_PROVIDER_KEY = previousKey;
    }
  }
});
