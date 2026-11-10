# Bring Your Own SIP Server / Trunk (BYO SIP)

Connect your existing PBX, SIP carrier trunk, or SBC directly to QuickStart AI. Inbound phone calls are received by LiveKit SIP, routed to the assigned workspace agent, and handled in real time with conversational AI.

---

## Overview

When you register a BYO SIP number:
1. QuickStart provisions a dedicated **SIP Inbound Trunk** and **Dispatch Rule** on the LiveKit SIP edge.
2. The trunk matches dialed numbers in both `+E.164` format (e.g., `+14155550123`) and national/plain digit format (e.g., `14155550123`).
3. Access controls protect your line against toll fraud and unauthorized traffic:
   - **Source IP / CIDR allowlisting** (rejects traffic outside your carrier's media gateway IPs).
   - **SIP digest authentication** (username & password challenge).
   - Open trunks (no IP restriction and no password) are strictly rejected.

---

## Scenario A: Carrier SIP Trunking (Twilio, Telnyx, Bandwidth)

### 1. Twilio Elastic SIP Trunking

1. Log in to the **Twilio Console** &rarr; **Voice** &rarr; **Trunks**.
2. Select your trunk (or create one) and navigate to **Origination**:
   - **Origination SIP URI**:
     ```
     sip:+14155550123@<YOUR_SIP_HOST>:5060;transport=udp
     ```
     *(Replace `+14155550123` with your Twilio DID and `<YOUR_SIP_HOST>` with your server FQDN or IP).*
   - **Priority**: `10`, **Weight**: `10`.
3. In QuickStart AI:
   - Open **Voice** &rarr; **Numbers** &rarr; **Connect your SIP trunk**.
   - Enter your Twilio phone number: `+14155550123`.
   - In **Allowed source IPs / CIDRs**, enter Twilio's North American Origination IP ranges:
     ```text
     54.172.60.0/23
     54.244.51.0/24
     177.71.206.192/26
     ```
   - (Optional) Enable SIP Digest credentials if you have configured SIP Credentials on the Twilio termination side.
   - Click **Register trunk**.
4. Test by calling your Twilio number from any mobile phone.

---

### 2. Telnyx SIP Connection

1. Log in to **Telnyx Mission Control Portal** &rarr; **Voice** &rarr; **SIP Connections**.
2. Create or edit a connection:
   - **Connection Type**: `FQDN`.
   - **FQDN**: `<YOUR_SIP_HOST>:5060`.
   - **Transport**: `UDP` or `TCP`.
3. Assign your Telnyx phone numbers to this connection under **Numbers** &rarr; **My Numbers**.
4. In QuickStart AI:
   - Add the Telnyx signalling IP subnets in **Allowed source IPs**:
     ```text
     192.76.120.0/22
     64.16.224.0/20
     ```
   - Register the phone number and assign your agent.

---

## Scenario B: On-Premise or Cloud PBX (Asterisk, FreeSWITCH)

### 1. Asterisk (PJSIP)

To forward incoming calls from an existing Asterisk PBX to QuickStart AI:

Add an endpoint and transport in `/etc/asterisk/pjsip.conf`:

```ini
; Transport (if not already defined)
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060

; Outbound Endpoint towards QuickStart SIP Edge
[quickstart-ai]
type=endpoint
transport=transport-udp
context=from-internal
disallow=all
allow=ulaw,alaw
aors=quickstart-aor
outbound_auth=quickstart-auth

[quickstart-auth]
type=auth
auth_type=userpass
username=qs_username_from_quickstart
password=generated_password_from_quickstart

[quickstart-aor]
type=aor
contact=sip:<YOUR_SIP_HOST>:5060
```

In `/etc/asterisk/extensions.conf`, route incoming calls to QuickStart:

```ini
[inbound-dids]
; Route incoming calls for +14155550123 to QuickStart agent
exten => +14155550123,1,NoOp(Forwarding to QuickStart AI Agent)
 same => n,Dial(PJSIP/+14155550123@quickstart-ai,60)
 same => n,Hangup()
```

---

### 2. FreeSWITCH

Create an outbound gateway in `/etc/freeswitch/directory/external/quickstart.xml`:

```xml
<include>
  <gateway name="quickstart-ai">
    <param name="realm" value="<YOUR_SIP_HOST>:5060"/>
    <param name="username" value="qs_username_from_quickstart"/>
    <param name="password" value="generated_password_from_quickstart"/>
    <param name="register" value="false"/>
    <param name="caller-id-in-from" value="true"/>
  </gateway>
</include>
```

In your FreeSWITCH dialplan (`/etc/freeswitch/dialplan/default.xml`):

```xml
<extension name="forward_to_quickstart">
  <condition field="destination_number" expression="^\+?1?(4155550123)$">
    <action application="bridge" data="sofia/gateway/quickstart-ai/+14155550123"/>
  </condition>
</extension>
```

---

## Scenario C: Registering via QuickStart API (cURL)

You can automate SIP trunk provisioning through the QuickStart REST API.

### 1. Register a BYO Number
```bash
curl -X POST https://api.yourdomain.com/v1/workspaces/$WORKSPACE_ID/voice/numbers/byo \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "e164": "+14155550123",
    "friendly_name": "Main Office PBX",
    "agent_id": "00000000-0000-0000-0000-000000000001",
    "allowed_addresses": ["203.0.113.10", "198.51.100.0/24"],
    "generate_credentials": true
  }'
```

**Response (201 Created):**
```json
{
  "number": {
    "id": "12ac6d43-3b80-4803-8022-c7ac47d32a78",
    "phone_number": "+14155550123",
    "provider": "byo_sip",
    "status": "active",
    "assigned_agent_id": "00000000-0000-0000-0000-000000000001",
    "sip": {
      "allowed_addresses": ["203.0.113.10", "198.51.100.0/24"],
      "auth_username": "qs_a1b2c3d4e5",
      "has_credentials": true
    }
  },
  "connection": {
    "host": "sip.yourdomain.com",
    "port": 5060,
    "tls_port": 5061,
    "transports": ["udp", "tcp", "tls"],
    "sip_uri": "sip:+14155550123@sip.yourdomain.com:5060",
    "accepted_number_formats": ["+14155550123", "14155550123"],
    "allowed_addresses": ["203.0.113.10", "198.51.100.0/24"],
    "auth_username": "qs_a1b2c3d4e5",
    "auth_password": "sec_EXAMPLE_ONE_TIME_PASSWORD_3f8a",
    "codecs": ["PCMU", "PCMA"],
    "dtmf": "rfc2833",
    "rtp_port_range": "10000-20000"
  }
}
```
> [!CAUTION]
> The `auth_password` is returned **exactly once** in this response. Store it in your PBX or secret manager immediately.

---

### 2. View Connection Details
```bash
curl https://api.yourdomain.com/v1/workspaces/$WORKSPACE_ID/voice/numbers/$NUMBER_ID/sip \
  -H "Authorization: Bearer $STAFF_TOKEN"
```
*(Returns identical connection parameters with `auth_password` omitted).*

---

### 3. Rotate Credentials
If credentials are leaked or need periodic rotation:
```bash
curl -X POST https://api.yourdomain.com/v1/workspaces/$WORKSPACE_ID/voice/numbers/$NUMBER_ID/sip/rotate-credentials \
  -H "Authorization: Bearer $STAFF_TOKEN"
```
*(Returns a fresh `auth_password` and immediately updates the LiveKit SIP trunk).*

---

### 4. Update Allowed IP Addresses
```bash
curl -X PATCH https://api.yourdomain.com/v1/workspaces/$WORKSPACE_ID/voice/numbers/$NUMBER_ID \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "allowed_addresses": ["203.0.113.10", "203.0.113.20"]
  }'
```

---

### 5. Remove Number
```bash
curl -X DELETE https://api.yourdomain.com/v1/workspaces/$WORKSPACE_ID/voice/numbers/$NUMBER_ID \
  -H "Authorization: Bearer $STAFF_TOKEN"
```
*(Removes the trunk from LiveKit and deletes the database record).*

---

## Testing with a Softphone (Linphone / Zoiper)

1. Open your SIP softphone (e.g. Linphone).
2. Set Account credentials:
   - **Username**: `qs_username` (from registration)
   - **Domain / Proxy**: `<YOUR_SIP_HOST>:5060;transport=udp`
   - **Password**: `auth_password` (from registration)
3. Dial `sip:+14155550123@<YOUR_SIP_HOST>:5060`.
4. Your QuickStart AI agent will answer and speak the initial greeting.
