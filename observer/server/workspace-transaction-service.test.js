import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkspaceTransactionService } from "./workspace-transaction-service.js";

function createMemoryContainer() {
  const files = new Map();
  const read = async (target) => {
    if (!files.has(target)) {
      const error = new Error(`ENOENT: ${target}`);
      error.code = "ENOENT";
      throw error;
    }
    return files.get(target);
  };
  return {
    files,
    async readContainerFileBuffer(target) {
      const content = await read(target);
      return {
        path: target,
        size: Buffer.byteLength(content, "utf8"),
        contentBase64: Buffer.from(content, "utf8").toString("base64")
      };
    },
    async writeContainerTextFile(target, content, { append = false } = {}) {
      const previous = files.get(target) || "";
      files.set(target, append ? `${previous}${content}` : String(content || ""));
      return { path: target, bytes: Buffer.byteLength(files.get(target) || "", "utf8"), append };
    },
    async editContainerTextFile(target, { oldText = "", newText = "", expectedReplacements = null } = {}) {
      const previous = await read(target);
      const count = previous.split(oldText).length - 1;
      if (count < 1) throw new Error(`oldText not found in ${target}`);
      if (expectedReplacements != null && count !== Number(expectedReplacements)) {
        throw new Error(`expected ${expectedReplacements} replacement(s) but found ${count}`);
      }
      files.set(target, previous.replace(oldText, newText));
      return { path: target, replacements: 1 };
    },
    async moveContainerPath(from, to) {
      const content = await read(from);
      files.set(to, content);
      files.delete(from);
      return { from, to };
    }
  };
}

async function createService(container) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-txn-"));
  const service = createWorkspaceTransactionService({
    compactTaskText: (value = "") => String(value || "").slice(0, 260),
    editContainerTextFile: container.editContainerTextFile,
    fs,
    moveContainerPath: container.moveContainerPath,
    pathModule: path,
    readContainerFileBuffer: container.readContainerFileBuffer,
    resolveToolPath: (value = "") => String(value || "").trim(),
    transactionRoot: root,
    writeContainerTextFile: container.writeContainerTextFile
  });
  return { root, service };
}

test("write_file records an applied transaction with checkpoint and before/after metadata", async () => {
  const container = createMemoryContainer();
  container.files.set("/workspace/app.js", "old");
  const { root, service } = await createService(container);

  const result = await service.transactWriteFile(
    { path: "/workspace/app.js", content: "new" },
    { taskContext: { taskId: "task-1" }, toolCallId: "call-1" }
  );

  assert.equal(container.files.get("/workspace/app.js"), "new");
  assert.match(result.transactionId, /^txn-/);
  assert.equal(result.transaction.status, "applied");
  assert.equal(result.transaction.taskId, "task-1");
  assert.equal(result.transaction.readBasis.hash.length, 64);
  assert.equal(result.transaction.applyResult.before.hash.length, 64);
  assert.equal(result.transaction.applyResult.after.hash.length, 64);
  const checkpoint = await fs.readFile(result.transaction.checkpoint.beforeContentPath, "utf8");
  assert.equal(checkpoint, "old");
  const records = await service.listTransactionsForTask("task-1");
  assert.equal(records.length, 1);
  assert.equal(records[0].id, result.transactionId);
  await fs.rm(root, { recursive: true, force: true });
});

test("edit_file classifies replacement count mismatch before apply", async () => {
  const container = createMemoryContainer();
  container.files.set("/workspace/app.js", "same same");
  const { root, service } = await createService(container);

  await assert.rejects(
    service.transactEditFile({ path: "/workspace/app.js", oldText: "same", newText: "next", replaceAll: true, expectedReplacements: 1 }),
    /expected 1 replacement/
  );
  assert.equal(container.files.get("/workspace/app.js"), "same same");
  const records = await service.listTransactionsForTask("");
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "failed");
  assert.equal(records[0].failure.class, "replacement_count_mismatch");
  await fs.rm(root, { recursive: true, force: true });
});

test("edit_file fails with stale_context when the target changes after proposal", async () => {
  const container = createMemoryContainer();
  container.files.set("/workspace/app.js", "before");
  let readCount = 0;
  const originalRead = container.readContainerFileBuffer;
  container.readContainerFileBuffer = async (target) => {
    readCount += 1;
    const result = await originalRead(target);
    if (readCount === 1) {
      container.files.set(target, "changed outside");
    }
    return result;
  };
  const { root, service } = await createService(container);

  await assert.rejects(
    service.transactEditFile({ path: "/workspace/app.js", oldText: "before", newText: "after" }),
    /Target changed before edit apply/
  );
  assert.equal(container.files.get("/workspace/app.js"), "changed outside");
  const records = await service.listTransactionsForTask("");
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "failed");
  assert.equal(records[0].failure.class, "stale_context");
  await fs.rm(root, { recursive: true, force: true });
});

test("rollback restores checkpoint only when the target still matches applied state", async () => {
  const container = createMemoryContainer();
  container.files.set("/workspace/app.js", "old");
  const { root, service } = await createService(container);

  const result = await service.transactWriteFile({ path: "/workspace/app.js", content: "new" });
  const rolledBack = await service.rollbackTransaction(result.transactionId);

  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(container.files.get("/workspace/app.js"), "old");

  const second = await service.transactWriteFile({ path: "/workspace/app.js", content: "newer" });
  container.files.set("/workspace/app.js", "external");
  await assert.rejects(
    service.rollbackTransaction(second.transactionId),
    /Target changed after transaction apply/
  );
  assert.equal(container.files.get("/workspace/app.js"), "external");
  const failed = await service.readTransaction(second.transactionId);
  assert.equal(failed.status, "rollback_failed");
  assert.equal(failed.failure.class, "rollback_target_changed");
  await fs.rm(root, { recursive: true, force: true });
});

test("external host edit transactions support approval and rejection state", async () => {
  const container = createMemoryContainer();
  const { root, service } = await createService(container);

  const proposed = await service.proposeExternalEditTransaction({
    adapter: "vscode",
    requestId: "edit-1",
    sessionId: "session-1",
    path: "C:/repo/README.md",
    oldText: "Old",
    newText: "New"
  }, { taskContext: { taskId: "task-host" } });

  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.target.scope, "host_workspace");
  assert.equal(proposed.approval.status, "pending");

  const approved = await service.approveTransaction(proposed.id, { actor: "user", notes: "Looks good" });
  assert.equal(approved.status, "approved");
  assert.equal(approved.approval.status, "approved");

  const rejectedBase = await service.proposeExternalEditTransaction({
    adapter: "vscode",
    requestId: "edit-2",
    sessionId: "session-1",
    path: "C:/repo/README.md",
    oldText: "Old",
    newText: "Bad"
  }, { taskContext: { taskId: "task-host" } });
  const rejected = await service.rejectTransaction(rejectedBase.id, { actor: "user", reason: "No thanks" });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.failure.class, "approval_rejected");
  await fs.rm(root, { recursive: true, force: true });
});

test("external side-effect transactions record compensation plans", async () => {
  const container = createMemoryContainer();
  const { root, service } = await createService(container);
  const proposed = await service.proposeExternalSideEffectTransaction({
    pluginId: "mail",
    domain: "mail",
    operation: "send_email",
    target: "user@example.com",
    summary: "Send follow-up email",
    irreversible: true,
    compensationPlan: "Send a correction email if needed.",
    payload: { subject: "Hello" }
  }, { taskContext: { taskId: "task-mail" } });

  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.target.scope, "external_service");
  assert.equal(proposed.external.irreversible, true);
  assert.match(proposed.external.compensationPlan, /correction email/);
  assert.equal(proposed.risk.requiresApproval, true);
  await fs.rm(root, { recursive: true, force: true });
});

test("high-risk write pauses for approval and applyApprovedTransaction executes the write", async () => {
  const container = createMemoryContainer();
  container.files.set("/workspace/.env", "SECRET=old");
  const { root, service } = await createService(container);

  const result = await service.transactWriteFile(
    { path: "/workspace/.env", content: "SECRET=new" },
    { taskContext: { taskId: "task-env" }, toolCallId: "call-env" }
  );
  assert.equal(result.pendingApproval, true);
  assert.match(result.transactionId, /^txn-/);
  assert.equal(result.transaction.status, "proposed");
  assert.equal(container.files.get("/workspace/.env"), "SECRET=old", "file unchanged before approval");

  await service.approveTransaction(result.transactionId, { actor: "user" });
  const applied = await service.applyApprovedTransaction(result.transactionId);
  assert.equal(applied.transaction.status, "applied");
  assert.equal(container.files.get("/workspace/.env"), "SECRET=new", "file updated after apply");
  const checkpoint = await fs.readFile(applied.transaction.checkpoint.beforeContentPath, "utf8");
  assert.equal(checkpoint, "SECRET=old");
  await fs.rm(root, { recursive: true, force: true });
});

test("applyApprovedTransaction rejects stale write_file when file changed after proposal", async () => {
  const container = createMemoryContainer();
  container.files.set("/workspace/.env", "SECRET=old");
  const { root, service } = await createService(container);

  const result = await service.transactWriteFile(
    { path: "/workspace/.env", content: "SECRET=new" },
    { taskContext: { taskId: "task-stale" }, toolCallId: "call-stale" }
  );
  assert.equal(result.pendingApproval, true);

  container.files.set("/workspace/.env", "SECRET=changed-externally");
  await service.approveTransaction(result.transactionId, { actor: "user" });

  await assert.rejects(
    service.applyApprovedTransaction(result.transactionId),
    /Target changed since transaction was proposed/
  );
  assert.equal(container.files.get("/workspace/.env"), "SECRET=changed-externally", "external change preserved");
  const record = await service.readTransaction(result.transactionId);
  assert.equal(record.status, "failed");
  assert.equal(record.failure.class, "stale_context");
  await fs.rm(root, { recursive: true, force: true });
});

test("validateReadBasis detects fresh, changed, and missing files correctly", async () => {
  const container = createMemoryContainer();
  const { root, service } = await createService(container);
  container.files.set("/workspace/src/app.js", "const x = 1;");
  const fresh = await service.validateReadBasis("/workspace/src/app.js", "");
  assert.equal(fresh.valid, true);
  assert.equal(fresh.staleness, "no_basis");
  assert.ok(fresh.currentHash.length > 0);

  const firstHash = fresh.currentHash;
  const freshWithHash = await service.validateReadBasis("/workspace/src/app.js", firstHash);
  assert.equal(freshWithHash.valid, true);
  assert.equal(freshWithHash.staleness, "fresh");

  container.files.set("/workspace/src/app.js", "const x = 2;");
  const stale = await service.validateReadBasis("/workspace/src/app.js", firstHash);
  assert.equal(stale.valid, false);
  assert.equal(stale.staleness, "changed");
  assert.notEqual(stale.currentHash, firstHash);

  const missing = await service.validateReadBasis("/workspace/src/missing.js", firstHash);
  assert.equal(missing.valid, false);
  assert.equal(missing.staleness, "not_found");
  await fs.rm(root, { recursive: true, force: true });
});
