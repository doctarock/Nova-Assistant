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

export const PROJECT_ROLE_PLAYBOOKS = [
  { name: "Product Manager", playbook: "Look for missing product goals, unclear user value, weak prioritization, or chances to turn vague work into a sharper user-facing outcome." },
  { name: "Project Manager", playbook: "Look for blocked tasks, sequencing problems, stale TODOs, missing next actions, or work that should be broken into a concrete next step." },
  { name: "Business Analyst", playbook: "Look for requirements gaps, unclear business rules, missing acceptance criteria, or documents that imply unimplemented business needs." },
  { name: "Technical Architect / Solutions Architect", playbook: "Look for architectural drift, missing integration points, unclear boundaries, or systems that need a concrete technical decision recorded in code or docs." },
  { name: "Story Architect", playbook: "Look for plot shape, scene sequencing, escalation, act structure, and whether the current story beat is doing enough work." },
  { name: "Developmental Editor", playbook: "Look for chapter-level clarity, pacing problems, weak scene purpose, muddy stakes, or missing emotional movement across the draft." },
  { name: "Line Editor", playbook: "Look for sentence-level clarity, rhythm, repetition, awkward phrasing, tonal drift, and places where prose can be tightened without flattening voice." },
  { name: "Continuity Editor", playbook: "Look for contradictions in timeline, POV, tense, names, world rules, and manuscript-to-outline consistency that would confuse later passes." },
  { name: "Character Writer", playbook: "Look for flat motivation, weak interiority, inconsistent voice, thin emotional turns, or dialogue that does not sound specific to the character." },
  { name: "Worldbuilding Designer", playbook: "Look for setting logic, lore consistency, faction clarity, and whether the world details are supporting story tension instead of sitting beside it." },
  { name: "UX Researcher", playbook: "Look for places where user assumptions are undocumented, evidence is missing, or a document suggests a question that should shape product decisions." },
  { name: "UX Designer", playbook: "Look for flow gaps, interaction problems, or unclear user journeys that could be improved through concrete UI or content changes." },
  { name: "Information Architect", playbook: "Look for confusing structure, navigation, naming, file organization, or documentation hierarchy issues." },
  { name: "UI Designer", playbook: "Look for component-level UI polish, layout inconsistency, weak hierarchy, or screens that need concrete visual improvement work." },
  { name: "Graphic Designer", playbook: "Look for missing graphics, weak visual assets, presentation issues, or opportunities to improve exported artifacts." },
  { name: "Brand Designer", playbook: "Look for inconsistent voice, identity drift, naming inconsistency, or missing brand application in user-facing materials." },
  { name: "Motion Designer", playbook: "Look for places where motion, transitions, or animation cues would clarify behavior or improve presentation." },
  { name: "Content Designer", playbook: "Look for unclear in-product language, missing guidance text, poor labels, or documentation that should be rewritten for clarity." },
  { name: "Front-End Developer", playbook: "Look for concrete UI implementation work, TODO/FIXME markers, broken interactions, styling issues, or missing pages/components." },
  { name: "Front-End Framework Developer", playbook: "Look for framework-specific refactors, state flow issues, routing issues, or misuse of the current front-end stack." },
  { name: "Accessibility Specialist", playbook: "Look for accessibility fixes, semantic gaps, missing labels, contrast issues, keyboard flow issues, or documentation that implies compliance risk." },
  { name: "Back-End Developer", playbook: "Look for API work, server logic fixes, handler gaps, integration bugs, or implementation tasks in backend code." },
  { name: "Database Engineer", playbook: "Look for schema issues, data model gaps, migrations, indexing opportunities, or backend tasks with data persistence implications." },
  { name: "Full-Stack Developer", playbook: "Look for vertical slices where one concrete feature or fix spans front-end and back-end safely." },
  { name: "DevOps Engineer", playbook: "Look for deployment, CI/CD, build, release, or environment workflow issues that can be improved concretely." },
  { name: "Cloud Engineer", playbook: "Look for infrastructure, hosting, runtime, or service configuration work suggested by the repo or documents." },
  { name: "Security Engineer", playbook: "Look for obvious security hardening tasks, secret handling issues, risky defaults, or exposed attack surface in code/config/docs." },
  { name: "Penetration Tester", playbook: "Look for concrete security validation targets, suspicious patterns, or areas where a safe security review task is warranted." },
  { name: "QA Tester", playbook: "Look for missing test coverage, reproducible bug checks, missing validation steps, or user-visible behavior that should be verified." },
  { name: "Automation QA Engineer", playbook: "Look for test automation additions, smoke checks, scripted validations, or flaky/manual workflows that should be automated." },
  { name: "Copywriter", playbook: "Look for marketing or site copy improvements, weak messaging, awkward phrasing, or missing persuasive content." },
  { name: "Content Manager", playbook: "Look for stale content, missing content structure, content inventory gaps, or priorities for maintaining user-facing content." },
  { name: "SEO Specialist", playbook: "Look for metadata, discoverability, heading structure, content gaps, or technical SEO tasks in the repo or documents." },
  { name: "Digital Marketer", playbook: "Look for campaign assets, landing page opportunities, distribution tasks, or messaging follow-ups grounded in existing files." },
  { name: "Data Analyst", playbook: "Look for instrumentation gaps, report opportunities, datasets needing analysis, or places where metrics would improve decisions." },
  { name: "CRO Specialist", playbook: "Look for conversion bottlenecks, landing page improvement opportunities, CTA issues, or experiments that can be implemented concretely." },
  { name: "Web Administrator", playbook: "Look for operational website upkeep, config hygiene, content publishing issues, or routine admin work that is grounded in current files." },
  { name: "Support Engineer", playbook: "Look for unresolved support-like issues, setup pain, troubleshooting gaps, or documentation/code improvements that reduce user friction." },
  { name: "Community Manager", playbook: "Look for public-facing docs, community guidance, announcement-ready artifacts, or recurring user questions that need better support material." }
];

export const AGENT_BRAINS = [
  {
    id: "bitnet",
    label: "CPU Intake",
    kind: "intake",
    model: "qwen2.5:1.5b",
    toolCapable: false,
    cronCapable: false,
    description: "CPU-only intake model for user conversation and queue planning"
  },
  {
    id: "worker",
    label: "Qwen Worker",
    kind: "worker",
    model: "qwen3.5:latest",
    toolCapable: true,
    cronCapable: true,
    description: "GPU worker for queued tool-using execution"
  },
  {
    id: "helper",
    label: "Gemma Helper",
    kind: "helper",
    model: "gemma3:1b",
    toolCapable: false,
    cronCapable: false,
    description: "Small helper model for speculative pre-triage, summarization, and ticket shaping"
  }
];

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
    projects: {
      maxActiveWorkPackagesPerProject: 6,
      projectWorkRetryCooldownMs: 6 * 60 * 60 * 1000,
      projectBackupIntervalMs: 15 * 60 * 1000,
      opportunityScanIdleMs: 60 * 1000,
      opportunityScanIntervalMs: 60 * 1000,
      opportunityScanRetentionMs: 30 * 24 * 60 * 60 * 1000,
      opportunityScanMaxQueuedBacklog: 5,
      noChangeMinimumConcreteTargets: 3,
      autoCreateProjectDirective: true,
      autoCreateProjectTodo: true,
      autoCreateProjectRoleTasks: true,
      autoImportProjects: true,
      autoBackupWorkspaceProjects: true,
      autoExportReadyProjects: true
    },
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
      ".observer-runtime"
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
