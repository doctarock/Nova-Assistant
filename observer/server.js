import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
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
import { createWorkspaceTransactionComposition } from "./server/workspace-transaction-composition.js";
import { createMemoryTrustDomain } from "./server/memory-trust-domain.js";
import { composeObserverServer } from "./server/observer-server-composition.js";
import {
  AGENT_BRAINS,
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
  createInitialVoicePatternStore,
  normalizeProjectsConfigForBootstrap
} from "./server/observer-core-state.js";
import {
  buildSemanticMap,
  formatSemanticForModel
} from "./server/output-semantic-compression.js";
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
  isFinanceSummaryRequest,
  isHelpRequest,
  isInboxSummaryRequest,
  isLightweightPlannerReplyRequest,
  isMailStatusRequest,
  isOutputStatusRequest,
  isProjectStatusRequest,
  isQueueStatusRequest,
  isScheduledJobsRequest,
  isSystemStatusRequest,
  isTimeRequest,
  isTodayInboxSummaryRequest,
  isUserIdentityRequest,
  looksLikeCapabilityRefusalCompletionSummary,
  looksLikeFileListSummary,
  looksLikeLowSignalCompletionSummary,
  looksLikeFollowUpMessage,
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
import { createObserverRecreationJob } from "./server/observer-recreation-job.js";
import { createObserverQueuedTaskPrompting } from "./server/observer-queued-task-prompting.js";
import { createObserverWaitingTaskHandling } from "./server/observer-waiting-task-handling.js";
import { createObserverWorkspaceTracking } from "./server/observer-workspace-tracking.js";
import { createObserverRuntimeFileCron } from "./server/observer-runtime-file-cron.js";
import { createObserverSecretsService } from "./server/observer-secrets-service.js";
import { createObserverBrainConfigDomain } from "./server/observer-brain-config.js";
import { createObserverConfigSecretsDomain } from "./server/observer-config-secrets-domain.js";
import { createObserverDocumentDomain } from "./server/observer-document-domain.js";
import { createObserverFailureDomain } from "./server/observer-failure-domain.js";
import { createObserverOpportunityDomain } from "./server/observer-opportunity-domain.js";
import { createObserverRuntimeSupport } from "./server/observer-runtime-support.js";
import { createObserverTaskStorage } from "./server/observer-task-storage.js";
import { createObserverTaskStorageIo } from "./server/observer-task-storage-io.js";
import { createObserverWorkerTools, requireNonEmptyToolContent } from "./server/observer-worker-tools.js";
import { createVoiceDomain } from "./server/voice-domain.js";
import { createObserverIotDomain } from "./server/observer-iot-domain.js";
import { createNoopPluginManager, initializeObserverPluginManager } from "./server/observer-plugin-loader.js";
import { createTaskReshapeDomain } from "./server/task-reshape-domain.js";
import { createObserverHttpHooks } from "./server/observer-http-hooks.js";
import { runCommand, inspectContainer, queryGpuStatus, shouldHideInspectorEntry } from "./server/observer-system-inspect.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const app = express();
const {
  compactHookText,
  sanitizeHookToken,
  summarizeHookValue,
  summarizeHookResponsePayload,
  summarizeHookRequestBody,
  requestTrackingMiddleware
} = createObserverHttpHooks({ getPluginManager: () => pluginManager });

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
app.use(requestTrackingMiddleware);
app.use("/vendor/three", express.static(path.join(__dirname, "node_modules", "three")));
app.use("/vendor/fonts", express.static(path.join(__dirname, "node_modules", "@fontsource")));
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3220);
const ADMIN_UI_TOKEN = crypto.randomBytes(24).toString("hex");
const UI_SESSION_PROTECTED_PATHS = [
  "/api/tasks/triage",
  "/api/agent/run",
  "/api/tasks/enqueue",
  "/api/tasks/dispatch-next",
  "/api/tasks/remove",
  "/api/tasks/abort",
  "/api/tasks/answer",
  "/api/tasks/reshape-issues/reset",
  "/api/state/reset-simple-project",
  "/api/regressions/run",
  "/api/app/config",
  "/api/brains/config"
];
const INTAKE_RATE_LIMIT_PATHS = new Set([
  "/api/tasks/triage",
  "/api/agent/run",
  "/api/tasks/enqueue"
]);
const INTAKE_RATE_LIMIT_WINDOW_MS = Math.max(
  1000,
  Math.min(Number(process.env.OBSERVER_INTAKE_RATE_LIMIT_WINDOW_MS || 60_000), 10 * 60 * 1000)
);
const INTAKE_RATE_LIMIT_MAX = Math.max(
  5,
  Math.min(Number(process.env.OBSERVER_INTAKE_RATE_LIMIT_MAX || 40), 500)
);
const intakeRateLimitBuckets = new Map();

function isSafeRequestMethod(method = "GET") {
  const normalized = String(method || "GET").trim().toUpperCase();
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS";
}

function isLoopbackAddress(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized === "::1"
    || normalized === "127.0.0.1"
    || normalized.startsWith("::ffff:127.0.0.1");
}

function isLoopbackRequest(req = {}) {
  return isLoopbackAddress(
    req.socket?.remoteAddress
      || req.connection?.remoteAddress
      || req.ip
      || ""
  );
}

function isTrustedLocalOrigin(origin = "") {
  const normalized = String(origin || "").trim();
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:") {
      return false;
    }
    const port = String(parsed.port || "80").trim();
    if (port !== String(PORT)) {
      return false;
    }
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function isTrustedSameHostOrigin(origin = "", req = {}) {
  const normalized = String(origin || "").trim();
  const requestHost = String(req.headers?.host || "").trim().toLowerCase();
  if (!normalized || !requestHost) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return String(parsed.host || "").trim().toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

function isTrustedLocalRequestOrigin(req = {}) {
  const origin = String(req.headers?.origin || "").trim();
  const referer = String(req.headers?.referer || "").trim();
  if (origin) {
    return isTrustedLocalOrigin(origin) || isTrustedSameHostOrigin(origin, req);
  }
  if (referer) {
    return isTrustedLocalOrigin(referer) || isTrustedSameHostOrigin(referer, req);
  }
  return false;
}

function isValidAdminToken(value = "") {
  const token = String(value || "").trim();
  if (!token) {
    return false;
  }
  const expected = Buffer.from(ADMIN_UI_TOKEN);
  const provided = Buffer.from(token);
  return expected.length === provided.length
    && crypto.timingSafeEqual(expected, provided);
}

function validateAdminRequest(req = {}) {
  const hasTrustedOrigin = isTrustedLocalRequestOrigin(req);
  if (!isLoopbackRequest(req) && !hasTrustedOrigin) {
    return false;
  }
  if (!isSafeRequestMethod(req.method) && !hasTrustedOrigin) {
    return false;
  }
  const token = String(req.headers?.["x-admin-token"] || "").trim();
  return isValidAdminToken(token);
}

function rateLimitKeyForRequest(req = {}, scope = "intake") {
  const address = String(req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip || "unknown").trim().toLowerCase();
  const method = String(req.method || "GET").trim().toUpperCase();
  const routePath = String(req.path || req.originalUrl || "").trim().toLowerCase();
  return `${scope}:${address}:${method}:${routePath}`;
}

function checkSlidingWindowRateLimit(req = {}, {
  scope = "intake",
  maxRequests = INTAKE_RATE_LIMIT_MAX,
  windowMs = INTAKE_RATE_LIMIT_WINDOW_MS
} = {}) {
  const now = Date.now();
  const key = rateLimitKeyForRequest(req, scope);
  const threshold = now - windowMs;
  const prior = Array.isArray(intakeRateLimitBuckets.get(key))
    ? intakeRateLimitBuckets.get(key).filter((timestamp) => Number(timestamp || 0) > threshold)
    : [];
  if (prior.length >= maxRequests) {
    const retryAfterMs = Math.max(1000, windowMs - (now - prior[0]));
    intakeRateLimitBuckets.set(key, prior);
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
    };
  }
  prior.push(now);
  intakeRateLimitBuckets.set(key, prior);
  return {
    allowed: true,
    retryAfterSeconds: 0
  };
}

app.get("/api/admin-token", (req, res) => {
  if (!isTrustedLocalRequestOrigin(req)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }
  res.json({ ok: true, token: ADMIN_UI_TOKEN });
});

app.use("/api/plugins", (req, res, next) => {
  if (!validateAdminRequest(req)) {
    return res.status(403).json({ ok: false, error: "Admin token required" });
  }
  next();
});

app.use(UI_SESSION_PROTECTED_PATHS, (req, res, next) => {
  if (isSafeRequestMethod(req.method)) {
    return next();
  }
  if (!validateAdminRequest(req)) {
    return res.status(403).json({ ok: false, error: "Admin token required" });
  }
  next();
});

app.use((req, res, next) => {
  if (!INTAKE_RATE_LIMIT_PATHS.has(String(req.path || "").trim())) {
    return next();
  }
  if (String(req.method || "GET").trim().toUpperCase() !== "POST") {
    return next();
  }
  const rateLimit = checkSlidingWindowRateLimit(req);
  if (!rateLimit.allowed) {
    res.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      error: "Too many intake requests. Please slow down and try again shortly."
    });
  }
  next();
});
const RUNTIME_ROOT = path.join(__dirname, ".derpy-observer-runtime");
const PLUGIN_RUNTIME_ROOT = path.join(RUNTIME_ROOT, "plugins-runtime");
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
const OBSERVER_TASK_QUEUE_NAME = "derpy-observer-task-queue";
const LEGACY_OBSERVER_TASK_QUEUE_NAME = "observer-task-queue";
const TASK_QUEUE_ROOT = path.join(RUNTIME_ROOT, OBSERVER_TASK_QUEUE_NAME);
const LEGACY_TASK_QUEUE_ROOT = path.join(LEGACY_RUNTIME_ROOT, LEGACY_OBSERVER_TASK_QUEUE_NAME);
const TASK_QUEUE_WORKSPACE_PATH = OBSERVER_TASK_QUEUE_NAME;
const TASK_QUEUE_INBOX = path.join(TASK_QUEUE_ROOT, "inbox");
const TASK_QUEUE_WAITING = TASK_QUEUE_INBOX;
const TASK_QUEUE_IN_PROGRESS = path.join(TASK_QUEUE_ROOT, "in_progress");
const TASK_QUEUE_DONE = path.join(TASK_QUEUE_ROOT, "done");
const TASK_QUEUE_CLOSED = path.join(TASK_QUEUE_ROOT, "closed");
const TASK_PROGRESS_HEARTBEAT_MS = 60000;
const TASK_STALE_IN_PROGRESS_MS = 10 * 60 * 1000;
const TASK_ORPHANED_IN_PROGRESS_MS = 2 * TASK_PROGRESS_HEARTBEAT_MS;
const AGENT_RUN_TIMEOUT_MS = 20 * 60 * 1000;
const INTAKE_PLAN_TIMEOUT_MS = 3 * 60 * 1000;
const HELPER_SCOUT_TIMEOUT_MS = 3 * 60 * 1000;
const HELPER_IDLE_RESERVE_COUNT = 1;
const QUESTION_MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000;
const OLLAMA_TRANSPORT_RETRY_COUNT = 2;
const OLLAMA_TRANSPORT_RETRY_DELAY_MS = 1200;
const OLLAMA_EMPTY_RESPONSE_RETRY_COUNT = 1;
const OLLAMA_ENDPOINT_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
const OLLAMA_INTAKE_LEASE_WAIT_MS = 12000;
const OLLAMA_SIDECAR_LEASE_WAIT_MS = 2500;
const MODEL_KEEPALIVE = "30m";
const DEFAULT_MODEL_TEMPERATURE = 0.2;
const MAX_MODEL_TEMPERATURE = 0.4;
const MODEL_WARM_INTERVAL_MS = 4 * 60 * 1000;
const RECREATION_IDLE_COOLDOWN_MS = 20 * 60 * 1000;
const RECREATION_ACTIVE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const TASK_RETENTION_MS = 1 * 24 * 60 * 60 * 1000;
const TASK_RETENTION_SWEEP_MS = 6 * 60 * 60 * 1000;
const CLOSED_TASK_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const LEGACY_TASK_QUEUE_RETIRE_AFTER_MS = 48 * 60 * 60 * 1000;
const MAX_CLOSED_TASK_FILES = 500;
const VISIBLE_COMPLETED_HISTORY_COUNT = 1;
const VISIBLE_FAILED_HISTORY_COUNT = 1;
const OLLAMA_CONTAINER = "ollama";
const LOCAL_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const OBSERVER_TOOL_CONTAINER = "derpy-observer-sandbox";
const OBSERVER_TOOL_IMAGE = "openclaw-safe";
const OBSERVER_TOOL_STATE_VOLUME = "derpy-observer-sandbox-state";
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
const TASK_EVENT_SEQ_PATH = path.join(RUNTIME_ROOT, "task-event-seq.txt");
const WORKSPACE_TRANSACTION_ROOT = path.join(RUNTIME_ROOT, "workspace-transactions");
const TASK_FLIGHT_RECORDER_ROOT = path.join(RUNTIME_ROOT, "task-flight-recorder");
const REGRESSION_RUN_REPORT_PATH = path.join(RUNTIME_ROOT, "regression-last-run.json");
const SKILL_REGISTRY_PATH = path.join(RUNTIME_ROOT, "skill-registry.json");
const TOOL_REGISTRY_PATH = path.join(RUNTIME_ROOT, "tool-registry.json");
const CAPABILITY_REQUESTS_PATH = path.join(RUNTIME_ROOT, "capability-requests.json");
const WORDPRESS_SITE_REGISTRY_PATH = path.join(RUNTIME_ROOT, "wordpress-sites.json");
const IOT_HA_REGISTRY_PATH = path.join(RUNTIME_ROOT, "iot-ha-instances.json");
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
let opportunityScanInFlight = false;
let lastInteractiveActivityAt = Date.now();
let mailPollInFlight = false;
const activeTaskControllers = new Map();
const MAX_WAITING_QUESTION_COUNT = 5;
let opportunityScanState = createInitialOpportunityScanState();
const mailState = createInitialMailState();
let mailWatchRulesState = createInitialMailWatchRulesState();
let documentRulesState = createInitialDocumentRulesState();
let voicePatternStore = createInitialVoicePatternStore();
let pluginManager = null;
let memoryTrustDomain = null;

const sessionConversationStore = new Map();
const SESSION_HISTORY_MAX_EXCHANGES = 10;
const SESSION_HISTORY_EXPIRE_MS = 2 * 60 * 60 * 1000;

function getSessionHistory(sessionId = "Main") {
  const key = String(sessionId || "Main").trim() || "Main";
  const entry = sessionConversationStore.get(key);
  if (!entry) {
    return [];
  }
  if (Date.now() - Number(entry.lastAt || 0) > SESSION_HISTORY_EXPIRE_MS) {
    sessionConversationStore.delete(key);
    return [];
  }
  const exchanges = entry.exchanges.slice();
  // If there are more than 8 turns, compress the older ones into a summary
  // so the LLM retains prior topic context without a bloated prompt.
  const RECENT_WINDOW = 8;
  if (exchanges.length <= RECENT_WINDOW) {
    return exchanges;
  }
  const older = exchanges.slice(0, exchanges.length - RECENT_WINDOW);
  const recent = exchanges.slice(exchanges.length - RECENT_WINDOW);
  // Build a compact summary of older turns grouped by user message + agent action
  const summaryParts = [];
  let i = 0;
  while (i < older.length) {
    const turn = older[i];
    if (turn.role === "user") {
      const userSnippet = String(turn.text || "").slice(0, 80).replace(/\s+/g, " ");
      const next = older[i + 1];
      const agentSnippet = next?.role === "agent"
        ? String(next.text || "").replace(/\s+/g, " ").slice(0, 80)
        : "";
      const actionLabel = next?.action === "enqueue" ? " → queued"
        : next?.action === "clarify" ? " → asked clarification"
        : agentSnippet ? ` → ${agentSnippet}` : "";
      summaryParts.push(`"${userSnippet}"${actionLabel}`);
      i += next?.role === "agent" ? 2 : 1;
    } else {
      i += 1;
    }
  }
  if (!summaryParts.length) {
    return recent;
  }
  const summaryExchange = {
    role: "agent",
    text: `[Earlier in this session: ${summaryParts.join("; ")}]`,
    ts: older[0]?.ts || Date.now(),
    action: "summary"
  };
  return [summaryExchange, ...recent];
}

function appendSessionExchange(sessionId = "Main", { userText = "", agentText = "", action = "" } = {}) {
  const key = String(sessionId || "Main").trim() || "Main";
  const user = String(userText || "").trim();
  const agent = String(agentText || "").trim();
  if (!user && !agent) {
    return;
  }
  const entry = sessionConversationStore.get(key) || { exchanges: [], lastAt: 0 };
  const now = Date.now();
  if (user) {
    entry.exchanges.push({ role: "user", text: user, ts: now });
  }
  if (agent) {
    const agentEntry = { role: "agent", text: agent, ts: now };
    if (action) agentEntry.action = action;
    entry.exchanges.push(agentEntry);
  }
  // Keep the window larger — old turns will be summarised rather than silently dropped (P4)
  while (entry.exchanges.length > SESSION_HISTORY_MAX_EXCHANGES * 2) {
    entry.exchanges.shift();
  }
  entry.lastAt = now;
  sessionConversationStore.set(key, entry);
}

async function buildIntakeSystemContext() {
  try {
    const { queued = [], inProgress = [] } = await listAllTasks();
    const runningNames = inProgress
      .slice(0, 3)
      .map((task) => String(task.message || "").trim().slice(0, 80))
      .filter(Boolean);
    return {
      queuedCount: queued.length,
      inProgressCount: inProgress.length,
      inProgressNames: runningNames
    };
  } catch {
    return { queuedCount: 0, inProgressCount: 0, inProgressNames: [] };
  }
}

const memoryTrustDomainApi = new Proxy({}, {
  get(_target, property) {
    if (typeof property !== "string") {
      return undefined;
    }
    return (...args) => {
      const runtimeFn = memoryTrustDomain?.[property];
      if (typeof runtimeFn !== "function") {
        throw new Error(`memory trust runtime unavailable: ${String(property || "").trim() || "unknown"}`);
      }
      return runtimeFn(...args);
    };
  }
});

const {
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
  getTrustLevelRank,
  getTrustedEmailSourceRecords,
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
} = memoryTrustDomainApi;

// ============================================================================
// SEMANTIC COMPRESSION UTILITIES (Observer-specific)
// ============================================================================

/**
 * Extract semantic compression from a tool result if available
 * Returns either the semantic map or the raw output for backward compatibility
 */
function getToolResultSemantic(toolResult, toolName = 'tool', defaultOutput = '') {
  // If result has semantic compression metadata (attached by compressed sandbox)
  if (toolResult && toolResult.__semantic) {
    return formatSemanticForModel(toolResult.__semantic);
  }
  
  // If result is standard format with stdout/stderr
  if (toolResult && toolResult.stdout !== undefined) {
    const semantic = buildSemanticMap(String(toolResult.stdout || ''), toolName, {
      outputType: 'text'
    });
    return formatSemanticForModel(semantic);
  }
  
  // Fallback: raw output
  return defaultOutput || '';
}

/**
 * Format a tool call result for model consumption using semantic compression
 */
function formatToolResultForModel(toolName, toolInput, toolOutput) {
  // Build semantic map from output
  const semantic = buildSemanticMap(
    String(toolOutput || ''),
    toolName,
    {
      command: `${toolName}(${JSON.stringify(toolInput).substring(0, 100)})`,
      outputType: 'text'
    }
  );
  
  // Return compact format for model
  return {
    tool: toolName,
    modelFormat: formatSemanticForModel(semantic),
    density: semantic.informationDensity,
    findings: semantic.keyFindings.slice(0, 3)
  };
}
const {
  buildQdrantApiKeyHandle,
  buildSecretsCatalog,
  deleteSecretValue,
  getRetrievalConfig,
  getSecretStatus,
  hasQdrantApiKey,
  migrateLegacyQdrantApiKey,
  readJsonFileIfExists,
  readTextFileIfExists,
  resolveQdrantApiKey,
  sanitizeConfigId,
  sanitizeStringList,
  saveObserverConfig,
  setSecretValue
} = createObserverConfigSecretsDomain({
  buildMailAgentPasswordHandle: (agentId = "") => observerSecrets.buildMailAgentPasswordHandle(String(agentId || "").trim()),
  buildQdrantApiKeyHandleBase: () => observerSecrets.buildQdrantApiKeyHandle(),
  configPath: CONFIG_PATH,
  defaultQdrantCollection: DEFAULT_QDRANT_COLLECTION,
  defaultQdrantUrl: DEFAULT_QDRANT_URL,
  fs,
  getIotInstances: () => iotDomain.listInstances(),
  getMailAgents: () => getMailAgents(),
  getObserverConfig: () => observerConfig,
  getPluginManager: () => pluginManager,
  hasMailPassword: async (...args) => await hasMailPassword(...args),
  invalidateObserverConfigCaches: (...args) => invalidateObserverConfigCaches(...args),
  observerSecrets,
  processObject: process
});

const {
  annotateNovaSpeechText,
  loadVoicePatternStore,
  saveVoicePatternStore
} = createVoiceDomain({
  compactHookText,
  createInitialVoicePatternStore,
  fs,
  getVoicePatternStore: () => voicePatternStore,
  loadObserverConfig: async () => observerConfig,
  normalizeVoiceTrustProfile,
  runHook: async (...args) => await pluginManager.runHook(...args),
  sanitizeHookToken,
  saveObserverConfig,
  setVoicePatternStore: (nextStore) => {
    voicePatternStore = nextStore;
  },
  voicePatternStorePath: VOICE_PATTERN_STORE_PATH,
  writeVolumeText: (...args) => writeVolumeText(...args)
});

const {
  broadcast,
  broadcastObserverEvent,
  defaultAppPropSlots,
  defaultAppReactionPathsByModel,
  defaultAppRoomTextures,
  listPublicAssetChoices,
  normalizePropScale,
  normalizeReactionPathsByModel,
  normalizeStylizationEffectPreset,
  normalizeStylizationFilterPreset,
  scheduleTaskDispatch
} = createObserverRuntimeSupport({
  clients,
  compactHookText,
  fs,
  getObserverConfig: () => observerConfig,
  getPluginManager: () => pluginManager,
  getTaskDispatchScheduled: () => taskDispatchScheduled,
  observerEventClients,
  pathModule: path,
  processQueuedTasksToCapacity: (...args) => processQueuedTasksToCapacity(...args),
  publicRoot: path.join(__dirname, "public"),
  recoverStaleTaskDispatchLock: (...args) => recoverStaleTaskDispatchLock(...args),
  sanitizeHookToken,
  setTaskDispatchScheduled: (value) => {
    taskDispatchScheduled = value === true;
  }
});
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
  syncWorkspaceProjectToRepositorySource,
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
const {
  coreTransactionsCapability,
  taskFlightRecorder,
  workspaceTransactions
} = createWorkspaceTransactionComposition({
  compactTaskText,
  editContainerTextFile,
  emitCoreEvent: (...args) => emitCoreEvent(...args),
  fs,
  moveContainerPath,
  pathModule: path,
  readContainerFileBuffer,
  readTaskHistory: (...args) => readTaskHistory(...args),
  resolveToolPath,
  taskFlightRecorderRoot: TASK_FLIGHT_RECORDER_ROOT,
  transactionRoot: WORKSPACE_TRANSACTION_ROOT,
  writeContainerTextFile
});

async function runOllamaPrompt(model, prompt, {
  timeoutMs = AGENT_RUN_TIMEOUT_MS,
  signal = null,
  baseUrl = LOCAL_OLLAMA_BASE_URL,
  images = [],
  brainId = "",
  laneHint = "",
  leaseOwnerId = "",
  leaseWaitMs = 0,
  leaseScope = "auto"
} = {}) {
  return runOllamaJsonGenerate(model, prompt, {
    timeoutMs,
    keepAlive: MODEL_KEEPALIVE,
    options: {},
    baseUrl,
    images,
    signal,
    brainId,
    laneHint,
    leaseOwnerId,
    leaseWaitMs,
    leaseScope,
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
  format = "json",
  brainId = "",
  laneHint = "",
  leaseOwnerId = "",
  leaseWaitMs = 0,
  leaseScope = "auto"
} = {}) {
  return runOllamaGenerate(model, prompt, {
    timeoutMs,
    keepAlive,
    options,
    baseUrl,
    images,
    signal,
    format,
    brainId,
    laneHint,
    leaseOwnerId,
    leaseWaitMs,
    leaseScope
  });
}

const ollamaLeaseStateByResource = new Map();

function getOllamaLeaseState(resourceKey = "") {
  const key = String(resourceKey || "").trim();
  if (!key) {
    return null;
  }
  if (!ollamaLeaseStateByResource.has(key)) {
    ollamaLeaseStateByResource.set(key, {
      active: null,
      queue: []
    });
  }
  return ollamaLeaseStateByResource.get(key);
}

function pruneOllamaLeaseState(resourceKey = "") {
  const key = String(resourceKey || "").trim();
  const state = key ? ollamaLeaseStateByResource.get(key) : null;
  if (state && !state.active && !state.queue.length) {
    ollamaLeaseStateByResource.delete(key);
  }
}

function removeQueuedOllamaLeaseWaiter(resourceKey = "", waiter = null) {
  const key = String(resourceKey || "").trim();
  const state = key ? ollamaLeaseStateByResource.get(key) : null;
  if (!state || !waiter) {
    return;
  }
  const index = state.queue.indexOf(waiter);
  if (index >= 0) {
    state.queue.splice(index, 1);
  }
  pruneOllamaLeaseState(key);
}

function releaseOllamaLease(resourceKey = "", token = null) {
  const key = String(resourceKey || "").trim();
  const state = key ? ollamaLeaseStateByResource.get(key) : null;
  if (!state || !token || state.active !== token) {
    return;
  }
  state.active = null;
  while (state.queue.length) {
    const nextWaiter = state.queue.shift();
    if (!nextWaiter || nextWaiter.settled) {
      continue;
    }
    nextWaiter.settled = true;
    if (typeof nextWaiter.cleanup === "function") {
      nextWaiter.cleanup();
    }
    state.active = nextWaiter.token;
    nextWaiter.resolve({
      ok: true,
      waitMs: Date.now() - Number(nextWaiter.enqueuedAt || Date.now()),
      queued: true,
      release: () => releaseOllamaLease(key, nextWaiter.token)
    });
    return;
  }
  pruneOllamaLeaseState(key);
}

async function resolveOllamaLeaseResourceKey({
  brainId = "",
  laneHint = "",
  baseUrl = LOCAL_OLLAMA_BASE_URL,
  leaseScope = "auto"
} = {}) {
  const scope = String(leaseScope || "auto").trim().toLowerCase();
  if (scope === "none") {
    return "";
  }
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const normalizedLocalBaseUrl = normalizeOllamaBaseUrl(LOCAL_OLLAMA_BASE_URL);
  if (scope === "auto" && normalizedBaseUrl === normalizedLocalBaseUrl) {
    return `endpoint:${normalizedBaseUrl}`;
  }
  const explicitLane = String(laneHint || "").trim();
  if (scope !== "endpoint" && explicitLane) {
    return `lane:${explicitLane}`;
  }
  const targetBrainId = String(brainId || "").trim();
  if (scope !== "endpoint" && targetBrainId && typeof findBrainByIdExact === "function" && typeof getBrainQueueLane === "function") {
    try {
      const brain = await findBrainByIdExact(targetBrainId);
      const derivedLane = brain ? String(getBrainQueueLane(brain) || brain.queueLane || "").trim() : "";
      if (derivedLane) {
        return `lane:${derivedLane}`;
      }
    } catch {
      // Fall through to endpoint lease.
    }
  }
  return `endpoint:${normalizedBaseUrl}`;
}

async function acquireOllamaLease({
  resourceKey = "",
  ownerId = "",
  waitTimeoutMs = 0,
  signal = null
} = {}) {
  const key = String(resourceKey || "").trim();
  if (!key) {
    return {
      ok: true,
      waitMs: 0,
      queued: false,
      release: () => {}
    };
  }
  const normalizedOwnerId = String(ownerId || "").trim();
  const state = getOllamaLeaseState(key);
  const activeOwnerId = String(state?.active?.ownerId || "").trim();
  if (normalizedOwnerId && activeOwnerId && activeOwnerId === normalizedOwnerId) {
    return {
      ok: false,
      busy: true,
      sameOwner: true,
      waitMs: 0
    };
  }
  if (!state.active) {
    const token = {
      id: Symbol(key),
      ownerId: normalizedOwnerId,
      acquiredAt: Date.now()
    };
    state.active = token;
    return {
      ok: true,
      waitMs: 0,
      queued: false,
      release: () => releaseOllamaLease(key, token)
    };
  }
  const waiter = {
    token: {
      id: Symbol(key),
      ownerId: normalizedOwnerId,
      acquiredAt: 0
    },
    enqueuedAt: Date.now(),
    settled: false,
    resolve: null,
    cleanup: null
  };
  return new Promise((resolve) => {
    let timeoutId = null;
    const onAbort = () => {
      if (waiter.settled) {
        return;
      }
      waiter.settled = true;
      waiter.cleanup?.();
      removeQueuedOllamaLeaseWaiter(key, waiter);
      resolve({
        ok: false,
        aborted: true,
        waitMs: Date.now() - waiter.enqueuedAt
      });
    };
    waiter.cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };
    waiter.resolve = (value) => {
      waiter.token.acquiredAt = Date.now();
      resolve(value);
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    if (Number(waitTimeoutMs || 0) > 0) {
      timeoutId = setTimeout(() => {
        if (waiter.settled) {
          return;
        }
        waiter.settled = true;
        waiter.cleanup?.();
        removeQueuedOllamaLeaseWaiter(key, waiter);
        resolve({
          ok: false,
          busy: true,
          waitMs: Date.now() - waiter.enqueuedAt
        });
      }, Number(waitTimeoutMs));
    }
    state.queue.push(waiter);
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
  format = "",
  brainId = "",
  laneHint = "",
  leaseOwnerId = "",
  leaseWaitMs = 0,
  leaseScope = "auto"
} = {}) {
  const normalizedOptions = normalizeGenerationOptions(options);
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const resourceKey = await resolveOllamaLeaseResourceKey({
    brainId,
    laneHint,
    baseUrl: normalizedBaseUrl,
    leaseScope
  });
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
  const lease = await acquireOllamaLease({
    resourceKey,
    ownerId: leaseOwnerId,
    waitTimeoutMs: Number(leaseWaitMs || 0),
    signal: controller.signal
  });
  if (!lease.ok) {
    const externallyAborted = Boolean(signal?.aborted);
    const resourceLabel = String(resourceKey || normalizedBaseUrl).replace(/^lane:/, "").replace(/^endpoint:/, "");
    if (signal) {
      signal.removeEventListener("abort", abortExternal);
    }
    if (timeout) {
      clearTimeout(timeout);
    }
    if (lease.aborted) {
      return {
        ok: false,
        code: 124,
        text: "",
        stderr: externallyAborted ? "task aborted by user" : `Observer timeout after ${Math.round(Number(timeoutMs || 0) / 1000)}s`,
        timedOut: !externallyAborted,
        busy: false,
        resourceKey,
        leaseWaitMs: Number(lease.waitMs || 0)
      };
    }
    return {
      ok: false,
      code: 0,
      text: "",
      stderr: lease.sameOwner
        ? `Ollama resource ${resourceLabel} is already busy with this task`
        : `Ollama resource ${resourceLabel} is busy`,
      timedOut: false,
      busy: true,
      resourceKey,
      leaseWaitMs: Number(lease.waitMs || 0)
    };
  }
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
    lease.release();
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

async function retryJsonEnvelope(model, rawText, schemaHint, {
  timeoutMs = 45000,
  options = undefined,
  baseUrl = LOCAL_OLLAMA_BASE_URL,
  brainId = "",
  leaseOwnerId = "",
  leaseWaitMs = OLLAMA_SIDECAR_LEASE_WAIT_MS
} = {}) {
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
    brainId,
    leaseOwnerId,
    leaseWaitMs,
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
  baseUrl = LOCAL_OLLAMA_BASE_URL,
  leaseOwnerId = ""
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
    brainId: plannerBrain?.id || "",
    leaseOwnerId,
    leaseWaitMs: OLLAMA_SIDECAR_LEASE_WAIT_MS,
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
  baseUrl = LOCAL_OLLAMA_BASE_URL,
  leaseOwnerId = ""
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
  const inspectFirstTarget = getProjectsRuntime()?.extractTaskDirectiveValue?.(message, "Inspect first:");
  const inspectSecondTarget = getProjectsRuntime()?.extractTaskDirectiveValue?.(message, "Inspect second if needed:");
  const inspectThirdTarget = getProjectsRuntime()?.extractTaskDirectiveValue?.(message, "Inspect third if needed:");
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
    brainId: plannerBrain?.id || "",
    leaseOwnerId,
    leaseWaitMs: OLLAMA_SIDECAR_LEASE_WAIT_MS,
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
} = createObserverPromptUtils({
  compactTaskText,
  defaultLargeItemChunkChars: DEFAULT_LARGE_ITEM_CHUNK_CHARS,
  maxLargeItemChunkChars: MAX_LARGE_ITEM_CHUNK_CHARS,
  normalizeContainerPathForComparison: (...args) => getProjectsRuntime()?.normalizeContainerPathForComparison?.(...args),
  normalizeToolCallRecord: (...args) => normalizeToolCallRecord(...args)
});

const {
  buildCompletionSummary,
  buildDailyBriefingSummary,
  buildFailureSummary,
  buildGpuStatusSummary,
  buildHostSystemStatusSummary,
  buildInboxSummary,
  buildMailStatusSummary,
  buildOutputStatusSummary,
  buildQueueStatusSummary,
  buildRecentActivitySummary,
  buildRunningProcessesSummary,
  buildScheduledJobsSummary,
  buildWeatherSummary,
  ensureUniqueOutputPath,
  extractFileReferenceCandidates,
  extractQuotedSegments,
  isDirectReadFileRequest,
  isPathWithinAllowedRoots,
  normalizeContainerMountPathCandidate,
  normalizeWindowsPathCandidate,
  normalizeWorkspaceRelativePathCandidate,
  outputNameCandidateFromSource,
  readPromptMemoryContext,
  resolveSourcePathFromContainerPath,
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
  appendVolumeText: (...args) => appendVolumeText(...args),
  buildMailStatus: (...args) => buildMailStatus(...args),
  compactTaskText,
  ensureObserverOutputDir: (...args) => ensureObserverOutputDir(...args),
  fileExists: (...args) => fileExists(...args),
  formatDateTimeForUser,
  formatJobCodename,
  formatTimeForUser,
  fs,
  getActiveMailAgent: (...args) => getActiveMailAgent(...args),
  getMailState: () => mailState,
  getMailWatchRulesState: () => mailWatchRulesState,
  getObserverConfig: () => observerConfig,
  humanJoin,
  listAllTasks: (...args) => listAllTasks(...args),
  listCronRunEvents: (...args) => listCronRunEvents(...args),
  listObserverOutputFiles: (...args) => listObserverOutputFiles(...args),
  os,
  path,
  queryGpuStatus,
  readVolumeFile: (...args) => readVolumeFile(...args),
  resolveObserverOutputPath: (...args) => resolveObserverOutputPath(...args),
  runCommand,
  startOfTodayMs,
  summarizeCronTools,
  weatherConfig: {
    get apiKey() { return process.env.OPEN_WEATHER_API_KEY || ""; },
    get location() { return process.env.WEATHER_LOCATION || observerConfig?.weather?.location || ""; }
  },
  writeVolumeText: (...args) => writeVolumeText(...args)
});

const {
  collectTrackedWorkspaceTargets,
  extractContainerPathCandidates,
  isContainerWorkspacePath,
  listTrackedWorkspaceFiles,
  resolveObserverOutputPath
} = createObserverWorkspaceTracking({
  OBSERVER_CONTAINER_WORKSPACE_ROOT,
  OBSERVER_OUTPUT_ROOT,
  fs,
  isPathWithinAllowedRoots,
  normalizeContainerMountPathCandidate,
  normalizeContainerPathForComparison: (...args) => getProjectsRuntime()?.normalizeContainerPathForComparison?.(...args),
  path,
  resolveSourcePathFromContainerPath,
  runObserverToolContainerNode
});

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
  extractProjectCycleImplementationRoots: (...args) => getProjectsRuntime()?.extractProjectCycleImplementationRoots?.(...args),
  extractTaskDirectiveValue: (...args) => getProjectsRuntime()?.extractTaskDirectiveValue?.(...args),
  isPlanningDocumentPath: (...args) => getProjectsRuntime()?.isPlanningDocumentPath?.(...args),
  normalizeContainerMountPathCandidate,
  normalizeContainerPathForComparison: (...args) => getProjectsRuntime()?.normalizeContainerPathForComparison?.(...args),
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

function noteInteractiveActivity() {
  lastInteractiveActivityAt = Date.now();
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

function getMailRuntime() {
  const provider = pluginManager?.getCapability?.("mail.runtime");
  if (typeof provider !== "function") {
    return null;
  }
  try {
    const runtime = provider();
    return runtime && typeof runtime === "object" ? runtime : null;
  } catch {
    return null;
  }
}

function getMailRuntimeFn(name = "") {
  const runtime = getMailRuntime();
  const fn = runtime?.[name];
  return typeof fn === "function" ? fn : null;
}

function requireMailRuntimeFn(name = "") {
  const fn = getMailRuntimeFn(name);
  if (typeof fn === "function") {
    return fn;
  }
  throw new Error(`mail runtime unavailable: ${String(name || "").trim() || "unknown"}`);
}

function getProjectsRuntime() {
  const provider = pluginManager?.getCapability?.("projects.runtime");
  if (typeof provider !== "function") {
    return null;
  }
  try {
    const runtime = provider();
    return runtime && typeof runtime === "object" ? runtime : null;
  } catch {
    return null;
  }
}

function getProjectsRuntimeFn(name = "") {
  const runtime = getProjectsRuntime();
  const fn = runtime?.[name];
  return typeof fn === "function" ? fn : null;
}

function requireProjectsRuntimeFn(name = "") {
  const fn = getProjectsRuntimeFn(name);
  if (typeof fn === "function") {
    return fn;
  }
  throw new Error(`projects runtime unavailable: ${String(name || "").trim() || "unknown"}`);
}

function normalizeProjectConfigInput(...args) {
  const runtimeFn = getProjectsRuntimeFn("normalizeProjectConfigInput");
  if (typeof runtimeFn === "function") {
    return runtimeFn(...args);
  }
  return normalizeProjectsConfigForBootstrap(...args);
}

function getProjectConfig(...args) {
  const runtimeFn = getProjectsRuntimeFn("getProjectConfig");
  if (typeof runtimeFn === "function") {
    return runtimeFn(...args);
  }
  const configured = observerConfig?.projects && typeof observerConfig.projects === "object"
    ? observerConfig.projects
    : {};
  return normalizeProjectsConfigForBootstrap(configured);
}

function getProjectNoChangeMinimumTargets(...args) {
  const runtimeFn = getProjectsRuntimeFn("getProjectNoChangeMinimumTargets");
  if (typeof runtimeFn === "function") {
    return runtimeFn(...args);
  }
  return getProjectConfig().noChangeMinimumConcreteTargets;
}

function getProjectRolePlaybooks() {
  const playbooks = getProjectsRuntime()?.getProjectRolePlaybooks?.();
  return Array.isArray(playbooks) ? playbooks : [];
}

const {
  buildBrainActivitySnapshot,
  buildBrainConfigPayload,
  chooseDedicatedHelperScoutBrain,
  chooseHealthyRemoteTriageBrain,
  chooseHelperScoutBrains,
  chooseIdleWorkerBrainForSpecialty,
  chooseIdleWorkerBrainForSpecialtyExcluding,
  chooseIdleWorkerBrainForTransportFailover,
  chooseIntakePlanningBrain,
  choosePlannerRepairBrain,
  clearOllamaEndpointTransportFailure,
  cosineSimilarity,
  countIdleBackgroundWorkerBrains,
  countIdleHelperBrains,
  findBrainByIdExact,
  formatOllamaTransportError,
  getAgentPersonaName,
  getBrain,
  getBrainQueueLane,
  getConfiguredBrainEndpoints,
  getEnabledBrainIds,
  getHelperAnalysisForRequest,
  getIdleBackgroundExecutionCapacity,
  getOllamaEndpointHealth,
  getOllamaEndpointTransportCooldown,
  getQueueLaneLoadSnapshot,
  getTotalBackgroundExecutionCapacity,
  inspectOllamaEndpoint,
  invalidateObserverConfigCaches,
  isCpuQueueLane,
  isRemoteParallelDispatchEnabled,
  isRetriableOllamaTransportError,
  listAvailableBrains,
  listHealthyRoutingHelpers,
  listIdleHelperBrains,
  listOllamaModels,
  markOllamaEndpointTransportFailure,
  normalizeOllamaBaseUrl,
  runOllamaEmbed,
  serializeBrainEndpointConfig,
  serializeBuiltInBrainConfig,
  serializeCustomBrainConfig,
  startHelperAnalysisForRequest,
  waitMs,
  warmRuntimeBrains
} = createObserverBrainConfigDomain({
  agentBrains: AGENT_BRAINS,
  attachHelperAnalysisToRelatedTasks: (...args) => attachHelperAnalysisToRelatedTasks(...args),
  broadcast,
  compactTaskText,
  extractJsonObject,
  getObserverConfig: () => observerConfig,
  getQueueConfig,
  getRoutingConfig,
  isCapabilityCheckRequest,
  listAllTasks: (...args) => listAllTasks(...args),
  localOllamaBaseUrl: LOCAL_OLLAMA_BASE_URL,
  modelKeepAlive: MODEL_KEEPALIVE,
  normalizeAgentSelfReference,
  ollamaContainer: OLLAMA_CONTAINER,
  runCommand,
  runOllamaGenerate,
  runOllamaJsonGenerate,
  sanitizeConfigId,
  helperIdleReserveCount: HELPER_IDLE_RESERVE_COUNT
});

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
          builtIn: Array.isArray(parsed?.brains?.builtIn)
            ? parsed.brains.builtIn
            : [],
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

const mailDomainContext = {
  observerSecrets,
  assessEmailSourceIdentity,
  inspectMailCommand,
  buildMailAgentPasswordHandle: (agentId = "") => observerSecrets.buildMailAgentPasswordHandle(String(agentId || "").trim()),
  getObserverConfig: () => observerConfig,
  process,
  fs,
  writeVolumeText: (...args) => writeVolumeText(...args),
  MAIL_WATCH_RULES_PATH,
  MAIL_QUARANTINE_LOG_PATH,
  DOCUMENT_RULES_PATH,
  PROMPT_MAIL_RULES_PATH,
  parseEveryToMs,
  compactTaskText,
  formatDateTimeForUser,
  formatTaskCodename,
  hashRef,
  listAllTasks: (...args) => listAllTasks(...args),
  createWaitingTask,
  createQueuedTask,
  noteInteractiveActivity,
  normalizeSourceIdentityRecord,
  describeSourceTrust,
  findRecentDuplicateQueuedTask,
  buildFailureInvestigationTaskMessage: (...args) => getProjectsRuntime()?.buildFailureInvestigationTaskMessage?.(...args),
  closeTaskRecord,
  normalizeTrustLevel,
  getAppTrustConfig,
  getDocumentRulesState: () => documentRulesState,
  setDocumentRulesState: (next) => {
    documentRulesState = next;
  },
  getMailWatchRulesState: () => mailWatchRulesState,
  setMailWatchRulesState: (next) => {
    mailWatchRulesState = next;
  },
  getMailState: () => mailState,
  setMailPollInFlight: (next) => {
    mailPollInFlight = next === true;
  },
  getMailPollInFlight: () => mailPollInFlight,
  simpleParser,
  broadcastObserverEvent,
  broadcast,
  runMailWatchRulesNow: (...args) => runMailWatchRulesNow(...args),
  nodemailer,
  escapeRegex
};

const mailRuntimeBridge = new Proxy({}, {
  get(_target, property) {
    if (typeof property !== "string") {
      return undefined;
    }
    return (...args) => {
      const fn = getMailRuntimeFn(property);
      return typeof fn === "function" ? fn(...args) : undefined;
    };
  }
});

const {
  migrateLegacyMailPassword,
  resolveMailPassword,
  hasMailPassword,
  resolveMailAuth,
  normalizeMailWatchRuleAction,
  extractEmailDomain,
  normalizeMailWatchRuleMatch,
  hasMailWatchRuleMatch,
  describeMailWatchRuleMatch,
  isExplicitMailWatchActionRule,
  buildMailWatchActionRuleFromMessage,
  parseMailWatchRuleAnswerIntent,
  loadMailWatchRulesState,
  saveMailWatchRulesState,
  loadDocumentRulesState,
  saveDocumentRulesState,
  getMailAgents,
  hasMailCredentials,
  looksLikeEmailAddress,
  getActiveMailAgent,
  buildMailStatus,
  resolveMailWatchNotifyEmail,
  forwardMailToUser,
  sendUnsureMailDigest,
  getMailWatchRule,
  findMailWatchWaitingTask,
  buildMailWatchSingleQuestion,
  handleMailWatchWaitingAnswer,
  reconcileMailWatchWaitingQuestions,
  upsertMailWatchRule,
  resolveMailCommandSourceIdentity,
  buildMailCommandRecord,
  refreshRecentMailTrustForSource,
  determineMailCommandAction,
  handleIncomingMailCommand,
  loadMailQuarantineLog,
  saveMailQuarantineLog,
  fetchRecentMessagesForAgent,
  pollActiveMailbox,
  sendAgentMail,
  moveAgentMail,
  toolSendMail,
  toolMoveMail,
  parseDirectMailRequest,
  parseStandingMailWatchRequest,
  isDefinitelyGoodMail,
  isDefinitelyBadMail,
  summarizeMailForUser,
  findRecentMailMatch,
  resolveSpecialUseMailbox,
  parseMailWatchAnswerAction,
} = mailRuntimeBridge;

const {
  deriveTaskIndexPathDetails,
  ensureObserverOutputDir,
  ensureTaskQueueDirs,
  extractTaskIdFromQueuePath,
  findIndexedTaskById,
  listVolumeFiles,
  migrateLegacyTaskQueueIfNeeded,
  readTaskHistory,
  readTaskRecordAtPath,
  readTaskStateIndex,
  readVolumeFile,
  recordTaskBreadcrumb,
  recordCoreEvent,
  resolveQueueWorkspacePath,
  writeVolumeText
} = createObserverTaskStorageIo({
  appendVolumeText,
  compactTaskText,
  fileExists,
  fs,
  legacyTaskQueueRetireAfterMs: LEGACY_TASK_QUEUE_RETIRE_AFTER_MS,
  legacyTaskQueueRoot: LEGACY_TASK_QUEUE_ROOT,
  observerOutputRoot: OBSERVER_OUTPUT_ROOT,
  pathModule: path,
  shouldHideInspectorEntry,
  taskEventLogPath: TASK_EVENT_LOG_PATH,
  taskPathForStatus: (...args) => taskPathForStatus(...args),
  taskQueueClosed: TASK_QUEUE_CLOSED,
  taskQueueDone: TASK_QUEUE_DONE,
  taskQueueInbox: TASK_QUEUE_INBOX,
  taskQueueInProgress: TASK_QUEUE_IN_PROGRESS,
  taskQueueRoot: TASK_QUEUE_ROOT,
  taskQueueWorkspacePath: TASK_QUEUE_WORKSPACE_PATH,
  taskEventSeqPath: TASK_EVENT_SEQ_PATH,
  taskStateIndexPath: TASK_STATE_INDEX_PATH,
  workspaceTaskPath: (...args) => workspaceTaskPath(...args)
});

async function emitCoreEvent(event = {}) {
  const recorded = await recordCoreEvent(event);
  broadcastObserverEvent({
    ...event,
    eventSeq: Number(recorded?.eventSeq || 0)
  });
  return recorded;
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

function getPluginCapability(name = "") {
  if (!pluginManager || typeof pluginManager.getCapability !== "function") {
    return null;
  }
  return pluginManager.getCapability(name);
}

function isPluginEnabled(pluginId = "") {
  const normalizedId = String(pluginId || "").trim();
  if (!normalizedId || !pluginManager || typeof pluginManager.listPlugins !== "function") {
    return false;
  }
  const plugin = pluginManager.listPlugins().find((entry) => String(entry?.id || "").trim() === normalizedId);
  return plugin?.enabled === true;
}

async function invokeCapability(name = "", ...args) {
  const provider = getPluginCapability(name);
  if (typeof provider !== "function") {
    throw new Error(`capability unavailable: ${String(name || "unknown")}`);
  }
  return await provider(...args);
}

async function invokeOptionalCapability(name = "", fallback = null, ...args) {
  const provider = getPluginCapability(name);
  if (typeof provider !== "function") {
    return fallback;
  }
  return await provider(...args);
}

function normalizeReferenceToken(value = "") {
  return String(value || "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/[.?!]+$/g, "")
    .trim();
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
const {
  attachHelperAnalysisToRelatedTasks,
  buildFailureReshapeMessage,
  buildRetryTaskMeta,
  canReshapeTask,
  getTaskReshapeAttemptCount,
  getTaskRootId,
  listTaskReshapeIssues,
  markTaskCriticalFailure,
  recordTaskReshapeReview,
  resetTaskReshapeIssueState
} = createTaskReshapeDomain({
  broadcastObserverEvent,
  buildCapabilityMismatchRetryMessage: (...args) => buildCapabilityMismatchRetryMessage(...args),
  classifyFailureText: (...args) => classifyFailureText(...args),
  compactTaskText,
  findTaskById: (...args) => findTaskById(...args),
  fs,
  getProjectsRuntime,
  hashRef: (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16),
  listAllTasks: (...args) => listAllTasks(...args),
  materializeTaskRecord: (...args) => materializeTaskRecord(...args),
  maxTaskReshapeAttempts: MAX_TASK_RESHAPE_ATTEMPTS,
  pathModule: path,
  taskPathForStatus: (...args) => taskPathForStatus(...args),
  taskReshapeIssuesPath: TASK_RESHAPE_ISSUES_PATH,
  taskReshapeLogPath: TASK_RESHAPE_LOG_PATH,
  workspaceTaskPath: (...args) => workspaceTaskPath(...args),
  writeTask: (...args) => writeTask(...args),
  writeVolumeText: (...args) => writeVolumeText(...args)
});
const runInternalRegressionCase = createInternalRegressionRunner({
  createSkillLibraryService,
  createToolConfigService,
  buildRegressionFailure,
  classifyFailureText: (...args) => classifyFailureText(...args),
  extractJsonObject,
  normalizeWorkerDecisionEnvelope: (...args) => normalizeWorkerDecisionEnvelope(...args),
  parseToolCallArgs,
  buildRetryTaskMeta,
  normalizeProjectConfigInput,
  buildCapabilityMismatchRetryMessage: (...args) => buildCapabilityMismatchRetryMessage(...args),
  buildProjectCycleCompletionPolicy: (...args) => getProjectsRuntime()?.buildProjectCycleCompletionPolicy?.(...args),
  isCapabilityMismatchFailure: (...args) => isCapabilityMismatchFailure(...args),
  chooseAutomaticRetryBrainId,
  extractTaskDirectiveValue: (...args) => getProjectsRuntime()?.extractTaskDirectiveValue?.(...args),
  evaluateProjectCycleCompletionState: (...args) => getProjectsRuntime()?.evaluateProjectCycleCompletionState?.(...args),
  objectiveRequiresConcreteImprovement: (...args) => getProjectsRuntime()?.objectiveRequiresConcreteImprovement?.(...args),
  buildToolLoopStepDiagnostics,
  buildToolLoopStopMessage,
  ensureClawhubCommandSucceeded,
  searchSkillLibrary,
  inspectSkillLibrarySkill,
  installSkillIntoWorkspace,
  listInstalledSkills,
  buildProjectPipelineCollection: (...args) => getProjectsRuntime()?.buildProjectPipelineCollection?.(...args),
  chooseProjectCycleRecoveryBrain: (...args) => getProjectsRuntime()?.chooseProjectCycleRecoveryBrain?.(...args),
  chooseEscalationRetryBrainId: (...args) => getProjectsRuntime()?.chooseEscalationRetryBrainId?.(...args),
  buildEscalationCloseRecommendation: (...args) => getProjectsRuntime()?.buildEscalationCloseRecommendation?.(...args),
  buildProjectCycleFollowUpMessage: (...args) => getProjectsRuntime()?.buildProjectCycleFollowUpMessage?.(...args),
  inferProjectCycleSpecialty: (...args) => getProjectsRuntime()?.inferProjectCycleSpecialty?.(...args),
  buildProjectDirectiveContent: (...args) => getProjectsRuntime()?.buildProjectDirectiveContent?.(...args),
  buildProjectRoleTaskBoardContent: (...args) => getProjectsRuntime()?.buildProjectRoleTaskBoardContent?.(...args),
  parseProjectDirectiveState: (...args) => getProjectsRuntime()?.parseProjectDirectiveState?.(...args),
  parseProjectTodoState: (...args) => getProjectsRuntime()?.parseProjectTodoState?.(...args),
  buildProjectTodoContent: (...args) => getProjectsRuntime()?.buildProjectTodoContent?.(...args),
  buildProjectWorkPackages: (...args) => getProjectsRuntime()?.buildProjectWorkPackages?.(...args),
  getProjectWorkAttemptCooldownMs: (...args) => getProjectsRuntime()?.getProjectWorkAttemptCooldownMs?.(...args),
  chooseProjectWorkTargets: (...args) => getProjectsRuntime()?.chooseProjectWorkTargets?.(...args),
  normalizeSummaryComparisonText,
  looksLikePlaceholderTaskMessage: (...args) => looksLikePlaceholderTaskMessage(...args),
  isConcreteImplementationInspectionTarget: (...args) => getProjectsRuntime()?.isConcreteImplementationInspectionTarget?.(...args),
  isEchoedToolResultEnvelope: (...args) => isEchoedToolResultEnvelope(...args),
  collectTrackedWorkspaceTargets,
  shouldBypassWorkerPreflight: (...args) => shouldBypassWorkerPreflight(...args),
  buildPostToolDecisionInstruction,
  buildWorkerSpecialtyPromptLines: (...args) => buildWorkerSpecialtyPromptLines(...args),
  buildQueuedTaskExecutionPrompt: (...args) => buildQueuedTaskExecutionPrompt(...args),
  buildTranscriptForPrompt,
  replanRepeatedToolLoopWithPlanner,
  normalizeToolCallRecord,
  normalizeToolName,
  normalizeContainerPathForComparison: (...args) => getProjectsRuntime()?.normalizeContainerPathForComparison?.(...args),
  extractInspectionTargetKey,
  parseToolCallArgs,
  resolveToolPath,
  requireNonEmptyToolContent,
  runPluginInternalRegressionCase: async (testCase = {}) => {
    if (!pluginManager || typeof pluginManager.runInternalRegressionCase !== "function") {
      return null;
    }
    return await pluginManager.runInternalRegressionCase(testCase, {
      buildRegressionFailure,
      determineMailCommandAction,
      getObserverConfig: () => observerConfig,
      setObserverConfig: (nextConfig) => {
        observerConfig = nextConfig;
      }
    });
  },
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
  tryBuildObserverNativeResponse: (...args) => tryBuildObserverNativeResponse(...args),
  planIntakeWithBitNet,
  createQueuedTask,
  processNextQueuedTask,
  findTaskById,
  waitMs,
  listAllTasks: (...args) => listAllTasks(...args),
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
  listPluginRegressionSuites: ({ outputRoot } = {}) => {
    if (!pluginManager || typeof pluginManager.listRegressionSuites !== "function") {
      return [];
    }
    return pluginManager.listRegressionSuites({ outputRoot });
  },
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

const {
  isCanonicalInProgressTaskRun,
  isTodoBackedWaitingTask,
  listAllTasks,
  listTasksByFolder,
  materializeTaskRecord,
  persistTaskTransition,
  recoverConflictingInProgressLaneTasks,
  recoverStaleInProgressTasks,
  recoverStaleTaskDispatchLock,
  removeTaskRecord,
  taskPathForStatus,
  workspaceTaskPath,
  writeTask,
  writeTaskRecord
} = createObserverTaskStorage({
  broadcast,
  broadcastObserverEvent,
  compactTaskText,
  deriveTaskIndexPathDetails,
  ensureTaskQueueDirs,
  fileExists,
  formatElapsedShort,
  fs,
  getBrain,
  getBrainQueueLane,
  getTaskDispatchInFlight: () => taskDispatchInFlight,
  getTaskDispatchStartedAt: () => taskDispatchStartedAt,
  listVolumeFiles,
  normalizeTaskRecord,
  pathModule: path,
  readVolumeFile,
  recordTaskBreadcrumb,
  setTaskDispatchInFlight: (value) => {
    taskDispatchInFlight = value;
  },
  setTaskDispatchStartedAt: (value) => {
    taskDispatchStartedAt = value;
  },
  taskOrphanedInProgressMs: TASK_ORPHANED_IN_PROGRESS_MS,
  taskQueueClosed: TASK_QUEUE_CLOSED,
  taskQueueDone: TASK_QUEUE_DONE,
  taskQueueInbox: TASK_QUEUE_INBOX,
  taskQueueInProgress: TASK_QUEUE_IN_PROGRESS,
  taskQueueWaiting: TASK_QUEUE_WAITING,
  taskStaleInProgressMs: TASK_STALE_IN_PROGRESS_MS,
  writeVolumeText
});

const {
  buildQueuedTaskExecutionPrompt
} = createObserverQueuedTaskPrompting({
  buildProjectQueuedTaskExecutionPrompt: (...args) => getProjectsRuntime()?.buildProjectQueuedTaskExecutionPrompt?.(...args),
  OBSERVER_CONTAINER_OUTPUT_ROOT,
  extractTaskDirectiveValue: (...args) => getProjectsRuntime()?.extractTaskDirectiveValue?.(...args),
  inferTaskCapabilityProfile: (...args) => inferTaskCapabilityProfile(...args),
  isProjectCycleMessage: (...args) => getProjectsRuntime()?.isProjectCycleMessage?.(...args),
  isProjectCycleTask: (...args) => getProjectsRuntime()?.isProjectCycleTask?.(...args),
  inferTaskSpecialty: (...args) => inferTaskSpecialty(...args),
  summarizeTaskCapabilities: (...args) => summarizeTaskCapabilities(...args),
  runPluginHook: async (hookName, payload) => {
    if (pluginManager && typeof pluginManager.runHook === "function") {
      return pluginManager.runHook(hookName, payload);
    }
    return payload;
  }
});

async function chooseAutomaticRetryBrainId(task = {}, failureClassification = "") {
  const attempted = new Set((Array.isArray(task?.specialistAttemptedBrainIds) ? task.specialistAttemptedBrainIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean));
  const requestedBrainId = String(task?.requestedBrainId || "worker").trim() || "worker";
  attempted.add(requestedBrainId);
  const specialty = inferTaskSpecialty(task) || "general";
  const projectCycleRecoveryBrain = await getProjectsRuntime()?.chooseProjectCycleRecoveryBrain?.(
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
  return ["opportunity_scan", "mail_watch", "agent_recreation"].includes(internalJobType);
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
  if (internalJobType === "agent_recreation") {
    return "Agent recreation cycle completed and was closed automatically.";
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
  if (/[\u0000-\u001F\u007F\u0085\u2028\u2029]/.test(input)) {
    throw new Error("path contains control characters");
  }
  if (input.startsWith("/")) {
    const normalized = path.posix.normalize(input.replaceAll("\\", "/"));
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
    return relative
      && relative !== "."
      ? `${OBSERVER_CONTAINER_INPUT_ROOT}/${relative}`
      : OBSERVER_CONTAINER_INPUT_ROOT;
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
    return relative
      && relative !== "."
      ? `${OBSERVER_CONTAINER_OUTPUT_ROOT}/${relative}`
      : OBSERVER_CONTAINER_OUTPUT_ROOT;
  }
  return normalizedRelative && normalizedRelative !== "."
    ? `${OBSERVER_CONTAINER_WORKSPACE_ROOT}/${normalizedRelative}`
    : OBSERVER_CONTAINER_WORKSPACE_ROOT;
}

const {
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
} = createObserverDocumentDomain({
  buildChunkedTextPayload,
  compactTaskText,
  cosineSimilarity,
  createInitialDocumentRulesState,
  defaultQdrantCollection: DEFAULT_QDRANT_COLLECTION,
  defaultQdrantUrl: DEFAULT_QDRANT_URL,
  documentIndexPath: DOCUMENT_INDEX_PATH,
  ensurePromptWorkspaceScaffolding,
  formatDayKey,
  fs,
  getDocumentRulesState: () => documentRulesState,
  getOllamaEndpointHealth,
  getRetrievalConfig,
  hasQdrantApiKey,
  hashRef,
  listAvailableBrains,
  listRecursiveFiles: (...args) => listRecursiveFiles(...args),
  maxDocumentSourceBytes: MAX_DOCUMENT_SOURCE_BYTES,
  observerAttachmentsRoot: OBSERVER_ATTACHMENTS_ROOT,
  observerOutputRoot: OBSERVER_OUTPUT_ROOT,
  pathModule: path,
  promptMemoryBriefingsRoot: PROMPT_MEMORY_BRIEFINGS_ROOT,
  promptTodayBriefingPath: PROMPT_TODAY_BRIEFING_PATH,
  readContainerFileBuffer,
  resolveQdrantApiKey,
  resolveToolPath,
  retrievalStatePath: RETRIEVAL_STATE_PATH,
  runOllamaEmbed,
  simpleParser,
  workspaceRoot: WORKSPACE_ROOT,
  writeVolumeText
});
const iotDomain = createObserverIotDomain({
  fs,
  path,
  registryPath: IOT_HA_REGISTRY_PATH,
  getSecret: (...args) => observerSecrets.getSecret(...args),
  hasSecret: (...args) => observerSecrets.hasSecret(...args),
  setSecret: (...args) => observerSecrets.setSecret(...args),
  deleteSecret: (...args) => observerSecrets.deleteSecret(...args),
  // Lazy — pluginManager is assigned after iotDomain is created
  getRunHook: () => pluginManager?.runHook?.bind(pluginManager) ?? null
});

const {
  executeWorkerToolCall,
  WORKER_TOOLS
} = createObserverWorkerTools({
  PROMPT_MEMORY_PERSONAL_DAILY_ROOT,
  OBSERVER_CONTAINER_INPUT_ROOT,
  TASK_QUEUE_IN_PROGRESS,
  PDFDocument,
  StandardFonts,
  appendHookTrace: (...args) => taskFlightRecorder.appendHookTrace(...args),
  appendReadBasis: (...args) => taskFlightRecorder.appendReadBasis(...args),
  appendVolumeText,
  compactTaskText,
  editContainerTextFile,
  ensureAutonomousToolApproved,
  ensureVolumeFile,
  formatDayKey,
  fs,
  getPluginManager: () => pluginManager,
  inspectSkillLibrarySkill,
  listFilesInContainer,
  listInstalledSkills,
  moveContainerPath,
  normalizeToolCallRecord,
  normalizeToolName,
  parseToolCallArgs,
  path,
  pdfParse,
  readContainerFileBuffer,
  readVolumeFile,
  recordSkillInstallationRequest,
  recordToolAdditionRequest,
  resolveToolPath,
  rgb,
  runObserverToolContainerNode,
  runSandboxShell,
  searchSkillLibrary,
  workspaceTransactions,
  iotDomain,
  toolMoveMail,
  toolReadDocument,
  toolSendMail,
  writeContainerTextFile,
  writeVolumeText
});

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
  const creativeHandoffSkipped = taskMeta?.skipCreativeHandoff === true;
  const creativeHandoffBrain = !String(taskMeta?.creativeHandoffBrainId || "").trim()
    && !creativeHandoffSkipped
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
  // Let plugins react to new task creation (sprint correlation, calendar logging, etc.)
  pluginManager.runHook("queue:task-created", {
    at: Date.now(),
    taskId: queuedTask.id,
    codename: queuedTask.codename,
    message: compactHookText(String(queuedTask.message || "").trim(), 220),
    sessionId: String(queuedTask.sessionId || "Main").trim(),
    brainId: String(queuedTask.requestedBrainId || "").trim(),
    queueLane: String(queuedTask.queueLane || "").trim(),
    internalJobType: String(queuedTask.internalJobType || "").trim()
  }).catch(() => {});
  scheduleTaskDispatch();
  return queuedTask;
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
  answerWaitingTask,
  buildTodoTextFromWaitingQuestion,
  shouldRouteWaitingTaskToTodo
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
const {
  appendFailureTelemetryEntry,
  appendQueueMaintenanceReport,
  buildCapabilityMismatchRetryMessage,
  classifyFailureText,
  extractProjectCycleObjectiveText,
  isCapabilityMismatchFailure,
  isProjectCyclePlanningObjective,
  isTransportFailoverFailure
} = createObserverFailureDomain({
  appendDailyOperationalMemory,
  compactTaskText,
  failureTelemetryLogPath: FAILURE_TELEMETRY_LOG_PATH,
  fs,
  getProjectNoChangeMinimumTargets,
  getProjectsRuntime,
  looksLikePlaceholderTaskMessage: (...args) => looksLikePlaceholderTaskMessage(...args),
  pathModule: path,
  queueMaintenanceLogPath: QUEUE_MAINTENANCE_LOG_PATH
});
const {
  buildAllowedOpportunityReferences,
  buildOpportunityWorkspaceSnapshot,
  buildTaskMaintenanceSnapshot,
  deriveOpportunityAnchorData,
  isBogusOrMetaOpportunityMessage,
  listRecursiveFiles,
  messageReferencesKnownOpportunitySource,
  planWorkspaceOpportunities
} = createObserverOpportunityDomain({
  compactTaskText,
  fs,
  hashRef,
  listAllTasks,
  observerInputHostRoot: OBSERVER_INPUT_HOST_ROOT,
  opportunityScanState,
  pathModule: path,
  visibleCompletedHistoryCount: VISIBLE_COMPLETED_HISTORY_COUNT,
  visibleFailedHistoryCount: VISIBLE_FAILED_HISTORY_COUNT
});

const {
  chooseQuestionMaintenanceBrain,
  extractConcreteTaskFileTargets,
  maybeRewritePromptWithIdleBrain,
  runIntakeWithOptionalRewrite,
  runWorkerTaskPreflight,
  shouldBypassWorkerPreflight
} = createObserverIntakePreflight({
  MODEL_KEEPALIVE,
  compactTaskText,
  extractFileReferenceCandidates,
  extractJsonObject,
  getBrain,
  isCpuQueueLane,
  listHealthyRoutingHelpers,
  listIdleHelperBrains,
  looksLikePlaceholderTaskMessage: (...args) => looksLikePlaceholderTaskMessage(...args),
  normalizeContainerMountPathCandidate,
  normalizeUserRequest: (...args) => normalizeUserRequest(...args),
  normalizeWindowsPathCandidate,
  normalizeWorkspaceRelativePathCandidate,
  planIntakeWithBitNet: async (opts = {}) => {
    const history = getSessionHistory(opts?.sessionId);
    const sysCtx = await buildIntakeSystemContext();
    return planIntakeWithBitNet({ ...opts, recentExchanges: history, systemContext: sysCtx });
  },
  getSessionHistory,
  looksLikeFollowUpMessage,
  runOllamaJsonGenerate,
  tryBuildObserverNativeResponse: (...args) => tryBuildObserverNativeResponse(...args)
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
  getProjectRolePlaybooks,
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
  inferProjectCycleSpecialty: (...args) => getProjectsRuntime()?.inferProjectCycleSpecialty?.(...args),
  listAllTasks,
  listContainerWorkspaceProjects,
  messageReferencesKnownOpportunitySource,
  readVolumeFile,
  runOllamaJsonGenerate,
  writeVolumeText
});

const {
  ensureOpportunityScanJob,
  executeOpportunityScanJob
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
  buildFailureInvestigationTaskMessage: (...args) => getProjectsRuntime()?.buildFailureInvestigationTaskMessage?.(...args),
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
  fillWorkspaceProjectsFromRepositories: async (...args) => await getProjectsRuntime()?.fillWorkspaceProjectsFromRepositories?.(...args) ?? [],
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
  inferTaskSpecialty: (...args) => inferTaskSpecialty(...args),
  isBogusOrMetaOpportunityMessage,
  isRemoteParallelDispatchEnabled,
  listAllTasks,
  listContainerWorkspaceProjects,
  listTasksByFolder,
  markTaskCriticalFailure,
  planTaskMaintenanceActions: (...args) => getProjectsRuntime()?.planTaskMaintenanceActions?.(...args),
  planWorkspaceOpportunities,
  processWorkspaceProjectForOpportunityScan: (...args) => getProjectsRuntime()?.processWorkspaceProjectForOpportunityScan?.(...args),
  queueHelperScoutTask,
  recordTaskReshapeReview,
  saveOpportunityScanState,
  writeDailyDocumentBriefing,
  opportunityScanState
});

const {
  ensureQuestionMaintenanceJob,
  executeMailWatchJob,
  runMailWatchRulesNow
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
  closeTaskRecord,
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
  executeEscalationReviewJob
} = createObserverEscalationReview({
  MAX_TASK_RESHAPE_ATTEMPTS,
  MODEL_KEEPALIVE,
  buildConcreteReviewReason: (...args) => getProjectsRuntime()?.buildConcreteReviewReason?.(...args),
  buildEscalationCloseRecommendation: (...args) => getProjectsRuntime()?.buildEscalationCloseRecommendation?.(...args),
  buildEscalationSplitProjectWorkKey: (...args) => getProjectsRuntime()?.buildEscalationSplitProjectWorkKey?.(...args),
  buildProjectCycleFollowUpMessage: (...args) => getProjectsRuntime()?.buildProjectCycleFollowUpMessage?.(...args),
  buildRetryTaskMeta,
  canReshapeTask,
  chooseEscalationRetryBrainId: (...args) => getProjectsRuntime()?.chooseEscalationRetryBrainId?.(...args),
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

const {
  ensureRecreationJob,
  executeRecreationJob
} = createObserverRecreationJob({
  AGENT_BRAINS,
  RECREATION_IDLE_COOLDOWN_MS,
  RECREATION_ACTIVE_INTERVAL_MS,
  TASK_QUEUE_CLOSED,
  TASK_QUEUE_DONE,
  TASK_QUEUE_INBOX,
  TASK_QUEUE_IN_PROGRESS,
  createQueuedTask,
  ensurePromptWorkspaceScaffolding,
  executeObserverRun: (...args) => executeObserverRun(...args),
  formatDateTimeForUser,
  getBrain,
  getAgentPersonaName,
  getObserverConfig: () => observerConfig,
  listTasksByFolder,
  observerContainerWorkspaceRoot: OBSERVER_CONTAINER_WORKSPACE_ROOT,
  path,
  promptMemoryPersonalDailyRoot: PROMPT_MEMORY_PERSONAL_DAILY_ROOT,
  readVolumeFile
});

async function tickObserverCronQueue() {
  if (observerCronTickInFlight) {
    return;
  }
  observerCronTickInFlight = true;
  try {
    await pluginManager.runHook("runtime:tick:cron", {
      at: Date.now(),
      source: "cron_queue"
    });
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
  buildCompletionReviewSummary,
  buildTaskCapabilityPromptLines,
  canBrainHandleSpecialty,
  chooseCreativeHandoffBrain,
  chooseLessLoadedEquivalentWorker,
  executeCreativeHandoffPass,
  inferTaskCapabilityProfile,
  inferTaskSpecialty,
  isCreativeOnlyBrain,
  isVisionOnlyBrain,
  looksLikePlaceholderTaskMessage,
  normalizeUserRequest,
  preferHigherReliabilityProjectCycleWorker,
  readUserProfileSummary,
  renderCreativeHandoffPacket,
  scoreBrainForSpecialty,
  selectSpecialistBrainRoute,
  selectToolsForTask,
  summarizeTaskCapabilities,
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
  forceToolUse = false,
  recentExchanges = [],
  systemContext = {}
} = {}) {
  const intakeBrain = await chooseIntakePlanningBrain() || await getBrain("bitnet");
  const systemPrompt = await buildIntakeSystemPrompt({
    internetEnabled,
    selectedMountIds,
    forceToolUse,
    sessionId,
    recentExchanges,
    systemContext
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
      baseUrl: intakeBrain.ollamaBaseUrl,
      brainId: intakeBrain.id,
      leaseOwnerId: `intake:${String(sessionId || "Main").trim() || "Main"}`,
      leaseWaitMs: OLLAMA_INTAKE_LEASE_WAIT_MS
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
        : "I'll queue that for the worker.",
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
  let action = parsed.action === "reply_only" ? "reply_only" : parsed.action === "clarify" ? "clarify" : "enqueue";
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
  if (action !== "reply_only" && action !== "clarify" && !tasks.length) {
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
  // Let plugins observe direct replies (session-memory, analytics, etc.)
  if (action === "reply_only" || action === "clarify") {
    pluginManager.runHook("intake:reply-complete", {
      at: Date.now(),
      action,
      sessionId: String(sessionId || "Main").trim(),
      messagePreview: compactHookText(String(message || "").trim(), 200),
      replyPreview: compactHookText(String(replyText || "").trim(), 300)
    }).catch(() => {});
  }
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
    || isFinanceSummaryRequest(message)
    || isProjectStatusRequest(message)
    || isScheduledJobsRequest(message)
    || isSystemStatusRequest(message)
    || isTodoNativeRequest(message);
}

memoryTrustDomain = createMemoryTrustDomain({
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
  QUESTION_MAINTENANCE_TARGETS,
} = memoryTrustDomain;

let pluginToolCatalogCache = [];

function collectPluginToolsSync(scope = "") {
  if (pluginManager && typeof pluginManager.listTools === "function") {
    pluginToolCatalogCache = pluginManager.listTools();
  }
  const normalizedScope = String(scope || "").trim().toLowerCase();
  const tools = Array.isArray(pluginToolCatalogCache) ? pluginToolCatalogCache.slice() : [];
  if (!normalizedScope) {
    return tools;
  }
  return tools.filter((entry) => Array.isArray(entry.scopes) && entry.scopes.includes(normalizedScope));
}

async function refreshPluginToolCatalogCache() {
  if (!pluginManager) {
    pluginToolCatalogCache = [];
    return;
  }
  let tools = [];
  if (typeof pluginManager.listTools === "function") {
    tools = pluginManager.listTools();
  } else if (typeof pluginManager.runHook === "function") {
    const payload = await pluginManager.runHook("intake:tools:list", { tools: [] });
    tools = Array.isArray(payload?.tools) ? payload.tools : [];
  }
  pluginToolCatalogCache = tools
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      name: String(entry.name || "").trim(),
      description: String(entry.description || "").trim(),
      parameters: entry.parameters && typeof entry.parameters === "object" ? entry.parameters : {},
      scopes: Array.isArray(entry.scopes)
        ? entry.scopes.map((scope) => String(scope || "").trim().toLowerCase()).filter(Boolean)
        : [String(entry.scope || "intake").trim().toLowerCase()].filter(Boolean),
      risk: String(entry.risk || "normal").trim().toLowerCase() || "normal",
      defaultApproved: entry.defaultApproved !== false,
      source: String(entry.source || "plugin").trim() === "core" ? "core" : "plugin",
      pluginId: String(entry.pluginId || "").trim(),
      pluginName: String(entry.pluginName || "").trim()
    }))
    .filter((entry) => entry.name);
}

async function executePluginIntakeToolCall({ name = "", args = {}, toolCall = null, normalized = null } = {}) {
  if (!pluginManager || typeof pluginManager.runHook !== "function") {
    return null;
  }
  const result = await pluginManager.runHook("intake:tool-call", {
    handled: false,
    name: String(name || "").trim(),
    args: args && typeof args === "object" ? args : {},
    toolCall,
    normalized,
    result: null
  });
  if (result?.handled === true) {
    return result.result ?? null;
  }
  return null;
}

const INTAKE_TOOLS = OBSERVER_INTAKE_TOOLS;

function buildToolCatalog() {
  const pluginWorkerTools = collectPluginToolsSync("worker");
  const pluginIntakeTools = collectPluginToolsSync("intake");
  return buildObserverToolCatalog({
    workerTools: [...WORKER_TOOLS, ...pluginWorkerTools],
    intakeTools: [...INTAKE_TOOLS, ...pluginIntakeTools]
  });
}

const { executeIntakeToolCall } = createObserverIntakeToolExecutor({
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
  buildScheduledJobsSummary,
  buildSystemStatusSummary: async () => {
    const lines = [];
    const plugins = typeof pluginManager?.listPlugins === "function" ? pluginManager.listPlugins() : [];
    const enabled = plugins.filter((p) => p?.enabled === true);
    const disabled = plugins.filter((p) => p?.enabled !== true);
    lines.push(
      enabled.length
        ? `System running. ${enabled.length} plugin${enabled.length === 1 ? "" : "s"} active${disabled.length ? `, ${disabled.length} disabled` : ""}.`
        : "System running. No plugins currently enabled."
    );
    if (enabled.length) {
      lines.push("Active plugins: " + enabled.map((p) => p.name || p.id).join(", ") + ".");
    }
    if (disabled.length) {
      lines.push("Disabled plugins: " + disabled.map((p) => p.name || p.id).join(", ") + ".");
    }
    return lines;
  },
  ensureAutonomousToolApproved,
  executePluginIntakeToolCall,
  formatDateForUser,
  formatDateTimeForUser,
  formatTimeForUser,
  inspectSkillLibrarySkill,
  listInstalledSkills,
  normalizeToolCallRecord,
  normalizeToolName,
  parseToolCallArgs,
  readPromptMemoryContext,
  recordSkillInstallationRequest,
  recordToolAdditionRequest,
  searchSkillLibrary,
  toolMoveMail,
  toolSendMail,
  writePromptMemoryFile,
  buildHostSystemStatusSummary,
  buildGpuStatusSummary,
  buildRunningProcessesSummary,
  buildWeatherSummary
});

const {
  extractTodoAddRequest,
  extractTodoCompleteRequest,
  extractTodoRemoveRequest,
  isTodoSummaryRequest,
  tryBuildObserverNativeResponse,
  tryHandleCopyToOutputRequest,
  tryHandleDirectMailRequest,
  tryHandleReadFileRequest,
  tryHandleSkillLibraryRequest,
  tryHandleStandingMailWatchRequest,
  tryHandleTodoRequest
} = createObserverNativeResponseHelpers({
  PROMPT_USER_PATH,
  addTodoItem: async (payload = {}) => await invokeCapability("todo.addItem", payload),
  broadcast,
  buildCalendarSummary: async (options = {}) => {
    const lines = await invokeOptionalCapability("calendar.buildSummary", ["Calendar plugin is unavailable."], options);
    return Array.isArray(lines) ? lines.map((entry) => String(entry || "").trim()).filter(Boolean) : [];
  },
  buildChunkedTextPayload,
  buildCompletionSummary,
  buildDailyBriefingSummary,
  buildDocumentOverviewSummary,
  buildDocumentSearchSummary,
  buildFailureSummary,
  buildFinanceSummary: async () => {
    const finance = await invokeOptionalCapability("finance.listEntries", null);
    if (!finance || typeof finance !== "object") {
      return ["Finance plugin is unavailable or no entries recorded yet."];
    }
    const { entries = [], summary = {}, financialYears = [] } = finance;
    const lines = [];
    const totalCount = Number(summary.trackedCount || entries.length || 0);
    if (!totalCount) {
      lines.push("No finance entries have been recorded yet.");
      return lines;
    }
    const income = Number(summary.totals?.income || 0).toFixed(2);
    const expense = Number(summary.totals?.expense || 0).toFixed(2);
    const net = Number(summary.totals?.net || 0).toFixed(2);
    const currency = entries[0]?.currency || "AUD";
    lines.push(`I have ${totalCount} finance entr${totalCount === 1 ? "y" : "ies"} tracked. Net: ${currency} ${net} (income ${currency} ${income}, expenses ${currency} ${expense}).`);
    if (financialYears.length) {
      const currentFY = financialYears.find((fy) => fy.isCurrent) || financialYears[0];
      if (currentFY) {
        lines.push(`Current financial year (${currentFY.label}): ${currentFY.entryCount} entr${currentFY.entryCount === 1 ? "y" : "ies"}, net ${currency} ${Number(currentFY.totals?.net || 0).toFixed(2)}.`);
      }
    }
    const unpaid = entries.filter((entry) => entry.status === "unpaid" && entry.type === "expense");
    if (unpaid.length) {
      lines.push(`Unpaid expenses: ${unpaid.length}`);
      for (const entry of unpaid.slice(0, 4)) {
        lines.push(`- ${entry.title}${entry.amountDisplay ? `: ${entry.amountDisplay}` : ""}`);
      }
    }
    const categoryMap = summary.categoryCounts || {};
    const topCategories = Object.entries(categoryMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([cat, count]) => `${cat}: ${count}`);
    if (topCategories.length) {
      lines.push(`Top categories: ${topCategories.join(", ")}.`);
    }
    return lines;
  },
  buildInboxSummary,
  buildMailStatusSummary,
  buildOutputStatusSummary,
  buildProjectStatusSummary: async ({ message = "" } = {}) => {
    const runtime = getProjectsRuntime();
    if (!runtime || typeof runtime.listProjectPipelines !== "function") {
      return ["Projects plugin is unavailable."];
    }
    const compactProjectLine = (value = "", maxLength = 180) => {
      const normalized = String(value || "").trim().replace(/\s+/g, " ");
      if (!normalized) {
        return "";
      }
      return normalized.length > maxLength ? `${normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...` : normalized;
    };
    const normalizeProjectSearchText = (value = "") => String(value || "")
      .toLowerCase()
      .replace(/%20/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const projectMatchesMessage = (panel = {}, rawMessage = "") => {
      const needle = normalizeProjectSearchText(rawMessage);
      if (!needle) {
        return false;
      }
      const aliases = [
        panel.name,
        panel.sourceName,
        panel.key,
        ...(Array.isArray(panel.aliases) ? panel.aliases : [])
      ].map(normalizeProjectSearchText).filter(Boolean);
      return aliases.some((alias) => alias && (needle.includes(alias) || alias.includes(needle)));
    };
    const formatProjectPanelStatus = (panel = {}) => {
      const name = String(panel.name || panel.sourceName || "Unknown project").trim();
      const assessment = panel.assessment && typeof panel.assessment === "object" ? panel.assessment : {};
      const checklist = panel.checklist && typeof panel.checklist === "object" ? panel.checklist : {};
      const todo = checklist.todo && typeof checklist.todo === "object" ? checklist.todo : {};
      const roles = checklist.roles && typeof checklist.roles === "object" ? checklist.roles : {};
      const activeRoles = Array.isArray(panel.activeRoles) ? panel.activeRoles : [];
      const roleReports = Array.isArray(panel.roleReports) ? panel.roleReports : [];
      const lines = [`${name}: ${String(assessment.phaseLabel || "Unknown phase").trim()} phase${assessment.workstreamLabel ? ` on a ${assessment.workstreamLabel} track` : ""}.`];
      if (assessment.currentPriority) {
        lines.push(`Priority: ${compactProjectLine(assessment.currentPriority, 220)}`);
      }
      const openTodos = Array.isArray(todo.unchecked) ? todo.unchecked : [];
      const doneTodos = Array.isArray(todo.checked) ? todo.checked : [];
      lines.push(`TODOs: ${Number(todo.uncheckedCount || openTodos.length || 0)} open, ${Number(todo.checkedCount || doneTodos.length || 0)} done.`);
      for (const item of openTodos.slice(0, 6)) {
        lines.push(`- [ ] ${compactProjectLine(item, 180)}`);
      }
      const visibleActiveRoles = activeRoles.slice(0, 6).map((entry) => {
        const roleName = String(entry?.name || entry || "").trim();
        const reason = String(entry?.reason || "").trim();
        return roleName ? `${roleName}${reason ? `: ${compactProjectLine(reason, 120)}` : ""}` : "";
      }).filter(Boolean);
      if (visibleActiveRoles.length) {
        lines.push(`Active roles: ${visibleActiveRoles.join("; ")}.`);
      } else {
        const selectedRoles = roleReports
          .filter((entry) => entry?.selected || Number(entry?.uncheckedCount || 0) || Number(entry?.checkedCount || 0))
          .map((entry) => String(entry?.name || "").trim())
          .filter(Boolean)
          .slice(0, 6);
        lines.push(`Roles: ${selectedRoles.length ? selectedRoles.join(", ") : "No active roles recorded yet"}.`);
      }
      const roleTaskLines = roleReports
        .flatMap((entry) => (Array.isArray(entry?.unchecked) ? entry.unchecked : []).map((task) => ({
          role: String(entry?.name || "").trim(),
          task: compactProjectLine(task, 170)
        })))
        .filter((entry) => entry.role && entry.task)
        .slice(0, 6);
      if (roleTaskLines.length) {
        lines.push(`Role tasks: ${Number(roles.uncheckedCount || roleTaskLines.length || 0)} open, ${Number(roles.checkedCount || 0)} done.`);
        for (const entry of roleTaskLines) {
          lines.push(`- ${entry.role}: ${entry.task}`);
        }
      }
      return lines;
    };
    const lines = [];
    if (typeof runtime.buildProjectSystemStatePayload === "function") {
      const state = await runtime.buildProjectSystemStatePayload().catch(() => null);
      const panels = Array.isArray(state?.projectPanels) ? state.projectPanels : [];
      const matchingPanel = panels.find((panel) => projectMatchesMessage(panel, message));
      if (matchingPanel) {
        return formatProjectPanelStatus(matchingPanel);
      }
    }
    const pipelines = await runtime.listProjectPipelines({ limit: 20 }).catch(() => []);
    if (!Array.isArray(pipelines) || !pipelines.length) {
      lines.push("No active workspace projects found.");
      return lines;
    }
    lines.push(`I have ${pipelines.length} active project pipeline${pipelines.length === 1 ? "" : "s"} in the workspace.`);
    for (const pipeline of pipelines.slice(0, 8)) {
      const name = String(pipeline.projectName || pipeline.projectWorkKey || pipeline.id || "Unknown project").trim();
      const taskCount = Number(pipeline.taskCount || pipeline.tasks?.length || 0);
      const status = String(pipeline.status || pipeline.phase || "").trim();
      lines.push(`- ${name}${status ? ` [${status}]` : ""}${taskCount ? `: ${taskCount} task${taskCount === 1 ? "" : "s"}` : ""}`);
    }
    return lines;
  },
  buildQueueStatusSummary,
  buildRecentActivitySummary,
  buildScheduledJobsSummary,
  buildSystemStatusSummary: async () => {
    const lines = [];
    const plugins = typeof pluginManager?.listPlugins === "function" ? pluginManager.listPlugins() : [];
    const enabled = plugins.filter((p) => p?.enabled === true);
    const disabled = plugins.filter((p) => p?.enabled !== true);
    lines.push(
      enabled.length
        ? `System is running. ${enabled.length} plugin${enabled.length === 1 ? "" : "s"} active${disabled.length ? `, ${disabled.length} disabled` : ""}.`
        : "System running. No plugins currently enabled."
    );
    if (enabled.length) {
      lines.push("Active plugins:");
      for (const plugin of enabled) {
        lines.push(`- ${plugin.name || plugin.id} v${plugin.version || "?"}`);
      }
    }
    if (disabled.length) {
      lines.push("Disabled plugins:");
      for (const plugin of disabled) {
        lines.push(`- ${plugin.name || plugin.id}`);
      }
    }
    return lines;
  },
  buildTodoSummaryLines: async (options = {}) => {
    const lines = await invokeOptionalCapability("todo.buildSummaryLines", ["Calendar plugin is unavailable."], options);
    return Array.isArray(lines) ? lines.map((entry) => String(entry || "").trim()).filter(Boolean) : [];
  },
  ensureUniqueOutputPath,
  answerWaitingTask,
  extractDocumentSearchQuery,
  extractFileReferenceCandidates,
  extractQuotedSegments,
  findTodoItemByReference: async (reference = "") => await invokeOptionalCapability("todo.findByReference", null, reference),
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
  isFinanceSummaryRequest,
  isHelpRequest,
  isInboxSummaryRequest,
  isMailStatusRequest,
  isOutputStatusRequest,
  isPathWithinAllowedRoots,
  isProjectStatusRequest,
  isQueueStatusRequest,
  isScheduledJobsRequest,
  isSystemStatusRequest,
  isTimeRequest,
  isTodayInboxSummaryRequest,
  isUserIdentityRequest,
  listAllTasks,
  listInstalledSkills,
  listObserverOutputFiles: (...args) => listObserverOutputFiles(...args),
  listTodoItems: async () => {
    const payload = await invokeOptionalCapability("todo.listItems", { items: [], open: [], completed: [], meta: { lastReminderAt: 0 }, summary: { openCount: 0, completedCount: 0 } });
    if (!payload || typeof payload !== "object") {
      return { items: [], open: [], completed: [], meta: { lastReminderAt: 0 }, summary: { openCount: 0, completedCount: 0 } };
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    const open = Array.isArray(payload.open) ? payload.open : items.filter((entry) => String(entry?.status || "").trim().toLowerCase() !== "completed");
    const completed = Array.isArray(payload.completed) ? payload.completed : items.filter((entry) => String(entry?.status || "").trim().toLowerCase() === "completed");
    return {
      ...payload,
      items,
      open,
      completed,
      meta: payload.meta && typeof payload.meta === "object" ? payload.meta : { lastReminderAt: 0 },
      summary: payload.summary && typeof payload.summary === "object"
        ? payload.summary
        : { openCount: open.length, completedCount: completed.length }
    };
  },
  normalizeContainerMountPathCandidate,
  normalizeDocumentContent,
  normalizeTodoReference: normalizeReferenceToken,
  normalizeWindowsPathCandidate,
  normalizeWorkspaceRelativePathCandidate,
  outputNameCandidateFromSource,
  parseDirectMailRequest,
  parseStandingMailWatchRequest,
  path,
  readUserProfileSummary,
  removeTodoItem: async (todoId = "", options = {}) => await invokeCapability("todo.removeItem", todoId, options),
  resolveSourcePathFromContainerPath,
  sanitizeSkillSlug,
  searchSkillLibrary,
  setTodoItemStatus: async (todoId = "", status = "completed", options = {}) => await invokeCapability("todo.setItemStatus", todoId, status, options),
  toolSendMail,
  upsertMailWatchRule
});

const {
  buildIntakeSystemPrompt,
  buildPromptReviewSampleMessage,
  buildWorkerSpecialtyPromptLines,
  buildWorkerSystemPrompt,
  filterDestructiveWriteCallsForInPlaceEdit,
  isEchoedToolResultEnvelope,
  normalizeWorkerDecisionEnvelope,
  taskRequestsInPlaceFileEdit
} = createObserverWorkerPrompting({
  INTAKE_TOOLS,
  OBSERVER_CONTAINER_OUTPUT_ROOT,
  OBSERVER_CONTAINER_WORKSPACE_ROOT,
  WORKER_TOOLS,
  appendHookTrace: (...args) => taskFlightRecorder.appendHookTrace(...args),
  buildInstalledSkillsGuidanceNote,
  buildPromptMemoryGuidanceNote,
  fs,
  getPluginToolsByScope: collectPluginToolsSync,
  selectToolsForTask,
  runPluginHook: async (hookName, payload) => {
    if (pluginManager && typeof pluginManager.runHook === "function") {
      return pluginManager.runHook(hookName, payload);
    }
    return payload;
  },
  loopLessonsHostPath: path.join(PROMPT_FILES_ROOT, "LOOP-LESSONS.md"),
  buildTaskCapabilityPromptLines,
  extractConcreteTaskFileTargets,
  extractTaskDirectiveValue: (...args) => getProjectsRuntime()?.extractTaskDirectiveValue?.(...args),
  getAgentPersonaName,
  getObserverConfig: () => observerConfig,
  getProjectNoChangeMinimumTargets,
  inferTaskCapabilityProfile,
  inferTaskSpecialty,
  isProjectCycleMessage: (...args) => getProjectsRuntime()?.isProjectCycleMessage?.(...args),
  normalizeContainerPathForComparison: (...args) => getProjectsRuntime()?.normalizeContainerPathForComparison?.(...args),
  normalizeToolCallRecord,
  normalizeToolName,
  parseToolCallArgs
});
const { executeObserverRun: executeObserverRun } = createObserverExecutionRunner({
  annotateNovaSpeechText,
  buildPostToolDecisionInstruction,
  buildToolLoopStepDiagnostics,
  buildToolLoopStopMessage,
  buildToolLoopSummaryText,
  buildToolSemanticFailureMessage,
  buildToolExecutionBatches: ({ toolCalls = [] } = {}) => {
    const provider = pluginManager?.getCapability("buildToolExecutionBatches");
    if (typeof provider !== "function") {
      return [];
    }
    try {
      return provider({ toolCalls });
    } catch {
      return [];
    }
  },
  buildTranscriptForPrompt,
  buildVisionImagesFromAttachments,
  buildWorkerSystemPrompt,
  collectTrackedWorkspaceTargets,
  compactTaskText,
  createToolLoopDiagnostics,
  debugJsonEnvelopeWithPlanner,
  diffFileSnapshots,
  didInspectNamedTarget: (...args) => getProjectsRuntime()?.didInspectNamedTarget?.(...args),
  executeWorkerToolCall,
  extractInspectionTargetKey,
  extractJsonObject,
  buildProjectCycleCompletionPolicy: (...args) => getProjectsRuntime()?.buildProjectCycleCompletionPolicy?.(...args),
  extractProjectCycleImplementationRoots: (...args) => getProjectsRuntime()?.extractProjectCycleImplementationRoots?.(...args),
  extractProjectCycleProjectRoot: (...args) => getProjectsRuntime()?.extractProjectCycleProjectRoot?.(...args),
  extractTaskDirectiveValue: (...args) => getProjectsRuntime()?.extractTaskDirectiveValue?.(...args),
  evaluateProjectCycleCompletionState: (...args) => getProjectsRuntime()?.evaluateProjectCycleCompletionState?.(...args),
  filterDestructiveWriteCallsForInPlaceEdit,
  formatToolResultForModel,
  getObserverConfig: () => observerConfig,
  getProjectNoChangeMinimumTargets,
  getToolResultSemantic,
  isConcreteImplementationInspectionTarget: (...args) => getProjectsRuntime()?.isConcreteImplementationInspectionTarget?.(...args),
  isEchoedToolResultEnvelope,
  isProjectCycleMessage: (...args) => getProjectsRuntime()?.isProjectCycleMessage?.(...args),
  isSemanticallySuccessfulToolResult,
  listObserverOutputFiles: (...args) => listObserverOutputFiles(...args),
  listTrackedWorkspaceFiles,
  normalizeAgentSelfReference,
  normalizeContainerPathForComparison: (...args) => getProjectsRuntime()?.normalizeContainerPathForComparison?.(...args),
  normalizeToolCallRecord,
  normalizeToolName,
  normalizeWorkerDecisionEnvelope,
  objectiveRequiresConcreteImprovement: (...args) => getProjectsRuntime()?.objectiveRequiresConcreteImprovement?.(...args),
  looksLikeCapabilityRefusalCompletionSummary,
  parseToolCallArgs,
  prepareAttachments,
  recordToolLoopStepDiagnostics,
  replanRepeatedToolLoopWithPlanner,
  retryJsonEnvelope,
  runOllamaPrompt,
  sanitizeSkillSlug,
  appendRepairLesson,
  appendHookTrace: (...args) => taskFlightRecorder.appendHookTrace(...args),
  appendProviderHistory: (...args) => taskFlightRecorder.appendProviderHistory(...args),
  appendToolStep: (...args) => taskFlightRecorder.appendToolStep(...args),
  patchProviderSummary: (...args) => taskFlightRecorder.patchProviderSummary(...args),
  writeProviderSummary: (...args) => taskFlightRecorder.writeProviderSummary(...args),
  OBSERVER_CONTAINER_WORKSPACE_ROOT,
  loopLessonsHostPath: path.join(PROMPT_FILES_ROOT, "LOOP-LESSONS.md"),
  runPluginHook: async (hookName, payload) => {
    if (pluginManager && typeof pluginManager.runHook === "function") {
      return pluginManager.runHook(hookName, payload);
    }
    return payload;
  }
});

const { selectDispatchableQueuedTask } = createObserverQueueDispatchSelection({
  TASK_QUEUE_IN_PROGRESS,
  findRecentProjectCycleMessageAttempt: (...args) => getProjectsRuntime()?.findRecentProjectCycleMessageAttempt?.(...args),
  findRecentProjectWorkAttempt: (...args) => getProjectsRuntime()?.findRecentProjectWorkAttempt?.(...args),
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
  TASK_QUEUE_IN_PROGRESS,
  VISIBLE_COMPLETED_HISTORY_COUNT,
  WORKSPACE_ROOT,
  activeTaskControllers,
  addTodoItem: async (payload = {}) => await invokeCapability("todo.addItem", payload),
  appendFailureTelemetryEntry,
  broadcast,
  broadcastObserverEvent,
  buildCapabilityMismatchRetryMessage,
  buildCompletionReviewSummary,
  buildQueuedTaskExecutionPrompt,
  buildTaskResumeSummary: (...args) => taskFlightRecorder.buildTaskResumeSummary(...args),
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
  executeRecreationJob,
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
  runPluginHook: async (hookName, payload) => {
    if (pluginManager && typeof pluginManager.runHook === "function") {
      return pluginManager.runHook(hookName, payload);
    }
    return payload;
  },
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

let processNextQueuedTaskExecutor = (...args) => observerProcessNextQueuedTask(...args);
let processQueuedTasksToCapacityExecutor = (...args) => observerProcessQueuedTasksToCapacity(...args);

const {
  findStaggeredAnchorMs,
  getCronMinGapMs,
  listCronRunEvents,
  listObserverOutputFiles,
  readCronStore,
  resolveContainerInspectablePath,
  resolveInspectablePath,
  writeCronStore
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
function triageTaskRequest(...args) {
  const request = args?.[0] && typeof args[0] === "object" ? args[0] : {};
  void pluginManager.runHook("subsystem:intake:triage-started", {
    at: Date.now(),
    intakeBrainId: compactHookText(String(request.intakeBrainId || "").trim(), 64),
    messagePreview: compactHookText(String(request.message || "").trim(), 220),
    internetEnabled: request.internetEnabled !== false,
    forceToolUse: request.forceToolUse === true
  });
  try {
    const triage = observerTriageTaskRequest(...args);
    void pluginManager.runHook("subsystem:intake:triage-completed", {
      at: Date.now(),
      mode: compactHookText(String(triage?.mode || "").trim(), 64),
      brainId: compactHookText(String(triage?.brainId || "").trim(), 64),
      complexity: Number(triage?.complexity || 0) || 0
    });
    return triage;
  } catch (error) {
    void pluginManager.runHook("subsystem:intake:triage-failed", {
      at: Date.now(),
      error: compactHookText(String(error?.message || error || "unknown error"), 220)
    });
    throw error;
  }
}async function generatePromptReviewPreview({
  internetEnabled = true,
  selectedMountIds = []
} = {}) {
  const normalizedMountIds = Array.isArray(selectedMountIds)
    ? selectedMountIds.map((value) => String(value))
    : [];
  const enabledInternet = internetEnabled !== false;
  const brains = await listAvailableBrains();
  const intakeBrain = await getBrain("bitnet");
  const entries = [
    {
      id: intakeBrain?.id || "intake",
      label: intakeBrain?.label || "Intake",
      kind: intakeBrain?.kind || "intake",
      model: intakeBrain?.model || "",
      scenario: "Direct reply or queue decision",
      sampleMessage: "Help me figure out whether this needs a direct answer or a deeper queued pass.",
      prompt: await buildIntakeSystemPrompt({
        internetEnabled: enabledInternet,
        selectedMountIds: normalizedMountIds,
        forceToolUse: true,
        sessionId: "Main"
      })
    }
  ];
  const workerBrains = brains
    .filter((brain) => brain.kind === "worker" && brain.toolCapable)
    .sort((left, right) => String(left.label || left.id).localeCompare(String(right.label || right.id)));
  for (const brain of workerBrains) {
    const sampleMessage = buildPromptReviewSampleMessage(brain);
    entries.push({
      id: brain.id,
      label: brain.label,
      kind: brain.kind,
      model: brain.model,
      specialty: brain.specialty || "general",
      queueLane: brain.queueLane || getBrainQueueLane(brain),
      scenario: "Queued execution sample",
      sampleMessage,
      prompt: await buildWorkerSystemPrompt({
        message: sampleMessage,
        brain,
        internetEnabled: enabledInternet,
        selectedMountIds: normalizedMountIds,
        forceToolUse: true,
        preset: "queued-task",
        runtimeNotesExtra: [
          "Review sample context: this is a prompt review preview, not a live task."
        ]
      })
    });
  }
  return {
    generatedAt: Date.now(),
    entries
  };
}

const promptReviewService = {
  generateReview: async (options = {}) => await generatePromptReviewPreview(options)
};

const taskLifecycleService = {
  findTaskById: async (taskId = "") => await findTaskById(String(taskId || "").trim()),
  readTaskHistory: async (taskId = "", options = {}) => await readTaskHistory(String(taskId || "").trim(), options),
  stopTask: async ({ taskId = "", reason = "Stopped by plugin lifecycle endpoint.", force = false } = {}) => {
    const normalizedTaskId = String(taskId || "").trim();
    const normalizedReason = String(reason || "").trim() || "Stopped by plugin lifecycle endpoint.";
    if (force) {
      return await forceStopTask(normalizedTaskId, normalizedReason);
    }
    return await abortActiveTask(normalizedTaskId, normalizedReason);
  },
  answerTask: async ({ taskId = "", answer = "", sessionId = "Main" } = {}) => {
    return await answerWaitingTask(
      String(taskId || "").trim(),
      String(answer || "").trim(),
      String(sessionId || "Main").trim() || "Main"
    );
  },
  createTask: async (payload = {}) => await createQueuedTask(payload && typeof payload === "object" ? payload : {})
};

async function processNextQueuedTask(...args) {
  try {
    return await processNextQueuedTaskExecutor(...args);
  } catch (error) {
    await pluginManager.runHook("queue:task-processed", {
      at: Date.now(),
      source: "processNextQueuedTask",
      ok: false,
      error: String(error?.message || error || "unknown error")
    });
    throw error;
  }
}
async function processQueuedTasksToCapacity(...args) {
  try {
    return await processQueuedTasksToCapacityExecutor(...args);
  } catch (error) {
    await pluginManager.runHook("queue:batch-processed", {
      at: Date.now(),
      source: "processQueuedTasksToCapacity",
      ok: false,
      tasks: [],
      count: 0,
      error: String(error?.message || error || "unknown error")
    });
    throw error;
  }
}
let tickObserverCronQueueExecutor = (...args) => tickObserverCronQueue(...args);
const pluginRuntimeContext = {
  MAX_TASK_RESHAPE_ATTEMPTS,
  OBSERVER_CONTAINER_OUTPUT_ROOT,
  OBSERVER_INPUT_HOST_ROOT,
  OBSERVER_OUTPUT_ROOT,
  PROJECT_MARKER_FILE_NAME: ".observer-project.json",
  TASK_QUEUE_CLOSED,
  addProjectRole: (...args) => getProjectsRuntime()?.addProjectRole?.(...args),
  appendDailyAssistantMemory,
  buildFailureReshapeMessage,
  buildProjectConfigPayload: (...args) => getProjectsRuntime()?.buildProjectConfigPayload?.(...args),
  buildProjectSystemStatePayload: (...args) => getProjectsRuntime()?.buildProjectSystemStatePayload?.(...args),
  buildMailStatus,
  mailDomainContext,
  buildWordPressSharedSecretHandle: (...args) => observerSecrets.buildWordPressSharedSecretHandle(...args),
  answerWaitingTask,
  canBrainHandleSpecialty,
  canReshapeTask,
  chooseIdleWorkerBrainForSpecialty,
  classifyFailureText,
  closeTaskRecord,
  compactTaskText,
  createQueuedTask,
  deleteSecretValue: (...args) => observerSecrets.deleteSecret(...args),
  extractContainerPathCandidates,
  fetchRecentMessagesForAgent,
  findActiveProjectCycleTask,
  findTaskById,
  fs,
  formatDateTimeForUser,
  getActiveMailAgent,
  getBrain,
  getBrainQueueLane,
  getMailState: () => mailState,
  getMailWatchRulesState: () => mailWatchRulesState,
  getObserverConfig: () => observerConfig,
  getProjectConfig,
  getProjectPipelineTrace: (...args) => getProjectsRuntime()?.getProjectPipelineTrace?.(...args),
  getRecentMailMessages: () => (Array.isArray(mailState?.recentMessages) ? mailState.recentMessages : []),
  getSecretValue: (...args) => observerSecrets.getSecret(...args),
  getTaskReshapeAttemptCount,
  hashRef,
  hasSecretValue: (...args) => observerSecrets.hasSecret(...args),
  hasMailCredentials,
  importRepositoryProjectToWorkspace,
  inferTaskCapabilityProfile,
  inferTaskSpecialty,
  inspectWorkspaceProject,
  listProjectPipelines: (...args) => getProjectsRuntime()?.listProjectPipelines?.(...args),
  listAvailableBrains,
  looksLikeEmailAddress,
  listAllTasks,
  listContainerWorkspaceProjects,
  listTasksByFolder,
  moveAgentMail,
  moveContainerPath,
  moveWorkspaceProjectToOutput,
  normalizeContainerMountPathCandidate,
  normalizeSecretHandle: (...args) => observerSecrets.normalizeSecretHandle(...args),
  normalizeProjectConfigInput,
  normalizeSummaryComparisonText,
  normalizeTaskDirectivePath,
  noteInteractiveActivity,
  opportunityScanState,
  path,
  pollActiveMailbox,
  pluginRuntimeRoot: PLUGIN_RUNTIME_ROOT,
  promptReviewService,
  processNextQueuedTask: (...args) => processNextQueuedTask(...args),
  processQueuedTasksToCapacity: (...args) => processQueuedTasksToCapacity(...args),
  promptFilesRoot: PROMPT_FILES_ROOT,
  readContainerFile,
  readJsonFileIfExists,
  readTextFileIfExists,
  readVolumeFile,
  removeProjectChecklistItem: (...args) => getProjectsRuntime()?.removeProjectChecklistItem?.(...args),
  removeProjectRole: (...args) => getProjectsRuntime()?.removeProjectRole?.(...args),
  saveObserverConfig,
  saveMailWatchRulesState,
  sendAgentMail,
  ensureRecreationJob,
  ensureOpportunityScanJob,
  setSecretValue: (...args) => observerSecrets.setSecret(...args),
  setObserverConfig: (nextConfig) => {
    observerConfig = nextConfig;
  },
  snapshotWorkspaceProjectToOutput,
  summarizeTaskCapabilities,
  syncWorkspaceProjectToRepositorySource,
  taskLifecycleService,
  taskQueueRoot: TASK_QUEUE_ROOT,
  coreTransactions: coreTransactionsCapability,
  taskFlightRecorder: {
    appendHookTrace: (...args) => taskFlightRecorder.appendHookTrace(...args),
    buildDebugPacket: (...args) => taskFlightRecorder.buildDebugPacket(...args),
    validateProviderHistory: (...args) => taskFlightRecorder.validateProviderHistory(...args)
  },
  wordpressSiteRegistryPath: WORDPRESS_SITE_REGISTRY_PATH,
  iotDomain,
  writeContainerTextFile,
  writeVolumeText
};

const {
  pluginLoadErrors,
  pluginManager: initializedPluginManager
} = await initializeObserverPluginManager({
  app,
  broadcast,
  fs,
  getObserverConfig: () => observerConfig,
  pathModule: path,
  pluginRuntimeRoot: PLUGIN_RUNTIME_ROOT,
  rootDir: __dirname,
  runtimeContext: pluginRuntimeContext,
  validateAdminRequest
});

pluginManager = initializedPluginManager;

try {
  await refreshPluginToolCatalogCache();
} catch (error) {
  const message = `plugin initialization failed: ${String(error?.message || error || "unknown error")}`;
  pluginLoadErrors.push(message);
  console.warn(`[observer] ${message}`);
  pluginManager = createNoopPluginManager({
    app,
    runtimeRoot: PLUGIN_RUNTIME_ROOT,
    loadErrors: pluginLoadErrors
  });
  pluginToolCatalogCache = [];
}

const wrapProcessNextQueuedTask = pluginManager.getCapability("wrapProcessNextQueuedTask");
if (typeof wrapProcessNextQueuedTask === "function") {
  processNextQueuedTaskExecutor = wrapProcessNextQueuedTask(processNextQueuedTaskExecutor);
}

const wrapProcessQueuedTasksToCapacity = pluginManager.getCapability("wrapProcessQueuedTasksToCapacity");
if (typeof wrapProcessQueuedTasksToCapacity === "function") {
  processQueuedTasksToCapacityExecutor = wrapProcessQueuedTasksToCapacity(processQueuedTasksToCapacityExecutor);
}

const wrapCronTick = pluginManager.getCapability("wrapCronTick");
if (typeof wrapCronTick === "function") {
  const wrappedTick = wrapCronTick((...args) => tickObserverCronQueue(...args));
  if (typeof wrappedTick === "function") {
    tickObserverCronQueueExecutor = wrappedTick;
  }
}

pluginManager.setRuntimeContext(pluginRuntimeContext);

try {
  await pluginManager.registerRoutes();
} catch (error) {
  const message = `plugin route registration failed: ${String(error?.message || error || "unknown error")}`;
  pluginLoadErrors.push(message);
  console.warn(`[observer] ${message}`);
}

const tickObserverCronQueueRuntime = async (...args) => {
  const startedAt = Date.now();
  await pluginManager.runHook("cron:tick-started", {
    at: startedAt,
    source: "tickObserverCronQueue"
  });
  try {
    const response = await tickObserverCronQueueExecutor(...args);
    await pluginManager.runHook("cron:tick-completed", {
      at: Date.now(),
      durationMs: Date.now() - startedAt,
      source: "tickObserverCronQueue",
      ok: true,
      response: response || null
    });
    return response;
  } catch (error) {
    await pluginManager.runHook("cron:tick-completed", {
      at: Date.now(),
      durationMs: Date.now() - startedAt,
      source: "tickObserverCronQueue",
      ok: false,
      error: String(error?.message || error || "unknown error")
    });
    throw error;
  }
};

// --- IoT / Home Assistant routes ---
const __iotSecretsTabPath = path.join(__dirname, "server", "plugins", "iot", "public", "iot-secrets-tab.js");
app.get("/api/plugin-ui/iot/secrets-tab.js", (_req, res) => {
  res.type("application/javascript");
  res.sendFile(__iotSecretsTabPath);
});
app.get("/api/iot/instances", async (_req, res) => {
  try {
    res.json({ ok: true, instances: await iotDomain.listInstances() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err || "failed to list instances") });
  }
});
app.post("/api/iot/instances", async (req, res) => {
  try {
    noteInteractiveActivity();
    res.json({ ok: true, instance: await iotDomain.saveInstance(req.body || {}) });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err?.message || err || "failed to save instance") });
  }
});
app.delete("/api/iot/instances/:instanceId", async (req, res) => {
  try {
    noteInteractiveActivity();
    const instanceId = String(req.params?.instanceId || "").trim();
    if (!instanceId) return res.status(400).json({ ok: false, error: "instanceId is required" });
    res.json({ ok: true, removed: await iotDomain.removeInstance({ instanceId }) });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err?.message || err || "failed to remove instance") });
  }
});
app.post("/api/iot/instances/:instanceId/test", async (req, res) => {
  try {
    const instanceId = String(req.params?.instanceId || "").trim();
    const result = await iotDomain.testConnection({ instanceId, ...(req.body || {}) });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err?.message || err || "connection test failed") });
  }
});
// --- end IoT routes ---

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
    getToolResultSemantic,
    formatToolResultForModel,
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
    appendSessionExchange,
    annotateNovaSpeechText,
    broadcast,
    createQueuedTask,
    getBrain,
    getHelperAnalysisForRequest,
    getObserverConfig: () => observerConfig,
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
    buildProjectConfigPayload: (...args) => getProjectsRuntime()?.buildProjectConfigPayload?.(...args),
    buildProjectSystemStatePayload: (...args) => getProjectsRuntime()?.buildProjectSystemStatePayload?.(...args),
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
    getProjectPipelineTrace: (...args) => getProjectsRuntime()?.getProjectPipelineTrace?.(...args),
    listAvailableBrains,
    listProjectPipelines: (...args) => getProjectsRuntime()?.listProjectPipelines?.(...args),
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
    addProjectRole: (...args) => getProjectsRuntime()?.addProjectRole?.(...args),
    removeProjectChecklistItem: (...args) => getProjectsRuntime()?.removeProjectChecklistItem?.(...args),
    removeProjectRole: (...args) => getProjectsRuntime()?.removeProjectRole?.(...args),
    saveObserverConfig,
    saveVoicePatternStore,
    serializeBrainEndpointConfig,
    serializeBuiltInBrainConfig,
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
    adminUiToken: ADMIN_UI_TOKEN,
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
    buildTaskDebugPacket: (...args) => taskFlightRecorder.buildDebugPacket(...args),
    validateProviderHistory: (...args) => taskFlightRecorder.validateProviderHistory(...args),
    createQueuedTask,
    applyApprovedTransaction: (...args) => workspaceTransactions.applyApprovedTransaction(...args),
    approveTransaction: (...args) => workspaceTransactions.approveTransaction(...args),
    persistTaskTransition,
    ensureRecreationJob,
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
    listTasksByFolder,
    listTransactionsForTask: (...args) => workspaceTransactions.listTransactionsForTask(...args),
    rollbackTransaction: (...args) => workspaceTransactions.rollbackTransaction(...args),
    rejectTransaction: (...args) => workspaceTransactions.rejectTransaction(...args),
    TASK_QUEUE_CLOSED,
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
    runPluginHook: async (hookName = "", payload = {}) =>
      await pluginManager.runHook(String(hookName || "").trim(), payload),
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
    ensureObserverToolContainer,
    ensureQuestionMaintenanceJob,
    ensureRecreationJob,
    getObserverConfig: () => observerConfig,
    modelWarmIntervalMs: MODEL_WARM_INTERVAL_MS,
    port: PORT,
    runPluginRuntimeHook: async (hookName = "", payload = {}) =>
      await pluginManager.runHook(String(hookName || "").trim(), {
        at: Date.now(),
        ...(payload && typeof payload === "object" ? payload : {})
      }),
    runQueueStorageMaintenance,
    scheduleTaskDispatch,
    taskRetentionSweepMs: TASK_RETENTION_SWEEP_MS,
    tickObserverCronQueue: tickObserverCronQueueRuntime,
    warmRuntimeBrains
  }
});






