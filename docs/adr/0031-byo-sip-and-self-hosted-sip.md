# ADR 0031: Bring-Your-Own SIP (BYO SIP) & Self-Hosted LiveKit SIP

- **Status:** Accepted
- **Date:** 2026-11-10
- **Amends:** [ADR 0023](0023-inbound-telnyx-livekit.md) (removes "LiveKit Cloud only" constraint)
- **Features:** 21C / 22 extension — carrier independence, on-prem PBX integration, data sovereignty

---

## Context

ADR 0023 introduced production inbound voice via platform-rented Telnyx phone numbers and LiveKit Cloud SIP. While this gave SaaS workspaces a turnkey click-to-buy experience, real-world enterprise deployments required:

1. **Carrier Independence (Bring Your Own Trunk / BYOC):** Customers already own phone numbers with carriers like Twilio Elastic SIP, Telnyx, Bandwidth, or localized international telcos, and want to keep their existing rate cards and DIDs.
2. **On-Premise / Cloud PBX Forwarding:** Enterprises use Asterisk, FreeSWITCH, Cisco CUCM, or Genesys to handle call queues and IVRs, forwarding specific options to QuickStart AI agents.
3. **Data Plane Sovereignty & Self-Hosting:** Regulated organizations require on-premise media handling where audio and SIP signalling terminate on their own virtual machines rather than third-party cloud edges.

---

## Decision

### 1. New Telephony Profile: `TELEPHONY_PROFILE=sip`
We add `sip` as a first-class profile in `voice-service`:
- LiveKit Cloud SIP or Self-Hosted LiveKit SIP is used for all inbound call ingress and media bridging.
- Telnyx platform purchasing is disabled (`DisabledTelnyxClient`), eliminating carrier account dependencies while keeping the UI clean and informative.
- Auto-profile selection: When LiveKit credentials are configured without Telnyx or Twilio keys, `sip` profile is selected automatically.

### 2. Self-Hosted LiveKit SIP Stack (`deploy/sip/`)
We deliver a complete, turn-key Docker Compose deployment for native Linux hosts:
- **`livekit/sip`**: Listens on UDP/TCP 5060 (and optional TLS 5061), negotiates G.711 PCMU/PCMA audio, and converts SIP RTP into WebRTC.
- **`livekit/livekit-server`**: Coordinates call rooms (`qs-call-<numberId>-<random>`) and dispatches signed webhooks to `voice-service`.
- **`redis:7-alpine`**: Maintains trunk registration and session persistence.
- **Host Networking**: Containers run with `network_mode: host` to eliminate Docker NAT bridge proxy bottlenecks and guarantee accurate external IP advertising in SIP SDP / ICE candidates.

### 3. Per-Number Inbound Trunks & Access Control
When an operator registers a BYO SIP number:
- A dedicated LiveKit inbound trunk is created with `numbers: ["+E.164", "E.164_without_plus"]`.
- An individual dispatch rule routes calls directly to `qs-call-<numberId>-`.
- **Access Control Enforcement**:
  - **Source IP / CIDR Allowlist**: Inbound INVITEs are filtered by source packet IP. Broad ranges (< /16 for IPv4, < /48 for IPv6) and hostnames are rejected at validation.
  - **SIP Digest Authentication**: 192-bit cryptographic passwords are generated for PBX authentication.
  - **Anti-Fraud Guard**: Trunks without an IP allowlist and without credentials ("open trunks") are rejected.

### 4. Zero-Storage Password Security
- The generated SIP trunk password is returned **strictly once** in the HTTP response of `POST /v1/workspaces/:id/voice/numbers/byo` and `POST /v1/workspaces/:id/voice/numbers/:id/sip/rotate-credentials`.
- QuickStart databases store only `{ allowed_addresses, auth_username, has_credentials: true }`. The plain password is never written to disk or database. Only the LiveKit SIP server retains the password for digest verification.

### 5. Multi-Tenant Protection
- Numbers are verified globally across workspaces. Once an E.164 number is claimed by a workspace, it cannot be registered by another tenant.
- Calls arriving without an assigned agent or when the workspace inbound cap is exhausted are immediately rejected with `SIP 480 Temporarily Unavailable` / `SIP 486 Busy Here`.

---

## Consequences

- Workspaces can connect any SIP-compliant PBX (Asterisk, FreeSWITCH) or carrier trunk without paying carrier markup fees.
- Eliminates hard dependency on LiveKit Cloud; platform can run entirely air-gapped or on sovereign infrastructure.
- One-way audio risks are eliminated by using host networking and automated IP advertising detection.
- Credential leaks are remediated instantly with zero-downtime password rotation.
