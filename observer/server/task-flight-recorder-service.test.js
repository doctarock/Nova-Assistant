import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTaskFlightRecorderService } from "./task-flight-recorder-service.js";

async function createRecorder() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-flight-"));
  const events = [];
  const recorder = createTaskFlightRecorderService({
    compactTaskText: (value = "", max = 260) => String(value || "").slice(0, max),
    emitCoreEvent: async (event) => {
      events.push(event);
      return { ...event, eventSeq: events.length };
    },
    fs,
    listTransactionsForTask: async () => [{ id: "txn-1", status: "applied" }],
    pathModule: path,
    readTaskHistory: async () => [{ eventSeq: 1, type: "task.started" }],
    root
  });
  return { root, events, recorder };
}

test("flight recorder builds debug packets and validates provider/tool correlation", async () => {
  const { root, events, recorder } = await createRecorder();
  await recorder.appendProviderHistory("task-1", {
    provider: "ollama",
    model: "model-a",
    brainId: "worker",
    step: 1,
    ok: true,
    rawText: "{\"tool_calls\":[]}",
    providerState: { responseId: "resp-1" }
  });
  await recorder.appendProviderHistory("task-1", {
    provider: "observer-normalized",
    model: "model-a",
    brainId: "worker",
    step: 1,
    ok: true,
    normalizedDecision: {
      tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: "{}" } }]
    }
  });
  await recorder.appendToolStep("task-1", {
    step: 1,
    toolCallId: "call-1",
    name: "read_file",
    transportOk: true,
    semanticOk: true,
    resultPreview: "ok"
  });

  const validation = await recorder.validateProviderHistory("task-1");
  assert.equal(validation.ok, true);
  assert.equal(validation.providerRecordCount, 1);
  assert.equal(validation.toolStepCount, 1);
  assert.equal(validation.summary.continuation.sameProviderResumeAvailable, true);

  const packet = await recorder.buildDebugPacket("task-1");
  assert.equal(packet.ok, true);
  assert.equal(packet.timeline.length, 1);
  assert.equal(packet.providerHistory.length, 2);
  assert.equal(packet.toolSteps.length, 1);
  assert.equal(packet.transactions.length, 1);
  assert.ok(events.some((event) => event.type === "provider.history_saved"));
  assert.ok(events.some((event) => event.type === "tool.step_recorded"));
  await fs.rm(root, { recursive: true, force: true });
});

test("flight recorder validation catches missing tool result records", async () => {
  const { root, recorder } = await createRecorder();
  await recorder.appendProviderHistory("task-2", {
    provider: "ollama",
    model: "model-a",
    step: 1,
    ok: true
  });
  await recorder.appendProviderHistory("task-2", {
    provider: "observer-normalized",
    model: "model-a",
    step: 1,
    ok: true,
    normalizedDecision: {
      tool_calls: [{ id: "missing-call", function: { name: "read_file", arguments: "{}" } }]
    }
  });
  const validation = await recorder.validateProviderHistory("task-2");
  assert.equal(validation.ok, false);
  assert.match(validation.failures.join("\n"), /missing-call/);
  await fs.rm(root, { recursive: true, force: true });
});

test("flight recorder records read basis entries and includes them in debug packet", async () => {
  const { root, recorder } = await createRecorder();
  await recorder.appendReadBasis("task-3", {
    toolCallId: "call-read-1",
    path: "/workspace/src/app.js",
    scope: "container_workspace",
    size: 1024,
    hash: "abc123",
    source: "read_file"
  });
  await recorder.appendReadBasis("task-3", {
    toolCallId: "call-read-2",
    path: "/workspace/src/utils.js",
    scope: "container_workspace",
    size: 512,
    source: "read_file"
  });
  const packet = await recorder.buildDebugPacket("task-3");
  assert.equal(packet.ok, true);
  assert.equal(packet.readBasis.length, 2);
  assert.equal(packet.readBasis[0].path, "/workspace/src/app.js");
  assert.equal(packet.readBasis[0].hash, "abc123");
  assert.equal(packet.readBasis[1].path, "/workspace/src/utils.js");
  await fs.rm(root, { recursive: true, force: true });
});

test("flight recorder patchProviderSummary merges run-end outcome into existing summary", async () => {
  const { root, recorder } = await createRecorder();
  await recorder.appendProviderHistory("task-4", {
    provider: "ollama",
    model: "model-a",
    brainId: "worker",
    step: 1,
    ok: true,
    providerState: { responseId: "resp-1" }
  });
  const before = await recorder.readProviderSummary("task-4");
  assert.equal(before.provider, "ollama");
  assert.equal(before.continuation.sameProviderResumeAvailable, true);
  await recorder.patchProviderSummary("task-4", {
    lastRunOutcome: "completed",
    lastRunStopReason: "",
    lastRunAt: Date.now()
  });
  const after = await recorder.readProviderSummary("task-4");
  assert.equal(after.provider, "ollama");
  assert.equal(after.continuation.sameProviderResumeAvailable, true);
  assert.equal(after.lastRunOutcome, "completed");
  await fs.rm(root, { recursive: true, force: true });
});

test("buildTaskResumeSummary returns null for tasks with no history and a text summary for tasks with prior work", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-flight-resume-"));
  const emptyRecorder = createTaskFlightRecorderService({
    compactTaskText: (value = "", max = 260) => String(value || "").slice(0, max),
    emitCoreEvent: async (event) => ({ ...event, eventSeq: 1 }),
    fs,
    listTransactionsForTask: async () => [],
    pathModule: path,
    readTaskHistory: async () => [],
    root
  });
  const empty = await emptyRecorder.buildTaskResumeSummary("task-5-empty");
  assert.equal(empty, null);

  const { recorder } = await createRecorder();
  await recorder.appendToolStep("task-5", {
    step: 1,
    toolCallId: "call-a",
    name: "read_file",
    transportOk: true,
    semanticOk: true
  });
  await recorder.appendToolStep("task-5", {
    step: 2,
    toolCallId: "call-b",
    name: "edit_file",
    transportOk: true,
    semanticOk: true
  });
  await recorder.appendReadBasis("task-5", {
    toolCallId: "call-a",
    path: "/workspace/src/app.js",
    scope: "container_workspace",
    size: 512,
    source: "read_file"
  });
  await recorder.patchProviderSummary("task-5", { lastRunOutcome: "waiting_for_user" });

  const summary = await recorder.buildTaskResumeSummary("task-5");
  assert.ok(typeof summary === "string" && summary.length > 0, "expected a non-empty summary");
  assert.ok(summary.includes("waiting_for_user"), "expected last run outcome in summary");
  assert.ok(summary.includes("read_file"), "expected tool step name in summary");
  assert.ok(summary.includes("/workspace/src/app.js"), "expected read file path in summary");
  await fs.rm(root, { recursive: true, force: true });
});
