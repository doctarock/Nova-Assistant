![Preview](https://repository-images.githubusercontent.com/1188661951/fd2bd3dd-5d6e-489e-9259-59c827988f06)

## Documentation

- [Plugin System Developer Guide](docs/PLUGIN-SYSTEM.md)
- [Semantic Compression Implementation Status](docs/IMPLEMENTATION_STATUS.md)
- [Compression Quick Reference](docs/COMPRESSION_QUICK_REFERENCE.md)
- [Semantic Compression Quick Start](docs/SEMANTIC_COMPRESSION_QUICK_START.md)
- [Tool Loop Compression Guide](docs/TOOL_LOOP_COMPRESSION_GUIDE.md)

---

Nova is a host-side AI orchestration application that combines:
- A web control panel
- Multi-brain LLM routing and execution across local and LAN endpoints
- A persistent queue-first task system
- Secure sandboxed tool execution in Docker
- Retrieval and document intelligence (Qdrant-backed)
- A plugin system for extending capabilities
- Voice interface with trust-based command gating

It is designed to run continuously as an autonomous or semi-autonomous operator while still allowing direct user supervision.

## 2. Core User-Facing Features

### 2.1 Main UI and Control Surface

The web UI includes dedicated tabs for:
- `Nova` — identity, voice preferences, questions, trust records
- `Queue` — queued/in-progress/done/failed tasks, repairs, issues, schedules, history
- `Brains` — model status, endpoints, base brains, specialists, routing config
- `Secrets` — keychain handles for retrieval, mail, and custom secrets
- `Capabilities` — tool catalog, installed skills, capability request tracking
- `Plugins` — installed plugins, interfaces, operations
- `System` — gateway health, intake state, SSE logs, regression test runner

### 2.2 Conversational Intake and Routing

The system supports:
- Direct run (`/api/agent/run`)
- Triage-first route selection (`/api/tasks/triage`)
- Queue handoff for deeper worker execution
- Observer-native immediate responses for common requests (time/date/status-style prompts)
- Prompt rewrite assistance using idle helper brains
- Optional worker preflight for ambiguity checks and clarification
- Multi-specialist routing across local and remote Ollama endpoints

### 2.3 Queue and Task Lifecycle

Queue functionality includes:
- Enqueueing, dispatching, removing, aborting, and answering tasks
- Task event stream and per-task history retrieval
- Waiting-for-user task handling and resume flow
- Deduplication of recently queued tasks
- Repair/follow-up monitor views
- Reshape issue tracking and reset workflow
- Queue pause/resume controls

### 2.4 Voice Interface and Trust

Voice functionality includes:
- Browser speech synthesis and recognition integration
- Passive listening toggle flow
- Voice fingerprint capture and matching
- Threshold-based trust profile matching
- Command allow/block decisions using configured minimum voice trust level
- Persisted trust records that unify email and voice identity concepts

### 2.5 3D Avatar and Visual Stage

Avatar system includes:
- Three.js rendering with GLTF model support
- Emotion-to-animation mapping and talking clip rotation
- Stylization presets/effects (post-processing pipeline)
- Configurable room textures/backgrounds
- Configurable prop slots and model placement

## 3. Automation and Background Intelligence

### 3.1 Internal Periodic Jobs

The system maintains internal queue-backed recurring jobs for:
- Opportunity scanning
- Prompt memory question maintenance
- Mail-watch sweeps
- Recreation/free-time cycles

### 3.2 Opportunity and Maintenance Systems

Background logic includes:
- Idle-time workspace opportunity generation
- Helper-scout work-package generation
- Queue maintenance snapshots and reshape follow-up planning
- Automatic skip/backoff behavior based on activity, backlog, and lane capacity

### 3.3 Recreation Cycle

The recreation subsystem:
- Queues non-deliverable free-time reflection tasks
- Encourages self-directed browsing/thinking/writing
- Validates that personal-note output is actually persisted

## 4. Retrieval and Document Intelligence

Retrieval domain capabilities:
- Qdrant collection lifecycle and health usage
- Workspace document scanning and normalization
- Content chunking with overlap controls
- Embedding-based indexing and query
- Filtered search (workspace/root/document/source)
- Document overview/search summaries surfaced through observer-native tooling

## 5. Tooling, Skills, and Approvals

### 5.1 Tool Catalog and Governance

Tool governance includes:
- Unified catalog across intake and worker scopes
- Risk classification (`normal`, `medium`, `high`, `approval`)
- Per-tool autonomous approval flags
- Persistent tool registry state

### 5.2 Capability Request Tracking

The system records unmet capability demand:
- Missing tool requests
- Skill installation requests
- Aggregation and status tracking for open/resolved requests

### 5.3 Skill Library Integration

Skill features include:
- Search and inspect via clawhub inside sandbox context
- Install into sandbox workspace
- Approved-skill gating before operational usage
- Installed skill inventory and metadata

## 6. Plugin System

Plugins extend the observer at runtime without modifying core code:
- Dynamic plugin loading from the plugins directory
- Interface and operation registration
- Plugin inventory visible in the Plugins UI tab
- See [Plugin System Developer Guide](docs/PLUGIN-SYSTEM.md) for authoring details

## 7. Semantic Compression

Tool loop and shell output compression reduces context bloat during long task execution:
- Automatic summarization of large tool outputs
- Shell hook compression for verbose command output
- Configurable compression thresholds
- See [Compression Quick Reference](docs/COMPRESSION_QUICK_REFERENCE.md) for details

## 8. Security and Isolation Model

### 8.1 Sandbox Model

Tool execution is isolated in a Docker container with:
- Read-only root filesystem
- Dropped Linux capabilities (`--cap-drop ALL`)
- `no-new-privileges`
- PID/memory/CPU limits
- Dedicated writable mounts only for allowed input/output/state paths

### 8.2 Secrets Management

Secrets are managed via OS keychain (`keytar`) with handles for:
- Mail agent passwords
- Retrieval/Qdrant API key
- Custom handles

### 8.3 Trust Controls

Trust system supports:
- Source trust levels (`unknown`, `known`, `trusted`)
- Email command minimum trust policy
- Voice command minimum trust policy
- Unified trust records with optional voice signature thresholds

## 9. API Surface Summary (Grouped)

Primary route groups:
- Runtime: `/api/runtime/*`, `/events/*`
- Intake/run: `/api/agent/run`, `/api/tasks/triage`, `/api/prompts/review`
- Queue/tasks: `/api/tasks/*`, `/api/queue/control`
- Cron/jobs: `/api/cron/*`
- Config/control: `/api/app/config`, `/api/brains/config`, `/api/tools/config`, `/api/secrets/*`
- Inspection/output: `/api/inspect/*`, `/api/output/*`
- Regressions: `/api/regressions/*`

## 10. Testing and Quality Features

Regression support includes:
- Built-in suite definitions for intake, planner, worker, and related flows
- UI-triggered regression execution from the System tab
- Latest persisted report retrieval
- Generated command-line helper for external run parity (`run-regressions.js`)

## 11. Runtime Dependencies and Deployment Shape

Expected runtime stack:
- Host Node.js observer process (`node server.js`)
- Ollama endpoint(s) for model execution
- Docker sandbox container for tool execution
- Qdrant for retrieval/search storage

## 12. Feature Positioning Snapshot

In practical terms, this application is:
- A local AI operations console
- A queue-first autonomous worker coordinator
- A safety-conscious sandboxed tool runtime
- A multi-brain routing layer across local and LAN Ollama endpoints

# Handoff

This repo runs as a host-side Node observer with a Docker sandbox for LLM-controlled tools, plus Ollama for model execution. There is no gateway container.

Special note on security: the environment described is inherently secure, however, the interface is not currently suitable for open web-facing use.

The accuracy on the voice security is dubious. There is no spoofing protection on email trust. Use these features carefully and run this on a local environment.

Trust settings are under the Nova tab.

## Current Setup

- Repo root: `<your-repo-path>`
- Observer app: `observer/`
- Observer URL: `http://127.0.0.1:3220/`
- Observer server entry: `observer/server.js`
- Observer config: `observer/observer.config.json`
- Observer runtime root: `observer/.observer-runtime`
- User-facing output folder: `<your-repo-path>/observer-output`

## Runtime Shape

The observer process runs directly on the host:

- launch command: `node server.js`
- working directory: `observer/`
- it owns:
  - the web UI
  - the scheduler
  - the queue
  - mail polling/sending
  - document indexing
  - task orchestration

The LLM does not get host shell access directly. Tool execution is isolated in Docker.

## Docker Sandbox

The LLM tool sandbox is the important security boundary.

- container name: `observer-sandbox`
- image name: `openclaw-safe`
- named volume: `observer-sandbox-state`
- container home: `/home/openclaw`
- internal working workspace: `/home/openclaw/.observer-sandbox/workspace`
- host output export mount: `/home/openclaw/observer-output`

The observer creates this container automatically on startup if needed.

### Tool install requirements

When adding or restoring a built-in tool for Nova, treat it as a runtime feature, not just a code change.

Required checks:

- if the tool shells out to a system command, that command must exist inside the `openclaw-safe` image, not just on the host
- if the tool depends on a language runtime, library, or binary, install that dependency in `Dockerfile`
- keep the tool name in code, prompts, and diagnostics aligned with the real callable name
- make sure the tool is present in the observer tool catalog so the worker prompt and approval state can expose it
- rebuild `openclaw-safe` after changing runtime dependencies
- replace or recreate `observer-sandbox` so the live observer stops using the old image
- verify the dependency inside the running sandbox with `docker exec observer-sandbox sh -lc "command -v <tool>"`
- verify the tool path end-to-end with one real sandboxed call before trusting overnight autonomy

Recent example:

- `unzip` existed in `server.js`, but the sandbox image did not contain `/usr/bin/unzip`
- result: Nova could see unzip-related work in project input, but runtime execution failed or drifted into bogus capability/missing-tool conclusions
- fix: install `zip` and `unzip` in `Dockerfile`, rebuild `openclaw-safe`, and let the observer recreate `observer-sandbox`

### Sandbox flags

The container is started with:

- `--read-only`
- `--cap-drop ALL`
- `--security-opt no-new-privileges`
- `--pids-limit 200`
- `--memory 2g`
- `--cpus 2.0`
- `--tmpfs /tmp`

Current caveat:

- the sandbox is expected to run as the non-root `openclaw` user
- on startup, the observer may launch a short host-managed bootstrap container as root only to repair ownership inside the named state volume, then it starts the actual AI sandbox as `openclaw`
- the AI-controlled sandbox still remains constrained by the read-only filesystem, dropped capabilities, no-new-privileges, tmpfs `/tmp`, and restricted mounts

### Sandbox mounts

The live sandbox is allowed to access exactly three locations:

- writable input share:
  - `<your-repo-path>/observer-input` -> `/home/openclaw/observer-input`
- writable sandbox workspace:
  - Docker named volume `observer-sandbox-state` -> `/home/openclaw/.observer-sandbox/workspace`
- writable output share:
  - `<your-repo-path>/observer-output` -> `/home/openclaw/observer-output`

No other host bind mounts are allowed into the Nova runtime sandbox.

Persistent internal sandbox state lives in the named Docker volume, not in the host repo.

### Security model

This is the intended design:

- Nova can read and write only within `observer-input`, the sandbox workspace, and `observer-output`
- Nova should not have arbitrary host filesystem write access
- Nova should not have host shell access

This is why the sandbox exists at all. Do not break the observer back out into direct host file/shell tooling.

## Docker and Ollama Containers

Containers that should normally exist:

- `observer-sandbox` (created dynamically by the observer on startup)
- `nova-qdrant` (via docker-compose)
- Ollama (managed separately)

## Models and Brains

Enabled brains in `observer/observer.config.json`:

**Built-in (local):**
- `intake` — Gemma 4 E4B, local Ollama, conversation and direct replies
- `worker` — Gemma 4 26B, local Ollama, queued tool-using work
- `helper` — Gemma 3 1B (disabled by default), speculative sidecar

**Remote specialists:**
- `remote_cpu` — Qwen 3.5 4B, LAN CPU planner for triage and routing
- `creative_worker` — Hermes 3, LAN GPU, creative and ideation tasks
- `code_worker` — Qwen 2.5 Coder 7B, LAN GPU, code tasks
- `vision_worker` — MiniCPM-V, LAN GPU, vision/image tasks
- `retrieval_worker` — MXBAI Embed Large, LAN GPU, embedding and retrieval
- `lappy_gpu_big` — Qwen 3.5 9B, laptop GPU, general tool-capable work
- `lan_73_p4` — Qwen 3.5 9B, LAN P4 endpoint, general tool-capable work
- `lap_planner` — FunctionGemma, laptop CPU, routing

## Mail

Mail polling is configured in `observer/observer.config.json` and handled by the observer process.

- IMAP host: `mail.example.com`
- SMTP host: `mail.example.com`
- active mailbox: `nova@example.com`

The observer supports:

- inbox polling
- sending mail
- archive/trash moves
- native spam/phishing heuristics
- recurring mail-watch jobs

## Queue and Scheduler

The queue is local to this observer and stored under:

- `observer/.observer-runtime/observer-task-queue`

Task folders:

- `inbox`
- `in_progress`
- `done`
- `closed`

There is no external cron service. Periodic work is implemented as self-perpetuating queued tasks.

Examples of internal recurring jobs:

- idle opportunity scan
- cleanup sweep
- mail watch

## Prompt and Memory Files

Editable prompt/memory files on the host:

- `observer/workspace-prompt-edit/AGENTS.md`
- `observer/workspace-prompt-edit/TOOLS.md`
- `observer/workspace-prompt-edit/SOUL.md`
- `observer/workspace-prompt-edit/USER.md`
- `observer/workspace-prompt-edit/MEMORY.md`
- `observer/workspace-prompt-edit/PERSONAL.md`
- `observer/workspace-prompt-edit/memory/...`

These are copied into the sandbox workspace as seed content.

## Important Paths

Host side:

- repo root: `<your-repo-path>`
- observer app: `<your-repo-path>/observer`
- output folder: `<your-repo-path>/observer-output`
- runtime state: `<your-repo-path>/observer/.observer-runtime`

Sandbox side:

- workspace: `/home/openclaw/.observer-sandbox/workspace`
- input: `/home/openclaw/observer-input`
- output: `/home/openclaw/observer-output`

## Recommended Bring-Up

```powershell
docker version
docker info
wsl --status
```

Build the sandbox image from the repo root:

```powershell
docker build -t openclaw-safe .
```

Then start Qdrant and the observer:

```powershell
cd <your-repo-path>
docker compose up -d qdrant

$env:QDRANT_URL="http://127.0.0.1:6333"
cd <your-repo-path>\observer
node server.js
```

Then verify:

- `http://127.0.0.1:3220/api/runtime/status`
- `http://127.0.0.1:3220/api/runtime/options`
- sandbox container exists
- Ollama is reachable
- Qdrant is reachable at `http://127.0.0.1:6333/collections`

## What Must Be Updated

- host paths in `observer/observer.config.json`
- mail credentials via the Secrets tab (stored in OS keychain via keytar)
- Ollama endpoint URLs if your LAN IPs differ from the defaults in config

## What To Preserve

- observer UI
- Nova avatar and voice flow
- queue-driven work model
- Docker sandbox isolation
- host-backed `observer-output`
- host-backed `observer-input`
- prompt and memory scaffolding
- local mail handling
