import { createRetrievalDomain } from "./retrieval-domain.js";

export function createObserverDocumentDomain(options = {}) {
  const {
    buildChunkedTextPayload = (text = "", _args = {}) => ({ content: String(text || ""), chunk: null }),
    compactTaskText = (value = "") => String(value || ""),
    createInitialDocumentRulesState = () => ({}),
    defaultQdrantCollection = "observer_chunks",
    defaultQdrantUrl = "http://127.0.0.1:6333",
    documentIndexPath = "",
    ensurePromptWorkspaceScaffolding = async () => {},
    formatDayKey = (value = Date.now()) => new Date(value).toISOString().slice(0, 10),
    fs = null,
    getDocumentRulesState = () => createInitialDocumentRulesState(),
    getOllamaEndpointHealth = async () => ({ running: false }),
    getRetrievalConfig = () => ({ qdrantUrl: defaultQdrantUrl, collectionName: defaultQdrantCollection }),
    hasQdrantApiKey = async () => false,
    hashRef = (value = "") => String(value || ""),
    listAvailableBrains = async () => [],
    listRecursiveFiles = async () => [],
    maxDocumentSourceBytes = 12 * 1024 * 1024,
    observerAttachmentsRoot = "",
    observerOutputRoot = "",
    pathModule = null,
    promptMemoryBriefingsRoot = "",
    promptTodayBriefingPath = "",
    readContainerFileBuffer = async () => ({ contentBase64: "", size: 0 }),
    resolveQdrantApiKey = async () => "",
    resolveToolPath = (value = "") => String(value || ""),
    retrievalStatePath = "",
    runOllamaEmbed = async () => [],
    simpleParser = null,
    workspaceRoot = "",
    writeVolumeText = async () => {},
    cosineSimilarity = () => 0
  } = options;

  function decodeBasicHtmlEntities(text = "") {
    return String(text || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'");
  }

  function stripHtmlToText(html = "") {
    return decodeBasicHtmlEntities(String(html || ""))
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|tr|td|th|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function isLikelyBinaryBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      return false;
    }
    const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
    let suspicious = 0;
    for (const byte of sample) {
      if (byte === 0) {
        return true;
      }
      if (byte < 7 || (byte > 14 && byte < 32)) {
        suspicious += 1;
      }
    }
    return suspicious > sample.length * 0.2;
  }

  function normalizeDocumentWhitespace(text = "") {
    return String(text || "")
      .replace(/\r/g, "")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function normalizeDocumentContent({
    buffer,
    sourceLabel = "",
    contentType = "",
    sourceName = ""
  } = {}) {
    const mime = String(contentType || "").toLowerCase().split(";")[0].trim();
    const lowerName = String(sourceName || sourceLabel || "").toLowerCase();
    const ext = pathModule.extname(lowerName);
    const warnings = [];

    if (!Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(String(buffer || ""), "utf8");
    }

    if (!buffer.length) {
      return {
        kind: "empty",
        contentType: mime,
        text: "",
        warnings,
        sourceLabel: sourceLabel || sourceName || "(unknown)"
      };
    }

    if (buffer.length > maxDocumentSourceBytes) {
      warnings.push(`source exceeded ${maxDocumentSourceBytes} bytes and was not normalized`);
      return {
        kind: "oversized",
        contentType: mime,
        text: `Document metadata only.\nSource: ${sourceLabel || sourceName || "(unknown)"}\nBytes: ${buffer.length}\nReason: source too large for direct normalization.`,
        warnings,
        sourceLabel: sourceLabel || sourceName || "(unknown)"
      };
    }

    if ((mime === "message/rfc822" || ext === ".eml") && simpleParser) {
      try {
        const parsed = await simpleParser(buffer);
        const body = normalizeDocumentWhitespace(parsed.text || stripHtmlToText(parsed.html || ""));
        const text = [
          `Email subject: ${parsed.subject || "(no subject)"}`,
          parsed.from?.text ? `From: ${parsed.from.text}` : "",
          parsed.to?.text ? `To: ${parsed.to.text}` : "",
          body ? `Body:\n${body}` : "Body: (empty)"
        ].filter(Boolean).join("\n");
        return {
          kind: "email",
          contentType: mime || "message/rfc822",
          text,
          warnings,
          sourceLabel: sourceLabel || sourceName || "(unknown)"
        };
      } catch (error) {
        warnings.push(`email parsing fell back to plain text: ${error.message}`);
      }
    }

    const htmlLike = mime === "text/html" || mime === "application/xhtml+xml" || [".html", ".htm", ".xhtml"].includes(ext);
    const jsonLike = mime === "application/json" || [".json", ".jsonc"].includes(ext);
    const markdownLike = mime === "text/markdown" || [".md", ".markdown", ".mdx"].includes(ext);
    const csvLike = mime === "text/csv" || [".csv", ".tsv"].includes(ext);
    const xmlLike = mime === "application/xml" || mime === "text/xml" || [".xml", ".svg"].includes(ext);
    const textLike = mime.startsWith("text/")
      || markdownLike
      || jsonLike
      || csvLike
      || xmlLike
      || [".txt", ".log", ".js", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".css", ".scss", ".yml", ".yaml", ".ini", ".toml", ".sh", ".ps1"].includes(ext);

    if (!textLike && isLikelyBinaryBuffer(buffer)) {
      warnings.push("binary document type is not directly supported yet");
      return {
        kind: "binary",
        contentType: mime || "application/octet-stream",
        text: `Document metadata only.\nSource: ${sourceLabel || sourceName || "(unknown)"}\nType: ${mime || ext || "binary"}\nBytes: ${buffer.length}\nReason: binary document extraction is not available yet.`,
        warnings,
        sourceLabel: sourceLabel || sourceName || "(unknown)"
      };
    }

    let text = buffer.toString("utf8");
    let kind = "text";

    if (htmlLike) {
      kind = "html";
      text = stripHtmlToText(text);
    } else if (jsonLike) {
      kind = "json";
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        text = normalizeDocumentWhitespace(text);
        warnings.push("json formatting failed, using raw text");
      }
    } else if (markdownLike) {
      kind = "markdown";
      text = normalizeDocumentWhitespace(text);
    } else if (csvLike) {
      kind = "table";
      text = normalizeDocumentWhitespace(text);
    } else if (xmlLike) {
      kind = "xml";
      text = normalizeDocumentWhitespace(text);
    } else {
      text = normalizeDocumentWhitespace(text);
    }

    return {
      kind,
      contentType: mime || (htmlLike ? "text/html" : textLike ? "text/plain" : ""),
      text,
      warnings,
      sourceLabel: sourceLabel || sourceName || "(unknown)"
    };
  }

  function buildDocumentToolResponse({
    sourceLabel = "",
    sourceName = "",
    contentType = "",
    normalized,
    args = {},
    extra = {}
  } = {}) {
    const chunked = buildChunkedTextPayload(normalized?.text || "", args);
    return {
      source: sourceLabel || sourceName || "(unknown)",
      kind: normalized?.kind || "text",
      contentType: normalized?.contentType || contentType || "",
      content: chunked.content,
      chunk: chunked.chunk,
      warnings: Array.isArray(normalized?.warnings) ? normalized.warnings : [],
      ...extra
    };
  }

  function isImageMimeType(value = "") {
    return /^image\//i.test(String(value || "").trim());
  }

  async function buildVisionImagesFromAttachments(attachments = []) {
    const imageAttachments = Array.isArray(attachments)
      ? attachments.filter((attachment) => isImageMimeType(attachment?.type || ""))
      : [];
    if (!imageAttachments.length) {
      return [];
    }
    const images = [];
    for (const attachment of imageAttachments.slice(0, 6)) {
      try {
        const file = await readContainerFileBuffer(String(attachment.containerPath || "").trim());
        const contentBase64 = String(file?.contentBase64 || "").trim();
        if (contentBase64) {
          images.push(contentBase64);
        }
      } catch {
        // Ignore unreadable image attachments.
      }
    }
    return images;
  }

  function getDocumentCandidateExtensions() {
    return [
      ".md", ".markdown", ".mdx", ".txt", ".log", ".json", ".jsonc", ".csv", ".tsv", ".xml", ".html", ".htm", ".xhtml",
      ".eml", ".yml", ".yaml", ".toml", ".ini", ".doc", ".docx", ".pdf", ".rtf"
    ];
  }

  function normalizeDocumentPathForRules(filePath = "") {
    return String(filePath || "").replace(/\//g, "\\").toLowerCase();
  }

  function isObserverOutputDocumentPath(filePath = "") {
    const lower = normalizeDocumentPathForRules(filePath);
    return lower.includes("\\observer-output\\");
  }

  function isGeneratedObserverArtifactPath(filePath = "") {
    const lower = normalizeDocumentPathForRules(filePath);
    const basename = pathModule.basename(lower);
    return isObserverOutputDocumentPath(lower) && (
      /^task-\d+.*\.(txt|md|json)$/i.test(basename)
      || /(?:^|[-_])(summary|status|briefing|heartbeat|cleanup|maintenance|progress|report)(?:[-_]|\.|$)/i.test(basename)
      || basename === "today.md"
    );
  }

  function isAssistantPrimaryDocumentPath(filePath = "") {
    const lower = normalizeDocumentPathForRules(filePath);
    const preferredTerms = Array.isArray(getDocumentRulesState()?.preferredPathTerms) ? getDocumentRulesState().preferredPathTerms : [];
    return lower.includes("\\observer-attachments\\")
      || preferredTerms.some((term) => term && lower.includes(String(term).toLowerCase()));
  }

  function isLowValueRepositoryDocument(filePath = "") {
    const lower = normalizeDocumentPathForRules(filePath);
    const basename = pathModule.basename(lower);
    const basenameNoExt = basename.replace(pathModule.extname(basename), "");
    const ignoredNames = Array.isArray(getDocumentRulesState()?.ignoredFileNamePatterns)
      ? getDocumentRulesState().ignoredFileNamePatterns
      : [];
    if (isAssistantPrimaryDocumentPath(lower)) {
      return false;
    }
    return ignoredNames.some((term) => term && (basename === term || basenameNoExt === term || basename.includes(term)));
  }

  function shouldIgnoreDocumentPath(filePath = "") {
    const lower = normalizeDocumentPathForRules(filePath);
    const ignoredTerms = Array.isArray(getDocumentRulesState()?.ignoredPathTerms) ? getDocumentRulesState().ignoredPathTerms : [];
    if (ignoredTerms.some((term) => term && lower.includes(term))) {
      return true;
    }
    if (isLowValueRepositoryDocument(lower)) {
      return true;
    }
    return [
      "\\openclaw-observer\\.agent-workspaces\\",
      "\\openclaw-observer\\workspace-prompt-edit\\",
      "\\openclaw-observer\\workspace-prompt-edit\\memory\\questions\\",
      "\\openclaw-observer\\workspace-prompt-edit\\memory\\briefings\\",
      "\\openclaw-observer\\workspace-prompt-edit\\today.md",
      "\\openclaw-observer\\workspace-prompt-edit\\memory\\202",
      "\\openclaw-observer\\package-lock.json",
      "\\openclaw-observer\\observer.language.json",
      "\\openclaw-observer\\observer.lexicon.json",
      "\\openclaw-observer\\server.js",
      "\\openclaw-observer\\public\\"
    ].some((term) => lower.includes(term));
  }

  function detectDocumentCategory({ relativePath = "", text = "", kind = "" } = {}) {
    const lower = `${relativePath}\n${text}`.toLowerCase();
    if (/\b(meeting|appointment|calendar|schedule|agenda|timeslot|booking)\b/.test(lower)) return "schedule";
    if (/\b(contract|agreement|terms|policy|nda)\b/.test(lower)) return "legal";
    if (kind === "email" || /\bfrom:|to:|email subject:\b/.test(lower)) return "mail";
    if (/\b(todo|task|follow up|follow-up|action items?|next step|handoff)\b/.test(lower)) return "action";
    if (/\b(notes|journal|memory|personal)\b/.test(lower)) return "notes";
    if (/\b(project|roadmap|todo|tasks|milestone|backlog|handoff)\b/.test(lower)) return "project";
    return "general";
  }

  function normalizeDateCandidate(raw = "") {
    const value = String(raw || "").trim();
    if (!value) return null;
    let parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (slashMatch) {
        const day = Number(slashMatch[1]);
        const month = Number(slashMatch[2]) - 1;
        const year = Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]);
        parsed = new Date(year, month, day).getTime();
      }
    }
    if (!Number.isFinite(parsed)) return null;
    const iso = new Date(parsed);
    if (Number.isNaN(iso.getTime())) return null;
    return iso.toISOString();
  }

  function extractDocumentSignals({ text = "", relativePath = "", modifiedAt = 0 } = {}) {
    const normalizedText = normalizeDocumentWhitespace(String(text || ""));
    const compact = normalizedText.slice(0, 24000);
    const lower = `${relativePath}\n${compact}`.toLowerCase();
    const extension = pathModule.extname(relativePath).toLowerCase();
    const lines = normalizedText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const heading = lines.find((line) => /^#{1,6}\s+/.test(line))?.replace(/^#{1,6}\s+/, "").trim()
      || lines.find(Boolean)
      || pathModule.basename(relativePath || "document");
    const summary = compactTaskText(lines.find((line) => line && !/^[-*]\s/.test(line)) || heading, 200);

    const dueDates = [];
    const dateContextLines = lines
      .filter((line) => /\b(due|deadline|follow up|follow-up|review by|pay by|renew|meeting|appointment|schedule|invoice|bill)\b/i.test(line)
        || /\b(invoice|bill|calendar|meeting|appointment|renewal)\b/i.test(relativePath))
      .slice(0, 40);
    const dateValuePattern = /\b([A-Z][a-z]{2,8}\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g;
    for (const line of dateContextLines) {
      for (const match of line.matchAll(dateValuePattern)) {
        const iso = normalizeDateCandidate(match[1] || match[0]);
        if (iso && !dueDates.includes(iso)) {
          dueDates.push(iso);
        }
        if (dueDates.length >= 6) {
          break;
        }
      }
      if (dueDates.length >= 6) {
        break;
      }
    }

    const contacts = [...new Set(
      [...compact.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)].map((match) => String(match[0] || "").trim().toLowerCase())
    )].slice(0, 8);

    const actionCandidates = [];
    const candidateLines = lines
      .filter((line) => line.length <= 180)
      .filter((line) => !/[{}<>]/.test(line))
      .filter((line) => !/^\s*[-*]\s*$/.test(line))
      .slice(0, 120);
    for (const line of candidateLines) {
      const normalizedLine = line.replace(/^[-*]\s+/, "").trim();
      if (!normalizedLine) {
        continue;
      }
      if (!/\b(reply|send|pay|review|follow up|schedule|call|book|renew|todo|action|next step|need to)\b/i.test(normalizedLine)) {
        continue;
      }
      const action = compactTaskText(normalizedLine, 120);
      if (action && !actionCandidates.includes(action)) {
        actionCandidates.push(action);
      }
      if (actionCandidates.length >= 6) {
        break;
      }
    }

    const watchHits = (Array.isArray(getDocumentRulesState()?.watchTerms) ? getDocumentRulesState().watchTerms : [])
      .filter((term) => term && lower.includes(String(term).toLowerCase()))
      .slice(0, 8);

    const importantPeopleHits = (Array.isArray(getDocumentRulesState()?.importantPeople) ? getDocumentRulesState().importantPeople : [])
      .filter((term) => term && lower.includes(String(term).toLowerCase()))
      .slice(0, 8);

    let priority = 0;
    if (actionCandidates.length) priority += 2;
    if (dueDates.length) priority += 2;
    if (watchHits.length) priority += 1;
    if (importantPeopleHits.length) priority += 1;
    if (/\b(urgent|asap|important|immediately|overdue)\b/.test(lower)) priority += 2;
    if (modifiedAt && Date.now() - Number(modifiedAt || 0) < 24 * 60 * 60 * 1000) priority += 1;
    if (isAssistantPrimaryDocumentPath(relativePath)) priority += 2;
    if (isObserverOutputDocumentPath(relativePath)) priority = Math.max(0, priority - 2);
    if (/\b(mail|schedule|legal|action)\b/.test(detectDocumentCategory({ relativePath, text: compact, kind: "" }))) priority += 1;
    if ([".js", ".ts", ".tsx", ".jsx", ".json", ".html", ".htm", ".xml"].includes(extension)) priority -= 2;
    if (/^openclaw-observer\//i.test(relativePath)) priority -= 1;
    if (isLowValueRepositoryDocument(relativePath)) priority -= 3;
    priority = Math.max(0, priority);

    const category = detectDocumentCategory({ relativePath, text: compact, kind: "" });
    return {
      heading: compactTaskText(heading, 160),
      summary,
      dueDates,
      contacts,
      actionCandidates,
      watchHits,
      importantPeopleHits,
      priority,
      category
    };
  }

  async function loadDocumentIndex() {
    try {
      const raw = await fs.readFile(documentIndexPath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? {
            lastScanAt: Number(parsed.lastScanAt || 0),
            entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {}
          }
        : { lastScanAt: 0, entries: {} };
    } catch {
      return { lastScanAt: 0, entries: {} };
    }
  }

  async function saveDocumentIndex(index) {
    await writeVolumeText(documentIndexPath, `${JSON.stringify(index, null, 2)}\n`);
  }

  function getDocumentScanRoots() {
    return [
      { id: "output", rootPath: observerOutputRoot, maxDepth: 6, limit: 260 },
      { id: "attachments", rootPath: observerAttachmentsRoot, maxDepth: 5, limit: 120 }
    ];
  }

  async function findRetrievalBrain() {
    const brains = await listAvailableBrains();
    return brains.find((brain) => brain.specialty === "retrieval") || null;
  }

  const retrievalDomain = createRetrievalDomain({
    runtimeStatePath: retrievalStatePath,
    qdrantUrl: defaultQdrantUrl,
    qdrantApiKey: "",
    getQdrantUrl: () => getRetrievalConfig().qdrantUrl,
    getQdrantApiKey: resolveQdrantApiKey,
    hasQdrantApiKey,
    collectionName: getRetrievalConfig().collectionName,
    workspaceKey: `observer:${workspaceRoot.replaceAll("\\", "/").toLowerCase()}`,
    getSelectedRoots: getDocumentScanRoots,
    getDocumentCandidateExtensions,
    listRecursiveFiles,
    shouldIgnoreDocumentPath,
    normalizeDocumentContent,
    embedTexts: async (texts = []) => {
      const items = Array.isArray(texts)
        ? texts.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      if (!items.length) {
        return {
          vectors: [],
          model: ""
        };
      }
      const retrievalBrain = await findRetrievalBrain();
      if (!retrievalBrain?.model || !retrievalBrain?.ollamaBaseUrl) {
        throw new Error("Retrieval embedding brain is not configured.");
      }
      const retrievalHealthy = await getOllamaEndpointHealth(retrievalBrain.ollamaBaseUrl);
      if (!retrievalHealthy?.running) {
        throw new Error(retrievalHealthy?.error || "Retrieval embedding brain is unavailable.");
      }
      return {
        vectors: await runOllamaEmbed(retrievalBrain.model, items, {
          baseUrl: retrievalBrain.ollamaBaseUrl,
          timeoutMs: items.length > 1 ? 45000 : 30000
        }),
        model: retrievalBrain.model
      };
    },
    hashRef
  });

  async function buildDocumentIndexSnapshot() {
    const previousIndex = await loadDocumentIndex();
    const nextEntries = {};
    const changed = [];
    const added = [];
    const urgent = [];
    const allEntries = [];
    const now = Date.now();

    for (const root of getDocumentScanRoots()) {
      const files = await listRecursiveFiles(root.rootPath, {
        extensions: getDocumentCandidateExtensions(),
        limit: root.limit,
        maxDepth: root.maxDepth
      });
      for (const filePath of files) {
        if (shouldIgnoreDocumentPath(filePath)) {
          continue;
        }
        try {
          const stats = await fs.stat(filePath);
          if (!stats.isFile()) {
            continue;
          }
          const raw = await fs.readFile(filePath);
          const normalized = await normalizeDocumentContent({
            buffer: raw,
            sourceLabel: filePath,
            sourceName: pathModule.basename(filePath),
            contentType: ""
          });
          const relativePath = pathModule.relative(root.rootPath, filePath).replace(/\\/g, "/");
          const signals = extractDocumentSignals({
            text: normalized.text || "",
            relativePath,
            modifiedAt: Number(stats.mtimeMs || 0)
          });
          const checksum = hashRef(`${normalized.kind}\n${normalized.text || ""}`);
          const key = `${root.id}:${relativePath.toLowerCase()}`;
          const previous = previousIndex.entries?.[key];
          const entry = {
            id: key,
            rootId: root.id,
            rootPath: root.rootPath,
            path: filePath,
            relativePath,
            name: pathModule.basename(filePath),
            extension: pathModule.extname(filePath).toLowerCase(),
            size: Number(stats.size || 0),
            modifiedAt: Number(stats.mtimeMs || 0),
            scannedAt: now,
            kind: normalized.kind || "text",
            contentType: normalized.contentType || "",
            checksum,
            heading: signals.heading,
            summary: signals.summary,
            category: signals.category,
            dueDates: signals.dueDates,
            contacts: signals.contacts,
            actionCandidates: signals.actionCandidates,
            watchHits: signals.watchHits,
            importantPeopleHits: signals.importantPeopleHits,
            priority: Number(signals.priority || 0),
            warnings: Array.isArray(normalized.warnings) ? normalized.warnings : [],
            status: !previous ? "new" : previous.checksum !== checksum ? "changed" : "unchanged",
            lastReviewedAt: Number(previous?.lastReviewedAt || 0),
            lastBriefedAt: Number(previous?.lastBriefedAt || 0)
          };
          nextEntries[key] = entry;
          allEntries.push(entry);
          if (entry.status === "new") {
            added.push(entry);
          } else if (entry.status === "changed") {
            changed.push(entry);
          }
          if (!isGeneratedObserverArtifactPath(filePath) && (entry.priority >= 3 || entry.actionCandidates.length || entry.dueDates.length)) {
            urgent.push(entry);
          }
        } catch {
          continue;
        }
      }
    }

    const removed = Object.values(previousIndex.entries || {})
      .filter((entry) => entry?.id && !nextEntries[entry.id])
      .map((entry) => ({
        id: entry.id,
        relativePath: entry.relativePath,
        rootId: entry.rootId
      }));

    const sortedUrgent = urgent
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return Number(b.modifiedAt || 0) - Number(a.modifiedAt || 0);
      });

    const nextIndex = {
      lastScanAt: now,
      entries: nextEntries
    };
    await saveDocumentIndex(nextIndex);
    return {
      index: nextIndex,
      totalDocuments: allEntries.length,
      newDocuments: added,
      changedDocuments: changed,
      removedDocuments: removed,
      urgentDocuments: sortedUrgent,
      topDocuments: allEntries
        .sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          return Number(b.modifiedAt || 0) - Number(a.modifiedAt || 0);
        })
        .slice(0, 12)
    };
  }

  async function writeDailyDocumentBriefing(snapshot) {
    const now = Date.now();
    const dayKey = formatDayKey(now);
    await ensurePromptWorkspaceScaffolding(now);
    const visibleUrgentDocuments = Array.isArray(snapshot?.urgentDocuments)
      ? snapshot.urgentDocuments.filter((entry) => !isGeneratedObserverArtifactPath(entry?.path || entry?.relativePath || ""))
      : [];
    const lines = [
      "# Daily Briefing",
      "",
      `Generated: ${new Date(now).toLocaleString("en-AU")}`,
      "Focus: assistant documents and attachments. Exports are tracked for reporting, not treated as active work.",
      `Documents tracked: ${Number(snapshot?.totalDocuments || 0)}`,
      `New: ${Array.isArray(snapshot?.newDocuments) ? snapshot.newDocuments.length : 0}`,
      `Changed: ${Array.isArray(snapshot?.changedDocuments) ? snapshot.changedDocuments.length : 0}`,
      `Urgent: ${visibleUrgentDocuments.length}`,
      ""
    ];
    const addSection = (title, entries, formatter) => {
      lines.push(`## ${title}`);
      if (!entries.length) {
        lines.push("- None");
        lines.push("");
        return;
      }
      for (const entry of entries) {
        lines.push(`- ${formatter(entry)}`);
      }
      lines.push("");
    };
    addSection("Needs Attention", visibleUrgentDocuments.slice(0, 8), (entry) => {
      const parts = [entry.relativePath];
      if (entry.actionCandidates?.length) parts.push(`actions: ${entry.actionCandidates.slice(0, 2).join("; ")}`);
      if (entry.dueDates?.length) parts.push(`dates: ${entry.dueDates.slice(0, 2).map((value) => String(value).slice(0, 10)).join(", ")}`);
      if (entry.watchHits?.length) parts.push(`watch: ${entry.watchHits.slice(0, 3).join(", ")}`);
      return parts.join(" | ");
    });
    addSection("New Documents", (snapshot?.newDocuments || []).slice(0, 8), (entry) => `${entry.relativePath} | ${entry.summary || entry.heading}`);
    addSection("Changed Documents", (snapshot?.changedDocuments || []).slice(0, 8), (entry) => `${entry.relativePath} | ${entry.summary || entry.heading}`);

    const content = `${lines.join("\n")}\n`;
    await writeVolumeText(pathModule.join(promptMemoryBriefingsRoot, `${dayKey}.md`), content);
    await writeVolumeText(promptTodayBriefingPath, content);
    return content;
  }

  async function buildDocumentOverviewSummary() {
    const index = await loadDocumentIndex();
    const entries = Object.values(index.entries || {});
    const urgent = entries
      .filter((entry) => Number(entry.priority || 0) >= 3 || (entry.actionCandidates || []).length || (entry.dueDates || []).length)
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return Number(b.modifiedAt || 0) - Number(a.modifiedAt || 0);
      });
    const lines = [];
    lines.push(`I'm tracking ${entries.length} document${entries.length === 1 ? "" : "s"} in the workspace index.`);
    if (urgent.length) {
      lines.push("Highest-priority documents:");
      for (const entry of urgent.slice(0, 6)) {
        const parts = [entry.relativePath];
        if (entry.actionCandidates?.length) parts.push(`actions: ${entry.actionCandidates.slice(0, 2).join("; ")}`);
        if (entry.dueDates?.length) parts.push(`dates: ${entry.dueDates.slice(0, 2).map((value) => String(value).slice(0, 10)).join(", ")}`);
        lines.push(`- ${parts.join(" | ")}`);
      }
    } else {
      lines.push("Highest-priority documents: none are currently flagged for action.");
    }
    return lines;
  }

  function isDocumentSearchRequest(message = "") {
    const lower = String(message || "").toLowerCase().trim();
    return /\b(find documents about|search documents for|search the documents for|what documents mention|which documents mention|find files about|search files for)\b/.test(lower);
  }

  function extractDocumentSearchQuery(message = "") {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    const patterns = [
      /find documents about\s+(.+)$/i,
      /search documents for\s+(.+)$/i,
      /search the documents for\s+(.+)$/i,
      /what documents mention\s+(.+)$/i,
      /which documents mention\s+(.+)$/i,
      /find files about\s+(.+)$/i,
      /search files for\s+(.+)$/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1].trim().replace(/[?.!]+$/g, "");
      }
    }
    return lower;
  }

  async function searchIndexedDocuments(query = "", limit = 5) {
    const trimmedQuery = String(query || "").trim();
    if (!trimmedQuery) {
      return { mode: "empty", matches: [] };
    }
    const index = await loadDocumentIndex();
    const entries = Object.values(index.entries || {})
      .filter((entry) => entry && !shouldIgnoreDocumentPath(entry.path || ""))
      .slice(0, 80);
    if (!entries.length) {
      return { mode: "empty", matches: [] };
    }

    const retrievalBrain = await findRetrievalBrain();
    const retrievalHealthy = retrievalBrain ? await getOllamaEndpointHealth(retrievalBrain.ollamaBaseUrl) : null;
    if (retrievalBrain && retrievalHealthy?.running) {
      try {
        const docTexts = entries.map((entry) => [
          entry.relativePath,
          entry.heading || "",
          entry.summary || "",
          Array.isArray(entry.actionCandidates) ? entry.actionCandidates.join("; ") : "",
          Array.isArray(entry.watchHits) ? entry.watchHits.join("; ") : ""
        ].filter(Boolean).join("\n"));
        const [queryEmbedding] = await runOllamaEmbed(retrievalBrain.model, [trimmedQuery], {
          baseUrl: retrievalBrain.ollamaBaseUrl,
          timeoutMs: 30000
        });
        const docEmbeddings = await runOllamaEmbed(retrievalBrain.model, docTexts, {
          baseUrl: retrievalBrain.ollamaBaseUrl,
          timeoutMs: 45000
        });
        const scored = entries.map((entry, index) => ({
          entry,
          score: cosineSimilarity(queryEmbedding, docEmbeddings[index] || [])
        }))
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, Math.max(1, Math.min(limit, 8)));
        return {
          mode: "semantic",
          brainId: retrievalBrain.id,
          matches: scored
        };
      } catch {
        // Fall through to lexical search.
      }
    }

    const terms = trimmedQuery.toLowerCase().split(/\s+/).filter((term) => term.length >= 3);
    const scored = entries.map((entry) => {
      const haystack = `${entry.relativePath}\n${entry.heading || ""}\n${entry.summary || ""}\n${(entry.actionCandidates || []).join("\n")}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { entry, score };
    })
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return Number(right.entry.priority || 0) - Number(left.entry.priority || 0);
      })
      .slice(0, Math.max(1, Math.min(limit, 8)));
    return {
      mode: "lexical",
      matches: scored
    };
  }

  async function buildDocumentSearchSummary(query = "") {
    const chunkResult = await retrievalDomain.searchChunks(query, {}, { limit: 5 });
    if (chunkResult.ok) {
      if (!chunkResult.matches.length) {
        return [`I couldn't find any indexed document chunks matching "${query}".`];
      }
      const lines = [];
      lines.push(`I found ${chunkResult.matches.length} relevant chunk${chunkResult.matches.length === 1 ? "" : "s"} for "${query}".`);
      for (const match of chunkResult.matches) {
        const payload = match.payload || {};
        const parts = [
          String(payload.relative_path || payload.source_path || payload.doc_id || "").trim()
        ].filter(Boolean);
        if (Number.isFinite(match.score)) {
          parts.push(`score: ${Number(match.score).toFixed(3)}`);
        }
        const preview = compactTaskText(String(payload.text || "").replace(/\s+/g, " ").trim(), 180);
        if (preview) {
          parts.push(preview);
        }
        lines.push(`- ${compactTaskText(parts.join(" | "), 260)}`);
      }
      return lines;
    }

    const result = await searchIndexedDocuments(query, 5);
    if (!result.matches.length) {
      return [`I couldn't find any indexed documents matching "${query}".`];
    }
    const lines = [];
    lines.push(`Chunk retrieval is unavailable right now, so I used the summary-level document index for "${query}".`);
    for (const match of result.matches) {
      const entry = match.entry;
      const parts = [entry.relativePath];
      if (entry.summary) parts.push(entry.summary);
      if (entry.actionCandidates?.length) parts.push(`actions: ${entry.actionCandidates.slice(0, 2).join("; ")}`);
      lines.push(`- ${compactTaskText(parts.join(" | "), 220)}`);
    }
    return lines;
  }

  async function ensureInitialDocumentIntelligence() {
    const snapshot = await buildDocumentIndexSnapshot();
    await writeDailyDocumentBriefing(snapshot);
    await retrievalDomain.ingestSelectedRoots().catch(() => {});
    return true;
  }

  async function toolReadDocument(args = {}, context = {}) {
    const rawTarget = String(
      args.target
      || args.filePath
      || args.filepath
      || args.file
      || args.filename
      || ""
    ).trim();
    const sourcePath = String(args.path || (!/^https?:\/\//i.test(rawTarget) ? rawTarget : "") || "").trim();
    const sourceUrl = String(args.url || (/^https?:\/\//i.test(rawTarget) ? rawTarget : "") || "").trim();
    if (!sourcePath && !sourceUrl) {
      throw new Error("path or url is required");
    }
    if (sourcePath && sourceUrl) {
      throw new Error("provide either path or url, not both");
    }
    if (sourcePath) {
      const target = resolveToolPath(sourcePath);
      const file = await readContainerFileBuffer(target);
      const normalized = await normalizeDocumentContent({
        buffer: Buffer.from(String(file.contentBase64 || ""), "base64"),
        sourceLabel: target,
        sourceName: pathModule.posix.basename(target),
        contentType: String(args.contentType || "")
      });
      return buildDocumentToolResponse({
        sourceLabel: target,
        sourceName: pathModule.posix.basename(target),
        contentType: String(args.contentType || ""),
        normalized,
        args,
        extra: {
          path: target,
          size: Number(file.size || 0)
        }
      });
    }

    if (!context.internetEnabled) {
      throw new Error("internet access is disabled for this task");
    }
    const response = await fetch(sourceUrl, {
      headers: {
        "user-agent": "derpy-claw-observer/1.0"
      }
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const normalized = await normalizeDocumentContent({
      buffer,
      sourceLabel: sourceUrl,
      sourceName: sourceUrl.split(/[?#]/, 1)[0].split("/").pop() || sourceUrl,
      contentType: response.headers.get("content-type") || ""
    });
    return buildDocumentToolResponse({
      sourceLabel: sourceUrl,
      sourceName: sourceUrl,
      contentType: response.headers.get("content-type") || "",
      normalized,
      args,
      extra: {
        url: sourceUrl,
        ok: response.ok,
        status: response.status
      }
    });
  }

  return {
    buildDocumentIndexSnapshot,
    buildDocumentOverviewSummary,
    buildDocumentSearchSummary,
    buildVisionImagesFromAttachments,
    ensureInitialDocumentIntelligence,
    extractDocumentSearchQuery,
    isDocumentSearchRequest,
    isGeneratedObserverArtifactPath,
    isImageMimeType,
    isObserverOutputDocumentPath,
    normalizeDocumentContent,
    retrievalDomain,
    toolReadDocument,
    writeDailyDocumentBriefing
  };
}
