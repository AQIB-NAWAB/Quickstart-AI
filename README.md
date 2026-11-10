# QuickStart AI

QuickStart AI is a **multi-tenant platform for building, deploying, and operating AI agents** for real businesses. A workspace configures agents with instructions, models, tools, and knowledge; those agents then serve customers on the **website widget**, in the **staff inbox** (chat and voice), through **outbound campaigns**, and via **automated lead generation** that finds and qualifies prospects before humans follow up.

We are building this as a **production engineering system**, not a demo chatbot: tenant isolation, evidence-backed lead research, idempotent APIs, fair job scheduling, and observability are first-class from the start. The long-form product and scale targets live in [docs/project_details.md](docs/project_details.md).

## What you get today

| Area                      | What it does                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agents**                | Create and publish workspace agents (instructions, channels, tools).                                                                           |
| **Conversations & inbox** | Staff handle visitor threads, live voice, and handoff.                                                                                         |
| **Embeddable widget**     | Publishable-key chat (and voice paths) on customer sites.                                                                                      |
| **Lead generation**       | Business profile research, category/location runs, accepted leads with evidence.                                                               |
| **Campaigns**             | Audience from CSV or an accepted lead-gen run; voice campaigns when telephony is connected; audience-only campaigns without dial requirements. |
| **Gateway**               | Public API, widget routes, and service proxy behind one edge.                                                                                  |

Staff UI runs in `apps/web` (Next.js). Domain logic lives in `services/*`; shared contracts and libraries live in `packages/*`.

## Who this is for

- **Operators** — run agents, inbox, campaigns, and lead runs in one workspace.
- **Engineers** — extend services, contracts, and the widget without breaking tenant boundaries.
- **Integrators** — embed the widget, ingest leads into campaigns, and wire telephony when ready.

## Documentation

- **Product & scale:** [docs/project_details.md](docs/project_details.md)
- **60-day execution plan:** [docs/roadmap.md](docs/roadmap.md)
- **Deep dives (identity, data plane, widget):** [docs/ai-roadmap.md](docs/ai-roadmap.md)
- **ADRs:** [docs/adr/](docs/adr/)
- **Lead generation:** [services/lead-generation-service/README.md](services/lead-generation-service/README.md), [docs/lead-generation.md](docs/lead-generation.md)
- **Gateway & APIs:** [docs/api/README.md](docs/api/README.md)
- **Inbound Calling & SIP Server:** [deploy/sip/README.md](deploy/sip/README.md), [deploy/sip/BYO-SIP.md](deploy/sip/BYO-SIP.md), [docs/runbooks/inbound-calling.md](docs/runbooks/inbound-calling.md)

## Repository layout

```text
apps/web/       Staff app, marketing site, widget bundle (quickstart-widget.js)
services/       Identity, workspace, gateway, agent, conversation, voice, campaign, lead-gen, …
packages/       contracts, auth, errors, logging, utilities, …
fixtures/       Widget demo host page and local test assets
docs/           Spec, roadmap, ADRs, runbooks
```

## Prerequisites

- Node.js **22+**
- [pnpm](https://pnpm.io/) **9+**
- **Docker & Docker Compose v2** (running daemon)

## Quickstart (Zero to Running in 60 Seconds)

1. **Clone and install dependencies:**

   ```bash
   git clone https://github.com/AQIB-NAWAB/Quickstar-AI.git
   cd Quickstar-AI
   pnpm install
   ```

2. **Configure environment:**

   ```bash
   cp .env.example .env
   ```

   _The default `.env` is fully functional out of the box with zero paid API keys needed (uses fake models, local Valkey, and Postgres on port 5433)._

3. **Start the complete stack:**

   ```bash
   pnpm dev:all
   # or: pnpm start
   ```

   This single command:
   - Starts Docker containers (PostgreSQL on port 5433 and Valkey on port 6379).
   - Applies database migrations across all 16 microservices automatically.
   - Launches all backend microservices and the tool execution mock clinic.
   - Automatically seeds the demo workspace and support agent.
   - Launches the Next.js staff management web UI on **http://localhost:3015**.
   - Cleanly shuts down and frees memory on `Ctrl+C`.

4. **Log in to Staff Portal:**
   - **URL:** [http://localhost:3015](http://localhost:3015)
   - **Email:** `quickstart@gmail.com`
   - **Password:** `password`

---

## Telephony & Inbound Calling Modes

The system supports three telephony tiers depending on your environment:

| Mode                                   | Configuration                                         | Use Case                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **1. Fake / Zero-Cost (Default)**      | `TELEPHONY_PROFILE=fake`<br>`SPEECH_PROFILE=fake`     | Local development and UI testing. Simulated calls, synthetic transcripts, zero external keys needed.                      |
| **2. Self-Hosted SIP Stack**           | `make sip-up`<br>`TELEPHONY_PROFILE=sip`              | Local or on-prem LiveKit SIP edge (`:5060`). Connect softphones (Linphone/Zoiper) or PBX directly to `127.0.0.1:5060`.    |
| **3. BYO SIP Carrier / LiveKit Cloud** | `LIVEKIT_URL=wss://...`<br>`LIVEKIT_SIP_ENDPOINT=...` | Production telephony. Connect Twilio Elastic SIP, Telnyx, Asterisk, or FreeSWITCH with carrier credentials via UI or API. |

See [deploy/sip/README.md](deploy/sip/README.md) and [deploy/sip/BYO-SIP.md](deploy/sip/BYO-SIP.md) for self-hosted SIP setup and carrier configuration guides.

---

## Port Map Reference

| Service                | Port   | Description                                                          |
| ---------------------- | ------ | -------------------------------------------------------------------- |
| **Staff Web App**      | `3015` | Next.js management UI (Agent Builder, Inbox, Voice, Leads, Settings) |
| **API Gateway**        | `3000` | Edge reverse proxy, public API, and widget script distribution       |
| **Identity**           | `3001` | Auth, JWT issuing, organizations, and team memberships               |
| **Workspace**          | `3002` | Workspace settings, members, and integrations                        |
| **Agent**              | `3003` | Agent configuration, tools, channels, and prompt compiler            |
| **Conversation**       | `3004` | Visitor threads, staff inbox, messaging sessions                     |
| **Model Gateway**      | `3005` | LLM router, multi-provider inference (OpenAI, Groq, fake)            |
| **Runtime**            | `3006` | Agent execution runtime, tool execution sandbox                      |
| **Web Fetch**          | `3007` | Web scraping, URL extraction, markdown conversion                    |
| **Voice**              | `3008` | Telephony lifecycle, SIP bridging, LiveKit integration, recordings   |
| **Knowledge**          | `3009` | RAG vector & BM25 indexing, document chunking                        |
| **Memory**             | `3010` | Long-term episodic and fact memory extraction                        |
| **Secrets**            | `3011` | AES-256-GCM encrypted vault for credentials and API keys             |
| **Workflow**           | `3012` | Trigger-condition-action workflow automation engine                  |
| **Campaign**           | `3013` | Outbound campaigns, audience segmentation                            |
| **Lead**               | `3014` | Lead management, dynamic schema, qualification statuses              |
| **Eval**               | `3016` | Agent evaluation harness and benchmark runs                          |
| **Usage**              | `3017` | Metering ledger and Stripe billing usage tracking                    |
| **Audit**              | `3018` | Append-only security and compliance audit log                        |
| **Lead Generation**    | `3019` | Autonomous business prospect research bot                            |
| **Dental Clinic Mock** | `4000` | Appointment slot & booking mock API for agent tool demonstration     |
| **PostgreSQL**         | `5433` | Primary database (host port 5433 avoids clashing with default 5432)  |
| **Valkey / Redis**     | `6379` | In-memory cache, pub/sub, rate limiting                              |

---

## Detailed Local Development & Testing

### 1. Manual Stack Startup (Fine-Grained)

If you prefer running services individually or in the background:

```bash
make up             # Starts full data plane (Postgres, Valkey, Kafka, OpenSearch, MinIO)
make migrate-all    # Runs migrations across all services
pnpm seed:demo      # Seeds demo workspace and support agent
pnpm stack:up       # Starts background services
pnpm dev            # Starts Next.js frontend on :3015
```

### 2. Widget on a Customer-Style Page (Port 8080)

```bash
pnpm seed:demo              # once, with stack up
pnpm widget:test:prepare    # writes fixtures/widget-test/config.local.js (gitignored)
pnpm widget:test:serve      # http://127.0.0.1:8080 — Northline demo host + embedded widget
```

Add `http://127.0.0.1:8080` to the publishable key’s allowed origins. Widget script is served from the web app (`/quickstart-widget.js`); gateway handles public widget API on **:3000**.

### 3. Lead Generation Stack (Optional)

```bash
bash scripts/start-lead-generation.sh
```

See [services/lead-generation-service/README.md](services/lead-generation-service/README.md) for `LEAD_GENERATION_MODE=live` vs demo and provider keys.

## Branching & commits

Day-to-day work lands on **`aqib`**; **`main`** is integration. Use clear commit messages; no AI co-author trailers (see [.cursorrules](.cursorrules)).

## License

TBD.
