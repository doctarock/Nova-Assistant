export function createTaskFlightRecorderService(options = {}) {
  const {
    compactTaskText = (value = "") => String(value || ""),
    emitCoreEvent = async () => null,
    fs = null,
    listTransactionsForTask = async () => [],
    pathModule = null,
    readTaskHistory = async () => [],
    root = ""
  } = options;

  function taskRoot(taskId = "") {
    return pathModule.join(root, sanitizeTaskId(taskId));
  }

  function sanitizeTaskId(value = "") {
    return String(value || "").trim().replace(/[^a-z0-9_.-]/gi, "_") || "unknown-task";
  }

  function jsonlPath(taskId = "", name = "") {
    return pathModule.join(taskRoot(taskId), `${name}.jsonl`);
  }

  function statePath(taskId = "", name = "") {
    return pathModule.join(taskRoot(taskId), `${name}.json`);
  }

  async function appendJsonLine(filePath = "", record = {}) {
    await fs.mkdir(pathModule.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  async function readJsonLines(filePath = "", limit = 80) {
    let raw = "";
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    return String(raw || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(Number(limit || 80), 500)));
  }

  async function appendProviderHistory(taskId = "", entry = {}) {
    const normalizedTaskId = String(taskId || entry?.taskId || "").trim();
    if (!normalizedTaskId) {
      return null;
    }
    const record = await appendJsonLine(jsonlPath(normalizedTaskId, "provider-history"), {
      schemaVersion: 1,
      at: Date.now(),
      taskId: normalizedTaskId,
      provider: String(entry.provider || "ollama").trim(),
      model: String(entry.model || "").trim(),
      brainId: String(entry.brainId || "").trim(),
      step: Number(entry.step || 0),
      role: String(entry.role || (entry.normalizedDecision ? "assistant_decision" : "assistant")).trim(),
      ok: entry.ok === true,
      durationMs: Math.max(0, Number(entry.durationMs || 0)),
      promptHash: String(entry.promptHash || "").trim(),
      rawText: compactTaskText(String(entry.rawText || ""), 12000),
      normalizedDecision: entry.normalizedDecision && typeof entry.normalizedDecision === "object" ? entry.normalizedDecision : null,
      error: compactTaskText(String(entry.error || ""), 1000),
      providerState: entry.providerState && typeof entry.providerState === "object" ? entry.providerState : {}
    });
    const previous = await readProviderSummary(normalizedTaskId);
    await writeProviderSummary(normalizedTaskId, {
      ...(previous && typeof previous === "object" ? previous : {}),
      provider: record.provider,
      model: record.model || previous?.model || "",
      brainId: record.brainId || previous?.brainId || "",
      latestProviderStep: Math.max(Number(previous?.latestProviderStep || 0), Number(record.step || 0)),
      latestProviderRecordAt: record.at,
      continuation: {
        sameProviderResumeAvailable: Boolean(previous?.continuation?.sameProviderResumeAvailable || record.providerState?.continuationToken || record.providerState?.responseId),
        crossProviderResumeAvailable: true,
        visibleTranscriptAvailable: true,
        preservedProviderStateKeys: [...new Set([
          ...(Array.isArray(previous?.continuation?.preservedProviderStateKeys) ? previous.continuation.preservedProviderStateKeys : []),
          ...Object.keys(record.providerState || {})
        ])].sort()
      }
    });
    await emitCoreEvent({
      type: "provider.history_saved",
      taskId: normalizedTaskId,
      provider: record.provider,
      status: record.ok ? "ok" : "failed",
      summary: `${record.provider || "provider"} history saved for step ${record.step || 0}`
    }).catch(() => {});
    return record;
  }

  async function appendToolStep(taskId = "", entry = {}) {
    const normalizedTaskId = String(taskId || entry?.taskId || "").trim();
    if (!normalizedTaskId) {
      return null;
    }
    const record = await appendJsonLine(jsonlPath(normalizedTaskId, "tool-steps"), {
      schemaVersion: 1,
      at: Date.now(),
      taskId: normalizedTaskId,
      step: Number(entry.step || 0),
      toolCallId: String(entry.toolCallId || "").trim(),
      name: String(entry.name || "").trim(),
      argsPreview: compactTaskText(String(entry.argsPreview || ""), 2000),
      transportOk: entry.transportOk === true,
      semanticOk: entry.semanticOk === true,
      durationMs: Math.max(0, Number(entry.durationMs || 0)),
      transactionId: String(entry.transactionId || entry.toolResult?.transactionId || "").trim(),
      failureClass: String(entry.failureClass || "").trim(),
      error: compactTaskText(String(entry.error || ""), 1000),
      resultPreview: compactTaskText(String(entry.resultPreview || ""), 4000)
    });
    await emitCoreEvent({
      type: "tool.step_recorded",
      taskId: normalizedTaskId,
      toolName: record.name,
      transactionId: record.transactionId,
      status: record.semanticOk ? "ok" : "failed",
      summary: `${record.name || "tool"} ${record.semanticOk ? "completed" : "failed"}`
    }).catch(() => {});
    return record;
  }

  async function appendHookTrace(taskId = "", entry = {}) {
    const normalizedTaskId = String(taskId || entry?.taskId || "").trim();
    if (!normalizedTaskId) {
      return null;
    }
    return appendJsonLine(jsonlPath(normalizedTaskId, "hook-trace"), {
      schemaVersion: 1,
      at: Date.now(),
      taskId: normalizedTaskId,
      hook: String(entry.hook || "").trim(),
      pluginId: String(entry.pluginId || "").trim(),
      effect: compactTaskText(String(entry.effect || ""), 1000),
      payloadPreview: compactTaskText(String(entry.payloadPreview || ""), 4000)
    });
  }

  async function appendReadBasis(taskId = "", entry = {}) {
    const normalizedTaskId = String(taskId || entry?.taskId || "").trim();
    if (!normalizedTaskId) {
      return null;
    }
    return appendJsonLine(jsonlPath(normalizedTaskId, "read-basis"), {
      schemaVersion: 1,
      at: Date.now(),
      taskId: normalizedTaskId,
      toolCallId: String(entry.toolCallId || "").trim(),
      path: String(entry.path || "").trim(),
      scope: String(entry.scope || "container_workspace").trim(),
      size: Math.max(0, Number(entry.size || 0)),
      hash: String(entry.hash || "").trim(),
      source: String(entry.source || "read_file").trim()
    });
  }

  async function writeProviderSummary(taskId = "", summary = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      return null;
    }
    const record = {
      schemaVersion: 1,
      taskId: normalizedTaskId,
      updatedAt: Date.now(),
      ...summary
    };
    const filePath = statePath(normalizedTaskId, "provider-summary");
    await fs.mkdir(pathModule.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return record;
  }

  async function readProviderSummary(taskId = "") {
    try {
      return JSON.parse(await fs.readFile(statePath(taskId, "provider-summary"), "utf8"));
    } catch {
      return null;
    }
  }

  async function patchProviderSummary(taskId = "", patch = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId || !patch || typeof patch !== "object") return null;
    const previous = await readProviderSummary(normalizedTaskId);
    return writeProviderSummary(normalizedTaskId, {
      ...(previous && typeof previous === "object" ? previous : {}),
      ...patch
    });
  }

  async function buildTaskResumeSummary(taskId = "", options = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) return null;
    const limit = Math.max(5, Math.min(Number(options.limit || 40), 120));
    const [toolSteps, transactions, readBasis, providerSummary] = await Promise.all([
      readJsonLines(jsonlPath(normalizedTaskId, "tool-steps"), limit),
      listTransactionsForTask(normalizedTaskId),
      readJsonLines(jsonlPath(normalizedTaskId, "read-basis"), limit),
      readProviderSummary(normalizedTaskId)
    ]);
    if (!toolSteps.length && !transactions.length && !readBasis.length) {
      return null;
    }
    const lines = ["Prior run context for this task (do not repeat completed work):"];
    if (providerSummary?.lastRunOutcome) {
      const outcome = String(providerSummary.lastRunOutcome || "").trim();
      const stopReason = String(providerSummary.lastRunStopReason || "").trim();
      lines.push(`- Last run outcome: ${outcome}${stopReason ? ` (${stopReason})` : ""}`);
    }
    const appliedTransactions = Array.isArray(transactions)
      ? transactions.filter((t) => String(t.status || "").trim() === "applied")
      : [];
    if (appliedTransactions.length) {
      lines.push(`- Applied changes (${appliedTransactions.length}):`);
      for (const txn of appliedTransactions.slice(-8)) {
        const op = String(txn.operation || "").trim();
        const target = String(txn.target?.path || txn.target || "").trim();
        const entry = `  ${op}${target ? ` ${target}` : ""}`.trimEnd();
        if (entry.trim()) lines.push(entry);
      }
    }
    if (readBasis.length) {
      const uniquePaths = [...new Set(readBasis.map((e) => String(e.path || "").trim()).filter(Boolean))];
      if (uniquePaths.length) {
        lines.push(`- Files read (${uniquePaths.length}): ${uniquePaths.slice(-6).join(", ")}`);
      }
    }
    if (toolSteps.length) {
      const stepSummary = toolSteps.slice(-6).map((s) => {
        const name = String(s.name || "").trim();
        const ok = s.semanticOk ? "ok" : "failed";
        return `${name}(${ok})`;
      });
      lines.push(`- Last tool steps: ${stepSummary.join(", ")}`);
    }
    return lines.join("\n");
  }

  async function buildDebugPacket(taskId = "", options = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      throw new Error("taskId is required");
    }
    const limit = Math.max(5, Math.min(Number(options.limit || 80), 500));
    const [timeline, providerHistory, toolSteps, transactions, hookTrace, providerSummary, readBasis] = await Promise.all([
      readTaskHistory(normalizedTaskId, { limit }),
      readJsonLines(jsonlPath(normalizedTaskId, "provider-history"), limit),
      readJsonLines(jsonlPath(normalizedTaskId, "tool-steps"), limit),
      listTransactionsForTask(normalizedTaskId),
      readJsonLines(jsonlPath(normalizedTaskId, "hook-trace"), limit),
      readProviderSummary(normalizedTaskId),
      readJsonLines(jsonlPath(normalizedTaskId, "read-basis"), limit)
    ]);
    return {
      ok: true,
      taskId: normalizedTaskId,
      timeline,
      providerSummary,
      providerHistory,
      toolSteps,
      transactions,
      hookTrace,
      readBasis
    };
  }

  async function validateProviderHistory(taskId = "", options = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      throw new Error("taskId is required");
    }
    const limit = Math.max(5, Math.min(Number(options.limit || 200), 500));
    const [providerHistory, toolSteps] = await Promise.all([
      readJsonLines(jsonlPath(normalizedTaskId, "provider-history"), limit),
      readJsonLines(jsonlPath(normalizedTaskId, "tool-steps"), limit)
    ]);
    const failures = [];
    const assistantDecisions = providerHistory.filter((entry) => entry.role === "assistant_decision");
    const seenToolCallIds = new Set();
    for (const decision of assistantDecisions) {
      const calls = Array.isArray(decision?.normalizedDecision?.tool_calls)
        ? decision.normalizedDecision.tool_calls
        : [];
      for (const call of calls) {
        const id = String(call?.id || "").trim();
        if (id) {
          seenToolCallIds.add(id);
        }
      }
    }
    const toolStepIds = new Set(toolSteps.map((entry) => String(entry.toolCallId || "").trim()).filter(Boolean));
    for (const id of seenToolCallIds) {
      if (!toolStepIds.has(id)) {
        failures.push(`tool call ${id} has no recorded tool step`);
      }
    }
    const providerRecords = providerHistory.filter((entry) => entry.provider && entry.provider !== "observer-normalized");
    if (!providerRecords.length) {
      failures.push("no provider records found");
    }
    const summary = await readProviderSummary(normalizedTaskId);
    if (!summary?.continuation?.crossProviderResumeAvailable) {
      failures.push("cross-provider resume transcript is not marked available");
    }
    return {
      ok: failures.length === 0,
      taskId: normalizedTaskId,
      failureCount: failures.length,
      failures,
      providerRecordCount: providerRecords.length,
      decisionCount: assistantDecisions.length,
      toolStepCount: toolSteps.length,
      summary
    };
  }

  return {
    appendHookTrace,
    appendProviderHistory,
    appendReadBasis,
    appendToolStep,
    buildDebugPacket,
    buildTaskResumeSummary,
    patchProviderSummary,
    readProviderSummary,
    validateProviderHistory,
    writeProviderSummary
  };
}
