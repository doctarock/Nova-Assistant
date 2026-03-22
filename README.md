![Preview](https://repository-images.githubusercontent.com/1188661951/fd2bd3dd-5d6e-489e-9259-59c827988f06)

# Handoff

This repo no longer runs as an OpenClaw gateway stack, only the skill library remains integrated. The live system is a host-side Node observer with a Docker sandbox for LLM-controlled tools, plus Ollama for model execution.

Special note on security, the environment described is inherently secure, the interface is not currently suitable for web facing.

The accuracy on the voice security is dubious. There is no spoofing protection on email trust. Use these features carefully, you have been warned.

Trust settings are under the Nova tab, I do not currently have a walk through for the interface, my apologies.

## Current Setup

- Repo root: `e:\AI\claw`
- Observer app: `openclaw-observer`
- Observer URL: `http://127.0.0.1:3220/`
- Observer server entry: `openclaw-observer/server.js`
- Observer config: `openclaw-observer/observer.config.json`
- Observer runtime root: `openclaw-observer/.observer-runtime`
- User-facing output folder: `e:\AI\claw\observer-output`

## Runtime Shape

The observer process runs directly on the host:

- launch command: `node server.js`
- working directory: `\workspace\`
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

- container name: `\observer-sandbox`
- image name: `openclaw-safe`
- named volume: `\observer-sandbox-state`
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
  - `e:\AI\claw\observer-input` -> `/home/openclaw/observer-input`
- writable sandbox workspace:
  - Docker named volume `observer-sandbox-state` -> `/home/openclaw/.observer-sandbox/workspace`
- writable output share:
  - `e:\AI\claw\observer-output` -> `/home/openclaw/observer-output`

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

- `observer-sandbox`
- `ollama`
- `qdrant`

There is no longer a long-lived `openclaw-gw` gateway container in the current design.

## Models and Brains

Enabled brains in `observer.config.json`:

- `intake`
  - label: `CPU Intake`
  - model: `qwen2.5:1.5b`
  - role: user conversation, direct replies, local planning
- `worker`
  - label: `Qwen Worker`
  - model: `qwen3.5:latest`
  - role: queued tool-using work

Defined but currently disabled:

- `helper`
  - label: `Shadow Helper`
  - model: `gemma3:1b`
  - intended role: speculative pre-triage / summarization sidecar

## Mail

Mail is handled by the observer process, not by Dockerized OpenClaw.

- IMAP host: `mail.example.net.au`
- SMTP host: `mail.example.net.au`
- active mailbox: `nova@example.net.au`

The observer currently supports:

- inbox polling
- sending mail
- archive/trash moves
- native spam/phishing heuristics
- recurring mail-watch jobs

## Queue and Scheduler

The queue is local to this observer and stored under:

- `openclaw-observer/.observer-runtime/observer-task-queue`

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

- `openclaw-observer/workspace-prompt-edit/AGENTS.md`
- `openclaw-observer/workspace-prompt-edit/TOOLS.md`
- `openclaw-observer/workspace-prompt-edit/SOUL.md`
- `openclaw-observer/workspace-prompt-edit/USER.md`
- `openclaw-observer/workspace-prompt-edit/MEMORY.md`
- `openclaw-observer/workspace-prompt-edit/PERSONAL.md`
- `openclaw-observer/workspace-prompt-edit/memory/...`

These are copied into the sandbox workspace as seed content.

## Important Paths

Host side:

- repo root: `e:\AI\claw`
- observer app: `e:\AI\claw\openclaw-observer`
- output folder: `e:\AI\claw\observer-output`
- runtime state: `e:\AI\claw\openclaw-observer\.observer-runtime`

Sandbox side:

- workspace: `/home/openclaw/.observer-sandbox/workspace`
- input: `/home/openclaw/observer-input`
- output: `/home/openclaw/observer-output`

## Goal

Replicate the current observer architecture on your current environment, not the older OpenClaw gateway stack.

That means:

- host-side Node observer
- Docker sandbox for tool execution
- Ollama for models
- host-side `observer-output`
- local runtime state under `.observer-runtime`

## Priorities

1. Get Docker Desktop working with WSL2.
2. Get Ollama working locally.
3. Clone/copy this repo to the laptop.
4. Build the sandbox image.
5. Start Qdrant.
6. Start the observer.
7. Verify the sandbox and mounts before enabling real work.

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

Then start Qdrant and the observer from:

```powershell
cd e:\AI\claw
docker compose up -d qdrant

$env:QDRANT_URL="http://127.0.0.1:6333"
cd e:\AI\claw\openclaw-observer
node server.js
```

Then verify:

- `http://127.0.0.1:3220/api/runtime/status`
- `http://127.0.0.1:3220/api/runtime/options`
- sandbox container exists
- Ollama is reachable
- Qdrant is reachable at `http://127.0.0.1:6333/collections`

## What Must Be Updated

- host paths in `openclaw-observer/observer.config.json`
- any machine-specific mail secrets if they differ

Do not blindly migrate:

- old OpenClaw gateway state
- old `openclaw_state` assumptions
- old port `3210`
- old `openclaw-gw` container expectations

## What To Preserve

- observer UI
- Nova avatar and voice flow
- queue-driven work model
- Docker sandbox isolation
- host-backed `observer-output`
- host-backed `observer-input`
- prompt and memory scaffolding
- local mail handling

