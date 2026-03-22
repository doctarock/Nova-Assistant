export function createObserverPromptUtils(context = {}) {
  const {
    compactTaskText,
    defaultLargeItemChunkChars,
    maxLargeItemChunkChars,
    normalizeContainerPathForComparison,
    normalizeToolCallRecord
  } = context;

  function normalizeChunkWindowArgs(args = {}) {
    const offset = Math.max(0, Number.parseInt(args.offset, 10) || 0);
    const maxChars = Math.max(
      500,
      Math.min(
        maxLargeItemChunkChars,
        Number.parseInt(args.maxChars, 10) || defaultLargeItemChunkChars
      )
    );
    return { offset, maxChars };
  }

  function buildChunkedTextPayload(text, args = {}) {
    const source = String(text || "");
    const { offset, maxChars } = normalizeChunkWindowArgs(args);
    const safeOffset = Math.min(offset, source.length);
    const end = Math.min(source.length, safeOffset + maxChars);
    const content = source.slice(safeOffset, end);
    const totalChars = source.length;
    const returnedChars = content.length;
    const hasMore = end < totalChars;
    const chunkIndex = returnedChars ? Math.floor(safeOffset / maxChars) + 1 : 1;
    const totalChunks = totalChars ? Math.max(1, Math.ceil(totalChars / maxChars)) : 1;
    return {
      content,
      chunk: {
        offset: safeOffset,
        maxChars,
        returnedChars,
        end,
        totalChars,
        hasMore,
        nextOffset: hasMore ? end : null,
        chunkIndex,
        totalChunks,
        truncated: totalChars > returnedChars
      }
    };
  }

  function summarizeChunkForPrompt(chunk = {}) {
    if (!chunk || typeof chunk !== "object") {
      return "";
    }
    const index = Number(chunk.chunkIndex || 1) || 1;
    const total = Number(chunk.totalChunks || 1) || 1;
    const returned = Number(chunk.returnedChars || 0) || 0;
    const totalChars = Number(chunk.totalChars || returned) || returned;
    return `chunk ${index} of ${total}, ${returned} of ${totalChars} chars${chunk.hasMore ? `, next offset ${chunk.nextOffset}` : ""}`;
  }

  function compactToolResultForPrompt(toolResult, preserveFullContent = false) {
    if (!toolResult || typeof toolResult !== "object") {
      return toolResult;
    }
    const entry = {
      ...toolResult
    };
    if (!entry.result || typeof entry.result !== "object") {
      return entry;
    }
    const result = { ...entry.result };
    if (typeof result.content === "string" && !preserveFullContent) {
      result.content = compactTaskText(result.content, 700);
      if (result.chunk) {
        result.contentSummary = summarizeChunkForPrompt(result.chunk);
      }
    }
    if (typeof result.body === "string" && !preserveFullContent) {
      result.body = compactTaskText(result.body, 700);
      if (result.chunk) {
        result.bodySummary = summarizeChunkForPrompt(result.chunk);
      }
    }
    entry.result = result;
    return entry;
  }

  function summarizeToolResultForPrompt(toolResult) {
    if (!toolResult || typeof toolResult !== "object") {
      return compactTaskText(String(toolResult || ""), 240);
    }
    const parts = [];
    const name = String(toolResult.name || "").trim();
    if (name) {
      parts.push(`tool=${name}`);
    }
    if (typeof toolResult.ok === "boolean") {
      parts.push(`ok=${toolResult.ok}`);
    }
    const result = toolResult.result && typeof toolResult.result === "object"
      ? toolResult.result
      : null;
    const target = String(
      result?.path
      || result?.source
      || result?.url
      || toolResult.path
      || toolResult.url
      || ""
    ).trim();
    if (target) {
      parts.push(`target=${target}`);
    }
    if (!toolResult.ok && toolResult.error) {
      parts.push(`error=${compactTaskText(String(toolResult.error || ""), 180)}`);
    } else if (result) {
      const textPreview = String(
        result.contentSummary
        || result.bodySummary
        || result.content
        || result.body
        || result.text
        || ""
      ).trim();
      if (textPreview) {
        parts.push(`summary=${compactTaskText(textPreview.replace(/\s+/g, " "), 220)}`);
      } else if (Array.isArray(result.entries)) {
        parts.push(`entries=${result.entries.length}`);
      } else if (Array.isArray(result.files)) {
        parts.push(`files=${result.files.length}`);
      }
    }
    return compactTaskText(parts.join(" | "), 320);
  }

  function buildPostToolDecisionInstruction(toolResults = [], {
    inspectFirstTarget = "",
    expectedFirstMove = "",
    stepDiagnostics = null,
    lowValueStreak = 0,
    requireConcreteConvergence = false,
    mentionsSkillsOrToolbelt = false
  } = {}) {
    const successfulResults = (Array.isArray(toolResults) ? toolResults : []).filter((entry) => entry?.ok);
    const emptyReadTargets = successfulResults
      .filter((entry) => {
        const toolName = String(entry?.name || "").trim().toLowerCase();
        if (!["read_document", "read_file"].includes(toolName)) {
          return false;
        }
        const content = String(
          entry?.result?.content
          || entry?.result?.body
          || entry?.result?.text
          || ""
        );
        return !content.trim();
      })
      .map((entry) => String(
        entry?.result?.path
        || entry?.result?.source
        || ""
      ).trim())
      .filter(Boolean);
    const inspectedTargets = successfulResults
      .map((entry) => String(
        entry?.result?.path
        || entry?.result?.source
        || entry?.result?.url
        || ""
      ).trim())
      .filter(Boolean);
    const lines = [
      "Use the observer tool results above to decide the next assistant action.",
      "Those results came from your previous tool calls and are not a user request.",
      "Do not echo role=tool, tool_results, or a bare tool-result object.",
      "Return either another assistant tool envelope that advances the work, or final=true with final_text if the task is genuinely complete."
    ];
    if (inspectedTargets.length) {
      lines.push(`Already inspected in this step: ${inspectedTargets.join(", ")}.`);
      lines.push("Do not repeat the same read/write bundle after a successful read. Either write concrete content, inspect a different named target, or conclude only if the completion gate is satisfied.");
    }
    if (emptyReadTargets.length) {
      lines.push(`The last read showed unexpectedly empty content in: ${emptyReadTargets.join(", ")}.`);
      lines.push("If the expected content can be reconstructed safely from the task brief, nearby files, or project tracking docs, repair that file now instead of rereading it.");
      lines.push("If you cannot repair it safely, do not loop on more empty reads. Search the skill library or record a capability request if tooling is missing, or finish with final_text starting exactly with 'QUESTION FOR USER:' followed by one focused question for the UI.");
    }
    if (inspectFirstTarget && inspectedTargets.some((target) => normalizeContainerPathForComparison(target) === normalizeContainerPathForComparison(inspectFirstTarget))) {
      lines.push("The named first inspection target is already covered, so continue to the next concrete target or edit step.");
    } else if (expectedFirstMove) {
      lines.push(`Keep the required first-move constraint in mind: ${expectedFirstMove}`);
    }
    if (!successfulResults.length) {
      lines.push("If the last tools failed, adjust the tool plan instead of repeating the same failing call.");
      lines.push("If the failure means the needed capability is missing from the available tools, do not end with a refusal. Search the skill library, inspect the best fit, and record request_skill_installation or request_tool_addition.");
    }
    if (stepDiagnostics?.progressKind === "inspection_repeat") {
      lines.push("The last step only repeated prior inspection and did not create a file change, artifact, capability request, or new concrete inspection target.");
    } else if (stepDiagnostics?.progressKind === "exploration") {
      lines.push("The last step added exploration only. Use that information to move into an edit, validation, capability request, or a no-change conclusion instead of broadening inspection again.");
    }
    if (requireConcreteConvergence && Number(lowValueStreak || 0) >= 2) {
      lines.push("You have spent multiple tool steps without concrete convergence. The next step must either change files, produce an artifact, use request_skill_installation/request_tool_addition, search the skill library for the missing capability, or conclude with the exact phrase 'no change is possible' and the inspected paths.");
      lines.push("If a repo change is now clear, use edit_file for targeted text changes, write_file for new or fully rewritten files, or move_path for renames instead of another read-only inspection step.");
      lines.push("When you use read_document, list_files, write_file, or edit_file, include the explicit full path in the path field on every call.");
    } else if (mentionsSkillsOrToolbelt && Number(lowValueStreak || 0) >= 1) {
      lines.push("If the blocker is a missing capability, prefer search_skill_library, inspect_skill_library, request_skill_installation, or request_tool_addition over more broad inspection.");
    }
    return lines.join(" ");
  }

  function buildTranscriptForPrompt(transcript = []) {
    const lastToolEntryIndex = (() => {
      for (let index = transcript.length - 1; index >= 0; index -= 1) {
        if (transcript[index]?.role === "tool") {
          return index;
        }
      }
      return -1;
    })();
    const compacted = transcript.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return entry;
      }
      if (entry.role === "assistant") {
        return {
          ...entry,
          assistant_message: compactTaskText(entry.assistant_message || "", 700)
        };
      }
      if (entry.role === "tool" && Array.isArray(entry.tool_results)) {
        const preserveFullContent = index === lastToolEntryIndex;
        return {
          ...entry,
          tool_results: entry.tool_results.map((toolResult) => compactToolResultForPrompt(toolResult, preserveFullContent))
        };
      }
      return entry;
    });
    return compacted.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return compactTaskText(String(entry || ""), 700);
      }
      if (entry.role === "assistant") {
        const lines = ["Assistant decision:"];
        if (entry.assistant_message) {
          lines.push(`assistant_message: ${entry.assistant_message}`);
        }
        if (Array.isArray(entry.tool_calls) && entry.tool_calls.length) {
          const summarizedCalls = entry.tool_calls.map((toolCall) => {
            const normalized = normalizeToolCallRecord(toolCall);
            return {
              name: String(normalized?.function?.name || "").trim(),
              arguments: String(normalized?.function?.arguments || "").trim()
            };
          });
          lines.push(`tool_calls: ${JSON.stringify(summarizedCalls)}`);
        }
        if (entry.action) {
          lines.push(`action: ${String(entry.action || "").trim()}`);
        }
        return lines.join("\n");
      }
      if (entry.role === "tool" && Array.isArray(entry.tool_results)) {
        const summarizedResults = entry.tool_results.map((toolResult, index) => {
          const summary = summarizeToolResultForPrompt(toolResult);
          const rawJson = compactTaskText(JSON.stringify(toolResult), 1200);
          return `Tool result ${index + 1}: ${summary}\nraw: ${rawJson}`;
        }).join("\n");
        return [
          "Observer tool results already executed below. Consume them as prior state, then decide the next assistant action.",
          summarizedResults
        ].join("\n");
      }
      return compactTaskText(JSON.stringify(entry), 1200);
    }).join("\n\n");
  }

  function formatDateTimeForUser(value) {
    if (!value) {
      return "never";
    }
    try {
      return new Date(value).toLocaleString("en-AU", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch {
      return String(value);
    }
  }

  function formatTimeForUser(value = Date.now()) {
    try {
      return new Date(value).toLocaleTimeString("en-AU", {
        hour: "numeric",
        minute: "2-digit"
      });
    } catch {
      return new Date(value).toString();
    }
  }

  function formatDateForUser(value = Date.now()) {
    try {
      return new Date(value).toLocaleDateString("en-AU", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    } catch {
      return new Date(value).toDateString();
    }
  }

  function formatDayKey(value = Date.now()) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Australia/Sydney",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(new Date(value));
      const year = parts.find((part) => part.type === "year")?.value || "0000";
      const month = parts.find((part) => part.type === "month")?.value || "00";
      const day = parts.find((part) => part.type === "day")?.value || "00";
      return `${year}-${month}-${day}`;
    } catch {
      return new Date(value).toISOString().slice(0, 10);
    }
  }

  function startOfTodayMs(value = Date.now()) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  function humanJoin(items = []) {
    const values = items.filter(Boolean);
    if (!values.length) return "";
    if (values.length === 1) return values[0];
    if (values.length === 2) return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
  }

  function summarizeCronTools(summary = "") {
    const lines = String(summary || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const toolNames = [];
    for (const line of lines) {
      if (!line.startsWith("{") || !line.includes("\"name\"")) {
        continue;
      }
      try {
        const parsed = JSON.parse(line);
        if (parsed?.name) {
          toolNames.push(String(parsed.name));
        }
      } catch {
        // ignore malformed lines
      }
    }
    const uniqueNames = [...new Set(toolNames)];
    const labels = [];
    if (uniqueNames.some((name) => name === "read" || name === "memory_get")) {
      labels.push("checked memory and workspace notes");
    }
    if (uniqueNames.includes("process")) {
      labels.push("reviewed active processes");
    }
    if (uniqueNames.includes("cron")) {
      labels.push("checked scheduled job status");
    }
    if (!labels.length && uniqueNames.length) {
      labels.push(`used ${humanJoin(uniqueNames)}`);
    }
    return humanJoin(labels);
  }

  return {
    buildChunkedTextPayload,
    buildPostToolDecisionInstruction,
    buildTranscriptForPrompt,
    compactToolResultForPrompt,
    formatDateForUser,
    formatDateTimeForUser,
    formatDayKey,
    formatTimeForUser,
    humanJoin,
    normalizeChunkWindowArgs,
    startOfTodayMs,
    summarizeChunkForPrompt,
    summarizeCronTools,
    summarizeToolResultForPrompt
  };
}
