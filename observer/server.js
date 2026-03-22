import express from "express";
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createRequire } from "module";
import { buildRegressionSuiteDefinitions } from "./server/regression-suites.js";
import {
  createSkillLibraryService,
  ensureClawhubCommandSucceeded,
  sanitizeSkillSlug
} from "./server/skill-library.js";
import { createToolConfigService } from "./server/tool-config-service.js";
import { createToolLoopDiagnosticsHelpers } from "./server/tool-loop-diagnostics.js";
import { createInternalRegressionRunner } from "./server/internal-regression-runner.js";
import { createRegressionCaseRunners } from "./server/regression-case-runners.js";
import { createRegressionOrchestrator } from "./server/regression-orchestrator.js";
import {
  buildRegressionFailure,
  createLooksLikeLowSignalPlannerTaskMessage
} from "./server/regression-utils.js";
import { createObserverSandboxService } from "./server/observer-sandbox-service.js";
import { createSandboxIoService } from "./server/sandbox-io-service.js";
import { createSandboxWorkspaceService } from "./server/sandbox-workspace-service.js";
import { createMemoryTrustDomain } from "./server/memory-trust-domain.js";
import { createRetrievalDomain } from "./server/retrieval-domain.js";
import { composeObserverServer } from "./server/observer-server-composition.js";
import {
  AGENT_BRAINS,
  PROJECT_ROLE_PLAYBOOKS,
  SIMPLE_STATE_DIRECTIVE_FILE_NAME,
  SIMPLE_STATE_DIRECTIVE_TEXT,
  SIMPLE_STATE_PROJECT_NAME,
  SIMPLE_STATE_TODAY_TEXT,
  WORKER_DECISION_JSON_SCHEMA,
  WORKER_TOOL_CALL_JSON_SCHEMA,
  createInitialDocumentRulesState,
  createInitialMailState,
  createInitialMailWatchRulesState,
  createInitialObserverConfig,
  createInitialObserverLanguage,
  createInitialOpportunityScanState,
  createInitialVoicePatternStore
} from "./server/observer-core-state.js";
import {
  compactTaskText,
  getCalendarSummaryScopeFromMessage,
  intakeMessageExplicitlyRequestsScheduling,
  isActivitySummaryRequest,
  isCalendarSummaryRequest,
  isCapabilityCheckRequest,
  isCompletionSummaryRequest,
  isDailyBriefingRequest,
  isDateRequest,
  isDocumentOverviewRequest,
  isFailureSummaryRequest,
  isInboxSummaryRequest,
  isLightweightPlannerReplyRequest,
  isMailStatusRequest,
  isOutputStatusRequest,
  isQueueStatusRequest,
  isTimeRequest,
  isTodayInboxSummaryRequest,
  isUserIdentityRequest,
  looksLikeCapabilityRefusalCompletionSummary,
  looksLikeFileListSummary,
  looksLikeLowSignalCompletionSummary,
  normalizeIntakeReplyText,
  normalizeSummaryComparisonText,
  shapePlannerTaskMessage
} from "./server/observer-request-heuristics.js";
import { createToolLoopRepairHelpers } from "./server/tool-loop-repair-helpers.js";
import { createObserverPromptUtils } from "./server/observer-prompt-utils.js";
import { createObserverNativeResponseHelpers } from "./server/observer-native-response-helpers.js";
import { createObserverNativeSupport } from "./server/observer-native-support.js";
import {
  OBSERVER_INTAKE_TOOLS,
  buildObserverToolCatalog,
  createObserverIntakeToolExecutor
} from "./server/observer-intake-tooling.js";
import { createObserverWorkerPrompting } from "./server/observer-worker-prompting.js";
import { createObserverQueueDispatchSelection } from "./server/observer-queue-dispatch-selection.js";
import { createObserverExecutionRunner } from "./server/observer-execution-runner.js";
import { createObserverQueueProcessor } from "./server/observer-queue-processor.js";
import { createObserverTaskExecutionSupport } from "./server/observer-task-execution-support.js";
import { createObserverIntakePreflight } from "./server/observer-intake-preflight.js";
import { createObserverMaintenanceSupport } from "./server/observer-maintenance-support.js";
import { createObserverPeriodicJobs } from "./server/observer-periodic-jobs.js";
import { createObserverEscalationReview } from "./server/observer-escalation-review.js";
import { createObserverOpportunityScan } from "./server/observer-opportunity-scan.js";
import { createObserverProjectCycleInspection } from "./server/observer-project-cycle-inspection.js";
import { createObserverProjectCycleSupport } from "./server/observer-project-cycle-support.js";
import { createObserverQueuedTaskPrompting } from "./server/observer-queued-task-prompting.js";
import { createObserverProjectPlanning } from "./server/observer-project-planning.js";
import { createObserverProjectWorkspaceSupport } from "./server/observer-project-workspace-support.js";
import { createObserverWaitingTaskHandling } from "./server/observer-waiting-task-handling.js";
import { createObserverWorkspaceTracking } from "./server/observer-workspace-tracking.js";
import { createObserverRuntimeFileCron } from "./server/observer-runtime-file-cron.js";
import { createObserverSecretsService } from "./server/observer-secrets-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const app = express();
app.use((req, res, next) => {
  const requestPath = String(req.path || "");
  if (
    requestPath === "/"
    || requestPath.startsWith("/api/")
    || /^\/observer(\.[^/]+)?\.(js|css)$/i.test(requestPath)
  ) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});
app.use(express.json({ limit: "12mb" }));
app.use("/vendor/three", express.static(path.join(__dirname, "node_modules", "three")));
app.use("/vendor/fonts", express.static(path.join(__dirname, "node_modules", "@fontsource")));
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3220);
const RUNTIME_ROOT = path.join(__dirname, ".observer-runtime");
const LEGACY_RUNTIME_ROOT = path.join(__dirname, ".observer-runtime");
const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const OBSERVER_INPUT_HOST_ROOT = path.resolve(__dirname, "..", "observer-input");
const OBSERVER_OUTPUT_HOST_ROOT = path.resolve(__dirname, "..", "observer-output");
const OBSERVER_ATTACHMENTS_ROOT = path.join(RUNTIME_ROOT, "observer-attachments");
const OBSERVER_OUTPUT_ROOT = OBSERVER_OUTPUT_HOST_ROOT;
const AGENT_WORKSPACES_ROOT = path.join(__dirname, ".agent-workspaces");
const PROMPT_AGENT_ID = "nova";
const LEGACY_PROMPT_WORKSPACE_ROOT = path.join(__dirname, "workspace-prompt-edit");
const PROMPT_WORKSPACE_ROOT = path.join(AGENT_WORKSPACES_ROOT, PROMPT_AGENT_ID);
const PROMPT_FILES_ROOT = path.join(PROMPT_WORKSPACE_ROOT, "prompt-files");
const PROMPT_PROJECTS_ROOT = path.join(PROMPT_WORKSPACE_ROOT, "projects");
const PROMPT_MEMORY_ROOT = path.join(PROMPT_WORKSPACE_ROOT, "memory");
const PROMPT_MEMORY_DAILY_ROOT = PROMPT_MEMORY_ROOT;
const PROMPT_MEMORY_QUESTIONS_ROOT = path.join(PROMPT_MEMORY_ROOT, "questions");
const PROMPT_MEMORY_PERSONAL_DAILY_ROOT = path.join(PROMPT_MEMORY_ROOT, "personal");
const PROMPT_MEMORY_BRIEFINGS_ROOT = path.join(PROMPT_MEMORY_ROOT, "briefings");
const PROMPT_USER_PATH = path.join(PROMPT_FILES_ROOT, "USER.md");
const PROMPT_MEMORY_CURATED_PATH = path.join(PROMPT_FILES_ROOT, "MEMORY.md");
const PROMPT_PERSONAL_PATH = path.join(PROMPT_FILES_ROOT, "PERSONAL.md");
const PROMPT_MAIL_RULES_PATH = path.join(PROMPT_FILES_ROOT, "MAIL-RULES.md");
const PROMPT_MEMORY_README_PATH = path.join(PROMPT_MEMORY_ROOT, "README.md");
const PROMPT_TODAY_BRIEFING_PATH = path.join(PROMPT_FILES_ROOT, "TODAY.md");
const OBSERVER_TASK_QUEUE_NAME = "observer-task-queue";
const LEGACY_OBSERVER_TASK_QUEUE_NAME = "observer-task-queue";
const TASK_QUEUE_ROOT = path.join(RUNTIME_ROOT, OBSERVER_TASK_QUEUE_NAME);
const LEGACY_TASK_QUEUE_ROOT = path.join(LEGACY_RUNTIME_ROOT, LEGACY_OBSERVER_TASK_QUEUE_NAME);
const TASK_QUEUE_WORKSPACE_PATH = OBSERVER_TASK_QUEUE_NAME;
const TASK_QUEUE_INBOX = path.join(TASK_QUEUE_ROOT, "inbox");
const TASK_QUEUE_WAITING = TASK_QUEUE_INBOX;
const TASK_QUEUE_IN_PROGRESS = path.join(TASK_QUEUE_ROOT, "in_progress");
const TASK_QUEUE_DONE = path.join(TASK_QUEUE_ROOT, "done");
const TASK_QUEUE_CLOSED = path.join(TASK_QUEUE_ROOT, "closed");
const CALENDAR_EVENTS_PATH = path.join(RUNTIME_ROOT, "calendar-events.json");
const TODO_STATE_PATH = path.join(RUNTIME_ROOT, "todo-list.json");
const TASK_PROGRESS_HEARTBEAT_MS = 60000;
const TASK_STALE_IN_PROGRESS_MS = 10 * 60 * 1000;
const TASK_ORPHANED_IN_PROGRESS_MS = 2 * TASK_PROGRESS_HEARTBEAT_MS;
const AGENT_RUN_TIMEOUT_MS = 20 * 60 * 1000;
const INTAKE_PLAN_TIMEOUT_MS = 3 * 60 * 1000;
const HELPER_SCOUT_TIMEOUT_MS = 3 * 60 * 1000;
const HELPER_IDLE_RESERVE_COUNT = 1;
const QUESTION_MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000;
const TODO_REMINDER_INTERVAL_MS = 30 * 60 * 1000;
const TODO_REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const OLLAMA_TRANSPORT_RETRY_COUNT = 2;
const OLLAMA_TRANSPORT_RETRY_DELAY_MS = 1200;
const OLLAMA_EMPTY_RESPONSE_RETRY_COUNT = 1;
const OLLAMA_ENDPOINT_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
const MODEL_KEEPALIVE = "30m";
const DEFAULT_MODEL_TEMPERATURE = 0.2;
const MAX_MODEL_TEMPERATURE = 0.4;
const MODEL_WARM_INTERVAL_MS = 4 * 60 * 1000;
const OPPORTUNITY_SCAN_IDLE_MS = 60 * 1000;
const OPPORTUNITY_SCAN_INTERVAL_MS = 60 * 1000;
const OPPORTUNITY_SCAN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const OPPORTUNITY_SCAN_MAX_QUEUED_BACKLOG = 5;
const TASK_RETENTION_MS = 1 * 24 * 60 * 60 * 1000;
const TASK_RETENTION_SWEEP_MS = 6 * 60 * 60 * 1000;
const CLOSED_TASK_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const LEGACY_TASK_QUEUE_RETIRE_AFTER_MS = 48 * 60 * 60 * 1000;
const MAX_CLOSED_TASK_FILES = 500;
const VISIBLE_COMPLETED_HISTORY_COUNT = 1;
const VISIBLE_FAILED_HISTORY_COUNT = 1;
const MAX_ACTIVE_PROJECT_WORK_PACKAGES_PER_PROJECT = 6;
const PROJECT_WORK_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const PROJECT_BACKUP_INTERVAL_MS = 15 * 60 * 1000;
const OLLAMA_CONTAINER = "ollama";
const LOCAL_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const OBSERVER_TOOL_CONTAINER = "observer-sandbox";
const OBSERVER_TOOL_IMAGE = "openclaw-safe";
const OBSERVER_TOOL_STATE_VOLUME = "observer-sandbox-state";
const OBSERVER_TOOL_RUNTIME_USER = "openclaw";
const OBSERVER_CONTAINER_HOME = "/home/openclaw";
const OBSERVER_CONTAINER_STATE_ROOT = `${OBSERVER_CONTAINER_HOME}/.observer-sandbox`;
const OBSERVER_CONTAINER_WORKSPACE_ROOT = `${OBSERVER_CONTAINER_STATE_ROOT}/workspace`;
const OBSERVER_CONTAINER_PROJECTS_ROOT = `${OBSERVER_CONTAINER_WORKSPACE_ROOT}/projects`;
const OBSERVER_CONTAINER_INPUT_ROOT = `${OBSERVER_CONTAINER_HOME}/observer-input`;
const OBSERVER_CONTAINER_OUTPUT_ROOT = `${OBSERVER_CONTAINER_HOME}/observer-output`;
const OBSERVER_CONTAINER_ATTACHMENTS_ROOT = `${OBSERVER_CONTAINER_HOME}/observer-attachments`;
const OBSERVER_CONTAINER_SEED_ROOT = `${OBSERVER_CONTAINER_HOME}/.observer-seed`;
const OBSERVER_CONTAINER_SKILLS_ROOT = `${OBSERVER_CONTAINER_WORKSPACE_ROOT}/skills`;
const DEFAULT_LARGE_ITEM_CHUNK_CHARS = 12000;
const MAX_LARGE_ITEM_CHUNK_CHARS = 24000;
const MAX_DOCUMENT_SOURCE_BYTES = 12 * 1024 * 1024;
const CONFIG_PATH = path.join(__dirname, "observer.config.json");
const LANGUAGE_CONFIG_PATH = path.join(__dirname, "observer.language.json");
const LEXICON_CONFIG_PATH = path.join(__dirname, "observer.lexicon.json");
const OPPORTUNITY_SCAN_STATE_PATH = path.join(RUNTIME_ROOT, "opportunity-scan-state.json");
const MAIL_WATCH_RULES_PATH = path.join(RUNTIME_ROOT, "mail-watch-rules.json");
const QUEUE_MAINTENANCE_LOG_PATH = path.join(RUNTIME_ROOT, "queue-maintenance-log.md");
const DOCUMENT_INDEX_PATH = path.join(RUNTIME_ROOT, "document-index.json");
const RETRIEVAL_STATE_PATH = path.join(RUNTIME_ROOT, "retrieval-state.json");
const DOCUMENT_RULES_PATH = path.join(RUNTIME_ROOT, "document-rules.json");
const MAIL_QUARANTINE_LOG_PATH = path.join(RUNTIME_ROOT, "mail-quarantine-log.json");
const VOICE_PATTERN_STORE_PATH = path.join(RUNTIME_ROOT, "voice-patterns.json");
const FAILURE_TELEMETRY_LOG_PATH = path.join(RUNTIME_ROOT, "failure-telemetry-log.md");
const TASK_RESHAPE_ISSUES_PATH = path.join(RUNTIME_ROOT, "task-reshape-issues.json");
const TASK_RESHAPE_LOG_PATH = path.join(RUNTIME_ROOT, "task-reshape-log.md");
const TASK_STATE_INDEX_PATH = path.join(RUNTIME_ROOT, "task-state-index.json");
const TASK_EVENT_LOG_PATH = path.join(RUNTIME_ROOT, "task-events.jsonl");
const REGRESSION_RUN_REPORT_PATH = path.join(RUNTIME_ROOT, "regression-last-run.json");
const SKILL_REGISTRY_PATH = path.join(RUNTIME_ROOT, "skill-registry.json");
const TOOL_REGISTRY_PATH = path.join(RUNTIME_ROOT, "tool-registry.json");
const CAPABILITY_REQUESTS_PATH = path.join(RUNTIME_ROOT, "capability-requests.json");
const WORDPRESS_SITE_REGISTRY_PATH = path.join(RUNTIME_ROOT, "wordpress-sites.json");
const SKILL_STAGING_ROOT = path.join(RUNTIME_ROOT, "skill-staging");
const SKILL_STAGING_SKILLS_DIR = path.join(SKILL_STAGING_ROOT, "skills");
const MAX_TASK_RESHAPE_ATTEMPTS = 3;
const DEFAULT_QDRANT_URL = process.env.QDRANT_URL || "http://127.0.0.1:6333";
const DEFAULT_QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "observer_chunks";
const INSPECT_ROOTS = {
  runtime: RUNTIME_ROOT,
  workspace: WORKSPACE_ROOT,
  queue: TASK_QUEUE_ROOT,
  output: OBSERVER_OUTPUT_ROOT,
  config: __dirname,
  memory: PROMPT_WORKSPACE_ROOT,
  public: path.join(__dirname, "public")
};
let observerConfig = createInitialObserverConfig({ localOllamaBaseUrl: LOCAL_OLLAMA_BASE_URL });
let observerLanguage = createInitialObserverLanguage();
let observerLexicon = {};
const observerSecrets = createObserverSecretsService();

// --- SSE clients for log stream ---
const clients = new Set();
const observerEventClients = new Set();
let taskDispatchInFlight = false;
let taskDispatchScheduled = false;
let taskDispatchStartedAt = 0;
let observerCronTickInFlight = false;
let brainWarmInFlight = false;
let opportunityScanInFlight = false;
let lastInteractiveActivityAt = Date.now();
let availableBrainsCache = { at: 0, brains: [] };
let ollamaEndpointHealthCache = { at: 0, entries: {} };
let ollamaEndpointFailureState = {};
let mailPollInFlight = false;
const activeTaskControllers = new Map();
const helperShadowCache = new Map();
const HELPER_SHADOW_CACHE_ENABLED = false;
const HELPER_ANALYSIS_TIMEOUT_MS = 1100;
const HELPER_ANALYSIS_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_WAITING_QUESTION_COUNT = 5;
let opportunityScanState = createInitialOpportunityScanState();
const mailState = createInitialMailState();
let mailWatchRulesState = createInitialMailWatchRulesState();
let documentRulesState = createInitialDocumentRulesState();
let voicePatternStore = createInitialVoicePatternStore();
let taskReshapeIssueState = null;

function invalidateObserverConfigCaches() {
  availableBrainsCache = { at: 0, brains: [] };
  ollamaEndpointHealthCache = { at: 0, entries: {} };
  ollamaEndpointFailureState = {};
}

function waitMs(delayMs = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(delayMs || 0))));
}

function formatOllamaTransportError(error) {
  const message = String(error?.message || "failed to reach Ollama API").trim();
  const cause = String(error?.cause?.message || error?.cause?.code || "").trim();
  if (cause && !message.toLowerCase().includes(cause.toLowerCase())) {
    return `${message} (${cause})`;
  }
  return message;
}

function isRetriableOllamaTransportError(error) {
  if (!error || error?.name === "AbortError") {
    return false;
  }
  const text = formatOllamaTransportError(error).toLowerCase();
  return text.includes("fetch failed")
    || text.includes("econnreset")
    || text.includes("socket")
    || text.includes("other side closed")
    || text.includes("network")
    || text.includes("und_err")
    || text.includes("connect")
    || text.includes("hang up")
    || text.includes("terminated");
}

function markOllamaEndpointTransportFailure(baseUrl, error) {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  ollamaEndpointFailureState[normalizedBaseUrl] = {
    failedAt: Date.now(),
    error: formatOllamaTransportError(error)
  };
  ollamaEndpointHealthCache = { at: 0, entries: { ...ollamaEndpointHealthCache.entries } };
}

function clearOllamaEndpointTransportFailure(baseUrl) {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  if (ollamaEndpointFailureState[normalizedBaseUrl]) {
    delete ollamaEndpointFailureState[normalizedBaseUrl];
    ollamaEndpointHealthCache = { at: 0, entries: { ...ollamaEndpointHealthCache.entries } };
  }
}

function getOllamaEndpointTransportCooldown(baseUrl) {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const failure = ollamaEndpointFailureState[normalizedBaseUrl];
  if (!failure) {
    return null;
  }
  const ageMs = Date.now() - Number(failure.failedAt || 0);
  if (ageMs >= OLLAMA_ENDPOINT_FAILURE_COOLDOWN_MS) {
    delete ollamaEndpointFailureState[normalizedBaseUrl];
    return null;
  }
  return {
    ...failure,
    remainingMs: OLLAMA_ENDPOINT_FAILURE_COOLDOWN_MS - ageMs
  };
}

function sanitizeConfigId(value = "", fallback = "") {
  const trimmed = String(value || "").trim().toLowerCase();
  const sanitized = trimmed.replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || String(fallback || "").trim().toLowerCase();
}

function sanitizeStringList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

async function setSecretValue(handle = "", value = "") {
  const result = await observerSecrets.setSecret(handle, value);
  return {
    handle: result.handle,
    hasSecret: true,
    backend: "system-keychain"
  };
}

async function getSecretStatus(handle = "") {
  const normalizedHandle = observerSecrets.normalizeSecretHandle(handle);
  return {
    handle: normalizedHandle,
    hasSecret: normalizedHandle ? await observerSecrets.hasSecret(normalizedHandle) : false,
    backend: "system-keychain"
  };
}

async function deleteSecretValue(handle = "") {
  const result = await observerSecrets.deleteSecret(handle);
  return {
    handle: result.handle,
    hasSecret: false,
    deleted: result.deleted,
    backend: "system-keychain"
  };
}

function buildMailAgentPasswordHandle(agentId = "") {
  return observerSecrets.buildMailAgentPasswordHandle(String(agentId || "").trim());
}

function buildQdrantApiKeyHandle() {
  return observerSecrets.normalizeSecretHandle(
    process.env.QDRANT_API_KEY_HANDLE || observerSecrets.buildQdrantApiKeyHandle()
  );
}

async function migrateLegacyQdrantApiKey(config = {}) {
  const apiKey = String(config?.apiKey || "").trim();
  const apiKeyHandle = observerSecrets.normalizeSecretHandle(
    config?.apiKeyHandle || buildQdrantApiKeyHandle()
  );
  if (apiKey && apiKeyHandle) {
    await observerSecrets.setSecret(apiKeyHandle, apiKey);
  }
  return apiKeyHandle;
}

function getRetrievalConfig() {
  const configured = observerConfig?.retrieval && typeof observerConfig.retrieval === "object"
    ? observerConfig.retrieval
    : {};
  return {
    qdrantUrl: String(configured.qdrantUrl || DEFAULT_QDRANT_URL).trim() || DEFAULT_QDRANT_URL,
    collectionName: String(configured.collectionName || DEFAULT_QDRANT_COLLECTION).trim() || DEFAULT_QDRANT_COLLECTION,
    apiKeyHandle: observerSecrets.normalizeSecretHandle(
      configured.apiKeyHandle || buildQdrantApiKeyHandle()
    )
  };
}

async function resolveQdrantApiKey() {
  const retrievalConfig = getRetrievalConfig();
  if (retrievalConfig.apiKeyHandle) {
    const stored = await observerSecrets.getSecret(retrievalConfig.apiKeyHandle);
    if (String(stored || "").trim()) {
      return String(stored || "").trim();
    }
  }
  return String(process.env.QDRANT_API_KEY || "").trim();
}

async function hasQdrantApiKey() {
  return Boolean(String(await resolveQdrantApiKey()).trim());
}

async function buildSecretsCatalog() {
  const mailAgents = await Promise.all(getMailAgents().map(async (agent) => ({
    id: agent.id,
    label: agent.label,
    email: agent.email,
    user: agent.user,
    passwordHandle: observerSecrets.normalizeSecretHandle(
      agent.passwordHandle || buildMailAgentPasswordHandle(agent.id)
    ),
    hasSecret: await hasMailPassword(agent),
    active: String(observerConfig?.mail?.activeAgentId || "").trim() === agent.id
  })));
  const wordpressSites = await listWordPressSites();
  const retrieval = getRetrievalConfig();
  return {
    serviceName: observerSecrets.serviceName,
    mail: {
      enabled: observerConfig?.mail?.enabled === true,
      activeAgentId: String(observerConfig?.mail?.activeAgentId || "").trim(),
      agents: mailAgents
    },
    wordpress: {
      sites: wordpressSites
    },
    retrieval: {
      qdrantUrl: retrieval.qdrantUrl,
      collectionName: retrieval.collectionName,
      apiKeyHandle: retrieval.apiKeyHandle,
      hasSecret: await hasQdrantApiKey()
    },
    suggestedHandles: [
      buildQdrantApiKeyHandle(),
      ...mailAgents.map((agent) => agent.passwordHandle),
      ...wordpressSites.map((site) => String(site.sharedSecretHandle || "").trim()).filter(Boolean)
    ].filter(Boolean)
  };
}

const PROJECT_MARKER_FILE_NAME = ".observer-project.json";
const PROJECT_READY_OUTPUT_ROOT = path.join(OBSERVER_OUTPUT_ROOT, "projects-ready");
const PROJECT_ARCHIVE_OUTPUT_ROOT = path.join(OBSERVER_OUTPUT_ROOT, "workspace-archive");
const PROJECT_BACKUP_OUTPUT_ROOT = path.join(OBSERVER_OUTPUT_ROOT, "project-backups");

function normalizeProjectHistoryKey(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function parseProjectTimestampLabel(label = "") {
  const text = String(label || "").trim();
  if (!text) {
    return 0;
  }
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const match = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-(.+))?$/);
  if (!match) {
    return 0;
  }
  const normalized = `${match[1]}:${match[2]}:${match[3]}.${match[4]}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readJsonFileIfExists(filePath = "") {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function readTextFileIfExists(filePath = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseMarkdownCheckboxLines(content = "") {
  const checked = [];
  const unchecked = [];
  const isPlaceholderCheckboxLabel = (value = "") => {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "none"
      || normalized === "n/a"
      || normalized === "na"
      || normalized === "no active tasks"
      || normalized === "no pending tasks"
      || normalized === "no completed tasks";
  };
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const match = rawLine.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const label = compactTaskText(String(match[2] || "").trim(), 220);
    if (!label || isPlaceholderCheckboxLabel(label)) {
      continue;
    }
    if (/x/i.test(String(match[1] || "").trim())) {
      checked.push(label);
    } else {
      unchecked.push(label);
    }
  }
  return { checked, unchecked };
}

function extractDirectiveObjectiveForOverview(content = "") {
  const lines = String(content || "").split(/\r?\n/);
  let insideObjectiveSection = false;
  const collected = [];
  for (const rawLine of lines) {
    const line = String(rawLine || "");
    if (/^\s*##\s+objective\s*$/i.test(line)) {
      insideObjectiveSection = true;
      continue;
    }
    if (insideObjectiveSection && /^\s*##\s+/.test(line)) {
      break;
    }
    if (insideObjectiveSection) {
      const trimmed = line.trim();
      if (!trimmed || /^[-*]\s+/.test(trimmed)) {
        continue;
      }
      collected.push(trimmed);
    }
  }
  if (collected.length) {
    return compactTaskText(collected.join(" "), 260);
  }
  const inlineMatch = String(content || "").match(/^\s*objective\s*:\s*(.+)$/im);
  if (inlineMatch?.[1]) {
    return compactTaskText(String(inlineMatch[1]).trim(), 260);
  }
  const nonHeadingLines = lines
    .map((line) => String(line || "").trim())
    .filter((line) => line && !/^#/.test(line) && !/^(priorities?|notes?)\s*:?\s*$/i.test(line));
  return compactTaskText(nonHeadingLines.slice(0, 2).join(" "), 260);
}

function buildChecklistSummary({
  todoChecked = [],
  todoUnchecked = [],
  roleChecked = [],
  roleUnchecked = [],
  directiveChecked = [],
  directiveUnchecked = [],
  directiveObjective = "",
  directiveCompleted = false,
  todoPath = "",
  roleTaskPath = "",
  directivePath = ""
} = {}) {
  const todoDone = Array.isArray(todoChecked) ? todoChecked : [];
  const todoOpen = Array.isArray(todoUnchecked) ? todoUnchecked : [];
  const roleDone = Array.isArray(roleChecked) ? roleChecked : [];
  const roleOpen = Array.isArray(roleUnchecked) ? roleUnchecked : [];
  const directiveDoneItems = Array.isArray(directiveChecked) ? directiveChecked : [];
  const directiveOpenItems = Array.isArray(directiveUnchecked) ? directiveUnchecked : [];
  const todoTotal = todoDone.length + todoOpen.length;
  const roleTotal = roleDone.length + roleOpen.length;
  const directiveTotal = directiveDoneItems.length + directiveOpenItems.length + (directiveObjective ? 1 : 0);
  const directiveDoneCount = directiveDoneItems.length + (directiveCompleted ? 1 : 0);
  const directiveOpenCount = directiveOpenItems.length + (!directiveCompleted && directiveObjective ? 1 : 0);
  const totalItems = todoTotal + roleTotal + directiveTotal;
  const completedItems = todoDone.length + roleDone.length + directiveDoneCount;
  const completionPercent = totalItems > 0
    ? Math.round((completedItems / totalItems) * 100)
    : 0;
  return {
    todoPath,
    roleTaskPath,
    directivePath,
    todo: {
      checkedCount: todoDone.length,
      uncheckedCount: todoOpen.length,
      checked: todoDone.slice(0, 8),
      unchecked: todoOpen.slice(0, 8)
    },
    roles: {
      checkedCount: roleDone.length,
      uncheckedCount: roleOpen.length,
      checked: roleDone.slice(0, 8),
      unchecked: roleOpen.slice(0, 8)
    },
    directive: {
      objective: compactTaskText(String(directiveObjective || "").trim(), 260),
      checkedCount: directiveDoneCount,
      uncheckedCount: directiveOpenCount,
      checked: directiveDoneItems.slice(0, 8),
      unchecked: directiveOpenItems.slice(0, 8),
      completed: directiveCompleted === true
    },
    totals: {
      completedItems,
      openItems: Math.max(0, totalItems - completedItems),
      totalItems,
      completionPercent
    }
  };
}

async function readHostProjectBoardState(projectRoot = "") {
  const normalizedRoot = String(projectRoot || "").trim();
  if (!normalizedRoot) {
    return {
      checklist: buildChecklistSummary(),
      roleReports: [],
      activeRoles: []
    };
  }
  const [todoContent, roleContent, directiveContent] = await Promise.all([
    readTextFileIfExists(path.join(normalizedRoot, "PROJECT-TODO.md")),
    readTextFileIfExists(path.join(normalizedRoot, "PROJECT-ROLE-TASKS.md")),
    readTextFileIfExists(path.join(normalizedRoot, "directive.md"))
  ]);
  const todoState = parseMarkdownCheckboxLines(todoContent);
  const roleState = parseMarkdownCheckboxLines(roleContent);
  const directiveState = parseMarkdownCheckboxLines(directiveContent);
  const directiveObjective = extractDirectiveObjectiveForOverview(directiveContent);
  const directiveInlineChecked = /\[[xX]\]/.test(String(directiveContent || ""));
  const directiveInlineUnchecked = /\[\s\]/.test(String(directiveContent || ""));
  const directiveCompleted = Boolean(
    directiveObjective
    && (
      (directiveState.checked.length && !directiveState.unchecked.length)
      || (directiveInlineChecked && !directiveInlineUnchecked)
    )
  );
  const roleBoardState = parseProjectRoleTaskBoardState(roleContent);
  return {
    checklist: buildChecklistSummary({
      todoChecked: todoState.checked,
      todoUnchecked: todoState.unchecked,
      roleChecked: roleState.checked,
      roleUnchecked: roleState.unchecked,
      directiveChecked: directiveState.checked,
      directiveUnchecked: directiveState.unchecked,
      directiveObjective,
      directiveCompleted,
      todoPath: path.join(normalizedRoot, "PROJECT-TODO.md"),
      roleTaskPath: path.join(normalizedRoot, "PROJECT-ROLE-TASKS.md"),
      directivePath: path.join(normalizedRoot, "directive.md")
    }),
    roleReports: Array.isArray(roleBoardState?.roleReports) ? roleBoardState.roleReports : [],
    activeRoles: Array.isArray(roleBoardState?.activeRoles) ? roleBoardState.activeRoles : []
  };
}

async function readWorkspaceProjectMarker(projectPath = "") {
  const normalizedPath = String(projectPath || "").trim();
  if (!normalizedPath) {
    return null;
  }
  try {
    const raw = await readContainerFile(`${normalizedPath}/${PROJECT_MARKER_FILE_NAME}`);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function listInputProjectHistoryEntries() {
  let entries = [];
  try {
    entries = await fs.readdir(OBSERVER_INPUT_HOST_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || String(entry.name || "").startsWith(".")) {
      continue;
    }
    const projectPath = path.join(OBSERVER_INPUT_HOST_ROOT, entry.name);
    let stat;
    try {
      stat = await fs.stat(projectPath);
    } catch {
      continue;
    }
    const marker = await readJsonFileIfExists(path.join(projectPath, PROJECT_MARKER_FILE_NAME));
    projects.push({
      kind: "input",
      name: String(marker?.projectName || entry.name || "").trim() || String(entry.name || "").trim(),
      sourceName: String(marker?.sourceName || entry.name || "").trim() || String(entry.name || "").trim(),
      path: projectPath,
      modifiedAt: Number(stat?.mtimeMs || 0),
      importedAt: Number(marker?.importedAt || 0),
      marker
    });
  }
  return projects;
}

async function scanStampedProjectArtifacts(rootPath = "", kind = "ready") {
  let stampEntries = [];
  try {
    stampEntries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const artifacts = [];
  for (const stampEntry of stampEntries) {
    if (!stampEntry.isDirectory()) {
      continue;
    }
    const stampRoot = path.join(rootPath, stampEntry.name);
    let projectEntries = [];
    try {
      projectEntries = await fs.readdir(stampRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    const occurredAt = parseProjectTimestampLabel(stampEntry.name);
    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory()) {
        continue;
      }
      const projectPath = path.join(stampRoot, projectEntry.name);
      const marker = await readJsonFileIfExists(path.join(projectPath, PROJECT_MARKER_FILE_NAME));
      let stat;
      try {
        stat = await fs.stat(projectPath);
      } catch {
        stat = null;
      }
      artifacts.push({
        kind,
        label: stampEntry.name,
        name: String(marker?.projectName || projectEntry.name || "").trim() || String(projectEntry.name || "").trim(),
        sourceName: String(marker?.sourceName || projectEntry.name || "").trim() || String(projectEntry.name || "").trim(),
        path: projectPath,
        occurredAt: occurredAt || Number(stat?.mtimeMs || 0),
        marker
      });
    }
  }
  return artifacts;
}

async function scanBackupProjectArtifacts(rootPath = "") {
  let projectEntries = [];
  try {
    projectEntries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const artifacts = [];
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) {
      continue;
    }
    const projectRoot = path.join(rootPath, projectEntry.name);
    let snapshotEntries = [];
    try {
      snapshotEntries = await fs.readdir(projectRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const snapshotEntry of snapshotEntries) {
      if (!snapshotEntry.isDirectory()) {
        continue;
      }
      const snapshotPath = path.join(projectRoot, snapshotEntry.name);
      const marker = await readJsonFileIfExists(path.join(snapshotPath, PROJECT_MARKER_FILE_NAME));
      let stat;
      try {
        stat = await fs.stat(snapshotPath);
      } catch {
        stat = null;
      }
      const reasonMatch = String(snapshotEntry.name || "").match(/^[^-].*?-(import|periodic|snapshot|manual|ready|archive)$/i);
      artifacts.push({
        kind: "backup",
        label: snapshotEntry.name,
        reason: String(reasonMatch?.[1] || "").trim().toLowerCase(),
        name: String(marker?.projectName || projectEntry.name || "").trim() || String(projectEntry.name || "").trim(),
        sourceName: String(marker?.sourceName || projectEntry.name || "").trim() || String(projectEntry.name || "").trim(),
        path: snapshotPath,
        occurredAt: parseProjectTimestampLabel(snapshotEntry.name) || Number(stat?.mtimeMs || 0),
        marker
      });
    }
  }
  return artifacts;
}

function summarizeProjectArtifact(artifact = {}) {
  return {
    kind: String(artifact.kind || "").trim(),
    label: String(artifact.label || "").trim(),
    path: String(artifact.path || "").trim(),
    occurredAt: Number(artifact.occurredAt || 0),
    reason: String(artifact.reason || "").trim()
  };
}

function summarizeProjectPipelineForPanel(pipeline = {}) {
  return {
    projectWorkKey: String(pipeline.projectWorkKey || "").trim(),
    focus: compactTaskText(String(pipeline.focus || "").trim(), 200),
    roleName: String(pipeline.projectWorkRoleName || "").trim(),
    roleReason: compactTaskText(String(pipeline.projectWorkRoleReason || "").trim(), 180),
    latestTaskId: String(pipeline.latestTaskId || "").trim(),
    latestCodename: String(pipeline.latestCodename || "").trim(),
    latestRequestedBrainLabel: String(pipeline.latestRequestedBrainLabel || pipeline.latestRequestedBrainId || "").trim(),
    finalStatus: String(pipeline.finalStatus || "").trim(),
    finalFailureClassification: String(pipeline.finalFailureClassification || "").trim(),
    attemptCount: Number(pipeline.attemptCount || 0),
    completedAttemptCount: Number(pipeline.completedAttemptCount || 0),
    failedAttemptCount: Number(pipeline.failedAttemptCount || 0),
    updatedAt: Number(pipeline.updatedAt || 0)
  };
}

function summarizeProjectTaskForPanel(task = {}) {
  return {
    id: String(task.id || "").trim(),
    codename: String(task.codename || task.id || "Task").trim(),
    status: String(task.status || "").trim(),
    requestedBrainLabel: String(task.requestedBrainLabel || task.requestedBrainId || "").trim(),
    focus: compactTaskText(String(task.projectWorkFocus || task.message || "").trim(), 180),
    roleName: String(task.projectWorkRoleName || "").trim(),
    roleReason: compactTaskText(String(task.projectWorkRoleReason || "").trim(), 180),
    summary: compactTaskText(String(task.resultSummary || task.reviewSummary || task.workerSummary || task.notes || "").trim(), 220),
    failureClassification: String(task.failureClassification || classifyFailureText(String(task.resultSummary || task.reviewSummary || task.workerSummary || task.notes || "").trim())).trim(),
    updatedAt: Number(task.completedAt || task.updatedAt || task.createdAt || 0)
  };
}

function deriveProjectPanelStage(entry = {}) {
  if (entry?.workspace?.present) {
    return entry.workspace.activeTaskCount > 0 || entry.workspace.waitingTaskCount > 0
      ? "active"
      : "workspace";
  }
  if (entry?.source?.present) {
    return "intake";
  }
  if (Array.isArray(entry?.history?.readyExports) && entry.history.readyExports.length) {
    return "completed";
  }
  if (Array.isArray(entry?.history?.archivedExports) && entry.history.archivedExports.length) {
    return "archived";
  }
  return "history";
}

const RECENT_READY_EXPORT_OVERVIEW_GRACE_MS = 5 * 60 * 1000;

function shouldPreferCompletedProjectOverview(entry = {}) {
  const latestReadyExport = Array.isArray(entry?.history?.readyExports) ? entry.history.readyExports[0] : null;
  if (!latestReadyExport?.path) {
    return false;
  }
  if (!entry?.workspace?.present) {
    return true;
  }
  const importedAt = Number(entry?.workspace?.importedAt || 0);
  const modifiedAt = Number(entry?.workspace?.modifiedAt || 0);
  const exportedAt = Number(latestReadyExport?.occurredAt || 0);
  if (!importedAt || !exportedAt) {
    return false;
  }
  const freshlyReimported = importedAt >= exportedAt && importedAt - exportedAt <= RECENT_READY_EXPORT_OVERVIEW_GRACE_MS;
  const untouchedSinceImport = modifiedAt <= importedAt;
  return freshlyReimported && untouchedSinceImport;
}

function serializeBrainEndpointConfig(entry = {}, id = "") {
  const endpointId = sanitizeConfigId(id, "endpoint");
  return {
    label: String(entry?.label || endpointId).trim() || endpointId,
    baseUrl: normalizeOllamaBaseUrl(entry?.baseUrl || "")
  };
}

function serializeCustomBrainConfig(entry = {}, index = 0, knownEndpointIds = new Set(["local"])) {
  const id = sanitizeConfigId(entry?.id, `custom_${index + 1}`);
  const kind = ["intake", "worker", "helper"].includes(String(entry?.kind || "").trim())
    ? String(entry.kind).trim()
    : "worker";
  const model = normalizeModelName(String(entry?.model || "").trim());
  if (!id || !model) {
    return null;
  }
  const endpointId = knownEndpointIds.has(String(entry?.endpointId || "").trim())
    ? String(entry.endpointId).trim()
    : "local";
  return {
    id,
    label: String(entry?.label || toBrainLabel(id)).trim() || toBrainLabel(id),
    kind,
    model,
    endpointId,
    queueLane: String(entry?.queueLane || "").trim(),
    specialty: String(entry?.specialty || "").trim().toLowerCase(),
    toolCapable: entry?.toolCapable === true,
    cronCapable: entry?.cronCapable === true,
    description: String(entry?.description || "").trim()
  };
}

function buildBrainConfigPayload() {
  return {
    brains: {
      enabledIds: Array.isArray(observerConfig?.brains?.enabledIds) ? observerConfig.brains.enabledIds : [],
      endpoints: getConfiguredBrainEndpoints(),
      assignments: observerConfig?.brains?.assignments && typeof observerConfig.brains.assignments === "object"
        ? observerConfig.brains.assignments
        : {},
      custom: Array.isArray(observerConfig?.brains?.custom) ? observerConfig.brains.custom : []
    },
    routing: getRoutingConfig(),
    queue: getQueueConfig(),
    builtInBrains: AGENT_BRAINS.map((brain) => ({
      id: brain.id,
      label: brain.label,
      kind: brain.kind,
      model: brain.model,
      description: brain.description
    }))
  };
}

async function buildProjectSystemStatePayload() {
  const projectConfig = getProjectConfig();
  const workspaceProjects = await listContainerWorkspaceProjects().catch(() => []);
  const { queued, waiting, inProgress, done, failed } = await listAllTasks();
  const closed = await listTasksByFolder(TASK_QUEUE_CLOSED, "closed").catch(() => []);
  const allProjectTaskHistory = [...queued, ...waiting, ...inProgress, ...done, ...failed, ...closed]
    .filter((task) => String(task?.projectName || "").trim());
  const [inputProjects, readyArtifacts, archivedArtifacts, backupArtifacts, workspaceProjectDetails] = await Promise.all([
    listInputProjectHistoryEntries(),
    scanStampedProjectArtifacts(PROJECT_READY_OUTPUT_ROOT, "ready"),
    scanStampedProjectArtifacts(PROJECT_ARCHIVE_OUTPUT_ROOT, "archive"),
    scanBackupProjectArtifacts(PROJECT_BACKUP_OUTPUT_ROOT),
    Promise.all(workspaceProjects.map(async (project) => ({
      ...project,
      marker: await readWorkspaceProjectMarker(project.path),
      todoState: await ensureProjectTodoForWorkspaceProject(project).catch(() => null)
    })))
  ]);
  const activeProjectTasks = [...queued, ...inProgress].filter((task) => String(task.internalJobType || "").trim() === "project_cycle");
  const waitingProjectTasks = waiting.filter((task) => String(task.internalJobType || "").trim() === "project_cycle");
  const recentProjectFailures = [...failed, ...done, ...closed]
    .filter((task) => String(task.internalJobType || "").trim() === "project_cycle")
    .filter((task) => {
      const status = String(task.status || "").trim().toLowerCase();
      return status === "failed" || classifyFailureText(String(task.resultSummary || task.reviewSummary || task.workerSummary || "").trim()) !== "unknown";
    })
    .sort((left, right) => Number(right.completedAt || right.updatedAt || right.createdAt || 0) - Number(left.completedAt || left.updatedAt || left.createdAt || 0))
    .slice(0, 12)
    .map((task) => ({
      id: task.id,
      codename: task.codename,
      projectName: task.projectName || "",
      status: task.status || "",
      updatedAt: Number(task.completedAt || task.updatedAt || task.createdAt || 0),
      failureClassification: String(task.failureClassification || classifyFailureText(String(task.resultSummary || task.reviewSummary || task.workerSummary || "").trim())).trim(),
      summary: compactTaskText(String(task.toolLoopDiagnostics?.summary || task.resultSummary || task.reviewSummary || task.workerSummary || task.notes || "").trim(), 220),
      toolLoopSummary: compactTaskText(String(task.toolLoopDiagnostics?.summary || "").trim(), 220)
    }));
  const projectTaskCounts = new Map();
  for (const task of activeProjectTasks) {
    const key = String(task.projectName || "").trim().toLowerCase();
    if (!key) {
      continue;
    }
    projectTaskCounts.set(key, Number(projectTaskCounts.get(key) || 0) + 1);
  }
  const workspaceProjectState = workspaceProjects
    .map((project) => ({
      name: String(project.name || "").trim(),
      path: String(project.path || "").trim(),
      modifiedAt: Number(project.modifiedAt || 0),
      activeTaskCount: Number(projectTaskCounts.get(String(project.name || "").trim().toLowerCase()) || 0)
    }))
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
  const recentImports = Object.entries(opportunityScanState.projectRotation?.recentImports || {})
    .map(([sourceName, importedAt]) => ({
      sourceName: String(sourceName || "").trim(),
      importedAt: Number(importedAt || 0)
    }))
    .sort((left, right) => right.importedAt - left.importedAt)
    .slice(0, 12);
  const allProjectPipelines = buildProjectPipelineCollection(allProjectTaskHistory);
  const recentProjectPipelines = allProjectPipelines
    .slice(0, 12)
    .map((pipeline) => ({
      projectWorkKey: pipeline.projectWorkKey,
      projectName: pipeline.projectName,
      focus: pipeline.focus,
      latestTaskId: pipeline.latestTaskId,
      latestCodename: pipeline.latestCodename,
      latestRequestedBrainId: pipeline.latestRequestedBrainId,
      latestRequestedBrainLabel: pipeline.latestRequestedBrainLabel,
      finalStatus: pipeline.finalStatus,
      finalFailureClassification: pipeline.finalFailureClassification,
      attemptCount: pipeline.attemptCount,
      handoffCount: pipeline.handoffCount,
      completedAttemptCount: pipeline.completedAttemptCount,
      failedAttemptCount: pipeline.failedAttemptCount,
      capabilityMismatchCount: pipeline.capabilityMismatchCount,
      updatedAt: pipeline.updatedAt
    }));
  const projectPanelMap = new Map();
  const ensureProjectPanel = ({ name = "", sourceName = "" } = {}) => {
    const key = normalizeProjectHistoryKey(sourceName, name);
    if (!key) {
      return null;
    }
    if (!projectPanelMap.has(key)) {
      projectPanelMap.set(key, {
        key,
        name: String(name || sourceName || "").trim(),
        sourceName: String(sourceName || name || "").trim(),
        aliases: [],
        source: {
          present: false,
          path: "",
          modifiedAt: 0,
          importedAt: 0
        },
        workspace: {
          present: false,
          path: "",
          modifiedAt: 0,
          importedAt: 0,
          activeTaskCount: 0,
          waitingTaskCount: 0
        },
        checklist: buildChecklistSummary(),
        roleReports: [],
        activeRoles: [],
        activeTasks: [],
        waitingTasks: [],
        recentJobs: [],
        recentTaskAttempts: [],
        history: {
          readyExports: [],
          archivedExports: [],
          backups: []
        },
        metrics: {
          completedJobs: 0,
          failedJobs: 0,
          activeJobs: 0
        },
        lastActivityAt: 0,
        currentStage: "history"
      });
    }
    const existing = projectPanelMap.get(key);
    existing.name = String(existing.name || name || sourceName || "").trim() || String(name || sourceName || "").trim();
    existing.sourceName = String(existing.sourceName || sourceName || name || "").trim() || String(sourceName || name || "").trim();
    for (const alias of [name, sourceName]) {
      const normalizedAlias = String(alias || "").trim();
      if (normalizedAlias && !existing.aliases.includes(normalizedAlias)) {
        existing.aliases.push(normalizedAlias);
      }
    }
    return existing;
  };

  for (const sourceProject of inputProjects) {
    const panel = ensureProjectPanel({ name: sourceProject.name, sourceName: sourceProject.sourceName });
    if (!panel) {
      continue;
    }
    panel.source = {
      present: true,
      path: String(sourceProject.path || "").trim(),
      modifiedAt: Number(sourceProject.modifiedAt || 0),
      importedAt: Number(sourceProject.importedAt || 0)
    };
    panel.lastActivityAt = Math.max(panel.lastActivityAt, panel.source.modifiedAt, panel.source.importedAt);
  }

  for (const project of workspaceProjectDetails) {
    const marker = project?.marker && typeof project.marker === "object" ? project.marker : {};
    const panel = ensureProjectPanel({
      name: String(marker?.projectName || project?.name || "").trim(),
      sourceName: String(marker?.sourceName || project?.name || "").trim()
    });
    if (!panel) {
      continue;
    }
    const activeTaskCount = activeProjectTasks.filter((task) =>
      normalizeProjectHistoryKey(task.projectName) === panel.key
    ).length;
    const waitingTaskCount = waitingProjectTasks.filter((task) =>
      normalizeProjectHistoryKey(task.projectName) === panel.key
    ).length;
    panel.workspace = {
      present: true,
      path: String(project.path || "").trim(),
      modifiedAt: Number(project.modifiedAt || 0),
      importedAt: Number(marker?.importedAt || 0),
      activeTaskCount,
      waitingTaskCount
    };
    if (project?.todoState) {
      panel.checklist = buildChecklistSummary({
        todoChecked: project.todoState.checked,
        todoUnchecked: project.todoState.unchecked,
        roleChecked: project.todoState.roleChecked,
        roleUnchecked: project.todoState.roleUnchecked,
        directiveChecked: Array.isArray(project.todoState?.directiveState?.checkedItems)
          ? project.todoState.directiveState.checkedItems.map((entry) => String(entry?.label || entry?.focus || "").trim()).filter(Boolean)
          : [],
        directiveUnchecked: Array.isArray(project.todoState?.directiveState?.uncheckedItems)
          ? project.todoState.directiveState.uncheckedItems.map((entry) => String(entry?.label || entry?.focus || "").trim()).filter(Boolean)
          : [],
        directiveObjective: String(project.todoState?.directiveState?.objectiveText || "").trim(),
        directiveCompleted: project.todoState?.directiveCompleted === true,
        todoPath: String(project.todoState?.todoPath || "").trim(),
        roleTaskPath: String(project.todoState?.roleTaskPath || "").trim(),
        directivePath: String(project.todoState?.directiveState?.path ? `${project.path}/${project.todoState.directiveState.path}` : "").trim()
      });
      panel.roleReports = Array.isArray(project.todoState?.roleReports) ? project.todoState.roleReports : [];
      panel.activeRoles = Array.isArray(project.todoState?.activeRoles) ? project.todoState.activeRoles : [];
    }
    panel.lastActivityAt = Math.max(
      panel.lastActivityAt,
      panel.workspace.modifiedAt,
      panel.workspace.importedAt
    );
  }

  const addArtifactHistory = (artifact = {}) => {
    const panel = ensureProjectPanel({ name: artifact.name, sourceName: artifact.sourceName });
    if (!panel) {
      return;
    }
    if (artifact.kind === "ready") {
      panel.history.readyExports.push(summarizeProjectArtifact(artifact));
    } else if (artifact.kind === "archive") {
      panel.history.archivedExports.push(summarizeProjectArtifact(artifact));
    } else if (artifact.kind === "backup") {
      panel.history.backups.push(summarizeProjectArtifact(artifact));
    }
    panel.lastActivityAt = Math.max(panel.lastActivityAt, Number(artifact.occurredAt || 0));
  };
  readyArtifacts.forEach(addArtifactHistory);
  archivedArtifacts.forEach(addArtifactHistory);
  backupArtifacts.forEach(addArtifactHistory);

  const tasksByProjectKey = new Map();
  for (const task of allProjectTaskHistory) {
    const key = normalizeProjectHistoryKey(task.projectName);
    if (!key) {
      continue;
    }
    if (!tasksByProjectKey.has(key)) {
      tasksByProjectKey.set(key, []);
    }
    tasksByProjectKey.get(key).push(task);
    ensureProjectPanel({ name: task.projectName, sourceName: task.projectName });
  }

  const pipelinesByProjectKey = new Map();
  for (const pipeline of allProjectPipelines) {
    const key = normalizeProjectHistoryKey(pipeline.projectName);
    if (!key) {
      continue;
    }
    if (!pipelinesByProjectKey.has(key)) {
      pipelinesByProjectKey.set(key, []);
    }
    pipelinesByProjectKey.get(key).push(pipeline);
    ensureProjectPanel({ name: pipeline.projectName, sourceName: pipeline.projectName });
  }

  for (const panel of projectPanelMap.values()) {
    const projectTasks = (tasksByProjectKey.get(panel.key) || [])
      .sort((left, right) => Number(right.completedAt || right.updatedAt || right.createdAt || 0) - Number(left.completedAt || left.updatedAt || left.createdAt || 0));
    const projectPipelines = (pipelinesByProjectKey.get(panel.key) || [])
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
    panel.activeTasks = projectTasks
      .filter((task) => ["queued", "in_progress"].includes(String(task.status || "").trim()))
      .slice(0, 6)
      .map((task) => summarizeProjectTaskForPanel(task));
    panel.waitingTasks = projectTasks
      .filter((task) => String(task.status || "").trim() === "waiting_for_user")
      .slice(0, 4)
      .map((task) => summarizeProjectTaskForPanel(task));
    panel.recentTaskAttempts = projectTasks
      .filter((task) => !["queued", "in_progress", "waiting_for_user"].includes(String(task.status || "").trim()))
      .slice(0, 8)
      .map((task) => summarizeProjectTaskForPanel(task));
    panel.recentJobs = projectPipelines
      .slice(0, 8)
      .map((pipeline) => summarizeProjectPipelineForPanel(pipeline));
    panel.metrics = {
      completedJobs: projectPipelines.filter((pipeline) => ["completed", "closed", "done"].includes(String(pipeline.finalStatus || "").trim())).length,
      failedJobs: projectPipelines.filter((pipeline) => String(pipeline.finalStatus || "").trim() === "failed").length,
      activeJobs: projectPipelines.filter((pipeline) => ["queued", "in_progress", "waiting_for_user"].includes(String(pipeline.finalStatus || "").trim())).length
    };
    for (const task of projectTasks) {
      panel.lastActivityAt = Math.max(panel.lastActivityAt, Number(task.completedAt || task.updatedAt || task.createdAt || 0));
    }
    for (const pipeline of projectPipelines) {
      panel.lastActivityAt = Math.max(panel.lastActivityAt, Number(pipeline.updatedAt || 0));
    }
    panel.history.readyExports.sort((left, right) => Number(right.occurredAt || 0) - Number(left.occurredAt || 0));
    panel.history.archivedExports.sort((left, right) => Number(right.occurredAt || 0) - Number(left.occurredAt || 0));
    panel.history.backups.sort((left, right) => Number(right.occurredAt || 0) - Number(left.occurredAt || 0));

    const preferCompletedOverview = shouldPreferCompletedProjectOverview(panel);
    const needsHostChecklist = !panel.workspace.present && !panel.checklist?.totals?.totalItems;
    if (preferCompletedOverview || needsHostChecklist) {
      const preferredHistoryPath = preferCompletedOverview
        ? panel.history.readyExports[0]?.path
        : (panel.source.present
          ? panel.source.path
          : (panel.history.readyExports[0]?.path || panel.history.archivedExports[0]?.path || panel.history.backups[0]?.path || ""));
      if (preferredHistoryPath) {
        const hostBoardState = await readHostProjectBoardState(preferredHistoryPath);
        panel.checklist = hostBoardState?.checklist || buildChecklistSummary();
        panel.roleReports = Array.isArray(hostBoardState?.roleReports) ? hostBoardState.roleReports : panel.roleReports;
        panel.activeRoles = Array.isArray(hostBoardState?.activeRoles) ? hostBoardState.activeRoles : panel.activeRoles;
      }
    }
    if (preferCompletedOverview) {
      panel.activeTasks = [];
      panel.waitingTasks = [];
      panel.metrics = {
        ...panel.metrics,
        activeJobs: 0
      };
      panel.currentStage = "completed";
    } else {
      panel.currentStage = deriveProjectPanelStage(panel);
    }
  }

  const projectPanels = [...projectPanelMap.values()]
    .map((panel) => ({
      ...panel,
      aliases: panel.aliases.slice(0, 8),
      activeRoles: Array.isArray(panel.activeRoles) ? panel.activeRoles.slice(0, 10) : [],
      roleReports: Array.isArray(panel.roleReports) ? panel.roleReports.filter((entry) => entry?.selected || entry?.totalCount > 0).slice(0, 12) : [],
      history: {
        readyExports: panel.history.readyExports.slice(0, 6),
        archivedExports: panel.history.archivedExports.slice(0, 6),
        backups: panel.history.backups.slice(0, 6)
      }
    }))
    .sort((left, right) => {
      const leftWorkspace = left.workspace.present ? 1 : 0;
      const rightWorkspace = right.workspace.present ? 1 : 0;
      if (leftWorkspace !== rightWorkspace) {
        return rightWorkspace - leftWorkspace;
      }
      return Number(right.lastActivityAt || 0) - Number(left.lastActivityAt || 0);
    });
  return {
    config: projectConfig,
    summary: {
      workspaceProjectCount: workspaceProjectState.length,
      activeProjectTaskCount: activeProjectTasks.length,
      waitingProjectTaskCount: waitingProjectTasks.length,
      recentProjectFailureCount: recentProjectFailures.length,
      trackedProjectCount: projectPanels.length,
      completedProjectCount: projectPanels.filter((panel) => panel.currentStage === "completed").length,
      historyOnlyProjectCount: projectPanels.filter((panel) => panel.currentStage === "history" || panel.currentStage === "archived").length
    },
    workspaceProjects: workspaceProjectState,
    activeProjectTasks: activeProjectTasks.slice(0, 20).map((task) => ({
      id: task.id,
      codename: task.codename,
      projectName: task.projectName || "",
      status: task.status || "",
      focus: compactTaskText(String(task.projectWorkFocus || task.message || "").trim(), 180),
      requestedBrainLabel: task.requestedBrainLabel || task.requestedBrainId || "",
      updatedAt: Number(task.updatedAt || task.createdAt || 0)
    })),
    recentImports,
    recentProjectPipelines,
    projectPanels,
    recentProjectFailures,
    rolePlaybooks: PROJECT_ROLE_PLAYBOOKS.map((entry) => ({
      name: entry.name,
      playbook: entry.playbook
    })),
    policies: {
      targetScoring: [
        "Filename matches and focus keywords are weighted heavily.",
        "Planning docs are penalized as concrete targets.",
        "README files get a small positive score.",
        "If no scored target exists, the first concrete file by extension is used."
      ],
      loopRepair: [
        "Repeated startup bundles are repaired locally for project-cycle tasks.",
        "Planning-only repeats are redirected into implementation roots.",
        "The named first target is advanced to the next concrete target after successful startup inspection.",
        "Inspection-only streaks now stop early unless the worker converges to a change, artifact, capability request, or valid no-change conclusion."
      ]
    }
  };
}

async function saveObserverConfig() {
  const serializedConfig = {
    ...observerConfig,
    retrieval: observerConfig?.retrieval && typeof observerConfig.retrieval === "object"
      ? {
          ...observerConfig.retrieval,
          apiKey: "",
          apiKeyHandle: observerSecrets.normalizeSecretHandle(
            observerConfig?.retrieval?.apiKeyHandle || buildQdrantApiKeyHandle()
          )
        }
      : observerConfig.retrieval,
    mail: observerConfig?.mail && typeof observerConfig.mail === "object"
      ? {
          ...observerConfig.mail,
          agents: Object.fromEntries(
            Object.entries(observerConfig.mail.agents || {}).map(([id, agent]) => [String(id), {
              ...agent,
              password: "",
              passwordHandle: observerSecrets.normalizeSecretHandle(
                agent?.passwordHandle || (id ? buildMailAgentPasswordHandle(id) : "")
              )
            }])
          )
        }
      : observerConfig.mail
  };
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(serializedConfig, null, 2)}\n`, "utf8");
  invalidateObserverConfigCaches();
}

async function loadVoicePatternStore() {
  try {
    const raw = await fs.readFile(VOICE_PATTERN_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    voicePatternStore = {
      profiles: Array.isArray(parsed?.profiles)
        ? parsed.profiles.map((entry, index) => normalizeVoiceTrustProfile(entry, index)).filter((entry) => entry.label || entry.signature.length)
        : []
    };
  } catch {
    const migratedProfiles = Array.isArray(observerConfig?.app?.trust?.voiceProfiles) && observerConfig.app.trust.voiceProfiles.length
      ? observerConfig.app.trust.voiceProfiles.map((entry, index) => normalizeVoiceTrustProfile(entry, index)).filter((entry) => entry.label || entry.signature.length)
      : (Array.isArray(observerConfig?.app?.trust?.records)
        ? observerConfig.app.trust.records
          .map((entry, index) => normalizeCombinedTrustRecord(entry, index))
          .filter((entry) => entry.signature.length)
          .map((entry, index) => normalizeVoiceTrustProfile(entry, index))
        : []);
    voicePatternStore = {
      profiles: migratedProfiles
    };
    if (migratedProfiles.length) {
      await saveVoicePatternStore();
      if (observerConfig?.app?.trust) {
        observerConfig.app.trust = {
          ...observerConfig.app.trust,
          voiceProfiles: []
        };
        await saveObserverConfig();
      }
    }
  }
}

async function saveVoicePatternStore() {
  voicePatternStore = {
    profiles: Array.isArray(voicePatternStore?.profiles)
      ? voicePatternStore.profiles.map((entry, index) => normalizeVoiceTrustProfile(entry, index)).filter((entry) => entry.label || entry.signature.length)
      : []
  };
  await writeVolumeText(VOICE_PATTERN_STORE_PATH, `${JSON.stringify(voicePatternStore, null, 2)}\n`);
}

function defaultAppRoomTextures() {
  return {
    walls: "",
    floor: "",
    ceiling: "",
    windowFrame: ""
  };
}

function defaultAppPropSlots() {
  return {
    backWallLeft: { model: "", scale: 1 },
    backWallRight: { model: "", scale: 1 },
    wallLeft: { model: "", scale: 1 },
    wallRight: { model: "", scale: 1 },
    besideLeft: { model: "", scale: 1 },
    besideRight: { model: "", scale: 1 },
    outsideLeft: { model: "", scale: 1 },
    outsideRight: { model: "", scale: 1 }
  };
}

function defaultAppReactionPathsByModel() {
  return {};
}

function normalizeTrustLevel(...args) { return memoryTrustDomain.normalizeTrustLevel(...args); }
function getTrustLevelRank(...args) { return memoryTrustDomain.getTrustLevelRank(...args); }
function trustLevelLabel(...args) { return memoryTrustDomain.trustLevelLabel(...args); }
function isTrustLevelAtLeast(...args) { return memoryTrustDomain.isTrustLevelAtLeast(...args); }
function defaultAppTrustConfig(...args) { return memoryTrustDomain.defaultAppTrustConfig(...args); }
function normalizeTrustAliasList(...args) { return memoryTrustDomain.normalizeTrustAliasList(...args); }
function normalizeTrustSignature(...args) { return memoryTrustDomain.normalizeTrustSignature(...args); }
function mergeTrustNotes(...args) { return memoryTrustDomain.mergeTrustNotes(...args); }
function hasCombinedTrustRecordData(...args) { return memoryTrustDomain.hasCombinedTrustRecordData(...args); }
function normalizeEmailTrustSource(...args) { return memoryTrustDomain.normalizeEmailTrustSource(...args); }
function normalizeVoiceTrustProfile(...args) { return memoryTrustDomain.normalizeVoiceTrustProfile(...args); }
function normalizeCombinedTrustRecord(...args) { return memoryTrustDomain.normalizeCombinedTrustRecord(...args); }
function mergeTrustRecord(...args) { return memoryTrustDomain.mergeTrustRecord(...args); }
function findMatchingTrustRecordIndex(...args) { return memoryTrustDomain.findMatchingTrustRecordIndex(...args); }
function upsertTrustRecord(...args) { return memoryTrustDomain.upsertTrustRecord(...args); }
function trustRecordsToEmailSources(...args) { return memoryTrustDomain.trustRecordsToEmailSources(...args); }
function trustRecordsToVoiceProfiles(...args) { return memoryTrustDomain.trustRecordsToVoiceProfiles(...args); }
function sanitizeTrustRecordForConfig(...args) { return memoryTrustDomain.sanitizeTrustRecordForConfig(...args); }
function normalizeAppTrustConfig(...args) { return memoryTrustDomain.normalizeAppTrustConfig(...args); }
function getAppTrustConfig(...args) { return memoryTrustDomain.getAppTrustConfig(...args); }
function getTrustedEmailSourceRecords(...args) { return memoryTrustDomain.getTrustedEmailSourceRecords(...args); }
function describeSourceTrust(...args) { return memoryTrustDomain.describeSourceTrust(...args); }
function normalizeSourceIdentityRecord(...args) { return memoryTrustDomain.normalizeSourceIdentityRecord(...args); }
function findMatchingEmailTrustSource(...args) { return memoryTrustDomain.findMatchingEmailTrustSource(...args); }
function assessEmailSourceIdentity(...args) { return memoryTrustDomain.assessEmailSourceIdentity(...args); }
function inspectMailCommand(...args) { return memoryTrustDomain.inspectMailCommand(...args); }
function getSourceTrustPolicy(...args) { return memoryTrustDomain.getSourceTrustPolicy(...args); }

function normalizePropScale(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0.2, Math.min(parsed, 3));
}

function normalizeReactionPathProfile(value = {}) {
  const profile = value && typeof value === "object" ? value : {};
  const talkingClips = Array.isArray(profile.talkingClips)
    ? [...new Set(profile.talkingClips.map((entry) => String(entry || "").trim()).filter(Boolean))]
    : [];
  const rawPaths = profile.paths && typeof profile.paths === "object" ? profile.paths : {};
  const paths = Object.fromEntries(
    Object.entries(rawPaths)
      .map(([emotion, clip]) => [String(emotion || "").trim().toLowerCase(), String(clip || "").trim()])
      .filter(([emotion, clip]) => emotion && clip)
  );
  return {
    idleClip: String(profile.idleClip || "").trim(),
    talkingClips,
    paths
  };
}

function normalizeReactionPathsByModel(value, allowedModelPaths = []) {
  const entries = value && typeof value === "object" ? Object.entries(value) : [];
  const allowed = new Set((Array.isArray(allowedModelPaths) ? allowedModelPaths : []).map((entry) => String(entry || "").trim()).filter(Boolean));
  return Object.fromEntries(
    entries
      .map(([modelPath, profile]) => [String(modelPath || "").trim(), normalizeReactionPathProfile(profile)])
      .filter(([modelPath, profile]) => modelPath && (!allowed.size || allowed.has(modelPath)) && (
        profile.idleClip
        || profile.talkingClips.length
        || Object.keys(profile.paths).length
      ))
  );
}

function normalizeStylizationFilterPreset(value, fallback = "none") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["none", "soft", "cinematic", "noir", "vivid", "haunted", "surveillance", "crystal", "whimsical", "dream", "retro_vhs", "toon"].includes(normalized) ? normalized : fallback;
}

function normalizeStylizationEffectPreset(value, fallback = "none") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["none", "toon", "dream", "retro_vhs", "whimsical"].includes(normalized) ? normalized : fallback;
}

async function walkAssetDirectory(dirPath, relativePrefix = "") {
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await walkAssetDirectory(entryPath, relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath.replaceAll("\\", "/"));
    }
  }
  return files;
}

async function listPublicAssetChoices() {
  const assetsDir = path.join(__dirname, "public", "assets");
  const files = await walkAssetDirectory(assetsDir);
  const toPublicPath = (fileName) => `/assets/${fileName}`;
  const filterByPath = (pattern) => files
    .filter((name) => pattern.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map(toPublicPath);
  const characters = filterByPath(/^characters\/.+\.glb$/i);
  const props = filterByPath(/^props\/.+\.glb$/i);
  const skies = filterByPath(/^skies\/.+\.(png|jpg|jpeg)$/i);
  const textures = filterByPath(/^textures\/.+\.(png|jpg|jpeg)$/i);
  return {
    characters,
    props,
    skies,
    textures,
    models: characters,
    backgrounds: skies
  };
}

/**
 * Broadcast a line to all connected SSE clients.
 */
function broadcast(line) {
  const msg = `data: ${JSON.stringify({ ts: Date.now(), line })}\n\n`;
  for (const res of clients) {
    res.write(msg);
  }
}

function broadcastObserverEvent(event) {
  const payload = {
    ts: Date.now(),
    ...event
  };
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of observerEventClients) {
    res.write(msg);
  }
}

function scheduleTaskDispatch(delayMs = 150) {
  if (observerConfig?.queue?.paused === true) {
    return;
  }
  if (taskDispatchScheduled) {
    return;
  }
  taskDispatchScheduled = true;
  setTimeout(async () => {
    taskDispatchScheduled = false;
    try {
      await recoverStaleTaskDispatchLock();
      await processQueuedTasksToCapacity();
    } catch (error) {
      broadcast(`[observer] task dispatch error: ${error.message}`);
    }
  }, delayMs);
}

function runCommand(command, args, { input, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeout = null;

    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");

    p.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    p.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    p.on("error", reject);
    p.on("close", (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({
        code: timedOut ? 124 : code,
        stdout: stdout.trim(),
        stderr: timedOut
          ? `${stderr.trim()}${stderr.trim() ? "\n" : ""}Observer timeout after ${Math.round(Number(timeoutMs || 0) / 1000)}s`
          : stderr.trim(),
        timedOut
      });
    });

    if (input) {
      p.stdin.write(input);
    }
    p.stdin.end();

    if (Number(timeoutMs || 0) > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        try {
          p.kill("SIGTERM");
        } catch {
          // ignore
        }
        setTimeout(() => {
          try {
            p.kill("SIGKILL");
          } catch {
            // ignore
          }
        }, 2000);
      }, Number(timeoutMs));
    }
  });
}

const {
  ensureObserverToolContainer,
  normalizeDockerComparePath,
  runObserverToolContainerNode
} = createObserverSandboxService({
  fs,
  runCommand,
  ensurePromptWorkspaceScaffolding,
  ensureInputHostRoot: () => fs.mkdir(OBSERVER_INPUT_HOST_ROOT, { recursive: true }),
  ensureOutputHostRoot: () => fs.mkdir(OBSERVER_OUTPUT_HOST_ROOT, { recursive: true }),
  observerToolContainer: OBSERVER_TOOL_CONTAINER,
  observerToolImage: OBSERVER_TOOL_IMAGE,
  observerToolStateVolume: OBSERVER_TOOL_STATE_VOLUME,
  observerToolRuntimeUser: OBSERVER_TOOL_RUNTIME_USER,
  observerInputHostRoot: OBSERVER_INPUT_HOST_ROOT,
  observerOutputHostRoot: OBSERVER_OUTPUT_HOST_ROOT,
  promptWorkspaceRoot: PROMPT_WORKSPACE_ROOT,
  promptProjectsRoot: PROMPT_PROJECTS_ROOT,
  observerContainerStateRoot: OBSERVER_CONTAINER_STATE_ROOT,
  observerContainerWorkspaceRoot: OBSERVER_CONTAINER_WORKSPACE_ROOT,
  observerContainerProjectsRoot: OBSERVER_CONTAINER_PROJECTS_ROOT,
  observerContainerInputRoot: OBSERVER_CONTAINER_INPUT_ROOT,
  observerContainerOutputRoot: OBSERVER_CONTAINER_OUTPUT_ROOT,
  observerContainerSkillsRoot: OBSERVER_CONTAINER_SKILLS_ROOT
});
const {
  listContainerFiles,
  quotePowerShellString,
  quoteShellPath,
  readContainerFile,
  readContainerFileBuffer,
  runGatewayShell,
  stripAnsi
} = createSandboxIoService({
  runCommand,
  runObserverToolContainerNode
});
const {
  archiveWorkspaceProjectsToOutput,
  editContainerTextFile,
  inspectWorkspaceProject,
  importRepositoryProjectToWorkspace,
  listContainerWorkspaceProjects,
  listFilesInContainer,
  moveContainerPath,
  snapshotWorkspaceProjectToOutput,
  moveWorkspaceProjectToOutput,
  runSandboxShell,
  writeContainerTextFile
} = createSandboxWorkspaceService({
  ensureObserverToolContainer,
  observerContainerInputRoot: OBSERVER_CONTAINER_INPUT_ROOT,
  observerContainerOutputRoot: OBSERVER_CONTAINER_OUTPUT_ROOT,
  runObserverToolContainerNode,
  runCommand,
  observerToolContainer: OBSERVER_TOOL_CONTAINER,
  observerContainerWorkspaceRoot: OBSERVER_CONTAINER_WORKSPACE_ROOT,
  observerContainerProjectsRoot: OBSERVER_CONTAINER_PROJECTS_ROOT,
  quoteShellPath
});

async function runOllamaPrompt(model, prompt, { timeoutMs = AGENT_RUN_TIMEOUT_MS, signal = null, baseUrl = LOCAL_OLLAMA_BASE_URL, images = [] } = {}) {
  return runOllamaJsonGenerate(model, prompt, {
    timeoutMs,
    keepAlive: MODEL_KEEPALIVE,
    options: {},
    baseUrl,
    images,
    signal,
    format: WORKER_DECISION_JSON_SCHEMA
  });
}

async function runOllamaJsonGenerate(model, prompt, {
  timeoutMs = AGENT_RUN_TIMEOUT_MS,
  keepAlive = "",
  options = {},
  baseUrl = LOCAL_OLLAMA_BASE_URL,
  images = [],
  signal = null,
  format = "json"
} = {}) {
  return runOllamaGenerate(model, prompt, {
    timeoutMs,
    keepAlive,
    options,
    baseUrl,
    images,
    signal,
    format
  });
}

function normalizeGenerationOptions(options = {}) {
  const normalized = options && typeof options === "object" ? { ...options } : {};
  const requestedTemperature = Number(normalized.temperature);
  if (Number.isFinite(requestedTemperature)) {
    normalized.temperature = Math.min(Math.max(requestedTemperature, 0), MAX_MODEL_TEMPERATURE);
  } else {
    normalized.temperature = DEFAULT_MODEL_TEMPERATURE;
  }
  return normalized;
}

function parseRawHttpResponse(rawResponse = "") {
  const boundary = rawResponse.indexOf("\r\n\r\n");
  if (boundary < 0) {
    throw new Error("invalid HTTP response from Ollama");
  }
  const head = rawResponse.slice(0, boundary);
  let body = rawResponse.slice(boundary + 4);
  const lines = head.split("\r\n");
  const statusLine = lines.shift() || "";
  const statusMatch = statusLine.match(/^HTTP\/\d+\.\d+\s+(\d+)/i);
  const status = Number(statusMatch?.[1] || 0);
  const headers = {};
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index <= 0) {
      continue;
    }
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  if (/chunked/i.test(headers["transfer-encoding"] || "")) {
    body = decodeChunkedBody(body);
  }
  return {
    status,
    headers,
    body
  };
}

function decodeChunkedBody(body = "") {
  let cursor = 0;
  let decoded = "";
  while (cursor < body.length) {
    const lineEnd = body.indexOf("\r\n", cursor);
    if (lineEnd < 0) {
      break;
    }
    const lengthHex = body.slice(cursor, lineEnd).trim();
    const length = Number.parseInt(lengthHex, 16);
    if (!Number.isFinite(length)) {
      throw new Error("invalid chunked response from Ollama");
    }
    cursor = lineEnd + 2;
    if (length === 0) {
      break;
    }
    decoded += body.slice(cursor, cursor + length);
    cursor += length + 2;
  }
  return decoded;
}

async function runOllamaGenerate(model, prompt, {
  timeoutMs = AGENT_RUN_TIMEOUT_MS,
  keepAlive = "",
  options = {},
  baseUrl = LOCAL_OLLAMA_BASE_URL,
  images = [],
  signal = null,
  format = ""
} = {}) {
  const normalizedOptions = normalizeGenerationOptions(options);
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const controller = new AbortController();
  const abortExternal = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortExternal, { once: true });
    }
  }
  const timeout = Number(timeoutMs || 0) > 0
    ? setTimeout(() => controller.abort(), Number(timeoutMs))
    : null;
  try {
    for (let attempt = 0; attempt <= OLLAMA_TRANSPORT_RETRY_COUNT; attempt += 1) {
      try {
        const response = await fetch(`${normalizedBaseUrl}/api/generate`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            think: false,
            ...(format ? { format } : {}),
            ...(keepAlive ? { keep_alive: keepAlive } : {}),
            ...(Array.isArray(images) && images.length ? { images } : {}),
            options: normalizedOptions
          }),
          signal: controller.signal
        });
        let parsed = {};
        try {
          parsed = await response.json();
        } catch {
          parsed = {};
        }
        if (!response.ok) {
          return {
            ok: false,
            code: response.status,
            text: "",
            stderr: String(parsed?.error || `Ollama API returned ${response.status}`),
            timedOut: false
          };
        }
        const responseText = stripAnsi(parsed.response || "");
        if (!responseText.trim()) {
          const thinkingText = stripAnsi(parsed.thinking || parsed.message?.content || "");
          if (attempt < OLLAMA_EMPTY_RESPONSE_RETRY_COUNT) {
            await waitMs(OLLAMA_TRANSPORT_RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
          return {
            ok: false,
            code: 0,
            text: "",
            stderr: thinkingText.trim()
              ? "empty model response (thinking-only output)"
              : "empty model response",
            timedOut: false
          };
        }
        clearOllamaEndpointTransportFailure(normalizedBaseUrl);
        return {
          ok: true,
          code: response.status,
          text: responseText,
          stderr: "",
          timedOut: false
        };
      } catch (error) {
        if (error?.name === "AbortError") {
          throw error;
        }
        const retriable = isRetriableOllamaTransportError(error);
        if (retriable && attempt < OLLAMA_TRANSPORT_RETRY_COUNT) {
          await waitMs(OLLAMA_TRANSPORT_RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        markOllamaEndpointTransportFailure(normalizedBaseUrl, error);
        return {
          ok: false,
          code: 0,
          text: "",
          stderr: formatOllamaTransportError(error),
          timedOut: false
        };
      }
    }
    return {
      ok: false,
      code: 0,
      text: "",
      stderr: "failed to reach Ollama API",
      timedOut: false
    };
  } catch (error) {
    const externallyAborted = Boolean(signal?.aborted);
    return {
      ok: false,
      code: error?.name === "AbortError" ? 124 : 0,
      text: "",
      stderr: error?.name === "AbortError"
        ? (externallyAborted ? "task aborted by user" : `Observer timeout after ${Math.round(Number(timeoutMs || 0) / 1000)}s`)
        : formatOllamaTransportError(error),
      timedOut: error?.name === "AbortError" && !externallyAborted
    };
  } finally {
    if (signal) {
      signal.removeEventListener("abort", abortExternal);
    }
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function warmRuntimeBrains() {
  if (brainWarmInFlight) {
    return;
  }
  brainWarmInFlight = true;
  try {
    const intakeBrain = await chooseIntakePlanningBrain() || await getBrain("bitnet");
    const workerBrain = await getBrain("worker");
    const warmups = [
      {
        brain: intakeBrain,
        prompt: "READY",
        options: { num_gpu: 0, temperature: 0, top_k: 1, num_predict: 1 }
      },
      {
        brain: workerBrain,
        prompt: "READY",
        options: { temperature: 0, top_k: 1, num_predict: 1 }
      }
    ];
    for (const warmup of warmups) {
      const result = await runOllamaGenerate(warmup.brain.model, warmup.prompt, {
        timeoutMs: 180000,
        keepAlive: MODEL_KEEPALIVE,
        options: warmup.options,
        baseUrl: warmup.brain.ollamaBaseUrl
      });
      if (!result.ok) {
        broadcast(`[observer] unable to warm ${warmup.brain.label}: ${result.stderr || "unknown error"}`);
      }
    }
  } finally {
    brainWarmInFlight = false;
  }
}

function extractJsonObject(text = "") {
  const raw = String(text || "")
    .replace(/<\/?think>/gi, "\n")
    .trim();
  if (!raw) {
    throw new Error("empty model response");
  }
  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : raw;
  const errors = [];
  const directCandidates = buildJsonRepairCandidates(candidate);
  const directParsed = parseFirstJsonCandidateFromList(directCandidates, errors);
  if (directParsed.ok) {
    return directParsed.value;
  }
  const balancedCandidates = collectBalancedJsonCandidates(directCandidates);
  if (!balancedCandidates.length) {
    throw new Error("model did not return JSON");
  }
  const balancedParsed = parseFirstJsonCandidateFromList(balancedCandidates, errors);
  if (balancedParsed.ok) {
    return balancedParsed.value;
  }
  throw errors[errors.length - 1] || new Error("model did not return JSON");
}

async function retryJsonEnvelope(model, rawText, schemaHint, { timeoutMs = 45000, options = undefined, baseUrl = LOCAL_OLLAMA_BASE_URL } = {}) {
  const repairPrompt = [
    "Rewrite the previous response as one JSON object only.",
    "Return JSON only. No markdown fences. No explanation outside JSON.",
    schemaHint,
    "If the previous response was prose, place it in assistant_message and final_text, with tool_calls as [].",
    "If the previous response implies tool use, convert it into valid OpenAI-style tool_calls.",
    "Never return a top-level role=tool or tool_results object; convert tool echoes into a valid assistant envelope.",
    "Do not wrap the real envelope inside assistant_message, final_text, or any other string field.",
    "If the previous response already contains a JSON envelope inside a quoted string, extract that envelope and return it as the top-level object.",
    "",
    "Previous response:",
    String(rawText || "").slice(0, 12000)
  ].join("\n");
  const retry = await runOllamaJsonGenerate(model, repairPrompt, {
    timeoutMs,
    keepAlive: MODEL_KEEPALIVE,
    options,
    baseUrl,
    format: WORKER_DECISION_JSON_SCHEMA
  });
  if (!retry.ok) {
    return { ok: false, text: "", error: retry.stderr || "JSON retry failed" };
  }
  return { ok: true, text: retry.text || "", error: "" };
}

async function debugJsonEnvelopeWithPlanner({
  model,
  rawText,
  parseError,
  schemaHint,
  baseUrl = LOCAL_OLLAMA_BASE_URL
} = {}) {
  const routing = getRoutingConfig();
  const plannerIdCandidates = [
    String(routing.remoteTriageBrainId || "").trim(),
    "toolrouter"
  ].filter(Boolean);
  const plannerBrain = await choosePlannerRepairBrain(plannerIdCandidates, {
    preferRemote: normalizeOllamaBaseUrl(baseUrl) !== LOCAL_OLLAMA_BASE_URL
  });
  const debugBrain = plannerBrain?.id
    ? plannerBrain
    : {
        model,
        ollamaBaseUrl: baseUrl
      };
  const debugPrompt = [
    "You are repairing a malformed worker JSON envelope for Nova.",
    "Return one valid JSON object only. No prose, no markdown, no code fences.",
    schemaHint,
    "Repair the structure conservatively. Preserve the original intent.",
    "If the content implies tool use, return valid OpenAI-style tool_calls.",
    "If it is only prose, put it in assistant_message and final_text with tool_calls as [].",
    "Never return a top-level role=tool or tool_results object; convert tool echoes into a valid assistant envelope.",
    "Do not leave the actual envelope nested inside assistant_message, final_text, or another quoted field.",
    "If the malformed response contains a JSON envelope inside a string, extract it and return it as the top-level object.",
    `Parse error: ${String(parseError || "unknown parse error").trim()}`,
    "",
    "Malformed response:",
    String(rawText || "").slice(0, 12000)
  ].join("\n");
  const repaired = await runOllamaJsonGenerate(debugBrain.model, debugPrompt, {
    timeoutMs: 30000,
    keepAlive: MODEL_KEEPALIVE,
    baseUrl: debugBrain.ollamaBaseUrl || baseUrl,
    format: WORKER_DECISION_JSON_SCHEMA
  });
  if (!repaired.ok) {
    return { ok: false, text: "", error: repaired.stderr || "planner JSON repair failed", plannerBrainId: plannerBrain?.id || "" };
  }
  return { ok: true, text: repaired.text || "", error: "", plannerBrainId: plannerBrain?.id || "" };
}

async function replanRepeatedToolLoopWithPlanner({
  message,
  transcript = [],
  repeatedToolCallSignature = "",
  executedTools = [],
  inspectedTargets = [],
  baseUrl = LOCAL_OLLAMA_BASE_URL
} = {}) {
  const localRepair = buildLocalRepeatedToolLoopRepair({
    message,
    repeatedToolCallSignature,
    inspectedTargets
  });
  if (localRepair) {
    return localRepair;
  }
  const localGroundedRepair = buildLocalGroundedTaskLoopRepair({
    message,
    repeatedToolCallSignature,
    inspectedTargets
  });
  if (localGroundedRepair) {
    return localGroundedRepair;
  }
  const routing = getRoutingConfig();
  const plannerIdCandidates = [
    String(routing.remoteTriageBrainId || "").trim(),
    "helper",
    "toolrouter"
  ].filter(Boolean);
  const plannerBrain = await choosePlannerRepairBrain(plannerIdCandidates, {
    preferRemote: normalizeOllamaBaseUrl(baseUrl) !== LOCAL_OLLAMA_BASE_URL
  });
  const debugBrain = plannerBrain?.id
    ? plannerBrain
    : await getBrain("bitnet");
  const inspectFirstTarget = extractTaskDirectiveValue(message, "Inspect first:");
  const inspectSecondTarget = extractTaskDirectiveValue(message, "Inspect second if needed:");
  const inspectThirdTarget = extractTaskDirectiveValue(message, "Inspect third if needed:");
  const prompt = [
    "You are Nova's tool-plan repair helper.",
    "Return one valid JSON object only. No prose, no markdown, no code fences.",
    "Use exactly this schema:",
    "{\"assistant_message\":\"...\",\"tool_calls\":[{\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"tool_name\",\"arguments\":\"{\\\"key\\\":\\\"value\\\"}\"}}],\"final\":false}",
    "Choose exactly one next move.",
    "Do not repeat the same tool call with the same arguments.",
    "Prefer a concrete inspection or execution step that advances the task immediately.",
    "If the repeated plan was reading a planning file again, switch to a concrete implementation file or directory.",
    "If the task already required PROJECT-TODO.md, PROJECT-ROLE-TASKS.md, and a named concrete file, treat that startup bundle as already done and advance to the next concrete target or edit step instead of repeating it.",
    "Recent transcript:",
    buildTranscriptForPrompt(transcript.slice(-5)),
    "",
    `User request: ${String(message || "").trim()}`,
    `Repeated tool signature: ${String(repeatedToolCallSignature || "").trim()}`,
    `Tools already executed: ${(Array.isArray(executedTools) ? executedTools.join(", ") : "") || "none"}`,
    `Inspected targets: ${(Array.isArray(inspectedTargets) ? inspectedTargets.join(", ") : "") || "none"}`,
    `Inspect first target: ${inspectFirstTarget || "none"}`,
    `Inspect second target: ${inspectSecondTarget || "none"}`,
    `Inspect third target: ${inspectThirdTarget || "none"}`
  ].join("\n");
  const repaired = await runOllamaJsonGenerate(debugBrain.model, prompt, {
    timeoutMs: 45000,
    keepAlive: MODEL_KEEPALIVE,
    baseUrl: debugBrain.ollamaBaseUrl || baseUrl,
    options: plannerBrain && isCpuQueueLane(plannerBrain) ? { num_gpu: 0 } : undefined,
    format: WORKER_DECISION_JSON_SCHEMA
  });
  if (!repaired.ok) {
    return { ok: false, decision: null, error: repaired.stderr || "planner tool-loop repair failed", plannerBrainId: plannerBrain?.id || "" };
  }
  try {
    const decision = normalizeWorkerDecisionEnvelope(extractJsonObject(repaired.text));
    const toolCalls = Array.isArray(decision?.tool_calls) ? decision.tool_calls : [];
    if (decision?.final || !toolCalls.length) {
      return { ok: false, decision: null, error: "planner did not return a replacement tool plan", plannerBrainId: plannerBrain?.id || "" };
    }
    return { ok: true, decision, error: "", plannerBrainId: plannerBrain?.id || "" };
  } catch (error) {
    return { ok: false, decision: null, error: error.message || "planner tool-loop repair parse failed", plannerBrainId: plannerBrain?.id || "" };
  }
}

const {
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
} = createToolLoopRepairHelpers({
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
});

const {
  buildToolLoopStepDiagnostics,
  buildToolLoopStopMessage,
  buildToolLoopSummaryText,
  buildToolSemanticFailureMessage,
  createToolLoopDiagnostics,
  diffFileSnapshots,
  isSemanticallySuccessfulToolResult,
  recordToolLoopStepDiagnostics
} = createToolLoopDiagnosticsHelpers({
  compactTaskText,
  normalizeToolName
});

function normalizeModelName(model) {
  return String(model || "").replace(/^ollama\//, "");
}

function normalizeOllamaBaseUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return LOCAL_OLLAMA_BASE_URL;
  }
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

function getConfiguredBrainEndpoints() {
  const configured = observerConfig?.brains?.endpoints && typeof observerConfig.brains.endpoints === "object"
    ? observerConfig.brains.endpoints
    : {};
  const entries = Object.entries(configured).map(([id, entry]) => {
    const baseUrl = normalizeOllamaBaseUrl(entry?.baseUrl || "");
    return [String(id), {
      id: String(id),
      label: String(entry?.label || id),
      baseUrl
    }];
  });
  if (!entries.some(([id]) => id === "local")) {
    entries.unshift(["local", { id: "local", label: "Local Ollama", baseUrl: LOCAL_OLLAMA_BASE_URL }]);
  }
  return Object.fromEntries(entries);
}

function getBrainEndpointForId(brainId = "") {
  const endpoints = getConfiguredBrainEndpoints();
  const assignments = observerConfig?.brains?.assignments && typeof observerConfig.brains.assignments === "object"
    ? observerConfig.brains.assignments
    : {};
  const endpointId = String(assignments[String(brainId || "")] || "local");
  const endpoint = endpoints[endpointId] || endpoints.local || { id: "local", label: "Local Ollama", baseUrl: LOCAL_OLLAMA_BASE_URL };
  return {
    ...endpoint,
    id: endpoint.id || endpointId
  };
}

function decorateBrain(brain) {
  const endpoint = brain?.endpointId || brain?.ollamaBaseUrl
    ? {
        id: String(brain.endpointId || "custom"),
        label: String(brain.endpointLabel || brain.endpointId || "Custom endpoint"),
        baseUrl: normalizeOllamaBaseUrl(brain.ollamaBaseUrl || "")
      }
    : getBrainEndpointForId(brain?.id || "");
  const baseUrl = normalizeOllamaBaseUrl(endpoint.baseUrl || "");
  return {
    ...brain,
    endpointId: String(endpoint.id || "local"),
    endpointLabel: String(endpoint.label || endpoint.id || "Local Ollama"),
    ollamaBaseUrl: baseUrl,
    remote: baseUrl !== LOCAL_OLLAMA_BASE_URL,
    queueLane: String(brain?.queueLane || "").trim()
  };
}

function normalizeCustomBrainConfig(entry, index = 0) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const id = String(entry.id || `custom_${index + 1}`).trim();
  const kind = ["intake", "worker", "helper"].includes(String(entry.kind || "").trim())
    ? String(entry.kind || "").trim()
    : "worker";
  const model = normalizeModelName(String(entry.model || "").trim());
  if (!id || !model) {
    return null;
  }
  const endpoint = entry.baseUrl
    ? {
        id: String(entry.endpointId || id),
        label: String(entry.endpointLabel || entry.label || id),
        baseUrl: normalizeOllamaBaseUrl(entry.baseUrl)
      }
    : (() => {
        const configuredEndpoints = getConfiguredBrainEndpoints();
        const explicitEndpointId = String(entry.endpointId || "").trim();
        if (explicitEndpointId && configuredEndpoints[explicitEndpointId]) {
          return configuredEndpoints[explicitEndpointId];
        }
        return getBrainEndpointForId(id);
      })();
  return decorateBrain({
    id,
    label: String(entry.label || toBrainLabel(id)),
    kind,
    model,
    specialty: String(entry.specialty || "").trim().toLowerCase(),
    toolCapable: entry.toolCapable == null ? kind === "worker" : entry.toolCapable === true,
    cronCapable: entry.cronCapable === true,
    description: String(entry.description || "Network Ollama brain"),
    queueLane: String(entry.queueLane || "").trim(),
    endpointId: endpoint.id,
    endpointLabel: endpoint.label,
    ollamaBaseUrl: endpoint.baseUrl
  });
}

function getAgentPersonaName() {
  return String(observerConfig?.app?.botName || "Agent").trim() || "Agent";
}

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

function stripNovaEmotionTags(text = "") {
  return String(text || "")
    .replace(/\[nova:(emotion|animation)=[^\]]+\]/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function inferNovaEmotionForText(text = "", context = "reply") {
  const clean = stripNovaEmotionTags(text).toLowerCase();
  const normalizedContext = String(context || "reply").trim().toLowerCase();
  if (!clean) {
    return normalizedContext === "question" ? "shrug" : "calm";
  }
  if (normalizedContext === "question") return "shrug";
  if (normalizedContext === "failure") return /\b(sorry|apolog|regret)\b/.test(clean) ? "hurt" : "angry";
  if (normalizedContext === "success" || normalizedContext === "output") return "celebrate";
  if (/\b(what did you mean|can you clarify|which one|what should i|how should i|could you confirm|do you want)\b/.test(clean)) return "shrug";
  if (/\b(done|finished|complete|completed|wrapped up|ready|created|generated|saved|sent to output|exported|packaged)\b/.test(clean)) return "celebrate";
  if (/\b(failed|error|problem|issue|couldn'?t|cannot|can'?t|blocked|timeout|timed out)\b/.test(clean)) return "angry";
  if (/\b(think|consider|reviewed|checked|looked|found|explained|because)\b/.test(clean)) return "reflect";
  if (/\b(yes|exactly|agreed|correct|right)\b/.test(clean)) return "agree";
  return "explain";
}

function annotateNovaSpeechText(text = "", context = "reply") {
  const raw = String(text || "").trim();
  if (!raw || /\[nova:(emotion|animation)=/i.test(raw)) {
    return raw;
  }
  const emotion = inferNovaEmotionForText(raw, context);
  return emotion ? `[nova:emotion=${emotion}] ${raw}` : raw;
}

function noteInteractiveActivity() {
  lastInteractiveActivityAt = Date.now();
}

function getEnabledBrainIds() {
  const configured = Array.isArray(observerConfig?.brains?.enabledIds)
    ? observerConfig.brains.enabledIds
    : [];
  return new Set((configured.length ? configured : ["bitnet", "worker"]).map((value) => String(value)));
}

function getRoutingConfig() {
  const specialistMap = observerConfig?.routing?.specialistMap && typeof observerConfig.routing.specialistMap === "object"
    ? observerConfig.routing.specialistMap
    : {};
  return {
    enabled: observerConfig?.routing?.enabled === true,
    remoteTriageBrainId: String(observerConfig?.routing?.remoteTriageBrainId || "").trim(),
    fallbackAttempts: Math.max(0, Math.min(Number(observerConfig?.routing?.fallbackAttempts || 2), 4)),
    specialistMap: {
      code: Array.isArray(specialistMap.code) ? specialistMap.code.map((value) => String(value)).filter(Boolean) : [],
      document: Array.isArray(specialistMap.document) ? specialistMap.document.map((value) => String(value)).filter(Boolean) : [],
      general: Array.isArray(specialistMap.general) ? specialistMap.general.map((value) => String(value)).filter(Boolean) : [],
      background: Array.isArray(specialistMap.background) ? specialistMap.background.map((value) => String(value)).filter(Boolean) : [],
      creative: Array.isArray(specialistMap.creative) ? specialistMap.creative.map((value) => String(value)).filter(Boolean) : [],
      vision: Array.isArray(specialistMap.vision) ? specialistMap.vision.map((value) => String(value)).filter(Boolean) : [],
      retrieval: Array.isArray(specialistMap.retrieval) ? specialistMap.retrieval.map((value) => String(value)).filter(Boolean) : []
    }
  };
}

function getQueueConfig() {
  const configured = observerConfig?.queue && typeof observerConfig.queue === "object"
    ? observerConfig.queue
    : {};
  return {
    remoteParallel: configured.remoteParallel !== false,
    escalationEnabled: configured.escalationEnabled !== false,
    paused: configured.paused === true
  };
}

function normalizeProjectConfigInput(configured = {}) {
  const source = configured && typeof configured === "object" ? configured : {};
  const numericOrDefault = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    maxActiveWorkPackagesPerProject: Math.max(1, Math.min(numericOrDefault(source.maxActiveWorkPackagesPerProject, MAX_ACTIVE_PROJECT_WORK_PACKAGES_PER_PROJECT), 12)),
    projectWorkRetryCooldownMs: Math.max(0, numericOrDefault(source.projectWorkRetryCooldownMs, PROJECT_WORK_RETRY_COOLDOWN_MS)),
    projectBackupIntervalMs: Math.max(60 * 1000, numericOrDefault(source.projectBackupIntervalMs, PROJECT_BACKUP_INTERVAL_MS)),
    opportunityScanIdleMs: Math.max(5000, numericOrDefault(source.opportunityScanIdleMs, OPPORTUNITY_SCAN_IDLE_MS)),
    opportunityScanIntervalMs: Math.max(10000, numericOrDefault(source.opportunityScanIntervalMs, OPPORTUNITY_SCAN_INTERVAL_MS)),
    opportunityScanRetentionMs: Math.max(60 * 60 * 1000, numericOrDefault(source.opportunityScanRetentionMs, OPPORTUNITY_SCAN_RETENTION_MS)),
    opportunityScanMaxQueuedBacklog: Math.max(1, Math.min(numericOrDefault(source.opportunityScanMaxQueuedBacklog, OPPORTUNITY_SCAN_MAX_QUEUED_BACKLOG), 50)),
    noChangeMinimumConcreteTargets: Math.max(1, Math.min(numericOrDefault(source.noChangeMinimumConcreteTargets, 3), 6)),
    autoCreateProjectDirective: source.autoCreateProjectDirective !== false,
    autoCreateProjectTodo: source.autoCreateProjectTodo !== false,
    autoCreateProjectRoleTasks: source.autoCreateProjectRoleTasks !== false,
    autoImportProjects: source.autoImportProjects !== false,
    autoBackupWorkspaceProjects: source.autoBackupWorkspaceProjects !== false,
    autoExportReadyProjects: source.autoExportReadyProjects !== false
  };
}

function getProjectConfig() {
  return normalizeProjectConfigInput(observerConfig?.projects && typeof observerConfig.projects === "object"
    ? observerConfig.projects
    : {});
}

function getProjectNoChangeMinimumTargets() {
  return getProjectConfig().noChangeMinimumConcreteTargets;
}

function buildProjectConfigPayload() {
  return {
    projects: getProjectConfig(),
    rolePlaybooks: PROJECT_ROLE_PLAYBOOKS.map((entry) => ({
      name: entry.name,
      playbook: entry.playbook
    }))
  };
}

function isCpuQueueLane(brain) {
  const explicitLane = String(brain?.queueLane || "").trim().toLowerCase();
  if (explicitLane.includes("gpu")) {
    return false;
  }
  if (explicitLane.includes("cpu")) {
    return true;
  }
  const text = `${String(brain?.model || "").toLowerCase()} ${String(brain?.description || "").toLowerCase()} ${String(brain?.specialty || "").toLowerCase()}`;
  return /\bcpu\b/.test(text);
}

function getBrainQueueLane(brain) {
  if (!brain || brain.kind === "intake") {
    return "";
  }
  if (String(brain.queueLane || "").trim()) {
    return String(brain.queueLane || "").trim();
  }
  const endpointId = String(brain.endpointId || "local").trim() || "local";
  if (brain.remote) {
    return isCpuQueueLane(brain) ? `endpoint:${endpointId}:cpu` : `endpoint:${endpointId}:gpu`;
  }
  return isCpuQueueLane(brain) ? `endpoint:${endpointId}:cpu` : `endpoint:${endpointId}:gpu`;
}

async function listHealthyToolWorkers() {
  const availableBrains = await listAvailableBrains();
  const workerCandidates = availableBrains.filter((brain) => brain.kind === "worker" && brain.toolCapable);
  const healthEntries = await Promise.all(workerCandidates.map(async (brain) => ({
    brain,
    health: await getOllamaEndpointHealth(brain.ollamaBaseUrl)
  })));
  return healthEntries
    .filter((entry) => entry.health?.running)
    .map((entry) => entry.brain);
}

function isGenerativeHelperBrain(brain = {}) {
  if (String(brain.kind || "").trim() !== "helper") {
    return false;
  }
  const specialty = String(brain.specialty || "").trim().toLowerCase();
  const text = [
    String(brain.id || ""),
    String(brain.label || ""),
    String(brain.model || ""),
    String(brain.description || ""),
    specialty
  ].join(" ").toLowerCase();
  if (specialty === "retrieval") {
    return false;
  }
  if (/\b(embed|embedding|vector|mxbai)\b/.test(text)) {
    return false;
  }
  return true;
}

async function listHealthyRoutingHelpers() {
  const availableBrains = await listAvailableBrains();
  const helperCandidates = availableBrains.filter((brain) => {
    if (brain.kind !== "helper") {
      return false;
    }
    if (!isGenerativeHelperBrain(brain)) {
      return false;
    }
    const specialty = String(brain.specialty || "").toLowerCase();
    const description = String(brain.description || "").toLowerCase();
    return specialty === "routing"
      || specialty === "general"
      || /\b(route|routing|triage|planner|planning|classification)\b/.test(description);
  });
  const healthEntries = await Promise.all(helperCandidates.map(async (brain) => ({
    brain,
    health: await getOllamaEndpointHealth(brain.ollamaBaseUrl)
  })));
  return healthEntries
    .filter((entry) => entry.health?.running)
    .map((entry) => entry.brain);
}

async function chooseHealthyRemoteTriageBrain({ availableBrains = null, laneLoad = null } = {}) {
  const routing = getRoutingConfig();
  const brains = Array.isArray(availableBrains) ? availableBrains : await listAvailableBrains();
  const queueLaneLoad = laneLoad instanceof Map ? laneLoad : await getQueueLaneLoadSnapshot();
  const healthyRoutingHelpers = await listHealthyRoutingHelpers();
  const configuredPlanner = routing.remoteTriageBrainId
    ? brains.find((brain) => brain.id === routing.remoteTriageBrainId)
    : null;
  const candidateHelpers = [
    configuredPlanner,
    ...healthyRoutingHelpers
  ]
    .filter(Boolean)
    .filter((brain) => brain.remote === true);
  if (!candidateHelpers.length) {
    return null;
  }
  return candidateHelpers.sort((left, right) => {
    const leftLoad = Number(queueLaneLoad.get(getBrainQueueLane(left)) || 0);
    const rightLoad = Number(queueLaneLoad.get(getBrainQueueLane(right)) || 0);
    if (leftLoad !== rightLoad) {
      return leftLoad - rightLoad;
    }
    const leftConfigured = left.id === String(routing.remoteTriageBrainId || "").trim() ? 1 : 0;
    const rightConfigured = right.id === String(routing.remoteTriageBrainId || "").trim() ? 1 : 0;
    if (leftConfigured !== rightConfigured) {
      return rightConfigured - leftConfigured;
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  })[0] || null;
}

async function getQueueLaneLoadSnapshot() {
  const counts = new Map();
  const record = async (task) => {
    const lane = String(task?.queueLane || "").trim()
      || getBrainQueueLane(await getBrain(task?.requestedBrainId || "worker"));
    if (!lane) {
      return;
    }
    counts.set(lane, Number(counts.get(lane) || 0) + 1);
  };
  const { queued, inProgress, waiting } = await listAllTasks();
  for (const task of [...queued, ...inProgress, ...waiting]) {
    await record(task);
  }
  return counts;
}

async function getHealthyWorkerLaneIds() {
  const workers = await listHealthyToolWorkers();
  return [...new Set(workers.map((brain) => String(brain.queueLane || getBrainQueueLane(brain)).trim()).filter(Boolean))];
}

async function getTotalBackgroundExecutionCapacity() {
  const queueConfig = getQueueConfig();
  if (!(await isRemoteParallelDispatchEnabled())) {
    return 1;
  }
  const laneIds = await getHealthyWorkerLaneIds();
  const capacity = laneIds.length || 1;
  return Math.max(1, Math.min(queueConfig.remoteParallel ? capacity : 1, 6));
}

async function getIdleBackgroundExecutionCapacity() {
  return getTotalBackgroundExecutionCapacity();
}

async function buildBrainActivitySnapshot() {
  const brains = await listAvailableBrains();
  const { queued, waiting, inProgress, done, failed } = await listAllTasks();
  const allTasks = [...queued, ...waiting, ...inProgress, ...done, ...failed];
  const now = Date.now();
  return Promise.all(brains.map(async (brain) => {
    const queueLane = String(brain.queueLane || getBrainQueueLane(brain)).trim();
    const brainTasks = allTasks.filter((task) => String(task.requestedBrainId || "") === String(brain.id || ""));
    const activeTask = inProgress.find((task) => String(task.requestedBrainId || "") === String(brain.id || ""));
    const lastActivityTs = brainTasks.reduce((best, task) =>
      Math.max(best, Number(task.completedAt || task.updatedAt || task.startedAt || task.createdAt || 0))
    , 0);
    let endpointHealthy = true;
    if (brain.ollamaBaseUrl) {
      const health = await getOllamaEndpointHealth(brain.ollamaBaseUrl);
      endpointHealthy = health?.running === true;
    }
    return {
      id: brain.id,
      label: brain.label,
      kind: brain.kind,
      model: brain.model,
      endpointId: brain.endpointId || "local",
      queueLane,
      remote: brain.remote === true,
      active: Boolean(activeTask),
      activeTaskId: String(activeTask?.id || ""),
      activeTaskCodename: String(activeTask?.codename || ""),
      queuedCount: queued.filter((task) => String(task.requestedBrainId || "") === String(brain.id || "")).length,
      waitingCount: waiting.filter((task) => String(task.requestedBrainId || "") === String(brain.id || "")).length,
      inProgressCount: inProgress.filter((task) => String(task.requestedBrainId || "") === String(brain.id || "")).length,
      completedCount: done.filter((task) => String(task.requestedBrainId || "") === String(brain.id || "")).length,
      failedCount: failed.filter((task) => String(task.requestedBrainId || "") === String(brain.id || "")).length,
      lastActivityAt: lastActivityTs || 0,
      idleForMs: lastActivityTs ? Math.max(0, now - lastActivityTs) : 0,
      endpointHealthy
    };
  }));
}

async function countIdleBackgroundWorkerBrains() {
  const snapshot = await buildBrainActivitySnapshot();
  const idleWorkers = snapshot.filter((entry) =>
    entry.kind === "worker"
    && entry.endpointHealthy
    && !entry.active
    && !entry.queuedCount
    && !entry.waitingCount
    && !!entry.queueLane
  );
  return idleWorkers.length;
}

async function countIdleHelperBrains() {
  const snapshot = await buildBrainActivitySnapshot();
  const idleHelpers = snapshot.filter((entry) =>
    entry.kind === "helper"
    && isGenerativeHelperBrain(entry)
    && isCpuQueueLane(entry)
    && entry.endpointHealthy
    && !entry.active
    && !entry.queuedCount
    && !entry.waitingCount
    && !!entry.queueLane
  );
  return idleHelpers.length;
}

async function listIdleHelperBrains(limit = 4) {
  const brains = await listAvailableBrains();
  const snapshot = await buildBrainActivitySnapshot();
  const snapshotById = new Map(snapshot.map((entry) => [String(entry.id || ""), entry]));
  return brains
    .filter((brain) => brain.kind === "helper" && isGenerativeHelperBrain(brain) && isCpuQueueLane(brain))
    .map((brain) => ({
      brain,
      activity: snapshotById.get(String(brain.id || "")) || {}
    }))
    .filter((entry) =>
      entry.activity.endpointHealthy !== false
      && !entry.activity.active
      && !Number(entry.activity.queuedCount || 0)
      && !Number(entry.activity.waitingCount || 0)
      && String(entry.brain.queueLane || getBrainQueueLane(entry.brain)).trim()
    )
    .sort((left, right) => Number(right.activity.idleForMs || 0) - Number(left.activity.idleForMs || 0))
    .slice(0, Math.max(1, Number(limit || 1)))
    .map((entry) => entry.brain);
}

async function chooseDedicatedHelperScoutBrain() {
  const idleHelpers = await listIdleHelperBrains(6);
  if (!idleHelpers.length) {
    return null;
  }
  const preferredOrder = ["lappy_cpu"];
  for (const brainId of preferredOrder) {
    const matched = idleHelpers.find((brain) => String(brain.id || "").trim() === brainId);
    if (matched) {
      return matched;
    }
    }
  return null;
}

function scoreHelperReservePriority(brain = {}) {
  const id = String(brain.id || "").trim().toLowerCase();
  const specialty = String(brain.specialty || "").trim().toLowerCase();
  const description = String(brain.description || "").trim().toLowerCase();
  let score = 0;
  if (id === "remote_cpu") score += 1000;
  if (specialty === "routing" || specialty === "general") score += 100;
  if (/\b(route|routing|triage|planner|planning|classification)\b/.test(description)) score += 20;
  return score;
}

async function chooseHelperScoutBrains(limit = 4) {
  const idleHelpers = await listIdleHelperBrains(8);
  if (!idleHelpers.length) {
    return [];
  }
  const reserveCount = Math.max(0, HELPER_IDLE_RESERVE_COUNT);
  const reserveIds = new Set(
    idleHelpers
      .slice()
      .sort((left, right) => {
        const scoreDiff = scoreHelperReservePriority(right) - scoreHelperReservePriority(left);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return String(left.id || "").localeCompare(String(right.id || ""));
      })
      .slice(0, reserveCount)
      .map((brain) => String(brain.id || "").trim())
      .filter(Boolean)
  );
  return idleHelpers
    .filter((brain) => !reserveIds.has(String(brain.id || "").trim()))
    .sort((left, right) => {
      const preferredLeft = String(left.id || "").trim() === "lappy_cpu" ? 1 : 0;
      const preferredRight = String(right.id || "").trim() === "lappy_cpu" ? 1 : 0;
      if (preferredRight !== preferredLeft) {
        return preferredRight - preferredLeft;
      }
      return String(left.id || "").localeCompare(String(right.id || ""));
    })
    .slice(0, Math.max(0, Number(limit || 0)));
}

async function chooseIdleWorkerBrainForSpecialty(specialty = "general") {
  const availableBrains = await listAvailableBrains();
  const snapshot = await buildBrainActivitySnapshot();
  const snapshotById = new Map(snapshot.map((entry) => [String(entry.id || ""), entry]));
  const workers = availableBrains.filter((brain) =>
    brain.kind === "worker"
    && brain.toolCapable
    && canBrainHandleSpecialty(brain, specialty)
  );
  const ranked = workers
    .map((brain) => {
      const activity = snapshotById.get(String(brain.id || "")) || {};
      return {
        brain,
        activity,
        score: scoreBrainForSpecialty(brain, specialty),
        idle: !activity.active && !Number(activity.queuedCount || 0) && activity.endpointHealthy !== false,
        idleForMs: Number(activity.idleForMs || 0)
      };
    })
    .filter((entry) => entry.activity.endpointHealthy !== false)
    .sort((left, right) => {
      if (Boolean(right.idle) !== Boolean(left.idle)) {
        return Number(Boolean(right.idle)) - Number(Boolean(left.idle));
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.idleForMs !== left.idleForMs) {
        return right.idleForMs - left.idleForMs;
      }
      return String(left.brain.id || "").localeCompare(String(right.brain.id || ""));
  });
  return ranked[0]?.brain || null;
}

async function chooseIdleWorkerBrainForSpecialtyExcluding(specialty = "general", excludedBrainIds = []) {
  const excluded = new Set((Array.isArray(excludedBrainIds) ? excludedBrainIds : [excludedBrainIds])
    .map((value) => String(value || "").trim())
    .filter(Boolean));
  const availableBrains = await listAvailableBrains();
  const snapshot = await buildBrainActivitySnapshot();
  const snapshotById = new Map(snapshot.map((entry) => [String(entry.id || ""), entry]));
  const workers = availableBrains.filter((brain) =>
    brain.kind === "worker"
    && brain.toolCapable
    && !excluded.has(String(brain.id || "").trim())
    && canBrainHandleSpecialty(brain, specialty)
  );
  const ranked = workers
    .map((brain) => {
      const activity = snapshotById.get(String(brain.id || "")) || {};
      return {
        brain,
        activity,
        score: scoreBrainForSpecialty(brain, specialty),
        idle: !activity.active && !Number(activity.queuedCount || 0) && activity.endpointHealthy !== false,
        idleForMs: Number(activity.idleForMs || 0)
      };
    })
    .filter((entry) => entry.activity.endpointHealthy !== false)
    .sort((left, right) => {
      if (Boolean(right.idle) !== Boolean(left.idle)) {
        return Number(Boolean(right.idle)) - Number(Boolean(left.idle));
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.idleForMs !== left.idleForMs) {
        return right.idleForMs - left.idleForMs;
      }
      return String(left.brain.id || "").localeCompare(String(right.brain.id || ""));
  });
  return ranked[0]?.brain || null;
}

async function chooseIdleWorkerBrainForTransportFailover(task = {}, specialty = "general", excludedBrainIds = []) {
  const excluded = new Set((Array.isArray(excludedBrainIds) ? excludedBrainIds : [excludedBrainIds])
    .map((value) => String(value || "").trim())
    .filter(Boolean));
  const currentBrain = await getBrain(String(task?.requestedBrainId || "worker").trim() || "worker");
  const currentLane = String(task?.queueLane || currentBrain?.queueLane || getBrainQueueLane(currentBrain)).trim();
  const currentEndpoint = normalizeOllamaBaseUrl(String(task?.ollamaBaseUrl || currentBrain?.ollamaBaseUrl || "").trim());
  const availableBrains = await listAvailableBrains();
  const snapshot = await buildBrainActivitySnapshot();
  const snapshotById = new Map(snapshot.map((entry) => [String(entry.id || ""), entry]));
  const workers = availableBrains.filter((brain) =>
    brain.kind === "worker"
    && brain.toolCapable
    && !excluded.has(String(brain.id || "").trim())
    && canBrainHandleSpecialty(brain, specialty)
  );
  const ranked = workers
    .map((brain) => {
      const activity = snapshotById.get(String(brain.id || "")) || {};
      const lane = String(brain.queueLane || getBrainQueueLane(brain)).trim();
      const endpoint = normalizeOllamaBaseUrl(String(brain.ollamaBaseUrl || "").trim());
      return {
        brain,
        activity,
        lane,
        endpoint,
        score: scoreBrainForSpecialty(brain, specialty),
        idle: !activity.active && !Number(activity.queuedCount || 0) && activity.endpointHealthy !== false,
        idleForMs: Number(activity.idleForMs || 0),
        differentTransport: (!currentLane || lane !== currentLane) || (!currentEndpoint || endpoint !== currentEndpoint)
      };
    })
    .filter((entry) => entry.activity.endpointHealthy !== false)
    .filter((entry) => entry.differentTransport)
    .sort((left, right) => {
      if (Boolean(right.idle) !== Boolean(left.idle)) {
        return Number(Boolean(right.idle)) - Number(Boolean(left.idle));
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.idleForMs !== left.idleForMs) {
        return right.idleForMs - left.idleForMs;
      }
      return String(left.brain.id || "").localeCompare(String(right.brain.id || ""));
    });
  return ranked[0]?.brain || null;
}

async function isRemoteParallelDispatchEnabled() {
  const queueConfig = getQueueConfig();
  const routing = getRoutingConfig();
  if (!queueConfig.remoteParallel || !routing.enabled) {
    return false;
  }
  const remoteTriageBrain = await chooseHealthyRemoteTriageBrain();
  return remoteTriageBrain?.remote === true;
}

function toBrainLabel(modelName) {
  const normalized = String(modelName || "");
  return normalized
    .split(/[:/-]/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+b$/i.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

async function listOllamaModels() {
  const result = await runCommand("docker", ["exec", OLLAMA_CONTAINER, "ollama", "list"]);
  if (result.code !== 0) {
    throw new Error(result.stderr || "failed to list ollama models");
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1)
    .map((line) => {
      const [name, digest, size, modified] = line.split(/\s{2,}/).map((part) => part?.trim());
      return {
        name: name || "",
        digest: digest || "",
        size: size || "",
        modified: modified || ""
      };
    })
    .filter((entry) => entry.name);
}

async function inspectOllamaEndpoint(baseUrl = LOCAL_OLLAMA_BASE_URL) {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const cooldown = getOllamaEndpointTransportCooldown(normalizedBaseUrl);
  if (cooldown) {
    return {
      ok: false,
      baseUrl: normalizedBaseUrl,
      status: 0,
      running: false,
      modelCount: 0,
      error: `Cooling down after transport failure: ${cooldown.error}`
    };
  }
  const controller = new AbortController();
  const timeoutMs = 12000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = null;
    let parsed = {};
    let lastError = "";
    for (const endpointPath of ["/api/tags", "/api/tag"]) {
      try {
        response = await fetch(`${normalizedBaseUrl}${endpointPath}`, {
          method: "GET",
          signal: controller.signal
        });
        try {
          parsed = await response.json();
        } catch {
          parsed = {};
        }
        if (response.ok) {
          break;
        }
        lastError = String(parsed?.error || `Ollama API returned ${response.status}`);
      } catch (error) {
        lastError = String(error?.message || "failed to reach Ollama API");
        if (controller.signal.aborted) {
          throw error;
        }
      }
    }
    if (!response) {
      throw new Error(lastError || "failed to reach Ollama API");
    }
    return {
      ok: response.ok,
      baseUrl: normalizedBaseUrl,
      status: response.status,
      running: response.ok,
      modelCount: Array.isArray(parsed?.models) ? parsed.models.length : 0,
      error: response.ok ? "" : String(parsed?.error || `Ollama API returned ${response.status}`)
    };
  } catch (error) {
    return {
      ok: false,
      baseUrl: normalizedBaseUrl,
      status: 0,
      running: false,
      modelCount: 0,
      error: error?.name === "AbortError" ? `Observer timeout after ${Math.round(timeoutMs / 1000)}s` : String(error?.message || "failed to reach Ollama API")
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getOllamaEndpointHealth(baseUrl = LOCAL_OLLAMA_BASE_URL) {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const now = Date.now();
  if (now - Number(ollamaEndpointHealthCache.at || 0) < 5000 && ollamaEndpointHealthCache.entries[normalizedBaseUrl]) {
    return ollamaEndpointHealthCache.entries[normalizedBaseUrl];
  }
  const health = await inspectOllamaEndpoint(normalizedBaseUrl);
  ollamaEndpointHealthCache.entries[normalizedBaseUrl] = health;
  ollamaEndpointHealthCache.at = now;
  return health;
}

async function runOllamaEmbed(model, input, { timeoutMs = 30000, baseUrl = LOCAL_OLLAMA_BASE_URL } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
    const response = await fetch(`${normalizedBaseUrl}/api/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        input
      }),
      signal: controller.signal
    });
    let parsed = {};
    try {
      parsed = await response.json();
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      throw new Error(String(parsed?.error || `Ollama API returned ${response.status}`));
    }
    const embeddings = Array.isArray(parsed?.embeddings)
      ? parsed.embeddings
      : Array.isArray(parsed?.embedding)
        ? [parsed.embedding]
        : [];
    return embeddings.filter((entry) => Array.isArray(entry) && entry.length);
  } finally {
    clearTimeout(timeout);
  }
}

function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index] || 0);
    const b = Number(right[index] || 0);
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

async function listAvailableBrains() {
  if (Date.now() - Number(availableBrainsCache.at || 0) < 5000 && Array.isArray(availableBrainsCache.brains) && availableBrainsCache.brains.length) {
    return availableBrainsCache.brains;
  }

  const enabledBrainIds = getEnabledBrainIds();
  const builtInBrains = AGENT_BRAINS.map((brain) => decorateBrain(brain));
  const customBrains = Array.isArray(observerConfig?.brains?.custom)
    ? observerConfig.brains.custom.map((entry, index) => normalizeCustomBrainConfig(entry, index)).filter(Boolean)
    : [];
  const enabledAgentBrains = [...builtInBrains, ...customBrains].filter((brain) => enabledBrainIds.has(brain.id));

  availableBrainsCache = {
    at: Date.now(),
    brains: enabledAgentBrains
  };
  return availableBrainsCache.brains;
}

async function getBrain(brainId) {
  const brains = await listAvailableBrains();
  return brains.find((brain) => brain.id === brainId) || brains.find((brain) => brain.id === "worker") || brains[0];
}

async function findBrainByIdExact(brainId = "") {
  const target = String(brainId || "").trim();
  if (!target) {
    return null;
  }
  const brains = await listAvailableBrains();
  return brains.find((brain) => String(brain.id || "").trim() === target) || null;
}

function scorePlannerRepairBrain(brain = {}) {
  const specialty = String(brain?.specialty || "").trim().toLowerCase();
  const description = String(brain?.description || "").trim().toLowerCase();
  const id = String(brain?.id || "").trim().toLowerCase();
  const hasRoutingSignal = (
    specialty === "routing"
    || specialty === "planner"
    || /\b(route|routing|router|planner|planning)\b/.test(description)
  );
  const hasToolingSignal = (
    /\b(tooling|tool plan|tool repair|tools)\b/.test(description)
  );
  if (!(hasRoutingSignal && hasToolingSignal)) {
    return 0;
  }
  let score = 100;
  if (specialty === "routing" || specialty === "planner") score += 40;
  if (/\btoolrouter\b/.test(id)) score += 20;
  return score;
}

async function choosePlannerRepairBrain(candidateIds = [], { preferRemote = false, fallbackBrainId = "bitnet" } = {}) {
  const availableBrains = await listAvailableBrains();
  const laneLoad = await getQueueLaneLoadSnapshot();
  const explicitBrains = [];
  for (const candidate of Array.isArray(candidateIds) ? candidateIds : []) {
    const brain = availableBrains.find((entry) => String(entry?.id || "").trim() === String(candidate || "").trim());
    if (brain?.id) {
      explicitBrains.push(brain);
    }
  }
  const remotePlanner = preferRemote
    ? await chooseHealthyRemoteTriageBrain({ availableBrains, laneLoad })
    : null;
  const fallbackBrain = fallbackBrainId
    ? availableBrains.find((entry) => String(entry?.id || "").trim() === String(fallbackBrainId || "").trim()) || null
    : null;
  const candidates = [
    ...explicitBrains,
    remotePlanner,
    fallbackBrain
  ].filter(Boolean);
  const unique = candidates.filter((brain, index, list) =>
    list.findIndex((entry) => String(entry?.id || "").trim() === String(brain?.id || "").trim()) === index
  );
  return unique.sort((left, right) => {
    if (preferRemote && Boolean(right.remote) !== Boolean(left.remote)) {
      return Number(Boolean(right.remote)) - Number(Boolean(left.remote));
    }
    const scoreDiff = scorePlannerRepairBrain(right) - scorePlannerRepairBrain(left);
    if (scoreDiff) {
      return scoreDiff;
    }
    const leftLoad = Number(laneLoad.get(getBrainQueueLane(left)) || 0);
    const rightLoad = Number(laneLoad.get(getBrainQueueLane(right)) || 0);
    if (leftLoad !== rightLoad) {
      return leftLoad - rightLoad;
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  })[0] || null;
}

function scoreIntakePlanningBrain(brain = {}) {
  if (!brain || String(brain.kind || "").trim() === "worker" && brain.toolCapable !== true) {
    return 0;
  }
  const kind = String(brain?.kind || "").trim().toLowerCase();
  const specialty = String(brain?.specialty || "").trim().toLowerCase();
  const description = String(brain?.description || "").trim().toLowerCase();
  const id = String(brain?.id || "").trim().toLowerCase();
  const text = [id, String(brain?.label || ""), String(brain?.model || ""), description, specialty].join(" ").toLowerCase();
  let score = 0;
  if (kind === "intake") score += 140;
  if (kind === "helper") score += 120;
  if (kind === "worker" && brain.toolCapable === true) score += 40;
  if (specialty === "routing" || specialty === "planner") score += 60;
  if (specialty === "general") score += 30;
  if (/\b(route|routing|router|planner|planning|triage|intake)\b/.test(text)) score += 25;
  if (id === "bitnet") score += 20;
  if (id === "helper") score += 10;
  return score;
}

async function chooseIntakePlanningBrain({
  candidateIds = [],
  preferRemote = false,
  fallbackBrainIds = ["bitnet", "helper", "worker"]
} = {}) {
  const availableBrains = await listAvailableBrains();
  const laneLoad = await getQueueLaneLoadSnapshot();
  const explicitBrains = [];
  for (const candidate of Array.isArray(candidateIds) ? candidateIds : []) {
    const brain = availableBrains.find((entry) => String(entry?.id || "").trim() === String(candidate || "").trim());
    if (brain?.id) {
      explicitBrains.push(brain);
    }
  }
  const remotePlanner = preferRemote
    ? await chooseHealthyRemoteTriageBrain({ availableBrains, laneLoad })
    : null;
  const fallbackBrains = (Array.isArray(fallbackBrainIds) ? fallbackBrainIds : [fallbackBrainIds])
    .map((candidate) => availableBrains.find((entry) => String(entry?.id || "").trim() === String(candidate || "").trim()) || null)
    .filter(Boolean);
  const localSurvivalBrain = availableBrains
    .filter((brain) => brain.remote !== true)
    .sort((left, right) => {
      const scoreDiff = scoreIntakePlanningBrain(right) - scoreIntakePlanningBrain(left);
      if (scoreDiff) {
        return scoreDiff;
      }
      const leftLoad = Number(laneLoad.get(getBrainQueueLane(left)) || 0);
      const rightLoad = Number(laneLoad.get(getBrainQueueLane(right)) || 0);
      if (leftLoad !== rightLoad) {
        return leftLoad - rightLoad;
      }
      return String(left.id || "").localeCompare(String(right.id || ""));
    })[0] || null;
  const candidates = [
    ...explicitBrains,
    remotePlanner,
    ...fallbackBrains,
    localSurvivalBrain
  ].filter(Boolean);
  const unique = candidates.filter((brain, index, list) =>
    list.findIndex((entry) => String(entry?.id || "").trim() === String(brain?.id || "").trim()) === index
  );
  return unique.sort((left, right) => {
    if (preferRemote && Boolean(right.remote) !== Boolean(left.remote)) {
      return Number(Boolean(right.remote)) - Number(Boolean(left.remote));
    }
    const scoreDiff = scoreIntakePlanningBrain(right) - scoreIntakePlanningBrain(left);
    if (scoreDiff) {
      return scoreDiff;
    }
    const leftLoad = Number(laneLoad.get(getBrainQueueLane(left)) || 0);
    const rightLoad = Number(laneLoad.get(getBrainQueueLane(right)) || 0);
    if (leftLoad !== rightLoad) {
      return leftLoad - rightLoad;
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  })[0] || null;
}

function buildHelperCacheKey({ message = "", sessionId = "Main" } = {}) {
  const hash = crypto
    .createHash("sha1")
    .update(`${String(sessionId || "Main").trim()}\n${String(message || "").trim()}`)
    .digest("hex");
  return `helper:${hash}`;
}

function pruneHelperShadowCache() {
  const now = Date.now();
  for (const [key, entry] of helperShadowCache.entries()) {
    const expiresAt = Number(entry?.expiresAt || 0);
    if (!expiresAt || expiresAt <= now || (!HELPER_SHADOW_CACHE_ENABLED && entry?.state === "done")) {
      helperShadowCache.delete(key);
    }
  }
}

function shouldUseHelperAnalysis(message = "") {
  const enabledBrainIds = getEnabledBrainIds();
  if (!enabledBrainIds.has("helper")) {
    return false;
  }
  const text = String(message || "").trim();
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;
  if (text.length >= 180 || words >= 32) {
    return true;
  }
  if (isCapabilityCheckRequest(text)) {
    return true;
  }
  if ((lower.match(/\band\b/g) || []).length >= 2) {
    return true;
  }
  if (/[.;:\n]/.test(text) && words >= 18) {
    return true;
  }
  return false;
}

async function runHelperAnalysis({ message = "", sessionId = "Main" } = {}) {
  const helperBrain = await getBrain("helper");
  if (!helperBrain || helperBrain.id !== "helper") {
    return null;
  }
  const prompt = [
    "You are a silent helper model for Nova.",
    `Nova's public name is ${getAgentPersonaName()}.`,
    "Analyze the user request and return JSON only.",
    "Do not mention internal routing or models.",
    "Return this schema exactly:",
    "{\"summary\":\"...\",\"intent\":\"...\",\"suggested_action\":\"reply_only|intake_tool|enqueue_worker\",\"draft_reply\":\"...\",\"confidence\":0.0,\"reasons\":[\"...\"]}",
    "Keep summary and draft_reply concise.",
    "Choose enqueue_worker only when deeper execution or follow-through is genuinely needed.",
    `Session: ${String(sessionId || "Main").trim() || "Main"}`,
    `User request: ${String(message || "").trim()}`
  ].join("\n");
  const result = await runOllamaJsonGenerate(helperBrain.model, prompt, {
    timeoutMs: HELPER_ANALYSIS_TIMEOUT_MS,
    keepAlive: MODEL_KEEPALIVE,
    baseUrl: helperBrain.ollamaBaseUrl
  });
  if (!result.ok) {
    return null;
  }
  let parsed;
  try {
    parsed = extractJsonObject(result.text);
  } catch {
    return null;
  }
  return {
    model: helperBrain.model,
    at: Date.now(),
    summary: compactTaskText(String(parsed.summary || "").trim(), 220),
    intent: compactTaskText(String(parsed.intent || "").trim(), 80),
    suggestedAction: ["reply_only", "intake_tool", "enqueue_worker"].includes(String(parsed.suggested_action || ""))
      ? String(parsed.suggested_action)
      : "reply_only",
    draftReply: compactTaskText(normalizeAgentSelfReference(String(parsed.draft_reply || "").trim()), 280),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0) || 0)),
    reasons: Array.isArray(parsed.reasons)
      ? parsed.reasons.map((entry) => compactTaskText(String(entry || "").trim(), 120)).filter(Boolean).slice(0, 4)
      : []
  };
}

function startHelperAnalysisForRequest({ message = "", sessionId = "Main" } = {}) {
  if (!shouldUseHelperAnalysis(message)) {
    return null;
  }
  pruneHelperShadowCache();
  const key = buildHelperCacheKey({ message, sessionId });
  const cached = helperShadowCache.get(key);
  if (HELPER_SHADOW_CACHE_ENABLED && cached?.state === "done" && cached.value) {
    return Promise.resolve(cached.value);
  }
  if (cached?.state === "pending" && cached.promise) {
    return cached.promise;
  }
  const promise = runHelperAnalysis({ message, sessionId })
    .then(async (value) => {
      if (value) {
        await attachHelperAnalysisToRelatedTasks({ message, sessionId, helperAnalysis: value });
        if (HELPER_SHADOW_CACHE_ENABLED) {
          helperShadowCache.set(key, {
            state: "done",
            value,
            createdAt: Date.now(),
            expiresAt: Date.now() + HELPER_ANALYSIS_CACHE_TTL_MS
          });
        } else {
          helperShadowCache.delete(key);
        }
      } else {
        helperShadowCache.delete(key);
      }
      return value;
    })
    .catch(() => {
      helperShadowCache.delete(key);
      return null;
    });
  helperShadowCache.set(key, {
    state: "pending",
    promise,
    createdAt: Date.now(),
    expiresAt: Date.now() + HELPER_ANALYSIS_CACHE_TTL_MS
  });
  return promise;
}

async function getHelperAnalysisForRequest({ message = "", sessionId = "Main", waitMs = 0 } = {}) {
  if (!shouldUseHelperAnalysis(message)) {
    return null;
  }
  pruneHelperShadowCache();
  const key = buildHelperCacheKey({ message, sessionId });
  const cached = helperShadowCache.get(key);
  if (HELPER_SHADOW_CACHE_ENABLED && cached?.state === "done" && cached.value) {
    return cached.value;
  }
  if (cached?.state === "pending" && cached.promise) {
    if (waitMs > 0) {
      return Promise.race([
        cached.promise,
        new Promise((resolve) => setTimeout(() => resolve(null), waitMs))
      ]);
    }
    return null;
  }
  const promise = startHelperAnalysisForRequest({ message, sessionId });
  if (!promise || waitMs <= 0) {
    return null;
  }
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), waitMs))
  ]);
}

function sanitizeAttachmentName(name, index) {
  const baseName = path.basename(String(name || `attachment-${index + 1}`));
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safeName || `attachment-${index + 1}`;
}

function buildAttachmentAlias(name, index) {
  const extension = path.extname(String(name || ""));
  const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, "");
  return `attachment-${index + 1}${safeExtension || ""}`;
}

async function writeVolumeFile(filePath, contentBase64) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(String(contentBase64 || ""), "base64"));
}

async function prepareAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return null;
  }

  const runFolder = `run-${Date.now()}`;
  const volumeRoot = `${OBSERVER_ATTACHMENTS_ROOT}/${runFolder}`;
  const workspaceRoot = `${OBSERVER_CONTAINER_ATTACHMENTS_ROOT}/${runFolder}`;
  const files = [];

  try {
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index] || {};
      const originalName = sanitizeAttachmentName(attachment.name, index);
      const fileName = buildAttachmentAlias(originalName, index);
      const contentBase64 = String(attachment.contentBase64 || "");
      const bytes = Buffer.from(contentBase64, "base64");
      const volumePath = `${volumeRoot}/${fileName}`;
      await writeVolumeFile(volumePath, contentBase64);
      files.push({
        name: fileName,
        originalName: String(attachment.name || originalName),
        type: String(attachment.type || "application/octet-stream"),
        size: bytes.length,
        containerPath: `${workspaceRoot}/${fileName}`
      });
    }

    return { volumeRoot, workspaceRoot, files };
  } catch (error) {
    throw error;
  }
}

async function migrateLegacyMailPassword(agentId, configuredPassword = "", configuredHandle = "") {
  const normalizedHandle = observerSecrets.normalizeSecretHandle(
    configuredHandle || (agentId ? buildMailAgentPasswordHandle(agentId) : "")
  );
  const directPassword = String(configuredPassword || "").trim();
  if (directPassword && normalizedHandle) {
    await observerSecrets.setSecret(normalizedHandle, directPassword);
  }
  return normalizedHandle;
}

async function resolveMailPassword(agentId, configuredHandle = "", configuredPassword = "") {
  const normalizedHandle = observerSecrets.normalizeSecretHandle(
    configuredHandle || (agentId ? buildMailAgentPasswordHandle(agentId) : "")
  );
  if (normalizedHandle) {
    const storedPassword = await observerSecrets.getSecret(normalizedHandle);
    if (String(storedPassword || "").trim()) {
      return String(storedPassword || "").trim();
    }
  }
  const directPassword = String(configuredPassword || "").trim();
  if (directPassword) {
    return directPassword;
  }
  const normalizedId = String(agentId || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase();
  if (!normalizedId) {
    return "";
  }
  return String(process.env[`OBSERVER_MAIL_${normalizedId}_PASSWORD`] || "").trim();
}

async function hasMailPassword(agent = {}) {
  const password = await resolveMailPassword(agent?.id, agent?.passwordHandle, agent?.password);
  return Boolean(String(password || "").trim());
}

async function resolveMailAuth(agent = {}) {
  const password = await resolveMailPassword(agent?.id, agent?.passwordHandle, agent?.password);
  return {
    user: String(agent?.user || agent?.email || "").trim(),
    pass: String(password || "").trim()
  };
}

async function loadObserverConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const retrievalApiKeyHandle = await migrateLegacyQdrantApiKey(parsed?.retrieval);
    const mailAgents = {};
    let migratedMailPasswords = false;
    for (const [id, agent] of Object.entries(parsed?.mail?.agents || {})) {
      const passwordHandle = await migrateLegacyMailPassword(id, agent?.password, agent?.passwordHandle);
      if (String(agent?.password || "").trim()) {
        migratedMailPasswords = true;
      }
      mailAgents[String(id)] = {
        id: String(id),
        label: String(agent?.label || id),
        aliases: Array.isArray(agent?.aliases) ? agent.aliases.map((value) => String(value)).filter(Boolean) : [],
        email: String(agent?.email || ""),
        user: String(agent?.user || agent?.email || ""),
        password: "",
        passwordHandle
      };
    }
    const configuredEndpoints = parsed?.brains?.endpoints && typeof parsed.brains.endpoints === "object"
      ? Object.fromEntries(
          Object.entries(parsed.brains.endpoints).map(([id, entry]) => [String(id), {
            label: String(entry?.label || id),
            baseUrl: normalizeOllamaBaseUrl(entry?.baseUrl || "")
            }])
          )
        : {
            local: {
              label: "Local Ollama",
              baseUrl: LOCAL_OLLAMA_BASE_URL
            }
          };
      observerConfig = {
        app: {
          botName: String(parsed?.app?.botName || "Agent"),
          avatarModelPath: String(parsed?.app?.avatarModelPath || "/assets/characters/Nova.glb"),
          backgroundImagePath: String(parsed?.app?.backgroundImagePath || ""),
          stylizationFilterPreset: normalizeStylizationFilterPreset(
            parsed?.app?.stylizationFilterPreset ?? parsed?.app?.stylizationPreset,
            "none"
          ),
          stylizationEffectPreset: normalizeStylizationEffectPreset(
            parsed?.app?.stylizationEffectPreset ?? parsed?.app?.stylizationPreset,
            "none"
          ),
          reactionPathsByModel: normalizeReactionPathsByModel(parsed?.app?.reactionPathsByModel),
          roomTextures: {
            ...defaultAppRoomTextures(),
            ...(parsed?.app?.roomTextures && typeof parsed.app.roomTextures === "object" ? Object.fromEntries(
              Object.entries(parsed.app.roomTextures).map(([key, value]) => [String(key), String(value || "")])
            ) : {})
          },
          propSlots: {
            ...defaultAppPropSlots(),
            ...(parsed?.app?.propSlots && typeof parsed.app.propSlots === "object" ? Object.fromEntries(
              Object.entries(parsed.app.propSlots).map(([key, value]) => {
                if (value && typeof value === "object") {
                  return [String(key), {
                    model: String(value.model || ""),
                    scale: normalizePropScale(value.scale, 1)
                  }];
                }
                return [String(key), {
                  model: String(value || ""),
                  scale: 1
                }];
              })
            ) : {})
          },
          voicePreferences: Array.isArray(parsed?.app?.voicePreferences)
            ? parsed.app.voicePreferences.map((value) => String(value)).filter(Boolean)
            : [],
          trust: normalizeAppTrustConfig(parsed?.app?.trust)
        },
        defaults: {
          internetEnabled: parsed?.defaults?.internetEnabled !== false,
          mountIds: [],
          intakeBrainId: String(parsed?.defaults?.intakeBrainId || "bitnet")
        },
        brains: {
          enabledIds: Array.isArray(parsed?.brains?.enabledIds)
            ? parsed.brains.enabledIds.map((value) => String(value)).filter(Boolean)
            : ["bitnet", "worker"],
          endpoints: configuredEndpoints,
          assignments: parsed?.brains?.assignments && typeof parsed.brains.assignments === "object"
            ? Object.fromEntries(Object.entries(parsed.brains.assignments).map(([id, value]) => [String(id), String(value)]))
            : {
                bitnet: "local",
                worker: "local",
                helper: "local"
              },
          custom: Array.isArray(parsed?.brains?.custom) ? parsed.brains.custom : []
        },
      queue: {
        remoteParallel: parsed?.queue?.remoteParallel !== false,
        escalationEnabled: parsed?.queue?.escalationEnabled !== false,
        paused: parsed?.queue?.paused === true
      },
      projects: normalizeProjectConfigInput(parsed?.projects),
      routing: {
        enabled: parsed?.routing?.enabled === true,
        remoteTriageBrainId: String(parsed?.routing?.remoteTriageBrainId || ""),
        specialistMap: {
          code: Array.isArray(parsed?.routing?.specialistMap?.code) ? parsed.routing.specialistMap.code.map((value) => String(value)).filter(Boolean) : [],
          document: Array.isArray(parsed?.routing?.specialistMap?.document) ? parsed.routing.specialistMap.document.map((value) => String(value)).filter(Boolean) : [],
          general: Array.isArray(parsed?.routing?.specialistMap?.general) ? parsed.routing.specialistMap.general.map((value) => String(value)).filter(Boolean) : [],
          background: Array.isArray(parsed?.routing?.specialistMap?.background) ? parsed.routing.specialistMap.background.map((value) => String(value)).filter(Boolean) : [],
          creative: Array.isArray(parsed?.routing?.specialistMap?.creative) ? parsed.routing.specialistMap.creative.map((value) => String(value)).filter(Boolean) : [],
          vision: Array.isArray(parsed?.routing?.specialistMap?.vision) ? parsed.routing.specialistMap.vision.map((value) => String(value)).filter(Boolean) : [],
          retrieval: Array.isArray(parsed?.routing?.specialistMap?.retrieval) ? parsed.routing.specialistMap.retrieval.map((value) => String(value)).filter(Boolean) : []
        },
        fallbackAttempts: Math.max(0, Math.min(Number(parsed?.routing?.fallbackAttempts || 2), 4))
      },
      networks: {
        internal: parsed?.networks?.internal || "local",
        internet: parsed?.networks?.internet || "internet"
      },
      retrieval: {
        qdrantUrl: String(parsed?.retrieval?.qdrantUrl || DEFAULT_QDRANT_URL).trim() || DEFAULT_QDRANT_URL,
        collectionName: String(parsed?.retrieval?.collectionName || DEFAULT_QDRANT_COLLECTION).trim() || DEFAULT_QDRANT_COLLECTION,
        apiKeyHandle: retrievalApiKeyHandle
      },
      mail: {
        enabled: parsed?.mail?.enabled === true,
        activeAgentId: String(parsed?.mail?.activeAgentId || "nova"),
        pollIntervalMs: Math.max(5000, Number(parsed?.mail?.pollIntervalMs || 30000)),
        imap: {
          host: String(parsed?.mail?.imap?.host || ""),
          port: Number(parsed?.mail?.imap?.port || 993),
          secure: parsed?.mail?.imap?.secure !== false
        },
        smtp: {
          host: String(parsed?.mail?.smtp?.host || ""),
          port: Number(parsed?.mail?.smtp?.port || 587),
          secure: parsed?.mail?.smtp?.secure === true,
          requireTLS: parsed?.mail?.smtp?.requireTLS !== false
        },
        agents: mailAgents
      },
      mounts: []
    };
    if (migratedMailPasswords || String(parsed?.retrieval?.apiKey || "").trim()) {
      await saveObserverConfig();
    }
  } catch (error) {
    console.warn(`Failed to load observer config at ${CONFIG_PATH}: ${error.message}`);
  }
}

async function loadObserverLanguage() {
  try {
    const raw = await fs.readFile(LANGUAGE_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    observerLanguage = {
      ...observerLanguage,
      ...parsed,
      acknowledgements: {
        ...observerLanguage.acknowledgements,
        ...(parsed?.acknowledgements || {})
      },
      voice: {
        ...observerLanguage.voice,
        ...(parsed?.voice || {})
      },
      taskNarration: {
        ...observerLanguage.taskNarration,
        ...(parsed?.taskNarration || {})
      }
    };
  } catch (error) {
    console.warn(`Failed to load observer language at ${LANGUAGE_CONFIG_PATH}: ${error.message}`);
  }
}

async function loadObserverLexicon() {
  try {
    const raw = await fs.readFile(LEXICON_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    observerLexicon = {
      ...observerLexicon,
      ...(parsed && typeof parsed === "object" ? parsed : {})
    };
  } catch (error) {
    console.warn(`Failed to load observer lexicon at ${LEXICON_CONFIG_PATH}: ${error.message}`);
  }
}

async function loadOpportunityScanState() {
  try {
    const raw = await fs.readFile(OPPORTUNITY_SCAN_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    opportunityScanState = {
      lastScanAt: Number(parsed?.lastScanAt || 0),
      lastCreatedAt: Number(parsed?.lastCreatedAt || 0),
      lastCleanupAt: Number(parsed?.lastCleanupAt || 0),
      nextMode: String(parsed?.nextMode || "scan").trim() === "cleanup" ? "cleanup" : "scan",
      recentKeys: parsed?.recentKeys && typeof parsed.recentKeys === "object" ? parsed.recentKeys : {},
      markdownOffsets: parsed?.markdownOffsets && typeof parsed.markdownOffsets === "object" ? parsed.markdownOffsets : {},
      projectRotation: {
        recentImports: parsed?.projectRotation?.recentImports && typeof parsed.projectRotation.recentImports === "object"
          ? parsed.projectRotation.recentImports
          : {},
        backups: parsed?.projectRotation?.backups && typeof parsed.projectRotation.backups === "object"
          ? parsed.projectRotation.backups
          : {}
      }
    };
  } catch {
    opportunityScanState = {
      lastScanAt: 0,
      lastCreatedAt: 0,
      lastCleanupAt: 0,
      nextMode: "scan",
      recentKeys: {},
      markdownOffsets: {},
      projectRotation: {
        recentImports: {},
        backups: {}
      }
    };
  }
}

async function saveOpportunityScanState() {
  const cutoff = Date.now() - getProjectConfig().opportunityScanRetentionMs;
  const recentKeys = Object.fromEntries(
    Object.entries(opportunityScanState.recentKeys || {})
      .filter(([, at]) => Number(at || 0) >= cutoff)
  );
  const markdownOffsets = Object.fromEntries(
    Object.entries(opportunityScanState.markdownOffsets || {})
      .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0)
      .map(([key, value]) => [key, Number(value)])
  );
  const recentImports = Object.fromEntries(
    Object.entries(opportunityScanState.projectRotation?.recentImports || {})
      .filter(([, at]) => Number(at || 0) >= cutoff)
      .map(([key, value]) => [String(key), Number(value)])
  );
  const backups = Object.fromEntries(
    Object.entries(opportunityScanState.projectRotation?.backups || {})
      .filter(([, value]) => value && typeof value === "object")
      .map(([key, value]) => {
        const record = value && typeof value === "object" ? value : {};
        return [String(key), {
          lastBackupAt: Number(record.lastBackupAt || 0),
          projectModifiedAt: Number(record.projectModifiedAt || 0),
          lastTargetPath: String(record.lastTargetPath || "").trim(),
          lastReason: String(record.lastReason || "").trim()
        }];
      })
      .filter(([, value]) => Number(value.lastBackupAt || 0) >= cutoff)
  );
  opportunityScanState = {
    lastScanAt: Number(opportunityScanState.lastScanAt || 0),
    lastCreatedAt: Number(opportunityScanState.lastCreatedAt || 0),
    lastCleanupAt: Number(opportunityScanState.lastCleanupAt || 0),
    nextMode: String(opportunityScanState.nextMode || "scan").trim() === "cleanup" ? "cleanup" : "scan",
    recentKeys,
    markdownOffsets,
    projectRotation: {
      recentImports,
      backups
    }
  };
  await writeVolumeText(OPPORTUNITY_SCAN_STATE_PATH, `${JSON.stringify(opportunityScanState, null, 2)}\n`);
}

async function loadMailWatchRulesState() {
  try {
    const raw = await fs.readFile(MAIL_WATCH_RULES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    mailWatchRulesState = {
      sendSummariesEnabled: parsed?.sendSummariesEnabled !== false,
      rules: Array.isArray(parsed?.rules)
        ? parsed.rules.map((rule) => ({
            id: String(rule?.id || "").trim(),
            createdAt: Number(rule?.createdAt || 0),
            updatedAt: Number(rule?.updatedAt || 0),
            enabled: rule?.enabled !== false,
            every: String(rule?.every || "10m").trim() || "10m",
            everyMs: Number(rule?.everyMs || parseEveryToMs(rule?.every || "10m") || 10 * 60 * 1000),
            instruction: String(rule?.instruction || "").trim(),
            notifyEmail: String(rule?.notifyEmail || "").trim(),
            autoForwardGood: rule?.autoForwardGood !== false,
            trashDefiniteBad: rule?.trashDefiniteBad !== false,
            promptUnsure: rule?.promptUnsure !== false,
            sendSummaries: rule?.sendSummaries !== false,
            promptEvery: String(rule?.promptEvery || "4h").trim() || "4h",
            promptEveryMs: Number(rule?.promptEveryMs || parseEveryToMs(rule?.promptEvery || "4h") || 4 * 60 * 60 * 1000),
            lastCheckedAt: Number(rule?.lastCheckedAt || 0),
            lastProcessedReceivedAt: Number(rule?.lastProcessedReceivedAt || 0),
            lastPromptedAt: Number(rule?.lastPromptedAt || 0),
            forwardedMessageIds: Array.isArray(rule?.forwardedMessageIds)
              ? rule.forwardedMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
              : [],
            pendingUnsureMessageIds: Array.isArray(rule?.pendingUnsureMessageIds)
              ? rule.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
              : []
          })).filter((rule) => rule.id)
        : []
    };
  } catch {
    mailWatchRulesState = createInitialMailWatchRulesState();
  }
  await syncMailRulesDocumentFromState();
}

async function saveMailWatchRulesState() {
  mailWatchRulesState = {
    sendSummariesEnabled: mailWatchRulesState?.sendSummariesEnabled !== false,
    rules: (Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [])
      .map((rule) => ({
        id: String(rule?.id || "").trim(),
        createdAt: Number(rule?.createdAt || 0),
        updatedAt: Number(rule?.updatedAt || 0),
        enabled: rule?.enabled !== false,
        every: String(rule?.every || "10m").trim() || "10m",
        everyMs: Number(rule?.everyMs || parseEveryToMs(rule?.every || "10m") || 10 * 60 * 1000),
        instruction: String(rule?.instruction || "").trim(),
        notifyEmail: String(rule?.notifyEmail || "").trim(),
        autoForwardGood: rule?.autoForwardGood !== false,
        trashDefiniteBad: rule?.trashDefiniteBad !== false,
        promptUnsure: rule?.promptUnsure !== false,
        sendSummaries: rule?.sendSummaries !== false,
        promptEvery: String(rule?.promptEvery || "4h").trim() || "4h",
        promptEveryMs: Number(rule?.promptEveryMs || parseEveryToMs(rule?.promptEvery || "4h") || 4 * 60 * 60 * 1000),
        lastCheckedAt: Number(rule?.lastCheckedAt || 0),
        lastProcessedReceivedAt: Number(rule?.lastProcessedReceivedAt || 0),
        lastPromptedAt: Number(rule?.lastPromptedAt || 0),
        forwardedMessageIds: Array.isArray(rule?.forwardedMessageIds)
          ? rule.forwardedMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
          : [],
        pendingUnsureMessageIds: Array.isArray(rule?.pendingUnsureMessageIds)
          ? rule.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
          : []
      }))
      .filter((rule) => rule.id && rule.instruction)
  };
  await writeVolumeText(MAIL_WATCH_RULES_PATH, `${JSON.stringify(mailWatchRulesState, null, 2)}\n`);
  await syncMailRulesDocumentFromState();
}

function renderMailRulesDocument() {
  const rules = (Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [])
    .slice()
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
  const lines = [
    "# MAIL-RULES.md",
    "",
    "Standing email-management rules tracked by the observer mail-watch engine.",
    "This document is synced from the active mail-watch rule state.",
    "",
    `- Send unsure mail summaries: ${mailWatchRulesState?.sendSummariesEnabled !== false ? "yes" : "no"}`,
    "",
    "## Active Rules",
    ""
  ];
  if (!rules.length) {
    lines.push("- No active mail-watch rules yet.");
  } else {
    for (const rule of rules) {
      lines.push(`### ${rule.id}`);
      lines.push(`- Enabled: ${rule.enabled === false ? "no" : "yes"}`);
      lines.push(`- Check cadence: ${String(rule.every || "10m").trim() || "10m"}`);
      lines.push(`- Notify email: ${String(rule.notifyEmail || "").trim() || "(implicit user email)"}`);
      lines.push(`- Auto forward good mail: ${rule.autoForwardGood !== false ? "yes" : "no"}`);
      lines.push(`- Trash definite bad mail: ${rule.trashDefiniteBad !== false ? "yes" : "no"}`);
      lines.push(`- Prompt on unsure mail: ${rule.promptUnsure !== false ? "yes" : "no"}`);
      lines.push(`- Send unsure mail summaries: ${rule.sendSummaries !== false ? "yes" : "no"}`);
      lines.push(`- Unsure prompt cadence: ${String(rule.promptEvery || "4h").trim() || "4h"}`);
      lines.push(`- Instruction: ${String(rule.instruction || "").trim() || "(none)"}`);
      lines.push("");
    }
  }
  lines.push("## Notes");
  lines.push("");
  lines.push("- Tell Nova a standing mailbox instruction in chat to create or update a live rule.");
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

async function syncMailRulesDocumentFromState() {
  await writeVolumeText(PROMPT_MAIL_RULES_PATH, renderMailRulesDocument());
}

async function loadDocumentRulesState() {
  try {
    const raw = await fs.readFile(DOCUMENT_RULES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    documentRulesState = {
      watchTerms: Array.isArray(parsed?.watchTerms)
        ? parsed.watchTerms.map((value) => String(value || "").trim()).filter(Boolean)
        : documentRulesState.watchTerms,
      importantPeople: Array.isArray(parsed?.importantPeople)
        ? parsed.importantPeople.map((value) => String(value || "").trim()).filter(Boolean)
        : documentRulesState.importantPeople,
      preferredPathTerms: Array.isArray(parsed?.preferredPathTerms)
        ? parsed.preferredPathTerms.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
        : documentRulesState.preferredPathTerms,
      ignoredPathTerms: Array.isArray(parsed?.ignoredPathTerms)
        ? parsed.ignoredPathTerms.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
        : documentRulesState.ignoredPathTerms,
      ignoredFileNamePatterns: Array.isArray(parsed?.ignoredFileNamePatterns)
        ? parsed.ignoredFileNamePatterns.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
        : documentRulesState.ignoredFileNamePatterns
    };
  } catch {
    // keep defaults
  }
}

async function saveDocumentRulesState() {
  const seededPeople = getMailAgents()
    .flatMap((agent) => [agent.label, agent.email, ...(Array.isArray(agent.aliases) ? agent.aliases : [])])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  documentRulesState = {
    watchTerms: Array.isArray(documentRulesState.watchTerms)
      ? [...new Set(documentRulesState.watchTerms.map((value) => String(value || "").trim()).filter(Boolean))]
      : [],
    importantPeople: Array.isArray(documentRulesState.importantPeople)
      ? [...new Set([...documentRulesState.importantPeople.map((value) => String(value || "").trim()).filter(Boolean), ...seededPeople])]
      : [...new Set(seededPeople)],
    preferredPathTerms: Array.isArray(documentRulesState.preferredPathTerms)
      ? [...new Set(documentRulesState.preferredPathTerms.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))]
      : [],
    ignoredPathTerms: Array.isArray(documentRulesState.ignoredPathTerms)
      ? [...new Set(documentRulesState.ignoredPathTerms.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))]
      : [],
    ignoredFileNamePatterns: Array.isArray(documentRulesState.ignoredFileNamePatterns)
      ? [...new Set(documentRulesState.ignoredFileNamePatterns.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))]
      : []
  };
  await writeVolumeText(DOCUMENT_RULES_PATH, `${JSON.stringify(documentRulesState, null, 2)}\n`);
}

function getMailAgents() {
  return Object.values(observerConfig?.mail?.agents || {}).map((agent) => ({
    ...agent,
    id: String(agent.id || ""),
    label: String(agent.label || agent.id || "Agent"),
    aliases: Array.isArray(agent.aliases) ? agent.aliases.map((value) => String(value)).filter(Boolean) : [],
    email: String(agent.email || ""),
    user: String(agent.user || agent.email || ""),
    passwordHandle: observerSecrets.normalizeSecretHandle(agent.passwordHandle || "")
  }));
}

function getMailAgent(agentId = "") {
  const id = String(agentId || observerConfig?.mail?.activeAgentId || "").trim();
  if (!id) {
    return null;
  }
  return getMailAgents().find((agent) => agent.id === id) || null;
}

function getActiveMailAgent() {
  return getMailAgent(observerConfig?.mail?.activeAgentId);
}

async function hasMailCredentials(agent) {
  return Boolean(
    observerConfig?.mail?.enabled
    && observerConfig?.mail?.imap?.host
    && observerConfig?.mail?.smtp?.host
    && agent?.email
    && agent?.user
    && await hasMailPassword(agent)
  );
}

async function buildMailStatus(agent = getActiveMailAgent()) {
  const recentMessages = (Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [])
    .filter((entry) => entry.agentId === agent?.id)
    .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0));
  const categoryCounts = {};
  let likelySpamCount = 0;
  let trustedSourceCount = 0;
  let knownSourceCount = 0;
  let commandReadyCount = 0;
  let commandReviewCount = 0;
  for (const message of recentMessages) {
    const category = String(message?.triage?.category || "other");
    categoryCounts[category] = Number(categoryCounts[category] || 0) + 1;
    if (message?.triage?.likelySpam) {
      likelySpamCount += 1;
    }
    const trustLevel = normalizeTrustLevel(message?.sourceIdentity?.trustLevel, "unknown");
    if (trustLevel === "trusted") {
      trustedSourceCount += 1;
    } else if (trustLevel === "known") {
      knownSourceCount += 1;
    }
    if (message?.command?.action === "auto_queue") {
      commandReadyCount += 1;
    } else if (["user_decision_required", "safe_reply_only"].includes(String(message?.command?.action || ""))) {
      commandReviewCount += 1;
    }
  }
  return {
    enabled: observerConfig?.mail?.enabled === true,
    activeAgentId: agent?.id || "",
    activeAgentLabel: agent?.label || "",
    activeAgentEmail: agent?.email || "",
    configured: Boolean(agent),
    ready: await hasMailCredentials(agent),
    hasPassword: agent ? await hasMailPassword(agent) : false,
    passwordHandle: String(agent?.passwordHandle || "").trim(),
    lastCheckAt: mailState.lastCheckAt || 0,
    lastError: mailState.lastError || "",
    recentMessageCount: recentMessages.length,
    likelySpamCount,
    trustedSourceCount,
    knownSourceCount,
    commandReadyCount,
    commandReviewCount,
    sendSummariesEnabled: mailWatchRulesState?.sendSummariesEnabled !== false,
    emailCommandMinLevel: getAppTrustConfig().emailCommandMinLevel,
    quarantinedCount: Array.isArray(mailState.quarantinedMessages) ? mailState.quarantinedMessages.filter((entry) => entry.agentId === agent?.id).length : 0,
    categoryCounts
  };
}

async function withImapClient(agent, handler) {
  const auth = await resolveMailAuth(agent);
  const client = new ImapFlow({
    host: observerConfig.mail.imap.host,
    port: observerConfig.mail.imap.port,
    secure: observerConfig.mail.imap.secure !== false,
    auth
  });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore logout failures
    }
  }
}

function sanitizeMailText(value = "") {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripQuotedReplyText(value = "") {
  const raw = sanitizeMailText(value);
  if (!raw) {
    return "";
  }
  const lines = raw.split("\n");
  const kept = [];
  const hasMeaningfulContent = () => kept.some((line) => String(line || "").trim());
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    const trimmed = line.trim();
    const nextWindow = lines
      .slice(index, index + 5)
      .map((entry) => String(entry || "").trim())
      .join("\n");
    const startsQuotedThread = (
      /^>+/.test(trimmed)
      || /^[-_]{2,}\s*original message\s*[-_]{2,}$/i.test(trimmed)
      || /^on .+wrote:\s*$/i.test(trimmed)
      || (
        hasMeaningfulContent()
        && /^from:\s+/i.test(trimmed)
        && /^subject:\s+/im.test(nextWindow)
      )
    );
    if (startsQuotedThread && hasMeaningfulContent()) {
      break;
    }
    kept.push(line);
  }
  return sanitizeMailText(kept.join("\n")) || raw;
}

function classifyMailMessage({
  fromName = "",
  fromAddress = "",
  to = [],
  subject = "",
  text = ""
} = {}) {
  const senderName = String(fromName || "").trim();
  const senderAddress = String(fromAddress || "").trim().toLowerCase();
  const recipients = Array.isArray(to) ? to.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean) : [];
  const subjectText = String(subject || "").trim();
  const bodyText = compactTaskText(String(text || "").replace(/\s+/g, " ").trim(), 2400);
  const combined = `${senderName}\n${senderAddress}\n${subjectText}\n${bodyText}`.toLowerCase();

  let spamScore = 0;
  const reasons = [];

  const addReason = (score, reason) => {
    spamScore += score;
    reasons.push(reason);
  };

  if (/\b(unsubscribe|view online|privacy policy|terms ?& ?conditions|help centre|manage preferences)\b/.test(combined)) {
    addReason(2, "bulk-marketing footer");
  }
  if (/\b(no traffic growth no pay|reply yes interested|special offer|limited time|flash deal|order now|buy now|discount|% off|sale)\b/.test(combined)) {
    addReason(2, "promotional language");
  }
  if (/\b(website review|marketing|seo|paid advertising|traffic growth|lead generation|digital marketing)\b/.test(combined)) {
    addReason(2, "cold marketing pitch");
  }
  if (/\b(kogan|seek|newsletter|store-news|noreply|no-reply|mailer-daemon)\b/.test(combined)) {
    addReason(1, "bulk sender pattern");
  }
  if (/\b(reply with no|if this is not of your interest|located in the below aussie cities)\b/.test(combined)) {
    addReason(2, "spam template phrasing");
  }
  if (senderAddress.endsWith(".my.id")) {
    addReason(3, "suspicious sender domain");
  }
  if (/\b(verify your account|confirm your identity|wallet|crypto|seed phrase|gift card|payment failed|account suspended|unusual sign-in|click the link below|act now)\b/.test(combined)) {
    addReason(3, "phishing-style language");
  }
  if (/\b(bit\.ly|tinyurl|t\.co|goo\.gl|rb\.gy)\b/.test(combined)) {
    addReason(2, "shortened-link pattern");
  }
  if (/\b(microsoft|google|apple|paypal|bank|ato|australia post|mygov)\b/.test(combined) && /\b(verify|login|password|reset|suspended|security alert|click)\b/.test(combined)) {
    addReason(3, "brand impersonation pattern");
  }
  if (/\b(invoice|refund|receipt|security alert|password reset|verification code)\b/.test(combined)) {
    addReason(-1, "transactional wording");
  }
  if (recipients.some((entry) => /\bhello@derek\.net\.au\b/.test(entry))) {
    addReason(1, "forwarded-to-user mailbox");
  }

  let category = "other";
  if (/\b(applied jobs|recruitment|job|seek|candidate|application)\b/.test(combined)) {
    category = "jobs";
  } else if (/\b(invoice|receipt|refund|order|payment|transaction|billing|renewal)\b/.test(combined)) {
    category = "transactional";
  } else if (/\b(marketing|seo|traffic growth|sale|discount|offer|promo|newsletter|advertis)\b/.test(combined)) {
    category = "promotion";
  } else if (/\b(hello|hi derek|let me know|thanks|regards)\b/.test(combined) && !/\b(unsubscribe|sale|discount)\b/.test(combined)) {
    category = "personal";
  } else if (/\b(alert|warning|security|system|notification|update)\b/.test(combined)) {
    category = "system";
  }

  const automated = /\b(noreply|no-reply|newsletter|store-news)\b/.test(senderAddress) || /\bview online\b/.test(combined);
  const likelySpam = spamScore >= 4 || (spamScore >= 3 && category === "promotion");
  const likelyPhishing = spamScore >= 5
    && category !== "promotion"
    && /\b(verify|password|login|security alert|suspended|click|payment failed|identity)\b/.test(combined)
    && !/\b(verification code|password reset requested by you)\b/.test(combined);
  if (category === "other" && automated && (likelySpam || /\b(sale|discount|offer|deal|promo)\b/.test(combined))) {
    category = "promotion";
  }
  const definitelyBad = likelyPhishing || (likelySpam && Number(spamScore || 0) >= 5 && ["promotion", "other"].includes(category));
  const autoReview = !(definitelyBad || (automated && category === "promotion"));
  const autoMoveDestination = definitelyBad ? "trash" : "";

  return {
    category,
    spamScore,
    likelySpam,
    likelyPhishing,
    automated,
    autoReview,
    autoMoveDestination,
    reasons: reasons.slice(0, 4)
  };
}

function resolveImplicitUserEmail() {
  const configured = String(observerConfig?.mail?.notifyEmail || "").trim();
  if (looksLikeEmailAddress(configured)) {
    return configured;
  }
  const recent = Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [];
  const blocked = new Set(
    [
      getActiveMailAgent()?.email
    ].filter(Boolean).map((value) => String(value).trim().toLowerCase())
  );
  const recipientScores = new Map();
  for (const message of recent) {
    const receivedAt = Number(message.receivedAt || 0);
    const recipients = Array.isArray(message.to) ? message.to : [];
    for (const recipient of recipients) {
      const email = String(recipient || "").trim();
      const key = email.toLowerCase();
      if (!email || blocked.has(key)) {
        continue;
      }
      const previous = recipientScores.get(key);
      recipientScores.set(key, {
        email,
        count: Number(previous?.count || 0) + 1,
        latestAt: Math.max(Number(previous?.latestAt || 0), receivedAt)
      });
    }
  }
  const bestRecipient = [...recipientScores.values()]
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return right.latestAt - left.latestAt;
    })[0];
  if (bestRecipient?.email) {
    return bestRecipient.email;
  }
  const incoming = recent
    .filter((message) => String(message.fromAddress || "").trim())
    .filter((message) => !blocked.has(String(message.fromAddress || "").trim().toLowerCase()))
    .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0));
  return String(incoming[0]?.fromAddress || "").trim();
}

function mailAgentMatchesText(agent, text = "") {
  const patterns = [
    String(agent?.id || "").trim(),
    String(agent?.label || "").trim(),
    ...(Array.isArray(agent?.aliases) ? agent.aliases.map((value) => String(value).trim()) : [])
  ].filter(Boolean);
  return patterns.some((value) => new RegExp(`\\b${escapeRegex(value)}\\b`, "i").test(text));
}

function parseDirectMailRequest(message = "") {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  if (!/\b(send|email|mail)\b/.test(lower)) {
    return null;
  }
  const directEmailMatch = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const refersToUser = /\b(to me|email me|send me (?:an? )?(?:test )?email|send me mail|mail me)\b/i.test(text);
  const destinationEmail = directEmailMatch
    ? String(directEmailMatch[0]).trim()
    : refersToUser
      ? resolveImplicitUserEmail()
      : "";
  if (!destinationEmail) {
    return null;
  }
  const subjectMatch = text.match(/\bsubject\b[:\s]+["']?([^"'\n]+)["']?/i);
  const bodyMatch = text.match(/\b(?:that says|that said|saying|say|with(?: the)? message|message|body)\b[:\s]+["']?([\s\S]+?)["']?\s*$/i);
  const bareHiMatch = text.match(/\b(?:send|email|mail)\b[\s\S]*?\b(?:that says|that said|saying|say)\s+(.+)$/i);
  const body = sanitizeMailText(bodyMatch?.[1] || bareHiMatch?.[1] || "");
  const wantsTestEmail = /\btest email\b/i.test(text) || /\btest mail\b/i.test(text);
  const wantsReport = /\b(add|include|attach|with)\b[\s\S]*\b(report|summary|status update)\b/i.test(text)
    || /\b(send|email|mail)\b[\s\S]*\b(report|summary|status update)\b/i.test(text);
  return {
    toEmail: destinationEmail,
    subject: String(subjectMatch?.[1] || "").trim(),
    text: body,
    wantsTestEmail,
    wantsReport
  };
}

function parseStandingMailWatchRequest(message = "") {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  if (!/\b(email|emails|mail|inbox)\b/.test(lower)) {
    return null;
  }
  if (!/\b(keep an eye on|watch|monitor|look out for|pay attention to|keep track of)\b/.test(lower)) {
    return null;
  }
  if (!/\b(let me know|tell me|notify me|flag|if i need to address|if anything needs my attention|if i should reply)\b/.test(lower)) {
    return null;
  }
  const notifyEmail = resolveImplicitUserEmail();
  const every = "10m";
  return {
    id: `mail-watch-${hashRef(text.replace(/\s+/g, " ").trim().toLowerCase())}`,
    every,
    everyMs: parseEveryToMs(every),
    instruction: text,
    notifyEmail,
    autoForwardGood: true,
    trashDefiniteBad: true,
    promptUnsure: true,
    sendSummaries: mailWatchRulesState?.sendSummariesEnabled !== false,
    promptEvery: "4h",
    promptEveryMs: parseEveryToMs("4h")
  };
}

function isValidNotifyEmail(value = "") {
  const email = String(value || "").trim();
  return looksLikeEmailAddress(email) && !/missing_/i.test(email);
}

function resolveMailWatchNotifyEmail(rule = {}) {
  const configured = String(rule?.notifyEmail || "").trim();
  if (isValidNotifyEmail(configured)) {
    return configured;
  }
  return String(resolveImplicitUserEmail() || "").trim();
}

function isDefinitelyGoodMail(message = {}) {
  const triage = message?.triage || {};
  const category = String(triage.category || "").trim().toLowerCase();
  if (triage.likelySpam || triage.likelyPhishing) {
    return false;
  }
  if (Number(triage.spamScore || 0) > 1) {
    return false;
  }
  return ["personal", "transactional", "jobs", "system"].includes(category);
}

function isDefinitelyBadMail(message = {}) {
  const triage = message?.triage || {};
  const category = String(triage.category || "").trim().toLowerCase();
  const spamScore = Number(triage.spamScore || 0);
  return triage.likelyPhishing === true
    || (triage.likelySpam === true && spamScore >= 5 && ["promotion", "other"].includes(category));
}

function summarizeMailForUser(message = {}) {
  const triage = message?.triage || {};
  const parts = [
    `${formatDateTimeForUser(message.receivedAt)} from ${message.fromName || message.fromAddress || "Unknown sender"}`,
    `subject: ${message.subject || "(no subject)"}`
  ];
  if (triage.category) {
    parts.push(`category: ${triage.category}`);
  }
  if (Array.isArray(triage.reasons) && triage.reasons.length) {
    parts.push(`signals: ${triage.reasons.slice(0, 3).join(", ")}`);
  }
  const preview = compactTaskText(message.text || "", 260);
  if (preview) {
    parts.push(preview);
  }
  return parts.join("\n");
}

async function forwardMailToUser(message = {}, notifyEmail = "") {
  const destination = String(notifyEmail || "").trim();
  if (!looksLikeEmailAddress(destination)) {
    throw new Error("notifyEmail is not configured");
  }
  const triage = message?.triage || {};
  const text = [
    "Nova flagged this email as clearly worth your attention.",
    "",
    `From: ${message.fromName || message.fromAddress || "Unknown sender"} <${message.fromAddress || "unknown"}>`,
    `To: ${Array.isArray(message.to) && message.to.length ? message.to.join(", ") : "(unknown)"}`,
    `Received: ${formatDateTimeForUser(message.receivedAt)}`,
    `Subject: ${message.subject || "(no subject)"}`,
    triage.category ? `Category: ${triage.category}` : "",
    "",
    "Message:",
    String(message.text || "").trim() || "(no message body)"
  ].filter(Boolean).join("\n");
  return sendAgentMail({
    toEmail: destination,
    subject: `[Nova] ${message.subject || "(no subject)"}`,
    text
  });
}

async function sendUnsureMailDigest({ rule, messages = [] } = {}) {
  const notifyEmail = resolveMailWatchNotifyEmail(rule);
  if (!looksLikeEmailAddress(notifyEmail) || !messages.length) {
    return null;
  }
  const body = [
    "Nova needs direction on these uncertain emails.",
    "",
    "Please reply with what you want done, or tell Nova directly in chat.",
    "",
    ...messages.slice(0, 8).map((message, index) => [
      `${index + 1}.`,
      summarizeMailForUser(message)
    ].join("\n"))
  ].join("\n\n");
  return sendAgentMail({
    toEmail: notifyEmail,
    subject: `[Nova] Direction needed for ${messages.length} email${messages.length === 1 ? "" : "s"}`,
    text: body
  });
}

function getMailWatchRule(ruleId = "") {
  return (Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [])
    .find((rule) => String(rule.id || "") === String(ruleId || "")) || null;
}

async function findMailWatchWaitingTask(ruleId = "") {
  const targetRuleId = String(ruleId || "").trim();
  if (!targetRuleId) {
    return null;
  }
  const { waiting } = await listAllTasks();
  return waiting.find((task) =>
    String(task.internalJobType || "") === "mail_watch_question"
    && String(task.mailWatchRuleId || "").trim() === targetRuleId
  ) || null;
}

function buildMailWatchSingleQuestion(message = {}) {
  const summary = summarizeMailForUser(message);
  return {
    message: [
      "Mail watch needs direction for 1 uncertain email.",
      "",
      `1. ${summary}`
    ].join("\n"),
    questionForUser: [
      "I have 1 uncertain email that needs direction.",
      "What would you like me to do with it?",
      "",
      `1. ${summary}`
    ].join("\n")
  };
}

function parseMailWatchAnswerAction(answer = "") {
  const lower = String(answer || "").trim().toLowerCase();
  if (!lower) {
    return "";
  }
  if (/\b(trash|delete|junk|bin|remove)\b/.test(lower)) {
    return "trash";
  }
  if (/\barchive\b/.test(lower)) {
    return "archive";
  }
  if (/\bforward\b|\bsend(?: it)? to me\b|\bemail(?: it)? to me\b/.test(lower)) {
    return "forward";
  }
  if (/\bkeep\b|\bleave\b|\bignore\b|\bdo nothing\b/.test(lower)) {
    return "keep";
  }
  return "";
}

async function inferMailWatchAnswerActionWithLlm(task, answer, messages = []) {
  const routing = getRoutingConfig();
  const plannerBrain = await choosePlannerRepairBrain(
    [String(routing.remoteTriageBrainId || "").trim(), "helper"].filter(Boolean),
    { preferRemote: true }
  ) || await getBrain("bitnet");
  const messageSummaries = (Array.isArray(messages) ? messages : [])
    .slice(0, 5)
    .map((message, index) => `${index + 1}. ${summarizeMailForUser(message)}`)
    .join("\n\n");
  const prompt = [
    "You are deciding how to apply a user's answer to a mail-watch follow-up question.",
    `Your name is ${getAgentPersonaName()}.`,
    "Reply with JSON only.",
    "Choose exactly one action from: trash, archive, forward, keep, unclear.",
    "Be conservative. Use unclear if the user answer is ambiguous or depends on per-message differences.",
    "Schema: {\"action\":\"trash|archive|forward|keep|unclear\",\"reason\":\"...\"}",
    "",
    `Original question: ${String(task.questionForUser || task.message || "").trim()}`,
    `User answer: ${String(answer || "").trim()}`,
    "",
    "Emails in question:",
    messageSummaries || "(none)"
  ].join("\n");
  const result = await runOllamaJsonGenerate(plannerBrain.model, prompt, {
    timeoutMs: 45000,
    keepAlive: MODEL_KEEPALIVE,
    baseUrl: plannerBrain.ollamaBaseUrl,
    options: isCpuQueueLane(plannerBrain) ? { num_gpu: 0 } : undefined
  });
  if (!result.ok) {
    return { action: "", reason: result.stderr || "planner inference failed" };
  }
  try {
    const parsed = extractJsonObject(result.text);
    const action = String(parsed.action || "").trim().toLowerCase();
    if (["trash", "archive", "forward", "keep"].includes(action)) {
      return {
        action,
        reason: compactTaskText(String(parsed.reason || "").trim(), 220)
      };
    }
    return {
      action: "",
      reason: compactTaskText(String(parsed.reason || "the answer was still ambiguous").trim(), 220)
    };
  } catch (error) {
    return { action: "", reason: error.message || "failed to parse planner answer" };
  }
}

async function handleMailWatchWaitingAnswer(task, answer, sessionId = "Main") {
  const ruleId = String(task.mailWatchRuleId || "").trim();
  const rule = getMailWatchRule(ruleId);
  if (!rule) {
    throw new Error("mail watch rule not found");
  }
  const pendingIds = Array.isArray(task.pendingUnsureMessageIds)
    ? task.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (!pendingIds.length) {
    throw new Error("no pending unsure emails were attached to this question");
  }
  const recentMessages = Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [];
  const messages = pendingIds
    .map((messageId) => recentMessages.find((entry) => String(entry.id || "").trim() === messageId))
    .filter(Boolean);
  if (!messages.length) {
    const currentPendingIds = Array.isArray(rule.pendingUnsureMessageIds)
      ? rule.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const currentMessages = currentPendingIds
      .map((messageId) => recentMessages.find((entry) => String(entry.id || "").trim() === messageId))
      .filter(Boolean);
    await closeTaskRecord(task, compactTaskText(
      currentMessages.length
        ? "Closed stale mail-watch question because the underlying unsure emails changed. A refreshed question will replace it."
        : "Closed stale mail-watch question because the original unsure emails are no longer available."
    , 260));
    if (currentMessages.length) {
      await reconcileMailWatchWaitingQuestions();
    }
    return {
      ...task,
      status: "closed",
      updatedAt: Date.now(),
      notes: currentMessages.length
        ? "Stale question replaced with a refreshed mail-watch prompt."
        : "Stale question cleared because the original messages are no longer available."
    };
  }
  let action = parseMailWatchAnswerAction(answer);
  let inferredReason = "";
  if (!action) {
    const inferred = await inferMailWatchAnswerActionWithLlm(task, answer, messages);
    action = inferred.action;
    inferredReason = inferred.reason || "";
  }
  if (!action) {
    throw new Error(`I couldn't tell whether you wanted me to trash, archive, forward, or keep that email.${inferredReason ? ` ${inferredReason}` : ""}`);
  }
  const notifyEmail = resolveMailWatchNotifyEmail(rule);
  const resolvedUnsureMessageIds = new Set(
    Array.isArray(rule.resolvedUnsureMessageIds)
      ? rule.resolvedUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
      : []
  );
  let forwardedCount = 0;
  let movedCount = 0;
  for (const message of messages) {
    const messageId = String(message.id || "").trim();
    if (action === "trash") {
      await moveAgentMail({ destination: "trash", messageId });
      movedCount += 1;
    } else if (action === "archive") {
      await moveAgentMail({ destination: "archive", messageId });
      movedCount += 1;
    } else if (action === "forward") {
      await forwardMailToUser(message, notifyEmail);
      forwardedCount += 1;
    }
  }
  const remainingPendingIds = (Array.isArray(rule.pendingUnsureMessageIds) ? rule.pendingUnsureMessageIds : [])
    .map((value) => String(value || "").trim())
    .filter((messageId) => !pendingIds.includes(messageId));
  for (const messageId of pendingIds) {
    resolvedUnsureMessageIds.add(messageId);
  }
  await upsertMailWatchRule({
    ...rule,
    pendingUnsureMessageIds: remainingPendingIds,
    resolvedUnsureMessageIds: [...resolvedUnsureMessageIds],
    lastPromptedAt: Date.now()
  });
  await closeTaskRecord(task, compactTaskText(
    action === "forward"
      ? `User answered mail-watch question: forwarded ${forwardedCount} uncertain email${forwardedCount === 1 ? "" : "s"} and cleared the waiting prompt.`
      : action === "keep"
        ? `User answered mail-watch question: kept ${messages.length} uncertain email${messages.length === 1 ? "" : "s"} in the inbox and cleared the waiting prompt.`
        : `User answered mail-watch question: moved ${movedCount} uncertain email${movedCount === 1 ? "" : "s"} to ${action} and cleared the waiting prompt.${inferredReason ? ` Reason: ${inferredReason}` : ""}`
  , 260));
  return {
    ...task,
    status: "closed",
    handledAction: action,
    handledMessageCount: messages.length,
    updatedAt: Date.now()
  };
}

async function reconcileMailWatchWaitingQuestions() {
  const rules = Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [];
  const recentMessages = Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [];
  const messageById = new Map(recentMessages.map((message) => [String(message.id || "").trim(), message]).filter(([id]) => id));
  for (const rule of rules) {
    if (rule?.enabled === false || rule?.promptUnsure === false) {
      continue;
    }
    const pendingIds = Array.isArray(rule?.pendingUnsureMessageIds)
      ? rule.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const existingWaitingTask = await findMailWatchWaitingTask(rule.id);
    if (!pendingIds.length) {
      if (existingWaitingTask) {
        await closeTaskRecord(existingWaitingTask, "Closed stale mail-watch question because there are no pending unsure emails.");
      }
      continue;
    }
    const messages = pendingIds.map((id) => messageById.get(id)).filter(Boolean).slice(0, 1);
    if (!messages.length) {
      if (existingWaitingTask) {
        await closeTaskRecord(existingWaitingTask, "Closed stale mail-watch question because the original unsure emails are no longer available.");
      }
      continue;
    }
    const nextPendingIds = messages.map((message) => String(message.id || "").trim()).filter(Boolean);
    const existingPendingIds = Array.isArray(existingWaitingTask?.pendingUnsureMessageIds)
      ? existingWaitingTask.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (existingWaitingTask) {
      const samePendingIds = existingPendingIds.length === nextPendingIds.length
        && existingPendingIds.every((value, index) => value === nextPendingIds[index]);
      if (samePendingIds) {
        continue;
      }
      await closeTaskRecord(existingWaitingTask, "Closed stale mail-watch question because the underlying unsure emails changed.");
    }
    const question = buildMailWatchSingleQuestion(messages[0]);
    await createWaitingTask({
      message: question.message,
      questionForUser: question.questionForUser,
      sessionId: "mail-watch-question",
      requestedBrainId: "worker",
      intakeBrainId: "bitnet",
      internetEnabled: false,
      selectedMountIds: [],
      forceToolUse: false,
      notes: `Recovered waiting question for uncertain mail from rule ${rule.id}.`,
      taskMeta: {
        internalJobType: "mail_watch_question",
        mailWatchRuleId: rule.id,
        pendingUnsureMessageIds: nextPendingIds
      }
    });
  }
}

async function upsertMailWatchRule(request = {}) {
  const now = Date.now();
  const existing = getMailWatchRule(request.id);
  const promptEvery = String(request.promptEvery || existing?.promptEvery || "4h").trim() || "4h";
  const rule = {
    id: String(request.id || `mail-watch-${now}`).trim(),
    createdAt: Number(existing?.createdAt || now),
    updatedAt: now,
    enabled: true,
    every: String(request.every || existing?.every || "10m").trim() || "10m",
    everyMs: Number(request.everyMs || existing?.everyMs || parseEveryToMs(request.every || existing?.every || "10m") || 10 * 60 * 1000),
    instruction: String(request.instruction || existing?.instruction || "").trim(),
    notifyEmail: String(request.notifyEmail || existing?.notifyEmail || resolveImplicitUserEmail() || "").trim(),
    autoForwardGood: request.autoForwardGood == null ? (existing?.autoForwardGood !== false) : request.autoForwardGood === true,
    trashDefiniteBad: request.trashDefiniteBad == null ? (existing?.trashDefiniteBad !== false) : request.trashDefiniteBad === true,
    promptUnsure: request.promptUnsure == null ? (existing?.promptUnsure !== false) : request.promptUnsure === true,
    sendSummaries: request.sendSummaries == null
      ? (existing?.sendSummaries == null ? (mailWatchRulesState?.sendSummariesEnabled !== false) : existing?.sendSummaries !== false)
      : request.sendSummaries === true,
    promptEvery,
    promptEveryMs: Number(request.promptEveryMs || existing?.promptEveryMs || parseEveryToMs(promptEvery) || 4 * 60 * 60 * 1000),
    lastCheckedAt: Number(request.lastCheckedAt || existing?.lastCheckedAt || 0),
    lastProcessedReceivedAt: Number(request.lastProcessedReceivedAt || existing?.lastProcessedReceivedAt || 0),
    lastPromptedAt: Number(request.lastPromptedAt || existing?.lastPromptedAt || 0),
    forwardedMessageIds: Array.isArray(request.forwardedMessageIds)
      ? request.forwardedMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
      : Array.isArray(existing?.forwardedMessageIds)
        ? existing.forwardedMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
        : [],
    resolvedUnsureMessageIds: Array.isArray(request.resolvedUnsureMessageIds)
      ? request.resolvedUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
      : Array.isArray(existing?.resolvedUnsureMessageIds)
        ? existing.resolvedUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
        : [],
    pendingUnsureMessageIds: Array.isArray(request.pendingUnsureMessageIds)
      ? request.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
      : Array.isArray(existing?.pendingUnsureMessageIds)
        ? existing.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
        : []
  };
  const otherRules = (Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [])
    .filter((entry) => String(entry.id || "") !== rule.id);
  mailWatchRulesState.rules = [...otherRules, rule]
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
  await saveMailWatchRulesState();
  return rule;
}

function normalizeMailMessage(agent, uid, envelope, parsed, source = "imap") {
  const fromEntry = Array.isArray(envelope?.from) ? envelope.from[0] : null;
  const toEntries = Array.isArray(envelope?.to) ? envelope.to : [];
  const subject = String(parsed?.subject || envelope?.subject || "(no subject)").trim() || "(no subject)";
  const rawText = sanitizeMailText(parsed?.text || parsed?.html || "");
  const text = stripQuotedReplyText(rawText);
  const sourceIdentity = assessEmailSourceIdentity({
    fromName: fromEntry?.name || "",
    fromAddress: fromEntry?.address || ""
  });
  const triage = classifyMailMessage({
    fromName: fromEntry?.name || "",
    fromAddress: fromEntry?.address || "",
    to: toEntries.map((entry) => entry?.address).filter(Boolean),
    subject,
    text
  });
  const command = inspectMailCommand({ subject, text });
  return {
    id: `${agent.id}:${uid}`,
    uid: Number(uid || 0),
    agentId: agent.id,
    agentLabel: agent.label,
    agentEmail: agent.email,
    fromName: fromEntry?.name || fromEntry?.address || "Unknown sender",
    fromAddress: fromEntry?.address || "",
    to: toEntries.map((entry) => entry?.address).filter(Boolean),
    subject,
    text,
    rawText,
    receivedAt: Number(envelope?.date ? new Date(envelope.date).getTime() : Date.now()),
    source,
    triage,
    sourceIdentity,
    command
  };
}

function mergeMailSourceIdentityRecords(primary = null, secondary = null) {
  const left = normalizeSourceIdentityRecord(primary);
  const right = normalizeSourceIdentityRecord(secondary);
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (left.kind !== right.kind) {
    return left;
  }
  const leftRank = getTrustLevelRank(left.trustLevel);
  const rightRank = getTrustLevelRank(right.trustLevel);
  const preferred = rightRank > leftRank ? right : left;
  const fallback = preferred === left ? right : left;
  return {
    ...fallback,
    ...preferred,
    label: String(preferred.label || fallback.label || "").trim(),
    email: String(preferred.email || fallback.email || "").trim().toLowerCase(),
    sourceId: String(preferred.sourceId || fallback.sourceId || "").trim(),
    matchedBy: String(preferred.matchedBy || fallback.matchedBy || "").trim()
  };
}

function resolveMailCommandSourceIdentity(message = {}) {
  const provided = normalizeSourceIdentityRecord(message?.sourceIdentity);
  if (provided?.kind && provided.kind !== "email") {
    return provided;
  }
  const fromName = String(message?.fromName || "").trim();
  const fromAddress = String(message?.fromAddress || "").trim();
  if (!fromName && !fromAddress) {
    return provided;
  }
  const assessed = assessEmailSourceIdentity({ fromName, fromAddress });
  return mergeMailSourceIdentityRecords(provided, assessed) || provided || assessed || null;
}

function buildMailCommandRecord(commandStatus = {}, existingCommand = {}) {
  const existing = existingCommand && typeof existingCommand === "object" ? existingCommand : {};
  const status = commandStatus && typeof commandStatus === "object" ? commandStatus : {};
  return {
    detected: status.detected === true,
    text: String(status.text || existing.text || "").trim(),
    action: String(status.action || "").trim(),
    reason: String(status.reason || "").trim(),
    taskId: String(status.taskId || "").trim(),
    taskCodename: String(status.taskCodename || "").trim(),
    deduped: status.deduped === true
  };
}

function buildMailCommandReceiptText(message = {}, commandStatus = {}) {
  const trustLabel = trustLevelLabel(message?.sourceIdentity?.trustLevel);
  const action = String(commandStatus?.action || "").trim();
  const actionDetail = action === "auto_queue"
    ? `Action taken: queued this request for execution${commandStatus?.taskCodename ? ` as ${commandStatus.taskCodename}` : ""}.`
    : action === "safe_reply_only"
      ? "Action taken: confirmed receipt only. Nova did not execute the request because this sender is not fully trusted."
      : action === "user_decision_required"
        ? `Action taken: referred this request to the question system for user decision${commandStatus?.taskCodename ? ` as ${commandStatus.taskCodename}` : ""}.`
        : action === "blocked"
          ? "Action taken: blocked this request because the message was flagged as spam or phishing."
          : `Action taken: ${action || "recorded"}.`;
  const lines = [
    "Nova received your message.",
    "",
    actionDetail,
    `Source trust: ${trustLabel}.`
  ];
  if (action === "auto_queue") {
    lines.push("If the request is unclear during execution, Nova will refer it to the question system for user direction.");
  }
  if (commandStatus?.reason) {
    lines.push(`Reason: ${String(commandStatus.reason || "").trim()}`);
  }
  if (commandStatus?.text) {
    lines.push("");
    lines.push(`Request received: ${String(commandStatus.text || "").trim()}`);
  }
  return lines.join("\n");
}

async function sendMailCommandReceipt(message = {}, commandStatus = {}) {
  const toEmail = String(message?.fromAddress || message?.sourceIdentity?.email || "").trim();
  if (!looksLikeEmailAddress(toEmail)) {
    return {
      sent: false,
      error: "sender email is unavailable"
    };
  }
  try {
    await sendAgentMail({
      toEmail,
      subject: `Re: ${String(message?.subject || "(no subject)").trim() || "(no subject)"}`,
      text: buildMailCommandReceiptText(message, commandStatus)
    });
    return {
      sent: true,
      error: ""
    };
  } catch (error) {
    return {
      sent: false,
      error: String(error?.message || error || "receipt failed").trim()
    };
  }
}

async function finalizeMailCommandStatus(message = {}, commandStatus = {}) {
  const nextStatus = {
    ...commandStatus
  };
  const receipt = await sendMailCommandReceipt(message, nextStatus);
  nextStatus.receiptSent = receipt.sent === true;
  if (!receipt.sent && receipt.error) {
    nextStatus.reason = `${String(nextStatus.reason || "").trim()} Receipt confirmation failed: ${receipt.error}`.trim();
  }
  broadcastObserverEvent({
    type: "mail.command",
    mail: {
      ...message,
      command: buildMailCommandRecord(nextStatus, message.command)
    }
  });
  return nextStatus;
}

function refreshRecentMailTrustForSource(sourceIdentity = {}) {
  const normalizedEmail = String(sourceIdentity?.email || "").trim().toLowerCase();
  if (!normalizedEmail || !Array.isArray(mailState.recentMessages) || !mailState.recentMessages.length) {
    return 0;
  }
  let updatedCount = 0;
  mailState.recentMessages = mailState.recentMessages.map((message) => {
    if (String(message?.fromAddress || "").trim().toLowerCase() !== normalizedEmail) {
      return message;
    }
    updatedCount += 1;
    const nextSourceIdentity = resolveMailCommandSourceIdentity({
      ...message,
      sourceIdentity
    }) || sourceIdentity || message.sourceIdentity;
    const inspectedCommand = inspectMailCommand(message);
    const nextCommandStatus = inspectedCommand.detected
      ? determineMailCommandAction({
          ...message,
          sourceIdentity: nextSourceIdentity,
          command: inspectedCommand
        })
      : null;
    return {
      ...message,
      sourceIdentity: nextSourceIdentity,
      command: nextCommandStatus
        ? buildMailCommandRecord(nextCommandStatus, inspectedCommand)
        : message.command
    };
  });
  return updatedCount;
}

function determineMailCommandAction(message = {}) {
  const command = message?.command && typeof message.command === "object"
    ? message.command
    : inspectMailCommand(message);
  if (!command.detected || !command.text) {
    return {
      detected: false,
      action: "",
      text: "",
      reason: ""
    };
  }
  const sourceIdentity = resolveMailCommandSourceIdentity(message) || {
    kind: "email",
    trustLevel: "unknown",
    label: String(message.fromName || message.fromAddress || "Unknown sender").trim()
  };
  const policy = getSourceTrustPolicy(sourceIdentity.trustLevel);
  if (message?.triage?.likelyPhishing || message?.triage?.likelySpam) {
    return {
      detected: true,
      action: "blocked",
      text: command.text,
      reason: "The email was flagged as spam or phishing."
    };
  }
  if (policy.requiresUserDecision) {
    return {
      detected: true,
      action: "user_decision_required",
      text: command.text,
      reason: "Unknown sources never execute commands. Nova referred the request to the user decision system."
    };
  }
  if (!policy.canExecuteCommands) {
    return {
      detected: true,
      action: "safe_reply_only",
      text: command.text,
      reason: "Known sources may receive a non-confidential acknowledgement, but they do not have authority to execute commands."
    };
  }
  return {
    detected: true,
    action: "auto_queue",
    text: command.text,
    reason: `${describeSourceTrust(sourceIdentity)} has full trust and may issue commands.`
  };
}

async function handleIncomingMailCommand(message = {}) {
  const resolvedSourceIdentity = resolveMailCommandSourceIdentity(message);
  if (resolvedSourceIdentity) {
    message.sourceIdentity = resolvedSourceIdentity;
  }
  const effectiveMessage = resolvedSourceIdentity
    ? { ...message, sourceIdentity: resolvedSourceIdentity }
    : { ...message };
  const commandStatus = determineMailCommandAction(effectiveMessage);
  if (!commandStatus.detected) {
    return commandStatus;
  }
  if (commandStatus.action === "safe_reply_only") {
    return finalizeMailCommandStatus(effectiveMessage, commandStatus);
  }
  if (commandStatus.action === "user_decision_required") {
    const { queued, waiting, inProgress } = await listAllTasks();
    const existingDecisionTask = [...queued, ...waiting, ...inProgress].find((task) =>
      String(task.sourceMessageId || "").trim() === String(effectiveMessage.id || "").trim()
      && String(task.sourceKind || "").trim() === "email"
    );
    if (existingDecisionTask) {
      return finalizeMailCommandStatus(effectiveMessage, {
        ...commandStatus,
        taskId: existingDecisionTask.id,
        taskCodename: existingDecisionTask.codename || formatTaskCodename(existingDecisionTask.id),
        deduped: true,
        reason: `${commandStatus.reason} Existing user-decision task already covers this message.`
      });
    }
    const decisionTask = await createWaitingTask({
      message: `Unknown email source requested: ${commandStatus.text}`,
      questionForUser: [
        `${describeSourceTrust(effectiveMessage.sourceIdentity)} sent an email command and is not trusted.`,
        `Subject: ${String(effectiveMessage.subject || "(no subject)").trim() || "(no subject)"}`,
        `Requested command: ${commandStatus.text}`,
        "",
        "How should Nova handle it? Reply with your decision, for example ignore it, answer manually, mark sender known, or mark sender trusted."
      ].join("\n"),
      sessionId: `mail:${String(effectiveMessage.agentId || "nova").trim()}`,
      requestedBrainId: "worker",
      intakeBrainId: "bitnet",
      internetEnabled: false,
      selectedMountIds: observerConfig.defaults.mountIds,
      forceToolUse: false,
      notes: `Waiting for user decision on unknown email command from ${describeSourceTrust(effectiveMessage.sourceIdentity)}.`,
      taskMeta: {
        sourceIdentity: normalizeSourceIdentityRecord({
          ...(effectiveMessage.sourceIdentity || {}),
          command: commandStatus
        }),
        sourceMessageId: String(effectiveMessage.id || "").trim(),
        sourceKind: "email",
        questionCategory: "source_trust_decision"
      }
    });
    return finalizeMailCommandStatus(effectiveMessage, {
      ...commandStatus,
      taskId: decisionTask.id,
      taskCodename: decisionTask.codename || formatTaskCodename(decisionTask.id),
      deduped: false
    });
  }
  if (commandStatus.action !== "auto_queue") {
    return finalizeMailCommandStatus(effectiveMessage, commandStatus);
  }
  const existingTask = await findRecentDuplicateQueuedTask({
    message: commandStatus.text,
    sessionId: `mail:${String(effectiveMessage.agentId || "nova").trim()}`,
    requestedBrainId: "worker",
    intakeBrainId: "bitnet"
  });
  if (existingTask) {
    return finalizeMailCommandStatus(effectiveMessage, {
      ...commandStatus,
      taskId: existingTask.id,
      taskCodename: existingTask.codename || formatTaskCodename(existingTask.id),
      deduped: true,
      reason: `Matched existing queued task ${existingTask.codename || existingTask.id}.`
    });
  }
  const task = await createQueuedTask({
    message: commandStatus.text,
    sessionId: `mail:${String(effectiveMessage.agentId || "nova").trim()}`,
    requestedBrainId: "worker",
    intakeBrainId: "bitnet",
    internetEnabled: true,
    selectedMountIds: observerConfig.defaults.mountIds,
    forceToolUse: true,
    requireWorkerPreflight: true,
    notes: `Queued from trusted email command sent by ${describeSourceTrust(effectiveMessage.sourceIdentity)}.`,
    taskMeta: {
      sourceIdentity: normalizeSourceIdentityRecord({
        ...(effectiveMessage.sourceIdentity || {}),
        command: commandStatus
      }),
      sourceMessageId: String(effectiveMessage.id || "").trim(),
      sourceKind: "email"
    }
  });
  return finalizeMailCommandStatus(effectiveMessage, {
    ...commandStatus,
    taskId: task.id,
    taskCodename: task.codename || formatTaskCodename(task.id),
    deduped: false
  });
}

async function loadMailQuarantineLog() {
  try {
    const raw = await fs.readFile(MAIL_QUARANTINE_LOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    mailState.quarantinedMessages = Array.isArray(parsed?.messages)
      ? parsed.messages.map((entry) => ({
          id: String(entry?.id || "").trim(),
          uid: Number(entry?.uid || 0),
          agentId: String(entry?.agentId || "").trim(),
          subject: String(entry?.subject || "").trim(),
          fromAddress: String(entry?.fromAddress || "").trim(),
          destination: String(entry?.destination || "").trim(),
          quarantinedAt: Number(entry?.quarantinedAt || 0),
          reasons: Array.isArray(entry?.reasons) ? entry.reasons.map((value) => String(value || "").trim()).filter(Boolean) : [],
          likelyPhishing: entry?.likelyPhishing === true,
          likelySpam: entry?.likelySpam === true
        })).filter((entry) => entry.id)
      : [];
  } catch {
    mailState.quarantinedMessages = [];
  }
}

async function saveMailQuarantineLog() {
  const messages = (Array.isArray(mailState.quarantinedMessages) ? mailState.quarantinedMessages : [])
    .sort((a, b) => Number(b.quarantinedAt || 0) - Number(a.quarantinedAt || 0))
    .slice(0, 200);
  mailState.quarantinedMessages = messages;
  await writeVolumeText(MAIL_QUARANTINE_LOG_PATH, `${JSON.stringify({ messages }, null, 2)}\n`);
}

async function tryAutoQuarantineMailMessage(client, message) {
  const triage = message?.triage || {};
  const destination = String(triage.autoMoveDestination || "").trim().toLowerCase();
  if (!destination) {
    return { moved: false, destination: "" };
  }
  const specialUseFlag = destination === "archive" ? "\\Archive" : destination === "trash" ? "\\Trash" : "";
  if (!specialUseFlag) {
    return { moved: false, destination: "" };
  }
  const destinationPath = await resolveSpecialUseMailbox(client, specialUseFlag, { createIfMissing: true });
  if (!destinationPath) {
    return { moved: false, destination: "" };
  }
  const result = await client.messageMove(Number(message.uid || 0), destinationPath, { uid: true });
  if (result === false) {
    return { moved: false, destination: "" };
  }
  mailState.quarantinedMessages = [
    {
      id: String(message.id || "").trim(),
      uid: Number(message.uid || 0),
      agentId: String(message.agentId || "").trim(),
      subject: String(message.subject || "").trim(),
      fromAddress: String(message.fromAddress || "").trim(),
      destination,
      quarantinedAt: Date.now(),
      reasons: Array.isArray(triage.reasons) ? triage.reasons : [],
      likelyPhishing: triage.likelyPhishing === true,
      likelySpam: triage.likelySpam === true
    },
    ...(Array.isArray(mailState.quarantinedMessages) ? mailState.quarantinedMessages : []).filter((entry) => String(entry.id || "") !== String(message.id || ""))
  ].slice(0, 200);
  await saveMailQuarantineLog();
  return { moved: true, destination };
}

async function fetchRecentMessagesForAgent(agent, { limit = 10, minUid = 0, emitEvents = false, initializeOnly = false } = {}) {
  if (!await hasMailCredentials(agent)) {
    return [];
  }
  return withImapClient(agent, async (client) => {
    let fetchedMessages = [];
    let highestUid = Number(minUid || 0);
    const lock = await client.getMailboxLock("INBOX");
    try {
      const allUids = await client.search({ all: true }, { uid: true });
      const sorted = [...allUids].sort((a, b) => a - b);
      highestUid = sorted.length ? sorted[sorted.length - 1] : Number(minUid || 0);
      const targetUids = initializeOnly
        ? sorted.slice(-Math.max(1, Math.min(Number(limit || 10), 20)))
        : sorted.filter((uid) => Number(uid) > Number(minUid || 0));
      if (targetUids.length) {
        for await (const msg of client.fetch(targetUids, { envelope: true, source: true }, { uid: true })) {
          const parsed = await simpleParser(msg.source);
          fetchedMessages.push(normalizeMailMessage(agent, msg.uid, msg.envelope, parsed));
        }
      }
    } finally {
      lock.release();
    }

    fetchedMessages.sort((left, right) => Number(left.receivedAt || 0) - Number(right.receivedAt || 0));
    const messages = [];
    const quarantined = [];
    for (const message of fetchedMessages) {
      if (!initializeOnly) {
        const commandStatus = await handleIncomingMailCommand(message);
        if (commandStatus.detected) {
          message.command = {
            ...(message.command || {}),
            ...commandStatus
          };
        }
        const quarantineResult = await tryAutoQuarantineMailMessage(client, message);
        if (quarantineResult.moved) {
          quarantined.push({
            ...message,
            quarantinedTo: quarantineResult.destination
          });
          continue;
        }
      }
      messages.push(message);
    }

    if (initializeOnly) {
      mailState.highestUidByAgent[agent.id] = Number(highestUid || 0);
    } else if (highestUid > Number(mailState.highestUidByAgent[agent.id] || 0)) {
      mailState.highestUidByAgent[agent.id] = Number(highestUid || 0);
    }

    if (messages.length) {
      const existing = mailState.recentMessages.filter((entry) => entry.agentId !== agent.id);
      const merged = [...existing, ...mailState.recentMessages.filter((entry) => entry.agentId === agent.id), ...messages];
      const deduped = new Map();
      for (const message of merged) {
        deduped.set(message.id, message);
      }
      mailState.recentMessages = [...deduped.values()]
        .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0))
        .slice(0, 40);
    }
    if (quarantined.length) {
      mailState.recentMessages = (Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [])
        .filter((entry) => !quarantined.some((item) => String(item.id || "") === String(entry.id || "")));
    }

    if (emitEvents && !initializeOnly) {
      for (const message of messages) {
        broadcastObserverEvent({
          type: "mail.message",
          mail: message
        });
      }
      for (const message of quarantined) {
        broadcastObserverEvent({
          type: "mail.quarantined",
          mail: message
        });
      }
    }

    mailState.lastCheckAt = Date.now();
    mailState.lastError = "";
    return messages;
  });
}

async function pollActiveMailbox({ emitEvents = true } = {}) {
  if (mailPollInFlight) {
    return [];
  }
  const agent = getActiveMailAgent();
  if (!await hasMailCredentials(agent)) {
    return [];
  }
  mailPollInFlight = true;
  try {
    const knownUid = Number(mailState.highestUidByAgent[agent.id] || 0);
    if (!knownUid) {
      await fetchRecentMessagesForAgent(agent, { limit: 10, initializeOnly: true });
      return [];
    }
    return await fetchRecentMessagesForAgent(agent, { minUid: knownUid, emitEvents });
  } catch (error) {
    mailState.lastCheckAt = Date.now();
    mailState.lastError = error.message;
    broadcast(`[observer] mail poll error: ${error.message}`);
    return [];
  } finally {
    mailPollInFlight = false;
  }
}

function looksLikeEmailAddress(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function sendAgentMail({ toEmail, subject, text }) {
  const fromAgent = getActiveMailAgent();
  const directEmail = String(toEmail || "").trim();
  if (!await hasMailCredentials(fromAgent)) {
    throw new Error("active mailbox is not fully configured");
  }
  if (!looksLikeEmailAddress(directEmail)) {
    throw new Error("destination mailbox is not configured");
  }
  const destinationEmail = directEmail;
  const destinationLabel = destinationEmail;
  const auth = await resolveMailAuth(fromAgent);
  const transporter = nodemailer.createTransport({
    host: observerConfig.mail.smtp.host,
    port: observerConfig.mail.smtp.port,
    secure: observerConfig.mail.smtp.secure === true,
    requireTLS: observerConfig.mail.smtp.requireTLS !== false,
    auth
  });
  const info = await transporter.sendMail({
    from: `"${fromAgent.label}" <${fromAgent.email}>`,
    to: `"${destinationLabel}" <${destinationEmail}>`,
    subject: String(subject || "").trim() || `Message from ${fromAgent.label}`,
    text: String(text || "").trim()
  });
  return {
    messageId: info.messageId,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
    from: fromAgent.email,
    to: destinationEmail
  };
}

async function toolSendMail(args = {}) {
  const toEmail = String(args.toEmail || args.email || args.to || "").trim();
  const subject = String(args.subject || "").trim();
  const text = String(args.text || args.body || "").trim();
  if (!looksLikeEmailAddress(toEmail)) {
    throw new Error("toEmail is required");
  }
  if (!text) {
    throw new Error("text is required");
  }
  const result = await sendAgentMail({
    toEmail,
    subject,
    text
  });
  return {
    ...result,
    subject: subject || `Message from ${getActiveMailAgent()?.label || "Nova"}`,
    text
  };
}

function findRecentMailMatch({
  messageId = "",
  uid = 0,
  subjectContains = "",
  fromContains = "",
  latest = false
} = {}) {
  const activeAgentId = String(getActiveMailAgent()?.id || "").trim();
  const recent = (Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [])
    .filter((message) => String(message.agentId || "") === activeAgentId)
    .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0));
  if (!recent.length) {
    return null;
  }
  const normalizedMessageId = String(messageId || "").trim();
  if (normalizedMessageId) {
    return recent.find((message) => String(message.id || "").trim() === normalizedMessageId) || null;
  }
  const numericUid = Number(uid || 0);
  if (numericUid > 0) {
    return recent.find((message) => Number(message.uid || 0) === numericUid) || null;
  }
  const normalizedSubject = String(subjectContains || "").trim().toLowerCase();
  if (normalizedSubject) {
    return recent.find((message) => String(message.subject || "").toLowerCase().includes(normalizedSubject)) || null;
  }
  const normalizedFrom = String(fromContains || "").trim().toLowerCase();
  if (normalizedFrom) {
    return recent.find((message) => {
      const fromName = String(message.fromName || "").toLowerCase();
      const fromAddress = String(message.fromAddress || "").toLowerCase();
      return fromName.includes(normalizedFrom) || fromAddress.includes(normalizedFrom);
    }) || null;
  }
  if (latest || recent.length === 1) {
    return recent[0];
  }
  return null;
}

async function resolveSpecialUseMailbox(client, specialUseFlag, { createIfMissing = false } = {}) {
  const folders = await client.list();
  const direct = folders.find((folder) => String(folder.specialUse || "") === specialUseFlag);
  if (direct?.path) {
    return String(direct.path);
  }
  const fallbackNamesByUse = {
    "\\Trash": ["Trash", "Deleted Items", "Deleted Messages"],
    "\\Archive": ["Archive", "Archives", "All Mail"]
  };
  const fallbackNames = fallbackNamesByUse[specialUseFlag] || [];
  const fallback = folders.find((folder) => fallbackNames.some((name) => String(folder.path || "").toLowerCase() === name.toLowerCase()));
  if (fallback?.path) {
    return String(fallback.path).trim();
  }
  if (!createIfMissing || !fallbackNames.length) {
    return "";
  }
  const createPath = fallbackNames[0];
  try {
    await client.mailboxCreate(createPath);
  } catch {
    // ignore create failure here; we'll re-check below
  }
  const refreshedFolders = await client.list();
  const created = refreshedFolders.find((folder) => String(folder.path || "").toLowerCase() === createPath.toLowerCase());
  return String(created?.path || "").trim();
}

async function moveAgentMail({ destination = "trash", messageId = "", uid = 0, subjectContains = "", fromContains = "", latest = false } = {}) {
  const agent = getActiveMailAgent();
  if (!await hasMailCredentials(agent)) {
    throw new Error("active mailbox is not fully configured");
  }
  const targetMessage = findRecentMailMatch({ messageId, uid, subjectContains, fromContains, latest });
  if (!targetMessage) {
    throw new Error("matching recent email was not found");
  }
  const normalizedDestination = String(destination || "").trim().toLowerCase();
  const specialUseFlag = normalizedDestination === "archive" ? "\\Archive" : normalizedDestination === "trash" ? "\\Trash" : "";
  if (!specialUseFlag) {
    throw new Error("destination must be trash or archive");
  }
  return withImapClient(agent, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const destinationPath = await resolveSpecialUseMailbox(client, specialUseFlag, { createIfMissing: true });
      if (!destinationPath) {
        throw new Error(`${normalizedDestination} mailbox is not configured on the server`);
      }
      const result = await client.messageMove(Number(targetMessage.uid), destinationPath, { uid: true });
      mailState.recentMessages = (Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [])
        .filter((message) => String(message.id || "") !== String(targetMessage.id || ""));
      mailState.lastCheckAt = Date.now();
      mailState.lastError = "";
      return {
        action: normalizedDestination,
        moved: Boolean(result !== false),
        destination: destinationPath,
        id: targetMessage.id,
        uid: Number(targetMessage.uid || 0),
        subject: String(targetMessage.subject || ""),
        fromAddress: String(targetMessage.fromAddress || "")
      };
    } finally {
      lock.release();
    }
  });
}

async function toolMoveMail(args = {}) {
  const destination = String(args.destination || args.action || "").trim().toLowerCase();
  const messageId = String(args.messageId || args.id || "").trim();
  const uid = Number(args.uid || 0);
  const subjectContains = String(args.subjectContains || args.subject || "").trim();
  const fromContains = String(args.fromContains || args.from || args.sender || "").trim();
  const latest = args.latest === true || String(args.latest || "").trim().toLowerCase() === "true";
  if (!destination) {
    throw new Error("destination is required");
  }
  const result = await moveAgentMail({
    destination,
    messageId,
    uid,
    subjectContains,
    fromContains,
    latest
  });
  return result;
}

async function inspectContainer(name) {
  const result = await runCommand("docker", [
    "inspect",
    name,
    "--format",
    "{{json .State}}"
  ]);

  if (result.code !== 0) {
    return { name, exists: false, running: false, error: result.stderr || "not found" };
  }

  try {
    const state = JSON.parse(result.stdout);
    return {
      name,
      exists: true,
      running: Boolean(state?.Running),
      status: state?.Status || "unknown",
      startedAt: state?.StartedAt || null,
      exitCode: state?.ExitCode ?? null
    };
  } catch {
    return {
      name,
      exists: true,
      running: false,
      status: "unknown",
      error: "failed to parse docker inspect output"
    };
  }
}

async function queryGpuStatus() {
  const result = await runCommand("nvidia-smi", [
    "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
    "--format=csv,noheader,nounits"
  ]);

  if (result.code !== 0) {
    return {
      available: false,
      error: result.stderr || "nvidia-smi failed"
    };
  }

  const line = result.stdout.split(/\r?\n/).find(Boolean);
  if (!line) {
    return {
      available: false,
      error: "no gpu data returned"
    };
  }

  const [name, utilizationGpu, memoryUsed, memoryTotal, temperatureGpu] = line.split(",").map((value) => value.trim());
  return {
    available: true,
    name,
    utilizationGpu: Number(utilizationGpu),
    memoryUsedMiB: Number(memoryUsed),
    memoryTotalMiB: Number(memoryTotal),
    temperatureC: Number(temperatureGpu)
  };
}

function shouldHideInspectorEntry(entryName) {
  if (!entryName) {
    return false;
  }
  return [
    ".git",
    ".gitignore",
    ".gitattributes",
    ".gitmodules"
  ].includes(entryName);
}

async function listVolumeFiles(rootPath) {
  const entries = [];
  async function walk(currentPath, depth = 0) {
    let stat;
    try {
      stat = await fs.stat(currentPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
    const entryName = path.basename(currentPath);
    if (depth > 0 && shouldHideInspectorEntry(entryName)) {
      return;
    }
    entries.push({
      type: stat.isDirectory() ? "dir" : "file",
      path: currentPath,
      name: entryName
    });
    if (!stat.isDirectory() || depth >= 3) {
      return;
    }
    let children = [];
    try {
      children = await fs.readdir(currentPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const child of children.sort()) {
      await walk(path.join(currentPath, child), depth + 1);
    }
  }
  await walk(rootPath);
  return entries;
}

async function readVolumeFile(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function ensureObserverOutputDir() {
  await fs.mkdir(OBSERVER_OUTPUT_ROOT, { recursive: true });
}

async function ensureTaskQueueDirs() {
  await Promise.all([
    fs.mkdir(TASK_QUEUE_INBOX, { recursive: true }),
    fs.mkdir(TASK_QUEUE_IN_PROGRESS, { recursive: true }),
    fs.mkdir(TASK_QUEUE_DONE, { recursive: true }),
    fs.mkdir(TASK_QUEUE_CLOSED, { recursive: true })
  ]);
}

async function countJsonFilesInFolder(folderPath = "") {
  try {
    const entries = await listVolumeFiles(folderPath);
    return entries.filter((entry) => entry.type === "file" && entry.path.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

async function countCanonicalQueueFiles() {
  const [inboxCount, inProgressCount, doneCount, closedCount] = await Promise.all([
    countJsonFilesInFolder(TASK_QUEUE_INBOX),
    countJsonFilesInFolder(TASK_QUEUE_IN_PROGRESS),
    countJsonFilesInFolder(TASK_QUEUE_DONE),
    countJsonFilesInFolder(TASK_QUEUE_CLOSED)
  ]);
  return inboxCount + inProgressCount + doneCount + closedCount;
}

async function getNewestFileModifiedAt(folderPaths = []) {
  let newestAt = 0;
  for (const folderPath of folderPaths) {
    const entries = await listVolumeFiles(folderPath).catch(() => []);
    for (const entry of entries) {
      if (entry.type !== "file" || !entry.path.endsWith(".json")) {
        continue;
      }
      try {
        const stats = await fs.stat(entry.path);
        newestAt = Math.max(newestAt, Number(stats.mtimeMs || 0));
      } catch {
        // skip missing or inaccessible files
      }
    }
  }
  return newestAt;
}

async function migrateLegacyTaskQueueIfNeeded() {
  const legacyFolders = {
    inbox: path.join(LEGACY_TASK_QUEUE_ROOT, "inbox"),
    in_progress: path.join(LEGACY_TASK_QUEUE_ROOT, "in_progress"),
    done: path.join(LEGACY_TASK_QUEUE_ROOT, "done"),
    closed: path.join(LEGACY_TASK_QUEUE_ROOT, "closed")
  };
  const canonicalFolders = {
    inbox: TASK_QUEUE_INBOX,
    in_progress: TASK_QUEUE_IN_PROGRESS,
    done: TASK_QUEUE_DONE,
    closed: TASK_QUEUE_CLOSED
  };
  const legacyCounts = await Promise.all(Object.values(legacyFolders).map((folder) => countJsonFilesInFolder(folder)));
  const legacyTotal = legacyCounts.reduce((sum, value) => sum + value, 0);
  if (!legacyTotal) {
    return { legacyFound: false, migrated: 0 };
  }
  const canonicalTotal = await countCanonicalQueueFiles();
  if (canonicalTotal > 0) {
    const newestLegacyAt = await getNewestFileModifiedAt(Object.values(legacyFolders));
    const retireEligible = newestLegacyAt > 0 && (Date.now() - newestLegacyAt) >= LEGACY_TASK_QUEUE_RETIRE_AFTER_MS;
    if (!retireEligible) {
      return {
        legacyFound: true,
        migrated: 0,
        retired: 0,
        skipped: true,
        canonicalTotal,
        legacyTotal,
        newestLegacyAt
      };
    }
    await fs.rm(LEGACY_TASK_QUEUE_ROOT, { recursive: true, force: true });
    return {
      legacyFound: true,
      migrated: 0,
      retired: legacyTotal,
      skipped: false,
      canonicalTotal,
      legacyTotal,
      newestLegacyAt
    };
  }
  let migrated = 0;
  for (const [status, legacyFolder] of Object.entries(legacyFolders)) {
    const entries = await listVolumeFiles(legacyFolder).catch(() => []);
    const files = entries.filter((entry) => entry.type === "file" && entry.path.endsWith(".json"));
    for (const entry of files) {
      const destination = path.join(canonicalFolders[status], path.basename(entry.path));
      if (await fileExists(destination)) {
        continue;
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(entry.path, destination).catch(async () => {
        const content = await readVolumeFile(entry.path);
        await writeVolumeText(destination, content);
        await fs.rm(entry.path, { force: true });
      });
      migrated += 1;
    }
  }
  await fs.rm(LEGACY_TASK_QUEUE_ROOT, { recursive: true, force: true }).catch(() => {});
  return { legacyFound: true, migrated, skipped: false, canonicalTotal, legacyTotal };
}

let taskTraceWriteChain = Promise.resolve();

function enqueueTaskTraceWrite(work) {
  taskTraceWriteChain = taskTraceWriteChain.then(work, work);
  return taskTraceWriteChain;
}

async function readTaskStateIndex() {
  try {
    const raw = await readVolumeFile(TASK_STATE_INDEX_PATH);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { tasks: {} };
  } catch {
    return { tasks: {} };
  }
}

function resolveQueueWorkspacePath(workspacePath = "") {
  const normalized = String(workspacePath || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized) {
    return "";
  }
  if (normalized === TASK_QUEUE_WORKSPACE_PATH) {
    return TASK_QUEUE_ROOT;
  }
  if (normalized.startsWith(`${TASK_QUEUE_WORKSPACE_PATH}/`)) {
    return path.join(TASK_QUEUE_ROOT, normalized.slice(TASK_QUEUE_WORKSPACE_PATH.length + 1));
  }
  return "";
}

function deriveTaskIndexPathDetails(filePath = "") {
  const resolved = path.resolve(String(filePath || ""));
  if (!resolved) {
    return { status: "", workspacePath: "" };
  }
  const fileName = path.basename(resolved);
  if (resolved.startsWith(path.resolve(TASK_QUEUE_INBOX))) {
    return { status: "queued", workspacePath: `${TASK_QUEUE_WORKSPACE_PATH}/inbox/${fileName}` };
  }
  if (resolved.startsWith(path.resolve(TASK_QUEUE_IN_PROGRESS))) {
    return { status: "in_progress", workspacePath: `${TASK_QUEUE_WORKSPACE_PATH}/in_progress/${fileName}` };
  }
  if (resolved.startsWith(path.resolve(TASK_QUEUE_CLOSED))) {
    return { status: "closed", workspacePath: `${TASK_QUEUE_WORKSPACE_PATH}/closed/${fileName}` };
  }
  if (resolved.startsWith(path.resolve(TASK_QUEUE_DONE))) {
    return { status: "done", workspacePath: `${TASK_QUEUE_WORKSPACE_PATH}/done/${fileName}` };
  }
  return { status: "", workspacePath: "" };
}

function extractTaskIdFromQueuePath(filePath = "") {
  const match = String(filePath || "").match(/(task-\d+)\.json$/i);
  return match ? match[1] : "";
}

async function recordTaskBreadcrumb(event = {}) {
  const taskId = String(event.taskId || "").trim();
  const timestamp = Number(event.at || Date.now());
  const normalizedEvent = {
    at: timestamp,
    eventType: String(event.eventType || "task.updated").trim() || "task.updated",
    taskId,
    fromStatus: String(event.fromStatus || "").trim(),
    toStatus: String(event.toStatus || "").trim(),
    fromPath: String(event.fromPath || "").trim(),
    toPath: String(event.toPath || "").trim(),
    fromWorkspacePath: String(event.fromWorkspacePath || "").trim(),
    toWorkspacePath: String(event.toWorkspacePath || "").trim(),
    reason: compactTaskText(String(event.reason || "").trim(), 260),
    sessionId: String(event.sessionId || "").trim(),
    brainId: String(event.brainId || "").trim()
  };
  await enqueueTaskTraceWrite(async () => {
    const index = await readTaskStateIndex();
    if (!index.tasks || typeof index.tasks !== "object") {
      index.tasks = {};
    }
    if (taskId) {
      const existing = index.tasks[taskId] && typeof index.tasks[taskId] === "object"
        ? index.tasks[taskId]
        : {};
      index.tasks[taskId] = {
        ...existing,
        taskId,
        currentStatus: normalizedEvent.toStatus || existing.currentStatus || normalizedEvent.fromStatus || "",
        currentFilePath: normalizedEvent.toPath || existing.currentFilePath || normalizedEvent.fromPath || "",
        currentWorkspacePath: normalizedEvent.toWorkspacePath || existing.currentWorkspacePath || normalizedEvent.fromWorkspacePath || "",
        previousStatus: normalizedEvent.fromStatus || existing.previousStatus || "",
        previousFilePath: normalizedEvent.fromPath || existing.previousFilePath || "",
        previousWorkspacePath: normalizedEvent.fromWorkspacePath || existing.previousWorkspacePath || "",
        lastEventType: normalizedEvent.eventType,
        lastReason: normalizedEvent.reason || existing.lastReason || "",
        sessionId: normalizedEvent.sessionId || existing.sessionId || "",
        brainId: normalizedEvent.brainId || existing.brainId || "",
        updatedAt: timestamp
      };
    }
    await writeVolumeText(TASK_STATE_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
    await appendVolumeText(TASK_EVENT_LOG_PATH, `${JSON.stringify(normalizedEvent)}\n`);
  });
}

async function readTaskRecordAtPath(filePath, options = {}) {
  const normalizedPath = path.resolve(String(filePath || "").trim());
  const maxRedirects = Math.max(0, Math.min(Number(options.maxRedirects || 4), 12));
  if (!normalizedPath) {
    return null;
  }
  let currentPath = normalizedPath;
  const visited = new Set();
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!currentPath || visited.has(currentPath)) {
      return null;
    }
    visited.add(currentPath);
    let parsed;
    try {
      parsed = JSON.parse(await readVolumeFile(currentPath));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (!parsed.redirectOnly) {
      return {
        ...parsed,
        filePath: currentPath
      };
    }
    const redirectWorkspacePath = String(parsed.redirectPath || "").trim();
    const redirectFilePath = resolveQueueWorkspacePath(redirectWorkspacePath) || taskPathForStatus(String(parsed.id || ""), String(parsed.status || ""));
    currentPath = path.resolve(redirectFilePath);
  }
  return null;
}

async function findIndexedTaskById(taskId) {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    return null;
  }
  const index = await readTaskStateIndex();
  const entry = index?.tasks && typeof index.tasks === "object"
    ? index.tasks[normalizedTaskId]
    : null;
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const candidatePaths = [
    String(entry.currentFilePath || "").trim(),
    resolveQueueWorkspacePath(String(entry.currentWorkspacePath || "").trim()),
    taskPathForStatus(normalizedTaskId, String(entry.currentStatus || "").trim())
  ].filter(Boolean);
  for (const candidatePath of candidatePaths) {
    const task = await readTaskRecordAtPath(candidatePath);
    if (task?.id === normalizedTaskId) {
      return {
        ...task,
        workspacePath: String(task.workspacePath || entry.currentWorkspacePath || "").trim()
      };
    }
  }
  return null;
}

function isCanonicalInProgressTaskRun(task, expectedTask = null, expectedPath = "") {
  if (!task || String(task.status || "").trim() !== "in_progress") {
    return false;
  }
  const normalizedExpectedPath = path.resolve(String(expectedPath || "").trim());
  if (normalizedExpectedPath && path.resolve(String(task.filePath || "").trim()) !== normalizedExpectedPath) {
    return false;
  }
  if (expectedTask && Number(task.startedAt || 0) !== Number(expectedTask.startedAt || 0)) {
    return false;
  }
  return true;
}

async function readTaskHistory(taskId, options = {}) {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    return [];
  }
  const limit = Math.max(1, Math.min(Number(options.limit || 40), 200));
  let raw;
  try {
    raw = await readVolumeFile(TASK_EVENT_LOG_PATH);
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
    .filter((entry) => entry && String(entry.taskId || "").trim() === normalizedTaskId)
    .sort((a, b) => Number(a.at || 0) - Number(b.at || 0))
    .slice(-limit);
}

async function writeVolumeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function clearDirectoryContents(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  await Promise.all(entries.map((entry) => (
    fs.rm(path.join(dirPath, entry.name), { recursive: true, force: true })
  )));
}

async function removeDateStampedMarkdownFiles(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/i.test(entry.name))
      .map((entry) => fs.rm(path.join(dirPath, entry.name), { force: true }))
  );
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

async function resetSandboxContainerWorkspaceToSimpleProjectState() {
  await ensureObserverToolContainer();
  await runObserverToolContainerNode(`
const fs = require("fs/promises");
const path = require("path");

async function removeDateStampedMarkdownFiles(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^\\d{4}-\\d{2}-\\d{2}\\.md$/i.test(entry.name))
      .map((entry) => fs.rm(path.posix.join(dirPath, entry.name), { force: true }))
  );
}

async function clearDirectoryContents(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map((entry) => fs.rm(path.posix.join(dirPath, entry.name), { recursive: true, force: true })));
}

async function main() {
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
  const root = String(payload.root || "").trim();
  const promptFilesRoot = path.posix.join(root, "prompt-files");
  const projectsRoot = path.posix.join(root, "projects");
  const memoryRoot = path.posix.join(root, "memory");
  const keepNames = new Set([
    ".clawhub",
    ".clawhub-home",
    ".clawhub-npm-cache",
    "browser-tool.mjs",
    "ollama-direct.mjs",
    "prompt-files",
    "projects",
    "skills",
    "memory"
  ]);

  const rootEntries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (keepNames.has(entry.name)) continue;
    await fs.rm(path.posix.join(root, entry.name), { recursive: true, force: true });
  }

  await removeDateStampedMarkdownFiles(memoryRoot);
  await removeDateStampedMarkdownFiles(path.posix.join(memoryRoot, "briefings"));
  await removeDateStampedMarkdownFiles(path.posix.join(memoryRoot, "questions"));
  await removeDateStampedMarkdownFiles(path.posix.join(memoryRoot, "personal"));
  await fs.rm(path.posix.join(memoryRoot, "projects"), { recursive: true, force: true });
  await fs.mkdir(path.posix.join(memoryRoot, "projects"), { recursive: true });
  await fs.mkdir(promptFilesRoot, { recursive: true });
  await fs.mkdir(projectsRoot, { recursive: true });
  await clearDirectoryContents(projectsRoot);
  await fs.writeFile(path.posix.join(promptFilesRoot, "TODAY.md"), String(payload.todayText || ""), "utf8");
  await fs.writeFile(path.posix.join(promptFilesRoot, "MEMORY.md"), String(payload.memoryText || ""), "utf8");

  process.stdout.write(JSON.stringify({
    reset: true,
    projectsRoot
  }));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, {
    root: OBSERVER_CONTAINER_WORKSPACE_ROOT,
    todayText: SIMPLE_STATE_TODAY_TEXT,
    memoryText: "# MEMORY.md\\n\\n- simple-check-project in observer-input\\n"
  }, { timeoutMs: 60000 });
}

async function resetToSimpleProjectState() {
  await Promise.all([
    clearDirectoryContents(OBSERVER_INPUT_HOST_ROOT),
    clearDirectoryContents(OBSERVER_OUTPUT_HOST_ROOT)
  ]);

  await Promise.all([
    fs.mkdir(OBSERVER_INPUT_HOST_ROOT, { recursive: true }),
    ensureObserverOutputDir()
  ]);

  const projectDir = path.join(OBSERVER_INPUT_HOST_ROOT, SIMPLE_STATE_PROJECT_NAME);
  const directivePath = path.join(projectDir, SIMPLE_STATE_DIRECTIVE_FILE_NAME);
  await fs.rm(projectDir, { recursive: true, force: true });
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(directivePath, SIMPLE_STATE_DIRECTIVE_TEXT, "utf8");
  await resetSandboxContainerWorkspaceToSimpleProjectState();

  return {
    message: "Accessible state reset complete. Nova now has one simple checkbox project.",
    projectName: SIMPLE_STATE_PROJECT_NAME,
    directiveFile: `observer-input/${SIMPLE_STATE_PROJECT_NAME}/${SIMPLE_STATE_DIRECTIVE_FILE_NAME}`,
    summaryLines: [
      "Reset complete.",
      "Cleared observer-input and observer-output.",
      "Cleared the persistent sandbox workspace projects area without pre-importing any projects.",
      `Seeded observer-input/${SIMPLE_STATE_PROJECT_NAME}/${SIMPLE_STATE_DIRECTIVE_FILE_NAME}.`,
      "The sandbox projects list will stay empty until the normal import flow runs.",
      "Directive: Check this box [ ]"
    ]
  };
}

async function appendVolumeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, content, "utf8");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function migrateLegacyPromptWorkspaceIfNeeded() {
  if (path.resolve(LEGACY_PROMPT_WORKSPACE_ROOT) === path.resolve(PROMPT_WORKSPACE_ROOT)) {
    return;
  }
  let legacyStats = null;
  try {
    legacyStats = await fs.stat(LEGACY_PROMPT_WORKSPACE_ROOT);
  } catch {
    legacyStats = null;
  }
  if (!legacyStats?.isDirectory()) {
    return;
  }
  await fs.mkdir(AGENT_WORKSPACES_ROOT, { recursive: true });
  if (!(await fileExists(PROMPT_WORKSPACE_ROOT))) {
    await fs.rename(LEGACY_PROMPT_WORKSPACE_ROOT, PROMPT_WORKSPACE_ROOT);
    return;
  }
  await fs.cp(LEGACY_PROMPT_WORKSPACE_ROOT, PROMPT_WORKSPACE_ROOT, {
    recursive: true,
    force: false,
    errorOnExist: false
  });
  await fs.rm(LEGACY_PROMPT_WORKSPACE_ROOT, { recursive: true, force: true });
}

async function ensureVolumeFile(filePath, content) {
  if (await fileExists(filePath)) {
    return;
  }
  await writeVolumeText(filePath, content);
}

function createCalendarEventId() {
  return `cal-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function parseCalendarTimestamp(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const text = String(value || "").trim();
  if (!text) {
    return fallback;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCalendarRepeatRule(repeat = {}, { allowNone = true } = {}) {
  const frequency = String(repeat?.frequency || "none").trim().toLowerCase();
  const normalizedFrequency = ["none", "daily", "weekly", "monthly", "yearly"].includes(frequency)
    ? frequency
    : "none";
  const interval = Math.max(1, Math.min(Number(repeat?.interval || 1) || 1, 365));
  if (normalizedFrequency === "none" && !allowNone) {
    return { frequency: "daily", interval };
  }
  return {
    frequency: normalizedFrequency,
    interval
  };
}

function advanceCalendarOccurrence(startAt, repeat, occurrenceAt) {
  const normalizedRepeat = normalizeCalendarRepeatRule(repeat);
  if (normalizedRepeat.frequency === "none") {
    return 0;
  }
  const base = new Date(Number(occurrenceAt || startAt || 0));
  if (!Number.isFinite(base.getTime()) || base.getTime() <= 0) {
    return 0;
  }
  const next = new Date(base.getTime());
  if (normalizedRepeat.frequency === "daily") {
    next.setDate(next.getDate() + normalizedRepeat.interval);
  } else if (normalizedRepeat.frequency === "weekly") {
    next.setDate(next.getDate() + (normalizedRepeat.interval * 7));
  } else if (normalizedRepeat.frequency === "monthly") {
    next.setMonth(next.getMonth() + normalizedRepeat.interval);
  } else if (normalizedRepeat.frequency === "yearly") {
    next.setFullYear(next.getFullYear() + normalizedRepeat.interval);
  }
  return next.getTime();
}

function computeCalendarNextOccurrenceAt(event, referenceNow = Date.now()) {
  const startAt = Number(event?.startAt || 0);
  const repeat = normalizeCalendarRepeatRule(event?.repeat);
  if (!startAt) {
    return 0;
  }
  if (repeat.frequency === "none") {
    return startAt;
  }
  let occurrenceAt = startAt;
  const floor = Math.max(0, Number(referenceNow || 0));
  for (let index = 0; index < 2000; index += 1) {
    if (occurrenceAt >= floor) {
      return occurrenceAt;
    }
    const nextOccurrenceAt = advanceCalendarOccurrence(startAt, repeat, occurrenceAt);
    if (!nextOccurrenceAt || nextOccurrenceAt <= occurrenceAt) {
      break;
    }
    occurrenceAt = nextOccurrenceAt;
  }
  return occurrenceAt;
}

function normalizeCalendarActionConfig(action = {}, defaults = {}) {
  const mountIds = Array.isArray(action?.mountIds)
    ? action.mountIds.map((entry) => String(entry || "").trim()).filter(Boolean)
    : Array.isArray(defaults.mountIds)
      ? defaults.mountIds
      : [];
  return {
    enabled: action?.enabled === true,
    message: compactTaskText(String(action?.message || "").trim(), 4000),
    requestedBrainId: String(action?.requestedBrainId || defaults.requestedBrainId || "worker").trim() || "worker",
    internetEnabled: action?.internetEnabled == null ? defaults.internetEnabled !== false : action.internetEnabled !== false,
    forceToolUse: action?.forceToolUse == null ? defaults.forceToolUse !== false : action.forceToolUse === true,
    mountIds
  };
}

function materializeCalendarEvent(event = {}, referenceNow = Date.now()) {
  const startAt = parseCalendarTimestamp(event.startAt, 0);
  const endAt = parseCalendarTimestamp(event.endAt, 0);
  const repeat = normalizeCalendarRepeatRule(event.repeat);
  const status = ["active", "completed", "cancelled"].includes(String(event.status || "").trim().toLowerCase())
    ? String(event.status || "").trim().toLowerCase()
    : "active";
  const action = normalizeCalendarActionConfig(event.action, {
    requestedBrainId: "worker",
    internetEnabled: true,
    forceToolUse: true,
    mountIds: observerConfig.defaults.mountIds
  });
  const nextOccurrenceAt = status === "active"
    ? Number(event.nextOccurrenceAt || computeCalendarNextOccurrenceAt({ startAt, repeat }, referenceNow) || 0)
    : 0;
  return {
    id: String(event.id || "").trim() || createCalendarEventId(),
    title: compactTaskText(String(event.title || "").trim(), 160) || "Untitled event",
    description: compactTaskText(String(event.description || "").trim(), 4000),
    location: compactTaskText(String(event.location || "").trim(), 240),
    type: String(event.type || "personal").trim().toLowerCase() === "nova_action" ? "nova_action" : "personal",
    status,
    allDay: event.allDay === true,
    startAt,
    endAt: endAt > startAt ? endAt : 0,
    repeat,
    action,
    createdAt: Number(event.createdAt || referenceNow || Date.now()),
    updatedAt: Number(event.updatedAt || referenceNow || Date.now()),
    completedAt: Number(event.completedAt || 0) || undefined,
    cancelledAt: Number(event.cancelledAt || 0) || undefined,
    nextOccurrenceAt,
    lastTriggeredAt: Number(event.lastTriggeredAt || 0) || undefined,
    lastQueuedOccurrenceAt: Number(event.lastQueuedOccurrenceAt || 0) || undefined,
    lastActionTaskId: String(event.lastActionTaskId || "").trim() || undefined
  };
}

async function readCalendarEvents() {
  await ensureVolumeFile(CALENDAR_EVENTS_PATH, "[]\n");
  let raw = "[]";
  try {
    raw = await readVolumeFile(CALENDAR_EVENTS_PATH);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  let parsed = [];
  try {
    parsed = JSON.parse(String(raw || "[]"));
  } catch {
    parsed = [];
  }
  return (Array.isArray(parsed) ? parsed : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => materializeCalendarEvent(entry));
}

async function writeCalendarEvents(events = []) {
  const normalized = (Array.isArray(events) ? events : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => materializeCalendarEvent(entry));
  await writeVolumeText(CALENDAR_EVENTS_PATH, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

async function listCalendarEvents() {
  const events = await readCalendarEvents();
  return events.sort((left, right) => {
    const leftTime = Number(left.startAt || left.nextOccurrenceAt || left.createdAt || 0);
    const rightTime = Number(right.startAt || right.nextOccurrenceAt || right.createdAt || 0);
    return leftTime - rightTime;
  });
}

async function saveCalendarEvent(eventInput = {}, options = {}) {
  const events = await readCalendarEvents();
  const now = Date.now();
  const existingIndex = events.findIndex((entry) => String(entry.id || "") === String(eventInput.id || ""));
  const existing = existingIndex >= 0 ? events[existingIndex] : null;
  const nextStatus = options.keepStatus
    ? String(existing?.status || eventInput.status || "active").trim().toLowerCase()
    : String(eventInput.status || existing?.status || "active").trim().toLowerCase();
  const merged = materializeCalendarEvent({
    ...(existing || {}),
    ...eventInput,
    status: nextStatus,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    nextOccurrenceAt: options.recomputeSchedule === false
      ? Number(eventInput.nextOccurrenceAt || existing?.nextOccurrenceAt || 0)
      : undefined
  }, now);
  if (options.recomputeSchedule !== false) {
    merged.nextOccurrenceAt = merged.status === "active"
      ? computeCalendarNextOccurrenceAt(merged, now)
      : 0;
  }
  if (existingIndex >= 0) {
    events[existingIndex] = merged;
  } else {
    events.push(merged);
  }
  await writeCalendarEvents(events);
  return merged;
}

async function removeCalendarEvent(eventId = "") {
  const normalizedId = String(eventId || "").trim();
  if (!normalizedId) {
    return false;
  }
  const events = await readCalendarEvents();
  const filtered = events.filter((entry) => String(entry.id || "") !== normalizedId);
  if (filtered.length === events.length) {
    return false;
  }
  await writeCalendarEvents(filtered);
  return true;
}

function normalizeTodoItem(record = {}) {
  const now = Date.now();
  const status = String(record.status || "").trim().toLowerCase() === "completed" ? "completed" : "open";
  const text = compactTaskText(String(record.text || "").trim(), 400);
  return {
    id: String(record.id || `todo-${now}`).trim() || `todo-${now}`,
    text,
    status,
    createdAt: Number(record.createdAt || now) || now,
    updatedAt: Number(record.updatedAt || record.createdAt || now) || now,
    completedAt: status === "completed" ? Number(record.completedAt || record.updatedAt || now) || now : 0,
    createdBy: String(record.createdBy || "").trim().toLowerCase() === "nova" ? "nova" : "user",
    source: compactTaskText(String(record.source || "manual").trim(), 80),
    linkedTaskId: String(record.linkedTaskId || "").trim(),
    linkedTaskCodename: String(record.linkedTaskCodename || "").trim(),
    linkedQuestion: compactTaskText(String(record.linkedQuestion || "").trim(), 1000),
    completionNote: compactTaskText(String(record.completionNote || "").trim(), 1000),
    resumedTaskId: String(record.resumedTaskId || "").trim()
  };
}

function normalizeTodoState(state = {}) {
  const items = Array.isArray(state?.items)
    ? state.items.map((entry) => normalizeTodoItem(entry)).filter((entry) => entry.text)
    : [];
  const meta = state?.meta && typeof state.meta === "object" ? state.meta : {};
  return {
    version: 1,
    items,
    meta: {
      lastReminderAt: Number(meta.lastReminderAt || 0) || 0
    }
  };
}

async function readTodoState() {
  try {
    const raw = await fs.readFile(TODO_STATE_PATH, "utf8");
    return normalizeTodoState(JSON.parse(raw));
  } catch {
    return normalizeTodoState();
  }
}

async function writeTodoState(state = {}) {
  const normalized = normalizeTodoState(state);
  await fs.mkdir(path.dirname(TODO_STATE_PATH), { recursive: true });
  await fs.writeFile(TODO_STATE_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function sortTodoItems(items = []) {
  return [...items].sort((left, right) => {
    const leftOpen = String(left?.status || "") !== "completed";
    const rightOpen = String(right?.status || "") !== "completed";
    if (leftOpen !== rightOpen) {
      return Number(rightOpen) - Number(leftOpen);
    }
    const leftTs = Number(
      leftOpen
        ? (left?.updatedAt || left?.createdAt || 0)
        : (left?.completedAt || left?.updatedAt || left?.createdAt || 0)
    );
    const rightTs = Number(
      rightOpen
        ? (right?.updatedAt || right?.createdAt || 0)
        : (right?.completedAt || right?.updatedAt || right?.createdAt || 0)
    );
    return rightTs - leftTs;
  });
}

async function listTodoItems() {
  const state = await readTodoState();
  const sorted = sortTodoItems(state.items);
  const open = sorted.filter((entry) => entry.status === "open");
  const completed = sorted.filter((entry) => entry.status === "completed");
  return {
    items: sorted,
    open,
    completed,
    meta: state.meta,
    summary: {
      openCount: open.length,
      completedCount: completed.length
    }
  };
}

function buildTodoReminderText(items = []) {
  const open = (Array.isArray(items) ? items : []).filter((entry) => String(entry?.status || "") === "open");
  if (!open.length) {
    return "Your personal to do list is clear.";
  }
  const preview = open.slice(0, 3).map((entry) => entry.text).filter(Boolean);
  return `You have ${open.length} open to do item${open.length === 1 ? "" : "s"}. ${preview.length ? `Top items: ${preview.join("; ")}.` : ""}`.trim();
}

async function buildTodoSummaryLines({ limit = 8 } = {}) {
  const { open, completed } = await listTodoItems();
  if (!open.length && !completed.length) {
    return ["You do not have any personal to do items yet."];
  }
  const lines = [
    open.length
      ? `You have ${open.length} open to do item${open.length === 1 ? "" : "s"}${completed.length ? ` and ${completed.length} completed.` : "."}`
      : `You have no open to do items${completed.length ? ` and ${completed.length} completed item${completed.length === 1 ? "" : "s"}.` : "."}`
  ];
  for (const item of open.slice(0, Math.max(1, Number(limit || 8)))) {
    lines.push(`- ${item.text}`);
  }
  if (open.length > limit) {
    lines.push(`- ${open.length - limit} more open item${open.length - limit === 1 ? "" : "s"}.`);
  }
  return lines;
}

async function addTodoItem({
  text,
  createdBy = "user",
  source = "manual",
  linkedTaskId = "",
  linkedTaskCodename = "",
  linkedQuestion = "",
  completionNote = ""
} = {}) {
  const normalizedText = compactTaskText(String(text || "").trim(), 400);
  if (!normalizedText) {
    throw new Error("todo text is required");
  }
  const state = await readTodoState();
  const now = Date.now();
  const duplicate = state.items.find((entry) =>
    entry.status === "open"
    && String(entry.text || "").trim().toLowerCase() === normalizedText.toLowerCase()
    && String(entry.linkedTaskId || "").trim() === String(linkedTaskId || "").trim()
  );
  if (duplicate) {
    return duplicate;
  }
  const item = normalizeTodoItem({
    id: `todo-${now}`,
    text: normalizedText,
    status: "open",
    createdAt: now,
    updatedAt: now,
    createdBy,
    source,
    linkedTaskId,
    linkedTaskCodename,
    linkedQuestion,
    completionNote
  });
  state.items.push(item);
  state.meta.lastReminderAt = Number(state.meta.lastReminderAt || 0) || 0;
  await writeTodoState(state);
  broadcastObserverEvent({
    type: "todo.created",
    todo: item
  });
  return item;
}

async function setTodoItemStatus(todoId = "", status = "completed", { completedBy = "user", sessionId = "Main" } = {}) {
  const normalizedTodoId = String(todoId || "").trim();
  if (!normalizedTodoId) {
    throw new Error("todoId is required");
  }
  const targetStatus = String(status || "").trim().toLowerCase() === "completed" ? "completed" : "open";
  const state = await readTodoState();
  const index = state.items.findIndex((entry) => String(entry.id || "") === normalizedTodoId);
  if (index < 0) {
    throw new Error("todo item not found");
  }
  const current = normalizeTodoItem(state.items[index]);
  const now = Date.now();
  let resumedTask = null;
  const next = {
    ...current,
    status: targetStatus,
    updatedAt: now,
    completedAt: targetStatus === "completed" ? now : 0
  };
  if (
    targetStatus === "completed"
    && current.linkedTaskId
    && !current.resumedTaskId
  ) {
    try {
      resumedTask = await answerWaitingTask(
        current.linkedTaskId,
        current.completionNote || `User completed todo item: ${current.text}`,
        sessionId
      );
      next.resumedTaskId = String(resumedTask?.id || current.linkedTaskId).trim();
      next.source = compactTaskText(`${current.source || "manual"} | completed by ${completedBy}`, 80);
    } catch (error) {
      next.source = compactTaskText(`${current.source || "manual"} | resume failed: ${error.message}`, 80);
    }
  }
  state.items[index] = normalizeTodoItem(next);
  await writeTodoState(state);
  broadcastObserverEvent({
    type: "todo.updated",
    todo: state.items[index],
    resumedTask
  });
  return {
    todo: state.items[index],
    resumedTask
  };
}

async function removeTodoItem(todoId = "", { removedBy = "user", sessionId = "Main" } = {}) {
  const normalizedTodoId = String(todoId || "").trim();
  if (!normalizedTodoId) {
    throw new Error("todoId is required");
  }
  const state = await readTodoState();
  const index = state.items.findIndex((entry) => String(entry.id || "") === normalizedTodoId);
  if (index < 0) {
    throw new Error("todo item not found");
  }
  const [removed] = state.items.splice(index, 1);
  let closedTask = null;
  if (removed?.linkedTaskId && removed?.status === "open") {
    try {
      const linkedTask = await findTaskById(removed.linkedTaskId);
      if (linkedTask && String(linkedTask.status || "").trim() === "waiting_for_user") {
        closedTask = await closeTaskRecord(
          linkedTask,
          `Linked todo removed by ${removedBy} from session ${sessionId}.`
        );
      }
    } catch {
      closedTask = null;
    }
  }
  await writeTodoState(state);
  broadcastObserverEvent({
    type: "todo.removed",
    todo: removed,
    closedTask
  });
  return {
    todo: removed,
    closedTask
  };
}

function normalizeTodoReference(value = "") {
  return String(value || "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.?!]+$/g, "")
    .trim();
}

async function findTodoItemByReference(reference = "") {
  const normalizedReference = normalizeTodoReference(reference).toLowerCase();
  if (!normalizedReference) {
    return null;
  }
  const { items } = await listTodoItems();
  return items.find((entry) => String(entry.id || "").toLowerCase() === normalizedReference)
    || items.find((entry) => String(entry.text || "").trim().toLowerCase() === normalizedReference)
    || items.find((entry) => String(entry.text || "").trim().toLowerCase().includes(normalizedReference))
    || null;
}

async function maybeEmitTodoReminder({ force = false } = {}) {
  const state = await readTodoState();
  const open = state.items.filter((entry) => entry.status === "open");
  if (!open.length) {
    return null;
  }
  const now = Date.now();
  if (!force && now - Number(state.meta.lastReminderAt || 0) < TODO_REMINDER_INTERVAL_MS) {
    return null;
  }
  state.meta.lastReminderAt = now;
  await writeTodoState(state);
  const text = buildTodoReminderText(open);
  broadcastObserverEvent({
    type: "todo.reminder",
    text,
    summary: {
      openCount: open.length
    },
    todos: open.slice(0, 3)
  });
  return {
    text,
    open
  };
}

function buildCalendarActionTaskMessage(event, occurrenceAt) {
  const when = buildCalendarOccurrenceLabel(occurrenceAt);
  const title = String(event?.title || "").trim() || "Calendar event";
  const actionMessage = compactTaskText(String(event?.action?.message || "").trim(), 4000);
  if (actionMessage) {
    return [
      `Calendar event action: ${title}.`,
      `Scheduled time: ${when}.`,
      actionMessage
    ].join("\n");
  }
  return `Calendar event action: ${title} at ${when}.`;
}

async function hasCalendarOccurrenceTask(eventId, occurrenceAt) {
  const normalizedEventId = String(eventId || "").trim();
  const targetOccurrenceAt = Number(occurrenceAt || 0);
  if (!normalizedEventId || !targetOccurrenceAt) {
    return false;
  }
  const { queued, waiting, inProgress, done, failed } = await listAllTasks();
  return [...queued, ...waiting, ...inProgress, ...done, ...failed].some((task) =>
    String(task.calendarEventId || "").trim() === normalizedEventId
    && Number(task.calendarOccurrenceAt || 0) === targetOccurrenceAt
  );
}

let calendarDueEventsInFlight = false;

async function runCalendarDueEvents() {
  if (calendarDueEventsInFlight) {
    return [];
  }
  calendarDueEventsInFlight = true;
  try {
    const events = await readCalendarEvents();
    if (!events.length) {
      return [];
    }
    const now = Date.now();
    const updatedEvents = [...events];
    const queuedTasks = [];
    for (let index = 0; index < updatedEvents.length; index += 1) {
      const event = updatedEvents[index];
      if (
        !event
        || event.status !== "active"
        || event.type !== "nova_action"
        || event.action?.enabled !== true
        || !Number(event.nextOccurrenceAt || 0)
        || Number(event.nextOccurrenceAt || 0) > now
      ) {
        continue;
      }
      const occurrenceAt = Number(event.nextOccurrenceAt || 0);
      if (await hasCalendarOccurrenceTask(event.id, occurrenceAt)) {
        continue;
      }
      const task = await createQueuedTask({
        message: buildCalendarActionTaskMessage(event, occurrenceAt),
        sessionId: "calendar",
        requestedBrainId: event.action?.requestedBrainId || "worker",
        intakeBrainId: "bitnet",
        internetEnabled: event.action?.internetEnabled !== false,
        selectedMountIds: Array.isArray(event.action?.mountIds) ? event.action.mountIds : observerConfig.defaults.mountIds,
        forceToolUse: event.action?.forceToolUse === true,
        notes: `Queued from calendar event "${event.title}" for ${buildCalendarOccurrenceLabel(occurrenceAt)}.`,
        taskMeta: {
          internalJobType: "calendar_event_action",
          calendarEventId: event.id,
          calendarOccurrenceAt: occurrenceAt,
          calendarEventTitle: event.title
        }
      });
      queuedTasks.push(task);
      const nextOccurrenceAt = event.repeat?.frequency === "none"
        ? 0
        : computeCalendarNextOccurrenceAt({
            startAt: event.startAt,
            repeat: event.repeat
          }, now + 1000);
      updatedEvents[index] = materializeCalendarEvent({
        ...event,
        updatedAt: now,
        lastTriggeredAt: now,
        lastQueuedOccurrenceAt: occurrenceAt,
        lastActionTaskId: task.id,
        status: event.repeat?.frequency === "none" ? "completed" : event.status,
        completedAt: event.repeat?.frequency === "none" ? now : undefined,
        nextOccurrenceAt
      }, now);
    }
    if (queuedTasks.length) {
      await writeCalendarEvents(updatedEvents);
    }
    return queuedTasks;
  } finally {
    calendarDueEventsInFlight = false;
  }
}

function buildCalendarOccurrenceLabel(timestamp) {
  if (!Number(timestamp || 0)) {
    return "unknown time";
  }
  return new Date(Number(timestamp)).toLocaleString();
}

function formatCalendarDayKey(timestamp) {
  if (!Number(timestamp || 0)) {
    return "";
  }
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Sydney",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(Number(timestamp)));
  } catch {
    return new Date(Number(timestamp)).toISOString().slice(0, 10);
  }
}

function summarizeCalendarEvent(event = {}) {
  const when = event.allDay
    ? formatDateForUser(event.startAt)
    : formatDateTimeForUser(event.startAt);
  const repeatText = event.repeat?.frequency && event.repeat.frequency !== "none"
    ? `, repeats ${event.repeat.frequency}${Number(event.repeat.interval || 1) > 1 ? ` x${Number(event.repeat.interval || 1)}` : ""}`
    : "";
  const typeText = event.type === "nova_action" || event.action?.enabled ? "nova action" : "personal";
  return `${event.title || "Untitled event"} (${typeText}) on ${when}${repeatText}${event.location ? ` at ${event.location}` : ""}`;
}

function matchesCalendarEventReference(event = {}, {
  eventId = "",
  titleContains = "",
  date = "",
  status = ""
} = {}) {
  if (eventId && String(event.id || "").trim() !== String(eventId || "").trim()) {
    return false;
  }
  if (titleContains) {
    const haystack = `${String(event.title || "")} ${String(event.description || "")}`.toLowerCase();
    if (!haystack.includes(String(titleContains || "").trim().toLowerCase())) {
      return false;
    }
  }
  if (date) {
    const normalizedDate = String(date || "").trim().slice(0, 10);
    if (formatCalendarDayKey(event.startAt) !== normalizedDate) {
      return false;
    }
  }
  if (status && String(event.status || "").trim().toLowerCase() !== String(status || "").trim().toLowerCase()) {
    return false;
  }
  return true;
}

async function findCalendarEventsByReference(reference = {}) {
  const events = await readCalendarEvents();
  return events.filter((event) => matchesCalendarEventReference(event, reference));
}

function normalizeCalendarToolEventInput(args = {}) {
  const repeatFrequency = String(args.repeatFrequency || args.repeat?.frequency || "none").trim().toLowerCase();
  const repeatInterval = Math.max(1, Math.min(Number(args.repeatInterval || args.repeat?.interval || 1) || 1, 365));
  return {
    title: compactTaskText(String(args.title || "").trim(), 160),
    description: compactTaskText(String(args.description || "").trim(), 4000),
    location: compactTaskText(String(args.location || "").trim(), 240),
    type: String(args.type || "").trim().toLowerCase() === "nova_action" ? "nova_action" : "personal",
    allDay: args.allDay === true,
    startAt: parseCalendarTimestamp(args.startAt, 0),
    endAt: parseCalendarTimestamp(args.endAt, 0),
    repeat: {
      frequency: ["none", "daily", "weekly", "monthly", "yearly"].includes(repeatFrequency) ? repeatFrequency : "none",
      interval: repeatInterval
    },
    action: {
      enabled: args.actionEnabled === true || String(args.type || "").trim().toLowerCase() === "nova_action",
      message: compactTaskText(String(args.actionMessage || args.action?.message || "").trim(), 4000),
      requestedBrainId: String(args.requestedBrainId || args.action?.requestedBrainId || "worker").trim() || "worker",
      internetEnabled: args.internetEnabled !== false,
      forceToolUse: args.forceToolUse === true,
      mountIds: Array.isArray(args.mountIds) ? args.mountIds : observerConfig.defaults.mountIds
    }
  };
}

function buildCalendarToolEventPatch(args = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(args, "title")) {
    patch.title = compactTaskText(String(args.title || "").trim(), 160);
  }
  if (Object.prototype.hasOwnProperty.call(args, "description")) {
    patch.description = compactTaskText(String(args.description || "").trim(), 4000);
  }
  if (Object.prototype.hasOwnProperty.call(args, "location")) {
    patch.location = compactTaskText(String(args.location || "").trim(), 240);
  }
  if (Object.prototype.hasOwnProperty.call(args, "type")) {
    patch.type = String(args.type || "").trim().toLowerCase() === "nova_action" ? "nova_action" : "personal";
  }
  if (Object.prototype.hasOwnProperty.call(args, "allDay")) {
    patch.allDay = args.allDay === true;
  }
  if (Object.prototype.hasOwnProperty.call(args, "startAt")) {
    patch.startAt = parseCalendarTimestamp(args.startAt, 0);
  }
  if (Object.prototype.hasOwnProperty.call(args, "endAt")) {
    patch.endAt = parseCalendarTimestamp(args.endAt, 0);
  }
  if (
    Object.prototype.hasOwnProperty.call(args, "repeatFrequency")
    || Object.prototype.hasOwnProperty.call(args, "repeatInterval")
    || (args.repeat && typeof args.repeat === "object")
  ) {
    patch.repeat = {
      frequency: String(args.repeatFrequency || args.repeat?.frequency || "none").trim().toLowerCase(),
      interval: Math.max(1, Math.min(Number(args.repeatInterval || args.repeat?.interval || 1) || 1, 365))
    };
  }
  if (
    Object.prototype.hasOwnProperty.call(args, "actionEnabled")
    || Object.prototype.hasOwnProperty.call(args, "actionMessage")
    || Object.prototype.hasOwnProperty.call(args, "requestedBrainId")
    || Object.prototype.hasOwnProperty.call(args, "internetEnabled")
    || Object.prototype.hasOwnProperty.call(args, "forceToolUse")
    || Object.prototype.hasOwnProperty.call(args, "mountIds")
    || (args.action && typeof args.action === "object")
  ) {
    patch.action = {
      enabled: args.actionEnabled === true || String(args.type || "").trim().toLowerCase() === "nova_action",
      message: compactTaskText(String(args.actionMessage || args.action?.message || "").trim(), 4000),
      requestedBrainId: String(args.requestedBrainId || args.action?.requestedBrainId || "worker").trim() || "worker",
      internetEnabled: args.internetEnabled !== false,
      forceToolUse: args.forceToolUse === true,
      mountIds: Array.isArray(args.mountIds) ? args.mountIds : observerConfig.defaults.mountIds
    };
  }
  return patch;
}

function getCalendarRangeForSummary(scope = "upcoming") {
  const now = Date.now();
  const todayStart = startOfTodayMs(now);
  const tomorrowStart = todayStart + (24 * 60 * 60 * 1000);
  const weekEnd = todayStart + (7 * 24 * 60 * 60 * 1000);
  if (scope === "today") {
    return { startAt: todayStart, endAt: tomorrowStart - 1, label: "today" };
  }
  if (scope === "tomorrow") {
    return { startAt: tomorrowStart, endAt: tomorrowStart + (24 * 60 * 60 * 1000) - 1, label: "tomorrow" };
  }
  if (scope === "week") {
    return { startAt: todayStart, endAt: weekEnd - 1, label: "this week" };
  }
  return { startAt: now, endAt: weekEnd - 1, label: "upcoming" };
}

function buildCalendarOccurrencesForRangeServer(events = [], rangeStartAt = 0, rangeEndAt = 0) {
  const occurrences = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.status === "cancelled") {
      continue;
    }
    const startAt = Number(event.startAt || 0);
    if (!startAt) {
      continue;
    }
    const repeat = normalizeCalendarRepeatRule(event.repeat);
    let occurrenceAt = startAt;
    let guard = 0;
    while (occurrenceAt && occurrenceAt <= rangeEndAt && guard < 400) {
      if (occurrenceAt >= rangeStartAt) {
        occurrences.push({
          eventId: event.id,
          at: occurrenceAt,
          dateKey: formatCalendarDayKey(occurrenceAt),
          event
        });
      }
      if (repeat.frequency === "none") {
        break;
      }
      occurrenceAt = advanceCalendarOccurrence(startAt, repeat, occurrenceAt);
      guard += 1;
    }
  }
  return occurrences.sort((left, right) => left.at - right.at);
}

async function buildCalendarSummary({ scope = "upcoming", limit = 10 } = {}) {
  const range = getCalendarRangeForSummary(scope);
  const occurrences = buildCalendarOccurrencesForRangeServer(await readCalendarEvents(), range.startAt, range.endAt)
    .filter((entry) => String(entry.event?.status || "").trim().toLowerCase() !== "cancelled")
    .slice(0, Math.max(1, Math.min(Number(limit || 10) || 10, 30)));
  if (!occurrences.length) {
    return [`No events ${range.label}.`];
  }
  return [
    `You have ${occurrences.length} calendar event${occurrences.length === 1 ? "" : "s"} ${range.label}.`,
    ...occurrences.map((entry) => summarizeCalendarEvent(entry.event))
  ];
}

const looksLikeLowSignalPlannerTaskMessage = createLooksLikeLowSignalPlannerTaskMessage({
  normalizeSummaryComparisonText
});

async function ensureSkillStagingDirs() {
  await fs.mkdir(SKILL_STAGING_SKILLS_DIR, { recursive: true });
}

const {
  approveInstalledSkill,
  buildInstalledSkillsGuidanceNote,
  containerSkillExists,
  inspectSkillLibrarySkill,
  installSkillIntoWorkspace,
  listInstalledSkills,
  revokeInstalledSkillApproval,
  searchSkillLibrary
} = createSkillLibraryService({
  ensureObserverToolContainer,
  runObserverToolContainerNode,
  readVolumeFile,
  writeVolumeText,
  readContainerFile,
  listContainerFiles,
  observerContainerWorkspaceRoot: OBSERVER_CONTAINER_WORKSPACE_ROOT,
  observerContainerSkillsRoot: OBSERVER_CONTAINER_SKILLS_ROOT,
  skillRegistryPath: SKILL_REGISTRY_PATH
});
const {
  buildToolConfigPayload,
  ensureAutonomousToolApproved,
  recordSkillInstallationRequest,
  recordToolAdditionRequest,
  updateToolConfig
} = createToolConfigService({
  buildToolCatalog,
  compactTaskText,
  normalizeToolName,
  sanitizeSkillSlug,
  readVolumeFile,
  writeVolumeText,
  toolRegistryPath: TOOL_REGISTRY_PATH,
  capabilityRequestsPath: CAPABILITY_REQUESTS_PATH,
  listInstalledSkills,
  containerSkillExists,
  approveInstalledSkill,
  revokeInstalledSkillApproval
});
const runInternalRegressionCase = createInternalRegressionRunner({
  createSkillLibraryService,
  createToolConfigService,
  determineMailCommandAction,
  buildRegressionFailure,
  classifyFailureText,
  extractJsonObject,
  normalizeWorkerDecisionEnvelope,
  parseToolCallArgs,
  buildRetryTaskMeta,
  normalizeProjectConfigInput,
  buildCapabilityMismatchRetryMessage,
  buildProjectCycleCompletionPolicy,
  isCapabilityMismatchFailure,
  chooseAutomaticRetryBrainId,
  extractTaskDirectiveValue,
  evaluateProjectCycleCompletionState,
  objectiveRequiresConcreteImprovement,
  buildToolLoopStepDiagnostics,
  buildToolLoopStopMessage,
  ensureClawhubCommandSucceeded,
  searchSkillLibrary,
  inspectSkillLibrarySkill,
  installSkillIntoWorkspace,
  listInstalledSkills,
  buildProjectPipelineCollection,
  chooseProjectCycleRecoveryBrain,
  chooseEscalationRetryBrainId,
  buildEscalationCloseRecommendation,
  buildProjectCycleFollowUpMessage,
  inferProjectCycleSpecialty,
  buildProjectDirectiveContent,
  buildProjectRoleTaskBoardContent,
  parseProjectDirectiveState,
  buildProjectTodoContent,
  buildProjectWorkPackages,
  getProjectWorkAttemptCooldownMs: (...args) => observerGetProjectWorkAttemptCooldownMs(...args),
  chooseProjectWorkTargets,
  normalizeSummaryComparisonText,
  looksLikePlaceholderTaskMessage,
  isConcreteImplementationInspectionTarget,
  isEchoedToolResultEnvelope,
  collectTrackedWorkspaceTargets,
  shouldBypassWorkerPreflight,
  buildPostToolDecisionInstruction,
  buildWorkerSpecialtyPromptLines,
  buildQueuedTaskExecutionPrompt,
  buildTranscriptForPrompt,
  replanRepeatedToolLoopWithPlanner,
  normalizeToolCallRecord,
  normalizeToolName,
  normalizeContainerPathForComparison,
  extractInspectionTargetKey,
  parseToolCallArgs,
  getObserverConfig: () => observerConfig,
  setObserverConfig: (nextConfig) => {
    observerConfig = nextConfig;
  }
});
const {
  getActiveLocalWorkerTasks,
  runIntakeRegressionCase,
  runPlannerRegressionCase,
  runWorkerRegressionCase
} = createRegressionCaseRunners({
  buildRegressionFailure,
  looksLikeLowSignalPlannerTaskMessage,
  normalizeSummaryComparisonText,
  looksLikeLowSignalCompletionSummary,
  tryBuildObserverNativeResponse,
  planIntakeWithBitNet,
  createQueuedTask,
  processNextQueuedTask,
  findTaskById,
  waitMs,
  listAllTasks,
  getWorkerQueueLane: () => getBrainQueueLane(AGENT_BRAINS[1] || { queueLane: "" }),
  fileExists,
  outputRoot: OBSERVER_OUTPUT_ROOT
});
const {
  getActiveRegressionRun,
  getLatestRegressionRunReport,
  listRegressionSuites,
  loadLatestRegressionRunReport,
  runRegressionSuites
} = createRegressionOrchestrator({
  buildRegressionSuiteDefinitions,
  outputRoot: OBSERVER_OUTPUT_ROOT,
  readLatestReport: async () => JSON.parse(await fs.readFile(REGRESSION_RUN_REPORT_PATH, "utf8")),
  writeLatestReport: async (report) => {
    await writeVolumeText(REGRESSION_RUN_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  },
  getActiveLocalWorkerTasks,
  runIntakeRegressionCase,
  runPlannerRegressionCase,
  runWorkerRegressionCase,
  runInternalRegressionCase,
  buildRegressionFailure
});

function workspaceTaskPath(status, taskId) {
  const fileName = `${taskId}.json`;
  if (status === "in_progress") return `${TASK_QUEUE_WORKSPACE_PATH}/in_progress/${fileName}`;
  if (status === "closed") return `${TASK_QUEUE_WORKSPACE_PATH}/closed/${fileName}`;
  if (status === "waiting_for_user") return `${TASK_QUEUE_WORKSPACE_PATH}/inbox/${fileName}`;
  if (status === "done" || status === "completed" || status === "failed") return `${TASK_QUEUE_WORKSPACE_PATH}/done/${fileName}`;
  return `${TASK_QUEUE_WORKSPACE_PATH}/inbox/${fileName}`;
}

function taskPathForStatus(taskId, status) {
  const fileName = `${taskId}.json`;
  if (status === "in_progress") return path.join(TASK_QUEUE_IN_PROGRESS, fileName);
  if (status === "closed") return path.join(TASK_QUEUE_CLOSED, fileName);
  if (status === "waiting_for_user") return path.join(TASK_QUEUE_INBOX, fileName);
  if (status === "done" || status === "completed" || status === "failed") return path.join(TASK_QUEUE_DONE, fileName);
  return path.join(TASK_QUEUE_INBOX, fileName);
}

function materializeTaskRecord(task = {}) {
  const normalizedTask = normalizeTaskRecord(task);
  return {
    ...normalizedTask,
    filePath: taskPathForStatus(normalizedTask.id, normalizedTask.status),
    workspacePath: workspaceTaskPath(normalizedTask.status, normalizedTask.id)
  };
}

async function writeTaskRecord(task = {}) {
  const materializedTask = materializeTaskRecord(task);
  await writeVolumeText(materializedTask.filePath, `${JSON.stringify(materializedTask, null, 2)}\n`);
  return materializedTask;
}

async function removeObsoleteTaskFile(previousPath = "", nextPath = "") {
  const normalizedPreviousPath = String(previousPath || "").trim();
  const normalizedNextPath = String(nextPath || "").trim();
  if (!normalizedPreviousPath || normalizedPreviousPath === normalizedNextPath) {
    return false;
  }
  await fs.rm(normalizedPreviousPath, { force: true }).catch(() => {});
  return true;
}

async function persistTaskTransition({
  previousTask = null,
  previousPath = "",
  nextTask = {},
  eventType = "task.updated",
  reason = ""
} = {}) {
  const sourceTask = previousTask && typeof previousTask === "object" ? previousTask : null;
  const sourcePath = String(previousPath || sourceTask?.filePath || "").trim()
    || taskPathForStatus(String(nextTask?.id || ""), String(sourceTask?.status || "").trim());
  const derivedSource = deriveTaskIndexPathDetails(sourcePath);
  const sourceStatus = String(sourceTask?.status || derivedSource.status || "").trim();
  const sourceWorkspacePath = String(sourceTask?.workspacePath || derivedSource.workspacePath || "").trim()
    || workspaceTaskPath(sourceStatus || "queued", String(nextTask?.id || ""));
  const savedTask = await writeTaskRecord(nextTask);
  await removeObsoleteTaskFile(sourcePath, savedTask.filePath);
  await recordTaskBreadcrumb({
    taskId: savedTask.id,
    eventType,
    fromStatus: sourceStatus,
    fromPath: sourcePath,
    fromWorkspacePath: sourceWorkspacePath,
    toStatus: savedTask.status,
    toPath: savedTask.filePath,
    toWorkspacePath: savedTask.workspacePath,
    reason,
    sessionId: savedTask.sessionId,
    brainId: savedTask.requestedBrainId
  });
  return savedTask;
}

async function listExistingTaskFilePaths(taskId = "") {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    return [];
  }
  const candidates = new Set([
    taskPathForStatus(normalizedTaskId, "queued"),
    taskPathForStatus(normalizedTaskId, "in_progress"),
    taskPathForStatus(normalizedTaskId, "done"),
    taskPathForStatus(normalizedTaskId, "closed")
  ]);
  const existing = [];
  for (const candidatePath of candidates) {
    if (await fileExists(candidatePath)) {
      existing.push(candidatePath);
    }
  }
  return existing;
}

async function removeTaskRecord(task, reason = "Task removed from queue.") {
  const normalizedTaskId = String(task?.id || "").trim();
  if (!normalizedTaskId) {
    throw new Error("task id is required");
  }
  const sourceStatus = String(task?.status || "").trim();
  const sourcePath = String(task?.filePath || "").trim() || taskPathForStatus(normalizedTaskId, sourceStatus);
  const sourceWorkspacePath = String(task?.workspacePath || "").trim()
    || workspaceTaskPath(sourceStatus || "queued", normalizedTaskId);
  const removedPaths = new Set(await listExistingTaskFilePaths(normalizedTaskId));
  removedPaths.add(sourcePath);
  for (const filePath of removedPaths) {
    await fs.rm(filePath, { force: true }).catch(() => {});
  }
  await recordTaskBreadcrumb({
    taskId: normalizedTaskId,
    eventType: "task.removed",
    fromStatus: sourceStatus,
    fromPath: sourcePath,
    fromWorkspacePath: sourceWorkspacePath,
    toStatus: "removed",
    toPath: "",
    toWorkspacePath: "",
    reason: String(reason || "").trim() || "Task removed from queue.",
    sessionId: String(task?.sessionId || "").trim(),
    brainId: String(task?.requestedBrainId || "").trim()
  });
  return [...removedPaths];
}

async function writeTask(task) {
  await ensureTaskQueueDirs();
  const normalizedTask = await writeTaskRecord(task);
  await recordTaskBreadcrumb({
    taskId: normalizedTask.id,
    eventType: "task.state_written",
    toStatus: normalizedTask.status,
    toPath: normalizedTask.filePath,
    toWorkspacePath: normalizedTask.workspacePath,
    reason: "Canonical task state written.",
    sessionId: normalizedTask.sessionId,
    brainId: normalizedTask.requestedBrainId
  });
  return normalizedTask.filePath;
}

async function recoverStaleInProgressTasks() {
  const inProgressTasks = await listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress");
  if (!inProgressTasks.length) {
    return [];
  }

  const now = Date.now();
  const recovered = [];
  for (const task of inProgressTasks) {
    const lastTouchedAt = Number(task.lastHeartbeatAt || task.updatedAt || task.startedAt || task.createdAt || 0);
    const orphanedWithoutController = !activeTaskControllers.has(String(task.id || "").trim());
    const staleWindowMs = orphanedWithoutController ? TASK_ORPHANED_IN_PROGRESS_MS : TASK_STALE_IN_PROGRESS_MS;
    if (!lastTouchedAt || now - lastTouchedAt < staleWindowMs) {
      continue;
    }

    const attemptCount = Number(task.dispatchCount || 0);
    if (attemptCount >= 2) {
      const failedTask = await persistTaskTransition({
        previousTask: task,
        nextTask: {
        ...task,
        status: "failed",
        updatedAt: now,
        completedAt: now,
        stalledAt: lastTouchedAt,
        resultSummary: `Task stalled after ${attemptCount} attempts and was marked failed.`,
        notes: `Marked failed after ${attemptCount} attempts because it stalled for ${formatElapsedShort(now - lastTouchedAt)} without a heartbeat or completion${orphanedWithoutController ? " after the worker controller was lost" : ""}.`,
        recoveryTrail: [
          ...(Array.isArray(task.recoveryTrail) ? task.recoveryTrail : []),
          {
            at: now,
            from: "in_progress",
            to: "failed",
            reason: "stale_in_progress_attempt_limit"
          }
        ]
      },
        eventType: "task.failed",
        reason: `Marked failed after ${attemptCount} attempts because it stalled for ${formatElapsedShort(now - lastTouchedAt)} without a heartbeat or completion${orphanedWithoutController ? " after the worker controller was lost" : ""}.`
      });
      broadcastObserverEvent({
        type: "task.failed",
        task: failedTask
      });
      recovered.push(failedTask);
      continue;
    }

    const recoveredTask = await persistTaskTransition({
      previousTask: task,
      nextTask: {
      ...task,
      status: "queued",
      updatedAt: now,
      recoveredAt: now,
      stalledAt: lastTouchedAt,
      notes: `Recovered from stale in_progress after ${formatElapsedShort(now - lastTouchedAt)} without a heartbeat or completion${orphanedWithoutController ? " after the worker controller was lost" : ""}.`,
      recoveryTrail: [
        ...(Array.isArray(task.recoveryTrail) ? task.recoveryTrail : []),
        {
          at: now,
          from: "in_progress",
          to: "queued",
          reason: "stale_in_progress"
        }
      ]
      },
      eventType: "task.recovered",
      reason: `Recovered from stale in_progress after ${formatElapsedShort(now - lastTouchedAt)} without a heartbeat or completion${orphanedWithoutController ? " after the worker controller was lost" : ""}.`
    });
    broadcastObserverEvent({
      type: "task.recovered",
      task: {
        ...recoveredTask,
        recovered: true
      }
    });
    recovered.push(recoveredTask);
  }

  return recovered;
}

async function recoverConflictingInProgressLaneTasks() {
  const inProgressTasks = await listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress");
  if (!inProgressTasks.length) {
    return [];
  }
  const byLane = new Map();
  for (const task of inProgressTasks) {
    const lane = String(task.queueLane || "").trim()
      || getBrainQueueLane(await getBrain(task.requestedBrainId || "worker"));
    if (!lane) {
      continue;
    }
    if (!byLane.has(lane)) {
      byLane.set(lane, []);
    }
    byLane.get(lane).push(task);
  }
  const now = Date.now();
  const recovered = [];
  for (const [lane, tasks] of byLane.entries()) {
    if (tasks.length <= 1) {
      continue;
    }
    const ordered = [...tasks].sort((left, right) => {
      const leftStarted = Number(left.startedAt || left.updatedAt || left.createdAt || 0);
      const rightStarted = Number(right.startedAt || right.updatedAt || right.createdAt || 0);
      return leftStarted - rightStarted;
    });
    const keeper = ordered[0];
    for (const task of ordered.slice(1)) {
      const recoveryNote = compactTaskText(`Recovered from lane conflict on ${lane}; ${keeper.codename || keeper.id} kept the active slot. ${String(task.notes || "").trim()}`.trim(), 260);
      const recoveredTask = await persistTaskTransition({
        previousTask: task,
        nextTask: {
        ...task,
        status: "queued",
        updatedAt: now,
        recoveredAt: now,
        stalledAt: Number(task.lastHeartbeatAt || task.updatedAt || task.startedAt || task.createdAt || now),
        notes: recoveryNote,
        recoveryTrail: [
          ...(Array.isArray(task.recoveryTrail) ? task.recoveryTrail : []),
          {
            at: now,
            from: "in_progress",
            to: "queued",
            reason: "queue_lane_conflict",
            lane,
            keptTaskId: keeper.id
          }
        ]
      },
        eventType: "task.recovered",
        reason: recoveryNote
      });
      broadcastObserverEvent({
        type: "task.recovered",
        task: {
          ...recoveredTask,
          recovered: true
        }
      });
      recovered.push(recoveredTask);
    }
  }
  return recovered;
}

async function recoverStaleTaskDispatchLock(maxAgeMs = 20000) {
  if (!taskDispatchInFlight) {
    taskDispatchStartedAt = 0;
    return false;
  }
  const startedAt = Number(taskDispatchStartedAt || 0);
  if (!startedAt || (Date.now() - startedAt) < maxAgeMs) {
    return false;
  }
  const inProgressTasks = await listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress");
  if (inProgressTasks.length) {
    return false;
  }
  taskDispatchInFlight = false;
  taskDispatchStartedAt = 0;
  broadcast(`[observer] recovered a stale task dispatch lock after ${formatElapsedShort(Date.now() - startedAt)} with no in-progress task.`);
  return true;
}

async function listTasksByFolder(folder, status) {
  await ensureTaskQueueDirs();
  const entries = await listVolumeFiles(folder);
  const files = entries.filter((entry) => entry.type === "file" && entry.path.endsWith(".json"));
  const tasks = [];
  for (const entry of files) {
    try {
      const content = await readVolumeFile(entry.path);
      const parsed = normalizeTaskRecord(JSON.parse(content));
      if (parsed.redirectOnly) {
        continue;
      }
      tasks.push({
        ...parsed,
        status: parsed.status || status,
        filePath: entry.path
      });
    } catch {
      // skip malformed queue files
    }
  }
  return tasks.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
}

function isTodoBackedWaitingTask(task = {}) {
  return String(task?.status || "").trim().toLowerCase() === "waiting_for_user"
    && String(task?.waitingMode || "").trim().toLowerCase() === "todo"
    && Boolean(String(task?.todoItemId || "").trim());
}

async function listAllTasks() {
  const [queued, inProgress, doneRaw] = await Promise.all([
    listTasksByFolder(TASK_QUEUE_INBOX, "queued"),
    listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress"),
    listTasksByFolder(TASK_QUEUE_DONE, "done")
  ]);
  const waiting = queued.filter((task) =>
    String(task.status || "").toLowerCase() === "waiting_for_user"
    && !isTodoBackedWaitingTask(task)
  );
  const queuedReady = queued.filter((task) => String(task.status || "").toLowerCase() !== "waiting_for_user");
  const failed = doneRaw.filter((task) => String(task.status || "").toLowerCase() === "failed");
  const done = doneRaw.filter((task) => String(task.status || "").toLowerCase() !== "failed");
  return { queued: queuedReady, waiting, inProgress, done, failed };
}

const {
  buildQueuedTaskExecutionPrompt: observerBuildQueuedTaskExecutionPrompt,
  isProjectCycleMessage: observerIsProjectCycleMessage,
  isProjectCycleTask: observerIsProjectCycleTask
} = createObserverQueuedTaskPrompting({
  OBSERVER_CONTAINER_OUTPUT_ROOT,
  extractTaskDirectiveValue,
  inferTaskCapabilityProfile,
  inferTaskSpecialty,
  summarizeTaskCapabilities
});

const {
  buildConcreteReviewReason: observerBuildConcreteReviewReason,
  buildEscalationCloseRecommendation: observerBuildEscalationCloseRecommendation,
  buildEscalationSplitProjectWorkKey: observerBuildEscalationSplitProjectWorkKey,
  buildProjectCycleFollowUpMessage: observerBuildProjectCycleFollowUpMessage,
  buildProjectPipelineCollection: observerBuildProjectPipelineCollection,
  chooseEscalationRetryBrainId: observerChooseEscalationRetryBrainId,
  chooseProjectCycleRecoveryBrain: observerChooseProjectCycleRecoveryBrain,
  getProjectPipelineTrace: observerGetProjectPipelineTrace,
  listProjectPipelines: observerListProjectPipelines
} = createObserverProjectCycleSupport({
  canBrainHandleSpecialty,
  classifyFailureText,
  compactTaskText,
  extractTaskDirectiveValue,
  hashRef,
  isProjectCycleTask,
  listAllTasks,
  listAvailableBrains,
  normalizeContainerMountPathCandidate,
  path,
  removeTaskDirectiveValue,
  replaceTaskDirectiveValue
});

async function chooseAutomaticRetryBrainId(task = {}, failureClassification = "") {
  const attempted = new Set((Array.isArray(task?.specialistAttemptedBrainIds) ? task.specialistAttemptedBrainIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean));
  const requestedBrainId = String(task?.requestedBrainId || "worker").trim() || "worker";
  attempted.add(requestedBrainId);
  const specialty = inferTaskSpecialty(task) || "general";
  const projectCycleRecoveryBrain = await chooseProjectCycleRecoveryBrain(
    task,
    failureClassification,
    specialty,
    [...attempted]
  );
  const alternateBrain = task?.capabilityMismatchSuspected === true
    ? await chooseIdleWorkerBrainForSpecialtyExcluding(specialty, [...attempted])
    : task?.transportFailoverSuggested === true
      ? await chooseIdleWorkerBrainForTransportFailover(task, specialty, [...attempted])
      : null;
  const fallbackBrainId = (Array.isArray(task?.specialistRoute?.fallbackBrainIds) ? task.specialistRoute.fallbackBrainIds : [])
    .find((id) => {
      const normalized = String(id || "").trim();
      return normalized && !attempted.has(normalized);
    }) || "";
  return String(projectCycleRecoveryBrain?.id || "").trim()
    || String(alternateBrain?.id || "").trim()
    || fallbackBrainId;
}

async function getWaitingQuestionBacklogCount({ excludeTaskId = "" } = {}) {
  const normalizedExcludedTaskId = String(excludeTaskId || "").trim();
  const waitingTasks = await listTasksByFolder(TASK_QUEUE_WAITING, "waiting_for_user");
  return waitingTasks.filter((task) => {
    if (String(task.status || "").toLowerCase() !== "waiting_for_user") {
      return false;
    }
    if (isTodoBackedWaitingTask(task)) {
      return false;
    }
    if (normalizedExcludedTaskId && String(task.id || "") === normalizedExcludedTaskId) {
      return false;
    }
    return true;
  }).length;
}

function buildWaitingQuestionLimitSummary(waitingQuestionCount = 0) {
  const count = Math.max(0, Number(waitingQuestionCount || 0));
  return `Question backlog limit reached: ${count} waiting question${count === 1 ? "" : "s"} already exist, so no additional question was generated.`;
}

async function findTaskById(taskId) {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    return null;
  }
  const indexedTask = await findIndexedTaskById(normalizedTaskId);
  if (indexedTask) {
    return indexedTask;
  }
  const [queued, waiting, inProgress, doneRaw, closed] = await Promise.all([
    listTasksByFolder(TASK_QUEUE_INBOX, "queued"),
    listTasksByFolder(TASK_QUEUE_WAITING, "waiting_for_user"),
    listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress"),
    listTasksByFolder(TASK_QUEUE_DONE, "done"),
    listTasksByFolder(TASK_QUEUE_CLOSED, "closed")
  ]);
  return [...queued, ...waiting, ...inProgress, ...doneRaw, ...closed].find((task) => task.id === normalizedTaskId) || null;
}

function shouldKeepTaskVisible(task, siblings, visibleCount = 1) {
  if (!task?.id || !Array.isArray(siblings) || visibleCount <= 0) {
    return false;
  }
  const keepIds = siblings
    .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
    .slice(0, visibleCount)
    .map((entry) => String(entry.id || ""));
  return keepIds.includes(String(task.id || ""));
}

function isAutoCloseCompletedInternalTask(task) {
  const internalJobType = String(task?.internalJobType || "").trim().toLowerCase();
  return ["opportunity_scan", "mail_watch"].includes(internalJobType);
}

function isImmediateInternalNoopCompletion(task) {
  const internalJobType = String(task?.internalJobType || "").trim().toLowerCase();
  const summaryText = [
    String(task?.resultSummary || "").trim(),
    String(task?.reviewSummary || "").trim(),
    String(task?.workerSummary || "").trim(),
    String(task?.notes || "").trim()
  ].filter(Boolean).join("\n");
  if (internalJobType === "opportunity_scan" && /Idle scan skipped because the queue already has \d+ queued tasks\./i.test(summaryText)) {
    return true;
  }
  if (internalJobType === "opportunity_scan" && /Idle scan skipped because the observer was recently active\./i.test(summaryText)) {
    return true;
  }
  if (internalJobType === "question_maintenance" && /Question backlog limit reached: \d+ waiting questions? already exist, so no additional question was generated\./i.test(summaryText)) {
    return true;
  }
  return false;
}

function getAutoCloseCompletedInternalTaskReason(task) {
  const internalJobType = String(task?.internalJobType || "").trim().toLowerCase();
  if (internalJobType === "mail_watch") {
    return "Internal mail watch run completed and was closed automatically.";
  }
  if (internalJobType === "question_maintenance") {
    return "Internal question maintenance completed with no user-facing action and was closed automatically.";
  }
  return "Internal idle workspace opportunity scan completed and was closed automatically.";
}

async function archiveExpiredCompletedTasks() {
  await ensureTaskQueueDirs();
  const now = Date.now();
  const { done: completedTasks, failed: failedTasks } = await listAllTasks();
  let archivedDone = 0;
  let archivedFailed = 0;
  for (const task of [...completedTasks, ...failedTasks]) {
    if (
      (String(task.status || "").toLowerCase() === "failed" && shouldKeepTaskVisible(task, failedTasks, VISIBLE_FAILED_HISTORY_COUNT))
      || (String(task.status || "").toLowerCase() !== "failed" && shouldKeepTaskVisible(task, completedTasks, VISIBLE_COMPLETED_HISTORY_COUNT))
    ) {
      continue;
    }
    await persistTaskTransition({
      previousTask: task,
      nextTask: {
      ...task,
      status: "closed",
      updatedAt: now,
      closedAt: now,
      },
      eventType: "task.closed",
      reason: "Task moved into closed history during cleanup."
    });
    if (task.status === "failed") {
      archivedFailed += 1;
    } else {
      archivedDone += 1;
    }
  }
  const archived = archivedDone + archivedFailed;
  if (archived) {
    broadcast(`[observer] archived ${archivedDone} completed and ${archivedFailed} failed task(s) to closed`);
  }
  return archived;
}

async function compactTaskStateIndex() {
  const index = await readTaskStateIndex();
  const tasks = index?.tasks && typeof index.tasks === "object" ? index.tasks : {};
  let changed = false;
  for (const [taskId, entry] of Object.entries(tasks)) {
    if (!entry || typeof entry !== "object") {
      delete tasks[taskId];
      changed = true;
      continue;
    }
    const currentStatus = String(entry.currentStatus || "").trim().toLowerCase();
    const currentFilePath = String(entry.currentFilePath || "").trim();
    const updatedAt = Number(entry.updatedAt || 0);
    const isExpiredRemoved = currentStatus === "removed" && updatedAt > 0 && (Date.now() - updatedAt) > CLOSED_TASK_RETENTION_MS;
    const isExpiredClosed = currentStatus === "closed" && updatedAt > 0 && (Date.now() - updatedAt) > CLOSED_TASK_RETENTION_MS;
    const missingClosedFile = (currentStatus === "closed" || currentStatus === "removed") && currentFilePath && !(await fileExists(currentFilePath));
    if (isExpiredRemoved || isExpiredClosed || missingClosedFile) {
      delete tasks[taskId];
      changed = true;
    }
  }
  if (changed) {
    await writeVolumeText(TASK_STATE_INDEX_PATH, `${JSON.stringify({ tasks }, null, 2)}\n`);
  }
  return changed;
}

async function pruneClosedTasks() {
  await ensureTaskQueueDirs();
  const entries = await listVolumeFiles(TASK_QUEUE_CLOSED).catch(() => []);
  const files = [];
  for (const entry of entries.filter((candidate) => candidate.type === "file" && candidate.path.endsWith(".json"))) {
    try {
      const parsed = normalizeTaskRecord(JSON.parse(await readVolumeFile(entry.path)));
      const closedAt = Number(parsed.closedAt || parsed.completedAt || parsed.updatedAt || parsed.createdAt || 0);
      files.push({
        path: entry.path,
        taskId: String(parsed.id || extractTaskIdFromQueuePath(entry.path) || "").trim(),
        redirectOnly: parsed.redirectOnly === true,
        closedAt
      });
    } catch {
      files.push({
        path: entry.path,
        taskId: extractTaskIdFromQueuePath(entry.path),
        redirectOnly: false,
        closedAt: 0
      });
    }
  }
  const ordered = files.sort((left, right) => Number(right.closedAt || 0) - Number(left.closedAt || 0));
  const keepPaths = new Set(ordered.slice(0, MAX_CLOSED_TASK_FILES).map((entry) => entry.path));
  const now = Date.now();
  let prunedCount = 0;
  for (const file of ordered) {
    const expired = Number(file.closedAt || 0) > 0 && (now - Number(file.closedAt || 0)) > CLOSED_TASK_RETENTION_MS;
    const overLimit = !keepPaths.has(file.path);
    if (!expired && !overLimit) {
      continue;
    }
    await fs.rm(file.path, { force: true });
    prunedCount += 1;
  }
  if (prunedCount) {
    await compactTaskStateIndex();
    broadcast(`[observer] pruned ${prunedCount} closed task file${prunedCount === 1 ? "" : "s"}.`);
  }
  return prunedCount;
}

async function pruneRedirectTaskFiles() {
  await ensureTaskQueueDirs();
  const folders = [TASK_QUEUE_INBOX, TASK_QUEUE_IN_PROGRESS, TASK_QUEUE_DONE, TASK_QUEUE_CLOSED];
  let prunedCount = 0;
  for (const folder of folders) {
    const entries = await listVolumeFiles(folder).catch(() => []);
    for (const entry of entries.filter((candidate) => candidate.type === "file" && candidate.path.endsWith(".json"))) {
      try {
        const parsed = JSON.parse(await readVolumeFile(entry.path));
        if (!parsed?.redirectOnly) {
          continue;
        }
        await fs.rm(entry.path, { force: true });
        prunedCount += 1;
      } catch {
        // skip malformed files
      }
    }
  }
  if (prunedCount) {
    broadcast(`[observer] pruned ${prunedCount} redirect task file${prunedCount === 1 ? "" : "s"}.`);
  }
  return prunedCount;
}

async function runQueueStorageMaintenance() {
  const migration = await migrateLegacyTaskQueueIfNeeded();
  const prunedRedirectsBeforeClosed = await pruneRedirectTaskFiles();
  const prunedClosed = await pruneClosedTasks();
  const prunedRedirectsAfterClosed = await pruneRedirectTaskFiles();
  const prunedRedirects = prunedRedirectsBeforeClosed + prunedRedirectsAfterClosed;
  const compactedIndex = await compactTaskStateIndex();
  const reportLines = [];
  if (migration?.migrated) {
    reportLines.push(`migrated ${migration.migrated} legacy task file${migration.migrated === 1 ? "" : "s"} into ${OBSERVER_TASK_QUEUE_NAME}/`);
  }
  if (migration?.retired) {
    reportLines.push(`retired ${migration.retired} stale legacy task file${migration.retired === 1 ? "" : "s"} from ${LEGACY_OBSERVER_TASK_QUEUE_NAME}/ after ${Math.round(LEGACY_TASK_QUEUE_RETIRE_AFTER_MS / (60 * 60 * 1000))} hours of inactivity`);
  }
  if (prunedRedirects) {
    reportLines.push(`pruned ${prunedRedirects} redirect stub file${prunedRedirects === 1 ? "" : "s"}`);
  }
  if (prunedClosed) {
    reportLines.push(`pruned ${prunedClosed} closed history file${prunedClosed === 1 ? "" : "s"}`);
  }
  if (compactedIndex) {
    reportLines.push("compacted the task-state index");
  }
  if (reportLines.length) {
    await appendQueueMaintenanceReport("Queue storage maintenance completed.", reportLines);
  }
  return {
    migration,
    prunedRedirects,
    prunedClosed,
    compactedIndex
  };
}

async function closeCompletedInternalPeriodicTasks() {
  await ensureTaskQueueDirs();
  const completedTasks = await listTasksByFolder(TASK_QUEUE_DONE, "done");
  const closable = completedTasks.filter((task) => {
    if (task.maintenanceReviewedAt || String(task.status || "").toLowerCase() === "failed") {
      return false;
    }
    if (shouldKeepTaskVisible(task, completedTasks, VISIBLE_COMPLETED_HISTORY_COUNT)) {
      return false;
    }
    return isAutoCloseCompletedInternalTask(task);
  });
  let closedCount = 0;
  for (const task of closable) {
    await closeTaskRecord(task, getAutoCloseCompletedInternalTaskReason(task));
    closedCount += 1;
  }
  if (closedCount) {
    await appendQueueMaintenanceReport(
      `Queue maintenance report: closed ${closedCount} completed internal periodic task${closedCount === 1 ? "" : "s"}.`,
      [
        "Recurring internal jobs now close themselves after documenting the run."
      ]
    );
  }
  return closedCount;
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
  if (input.startsWith("/")) {
    const normalized = input.replaceAll("\\", "/");
    if (
      normalized === OBSERVER_CONTAINER_WORKSPACE_ROOT
      || normalized.startsWith(`${OBSERVER_CONTAINER_WORKSPACE_ROOT}/`)
      || normalized === OBSERVER_CONTAINER_INPUT_ROOT
      || normalized.startsWith(`${OBSERVER_CONTAINER_INPUT_ROOT}/`)
      || normalized === OBSERVER_CONTAINER_OUTPUT_ROOT
      || normalized.startsWith(`${OBSERVER_CONTAINER_OUTPUT_ROOT}/`)
    ) {
      return normalized;
    }
    throw new Error("absolute path is outside the allowed container workspace");
  }
  if (/^[A-Za-z]:[\\/]/.test(input)) {
    throw new Error("host paths are not allowed for tool calls");
  }
  const normalizedRelative = input.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (
    normalizedRelative === "observer-input"
    || normalizedRelative.startsWith("observer-input/")
  ) {
    const relative = normalizedRelative === "observer-input"
      ? ""
      : normalizedRelative.slice("observer-input/".length);
    return relative
      ? `${OBSERVER_CONTAINER_INPUT_ROOT}/${relative}`
      : OBSERVER_CONTAINER_INPUT_ROOT;
  }
  if (
    normalizedRelative === "observer-output"
    || normalizedRelative.startsWith("observer-output/")
  ) {
    const relative = normalizedRelative === "observer-output"
      ? ""
      : normalizedRelative.slice("observer-output/".length);
    return relative
      ? `${OBSERVER_CONTAINER_OUTPUT_ROOT}/${relative}`
      : OBSERVER_CONTAINER_OUTPUT_ROOT;
  }
  return normalizedRelative
    ? `${OBSERVER_CONTAINER_WORKSPACE_ROOT}/${normalizedRelative}`
    : OBSERVER_CONTAINER_WORKSPACE_ROOT;
}

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
  const ext = path.extname(lowerName);
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

  if (buffer.length > MAX_DOCUMENT_SOURCE_BYTES) {
    warnings.push(`source exceeded ${MAX_DOCUMENT_SOURCE_BYTES} bytes and was not normalized`);
    return {
      kind: "oversized",
      contentType: mime,
      text: `Document metadata only.\nSource: ${sourceLabel || sourceName || "(unknown)"}\nBytes: ${buffer.length}\nReason: source too large for direct normalization.`,
      warnings,
      sourceLabel: sourceLabel || sourceName || "(unknown)"
    };
  }

  if (mime === "message/rfc822" || ext === ".eml") {
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
      // ignore unreadable image attachments
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
  const basename = path.basename(lower);
  return isObserverOutputDocumentPath(lower) && (
    /^task-\d+.*\.(txt|md|json)$/i.test(basename)
    || /(?:^|[-_])(summary|status|briefing|heartbeat|cleanup|maintenance|progress|report)(?:[-_]|\.|$)/i.test(basename)
    || basename === "today.md"
  );
}

function isAssistantPrimaryDocumentPath(filePath = "") {
  const lower = normalizeDocumentPathForRules(filePath);
  const preferredTerms = Array.isArray(documentRulesState.preferredPathTerms) ? documentRulesState.preferredPathTerms : [];
  return lower.includes("\\observer-attachments\\")
    || preferredTerms.some((term) => term && lower.includes(term.toLowerCase()));
}

function isLowValueRepositoryDocument(filePath = "") {
  const lower = normalizeDocumentPathForRules(filePath);
  const basename = path.basename(lower);
  const basenameNoExt = basename.replace(path.extname(basename), "");
  const ignoredNames = Array.isArray(documentRulesState.ignoredFileNamePatterns)
    ? documentRulesState.ignoredFileNamePatterns
    : [];
  if (isAssistantPrimaryDocumentPath(lower)) {
    return false;
  }
  return ignoredNames.some((term) => term && (basename === term || basenameNoExt === term || basename.includes(term)));
}

function shouldIgnoreDocumentPath(filePath = "") {
  const lower = normalizeDocumentPathForRules(filePath);
  const ignoredTerms = Array.isArray(documentRulesState.ignoredPathTerms) ? documentRulesState.ignoredPathTerms : [];
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
  if (/\b(invoice|receipt|bill|payment due|quote|proposal|renewal|subscription)\b/.test(lower)) return "finance";
  if (/\b(meeting|appointment|calendar|schedule|agenda|timeslot|booking)\b/.test(lower)) return "schedule";
  if (/\b(contract|agreement|terms|policy|nda)\b/.test(lower)) return "legal";
  if (kind === "email" || /\bfrom:|to:|email subject:\b/.test(lower)) return "mail";
  if (/\b(todo|task|follow up|follow-up|action items?|next step|handoff)\b/.test(lower)) return "action";
  if (/\b(notes|journal|memory|personal)\b/.test(lower)) return "notes";
  if (/\b(invoice|receipt|bill|payment|quote|proposal|renewal)\b/.test(lower)) return "finance";
  if (/\b(meeting|appointment|calendar|schedule|agenda)\b/.test(lower)) return "schedule";
  if (/\b(contract|agreement|terms|policy|nda)\b/.test(lower)) return "legal";
  if (/\b(project|roadmap|todo|tasks|milestone|backlog|handoff)\b/.test(lower)) return "project";
  if (kind === "email" || /\bfrom:|to:|email subject:\b/.test(lower)) return "mail";
  if (/\b(notes|journal|memory|personal)\b/.test(lower)) return "notes";
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
  const extension = path.extname(relativePath).toLowerCase();
  const lines = normalizedText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#{1,6}\s+/.test(line))?.replace(/^#{1,6}\s+/, "").trim()
    || lines.find(Boolean)
    || path.basename(relativePath || "document");
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

  const watchHits = (Array.isArray(documentRulesState.watchTerms) ? documentRulesState.watchTerms : [])
    .filter((term) => term && lower.includes(term.toLowerCase()))
    .slice(0, 8);

  const importantPeopleHits = (Array.isArray(documentRulesState.importantPeople) ? documentRulesState.importantPeople : [])
    .filter((term) => term && lower.includes(term.toLowerCase()))
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
  if (/\b(mail|finance|schedule|legal|action)\b/.test(detectDocumentCategory({ relativePath, text: compact, kind: "" }))) priority += 1;
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
    const raw = await fs.readFile(DOCUMENT_INDEX_PATH, "utf8");
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
  await writeVolumeText(DOCUMENT_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
}

function getDocumentScanRoots() {
  return [
    { id: "output", rootPath: OBSERVER_OUTPUT_ROOT, maxDepth: 6, limit: 260 },
    { id: "attachments", rootPath: OBSERVER_ATTACHMENTS_ROOT, maxDepth: 5, limit: 120 }
  ];
}

const retrievalDomain = createRetrievalDomain({
  runtimeStatePath: RETRIEVAL_STATE_PATH,
  qdrantUrl: DEFAULT_QDRANT_URL,
  qdrantApiKey: "",
  getQdrantUrl: () => getRetrievalConfig().qdrantUrl,
  getQdrantApiKey: resolveQdrantApiKey,
  hasQdrantApiKey,
  collectionName: getRetrievalConfig().collectionName,
  workspaceKey: `observer:${WORKSPACE_ROOT.replaceAll("\\", "/").toLowerCase()}`,
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
          sourceName: path.basename(filePath),
          contentType: ""
        });
        const relativePath = path.relative(root.rootPath, filePath).replace(/\\/g, "/");
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
          name: path.basename(filePath),
          extension: path.extname(filePath).toLowerCase(),
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
  await writeVolumeText(path.join(PROMPT_MEMORY_BRIEFINGS_ROOT, `${dayKey}.md`), content);
  await writeVolumeText(PROMPT_TODAY_BRIEFING_PATH, content);
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

async function findRetrievalBrain() {
  const brains = await listAvailableBrains();
  return brains.find((brain) => brain.specialty === "retrieval") || null;
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
      // fall through to lexical search
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
    lines.push(
      `I found ${chunkResult.matches.length} relevant chunk${chunkResult.matches.length === 1 ? "" : "s"} for "${query}".`
    );
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
      sourceName: path.posix.basename(target),
      contentType: String(args.contentType || "")
    });
    return buildDocumentToolResponse({
      sourceLabel: target,
      sourceName: path.posix.basename(target),
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
      "user-agent": "claw-observer/1.0"
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

function getToolPathArg(args = {}, { defaultPath = "" } = {}) {
  const source = args && typeof args === "object" ? args : {};
  const value = String(
    source.path
    || source.target
    || source.filePath
    || source.filepath
    || source.file
    || source.filename
    || defaultPath
    || ""
  ).trim();
  if (!value) {
    throw new Error("path is required");
  }
  return value;
}

async function toolListFiles(args = {}) {
  const target = resolveToolPath(getToolPathArg(args, { defaultPath: "." }));
  const recursive = Boolean(args.recursive);
  const limit = Math.max(1, Math.min(Number(args.limit || 200), 500));
  return listFilesInContainer(target, { recursive, limit });
}

async function toolReadFile(args = {}) {
  return toolReadDocument(args, { internetEnabled: false });
}

async function toolWriteFile(args = {}) {
  const target = resolveToolPath(getToolPathArg(args));
  const content = String(args.content || "");
  const append = Boolean(args.append);
  return writeContainerTextFile(target, content, { append, timeoutMs: 30000 });
}

async function writeContainerBinaryFile(targetPath, base64Buffer) {
  const buffer = Buffer.from(base64Buffer, "base64");
  const tempHostPath = path.join(TASK_QUEUE_IN_PROGRESS, `temp-bin-${Date.now()}-${Math.floor(Math.random() * 1000)}.bin`);
  await fs.writeFile(tempHostPath, buffer);
  try {
    const encodedTarget = Buffer.from(targetPath).toString("base64");
    const script = `
      const fs = require('fs');
      const path = Buffer.from('${encodedTarget}', 'base64').toString('utf8');
      const src = '/home/openclaw/observer-input/${path.basename(tempHostPath)}';
      fs.copyFileSync(src, path);
    `;
    const inContainerTempPath = `${OBSERVER_CONTAINER_INPUT_ROOT}/${path.basename(tempHostPath)}`;
    await runObserverToolContainerNode(script, {
      extraMounts: [[tempHostPath, inContainerTempPath, "ro"]]
    });
  } finally {
    await fs.unlink(tempHostPath).catch(() => {});
  }
}

function normalizeEditToolArgs(args = {}) {
  const source = args && typeof args === "object" ? args : {};
  const edits = Array.isArray(source.edits) && source.edits.length
    ? source.edits
    : (Array.isArray(source.replacements) ? source.replacements : []);
  const normalizedEdits = edits.map((entry) => ({
    oldText: String(entry?.oldText ?? entry?.old ?? entry?.find ?? ""),
    newText: String(entry?.newText ?? entry?.new ?? entry?.replace ?? ""),
    replaceAll: entry?.replaceAll === true || entry?.replace_all === true,
    expectedReplacements: entry?.expectedReplacements == null
      ? (entry?.expected_replacements == null ? null : Number(entry.expected_replacements))
      : Number(entry.expectedReplacements)
  })).filter((entry) => entry.oldText);
  return {
    edits: normalizedEdits,
    oldText: String(source.oldText ?? source.old ?? source.find ?? ""),
    newText: String(source.newText ?? source.new ?? source.replace ?? ""),
    content: Object.prototype.hasOwnProperty.call(source, "content")
      ? String(source.content ?? "")
      : (Object.prototype.hasOwnProperty.call(source, "fullContent")
        ? String(source.fullContent ?? "")
        : ""),
    replaceAll: source.replaceAll === true || source.replace_all === true,
    expectedReplacements: source.expectedReplacements == null
      ? (source.expected_replacements == null ? null : Number(source.expected_replacements))
      : Number(source.expectedReplacements)
  };
}

async function toolEditFile(args = {}) {
  const target = resolveToolPath(getToolPathArg(args));
  const normalizedArgs = normalizeEditToolArgs(args);
  if (
    normalizedArgs.content
    && !normalizedArgs.edits.length
    && !normalizedArgs.oldText
  ) {
    return writeContainerTextFile(target, normalizedArgs.content, { timeoutMs: 30000 });
  }
  return editContainerTextFile(target, {
    ...normalizedArgs,
    timeoutMs: 30000
  });
}

async function toolMovePath(args = {}) {
  const from = resolveToolPath(args.fromPath || args.from);
  const to = resolveToolPath(args.toPath || args.to);
  return moveContainerPath(from, to, {
    overwrite: args.overwrite === true,
    timeoutMs: 30000
  });
}

async function toolShellCommand(args = {}) {
  const command = String(args.command || "").trim();
  if (!command) {
    throw new Error("command is required");
  }
  return runSandboxShell(command, {
    timeoutMs: Math.max(1000, Math.min(Number(args.timeoutMs || 60000), 180000))
  });
}

async function toolWebFetch(args = {}, { internetEnabled } = {}) {
  const result = await toolReadDocument(args, { internetEnabled });
  return {
    url: result.url || String(args.url || "").trim(),
    ok: result.ok,
    status: result.status,
    contentType: result.contentType || "",
    body: result.content || "",
    chunk: result.chunk,
    kind: result.kind,
    warnings: result.warnings || []
  };
}

let wordpressSiteRegistryState = null;
const WORDPRESS_BRIDGE_NAMESPACE = "nova-bridge/v1";

function normalizeWordPressBaseUrl(value = "") {
  let raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  try {
    const parsed = new URL(raw);
    let pathname = parsed.pathname.replace(/\/+$/g, "");
    pathname = pathname.replace(/\/wp-json(?:\/.*)?$/i, "");
    return `${parsed.origin}${pathname}`.replace(/\/+$/g, "");
  } catch {
    return "";
  }
}

function normalizeWordPressSiteId(value = "", fallbackBaseUrl = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw) {
    return raw.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  }
  const normalizedBaseUrl = normalizeWordPressBaseUrl(fallbackBaseUrl);
  if (!normalizedBaseUrl) {
    return "";
  }
  try {
    const parsed = new URL(normalizedBaseUrl);
    const hostPart = parsed.hostname.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    const pathPart = parsed.pathname.replace(/\/+/g, "-").replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "");
    return [hostPart, pathPart].filter(Boolean).join("-");
  } catch {
    return "";
  }
}

function normalizeWordPressPostStatus(value = "", fallback = "draft") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["draft", "publish", "private", "pending", "future"].includes(normalized)) {
    return normalized;
  }
  return String(fallback || "draft").trim().toLowerCase() || "draft";
}

function normalizeWordPressTermList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === "number" ? entry : String(entry || "").trim())
      .filter((entry) => entry !== "" && entry != null);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function normalizeWordPressSiteEntry(entry = {}) {
  const baseUrl = normalizeWordPressBaseUrl(entry.baseUrl || entry.url || "");
  const siteId = normalizeWordPressSiteId(entry.siteId || entry.id || "", baseUrl);
  const label = compactTaskText(String(entry.label || entry.name || siteId || baseUrl).trim(), 120);
  return {
    siteId,
    label,
    baseUrl,
    keyId: compactTaskText(String(entry.keyId || entry.apiKeyId || "").trim(), 120),
    sharedSecretHandle: observerSecrets.normalizeSecretHandle(
      entry.sharedSecretHandle
      || entry.secretHandle
      || (siteId ? observerSecrets.buildWordPressSharedSecretHandle(siteId) : "")
    ),
    sharedSecret: String(entry.sharedSecret || entry.secret || "").trim(),
    defaultStatus: normalizeWordPressPostStatus(entry.defaultStatus || "draft"),
    updatedAt: Number(entry.updatedAt || Date.now())
  };
}

async function buildWordPressSitePublicView(site = {}) {
  const sharedSecretHandle = observerSecrets.normalizeSecretHandle(site.sharedSecretHandle || "");
  const hasSecret = sharedSecretHandle
    ? await observerSecrets.hasSecret(sharedSecretHandle)
    : Boolean(String(site.sharedSecret || "").trim());
  return {
    siteId: String(site.siteId || "").trim(),
    label: String(site.label || "").trim(),
    baseUrl: String(site.baseUrl || "").trim(),
    keyId: String(site.keyId || "").trim(),
    sharedSecretHandle,
    defaultStatus: normalizeWordPressPostStatus(site.defaultStatus || "draft"),
    hasSecret,
    maskedSecret: hasSecret ? "stored in system keychain" : "",
    updatedAt: Number(site.updatedAt || 0)
  };
}

async function ensureWordPressSiteSecretStored(site = {}) {
  const sharedSecretHandle = observerSecrets.normalizeSecretHandle(
    site.sharedSecretHandle
    || (site.siteId ? observerSecrets.buildWordPressSharedSecretHandle(site.siteId) : "")
  );
  const legacySharedSecret = String(site.sharedSecret || "").trim();
  if (!sharedSecretHandle || !legacySharedSecret) {
    return {
      ...site,
      sharedSecretHandle
    };
  }
  await observerSecrets.setSecret(sharedSecretHandle, legacySharedSecret);
  return {
    ...site,
    sharedSecretHandle,
    sharedSecret: ""
  };
}

async function resolveWordPressSharedSecret(site = {}) {
  const sharedSecretHandle = observerSecrets.normalizeSecretHandle(site.sharedSecretHandle || "");
  if (sharedSecretHandle) {
    const resolved = await observerSecrets.getSecret(sharedSecretHandle);
    if (String(resolved || "").trim()) {
      return String(resolved || "");
    }
  }
  return String(site.sharedSecret || "");
}

async function loadWordPressSiteRegistry() {
  if (wordpressSiteRegistryState) {
    return wordpressSiteRegistryState;
  }
  try {
    const raw = await fs.readFile(WORDPRESS_SITE_REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    wordpressSiteRegistryState = {
      sites: Array.isArray(parsed?.sites)
        ? parsed.sites.map((entry) => normalizeWordPressSiteEntry(entry)).filter((entry) => entry.siteId && entry.baseUrl)
        : []
    };
  } catch {
    wordpressSiteRegistryState = { sites: [] };
  }
  let migrated = false;
  wordpressSiteRegistryState.sites = await Promise.all(
    wordpressSiteRegistryState.sites.map(async (entry) => {
      const upgraded = await ensureWordPressSiteSecretStored(entry);
      if (String(entry.sharedSecret || "").trim() && !String(upgraded.sharedSecret || "").trim()) {
        migrated = true;
      }
      return upgraded;
    })
  );
  if (migrated) {
    await saveWordPressSiteRegistry();
  }
  return wordpressSiteRegistryState;
}

async function saveWordPressSiteRegistry() {
  const state = await loadWordPressSiteRegistry();
  const serializedState = {
    sites: (Array.isArray(state.sites) ? state.sites : []).map((entry) => ({
      siteId: String(entry.siteId || "").trim(),
      label: String(entry.label || "").trim(),
      baseUrl: String(entry.baseUrl || "").trim(),
      keyId: String(entry.keyId || "").trim(),
      sharedSecretHandle: observerSecrets.normalizeSecretHandle(entry.sharedSecretHandle || ""),
      defaultStatus: normalizeWordPressPostStatus(entry.defaultStatus || "draft"),
      updatedAt: Number(entry.updatedAt || Date.now())
    }))
  };
  await fs.mkdir(path.dirname(WORDPRESS_SITE_REGISTRY_PATH), { recursive: true });
  await fs.writeFile(WORDPRESS_SITE_REGISTRY_PATH, `${JSON.stringify(serializedState, null, 2)}\n`, "utf8");
}

async function listWordPressSites() {
  const state = await loadWordPressSiteRegistry();
  return Promise.all(state.sites.map((entry) => buildWordPressSitePublicView(entry)));
}

async function saveWordPressSite(args = {}) {
  const normalized = normalizeWordPressSiteEntry(args);
  if (!normalized.siteId) {
    throw new Error("siteId or baseUrl is required");
  }
  if (!normalized.baseUrl) {
    throw new Error("baseUrl is required");
  }
  if (!normalized.keyId) {
    throw new Error("keyId is required");
  }
  const state = await loadWordPressSiteRegistry();
  const index = state.sites.findIndex((entry) => String(entry.siteId || "").trim() === normalized.siteId);
  const existing = index >= 0 ? state.sites[index] : null;
  const sharedSecretHandle = observerSecrets.normalizeSecretHandle(
    normalized.sharedSecretHandle
    || existing?.sharedSecretHandle
    || observerSecrets.buildWordPressSharedSecretHandle(normalized.siteId)
  );
  const providedSharedSecret = String(args.sharedSecret || args.secret || "").trim();
  const hasExistingSecret = sharedSecretHandle ? await observerSecrets.hasSecret(sharedSecretHandle) : false;
  if (!providedSharedSecret && !hasExistingSecret) {
    throw new Error("sharedSecret is required");
  }
  if (providedSharedSecret) {
    await observerSecrets.setSecret(sharedSecretHandle, providedSharedSecret);
  }
  const nextEntry = {
    ...(existing || {}),
    ...normalized,
    sharedSecretHandle,
    sharedSecret: "",
    updatedAt: Date.now()
  };
  if (index >= 0) {
    state.sites[index] = nextEntry;
  } else {
    state.sites.unshift(nextEntry);
  }
  state.sites = state.sites
    .filter((entry) => entry.siteId && entry.baseUrl)
    .sort((left, right) => String(left.label || left.siteId).localeCompare(String(right.label || right.siteId)));
  await saveWordPressSiteRegistry();
  return buildWordPressSitePublicView(state.sites.find((entry) => entry.siteId === normalized.siteId) || nextEntry);
}

async function removeWordPressSite(args = {}) {
  const siteId = normalizeWordPressSiteId(args.siteId || args.id || "");
  if (!siteId) {
    throw new Error("siteId is required");
  }
  const state = await loadWordPressSiteRegistry();
  const index = state.sites.findIndex((entry) => String(entry.siteId || "").trim() === siteId);
  if (index < 0) {
    throw new Error(`WordPress site "${siteId}" was not found`);
  }
  const [removed] = state.sites.splice(index, 1);
  const sharedSecretHandle = observerSecrets.normalizeSecretHandle(removed?.sharedSecretHandle || "");
  if (sharedSecretHandle) {
    await observerSecrets.deleteSecret(sharedSecretHandle);
  }
  await saveWordPressSiteRegistry();
  return buildWordPressSitePublicView(removed);
}

async function getWordPressSiteConfig(siteId = "") {
  const normalizedSiteId = normalizeWordPressSiteId(siteId);
  if (!normalizedSiteId) {
    throw new Error("siteId is required");
  }
  const state = await loadWordPressSiteRegistry();
  const site = state.sites.find((entry) => String(entry.siteId || "").trim() === normalizedSiteId);
  if (!site) {
    throw new Error(`WordPress site "${normalizedSiteId}" is not configured`);
  }
  const sharedSecret = await resolveWordPressSharedSecret(site);
  if (!String(site.keyId || "").trim() || !String(sharedSecret || "").trim()) {
    throw new Error(`WordPress site "${normalizedSiteId}" is missing credentials`);
  }
  return {
    ...site,
    sharedSecret
  };
}

function buildWordPressBridgePath(route = "") {
  const normalizedRoute = String(route || "").trim() || "/site";
  return `/wp-json/${WORDPRESS_BRIDGE_NAMESPACE}${normalizedRoute.startsWith("/") ? normalizedRoute : `/${normalizedRoute}`}`;
}

function buildWordPressBridgeSignature({ timestamp = "", method = "GET", requestPath = "", bodyText = "", sharedSecret = "" } = {}) {
  return crypto
    .createHmac("sha256", String(sharedSecret || ""))
    .update(`${String(timestamp || "").trim()}.${String(method || "GET").trim().toUpperCase()}.${String(requestPath || "").trim()}.${String(bodyText || "")}`, "utf8")
    .digest("hex");
}

async function callWordPressBridge(site, { method = "GET", route = "/site", body = null, timeoutMs = 30000 } = {}) {
  const requestPath = buildWordPressBridgePath(route);
  const normalizedMethod = String(method || "GET").trim().toUpperCase() || "GET";
  const baseUrl = String(site?.baseUrl || "").trim().replace(/\/+$/g, "");
  const url = `${baseUrl}${requestPath}`;
  const bodyText = body == null ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = {
    "x-nova-key": String(site?.keyId || "").trim(),
    "x-nova-timestamp": timestamp,
    "x-nova-signature": buildWordPressBridgeSignature({
      timestamp,
      method: normalizedMethod,
      requestPath,
      bodyText,
      sharedSecret: String(site?.sharedSecret || "")
    }),
    accept: "application/json"
  };
  if (bodyText) {
    headers["content-type"] = "application/json";
  }
  let response;
  try {
    response = await fetch(url, {
      method: normalizedMethod,
      headers,
      body: bodyText || undefined,
      signal: AbortSignal.timeout(Math.max(1000, Math.min(Number(timeoutMs || 30000), 120000)))
    });
  } catch (error) {
    throw new Error(`WordPress request failed for ${site?.siteId || site?.baseUrl || "site"}: ${error.message}`);
  }
  const rawText = await response.text();
  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { raw: rawText };
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(String(payload?.error || payload?.message || `WordPress bridge returned HTTP ${response.status}`));
  }
  return payload;
}

async function toolListWordPressSites() {
  const sites = await listWordPressSites();
  return {
    text: sites.length
      ? `Configured WordPress sites:\n${sites.map((site) => `- ${site.siteId}: ${site.label || site.baseUrl} (${site.baseUrl})`).join("\n")}`
      : "No WordPress sites are configured yet.",
    sites
  };
}

async function toolSaveWordPressSite(args = {}) {
  const site = await saveWordPressSite(args);
  return {
    text: `Saved WordPress site ${site.siteId} for ${site.baseUrl}.`,
    site
  };
}

async function toolRemoveWordPressSite(args = {}) {
  const site = await removeWordPressSite(args);
  return {
    text: `Removed WordPress site ${site.siteId}.`,
    site
  };
}

async function toolWordPressTestConnection(args = {}) {
  const site = await getWordPressSiteConfig(args.siteId);
  const result = await callWordPressBridge(site, {
    method: "GET",
    route: "/site",
    timeoutMs: Number(args.timeoutMs || 20000)
  });
  return {
    text: `Connected to ${site.label || site.siteId}. Remote site: ${result?.site?.name || result?.site?.url || site.baseUrl}.`,
    site: await buildWordPressSitePublicView(site),
    remoteSite: result.site || {}
  };
}

async function toolWordPressUpsertPost(args = {}) {
  const site = await getWordPressSiteConfig(args.siteId);
  const postId = Number(args.wordpressPostId || args.postId || 0);
  const slug = compactTaskText(String(args.slug || "").trim(), 180);
  const title = compactTaskText(String(args.title || "").trim(), 220);
  const content = String(args.content || "");
  if (!(postId > 0) && !slug && !title) {
    throw new Error("title is required for a new post, or provide wordpressPostId/postId or slug for an update");
  }
  if (!content && !(postId > 0 || slug)) {
    throw new Error("content is required for a new post");
  }
  const payload = {
    postId: postId > 0 ? postId : undefined,
    title: title || undefined,
    content: content || undefined,
    slug: slug || undefined,
    excerpt: String(args.excerpt || "").trim() || undefined,
    status: normalizeWordPressPostStatus(args.status || site.defaultStatus || "draft"),
    postType: compactTaskText(String(args.postType || "post").trim().toLowerCase(), 80) || "post",
    categories: normalizeWordPressTermList(args.categories),
    tags: normalizeWordPressTermList(args.tags)
  };
  const result = await callWordPressBridge(site, {
    method: "POST",
    route: "/posts/upsert",
    body: payload,
    timeoutMs: Number(args.timeoutMs || 30000)
  });
  const post = result.post || {};
  return {
    text: `Upserted WordPress ${post.postType || payload.postType || "post"} ${post.id || payload.postId || ""} on ${site.label || site.siteId}${post.viewUrl ? `: ${post.viewUrl}` : "."}`,
    site: await buildWordPressSitePublicView(site),
    post
  };
}

const WORKER_TOOLS = [
  { name: "list_files", description: "List files in a directory", parameters: { path: "string", recursive: "boolean", limit: "number" } },
  { name: "read_document", description: "Read and normalize a document from a path or url. Cleans markdown/html/json/email-like content into a consumable text view and returns it in chunks.", parameters: { path: "string", url: "string", offset: "number", maxChars: "number", contentType: "string" } },
  { name: "read_file", description: "Read and normalize a text document from a path in chunks. Prefer read_document for general document work.", parameters: { path: "string", offset: "number", maxChars: "number", contentType: "string" } },
  { name: "write_file", description: "Write or append a UTF-8 text file", parameters: { path: "string", content: "string", append: "boolean" } },
  { name: "edit_file", description: "Apply targeted text replacements to an existing UTF-8 text file, or replace the whole file when content is provided", parameters: { path: "string", oldText: "string", newText: "string", replaceAll: "boolean", expectedReplacements: "number", edits: "array", content: "string" } },
  { name: "move_path", description: "Move or rename a file or directory inside the workspace or observer-output", parameters: { fromPath: "string", toPath: "string", overwrite: "boolean" } },
  { name: "shell_command", description: "Run a shell command inside the observer sandbox container workspace", parameters: { command: "string", timeoutMs: "number" } },
  { name: "web_fetch", description: "Fetch a webpage or text resource in chunks. Start with the first chunk, then request more using offset and maxChars only if needed.", parameters: { url: "string", offset: "number", maxChars: "number" } },
  { name: "search_skill_library", description: "Search the OpenClaw skill library for relevant tools or skills.", parameters: { query: "string", limit: "number" } },
  { name: "inspect_skill_library", description: "Inspect a specific OpenClaw skill by slug before deciding to install it.", parameters: { slug: "string" } },
  { name: "install_skill", description: "Request installation of an OpenClaw skill. This requires explicit user approval and should not be used autonomously.", parameters: { slug: "string" } },
  { name: "request_skill_installation", description: "Record a request to install an OpenClaw skill later when autonomous approval is not allowed.", parameters: { slug: "string", reason: "string", skillName: "string", taskSummary: "string" } },
  { name: "request_tool_addition", description: "Record a request for a missing built-in tool or capability discovered during work.", parameters: { requestedTool: "string", reason: "string", skillSlug: "string", skillName: "string", taskSummary: "string" } },
  { name: "list_installed_skills", description: "List OpenClaw skills already installed in the observer sandbox workspace." },
  { name: "send_mail", description: "Send an email to a direct address", parameters: { toEmail: "string", subject: "string", text: "string" } },
  { name: "move_mail", description: "Move a recent inbox email to trash or archive using destination plus one of messageId, uid, subjectContains, fromContains, or latest", parameters: { destination: "string", messageId: "string", uid: "number", subjectContains: "string", fromContains: "string", latest: "boolean" } },
  { name: "list_wordpress_sites", description: "List configured WordPress sites available through the Nova bridge plugin." },
  { name: "save_wordpress_site", description: "Save or update a WordPress site connection for the Nova bridge plugin.", parameters: { siteId: "string", label: "string", baseUrl: "string", keyId: "string", sharedSecret: "string", defaultStatus: "draft|publish|private|pending|future" } },
  { name: "remove_wordpress_site", description: "Remove a configured WordPress site connection.", parameters: { siteId: "string" } },
  { name: "wordpress_test_connection", description: "Test the authenticated connection to a configured WordPress site.", parameters: { siteId: "string", timeoutMs: "number" } },
  { name: "wordpress_upsert_post", description: "Create or update a WordPress post on a configured site. Use wordpressPostId/postId or slug to update an existing post.", parameters: { siteId: "string", wordpressPostId: "number", postId: "number", title: "string", content: "string", slug: "string", excerpt: "string", status: "draft|publish|private|pending|future", postType: "string", categories: "array|string", tags: "array|string", timeoutMs: "number" } },
  { name: "export_pdf", description: "Export text to a PDF file", parameters: { path: "string", text: "string" } },
  { name: "read_pdf", description: "Read text from a PDF document", parameters: { path: "string" } },
  { name: "zip", description: "Zip a file or directory", parameters: { source: "string", destination: "string" } },
  { name: "unzip", description: "Unzip a zip archive", parameters: { source: "string", destination: "string" } }
];

async function executeWorkerToolCall(toolCall, context) {
  const normalized = normalizeToolCallRecord(toolCall);
  const name = normalizeToolName(normalized?.function?.name || "");
  const args = parseToolCallArgs(normalized);
  await ensureAutonomousToolApproved(name);
  if (name === "list_files") return toolListFiles(args);
  if (name === "read_document") return toolReadDocument(args, context);
  if (name === "read_file") return toolReadFile(args);
  if (name === "write_file") return toolWriteFile(args);
  if (name === "edit_file") return toolEditFile(args);
  if (name === "move_path") return toolMovePath(args);
  if (name === "shell_command") return toolShellCommand(args);
  if (name === "web_fetch") return toolWebFetch(args, context);
  if (name === "search_skill_library") return searchSkillLibrary(args.query, args.limit);
  if (name === "inspect_skill_library") return inspectSkillLibrarySkill(args.slug);
  if (name === "install_skill") throw new Error("install_skill requires explicit user approval");
  if (name === "request_skill_installation") return recordSkillInstallationRequest({ ...args, requestedBy: "worker", source: "worker-tool" });
  if (name === "request_tool_addition") return recordToolAdditionRequest({ ...args, requestedBy: "worker", source: "worker-tool" });
  if (name === "list_installed_skills") return { skills: await listInstalledSkills() };
  if (name === "send_mail") return toolSendMail(args);
  if (name === "move_mail") return toolMoveMail(args);
  if (name === "list_wordpress_sites") return toolListWordPressSites();
  if (name === "save_wordpress_site") return toolSaveWordPressSite(args);
  if (name === "remove_wordpress_site") return toolRemoveWordPressSite(args);
  if (name === "wordpress_test_connection") return toolWordPressTestConnection(args);
  if (name === "wordpress_upsert_post") return toolWordPressUpsertPost(args);
  if (name === "export_pdf") return toolExportPdf(args);
  if (name === "read_pdf") return toolReadPdf(args);
  if (name === "zip") return toolZip(args);
  if (name === "unzip") return toolUnzip(args);
  throw new Error(`unknown tool: ${name}`);
}

async function toolExportPdf(args = {}) {
  const target = resolveToolPath(getToolPathArg(args));
  const text = String(args.text || "");
  
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  
  page.drawText(text, {
    x: 50,
    y: height - 50,
    size: 12,
    font: font,
    color: rgb(0, 0, 0),
    maxWidth: width - 100,
    lineHeight: 16
  });
  
  const pdfBytes = await pdfDoc.save();
  const base64Buffer = Buffer.from(pdfBytes).toString("base64");
  
  await writeContainerBinaryFile(target, base64Buffer);
  
  return { success: true, path: target };
}

async function toolReadPdf(args = {}) {
  const target = resolveToolPath(getToolPathArg(args));
  const maxReadBytes = 10 * 1024 * 1024;
  
  const bufferResult = await readContainerFileBuffer(target, { maxBytes: maxReadBytes });
  const data = await pdfParse(bufferResult);
  
  return { text: data.text, numpages: data.numpages, info: data.info };
}

async function toolZip(args = {}) {
  const source = resolveToolPath(args.source);
  const destination = resolveToolPath(args.destination);
  
  const result = await runSandboxShell(`zip -r "${destination}" "${source}"`, {
    timeoutMs: 60000
  });
  
  return { success: result.ok, stdout: result.stdout, stderr: result.stderr };
}

async function toolUnzip(args = {}) {
  const source = resolveToolPath(args.source);
  const destination = resolveToolPath(args.destination);
  
  const result = await runSandboxShell(`unzip "${source}" -d "${destination}"`, {
    timeoutMs: 60000
  });
  
  return { success: result.ok, stdout: result.stdout, stderr: result.stderr };
}

async function createQueuedTask({
  message,
  sessionId = "Main",
  requestedBrainId = "worker",
  intakeBrainId = "bitnet",
  internetEnabled = observerConfig.defaults.internetEnabled,
  selectedMountIds = observerConfig.defaults.mountIds,
  forceToolUse = false,
  requireWorkerPreflight = false,
  attachments = [],
  helperAnalysis = null,
  notes = "Observer queued task for deferred processing.",
  taskMeta = {}
}) {
  let requestedBrain = await getBrain(String(requestedBrainId || "worker"));
  const internalCpuJob = String(taskMeta?.internalJobType || "").trim();
  const lockRequestedBrain = taskMeta?.lockRequestedBrain === true;
  const allowsInternalQueueJob = internalCpuJob && (requestedBrain.kind === "intake" || requestedBrain.kind === "helper");
  if ((!requestedBrain.toolCapable || requestedBrain.kind !== "worker") && !allowsInternalQueueJob) {
    throw new Error(`brain "${requestedBrain.id}" cannot process queued tool tasks`);
  }
  let specialistRoute = taskMeta?.specialistRoute && typeof taskMeta.specialistRoute === "object"
    ? taskMeta.specialistRoute
    : null;
  if (!lockRequestedBrain && !specialistRoute && requestedBrain.kind === "worker" && requestedBrain.toolCapable) {
    specialistRoute = await selectSpecialistBrainRoute({
      message,
      notes,
      ...taskMeta
    }, {
      preferredBrainId: requestedBrain.id
    });
    if (specialistRoute?.preferredBrainId) {
      requestedBrain = await getBrain(specialistRoute.preferredBrainId);
    }
  }
  const inferredSpecialty = inferTaskSpecialty({
    message,
    notes,
    attachments: Array.isArray(attachments) ? attachments : [],
    ...taskMeta
  });
  const creativeHandoffBrain = !String(taskMeta?.creativeHandoffBrainId || "").trim()
    && inferredSpecialty === "creative"
    && requestedBrain.kind === "worker"
    && requestedBrain.toolCapable
      ? await chooseCreativeHandoffBrain({ excludeBrainId: requestedBrain.id })
      : null;
  const resolvedTaskMeta = {
    ...taskMeta,
    ...(creativeHandoffBrain?.id ? { creativeHandoffBrainId: creativeHandoffBrain.id } : {})
  };

  const preparedAttachments = await prepareAttachments(Array.isArray(attachments) ? attachments : []);
  const now = Date.now();
  const task = {
    id: `task-${now}`,
    codename: formatTaskCodename(`task-${now}`),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    sessionId,
    intakeBrainId,
    requestedBrainId: requestedBrain.id,
    requestedBrainLabel: requestedBrain.label,
    internetEnabled,
    mountIds: selectedMountIds,
    forceToolUse,
    requireWorkerPreflight,
    message: String(message || "").trim(),
    attachments: preparedAttachments?.files || [],
    helperAnalysis: helperAnalysis && typeof helperAnalysis === "object" ? helperAnalysis : undefined,
    specialistRoute: specialistRoute || undefined,
    specialistAttemptedBrainIds: [],
    queueLane: getBrainQueueLane(requestedBrain),
    notes,
    ...resolvedTaskMeta
  };
  const filePath = await writeTask(task);
  const queuedTask = {
    ...task,
    filePath,
    workspacePath: workspaceTaskPath("queued", task.id)
  };
  await recordTaskBreadcrumb({
    taskId: queuedTask.id,
    eventType: "task.created",
    toStatus: "queued",
    toPath: filePath,
    toWorkspacePath: queuedTask.workspacePath,
    reason: notes,
    sessionId: queuedTask.sessionId,
    brainId: queuedTask.requestedBrainId
  });
  broadcastObserverEvent({
    type: "task.queued",
    task: queuedTask
  });
  scheduleTaskDispatch();
  return queuedTask;
}

function buildRetryTaskMeta(task = {}, extra = {}) {
  return {
    ...(String(task.rootTaskId || task.id || "").trim() ? { rootTaskId: String(task.rootTaskId || task.id).trim() } : {}),
    reshapeAttemptCount: Math.max(0, Number(task.reshapeAttemptCount || 0)) + 1,
    ...(String(task.reshapeIssueKey || "").trim() ? { reshapeIssueKey: String(task.reshapeIssueKey).trim() } : {}),
    ...(String(task.internalJobType || "").trim() ? { internalJobType: String(task.internalJobType).trim() } : {}),
    ...(String(task.specialtyHint || "").trim() ? { specialtyHint: String(task.specialtyHint).trim() } : {}),
    ...(String(task.creativeHandoffBrainId || "").trim() ? { creativeHandoffBrainId: String(task.creativeHandoffBrainId).trim() } : {}),
    ...(String(task.projectName || "").trim() ? { projectName: String(task.projectName).trim() } : {}),
    ...(String(task.projectPath || "").trim() ? { projectPath: String(task.projectPath).trim() } : {}),
    ...(String(task.projectWorkKey || "").trim() ? { projectWorkKey: String(task.projectWorkKey).trim() } : {}),
    ...(String(task.projectWorkFocus || "").trim() ? { projectWorkFocus: String(task.projectWorkFocus).trim() } : {}),
    ...(String(task.projectWorkSource || "").trim() ? { projectWorkSource: String(task.projectWorkSource).trim() } : {}),
    ...(String(task.projectWorkRoleName || "").trim() ? { projectWorkRoleName: String(task.projectWorkRoleName).trim() } : {}),
    ...(String(task.projectWorkRoleReason || "").trim() ? { projectWorkRoleReason: String(task.projectWorkRoleReason).trim() } : {}),
    ...(String(task.projectWorkRolePlaybook || "").trim() ? { projectWorkRolePlaybook: String(task.projectWorkRolePlaybook).trim() } : {}),
    ...(String(task.projectWorkPrimaryTarget || "").trim() ? { projectWorkPrimaryTarget: String(task.projectWorkPrimaryTarget).trim() } : {}),
    ...(String(task.projectWorkSecondaryTarget || "").trim() ? { projectWorkSecondaryTarget: String(task.projectWorkSecondaryTarget).trim() } : {}),
    ...(String(task.projectWorkTertiaryTarget || "").trim() ? { projectWorkTertiaryTarget: String(task.projectWorkTertiaryTarget).trim() } : {}),
    ...(String(task.projectWorkExpectedFirstMove || "").trim() ? { projectWorkExpectedFirstMove: String(task.projectWorkExpectedFirstMove).trim() } : {}),
    ...extra
  };
}

function getTaskRootId(task = {}) {
  return String(task?.rootTaskId || task?.id || "").trim();
}

function getTaskReshapeAttemptCount(task = {}) {
  return Math.max(0, Number(task?.reshapeAttemptCount || 0));
}

function canReshapeTask(task = {}, increment = 1) {
  return getTaskReshapeAttemptCount(task) + Math.max(0, Number(increment || 0)) <= MAX_TASK_RESHAPE_ATTEMPTS;
}

function normalizeReshapeSignatureText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[a-z]:\\[^\s"]+/gi, "<path>")
    .replace(/\/home\/openclaw\/[^\s"]+/gi, "<path>")
    .replace(/\btask-\d+\b/gi, "task")
    .replace(/\b\d{2,}\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTaskReshapeLogEntries(raw = "") {
  return String(raw || "")
    .split(/^##\s+/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const timestamp = String(lines.shift() || "").trim();
      const entry = {
        at: Number(new Date(timestamp).getTime() || 0),
        taskId: "",
        taskCodename: "",
        rootTaskId: "",
        phase: "",
        action: "",
        classification: "",
        recurrenceCount: 0,
        uniqueRootTaskCount: 0,
        reason: "",
        improvement: ""
      };
      for (const line of lines) {
        const match = line.match(/^- ([^:]+):\s*(.*)$/);
        if (!match) {
          continue;
        }
        const key = String(match[1] || "").trim().toLowerCase();
        const value = String(match[2] || "").trim();
        if (key === "task") {
          const taskMatch = value.match(/^(.*)\((task-\d+)\)$/i);
          if (taskMatch) {
            entry.taskCodename = String(taskMatch[1] || "").trim();
            entry.taskId = String(taskMatch[2] || "").trim();
          } else {
            entry.taskCodename = value;
          }
          continue;
        }
        if (key === "root task") {
          entry.rootTaskId = value;
          continue;
        }
        if (key === "phase") {
          entry.phase = value;
          continue;
        }
        if (key === "action") {
          entry.action = value;
          continue;
        }
        if (key === "classification") {
          entry.classification = value;
          continue;
        }
        if (key === "recurrence count") {
          entry.recurrenceCount = Number(value || 0);
          continue;
        }
        if (key === "unique job count") {
          entry.uniqueRootTaskCount = Number(value || 0);
          continue;
        }
        if (key === "reason") {
          entry.reason = value;
          continue;
        }
        if (key === "improvement") {
          entry.improvement = value;
        }
      }
      return entry;
    })
    .filter((entry) => entry.at > 0 && (entry.taskId || entry.reason || entry.classification));
}

function buildTaskReshapeIssueStateFromLogEntries(entries = []) {
  const issues = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const signatureSeed = [
      String(entry.classification || "unknown").trim().toLowerCase() || "unknown",
      normalizeReshapeSignatureText(entry.reason || entry.improvement || entry.taskCodename || entry.taskId || "")
    ].join("|");
    const issueKey = hashRef(signatureSeed || `reshape-${entry.at}`);
    const existing = issues[issueKey] || {
      issueKey,
      signature: signatureSeed,
      classification: String(entry.classification || "unknown").trim() || "unknown",
      firstSeenAt: Number(entry.at || 0),
      lastSeenAt: Number(entry.at || 0),
      occurrenceCount: 0,
      uniqueRootTaskCount: 0,
      rootTaskIds: [],
      recentTaskIds: []
    };
    const rootTaskIds = new Set((Array.isArray(existing.rootTaskIds) ? existing.rootTaskIds : []).filter(Boolean));
    if (entry.rootTaskId) {
      rootTaskIds.add(String(entry.rootTaskId).trim());
    }
    const recentTaskIds = [
      ...(Array.isArray(existing.recentTaskIds) ? existing.recentTaskIds : []).filter(Boolean),
      String(entry.taskId || "").trim()
    ].filter(Boolean).slice(-20);
    issues[issueKey] = {
      ...existing,
      issueKey,
      signature: signatureSeed,
      classification: String(entry.classification || existing.classification || "unknown").trim() || "unknown",
      firstSeenAt: Math.min(Number(existing.firstSeenAt || entry.at || 0), Number(entry.at || existing.firstSeenAt || 0)),
      lastSeenAt: Math.max(Number(existing.lastSeenAt || 0), Number(entry.at || 0)),
      occurrenceCount: Math.max(Number(existing.occurrenceCount || 0) + 1, Number(entry.recurrenceCount || 0) || 1),
      uniqueRootTaskCount: Math.max(rootTaskIds.size, Number(entry.uniqueRootTaskCount || 0)),
      rootTaskIds: [...rootTaskIds].slice(-50),
      recentTaskIds,
      lastTaskId: String(entry.taskId || existing.lastTaskId || "").trim(),
      lastTaskCodename: String(entry.taskCodename || existing.lastTaskCodename || "").trim(),
      lastSourceTaskId: String(entry.taskId || existing.lastSourceTaskId || "").trim(),
      lastSourceTaskCodename: String(entry.taskCodename || existing.lastSourceTaskCodename || "").trim(),
      lastRequestedBrainId: String(existing.lastRequestedBrainId || "").trim(),
      lastRequestedBrainLabel: String(existing.lastRequestedBrainLabel || "").trim(),
      lastAttemptedBrains: Array.isArray(existing.lastAttemptedBrains) ? existing.lastAttemptedBrains : [],
      lastOutcomeSummary: String(existing.lastOutcomeSummary || "").trim(),
      lastTaskMessage: String(existing.lastTaskMessage || "").trim(),
      lastReason: compactTaskText(String(entry.reason || existing.lastReason || "").trim(), 320),
      lastImprovement: compactTaskText(String(entry.improvement || existing.lastImprovement || "").trim(), 320),
      lastPhase: String(entry.phase || existing.lastPhase || "").trim(),
      lastAction: String(entry.action || existing.lastAction || "").trim()
    };
  }
  return {
    issues,
    events: []
  };
}

async function buildTaskReshapeIssueStateFromLog() {
  try {
    const raw = await fs.readFile(TASK_RESHAPE_LOG_PATH, "utf8");
    return buildTaskReshapeIssueStateFromLogEntries(parseTaskReshapeLogEntries(raw));
  } catch {
    return {
      issues: {},
      events: []
    };
  }
}

async function getEffectiveTaskReshapeIssueState() {
  const state = await loadTaskReshapeIssueState();
  if (Object.keys(state?.issues || {}).length) {
    return state;
  }
  const recovered = await buildTaskReshapeIssueStateFromLog();
  if (Object.keys(recovered?.issues || {}).length) {
    return recovered;
  }
  return state;
}

function buildReshapeIssueSignature({ task = {}, sourceTask = null, classification = "", reason = "", improvement = "" } = {}) {
  const anchorTask = sourceTask && typeof sourceTask === "object" ? sourceTask : task;
  const summary = compactTaskText(
    String(reason || improvement || anchorTask?.resultSummary || anchorTask?.reviewSummary || anchorTask?.workerSummary || anchorTask?.notes || anchorTask?.message || "").trim(),
    220
  );
  const normalizedSummary = normalizeReshapeSignatureText(summary);
  const normalizedClassification = String(classification || anchorTask?.failureClassification || "").trim().toLowerCase() || "unknown";
  return `${normalizedClassification}|${normalizedSummary || "unspecified"}`;
}

async function loadTaskReshapeIssueState() {
  if (taskReshapeIssueState) {
    return taskReshapeIssueState;
  }
  try {
    const raw = await fs.readFile(TASK_RESHAPE_ISSUES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    taskReshapeIssueState = {
      issues: parsed?.issues && typeof parsed.issues === "object" ? parsed.issues : {},
      events: Array.isArray(parsed?.events) ? parsed.events : []
    };
  } catch {
    taskReshapeIssueState = {
      issues: {},
      events: []
    };
  }
  return taskReshapeIssueState;
}

async function saveTaskReshapeIssueState() {
  const state = await loadTaskReshapeIssueState();
  const normalizedIssues = Object.fromEntries(
    Object.entries(state.issues || {})
      .filter(([key]) => String(key || "").trim())
      .map(([key, value]) => [
        key,
        {
          issueKey: String(value?.issueKey || key).trim(),
          signature: String(value?.signature || "").trim(),
          classification: String(value?.classification || "unknown").trim(),
          firstSeenAt: Number(value?.firstSeenAt || 0),
          lastSeenAt: Number(value?.lastSeenAt || 0),
          occurrenceCount: Math.max(0, Number(value?.occurrenceCount || 0)),
          uniqueRootTaskCount: Math.max(0, Number(value?.uniqueRootTaskCount || 0)),
          lastTaskId: String(value?.lastTaskId || "").trim(),
          lastTaskCodename: String(value?.lastTaskCodename || "").trim(),
          lastSourceTaskId: String(value?.lastSourceTaskId || "").trim(),
          lastSourceTaskCodename: String(value?.lastSourceTaskCodename || "").trim(),
          lastRequestedBrainId: String(value?.lastRequestedBrainId || "").trim(),
          lastRequestedBrainLabel: String(value?.lastRequestedBrainLabel || "").trim(),
          lastAttemptedBrains: Array.isArray(value?.lastAttemptedBrains) ? value.lastAttemptedBrains.slice(-8) : [],
          lastOutcomeSummary: String(value?.lastOutcomeSummary || "").trim(),
          lastTaskMessage: String(value?.lastTaskMessage || "").trim(),
          lastReason: String(value?.lastReason || "").trim(),
          lastImprovement: String(value?.lastImprovement || "").trim(),
          lastPhase: String(value?.lastPhase || "").trim(),
          lastAction: String(value?.lastAction || "").trim(),
          rootTaskIds: Array.isArray(value?.rootTaskIds) ? value.rootTaskIds.slice(-50) : [],
          recentTaskIds: Array.isArray(value?.recentTaskIds) ? value.recentTaskIds.slice(-20) : []
        }
      ])
  );
  const normalizedEvents = Array.isArray(state.events) ? state.events.slice(-500) : [];
  taskReshapeIssueState = {
    issues: normalizedIssues,
    events: normalizedEvents
  };
  await writeVolumeText(TASK_RESHAPE_ISSUES_PATH, `${JSON.stringify(taskReshapeIssueState, null, 2)}\n`);
}

async function resetTaskReshapeIssueState() {
  const state = await loadTaskReshapeIssueState();
  const clearedIssueCount = Object.keys(state?.issues || {}).length;
  const clearedEventCount = Array.isArray(state?.events) ? state.events.length : 0;
  taskReshapeIssueState = {
    issues: {},
    events: []
  };
  await writeVolumeText(TASK_RESHAPE_ISSUES_PATH, `${JSON.stringify(taskReshapeIssueState, null, 2)}\n`);
  await writeVolumeText(TASK_RESHAPE_LOG_PATH, "");
  return {
    clearedIssueCount,
    clearedEventCount
  };
}

async function listTaskReshapeIssues({ limit = 12 } = {}) {
  const state = await getEffectiveTaskReshapeIssueState();
  const issueEntries = Object.values(state?.issues || {})
    .filter((entry) => entry && typeof entry === "object")
    .sort((left, right) => {
      const rightScore = Number(right.lastSeenAt || right.firstSeenAt || 0);
      const leftScore = Number(left.lastSeenAt || left.firstSeenAt || 0);
      return rightScore - leftScore;
    })
    .slice(0, Math.max(1, Number(limit || 12)));
  const issues = await Promise.all(issueEntries.map(async (entry) => {
    const sourceTaskId = String(entry.lastSourceTaskId || "").trim() || String(entry.lastTaskId || "").trim();
    const liveTask = sourceTaskId ? await findTaskById(sourceTaskId) : null;
    const attemptedBrains = Array.isArray(entry.lastAttemptedBrains) && entry.lastAttemptedBrains.length
      ? entry.lastAttemptedBrains
      : [
          ...(Array.isArray(liveTask?.specialistAttemptedBrainIds) ? liveTask.specialistAttemptedBrainIds : []),
          String(liveTask?.requestedBrainId || "").trim()
        ].map((value) => String(value || "").trim()).filter(Boolean);
    const synthesizedReason = buildConcreteReviewReason({
      task: liveTask || {},
      sourceTask: liveTask || null,
      attemptedBrains,
      classification: String(entry.classification || liveTask?.failureClassification || "").trim(),
      fallback: String(entry.lastReason || "").trim()
    });
    return {
      issueKey: String(entry.issueKey || "").trim(),
      classification: String(entry.classification || "unknown").trim(),
      signature: String(entry.signature || "").trim(),
      occurrenceCount: Math.max(0, Number(entry.occurrenceCount || 0)),
      uniqueRootTaskCount: Math.max(0, Number(entry.uniqueRootTaskCount || 0)),
      firstSeenAt: Number(entry.firstSeenAt || 0),
      lastSeenAt: Number(entry.lastSeenAt || 0),
      lastTaskId: String(entry.lastTaskId || "").trim(),
      lastTaskCodename: String(entry.lastTaskCodename || "").trim(),
      lastSourceTaskId: sourceTaskId,
      lastSourceTaskCodename: String(entry.lastSourceTaskCodename || liveTask?.codename || "").trim(),
      lastRequestedBrainId: String(entry.lastRequestedBrainId || liveTask?.requestedBrainId || "").trim(),
      lastRequestedBrainLabel: String(entry.lastRequestedBrainLabel || liveTask?.requestedBrainLabel || liveTask?.requestedBrainId || "").trim(),
      lastAttemptedBrains: [...new Set(attemptedBrains)].slice(-8),
      lastOutcomeSummary: compactTaskText(String(entry.lastOutcomeSummary || liveTask?.resultSummary || liveTask?.reviewSummary || liveTask?.workerSummary || liveTask?.notes || "").trim(), 320),
      lastTaskMessage: compactTaskText(String(entry.lastTaskMessage || liveTask?.originalMessage || liveTask?.message || "").trim(), 220),
      lastReason: compactTaskText(String(entry.lastReason || synthesizedReason || "").trim(), 220) || synthesizedReason,
      lastImprovement: compactTaskText(String(entry.lastImprovement || "").trim(), 220),
      lastPhase: String(entry.lastPhase || "").trim(),
      lastAction: String(entry.lastAction || "").trim()
    };
  }));
  const criticalCount = issues.filter((entry) => /critical/i.test(String(entry.lastAction || ""))).length;
  return {
    issues,
    summary: {
      totalIssues: Object.keys(state?.issues || {}).length,
      visibleIssues: issues.length,
      criticalVisibleCount: criticalCount
    }
  };
}

async function recordTaskReshapeReview({
  task = {},
  sourceTask = null,
  phase = "review",
  action = "reviewed",
  reason = "",
  improvement = "",
  classification = "",
  willResubmit = false,
  critical = false
} = {}) {
  const anchorTask = sourceTask && typeof sourceTask === "object" ? sourceTask : task;
  const taskId = String(task?.id || anchorTask?.id || "").trim();
  if (!taskId) {
    return null;
  }
  const rootTaskId = getTaskRootId(anchorTask) || taskId;
  const finalClassification = String(classification || anchorTask?.failureClassification || classifyFailureText(reason || improvement || anchorTask?.resultSummary || anchorTask?.reviewSummary || anchorTask?.workerSummary || anchorTask?.notes || "")).trim() || "unknown";
  const signature = buildReshapeIssueSignature({
    task,
    sourceTask: anchorTask,
    classification: finalClassification,
    reason,
    improvement
  });
  const issueKey = hashRef(signature);
  const now = Date.now();
  const state = await loadTaskReshapeIssueState();
  const existing = state.issues?.[issueKey] && typeof state.issues[issueKey] === "object"
    ? state.issues[issueKey]
    : {
        issueKey,
        signature,
        classification: finalClassification,
        firstSeenAt: now,
        lastSeenAt: now,
        occurrenceCount: 0,
        uniqueRootTaskCount: 0,
        rootTaskIds: [],
        recentTaskIds: []
      };
  const rootTaskIds = new Set((Array.isArray(existing.rootTaskIds) ? existing.rootTaskIds : []).map((value) => String(value || "").trim()).filter(Boolean));
  if (rootTaskId) {
    rootTaskIds.add(rootTaskId);
  }
  const attemptedBrains = [
    ...(Array.isArray(task?.specialistAttemptedBrainIds) ? task.specialistAttemptedBrainIds : []),
    ...(Array.isArray(anchorTask?.specialistAttemptedBrainIds) ? anchorTask.specialistAttemptedBrainIds : []),
    String(anchorTask?.requestedBrainId || "").trim()
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const recentTaskIds = [
    ...(Array.isArray(existing.recentTaskIds) ? existing.recentTaskIds : []).map((value) => String(value || "").trim()).filter(Boolean),
    taskId
  ].slice(-20);
  const updated = {
    ...existing,
    issueKey,
    signature,
    classification: finalClassification,
    lastSeenAt: now,
    occurrenceCount: Math.max(0, Number(existing.occurrenceCount || 0)) + 1,
    uniqueRootTaskCount: rootTaskIds.size,
    rootTaskIds: [...rootTaskIds].slice(-50),
    recentTaskIds,
    lastTaskId: taskId,
    lastTaskCodename: String(task?.codename || anchorTask?.codename || "").trim(),
    lastSourceTaskId: String(anchorTask?.id || "").trim(),
    lastSourceTaskCodename: String(anchorTask?.codename || "").trim(),
    lastRequestedBrainId: String(anchorTask?.requestedBrainId || "").trim(),
    lastRequestedBrainLabel: String(anchorTask?.requestedBrainLabel || anchorTask?.requestedBrainId || "").trim(),
    lastAttemptedBrains: [...new Set(attemptedBrains)].slice(-8),
    lastOutcomeSummary: compactTaskText(String(anchorTask?.resultSummary || anchorTask?.reviewSummary || anchorTask?.workerSummary || anchorTask?.notes || "").trim(), 320),
    lastTaskMessage: compactTaskText(String(anchorTask?.originalMessage || anchorTask?.message || "").trim(), 220),
    lastReason: compactTaskText(String(reason || "").trim(), 320),
    lastImprovement: compactTaskText(String(improvement || "").trim(), 320),
    lastPhase: String(phase || "review").trim(),
    lastAction: String(action || "reviewed").trim()
  };
  state.issues[issueKey] = updated;
  state.events.push({
    at: now,
    taskId,
    taskCodename: String(task?.codename || anchorTask?.codename || "").trim(),
    sourceTaskId: String(anchorTask?.id || "").trim(),
    rootTaskId,
    issueKey,
    phase: String(phase || "review").trim(),
    action: String(action || "reviewed").trim(),
    classification: finalClassification,
    reason: compactTaskText(String(reason || "").trim(), 320),
    improvement: compactTaskText(String(improvement || "").trim(), 320),
    reshapeAttemptCount: getTaskReshapeAttemptCount(anchorTask),
    willResubmit: willResubmit === true,
    critical: critical === true,
    recurrenceCount: updated.occurrenceCount,
    uniqueRootTaskCount: updated.uniqueRootTaskCount
  });
  await saveTaskReshapeIssueState();

  const logLines = [
    `## ${new Date(now).toISOString()}`,
    `- Task: ${updated.lastTaskCodename || taskId} (${taskId})`,
    `- Root task: ${rootTaskId || "unknown"}`,
    `- Phase: ${String(phase || "review").trim() || "review"}`,
    `- Action: ${String(action || "reviewed").trim() || "reviewed"}`,
    `- Classification: ${finalClassification}`,
    `- Recurrence count: ${updated.occurrenceCount}`,
    `- Unique job count: ${updated.uniqueRootTaskCount}`,
    `- Reshape attempts so far: ${getTaskReshapeAttemptCount(anchorTask)}/${MAX_TASK_RESHAPE_ATTEMPTS}`,
    `- Will resubmit: ${willResubmit === true ? "yes" : "no"}`,
    `- Critical: ${critical === true ? "yes" : "no"}`,
    `- Reason: ${compactTaskText(String(reason || "").trim(), 320) || "n/a"}`,
    `- Improvement: ${compactTaskText(String(improvement || "").trim(), 320) || "n/a"}`,
    ""
  ];
  await fs.mkdir(path.dirname(TASK_RESHAPE_LOG_PATH), { recursive: true });
  await fs.appendFile(TASK_RESHAPE_LOG_PATH, `${logLines.join("\n")}\n`, "utf8");
  return updated;
}

function buildFailureReshapeMessage(task = {}, improvement = "") {
  const failureClassification = String(task?.failureClassification || classifyFailureText(task?.resultSummary || task?.reviewSummary || task?.workerSummary || task?.notes || "")).trim();
  const retryMessage = compactTaskText(
    String(improvement || "").trim(),
    500
  ) || compactTaskText(buildCapabilityMismatchRetryMessage(task, failureClassification).replace(String(task?.message || "").trim(), "").trim(), 500);
  if (String(task?.internalJobType || "").trim() === "project_cycle") {
    return buildProjectCycleFollowUpMessage(task, { retryNote: retryMessage || failureClassification });
  }
  return [String(task?.message || "").trim(), "", compactTaskText(retryMessage || `Retry note: address the previous ${failureClassification || "failed"} outcome and keep the next pass concrete.`, 320)]
    .filter(Boolean)
    .join("\n");
}

async function markTaskCriticalFailure(task = {}, reason = "") {
  if (!task?.id) {
    return task;
  }
  const updatedTask = materializeTaskRecord({
    ...task,
    criticalFailure: true,
    criticalFailureAt: Date.now(),
    criticalFailureReason: compactTaskText(String(reason || "").trim(), 320),
    notes: compactTaskText(`${String(task.notes || "").trim()} Critical failure: ${String(reason || "").trim()}`.trim(), 320)
  });
  await writeVolumeText(updatedTask.filePath, `${JSON.stringify(updatedTask, null, 2)}\n`);
  return updatedTask;
}

async function attachHelperAnalysisToRelatedTasks({
  message,
  sessionId = "Main",
  helperAnalysis = null
} = {}) {
  if (!helperAnalysis || !String(message || "").trim()) {
    return 0;
  }
  const { queued, inProgress } = await listAllTasks();
  const candidates = [...queued, ...inProgress]
    .filter((task) => String(task.sessionId || "") === String(sessionId || "Main"))
    .filter((task) => String(task.message || "").trim() === String(message || "").trim())
    .filter((task) => !task.helperAnalysis?.summary && !task.helperAnalysis?.intent);
  let updated = 0;
  for (const task of candidates) {
    const nextTask = {
      ...task,
      updatedAt: Date.now(),
      helperAnalysis
    };
    await writeTask(nextTask);
    broadcastObserverEvent({
      type: "task.updated",
      task: {
        ...nextTask,
        filePath: taskPathForStatus(nextTask.id, nextTask.status),
        workspacePath: workspaceTaskPath(nextTask.status, nextTask.id)
      }
    });
    updated += 1;
  }
  return updated;
}

async function abortActiveTask(taskId = "", reason = "Aborted by user.") {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    throw new Error("taskId is required");
  }
  const task = await findTaskById(normalizedTaskId);
  if (!task) {
    throw new Error("task not found");
  }
  if (String(task.status || "") !== "in_progress") {
    throw new Error("task is not currently in progress");
  }
  const controller = activeTaskControllers.get(normalizedTaskId);
  if (controller) {
    controller.abort();
  }
  const abortedAt = Date.now();
  const updatedTask = {
    ...task,
    updatedAt: abortedAt,
    abortRequestedAt: abortedAt,
    progressNote: "Abort requested. Stopping active work.",
    notes: compactTaskText(reason, 240)
  };
  const inProgressPath = taskPathForStatus(normalizedTaskId, "in_progress");
  await writeVolumeText(inProgressPath, `${JSON.stringify(updatedTask, null, 2)}\n`);
  broadcastObserverEvent({
    type: "task.progress",
    task: updatedTask
  });
  return updatedTask;
}

async function forceStopTask(taskId = "", reason = "Force-cleared by user.") {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    throw new Error("taskId is required");
  }
  const task = await findTaskById(normalizedTaskId);
  if (!task) {
    throw new Error("task not found");
  }
  if (String(task.status || "") !== "in_progress") {
    throw new Error("task is not currently in progress");
  }
  const now = Date.now();
  const controller = activeTaskControllers.get(normalizedTaskId);
  if (controller) {
    controller.abort();
    activeTaskControllers.delete(normalizedTaskId);
  }
  return closeTaskRecord({
    ...task,
    updatedAt: now,
    abortRequestedAt: Number(task.abortRequestedAt || 0) || now,
    aborted: true,
    abortedAt: now,
    progressNote: "Force-cleared by user.",
    workerSummary: String(task.workerSummary || "").trim(),
    reviewSummary: String(task.reviewSummary || "").trim(),
    resultSummary: compactTaskText(
      String(task.resultSummary || reason || "Force-cleared by user.").trim(),
      420
    ),
    notes: compactTaskText(String(reason || "Force-cleared by user.").trim(), 240)
  }, reason || "Force-cleared by user.");
}

const {
  answerWaitingTask: observerAnswerWaitingTask,
  buildTodoTextFromWaitingQuestion: observerBuildTodoTextFromWaitingQuestion,
  shouldRouteWaitingTaskToTodo: observerShouldRouteWaitingTaskToTodo
} = createObserverWaitingTaskHandling({
  assessEmailSourceIdentity,
  broadcastObserverEvent,
  buildMailCommandRecord,
  closeTaskRecord,
  compactTaskText,
  describeSourceTrust,
  findTaskById,
  getAppTrustConfig,
  getMailState: () => mailState,
  getObserverConfig: () => observerConfig,
  handleIncomingMailCommand,
  handleMailWatchWaitingAnswer,
  normalizeAppTrustConfig,
  normalizeCombinedTrustRecord,
  normalizeSourceIdentityRecord,
  normalizeTrustLevel,
  persistTaskTransition,
  refreshRecentMailTrustForSource,
  resolveMailCommandSourceIdentity,
  sanitizeTrustRecordForConfig,
  saveObserverConfig,
  scheduleTaskDispatch,
  setObserverConfig: (nextConfig) => {
    observerConfig = nextConfig;
  },
  trustLevelLabel,
  upsertTrustRecord
});

async function createWaitingTask({
  message,
  questionForUser,
  sessionId = "Main",
  requestedBrainId = "worker",
  intakeBrainId = "bitnet",
  internetEnabled = observerConfig.defaults.internetEnabled,
  selectedMountIds = observerConfig.defaults.mountIds,
  forceToolUse = false,
  notes = "Observer is waiting for user direction.",
  taskMeta = {}
}) {
  const requestedBrain = await getBrain(String(requestedBrainId || "worker"));
  const now = Date.now();
  const task = normalizeTaskRecord({
    id: `task-${now}`,
    codename: formatTaskCodename(`task-${now}`),
    status: "waiting_for_user",
    createdAt: now,
    updatedAt: now,
    waitingForUserAt: now,
    answerPending: true,
    sessionId,
    intakeBrainId,
    requestedBrainId: requestedBrain.id,
    requestedBrainLabel: requestedBrain.label,
    internetEnabled,
    mountIds: Array.isArray(selectedMountIds) ? selectedMountIds : [],
    forceToolUse,
    message: String(message || "").trim(),
    originalMessage: String(message || "").trim(),
    questionForUser: compactTaskText(String(questionForUser || "").trim(), 2000),
    queueLane: getBrainQueueLane(requestedBrain),
    notes,
    ...taskMeta
  });
  const savedTask = await writeTaskRecord(task);
  await recordTaskBreadcrumb({
    taskId: savedTask.id,
    eventType: "task.waiting",
    toStatus: "waiting_for_user",
    toPath: savedTask.filePath,
    toWorkspacePath: savedTask.workspacePath,
    reason: notes,
    sessionId: savedTask.sessionId,
    brainId: savedTask.requestedBrainId
  });
  broadcastObserverEvent({
    type: "task.waiting",
    task: savedTask
  });
  return savedTask;
}

async function findRecentCronTaskRuns(seriesId, limit = 3) {
  if (!seriesId) {
    return [];
  }
  const { done, failed } = await listAllTasks();
  return [...done, ...failed]
    .filter((task) => String(task.scheduler?.seriesId || "") === String(seriesId))
    .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
    .slice(0, limit);
}

async function findRecentDuplicateQueuedTask({
  message,
  sessionId = "Main",
  requestedBrainId = "worker",
  intakeBrainId = "bitnet",
  dedupeWindowMs = 8000
} = {}) {
  const trimmedMessage = String(message || "").trim();
  if (!trimmedMessage) {
    return null;
  }
  const now = Date.now();
  const { queued, inProgress, failed } = await listAllTasks();
  return [...queued, ...inProgress, ...failed].find((task) => {
    const taskAgeMs = now - Number(task.updatedAt || task.createdAt || 0);
    if (taskAgeMs < 0 || taskAgeMs > dedupeWindowMs) {
      return false;
    }
    return String(task.message || "").trim() === trimmedMessage
      && String(task.sessionId || "Main") === String(sessionId || "Main")
      && String(task.requestedBrainId || "worker") === String(requestedBrainId || "worker")
      && String(task.intakeBrainId || "bitnet") === String(intakeBrainId || "bitnet");
  }) || null;
}

async function findTaskByOpportunityKey(opportunityKey = "") {
  const key = String(opportunityKey || "").trim();
  if (!key) {
    return null;
  }
  const [queued, inProgress, done, closed] = await Promise.all([
    listTasksByFolder(TASK_QUEUE_INBOX, "queued"),
    listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress"),
    listTasksByFolder(TASK_QUEUE_DONE, "done"),
    listTasksByFolder(TASK_QUEUE_CLOSED, "closed")
  ]);
  return [...queued, ...inProgress, ...done, ...closed].find((task) => String(task.opportunityKey || "") === key) || null;
}

async function findTaskByMaintenanceKey(maintenanceKey = "") {
  const key = String(maintenanceKey || "").trim();
  if (!key) {
    return null;
  }
  const [queued, inProgress, done, closed] = await Promise.all([
    listTasksByFolder(TASK_QUEUE_INBOX, "queued"),
    listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress"),
    listTasksByFolder(TASK_QUEUE_DONE, "done"),
    listTasksByFolder(TASK_QUEUE_CLOSED, "closed")
  ]);
  return [...queued, ...inProgress, ...done, ...closed].find((task) => String(task.maintenanceKey || "") === key) || null;
}

async function closeTaskRecord(task, reason = "") {
  const now = Date.now();
  const closedTask = await persistTaskTransition({
    previousTask: task,
    nextTask: {
    ...task,
    status: "closed",
    closedFromStatus: String(task?.status || "").trim() || "unknown",
    updatedAt: now,
    closedAt: now,
    maintenanceReviewedAt: now,
    maintenanceDecision: "closed",
    maintenanceReason: String(reason || "").trim(),
    notes: String(reason || task.notes || "").trim() || task.notes,
  },
    eventType: "task.closed",
    reason: reason || "Task closed."
  });
  broadcastObserverEvent({
    type: "task.closed",
    task: closedTask
  });
  if (String(task?.status || "").toLowerCase() === "failed") {
    await appendFailureTelemetryEntry({
      task: closedTask,
      phase: "maintenance_close",
      summary: reason || closedTask.resultSummary || closedTask.reviewSummary || closedTask.notes || "",
      classification: classifyFailureText(reason || closedTask.resultSummary || closedTask.reviewSummary || closedTask.notes || "")
    });
  }
  return closedTask;
}

function classifyFailureText(text = "") {
  const lower = String(text || "").toLowerCase();
  if (!lower) return "unknown";
  if (lower.includes("invalid json") || lower.includes("did not return json") || lower.includes("malformed json")) return "invalid_json";
  if (lower.includes("echoed tool results") || lower.includes("assistant decision")) return "invalid_envelope";
  if (lower.includes("before satisfying completion policy")) return "protocol_invalid_finalization";
  if (lower.includes("repeated the same tool plan")) return "repeated_tool_plan";
  if (lower.includes("without concrete progress across 3 consecutive steps")) return "low_value_tool_loop";
  if (lower.includes("made no semantic tool progress across 3 consecutive steps")) return "low_value_tool_loop";
  if (lower.includes("tool loop cap") || lower.includes("never converged to an edit")) return "low_value_tool_loop";
  if (lower.includes("without inspecting concrete files or resources")) return "no_inspection";
  if (lower.includes("without inspecting at least") && lower.includes("distinct concrete targets")) return "no_change_insufficient_inspection";
  if (lower.includes("without naming the inspected targets")) return "no_change_missing_targets";
  if (lower.includes("without changing files") || lower.includes("without changing file") || lower.includes("proving a no-change conclusion")) return "no_concrete_outcome";
  if (lower.includes("empty final response")) return "empty_final_response";
  if (lower.includes("speculative or future-tense")) return "speculative_completion";
  if (lower.includes("stalled") || lower.includes("without a heartbeat")) return "stalled";
  if (lower.includes("fetch failed")) return "tool_fetch_failed";
  if (lower.includes("timed out") || lower.includes("timeout")) return "timeout";
  if (lower.includes("task aborted")) return "aborted";
  return "other";
}

function extractProjectCycleObjectiveText(task = {}) {
  const message = String(task?.message || "").trim();
  const objectiveMatch = message.match(/(?:^|\n)Objective:\s*(.+?)(?:\r?\n|$)/i);
  return String(objectiveMatch?.[1] || task?.projectWorkFocus || "").trim();
}

function isProjectCyclePlanningObjective(task = {}) {
  const objective = extractProjectCycleObjectiveText(task).toLowerCase();
  if (!objective) {
    return false;
  }
  return (
    /\breview the project structure\b/.test(objective)
    || /\bidentify the best runnable or shippable next step\b/.test(objective)
    || /\bidentify the best next step\b/.test(objective)
    || /\bclarify the most shippable next step\b/.test(objective)
    || /\brecord the next concrete step\b/.test(objective)
  );
}

function isCapabilityMismatchFailure(classification = "", task = {}) {
  const normalized = String(classification || "").trim().toLowerCase();
  if (!["speculative_completion", "no_inspection", "no_concrete_outcome", "repeated_tool_plan", "low_value_tool_loop", "no_change_insufficient_inspection", "no_change_missing_targets", "invalid_envelope", "empty_final_response"].includes(normalized)) {
    return false;
  }
  const sessionId = String(task?.sessionId || "").trim().toLowerCase();
  const internalJobType = String(task?.internalJobType || "").trim().toLowerCase();
  const message = String(task?.message || "").trim().toLowerCase();
  const projectCycleTask = (
    sessionId === "project-cycle"
    || internalJobType === "project_cycle"
    || /\bthis is a focused project work package\b/.test(message)
    || /\/project-todo\.md\b/.test(message)
  );
  if (!projectCycleTask) {
    return false;
  }
  const planningObjective = isProjectCyclePlanningObjective(task);
  const diagnostics = task?.toolLoopDiagnostics && typeof task.toolLoopDiagnostics === "object"
    ? task.toolLoopDiagnostics
    : {};
  const concreteProgressSteps = Math.max(0, Number(diagnostics.concreteProgressStepCount || 0));
  const uniqueConcreteInspectionTargets = Array.isArray(diagnostics.uniqueConcreteInspectionTargets)
    ? diagnostics.uniqueConcreteInspectionTargets.length
    : 0;
  if (normalized === "low_value_tool_loop" && (planningObjective || concreteProgressSteps > 0 || uniqueConcreteInspectionTargets >= 3)) {
    return false;
  }
  if (planningObjective && ["speculative_completion", "no_concrete_outcome", "repeated_tool_plan"].includes(normalized)) {
    return false;
  }
  return true;
}

function isTransportFailoverFailure(classification = "", task = {}) {
  const normalized = String(classification || "").trim().toLowerCase();
  if (normalized === "tool_fetch_failed") {
    return true;
  }
  if (normalized !== "timeout") {
    return false;
  }
  const summary = [
    String(task?.resultSummary || "").trim(),
    String(task?.reviewSummary || "").trim(),
    String(task?.workerSummary || "").trim(),
    String(task?.notes || "").trim()
  ].join(" ").toLowerCase();
  return (
    summary.includes("headers timeout")
    || summary.includes("fetch failed")
    || summary.includes("failed to reach ollama api")
    || summary.includes("transport failure")
    || summary.includes("ollama api")
  );
}

const {
  buildFailureInvestigationTaskMessage: observerBuildFailureInvestigationTaskMessage,
  buildProjectCycleCompletionPolicy: observerBuildProjectCycleCompletionPolicy,
  didInspectNamedTarget: observerDidInspectNamedTarget,
  evaluateProjectCycleCompletionState: observerEvaluateProjectCycleCompletionState,
  extractProjectCycleImplementationRoots: observerExtractProjectCycleImplementationRoots,
  extractProjectCycleProjectRoot: observerExtractProjectCycleProjectRoot,
  extractTaskDirectiveValue: observerExtractTaskDirectiveValue,
  isConcreteImplementationInspectionTarget: observerIsConcreteImplementationInspectionTarget,
  isPlanningDocumentPath: observerIsPlanningDocumentPath,
  normalizeContainerPathForComparison: observerNormalizeContainerPathForComparison,
  objectiveRequiresConcreteImprovement: observerObjectiveRequiresConcreteImprovement,
  removeTaskDirectiveValue: observerRemoveTaskDirectiveValue,
  replaceTaskDirectiveValue: observerReplaceTaskDirectiveValue
} = createObserverProjectCycleInspection({
  classifyFailureText,
  compactTaskText,
  extractContainerPathCandidates,
  normalizeContainerMountPathCandidate,
  normalizeTaskDirectivePath,
  path
});

function buildCapabilityMismatchRetryMessage(task = {}, failureClassification = "") {
  const baseMessage = String(task?.message || "").trim();
  if (!baseMessage) {
    return "";
  }
  const minConcreteTargets = getProjectNoChangeMinimumTargets();
  const projectPath = String(task?.projectPath || "").trim();
  const primaryTarget = String(task?.projectWorkPrimaryTarget || "").trim();
  const secondaryTarget = String(task?.projectWorkSecondaryTarget || "").trim();
  const tertiaryTarget = String(task?.projectWorkTertiaryTarget || "").trim();
  const expectedFirstMove = String(task?.projectWorkExpectedFirstMove || "").trim()
    || extractTaskDirectiveValue(baseMessage, "Expected first move:");
  const inspectFirst = extractTaskDirectiveValue(baseMessage, "Inspect first:")
    || (projectPath && primaryTarget ? `${projectPath}/${primaryTarget}` : "");
  const inspectSecond = extractTaskDirectiveValue(baseMessage, "Inspect second if needed:")
    || (projectPath && secondaryTarget ? `${projectPath}/${secondaryTarget}` : "");
  const inspectThird = extractTaskDirectiveValue(baseMessage, "Inspect third if needed:")
    || (projectPath && tertiaryTarget ? `${projectPath}/${tertiaryTarget}` : "");
  const retryLines = [];
  const normalizedFailure = String(failureClassification || "").trim().toLowerCase();

  if (normalizedFailure === "no_inspection") {
    retryLines.push("Retry note: the previous worker finished without any concrete inspection.");
    if (expectedFirstMove) {
      retryLines.push(`Start with this exact first move: ${expectedFirstMove}`);
    } else if (inspectFirst) {
      retryLines.push(`Start by inspecting this concrete target: ${inspectFirst}`);
    }
    retryLines.push("Do not return final=true before at least one successful inspection tool call.");
  } else if (normalizedFailure === "speculative_completion") {
    retryLines.push("Retry note: the previous worker stopped with speculative or future-tense language instead of completed work.");
    retryLines.push("Keep working with tools until you have a concrete change, artifact, or the exact no-change conclusion with inspected paths.");
  } else if (normalizedFailure === "no_concrete_outcome") {
    retryLines.push("Retry note: the previous worker finished without a concrete change, output artifact, or valid no-change conclusion.");
    retryLines.push("Either make one safe concrete improvement now or use the exact phrase 'no change is possible' with the inspected paths.");
  } else if (normalizedFailure === "no_change_insufficient_inspection") {
    retryLines.push("Retry note: the previous worker used a no-change conclusion before inspecting enough concrete implementation targets.");
    retryLines.push(`Inspect at least ${minConcreteTargets} distinct concrete implementation files or directories before using that conclusion again.`);
  } else if (normalizedFailure === "no_change_missing_targets") {
    retryLines.push("Retry note: the previous worker used a no-change conclusion without naming the inspected targets.");
    retryLines.push("Name the exact inspected files or directories in the conclusion.");
  } else if (normalizedFailure === "repeated_tool_plan") {
    retryLines.push("Retry note: the previous worker repeated the same tool plan without advancing the work.");
    if (inspectFirst) {
      retryLines.push(`Narrow this retry to ${inspectFirst} and continue from that concrete target instead of replaying the startup bundle.`);
      retryLines.push("Do not repeat the same inspection step twice. After the required read, make one concrete change or use the exact phrase 'no change is possible' with the inspected paths.");
      if (inspectSecond) {
        retryLines.push(`Only inspect ${inspectSecond} if the primary target truly requires it to complete the work.`);
      } else if (inspectThird) {
        retryLines.push(`Only inspect ${inspectThird} if the primary target truly requires it to complete the work.`);
      }
    } else if (inspectSecond) {
      retryLines.push(`Move to this next concrete target instead of replaying the startup bundle: ${inspectSecond}`);
    } else if (inspectThird) {
      retryLines.push(`Move to this next concrete target instead of replaying the startup bundle: ${inspectThird}`);
    } else {
      retryLines.push("Move to one different concrete file, directory, or edit step instead of repeating the same inspection loop.");
    }
  } else if (normalizedFailure === "low_value_tool_loop") {
    retryLines.push("Retry note: the previous worker kept using tools without converging to a concrete change, artifact, capability request, or valid no-change conclusion.");
    retryLines.push("Do not spend another pass on inspection-only steps once you already have enough evidence to act.");
    retryLines.push("If the fix is understood, use edit_file for targeted changes, write_file for new or fully rewritten files, or move_path for renames instead of more read-only inspection.");
    retryLines.push("For read_document, list_files, write_file, and edit_file, include the explicit full path in the path field on every tool call.");
    retryLines.push("Either make one concrete change, search the skill library for the missing capability, record a capability request, or conclude with the exact phrase 'no change is possible' and the inspected paths.");
  } else if (normalizedFailure === "invalid_envelope") {
    retryLines.push("Retry note: the previous worker echoed tool results instead of returning an assistant decision.");
    retryLines.push("Return either assistant tool_calls for more work or final=true with final_text. Do not output role=tool or tool_results as the top-level response.");
  } else if (normalizedFailure === "empty_final_response") {
    retryLines.push("Retry note: the previous worker ended the task without any usable final_text.");
    retryLines.push("Keep working until you can return a concrete final_text or another assistant tool envelope.");
  } else if (normalizedFailure === "stalled" || normalizedFailure === "timeout") {
    retryLines.push("Retry note: the previous worker stalled before reaching a concrete outcome.");
    if (expectedFirstMove) {
      retryLines.push(`Start with this exact first move: ${expectedFirstMove}`);
    } else if (inspectFirst) {
      retryLines.push(`Start by inspecting this concrete target: ${inspectFirst}`);
    }
    retryLines.push("Narrow the next pass to one concrete move before broadening the scope.");
  }

  if (!retryLines.length) {
    return baseMessage;
  }
  return [baseMessage, "", ...retryLines].join("\n");
}

async function appendFailureTelemetryEntry({ task, phase = "execution", summary = "", classification = "" } = {}) {
  const taskId = String(task?.id || "").trim();
  if (!taskId) {
    return;
  }
  const stamp = new Date().toISOString();
  const finalClassification = String(classification || classifyFailureText(summary)).trim() || "unknown";
  const cleanSummary = compactTaskText(String(summary || "").replace(/\s+/g, " ").trim(), 320) || "No summary available.";
  const rawMessage = String(task?.message || "").replace(/\s+/g, " ").trim();
  const rawOriginalMessage = String(task?.originalMessage || "").replace(/\s+/g, " ").trim();
  const displayMessageSource = looksLikePlaceholderTaskMessage(rawMessage) && rawOriginalMessage
    ? rawOriginalMessage
    : rawMessage;
  const message = compactTaskText(displayMessageSource, 220) || "(no task message)";
  const details = [
    `## ${stamp}`,
    `- Task: ${task?.codename || taskId} (${taskId})`,
    `- Phase: ${String(phase || "execution").trim() || "execution"}`,
    `- Classification: ${finalClassification}`,
    `- Brain: ${String(task?.requestedBrainId || "").trim() || "unknown"}`,
    `- Session: ${String(task?.sessionId || "").trim() || "unknown"}`,
    `- Status: ${String(task?.status || "").trim() || "unknown"}`,
    `- Message: ${message}`,
    `- Summary: ${cleanSummary}`
  ];
  if (task?.previousTaskId) {
    details.push(`- Previous task: ${String(task.previousTaskId).trim()}`);
  }
  if (task?.parentTaskId) {
    details.push(`- Parent task: ${String(task.parentTaskId).trim()}`);
  }
  if (task?.toolLoopDiagnostics?.summary) {
    details.push(`- Tool loop: ${String(task.toolLoopDiagnostics.summary).trim()}`);
  }
  await fs.mkdir(path.dirname(FAILURE_TELEMETRY_LOG_PATH), { recursive: true });
  await fs.appendFile(FAILURE_TELEMETRY_LOG_PATH, `${details.join("\n")}\n\n`, "utf8");
}

async function appendQueueMaintenanceReport(title, lines = []) {
  const heading = String(title || "").trim();
  const bodyLines = Array.isArray(lines)
    ? lines.map((line) => String(line || "").trim()).filter(Boolean)
    : [];
  if (!heading && !bodyLines.length) {
    return;
  }
  const stamp = new Date().toISOString();
  const content = [
    `## ${stamp}`,
    heading,
    ...bodyLines.map((line) => `- ${line}`),
    ""
  ].join("\n");
  await fs.mkdir(path.dirname(QUEUE_MAINTENANCE_LOG_PATH), { recursive: true });
  await fs.appendFile(QUEUE_MAINTENANCE_LOG_PATH, `${content}\n`, "utf8");
  if (bodyLines.length) {
    await appendDailyOperationalMemory(heading, bodyLines);
  }
}

async function listTopLevelWorkspaceEntries(rootPath, limit = 24) {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    return entries
      .map((entry) => `${entry.isDirectory() ? "dir" : "file"}:${entry.name}`)
      .sort((left, right) => left.localeCompare(right))
      .slice(0, limit);
  } catch {
    return [];
  }
}

async function listRecursiveFiles(rootPath, {
  extensions = [],
  limit = 24,
  maxDepth = 5
} = {}) {
  const normalizedRoot = String(rootPath || "").trim();
  if (!normalizedRoot) {
    return [];
  }
  const allowed = new Set((extensions || []).map((value) => String(value || "").toLowerCase()).filter(Boolean));
  const matches = [];
  const ignoredDirNames = new Set([
    ".git",
    "node_modules",
    "vendor",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    ".cache",
    "observer-output",
    ".observer-runtime"
  ]);
  const queue = [{ path: normalizedRoot, depth: 0 }];
  while (queue.length && matches.length < limit) {
    const current = queue.shift();
    try {
      const entries = await fs.readdir(current.path, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (matches.length >= limit) {
          break;
        }
        const entryPath = path.join(current.path, entry.name);
        if (entry.isDirectory()) {
          if (
            current.depth < maxDepth
            && !ignoredDirNames.has(entry.name.toLowerCase())
            && !(entry.name.startsWith(".") && entry.name.toLowerCase() !== ".github")
          ) {
            queue.push({ path: entryPath, depth: current.depth + 1 });
          }
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        const extension = path.extname(entry.name).toLowerCase();
        if (allowed.size && !allowed.has(extension)) {
          continue;
        }
        matches.push(entryPath);
      }
    } catch {
      continue;
    }
  }
  return matches;
}

function scoreMarkdownPath(rootPath, filePath) {
  const relativePath = path.relative(rootPath, filePath).replace(/\\/g, "/");
  const baseName = path.basename(filePath).toLowerCase();
  const segments = relativePath.split("/").filter(Boolean);
  let score = 0;
  const preferredNames = new Map([
    ["agents.md", 220],
    ["soul.md", 210],
    ["tools.md", 205],
    ["todo.md", 200],
    ["tasks.md", 195],
    ["plan.md", 190],
    ["plans.md", 185],
    ["roadmap.md", 180],
    ["notes.md", 170],
    ["readme.md", 160],
    ["handoff.md", 150],
    ["laptop-handoff.md", 150],
    ["status.md", 140]
  ]);
  score += preferredNames.get(baseName) || 0;
  if (segments.length <= 2) {
    score += 120;
  } else if (segments.length <= 4) {
    score += 70;
  }
  if (segments.some((segment) => /prompt|workspace|observer|docs?|design|spec|plan|task|notes?/i.test(segment))) {
    score += 80;
  }
  if (/^\./.test(baseName)) {
    score -= 80;
  }
  if (/readme|changelog|history|license|contributing|security|upgrade|release|code_of_conduct/i.test(baseName)) {
    score -= 20;
  }
  return score;
}

async function summarizeMarkdownFile(rootPath, filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const heading = lines.find((line) => /^#{1,6}\s+/.test(line)) || "";
    const summaryLine = lines.find((line) => !/^#{1,6}\s+/.test(line)) || "";
    return {
      path: path.relative(rootPath, filePath).replace(/\\/g, "/"),
      heading: heading.replace(/^#{1,6}\s+/, "").trim(),
      summary: compactTaskText(summaryLine, 140)
    };
  } catch {
    return {
      path: path.relative(rootPath, filePath).replace(/\\/g, "/"),
      heading: "",
      summary: ""
    };
  }
}

async function listMarkdownSummaries(rootPath, limit = 20, maxDepth = 5, rotationKey = "") {
  const files = await listRecursiveFiles(rootPath, {
    extensions: [".md", ".markdown", ".mdx"],
    limit: 5000,
    maxDepth
  });
  const rankedFiles = [];
  for (const filePath of files) {
    let modifiedAt = 0;
    try {
      const stats = await fs.stat(filePath);
      modifiedAt = Number(stats.mtimeMs || 0);
    } catch {
      modifiedAt = 0;
    }
    rankedFiles.push({
      filePath,
      modifiedAt,
      score: scoreMarkdownPath(rootPath, filePath)
    });
  }
  rankedFiles.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.modifiedAt - left.modifiedAt;
  });
  const total = rankedFiles.length;
  const normalizedOffset = total > 0
    ? Math.max(0, Number(opportunityScanState.markdownOffsets?.[rotationKey] || 0)) % total
    : 0;
  const rotatedFiles = total > 0
    ? rankedFiles.map((_, index) => rankedFiles[(normalizedOffset + index) % total])
    : [];
  const summaries = [];
  for (const entry of rotatedFiles.slice(0, limit)) {
    summaries.push(await summarizeMarkdownFile(rootPath, entry.filePath));
  }
  return {
    summaries,
    total,
    nextOffset: total > 0 ? (normalizedOffset + Math.max(1, limit)) % total : 0
  };
}

async function buildOpportunityWorkspaceSnapshot() {
  const workspaceEntries = await listTopLevelWorkspaceEntries(OBSERVER_INPUT_HOST_ROOT, 24);
  const workspaceMarkdownResult = await listMarkdownSummaries(OBSERVER_INPUT_HOST_ROOT, 24, 6, "workspace");
  opportunityScanState.markdownOffsets.workspace = workspaceMarkdownResult.nextOffset;
  const workspaceMarkdown = workspaceMarkdownResult.summaries.map((entry) => ({
    ...entry,
    path: entry?.path ? `observer-input/${String(entry.path).replace(/^\/+/, "")}` : "observer-input"
  }));
  const { failed, done } = await listAllTasks();
  const recentFailed = failed
    .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
    .slice(0, 5)
    .map((task) => ({
      id: task.id,
      message: compactTaskText(task.message, 140),
      summary: compactTaskText(task.resultSummary || task.notes || "", 180)
    }));
  const recentDone = done
    .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
    .slice(0, 5)
    .map((task) => ({
      id: task.id,
      message: compactTaskText(task.message, 140),
      summary: compactTaskText(task.resultSummary || "", 180)
    }));
  return {
    workspaceRoot: OBSERVER_INPUT_HOST_ROOT,
    workspaceEntries,
    workspaceMarkdown,
    defaultMounts: [],
    recentFailed,
    recentDone
  };
}

async function buildTaskMaintenanceSnapshot(limit = 8) {
  const { done, failed } = await listAllTasks();
  const retainedDoneIds = done
    .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
    .slice(0, VISIBLE_COMPLETED_HISTORY_COUNT)
    .map((task) => String(task.id || ""));
  const retainedFailedIds = failed
    .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
    .slice(0, VISIBLE_FAILED_HISTORY_COUNT)
    .map((task) => String(task.id || ""));
  const candidates = [...failed, ...done]
    .filter((task) => !task.maintenanceReviewedAt)
    .filter((task) => String(task.internalJobType || "") !== "opportunity_scan")
    .filter((task) => {
      const id = String(task.id || "");
      if (String(task.status || "").toLowerCase() === "failed") {
        return !retainedFailedIds.includes(id);
      }
      return !retainedDoneIds.includes(id);
    })
    .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
    .slice(0, limit)
    .map((task) => ({
      id: task.id,
      status: task.status,
      sessionId: String(task.sessionId || ""),
      maintenanceKey: String(task.maintenanceKey || ""),
      parentTaskId: String(task.parentTaskId || ""),
      message: compactTaskText(task.message, 160),
      summary: compactTaskText(task.reviewSummary || task.resultSummary || task.notes || "", 220),
      outputFiles: Array.isArray(task.outputFiles) ? task.outputFiles.slice(0, 6).map((file) => file.path || file.name) : []
    }));
  return candidates;
}

function buildMarkdownReviewOpportunity(entry, sourceRoot = "workspace") {
  const relativePath = String(entry?.path || "").trim();
  if (!relativePath) {
    return null;
  }
  const lowerPath = relativePath.toLowerCase();
  const heading = String(entry?.heading || "").trim();
  const summary = String(entry?.summary || "").trim();
  const evidenceText = `${heading}\n${summary}`.toLowerCase();
  const preferred = /(agents|soul|tools|todo|tasks|plan|plans|roadmap|notes|readme|handoff)\.mdx?$/i.test(lowerPath);
  const signal = /\b(todo|next|plan|roadmap|follow[- ]?up|unfinished|pending|fix|issue|problem|review|opportunit)\b/i.test(evidenceText);
  if (!preferred && !signal) {
    return null;
  }
  const shortPath = compactTaskText(relativePath, 120);
  return {
    key: `md-${sourceRoot}-${hashRef(lowerPath)}`,
    message: `Review ${shortPath} and carry out the highest-value concrete next step you find there.`,
    specialtyHint: /todo|fix|issue|problem|unfinished|pending/i.test(evidenceText) ? "code" : "document",
    sourceDocumentPath: shortPath,
    reason: heading
      ? `Prioritized markdown file ${shortPath} appears relevant (${compactTaskText(heading, 80)}).`
      : `Prioritized markdown file ${shortPath} appears relevant for follow-up review.`
  };
}

function buildFailedTaskOpportunity(task) {
  const taskId = String(task?.id || "").trim();
  let message = String(task?.message || "").trim();
  message = message.replace(/^Investigate and fix the worker JSON formatting failure for task [^:]+:\s*/i, "");
  message = message.replace(/^Investigate why task [^:]+ stalled and make the queue runner recover or complete it cleanly:\s*/i, "");
  const compactMessage = compactTaskText(message, 140);
  const summary = String(task?.summary || "").toLowerCase();
  if (!taskId || !compactMessage) {
    return null;
  }
  if (summary.includes("invalid json")) {
    return {
      key: `failed-json-${taskId}`,
      message: compactTaskText(`Investigate and fix the worker JSON formatting failure for task ${taskId}. Original task: ${compactMessage}`, 220),
      specialtyHint: "code",
      sourceTaskId: taskId,
      reason: `Recent failed task ${taskId} ended with malformed worker JSON.`
    };
  }
  if (summary.includes("stalled")) {
    return {
      key: `failed-stall-${taskId}`,
      message: compactTaskText(`Investigate why task ${taskId} stalled and make the queue runner recover or complete it cleanly. Original task: ${compactMessage}`, 220),
      specialtyHint: "code",
      sourceTaskId: taskId,
      reason: `Recent failed task ${taskId} stalled during execution.`
    };
  }
  if (summary.includes("send_mail tool") || summary.includes("mail sender")) {
    return {
      key: `failed-mail-${taskId}`,
      message: compactTaskText(`Verify the mail sending tool path and retry the failed email task ${taskId}. Original task: ${compactMessage}`, 220),
      specialtyHint: "document",
      sourceTaskId: taskId,
      reason: `Recent failed task ${taskId} could not complete its email send path.`
    };
  }
  return null;
}

function isBogusOrMetaOpportunityMessage(message = "") {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  return (
    !text
    || /^task-\d+:/i.test(text)
    || /\bi have completed the task\b/i.test(text)
    || /\bi completed the task\b/i.test(text)
    || /\bworker summary\b/i.test(text)
    || /\bartifact summary\b/i.test(text)
    || /\bno further tasks are pending\b/i.test(text)
    || /\bnova awaits instructions\b/i.test(text)
    || /\bhanded to worker brains\b/i.test(text)
    || /\badditional useful work packages\b/i.test(text)
    || /\bidentify(?:ing)? and suggesting additional work packages\b/i.test(text)
    || /\bsearching for additional useful work packages\b/i.test(text)
    || /\btoday'?s tasks\b/i.test(text)
    || /\bdaily tasks\b/i.test(text)
    || /\bpersonal notes\b/i.test(text)
    || /\btypical preferences\b/i.test(text)
    || /\bpersonal commitments\b/i.test(text)
    || /\bactionable items and reminders\b/i.test(text)
    || /\banaly[sz]ing the workload\b/i.test(text)
    || /\bsuggested work packages\b/i.test(text)
    || lower.startsWith("i have completed")
    || lower.startsWith("i completed")
  );
}

function buildAllowedOpportunityReferences({ workspaceProjects = [], recentFailed = [], recentDone = [], urgentDocuments = [], workspaceMarkdown = [] } = {}) {
  const refs = new Set();
  const addRef = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized || normalized.length < 3) {
      return;
    }
    refs.add(normalized.toLowerCase());
  };
  for (const project of Array.isArray(workspaceProjects) ? workspaceProjects : []) {
    addRef(project?.name);
  }
  for (const task of [...(Array.isArray(recentFailed) ? recentFailed : []), ...(Array.isArray(recentDone) ? recentDone : [])]) {
    addRef(task?.id);
    addRef(task?.message);
  }
  for (const doc of Array.isArray(urgentDocuments) ? urgentDocuments : []) {
    addRef(doc?.relativePath);
    addRef(doc?.heading);
  }
  for (const entry of Array.isArray(workspaceMarkdown) ? workspaceMarkdown : []) {
    addRef(entry?.path);
    addRef(entry?.heading);
  }
  return [...refs];
}

function messageReferencesKnownOpportunitySource(message = "", allowedRefs = []) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) {
    return false;
  }
  if (/task-\d+/i.test(text) || /[\\/]/.test(text) || /\.[a-z0-9]{1,8}\b/i.test(text)) {
    return true;
  }
  return (Array.isArray(allowedRefs) ? allowedRefs : []).some((ref) => ref && text.includes(String(ref).toLowerCase()));
}

function deriveOpportunityAnchorData(message = "", { workspaceProjects = [], recentFailed = [], urgentDocuments = [], workspaceMarkdown = [] } = {}) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) {
    return null;
  }
  const matchedTask = (Array.isArray(recentFailed) ? recentFailed : []).find((task) => {
    const taskId = String(task?.id || "").trim().toLowerCase();
    return taskId && text.includes(taskId);
  });
  if (matchedTask) {
    return { sourceTaskId: String(matchedTask.id || "").trim() };
  }
  const matchedProject = (Array.isArray(workspaceProjects) ? workspaceProjects : []).find((project) => {
    const projectName = String(project?.name || "").trim().toLowerCase();
    return projectName && text.includes(projectName);
  });
  if (matchedProject) {
    return {
      projectName: String(matchedProject.name || "").trim(),
      projectPath: String(matchedProject.path || "").trim()
    };
  }
  const matchedDocument = [
    ...(Array.isArray(urgentDocuments) ? urgentDocuments : []),
    ...(Array.isArray(workspaceMarkdown) ? workspaceMarkdown : [])
  ].find((entry) => {
    const relativePath = String(entry?.relativePath || entry?.path || "").trim().toLowerCase();
    return relativePath && text.includes(relativePath);
  });
  if (matchedDocument) {
    return {
      sourceDocumentPath: String(matchedDocument.relativePath || matchedDocument.path || "").trim()
    };
  }
  return null;
}

async function planWorkspaceOpportunities(snapshot) {
  const planned = [];
  const seenKeys = new Set();
  const pushPlan = (entry) => {
    if (!entry?.key || !entry?.message || seenKeys.has(entry.key)) {
      return;
    }
    seenKeys.add(entry.key);
    planned.push(entry);
  };

  for (const failedTask of Array.isArray(snapshot?.recentFailed) ? snapshot.recentFailed : []) {
    pushPlan(buildFailedTaskOpportunity(failedTask));
    if (planned.length >= 2) {
      return planned;
    }
  }

  for (const entry of Array.isArray(snapshot?.workspaceMarkdown) ? snapshot.workspaceMarkdown : []) {
    pushPlan(buildMarkdownReviewOpportunity(entry, "workspace"));
    if (planned.length >= 2) {
      return planned;
    }
  }

  for (const mount of Array.isArray(snapshot?.defaultMounts) ? snapshot.defaultMounts : []) {
    for (const entry of Array.isArray(mount?.markdownFiles) ? mount.markdownFiles : []) {
      pushPlan(buildMarkdownReviewOpportunity(entry, String(mount?.id || "mount")));
      if (planned.length >= 2) {
        return planned;
      }
    }
  }

  return planned;
}

const {
  chooseQuestionMaintenanceBrain: observerChooseQuestionMaintenanceBrain,
  extractConcreteTaskFileTargets: observerExtractConcreteTaskFileTargets,
  maybeRewritePromptWithIdleBrain: observerMaybeRewritePromptWithIdleBrain,
  runIntakeWithOptionalRewrite: observerRunIntakeWithOptionalRewrite,
  runWorkerTaskPreflight: observerRunWorkerTaskPreflight,
  shouldBypassWorkerPreflight: observerShouldBypassWorkerPreflight
} = createObserverIntakePreflight({
  MODEL_KEEPALIVE,
  compactTaskText,
  extractFileReferenceCandidates,
  extractJsonObject,
  getBrain,
  isCpuQueueLane,
  listHealthyRoutingHelpers,
  listIdleHelperBrains,
  looksLikePlaceholderTaskMessage,
  normalizeContainerMountPathCandidate,
  normalizeUserRequest,
  normalizeWindowsPathCandidate,
  normalizeWorkspaceRelativePathCandidate,
  planIntakeWithBitNet,
  runOllamaJsonGenerate,
  tryBuildObserverNativeResponse
});

const {
  buildDocumentOpportunity,
  executeHelperScoutJob,
  executeQuestionMaintenanceJob,
  findActiveProjectCycleTask,
  queueHelperScoutTask
} = createObserverMaintenanceSupport({
  HELPER_SCOUT_TIMEOUT_MS,
  MAX_WAITING_QUESTION_COUNT,
  MODEL_KEEPALIVE,
  PROJECT_ROLE_PLAYBOOKS,
  appendDailyQuestionLog,
  applyQuestionMaintenanceAnswer,
  buildAllowedOpportunityReferences,
  buildDocumentIndexSnapshot,
  buildOpportunityWorkspaceSnapshot,
  buildWaitingQuestionLimitSummary,
  chooseIdleWorkerBrainForSpecialty,
  chooseQuestionMaintenanceBrain,
  chooseQuestionMaintenanceTarget,
  compactTaskText,
  createQueuedTask,
  deriveOpportunityAnchorData,
  ensurePromptWorkspaceScaffolding,
  extractJsonObject,
  findRecentCronTaskRuns,
  findTaskByMaintenanceKey,
  findTaskByOpportunityKey,
  getAgentPersonaName,
  getBrain,
  getObserverConfig: () => observerConfig,
  getPromptMemoryFileMap: () => ({
    "MEMORY.md": PROMPT_MEMORY_CURATED_PATH,
    "PERSONAL.md": PROMPT_PERSONAL_PATH,
    "USER.md": PROMPT_USER_PATH
  }),
  getQuestionMaintenanceExpansions: () => memoryTrustDomain.QUESTION_MAINTENANCE_EXPANSIONS,
  getQuestionMaintenanceTargets: () => memoryTrustDomain.QUESTION_MAINTENANCE_TARGETS,
  getWaitingQuestionBacklogCount,
  hashRef,
  isBogusOrMetaOpportunityMessage,
  isCpuQueueLane,
  isGeneratedObserverArtifactPath,
  isObserverOutputDocumentPath,
  listAllTasks,
  listContainerWorkspaceProjects,
  messageReferencesKnownOpportunitySource,
  readVolumeFile,
  runOllamaJsonGenerate,
  writeVolumeText
});

const {
  buildProjectWorkPackages: observerBuildProjectWorkPackages,
  chooseProjectWorkTargets: observerChooseProjectWorkTargets,
  fillWorkspaceProjectsFromRepositories,
  getProjectWorkAttemptCooldownMs: observerGetProjectWorkAttemptCooldownMs,
  findRecentProjectCycleMessageAttempt,
  findRecentProjectWorkAttempt,
  findTaskByProjectWorkKey,
  planTaskMaintenanceActions,
  processWorkspaceProjectForOpportunityScan,
  queueWorkspaceProjectCycleTasks,
  rotateWorkspaceProjectFromRepositories
} = createObserverProjectWorkspaceSupport({
  MAX_TASK_RESHAPE_ATTEMPTS,
  OBSERVER_CONTAINER_OUTPUT_ROOT,
  OBSERVER_INPUT_HOST_ROOT,
  TASK_QUEUE_CLOSED,
  appendDailyAssistantMemory,
  buildFailureReshapeMessage,
  canReshapeTask,
  chooseIdleWorkerBrainForSpecialty,
  classifyFailureText,
  compactTaskText,
  createQueuedTask,
  ensureProjectTodoForWorkspaceProject,
  findActiveProjectCycleTask,
  formatDateTimeForUser,
  fs,
  getObserverConfig: () => observerConfig,
  getProjectConfig,
  getProjectImplementationRoot,
  getTaskReshapeAttemptCount,
  hashRef,
  importRepositoryProjectToWorkspace,
  inferProjectCycleSpecialty,
  inferTaskSpecialty,
  listAllTasks,
  listContainerWorkspaceProjects,
  listTasksByFolder,
  moveWorkspaceProjectToOutput,
  normalizeSummaryComparisonText,
  opportunityScanState,
  path,
  pickInspectionFile,
  snapshotWorkspaceProjectToOutput,
  writeContainerTextFile
});

const {
  buildProjectDirectiveContent: observerBuildProjectDirectiveContent,
  buildProjectRoleTaskBoardContent: observerBuildProjectRoleTaskBoardContent,
  buildProjectTodoContent: observerBuildProjectTodoContent,
  ensureProjectRoleTaskBoardForWorkspaceProject: observerEnsureProjectRoleTaskBoardForWorkspaceProject,
  ensureProjectTodoForWorkspaceProject: observerEnsureProjectTodoForWorkspaceProject,
  getProjectImplementationRoot: observerGetProjectImplementationRoot,
  inferProjectCycleSpecialty: observerInferProjectCycleSpecialty,
  parseProjectRoleTaskBoardState: observerParseProjectRoleTaskBoardState,
  parseProjectDirectiveState: observerParseProjectDirectiveState,
  pickInspectionFile: observerPickInspectionFile,
  readProjectDirectiveState: observerReadProjectDirectiveState
} = createObserverProjectPlanning({
  PROJECT_ROLE_PLAYBOOKS,
  compactTaskText,
  getProjectConfig,
  inspectWorkspaceProject,
  moveContainerPath,
  normalizeSummaryComparisonText,
  path,
  readContainerFile,
  writeContainerTextFile
});

const {
  ensureOpportunityScanJob: observerEnsureOpportunityScanJob,
  executeOpportunityScanJob: observerExecuteOpportunityScanJob
} = createObserverOpportunityScan({
  AGENT_BRAINS,
  TASK_QUEUE_CLOSED,
  TASK_QUEUE_DONE,
  TASK_QUEUE_INBOX,
  TASK_QUEUE_IN_PROGRESS,
  MAX_TASK_RESHAPE_ATTEMPTS,
  appendDailyAssistantMemory,
  appendQueueMaintenanceReport,
  archiveExpiredCompletedTasks,
  buildDocumentIndexSnapshot,
  buildDocumentOpportunity,
  buildFailureInvestigationTaskMessage,
  buildOpportunityWorkspaceSnapshot,
  buildRetryTaskMeta,
  buildTaskMaintenanceSnapshot,
  canReshapeTask,
  chooseHelperScoutBrains,
  chooseIdleWorkerBrainForSpecialty,
  classifyFailureText,
  closeCompletedInternalPeriodicTasks,
  closeTaskRecord,
  compactTaskText,
  countIdleBackgroundWorkerBrains,
  countIdleHelperBrains,
  createQueuedTask,
  fillWorkspaceProjectsFromRepositories,
  findTaskById,
  findTaskByMaintenanceKey,
  findTaskByOpportunityKey,
  getIdleBackgroundExecutionCapacity,
  getLastInteractiveActivityAt: () => lastInteractiveActivityAt,
  getObserverConfig: () => observerConfig,
  getProjectConfig,
  getTaskReshapeAttemptCount,
  getTotalBackgroundExecutionCapacity,
  hashRef,
  inferTaskSpecialty,
  isBogusOrMetaOpportunityMessage,
  isRemoteParallelDispatchEnabled,
  listAllTasks,
  listContainerWorkspaceProjects,
  listTasksByFolder,
  markTaskCriticalFailure,
  planTaskMaintenanceActions,
  planWorkspaceOpportunities,
  processWorkspaceProjectForOpportunityScan,
  queueHelperScoutTask,
  recordTaskReshapeReview,
  saveOpportunityScanState,
  writeDailyDocumentBriefing,
  opportunityScanState
});

const {
  ensureAllMailWatchJobs: observerEnsureAllMailWatchJobs,
  ensureMailWatchJob: observerEnsureMailWatchJob,
  ensureQuestionMaintenanceJob: observerEnsureQuestionMaintenanceJob,
  executeMailWatchJob: observerExecuteMailWatchJob
} = createObserverPeriodicJobs({
  AGENT_BRAINS,
  QUESTION_MAINTENANCE_INTERVAL_MS,
  TASK_QUEUE_CLOSED,
  TASK_QUEUE_DONE,
  TASK_QUEUE_INBOX,
  TASK_QUEUE_IN_PROGRESS,
  TASK_QUEUE_WAITING,
  buildMailWatchSingleQuestion,
  chooseQuestionMaintenanceBrain,
  compactTaskText,
  createQueuedTask,
  createWaitingTask,
  findMailWatchWaitingTask,
  forwardMailToUser,
  getActiveMailAgent,
  getMailState: () => mailState,
  getMailWatchRule,
  getMailWatchRulesState: () => mailWatchRulesState,
  isDefinitelyBadMail,
  isDefinitelyGoodMail,
  listAllTasks,
  listTasksByFolder,
  moveAgentMail,
  resolveMailWatchNotifyEmail,
  sendUnsureMailDigest,
  upsertMailWatchRule
});

const {
  executeEscalationReviewJob: observerExecuteEscalationReviewJob
} = createObserverEscalationReview({
  MAX_TASK_RESHAPE_ATTEMPTS,
  MODEL_KEEPALIVE,
  buildConcreteReviewReason,
  buildEscalationCloseRecommendation,
  buildEscalationSplitProjectWorkKey,
  buildProjectCycleFollowUpMessage,
  buildRetryTaskMeta,
  canReshapeTask,
  chooseEscalationRetryBrainId,
  choosePlannerRepairBrain,
  compactTaskText,
  createQueuedTask,
  extractJsonObject,
  findTaskById,
  getBrain,
  getRoutingConfig,
  getTaskReshapeAttemptCount,
  listAvailableBrains,
  markTaskCriticalFailure,
  recordTaskReshapeReview,
  runOllamaJsonGenerate
});

async function tickObserverCronQueue() {
  if (observerCronTickInFlight) {
    return;
  }
  observerCronTickInFlight = true;
  try {
    await runCalendarDueEvents();
    await processNextQueuedTask();
  } finally {
    observerCronTickInFlight = false;
  }
}

async function listTaskEvents({ sinceTs = 0, limit = 20 } = {}) {
  const { queued, inProgress, done, failed } = await listAllTasks();
  return [...queued, ...inProgress, ...done, ...failed]
    .filter((task) => Number(task.updatedAt || task.createdAt || 0) > Number(sinceTs || 0))
    .sort((a, b) => Number(a.updatedAt || a.createdAt || 0) - Number(b.updatedAt || b.createdAt || 0))
    .slice(-Math.max(1, Math.min(Number(limit || 20), 100)));
}

function summarizePayloadText(parsed) {
  const payloads = parsed?.result?.payloads || parsed?.payloads || [];
  const text = payloads
    .map((payload) => String(payload?.text || "").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (text) {
    return text;
  }
  return String(
    parsed?.final_text
    || parsed?.reply_text
    || parsed?.assistant_message
    || parsed?.result?.final_text
    || parsed?.result?.reply_text
    || parsed?.result?.assistant_message
    || ""
  ).trim();
}

function hasMeaningfulTextResponse(runResponse) {
  const summary = summarizePayloadText(runResponse?.parsed);
  if (summary.trim()) {
    return true;
  }
  return false;
}

function summarizeRunArtifacts(runResponse) {
  const files = Array.isArray(runResponse?.outputFiles) ? runResponse.outputFiles : [];
  if (files.length) {
    return `No text response. Generated files: ${files.map((file) => file.path || file.name).join(", ")}`;
  }
  return "";
}

function formatElapsedShort(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

function hashRef(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatTaskCodename(id) {
  const hash = hashRef(id);
  const adjectives = [
    "Amber", "Brisk", "Cinder", "Dawn", "Ember", "Flint", "Golden", "Harbor",
    "Ivory", "Juniper", "Kindle", "Lumen", "Marlow", "North", "Opal", "Pine",
    "Quartz", "Rowan", "Sable", "Tawny", "Umber", "Velvet", "Willow", "Zephyr"
  ];
  const nouns = [
    "Beacon", "Bridge", "Circuit", "Drift", "Engine", "Field", "Grove", "Harbor",
    "Index", "Junction", "Key", "Lantern", "Matrix", "Node", "Orbit", "Path",
    "Queue", "Relay", "Signal", "Thread", "Unit", "Vector", "Watch", "Yard"
  ];
  const adjective = adjectives[hash % adjectives.length];
  const noun = nouns[Math.floor(hash / adjectives.length) % nouns.length];
  const suffix = String(hash % 1000).padStart(3, "0");
  return `${adjective} ${noun} ${suffix}`;
}

function formatJobCodename(id) {
  return formatTaskCodename(`job:${id}`);
}

function formatEntityRef(kind = "", id = "") {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  if (normalizedKind === "job") {
    return formatJobCodename(id || "unknown");
  }
  if (normalizedKind === "task") {
    return formatTaskCodename(id || "unknown");
  }
  return formatTaskCodename(`${normalizedKind || "entity"}:${id || "unknown"}`);
}

function normalizeTaskRecord(task = {}) {
  return {
    ...task,
    codename: task.codename || formatTaskCodename(task.id || "unknown"),
    rootTaskId: String(task.rootTaskId || task.id || "").trim(),
    reshapeAttemptCount: Math.max(0, Number(task.reshapeAttemptCount || 0))
  };
}

function getNextEscalationBrainId() {
  return null;
}

const {
  buildCompletionReviewSummary: observerBuildCompletionReviewSummary,
  buildTaskCapabilityPromptLines: observerBuildTaskCapabilityPromptLines,
  canBrainHandleSpecialty: observerCanBrainHandleSpecialty,
  chooseCreativeHandoffBrain: observerChooseCreativeHandoffBrain,
  chooseLessLoadedEquivalentWorker: observerChooseLessLoadedEquivalentWorker,
  executeCreativeHandoffPass: observerExecuteCreativeHandoffPass,
  inferTaskCapabilityProfile: observerInferTaskCapabilityProfile,
  inferTaskSpecialty: observerInferTaskSpecialty,
  isCreativeOnlyBrain: observerIsCreativeOnlyBrain,
  isVisionOnlyBrain: observerIsVisionOnlyBrain,
  looksLikePlaceholderTaskMessage: observerLooksLikePlaceholderTaskMessage,
  normalizeUserRequest: observerNormalizeUserRequest,
  preferHigherReliabilityProjectCycleWorker: observerPreferHigherReliabilityProjectCycleWorker,
  readUserProfileSummary: observerReadUserProfileSummary,
  renderCreativeHandoffPacket: observerRenderCreativeHandoffPacket,
  scoreBrainForSpecialty: observerScoreBrainForSpecialty,
  selectSpecialistBrainRoute: observerSelectSpecialistBrainRoute,
  summarizeTaskCapabilities: observerSummarizeTaskCapabilities,
  triageTaskRequest: observerTriageTaskRequest
} = createObserverTaskExecutionSupport({
  MODEL_KEEPALIVE,
  PROMPT_USER_PATH,
  chooseHealthyRemoteTriageBrain,
  chooseIntakePlanningBrain,
  compactTaskText,
  extractContainerPathCandidates,
  extractJsonObject,
  fs,
  getAgentPersonaName,
  getBrain,
  getBrainQueueLane,
  getOllamaEndpointHealth,
  getQueueLaneLoadSnapshot,
  getRoutingConfig,
  isImageMimeType,
  isPathWithinAllowedRoots,
  listAvailableBrains,
  looksLikeCapabilityRefusalCompletionSummary,
  looksLikeLowSignalCompletionSummary,
  normalizeAgentSelfReference,
  path,
  readVolumeFile,
  resolveSourcePathFromContainerPath,
  runOllamaGenerate,
  runOllamaJsonGenerate,
  summarizePayloadText
});

async function planIntakeWithBitNet({
  message,
  sessionId = "Main",
  internetEnabled = true,
  selectedMountIds = [],
  forceToolUse = false
} = {}) {
  const intakeBrain = await chooseIntakePlanningBrain() || await getBrain("bitnet");
  const systemPrompt = await buildIntakeSystemPrompt({
    internetEnabled,
    selectedMountIds,
    forceToolUse,
    sessionId
  });
  let parsed = null;
  const transcript = [];
  for (let step = 0; step < 4; step += 1) {
    const toolHistory = transcript.length
      ? `\n\nConversation so far:\n${buildTranscriptForPrompt(transcript)}`
      : "";
  const result = await runOllamaJsonGenerate(intakeBrain.model, `${systemPrompt}${toolHistory}\n\nUser message:\n${message}`, {
      timeoutMs: INTAKE_PLAN_TIMEOUT_MS,
      keepAlive: MODEL_KEEPALIVE,
      options: {
        num_gpu: 0
      },
      baseUrl: intakeBrain.ollamaBaseUrl
    });
    if (!result.ok) {
      throw new Error(result.stderr || "CPU intake planning failed");
    }
    try {
      parsed = extractJsonObject(result.text);
    } catch {
      parsed = null;
      break;
    }
    const toolCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls.map((call, index) => normalizeToolCallRecord(call, index)) : [];
    if (parsed.final || !toolCalls.length) {
      break;
    }
    const toolResults = [];
    for (const toolCall of toolCalls.slice(0, 4)) {
      try {
        const toolResult = await executeIntakeToolCall(toolCall);
        toolResults.push({
          tool_call_id: String(toolCall.id || `call_${toolResults.length + 1}`),
          name: String(toolCall?.function?.name || ""),
          arguments: parseToolCallArgs(toolCall),
          result: toolResult
        });
      } catch (error) {
        toolResults.push({
          tool_call_id: String(toolCall.id || `call_${toolResults.length + 1}`),
          name: String(toolCall?.function?.name || ""),
          arguments: parseToolCallArgs(toolCall),
          error: error.message || "tool failed"
        });
      }
    }
    transcript.push({
      role: "assistant",
      assistant_message: String(parsed.assistant_message || "").trim(),
      action: parsed.action || "",
      tool_calls: toolCalls
    });
    transcript.push({
      role: "tool",
      tool_results: toolResults
    });
    transcript.push({
      role: "assistant",
      assistant_message: buildPostToolDecisionInstruction(toolResults)
    });
  }
  if (!parsed) {
    const inferredEvery = (() => {
      const match = String(message || "").toLowerCase().match(/\bevery\s+(\d+\s*(?:ms|s|m|h|d))\b/);
      return match ? match[1].replace(/\s+/g, "") : "";
    })();
    parsed = {
      final_text: inferredEvery
        ? "I'll queue that as a periodic worker task."
        : "I'll queue that for the Qwen worker.",
      action: "enqueue",
      tasks: [
        {
          message: String(message || "").trim(),
          every: inferredEvery,
          delay: ""
        }
      ],
      reason: "Fallback intake plan after non-JSON model output",
      final: true
    };
  }
  let action = parsed.action === "reply_only" ? "reply_only" : "enqueue";
  const explicitScheduleRequested = intakeMessageExplicitlyRequestsScheduling(message);
  const tasks = Array.isArray(parsed.tasks)
    ? parsed.tasks
        .map((task) => ({
          message: String(task?.message || "").trim(),
          every: explicitScheduleRequested && task?.every ? String(task.every).trim() : "",
          delay: explicitScheduleRequested && task?.delay ? String(task.delay).trim() : ""
        }))
        .filter((task) => task.message)
    : [];
  const rawReplyText = normalizeAgentSelfReference(String(parsed.final_text || parsed.reply_text || parsed.assistant_message || "").trim());
  if (
    action === "enqueue"
    && tasks.length === 1
    && tasks[0].message === String(message || "").trim()
    && !tasks[0].every
    && !tasks[0].delay
    && isLightweightPlannerReplyRequest(message)
  ) {
    action = "reply_only";
    tasks.length = 0;
  }
  if (
    action === "enqueue"
    && transcript.length
    && rawReplyText
    && (!tasks.length || (tasks.length === 1 && tasks[0].message === String(message || "").trim() && !tasks[0].every && !tasks[0].delay))
  ) {
    action = "reply_only";
    tasks.length = 0;
  }
  if (action !== "reply_only" && !tasks.length) {
    const inferredEvery = (() => {
      const match = String(message || "").toLowerCase().match(/\bevery\s+(\d+\s*(?:ms|s|m|h|d))\b/);
      return match ? match[1].replace(/\s+/g, "") : "";
    })();
    tasks.push({
      message: String(message || "").trim(),
      every: inferredEvery,
      delay: ""
    });
  }
  if (
    action === "enqueue"
    && rawReplyText
    && isLightweightPlannerReplyRequest(message)
  ) {
    action = "reply_only";
    tasks.length = 0;
  }
  if (action === "enqueue") {
    for (const task of tasks) {
      if (looksLikeLowSignalPlannerTaskMessage(task.message, message)) {
        task.message = shapePlannerTaskMessage(message);
      }
    }
  }
  const replyText = normalizeIntakeReplyText({
    message,
    action,
    replyText: rawReplyText
  });
  return {
    replyText,
    action,
    tasks,
    reason: String(parsed.reason || "").trim() || "CPU intake decision",
    modelUsed: intakeBrain.model,
    fallbackReason: ""
  };
}

function isTodoNativeRequest(message = "") {
  return Boolean(
    extractTodoAddRequest(message)
    || extractTodoCompleteRequest(message)
    || extractTodoRemoveRequest(message)
    || isTodoSummaryRequest(message)
  );
}

function isObserverNativeRequest(message = "") {
  return isActivitySummaryRequest(message)
    || isQueueStatusRequest(message)
    || isTimeRequest(message)
    || isDateRequest(message)
    || isMailStatusRequest(message)
    || isInboxSummaryRequest(message)
    || isOutputStatusRequest(message)
    || isCompletionSummaryRequest(message)
    || isFailureSummaryRequest(message)
    || isDocumentOverviewRequest(message)
    || isDailyBriefingRequest(message)
    || isCalendarSummaryRequest(message)
    || isTodoNativeRequest(message);
}

const {
  buildChunkedTextPayload,
  buildPostToolDecisionInstruction: observerBuildPostToolDecisionInstruction,
  buildTranscriptForPrompt: observerBuildTranscriptForPrompt,
  compactToolResultForPrompt,
  formatDateForUser: observerFormatDateForUser,
  formatDateTimeForUser: observerFormatDateTimeForUser,
  formatDayKey,
  formatTimeForUser: observerFormatTimeForUser,
  humanJoin,
  normalizeChunkWindowArgs,
  startOfTodayMs,
  summarizeChunkForPrompt,
  summarizeCronTools,
  summarizeToolResultForPrompt
} = createObserverPromptUtils({
  compactTaskText,
  defaultLargeItemChunkChars: DEFAULT_LARGE_ITEM_CHUNK_CHARS,
  maxLargeItemChunkChars: MAX_LARGE_ITEM_CHUNK_CHARS,
  normalizeContainerPathForComparison,
  normalizeToolCallRecord
});

function buildPromptMemoryGuidanceNote(...args) { return memoryTrustDomain.buildPromptMemoryGuidanceNote(...args); }
async function ensurePromptWorkspaceScaffolding(...args) { return memoryTrustDomain.ensurePromptWorkspaceScaffolding(...args); }
function normalizeMemoryBulletValue(...args) { return memoryTrustDomain.normalizeMemoryBulletValue(...args); }
function parseMarkdownFieldValue(...args) { return memoryTrustDomain.parseMarkdownFieldValue(...args); }
function updateMarkdownFieldValue(...args) { return memoryTrustDomain.updateMarkdownFieldValue(...args); }
function getMarkdownSectionInfo(...args) { return memoryTrustDomain.getMarkdownSectionInfo(...args); }
function upsertMarkdownSectionBullet(...args) { return memoryTrustDomain.upsertMarkdownSectionBullet(...args); }
function getQuestionMaintenanceTargetState(...args) { return memoryTrustDomain.getQuestionMaintenanceTargetState(...args); }
function applyQuestionMaintenanceAnswer(...args) { return memoryTrustDomain.applyQuestionMaintenanceAnswer(...args); }
function chooseQuestionMaintenanceTarget(...args) { return memoryTrustDomain.chooseQuestionMaintenanceTarget(...args); }
async function appendDailyQuestionLog(...args) { return memoryTrustDomain.appendDailyQuestionLog(...args); }
async function appendDailyOperationalMemory(...args) { return memoryTrustDomain.appendDailyOperationalMemory(...args); }
async function appendDailyAssistantMemory(...args) { return memoryTrustDomain.appendDailyAssistantMemory(...args); }
async function backfillRecentMaintenanceMemory(...args) { return memoryTrustDomain.backfillRecentMaintenanceMemory(...args); }

const memoryTrustDomain = createMemoryTrustDomain({
  appendVolumeText,
  compactTaskText,
  ensureVolumeFile,
  escapeRegex,
  formatDayKey,
  formatTimeForUser,
  fs,
  getObserverConfig: () => observerConfig,
  getVoicePatternStore: () => voicePatternStore,
  hashRef,
  observerContainerWorkspaceRoot: OBSERVER_CONTAINER_WORKSPACE_ROOT,
  observerContainerProjectsRoot: OBSERVER_CONTAINER_PROJECTS_ROOT,
  path,
  promptProjectsRoot: PROMPT_PROJECTS_ROOT,
  promptFilesRoot: PROMPT_FILES_ROOT,
  promptMemoryBriefingsRoot: PROMPT_MEMORY_BRIEFINGS_ROOT,
  promptMemoryCuratedPath: PROMPT_MEMORY_CURATED_PATH,
  promptMemoryDailyRoot: PROMPT_MEMORY_DAILY_ROOT,
  promptMailRulesPath: PROMPT_MAIL_RULES_PATH,
  promptMemoryPersonalDailyRoot: PROMPT_MEMORY_PERSONAL_DAILY_ROOT,
  promptMemoryQuestionsRoot: PROMPT_MEMORY_QUESTIONS_ROOT,
  promptMemoryReadmePath: PROMPT_MEMORY_README_PATH,
  promptPersonalPath: PROMPT_PERSONAL_PATH,
  promptTodayBriefingPath: PROMPT_TODAY_BRIEFING_PATH,
  promptUserPath: PROMPT_USER_PATH,
  queueMaintenanceLogPath: QUEUE_MAINTENANCE_LOG_PATH,
  saveDocumentRulesState
});
const {
  QUESTION_MAINTENANCE_EXPANSIONS,
  QUESTION_MAINTENANCE_TARGETS
} = memoryTrustDomain;

const {
  buildCompletionSummary,
  buildDailyBriefingSummary,
  buildFailureSummary,
  buildInboxSummary,
  buildMailStatusSummary,
  buildOutputStatusSummary,
  buildQueueStatusSummary,
  buildRecentActivitySummary,
  ensureUniqueOutputPath: observerNativeEnsureUniqueOutputPath,
  extractFileReferenceCandidates: observerNativeExtractFileReferenceCandidates,
  extractQuotedSegments: observerNativeExtractQuotedSegments,
  isDirectReadFileRequest: observerNativeIsDirectReadFileRequest,
  isPathWithinAllowedRoots: observerNativeIsPathWithinAllowedRoots,
  normalizeContainerMountPathCandidate: observerNativeNormalizeContainerMountPathCandidate,
  normalizeWindowsPathCandidate: observerNativeNormalizeWindowsPathCandidate,
  normalizeWorkspaceRelativePathCandidate: observerNativeNormalizeWorkspaceRelativePathCandidate,
  outputNameCandidateFromSource: observerNativeOutputNameCandidateFromSource,
  readPromptMemoryContext,
  resolveSourcePathFromContainerPath: observerNativeResolveSourcePathFromContainerPath,
  writePromptMemoryFile
} = createObserverNativeSupport({
  OBSERVER_ATTACHMENTS_ROOT,
  OBSERVER_CONTAINER_ATTACHMENTS_ROOT,
  OBSERVER_CONTAINER_OUTPUT_ROOT,
  OBSERVER_CONTAINER_WORKSPACE_ROOT,
  OBSERVER_OUTPUT_ROOT,
  PROMPT_MEMORY_CURATED_PATH,
  PROMPT_PERSONAL_PATH,
  PROMPT_TODAY_BRIEFING_PATH,
  PROMPT_USER_PATH,
  RUNTIME_ROOT,
  WORKSPACE_ROOT,
  appendVolumeText,
  buildMailStatus,
  compactTaskText,
  ensureObserverOutputDir,
  fileExists,
  formatDateTimeForUser,
  formatJobCodename,
  formatTimeForUser,
  fs,
  getActiveMailAgent,
  getMailState: () => mailState,
  getMailWatchRulesState: () => mailWatchRulesState,
  getObserverConfig: () => observerConfig,
  humanJoin,
  listAllTasks,
  listCronRunEvents,
  listObserverOutputFiles,
  path,
  readVolumeFile,
  resolveObserverOutputPath,
  startOfTodayMs,
  summarizeCronTools,
  writeVolumeText
});

const INTAKE_TOOLS = OBSERVER_INTAKE_TOOLS;

function buildToolCatalog() {
  return buildObserverToolCatalog({
    workerTools: WORKER_TOOLS,
    intakeTools: INTAKE_TOOLS
  });
}

const { executeIntakeToolCall } = createObserverIntakeToolExecutor({
  buildCalendarSummary,
  buildCalendarToolEventPatch,
  buildCompletionSummary,
  buildDailyBriefingSummary,
  buildDocumentOverviewSummary,
  buildDocumentSearchSummary,
  buildFailureSummary,
  buildInboxSummary,
  buildMailStatusSummary,
  buildOutputStatusSummary,
  buildQueueStatusSummary,
  buildRecentActivitySummary,
  ensureAutonomousToolApproved,
  findCalendarEventsByReference,
  formatDateForUser,
  formatDateTimeForUser,
  formatTimeForUser,
  inspectSkillLibrarySkill,
  listInstalledSkills,
  normalizeCalendarToolEventInput,
  normalizeToolCallRecord,
  normalizeToolName,
  parseToolCallArgs,
  readPromptMemoryContext,
  recordSkillInstallationRequest,
  recordToolAdditionRequest,
  removeCalendarEvent,
  saveCalendarEvent,
  searchSkillLibrary,
  summarizeCalendarEvent,
  toolMoveMail,
  toolSendMail,
  writePromptMemoryFile
});

const {
  extractTodoAddRequest,
  extractTodoCompleteRequest,
  extractTodoRemoveRequest,
  isTodoSummaryRequest,
  tryBuildObserverNativeResponse: observerTryBuildObserverNativeResponse,
  tryHandleCopyToOutputRequest: observerTryHandleCopyToOutputRequest,
  tryHandleDirectMailRequest: observerTryHandleDirectMailRequest,
  tryHandleReadFileRequest: observerTryHandleReadFileRequest,
  tryHandleSkillLibraryRequest: observerTryHandleSkillLibraryRequest,
  tryHandleStandingMailWatchRequest: observerTryHandleStandingMailWatchRequest,
  tryHandleTodoRequest: observerTryHandleTodoRequest
} = createObserverNativeResponseHelpers({
  PROMPT_USER_PATH,
  addTodoItem,
  broadcast,
  buildCalendarSummary,
  buildChunkedTextPayload,
  buildCompletionSummary,
  buildDailyBriefingSummary,
  buildDocumentOverviewSummary,
  buildDocumentSearchSummary,
  buildFailureSummary,
  buildInboxSummary,
  buildMailStatusSummary,
  buildOutputStatusSummary,
  buildQueueStatusSummary,
  buildRecentActivitySummary,
  buildTodoSummaryLines,
  ensureMailWatchJob,
  ensureUniqueOutputPath,
  extractDocumentSearchQuery,
  extractFileReferenceCandidates,
  extractQuotedSegments,
  findTodoItemByReference,
  formatDateForUser,
  formatDateTimeForUser,
  formatTimeForUser,
  fs,
  getActiveMailAgent,
  getCalendarSummaryScopeFromMessage,
  inspectSkillLibrarySkill,
  installSkillIntoWorkspace,
  isActivitySummaryRequest,
  isCalendarSummaryRequest,
  isCompletionSummaryRequest,
  isDailyBriefingRequest,
  isDateRequest,
  isDirectReadFileRequest,
  isDocumentOverviewRequest,
  isDocumentSearchRequest,
  isFailureSummaryRequest,
  isInboxSummaryRequest,
  isMailStatusRequest,
  isOutputStatusRequest,
  isPathWithinAllowedRoots,
  isQueueStatusRequest,
  isTimeRequest,
  isTodayInboxSummaryRequest,
  isUserIdentityRequest,
  listInstalledSkills,
  listObserverOutputFiles,
  listTodoItems,
  normalizeContainerMountPathCandidate,
  normalizeDocumentContent,
  normalizeTodoReference,
  normalizeWindowsPathCandidate,
  normalizeWorkspaceRelativePathCandidate,
  outputNameCandidateFromSource,
  parseDirectMailRequest,
  parseStandingMailWatchRequest,
  path,
  readUserProfileSummary,
  removeTodoItem,
  resolveSourcePathFromContainerPath,
  sanitizeSkillSlug,
  searchSkillLibrary,
  setTodoItemStatus,
  toolSendMail,
  upsertMailWatchRule
});

const {
  buildIntakeSystemPrompt: observerBuildIntakeSystemPrompt,
  buildPromptReviewSampleMessage: observerBuildPromptReviewSampleMessage,
  buildWorkerSpecialtyPromptLines: observerBuildWorkerSpecialtyPromptLines,
  buildWorkerSystemPrompt: observerBuildWorkerSystemPrompt,
  filterDestructiveWriteCallsForInPlaceEdit: observerFilterDestructiveWriteCallsForInPlaceEdit,
  isEchoedToolResultEnvelope: observerIsEchoedToolResultEnvelope,
  normalizeWorkerDecisionEnvelope: observerNormalizeWorkerDecisionEnvelope,
  taskRequestsInPlaceFileEdit: observerTaskRequestsInPlaceFileEdit
} = createObserverWorkerPrompting({
  INTAKE_TOOLS,
  OBSERVER_CONTAINER_OUTPUT_ROOT,
  OBSERVER_CONTAINER_WORKSPACE_ROOT,
  WORKER_TOOLS,
  buildInstalledSkillsGuidanceNote,
  buildPromptMemoryGuidanceNote,
  buildTaskCapabilityPromptLines,
  extractConcreteTaskFileTargets,
  extractTaskDirectiveValue,
  getAgentPersonaName,
  getObserverConfig: () => observerConfig,
  getProjectNoChangeMinimumTargets,
  inferTaskCapabilityProfile,
  inferTaskSpecialty,
  isProjectCycleMessage,
  normalizeContainerPathForComparison,
  normalizeToolCallRecord,
  normalizeToolName,
  parseToolCallArgs
});

const { executeObserverRun: observerExecuteObserverRun } = createObserverExecutionRunner({
  annotateNovaSpeechText,
  buildPostToolDecisionInstruction,
  buildToolLoopStepDiagnostics,
  buildToolLoopStopMessage,
  buildToolLoopSummaryText,
  buildToolSemanticFailureMessage,
  buildTranscriptForPrompt,
  buildVisionImagesFromAttachments,
  buildWorkerSystemPrompt,
  collectTrackedWorkspaceTargets,
  compactTaskText,
  createToolLoopDiagnostics,
  debugJsonEnvelopeWithPlanner,
  diffFileSnapshots,
  didInspectNamedTarget,
  executeWorkerToolCall,
  extractInspectionTargetKey,
  extractJsonObject,
  buildProjectCycleCompletionPolicy,
  extractProjectCycleImplementationRoots,
  extractProjectCycleProjectRoot,
  extractTaskDirectiveValue,
  evaluateProjectCycleCompletionState,
  filterDestructiveWriteCallsForInPlaceEdit,
  getObserverConfig: () => observerConfig,
  getProjectNoChangeMinimumTargets,
  isConcreteImplementationInspectionTarget,
  isEchoedToolResultEnvelope,
  isProjectCycleMessage,
  isSemanticallySuccessfulToolResult,
  listObserverOutputFiles,
  listTrackedWorkspaceFiles,
  normalizeAgentSelfReference,
  normalizeContainerPathForComparison,
  normalizeToolCallRecord,
  normalizeToolName,
  normalizeWorkerDecisionEnvelope,
  objectiveRequiresConcreteImprovement,
  looksLikeCapabilityRefusalCompletionSummary,
  parseToolCallArgs,
  prepareAttachments,
  recordToolLoopStepDiagnostics,
  replanRepeatedToolLoopWithPlanner,
  retryJsonEnvelope,
  runOllamaPrompt,
  sanitizeSkillSlug
});

const { selectDispatchableQueuedTask } = createObserverQueueDispatchSelection({
  TASK_QUEUE_IN_PROGRESS,
  findRecentProjectCycleMessageAttempt,
  findRecentProjectWorkAttempt,
  getBrain,
  getBrainQueueLane,
  getProjectConfig,
  listTasksByFolder,
  normalizeOllamaBaseUrl
});

const {
  processNextQueuedTask: observerProcessNextQueuedTask,
  processQueuedTasksToCapacity: observerProcessQueuedTasksToCapacity
} = createObserverQueueProcessor({
  MAX_TASK_RESHAPE_ATTEMPTS,
  OBSERVER_CONTAINER_OUTPUT_ROOT,
  TASK_PROGRESS_HEARTBEAT_MS,
  TASK_QUEUE_DONE,
  TASK_QUEUE_INBOX,
  VISIBLE_COMPLETED_HISTORY_COUNT,
  WORKSPACE_ROOT,
  activeTaskControllers,
  addTodoItem,
  appendFailureTelemetryEntry,
  broadcast,
  broadcastObserverEvent,
  buildCapabilityMismatchRetryMessage,
  buildCompletionReviewSummary,
  buildQueuedTaskExecutionPrompt,
  buildRetryTaskMeta,
  buildTodoTextFromWaitingQuestion,
  canReshapeTask,
  chooseAutomaticRetryBrainId,
  classifyFailureText,
  closeTaskRecord,
  compactTaskText,
  createQueuedTask,
  executeCreativeHandoffPass,
  executeEscalationReviewJob,
  executeHelperScoutJob,
  executeMailWatchJob,
  executeObserverRun,
  executeOpportunityScanJob,
  executeQuestionMaintenanceJob,
  extractContainerPathCandidates,
  findIndexedTaskById,
  findRecentCronTaskRuns,
  formatDateTimeForUser,
  formatElapsedShort,
  formatEntityRef,
  fs,
  getAutoCloseCompletedInternalTaskReason,
  getBrain,
  getObserverConfig: () => observerConfig,
  getQueueConfig,
  getRoutingConfig,
  getTaskDispatchInFlight: () => taskDispatchInFlight,
  getTaskReshapeAttemptCount,
  getTaskRootId,
  isAutoCloseCompletedInternalTask,
  isCanonicalInProgressTaskRun,
  isCapabilityMismatchFailure,
  isImmediateInternalNoopCompletion,
  isRemoteParallelDispatchEnabled,
  isTodoBackedWaitingTask,
  isTransportFailoverFailure,
  listTasksByFolder,
  markTaskCriticalFailure,
  normalizeOllamaBaseUrl,
  path,
  persistTaskTransition,
  recordTaskReshapeReview,
  recoverConflictingInProgressLaneTasks,
  recoverStaleInProgressTasks,
  recoverStaleTaskDispatchLock,
  renderCreativeHandoffPacket,
  resolveSourcePathFromContainerPath,
  runWorkerTaskPreflight,
  scheduleTaskDispatch,
  selectDispatchableQueuedTask,
  setTaskDispatchInFlight: (value) => {
    taskDispatchInFlight = value;
  },
  setTaskDispatchStartedAt: (value) => {
    taskDispatchStartedAt = value;
  },
  shouldKeepTaskVisible,
  shouldRouteWaitingTaskToTodo,
  summarizePayloadText,
  summarizeRunArtifacts,
  writeVolumeText
});

const {
  collectTrackedWorkspaceTargets: observerCollectTrackedWorkspaceTargets,
  extractContainerPathCandidates: observerExtractContainerPathCandidates,
  isContainerWorkspacePath: observerIsContainerWorkspacePath,
  listTrackedWorkspaceFiles: observerListTrackedWorkspaceFiles,
  resolveObserverOutputPath: observerResolveObserverOutputPath
} = createObserverWorkspaceTracking({
  OBSERVER_CONTAINER_WORKSPACE_ROOT,
  OBSERVER_OUTPUT_ROOT,
  fs,
  isPathWithinAllowedRoots,
  normalizeContainerMountPathCandidate,
  normalizeContainerPathForComparison,
  path,
  resolveSourcePathFromContainerPath,
  runObserverToolContainerNode
});

const {
  findStaggeredAnchorMs: observerFindStaggeredAnchorMs,
  getCronMinGapMs: observerGetCronMinGapMs,
  listCronRunEvents: observerListCronRunEvents,
  listObserverOutputFiles: observerListObserverOutputFiles,
  readCronStore: observerReadCronStore,
  resolveContainerInspectablePath: observerResolveContainerInspectablePath,
  resolveInspectablePath: observerResolveInspectablePath,
  writeCronStore: observerWriteCronStore
} = createObserverRuntimeFileCron({
  INSPECT_ROOTS,
  OBSERVER_CONTAINER_WORKSPACE_ROOT,
  OBSERVER_OUTPUT_ROOT,
  compactTaskText,
  ensureObserverOutputDir,
  fs,
  listAllTasks,
  path
});

// Startup-safe bridge wrappers for extracted modules.
function isProjectCycleTask(...args) { return observerIsProjectCycleTask(...args); }
function isProjectCycleMessage(...args) { return observerIsProjectCycleMessage(...args); }
function buildQueuedTaskExecutionPrompt(...args) { return observerBuildQueuedTaskExecutionPrompt(...args); }
function buildProjectPipelineCollection(...args) { return observerBuildProjectPipelineCollection(...args); }
function listProjectPipelines(...args) { return observerListProjectPipelines(...args); }
function getProjectPipelineTrace(...args) { return observerGetProjectPipelineTrace(...args); }
function chooseProjectCycleRecoveryBrain(...args) { return observerChooseProjectCycleRecoveryBrain(...args); }
function buildConcreteReviewReason(...args) { return observerBuildConcreteReviewReason(...args); }
function shouldRouteWaitingTaskToTodo(...args) { return observerShouldRouteWaitingTaskToTodo(...args); }
function buildTodoTextFromWaitingQuestion(...args) { return observerBuildTodoTextFromWaitingQuestion(...args); }
function answerWaitingTask(...args) { return observerAnswerWaitingTask(...args); }
function buildFailureInvestigationTaskMessage(...args) { return observerBuildFailureInvestigationTaskMessage(...args); }
function buildProjectCycleCompletionPolicy(...args) { return observerBuildProjectCycleCompletionPolicy(...args); }
function extractTaskDirectiveValue(...args) { return observerExtractTaskDirectiveValue(...args); }
function evaluateProjectCycleCompletionState(...args) { return observerEvaluateProjectCycleCompletionState(...args); }
function objectiveRequiresConcreteImprovement(...args) { return observerObjectiveRequiresConcreteImprovement(...args); }
function replaceTaskDirectiveValue(...args) { return observerReplaceTaskDirectiveValue(...args); }
function removeTaskDirectiveValue(...args) { return observerRemoveTaskDirectiveValue(...args); }
function normalizeContainerPathForComparison(...args) { return observerNormalizeContainerPathForComparison(...args); }
function extractProjectCycleProjectRoot(...args) { return observerExtractProjectCycleProjectRoot(...args); }
function extractProjectCycleImplementationRoots(...args) { return observerExtractProjectCycleImplementationRoots(...args); }
function isPlanningDocumentPath(...args) { return observerIsPlanningDocumentPath(...args); }
function isConcreteImplementationInspectionTarget(...args) { return observerIsConcreteImplementationInspectionTarget(...args); }
function didInspectNamedTarget(...args) { return observerDidInspectNamedTarget(...args); }
function buildProjectCycleFollowUpMessage(...args) { return observerBuildProjectCycleFollowUpMessage(...args); }
function buildEscalationSplitProjectWorkKey(...args) { return observerBuildEscalationSplitProjectWorkKey(...args); }
function chooseEscalationRetryBrainId(...args) { return observerChooseEscalationRetryBrainId(...args); }
function buildEscalationCloseRecommendation(...args) { return observerBuildEscalationCloseRecommendation(...args); }
function chooseQuestionMaintenanceBrain(...args) { return observerChooseQuestionMaintenanceBrain(...args); }
function extractConcreteTaskFileTargets(...args) { return observerExtractConcreteTaskFileTargets(...args); }
function maybeRewritePromptWithIdleBrain(...args) { return observerMaybeRewritePromptWithIdleBrain(...args); }
function shouldBypassWorkerPreflight(...args) { return observerShouldBypassWorkerPreflight(...args); }
function runWorkerTaskPreflight(...args) { return observerRunWorkerTaskPreflight(...args); }
function runIntakeWithOptionalRewrite(...args) { return observerRunIntakeWithOptionalRewrite(...args); }
function buildProjectWorkPackages(...args) { return observerBuildProjectWorkPackages(...args); }
function chooseProjectWorkTargets(...args) { return observerChooseProjectWorkTargets(...args); }
function getProjectImplementationRoot(...args) { return observerGetProjectImplementationRoot(...args); }
function inferProjectCycleSpecialty(...args) { return observerInferProjectCycleSpecialty(...args); }
function parseProjectRoleTaskBoardState(...args) { return observerParseProjectRoleTaskBoardState(...args); }
function parseProjectDirectiveState(...args) { return observerParseProjectDirectiveState(...args); }
function readProjectDirectiveState(...args) { return observerReadProjectDirectiveState(...args); }
function buildProjectDirectiveContent(...args) { return observerBuildProjectDirectiveContent(...args); }
function buildProjectRoleTaskBoardContent(...args) { return observerBuildProjectRoleTaskBoardContent(...args); }
function buildProjectTodoContent(...args) { return observerBuildProjectTodoContent(...args); }
function pickInspectionFile(...args) { return observerPickInspectionFile(...args); }
function ensureProjectRoleTaskBoardForWorkspaceProject(...args) { return observerEnsureProjectRoleTaskBoardForWorkspaceProject(...args); }
function ensureProjectTodoForWorkspaceProject(...args) { return observerEnsureProjectTodoForWorkspaceProject(...args); }
function executeOpportunityScanJob(...args) { return observerExecuteOpportunityScanJob(...args); }
function ensureOpportunityScanJob(...args) { return observerEnsureOpportunityScanJob(...args); }
function ensureMailWatchJob(...args) { return observerEnsureMailWatchJob(...args); }
function ensureAllMailWatchJobs(...args) { return observerEnsureAllMailWatchJobs(...args); }
function ensureQuestionMaintenanceJob(...args) { return observerEnsureQuestionMaintenanceJob(...args); }
function executeMailWatchJob(...args) { return observerExecuteMailWatchJob(...args); }
function executeEscalationReviewJob(...args) { return observerExecuteEscalationReviewJob(...args); }
function normalizeUserRequest(...args) { return observerNormalizeUserRequest(...args); }
function looksLikePlaceholderTaskMessage(...args) { return observerLooksLikePlaceholderTaskMessage(...args); }
function inferTaskSpecialty(...args) { return observerInferTaskSpecialty(...args); }
function inferTaskCapabilityProfile(...args) { return observerInferTaskCapabilityProfile(...args); }
function buildTaskCapabilityPromptLines(...args) { return observerBuildTaskCapabilityPromptLines(...args); }
function summarizeTaskCapabilities(...args) { return observerSummarizeTaskCapabilities(...args); }
function isCreativeOnlyBrain(...args) { return observerIsCreativeOnlyBrain(...args); }
function chooseCreativeHandoffBrain(...args) { return observerChooseCreativeHandoffBrain(...args); }
function isVisionOnlyBrain(...args) { return observerIsVisionOnlyBrain(...args); }
function canBrainHandleSpecialty(...args) { return observerCanBrainHandleSpecialty(...args); }
function scoreBrainForSpecialty(...args) { return observerScoreBrainForSpecialty(...args); }
function chooseLessLoadedEquivalentWorker(...args) { return observerChooseLessLoadedEquivalentWorker(...args); }
function preferHigherReliabilityProjectCycleWorker(...args) { return observerPreferHigherReliabilityProjectCycleWorker(...args); }
function selectSpecialistBrainRoute(...args) { return observerSelectSpecialistBrainRoute(...args); }
function triageTaskRequest(...args) { return observerTriageTaskRequest(...args); }
function readUserProfileSummary(...args) { return observerReadUserProfileSummary(...args); }
function renderCreativeHandoffPacket(...args) { return observerRenderCreativeHandoffPacket(...args); }
function executeCreativeHandoffPass(...args) { return observerExecuteCreativeHandoffPass(...args); }
function buildCompletionReviewSummary(...args) { return observerBuildCompletionReviewSummary(...args); }
function buildPostToolDecisionInstruction(...args) { return observerBuildPostToolDecisionInstruction(...args); }
function buildTranscriptForPrompt(...args) { return observerBuildTranscriptForPrompt(...args); }
function formatDateForUser(...args) { return observerFormatDateForUser(...args); }
function formatDateTimeForUser(...args) { return observerFormatDateTimeForUser(...args); }
function formatTimeForUser(...args) { return observerFormatTimeForUser(...args); }
function ensureUniqueOutputPath(...args) { return observerNativeEnsureUniqueOutputPath(...args); }
function extractFileReferenceCandidates(...args) { return observerNativeExtractFileReferenceCandidates(...args); }
function extractQuotedSegments(...args) { return observerNativeExtractQuotedSegments(...args); }
function isDirectReadFileRequest(...args) { return observerNativeIsDirectReadFileRequest(...args); }
function isPathWithinAllowedRoots(...args) { return observerNativeIsPathWithinAllowedRoots(...args); }
function normalizeContainerMountPathCandidate(...args) { return observerNativeNormalizeContainerMountPathCandidate(...args); }
function normalizeWindowsPathCandidate(...args) { return observerNativeNormalizeWindowsPathCandidate(...args); }
function normalizeWorkspaceRelativePathCandidate(...args) { return observerNativeNormalizeWorkspaceRelativePathCandidate(...args); }
function outputNameCandidateFromSource(...args) { return observerNativeOutputNameCandidateFromSource(...args); }
function resolveSourcePathFromContainerPath(...args) { return observerNativeResolveSourcePathFromContainerPath(...args); }
function tryBuildObserverNativeResponse(...args) { return observerTryBuildObserverNativeResponse(...args); }
function tryHandleCopyToOutputRequest(...args) { return observerTryHandleCopyToOutputRequest(...args); }
function tryHandleDirectMailRequest(...args) { return observerTryHandleDirectMailRequest(...args); }
function tryHandleReadFileRequest(...args) { return observerTryHandleReadFileRequest(...args); }
function tryHandleSkillLibraryRequest(...args) { return observerTryHandleSkillLibraryRequest(...args); }
function tryHandleStandingMailWatchRequest(...args) { return observerTryHandleStandingMailWatchRequest(...args); }
function tryHandleTodoRequest(...args) { return observerTryHandleTodoRequest(...args); }
function buildWorkerSpecialtyPromptLines(...args) { return observerBuildWorkerSpecialtyPromptLines(...args); }
function buildIntakeSystemPrompt(...args) { return observerBuildIntakeSystemPrompt(...args); }
function buildWorkerSystemPrompt(...args) { return observerBuildWorkerSystemPrompt(...args); }
function buildPromptReviewSampleMessage(...args) { return observerBuildPromptReviewSampleMessage(...args); }
function normalizeWorkerDecisionEnvelope(...args) { return observerNormalizeWorkerDecisionEnvelope(...args); }
function taskRequestsInPlaceFileEdit(...args) { return observerTaskRequestsInPlaceFileEdit(...args); }
function filterDestructiveWriteCallsForInPlaceEdit(...args) { return observerFilterDestructiveWriteCallsForInPlaceEdit(...args); }
function isEchoedToolResultEnvelope(...args) { return observerIsEchoedToolResultEnvelope(...args); }
function executeObserverRun(...args) { return observerExecuteObserverRun(...args); }
function processNextQueuedTask(...args) { return observerProcessNextQueuedTask(...args); }
function processQueuedTasksToCapacity(...args) { return observerProcessQueuedTasksToCapacity(...args); }
function resolveObserverOutputPath(...args) { return observerResolveObserverOutputPath(...args); }
function extractContainerPathCandidates(...args) { return observerExtractContainerPathCandidates(...args); }
function isContainerWorkspacePath(...args) { return observerIsContainerWorkspacePath(...args); }
function collectTrackedWorkspaceTargets(...args) { return observerCollectTrackedWorkspaceTargets(...args); }
function listTrackedWorkspaceFiles(...args) { return observerListTrackedWorkspaceFiles(...args); }
function listObserverOutputFiles(...args) { return observerListObserverOutputFiles(...args); }
function resolveInspectablePath(...args) { return observerResolveInspectablePath(...args); }
function resolveContainerInspectablePath(...args) { return observerResolveContainerInspectablePath(...args); }
function readCronStore(...args) { return observerReadCronStore(...args); }
function listCronRunEvents(...args) { return observerListCronRunEvents(...args); }
function writeCronStore(...args) { return observerWriteCronStore(...args); }
function getCronMinGapMs(...args) { return observerGetCronMinGapMs(...args); }
function findStaggeredAnchorMs(...args) { return observerFindStaggeredAnchorMs(...args); }

await composeObserverServer({
  runtimeRouteArgs: {
    app,
    buildBrainActivitySnapshot,
    buildMailStatus,
    broadcast,
    clients,
    getAppTrustConfig,
    getBrainQueueLane,
    getConfiguredBrainEndpoints,
    getQdrantStatus: () => retrievalDomain.getStatus(),
    getObserverConfig: () => observerConfig,
    getObserverLanguage: () => observerLanguage,
    getObserverLexicon: () => observerLexicon,
    getProjectConfig,
    getQueueConfig,
    getRoutingConfig,
    inspectContainer,
    inspectOllamaEndpoint,
    listAvailableBrains,
    localOllamaBaseUrl: LOCAL_OLLAMA_BASE_URL,
    observerEventClients,
    ollamaContainer: OLLAMA_CONTAINER,
    queryGpuStatus,
    saveObserverConfig,
    scheduleTaskDispatch,
    setObserverConfig: (nextConfig) => {
      observerConfig = nextConfig;
    }
  },
  intakeRouteArgs: {
    agentBrains: AGENT_BRAINS,
    app,
    appendDailyQuestionLog,
    annotateNovaSpeechText,
    broadcast,
    buildIntakeSystemPrompt,
    buildPromptReviewSampleMessage,
    buildWorkerSystemPrompt,
    createQueuedTask,
    getBrain,
    getBrainQueueLane,
    getHelperAnalysisForRequest,
    getObserverConfig: () => observerConfig,
    listAvailableBrains,
    listObserverOutputFiles,
    normalizeSourceIdentityRecord,
    normalizeUserRequest,
    noteInteractiveActivity,
    parseEveryToMs,
    runIntakeWithOptionalRewrite,
    startHelperAnalysisForRequest,
    triageTaskRequest
  },
  observerConfigRouteArgs: {
    agentBrains: AGENT_BRAINS,
    app,
    buildBrainConfigPayload,
    buildProjectConfigPayload,
    buildProjectSystemStatePayload,
    buildSecretsCatalog,
    buildToolConfigPayload,
    defaultAppPropSlots,
    defaultAppReactionPathsByModel,
    defaultAppRoomTextures,
    deleteSecretValue,
    getAppTrustConfig,
    getBrainQueueLane,
    getObserverConfig: () => observerConfig,
    getSecretStatus,
    getProjectPipelineTrace,
    listAvailableBrains,
    listProjectPipelines,
    listPublicAssetChoices,
    localOllamaBaseUrl: LOCAL_OLLAMA_BASE_URL,
    normalizeAppTrustConfig,
    normalizeProjectConfigInput,
    normalizePropScale,
    normalizeReactionPathsByModel,
    normalizeStylizationEffectPreset,
    normalizeStylizationFilterPreset,
    normalizeVoiceTrustProfile,
    sanitizeConfigId,
    sanitizeStringList,
    sanitizeTrustRecordForConfig,
    saveObserverConfig,
    saveVoicePatternStore,
    serializeBrainEndpointConfig,
    serializeCustomBrainConfig,
    setSecretValue,
    setObserverConfig: (nextConfig) => {
      observerConfig = nextConfig;
    },
    setVoicePatternStore: (nextStore) => {
      voicePatternStore = nextStore;
    },
    updateToolConfig
  },
  mailCalendarRouteArgs: {
    addTodoItem,
    app,
    buildMailStatus,
    fetchRecentMessagesForAgent,
    getActiveMailAgent,
    getMailWatchRulesState: () => mailWatchRulesState,
    hasMailCredentials,
    listCalendarEvents,
    listTodoItems,
    looksLikeEmailAddress,
    mailState,
    moveAgentMail,
    noteInteractiveActivity,
    parseCalendarTimestamp,
    pollActiveMailbox,
    readCalendarEvents,
    removeCalendarEvent,
    removeTodoItem,
    saveMailWatchRulesState,
    saveCalendarEvent,
    sendAgentMail,
    setTodoItemStatus,
    writeCalendarEvents
  },
  workerExecutionRouteArgs: {
    app,
    fs,
    getActiveRegressionRun,
    getLatestRegressionRunReport,
    listContainerFiles,
    listObserverOutputFiles,
    listRegressionSuites,
    listVolumeFiles,
    loadLatestRegressionRunReport,
    observerContainerWorkspaceRoot: OBSERVER_CONTAINER_WORKSPACE_ROOT,
    observerOutputRoot: OBSERVER_OUTPUT_ROOT,
    path,
    readContainerFile,
    resetToSimpleProjectState,
    readVolumeFile,
    resolveContainerInspectablePath,
    resolveInspectablePath,
    resolveObserverOutputPath,
    runRegressionSuites
  },
  queueEngineRouteArgs: {
    abortActiveTask,
    app,
    appendDailyQuestionLog,
    answerWaitingTask,
    broadcastObserverEvent,
    createQueuedTask,
    findRecentDuplicateQueuedTask,
    findTaskById,
    forceStopTask,
    getBrain,
    getHelperAnalysisForRequest,
    getObserverConfig: () => observerConfig,
    listAllTasks,
    listCronRunEvents,
    listTaskEvents,
    listTaskReshapeIssues,
    normalizeSourceIdentityRecord,
    normalizeUserRequest,
    noteInteractiveActivity,
    parseEveryToMs,
    processNextQueuedTask,
    readCronStore,
    readTaskHistory,
    removeTaskRecord,
    resetTaskReshapeIssueState,
    runIntakeWithOptionalRewrite,
    taskPathForStatus,
    taskQueueRoot: TASK_QUEUE_ROOT,
    workspaceTaskPath,
    writeCronStore,
    writeTask
  },
  cronRouteArgs: {
    app,
    broadcast,
    compactTaskText,
    createQueuedTask,
    getBrain,
    getCronMinGapMs,
    getMailWatchRulesState: () => mailWatchRulesState,
    getObserverConfig: () => observerConfig,
    getProjectConfig,
    listAllTasks,
    listCronRunEvents,
    parseEveryToMs,
    questionMaintenanceIntervalMs: QUESTION_MAINTENANCE_INTERVAL_MS,
    removeTaskRecord,
    writeTask
  },
  initializeArgs: {
    backfillRecentMaintenanceMemory,
    ensureInitialDocumentIntelligence,
    ensurePromptWorkspaceScaffolding,
    loadDocumentRulesState,
    loadMailQuarantineLog,
    loadMailWatchRulesState,
    loadObserverConfig,
    loadObserverLanguage,
    loadObserverLexicon,
    loadOpportunityScanState,
    loadVoicePatternStore,
    migrateLegacyPromptWorkspaceIfNeeded
  },
  startArgs: {
    app,
    archiveExpiredCompletedTasks,
    broadcast,
    closeCompletedInternalPeriodicTasks,
    ensureAllMailWatchJobs,
    ensureObserverToolContainer,
    ensureOpportunityScanJob,
    ensureQuestionMaintenanceJob,
    getObserverConfig: () => observerConfig,
    maybeEmitTodoReminder,
    modelWarmIntervalMs: MODEL_WARM_INTERVAL_MS,
    pollActiveMailbox,
    port: PORT,
    reconcileMailWatchWaitingQuestions,
    runCalendarDueEvents,
    runQueueStorageMaintenance,
    scheduleTaskDispatch,
    taskRetentionSweepMs: TASK_RETENTION_SWEEP_MS,
    tickObserverCronQueue,
    todoReminderCheckIntervalMs: TODO_REMINDER_CHECK_INTERVAL_MS,
    warmRuntimeBrains
  }
});
