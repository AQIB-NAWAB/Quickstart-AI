# Self-Hosted LiveKit SIP Server Stack

Deploy a standalone, self-hosted SIP server and media edge for QuickStart AI inbound voice calling.

This stack bundles:
- **Redis 7** (session state, rate-limiting, and SIP trunk coordination)
- **LiveKit Server** (`livekit/livekit-server`, room coordination and WebRTC edge)
- **LiveKit SIP** (`livekit/sip`, SIP protocol gateway, digest auth, RTP transceiver)

It connects directly to QuickStart's `@quickstart/service-voice` over HTTP webhooks and WebRTC room bridging, enabling operators to bring any SIP trunk, PBX, or carrier line without third-party cloud telephony dependencies.

---

## Architecture

```
                                 INBOUND CALL
                                      │
                                      ▼
                      Carrier / PBX / SBC / Softphone
                                      │
                   SIP (UDP/TCP 5060, TLS 5061)
                   RTP Audio (UDP 10000-20000)
                                      │
                                      ▼
             ┌──────────────────────────────────────────────────┐
             │            Host Networking Boundary              │
             │                                                  │
             │   ┌──────────────────────────────────────────┐   │
             │   │  livekit/sip                             │   │
             │   │  - Inbound trunk matching (E.164)        │   │
             │   │  - Source IP / CIDR allowlisting         │   │
             │   │  - SIP digest authentication             │   │
             │   │  - G.711 PCMU/PCMA codec negotiation     │   │
             │   │  - Bidirectional RTP <-> WebRTC Bridge   │   │
             │   └────────────────────┬─────────────────────┘   │
             │                        │ WebRTC + RPC            │
             │                        ▼                         │
             │   ┌──────────────────────────────────────────┐   │
             │   │  livekit/livekit-server                  │   │
             │   │  - Room: qs-call-<numberId>-<random>     │   │
             │   │  - Webhook dispatch                      │   │
             │   └────────────────────┬─────────────────────┘   │
             │                        │                         │
             │   ┌────────────────────┴─────────────────────┐   │
             │   │  Redis 7 (127.0.0.1:6379 only)           │   │
             │   └──────────────────────────────────────────┘   │
             └────────────────────────┬─────────────────────────┘
                                      │
                 Signed Room Webhooks (HTTPS POST)
                 room_started / participant_joined / participant_left
                                      │
                                      ▼
             ┌──────────────────────────────────────────────────┐
             │  voice-service (:3008)                           │
             │  - InboundMediaBridge joins room as participant  │
             │  - Realtime Cascade: Deepgram STT ->             │
             │    runtime-service (:3006) -> Catalog TTS        │
             │  - Call transcripts, audio waveforms & metrics   │
             └──────────────────────────────────────────────────┘
```

---

## Prerequisites

1. **Linux Virtual Machine / Bare Metal Server**:
   - Ubuntu 22.04 LTS / 24.04 LTS or Debian 12 recommended.
   - 2 vCPUs, 4 GB RAM minimum for ~25-50 concurrent calls.
   - Public static IPv4 address (SIP carrier trunks generally require IPv4).
   - *Note:* Docker Desktop on macOS/Windows does **not** support `network_mode: host`. Self-hosting requires native Linux.
2. **Docker & Docker Compose v2**:
   ```bash
   docker compose version  # v2.20+
   ```
3. **Public DNS Record**:
   - e.g., `sip.yourdomain.com` pointing to the public IP of the host.
4. **Public HTTPS URL for Voice Service**:
   - The SIP stack needs to send webhook events to `VOICE_PUBLIC_BASE_URL`.

---

## Firewall & Port Rules

Both `livekit` and `sip` run with `network_mode: host` to prevent NAT traversal issues and Docker bridge proxy bottlenecks. Configure your cloud firewall / security group as follows:

| Port | Protocol | Purpose | Access |
|---|---|---|---|
| **5060** | UDP + TCP | SIP Signalling (standard) | Public or Carrier IP ranges |
| **5061** | TCP | SIP over TLS (SIPS) | Public or Carrier IP ranges (optional) |
| **10000–20000** | UDP | SIP RTP media (audio) | Public or Carrier IP ranges |
| **7880** | TCP | LiveKit HTTP & WebSocket API | Public (or restricted to voice-service) |
| **7881** | TCP | LiveKit WebRTC TCP fallback | Public |
| **50000–60000** | UDP | LiveKit WebRTC media | Public |
| **6379** | TCP | Redis | **127.0.0.1 ONLY (Do NOT expose publicly)** |

> [!IMPORTANT]
> Because `network_mode: host` binds directly to host interfaces, Redis is configured in `docker-compose.yml` to publish only on `127.0.0.1:6379`. Verify with `ss -tulpn | grep 6379` that Redis is never listening on `0.0.0.0`.

---

## Quickstart Deployment

### 1. Configure Environment
```bash
cd deploy/sip
cp .env.example .env
```
Edit `.env`:
- `SIP_HOST`: Public IP or FQDN of this host (e.g. `sip.example.com` or `203.0.113.10`).
- `VOICE_PUBLIC_BASE_URL`: Public HTTPS endpoint of your voice-service (e.g. `https://api.yourdomain.com`).
- `LIVEKIT_URL`: URL voice-service uses to reach LiveKit (e.g. `ws://127.0.0.1:7880` if co-located, or `wss://sip.example.com:7880`).

### 2. Generate Credentials and Configs
Run the idempotent config generator:
```bash
./render-config.sh
```
This script will:
- Auto-generate secure `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` if not already present.
- Create `config/livekit.yaml` and `config/sip.yaml` with mode `0600`.
- Print the exact environment variables needed by `voice-service`.

### 3. Start the Stack
```bash
docker compose up -d --wait
```
Or from the root of the project:
```bash
make sip-up
```

### 4. Verify SIP Reachability
Run the SIP OPTIONS probe script from any computer to ensure SIP packets reach the edge:
```bash
node scripts/check-sip-stack.mjs sip.example.com --port 5060 --transport udp
```
Or via Makefile:
```bash
SIP_HOST=sip.example.com make sip-check
```

---

## Configuring Voice Service

Update your `voice-service` environment with the block printed by `render-config.sh`:

```env
TELEPHONY_PROFILE=sip
TELEPHONY_REQUIRE_REAL=1
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=<generated-key>
LIVEKIT_API_SECRET=<generated-secret>
LIVEKIT_SIP_ENDPOINT=sip.example.com:5060
LIVEKIT_BRIDGE_ENABLED=1
VOICE_PUBLIC_BASE_URL=https://api.yourdomain.com
SIP_PUBLIC_PORT=5060
SIP_TRANSPORTS=udp,tcp
SIP_RTP_PORT_RANGE=10000-20000
```

Restart `voice-service`. Once restarted:
1. Open the QuickStart Staff Web App.
2. Navigate to **Voice** &rarr; **Numbers**.
3. The top banner will reflect **Self-hosted SIP** readiness.
4. Click **Connect your SIP trunk** to register numbers.

---

## Troubleshooting Guide

| Issue / Error | Cause | Remediation |
|---|---|---|
| **SIP 403 Forbidden** | Trunk authentication failed or incoming source IP is not in allowed list. | Check the source IP that your carrier is sending from. Add it in the UI under **Edit IPs** or verify digest username & password. |
| **SIP 404 Not Found** | The called number is not registered or format doesn't match. | LiveKit trunks match both `+E.164` and plain digits. Ensure the number registered in QuickStart matches the dialed DID in the SIP `To:` header. |
| **SIP 408 Request Timeout** | Firewall dropping incoming UDP/TCP packets on port 5060. | Verify cloud firewall security group permits 5060 UDP/TCP from carrier IPs. |
| **SIP 480 Temporarily Unavailable** | No agent assigned to number or capacity exceeded. | Assign an active agent to the phone number in Voice &rarr; Numbers. Ensure workspace inbound cap is not exceeded. |
| **SIP 486 Busy Here** | Global or workspace concurrent call cap exhausted. | Raise `VOICE_GLOBAL_INBOUND_CAP` or workspace cap in voice-service configuration. |
| **One-Way Audio (Caller can't hear AI)** | RTP ports blocked or NAT advertising private IP. | Ensure UDP ports `10000-20000` are open to the internet. Verify `use_external_ip: true` is set in `config/sip.yaml`. |
| **Calls ring indefinitely, no speech** | Webhook not reaching voice-service or bridge failed to start. | Verify `VOICE_PUBLIC_BASE_URL` is reachable from the LiveKit server container. Check voice-service logs for `livekit.bridge.start`. |

---

## Upgrades & Maintenance

- View logs in realtime:
  ```bash
  docker compose -f deploy/sip/docker-compose.yml logs -f
  # or: make sip-logs
  ```
- Stop the stack:
  ```bash
  docker compose -f deploy/sip/docker-compose.yml down
  # or: make sip-down
  ```
- To update image versions, edit `docker-compose.yml` or set `LIVEKIT_SERVER_IMAGE` / `SIP_IMAGE` in `.env`, then run `docker compose pull && docker compose up -d`.
