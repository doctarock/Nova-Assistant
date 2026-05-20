export function createObserverGeneralUtils({
  getAgentPersonaName = () => "Nova",
  observerContainerInputRoot,
  observerContainerOutputRoot,
  observerContainerWorkspaceRoot,
  path
} = {}) {
  function escapeRegex(value = "") {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeAgentSelfReference(text = "") {
    const persona = getAgentPersonaName();
    const personaPattern = escapeRegex(persona);
    return String(text || "")
      .replace(/\bI(?:'| a)m\s+Qwen\b/gi, (match) => (/I am/i.test(match) ? `I am ${persona}` : `I'm ${persona}`))
      .replace(/\bmy name is\s+Qwen\b/gi, `my name is ${persona}`)
      .replace(/\bthis is\s+Qwen\b/gi, `this is ${persona}`)
      .replace(/\bQwen Worker\b/g, persona)
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+will\\b`, "gi"), "I will")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+can\\b`, "gi"), "I can")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+cannot\\b`, "gi"), "I cannot")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+can't\\b`, "gi"), "I can't")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+should\\b`, "gi"), "I should")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+need(?:s)?\\b`, "gi"), "I need")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+want(?:s)?\\b`, "gi"), "I want")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+ha(?:s|ve)\\b`, "gi"), "I have")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+had\\b`, "gi"), "I had")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+was\\b`, "gi"), "I was")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+is\\b`, "gi"), "I am")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+do(?:es)?\\b`, "gi"), "I do")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+did\\b`, "gi"), "I did")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+know(?:s)?\\b`, "gi"), "I know")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+found\\b`, "gi"), "I found")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+created\\b`, "gi"), "I created")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)\\s+checked\\b`, "gi"), "I checked")
      .replace(new RegExp(`\\b(?:${personaPattern}|the agent|the assistant|this assistant|this agent)'s\\b`, "gi"), "my")
      .replace(/\b[Nn]ova and I\b/g, "I")
      .replace(/\bthe agent and I\b/gi, "I")
      .replace(/\bthe assistant and I\b/gi, "I")
      .trim();
  }

  function parseEveryToMs(every) {
    const raw = String(every || "").trim().toLowerCase();
    const match = raw.match(/^(\d+)\s*(ms|s|m|h|d)$/);
    if (!match) {
      return 0;
    }
    const value = Number(match[1]);
    const unit = match[2];
    if (unit === "ms") return value;
    if (unit === "s") return value * 1000;
    if (unit === "m") return value * 60 * 1000;
    if (unit === "h") return value * 60 * 60 * 1000;
    if (unit === "d") return value * 24 * 60 * 60 * 1000;
    return 0;
  }

  function resolveToolPath(rawPath = "") {
    const input = String(rawPath || "").trim();
    if (!input) {
      throw new Error("path is required");
    }
    if (/[\u0000-\u001F\u007F\u0085\u2028\u2029]/.test(input)) {
      throw new Error("path contains control characters");
    }
    if (input.startsWith("/")) {
      const normalized = path.posix.normalize(input.replaceAll("\\", "/"));
      if (
        normalized === observerContainerWorkspaceRoot
        || normalized.startsWith(`${observerContainerWorkspaceRoot}/`)
        || normalized === observerContainerInputRoot
        || normalized.startsWith(`${observerContainerInputRoot}/`)
        || normalized === observerContainerOutputRoot
        || normalized.startsWith(`${observerContainerOutputRoot}/`)
      ) {
        return normalized;
      }
      throw new Error("absolute path is outside the allowed container workspace");
    }
    if (/^[A-Za-z]:[\\/]/.test(input)) {
      throw new Error("host paths are not allowed for tool calls");
    }
    const normalizedRelative = path.posix.normalize(
      input.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/^\/+/, "") || "."
    );
    if (normalizedRelative === ".." || normalizedRelative.startsWith("../")) {
      throw new Error("path escapes the allowed container workspace");
    }
    if (
      normalizedRelative === "observer-input"
      || normalizedRelative.startsWith("observer-input/")
    ) {
      const relative = normalizedRelative === "observer-input"
        ? ""
        : path.posix.normalize(normalizedRelative.slice("observer-input/".length) || ".");
      if (relative === ".." || relative.startsWith("../")) {
        throw new Error("path escapes the allowed container workspace");
      }
      return relative && relative !== "."
        ? `${observerContainerInputRoot}/${relative}`
        : observerContainerInputRoot;
    }
    if (
      normalizedRelative === "observer-output"
      || normalizedRelative.startsWith("observer-output/")
    ) {
      const relative = normalizedRelative === "observer-output"
        ? ""
        : path.posix.normalize(normalizedRelative.slice("observer-output/".length) || ".");
      if (relative === ".." || relative.startsWith("../")) {
        throw new Error("path escapes the allowed container workspace");
      }
      return relative && relative !== "."
        ? `${observerContainerOutputRoot}/${relative}`
        : observerContainerOutputRoot;
    }
    return normalizedRelative && normalizedRelative !== "."
      ? `${observerContainerWorkspaceRoot}/${normalizedRelative}`
      : observerContainerWorkspaceRoot;
  }

  function replaceMarkdownSectionByHeading(content, heading, bodyLines = []) {
    const normalizedContent = String(content || "");
    const escapedHeading = String(heading || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sectionPattern = new RegExp(`(## ${escapedHeading}\\r?\\n\\r?\\n)([\\s\\S]*?)(?=\\r?\\n## |$)`, "i");
    const replacementBody = `${bodyLines.join("\n")}\n`;
    if (sectionPattern.test(normalizedContent)) {
      return normalizedContent.replace(sectionPattern, `$1${replacementBody}`);
    }
    const trimmed = normalizedContent.trimEnd();
    return `${trimmed}${trimmed ? "\n\n" : ""}## ${heading}\n\n${replacementBody}`;
  }

  function normalizeReferenceToken(value = "") {
    return String(value || "")
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .replace(/[.?!]+$/g, "")
      .trim();
  }

  return {
    escapeRegex,
    normalizeAgentSelfReference,
    normalizeReferenceToken,
    parseEveryToMs,
    replaceMarkdownSectionByHeading,
    resolveToolPath
  };
}
