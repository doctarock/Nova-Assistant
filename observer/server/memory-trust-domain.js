export function createMemoryTrustDomain(context = {}) {
  function normalizeTrustLevel(value, fallback = "unknown") {
    const normalized = String(value || "").trim().toLowerCase();
    if (["unknown", "known", "trusted"].includes(normalized)) {
      return normalized;
    }
    return fallback;
  }

  function getTrustLevelRank(level) {
    const normalized = normalizeTrustLevel(level);
    if (normalized === "trusted") return 2;
    if (normalized === "known") return 1;
    return 0;
  }

  function trustLevelLabel(level) {
    const normalized = normalizeTrustLevel(level);
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  function isTrustLevelAtLeast(level, minimum) {
    return getTrustLevelRank(level) >= getTrustLevelRank(minimum);
  }

  function defaultAppTrustConfig() {
    return {
      emailCommandMinLevel: "trusted",
      voiceCommandMinLevel: "trusted",
      records: [],
      emailSources: [],
      voiceProfiles: []
    };
  }

  function normalizeTrustAliasList(value) {
    return Array.isArray(value)
      ? [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))]
      : [];
  }

  function normalizeTrustSignature(value) {
    return Array.isArray(value)
      ? value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry)).slice(0, 64)
      : [];
  }

  function mergeTrustNotes(...values) {
    const parts = [];
    const seen = new Set();
    for (const value of values) {
      const text = String(value || "").trim();
      if (!text) {
        continue;
      }
      const key = text.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      parts.push(text);
    }
    return parts.join("\n\n");
  }

  function hasCombinedTrustRecordData(entry = {}) {
    return Boolean(
      String(entry?.label || entry?.speakerLabel || "").trim()
      || String(entry?.email || "").trim()
      || normalizeTrustAliasList(entry?.aliases).length
      || String(entry?.notes || "").trim()
      || normalizeTrustSignature(entry?.signature).length
    );
  }

  function normalizeEmailTrustSource(entry = {}, index = 0) {
    const email = String(entry?.email || "").trim().toLowerCase();
    const label = String(entry?.label || email || `Email source ${index + 1}`).trim();
    const aliases = normalizeTrustAliasList(entry?.aliases);
    const id = String(entry?.id || `email-source-${context.hashRef(`${email}|${label}|${index}`)}`).trim();
    return {
      id,
      label,
      email,
      aliases,
      trustLevel: normalizeTrustLevel(entry?.trustLevel, "known"),
      notes: String(entry?.notes || "").trim()
    };
  }

  function normalizeVoiceTrustProfile(entry = {}, index = 0) {
    const label = String(entry?.label || `Voice profile ${index + 1}`).trim();
    const signature = normalizeTrustSignature(entry?.signature);
    const threshold = Math.max(0.45, Math.min(Number(entry?.threshold || 0.82), 0.99));
    const id = String(entry?.id || `voice-profile-${context.hashRef(`${label}|${index}`)}`).trim();
    const now = Date.now();
    return {
      id,
      label,
      trustLevel: normalizeTrustLevel(entry?.trustLevel, "known"),
      threshold,
      signature,
      notes: String(entry?.notes || "").trim(),
      capturedAt: Number(entry?.capturedAt || entry?.createdAt || (signature.length ? now : 0) || 0),
      updatedAt: Number(entry?.updatedAt || entry?.capturedAt || entry?.createdAt || (signature.length ? now : 0) || 0)
    };
  }

  function normalizeCombinedTrustRecord(entry = {}, index = 0) {
    const email = String(entry?.email || "").trim().toLowerCase();
    const fallbackLabel = email || `Trust record ${index + 1}`;
    const label = String(entry?.label || entry?.speakerLabel || fallbackLabel).trim() || fallbackLabel;
    const aliases = normalizeTrustAliasList(entry?.aliases);
    const signature = normalizeTrustSignature(entry?.signature);
    const threshold = Math.max(0.45, Math.min(Number(entry?.threshold || 0.82), 0.99));
    const id = String(
      entry?.id
      || entry?.sourceId
      || entry?.speakerId
      || `trust-record-${context.hashRef(`${email}|${label}|${index}`)}`
    ).trim();
    const now = Date.now();
    return {
      id,
      label,
      email,
      aliases,
      trustLevel: normalizeTrustLevel(entry?.trustLevel, "known"),
      threshold,
      signature,
      notes: String(entry?.notes || "").trim(),
      capturedAt: Number(entry?.capturedAt || entry?.createdAt || (signature.length ? now : 0) || 0),
      updatedAt: Number(entry?.updatedAt || entry?.capturedAt || entry?.createdAt || (signature.length ? now : 0) || 0)
    };
  }

  function mergeTrustRecord(target = {}, incoming = {}, index = 0) {
    const current = normalizeCombinedTrustRecord(target, index);
    const next = normalizeCombinedTrustRecord(incoming, index);
    const mergedAliases = [...new Set([...(Array.isArray(current.aliases) ? current.aliases : []), ...(Array.isArray(next.aliases) ? next.aliases : [])])];
    const mergedTrustLevel = getTrustLevelRank(next.trustLevel) > getTrustLevelRank(current.trustLevel)
      ? next.trustLevel
      : current.trustLevel;
    return normalizeCombinedTrustRecord({
      id: current.id || next.id,
      label: current.label || next.label,
      email: current.email || next.email,
      aliases: mergedAliases,
      trustLevel: mergedTrustLevel,
      threshold: next.signature.length ? next.threshold : current.threshold,
      signature: next.signature.length ? next.signature : current.signature,
      notes: mergeTrustNotes(current.notes, next.notes),
      capturedAt: Math.max(Number(current.capturedAt || 0), Number(next.capturedAt || 0)),
      updatedAt: Math.max(Number(current.updatedAt || 0), Number(next.updatedAt || 0))
    }, index);
  }

  function findMatchingTrustRecordIndex(records = [], entry = {}) {
    const id = String(entry?.id || entry?.sourceId || entry?.speakerId || "").trim();
    const email = String(entry?.email || "").trim().toLowerCase();
    const label = String(entry?.label || entry?.speakerLabel || "").trim().toLowerCase();
    return records.findIndex((record) => {
      const recordId = String(record?.id || "").trim();
      const recordEmail = String(record?.email || "").trim().toLowerCase();
      const recordLabel = String(record?.label || "").trim().toLowerCase();
      return (
        (id && recordId === id)
        || (email && recordEmail === email)
        || (label && recordLabel === label)
      );
    });
  }

  function upsertTrustRecord(records = [], entry = {}, index = 0) {
    const matchIndex = findMatchingTrustRecordIndex(records, entry);
    if (matchIndex >= 0) {
      records[matchIndex] = mergeTrustRecord(records[matchIndex], entry, matchIndex);
      return;
    }
    records.push(normalizeCombinedTrustRecord(entry, index));
  }

  function trustRecordsToEmailSources(records = []) {
    return records
      .filter((record) => String(record?.email || "").trim())
      .map((record, index) => normalizeEmailTrustSource(record, index));
  }

  function trustRecordsToVoiceProfiles(records = []) {
    return records
      .filter((record) => normalizeTrustSignature(record?.signature).length)
      .map((record, index) => normalizeVoiceTrustProfile(record, index));
  }

  function sanitizeTrustRecordForConfig(entry = {}, index = 0) {
    const normalized = normalizeCombinedTrustRecord(entry, index);
    return {
      ...normalized,
      signature: []
    };
  }

  function normalizeAppTrustConfig(input = {}, options = {}) {
    const trust = input && typeof input === "object" ? input : {};
    const voiceProfilesInput = Array.isArray(options?.voiceProfiles)
      ? options.voiceProfiles
      : (Array.isArray(trust?.voiceProfiles) ? trust.voiceProfiles : []);
    const records = [];
    if (Array.isArray(trust?.records)) {
      trust.records
        .filter((entry) => hasCombinedTrustRecordData(entry))
        .forEach((entry, index) => {
          upsertTrustRecord(records, entry, index);
        });
    }
    if (Array.isArray(trust?.emailSources)) {
      trust.emailSources.forEach((entry, index) => {
        const normalized = normalizeEmailTrustSource(entry, index);
        if (!normalized.email) {
          return;
        }
        upsertTrustRecord(records, normalized, records.length);
      });
    }
    voiceProfilesInput.forEach((entry, index) => {
      const normalized = normalizeVoiceTrustProfile(entry, index);
      if (!normalized.label && !normalized.signature.length) {
        return;
      }
      upsertTrustRecord(records, normalized, records.length);
    });
    return {
      emailCommandMinLevel: normalizeTrustLevel(trust?.emailCommandMinLevel, "trusted"),
      voiceCommandMinLevel: normalizeTrustLevel(trust?.voiceCommandMinLevel, "trusted"),
      records: records.map((entry, index) => normalizeCombinedTrustRecord(entry, index)),
      emailSources: trustRecordsToEmailSources(records),
      voiceProfiles: trustRecordsToVoiceProfiles(records)
    };
  }

  function getAppTrustConfig() {
    return normalizeAppTrustConfig(context.getObserverConfig()?.app?.trust, {
      voiceProfiles: Array.isArray(context.getVoicePatternStore()?.profiles) ? context.getVoicePatternStore().profiles : []
    });
  }

  function getTrustedEmailSourceRecords() {
    return Array.isArray(getAppTrustConfig().emailSources) ? getAppTrustConfig().emailSources : [];
  }

  function describeSourceTrust(sourceIdentity = {}) {
    const kind = String(sourceIdentity?.kind || "source").trim();
    const label = String(sourceIdentity?.label || sourceIdentity?.email || sourceIdentity?.speakerLabel || kind).trim() || kind;
    const trustLevel = trustLevelLabel(sourceIdentity?.trustLevel);
    return `${label} (${trustLevel})`;
  }

  function normalizeSourceIdentityRecord(value = {}, options = {}) {
    const source = value && typeof value === "object" ? value : {};
    const preserveTrustLevel = options?.preserveTrustLevel === true;
    const kind = String(source.kind || "").trim().toLowerCase();
    if (!kind) {
      return null;
    }
    const normalized = {
      kind,
      trustLevel: preserveTrustLevel
        ? normalizeTrustLevel(source.trustLevel, "unknown")
        : "unknown"
    };
    if (kind === "email") {
      normalized.email = String(source.email || "").trim().toLowerCase();
      normalized.label = String(source.label || source.email || "Email source").trim();
      normalized.sourceId = String(source.sourceId || "").trim();
      normalized.matchedBy = String(source.matchedBy || "").trim();
      if (source.command) {
        normalized.command = {
          detected: source.command.detected === true,
          action: String(source.command.action || "").trim(),
          text: context.compactTaskText(String(source.command.text || "").trim(), 400),
          reason: context.compactTaskText(String(source.command.reason || "").trim(), 220)
        };
      }
      return normalized;
    }
    if (kind === "voice") {
      normalized.speakerId = String(source.speakerId || "").trim();
      normalized.speakerLabel = String(source.speakerLabel || source.label || "Unknown speaker").trim();
      normalized.label = normalized.speakerLabel;
      normalized.similarity = Number.isFinite(Number(source.similarity)) ? Number(source.similarity) : 0;
      normalized.threshold = Number.isFinite(Number(source.threshold)) ? Number(source.threshold) : 0;
      return normalized;
    }
    normalized.label = String(source.label || kind).trim();
    return normalized;
  }

  function findMatchingEmailTrustSource({ fromName = "", fromAddress = "" } = {}) {
    const normalizedAddress = String(fromAddress || "").trim().toLowerCase();
    const normalizedName = String(fromName || "").trim().toLowerCase();
    if (!normalizedAddress && !normalizedName) {
      return null;
    }
    const sources = getTrustedEmailSourceRecords();
    for (const source of sources) {
      if (source.email && source.email === normalizedAddress) {
        return { source, matchedBy: "email" };
      }
      if (Array.isArray(source.aliases) && source.aliases.some((alias) => alias.toLowerCase() === normalizedName)) {
        return { source, matchedBy: "alias" };
      }
    }
    return null;
  }

  function assessEmailSourceIdentity({ fromName = "", fromAddress = "" } = {}) {
    const normalizedAddress = String(fromAddress || "").trim().toLowerCase();
    const normalizedName = String(fromName || "").trim();
    const match = findMatchingEmailTrustSource({ fromName, fromAddress });
    if (!match) {
      return {
        kind: "email",
        label: normalizedName || normalizedAddress || "Unknown sender",
        email: normalizedAddress,
        sourceId: "",
        matchedBy: "",
        trustLevel: "unknown"
      };
    }
    return {
      kind: "email",
      label: match.source.label || normalizedName || normalizedAddress || "Known sender",
      email: normalizedAddress || match.source.email,
      sourceId: match.source.id,
      matchedBy: match.matchedBy,
      trustLevel: normalizeTrustLevel(match.source.trustLevel, "known"),
      notes: match.source.notes || ""
    };
  }

  function inspectMailCommand(message = {}) {
    const subject = String(message.subject || "").trim();
    const text = String(message.text || "").trim();
    const prefixPattern = /^\s*(?:\[nova\]|nova)\s*(?:[:,\-]|[–—])\s*(.+)$/i;
    const subjectMatch = subject.match(prefixPattern);
    const bodyLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
    const bodyMatch = bodyLine.match(prefixPattern);
    const commandText = String(subjectMatch?.[1] || bodyMatch?.[1] || "").trim();
    return {
      detected: Boolean(commandText),
      text: context.compactTaskText(commandText, 600)
    };
  }

  function getSourceTrustPolicy(level = "unknown") {
    const trustLevel = normalizeTrustLevel(level, "unknown");
    if (trustLevel === "trusted") {
      return {
        trustLevel,
        canExecuteCommands: true,
        canRespond: true,
        canShareConfidential: true,
        requiresUserDecision: false,
        replyMode: "full"
      };
    }
    if (trustLevel === "known") {
      return {
        trustLevel,
        canExecuteCommands: false,
        canRespond: true,
        canShareConfidential: false,
        requiresUserDecision: false,
        replyMode: "safe_only"
      };
    }
    return {
      trustLevel,
      canExecuteCommands: false,
      canRespond: false,
      canShareConfidential: false,
      requiresUserDecision: true,
      replyMode: "none"
    };
  }

  function buildPromptMemoryGuidanceNote(now = Date.now()) {
    const dayKey = context.formatDayKey(now);
    const promptWorkspaceRoot = context.observerContainerWorkspaceRoot;
    const promptFilesRoot = `${context.observerContainerWorkspaceRoot}/prompt-files`;
    const promptMemoryDaily = `${context.observerContainerWorkspaceRoot}/memory/${dayKey}.md`;
    const promptQuestionsDaily = `${context.observerContainerWorkspaceRoot}/memory/questions/${dayKey}.md`;
    const promptPersonalDaily = `${context.observerContainerWorkspaceRoot}/memory/personal/${dayKey}.md`;
    const promptBriefingDaily = `${context.observerContainerWorkspaceRoot}/memory/briefings/${dayKey}.md`;
    const curatedMemoryPath = `${promptFilesRoot}/MEMORY.md`;
    const personalPath = `${promptFilesRoot}/PERSONAL.md`;
    const userPath = `${promptFilesRoot}/USER.md`;
    const todayBriefingPath = `${promptFilesRoot}/TODAY.md`;
    return [
      `Persistent memory workspace: ${promptWorkspaceRoot}`,
      `Prompt files: ${promptFilesRoot}`,
      `Daily memory log: ${promptMemoryDaily}`,
      `Daily question log: ${promptQuestionsDaily}`,
      `Daily personal notes: ${promptPersonalDaily}`,
      `Daily briefing archive: ${promptBriefingDaily}`,
      `Current daily briefing: ${todayBriefingPath}`,
      `Curated memory: ${curatedMemoryPath}`,
      `Personal memory: ${personalPath}`,
      `User profile: ${userPath}`,
      "If a user asks you to remember something, or you establish a lasting preference, workflow, or standing instruction, update the relevant memory file instead of relying on session memory."
    ].join("\n");
  }

  async function ensurePromptWorkspaceScaffolding(now = Date.now()) {
    const dayKey = context.formatDayKey(now);
    await context.fs.mkdir(context.promptFilesRoot, { recursive: true });
    await context.fs.mkdir(context.promptProjectsRoot, { recursive: true });
    await context.fs.mkdir(context.promptMemoryDailyRoot, { recursive: true });
    await context.fs.mkdir(context.promptMemoryQuestionsRoot, { recursive: true });
    await context.fs.mkdir(context.promptMemoryPersonalDailyRoot, { recursive: true });
    await context.fs.mkdir(context.promptMemoryBriefingsRoot, { recursive: true });
    const legacyPromptFiles = [
      ["AGENTS.md", context.path.join(context.promptFilesRoot, "AGENTS.md")],
      ["USER.md", context.promptUserPath],
      ["MEMORY.md", context.promptMemoryCuratedPath],
      ["PERSONAL.md", context.promptPersonalPath],
      ["MAIL-RULES.md", context.promptMailRulesPath],
      ["SOUL.md", context.path.join(context.promptFilesRoot, "SOUL.md")],
      ["TODAY.md", context.promptTodayBriefingPath],
      ["TOOLS.md", context.path.join(context.promptFilesRoot, "TOOLS.md")]
    ];
    for (const [fileName, nextPath] of legacyPromptFiles) {
      const legacyPath = context.path.join(context.observerContainerWorkspaceRoot, fileName);
      const targetExists = await context.fs.access(nextPath).then(() => true).catch(() => false);
      const legacyExists = await context.fs.access(legacyPath).then(() => true).catch(() => false);
      if (!legacyExists) continue;
      if (!targetExists) {
        await context.fs.rename(legacyPath, nextPath).catch(async () => {
          const legacyContent = await context.fs.readFile(legacyPath, "utf8");
          await context.fs.writeFile(nextPath, legacyContent, "utf8");
          await context.fs.rm(legacyPath, { force: true });
        });
      } else {
        await context.fs.rm(legacyPath, { force: true });
      }
    }
    const rootPromptDuplicates = [
      context.path.join(context.observerContainerWorkspaceRoot, "AGENTS.md"),
      context.path.join(context.observerContainerWorkspaceRoot, "USER.md"),
      context.path.join(context.observerContainerWorkspaceRoot, "MEMORY.md"),
      context.path.join(context.observerContainerWorkspaceRoot, "PERSONAL.md"),
      context.path.join(context.observerContainerWorkspaceRoot, "MAIL-RULES.md"),
      context.path.join(context.observerContainerWorkspaceRoot, "SOUL.md"),
      context.path.join(context.observerContainerWorkspaceRoot, "TODAY.md"),
      context.path.join(context.observerContainerWorkspaceRoot, "TOOLS.md")
    ];
    await Promise.all(rootPromptDuplicates.map((filePath) => context.fs.rm(filePath, { force: true })));
    const rootEntries = await context.fs.readdir(context.observerContainerWorkspaceRoot, { withFileTypes: true }).catch(() => []);
    const blockedProjectDirs = new Set(["memory", "prompt-files", "projects", "skills"]);
    for (const entry of rootEntries) {
      if (!entry?.isDirectory?.()) continue;
      const entryName = String(entry.name || "").trim();
      if (!entryName || entryName.startsWith(".") || blockedProjectDirs.has(entryName)) continue;
      const candidatePath = context.path.join(context.observerContainerWorkspaceRoot, entryName);
      const markerPath = context.path.join(candidatePath, ".observer-project.json");
      const todoPath = context.path.join(candidatePath, "PROJECT-TODO.md");
      const roleTasksPath = context.path.join(candidatePath, "PROJECT-ROLE-TASKS.md");
      const hasProjectFiles = await context.fs.access(markerPath).then(() => true).catch(async () => (
        await context.fs.access(todoPath).then(() => true).catch(() =>
          context.fs.access(roleTasksPath).then(() => true).catch(() => false)
        )
      ));
      if (!hasProjectFiles) continue;
      const targetPath = context.path.join(context.promptProjectsRoot, entryName);
      const targetExists = await context.fs.access(targetPath).then(() => true).catch(() => false);
      if (targetExists) continue;
      await context.fs.rename(candidatePath, targetPath).catch(() => null);
    }
    await context.ensureVolumeFile(context.promptUserPath, [
      "# USER.md",
      "",
      "Core facts about the human Nova is helping.",
      "",
      "## Identity",
      "",
      "- Name:",
      "- Preferred short name:",
      "- Timezone: Australia/Sydney",
      "",
      "## Ongoing Priorities",
      "",
      "-",
      "",
      "## Communication Preferences",
      "",
      "-",
      ""
    ].join("\n"));
    await context.ensureVolumeFile(context.promptMemoryCuratedPath, [
      "# MEMORY.md",
      "",
      "Curated long-term memory for Nova.",
      "",
      "## Stable Facts",
      "",
      "-",
      "",
      "## Preferences",
      "",
      "-",
      "",
      "## Ongoing Projects",
      "",
      "-",
      ""
    ].join("\n"));
    await context.ensureVolumeFile(context.promptPersonalPath, [
      "# PERSONAL.md",
      "",
      "Private personal context, taste, and standing preferences that should persist over time.",
      "",
      "## Personal Preferences",
      "",
      "-",
      "",
      "## Relationships",
      "",
      "-",
      "",
      "## Standing Instructions",
      "",
      "-",
      ""
    ].join("\n"));
    await context.ensureVolumeFile(context.promptMailRulesPath, [
      "# MAIL-RULES.md",
      "",
      "Standing email-management rules, inbox preferences, and durable mail-handling instructions for Nova.",
      "",
      "## Standing Rules",
      "",
      "-",
      "",
      "## Sender Preferences",
      "",
      "-",
      "",
      "## Escalation Preferences",
      "",
      "-",
      ""
    ].join("\n"));
    await context.ensureVolumeFile(context.promptMemoryReadmePath, [
      "# Memory Layout",
      "",
      "- `prompt-files/*.md` -> curated prompt documents for the agent workspace",
      "- `projects/*` -> active project workspaces for the agent",
      "- `memory/YYYY-MM-DD.md` -> daily operational notes",
      "- `memory/questions/YYYY-MM-DD.md` -> daily question and process-code log",
      "- `memory/personal/YYYY-MM-DD.md` -> daily personal/private notes worth revisiting",
      "- `memory/briefings/YYYY-MM-DD.md` -> daily native briefing assembled from indexed documents and activity",
      "- `prompt-files/MEMORY.md` -> curated long-term memory",
      "- `prompt-files/MAIL-RULES.md` -> standing email-management rules and inbox preferences",
      "- `prompt-files/PERSONAL.md` -> persistent personal context and preferences",
      "- `prompt-files/USER.md` -> user profile and stable human context",
      "- `prompt-files/TODAY.md` -> current daily briefing",
      ""
    ].join("\n"));
    await context.ensureVolumeFile(context.promptTodayBriefingPath, [
      "# Daily Briefing",
      "",
      "No briefing has been generated yet.",
      ""
    ].join("\n"));
    await context.ensureVolumeFile(context.path.join(context.promptMemoryDailyRoot, `${dayKey}.md`), [
      `# ${dayKey}`,
      "",
      "## Highlights",
      "",
      "-",
      "",
      "## Decisions",
      "",
      "-",
      ""
    ].join("\n"));
    await context.ensureVolumeFile(context.path.join(context.promptMemoryQuestionsRoot, `${dayKey}.md`), [
      `# Question Log ${dayKey}`,
      "",
      "Daily record of incoming requests and the process codes they were attached to.",
      ""
    ].join("\n"));
    await context.ensureVolumeFile(context.path.join(context.promptMemoryPersonalDailyRoot, `${dayKey}.md`), [
      `# Personal Notes ${dayKey}`,
      "",
      "Daily personal notes, preferences, and relationship context worth retaining.",
      ""
    ].join("\n"));
    await context.ensureVolumeFile(context.path.join(context.promptMemoryBriefingsRoot, `${dayKey}.md`), [
      `# Daily Briefing ${dayKey}`,
      "",
      "No briefing has been generated yet.",
      ""
    ].join("\n"));
    await context.saveDocumentRulesState();
  }

  function normalizeMemoryBulletValue(value = "") {
    return context.compactTaskText(String(value || "").replace(/\s+/g, " ").trim(), 240);
  }

  function parseMarkdownFieldValue(content = "", label = "") {
    const pattern = new RegExp(`^\\s*-\\s*${context.escapeRegex(label)}:\\s*(.*)\\s*$`, "im");
    const match = String(content || "").match(pattern);
    return match ? String(match[1] || "").trim() : "";
  }

  function updateMarkdownFieldValue(content = "", label = "", value = "") {
    const normalizedValue = String(value || "").trim();
    const pattern = new RegExp(`^(\\s*-\\s*${context.escapeRegex(label)}:\\s*)(.*)$`, "im");
    if (pattern.test(String(content || ""))) {
      return String(content || "").replace(pattern, `$1${normalizedValue}`);
    }
    return String(content || "");
  }

  function getMarkdownSectionInfo(content = "", sectionTitle = "") {
    const lines = String(content || "").split(/\r?\n/);
    const heading = `## ${String(sectionTitle || "").trim()}`;
    const startIndex = lines.findIndex((line) => line.trim() === heading);
    if (startIndex === -1) {
      return { lines, startIndex: -1, endIndex: lines.length, bullets: [] };
    }
    let endIndex = lines.length;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index].trim())) {
        endIndex = index;
        break;
      }
    }
    const bullets = lines
      .slice(startIndex + 1, endIndex)
      .map((line) => line.match(/^\s*-\s*(.*)\s*$/))
      .filter(Boolean)
      .map((match) => String(match[1] || "").trim())
      .filter((value) => value && value !== "-");
    return { lines, startIndex, endIndex, bullets };
  }

  function upsertMarkdownSectionBullet(content = "", sectionTitle = "", bulletValue = "", { replacePlaceholder = true } = {}) {
    const normalizedBullet = normalizeMemoryBulletValue(bulletValue);
    if (!normalizedBullet) {
      return String(content || "");
    }
    const { lines, startIndex, endIndex, bullets } = getMarkdownSectionInfo(content, sectionTitle);
    if (startIndex === -1) {
      return String(content || "");
    }
    if (bullets.some((entry) => entry.toLowerCase() === normalizedBullet.toLowerCase())) {
      return String(content || "");
    }
    if (replacePlaceholder) {
      for (let index = startIndex + 1; index < endIndex; index += 1) {
        if (/^\s*-\s*$/.test(lines[index])) {
          lines[index] = `- ${normalizedBullet}`;
          return `${lines.join("\n").replace(/\s+$/, "")}\n`;
        }
      }
    }
    lines.splice(endIndex, 0, `- ${normalizedBullet}`);
    return `${lines.join("\n").replace(/\s+$/, "")}\n`;
  }

  const QUESTION_MAINTENANCE_TARGETS = [
    { key: "user_name", fileName: "USER.md", mode: "field", label: "Name", question: "What name should I record for you in USER.md?" },
    { key: "user_short_name", fileName: "USER.md", mode: "field", label: "Preferred short name", question: "What short name should I use for you by default?" },
    { key: "user_priorities", fileName: "USER.md", mode: "section", section: "Ongoing Priorities", question: "What is one current ongoing priority I should record for you?" },
    { key: "user_communication", fileName: "USER.md", mode: "section", section: "Communication Preferences", question: "How would you like me to present updates and results by default?" },
    { key: "memory_stable_facts", fileName: "MEMORY.md", mode: "section", section: "Stable Facts", question: "What is one stable fact about you or your situation that I should remember long-term?" },
    { key: "memory_preferences", fileName: "MEMORY.md", mode: "section", section: "Preferences", question: "What is one preference or workflow habit I should keep in MEMORY.md?" },
    { key: "memory_projects", fileName: "MEMORY.md", mode: "section", section: "Ongoing Projects", question: "Which ongoing project should I record as important right now?" },
    { key: "personal_preferences", fileName: "PERSONAL.md", mode: "section", section: "Personal Preferences", question: "What is one personal preference or taste I should remember?" },
    { key: "personal_standing_instructions", fileName: "PERSONAL.md", mode: "section", section: "Standing Instructions", question: "What is one standing instruction you want me to keep following automatically?" }
  ];

  const QUESTION_MAINTENANCE_EXPANSIONS = [
    { key: "expand_priorities", fileName: "USER.md", mode: "section", section: "Ongoing Priorities", question: "What is another current priority I should keep in mind for you?" },
    { key: "expand_communication", fileName: "USER.md", mode: "section", section: "Communication Preferences", question: "What is another communication preference I should follow by default?" },
    { key: "expand_memory_projects", fileName: "MEMORY.md", mode: "section", section: "Ongoing Projects", question: "What is another ongoing project or area I should track in memory?" },
    { key: "expand_standing_instructions", fileName: "PERSONAL.md", mode: "section", section: "Standing Instructions", question: "What is another standing instruction or habit you want me to follow?" }
  ];

  function getQuestionMaintenanceTargetState(target, fileContents) {
    const content = String(fileContents[target.fileName] || "");
    if (target.mode === "field") {
      return {
        complete: Boolean(parseMarkdownFieldValue(content, target.label)),
        currentValue: parseMarkdownFieldValue(content, target.label)
      };
    }
    const info = getMarkdownSectionInfo(content, target.section);
    return {
      complete: info.bullets.length > 0,
      currentValue: info.bullets.join("; ")
    };
  }

  function applyQuestionMaintenanceAnswer(target, answer, fileContents) {
    const normalizedAnswer = normalizeMemoryBulletValue(answer);
    if (!normalizedAnswer) {
      return { updated: false, fileContents, note: "Answer was empty." };
    }
    const nextContents = { ...fileContents };
    const existing = String(nextContents[target.fileName] || "");
    let updatedContent = existing;
    if (target.mode === "field") {
      updatedContent = updateMarkdownFieldValue(existing, target.label, normalizedAnswer);
    } else {
      updatedContent = upsertMarkdownSectionBullet(existing, target.section, normalizedAnswer, { replacePlaceholder: true });
    }
    if (updatedContent === existing) {
      return { updated: false, fileContents: nextContents, note: "Answer did not change the target file." };
    }
    nextContents[target.fileName] = updatedContent;
    return { updated: true, fileContents: nextContents, note: `Updated ${target.fileName}.` };
  }

  function chooseQuestionMaintenanceTarget(fileContents, task = {}) {
    const recentTargetKeys = new Set(
      Array.isArray(task.recentQuestionTargetKeys)
        ? task.recentQuestionTargetKeys.map((value) => String(value || "").trim()).filter(Boolean)
        : []
    );
    const incompleteTargets = [];
    for (const target of QUESTION_MAINTENANCE_TARGETS) {
      const state = getQuestionMaintenanceTargetState(target, fileContents);
      if (!state.complete) {
        incompleteTargets.push(target);
      }
    }
    const nextIncomplete = incompleteTargets.find((target) => !recentTargetKeys.has(target.key));
    if (nextIncomplete) {
      return nextIncomplete;
    }
    if (incompleteTargets.length) {
      return incompleteTargets[0];
    }
    const rotationIndex = Math.max(0, Number(task.questionCycleIndex || 0));
    const expansionTargets = QUESTION_MAINTENANCE_EXPANSIONS.filter((target) => !recentTargetKeys.has(target.key));
    const activeExpansions = expansionTargets.length ? expansionTargets : QUESTION_MAINTENANCE_EXPANSIONS;
    return activeExpansions[rotationIndex % activeExpansions.length] || activeExpansions[0] || null;
  }

  async function appendDailyQuestionLog({
    message,
    sessionId = "Main",
    route = "",
    taskRefs = [],
    notes = ""
  } = {}) {
    const text = context.compactTaskText(String(message || "").replace(/\s+/g, " ").trim(), 280);
    if (!text) {
      return;
    }
    const now = Date.now();
    const dayKey = context.formatDayKey(now);
    await ensurePromptWorkspaceScaffolding(now);
    const logPath = context.path.join(context.promptMemoryQuestionsRoot, `${dayKey}.md`);
    const processCodes = Array.isArray(taskRefs)
      ? taskRefs.map((task) => task?.codename || task?.id).filter(Boolean)
      : [];
    const entry = [
      "",
      `## ${context.formatTimeForUser(now)}`,
      `- Question: ${text}`,
      `- Session: ${String(sessionId || "Main").trim() || "Main"}`,
      `- Route: ${route || "unspecified"}`,
      `- Process codes: ${processCodes.join(", ") || "none"}`,
      notes ? `- Notes: ${context.compactTaskText(String(notes || "").replace(/\s+/g, " ").trim(), 280)}` : null
    ].filter(Boolean).join("\n");
    await context.appendVolumeText(logPath, `${entry}\n`);
  }

  async function appendDailyOperationalMemory(title, lines = [], now = Date.now()) {
    const heading = context.compactTaskText(String(title || "").replace(/\s+/g, " ").trim(), 220);
    const bodyLines = Array.isArray(lines)
      ? lines.map((line) => context.compactTaskText(String(line || "").replace(/\s+/g, " ").trim(), 260)).filter(Boolean)
      : [];
    if (!heading || !bodyLines.length) {
      return;
    }
    const dayKey = context.formatDayKey(now);
    await ensurePromptWorkspaceScaffolding(now);
    const logPath = context.path.join(context.promptMemoryDailyRoot, `${dayKey}.md`);
    const entry = [
      "",
      `## Queue Maintenance ${context.formatTimeForUser(now)}`,
      `- Summary: ${heading}`,
      ...bodyLines.map((line) => `- ${line}`)
    ].join("\n");
    await context.appendVolumeText(logPath, `${entry}\n`);
  }

  async function appendDailyAssistantMemory(sectionTitle, title, lines = [], now = Date.now()) {
    const heading = context.compactTaskText(String(title || "").replace(/\s+/g, " ").trim(), 220);
    const bodyLines = Array.isArray(lines)
      ? lines.map((line) => context.compactTaskText(String(line || "").replace(/\s+/g, " ").trim(), 260)).filter(Boolean)
      : [];
    if (!heading || !bodyLines.length) {
      return;
    }
    const dayKey = context.formatDayKey(now);
    await ensurePromptWorkspaceScaffolding(now);
    const logPath = context.path.join(context.promptMemoryDailyRoot, `${dayKey}.md`);
    const entry = [
      "",
      `## ${context.compactTaskText(String(sectionTitle || "Operational Memory"), 80)} ${context.formatTimeForUser(now)}`,
      `- Summary: ${heading}`,
      ...bodyLines.map((line) => `- ${line}`)
    ].join("\n");
    await context.appendVolumeText(logPath, `${entry}\n`);
  }

  async function backfillRecentMaintenanceMemory(limit = 12) {
    try {
      const raw = await context.fs.readFile(context.queueMaintenanceLogPath, "utf8");
      const sections = raw
        .split(/^## /m)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
          const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          const stampText = lines.shift() || "";
          const title = lines.shift() || "";
          const details = lines
            .filter((line) => line.startsWith("- "))
            .map((line) => line.slice(2).trim())
            .filter(Boolean);
          return {
            stampText,
            title,
            details
          };
        })
        .filter((entry) => entry.title && entry.details.length)
        .filter((entry) => entry.details.some((line) => /^(Closed|Advanced|Archived)\b/i.test(line)));
      if (!sections.length) {
        return 0;
      }
      const now = Date.now();
      const dayKey = context.formatDayKey(now);
      await ensurePromptWorkspaceScaffolding(now);
      const dailyPath = context.path.join(context.promptMemoryDailyRoot, `${dayKey}.md`);
      let dailyContent = "";
      try {
        dailyContent = await context.fs.readFile(dailyPath, "utf8");
      } catch {
        dailyContent = "";
      }
      let appended = 0;
      for (const entry of sections.slice(-Math.max(1, limit))) {
        if (dailyContent.includes(`- Summary: ${entry.title}`)) {
          continue;
        }
        const stampAt = Number.isFinite(Date.parse(entry.stampText)) ? Date.parse(entry.stampText) : now;
        await appendDailyOperationalMemory(entry.title, entry.details, stampAt);
        dailyContent += `\n- Summary: ${entry.title}\n`;
        appended += 1;
      }
      return appended;
    } catch {
      return 0;
    }
  }

  async function appendRepairLesson({
    timestamp = new Date().toISOString(),
    taskMessage = "",
    repeatedCalls = "",
    repairNote = ""
  } = {}) {
    try {
      const lessonsPath = context.path.join(context.promptFilesRoot, "LOOP-LESSONS.md");
      const compact = (s, n) => String(s || "").replace(/\s+/g, " ").slice(0, n).trim();
      const entry = [
        `## ${timestamp}`,
        compact(taskMessage, 200) ? `- Task: ${compact(taskMessage, 200)}` : "",
        compact(repeatedCalls, 300) ? `- Stuck on: ${compact(repeatedCalls, 300)}` : "",
        repairNote ? `- Repair: ${compact(repairNote, 200)}` : "",
        ""
      ].filter(Boolean).join("\n") + "\n";
      const existing = await context.fs.readFile(lessonsPath, "utf8").catch(() => "");
      if (!existing.trim()) {
        await context.fs.writeFile(lessonsPath, `# Loop Repair Lessons\n\nPatterns that caused tool loop repairs. Avoid repeating these.\n\n${entry}`, "utf8");
      } else {
        await context.fs.appendFile(lessonsPath, entry, "utf8");
      }
    } catch {
      // non-fatal
    }
  }

  return {
    QUESTION_MAINTENANCE_EXPANSIONS,
    QUESTION_MAINTENANCE_TARGETS,
    appendDailyAssistantMemory,
    appendDailyOperationalMemory,
    appendRepairLesson,
    appendDailyQuestionLog,
    applyQuestionMaintenanceAnswer,
    assessEmailSourceIdentity,
    backfillRecentMaintenanceMemory,
    buildPromptMemoryGuidanceNote,
    chooseQuestionMaintenanceTarget,
    defaultAppTrustConfig,
    describeSourceTrust,
    ensurePromptWorkspaceScaffolding,
    findMatchingEmailTrustSource,
    findMatchingTrustRecordIndex,
    getAppTrustConfig,
    getMarkdownSectionInfo,
    getQuestionMaintenanceTargetState,
    getSourceTrustPolicy,
    getTrustedEmailSourceRecords,
    getTrustLevelRank,
    hasCombinedTrustRecordData,
    inspectMailCommand,
    isTrustLevelAtLeast,
    mergeTrustNotes,
    mergeTrustRecord,
    normalizeAppTrustConfig,
    normalizeCombinedTrustRecord,
    normalizeEmailTrustSource,
    normalizeMemoryBulletValue,
    normalizeSourceIdentityRecord,
    normalizeTrustAliasList,
    normalizeTrustLevel,
    normalizeTrustSignature,
    normalizeVoiceTrustProfile,
    parseMarkdownFieldValue,
    sanitizeTrustRecordForConfig,
    trustLevelLabel,
    trustRecordsToEmailSources,
    trustRecordsToVoiceProfiles,
    updateMarkdownFieldValue,
    upsertMarkdownSectionBullet,
    upsertTrustRecord
  };
}
