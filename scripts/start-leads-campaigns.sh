#!/usr/bin/env bash
# Low-RAM stack for Lead Generation, Campaigns, and Reachout Features
# Starts: Postgres & Valkey, identity (:3001), workspace (:3002), model-gateway (:3005),
#         lead (:3014), lead-generation (:3019), campaign (:3013), gateway (:3000), and apps/web (:3015)
# Auto-cleans up on Ctrl+C to immediately release RAM.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LOG_DIR="${QS_LOG_DIR:-/tmp/qs-leads-campaigns-stack}"
mkdir -p "$LOG_DIR" "$ROOT/.run"

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }

PIDS=()

cleanup() {
  printf '\n\033[1;33m[!] Stopping all services and freeing memory...\033[0m\n'
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  if [ -d "$LOG_DIR" ]; then
    for pidfile in "$LOG_DIR"/*.pid; do
      if [ -f "$pidfile" ]; then
        local p
        p=$(cat "$pidfile" 2>/dev/null || true)
        if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
          kill -9 "$p" 2>/dev/null || true
        fi
        rm -f "$pidfile"
      fi
    done
  fi

  docker compose stop postgres valkey >/dev/null 2>&1 || true
  printf '\033[1;32m[✓] All services and containers stopped. RAM is fully released.\033[0m\n'
}

trap cleanup EXIT INT TERM

start_svc() {
  local name="$1"
  local dir="$2"
  local port="$3"
  local pidfile="$LOG_DIR/${name}.pid"
  local logfile="$LOG_DIR/${name}.log"
  local entry="$ROOT/$dir/dist/index.js"

  if curl -sf "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
    echo "  ${name} already up on :${port}"
    return 0
  fi

  if [[ ! -f "$entry" ]]; then
    echo "  building ${name}…"
    pnpm --filter "$(jq -r .name "$ROOT/$dir/package.json")" build >>"$logfile" 2>&1 || true
  fi

  local env_args=(--env-file=.env)
  if [[ ("$name" == "lead-generation" || "$name" == "web-fetch") && -f "$ROOT/.env.leads" ]]; then
    env_args+=(--env-file=.env.leads)
  fi

  if [[ "$name" == "workspace" || "$name" == "campaign" ]]; then
    env KAFKA_BROKERS="" node "${env_args[@]}" "$entry" >>"$logfile" 2>&1 &
  else
    node "${env_args[@]}" "$entry" >>"$logfile" 2>&1 &
  fi

  local pid=$!
  echo "$pid" >"$pidfile"
  PIDS+=("$pid")
  echo "  started ${name} (pid $pid) on :${port}"

  for _ in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
      echo "  ${name} healthy on :${port}"
      return 0
    fi
    sleep 0.5
  done
  echo "  WARN: ${name} did not respond healthy on :${port} (see ${logfile})" >&2
}

bold "1) Low-RAM Data Plane (Postgres + Valkey only)"
if ! docker info >/dev/null 2>&1; then
  printf '\n\033[1;31m[!] Docker daemon is not running.\033[0m\n'
  echo "Please start Docker first by running: sudo systemctl start docker"
  exit 1
fi
docker compose up -d --wait postgres valkey

bold "2) Database Migrations"
export DATABASE_URL="${DATABASE_URL:-postgresql://quickstart:quickstart@localhost:5433/quickstart}"
pnpm --filter @quickstart/service-identity migrate || true
pnpm --filter @quickstart/service-workspace migrate || true
pnpm --filter @quickstart/service-secrets migrate || true
pnpm --filter @quickstart/service-lead migrate || true
pnpm --filter @quickstart/service-lead-generation migrate || true
pnpm --filter @quickstart/service-web-fetch migrate || true
pnpm --filter @quickstart/service-campaign migrate || true

bold "3) Starting Targeted Backend Services"
start_svc identity services/identity-service "${IDENTITY_PORT:-3001}"
start_svc workspace services/workspace-service "${WORKSPACE_PORT:-3002}"
start_svc secrets services/secrets-service "${SECRETS_PORT:-3011}"
start_svc model-gateway services/model-gateway "${MODEL_GATEWAY_PORT:-3005}"
start_svc web-fetch services/web-fetch-service "${WEB_FETCH_PORT:-3007}"
start_svc lead services/lead-service "${LEAD_PORT:-3014}"
start_svc lead-generation services/lead-generation-service "${LEAD_GENERATION_PORT:-3019}"
start_svc campaign services/campaign-service "${CAMPAIGN_PORT:-3013}"
start_svc gateway services/gateway-service "${GATEWAY_PORT:-3000}"

bold "4) Seed Demo Account"
node --env-file=.env scripts/seed-demo-account.mjs >/dev/null 2>&1 || true

bold "5) Starting Frontend (apps/web on port 3015)"
echo "--------------------------------------------------------"
echo "  Frontend URL:     http://localhost:3015"
echo "  Campaigns Hub:    http://localhost:3015/workspaces (navigate to Campaigns / Leads)"
echo "  Demo Account:     quickstart@gmail.com / password"
echo "  Auto-cleanup:     Press Ctrl+C to stop everything & free RAM"
echo "--------------------------------------------------------"
echo ""

# Free lingering port 3015 if any
if lsof -ti :3015 >/dev/null 2>&1; then
  fuser -k 3015/tcp 2>/dev/null || true
  sleep 1
fi

NODE_OPTIONS="--max-old-space-size=1536" PORT=3015 pnpm --filter @quickstart/web exec next dev -H 0.0.0.0 -p 3015 &
WEB_PID=$!
PIDS+=("$WEB_PID")

wait "$WEB_PID"
