#!/usr/bin/env bash
# Start data plane + core platform services in the background for local demo.
# Uses `node --env-file=.env` so JSON env values (e.g. ACQUISITION_PROVIDER_PROFILES_JSON)
# are not mangled by bash `source`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LOG_DIR="${QS_LOG_DIR:-/tmp/qs-stack}"
mkdir -p "$LOG_DIR" "$ROOT/.run"

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# name dir port
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

  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "  ${name} process alive (pid $(cat "$pidfile")) — waiting for healthz"
  else
    nohup node --env-file=.env "$entry" >>"$logfile" 2>&1 &
    echo $! >"$pidfile"
    echo "  started ${name} (pid $!) → ${logfile}"
  fi

  for _ in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
      echo "  ${name} healthy on :${port}"
      return 0
    fi
    sleep 0.5
  done
  echo "  WARN: ${name} did not become healthy on :${port} (see ${logfile})" >&2
  return 0
}

# Lead-generation needs LEAD_GENERATION_ADMIN_TOKEN (often only in .env.leads).
start_lead_generation() {
  local name="lead-generation"
  local port="${LEAD_GENERATION_PORT:-3019}"
  local pidfile="$LOG_DIR/${name}.pid"
  local logfile="$LOG_DIR/${name}.log"
  local entry="$ROOT/services/lead-generation-service/dist/index.js"
  local env_args=(--env-file=.env)
  if [[ -f "$ROOT/.env.leads" ]]; then
    env_args+=(--env-file=.env.leads)
  fi

  if curl -sf "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
    echo "  ${name} already up on :${port}"
    return 0
  fi
  if [[ ! -f "$entry" ]]; then
    echo "  building ${name}…"
    pnpm --filter @quickstart/service-lead-generation build >>"$logfile" 2>&1 || true
  fi
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "  ${name} process alive (pid $(cat "$pidfile")) — waiting for healthz"
  else
    nohup node "${env_args[@]}" "$entry" >>"$logfile" 2>&1 &
    echo $! >"$pidfile"
    echo "  started ${name} (pid $!) → ${logfile}"
  fi
  for _ in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
      echo "  ${name} healthy on :${port}"
      return 0
    fi
    sleep 0.5
  done
  echo "  WARN: ${name} did not become healthy on :${port} (see ${logfile})" >&2
  return 0
}

bold "1) Data plane"
docker compose up -d --wait

bold "2) Migrations (shared Postgres)"
pnpm --filter @quickstart/contracts build
export DATABASE_URL="${DATABASE_URL:-postgresql://quickstart:quickstart@localhost:5433/quickstart}"
make migrate-all || true

bold "3) Start services"
start_svc identity services/identity-service "${IDENTITY_PORT:-3001}"
start_svc workspace services/workspace-service "${WORKSPACE_PORT:-3002}"
start_svc agent services/agent-service "${AGENT_PORT:-3003}"
start_svc conversation services/conversation-service "${CONVERSATION_PORT:-3004}"
start_svc model-gateway services/model-gateway "${MODEL_GATEWAY_PORT:-3005}"
start_svc runtime services/runtime-service "${RUNTIME_PORT:-3006}"
start_svc web-fetch services/web-fetch-service "${WEB_FETCH_PORT:-3007}"
start_svc voice services/voice-service "${VOICE_PORT:-3008}"
start_svc knowledge services/knowledge-service "${KNOWLEDGE_PORT:-3009}"
start_svc memory services/memory-service "${MEMORY_PORT:-3010}"
start_svc secrets services/secrets-service "${SECRETS_PORT:-3011}"
start_svc workflow services/workflow-service "${WORKFLOW_PORT:-3012}"
start_svc campaign services/campaign-service "${CAMPAIGN_PORT:-3013}"
start_svc lead services/lead-service "${LEAD_PORT:-3014}"
start_svc eval services/eval-service "${EVAL_PORT:-3016}"
start_svc usage services/usage-service "${USAGE_PORT:-3017}"
start_svc audit services/audit-service "${AUDIT_PORT:-3018}"
# Lead-generation uses :3019 (workflow owns :3012). Merge .env.leads when present.
start_lead_generation
start_svc gateway services/gateway-service "${GATEWAY_PORT:-3000}"

bold "4) Staff web (optional)"
if curl -sf "http://127.0.0.1:3015" >/dev/null 2>&1 || curl -sf "http://127.0.0.1:3015/login" >/dev/null 2>&1; then
  echo "  web already up on :3015"
else
  # apps/web defaults to 3005 in package.json; force 3015 (staff web) for local stack.
  # Force NODE_ENV=development: `next dev` keeps an inherited NODE_ENV=production,
  # which disables eval in the middleware sandbox and crashes every page render.
  nohup env NODE_ENV=development PORT=3015 pnpm --filter @quickstart/web exec next dev -H 0.0.0.0 -p 3015 >>"$LOG_DIR/web.log" 2>&1 &
  echo $! >"$LOG_DIR/web.pid"
  echo "  started web (pid $!) → $LOG_DIR/web.log"
fi

bold "Done"
echo "Gateway:  http://127.0.0.1:3000/healthz"
echo "Staff UI: http://127.0.0.1:3015"
echo "Logs:     $LOG_DIR"
echo "Seed:     pnpm seed:demo"
