#!/usr/bin/env bash
# openclaw-observer install script
# Usage: bash install.sh [--pm2]
#   --pm2   Install PM2 globally and start the server as a managed process

set -e

# ── helpers ──────────────────────────────────────────────────────────────────

info()  { echo "[install] $*"; }
warn()  { echo "[install] WARNING: $*" >&2; }
die()   { echo "[install] ERROR: $*" >&2; exit 1; }

USE_PM2=false
for arg in "$@"; do
  [[ "$arg" == "--pm2" ]] && USE_PM2=true
done

# ── Node.js version check ─────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  die "Node.js not found. Install Node.js 18+ from https://nodejs.org and re-run."
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if (( NODE_MAJOR < 18 )); then
  die "Node.js 18+ required (found v$(node --version | tr -d v)). Please upgrade."
fi
info "Node.js v$(node --version | tr -d v) OK"

# ── npm install ───────────────────────────────────────────────────────────────

info "Installing dependencies..."
npm install
info "Dependencies installed."

# ── default config ────────────────────────────────────────────────────────────

CONFIG="observer.config.json"
if [[ ! -f "$CONFIG" ]]; then
  info "Creating default $CONFIG..."
  cat > "$CONFIG" <<'EOF'
{
  "app": {
    "botName": "Agent"
  },
  "brains": {},
  "queue": {},
  "projects": {},
  "routing": {},
  "networks": {},
  "retrieval": {},
  "mail": {},
  "mounts": {}
}
EOF
  info "Created $CONFIG — edit it to configure your agent."
else
  info "$CONFIG already exists, skipping."
fi

# ── PM2 setup (optional) ──────────────────────────────────────────────────────

if $USE_PM2; then
  if ! command -v pm2 &>/dev/null; then
    info "Installing PM2 globally..."
    npm install -g pm2
  fi
  info "Starting server with PM2..."
  pm2 start ecosystem.config.cjs --env production
  pm2 save
  info "Server started. Useful commands:"
  info "  npm run logs      — tail logs"
  info "  npm run restart   — restart server"
  info "  npm run stop      — stop server"
  info ""
  info "To auto-start on boot, run: pm2 startup"
else
  info ""
  info "Done. To start the server:"
  info "  node server.js              — run directly"
  info "  npm run start:pm2           — run with PM2 (recommended)"
  info ""
  info "For PM2 setup in one step, re-run: bash install.sh --pm2"
fi
