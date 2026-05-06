import crypto from "crypto";

export function createWorkspaceTransactionService(options = {}) {
  const {
    compactTaskText = (value = "") => String(value || ""),
    editContainerTextFile = async () => ({}),
    emitCoreEvent = async () => null,
    fs = null,
    moveContainerPath = async () => ({}),
    pathModule = null,
    readContainerFileBuffer = async () => ({ contentBase64: "", size: 0 }),
    resolveToolPath = (value = "") => String(value || ""),
    transactionRoot = "",
    writeContainerTextFile = async () => ({})
  } = options;

  const TRANSACTION_SCHEMA_VERSION = 1;

  function sha256(value = "") {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  function makeTransactionId(operation = "edit") {
    return `txn-${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${String(operation || "edit").replace(/[^a-z0-9_-]/gi, "")}`;
  }

  function transactionPath(id = "") {
    return pathModule.join(transactionRoot, "transactions", `${id}.json`);
  }

  function checkpointPath(transactionId = "", name = "before.txt") {
    return pathModule.join(transactionRoot, "checkpoints", transactionId, name);
  }

  function normalizeTaskContext(context = {}) {
    const taskContext = context?.taskContext && typeof context.taskContext === "object" ? context.taskContext : {};
    return {
      taskId: String(taskContext.taskId || context.taskId || "").trim(),
      sessionId: String(taskContext.sessionId || context.sessionId || "").trim(),
      toolCallId: String(context.toolCallId || context.callId || "").trim()
    };
  }

  function classifyRisk({ operation = "", target = "", append = false, overwrite = false } = {}) {
    const lower = String(target || "").toLowerCase();
    const reasons = [];
    let level = "low";
    if (operation === "move_path") {
      level = "normal";
      reasons.push("move");
    }
    if (append) {
      reasons.push("append");
    }
    if (overwrite) {
      level = "high";
      reasons.push("overwrite");
    }
    if (/(^|\/)(\.env|\.npmrc|\.pypirc|id_rsa|id_ed25519)(\/|$)/i.test(lower) || /secret|credential|token|password/i.test(lower)) {
      level = "high";
      reasons.push("secrets_or_credentials");
    }
    if (/(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|dockerfile|docker-compose\.ya?ml)(\/|$)/i.test(lower)) {
      if (level === "low") level = "normal";
      reasons.push("package_or_deploy_file");
    }
    return {
      level,
      reasons,
      requiresApproval: level === "high",
      requiresCheckpoint: operation !== "write_file" || !append
    };
  }

  async function readMetadata(target = "") {
    try {
      const file = await readContainerFileBuffer(target);
      const content = Buffer.from(String(file.contentBase64 || ""), "base64").toString("utf8");
      return {
        exists: true,
        size: Number(file.size || Buffer.byteLength(content, "utf8")),
        hash: sha256(content),
        content
      };
    } catch (error) {
      if (error?.code === "ENOENT" || /no such file|cannot find|not found/i.test(String(error?.message || ""))) {
        return {
          exists: false,
          size: 0,
          hash: "",
          content: ""
        };
      }
      throw error;
    }
  }

  function buildUnifiedDiff({ path = "", oldText = "", newText = "" } = {}) {
    if (oldText === newText) {
      return "";
    }
    const oldLines = String(oldText || "").split(/\r?\n/);
    const newLines = String(newText || "").split(/\r?\n/);
    const maxLines = 240;
    const lines = [`--- a/${path}`, `+++ b/${path}`, "@@ @@"];
    const oldLimit = Math.min(oldLines.length, maxLines);
    const newLimit = Math.min(newLines.length, maxLines);
    for (let index = 0; index < Math.max(oldLimit, newLimit); index += 1) {
      const oldLine = oldLines[index];
      const newLine = newLines[index];
      if (oldLine === newLine) {
        if (oldLine != null && lines.length < maxLines) lines.push(` ${oldLine}`);
        continue;
      }
      if (oldLine != null && lines.length < maxLines) lines.push(`-${oldLine}`);
      if (newLine != null && lines.length < maxLines) lines.push(`+${newLine}`);
    }
    if (oldLines.length > maxLines || newLines.length > maxLines) {
      lines.push("...diff truncated...");
    }
    return `${lines.join("\n")}\n`;
  }

  function applyTextEdits(content = "", editArgs = {}) {
    if (editArgs.hasContent) {
      return {
        content: String(editArgs.content ?? ""),
        replacements: 1,
        edits: []
      };
    }
    const edits = Array.isArray(editArgs.edits) && editArgs.edits.length
      ? editArgs.edits
      : [{
          oldText: String(editArgs.oldText ?? ""),
          newText: String(editArgs.newText ?? ""),
          replaceAll: editArgs.replaceAll === true,
          expectedReplacements: editArgs.expectedReplacements == null ? null : Number(editArgs.expectedReplacements)
        }];
    let next = String(content || "");
    let replacements = 0;
    for (const edit of edits) {
      const oldText = String(edit?.oldText || "");
      const newText = String(edit?.newText ?? "");
      if (!oldText) {
        const error = new Error("edit oldText is required");
        error.failureClass = "malformed_edit";
        throw error;
      }
      const occurrenceCount = oldText ? next.split(oldText).length - 1 : 0;
      const replacementCount = edit.replaceAll === true ? occurrenceCount : (next.includes(oldText) ? 1 : 0);
      if (replacementCount < 1) {
        const error = new Error("oldText not found");
        error.failureClass = "replacement_not_found";
        throw error;
      }
      if (edit.expectedReplacements != null && replacementCount !== Number(edit.expectedReplacements)) {
        const error = new Error(`expected ${Number(edit.expectedReplacements)} replacement(s) but found ${replacementCount}`);
        error.failureClass = "replacement_count_mismatch";
        throw error;
      }
      next = edit.replaceAll === true ? next.split(oldText).join(newText) : next.replace(oldText, newText);
      replacements += replacementCount;
    }
    return {
      content: next,
      replacements,
      edits
    };
  }

  async function writeTransaction(record = {}) {
    const filePath = transactionPath(record.id);
    await fs.mkdir(pathModule.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return record;
  }

  async function readTransaction(transactionId = "") {
    const normalizedId = String(transactionId || "").trim();
    if (!normalizedId) {
      return null;
    }
    try {
      const record = JSON.parse(await fs.readFile(transactionPath(normalizedId), "utf8"));
      return record && typeof record === "object" ? record : null;
    } catch {
      return null;
    }
  }

  async function createBaseTransaction({ operation = "", target = {}, proposal = {}, risk = {}, context = {} } = {}) {
    const now = Date.now();
    const ctx = normalizeTaskContext(context);
    return {
      schemaVersion: TRANSACTION_SCHEMA_VERSION,
      id: makeTransactionId(operation),
      taskId: ctx.taskId,
      operation,
      status: "draft",
      risk,
      target,
      readBasis: null,
      proposal,
      approval: {
        status: risk.requiresApproval ? "pending" : "not_required",
        actor: risk.requiresApproval ? "" : "policy",
        decidedAt: risk.requiresApproval ? 0 : now,
        notes: risk.requiresApproval ? "" : "Low-risk sandbox transaction auto-applied."
      },
      checkpoint: {
        id: "",
        beforeContentPath: "",
        reversible: false
      },
      applyResult: null,
      failure: null,
      context: ctx,
      createdAt: now,
      updatedAt: now
    };
  }

  async function proposeExternalEditTransaction(input = {}, context = {}) {
    const targetPath = String(input.path || input.filePath || input.target || "").trim();
    if (!targetPath) {
      throw new Error("path is required");
    }
    const oldText = Object.prototype.hasOwnProperty.call(input, "oldText") ? String(input.oldText ?? "") : "";
    const newText = Object.prototype.hasOwnProperty.call(input, "newText")
      ? String(input.newText ?? "")
      : (Object.prototype.hasOwnProperty.call(input, "content") ? String(input.content ?? "") : "");
    const operation = Object.prototype.hasOwnProperty.call(input, "content") && !Object.prototype.hasOwnProperty.call(input, "oldText")
      ? "write_file"
      : "edit_file";
    const risk = {
      ...classifyRisk({ operation, target: targetPath, overwrite: operation === "write_file" }),
      level: "high",
      reasons: [...new Set(["host_workspace", ...(classifyRisk({ operation, target: targetPath }).reasons || [])])],
      requiresApproval: true,
      requiresCheckpoint: true
    };
    const transaction = await createBaseTransaction({
      operation,
      target: {
        scope: "host_workspace",
        path: targetPath,
        pluginId: String(input.pluginId || "vscode").trim()
      },
      proposal: {
        oldText,
        newText,
        fullContentHash: newText ? sha256(newText) : "",
        unifiedDiff: buildUnifiedDiff({ path: targetPath, oldText, newText }),
        summary: compactTaskText(String(input.title || input.instructions || `Host workspace edit for ${targetPath}`), 220)
      },
      risk,
      context
    });
    transaction.status = "proposed";
    transaction.external = {
      adapter: String(input.adapter || "vscode").trim(),
      requestId: String(input.requestId || "").trim(),
      sessionId: String(input.sessionId || "").trim()
    };
    transaction.readBasis = oldText
      ? {
          path: targetPath,
          scope: "host_workspace",
          size: Buffer.byteLength(oldText, "utf8"),
          hash: sha256(oldText),
          capturedByToolCallId: transaction.context.toolCallId,
          source: String(input.adapter || "vscode").trim()
        }
      : {
          path: targetPath,
          scope: "host_workspace",
          size: 0,
          hash: "",
          noBasisReason: "external_edit_request_without_old_text",
          source: String(input.adapter || "vscode").trim()
        };
    await writeTransaction(transaction);
    await emitCoreEvent({
      type: "transaction.proposed",
      taskId: transaction.taskId,
      transactionId: transaction.id,
      status: transaction.status,
      summary: transaction.proposal?.summary || ""
    }).catch(() => {});
    return transaction;
  }

  async function proposeExternalSideEffectTransaction(input = {}, context = {}) {
    const domain = String(input.domain || input.adapter || input.pluginId || "external").trim();
    const operation = String(input.operation || "external_side_effect").trim();
    const summary = compactTaskText(String(input.summary || input.title || `${domain} ${operation}`), 220);
    const riskLevel = ["low", "normal", "high", "critical"].includes(String(input.riskLevel || "").trim())
      ? String(input.riskLevel).trim()
      : "high";
    const transaction = await createBaseTransaction({
      operation,
      target: {
        scope: "external_service",
        path: String(input.target || input.resource || "").trim(),
        pluginId: String(input.pluginId || domain).trim(),
        domain
      },
      proposal: {
        oldText: "",
        newText: "",
        fullContentHash: input.payload ? sha256(JSON.stringify(input.payload)) : "",
        unifiedDiff: "",
        summary
      },
      risk: {
        level: riskLevel,
        reasons: [...new Set(["external_service", ...(Array.isArray(input.riskReasons) ? input.riskReasons.map(String) : [])])],
        requiresApproval: input.requiresApproval !== false,
        requiresCheckpoint: false
      },
      context
    });
    transaction.status = "proposed";
    transaction.external = {
      adapter: domain,
      requestId: String(input.requestId || "").trim(),
      irreversible: input.irreversible === true,
      compensationPlan: compactTaskText(String(input.compensationPlan || ""), 1000),
      payloadPreview: compactTaskText(JSON.stringify(input.payload || {}), 4000)
    };
    transaction.readBasis = {
      path: String(input.target || input.resource || "").trim(),
      scope: "external_service",
      size: 0,
      hash: "",
      noBasisReason: "external_side_effect",
      source: domain
    };
    await writeTransaction(transaction);
    await emitCoreEvent({
      type: "transaction.proposed",
      taskId: transaction.taskId,
      transactionId: transaction.id,
      status: transaction.status,
      summary
    }).catch(() => {});
    return transaction;
  }

  async function completeExternalTransaction(transactionId = "", result = {}) {
    const transaction = await readTransaction(transactionId);
    if (!transaction) {
      throw new Error("transaction not found");
    }
    const ok = result.ok !== false;
    const finalDiff = String(result.finalDiff || result.diff || "").trim();
    transaction.status = ok ? "applied" : "failed";
    transaction.approval = {
      ...(transaction.approval || {}),
      status: ok ? "approved" : "rejected",
      actor: String(result.actor || "user").trim(),
      decidedAt: Date.now(),
      notes: compactTaskText(String(result.notes || result.message || ""), 500)
    };
    if (ok) {
      transaction.applyResult = {
        before: transaction.readBasis
          ? { exists: Boolean(transaction.readBasis.hash), size: Number(transaction.readBasis.size || 0), hash: String(transaction.readBasis.hash || "") }
          : null,
        after: {
          exists: true,
          size: Number(result.size || 0),
          hash: String(result.hash || result.afterHash || "")
        },
        actualDiff: finalDiff,
        modifiedProposal: result.userModified === true
      };
      transaction.externalResult = {
        completedAt: Date.now(),
        userModified: result.userModified === true,
        raw: result && typeof result === "object" ? result : {}
      };
    } else {
      transaction.failure = {
        class: String(result.failureClass || "external_apply_failed").trim(),
        message: compactTaskText(String(result.error || result.message || "external apply failed"), 1000),
        retryable: false
      };
    }
    transaction.updatedAt = Date.now();
    await writeTransaction(transaction);
    await emitCoreEvent({
      type: ok ? "transaction.applied" : "transaction.failed",
      taskId: transaction.taskId,
      transactionId: transaction.id,
      status: transaction.status,
      summary: ok ? "External transaction applied." : transaction.failure?.message || "External transaction failed."
    }).catch(() => {});
    return transaction;
  }

  async function approveTransaction(transactionId = "", decision = {}) {
    const transaction = await readTransaction(transactionId);
    if (!transaction) {
      throw new Error("transaction not found");
    }
    transaction.approval = {
      ...(transaction.approval || {}),
      status: "approved",
      actor: String(decision.actor || "user").trim(),
      decidedAt: Date.now(),
      notes: compactTaskText(String(decision.notes || ""), 500)
    };
    if (String(transaction.status || "") === "proposed") {
      transaction.status = "approved";
    }
    transaction.updatedAt = Date.now();
    await writeTransaction(transaction);
    await emitCoreEvent({
      type: "transaction.approved",
      taskId: transaction.taskId,
      transactionId: transaction.id,
      status: transaction.status,
      summary: transaction.approval?.notes || "Transaction approved."
    }).catch(() => {});
    return transaction;
  }

  async function rejectTransaction(transactionId = "", decision = {}) {
    const transaction = await readTransaction(transactionId);
    if (!transaction) {
      throw new Error("transaction not found");
    }
    transaction.status = "rejected";
    transaction.approval = {
      ...(transaction.approval || {}),
      status: "rejected",
      actor: String(decision.actor || "user").trim(),
      decidedAt: Date.now(),
      notes: compactTaskText(String(decision.notes || ""), 500)
    };
    transaction.failure = {
      class: "approval_rejected",
      message: compactTaskText(String(decision.reason || decision.notes || "Transaction rejected."), 1000),
      retryable: false
    };
    transaction.updatedAt = Date.now();
    await writeTransaction(transaction);
    await emitCoreEvent({
      type: "transaction.rejected",
      taskId: transaction.taskId,
      transactionId: transaction.id,
      status: transaction.status,
      summary: transaction.failure?.message || "Transaction rejected."
    }).catch(() => {});
    return transaction;
  }

  async function applyApprovedTransaction(transactionId = "") {
    const transaction = await readTransaction(transactionId);
    if (!transaction) {
      throw new Error("transaction not found");
    }
    if (String(transaction.status || "") !== "approved") {
      throw new Error(`transaction must be in approved state to apply (current: ${transaction.status || "(none)"})`);
    }
    const operation = String(transaction.operation || "");
    const targetPath = String(transaction.target?.path || "").trim();
    if (!targetPath) {
      throw new Error("transaction has no target path");
    }

    if (operation === "edit_file" || operation === "write_file") {
      const basisHash = String(transaction.readBasis?.hash || "").trim();
      if (basisHash) {
        const current = await readMetadata(targetPath);
        if (current.hash !== basisHash) {
          transaction.status = "failed";
          transaction.failure = {
            class: "stale_context",
            message: `Target changed since transaction was proposed: ${targetPath}`,
            retryable: true
          };
          transaction.updatedAt = Date.now();
          await writeTransaction(transaction);
          await emitCoreEvent({
            type: "transaction.failed",
            taskId: transaction.taskId,
            transactionId: transaction.id,
            status: transaction.status,
            summary: transaction.failure.message
          }).catch(() => {});
          const err = new Error(transaction.failure.message);
          err.failureClass = "stale_context";
          throw err;
        }
      }
    }

    const checkpointSource = operation === "move_path"
      ? String(transaction.target?.fromPath || targetPath).trim()
      : targetPath;
    const before = await readMetadata(checkpointSource);

    transaction.status = "applying";
    transaction.checkpoint = await storeCheckpoint(transaction, before);
    if (operation === "move_path") {
      const destBefore = await readMetadata(targetPath);
      transaction.overwriteCheckpoint = destBefore.exists
        ? await storeCheckpoint({ id: `${transaction.id}-overwrite` }, destBefore)
        : null;
    }
    transaction.updatedAt = Date.now();
    await writeTransaction(transaction);

    try {
      let result;
      if (operation === "write_file" || operation === "edit_file") {
        result = await writeContainerTextFile(targetPath, String(transaction.proposal?.newText ?? ""), { timeoutMs: 30000 });
      } else if (operation === "move_path") {
        const fromPath = String(transaction.target?.fromPath || "").trim();
        if (!fromPath) throw new Error("move transaction missing fromPath");
        const overwrite = Array.isArray(transaction.risk?.reasons) && transaction.risk.reasons.includes("overwrite");
        result = await moveContainerPath(fromPath, targetPath, { overwrite, timeoutMs: 30000 });
      } else {
        throw new Error(`unsupported operation for apply: ${operation}`);
      }
      const after = await readMetadata(targetPath);
      transaction.status = "applied";
      transaction.applyResult = {
        before: { exists: before.exists, size: before.size, hash: before.hash },
        after: { exists: after.exists, size: after.size, hash: after.hash },
        actualDiff: operation !== "move_path"
          ? buildUnifiedDiff({ path: targetPath, oldText: before.content, newText: after.content })
          : "",
        modifiedProposal: after.hash !== String(transaction.proposal?.fullContentHash || "").trim()
      };
      transaction.adapterResult = result;
      transaction.updatedAt = Date.now();
      await writeTransaction(transaction);
      await emitCoreEvent({
        type: "transaction.applied",
        taskId: transaction.taskId,
        transactionId: transaction.id,
        status: transaction.status,
        summary: transaction.proposal?.summary || ""
      }).catch(() => {});
      return { ...result, transactionId: transaction.id, transaction };
    } catch (error) {
      transaction.status = "failed";
      transaction.failure = {
        class: String(error?.failureClass || "apply_failed"),
        message: String(error?.message || error || ""),
        retryable: true
      };
      transaction.updatedAt = Date.now();
      await writeTransaction(transaction);
      await emitCoreEvent({
        type: "transaction.failed",
        taskId: transaction.taskId,
        transactionId: transaction.id,
        status: transaction.status,
        summary: transaction.failure?.message || ""
      }).catch(() => {});
      throw error;
    }
  }

  async function storeCheckpoint(transaction, beforeMetadata) {
    if (!beforeMetadata.exists) {
      return {
        id: "",
        beforeContentPath: "",
        reversible: true
      };
    }
    const filePath = checkpointPath(transaction.id, "before.txt");
    await fs.mkdir(pathModule.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, beforeMetadata.content, "utf8");
    return {
      id: `${transaction.id}:before`,
      beforeContentPath: filePath,
      reversible: true
    };
  }

  async function transactWriteFile(args = {}, context = {}) {
    const target = resolveToolPath(args.path || args.target || args.filePath || args.file);
    const content = String(args.content ?? "");
    const append = args.append === true;
    const before = await readMetadata(target);
    const risk = classifyRisk({ operation: "write_file", target, append });
    let transaction = await createBaseTransaction({
      operation: "write_file",
      target: { scope: "container_workspace", path: target, pluginId: "" },
      proposal: {
        oldText: before.exists ? before.content : "",
        newText: append ? `${before.content}${content}` : content,
        fullContentHash: sha256(append ? `${before.content}${content}` : content),
        unifiedDiff: buildUnifiedDiff({ path: target, oldText: before.exists ? before.content : "", newText: append ? `${before.content}${content}` : content }),
        summary: compactTaskText(`${append ? "Append to" : "Write"} ${target}`, 220)
      },
      risk,
      context
    });
    transaction.status = "proposed";
    transaction.readBasis = before.exists
      ? { path: target, scope: "container_workspace", size: before.size, hash: before.hash, capturedByToolCallId: transaction.context.toolCallId }
      : { path: target, scope: "container_workspace", size: 0, hash: "", noBasisReason: "target_missing" };
    await writeTransaction(transaction);
    await emitCoreEvent({
      type: "transaction.proposed",
      taskId: transaction.taskId,
      transactionId: transaction.id,
      status: transaction.status,
      summary: transaction.proposal?.summary || ""
    }).catch(() => {});
    if (risk.requiresApproval) {
      return { pendingApproval: true, transactionId: transaction.id, transaction };
    }
    transaction.status = "applying";
    transaction.checkpoint = await storeCheckpoint(transaction, before);
    transaction.updatedAt = Date.now();
    await writeTransaction(transaction);
    try {
      const result = await writeContainerTextFile(target, content, { append, timeoutMs: 30000 });
      const after = await readMetadata(target);
      transaction.status = "applied";
      transaction.applyResult = {
        before: { exists: before.exists, size: before.size, hash: before.hash },
        after: { exists: after.exists, size: after.size, hash: after.hash },
        actualDiff: buildUnifiedDiff({ path: target, oldText: before.content, newText: after.content }),
        modifiedProposal: after.hash !== transaction.proposal.fullContentHash
      };
      transaction.adapterResult = result;
      transaction.updatedAt = Date.now();
      await writeTransaction(transaction);
      await emitCoreEvent({
        type: "transaction.applied",
        taskId: transaction.taskId,
        transactionId: transaction.id,
        status: transaction.status,
        summary: transaction.proposal?.summary || ""
      }).catch(() => {});
      return { ...result, transactionId: transaction.id, transaction };
    } catch (error) {
      transaction.status = "failed";
      transaction.failure = {
        class: String(error?.failureClass || "apply_failed"),
        message: String(error?.message || error || ""),
        retryable: true
      };
      transaction.updatedAt = Date.now();
      await writeTransaction(transaction);
      await emitCoreEvent({
        type: "transaction.failed",
        taskId: transaction.taskId,
        transactionId: transaction.id,
        status: transaction.status,
        summary: transaction.failure?.message || ""
      }).catch(() => {});
      throw error;
    }
  }

  async function transactEditFile(args = {}, context = {}) {
    const target = resolveToolPath(args.path || args.target || args.filePath || args.file);
    const before = await readMetadata(target);
    if (!before.exists) {
      const error = new Error(`file does not exist: ${target}`);
      error.failureClass = "missing_target";
      throw error;
    }
    const risk = classifyRisk({ operation: "edit_file", target });
    let editPlan;
    try {
      editPlan = applyTextEdits(before.content, args);
    } catch (error) {
      const failedTransaction = await createBaseTransaction({
        operation: "edit_file",
        target: { scope: "container_workspace", path: target, pluginId: "" },
        proposal: {
          oldText: before.content,
          newText: before.content,
          fullContentHash: before.hash,
          unifiedDiff: "",
          summary: compactTaskText(`Rejected edit proposal for ${target}`, 220)
        },
        risk,
        context
      });
      failedTransaction.status = "failed";
      failedTransaction.readBasis = { path: target, scope: "container_workspace", size: before.size, hash: before.hash, capturedByToolCallId: failedTransaction.context.toolCallId };
      failedTransaction.failure = {
        class: String(error?.failureClass || "malformed_edit"),
        message: String(error?.message || error || ""),
        retryable: true
      };
      failedTransaction.updatedAt = Date.now();
      await writeTransaction(failedTransaction);
      await emitCoreEvent({
        type: "transaction.failed",
        taskId: failedTransaction.taskId,
        transactionId: failedTransaction.id,
        status: failedTransaction.status,
        summary: failedTransaction.failure?.message || ""
      }).catch(() => {});
      throw error;
    }
    let transaction = await createBaseTransaction({
      operation: "edit_file",
      target: { scope: "container_workspace", path: target, pluginId: "" },
      proposal: {
        oldText: before.content,
        newText: editPlan.content,
        fullContentHash: sha256(editPlan.content),
        unifiedDiff: buildUnifiedDiff({ path: target, oldText: before.content, newText: editPlan.content }),
        summary: compactTaskText(`Edit ${target}`, 220)
      },
      risk,
      context
    });
    transaction.status = "proposed";
    transaction.readBasis = { path: target, scope: "container_workspace", size: before.size, hash: before.hash, capturedByToolCallId: transaction.context.toolCallId };
    await writeTransaction(transaction);
    await emitCoreEvent({
      type: "transaction.proposed",
      taskId: transaction.taskId,
      transactionId: transaction.id,
      status: transaction.status,
      summary: transaction.proposal?.summary || ""
    }).catch(() => {});
    if (risk.requiresApproval) {
      return { pendingApproval: true, transactionId: transaction.id, transaction };
    }
    const currentBeforeApply = await readMetadata(target);
    if (currentBeforeApply.hash !== before.hash) {
      transaction.status = "failed";
      transaction.failure = {
        class: "stale_context",
        message: `Target changed before edit apply: ${target}`,
        retryable: true
      };
      transaction.updatedAt = Date.now();
      await writeTransaction(transaction);
      await emitCoreEvent({
        type: "transaction.failed",
        taskId: transaction.taskId,
        transactionId: transaction.id,
        status: transaction.status,
        summary: transaction.failure?.message || ""
      }).catch(() => {});
      const error = new Error(transaction.failure.message);
      error.failureClass = "stale_context";
      throw error;
    }
    transaction.status = "applying";
    transaction.checkpoint = await storeCheckpoint(transaction, before);
    transaction.updatedAt = Date.now();
    await writeTransaction(transaction);
    try {
      const result = args.hasContent
        ? await writeContainerTextFile(target, args.content, { timeoutMs: 30000 })
        : await editContainerTextFile(target, { ...args, timeoutMs: 30000 });
      const after = await readMetadata(target);
      transaction.status = "applied";
      transaction.applyResult = {
        before: { exists: before.exists, size: before.size, hash: before.hash },
        after: { exists: after.exists, size: after.size, hash: after.hash },
        actualDiff: buildUnifiedDiff({ path: target, oldText: before.content, newText: after.content }),
        modifiedProposal: after.hash !== transaction.proposal.fullContentHash
      };
      transaction.adapterResult = result;
      transaction.updatedAt = Date.now();
      await writeTransaction(transaction);
      await emitCoreEvent({
        type: "transaction.applied",
        taskId: transaction.taskId,
        transactionId: transaction.id,
        status: transaction.status,
        summary: transaction.proposal?.summary || ""
      }).catch(() => {});
      return { ...result, transactionId: transaction.id, transaction };
    } catch (error) {
      transaction.status = "failed";
      transaction.failure = {
        class: String(error?.failureClass || "apply_failed"),
        message: String(error?.message || error || ""),
        retryable: true
      };
      transaction.updatedAt = Date.now();
      await writeTransaction(transaction);
      await emitCoreEvent({
        type: "transaction.failed",
        taskId: transaction.taskId,
        transactionId: transaction.id,
        status: transaction.status,
        summary: transaction.failure?.message || ""
      }).catch(() => {});
      throw error;
    }
  }

  async function transactMovePath(args = {}, context = {}) {
    const from = resolveToolPath(args.fromPath || args.from);
    const to = resolveToolPath(args.toPath || args.to);
    const overwrite = args.overwrite === true;
    const before = await readMetadata(from);
    const targetBefore = await readMetadata(to);
    const risk = classifyRisk({ operation: "move_path", target: to, overwrite });
    let transaction = await createBaseTransaction({
      operation: "move_path",
      target: { scope: "container_workspace", path: to, fromPath: from, pluginId: "" },
      proposal: {
        oldText: "",
        newText: "",
        fullContentHash: before.hash,
        unifiedDiff: "",
        summary: compactTaskText(`Move ${from} to ${to}`, 220)
      },
      risk,
      context
    });
    transaction.status = "proposed";
    transaction.readBasis = before.exists
      ? { path: from, scope: "container_workspace", size: before.size, hash: before.hash, capturedByToolCallId: transaction.context.toolCallId }
      : { path: from, scope: "container_workspace", size: 0, hash: "", noBasisReason: "target_missing" };
    await writeTransaction(transaction);
    await emitCoreEvent({
      type: "transaction.proposed",
      taskId: transaction.taskId,
      transactionId: transaction.id,
      status: transaction.status,
      summary: transaction.proposal?.summary || ""
    }).catch(() => {});
    if (risk.requiresApproval) {
      return { pendingApproval: true, transactionId: transaction.id, transaction };
    }
    transaction.status = "applying";
    transaction.checkpoint = await storeCheckpoint(transaction, before);
    transaction.overwriteCheckpoint = targetBefore.exists ? await storeCheckpoint({ id: `${transaction.id}-overwrite` }, targetBefore) : null;
    transaction.updatedAt = Date.now();
    await writeTransaction(transaction);
    try {
      const result = await moveContainerPath(from, to, { overwrite, timeoutMs: 30000 });
      const after = await readMetadata(to);
      transaction.status = "applied";
      transaction.applyResult = {
        before: { exists: before.exists, size: before.size, hash: before.hash },
        after: { exists: after.exists, size: after.size, hash: after.hash },
        actualDiff: "",
        modifiedProposal: after.hash !== before.hash
      };
      transaction.adapterResult = result;
      transaction.updatedAt = Date.now();
      await writeTransaction(transaction);
      await emitCoreEvent({
        type: "transaction.applied",
        taskId: transaction.taskId,
        transactionId: transaction.id,
        status: transaction.status,
        summary: transaction.proposal?.summary || ""
      }).catch(() => {});
      return { ...result, transactionId: transaction.id, transaction };
    } catch (error) {
      transaction.status = "failed";
      transaction.failure = {
        class: String(error?.failureClass || "apply_failed"),
        message: String(error?.message || error || ""),
        retryable: true
      };
      transaction.updatedAt = Date.now();
      await writeTransaction(transaction);
      await emitCoreEvent({
        type: "transaction.failed",
        taskId: transaction.taskId,
        transactionId: transaction.id,
        status: transaction.status,
        summary: transaction.failure?.message || ""
      }).catch(() => {});
      throw error;
    }
  }

  async function listTransactionsForTask(taskId = "") {
    const normalizedTaskId = String(taskId || "").trim();
    const dirPath = pathModule.join(transactionRoot, "transactions");
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const record = JSON.parse(await fs.readFile(pathModule.join(dirPath, entry.name), "utf8"));
        if (!normalizedTaskId || String(record?.taskId || "").trim() === normalizedTaskId) {
          records.push(record);
        }
      } catch {
        // Ignore malformed transaction records.
      }
    }
    return records.sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
  }

  async function rollbackTransaction(transactionId = "", options = {}) {
    const transaction = await readTransaction(transactionId);
    if (!transaction) {
      throw new Error("transaction not found");
    }
    if (String(transaction.status || "") !== "applied") {
      throw new Error(`cannot roll back transaction with status ${transaction.status || "(none)"}`);
    }
    const isMove = String(transaction?.operation || "") === "move_path";
    const targetPath = String(transaction?.target?.path || "").trim();
    const fromPath = isMove ? String(transaction?.target?.fromPath || "").trim() : "";
    const checkpointPathValue = String(transaction?.checkpoint?.beforeContentPath || "").trim();
    if (!targetPath) {
      throw new Error("transaction is not automatically reversible");
    }
    if (isMove && !fromPath) {
      throw new Error("move transaction missing fromPath; cannot reverse");
    }
    if (!isMove && (!checkpointPathValue || transaction?.checkpoint?.reversible !== true)) {
      throw new Error("transaction is not automatically reversible");
    }
    const current = await readMetadata(targetPath);
    const afterHash = String(transaction?.applyResult?.after?.hash || "").trim();
    if (!options.force && afterHash && current.hash !== afterHash) {
      transaction.status = "rollback_failed";
      transaction.failure = {
        class: "rollback_target_changed",
        message: `Target changed after transaction apply: ${targetPath}`,
        retryable: false
      };
      transaction.updatedAt = Date.now();
      await writeTransaction(transaction);
      await emitCoreEvent({
        type: "transaction.failed",
        taskId: transaction.taskId,
        transactionId: transaction.id,
        status: transaction.status,
        summary: transaction.failure?.message || ""
      }).catch(() => {});
      throw new Error(transaction.failure.message);
    }
    transaction.status = "rolling_back";
    transaction.updatedAt = Date.now();
    await writeTransaction(transaction);
    if (isMove) {
      await moveContainerPath(targetPath, fromPath, { overwrite: false, timeoutMs: 30000 });
      const overwriteCheckpointPath = String(transaction?.overwriteCheckpoint?.beforeContentPath || "").trim();
      if (overwriteCheckpointPath) {
        const overwriteContent = await fs.readFile(overwriteCheckpointPath, "utf8");
        await writeContainerTextFile(targetPath, overwriteContent, { timeoutMs: 30000 });
      }
    } else {
      const beforeContent = await fs.readFile(checkpointPathValue, "utf8");
      await writeContainerTextFile(targetPath, beforeContent, { timeoutMs: 30000 });
    }
    const rollbackVerifyPath = isMove ? fromPath : targetPath;
    const afterRollback = await readMetadata(rollbackVerifyPath);
    transaction.status = "rolled_back";
    transaction.rollbackResult = {
      at: Date.now(),
      forced: options.force === true,
      restoredHash: afterRollback.hash,
      restoredSize: afterRollback.size
    };
    transaction.updatedAt = Date.now();
    await writeTransaction(transaction);
    await emitCoreEvent({
      type: "transaction.rolled_back",
      taskId: transaction.taskId,
      transactionId: transaction.id,
      status: transaction.status,
      summary: `Rolled back ${targetPath}`
    }).catch(() => {});
    return transaction;
  }

  async function validateReadBasis(target = "", expectedHash = "") {
    const normalizedTarget = String(target || "").trim();
    const normalizedExpected = String(expectedHash || "").trim();
    if (!normalizedTarget) {
      return { valid: false, staleness: "invalid_target", currentHash: "", basisHash: normalizedExpected, path: normalizedTarget };
    }
    const current = await readMetadata(normalizedTarget);
    if (!current.exists) {
      return { valid: false, staleness: "not_found", currentHash: "", basisHash: normalizedExpected, path: normalizedTarget };
    }
    if (!normalizedExpected) {
      return { valid: true, staleness: "no_basis", currentHash: current.hash, basisHash: "", path: normalizedTarget };
    }
    const changed = current.hash !== normalizedExpected;
    return {
      valid: !changed,
      staleness: changed ? "changed" : "fresh",
      currentHash: current.hash,
      basisHash: normalizedExpected,
      path: normalizedTarget
    };
  }

  return {
    applyApprovedTransaction,
    approveTransaction,
    classifyRisk,
    completeExternalTransaction,
    listTransactionsForTask,
    proposeExternalEditTransaction,
    proposeExternalSideEffectTransaction,
    readTransaction,
    rejectTransaction,
    rollbackTransaction,
    transactEditFile,
    transactMovePath,
    transactWriteFile,
    validateReadBasis
  };
}
