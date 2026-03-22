export function createToolLoopRepairHelpers(context = {}) {
  const {
    compactTaskText,
    extractJsonObject,
    extractProjectCycleImplementationRoots,
    extractTaskDirectiveValue,
    isPlanningDocumentPath,
    normalizeContainerMountPathCandidate,
    normalizeContainerPathForComparison,
    normalizeWindowsPathCandidate,
    normalizeWorkspaceRelativePathCandidate,
    path
  } = context;

function normalizeTaskDirectivePath(value = "") {
  return normalizeContainerMountPathCandidate(
    String(value || "").replace(/[)."'\`,;:!?]+$/g, "").trim()
  );
}

function parseLooseToolCallArguments(rawArgs = "") {
  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    return rawArgs;
  }
  const text = String(rawArgs || "").trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    if (typeof parsed === "string") {
      return parseLooseToolCallArguments(parsed);
    }
  } catch {
    // Fall through to path/url heuristics.
  }
  const keyValuePairs = text
    .split(/[\r\n,]+/)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (keyValuePairs.length) {
    const parsedPairs = {};
    let pairCount = 0;
    for (const entry of keyValuePairs) {
      const match = entry.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]\s*(.+)$/);
      if (!match) {
        pairCount = 0;
        break;
      }
      const key = String(match[1] || "").trim();
      let value = String(match[2] || "").trim();
      if (!key || !value) {
        pairCount = 0;
        break;
      }
      if (
        (value.startsWith("\"") && value.endsWith("\""))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (/^-?\d+(?:\.\d+)?$/.test(value)) {
        parsedPairs[key] = Number(value);
      } else if (/^(true|false)$/i.test(value)) {
        parsedPairs[key] = value.toLowerCase() === "true";
      } else {
        parsedPairs[key] = value;
      }
      pairCount += 1;
    }
    if (pairCount) {
      return parsedPairs;
    }
  }
  if (/^https?:\/\//i.test(text)) {
    return { url: text };
  }
  const normalizedPath = normalizeContainerMountPathCandidate(text);
  if (normalizedPath.startsWith("/home/openclaw/") || /^[A-Za-z]:[\\/]/.test(text)) {
    return { path: normalizedPath };
  }
  return {};
}

function parseRepeatedToolCallSignature(signature = "") {
  let parsed = [];
  try {
    const candidate = JSON.parse(String(signature || "").trim() || "[]");
    if (Array.isArray(candidate)) {
      parsed = candidate;
    }
  } catch {
    parsed = [];
  }
  return parsed.map((entry, index) => {
    const name = normalizeToolName(entry?.name || entry?.function?.name || "");
    const args = parseLooseToolCallArguments(entry?.arguments ?? entry?.function?.arguments ?? "");
    return {
      id: `call_${index + 1}`,
      name,
      args,
      target: extractInspectionTargetKey(name, args)
    };
  });
}

function normalizeLocalRepairTarget(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return normalizeTaskDirectivePath(raw)
    || normalizeWindowsPathCandidate(raw)
    || normalizeWorkspaceRelativePathCandidate(raw)
    || normalizeContainerMountPathCandidate(raw)
    || "";
}

function basenameForRepairTarget(target = "") {
  const normalized = normalizeContainerPathForComparison(String(target || "").trim());
  if (!normalized) {
    return "";
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return path.win32.basename(normalized);
  }
  return path.posix.basename(normalized);
}

function buildInspectionToolCallForTarget(target = "", { preferredReadTool = "" } = {}) {
  const normalizedTarget = normalizeLocalRepairTarget(target);
  if (!normalizedTarget) {
    return null;
  }
  if (/^https?:\/\//i.test(normalizedTarget)) {
    return buildToolCall("call_1", "web_fetch", { url: normalizedTarget });
  }
  const basename = basenameForRepairTarget(normalizedTarget);
  const looksFile = /\.[A-Za-z0-9]{1,12}$/.test(basename);
  const toolName = looksFile
    ? (normalizeToolName(preferredReadTool) === "read_file" ? "read_file" : "read_document")
    : "list_files";
  return buildToolCall("call_1", toolName, { path: normalizedTarget });
}

function buildLocalLoopRepairResult(assistantMessage = "", toolCalls = [], plannerBrainId = "") {
  const normalizedToolCalls = (Array.isArray(toolCalls) ? toolCalls : [toolCalls]).filter(Boolean);
  if (!normalizedToolCalls.length) {
    return null;
  }
  return {
    ok: true,
    decision: {
      assistant_message: String(assistantMessage || "").trim(),
      tool_calls: normalizedToolCalls,
      final: false
    },
    error: "",
    plannerBrainId: String(plannerBrainId || "").trim() || "local-repair"
  };
}

function buildLocalInspectionLoopRepairResult(
  target = "",
  assistantMessage = "",
  { plannerBrainId = "", preferredReadTool = "" } = {}
) {
  const toolCall = buildInspectionToolCallForTarget(target, { preferredReadTool });
  return buildLocalLoopRepairResult(assistantMessage, toolCall, plannerBrainId);
}

function extractQuotedPathMentions(message = "") {
  return [...String(message || "").matchAll(/\"([^\"]+)\"|'([^']+)'/g)]
    .map((match) => ({
      raw: String(match?.[1] || match?.[2] || "").trim(),
      index: Number(match?.index || 0)
    }))
    .map((entry) => ({
      ...entry,
      normalized: normalizeLocalRepairTarget(entry.raw)
    }))
    .filter((entry) => entry.raw && entry.normalized);
}

function inferGroundedFileTaskPathHints(message = "") {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const mentions = extractQuotedPathMentions(text);
  if (!mentions.length) {
    return { destination: "", sources: [], allPaths: [] };
  }
  const allPaths = [];
  for (const entry of mentions) {
    if (!allPaths.includes(entry.normalized)) {
      allPaths.push(entry.normalized);
    }
  }
  const matchDestination = (pattern) => {
    const match = text.match(pattern);
    return normalizeLocalRepairTarget(match?.[1] || "");
  };
  let destination = "";
  if (/^\s*(create|edit)\s+["']/i.test(text) || /\brevise\b[\s\S]{0,120}\bin\s+["']/i.test(text)) {
    destination = mentions[0]?.normalized || "";
  }
  if (!destination) {
    destination = matchDestination(/\b(?:write|rewrite|produce|extract|save|export)\b[\s\S]{0,160}?\b(?:to|into)\s+["']([^"']+)["']/i)
      || matchDestination(/\bindex file called\s+["']([^"']+)["']/i)
      || matchDestination(/\bcalled\s+["']([^"']+)["']/i);
  }
  if (!destination && mentions.length > 1 && /\b(write|rewrite|produce|extract|compare|summary|note|checklist|index|template)\b/.test(lower)) {
    destination = mentions[mentions.length - 1]?.normalized || "";
  }
  const sources = allPaths.filter((entry) => entry && entry !== destination);
  if (!sources.length && destination) {
    sources.push(destination);
  }
  return {
    destination,
    sources,
    allPaths
  };
}

function buildLocalGroundedTaskLoopRepair({
  message = "",
  repeatedToolCallSignature = "",
  inspectedTargets = []
} = {}) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  if (!/\b(read|rewrite|write|compare|inspect|edit|revise|create|produce|extract)\b/.test(lower)) {
    return null;
  }
  const repeatedCalls = parseRepeatedToolCallSignature(repeatedToolCallSignature);
  if (!repeatedCalls.length) {
    return null;
  }
  const repeatedTargets = repeatedCalls
    .map((entry) => normalizeContainerPathForComparison(normalizeLocalRepairTarget(entry.target)))
    .filter(Boolean);
  if (!repeatedTargets.length) {
    return null;
  }
  const readLikeCalls = repeatedCalls.filter((entry) => ["read_document", "read_file", "list_files"].includes(entry.name));
  if (!readLikeCalls.length) {
    return null;
  }
  const pathHints = inferGroundedFileTaskPathHints(text);
  if (!pathHints.allPaths.length) {
    return null;
  }
  const normalizedInspectedTargets = new Set(
    (Array.isArray(inspectedTargets) ? inspectedTargets : [])
      .map((target) => normalizeContainerPathForComparison(normalizeLocalRepairTarget(target)))
      .filter(Boolean)
  );
  const sources = pathHints.sources
    .map((target) => normalizeContainerPathForComparison(target))
    .filter((target, index, list) => target && list.indexOf(target) === index);
  const nextUnreadSource = sources.find((target) => !normalizedInspectedTargets.has(target) && !repeatedTargets.includes(target)) || "";
  if (nextUnreadSource) {
    return buildLocalInspectionLoopRepairResult(
      nextUnreadSource,
      "I am moving to the next named source before writing.",
      { plannerBrainId: "local-grounded-file" }
    );
  }

  const incompleteWrite = repeatedCalls.some((entry) =>
    entry.name === "write_file" && !String(entry.args?.content ?? "").trim()
  );
  const repeatedRead = readLikeCalls.find((entry) => ["read_document", "read_file"].includes(entry.name)) || null;
  const primarySource = sources[0] || repeatedTargets[0] || "";
  if (primarySource && incompleteWrite && repeatedRead) {
    const preferredReadTool = repeatedRead.name === "read_document" ? "read_file" : "read_document";
    return buildLocalInspectionLoopRepairResult(
      primarySource,
      "I am refreshing the source context before attempting the write again.",
      { plannerBrainId: "local-grounded-file", preferredReadTool }
    );
  }

  const repeatedList = readLikeCalls.find((entry) => entry.name === "list_files") || null;
  if (primarySource && repeatedList && !/\.[A-Za-z0-9]{1,12}$/.test(basenameForRepairTarget(primarySource))) {
    const args = repeatedList.args && typeof repeatedList.args === "object" ? repeatedList.args : {};
    if (args.recursive !== true) {
      return buildLocalLoopRepairResult(
        "I am expanding the file listing depth before writing the output.",
        buildToolCall("call_1", "list_files", { path: primarySource, recursive: true, limit: 200 }),
        "local-grounded-file"
      );
    }
  }

  if (primarySource && repeatedRead && pathHints.destination) {
    const preferredReadTool = repeatedRead.name === "read_document" ? "read_file" : "read_document";
    return buildLocalInspectionLoopRepairResult(
      primarySource,
      "I am changing the inspection step instead of repeating the same read/write bundle.",
      { plannerBrainId: "local-grounded-file", preferredReadTool }
    );
  }

  return null;
}

function buildLocalRepeatedToolLoopRepair({
  message = "",
  repeatedToolCallSignature = "",
  inspectedTargets = []
} = {}) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const isProjectCycle = (
    lower.includes("/project-todo.md")
    || /\bfocused project work package\b/.test(lower)
    || /^advance the project\b/.test(lower)
  );
  if (!isProjectCycle) {
    return null;
  }
  const inspectFirstTarget = normalizeTaskDirectivePath(extractTaskDirectiveValue(text, "Inspect first:"));
  const inspectSecondTarget = normalizeTaskDirectivePath(extractTaskDirectiveValue(text, "Inspect second if needed:"));
  const inspectThirdTarget = normalizeTaskDirectivePath(extractTaskDirectiveValue(text, "Inspect third if needed:"));
  const repeatedCalls = parseRepeatedToolCallSignature(repeatedToolCallSignature);
  if (!repeatedCalls.length) {
    return null;
  }
  const repeatedTargets = repeatedCalls
    .map((entry) => normalizeContainerPathForComparison(entry.target))
    .filter(Boolean);
  if (!repeatedTargets.length) {
    return null;
  }
  const repeatedInspectionOnly = repeatedCalls.every((entry) => ["read_document", "read_file", "list_files"].includes(entry.name));
  if (!repeatedInspectionOnly) {
    return null;
  }
  const normalizedInspectedTargets = new Set(
    (Array.isArray(inspectedTargets) ? inspectedTargets : [])
      .map((target) => normalizeContainerPathForComparison(target))
      .filter(Boolean)
  );
  const projectRoots = extractProjectCycleImplementationRoots(text)
    .map((target) => normalizeContainerPathForComparison(target))
    .filter(Boolean);
  const canonicalConcreteRoot = projectRoots.find((target) => /\/observer-input$/i.test(target)) || "";
  const projectRoot = projectRoots[0] || "";
  const inspectHints = [inspectFirstTarget, inspectSecondTarget, inspectThirdTarget]
    .map((target) => normalizeContainerPathForComparison(target))
    .filter((target, index, list) => target && list.indexOf(target) === index);
  const nextUninspectedHint = inspectHints.find((target) => !normalizedInspectedTargets.has(target)) || "";
  const nextFollowUpHint = [inspectSecondTarget, inspectThirdTarget]
    .map((target) => normalizeContainerPathForComparison(target))
    .find((target) => target && !normalizedInspectedTargets.has(target)) || "";
  const repeatedIncludesInspectFirst = inspectFirstTarget
    ? repeatedTargets.includes(normalizeContainerPathForComparison(inspectFirstTarget))
    : false;
  const repeatedOnlyPlanningOrRoot = repeatedTargets.every((target) =>
    isPlanningDocumentPath(target)
    || projectRoots.includes(target)
    || (canonicalConcreteRoot && target === canonicalConcreteRoot)
  );
  const inspectFirstParent = inspectFirstTarget && /\.[A-Za-z0-9]{1,12}$/i.test(path.posix.basename(inspectFirstTarget))
    ? normalizeContainerPathForComparison(path.posix.dirname(inspectFirstTarget))
    : "";

  if (repeatedIncludesInspectFirst && !normalizedInspectedTargets.has(normalizeContainerPathForComparison(inspectFirstTarget))) {
    const fallbackTarget = nextFollowUpHint || inspectFirstParent || canonicalConcreteRoot || projectRoot;
    const toolCall = buildInspectionToolCallForTarget(fallbackTarget);
    if (toolCall) {
      return {
        ok: true,
        decision: {
          assistant_message: "The named first target did not yield progress, so I知 advancing to the next concrete target.",
          tool_calls: [toolCall],
          final: false
        },
        error: "",
        plannerBrainId: "local-project-cycle"
      };
    }
  }

  if (inspectFirstTarget && repeatedOnlyPlanningOrRoot && !normalizedInspectedTargets.has(normalizeContainerPathForComparison(inspectFirstTarget))) {
    const toolCall = buildInspectionToolCallForTarget(inspectFirstTarget);
    if (toolCall) {
      return {
        ok: true,
        decision: {
          assistant_message: "I知 moving from planning to the named concrete target.",
          tool_calls: [toolCall],
          final: false
        },
        error: "",
        plannerBrainId: "local-project-cycle"
      };
    }
  }

  if (repeatedIncludesInspectFirst && nextFollowUpHint) {
    const toolCall = buildInspectionToolCallForTarget(nextFollowUpHint);
    if (toolCall) {
      return {
        ok: true,
        decision: {
          assistant_message: "I already inspected the startup bundle, so I知 advancing to the next concrete target.",
          tool_calls: [toolCall],
          final: false
        },
        error: "",
        plannerBrainId: "local-project-cycle"
      };
    }
  }

  if (repeatedIncludesInspectFirst) {
    const fallbackTarget = inspectFirstParent || canonicalConcreteRoot || projectRoot;
    const normalizedFallbackTarget = normalizeContainerPathForComparison(fallbackTarget);
    if (normalizedFallbackTarget && !repeatedTargets.includes(normalizedFallbackTarget)) {
      const toolCall = buildInspectionToolCallForTarget(fallbackTarget);
      if (toolCall) {
        return {
          ok: true,
          decision: {
            assistant_message: "I already inspected the startup bundle, so I知 moving to the next concrete area.",
            tool_calls: [toolCall],
            final: false
          },
          error: "",
          plannerBrainId: "local-project-cycle"
        };
      }
    }
  }

  if (!inspectFirstTarget && repeatedOnlyPlanningOrRoot && canonicalConcreteRoot && !normalizedInspectedTargets.has(canonicalConcreteRoot)) {
    const toolCall = buildInspectionToolCallForTarget(canonicalConcreteRoot);
    if (toolCall) {
      return {
        ok: true,
        decision: {
          assistant_message: "I知 drilling into the canonical implementation area.",
          tool_calls: [toolCall],
          final: false
        },
        error: "",
        plannerBrainId: "local-project-cycle"
      };
    }
  }

  const observerInputFallback = projectRoot ? normalizeContainerPathForComparison(`${projectRoot}/observer-input`) : "";
  if (!inspectFirstTarget && repeatedOnlyPlanningOrRoot && observerInputFallback && !normalizedInspectedTargets.has(observerInputFallback)) {
    const toolCall = buildInspectionToolCallForTarget(observerInputFallback);
    if (toolCall) {
      return {
        ok: true,
        decision: {
          assistant_message: "I知 moving into the implementation workspace instead of repeating the project root scan.",
          tool_calls: [toolCall],
          final: false
        },
        error: "",
        plannerBrainId: "local-project-cycle"
      };
    }
  }

  if (nextUninspectedHint && !repeatedTargets.includes(nextUninspectedHint)) {
    const toolCall = buildInspectionToolCallForTarget(nextUninspectedHint);
    if (toolCall) {
      return {
        ok: true,
        decision: {
          assistant_message: "I知 advancing to the next concrete inspection target.",
          tool_calls: [toolCall],
          final: false
        },
        error: "",
        plannerBrainId: "local-project-cycle"
      };
    }
  }

  return null;
}

function repairUnterminatedArgumentsStrings(text = "") {
  const source = String(text || "");
  const marker = "\"arguments\":\"";
  let output = "";
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(marker, cursor);
    if (start < 0) {
      output += source.slice(cursor);
      break;
    }
    output += source.slice(cursor, start + marker.length);
    let index = start + marker.length;
    let escaped = false;
    let objectDepth = 0;
    let sawOpeningBrace = false;
    let closedNormally = false;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (escaped) {
        output += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }
      if (char === "\"") {
        output += char;
        closedNormally = true;
        index += 1;
        break;
      }
      output += char;
      if (char === "{") {
        objectDepth += 1;
        sawOpeningBrace = true;
      } else if (char === "}" && objectDepth > 0) {
        objectDepth -= 1;
        if (sawOpeningBrace && objectDepth === 0) {
          const nextChar = source[index + 1] || "";
          if (nextChar === "}" || nextChar === "]" || nextChar === ",") {
            output += "\"";
            index += 1;
            break;
          }
        }
      }
    }
    if (!closedNormally && index >= source.length) {
      output += "\"";
      cursor = source.length;
      break;
    }
    cursor = index;
  }
  return output;
}

function repairLikelyJson(text = "") {
  let repaired = repairInvalidJsonEscapes(
    String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\[\s*\.{3}\s*\]/g, "[]")
    .replace(/:\s*\.{3}(\s*[,}\]])/g, ": null$1")
    .replace(/,\s*\.{3}(\s*[,}\]])/g, "$1")
    .replace(/([{,]\s*)\.{3}(\s*[,}\]])/g, "$1$2")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, "$1\"$2\"$3")
    .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, value) => `: "${value.replace(/"/g, "\\\"")}"`)
    .replace(/([{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'(\s*:)/g, (_, left, key, right) => `${left}"${key.replace(/"/g, "\\\"")}"${right}`)
  );
  repaired = repaired.replace(
    /("arguments"\s*:\s*"(?:[^"\\]|\\.)*"\s*})\s*,\s*(\{"id"\s*:)/g,
    "$1},$2"
  );
  repaired = repaired.replace(
    /("arguments"\s*:\s*"(?:[^"\\]|\\.)*"\s*})\s*]\s*,\s*("final"\s*:)/g,
    "$1}],$2"
  );
  repaired = repaired.replace(
    /("arguments"\s*:\s*")((?:[^"\\]|\\.)*)(")/g,
    (_, prefix, body, suffix) => {
      let normalized = String(body || "")
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/,\s*$/g, "")
        .replace(/\\\\+"/g, "\\\\\"");
      return `${prefix}${normalized}${suffix}`;
    }
  );
  return repaired;
}

function repairLikelyMissingToolCallArgumentsObject(text = "") {
  const source = String(text || "");
  if (!source.includes("\"arguments\"")) {
    return source;
  }
  const insertions = [];
  let searchIndex = 0;
  while (searchIndex < source.length) {
    const markerIndex = source.indexOf("\"arguments\"", searchIndex);
    if (markerIndex < 0) {
      break;
    }
    let cursor = markerIndex + "\"arguments\"".length;
    while (/\s/.test(source[cursor] || "")) {
      cursor += 1;
    }
    if (source[cursor] !== ":") {
      searchIndex = markerIndex + 1;
      continue;
    }
    cursor += 1;
    while (/\s/.test(source[cursor] || "")) {
      cursor += 1;
    }
    if (source[cursor] !== "{") {
      searchIndex = markerIndex + 1;
      continue;
    }
    let depth = 1;
    let inString = false;
    let escaped = false;
    let insertionIndex = -1;
    for (let index = cursor + 1; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "{") {
        depth += 1;
        continue;
      }
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          break;
        }
        continue;
      }
      if (
        char === ","
        && depth === 1
        && (
          /^\s*"id"\s*:\s*"[^"]*"\s*,\s*"type"\s*:\s*"function"/.test(source.slice(index + 1))
          || /^\s*"type"\s*:\s*"function"/.test(source.slice(index + 1))
        )
      ) {
        insertionIndex = index;
        break;
      }
    }
    if (insertionIndex >= 0) {
      insertions.push(insertionIndex);
    }
    searchIndex = cursor + 1;
  }
  if (!insertions.length) {
    return source;
  }
  let repaired = source;
  for (let index = insertions.length - 1; index >= 0; index -= 1) {
    const insertAt = insertions[index];
    repaired = `${repaired.slice(0, insertAt)}}${repaired.slice(insertAt)}`;
  }
  return repaired;
}

function repairUnexpectedJsonClosers(text = "") {
  const source = String(text || "");
  if (!source) {
    return source;
  }
  let output = "";
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      output += char;
      continue;
    }
    if (char === "}" || char === "]") {
      const expectedOpen = char === "}" ? "{" : "[";
      while (stack.length && stack[stack.length - 1] !== expectedOpen) {
        output += stack.pop() === "{" ? "}" : "]";
      }
      if (stack.length && stack[stack.length - 1] === expectedOpen) {
        stack.pop();
      }
      output += char;
      continue;
    }
    output += char;
  }
  while (stack.length) {
    output += stack.pop() === "{" ? "}" : "]";
  }
  return output;
}

function buildJsonRepairCandidates(text = "") {
  const source = String(text || "").trim();
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };
  pushCandidate(source);
  const repairedArguments = repairUnterminatedArgumentsStrings(source);
  pushCandidate(repairedArguments);
  const repairedToolCallArguments = repairLikelyMissingToolCallArgumentsObject(repairedArguments);
  pushCandidate(repairedToolCallArguments);
  const repairedClosers = repairUnexpectedJsonClosers(repairedToolCallArguments);
  pushCandidate(repairedClosers);
  pushCandidate(repairLikelyJson(repairedClosers));
  return candidates;
}

function parseFirstJsonCandidateFromList(candidates = [], errors = []) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    try {
      return {
        ok: true,
        value: JSON.parse(candidate)
      };
    } catch (error) {
      if (Array.isArray(errors)) {
        errors.push(error);
      }
    }
  }
  return { ok: false, value: null };
}

function tryParseJsonCandidate(text = "", errors = []) {
  return parseFirstJsonCandidateFromList(buildJsonRepairCandidates(text), errors);
}

function collectBalancedJsonCandidates(candidates = []) {
  const balancedCandidates = [];
  const seenBalancedCandidates = new Set();
  for (const variant of Array.isArray(candidates) ? candidates : []) {
    for (const balanced of extractBalancedJsonObjects(variant)) {
      const normalized = String(balanced || "").trim();
      if (!normalized || seenBalancedCandidates.has(normalized)) {
        continue;
      }
      seenBalancedCandidates.add(normalized);
      balancedCandidates.push(normalized);
    }
  }
  return balancedCandidates;
}

function repairInvalidJsonEscapes(text = "") {
  const source = String(text || "");
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (!inString) {
      output += char;
      if (char === "\"") {
        inString = true;
      }
      continue;
    }
    if (escaped) {
      if (/["\\/bfnrt]/.test(char)) {
        output += char;
      } else if (char === "u" && /^[0-9a-fA-F]{4}$/.test(source.slice(index + 1, index + 5))) {
        output += char;
      } else {
        output += `\\${char}`;
      }
      escaped = false;
      continue;
    }
    if (char === "\\") {
      output += "\\";
      escaped = true;
      continue;
    }
    output += char;
    if (char === "\"") {
      inString = false;
    }
  }
  if (escaped) {
    output += "\\";
  }
  return output;
}

function extractBalancedJsonObject(text = "") {
  const matches = extractBalancedJsonObjects(text);
  return matches[0] || "";
}

function extractBalancedJsonObjects(text = "") {
  const source = String(text || "");
  const results = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          results.push(source.slice(start, index + 1));
          start = -1;
        }
      }
    }
  }
  return results.reverse();
}

function buildToolCall(id, name, args) {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args || {})
    }
  };
}

function parseToolCallArgs(toolCall) {
  const normalized = normalizeToolCallRecord(toolCall);
  const rawArgs = normalized?.function?.arguments;
  if (rawArgs && typeof rawArgs === "object") {
    return rawArgs;
  }
  const text = String(rawArgs || "{}").trim() || "{}";
  const parseJsonLike = (value) => {
    const candidate = String(value || "").trim();
    if (!candidate) {
      return null;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        return extractJsonObject(candidate);
      } catch {
        return null;
      }
    }
  };
  let parsed = parseJsonLike(text);
  if (typeof parsed === "string") {
    parsed = parseJsonLike(parsed);
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed;
  }
  return parseLooseToolCallArguments(text);
}

function normalizeToolCallRecord(toolCall, index = 0) {
  const record = toolCall && typeof toolCall === "object" ? { ...toolCall } : {};
  const rawFunction = record.function && typeof record.function === "object" && !Array.isArray(record.function)
    ? { ...record.function }
    : {};
  const fallbackName = record["function.name"] || record.function_name || record.name || "";
  const fallbackArguments = record["function.arguments"] ?? record.function_arguments ?? record.arguments;
  if (!rawFunction.name && fallbackName) {
    rawFunction.name = fallbackName;
  }
  if (rawFunction.arguments === undefined && fallbackArguments !== undefined) {
    rawFunction.arguments = fallbackArguments;
  }
  if (rawFunction.arguments && typeof rawFunction.arguments !== "string") {
    try {
      rawFunction.arguments = JSON.stringify(rawFunction.arguments);
    } catch {
      rawFunction.arguments = "{}";
    }
  }
  if (typeof rawFunction.arguments !== "string") {
    rawFunction.arguments = "{}";
  }
  const repairedLooseArgs = parseLooseToolCallArguments(rawFunction.arguments);
  if (
    repairedLooseArgs
    && typeof repairedLooseArgs === "object"
    && !Array.isArray(repairedLooseArgs)
    && Object.keys(repairedLooseArgs).length
  ) {
    let parsedArguments = null;
    try {
      parsedArguments = JSON.parse(String(rawFunction.arguments || "").trim() || "{}");
    } catch {
      parsedArguments = null;
    }
    if (!parsedArguments || typeof parsedArguments !== "object" || Array.isArray(parsedArguments)) {
      try {
        rawFunction.arguments = JSON.stringify(repairedLooseArgs);
      } catch {
        rawFunction.arguments = "{}";
      }
    }
  }
  return {
    ...record,
    id: String(record.id || `call_${index + 1}`),
    type: "function",
    function: rawFunction
  };
}

function normalizeToolName(name = "") {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^functions?[.:/]/, "")
    .replace(/^tools?[.:/]/, "")
    .replace(/^function[._-]/, "")
    .replace(/^tool[._-]/, "")
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
}

function extractInspectionTargetKey(toolName = "", args = {}) {
  const normalizedTool = normalizeToolName(toolName);
  if (["list_files", "read_document", "read_file"].includes(normalizedTool)) {
    return compactTaskText(String(args.path || args.url || "").trim(), 240);
  }
  if (normalizedTool === "web_fetch") {
    return compactTaskText(String(args.url || "").trim(), 240);
  }
  if (normalizedTool === "shell_command") {
    return compactTaskText(String(args.command || "").trim(), 240);
  }
  return "";
}

  return {
    basenameForRepairTarget,
    buildInspectionToolCallForTarget,
    buildJsonRepairCandidates,
    buildLocalGroundedTaskLoopRepair,
    buildLocalInspectionLoopRepairResult,
    buildLocalLoopRepairResult,
    buildLocalRepeatedToolLoopRepair,
    buildToolCall,
    collectBalancedJsonCandidates,
    extractBalancedJsonObject,
    extractBalancedJsonObjects,
    extractInspectionTargetKey,
    extractQuotedPathMentions,
    inferGroundedFileTaskPathHints,
    normalizeLocalRepairTarget,
    normalizeTaskDirectivePath,
    normalizeToolCallRecord,
    normalizeToolName,
    parseFirstJsonCandidateFromList,
    parseLooseToolCallArguments,
    parseRepeatedToolCallSignature,
    parseToolCallArgs,
    repairInvalidJsonEscapes,
    repairLikelyJson,
    repairLikelyMissingToolCallArgumentsObject,
    repairUnexpectedJsonClosers,
    repairUnterminatedArgumentsStrings,
    tryParseJsonCandidate
  };
}

