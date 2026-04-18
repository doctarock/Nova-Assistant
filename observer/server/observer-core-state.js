export const SIMPLE_STATE_PROJECT_NAME = "simple-check-project";
export const SIMPLE_STATE_DIRECTIVE_FILE_NAME = "directive.md";
export const SIMPLE_STATE_DIRECTIVE_TEXT = "Check this box [ ]\n";
export const SIMPLE_STATE_TODAY_TEXT = [
  "# Daily Briefing",
  "",
  "Generated: reset for a clean start",
  "Focus: one simple input project",
  "Documents tracked: 1",
  "New: 1",
  "Changed: 0",
  "Urgent: 1",
  "",
  "## Needs Attention",
  "- simple-check-project/directive.md | actions: Check this box [ ]",
  "",
  "## New Documents",
  "- simple-check-project/directive.md",
  "",
  "## Changed Documents",
  "- None",
  ""
].join("\n");

export const WORKER_TOOL_CALL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    type: { type: "string", enum: ["function"] },
    function: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        arguments: { type: "string" }
      },
      required: ["name", "arguments"]
    }
  },
  required: ["id", "type", "function"]
};

export const WORKER_DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistant_message: { type: "string" },
    final_text: { type: "string" },
    tool_calls: {
      type: "array",
      items: WORKER_TOOL_CALL_JSON_SCHEMA,
      maxItems: 6
    },
    final: { type: "boolean" }
  },
  required: ["assistant_message", "tool_calls", "final"]
};

export const AGENT_BRAINS = [
  {
    id: "intake",
    label: "Intake",
    kind: "intake",
    model: "qwen2.5:1.5b",
    toolCapable: false,
    cronCapable: false,
    description: "CPU-only intake model for user conversation and queue planning"
  },
  {
    id: "worker",
    label: "Worker",
    kind: "worker",
    model: "qwen3.5:9b",
    toolCapable: true,
    cronCapable: true,
    description: "GPU worker for queued tool-using execution"
  },
  {
    id: "helper",
    label: "Helper",
    kind: "helper",
    model: "gemma3:1b",
    toolCapable: false,
    cronCapable: false,
    description: "Small helper model for speculative pre-triage, summarization, and ticket shaping"
  }
];

export function normalizeProjectsConfigForBootstrap(configured = {}) {
  const source = configured && typeof configured === "object" ? configured : {};
  const numericOrDefault = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const normalizeCreativeThroughputMode = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    return ["conservative", "auto", "fast"].includes(normalized) ? normalized : "auto";
  };
  return {
    maxActiveWorkPackagesPerProject: Math.max(1, Math.min(numericOrDefault(source.maxActiveWorkPackagesPerProject, 6), 12)),
    projectWorkRetryCooldownMs: Math.max(0, numericOrDefault(source.projectWorkRetryCooldownMs, 6 * 60 * 60 * 1000)),
    projectBackupIntervalMs: Math.max(60 * 1000, numericOrDefault(source.projectBackupIntervalMs, 15 * 60 * 1000)),
    opportunityScanIdleMs: Math.max(5000, numericOrDefault(source.opportunityScanIdleMs, 60 * 1000)),
    opportunityScanIntervalMs: Math.max(10000, numericOrDefault(source.opportunityScanIntervalMs, 60 * 1000)),
    opportunityScanRetentionMs: Math.max(60 * 60 * 1000, numericOrDefault(source.opportunityScanRetentionMs, 30 * 24 * 60 * 60 * 1000)),
    opportunityScanMaxQueuedBacklog: Math.max(1, Math.min(numericOrDefault(source.opportunityScanMaxQueuedBacklog, 5), 50)),
    noChangeMinimumConcreteTargets: Math.max(1, Math.min(numericOrDefault(source.noChangeMinimumConcreteTargets, 3), 6)),
    projectWorkMaxRetries: Math.max(1, Math.min(numericOrDefault(source.projectWorkMaxRetries, 5), 50)),
    creativeThroughputMode: normalizeCreativeThroughputMode(source.creativeThroughputMode),
    autoCreateProjectDirective: source.autoCreateProjectDirective !== false,
    autoCreateProjectTodo: source.autoCreateProjectTodo !== false,
    autoCreateProjectRoleTasks: source.autoCreateProjectRoleTasks !== false,
    autoImportProjects: source.autoImportProjects !== false,
    autoBackupWorkspaceProjects: source.autoBackupWorkspaceProjects !== false,
    autoExportReadyProjects: source.autoExportReadyProjects !== false
  };
}

export function createInitialObserverConfig({ localOllamaBaseUrl = "" } = {}) {
  return {
    app: {
      botName: "Agent",
      avatarModelPath: "/assets/characters/Nova.glb",
      backgroundImagePath: "",
      stylizationFilterPreset: "none",
      stylizationEffectPreset: "none",
      reactionPathsByModel: {},
      roomTextures: {
        walls: "",
        floor: "",
        ceiling: "",
        windowFrame: ""
      },
      propSlots: {
        backWallLeft: { model: "", scale: 1 },
        backWallRight: { model: "", scale: 1 },
        wallLeft: { model: "", scale: 1 },
        wallRight: { model: "", scale: 1 },
        besideLeft: { model: "", scale: 1 },
        besideRight: { model: "", scale: 1 },
        outsideLeft: { model: "", scale: 1 },
        outsideRight: { model: "", scale: 1 }
      },
      voicePreferences: [],
      trust: {
        emailCommandMinLevel: "trusted",
        voiceCommandMinLevel: "trusted",
        records: [],
        emailSources: [],
        voiceProfiles: []
      }
    },
    defaults: {
      internetEnabled: true,
      mountIds: [],
      intakeBrainId: "bitnet"
    },
    brains: {
      enabledIds: ["bitnet", "worker"],
      builtIn: [],
      endpoints: {
        local: {
          label: "Local Ollama",
          baseUrl: localOllamaBaseUrl
        }
      },
      assignments: {
        bitnet: "local",
        worker: "local",
        helper: "local"
      },
      custom: []
    },
    routing: {
      enabled: false,
      remoteTriageBrainId: "",
      specialistMap: {
        code: [],
        document: [],
        general: [],
        background: []
      },
      fallbackAttempts: 2
    },
    queue: {
      remoteParallel: true,
      escalationEnabled: true,
      paused: false
    },
    projects: normalizeProjectsConfigForBootstrap(),
    networks: {
      internal: "local",
      internet: "internet"
    },
    retrieval: {
      qdrantUrl: "http://127.0.0.1:6333",
      collectionName: "observer_chunks",
      apiKeyHandle: "retrieval/qdrant/api-key"
    },
    mail: {
      enabled: false,
      activeAgentId: "nova",
      pollIntervalMs: 30000,
      imap: {
        host: "",
        port: 993,
        secure: true
      },
      smtp: {
        host: "",
        port: 587,
        secure: false,
        requireTLS: true
      },
      agents: {}
    },
    mounts: []
  };
}

export function createInitialObserverLanguage() {
  return {
    acknowledgements: {
      directWorking: "I'm working on it.",
      queueReady: "I'm getting {{taskRef}} ready now.",
      queueEscalated: "I'm getting {{taskRef}} ready now.\n\nI'll take a deeper look and follow up shortly."
    },
    voice: {
      passiveOff: "Passive listening is off. Say <strong>{{botName}}</strong> to begin, then <strong>{{stopPhrase}}</strong> to finish once enabled.",
      passiveOn: "Passive listening is on. Say <strong>{{botName}}</strong> to begin.",
      listening: "Listening for your request. Say <strong>{{stopPhrase}}</strong> to finish.",
      listeningHeard: "Listening for your request. Say <strong>{{stopPhrase}}</strong> to finish.<br><strong>Heard:</strong> {{previewText}}",
      capturedQueued: "Captured request queued: <strong>{{text}}</strong>",
      capturedQueuedMeta: "Nova will send this when ready.",
      capturedRequest: "Captured request: <strong>{{text}}</strong>",
      capturedSubmitted: "Captured request submitted.",
      queuedSubmitted: "Queued request submitted.",
      sendingQueued: "Sending queued request: <strong>{{text}}</strong>"
    },
    taskNarration: {
      completedOpeners: [
        "I've finished {{taskRef}}.",
        "{{taskRef}} is done.",
        "I wrapped up {{taskRef}}."
      ],
      failedOpeners: [
        "I ran into a problem with {{taskRef}}.",
        "{{taskRef}} hit an issue.",
        "Something went wrong while I was working on {{taskRef}}."
      ],
      failedFallback: "I wasn't able to finish it cleanly.",
      recoveredOpeners: [
        "I'm picking {{taskRef}} back up.",
        "{{taskRef}} is back in motion.",
        "I've recovered {{taskRef}} and I'm trying again."
      ],
      recoveredFallback: "It had stalled, so I restarted it.",
      escalatedOpeners: [
        "I'm taking {{taskRef}} into a deeper pass.",
        "{{taskRef}} needs a closer look, so I'm digging further.",
        "I'm giving {{taskRef}} a deeper pass now."
      ],
      escalatedDetail: "I'll follow up once I have the result.",
      inProgressOpeners: [
        "I'm working on {{taskRef}}, hang tight.",
        "{{taskRef}} is in progress. Hang tight.",
        "Still on {{taskRef}}. Give me a moment."
      ],
      inProgressFastDetail: "I am fast tracking this one.",
      inProgressDefaultDetail: "This may take some time.",
      queuedOpeners: [
        "I've queued {{taskRef}}.",
        "{{taskRef}} is lined up.",
        "I've added {{taskRef}} to the queue."
      ],
      queuedFallback: "It will be handled by {{brainLabel}}."
    }
  };
}

export function createInitialOpportunityScanState() {
  return {
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

export function createInitialMailState() {
  return {
    activeAgentId: "",
    lastCheckAt: 0,
    lastError: "",
    recentMessages: [],
    highestUidByAgent: {},
    quarantinedMessages: []
  };
}

export function createInitialMailWatchRulesState() {
  return {
    sendSummariesEnabled: true,
    rules: []
  };
}

export function createInitialDocumentRulesState() {
  return {
    watchTerms: [
      "invoice",
      "bill",
      "renewal",
      "meeting",
      "appointment",
      "reply",
      "follow up",
      "deadline",
      "contract",
      "quote",
      "proposal"
    ],
    importantPeople: [],
    preferredPathTerms: [
      "observer-output",
      "attachment",
      "attachments",
      "inbox",
      "mail",
      "download",
      "document",
      "notes",
      "todo",
      "task",
      "invoice",
      "quote",
      "proposal",
      "contract",
      "schedule",
      "calendar"
    ],
    ignoredPathTerms: [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".derpy-observer-runtime"
    ],
    ignoredFileNamePatterns: [
      "readme",
      "license",
      "copying",
      "changelog",
      "package-lock",
      "pnpm-lock",
      "yarn.lock",
      "cargo.lock",
      "composer.lock"
    ]
  };
}

export function createInitialVoicePatternStore() {
  return {
    profiles: []
  };
}
