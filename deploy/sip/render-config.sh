#!/usr/bin/env bash
# Render config for the self-hosted SIP stack (idempotent).
#
#   deploy/sip/.env  --->  deploy/sip/config/livekit.yaml
#                          deploy/sip/config/sip.yaml
#
# * Creates .env from .env.example when missing.
# * Generates LIVEKIT_API_KEY / LIVEKIT_API_SECRET when empty and writes them back
#   to .env. Existing values are never rotated by this script.
# * Re-running only re-renders the YAML from .env.
# * Prints the voice-service env block to copy.
#
# Usage: ./render-config.sh [--detect-ip] [-h|--help]
# Env:   SIP_ENV_FILE=/path/to/.env      override the env file location
#        SIP_CONFIG_DIR=/path/to/config  override the output directory
#
# .env is parsed as plain KEY=VALUE lines (it is never sourced/executed).
# No quotes, no inline comments.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SIP_ENV_FILE:-$DIR/.env}"
CONFIG_DIR="${SIP_CONFIG_DIR:-$DIR/config}"
DETECT_FLAG=0

for arg in "$@"; do
  case "$arg" in
    --detect-ip) DETECT_FLAG=1 ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

die() { echo "render-config: error: $*" >&2; exit 1; }
warn() { echo "render-config: warning: $*" >&2; }

# ---- .env helpers -----------------------------------------------------------
get() { # get KEY [DEFAULT]
  local v
  v="$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  v="${v%$'\r'}"
  v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
  if [ -z "$v" ]; then printf '%s' "${2-}"; else printf '%s' "$v"; fi
}

set_env() { # set_env KEY VALUE  (in-place, keeps file mode)
  local tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  if grep -qE "^$1=" "$ENV_FILE"; then
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_FILE" >"$tmp"
  else
    cat "$ENV_FILE" >"$tmp"; printf '%s=%s\n' "$1" "$2" >>"$tmp"
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

rand_hex() { # rand_hex BYTES
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"
  else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

need_re() { # need_re NAME VALUE REGEX DESCRIPTION
  [[ "$2" =~ $3 ]] || die "$1='$2' is invalid ($4)"
}

umask 077

# ---- load / create .env -----------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  [ -f "$DIR/.env.example" ] || die "$DIR/.env.example not found"
  cp "$DIR/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "created $ENV_FILE from .env.example"
fi
chmod 600 "$ENV_FILE"

# ---- credentials ------------------------------------------------------------
API_KEY="$(get LIVEKIT_API_KEY)"
API_SECRET="$(get LIVEKIT_API_SECRET)"
if [ -z "$API_KEY" ]; then
  API_KEY="qs$(rand_hex 8)"
  set_env LIVEKIT_API_KEY "$API_KEY"
  echo "generated LIVEKIT_API_KEY (saved to $ENV_FILE)"
fi
if [ -z "$API_SECRET" ]; then
  API_SECRET="$(rand_hex 24)"   # 48 hex chars
  set_env LIVEKIT_API_SECRET "$API_SECRET"
  echo "generated LIVEKIT_API_SECRET (saved to $ENV_FILE)"
fi
need_re LIVEKIT_API_KEY "$API_KEY" '^[A-Za-z0-9_-]{3,64}$' 'letters, digits, _ and - only'
need_re LIVEKIT_API_SECRET "$API_SECRET" '^[A-Za-z0-9_-]{32,128}$' 'at least 32 chars; letters, digits, _ and - only'

# ---- settings ---------------------------------------------------------------
SIP_HOST="$(get SIP_HOST)"
PUBLIC_IP="$(get PUBLIC_IP)"
SIP_PORT="$(get SIP_PORT 5060)"
SIP_TLS_PORT="$(get SIP_TLS_PORT)"
SIP_CERTS_DIR="$(get SIP_CERTS_DIR ./certs)"
SIP_TLS_CERT_FILE="$(get SIP_TLS_CERT_FILE /certs/fullchain.pem)"
SIP_TLS_KEY_FILE="$(get SIP_TLS_KEY_FILE /certs/privkey.pem)"
RTP_PORT_RANGE="$(get RTP_PORT_RANGE 10000-20000)"
SIP_HEALTH_PORT="$(get SIP_HEALTH_PORT 8081)"
SIP_LOG_LEVEL="$(get SIP_LOG_LEVEL info)"
LK_PORT="$(get LIVEKIT_PORT 7880)"
LK_TCP_PORT="$(get LIVEKIT_RTC_TCP_PORT 7881)"
LK_RTC_RANGE="$(get LIVEKIT_RTC_PORT_RANGE 50000-60000)"
LK_LOG_LEVEL="$(get LIVEKIT_LOG_LEVEL info)"
LK_PUBLIC_URL="$(get LIVEKIT_PUBLIC_URL)"
WEBHOOK_BASE="$(get VOICE_PUBLIC_BASE_URL)"
REDIS_PORT="$(get REDIS_PORT 6379)"
DETECT="$(get DETECT_PUBLIC_IP 0)"
[ "$DETECT_FLAG" = 1 ] && DETECT=1

PORT_RE='^[0-9]{2,5}$'
RANGE_RE='^[0-9]{2,5}-[0-9]{2,5}$'
HOST_RE='^([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$'
IPV4_RE='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
LEVEL_RE='^(debug|info|warn|error)$'
need_re SIP_PORT "$SIP_PORT" "$PORT_RE" 'port number'
[ -z "$SIP_TLS_PORT" ] || need_re SIP_TLS_PORT "$SIP_TLS_PORT" "$PORT_RE" 'port number or empty'
need_re RTP_PORT_RANGE "$RTP_PORT_RANGE" "$RANGE_RE" 'START-END'
need_re LIVEKIT_RTC_PORT_RANGE "$LK_RTC_RANGE" "$RANGE_RE" 'START-END'
need_re SIP_HEALTH_PORT "$SIP_HEALTH_PORT" "$PORT_RE" 'port number'
need_re LIVEKIT_PORT "$LK_PORT" "$PORT_RE" 'port number'
need_re LIVEKIT_RTC_TCP_PORT "$LK_TCP_PORT" "$PORT_RE" 'port number'
need_re REDIS_PORT "$REDIS_PORT" "$PORT_RE" 'port number'
need_re SIP_LOG_LEVEL "$SIP_LOG_LEVEL" "$LEVEL_RE" 'debug|info|warn|error'
need_re LIVEKIT_LOG_LEVEL "$LK_LOG_LEVEL" "$LEVEL_RE" 'debug|info|warn|error'
[ -z "$SIP_HOST" ] || need_re SIP_HOST "$SIP_HOST" "$HOST_RE" 'DNS name or IPv4, no port'
if [ -n "$PUBLIC_IP" ]; then
  need_re PUBLIC_IP "$PUBLIC_IP" "$IPV4_RE" 'IPv4 address'
fi
[ -z "$LK_PUBLIC_URL" ] || need_re LIVEKIT_PUBLIC_URL "$LK_PUBLIC_URL" '^wss?://[A-Za-z0-9.:_-]+(/[A-Za-z0-9._~/-]*)?$' 'ws:// or wss:// URL'
if [ -n "$WEBHOOK_BASE" ]; then
  WEBHOOK_BASE="${WEBHOOK_BASE%/}"
  need_re VOICE_PUBLIC_BASE_URL "$WEBHOOK_BASE" '^https?://[A-Za-z0-9.:_-]+(/[A-Za-z0-9._~/-]*)?$' 'public http(s) URL without query/spaces'
  case "$WEBHOOK_BASE" in http://*) warn "VOICE_PUBLIC_BASE_URL is plain http; use https in production" ;; esac
fi

range_start() { echo "${1%-*}"; }
range_end() { echo "${1#*-}"; }
[ "$(range_start "$RTP_PORT_RANGE")" -lt "$(range_end "$RTP_PORT_RANGE")" ] || die "RTP_PORT_RANGE start must be below end"
[ "$(range_start "$LK_RTC_RANGE")" -lt "$(range_end "$LK_RTC_RANGE")" ] || die "LIVEKIT_RTC_PORT_RANGE start must be below end"
if [ "$(range_start "$RTP_PORT_RANGE")" -le "$(range_end "$LK_RTC_RANGE")" ] && [ "$(range_start "$LK_RTC_RANGE")" -le "$(range_end "$RTP_PORT_RANGE")" ]; then
  die "RTP_PORT_RANGE and LIVEKIT_RTC_PORT_RANGE overlap"
fi

# ---- public IP (informational unless PUBLIC_IP is set) ------------------------
DETECTED_IP=""
if [ -z "$PUBLIC_IP" ] && [ "$DETECT" = 1 ]; then
  for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip="$(curl -fsS -m 5 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ "$ip" =~ $IPV4_RE ]]; then DETECTED_IP="$ip"; break; fi
  done
  if [ -n "$DETECTED_IP" ]; then
    echo "detected public IP: $DETECTED_IP (informational; set PUBLIC_IP=$DETECTED_IP in .env to pin it)"
  else
    warn "could not detect the public IP; set PUBLIC_IP manually if STUN discovery is wrong"
  fi
fi

# ---- TLS --------------------------------------------------------------------
if [ -n "$SIP_TLS_PORT" ]; then
  need_re SIP_TLS_CERT_FILE "$SIP_TLS_CERT_FILE" '^/certs/[A-Za-z0-9._/-]+$' 'path under /certs (container path)'
  need_re SIP_TLS_KEY_FILE "$SIP_TLS_KEY_FILE" '^/certs/[A-Za-z0-9._/-]+$' 'path under /certs (container path)'
  case "$SIP_CERTS_DIR" in /*) host_certs="$SIP_CERTS_DIR" ;; *) host_certs="$DIR/$SIP_CERTS_DIR" ;; esac
  for f in "$SIP_TLS_CERT_FILE" "$SIP_TLS_KEY_FILE"; do
    [ -f "$host_certs/${f#/certs/}" ] || warn "TLS file $host_certs/${f#/certs/} not found yet; sip will not start until it exists"
  done
fi

# ---- render -----------------------------------------------------------------
mkdir -p "$CONFIG_DIR"
write_file() { # write_file PATH  (content on stdin)
  local tmp
  tmp="$(mktemp "$1.XXXXXX")"
  cat >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$1"
}

if [ -n "$PUBLIC_IP" ]; then
  LK_IP_LINES="  node_ip: $PUBLIC_IP
  use_external_ip: false"
  SIP_IP_LINES="nat_1_to_1_ip: $PUBLIC_IP"
else
  LK_IP_LINES="  use_external_ip: true"
  SIP_IP_LINES="use_external_ip: true"
fi

if [ -n "$WEBHOOK_BASE" ]; then
  WEBHOOK_BLOCK="webhook:
  api_key: $API_KEY
  urls:
    - $WEBHOOK_BASE/voice/telephony/livekit/webhook"
else
  WEBHOOK_BLOCK="# webhook: not rendered because VOICE_PUBLIC_BASE_URL is empty.
# Without it the bridge never learns about calls. Set it and re-run render-config.sh."
  warn "VOICE_PUBLIC_BASE_URL is empty: no webhook configured, inbound calls will not reach the bridge"
fi

write_file "$CONFIG_DIR/livekit.yaml" <<EOF
# GENERATED by deploy/sip/render-config.sh from .env. Do not edit; do not commit.
# Contains the API secret.
port: $LK_PORT
log_level: $LK_LOG_LEVEL
rtc:
  tcp_port: $LK_TCP_PORT
  port_range_start: $(range_start "$LK_RTC_RANGE")
  port_range_end: $(range_end "$LK_RTC_RANGE")
$LK_IP_LINES
redis:
  address: 127.0.0.1:$REDIS_PORT
keys:
  $API_KEY: $API_SECRET
$WEBHOOK_BLOCK
EOF

if [ -n "$SIP_TLS_PORT" ]; then
  TLS_BLOCK="tls:
  port: $SIP_TLS_PORT
  certs:
    - cert_file: $SIP_TLS_CERT_FILE
      key_file: $SIP_TLS_KEY_FILE"
else
  TLS_BLOCK="# tls: disabled (SIP_TLS_PORT is empty)"
fi

write_file "$CONFIG_DIR/sip.yaml" <<EOF
# GENERATED by deploy/sip/render-config.sh from .env. Do not edit; do not commit.
# Contains the API secret.
api_key: $API_KEY
api_secret: $API_SECRET
ws_url: ws://127.0.0.1:$LK_PORT
redis:
  address: 127.0.0.1:$REDIS_PORT
sip_port: $SIP_PORT
rtp_port: $RTP_PORT_RANGE
$SIP_IP_LINES
health_port: $SIP_HEALTH_PORT
logging:
  level: $SIP_LOG_LEVEL
$TLS_BLOCK
EOF

echo "rendered $CONFIG_DIR/livekit.yaml and $CONFIG_DIR/sip.yaml (mode 600)"

# ---- voice-service env block --------------------------------------------------
SHOWN_IP="${PUBLIC_IP:-$DETECTED_IP}"
ENDPOINT_HOST="${SIP_HOST:-$SHOWN_IP}"
if [ -z "$ENDPOINT_HOST" ]; then
  ENDPOINT="<set SIP_HOST in .env>"
elif [ "$SIP_PORT" != 5060 ]; then
  ENDPOINT="$ENDPOINT_HOST:$SIP_PORT"
else
  ENDPOINT="$ENDPOINT_HOST"
fi
TRANSPORTS="udp,tcp"; [ -z "$SIP_TLS_PORT" ] || TRANSPORTS="udp,tcp,tls"

cat <<EOF

# ---- voice-service environment (copy into its env / secret store) -----------
# Contains LIVEKIT_API_SECRET: treat this output as a secret.
TELEPHONY_PROFILE=sip
TELEPHONY_REQUIRE_REAL=1
LIVEKIT_URL=${LK_PUBLIC_URL:-ws://127.0.0.1:$LK_PORT}
LIVEKIT_API_KEY=$API_KEY
LIVEKIT_API_SECRET=$API_SECRET
LIVEKIT_SIP_ENDPOINT=$ENDPOINT
LIVEKIT_BRIDGE_ENABLED=1
VOICE_PUBLIC_BASE_URL=${WEBHOOK_BASE:-<public https URL of voice-service>}
SIP_PUBLIC_PORT=$SIP_PORT
EOF
[ -z "$SIP_TLS_PORT" ] || echo "SIP_TLS_PORT=$SIP_TLS_PORT"
cat <<EOF
SIP_TRANSPORTS=$TRANSPORTS
SIP_RTP_PORT_RANGE=$RTP_PORT_RANGE
EOF
[ -z "$SHOWN_IP" ] || echo "SIP_PUBLIC_IPS=$SHOWN_IP"
cat <<EOF
# ---- end ----------------------------------------------------------------------

next: docker compose -f deploy/sip/docker-compose.yml up -d --wait   (or: make sip-up)
EOF
