# Local AI Home Assistant Installation

## What Was Installed

- Repository: `doctarock/local-ai-home-assistant`
- Node dependencies in `observer/node_modules`
- Qdrant Docker service from `docker-compose.yml`
- Observer UI running at `http://127.0.0.1:3220`

## Requirements

- Node.js 18 or newer. This machine is using Node `v24.14.0`.
- npm. On Windows PowerShell, use `npm.cmd` if `npm.ps1` is blocked by execution policy.
- Docker Desktop, running Linux containers.
- Optional: Ollama at `http://127.0.0.1:11434` with the models named in `observer/observer.config.json`.

## Install From Scratch

From the folder where you want the project:

```powershell
Invoke-WebRequest -Uri https://github.com/doctarock/local-ai-home-assistant/archive/refs/heads/main.zip -OutFile local-ai-home-assistant-main.zip
Expand-Archive -Path local-ai-home-assistant-main.zip -DestinationPath . -Force
cd .\local-ai-home-assistant-main
```

Install the observer dependencies:

```powershell
cd .\observer
npm.cmd install
```

If `npm install` works in your shell, that is fine too. `npm.cmd` avoids PowerShell execution-policy blocking of `npm.ps1`.

## Start Services

Start Qdrant from the repository root:

```powershell
cd [working directory]
docker compose up -d qdrant
```

Start the observer:

```powershell
cd [working directory]\observer
$env:QDRANT_URL = "http://127.0.0.1:6333"
node server.js
```

Open:

```text
http://127.0.0.1:3220
```

The observer defaults are:

- UI port: `3220`, controlled by `PORT`
- Qdrant URL: `http://127.0.0.1:6333`, controlled by `QDRANT_URL`
- Qdrant collection: `observer_chunks`, controlled by `QDRANT_COLLECTION`
- Local Ollama endpoint: `http://127.0.0.1:11434`, configured in `observer/observer.config.json`

## Background Run On Windows

To run the observer in the background and write logs beside the app:

```powershell
Start-Process -FilePath node `
  -ArgumentList 'server.js' `
  -WorkingDirectory '[working directory]' `
  -RedirectStandardOutput '[working directory]\observer\observer.out.log' `
  -RedirectStandardError '[working directory]\observer\observer.err.log' `
  -WindowStyle Hidden
```

Check it:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3220/
docker ps --filter name=nova-qdrant
```

Stop it:

```powershell
Get-Process node | Stop-Process
docker compose down
```

If you run other Node apps, stop only the observer process rather than every `node` process.

## Optional Ollama Setup

The app can open without Ollama, but model-backed actions expect Ollama endpoints and models to be available. The default local endpoint is:

```text
http://127.0.0.1:11434
```

The default config references models such as:

- `gemma4:e4b`
- `gemma4:26b`
- `gemma3:1b`

Install or edit these in `observer/observer.config.json` to match your local Ollama setup.

