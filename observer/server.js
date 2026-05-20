import express from "express";
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
import { createWorkspaceTransactionService } from "./server/workspace-transaction-service.js";
import { createTaskFlightRecorderService } from "./server/task-flight-recorder-service.js";
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
import { createObserverOutputSemanticUtils } from "./server/observer-output-semantic-utils.js";
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
import { registerObserverIotRoutes } from "./server/observer-iot-routes.js";
import { createAgentSkillsService } from "./server/observer-agent-skills-service.js";
import { registerAgentSkillRoutes } from "./server/observer-agent-skill-routes.js";
import { createNoopPluginManager, initializeObserverPluginManager } from "./server/observer-plugin-loader.js";
import { createTaskReshapeDomain } from "./server/task-reshape-domain.js";
import { createObserverHttpHooks } from "./server/observer-http-hooks.js";
import { runCommand, inspectContainer, queryGpuStatus, shouldHideInspectorEntry } from "./server/observer-system-inspect.js";
import { createObserverAdminSecurity } from "./server/observer-admin-security.js";
import { createSessionConversationStore } from "./server/session-conversation-store.js";
import { createObserverWorkspaceFileUtils } from "./server/observer-workspace-file-utils.js";
import { createObserverConfigLoader } from "./server/observer-config-loader.js";
import {
  formatElapsedShort,
  formatEntityRef,
  formatJobCodename,
  formatTaskCodename,
  hashRef,
  hasMeaningfulTextResponse,
  normalizeTaskRecord,
  summarizePayloadText,
  summarizeRunArtifacts
} from "./server/observer-task-format-utils.js";
import { createOllamaRuntimeService } from "./server/ollama-runtime-service.js";
import { createSimpleStateResetService } from "./server/simple-state-reset-service.js";
import { createIntakePlannerService } from "./server/intake-planner-service.js";
import { createObserverGeneralUtils } from "./server/observer-general-utils.js";
import { createObserverRuntimeAccessors } from "./server/observer-runtime-accessors.js";
import { createObserverTaskLifecycleService } from "./server/observer-task-lifecycle-service.js";
import { createPluginToolCatalogService } from "./server/plugin-tool-catalog-service.js";
import {
  createPluginHookedQueueProcessors,
  createPluginObservedTriageTaskRequest,
  createPluginTaskLifecycleRuntimeService,
  createPromptReviewService
} from "./server/plugin-runtime-services.js";

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
const {
  adminUiToken: ADMIN_UI_TOKEN,
  registerAdminSecurityMiddleware,
  validateAdminRequest
} = createObserverAdminSecurity({ port: PORT });
registerAdminSecurityMiddleware(app);
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
const OBSERVER_TOOL_IMAGE = "nova-safe";
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
const {
  appendVolumeText,
  clearDirectoryContents,
  fileExists,
  migrateLegacyPromptWorkspaceIfNeeded,
  prepareAttachments,
  removeDateStampedMarkdownFiles
} = createObserverWorkspaceFileUtils({
  fs,
  path,
  observerAttachmentsRoot: OBSERVER_ATTACHMENTS_ROOT,
  observerContainerAttachmentsRoot: OBSERVER_CONTAINER_ATTACHMENTS_ROOT,
  legacyPromptWorkspaceRoot: LEGACY_PROMPT_WORKSPACE_ROOT,
  promptWorkspaceRoot: PROMPT_WORKSPACE_ROOT,
  agentWorkspacesRoot: AGENT_WORKSPACES_ROOT
});
const {
  escapeRegex,
  normalizeAgentSelfReference,
  normalizeReferenceToken,
  parseEveryToMs,
  replaceMarkdownSectionByHeading,
  resolveToolPath
} = createObserverGeneralUtils({
  getAgentPersonaName: () => getAgentPersonaName(),
  observerContainerInputRoot: OBSERVER_CONTAINER_INPUT_ROOT,
  observerContainerOutputRoot: OBSERVER_CONTAINER_OUTPUT_ROOT,
  observerContainerWorkspaceRoot: OBSERVER_CONTAINER_WORKSPACE_ROOT,
  path
});
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
let pluginToolCatalogService = null;
let memoryTrustDomain = null;

function requirePluginToolCatalogService() {
  if (!pluginToolCatalogService) {
    throw new Error("plugin tool catalog service not initialized");
  }
  return pluginToolCatalogService;
}

function collectPluginToolsSync(...args) {
  return requirePluginToolCatalogService().collectPluginToolsSync(...args);
}

async function refreshPluginToolCatalogCache(...args) {
  return await requirePluginToolCatalogService().refreshPluginToolCatalogCache(...args);
}

async function executePluginIntakeToolCall(...args) {
  return await requirePluginToolCatalogService().executePluginIntakeToolCall(...args);
}

function buildToolCatalog(...args) {
  return requirePluginToolCatalogService().buildToolCatalog(...args);
}

const {
  appendSessionExchange,
  getSessionHistory
} = createSessionConversationStore();

const {
  getMailRuntime,
  getMailRuntimeFn,
  getPluginCapability,
  getProjectConfig,
  getProjectNoChangeMinimumTargets,
  getProjectRolePlaybooks,
  getProjectsRuntime,
  getProjectsRuntimeFn,
  getQueueConfig,
  getRoutingConfig,
  invokeCapability,
  invokeOptionalCapability,
  isPluginEnabled,
  normalizeProjectConfigInput,
  requireMailRuntimeFn,
  requireProjectsRuntimeFn
} = createObserverRuntimeAccessors({
  getObserverConfig: () => observerConfig,
  getPluginManager: () => pluginManager,
  normalizeProjectsConfigForBootstrap
});

let taskLifecycleDomain = null;

function requireTaskLifecycleService() {
  if (!taskLifecycleDomain) {
    throw new Error("task lifecycle service is not initialized");
  }
  return taskLifecycleDomain;
}

async function chooseAutomaticRetryBrainId(...args) { return await requireTaskLifecycleService().chooseAutomaticRetryBrainId(...args); }
async function getWaitingQuestionBacklogCount(...args) { return await requireTaskLifecycleService().getWaitingQuestionBacklogCount(...args); }
function buildWaitingQuestionLimitSummary(...args) { return requireTaskLifecycleService().buildWaitingQuestionLimitSummary(...args); }
async function findTaskById(...args) { return await requireTaskLifecycleService().findTaskById(...args); }
function shouldKeepTaskVisible(...args) { return requireTaskLifecycleService().shouldKeepTaskVisible(...args); }
function isAutoCloseCompletedInternalTask(...args) { return requireTaskLifecycleService().isAutoCloseCompletedInternalTask(...args); }
function isImmediateInternalNoopCompletion(...args) { return requireTaskLifecycleService().isImmediateInternalNoopCompletion(...args); }
function getAutoCloseCompletedInternalTaskReason(...args) { return requireTaskLifecycleService().getAutoCloseCompletedInternalTaskReason(...args); }
async function archiveExpiredCompletedTasks(...args) { return await requireTaskLifecycleService().archiveExpiredCompletedTasks(...args); }
async function runQueueStorageMaintenance(...args) { return await requireTaskLifecycleService().runQueueStorageMaintenance(...args); }
async function closeCompletedInternalPeriodicTasks(...args) { return await requireTaskLifecycleService().closeCompletedInternalPeriodicTasks(...args); }
async function createQueuedTask(...args) { return await requireTaskLifecycleService().createQueuedTask(...args); }
async function abortActiveTask(...args) { return await requireTaskLifecycleService().abortActiveTask(...args); }
async function forceStopTask(...args) { return await requireTaskLifecycleService().forceStopTask(...args); }
async function createWaitingTask(...args) { return await requireTaskLifecycleService().createWaitingTask(...args); }
async function findRecentCronTaskRuns(...args) { return await requireTaskLifecycleService().findRecentCronTaskRuns(...args); }
async function findRecentDuplicateQueuedTask(...args) { return await requireTaskLifecycleService().findRecentDuplicateQueuedTask(...args); }
async function findTaskByOpportunityKey(...args) { return await requireTaskLifecycleService().findTaskByOpportunityKey(...args); }
async function findTaskByMaintenanceKey(...args) { return await requireTaskLifecycleService().findTaskByMaintenanceKey(...args); }
async function closeTaskRecord(...args) { return await requireTaskLifecycleService().closeTaskRecord(...args); }

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

const {
  formatToolResultForModel,
  getToolResultSemantic
} = createObserverOutputSemanticUtils({
  buildSemanticMap,
  formatSemanticForModel
});

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
const workspaceTransactions = createWorkspaceTransactionService({
  compactTaskText,
  editContainerTextFile,
  emitCoreEvent: (...args) => emitCoreEvent(...args),
  fs,
  moveContainerPath,
  pathModule: path,
  readContainerFileBuffer,
  resolveToolPath,
  transactionRoot: WORKSPACE_TRANSACTION_ROOT,
  writeContainerTextFile
});
const taskFlightRecorder = createTaskFlightRecorderService({
  compactTaskText,
  emitCoreEvent: (...args) => emitCoreEvent(...args),
  fs,
  listTransactionsForTask: (...args) => workspaceTransactions.listTransactionsForTask(...args),
  pathModule: path,
  readTaskHistory: (...args) => readTaskHistory(...args),
  root: TASK_FLIGHT_RECORDER_ROOT
});

let ollamaRuntime = null;

function requireOllamaRuntime() {
  if (!ollamaRuntime) {
    throw new Error("Ollama runtime is not initialized");
  }
  return ollamaRuntime;
}

async function runOllamaPrompt(...args) {
  return await requireOllamaRuntime().runOllamaPrompt(...args);
}

async function runOllamaJsonGenerate(...args) {
  return await requireOllamaRuntime().runOllamaJsonGenerate(...args);
}

async function runOllamaGenerate(...args) {
  return await requireOllamaRuntime().runOllamaGenerate(...args);
}

function extractJsonObject(...args) {
  return requireOllamaRuntime().extractJsonObject(...args);
}

async function retryJsonEnvelope(...args) {
  return await requireOllamaRuntime().retryJsonEnvelope(...args);
}

async function debugJsonEnvelopeWithPlanner(...args) {
  return await requireOllamaRuntime().debugJsonEnvelopeWithPlanner(...args);
}

async function replanRepeatedToolLoopWithPlanner(...args) {
  return await requireOllamaRuntime().replanRepeatedToolLoopWithPlanner(...args);
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

ollamaRuntime = createOllamaRuntimeService({
  agentRunTimeoutMs: AGENT_RUN_TIMEOUT_MS,
  buildJsonRepairCandidates,
  buildLocalGroundedTaskLoopRepair,
  buildLocalRepeatedToolLoopRepair,
  buildTranscriptForPrompt,
  choosePlannerRepairBrain: (...args) => choosePlannerRepairBrain(...args),
  clearOllamaEndpointTransportFailure: (...args) => clearOllamaEndpointTransportFailure(...args),
  collectBalancedJsonCandidates,
  defaultModelTemperature: DEFAULT_MODEL_TEMPERATURE,
  findBrainByIdExact: (...args) => findBrainByIdExact(...args),
  formatOllamaTransportError: (...args) => formatOllamaTransportError(...args),
  getBrain: (...args) => getBrain(...args),
  getBrainQueueLane: (...args) => getBrainQueueLane(...args),
  getProjectsRuntime,
  getRoutingConfig,
  isCpuQueueLane: (...args) => isCpuQueueLane(...args),
  isRetriableOllamaTransportError: (...args) => isRetriableOllamaTransportError(...args),
  localOllamaBaseUrl: LOCAL_OLLAMA_BASE_URL,
  markOllamaEndpointTransportFailure: (...args) => markOllamaEndpointTransportFailure(...args),
  maxModelTemperature: MAX_MODEL_TEMPERATURE,
  modelKeepAlive: MODEL_KEEPALIVE,
  normalizeOllamaBaseUrl: (...args) => normalizeOllamaBaseUrl(...args),
  normalizeWorkerDecisionEnvelope: (...args) => normalizeWorkerDecisionEnvelope(...args),
  ollamaEmptyResponseRetryCount: OLLAMA_EMPTY_RESPONSE_RETRY_COUNT,
  ollamaSidecarLeaseWaitMs: OLLAMA_SIDECAR_LEASE_WAIT_MS,
  ollamaTransportRetryCount: OLLAMA_TRANSPORT_RETRY_COUNT,
  ollamaTransportRetryDelayMs: OLLAMA_TRANSPORT_RETRY_DELAY_MS,
  parseFirstJsonCandidateFromList,
  stripAnsi,
  waitMs: (...args) => waitMs(...args),
  workerDecisionJsonSchema: WORKER_DECISION_JSON_SCHEMA
});

function noteInteractiveActivity() {
  lastInteractiveActivityAt = Date.now();
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
  classifyMailMessage,
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
  loadObserverConfig,
  loadObserverLanguage,
  loadObserverLexicon,
  loadOpportunityScanState,
  saveOpportunityScanState
} = createObserverConfigLoader({
  configPath: CONFIG_PATH,
  defaultQdrantCollection: DEFAULT_QDRANT_COLLECTION,
  defaultQdrantUrl: DEFAULT_QDRANT_URL,
  defaultAppPropSlots,
  defaultAppRoomTextures,
  fs,
  getObserverConfig: () => observerConfig,
  getObserverLanguage: () => observerLanguage,
  getObserverLexicon: () => observerLexicon,
  getOpportunityScanState: () => opportunityScanState,
  getProjectConfig,
  languageConfigPath: LANGUAGE_CONFIG_PATH,
  lexiconConfigPath: LEXICON_CONFIG_PATH,
  localOllamaBaseUrl: LOCAL_OLLAMA_BASE_URL,
  migrateLegacyMailPassword,
  migrateLegacyQdrantApiKey,
  normalizeAppTrustConfig,
  normalizeOllamaBaseUrl,
  normalizeProjectConfigInput,
  normalizePropScale,
  normalizeReactionPathsByModel,
  normalizeStylizationEffectPreset,
  normalizeStylizationFilterPreset,
  opportunityScanStatePath: OPPORTUNITY_SCAN_STATE_PATH,
  saveObserverConfig,
  setObserverConfig: (next) => {
    observerConfig = next;
  },
  setObserverLanguage: (next) => {
    observerLanguage = next;
  },
  setObserverLexicon: (next) => {
    observerLexicon = next;
  },
  setOpportunityScanState: (next) => {
    opportunityScanState = next;
  },
  writeVolumeText: (...args) => writeVolumeText(...args)
});

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

const {
  resetSandboxContainerWorkspaceToSimpleProjectState,
  resetToSimpleProjectState
} = createSimpleStateResetService({
  clearDirectoryContents,
  ensureObserverOutputDir,
  ensureObserverToolContainer,
  fs,
  observerContainerWorkspaceRoot: OBSERVER_CONTAINER_WORKSPACE_ROOT,
  observerInputHostRoot: OBSERVER_INPUT_HOST_ROOT,
  observerOutputHostRoot: OBSERVER_OUTPUT_HOST_ROOT,
  path,
  runObserverToolContainerNode,
  simpleStateDirectiveFileName: SIMPLE_STATE_DIRECTIVE_FILE_NAME,
  simpleStateDirectiveText: SIMPLE_STATE_DIRECTIVE_TEXT,
  simpleStateProjectName: SIMPLE_STATE_PROJECT_NAME,
  simpleStateTodayText: SIMPLE_STATE_TODAY_TEXT
});

async function ensureVolumeFile(filePath, content) {
  if (await fileExists(filePath)) {
    return;
  }
  await writeVolumeText(filePath, content);
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
const agentSkillsService = createAgentSkillsService({ brainsConfig: observerConfig.brains });
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
  hashRef,
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
      classifyMailMessage,
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

taskLifecycleDomain = createObserverTaskLifecycleService({
  activeTaskControllers,
  appendFailureTelemetryEntry: (...args) => appendFailureTelemetryEntry(...args),
  appendQueueMaintenanceReport: (...args) => appendQueueMaintenanceReport(...args),
  broadcast,
  broadcastObserverEvent,
  chooseCreativeHandoffBrain: (...args) => chooseCreativeHandoffBrain(...args),
  chooseIdleWorkerBrainForSpecialtyExcluding: (...args) => chooseIdleWorkerBrainForSpecialtyExcluding(...args),
  chooseIdleWorkerBrainForTransportFailover: (...args) => chooseIdleWorkerBrainForTransportFailover(...args),
  classifyFailureText: (...args) => classifyFailureText(...args),
  closedTaskRetentionMs: CLOSED_TASK_RETENTION_MS,
  compactHookText,
  compactTaskText,
  ensureTaskQueueDirs,
  extractTaskIdFromQueuePath,
  fileExists,
  findIndexedTaskById,
  formatTaskCodename,
  fs,
  getBrain,
  getBrainQueueLane,
  getObserverConfig: () => observerConfig,
  getProjectsRuntime,
  inferTaskSpecialty: (...args) => inferTaskSpecialty(...args),
  legacyObserverTaskQueueName: LEGACY_OBSERVER_TASK_QUEUE_NAME,
  legacyTaskQueueRetireAfterMs: LEGACY_TASK_QUEUE_RETIRE_AFTER_MS,
  listAllTasks,
  listTasksByFolder,
  listVolumeFiles,
  maxClosedTaskFiles: MAX_CLOSED_TASK_FILES,
  migrateLegacyTaskQueueIfNeeded,
  normalizeTaskRecord,
  observerTaskQueueName: OBSERVER_TASK_QUEUE_NAME,
  prepareAttachments,
  readTaskStateIndex,
  readVolumeFile,
  recordTaskBreadcrumb,
  persistTaskTransition,
  runPluginHook: async (hookName, payload) => {
    if (pluginManager && typeof pluginManager.runHook === "function") {
      return pluginManager.runHook(hookName, payload);
    }
    return payload;
  },
  scheduleTaskDispatch,
  selectSpecialistBrainRoute: (...args) => selectSpecialistBrainRoute(...args),
  taskPathForStatus,
  taskQueueClosed: TASK_QUEUE_CLOSED,
  taskQueueDone: TASK_QUEUE_DONE,
  taskQueueInbox: TASK_QUEUE_INBOX,
  taskQueueInProgress: TASK_QUEUE_IN_PROGRESS,
  taskQueueWaiting: TASK_QUEUE_WAITING,
  taskStateIndexPath: TASK_STATE_INDEX_PATH,
  visibleCompletedHistoryCount: VISIBLE_COMPLETED_HISTORY_COUNT,
  visibleFailedHistoryCount: VISIBLE_FAILED_HISTORY_COUNT,
  workspaceTaskPath,
  writeTask,
  writeTaskRecord,
  writeVolumeText
});

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
  searchAgentSkills: (query) => agentSkillsService.searchSkills(query),
  runAgentSkill: (skillId, input, brainId) => agentSkillsService.runSkill(skillId, input, brainId),
  workspaceTransactions,
  iotDomain,
  toolMoveMail,
  toolReadDocument,
  toolSendMail,
  writeContainerTextFile,
  writeVolumeText
});

const INTAKE_TOOLS = OBSERVER_INTAKE_TOOLS;

pluginToolCatalogService = createPluginToolCatalogService({
  buildObserverToolCatalog,
  getPluginManager: () => pluginManager,
  getWorkerTools: () => WORKER_TOOLS,
  intakeTools: INTAKE_TOOLS
});

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

let intakePlannerService = null;

async function planIntakeWithBitNet(...args) {
  if (!intakePlannerService) {
    throw new Error("intake planner service is not initialized");
  }
  return await intakePlannerService.planIntakeWithBitNet(...args);
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

intakePlannerService = createIntakePlannerService({
  buildIntakeSystemPrompt: (...args) => buildIntakeSystemPrompt(...args),
  buildPostToolDecisionInstruction,
  buildTranscriptForPrompt,
  compactHookText,
  executeIntakeToolCall,
  extractJsonObject,
  getBrain: async () => await chooseIntakePlanningBrain() || await getBrain("bitnet"),
  intakeLeaseWaitMs: OLLAMA_INTAKE_LEASE_WAIT_MS,
  intakeMessageExplicitlyRequestsScheduling,
  intakePlanTimeoutMs: INTAKE_PLAN_TIMEOUT_MS,
  isLightweightPlannerReplyRequest,
  looksLikeLowSignalPlannerTaskMessage,
  modelKeepAlive: MODEL_KEEPALIVE,
  normalizeAgentSelfReference,
  normalizeIntakeReplyText,
  normalizeToolCallRecord,
  parseToolCallArgs,
  pluginManagerProvider: () => pluginManager,
  runOllamaJsonGenerate,
  shapePlannerTaskMessage
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
  buildToolConfigPayload,
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
  buildInstalledSkillsGuidanceNote,
  buildAgentSkillsGuidanceNote: () => agentSkillsService.buildAgentSkillsGuidanceNote(),
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
  appendProviderHistory: (...args) => taskFlightRecorder.appendProviderHistory(...args),
  appendToolStep: (...args) => taskFlightRecorder.appendToolStep(...args),
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

const triageTaskRequest = createPluginObservedTriageTaskRequest({
  compactHookText,
  getPluginManager: () => pluginManager,
  observerTriageTaskRequest
});

const promptReviewService = createPromptReviewService({
  buildIntakeSystemPrompt,
  buildPromptReviewSampleMessage,
  buildWorkerSystemPrompt,
  getBrain,
  getBrainQueueLane,
  listAvailableBrains
});

const taskLifecycleService = createPluginTaskLifecycleRuntimeService({
  abortActiveTask,
  answerWaitingTask,
  createQueuedTask,
  findTaskById,
  forceStopTask,
  readTaskHistory
});

const pluginHookedQueueProcessors = createPluginHookedQueueProcessors({
  getPluginManager: () => pluginManager,
  getProcessNextQueuedTaskExecutor: () => processNextQueuedTaskExecutor,
  getProcessQueuedTasksToCapacityExecutor: () => processQueuedTasksToCapacityExecutor
});

async function processNextQueuedTask(...args) {
  return await pluginHookedQueueProcessors.processNextQueuedTask(...args);
}

async function processQueuedTasksToCapacity(...args) {
  return await pluginHookedQueueProcessors.processQueuedTasksToCapacity(...args);
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
  coreTransactions: {
    proposeExternalEditTransaction: (...args) => workspaceTransactions.proposeExternalEditTransaction(...args),
    proposeExternalSideEffectTransaction: (...args) => workspaceTransactions.proposeExternalSideEffectTransaction(...args),
    completeExternalTransaction: (...args) => workspaceTransactions.completeExternalTransaction(...args),
    listTransactionsForTask: (...args) => workspaceTransactions.listTransactionsForTask(...args)
  },
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
  requirePluginToolCatalogService().resetPluginToolCatalogCache();
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

registerObserverIotRoutes({
  app,
  dirname: __dirname,
  iotDomain,
  noteInteractiveActivity
});

registerAgentSkillRoutes({
  app,
  agentSkillsService,
  noteInteractiveActivity
});

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






