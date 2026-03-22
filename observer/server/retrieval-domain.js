import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const STATE_SCHEMA_VERSION = 1;
const CHUNK_SCHEMA_VERSION = 1;
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_CHUNK_OVERLAP = 200;
const DEFAULT_MAX_CHUNKS_PER_DOC = 64;
const DEFAULT_SEARCH_LIMIT = 5;

function normalizeRootEntry(root = {}, index = 0) {
  const id = String(root?.id || `root_${index + 1}`).trim();
  const rootPath = String(root?.rootPath || "").trim();
  return {
    id,
    rootPath,
    maxDepth: Math.max(1, Number(root?.maxDepth || 5) || 5),
    limit: Math.max(1, Number(root?.limit || 250) || 250)
  };
}

function compactWhitespace(value = "") {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildUuidFromSeed(seed = "") {
  const hex = crypto.createHash("sha1").update(String(seed || "")).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}

function buildChunkPreview(text = "", maxChars = 220) {
  const compact = compactWhitespace(text).replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function splitLongSegment(text = "", chunkSize = DEFAULT_CHUNK_SIZE) {
  const output = [];
  let cursor = 0;
  const source = compactWhitespace(text);
  while (cursor < source.length) {
    const maxEnd = Math.min(source.length, cursor + chunkSize);
    let end = maxEnd;
    if (maxEnd < source.length) {
      const window = source.slice(cursor, maxEnd);
      const preferredBreak = Math.max(
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
        window.lastIndexOf("; "),
        window.lastIndexOf(", "),
        window.lastIndexOf(" ")
      );
      if (preferredBreak >= Math.floor(chunkSize * 0.55)) {
        end = cursor + preferredBreak + 1;
      }
    }
    const chunk = source.slice(cursor, end).trim();
    if (chunk) {
      output.push(chunk);
    }
    cursor = end;
  }
  return output;
}

function chunkDocumentText(text = "", {
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
  maxChunks = DEFAULT_MAX_CHUNKS_PER_DOC
} = {}) {
  const source = compactWhitespace(text);
  if (!source) {
    return [];
  }
  const normalizedChunkSize = Math.max(300, Number(chunkSize || DEFAULT_CHUNK_SIZE) || DEFAULT_CHUNK_SIZE);
  const normalizedOverlap = Math.max(0, Math.min(Number(chunkOverlap || DEFAULT_CHUNK_OVERLAP) || DEFAULT_CHUNK_OVERLAP, Math.floor(normalizedChunkSize / 2)));
  const paragraphs = source.split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean);
  const units = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= normalizedChunkSize) {
      units.push(paragraph);
      continue;
    }
    units.push(...splitLongSegment(paragraph, normalizedChunkSize));
  }

  const chunks = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (!current || candidate.length <= normalizedChunkSize) {
      current = candidate;
      continue;
    }
    chunks.push(current.trim());
    if (chunks.length >= maxChunks) {
      return chunks.slice(0, maxChunks);
    }
    const overlapSeed = normalizedOverlap > 0
      ? current.slice(Math.max(0, current.length - normalizedOverlap)).trim()
      : "";
    current = overlapSeed ? `${overlapSeed}\n\n${unit}` : unit;
    if (current.length > normalizedChunkSize) {
      const splitUnits = splitLongSegment(current, normalizedChunkSize);
      current = "";
      for (const splitUnit of splitUnits) {
        chunks.push(splitUnit);
        if (chunks.length >= maxChunks) {
          return chunks.slice(0, maxChunks);
        }
      }
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks.slice(0, maxChunks);
}

function buildPayloadFilter(filters = {}, workspaceKey = "") {
  const must = [];
  if (workspaceKey) {
    must.push({
      key: "workspace_key",
      match: { value: workspaceKey }
    });
  }
  if (filters?.docId) {
    must.push({
      key: "doc_id",
      match: { value: String(filters.docId).trim() }
    });
  }
  if (filters?.rootId) {
    must.push({
      key: "root_id",
      match: { value: String(filters.rootId).trim() }
    });
  }
  if (filters?.sourcePath) {
    must.push({
      key: "source_path",
      match: { value: String(filters.sourcePath).trim() }
    });
  }
  if (filters?.sourceType) {
    must.push({
      key: "source_type",
      match: { value: String(filters.sourceType).trim() }
    });
  }
  return must.length ? { must } : null;
}

function extractQueryResults(body = {}) {
  if (Array.isArray(body?.result?.points)) {
    return body.result.points;
  }
  if (Array.isArray(body?.result)) {
    return body.result;
  }
  if (Array.isArray(body?.points)) {
    return body.points;
  }
  return [];
}

function createEmptyState({ collectionName = "", workspaceKey = "" } = {}) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    collectionName: String(collectionName || "").trim(),
    workspaceKey: String(workspaceKey || "").trim(),
    lastSyncAt: 0,
    docs: {}
  };
}

function normalizeState(raw = {}, { collectionName = "", workspaceKey = "" } = {}) {
  const fallback = createEmptyState({ collectionName, workspaceKey });
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  return {
    schemaVersion: Number(raw.schemaVersion || 0),
    collectionName: String(raw.collectionName || "").trim(),
    workspaceKey: String(raw.workspaceKey || "").trim(),
    lastSyncAt: Number(raw.lastSyncAt || 0),
    docs: raw.docs && typeof raw.docs === "object" ? raw.docs : {}
  };
}

function createQdrantClient({
  url = "http://127.0.0.1:6333",
  apiKey = "",
  getUrl = null,
  getApiKey = null,
  fetchImpl = fetch
} = {}) {
  function resolveBaseUrl() {
    const value = typeof getUrl === "function" ? getUrl() : url;
    return String(value || "").trim().replace(/\/+$/, "");
  }

  async function resolveApiKey() {
    const value = typeof getApiKey === "function" ? await getApiKey() : apiKey;
    return String(value || "").trim();
  }

  async function request(method, pathname, body = undefined) {
    const baseUrl = resolveBaseUrl();
    if (!baseUrl) {
      return {
        ok: false,
        status: 0,
        error: "Qdrant URL is not configured",
        body: null
      };
    }
    const headers = {
      "content-type": "application/json"
    };
    const resolvedApiKey = await resolveApiKey();
    if (resolvedApiKey) {
      headers["api-key"] = resolvedApiKey;
    }
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: String(error?.message || "Failed to reach Qdrant"),
        body: null
      };
    }

    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? "" : String(parsed?.status?.error || parsed?.error || `Qdrant returned ${response.status}`),
      body: parsed
    };
  }

  return {
    get baseUrl() {
      return resolveBaseUrl();
    },
    getCollection(collectionName = "") {
      return request("GET", `/collections/${encodeURIComponent(collectionName)}`);
    },
    createCollection(collectionName = "", vectorSize = 0) {
      return request("PUT", `/collections/${encodeURIComponent(collectionName)}`, {
        vectors: {
          size: Math.max(1, Number(vectorSize || 0)),
          distance: "Cosine"
        },
        on_disk_payload: true
      });
    },
    upsertPoints(collectionName = "", points = []) {
      return request("PUT", `/collections/${encodeURIComponent(collectionName)}/points`, {
        points
      });
    },
    deletePointsByFilter(collectionName = "", filter = null) {
      return request("POST", `/collections/${encodeURIComponent(collectionName)}/points/delete`, {
        filter
      });
    },
    queryPoints(collectionName = "", vector = [], {
      filter = null,
      limit = DEFAULT_SEARCH_LIMIT
    } = {}) {
      return request("POST", `/collections/${encodeURIComponent(collectionName)}/points/query`, {
        query: vector,
        limit: Math.max(1, Number(limit || DEFAULT_SEARCH_LIMIT) || DEFAULT_SEARCH_LIMIT),
        with_payload: true,
        with_vector: false,
        ...(filter ? { filter } : {})
      });
    },
    request
  };
}

export function createRetrievalDomain({
  runtimeStatePath = "",
  qdrantUrl = "http://127.0.0.1:6333",
  qdrantApiKey = "",
  getQdrantUrl = null,
  getQdrantApiKey = null,
  hasQdrantApiKey = null,
  collectionName = "observer_chunks",
  workspaceKey = "",
  getSelectedRoots,
  getDocumentCandidateExtensions,
  listRecursiveFiles,
  shouldIgnoreDocumentPath,
  normalizeDocumentContent,
  embedTexts,
  hashRef,
  fetchImpl = fetch,
  syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS
} = {}) {
  const qdrant = createQdrantClient({
    url: qdrantUrl,
    apiKey: qdrantApiKey,
    getUrl: getQdrantUrl,
    getApiKey: getQdrantApiKey,
    fetchImpl
  });
  let ensuredCollectionSize = 0;

  async function loadState() {
    if (!runtimeStatePath) {
      return createEmptyState({ collectionName, workspaceKey });
    }
    try {
      const raw = await fs.readFile(runtimeStatePath, "utf8");
      return normalizeState(JSON.parse(raw), { collectionName, workspaceKey });
    } catch {
      return createEmptyState({ collectionName, workspaceKey });
    }
  }

  async function saveState(state = {}) {
    if (!runtimeStatePath) {
      return;
    }
    const normalized = normalizeState(state, { collectionName, workspaceKey });
    await fs.mkdir(path.dirname(runtimeStatePath), { recursive: true });
    await fs.writeFile(runtimeStatePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  }

  async function ensureCollection(vectorSize = 0) {
    const normalizedSize = Math.max(0, Number(vectorSize || 0));
    if (!normalizedSize) {
      return {
        ok: false,
        available: false,
        error: "Vector size is required to bootstrap the Qdrant collection."
      };
    }
    if (ensuredCollectionSize === normalizedSize) {
      return {
        ok: true,
        available: true,
        collectionName,
        vectorSize: ensuredCollectionSize
      };
    }
    const existing = await qdrant.getCollection(collectionName);
    if (existing.ok) {
      ensuredCollectionSize = normalizedSize;
      return {
        ok: true,
        available: true,
        collectionName,
        vectorSize: ensuredCollectionSize
      };
    }
    if (existing.status !== 404) {
      return {
        ok: false,
        available: false,
        error: existing.error || "Unable to inspect Qdrant collection."
      };
    }
    const created = await qdrant.createCollection(collectionName, normalizedSize);
    if (!created.ok) {
      return {
        ok: false,
        available: false,
        error: created.error || "Unable to create Qdrant collection."
      };
    }
    ensuredCollectionSize = normalizedSize;
    return {
      ok: true,
      available: true,
      collectionName,
      vectorSize: ensuredCollectionSize
    };
  }

  async function purgeWorkspaceIndex() {
    const filter = buildPayloadFilter({}, workspaceKey);
    if (!filter) {
      return {
        ok: false,
        error: "Workspace key is required for purge."
      };
    }
    const result = await qdrant.deletePointsByFilter(collectionName, filter);
    return {
      ok: result.ok,
      error: result.error || ""
    };
  }

  async function deleteDocumentPoints(docId = "") {
    const filter = buildPayloadFilter({ docId }, workspaceKey);
    if (!filter) {
      return {
        ok: false,
        error: "Document id is required for deletion."
      };
    }
    const result = await qdrant.deletePointsByFilter(collectionName, filter);
    return {
      ok: result.ok,
      error: result.error || ""
    };
  }

  async function buildRootFileList() {
    const roots = (Array.isArray(getSelectedRoots?.()) ? getSelectedRoots() : [])
      .map((entry, index) => normalizeRootEntry(entry, index))
      .filter((entry) => entry.id && entry.rootPath);
    const extensions = Array.isArray(getDocumentCandidateExtensions?.()) ? getDocumentCandidateExtensions() : [];
    const docs = [];
    for (const root of roots) {
      const files = await listRecursiveFiles(root.rootPath, {
        extensions,
        limit: root.limit,
        maxDepth: root.maxDepth
      });
      for (const filePath of files) {
        if (shouldIgnoreDocumentPath(filePath)) {
          continue;
        }
        docs.push({ root, filePath });
      }
    }
    return docs;
  }

  async function ingestSelectedRoots({ force = false } = {}) {
    const now = Date.now();
    let state = await loadState();
    const requiresWorkspaceReset = force
      || state.schemaVersion !== STATE_SCHEMA_VERSION
      || state.collectionName !== collectionName
      || state.workspaceKey !== workspaceKey;
    if (requiresWorkspaceReset) {
      await purgeWorkspaceIndex().catch(() => {});
      state = createEmptyState({ collectionName, workspaceKey });
    }

    const currentDocIds = new Set();
    let indexedDocuments = 0;
    let changedDocuments = 0;
    let removedDocuments = 0;
    let skippedDocuments = 0;
    let indexedChunks = 0;
    let bootstrapError = "";
    let embeddingModel = "";

    const docs = await buildRootFileList();
    for (const entry of docs) {
      const { root, filePath } = entry;
      let stats;
      try {
        stats = await fs.stat(filePath);
      } catch {
        continue;
      }
      if (!stats?.isFile?.()) {
        continue;
      }

      let raw;
      try {
        raw = await fs.readFile(filePath);
      } catch {
        continue;
      }

      let normalized;
      try {
        normalized = await normalizeDocumentContent({
          buffer: raw,
          sourceLabel: filePath,
          sourceName: path.basename(filePath),
          contentType: ""
        });
      } catch {
        continue;
      }

      const relativePath = path.relative(root.rootPath, filePath).replace(/\\/g, "/");
      const docId = `${root.id}:${relativePath.toLowerCase()}`;
      currentDocIds.add(docId);
      const text = compactWhitespace(normalized?.text || "");
      const contentHash = String(hashRef(`${normalized?.kind || "text"}\n${text}`));
      const existing = state.docs[docId];
      if (
        !force
        && existing
        && String(existing.contentHash || "") === contentHash
        && Number(existing.modifiedAt || 0) === Number(stats.mtimeMs || 0)
        && Number(existing.chunkSchemaVersion || 0) === CHUNK_SCHEMA_VERSION
      ) {
        skippedDocuments += 1;
        continue;
      }

      await deleteDocumentPoints(docId).catch(() => {});
      if (!text) {
        delete state.docs[docId];
        changedDocuments += 1;
        continue;
      }

      const chunks = chunkDocumentText(text);
      if (!chunks.length) {
        delete state.docs[docId];
        changedDocuments += 1;
        continue;
      }

      let embeddingResponse;
      try {
        embeddingResponse = await embedTexts(chunks);
      } catch (error) {
        bootstrapError = String(error?.message || "Embedding provider was unavailable.");
        break;
      }
      const vectors = Array.isArray(embeddingResponse?.vectors) ? embeddingResponse.vectors : [];
      if (!vectors.length || vectors.length !== chunks.length) {
        bootstrapError = "Embedding provider returned an unexpected vector count.";
        break;
      }
      embeddingModel = String(embeddingResponse?.model || embeddingModel || "").trim();
      const collectionReady = await ensureCollection(vectors[0]?.length || 0);
      if (!collectionReady.ok) {
        bootstrapError = collectionReady.error || "Unable to bootstrap the Qdrant collection.";
        break;
      }

      const title = buildChunkPreview(normalized?.text || relativePath, 140) || path.basename(relativePath || filePath);
      const payloadBase = {
        schema_version: CHUNK_SCHEMA_VERSION,
        workspace_key: workspaceKey,
        doc_id: docId,
        root_id: root.id,
        source_path: filePath,
        relative_path: relativePath,
        source_type: normalized?.kind || "text",
        title,
        updated_at: Number(stats.mtimeMs || 0),
        content_hash: contentHash
      };
      const points = chunks.map((chunk, index) => ({
        id: buildUuidFromSeed(`${workspaceKey}|${docId}|${index}|${contentHash}`),
        vector: vectors[index],
        payload: {
          ...payloadBase,
          chunk_id: `${docId}:${index}`,
          chunk_index: index,
          chunk_total: chunks.length,
          text: chunk
        }
      }));
      const upserted = await qdrant.upsertPoints(collectionName, points);
      if (!upserted.ok) {
        bootstrapError = upserted.error || `Unable to index ${relativePath}.`;
        break;
      }

      state.docs[docId] = {
        docId,
        rootId: root.id,
        path: filePath,
        relativePath,
        sourceType: normalized?.kind || "text",
        title,
        contentHash,
        modifiedAt: Number(stats.mtimeMs || 0),
        chunkCount: chunks.length,
        chunkSchemaVersion: CHUNK_SCHEMA_VERSION,
        indexedAt: now
      };
      indexedDocuments += 1;
      changedDocuments += existing ? 1 : 0;
      indexedChunks += chunks.length;
    }

    const staleDocIds = Object.keys(state.docs || {}).filter((docId) => !currentDocIds.has(docId));
    for (const docId of staleDocIds) {
      await deleteDocumentPoints(docId).catch(() => {});
      delete state.docs[docId];
      removedDocuments += 1;
    }
    state.lastSyncAt = now;
    await saveState(state);

    return {
      ok: !bootstrapError,
      available: !bootstrapError,
      error: bootstrapError,
      collectionName,
      embeddingModel,
      indexedDocuments,
      changedDocuments,
      removedDocuments,
      skippedDocuments,
      indexedChunks,
      totalDocuments: Object.keys(state.docs || {}).length,
      lastSyncAt: state.lastSyncAt
    };
  }

  async function maybeSyncSelectedRoots() {
    const state = await loadState();
    if (Date.now() - Number(state.lastSyncAt || 0) < Math.max(15000, Number(syncIntervalMs || DEFAULT_SYNC_INTERVAL_MS) || DEFAULT_SYNC_INTERVAL_MS)) {
      return {
        ok: true,
        skipped: true,
        lastSyncAt: state.lastSyncAt,
        totalDocuments: Object.keys(state.docs || {}).length
      };
    }
    return ingestSelectedRoots();
  }

  async function searchChunks(query = "", filters = {}, options = {}) {
    const trimmedQuery = String(query || "").trim();
    if (!trimmedQuery) {
      return {
        ok: true,
        available: true,
        query: trimmedQuery,
        collectionName,
        matches: []
      };
    }

    if (options.syncBeforeSearch !== false) {
      const syncResult = await maybeSyncSelectedRoots();
      if (!syncResult.ok) {
        return {
          ok: false,
          available: false,
          query: trimmedQuery,
          collectionName,
          matches: [],
          error: syncResult.error || "Chunk retrieval sync failed."
        };
      }
    }

    let embeddingResponse;
    try {
      embeddingResponse = await embedTexts([trimmedQuery]);
    } catch (error) {
      return {
        ok: false,
        available: false,
        query: trimmedQuery,
        collectionName,
        matches: [],
        error: String(error?.message || "Embedding provider was unavailable.")
      };
    }
    const vectors = Array.isArray(embeddingResponse?.vectors) ? embeddingResponse.vectors : [];
    if (!vectors.length || !Array.isArray(vectors[0]) || !vectors[0].length) {
      return {
        ok: false,
        available: false,
        query: trimmedQuery,
        collectionName,
        matches: [],
        error: "Embedding provider returned no query vector."
      };
    }

    const collectionReady = await ensureCollection(vectors[0].length);
    if (!collectionReady.ok) {
      return {
        ok: false,
        available: false,
        query: trimmedQuery,
        collectionName,
        matches: [],
        error: collectionReady.error || "Qdrant collection bootstrap failed."
      };
    }

    const response = await qdrant.queryPoints(collectionName, vectors[0], {
      filter: buildPayloadFilter(filters, workspaceKey),
      limit: Math.max(1, Number(options.limit || DEFAULT_SEARCH_LIMIT) || DEFAULT_SEARCH_LIMIT)
    });
    if (!response.ok) {
      return {
        ok: false,
        available: false,
        query: trimmedQuery,
        collectionName,
        matches: [],
        error: response.error || "Qdrant chunk search failed."
      };
    }

    const matches = extractQueryResults(response.body).map((entry) => ({
      id: String(entry?.id || "").trim(),
      score: Number(entry?.score || 0),
      payload: entry?.payload && typeof entry.payload === "object" ? entry.payload : {}
    }));
    return {
      ok: true,
      available: true,
      query: trimmedQuery,
      collectionName,
      embeddingModel: String(embeddingResponse?.model || "").trim(),
      matches
    };
  }

  async function clearWorkspaceIndex() {
    const purge = await purgeWorkspaceIndex();
    if (!purge.ok) {
      return purge;
    }
    const emptyState = createEmptyState({ collectionName, workspaceKey });
    await saveState(emptyState);
    return {
      ok: true,
      collectionName
    };
  }

  async function getStatus() {
    const state = await loadState();
    const docs = Object.values(state.docs || {});
    const indexedDocumentCount = docs.length;
    const indexedChunkCount = docs.reduce((total, entry) => total + Math.max(0, Number(entry?.chunkCount || 0)), 0);
    const lastSyncAt = Number(state.lastSyncAt || 0);
    const statusMeta = {
      indexedDocumentCount,
      indexedChunkCount,
      lastSyncAt,
      hasApiKey: typeof hasQdrantApiKey === "function"
        ? await hasQdrantApiKey()
        : Boolean(String(qdrantApiKey || "").trim())
    };
    if (!qdrant.baseUrl) {
      return {
        enabled: false,
        running: false,
        status: "unconfigured",
        baseUrl: "",
        collectionName,
        collectionCount: 0,
        error: "Qdrant URL is not configured.",
        ...statusMeta
      };
    }
    const response = await qdrant.getCollection(collectionName);
    if (response.ok) {
      return {
        enabled: true,
        running: true,
        status: "ok",
        baseUrl: qdrant.baseUrl,
        collectionName,
        collectionCount: 1,
        collectionReady: true,
        error: "",
        ...statusMeta
      };
    }
    if (response.status === 404) {
      const collectionsResponse = await qdrant.request?.("GET", "/collections");
      const collections = Array.isArray(collectionsResponse?.body?.result?.collections)
        ? collectionsResponse.body.result.collections
        : [];
      return {
        enabled: true,
        running: Boolean(collectionsResponse?.ok),
        status: collectionsResponse?.ok ? "missing_collection" : (collectionsResponse?.status || 0),
        baseUrl: qdrant.baseUrl,
        collectionName,
        collectionCount: collections.length,
        collectionReady: false,
        error: collectionsResponse?.ok ? "" : String(collectionsResponse?.error || response.error || "Qdrant is unavailable."),
        ...statusMeta
      };
    }
    const collectionsResponse = await qdrant.request?.("GET", "/collections");
    const collections = Array.isArray(collectionsResponse?.body?.result?.collections)
      ? collectionsResponse.body.result.collections
      : [];
    return {
      enabled: true,
      running: Boolean(collectionsResponse?.ok),
      status: collectionsResponse?.ok ? "reachable" : (response.status || collectionsResponse?.status || 0),
      baseUrl: qdrant.baseUrl,
      collectionName,
      collectionCount: collections.length,
      collectionReady: false,
      error: String(response.error || collectionsResponse?.error || "Qdrant is unavailable."),
      ...statusMeta
    };
  }

  return {
    clearWorkspaceIndex,
    ensureCollection,
    getStatus,
    ingestSelectedRoots,
    searchChunks
  };
}
