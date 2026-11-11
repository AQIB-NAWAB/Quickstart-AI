# QuickStart AI — Roadmap

This file is the plan and the progress board.

- What the product is: [docs/project_details.md](./project_details.md)
- When and how we build it: this file
- **Learn-day depth (database, APIs, identity, cross-feature map):** [docs/ai-roadmap.md](./ai-roadmap.md) — use with each feature’s **Learn today** block; not a second progress board
- Why we chose a design: [docs/adr/](./adr/)

Update this file at the end of every work day. Change the status, tick the boxes, and write what shipped.

Design scale (use these numbers when you ask "will this break?"):

- 10,000+ organizations, 50,000+ users, 100,000+ agents
- 10,000 API requests per second sustained, 20,000 peak
- Millions of messages per day, 10,000+ concurrent chats
- 5,000 concurrent ongoing inbound voice calls and 5,000 concurrent ongoing outbound voice calls

These numbers are the design target. They are not the traffic on a laptop. A design that only works on one process for one user is not done.

These are three different budgets. Do not mix them.

| Budget | What it is | What it is not |
| --- | --- | --- |
| 10,000 HTTP requests per second sustained, 20,000 peak | Short requests through the gateway: JWT, proxy, Redis rate limit, cheap reads | Not 10,000 model calls per second |
| 10,000+ concurrent chats | Open conversations that read and append in Postgres | Not 10,000 long-held gateway sockets unless the widget is streaming |
| 5,000 inbound voice calls and 5,000 outbound voice calls at the same time | Up to 10,000 long-lived audio sockets on the **voice** process | Not HTTP on the API gateway. Media and call drain do not sit on port 3000 |

Rules that stay true at this target:

1. One shared Postgres schema with `workspace_id` on every tenant row. Ten thousand databases would fail on connections and migrations first.
2. The HTTP gateway stays a thin door. It does not check membership on every hop by calling workspace, it does not call a model, and it does not hold audio.
3. Billing is never on the request or call path. Model tokens, web acquisition units, and call minutes become usage facts, then a consumer writes the ledger (Feature 26).
4. We do not add a service whose only job is "scale." Cache, pooler, and a separate voice process are the improvements. The feature list stays the same.

What must exist before we treat the target as honest:

- A short Redis cache of workspace membership. Postgres stays the source of truth. Per-request HTTP to workspace at 10,000 requests per second is the bottleneck we already have.
- A written Postgres connection budget, then a pooler (PgBouncer or the Aurora/RDS proxy) before the production load test if replica math exceeds `max_connections`.
- Voice as its own process, with a longer drain than HTTP, and a Redis cap of 5,000 inbound and 5,000 outbound.
- A global and per-workspace cap on outbound model calls so one tenant cannot fill every vendor connection while calls are up.
- Web fetch (Feature 10B) with provider adapters, per-workspace acquisition unit budgets, and usage facts for crawl/scrape/search — not vendor SDKs scattered in ingest or tools.
- **Membership cache (Feature 09B)** before voice or runtime at scale. Voice and runtime must not HTTP to workspace on every turn or utterance.
- **Voice service** as its own process (port **3008**), Redis caps **5,000 inbound + 5,000 outbound**, and **P3-style graceful drain** before production telephony traffic.

---

## 1. How to read this file

Each feature has the same shape. Read it in this order.

1. **Pre-context.** What already exists, and the words we will use.
2. **What this is.** A plain definition.
3. **Why now.** What breaks later if we skip it.
4. **Junior shortcut.** The usual first implementation, and the production failure it hides.
5. **Production shape.** How the same feature looks when many copies of the service are running.
6. **What breaks at our scale.** The specific failure, not a slogan.
7. **Choice.** The option we take, the options we reject, and the cost of the option we take.
8. **Cloud later.** What stays the same when we move from Docker Compose to a cloud cluster. Kubernetes and cloud accounts are built near the end. Earlier features must already be safe with two copies of the process.
9. **Low-level design.** Tables, APIs, files, and the failure policy ("if X fails, we do Y").
10. **Learn today.** The study block. What to read, what to trace in code, and what to write on paper **before** code. Checklist only; not the full failure analysis.
11. **Deep learning.** The feature’s **production deep topic**: mechanism step-by-step, failure modes at our scale (10k req/s, concurrent chats, tenant isolation), threat or misuse cases, decision trees, classification exercises, and **which tests prove** you understood. This is mandatory on learn days—not a side lecture. Full narrative, tables, and exercises live under **Deep learning** in [docs/ai-roadmap.md](./ai-roadmap.md) for that feature.
12. **Build today.** Two tracks. Each track is a full feature, not a helper task.
13. **Done when.** The checks that must be true.
14. **Still unsafe.** What we knowingly leave for a later feature.
15. **Database design.** Tables, columns, indexes, migrations, tenant column on every row, caps, and delete/retention paths. Say which database (usually Postgres) and what must never live only in process memory.
16. **Identity and trust boundaries.** Who is the tenant (`workspace_id`), who is the staff actor (`actorId`), who is the end-user subject (widget visitor, voice caller, API customer). What crosses the public gateway vs internal-only hops.
17. **Related features.** How this feature connects to what is already shipped and what must not be duplicated (for example memory vs knowledge RAG vs conversation history vs secrets).
18. **API, gateway, and permissions.** Public routes on `:3000`, service port, internal routes and tokens, new `packages/contracts` permissions, and membership cache (09B) on the hot path.
19. **Extended detail.** Extra examples, DDL sketches, and copy-paste API tables in [docs/ai-roadmap.md](./ai-roadmap.md). Roadmap keeps decisions and status; ai-roadmap keeps the long-form lesson.

Every work day has two parts: **learn, then ship**. On learn days, walk headings **1–11** (through **Deep learning**) before **Build today**. The build block must leave running code or a finished doc/test/script that another person can run.

On **every** learn day, complete **Deep learning** (heading 11) for the feature you are about to build—not only on “second days.” The feature’s **Deep topic** line in the feature header names the focus; the **Deep learning** section proves you can explain the failure, not just the happy path.

---

## 2. Words we use

| Word | Meaning in this project |
| --- | --- |
| Organization | The company account. Billing and users live here. |
| Workspace | The project inside an organization. Agents, chats, and knowledge live here. This is the tenant id. |
| Tenant | In our code, tenant means workspace id. Every row that belongs to a customer has `workspace_id`. |
| Gateway | The only public HTTP door (local port 3000). It checks the login token and forwards the call. |
| Agent | Saved configuration: name, instructions, model settings. It is not the running chat loop. |
| Version | A frozen copy of an agent at publish time. We do not edit that copy. |
| Conversation | A stored chat: ordered messages in Postgres. |
| Model gateway | Our service that calls an LLM vendor. The rest of the system does not call the vendor SDK directly. |
| Web fetch | `services/web-fetch-service` — scrape, crawl, and search. Vendors such as Olostep are **providers** behind it, not the service name. |
| Acquisition action | One billable unit of work: e.g. one scrape, one crawl page, one search query. Recorded for cost policy and Feature 26. |
| Runtime | The loop that reads a published agent, reads the chat, calls the model gateway, and writes the reply. |
| Voice service | Realtime edge on port 3008: session orchestration, STT/TTS, telephony adapter. It does **not** run the agent loop; it calls the runtime for turns. |
| Telephony provider | CPaaS that terminates PSTN/SIP (Twilio or Telnyx first) and streams media to the voice service. Not the HTTP API gateway. |
| Voice turn | One user utterance through STT → runtime → TTS (cascade default). Shorter deadline than chat; spoken fallback on timeout. |
| Idempotency key | A client-supplied id so a retry does not insert the same message twice. |
| Optimistic concurrency | Update only if `version` still matches what the client last read. If not, return 409. |
| Horizontal scale | Add more copies of the same service. |
| Vertical scale | Give one copy more CPU or RAM. It does not fix a bug that lives in process memory. |

---

## 3. How the team works

From here on, a **product feature is end to end**. One person owns it until a staff user can do the job in `apps/web` and the API enforces the same rules. We do not mark a product feature done when only the service exists, and we do not open a second "frontend ticket" for the same job.

A feature ships together:

1. **Data and rules** in the service that owns them (Postgres, tests, failure behavior).
2. **A public route** on the gateway (`:3000`), or an internal route if the caller is another service.
3. **Staff UI** in `apps/web`: a page under `app/(app)/workspaces/...`, a folder `src/features/<name>/`, and a BFF route under `app/api/` so the browser uses httpOnly cookies.
4. **A test the teammate can run** (service test and a short click-path or HTTP example for the screen).

Three people can work the same day only on **three different features**. The split is by feature, which means different service directories and different `features/<name>/` folders.

Rules:

1. Pick **one feature** from section **6A**. Do not start it while a feature it **Needs** is still open.
2. You may edit that feature's service **and** its `apps/web` feature folder in the same change. That is the point. You do not hand the screen to someone else.
3. Do not edit another person's service, their `features/<name>/` folder, or the same shared package (`packages/*`) on the same day.
4. If two features need a shared type, one person lands `packages/contracts` first. The other uses it the next day.
5. Gateway route files stay split (`proxy-agent`, `proxy-conversation`, and so on). Do not both edit `routes/index.ts`. Add your module, then one person wires the one-line register.
6. The browser never calls a service port and never stores access tokens in `localStorage`.
7. A 15-minute sync is only for the JSON shape and the URL. After that, work alone.

**Exceptions (no staff screen):** identity internals, membership cache, model gateway, web fetch, the event outbox, tracing, and platform labs **P1–P8**. Those are done when the service contract and tests pass. The product feature that *uses* them is still end to end (workflows use events; the workflow screen ships with workflows).

Frontend layout: [apps/web/docs/FOLDER_STRUCTURE.md](../apps/web/docs/FOLDER_STRUCTURE.md).

---

## 4. What is already built

The old board in this file was behind the code. This table matches the repo as of the runtime-service work.

| Feature | Status | Where it lives | What a caller can do |
| --- | --- | --- | --- |
| Monorepo, service template, shared libraries | Done | `packages/*`, `services/_template` | Errors, logs, traces, auth context, HTTP shell |
| Local data plane | Done | `docker-compose.yml`, `make up` | Postgres, Valkey, Kafka, OpenSearch, OTel, local SQS |
| Identity | Done | `services/identity-service` | Register, login, refresh, orgs, API keys |
| Workspace and roles | Done | `services/workspace-service` | Workspaces, members, invites, permission checks |
| API gateway | Done | `services/gateway-service` | Public door on port 3000, JWT, Redis rate limit, proxy |
| Agent configuration | Done | `services/agent-service` | Create, list, get, update, delete agents in a workspace |
| Agent versions and publish (08) | Done | `services/agent-service` | Publish immutable versions, production pointer, rollback |
| Conversations (09) | Done | `services/conversation-service` | Threads, ordered messages, idempotent append |
| Model gateway (10) | Done | `services/model-gateway` | Internal complete/stream; vendor adapters behind one API |
| Web fetch (10B) | Done | `services/web-fetch-service` | Internal scrape, crawl jobs, search; direct HTTP + Olostep providers |
| Membership cache (09B) | Done | `packages/workspace-access` | Redis-backed role resolution; workspace invalidates on member change |
| Knowledge ingest (11) | Done | `services/knowledge-service` | Text sources → SQS worker → OpenSearch chunks |
| Agent runtime — chat turns (12) | Done | `services/runtime-service` | Turn via gateway: published version → model gateway → messages |
| Retrieval in runtime (13) | Done | runtime + knowledge internal API | RAG when workspace has ready sources; chunk ids on assistant metadata |

Shared permission strings live in `packages/contracts` so workspace and agent do not copy two different role lists.

Also in the repo (board detail is in section 6 and **6A**, synced 2026-10-12):

| Feature | Status | Where | Note |
| --- | --- | --- | --- |
| Memory (14), tools (15), secrets (16) | Done | `memory-service`, agent tools, `secrets-service` | Gateway proxies memory, knowledge, secrets |
| Website widget (17) | Done (v1) | gateway public routes, publishable keys, `apps/web/public/quickstart-widget.js`, `scripts/check-widget-browser-proof.mjs` | Chat turn, refresh history, wrong-origin reject, and idempotent retry proven; SSE reconnect-by-seq is follow-up |
| Inbox handoff (18) | Done | conversation `take`/`release`, runtime 409 | Staff UI is F4 |
| Event platform (19) | Done (catalog v1) | conversation outbox + Kafka | `handed_off`, `released`, `message.appended` produced; consumer idempotency remains |
| Workflows (20) | Done | `services/workflow-service` :3012 + staff UI | Definitions, Kafka consumer, runs/steps, side effects, dead letters |
| Voice path (21) | Done (v1) | `voice-service` :3008, runtime internal voice turn, `scripts/check-voice-simulate-proof.mjs` | Fake-media simulate → real runtime messages + `voice_calls` timings |
| Speech providers (21B) | Done (v1) | `speech/` OpenAI + fake profiles, `scripts/check-voice-speech-proof.mjs` | Env-gated OpenAI STT/TTS; fail-closed flag; usage stubs; 21C still open |
| Staff web F1 + F4 | Done (core) | `apps/web` | Auth shell, inbox, transcript. Agents/settings still "Soon" |

Local ports: identity 3001, workspace 3002, agent 3003, conversation 3004, model-gateway 3005, runtime 3006, web-fetch 3007, voice 3008, knowledge 3009, memory 3010, secrets 3011, workflow 3012, campaign 3013, lead 3014, staff web **3015**, eval 3016, usage 3017, audit 3018, lead-generation **3019**, gateway 3000. Postgres on the host is 5433.

### What is still unsafe in the code we already shipped

Say these out loud. They are not bugs we forgot. They are the next designs.

- The gateway checks that the token is valid. It does **not** check that this user is a member of the workspace id in the URL. Membership is checked in the service that owns the data.
- Agent and conversation permission checks call workspace over HTTP on every request. At 10,000 requests per second that hop is the bottleneck. A short Redis cache of membership is **required before we treat the gateway as ready for this scale**. Postgres stays the source of truth. A cache miss or Redis down falls back to workspace HTTP or fails closed on the write path — pick one in the ADR and test it.
- Agent drafts and immutable published versions exist (Feature 08). Runtime (Feature 12) must read the production pointer, not the draft row.
- Two gateway copies are safe for rate limits only because the counter is in Redis. Any new limit that uses a `Map` inside Node will be wrong as soon as the second copy starts.
- Voice sockets must not share the HTTP gateway process. 5,000 inbound plus 5,000 outbound is a connection and memory problem on the voice edge, not more `proxy-*.routes.ts` files.

---

## 5. Product path

Read this once. Later features assume it. **Section 5A** is dependency order. **Section 5B** is what we build next. **Section 5C** is the voice stack when we schedule telephony.

### 5A. Dependency order (where each feature belongs)

```text
Foundation (done):
  01–07  monorepo, data plane, shared libs, identity, workspace, gateway, agent drafts

Agents and chat core (done):
  08  versions & publish          ‖  09  conversations
  10  model gateway
  10B web fetch
  12  agent runtime (chat turns)

Scale + knowledge (next — see 5B):
  09B membership cache (Redis; all hot paths, not voice-only)
  11  knowledge ingest (sources → chunks → index)
  13  retrieval in runtime (embed + query; needs 11 + 12)
  14  memory (needs 09 + 12)

More agent surface:
  15  tools & MCP  ‖  16  secrets
  17  website widget  ‖  18  inbox / human handoff

Events and growth:
  19  event platform  →  20  workflows
  24  leads

Voice edge (later — see 5C; uses same runtime as chat):
  21  voice path  →  21B  speech (STT/TTS)  →  22  reliability  →  21C  telephony
  23  campaigns (needs 21C + 22; 18 before heavy outbound)
  V1  voice load & drain proof  ‖  P3  graceful drain on voice pods

Billing, security, ops (late):
  25  evaluation  ‖  26  usage & billing  →  27  audit  →  28  observability & alerts
  29  cloud deploy  →  30  load, failure, recovery, SDKs
  P1–P8  platform labs (parallel with product when files do not overlap)
```

### 5B. Current focus path (end-to-end features)

A product feature is finished only when the API and the staff screen both work. Section **6A** is the list. Catch-up features already have APIs; the owner still ships the screen as part of that same feature. New features start with the service and the screen in one slice.

```text
Now (catch-up screens that were open are largely done; pick from 6A):
  Website widget (17) — done for v1 JSON turns; SSE follow-up only
  Voice path (21) — done for v1 fake-media simulate + runtime hop
  Speech providers (21B) — done for v1 OpenAI profile + fake default
  Next: 22 reliability → 21C telephony (+ F5 polish)
  Campaigns, leads, usage, evaluation, audit (each: API + screen)
  Platform labs P1–P8 and cloud deploy (no product screen)
```

### 5C. Voice track (when we start telephony)

Inbound and outbound voice remain a **design target** (5,000 + 5,000 concurrent calls). They are **not** the current build order. Start this track only after **09B** and when we choose to prioritize phone over more knowledge work.

```text
09B membership cache (required before voice or runtime at scale)
  → 12 addendum: voice-turn contract in `packages/contracts` (can ship with Feature 21)
  → 21 voice path (voice-service :3008, fake media, calls table)
  → 21B speech providers (STT/TTS adapters inside voice-service)
  → 22 voice reliability (caps, barge-in, reconnect, fail-closed)
  → 21C telephony (CPaaS: Twilio or Telnyx; ADR picks primary)
  → 18 inbox / handoff (runtime skips model when state=human) — before heavy outbound
  → 23 campaigns (queued dial; needs 21C + 22)
  → 26 usage slice (voice minutes + STT/TTS units) — do not wait for full billing UI
Parallel when voice is active: P3 drain, V1 load proof, per-call stage metrics (Feature 28)
```

Default audio path: **cascade** (STT → runtime → TTS). Optional **realtime speech** profile on the agent version only when tools/retrieval are off; document in ADR for voice (Feature 21).

Rules that do not change:

1. The runtime starts with a model call only. Later features add steps. We do not throw the runtime away.
2. Voice is another channel into the same runtime.
3. We write Kafka events only after the object exists in Postgres.
4. Daily product work uses Docker Compose. A second track (section 8A) builds Docker images, a local Kubernetes slice, probes, and deploy habits **while** product features continue. Full cloud accounts stay late. The habits must exist before that day.
5. Telephony vendor SDKs and STT/TTS vendor SDKs stay inside **voice-service** (or a speech submodule), not in gateway or runtime.

---

## 6. Progress board

Update these lines every day.

- **Current focus:** section **6A** — next is **28** Observability and alerts; V1 voice load/drain can run beside
- **Next production deep topic:** metrics that mean unhealthy + alert on error rate (Feature 28)
- **Product priority:** Voice **21–23** + leads **24** + eval **25** + usage **26** + audit **27** done for v1; keep widget SSE as follow-up only
- **Finished features:** backend **01–27** + **21B** + **21C**; staff web **F1–F4**, **F8**, **F10** core
- **Board status:** synced to repo 2026-10-13 (Feature 27 proof); update this line when code and table disagree

| # | Feature | Needs | Track partner (can run the same days) | Status |
| --- | --- | --- | --- | --- |
| 01 | Engineering foundation | — | — | done |
| 02 | Local data plane | — | — | done |
| 03 | Shared libraries | — | — | done |
| 04 | Identity | — | — | done |
| 05 | Workspace and roles | — | — | done |
| 06 | API gateway | — | — | done |
| 07 | Agent drafts | workspace, gateway | — | done |
| 08 | Agent versions and publish | agent drafts | 09 | done |
| 09 | Conversation service | gateway, workspace | 08 | done |
| 09B | Membership cache | workspace | 11 | done |
| 10 | Model gateway | — | 10B, 11 | done |
| 10B | Web fetch service | workspace | 11 | done |
| 11 | Knowledge ingest | 10B, workspace, OpenSearch | 14 | done |
| 12 | Agent runtime (chat turns) | 08, 09, 10 | 11, 13 | done |
| 13 | Retrieval in the runtime | 11, 12 | 14 | done |
| 14 | Memory | 09, 12 | 13 | done |
| 15 | Tools and MCP | 12 | 16 | done |
| 16 | Secrets | — | 15 | done |
| 17 | Website chat widget | 12 | 18 | done |
| 18 | Inbox and human handoff | 09 | 17, 21C | done |
| 19 | Event platform | objects exist | 20 | done |
| 20 | Workflow automation | 19 | 19 | done |
| 21 | Voice path | 12, 09B | 21B | done |
| 21B | Speech providers (STT/TTS) | 21 | 21C | done |
| 22 | Voice reliability | 21 | 21C | done |
| 21C | Telephony (CPaaS) | 21, 21B, 22 | 23 | done |
| 23 | Campaigns | 21C, 22, 09 | 24 | done |
| V1 | Voice load and drain proof | 22, P3 | P3 | not_started |
| 24 | Leads | 19 | 23 | done |
| 25 | Evaluation | 12 | 26 | done |
| 26 | Usage and billing | 10, 12, 21B, 21C | 25 | done |
| 27 | Audit and security | all writes | 28 | done |
| 28 | Observability and alerts | traces exist | 27 | in_progress |
| 29 | Cloud deploy (AWS, Kubernetes, CI) | features above | 30 | not_started |
| 30 | Load, failure, recovery, SDKs | 29 | 29 | not_started |
| P1 | Docker images for our services | services exist | P2 | not_started |
| P2 | Local Kubernetes: two gateway copies | P1 | P1 | not_started |
| P3 | Probes, graceful shutdown, rolling update | P2 | P4 | not_started |
| P4 | Config, secrets, and "no secrets in the image" | P1 | P3 | not_started |
| P5 | Postgres pool, timeouts, and slow-query guard | identity or workspace | P6 | not_started |
| P6 | Metrics that survive two copies | gateway | P5 | not_started |
| P7 | CI: test, image build, no manual laptop-only steps | P1 | P8 | not_started |
| P8 | Network picture: public gateway, private services | P2 | P7 | not_started |
| F1 | Frontend foundation — landing page, auth, layout, design system | 04, 05, 06 | F2 | done |
| F2 | Agent builder and agent settings UI | F1, 07, 08, 15, 16 | F3 | done |
| F3 | Knowledge and memory UI | F1, 11, 14 | F2 | done |
| F4 | Conversation inbox and live chat UI | F1, 09, 18 | F3 | done |
| F5 | Inbound voice — call logs, live calls, transcripts | F1, 21, 21B | F6 | not_started |
| F6 | Outbound voice and campaign management UI | F1, 21C, 23 | F5 | not_started |
| F7 | Leads management UI | F1, 24 | F6 | not_started |
| F8 | Workflow and event builder UI | F1, 19, 20 | F7 | done |
| F9 | Analytics and usage UI | F1, 26 | F8 | done |
| F10 | Workspace settings — members, roles, API keys, billing, secrets | F1, 04, 05, 16 | F9 | done |
| F11 | Agent evaluation UI | F1, 25 | F9 | in_progress |
| F12 | Audit log and notification center | F1, 27 | F11 | done |
| F13 | Developer portal — API reference, SDK docs, webhooks | F1, public API | F12 | done |

Platform labs **P1–P8** are real features. Either person can take one lab while the other takes a product feature (08, 09, …), as long as you do not edit the same files. Labs are how we learn Docker, Kubernetes, and cloud **by shipping**.

The **F1–F13** rows are the screen half of a product feature. They are not a second backlog. From section **3** onward, you pick the product feature in **6A** and ship the API and the screen together. F-numbers stay here so older notes still point at the same work.

---

## 6A. Remaining work — one feature, both sides

Synced **2026-10-10**. This is the queue. Section 35 still has the long screen notes. You do not pick "backend" or "frontend" as the task. You pick a **feature** and finish both sides.

**Done** means: the gateway route behaves correctly with two replicas of the service, and a staff user can complete the job in the web app (or, for the widget, a host page outside the staff app can).

### Now — finish features whose API already exists

The service work is in the repo. The feature is still open until the screen is in. One person per row. Same day is fine because the folders differ. Do not add a second service for these.

| Feature | What the user can do when it is done | API already on :3000 | What you still ship | Directories you own |
| --- | --- | --- | --- | --- |
| **Agents** (07, 08, 15, screen F2) | Create a draft, edit instructions, attach tool names, publish, see versions, roll back. Runtime keeps using the published pointer. | Agents, publish, rollback, versions, diff | Pages, BFF, empty and error states. Secret values never appear; only secret names. | `apps/web/src/features/agents/`, `app/(app)/workspaces/[workspaceId]/agents/`, `app/api/workspaces/.../agents/`. Touch `agent-service` only if a real API bug blocks the screen. |
| **Knowledge and memory** (11, 14, screen F3) | Add a text source, see ready or failed, open chunks. List and delete memory for a subject key. | `.../knowledge/*`, `.../memory/*` | Those screens in one feature folder. | `apps/web/src/features/knowledge/` and the matching `app/` routes and BFF. |
| **Workspace settings** (05, 04 keys, 16, screen F10) | Invite a member, change a role, create an API key (shown once), rotate a secret by name, create a publishable key. | Members, invites, API keys, secrets, publishable keys | Settings pages. Billing UI waits for the usage feature. | `apps/web/src/features/settings/` and the matching routes and BFF. |

**Inbox (09, 18, screen F4) is done for v1.** Leave it unless you are fixing a bug. Gaps that are not a new feature: no list cursor past 50, poll instead of SSE, no resolve button, `waiting` is reserved and unused.

### Next — new product features (API and screen in the same slice)

Start the next row only after the **Needs** row is done. The person who takes it writes the service, the gateway route, and the staff screen before calling it done.

| Order | Feature | Needs | Ship together | Directories |
| --- | --- | --- | --- | --- |
| 1 | **Website widget** (17) | Runtime, publishable keys | **Done (v1).** Embed bundle, demo page, and `scripts/check-widget-browser-proof.mjs` prove chat + refresh + origin + idempotency. SSE is follow-up. | `apps/web/public/quickstart-widget.js`, `fixtures/widget-demo.html`; key admin stays in settings. |
| 2 | **Voice** (21 + 21B done v1; next 22 → 21C + F5) | Runtime, membership cache. Section **5C**. | **21/21B done:** simulate + OpenAI speech profile. Still ship reliability (22), one telephony vendor (21C). Staff call log API path already exists. | `services/voice-service/`, `apps/web/src/features/voice/` |
| 3 | **Campaigns** (23 + screen F6) | Voice reliability and telephony | Queue, caps, and the campaign screen. | One service (decide in the ADR), `features/campaigns/` |
| 4 | **Leads** (24 + screen F7) | Workflows or a single event you already emit | Lead rows and the lead list. | Lead service, `features/leads/` |
| 5 | **Usage** (26 + screen F9) | Model and web-fetch facts already log; there is no ledger | Ledger consumer off the request path, and a staff totals page. | Usage consumer, `features/usage/` |
| 6 | **Evaluation** (25 + screen F11) | Runtime turns | Dataset, run, score, and the eval screen. | Eval service, `features/evaluation/` |
| 7 | **Audit** (27 + screen F12) | Staff writes exist | Append-only audit rows and the audit screen. Say in the ADR whether a failed audit insert fails the user request. | Audit writer, `features/audit/` |
| 8 | **Developer docs** (F13) | Public routes you are willing to freeze | API reference next to the routes, not a separate product. | `docs/` or a docs route in `apps/web` |
| — | **Observability (28), cloud (29–30), labs P1–P8** | — | No staff product screen. Ship the probe, metric, or deploy path. | Platform files only |

### What we will not do

- Merge a product feature as "backend done" and leave the screen for later.
- A second chat store in the Next.js process.
- Custom Kafka event types per tenant. Workflows use the fixed catalog in `packages/contracts`.
- Billing math on the gateway request path.
- Setup state that exists only in `localStorage`.

### This week

| Person | Feature | Owns |
| --- | --- | --- |
| A | Agents | `features/agents/` and agent routes |
| B | Knowledge and memory | `features/knowledge/` |
| C | Workspace settings | `features/settings/` |

---

## 7. The learning block (use this every day)

Before you write feature code, write short notes under these headings. Same headings every day. Six hours total: about two hours of notes, four hours of shipping.

1. **Pre-context.** What is already running, in one paragraph.
2. **Definition.** What the feature is, in two or three sentences. Define any new word.
3. **Why now.** Which later feature becomes a rewrite if we skip this.
4. **Junior shortcut.** Describe the simple version. Then name the production incident it causes (wrong tenant, double write, hang, stale prompt, split brain).
5. **Production shape.** Where the data lives (Postgres, Redis, OpenSearch, object storage). What is in memory. What happens with two copies of the process.
6. **Breaks at scale.** One concrete failure at 10,000 requests per second sustained, 20,000 peak, 5,000 concurrent inbound calls, 5,000 concurrent outbound calls, 100,000 agents, or millions of messages.
7. **Choice.** One option we take. Two options we reject, each with the cost.
8. **Cloud later.** What becomes a managed service (RDS, ElastiCache, MSK, S3) and what must already be true in code (health checks, no disk state, stateless process).
9. **Low-level design.** Tables, indexes, API paths, status codes, and "if this dependency fails, we return this."
10. **Ship check.** The test you will run today that fails if the junior shortcut ships.

Day 2 of the feature adds the production deep topic from section 8. You still ship code that day.

---

## 8. Production deep topics (every second day)

These topics repeat across the product. Each feature below names the one you study while you build it. Spend the first hour of day 2 on that topic, tied to your code, then finish the feature.

| Deep topic | Plain meaning | Where it shows up |
| --- | --- | --- |
| Transactions and lost updates | Two writers. One commit must not erase the other. | Agent versions, role changes |
| Idempotency | A retry is normal. A second row is a bug. | Messages, billing, tool calls |
| Timeouts, one retry, circuit breaker | A dead vendor must not hold a worker forever. A retry storm multiplies cost. | Model gateway, web acquisition, any HTTP call |
| Cost policy and unit budgets | Paid actions need allow/deny before the vendor call, not after the bill arrives. | Web acquisition, model gateway caps, Feature 26 |
| Horizontal vs vertical scale | More copies vs a bigger machine. Memory state breaks the first option. | Gateway, runtime, widget connections |
| Distributed lock vs database constraint | A lock in Redis expires. A unique key in Postgres does not forget. | Refresh tokens, unique agent names, publish pointer |
| Queues and backpressure | Kafka for events many consumers read. A job queue for work that must retry. Do not do heavy work inside the HTTP request. | Ingest, workflows, campaigns |
| Tenant leaks | A missing `workspace_id` in one query returns another customer's row. | Every new table |
| Streaming and proxies | A long connection dies at a load balancer if you do not send heartbeats. You cannot blindly retry after the user already saw tokens. | Runtime, widget, voice |
| Voice stage latency | STT, LLM, TTS, and time-to-first-audio must be traced per `call_id`. You cannot tune 5,000 calls from one log line. | Voice service, model gateway, Feature V1 |
| Observability | Logs, metrics, and traces share one `request_id`. You cannot fix a 10,000 rps system from one laptop log. | Every service, then a dedicated alerts feature |
| Secrets and rotation | A key in a log line or in git is public. Rotation must not take the platform down. | Model keys, tool credentials |
| Read-your-writes | After publish succeeds, the next read must see the new pointer. A lagging copy must not answer that read. | Versions, inbox assignment |
| Failure domains | One bad tenant or one bad vendor must not take every worker. | Runtime limits, voice, cloud |

The short table is the index. **Section 8A** is the deep study. Read the lab before you build it. Do not skip to YAML.

---

## 8A. Deep learning labs (Docker, Kubernetes, cloud)

These labs sit **beside** product features. They are not "read a blog and stop." Each lab has a study block and a ship block. The study block is the larger part. If you cannot explain the failure in a sentence, do not merge the YAML.

How to use a lab:

1. Spend the first half of the day on **Learn** (write notes in your own words).
2. Spend the second half on **Build**.
3. End with **Explain back**: what a junior does, what breaks with two copies, what the cloud will change later.

Words for this section:

| Word | Meaning |
| --- | --- |
| Image | A packed snapshot of your app and its runtime. It is not a running program yet. |
| Container | A running image. It has its own files and its own network address. |
| Docker Compose | One file that starts many containers on **one machine**. Good for the laptop. Weak as the production control plane. |
| Pod | The Kubernetes word for one or a few containers that share a network and live and die together. |
| Deployment | A Kubernetes object that keeps N copies of a pod running, and replaces them on a new image. |
| Service | A stable name and address in front of changing pods. Clients use the Service, not a pod IP. |
| Ingress | The HTTP front door into the cluster. In our design only the gateway sits here. |
| Readiness | "This copy can take traffic now." If it fails, the load balancer stops sending new calls. The process stays up. |
| Liveness | "This process is stuck. Kill it." A wrong liveness check restarts healthy apps during a slow database. |
| Horizontal scale | More copies. |
| Vertical scale | A bigger machine for one copy. |
| Rolling update | Replace copies one by one so the service never goes to zero. |
| Control plane | The Kubernetes brain (API server, scheduler). It does not run your Node code. |
| Node | A machine in the cluster. Pods are placed on nodes. |
| Namespace | A folder inside the cluster. Staging and prod should not share one namespace. |

### How the pieces sit on top of each other

```text
Your TypeScript process
    inside a container
        inside a pod
            kept alive by a Deployment (ask for 2 copies)
                reached through a Service
                    reached from the internet only if it is the gateway, via Ingress

Postgres and Redis are not "just more Node pods" in production.
On the laptop they are containers.
In the cloud they are managed databases. The app still uses a URL.
```

A junior mixes these layers. They SSH into a server, edit a file, and call that deploy. The next crash has no record of what was running. An image plus a Deployment is the record.

---

### Lab P1 — Docker images

**Status:** `not_started`  
**Can run beside:** any product feature that is not editing the same Dockerfile

#### Pre-context

Today we run `pnpm start` on the laptop. Compose runs Postgres and Redis, not our Node services. A new teammate must install Node, copy env vars, and start four terminals. That is not how production starts a process.

#### What Docker is

Docker builds an **image** from a **Dockerfile**. The image contains Node, your compiled JavaScript, and the files you copied. It does not contain your laptop's home directory. A **container** is that image running with limits (CPU, memory) and env vars you pass in at start.

The image is built once and run many times. If the image works on your machine and in CI, the "works on my laptop" class of bugs shrinks. It does not shrink logic bugs. A tenant leak is still a tenant leak inside a beautiful image.

#### What a junior usually does

- Copies the whole repo, including tests, `.env`, and `node_modules` from the laptop.
- Runs as root.
- Uses `latest` as the only tag, so yesterday's image and today's image have the same name.
- Puts `JWT_ACCESS_SECRET` in the Dockerfile with `ENV`. Anyone who can pull the image can read the secret.
- Stores uploads in `/tmp` inside the container. The next deploy deletes them.

#### What production needs

- **Multi-stage build.** Stage 1 compiles TypeScript. Stage 2 copies only `dist` and production dependencies. The final image does not need the compiler.
- **Non-root user.** A bug in the app should not be root on the node.
- **Pinned base image.** `node:22-bookworm-slim` with a digest or a clear version, not a floating tag you cannot rebuild.
- **Tag = git sha.** `quickstart-gateway:b9eaac0`. `latest` is a nickname, not the thing you roll back to.
- **No secrets in the image.** Secrets arrive as env or as mounted files at runtime.
- **One process per container.** Do not start identity and gateway in the same container. One crash should not hide which service died.
- **Listen on `0.0.0.0` and `$PORT`.** A container that listens on `127.0.0.1` looks healthy and receives nothing from the network.

#### What breaks at scale

Image size and startup time matter when you start tens of copies. A 2 GB image that runs `tsc` on boot makes a rolling update slow. Build in CI, run the compiled file.

A container has no durable disk. If agent uploads land in the container filesystem, the next restart loses them. Postgres and object storage are the disks that count.

#### Choice

We take one Dockerfile pattern for every service, multi-stage, non-root, sha tags.

We do not take one giant image that runs all services. That brings back the monolith we split on purpose.

We do not take Docker as a substitute for tenant tests. The image only packages the process.

#### Cloud later

The same image runs on your laptop, in CI, and in the cluster. The registry (GitHub Container Registry, ECR, and so on) stores the sha. The cluster pulls the sha. You do not rebuild on the server.

#### Build

- [ ] `deploy/docker/gateway.Dockerfile` (and the same pattern for identity, workspace, agent)
- [ ] `.dockerignore` so `.env` and `node_modules` are not copied
- [ ] Document `docker build` and `docker run` with env vars, port 3000, health `GET /healthz`
- [ ] Image does not contain `JWT_ACCESS_SECRET` (grep the image history or the Dockerfile in review)

#### Done when

A second person can run the gateway container against Compose Postgres and Redis without installing the repo's Node modules inside the container.

#### Still unsafe

No cluster yet. No scan of CVEs in the base image yet. Add a note in the Dockerfile comment that scanning is lab P7.

---

### Lab P2 — Local Kubernetes, two copies of the gateway

**Status:** `not_started`  
**Needs:** P1

#### Pre-context

Compose starts one container per service on one machine. Kubernetes is a **control plane** that keeps asking "do we have the number of pods we asked for?" If a pod dies, it starts another. That is the difference. Compose will not do that for you unless you add extra tools.

We use a **local** cluster (kind or k3d). We do not open a cloud account in this lab.

#### What Kubernetes is doing

You apply YAML. The API server stores it. The scheduler places pods on nodes. A controller notices "I want 2 gateway pods and I have 1" and starts the missing one.

You do not SSH to start Node. If you need SSH to fix a deploy, the lab is not done.

Objects we will use first:

| Object | Why it exists |
| --- | --- |
| Namespace `quickstart-local` | Keeps this experiment off other local clusters |
| Deployment `gateway` with `replicas: 2` | Two copies of the same image |
| Service `gateway` | One DNS name, traffic split across the two pods |
| ConfigMap | Non-secret settings (`IDENTITY_URL`, ports) |
| Secret | The JWT secret. Not in git. |

We do **not** start with Ingress controllers, service mesh, or Helm charts that hide the YAML. Read the YAML. Generate Helm later if the YAML repeats too much.

#### What a junior usually does

- Puts `replicas: 3` on a service that stores sessions in memory. Each copy has a different session. Users get logged out at random.
- Uses pod IP in the client. Pod IPs change. The Service exists so you do not do that.
- Runs Postgres as a pod with an emptyDir disk, then is surprised the data vanished. For this lab, Postgres stays in Compose **or** a pod with a PersistentVolume. Write down which one you chose.
- Copies a tutorial that exposes every Service as LoadBalancer, including the database.

#### What production needs

- Gateway `replicas: 2` proves the rate limit is shared. Hit both pods. The Redis counter must be the same Redis. If each pod had its own Redis, the limit would be doubled. That is the experiment.
- Identity, workspace, and agent can stay at 1 replica in this lab. The lesson is the gateway, because it is the public door.
- Service DNS: `http://gateway.quickstart-local.svc.cluster.local`. Other pods use that name, not `localhost`. Inside a pod, `localhost` is the pod itself, not your laptop.
- Resource requests: a small CPU and memory request so the scheduler can place the pod. Without requests, a noisy pod can starve the node. This is vertical thinking inside a horizontal system. Requests are not the same as limits. A limit kills the process when it passes the number. Start with requests. Add limits when you know the steady number.

#### What breaks at scale

Two replicas with a `Map` rate limiter allow twice the traffic. We already moved the limiter to Redis. This lab is the proof.

A Service without readiness (lab P3) sends traffic to a pod that is still starting. You will see random 500s during deploy. That is why P3 exists. You can still finish P2 by showing two ready pods and a shared Redis key.

#### Choice

We take kind or k3d plus plain YAML in `deploy/k8s/local/`.

We do not take a full EKS cluster in this lab. Cloud accounts are feature 29. The YAML habits move there.

We do not take a service mesh. A mesh does not authenticate a customer. The gateway does.

#### Cloud later

The same Deployment shape runs in EKS or another managed Kubernetes. The node type and the load balancer change. The replica count and the Redis URL change by environment. The idea "more pods, shared Redis, no local disk" does not change.

#### Build

- [ ] `deploy/k8s/local/` with namespace, gateway Deployment (2 replicas), Service, ConfigMap
- [ ] Secret created by a command in the README, not committed
- [ ] README: install kind or k3d, load the image, apply, `kubectl get pods`, curl health through port-forward
- [ ] Show a Redis key used by both pods (rate limit or a tiny debug counter you remove after the note)

#### Done when

Killing one gateway pod (`kubectl delete pod`) brings a new pod back, and the other pod still serves `/healthz` during that time.

#### Still unsafe

Probes may be too naive. Secrets handling is finished in P4. This lab proves replicas and self-heal.

---

### Lab P3 — Probes, graceful shutdown, rolling update

**Status:** `not_started`  
**Needs:** P2

#### Pre-context

A process can be "running" and still be unable to talk to Postgres. Kubernetes does not know that unless we tell it.

#### What these checks mean

**Readiness.** The pod is in the Service endpoints only when readiness succeeds. Use it for "database ping works" and "Redis ping works." When Postgres is down, readiness fails, and the load balancer stops sending **new** calls. Old calls can finish.

**Liveness.** Kubernetes kills the pod. Use it only when the process is deadlocked (event loop stuck). Do not point liveness at Postgres. A database blip would restart every pod, which makes the blip worse.

**Startup probe.** A slow boot (migrations, JIT, cold start) should not be killed by liveness. We do not run migrations in the web pod (see below), so startup can be short. Still know the knob.

**Graceful shutdown.** On SIGTERM, stop accepting new connections, finish the ones you have, close the database pool, exit. Kubernetes waits `terminationGracePeriodSeconds` (often 30s) then sends SIGKILL. If you ignore SIGTERM, in-flight publishes die mid-way. Our services already close the HTTP server on SIGTERM. This lab checks that the container actually receives the signal. A shell as PID 1 sometimes swallows it. Prefer `exec` form in Docker (`CMD ["node", "dist/index.js"]`) so Node is PID 1.

**Voice pods.** HTTP `terminationGracePeriodSeconds: 30` is not enough when calls last minutes. For `voice-service`, document **stop accepting new calls on SIGTERM**, drain existing media streams, then exit — often **120s+** grace or a preStop hook that fails readiness first. Feature **V1** proves drain with simulated long calls.

**preStop.** A short sleep or a "fail readiness first" hook gives the load balancer time to stop sending traffic before the process exits. Without it, a few requests hit a pod that is already dying.

**Rolling update.** `maxUnavailable: 0` and `maxSurge: 1` means "start a new pod, wait until it is ready, then stop an old one." The service never goes to zero copies. A bad image that fails readiness stops the rollout. That is what you want. A junior sets `maxUnavailable: 100%` and takes an outage on every deploy.

#### What a junior usually does

- One HTTP check used for both liveness and readiness, and that check always returns 200.
- `npm start` as a shell script, so SIGTERM never reaches Node.
- Migrations on every pod start. Two replicas run migrations together and corrupt `schema_migrations` or lock the table at the worst moment.

#### What production needs

- Readiness hits `/readyz` (dependency checks). Liveness hits `/healthz` (process only) or a simple live path that does not call the database.
- Migrations are a **Job**, one shot, before the Deployment rolls. If the Job fails, do not roll the Deployment.
- Rolling strategy written in the YAML, not left as the default you have never read.

#### What breaks at scale

During a deploy at 10,000 requests per second sustained, a few seconds of "pod is in the endpoints but already closing" becomes a visible error spike. preStop plus readiness is how you cut that spike.

A migration lock from six pods starting at once can stall writes for the whole product. One Job avoids that.

#### Choice

We take separate live and ready endpoints, exec-form start, a migrate Job, and a rolling strategy with `maxUnavailable: 0`.

We do not take "restart the pod if Postgres is slow."

#### Cloud later

The load balancer uses the same readiness idea. Managed databases do not remove the need for the probe. They remove the need for us to operate disk failover.

#### Build

- [ ] Gateway Deployment: readiness `/readyz`, liveness `/healthz`, preStop, rolling update
- [ ] `deploy/k8s/local/migrate-job.yaml` example for one service
- [ ] A note in the lab README: kill Postgres, show the pod becomes NotReady, show it is **not** CrashLoopBackOff from liveness
- [ ] Confirm Dockerfile `CMD` is exec form

#### Done when

You can show a NotReady pod that is still running, and a rollout that keeps at least one ready pod.

---

### Lab P4 — Config and secrets

**Status:** `not_started`  
**Needs:** P1  
**Can run beside:** P3

#### Pre-context

`.env` on a laptop is fine. `.env` in git is a leak. An image with `ENV JWT_ACCESS_SECRET=...` is a leak you can pull from a registry.

#### What config and secrets are

**Config** is not secret: port numbers, upstream URLs, feature flags, log level. A ConfigMap is a Kubernetes object that holds those keys. Change the ConfigMap, restart the pods (or use a tool that restarts them). A running process will not see the file change unless you coded a reload. Assume restart.

**Secrets** are passwords, JWT signing keys, database URLs with passwords, model API keys. A Kubernetes Secret is only base64. Base64 is not encryption. Anyone with permission to read Secrets in the namespace can read them. In the cloud, seal them with KMS or use an external secret store. For the local lab, a Secret that is **not in git** is the lesson.

Twelve-factor rule: the same image, different config per environment. Staging and prod do not get two Dockerfiles.

#### What a junior usually does

- Commits `deploy/k8s/secret.yaml` with the real key.
- Uses one Secret for every environment.
- Logs `process.env` on startup "to debug."
- Mounts the Docker socket into the app "so it can deploy itself." That is root on the node.

#### What production needs

- ConfigMap for URLs. Secret for `JWT_ACCESS_SECRET` and `DATABASE_URL`.
- The app still reads environment variables. Kubernetes injects them. The TypeScript does not import a Kubernetes client to find its own database URL.
- A startup check we already have: refuse to boot if the JWT secret is shorter than 32 characters. Keep that. The cluster will show CrashLoopBackOff, which is the correct signal.

#### What breaks at scale

A leaked signing key means every access token can be forged until you rotate. Rotation means: new key, short overlap or forced re-login, old key removed. If the key is inside the image, rotation means rebuild every service. If the key is a Secret, rotation means update the Secret and roll the pods. That is the operational difference.

#### Choice

We take ConfigMap + Secret injection, image stays generic.

We do not take HashiCorp Vault in this lab. Vault is a real product. Learning it before we can explain a Kubernetes Secret will hide the basics. Feature 16 is application-level secrets for customers. This lab is platform-level secrets for **our** processes.

#### Cloud later

AWS Secrets Manager or SSM, or External Secrets operator, feeds the same env vars. The application code stays. IAM decides which pod identity can read which secret. A node role that can read every secret is the junior IAM bug.

#### Build

- [ ] Example ConfigMap committed
- [ ] `secret.example.yaml` with fake values, and a README line: copy to `secret.yaml`, do not commit
- [ ] `.gitignore` entry if a local secret file would sit in the repo
- [ ] Gateway pod shows the upstream URL from the ConfigMap (`kubectl exec` print the URL only, never print the secret)

#### Done when

The image runs with two different ConfigMaps (local ports vs in-cluster DNS) without a rebuild.

---

### Lab P5 — Database connections under many copies

**Status:** `not_started`  
**Can run beside:** a product feature if you only add pool settings and a short ADR

#### Pre-context

Each Node process opens a pool of Postgres connections. That is invisible on a laptop with one process. It becomes an outage when you add pods.

#### What a pool is

Opening a TCP connection to Postgres is slow, so the process keeps a pool (for example 10 connections) and reuses them. TypeORM and `pg` both have pools. If you do not set a max, the default can be high.

**The math.** 2 gateway pods do not need Postgres. Identity, workspace, agent, conversation, runtime, web-fetch, knowledge, voice, and a migrate job do. Suppose 9 services × 2 replicas × 20 connections = 360 connections. A small managed Postgres might allow 100. The 101st connection waits or fails. The app looks "slow" and the database is only full of idle connections.

**PgBouncer** (or the RDS / Aurora proxy equivalent) sits between the app and Postgres and multiplexes many app connections onto fewer database connections. Write the formula in this lab. At 10,000 requests per second we will run more than two copies of several services. A pooler is **required before the production load test** if `services × replicas × pool_size` is near `max_connections`. Do not wait for the first outage. The pooler does not fix a missing `workspace_id` or a transaction that waits on a model call.

**Statement timeout.** A query without a timeout can hold a connection for minutes. Set a server or session timeout so a forgotten `SELECT` cannot pin a worker. Long migrations use a different role or a higher timeout. Do not use the request pool for a 20-minute index build.

**Idle in transaction.** A request that `BEGIN`s and then waits on an LLM call holds a connection and row locks. Publish must not call an LLM inside the transaction. This lab writes that rule next to the pool numbers.

#### What a junior usually does

- Sets pool size to 100 "so we are fast" on every service.
- Runs `CREATE INDEX` on a big table inside the web process at startup.
- Uses one shared database user with superuser rights for the app.

#### What production needs

- A written budget: max connections on the server, pool size per process, replica count, headroom for migrations and admin.
- App user can read and write product tables, not create roles.
- Slow query log or `statement_timeout` so a bad query shows up before it eats the pool.

#### What breaks at scale

Horizontal scale of the app **increases** database connections. Vertical scale of one database has a hard connection cap. People add pods and take down Postgres. This is the most common "we scaled the app" incident.

#### Choice

We take an explicit pool size in config, a short ADR with the formula, `statement_timeout` for the app role, and a pooler before the production load test when the formula says we are near the cap.

We do not take a second Postgres cluster per service as the first fix. We do not raise every pool to 100.

#### Cloud later

RDS and Aurora have `max_connections` tied to instance size. A bigger instance is vertical scale. It buys connection slots and I/O. It does not fix a query missing `workspace_id`. Read replicas are for read-heavy reports. Publish and "read after write" stay on the primary.

#### Build

- [ ] `docs/architecture/postgres-connections.md` with the formula using our real services, including identity, workspace, agent, conversation, runtime, web-fetch, knowledge, voice, and a migrate job
- [ ] Pool max set from env in one service as the pattern (identity or workspace), default small for local
- [ ] Decision line: when the formula exceeds Aurora `max_connections`, add PgBouncer or the managed proxy before Feature 30 load
- [ ] Note in the agent publish design: no network call inside the DB transaction

#### Done when

The doc lists a number for "safe replicas" on a Postgres that allows 100 connections, and the code default matches the doc.

---

### Lab P6 — Metrics that still work with two copies

**Status:** `not_started`  
**Can run beside:** P5

#### Pre-context

Logs tell a story for one request (`request_id`). They are a bad way to answer "how many 500s in the last five minutes?" across two pods.

#### What metrics, logs, and traces are

**Log.** One event. "This request failed." High detail. Expensive if you log the body.

**Metric.** A number over time. "500s per second." Cheap if the label set is small. This is what alerts use.

**Trace.** A tree of spans for one request: gateway → agent → workspace. You use it when one request is slow and the metric only says "p99 is bad."

All three should carry `request_id` or a trace id. They answer different questions. A junior picks one and ignores the other two.

**Cardinality.** A label is part of the metric name in practice. `status=500` is fine. `user_id=<uuid>` creates one series per user and will knock over Prometheus. Workspace id is 10,000 values. Do not put it on every metric. Put it in the log line when you are debugging one customer.

**Two copies.** Each pod exports its own counters. The scraper adds them. A counter in Node memory resets when the pod restarts. That is correct for a rate. It is wrong for "money this month." Money stays in Postgres (feature 26).

**RED and USE.** RED for the gateway: Rate, Errors, Duration. USE for the pool: Utilization, Saturation, Errors. You do not need 40 dashboards. You need these.

#### What a junior usually does

- Logs every request at debug in production and fills the disk.
- Alerts on CPU above 80% with no error alert. A retry storm can be a CPU success.
- Uses a global variable as the only dashboard.

#### What production needs

- `/metrics` or OTel export we already started with the collector in Compose.
- Counters: requests, errors by status class, upstream timeouts.
- Histogram: latency on the gateway.
- An alert file: error ratio over 5 minutes, and "readiness failing."

#### What breaks at scale

The metrics system dies from labels before the app dies from traffic. The app dies from a full connection pool while CPU looks calm. The dashboard must show pool waiting, not only CPU.

#### Choice

We take a small RED set on the gateway and the existing OTel collector path.

We do not take a metric per route template that includes raw ids.

#### Cloud later

Prometheus, Grafana, CloudWatch, or a vendor can scrape the same numbers. Do not rename metrics when you change vendors. Renames break alerts.

#### Build

- [ ] `docs/architecture/observability.md` with the metric list and the labels we allow
- [ ] One alert rule in `deploy/observability/`
- [ ] A curl that forces a 401 and a note showing `request_id` in the log

#### Done when

The doc answers "are we failing?" and "are we slow?" without telling anyone to grep a laptop.

---

### Lab P7 — CI builds the image

**Status:** `not_started`  
**Needs:** P1

#### Pre-context

A green test on a laptop is not a deploy. The cluster runs an image. CI is the place that runs tests and builds that image from a known git sha.

#### What CI is for

On every pull request: install, typecheck, unit tests that do not need a cloud account. On merge to the main branch: build images tagged with the git sha. Do not tag only `latest`.

CI is not a place to store production secrets. The JWT secret for tests is a fixed test string. The production secret stays in the secret store.

**Supply chain.** Pin actions and base images. A junior points `uses: some-action@main` and trusts whatever that branch is tomorrow. Pin a sha or a release.

**Tests that need Redis.** Gateway tests need Redis. CI should start Redis as a service container, or skip those tests with a clear line. A silent skip is how a broken rate limit ships. Prefer a real Redis service in CI for the gateway job.

#### What a junior usually does

- Builds the image on their laptop and `docker push`es from a home network.
- Runs `curl | bash` in CI from an unpinned URL.
- Makes the deploy job use an admin cloud key that can delete the account.

#### What production needs

- PR checks block merge when tests fail.
- Image tag equals the commit sha.
- The deploy job, when it exists, can roll the gateway image and cannot rewrite IAM for the whole company. Smallest permission that can push an image and update a Deployment.

#### What breaks at scale

This lab does not fail because of request rate. It breaks when two people ship and nobody knows which image is in the cluster. The sha tag is the fix.

#### Choice

We take GitHub Actions (the repo is on GitHub): test job, image job on main.

We do not take a custom Jenkins server for this program.

#### Cloud later

The same workflow pushes to ECR and runs `kubectl set image` or updates a manifest. Feature 29 wires the cluster. This lab can push to GHCR first so the pipeline exists.

#### Build

- [ ] `.github/workflows/ci.yml` runs typecheck and tests
- [ ] Image build job documented, tag is the github sha
- [ ] README line: how to see which sha is deployed

#### Done when

A pull request shows a pass or fail without a human running `pnpm test` as the only gate.

---

### Lab P8 — The network picture

**Status:** `not_started`  
**Needs:** P2

#### Pre-context

On the laptop every port is open: 3000, 3001, 3002, 3003, 5433. That is convenient and it is not the production picture.

#### What the network is

**Public.** The internet can reach the gateway, and only the gateway. TLS ends at the load balancer or ingress. Inside the cluster, traffic can be HTTP on a private network. Still authenticate. Private does not mean trusted forever. A stolen pod can call other services. The gateway already checks JWT. Internal services still check the token or the auth header.

**Private.** Identity, workspace, agent, Postgres, Redis have no public IP. Security groups or Kubernetes network policy drop traffic that does not come from allowed pods.

**East-west.** Service to service. This is where a missing timeout hangs a chain: gateway waits on agent, agent waits on workspace, workspace waits on Postgres. Every hop has a timeout. We already return 503 or 504 when an upstream dies. The network picture is why that code exists.

**Egress.** Runtime and tools call the public internet (LLM vendors, customer APIs). A cluster that allows all egress is normal at the start and dangerous later. An allow-list belongs with tools (feature 15). This lab only draws the picture and blocks **inbound** access to the database.

#### What a junior usually does

- Publishes Postgres `0.0.0.0:5432` in the cloud security group "for a GUI."
- Puts all pods in one flat network and calls it done because "it is inside the VPC."
- Forgets that `kubectl port-forward` is an admin backdoor. It is fine for debug. It is not the product path.

#### What production needs

- A one-page diagram in the repo: user → ingress → gateway → services → data stores.
- NetworkPolicy or a documented security group: database accepts traffic only from app pods.
- No NodePort for Postgres in the local manifest examples.

#### What breaks at scale

The scale failure is blast radius. One public database is every tenant. One open admin port is a full read of chats. This is not theoretical. It is the usual cloud incident.

#### Choice

We take a diagram plus a local NetworkPolicy sketch that denies ingress to Postgres except from app namespaces.

We do not take a service mesh in this lab.

#### Cloud later

The diagram maps to: ALB or NLB → gateway Service → cluster IP services → RDS and ElastiCache in private subnets. NAT gateway for egress has a cost. Know that egress to the LLM is not free.

#### Build

- [ ] `docs/architecture/network.md` with the diagram and the sentence "only the gateway is public"
- [ ] Example NetworkPolicy YAML, even if the local cluster needs a plugin to enforce it. The YAML is the learning object. Say if kind is not enforcing it yet.

#### Done when

A reader can point at the only public box and at the data stores that have no public port.

---

### How labs pair with product work

| Day | Person A can ship | Person B can ship |
| --- | --- | --- |
| A product day | Feature 08 versions | Feature 09 conversations |
| A platform day | Lab P1 or P2 (images and two gateway pods) | Feature 08 or 09 if the files do not overlap |
| A deep study day | Lab P3 probes and shutdown | Lab P5 connection math |

Do not turn a lab into a rewrite of the agent service. If a lab finds a real bug (SIGTERM not reaching Node, pool default too high), fix that bug in a small change and record it in the daily log.

### What we are not studying in these labs

- A service mesh (Istio, Linkerd) as the first step.
- Multi-region active-active. Feature 30 talks about recovery in one region first.
- Building our own Kubernetes. We use a local cluster, then a managed control plane.
- Custom schedulers, operators, and CRDs. We do not have a problem that needs them.

---

## 9. Finished features (short record)

The long day-by-day notes for 01–07 were the old format. The decisions still live in ADR 0001–0007. Do not rebuild these.

What we learned that still applies:

- One Postgres database, shared tables, `workspace_id` on every tenant row. A database per customer does not fit 10,000 organizations in this program.
- Redis is for counters, sessions, and short locks. If Redis is empty, users and agents must still exist in Postgres.
- The gateway is the public door. Internal ports are for local debug.
- Permission checks use one function and shared strings in `packages/contracts`. Scattered `if role === admin` will drift.
- Agent updates use `expected_version`. Two saves must not silently overwrite.

---

## 10. Feature 08 — Agent versions and publish

**Status:** `done`  
**Needs:** agent drafts  
**Can run beside:** Feature 09  
**Deep topic (day 2):** transactions and lost updates  
**Owns:** `services/agent-service` version code, and the agent gateway routes for publish and versions

### Pre-context

We can create and edit an agent draft. The draft row changes in place. Publish on the workspace service only checks permission. Nothing stores "this exact prompt was production at 3pm."

### What this is

A **version** is a copy of the draft at the moment someone publishes. After that, the copy does not change. **Publish** inserts that copy and moves a pointer that means "production is this version." **Rollback** moves the pointer to an older version. It does not edit the old copy. The draft stays editable for the next publish.

### Why now

The runtime (feature 12) will read "what is production." If we point it at the draft row, every edit changes live chats, and we cannot roll back.

### Junior shortcut

The junior shortcut updates the live agent and stores history as a JSON array on the same row. Two people publishing at once overwrite the array. A bug that updates a "history" object rewrites the past. There is no single pointer a runtime can read by primary key.

### Production shape

Postgres holds `agent_versions` (insert only) and a production pointer on the agent (or a small pointer row). The publish function runs in **one database transaction**: insert version, move pointer, commit. If the process dies in the middle, the transaction rolls back and production still points at the old version.

Two app copies are safe because the database is the lock, not a variable in Node.

### What breaks at scale

Publish is rare. The dangerous load is the runtime reading the pointer on every chat turn. That read must be a primary-key lookup. A long transaction that also calls an LLM will block those reads. Publish must only copy rows and move the pointer.

Two publishers with the same `base_version`: one commit wins, the other gets 409. If we skip `base_version`, both think they published their own draft.

### Choice

We take immutable version rows plus a pointer, with `base_version` on publish.

We reject a git repo per agent. Git is a poor way to answer "what is production for this workspace" at chat speed.

We reject blocking publish on an eval score. That couples two unfinished systems. Eval can gate publish later.

Cost: more tables, and clients must send `base_version`.

### Cloud later

The table stays on managed Postgres. Publish reads and writes stay on the primary so a replica cannot serve a stale pointer after success. The app stays stateless.

### Low-level design

- Table `agent_versions`: id, workspace_id, agent_id, version number, snapshot JSON (the draft fields), created_at, created_by. No updates. A test or a DB privilege should make updates fail.
- Pointer: `production_version_id` on the agent, or a `agent_release` row. Include `workspace_id` on every query.
- `POST .../agents/{id}/publish` body: `base_version`. Success returns the new pointer.
- `POST .../rollback` body: target version id. Moves the pointer only.
- `GET` list versions, `GET` diff as a read of two snapshots (the diff is not a second source of truth).
- States for the draft environment can be draft, testing, staging, production as labels. Illegal jumps return 409. The immutable row is still the source of what was published.
- If the version insert succeeds and the pointer update fails, the transaction rolls back.
- Gateway: these routes go to the agent service. Remove the workspace publish stub once the real route exists, or keep the permission check in one place only. Do not have two publish implementations.
- Do not log full instructions.

### Learn today

Write notes for headings 1–10 in section 7, using this feature. Draw the transaction: insert version, move pointer, commit.

### Build today

**Track A (this feature, end to end)**

- [x] Migration for versions and the pointer
- [x] Publish, rollback, list, diff
- [x] Reject stale `base_version` with 409
- [x] Test: two publishes, one conflict; cross-workspace version id returns 404
- [x] Gateway routes and a short curl example
- [x] ADR `docs/adr/0009-agent-versioning.md` with the failure lines above

**Track B** is feature 09. Do not split this feature into "one person writes SQL, the other only writes docs."

### Done when

A caller can publish, see a frozen version, edit the draft without changing that version, roll back the pointer, and get 409 if they publish from a stale base. Another workspace cannot read the version.

### Still unsafe

Runtime (Feature 12) reads the production pointer per turn. A conversation already in flight may still finish on the version id bound at turn start. We do not kill a model call mid-flight inside this feature.

---

## 11. Feature 09 — Conversation service

**Status:** `done`  
**Needs:** gateway and workspace (agent id may be empty until versions exist)  
**Can run beside:** Feature 08  
**Deep topic (day 2):** idempotency  
**Owns:** `services/conversation-service` and `proxy-conversation.routes.ts`

### Pre-context

We have users, workspaces, and agent drafts. We do not store chats. Redis is not the chat database. If we only kept messages in memory, a restart would delete the inbox.

### What this is

A **conversation** is a thread inside a workspace. A **message** is one row with a sequence number `seq` (1, 2, 3, …). The client sends an **idempotency key** so a retry does not create a second message.

### Why now

The runtime needs a place to append user and assistant messages. The widget and the inbox will read the same rows later. If we invent a second chat store inside the runtime, we will migrate under load.

### Junior shortcut

The junior shortcut inserts a message with `count(*) + 1` as the sequence, with no idempotency key. Two requests at once get the same `seq` or a gap. A timeout on the client causes a duplicate user message. Listing "all messages for the org" scans every tenant.

### Production shape

Postgres is the source of truth. `seq` is allocated in the same transaction as the insert (a counter on the conversation row, `UPDATE ... SET next_seq = next_seq + 1 RETURNING`, then insert the message). Unique `(conversation_id, idempotency_key)` makes the retry return the first row.

Two app copies are safe because the counter lives in Postgres, not in a process variable.

### What breaks at scale

Millions of messages per day will need an index on `(workspace_id, conversation_id, seq)`. A list API that loads every message in the workspace will time out. The hot path is "append one message" and "read this conversation after seq N."

Partitioning and archival are not this feature. Call that out as still unsafe. Do not block the first correct append on a partition design.

### Choice

We take Postgres, a per-conversation counter, and an idempotency key.

We reject Redis as the only store. A flush would delete chats.

We reject a gap-free sequence built only in the application without a transaction. Two copies will race.

Cost: every send is a transaction. That is cheap next to a model call, and it is the correctness boundary.

### Cloud later

Managed Postgres. The HTTP handler stays stateless. Attachments, when they exist, go to object storage, not the local disk. The local disk on a cloud host disappears on restart.

### Low-level design

- `conversations`: id, workspace_id, optional agent_id, status, created_at
- `messages`: id, workspace_id, conversation_id, seq, role, body, idempotency_key, created_at
- Unique `(conversation_id, idempotency_key)` and unique `(conversation_id, seq)`
- Index `(workspace_id, conversation_id, seq)`
- `POST /v1/workspaces/{id}/conversations`
- `POST /v1/workspaces/{id}/conversations/{id}/messages` with `idempotency_key`
- `GET` messages with `after_seq` cursor
- Every query includes `workspace_id`. Wrong workspace returns 404.
- Retry with the same key returns the original message and does not increment `seq`.
- If Postgres is down, return 503. Do not write the message to a local file.

### Learn today

Section 7 headings, plus one example of a retry that must not double-insert.

### Build today

**Track A (this feature, end to end)**

- [x] New service, migration, `make conversation-migrate`
- [x] Create conversation, append, list by seq
- [x] Idempotency test and cross-workspace test
- [x] Gateway proxy file and README smoke steps
- [x] ADR for the failure policy

### Done when

A chat survives a Redis flush. Messages have a stable order. A retry does not duplicate. Another workspace cannot read the thread.

### Still unsafe

No partitioning, no archive job, no realtime push. The widget will need the cursor fields (`conversation_id`, `after_seq`) which this API must already return.

---

## 11A. Feature 09B — Membership cache

**Status:** `done` (2026-09-28)  
**Needs:** workspace  
**Placement in product path:** §5B — first item on the current focus path (before ingest and retrieval)  
**Can run beside:** Feature 11 (different packages day: land contracts + one service consumer first)  
**Deep topic (day 2):** fail-closed vs fallback when Redis is empty  
**Owns:** shared helper in `packages/*` (or gateway + services adopt), ADR for cache policy

### Pre-context

Agent, conversation, runtime, and voice edge check workspace membership. Today that is often an HTTP call to workspace-service per request. At 10,000 HTTP rps and at thousands of voice turns per minute, that hop becomes the bottleneck.

### What this is

A short TTL cache in Redis: `(user_id, workspace_id) → { roles, ok }`. Postgres and workspace-service stay the source of truth. On cache miss, call workspace once and set the key. On revoke or role change, invalidate or wait for TTL (pick one in the ADR and test it).

### Why now

Feature 12 and Feature 21 both need membership on every turn. Voice cannot add a fourth HTTP hop per utterance.

### Junior shortcut

Cache forever with no invalidation. A removed member keeps access until restart. Or cache in a `Map` per process so two gateway copies disagree.

### Production shape

Shared Redis key prefix. TTL in the 30–120 second range unless the ADR says otherwise. **Write path** (role change, remove member): invalidate or fail closed. **Redis down:** document fail-closed on voice new calls and runtime turns, or fallback to workspace HTTP with a strict timeout — pick one.

### Low-level design

- Contract type `MembershipSnapshot` in `packages/contracts`
- Test: two processes share the same cached allow
- Test: after simulated revoke, access denied within the policy window
- No membership check removed from services; only the hot path is cached

### Done when

Runtime (or gateway proxy) can serve repeated reads without workspace HTTP on every call, and tests prove cross-process consistency.

### Still unsafe

No global session store for end users of the widget. This cache is staff/API membership only.

---

## 12. Feature 10 — Model gateway

**Status:** `done`  
**Needs:** none (do not wait for the runtime)  
**Can run beside:** Feature 10B or 11  
**Deep topic (day 2):** timeouts, one retry, circuit breaker  
**Owns:** `services/model-gateway` (ADR 0010, `docs/api/model-gateway-errors.md`)

### Pre-context

No service calls an LLM yet. When the runtime exists, it must not import a vendor SDK. The first vendor outage would become a rewrite of the runtime.

### What this is

A small service with two operations: **complete** (one full answer) and **stream** (tokens over time). Vendor SDKs stay inside this service. Callers see our error codes, not the vendor's raw body.

### Why now

The runtime should depend on a stable interface. Usage fields (model, tokens, latency) must be recorded now or billing cannot be rebuilt later.

### Junior shortcut

The junior shortcut calls the vendor from the runtime and retries five times on any error. A timeout holds a worker until the process is killed. A stream that already showed tokens gets a second answer glued on. Logs print the API key.

### Production shape

Each call has a timeout. We retry **once**, and only when no token was sent to the caller. If a fallback model is configured, we call it once. If the error rate is high, the circuit breaker opens and we return a typed error instead of retrying.

Keys live in the environment for now. They must not appear in logs.

This service records usage. It does not send invoices. It enforces a **global outbound cap** (config number) so 20,000 peak HTTP requests cannot open 20,000 vendor connections. Per-workspace caps live in the runtime and share Redis so two runtime copies agree. When the cap is full, return a typed error or queue. Do not retry until the vendor recovers.

### What breaks at scale

10,000 API requests per second sustained (20,000 peak) is not 10,000 model calls per second. Model calls are slow and billed. A retry storm at peak multiplies the bill. One workspace must not be able to occupy every outbound connection. Put a cap in the design even if the first cap is a simple config number. Voice adds a second budget: 5,000 concurrent inbound calls and 5,000 concurrent outbound calls, each holding a long connection. Consider a separate **in-flight cap** or pool for voice-originated model calls so chat and phone do not share one undifferentiated limit at peak.

### Choice

We take our own model gateway, two providers so fallback is real, timeout, one safe retry, optional fallback.

We reject "the runtime imports the vendor SDK."

We reject an infinite walk over every provider we have keys for.

Cost: we maintain an adapter per vendor.

### Cloud later

The service stays stateless. Keys move to a secret store (feature 16, then the cloud secret manager). Timeouts stay in code. The cloud load balancer will not fix a missing timeout.

### Low-level design

- `POST /internal/complete` and `POST /internal/stream` (gateway may keep these off the public internet until the runtime is the only caller)
- Map timeout, vendor 429, and vendor 5xx to our error envelope with `request_id`
- Emit a usage record: provider, model, input tokens, output tokens, latency, workspace_id. A log event is enough. No invoice math. Do not write a billing row on this request.
- Global outbound connection / in-flight cap. Reject or queue when full.
- Test with a fake vendor: timeout, 429 once, fallback when the first call fails before tokens, no second full answer after tokens started
- If the vendor hangs, the caller sees timeout. The process stays up.

### Learn today

Section 7, plus a drawing of timeout → one retry → fallback → typed error.

### Build today

End-to-end service, fake provider in tests, ADR, and a short error table in `docs/api/`.

### Done when

A caller can complete and stream against the fake provider. A hung provider returns a timeout. Usage fields are present. No key in logs.

### Still unsafe

No money ledger yet (Feature 26). No hard spend budget per tenant. Streaming to a browser is the widget's job later. This service only speaks to the runtime and to tests. The global cap in this feature is a connection cap, not a dollar cap.

---

## 13. Feature 10B — Web fetch service

**Status:** `done`  
**Needs:** workspace (membership checks on every call)  
**Can run beside:** Feature 11 (different directories: `services/web-fetch-service` vs knowledge ingest)  
**Deep topic (day 2):** cost policy, provider failover, and queues  
**Owns:** `services/web-fetch-service` (local port **3007**), ADR **0011**, `packages/contracts` web-fetch types, `docs/api/web-fetch-errors.md`

### Pre-context

Knowledge ingest, tools, leads, and campaigns all need **public web content** (one URL, many pages, or search results). Olostep is one vendor. If we embed Olostep inside the knowledge worker, the runtime, and the lead worker, we will ship four different timeout, retry, and billing behaviors. One bad crawl in the gateway HTTP request will hold a worker and bypass tenant caps.

### What this is

A dedicated internal service — **web acquisition** — that performs **acquisition actions** for a workspace: **scrape** (one URL), **crawl** (many pages under a seed), **map** (discover URLs), and **search** (web search). Callers (knowledge ingest, runtime tool stage, lead/campaign workers) call **our** API. Vendor HTTP stays inside **provider adapters**. Olostep is the first adapter; **direct HTTP fetch** (cheap, no JS) is the second so we can route simple pages without paid credits. More vendors (Firecrawl, Jina, Browserless, and so on) plug in without renaming the service.

### Why now

Feature 11 will add URL and site sources. Feature 15 will add live `fetch_url` / `search_web` tools. Feature 23–24 will scrape prospect sites. If each feature imports a vendor SDK, cost and failure policy diverge and we cannot enforce a workspace budget at 10,000 organizations.

### Junior shortcut

The junior shortcut calls Olostep from the knowledge worker with no timeout, retries every 5xx forever, and logs the API key. Crawls run inside `POST /knowledge/sources` so one 500-page site blocks the gateway. There is no record of credits spent, so Finance cannot reconcile Feature 26. When Olostep is down, ingest silently fails with a generic 500 and no fallback provider.

### Production shape

**HTTP ingress is thin.** `POST /internal/acquire` (or action-specific routes) validates `workspace_id`, runs **policy**, then either executes synchronously for a single scrape with a short deadline or **enqueues** a long crawl/search job and returns `job_id` + status. Workers call providers with per-action timeouts, **one safe retry** only when no partial billable output was committed, and a **circuit breaker per provider profile**.

**Policy engine (required in v1, not “later”):** Before any paid action, evaluate:

- Global in-flight cap (Redis, same pattern as model-gateway).
- Per-workspace **daily acquisition unit budget** (config + Redis counter; Postgres is the audit trail via usage facts).
- **Provider selection:** e.g. `direct_http` for allow-listed hosts and `text/html` only; Olostep when JS rendering or anti-bot is needed; deny if budget exhausted → typed `ACQUISITION_BUDGET_EXCEEDED`, not a hang.
- **Maintenance switches:** disable a provider profile via env/config without redeploying callers; open circuit → try next profile in the ordered list once, then fail typed.

**Cost accounting:** Every completed action emits a **usage fact**: `workspace_id`, `action`, `provider`, `units` (pages, queries, or scrape count), `estimated_cost_micros` (from a static price table in config until Feature 26), `request_id`, idempotency key. No invoice math on the hot path. Knowledge ingest stores normalized **markdown/text** in object storage (or a blob table locally); it does not store vendor raw JSON as the source of truth.

**Secrets:** Provider API keys live in this service’s environment (later Feature 16 / secret manager). Keys never appear in logs or in caller responses.

### What breaks at scale

Crawl and search are **slow and billed per page or query**. Ten workspaces starting full-site crawls at once must **queue**, not open ten thousand outbound connections from one Node process. One workspace must not exhaust the global provider rate limit for everyone. A missing `workspace_id` on a stored artifact is a **data leak**, not a performance issue. At 10,000 HTTP rps on the gateway, **zero** of those requests should be long-running crawls; crawls are jobs on this service’s worker pool.

### Choice

We take a **dedicated web-fetch-service**, provider adapter interface, policy + usage facts in v1, queue for crawl/search, Olostep + direct HTTP as first two providers.

We reject naming the service after Olostep or putting vendor SDKs in knowledge ingest, runtime, or gateway.

We reject synchronous full-site crawl on any public API route.

Cost: we maintain adapters and a price table. That cost is smaller than reconciling four divergent integrations after launch.

### Cloud later

Workers scale horizontally. Redis caps and budgets are shared across replicas. Provider keys move to the managed secret store. The queue becomes SQS (local ElasticMQ already exists). Egress from this service is expected; firewall allow-lists are a platform concern (lab P8), product allow-lists stay in policy for customer URLs.

### Low-level design

- Internal auth: same internal token pattern as model-gateway (`Authorization: Bearer` shared secret); not exposed on gateway :3000 until a product route needs it (tools may call via runtime → internal only).
- `POST /internal/scrape` — sync, strict timeout (e.g. 30s), returns normalized text + metadata.
- `POST /internal/crawl` — async job, returns `job_id`; worker pages with max depth/pages from request caps.
- `POST /internal/search` — async or sync with low `max_results` cap.
- `GET /internal/jobs/:jobId` — status, error code, artifact location pointer (not full body in list APIs).
- Provider interface: `scrape`, `crawlPage`, `search`, health probe; each profile has `name`, `enabled`, `priority`, `unit_cost_micros`.
- Policy module: `decide(context) → { allow, provider_profile, reason }` — unit-test without network.
- Postgres (optional v1): `acquisition_jobs` for job status; artifacts in object storage path `workspace_id/job_id/...`.
- Tests: fake provider; budget deny; circuit opens → fallback profile; idempotent job create; no API key in logs.

### Learn today

Section 7 headings, plus a table of **who calls web acquisition** (knowledge 11, tools 15, leads 24, campaigns 23) and which actions are sync vs queued.

### Build today

End-to-end service on port 3007, fake provider in tests, Olostep adapter behind env flag, ADR 0011, contracts types, error doc, README smoke with `WEB_ACQUISITION_INTERNAL_TOKEN`.

### Done when

A caller can scrape via fake provider with usage fields present. A crawl job returns before all pages finish and completes in the worker. Budget policy returns a typed error without calling the vendor. Two service replicas share the Redis in-flight cap. No vendor key in logs.

### Still unsafe

No dollar invoicing (Feature 26). No customer-visible “web credits” UI. No browser automation farm of our own. Legal/compliance for crawling customer sites is workspace responsibility; we log `workspace_id` and seed URL for audit (Feature 27).

---

## 14. Feature 11 — Knowledge ingest

**Status:** `done` (2026-09-28)  
**Needs:** Feature 10B, workspace, OpenSearch from `make up`  
**Placement in product path:** §5B — after **09B**, before **13** (retrieval)  
**Can run beside:** Feature 09B (different service directories; do not edit `packages/*` the same day as 09B)  
**Deep topic (day 2):** queues and backpressure  
**Owns:** `services/knowledge-service` (or equivalent) plus ingest worker. Do not put parsing, embedding, or **web fetch** inside the gateway request.

### Pre-context

OpenSearch is running and empty of product data. Agents have no documents. Web acquisition (10B) is the only place that calls scrape/crawl/search vendors.

### What this is

A business adds a **source**: pasted text, uploaded file, **single URL**, or **site crawl** (seed URL + limits). We store source metadata, split content into chunks, embed, and index with `workspace_id`. Ingest status is visible: queued, running, ready, failed. For URL and site sources, the ingest worker **requests normalized text from web acquisition (10B)** and then runs the same chunk → embed → index pipeline as file/text sources.

### Why now

Retrieval (feature 13) needs indexed chunks. If the runtime invents a one-off loader, delete and tenant filters will be missing.

### Junior shortcut

The junior shortcut parses and embeds inside the HTTP request. A large file holds the gateway worker. A crash in the middle leaves half an index with no status. Chunks are stored without `workspace_id`, so search returns another tenant's text.

### Production shape

The HTTP request only records the source and enqueues a job. A worker does parse, chunk, embed, index. The job queue retries with a dead-letter path. OpenSearch holds the search documents. Postgres holds source metadata and status. Object storage holds the file bytes when we are not on a laptop disk.

Two workers may pick jobs. The job id must be idempotent so the same source is not indexed twice as two truths. Use a source version.

### What breaks at scale

Embedding is the slow, paid step. 1,000 uploads at once must queue, not stampede the embedding API. Search load must not sit on the Postgres primary. A missing workspace filter is a data leak, not a slow query.

### Choice

We take Postgres for status, a queue for work, OpenSearch for chunks.

We reject doing the whole pipeline inside the request.

We reject pgvector on the primary as the long-term search path. It is fine for a demo and dangerous when search and writes share one database at our target rate.

Cost: we operate a queue and a search cluster. Locally, Compose already has both.

### Cloud later

S3 for files, a managed queue, managed OpenSearch. The worker is a separate process so we can scale it without scaling the gateway.

### Low-level design

- `sources`: id, workspace_id, name, `kind` (`text` | `file` | `url` | `site`), status, error, `acquisition_job_id` when kind is `url` or `site`, created_at
- `chunks` metadata in Postgres optional; search docs in OpenSearch with `workspace_id`, `source_id`, text, vector
- URL/site: enqueue ingest only after 10B returns text or crawl job completes; respect 10B budget errors and surface them on the source row
- Delete source: mark deleted, enqueue delete, remove search docs. A failed delete stays visible.
- Re-index creates a new source version. Old chunks for that version are removed when the new version is ready, or we search by active version. Pick one and test it.
- Do not log full document bodies at info level.

### Learn today

Section 7, plus where the HTTP request ends and the worker begins.

### Build today

End-to-end: create source, worker indexes a small text, search by workspace returns only that workspace, failed embed sets status failed and can retry.

### Done when

One document becomes searchable chunks for one workspace only. A second workspace does not see them. The upload request returns before embedding finishes.

### Still unsafe

No PDF parser required for the first slice if plain text works end to end. No reranker yet. Site-wide crawl depth and page caps are enforced in **10B**, not reimplemented here.

---

## 15. Feature 12 — Agent runtime

**Status:** `done` (2026-09-28 — chat turn path)  
**Needs:** 08, 09, and 10 (met); **09B** before production scale on the turn path  
**Deep topic (day 2):** streaming and "do not retry after tokens" (still open)  
**Owns:** `services/runtime-service`. It calls model gateway and conversation. It does not own their tables.

**Shipped (2026-09-28):** `services/runtime-service` :3006, gateway `proxy-runtime`, non-streaming `POST .../turns`, production pointer, `agent_version_id` on assistant messages, idempotency, 409 unpublished, 404 cross-workspace; tests in `turns.test.ts`.

### Pre-context

We can publish an agent, store messages, and call a model behind our gateway. Nothing connects them.

### What this is

The runtime loads the **production pointer**, loads the conversation, calls the model gateway, and appends the assistant message. The first version is a single model call. Tools, retrieval, and memory are later steps in this same loop.

### Why now

This is the first time a configured agent can answer. If we start it before versions exist, it binds to a mutable draft.

### Junior shortcut

The junior shortcut reads the draft row, calls the vendor SDK, and writes the reply with no timeout. A publish during the turn changes the prompt mid-flight with no record of which version ran. A client retry creates two assistant messages.

### Production shape

At the start of the turn, read the production version id and keep it on the message row (`agent_version_id`). The turn finishes on that snapshot even if someone publishes again. Model calls go through the model gateway. The assistant message uses an idempotency key.

The process is stateless. Two runtimes can handle different conversations. A limit per workspace caps how many model calls that workspace can run at once so one tenant cannot fill every worker. That cap lives in Redis, not in process memory, because two runtime copies must share it. Membership for the turn path uses the same short Redis cache as other services; do not add a fourth HTTP hop to workspace on every token.

### What breaks at scale

The slow part is the model, not the CRUD. Holding the HTTP connection during a long completion limits how many chats one process can serve. Streaming helps the user see tokens, but the gateway must not do the model work itself. It proxies. Connection count becomes the limit before CPU does.

### Choice

We take a separate runtime service, production pointer only, model gateway only, conversation service for storage.

We reject a second agent engine for voice later. Voice will call this runtime.

We reject putting the vendor SDK here.

Cost: more network hops. Each hop needs a timeout.

### Cloud later

Scale the runtime horizontally. The cap per workspace must live in Redis, not in one process. Health checks must fail when the model gateway is unreachable if we want the load balancer to stop sending traffic. Decide that in the ADR and test it. Runtime is HTTP and streams. It is not the 5,000 + 5,000 voice sockets.

### Low-level design

- `POST /v1/workspaces/{id}/conversations/{id}/turns` with idempotency key
- Load pointer; 409 if nothing is published
- Append user message if the client sent text and the key is new
- Call model gateway with timeout
- Append assistant message with the version id
- Stream path: proxy tokens; on failure before tokens, return the typed error; after tokens, mark the turn failed in storage and do not start a second full answer on the same stream
- Cross-workspace conversation id returns 404
- **Voice contract (required for Feature 21):** internal or public turn with `channel: voice`, stricter `deadline_ms`, optional shorter history window; same idempotency and `agent_version_id` rules as chat. Runtime does not hold audio sockets.
- Before model call: if conversation `state` is `human` (Feature 18), return typed error and do not call model gateway

### Learn today

Section 7. Write the turn as a sequence of calls and the status code for each failure. Add the voice-turn sequence with a 8–12s deadline example.

### Build today

One non-streaming turn against the fake model gateway, plus one test that an unpublished agent cannot run, plus one test that workspace B cannot run workspace A's conversation. Document the voice-turn request shape in `packages/contracts` even if voice-service ships later.

### Done when

A published agent can answer once, the message history shows the reply, and the stored row records which version ran. Voice-service can call the documented voice-turn API in tests (fake audio not required in runtime repo).

### Still unsafe

No streaming turn path yet. No per-workspace model concurrency cap in Redis. **Voice-turn** contract (`channel: voice`, `deadline_ms`) deferred to Feature **21** prep (see §5C). No tools, no retrieval (Feature 13), no memory, no widget. Human handoff (`state=human`, Feature 18) not wired. Membership still HTTP to workspace on downstream services until **09B**. Retrieval on voice calls needs a strict budget (Feature 13 addendum).

---

## 16. Feature 13 — Retrieval in the runtime

**Status:** `done` (2026-09-28)  
**Needs:** 11 and 12  
**Placement in product path:** §5B — after **11** ingest (embed + index); extends Feature **12** runtime loop  
**Can run beside:** Feature 14 if the files do not overlap. If both change the runtime loop, only one person edits the runtime that day. The other can build the retrieval query API in the knowledge service.  
**Deep topic:** tenant leaks in search

### Pre-context

Chunks can be indexed. The runtime answers from the prompt only.

### What this is

Before the model call, the runtime asks the knowledge service for chunks in **this workspace**, puts them into the prompt, and stores which chunk ids were used (so we can debug later).

### Why now

Without a tenant filter at retrieval time, the model will quote another customer's document. That is the failure we are designing against.

### Junior shortcut

Search the whole index with the user text and trust the model not to mix tenants. Or filter in application code after a wide search. Both leak or waste cost.

### Production shape

The search request includes `workspace_id` as a filter in the search engine, not only in Node after the fact. The runtime times out the search and still answers, or fails the turn, based on a written policy. Pick one: "answer without docs" vs "fail the turn." Write it in the ADR. Default for this product: fail the turn with a typed error if search is required and search is down, so we do not silently drop a company's knowledge. If the agent has no sources, skip retrieval.

### What breaks at scale

A search that returns huge chunks will blow the model context and the bill. Cap the number of chunks and the characters. At 1,000 chats per second, search latency becomes part of p99. The lookup must use the index, not a scan of every chunk in Postgres.

### Choice

We take workspace-filtered search, a hard cap on chunks, and a timeout.

We reject "search everything and hope."

Cost: answers get worse when the cap is too small. That is a product knob, not a reason to remove the filter.

### Cloud later

Managed OpenSearch. The runtime still passes tenant id. The cloud service will not add the filter for us.

### Low-level design

- Knowledge service: `POST /internal/retrieve` with workspace id, query text, limit
- Runtime calls it with the same timeout policy as other hops
- Persist `retrieved_chunk_ids` on the assistant message or a side table
- Test: two workspaces, similar text, only the caller's chunks return

### Done when

A turn includes only the caller's documents. A test fails if the other workspace's text appears.

### Still unsafe

No rerank model required in the first slice. No citation UI. Say so.

---

## 17. Feature 14 — Memory

**Status:** `done`  
**Needs:** conversations (09) and runtime (12) — both done  
**Placement in product path:** §5B — after **13** retrieval; parallel option on the board is **15** tools (different directories if runtime is not shared the same day)  
**Can run beside:** Feature 15 if only one person edits `runtime-service` per day; the other owns memory CRUD service or docs  
**Deep topic:** what is allowed in memory vs what is a secret  
**Owns:** new `memory-service` (or conversation-adjacent module — pick one service directory on day 1 and document in ADR); runtime read path in `services/runtime-service`  
**Extended learn-day narrative:** [docs/ai-roadmap.md § Feature 14 — Memory](./ai-roadmap.md#feature-14--memory)

### Pre-context

Each turn already loads: published agent version (08), conversation messages (09), model gateway (10), optional **knowledge retrieval** (11 + 13) when `ready_count > 0`, with membership cache (09B) and gateway membership on workspace routes.

There is still no durable store for **per end-user** preferences and facts ("prefers email", "timezone", "language") that should survive across conversations without sending the full message history every time.

Staff **workspace members** have roles in workspace-service. That is not memory. **Knowledge chunks** in OpenSearch are company documents, not per-chatter facts.

### What this is

**Memory** is a **small, capped set of text facts** in **Postgres**, keyed by **`workspace_id`** and **`subject_key`**.

- **`subject_key`** identifies the **end user of the chat** (widget visitor, API customer's user), not the logged-in dashboard `actorId`.
- The **runtime** **reads** facts into the prompt before the model call (separate section from RAG chunks).
- **Writes** go through an explicit HTTP API with validation in v1 — not "the model remembered it" as automatic persistence.

The **conversation** table remains the complete ordered history. Memory is a **bounded summary layer**.

### Why now

Unbounded prompt history makes **token cost** and **latency** grow without limit. At millions of messages per day and 10,000+ concurrent chats, we need a deliberate cap.

RAG (13) answers from **indexed documents**. Memory answers **about this person** in a few lines. Building tools (15) before memory is allowed on the board, but memory is the smaller, knowledge-adjacent step for "smarter chat" without side effects.

### Junior shortcut

One JSON blob per workspace with no `workspace_id` on every query; using **staff user id** as `subject_key`; letting the model store API keys and card numbers; auto-saving every assistant reply as a fact; loading **all facts in the workspace** on every turn.

**Failure:** cross-tenant leak, secrets in logs, or prompts that still exceed context because caps were missing.

### Production shape

- **Postgres** is source of truth for facts (not OpenSearch, not Redis).
- **Caps:** max facts per `(workspace_id, subject_key)`, max bytes per fact — reject at API.
- **Denylist** in ADR: passwords, payment card numbers, raw bearer tokens, API keys (use **Feature 16** secrets by reference later).
- **Stateless runtime replicas:** read memory via HTTP or shared client; no in-process fact cache as source of truth (optional Redis cache is a later optimization).
- **Two replicas safe:** writes use clear upsert or version rule; reads are indexed lookups.

### What breaks at scale

| Failure | At 10,000+ orgs / 10k req/s sustained |
| --- | --- |
| Query all facts for `workspace_id` only | Sequential scan as end-users grow; p99 on turn path explodes |
| No index on `(workspace_id, subject_key)` | Same |
| Inject unbounded facts into prompt | Model context and bill blow up even if DB is fast |
| Confuse memory with RAG | Double context, wrong delete story, audit confusion |
| Store secrets in memory rows | Compliance and breach; logs and support exports expose them |

Hot path: **one subject** per turn, indexed lookup, capped rows, capped inject characters (mirror RAG char cap pattern in runtime).

### Choice

**We take:** explicit Postgres rows, caps, denylist, CRUD API, runtime read on turn, simple write API.

**We reject:** unbounded vector memory as v1; model-as-database; secrets in memory.

**Cost:** memory will be **incomplete** and sometimes wrong until product adds better write UX. The **conversation log stays complete**.

**Fail policy (write in ADR):** if memory read fails, choose **fail turn** vs **continue without memory** — default recommendation: **continue without memory** (memory optional), unlike RAG when KB exists and retrieve fails (fail closed per 13).

### Cloud later

Same Postgres (RDS/Aurora later). **Delete path** by `subject_key` and by fact id for GDPR-style requests — implement API now, UI later.

Render: no local disk for facts; bind service to `0.0.0.0:$PORT`; migrations as job or startup policy per existing service pattern.

### Low-level design

- Service port TBD (e.g. **3010**); gateway `proxy-memory.routes.ts`; env `MEMORY_URL`.
- Public (via gateway): CRUD under `/v1/workspaces/:workspaceId/memory/...` with JWT + 09B + permissions.
- Internal (optional v1): `GET /internal/workspaces/:id/memory/facts?subject_key=` for runtime with internal token (same pattern as knowledge `ready-count` / retrieve).
- Runtime: resolve `subject_key` from conversation/widget contract; inject `User facts:` block with char cap; optional metadata on assistant message later (`memory_fact_ids` — not required v1).
- Permissions in `packages/contracts`: e.g. `MEMORY_READ`, `MEMORY_WRITE` (exact strings in one Aqib-owned contracts PR).
- **Failure policy:** document in ADR; test memory service down behavior on runtime.

### Database design

- **Table `memory_facts`** (name may change in ADR; shape is fixed intent):
  - `id` UUID PK
  - `workspace_id` UUID NOT NULL — tenant on every row
  - `subject_key` VARCHAR NOT NULL — opaque stable id for end user (see identity section)
  - `fact_key` VARCHAR optional — short label for upsert ("timezone", "channel")
  - `fact_text` TEXT NOT NULL — capped length at app layer (e.g. 2–4 KB max per fact)
  - `created_at`, `updated_at` TIMESTAMPTZ
  - Optional `created_by_actor_id` UUID — staff who wrote fact via API, if applicable
- **Indexes:** `(workspace_id, subject_key)`, unique optional on `(workspace_id, subject_key, fact_key)` if upsert-by-key is supported.
- **Migrations:** `make memory-migrate` or service-local migrate script; never rely on CREATE TABLE at HTTP startup in production.
- **Delete:** `DELETE FROM memory_facts WHERE workspace_id = ? AND subject_key = ?` for subject erasure; single-row delete by id with tenant guard.
- **No** full fact bodies in info logs.

### Identity and trust boundaries

| Actor | Id | Uses memory how |
| --- | --- | --- |
| Staff user | JWT `sub` → `actorId` | Calls memory CRUD API with workspace permission |
| End user (chatter) | `subject_key` | Facts attach here; never use staff `actorId` as subject |
| Gateway | Public | JWT + membership only; does not store facts |
| Runtime | Internal token | Reads facts for turn; does not bypass tenant filter |

**Define in ADR before build:** widget anonymous id vs logged-in customer id; how `subject_key` is passed on `POST .../turns` or stored on `conversations` row.

Trust line: memory service must **never** return rows where `workspace_id` ≠ route tenant.

### Related features

| Feature | Relationship to 14 |
| --- | --- |
| **09 Conversation** | Full message history; memory does not replace messages |
| **11 + 13 Knowledge / RAG** | Company docs in OpenSearch; memory is Postgres per subject — different store, different prompt section |
| **09B Membership** | Same cached client on memory routes and runtime permission checks |
| **15 Tools** | Side effects; memory has no external HTTP in v1 — do not merge tool loop into memory service |
| **16 Secrets** | Credentials by name; never store values in `fact_text` |
| **17 Widget** | Will supply stable `subject_key` for anonymous visitors |
| **27 Audit** | Later: log who wrote/deleted facts |

### API, gateway, and permissions

- **Gateway:** `router.all("/v1/workspaces/:workspaceId/memory/*", ...)` with `createProtectedWorkspaceProxyChain` (membership + JWT).
- **Service:** `requireWorkspacePermission(MEMORY_READ | MEMORY_WRITE)` on mutating vs read routes.
- **Runtime turn:** existing `CONVERSATION_PARTICIPATE`; memory read does not widen who can chat — only enriches prompt.
- **Contracts:** add permissions in `packages/contracts` once; services import from `@quickstart/contracts`.
- **Errors:** typed `VALIDATION_FAILED` for oversize; `NOT_FOUND` for wrong tenant; no fact body in error messages.

### Learn today

1. Read this feature block end-to-end (all headings **1–19**), then [docs/ai-roadmap.md § Feature 14](./ai-roadmap.md#feature-14--memory) in the same order.
2. Read [docs/project_details.md](./project_details.md) scale sections (orgs, messages/day, concurrent chats).
3. Trace `services/runtime-service/src/services/turns.service.ts` — where RAG injects; mark memory injection point **after** retrieval, **before** model gateway.
4. Read conversation domain types — how senders are identified; draft `subject_key` rules.
5. Compare to knowledge internal client pattern (`knowledge.client.ts`) for a thin `memory.client.ts`.
6. Write ADR draft: caps, denylist, `subject_key`, fail-open vs fail-closed on read failure.
7. Draw one sequence: turn with RAG + memory + model; label HTTP status for each failure hop.
8. Complete **Deep learning** below (or the full **Deep learning** section in ai-roadmap) before opening an IDE for Build today.

### Deep learning

**Deep topic:** what is allowed in **memory** vs what is a **secret** (and what belongs in **knowledge**, not memory).

This block is the core of the learn day. You should be able to teach it to a teammate without opening the repo.

**Mechanism — three storage intents (do not mix):**

| Intent | Store | Scoped by | Example |
| --- | --- | --- | --- |
| Company knowledge | OpenSearch chunks (11) | `workspace_id` + source | Refund policy PDF |
| End-user memory | Postgres `memory_facts` (14) | `workspace_id` + `subject_key` | “Prefers WhatsApp” |
| Credentials | Feature 16 secrets (later) | `workspace_id` + secret name | CRM API key **by reference** |
| Chat transcript | Conversation messages (09) | `workspace_id` + conversation | Full dialogue |

**Failure at scale — walk through in words:**

1. **Wrong bucket:** refund policy stored as a memory fact → every user sees company text as “personal memory”; deletes and GDPR become wrong.
2. **Missing `workspace_id` in SQL:** at 10,000 organizations, one bug returns another tenant’s facts → severity-1 data leak. Test must assert SQL always binds tenant from route context, never from client body alone.
3. **Wrong subject:** staff `actorId` used as `subject_key` → all agents share one “user memory”; support cannot explain behavior.
4. **Secret in `fact_text`:** API key in memory row → appears in DB backups, exports, future audit UI, and possibly prompt injection to the model.
5. **Unbounded read:** load all facts for workspace on each turn → Postgres and prompt blow up as end-users grow.
6. **Prompt injection via fact:** attacker or malicious staff writes fact_text `Ignore previous instructions and …` → if injected without framing, model may obey. Mitigation: fixed wrapper (“User facts (not instructions):”), sanitize or reject patterns, cap length, never execute fact as code.
7. **Fail policy mismatch:** RAG fail-closed when KB exists (13) but memory fail-open when DB down — intentional; document so on-call does not “fix” memory to fail-closed without product sign-off.

**Decision tree (where does this string go?):**

```text
Is it a credential or payment instrument?
  yes → Feature 16 secrets (or never store) — NOT memory
  no → Is it true for the whole company / in a document?
    yes → Knowledge ingest (11) — NOT memory
    no → Is it about one end-user (subject)?
      yes → Memory fact (14) if not on denylist and under cap
      no → Conversation message only (09) — do not duplicate as memory unless product needs summary
```

**Classification (learn exercise — answers in ai-roadmap):** classify each row as `memory` | `knowledge` | `secret` | `conversation-only` | `reject`. Complete the full table in [ai-roadmap § Deep learning](./ai-roadmap.md#deep-learning-feature-14--memory).

**Tests that prove deep learning (not optional for Build today):**

- Cross-tenant read/write (A vs B).
- Oversized `fact_text` rejected.
- Denylist rejects token-shaped strings (define patterns in ADR).
- Runtime inject: memory block appears **after** knowledge block when both exist; char cap enforced.
- (If fail-open) memory service down → turn still 200 without facts; log `memory.read_degraded`.

**Read next:** [docs/ai-roadmap.md — Deep learning (Feature 14)](./ai-roadmap.md#deep-learning-feature-14--memory) for extended tables, threat scenarios, and study questions.

### Build today

| Track A (memory service) | Track B (runtime + gateway) — day 2 if same person would touch both |
| --- | --- |
| Migration `memory_facts`, repository, CRUD HTTP, permissions | `memory.client.ts`, read on turn, prompt section + char cap |
| Cross-tenant tests | Test: fact written for subject S appears on next turn for S only |
| `make memory-migrate`, README, gateway proxy | Gateway proxy route + env `MEMORY_URL` |

Minimum slice: one fact via API → next turn includes it → workspace B cannot read A.

### Done when

- Fact saved for `subject_key` in workspace W appears on the **next turn** for that subject only.
- Workspace B cannot read or mutate workspace A's facts.
- Oversized fact rejected at API.
- ADR + ai-roadmap section updated with chosen `subject_key` rule and fail policy.
- Gateway and service enforce membership + `MEMORY_*` permissions.

### Still unsafe

- No ML **extraction** from chat into facts in v1.
- No vector / semantic memory search.
- No citation UI for which facts were used (optional metadata later).
- No Redis cache for memory reads.
- No integration with **16 Secrets** or **17 Widget** until those features land — document assumed `subject_key` contract for widget anyway.
- At 10k req/s, one indexed read per turn is acceptable; **admin "list all facts in workspace"** must be paginated and not on turn hot path.
- Streaming turns (runtime day 2) may need a follow-up so memory read stays correct on stream path.

---

## 18. Feature 15 — Tools and MCP

**Status:** `done`  
**Needs:** runtime  
**Can run beside:** Feature 16  
**Deep topic:** timeouts and idempotency on side effects

### Pre-context

The runtime only talks to the model. It cannot call a customer's HTTP API.

### What this is

A tool is a named action (HTTP request or MCP tool) that the model may request. Our runtime executes it with a timeout, records the input and output, and sends the result back to the model for the next step. The loop stays inside the runtime. We add a stage. We do not replace the runtime.

### Why now

Side effects (create ticket, send email) are where double execution hurts. The design has to exist before we add many tools.

### Junior shortcut

The junior shortcut lets the model call any URL, retries the tool five times, and does not store whether it already ran. A timeout after the customer's API succeeded creates a second ticket.

### Production shape

Tools are configured per agent version (the published snapshot), not edited live under a running call. Execution has a timeout, an allow-list of hosts, and an idempotency key stored before the call when the tool is not safe to repeat. If we do not know whether the first call succeeded, we do not blindly call again. We return "unknown" and let a human path handle it later.

Permissions: reuse `packages/contracts` style checks. Analyst must not gain a new "run tool" right by accident. Add a permission string in contracts in one change, then use it.

### What breaks at scale

Tool calls are slow. A chat that runs ten tools holds a worker. Cap tool calls per turn. A tool that calls back into our public gateway can deadlock if we only have a few workers. Internal calls must not depend on the same tiny worker pool without a timeout.

### Choice

We take an allow-list, a timeout, a per-turn cap, and stored tool-call rows.

We reject "the model may call any URL."

Cost: customers must register hosts. That is the point.

### Cloud later

Egress from the cluster should be restricted. The allow-list in the app is the product rule. The cloud firewall is the second rule. Both can exist. Neither replaces the other.

### Low-level design

- Tables: tool definitions on the agent version snapshot, `tool_calls` with workspace_id, status, idempotency key
- One built-in HTTP tool is enough for the first slice; **`fetch_url` / `search_web` call web acquisition (10B)**, not a vendor SDK from the runtime
- Test: second attempt with the same key does not double-call the fake server
- Test: host not on the allow-list is rejected before any socket
- Test: when 10B returns `ACQUISITION_BUDGET_EXCEEDED`, the tool step fails typed without retrying the vendor

### Done when

A published agent can run one allow-listed HTTP tool, the turn records the call, and a retry does not double-execute.

### Still unsafe

No full MCP catalog required on day one. One MCP or one HTTP tool that proves the loop is enough. Write which one you shipped.

---

## 19. Feature 16 — Secrets

**Status:** `done`  
**Needs:** none, but tools should read secrets from here once both exist  
**Can run beside:** Feature 15  
**Deep topic:** secrets and rotation

### Pre-context

Model keys sit in environment variables. Tool credentials do not have a store.

### What this is

A secret is a value encrypted at rest, scoped to a workspace, referenced by name. Services receive the secret at use time. Logs and API responses return the name, never the value.

### Why now

Tools and the model gateway will otherwise keep pasting keys into agent instructions and into git.

### Junior shortcut

The junior shortcut stores the secret in the agent instructions or in a plaintext column, and returns it from `GET /agents`. Anyone with read access, and anyone with a log pipeline, has the key.

### Production shape

Postgres stores ciphertext and a key version. The encryption key is in the environment now and in a cloud KMS later. Decrypt only in the process that needs the byte string for the outbound call. Rotation writes a new ciphertext and keeps the old key version until the new one works. A failed rotation does not delete the old row first.

Two copies of the service can decrypt if they have the same key. Do not cache plaintext in a process-global map that survives after rotation.

### What breaks at scale

The scale problem is blast radius, not requests per second. One log line with a secret is a full leak. One missing `workspace_id` returns another tenant's ciphertext to a buggy decrypt path.

### Choice

We take envelope encryption with a master key, workspace scope, and redacted APIs.

We reject "just use env vars for every customer tool." Env vars do not scale to 10,000 tenants and they are not per-workspace.

Cost: we must operate rotation. Write the rotate API even if the UI is later.

### Cloud later

Master key moves to KMS. The table stays in Postgres. The application code that redacts logs stays. KMS does not redact your logger.

### Low-level design

- `secrets`: id, workspace_id, name, ciphertext, key_version, created_at
- Create, list names, delete, rotate
- `GET` never returns plaintext
- Test: log spy or response body does not contain the raw value
- Test: other workspace gets 404

### Done when

A secret can be stored and used by name by an internal caller in tests, and no API response shows the raw value.

### Still unsafe

No full KMS integration until the cloud feature. Document the local master key as dev-only.

---

## 20. Feature 17 — Website chat widget

**Status:** `done` — public widget HTTP API, publishable-key management, static browser bundle, host-page demo, and `scripts/check-widget-browser-proof.mjs` (create → turn → refresh history, wrong origin, idempotent retry) pass against a local stack. SSE reconnect-by-seq remains follow-up work.
**Needs:** runtime chat turns
**Can run beside:** Feature 18  
**Deep topic:** horizontal scale of long connections

### Pre-context

The runtime can answer, and workspace settings manage publishable keys. `apps/web/public/quickstart-widget.js` provides a browser chat client; `fixtures/widget-demo.html` is the local host-page example. This feature is the embeddable chat, not the staff console.

### What this is

A small browser script the customer's website loads. It talks only to the gateway. It uses a **publishable key** (safe to be in JavaScript) that maps to one workspace. It is not the secret API key.

### Why now

This is the first channel a real site can load. If the script contains a secret, that secret is public the moment the page loads.

### Junior shortcut

The junior shortcut puts the service API key in the widget and lets any domain use it. Another site copies the script and spends the customer's model budget. Refresh starts a new conversation and loses history.

### Production shape

The gateway checks the publishable key and the site origin allow-list. The current client uses request/response JSON, stores the visitor and `conversation_id`, and reloads stored messages after a page refresh. SSE with replay by `seq` remains a follow-up; normal HTTP sends each message.

The gateway proxies turns. It does not run the model.

### What breaks at scale

Thousands of open chats mean thousands of held connections. The limit is connection count and memory per connection, not CPU. Heartbeats keep idle proxies from closing the stream. A process restart drops streams. The client must reconnect with `seq` and continue. That only works if conversation storage is already correct.

### Choice

We take publishable keys, origin allow-list, request/response turns, and browser persistence for the v1 widget. SSE and reconnect by `seq` remain follow-up work.

We reject a secret in the bundle.

Cost: we must build a key type that is not the org API key.

### Cloud later

The load balancer must allow long SSE timeouts. Sticky sessions are a crutch. Reconnect by seq is the real design, so any copy of the gateway can resume.

### Low-level design

- Issue and revoke publishable keys, workspace scoped, origin list
- Static widget bundle in `apps/web/public/quickstart-widget.js`
- Send messages and reload history; SSE token subscription and replay after seq are follow-up work
- Test: wrong origin is rejected
- Test: reconnect does not duplicate the user message (idempotency key)

### Done when

A local HTML page can chat through the gateway with a publishable key, refresh, and see the same conversation.

### Still unsafe

No inbox UI here. No voice. Polish is not the goal. The failure cases are.

---

## 21. Feature 18 — Inbox and human handoff

**Status:** `done`  
**Needs:** conversations  
**Can run beside:** Feature 17 if the widget and the inbox do not edit the same service. Inbox can be an API on the conversation service plus a small staff page. **Voice track:** ship minimal handoff before heavy outbound (Feature 23); callers must be able to escalate to a human.  
**Deep topic:** read-your-writes and two people taking the same chat

### Pre-context

Messages exist. Nobody can assign a chat to a human, and the model does not stop when a human joins. Voice calls use the same conversation row; without handoff, the bot talks over a human on the phone.

### What this is

An inbox is a list of conversations for a workspace, with assignee and state (bot, waiting, human). Handoff sets the state so the runtime will not keep answering while a human owns the thread. Messages from the human are normal message rows with role `human`.

### Why now

Operations need a way to take over. If we bolt this on after voice and campaigns, every channel will invent its own assignee field.

### Junior shortcut

The junior shortcut stores "who is assigned" in a browser session or in memory. Two staff members click "take" and both think they own it. The bot keeps replying because the runtime never reads the state.

### Production shape

Assignee and state are columns on the conversation, updated with a condition (`WHERE state = 'waiting'`) so only one take wins. The other gets 409. The runtime reads state before it calls the model. If state is human, it does not call the model.

### What breaks at scale

The inbox list must be filtered by `workspace_id` and indexed by state and updated time. "All conversations in Postgres" will not load. Pagination is required.

### Choice

We take a conditional update for assignment and a runtime check of state.

We reject a second message store for humans.

Cost: the runtime and the inbox share the conversation row. Agree the column names before coding.

### Cloud later

Same Postgres primary for the assignment write so the runtime cannot miss a take that just succeeded.

### Low-level design

- Fields on conversation: state, assignee_user_id
- `POST .../take`, `POST .../release`
- List API with cursor
- Test: two takes, one wins
- Test: runtime does not call the model when state is human (fake model gateway asserts zero calls)

### Done when

A staff user can take a conversation, send a human message, and the bot stays quiet until release.

### Still unsafe

No email notifications. No mobile app. A simple API plus one page is enough if the tests exist.

---

## 22. Feature 19 — Event platform

**Status:** `done` — outbox, Kafka publisher/consumer, and catalog producers `conversation.handed_off`, `conversation.released`, `message.appended` (plus declared `agent.published`).
**Needs:** the objects that emit events (agent, conversation, handoff). Do not invent events for objects that do not exist.  
**Can run beside:** Feature 20 only after the event envelope exists. Day 1 can be the envelope and one producer. Day 2 can be one consumer. If two people work, one owns the producer library, the other owns one consumer. Do not both edit the topic names.  
**Deep topic:** queues and "at least once"

**Admin-configured scenarios (e.g. “notify us when user asks about payment”):** tenants do **not** define custom Kafka event types. The platform emits **catalog** facts (`message.appended`, `conversation.handed_off`, …). Admins configure **workflows (Feature 20 / F8)** with triggers on those types plus **conditions** (keywords, intent, assignee) and **actions** (in-app notify F12, email, webhook F13). Optional **intent detection** is a later slice on top of `message.appended`, not a separate “custom events” bus feature.

### Pre-context

Kafka is in Compose. The product does not publish business events yet.

### What this is

After a successful database commit, we publish a fact: `agent.published`, `message.appended`, `conversation.handed_off`. The payload includes workspace_id, ids, and `request_id`. Consumers may see the event more than once. They must be idempotent.

### Why now

Workflows, leads, and usage all need a stream of facts. If each feature polls tables with its own hidden query, we will miss updates and couple every service.

### Junior shortcut

The junior shortcut publishes to Kafka before the database commit. The consumer acts, then the transaction rolls back. Or they treat Kafka as exactly-once and insert duplicate side effects.

### Production shape

Commit Postgres first, then publish. If publish fails, a short outbox table in Postgres retries. Consumers store the event id they already handled. Two copies of a consumer must not double-apply.

### What breaks at scale

A consumer that does slow work on the Kafka thread blocks the partition. Hand off to a job queue for slow work. A missing workspace id in the payload makes every consumer unsafe.

### Choice

We take an outbox and at-least-once delivery with consumer idempotency.

We reject "exactly once" as a promise we make to product code. We promise "we can handle duplicates."

Cost: every consumer writes a little extra bookkeeping.

### Cloud later

Managed Kafka. The outbox still matters. The cloud bus does not make a bad consumer idempotent.

### Low-level design

- Outbox table: id, workspace_id, type, payload, published_at
- One publisher process
- One example consumer that records handoff counts in an idempotent way
- Test: duplicate delivery does not double-count

### Done when

A real product action (publish or handoff) creates an event a consumer can read, and a replay does not double-apply.

### Still unsafe

Not every table emits events on day one. List the events you actually ship.

---

## 23. Feature 20 — Workflow automation

**Status:** `done` — `services/workflow-service` (:3012), gateway proxy, staff UI wired; Kafka consumer; runs/steps/side effects/dead letters. See [ADR 0020](./adr/0020-workflows.md).
**Needs:** events  
**Deep topic:** retries and poison messages

### Pre-context

Events can exist. Nothing reacts with a multi-step business flow.

### What this is

A workflow is a saved definition: when this event happens, run these steps (call a tool, write a lead, notify). A run row stores the current step so a crash resumes instead of starting over.

Example: trigger `message.appended` + condition “text mentions payment” → action “create staff notification” — no tenant-defined event type on the bus (see Feature 19 note).

### Why now

Campaigns and leads will want triggers. A one-off `if` inside the runtime will not be operable.

### Junior shortcut

The junior shortcut runs all steps inside the event consumer with no run record. A crash repeats step 1. A bad payload retries forever and blocks the partition.

### Production shape

Each run has state in Postgres. Steps that call tools use the tool idempotency rules. A message that fails N times goes to a dead-letter path and leaves the main consumer free. Definitions are versioned so an edit does not change a run that already started.

### What breaks at scale

A hot event ("every message") can create a workflow storm. The definition must allow a filter, and the worker count must be separate from the gateway. One tenant's workflow must not use every worker. Put a per-workspace cap.

### Choice

We take stored runs, step resume, and a dead-letter path.

We reject an unbounded script with full network access as the first engine.

Cost: the first workflows will feel limited. That is acceptable.

### Cloud later

Workers scale horizontally because run state is in Postgres, not in the worker.

### Low-level design

- Tables: definitions, runs, steps
- One trigger: conversation handed off, one action: write a row we can assert in a test
- Test: crash simulation resumes at the next step
- Test: poison message lands in the dead-letter table

### Done when

One real event starts a run, the action happens once, and a forced retry does not duplicate the action.

### Still unsafe

Email and agent-handoff actions record side-effect rows; they do not yet call SES or conversation take. Webhook secret refs are names only until secrets vault resolution is wired on the worker. Per-workspace run concurrency caps and SSE-style live run traces are later.

---

## 24. Feature 21 — Voice path

**Status:** `done` (v1) — fake-media simulate → runtime internal voice turn → `voice_calls` + timings; proven by `scripts/check-voice-simulate-proof.mjs`. Real STT/TTS is **21B**; PSTN is **21C**.  
**Needs:** 12 (runtime), 09B (membership cache at scale)  
**Can run beside:** 11 if directories differ  
**Deep topic:** streaming, heartbeats, and a second channel that must not fork the agent engine  
**Owns:** `services/voice-service` (local port **3008**), ADR **0021-voice-platform**, `packages/contracts` voice/call types

### Pre-context

Chat can run a turn. Voice edge exists on `:3008` with cascade fake media and an internal runtime voice-turn hop (same pattern as widget internal turns).

### What this is

A voice call is a channel. **Cascade default:** audio in → STT → runtime (text turn) → TTS → audio out. The agent, the **published version**, and the conversation are the same objects as chat. The call has its own session row because audio is realtime. Published agent versions may include **voice settings** (language, TTS voice id, max response length, `voice_mode: cascade | realtime` when ADR allows realtime without tools/RAG).

### Why now

If voice gets a second runtime, we will fix every bug twice.

### Junior shortcut

The junior shortcut builds a separate "voice brain" with its own prompt store. Publish in the agent service does not affect calls. A dropped packet retries the whole model call and the caller hears two answers.

### Production shape

The voice edge is **its own process**. It handles audio and turns it into a turn request to the same runtime. The HTTP gateway on port 3000 never holds the media socket. The runtime still uses the production pointer and the conversation table. Timeouts are shorter than chat because a human is waiting on the phone. If the model misses the deadline, the caller hears a typed fallback phrase, and the conversation row records the failure.

Call state that must survive a restart (call id, conversation id, direction, workspace cap) lives in Postgres or Redis with a TTL. The socket may die on deploy. Recordings go to object storage, not the local disk. Drain time for a voice pod is longer than HTTP (`terminationGracePeriodSeconds` measured in minutes if calls last that long), or new calls stop first and existing calls finish.

### What breaks at scale

5,000 concurrent inbound calls and 5,000 concurrent outbound calls means 10,000 realtime sockets when both sides are full. The voice edge scales horizontally only if call state that must survive a restart is in Postgres or Redis with a TTL, not only in the process. In-memory call state is lost on deploy. Say which state is allowed to die (the socket) and which is not (the conversation).

### Choice

We take one runtime and a separate voice edge for audio.

We reject a second agent configuration store.

Cost: the voice edge is a new service with harder networking.

### Cloud later

This service needs stable outbound media and health checks. The cluster comes in feature 29. The code must already bind `0.0.0.0` and expose health. Do not wait for Kubernetes to discover that call state was only in memory.

### Low-level design

- `calls`: id, workspace_id, conversation_id, direction (inbound or outbound), state, `agent_version_id` snapshot
- `services/voice-service`: health, internal auth, session orchestration; **fake media** test double sends one utterance → one runtime voice-turn → one TTS chunk out
- Emit **usage/trace stubs**: `call_id`, stage timings (STT, runtime, TTS) to logs or OTel — shapes used later by Feature 26
- No second copy of agent fields
- No audio bytes through `services/gateway-service`
- Telephony PSTN and vendor STT/TTS keys are **Feature 21B / 21C**, not required for Feature 21 Done when

### Done when

One simulated call creates a conversation turn through the existing runtime and records the call row. Traces or structured logs include `call_id` and stage latency fields.

**Met:** `node --env-file=.env scripts/check-voice-simulate-proof.mjs` (conversation messages + `call_id` + `stt_ms`/`runtime_ms`/`tts_ms`).

### Still unsafe

No PSTN (21C). No production phone numbers. Default boot still uses fake STT/TTS (21B). Recording/transcript storage optional stub only. Legal/compliance for call recording documented as deferred. Dual-replica cap race / drain proof remains for V1.

---

## 25. Feature 22 — Voice reliability

**Status:** `done` (v1) — atomic Redis/memory leases; four LLD tests in `voice-reliability.test.ts`; proven by `scripts/check-voice-reliability-proof.mjs`.  
**Needs:** 21  
**Deep topic:** failure domains (one bad call must not stall the rest)

### Pre-context

A simulated call can complete through the real runtime (Feature 21). Real calls drop, arrive twice, and overrun deadlines.

### What this is

Retries policy (no infinite model retry on phone), **barge-in** (stop TTS, accept new utterance), dead-call cleanup, and limits on concurrent calls. **Global Redis caps:** 5,000 inbound and 5,000 outbound platform-wide. **Per-workspace** inbound/outbound caps so one tenant cannot consume the global 5,000. A call that exceeds its deadline ends with a clear state on the call row and a spoken fallback if audio was already open.

### Why now

Without cleanup, leaked sessions hold workers until the process restarts.

### Junior shortcut

The junior shortcut retries the model until the caller hangs up, with no cap. One stuck call occupies a worker forever. A reconnect creates a second conversation.

### Production shape

Every call has a deadline. Workers are released in `finally`. Reconnect uses the call id. Per-workspace concurrent call count lives in Redis so two voice copies share the cap. If Redis is down, refuse new calls (fail closed) rather than unlimited calls.

### What breaks at scale

The failure is leaked concurrency, not a wrong SQL row. At 5,000 inbound and 5,000 outbound, a leak of one worker per call takes the pool down in minutes. The Redis cap is two numbers: inbound and outbound. A workspace that is at its own cap must not consume the global 5,000.

### Choice

We take deadlines, Redis concurrency caps, and fail-closed when the cap store is down.

We reject unlimited retry.

Cost: some calls fail fast when Redis is unhealthy. That is better than a dead pool.

### Cloud later

The cap remains in Redis (managed cache). More voice pods do not multiply the allowed calls by accident.

### Low-level design

- Test: global or workspace cap reached returns a typed error before opening media — **done** (`RATE_LIMITED`, STT not called)
- Test: simulated hang releases the worker in `finally` — **done** (lease count back to 0)
- Test: reconnect reuses the same `call_id` and conversation — **done** (live reconnect skips second acquire)
- Test: barge-in cancels in-flight TTS without starting a duplicate assistant message — **done**
- ADR: Redis down → refuse **new** calls (fail closed) — **done**; caps are ownership leases (Lua / memory)

### Done when

Those tests pass and the ADR says what happens when Redis is down. **Met** — unit suite + `scripts/check-voice-reliability-proof.mjs` green.

### Still unsafe

No global anycast network. No legal call-recording program. Write the recording decision as "not in this feature." Dual-replica Redis race / kill-pod drain proof remains **V1**.

---

## 25A. Feature 21B — Speech providers (STT/TTS)

**Status:** `done` (v1) — `SPEECH_PROFILE=fake|openai`; OpenAI Whisper STT + TTS adapters; fail-closed via `VOICE_REQUIRE_REAL_SPEECH`; proven by `scripts/check-voice-speech-proof.mjs` (fixture mode).  
**Needs:** 21  
**Can run beside:** 22 if files do not overlap in `voice-service`  
**Deep topic:** timeouts, one retry, circuit breaker (same as model gateway)  
**Owns:** STT/TTS **provider adapters** inside `services/voice-service` (not in runtime)

### Pre-context

Feature 21 proves the loop with a fake media path. Real calls need STT and TTS vendors with keys, timeouts, and usage units.

### What this is

Provider interface: `transcribe(audio_chunk)`, `synthesize(text)` (and streaming variants). Vendors (Deepgram, Cartesia, ElevenLabs, OpenAI speech, etc.) plug in behind env profiles. **One retry** only when no billable output was committed. Circuit breaker per profile. Usage fact per STT/TTS unit for Feature 26.

### Why now

If STT/TTS SDKs land in runtime or gateway, voice scale and billing diverge from model-gateway rules.

### Low-level design

- Files: `services/voice-service/src/speech/` — `types.ts`, `fake-*.ts`, `openai-stt.ts`, `openai-tts.ts`, `policy.ts` (retry + breaker + usage), `factory.ts`
- Env: `SPEECH_PROFILE=fake|openai` (default `fake`); `SPEECH_OPENAI_API_KEY` / `OPENAI_API_KEY`; `VOICE_REQUIRE_REAL_SPEECH=1` fail-closed; optional `SPEECH_CIRCUIT_FAILURE_THRESHOLD`, `SPEECH_CIRCUIT_COOLDOWN_MS`, `SPEECH_HTTP_TIMEOUT_MS`
- OpenAI STT: `POST /v1/audio/transcriptions` (whisper-1); TTS: `POST /v1/audio/speech`
- Failure: timeout/5xx → one retry if no billable output; circuit open → fail turn; never log API keys
- Usage stub log: `{ type: "speech.usage", provider, unit: "stt"|"tts", units: number, call_id?, workspace_id? }`
- Proof: `scripts/check-voice-speech-proof.mjs` (fixture mode default); Feature 21 `check-voice-simulate-proof.mjs` stays on fake profile

### Done when

Fake STT/TTS in tests; one real provider behind env flag optional; no API keys in logs; voice turn works end-to-end in simulation with real adapter code paths.

**Met:** `node --env-file=.env scripts/check-voice-speech-proof.mjs` (fixture); Feature 21 simulate remains green on `SPEECH_PROFILE=fake`.

### Still unsafe

No separate `speech-gateway` service unless traffic proves we need it. Start inside voice-service. Streaming STT/TTS and second vendors deferred.

---

## 25B. Feature 21C — Telephony (CPaaS)

**Status:** `done` (v1 adapter) — `TwilioCpaasProvider` + factory (`TELEPHONY_PROFILE=fake|twilio`); signed public inbound/status; internal dial; status idempotency; proven by `scripts/check-voice-telephony-proof.mjs` (fixture).  
**Needs:** 21, 21B, 22  
**Deep topic:** webhook idempotency and media stream security  
**Owns:** telephony adapter in `services/voice-service`, ADR **0022-telephony-providers** (primary: **Twilio**; fallback profile: **Telnyx**)

### Pre-context

Simulated calls work. Customers need inbound DIDs and outbound dial.

### What this is

**TelephonyProvider** interface: buy/link number (staging), inbound webhook → open media stream, outbound `dial`, status callbacks, hangup, **transfer** (later slice). CPaaS streams audio (often μ-law 8 kHz) to a **WebSocket** on voice-service. Sign and verify webhooks. Idempotent handling of duplicate status events.

### Why now

Feature 23 campaigns and real outbound product need PSTN. Feature 21 intentionally defers carrier integration.

### Junior shortcut

Hard-code Twilio in the gateway. Webhooks without signature check. Outbound dial in the HTTP request handler.

### Production shape

All telephony HTTP routes on voice-service (or a dedicated telephony port on the same process), not on gateway :3000. Recordings point to object storage URLs when enabled. Emit telephony usage facts (call minute, direction) async.

### Low-level design

- Adapter factory registers Twilio (real or fake) + Telnyx stub + SIP + fake behind `TelephonyRouter` — **done**
- Public `POST /voice/telephony/:providerId/inbound|status` with signature verify — **done**
- Internal `POST .../voice/dial` → router → provider.dial → orchestrator turn + Feature 22 caps — **done**
- Status idempotency by `(CallSid, event)` — **done**
- ADR names Twilio primary + Telnyx fallback — **done** (0022)

### Done when

One inbound and one outbound call through staging CPaaS complete one runtime turn each; caps from Feature 22 enforced; ADR names primary and fallback provider.  
**Met (v1 adapter / fixture):** signed inbound + outbound dial each complete one orchestrator turn with caps; live PSTN Media Streams remain optional when `TWILIO_*` set.

### Still unsafe

No live PSTN until Telnyx + LiveKit Cloud secrets. No outbound PSTN dialing through Telnyx yet. No AMD/voicemail/opt-out (campaign compliance) — document under Feature 23. No international regulatory bundle. Inbound number inventory + LiveKit SIP path shipped (ADR 0023).

---

## 25C. Feature V1 — Voice load and drain proof

**Status:** `not_started`  
**Needs:** 22, lab P3 habits  
**Deep topic:** failure domains at long-lived connections

### What this is

A repeatable script: **two** voice-service replicas (or processes), shared Redis caps, **N** simulated long calls (config, e.g. 200–500 locally), assert caps reject excess, kill one process during drain and verify calls end or reconnect per ADR. Not 5,000 on a laptop — prove **shape**: shared Redis, no in-memory-only call state, drain stops new calls.

### Done when

Script passes in CI or `make voice-load-smoke`; README documents how to run it.

### Still unsafe

Not a substitute for Feature 30 full platform load test.

---

## 26. Feature 23 — Campaigns

**Status:** `done` (v1) — claim worker + `VoiceDialAdapter` (`CAMPAIGN_DIAL_MODE=voice`) → voice simulate; LLD claim/idempotency/pacing; proven by `scripts/check-campaign-voice-proof.mjs`.  
**Needs:** 21C (telephony), 22 (caps), 09 (conversations)  
**Can run beside:** Feature 24  
**Deep topic:** backpressure (do not dial every lead in one request)

### Pre-context

We can place a single simulated call. We cannot place a controlled batch.

### What this is

A campaign is a workspace-scoped list of targets and a schedule. A worker pulls a small batch, may **enrich targets via web acquisition (10B)** (scrape one page per lead under budget), starts calls through the voice path, and records outcomes on the campaign rows.

### Why now

A batch that starts inside an HTTP request will time out and double-dial on retry.

### Junior shortcut

The junior shortcut loops all targets in the request handler. The client retries and people get two calls.

### Production shape

The request only creates the campaign. A worker claims rows with a database condition so two workers do not dial the same target. Each attempt has an idempotency key. Rate is capped per workspace.

### What breaks at scale

The failure is a thundering herd into the voice edge. The cap is the product. Without it, one campaign consumes every call slot.

### Choice

We take queued claim-by-row and a rate cap.

We reject in-request dialing.

Cost: campaigns are not instant. They drain. Show status on the campaign.

### Cloud later

Workers scale out. The claim SQL stays correct with many workers.

### Low-level design

- Tables: campaigns, targets, attempts — **done** (`campaign-service`)
- Test: two workers, each target attempted once — **done** (`claim-idempotency.test.ts`)
- Test: retry of the create request does not create two campaigns (idempotency key) — **done**
- Per-campaign `maxConcurrentCalls` claim pacing — **done** (light; Redis outbound coupling later)
- `CAMPAIGN_DIAL_MODE=voice` → voice internal simulate — **done**

### Done when

A campaign of a few fake targets runs through the voice test double once each. **Met** — proof script green.

### Still unsafe

No production carrier beyond staging CPaaS. **AMD, voicemail, opt-out, and compliance copy** are not done — document before production outbound at scale. Legacy voice-service `/voice/campaigns` side-car still exists. Per-minute pacing + global Redis outbound lease coupling incomplete.

---

## 27. Feature 24 — Leads

**Status:** `done` (v1 flexible — schema-as-data)  
**Needs:** events (a lead can also be created by API if events are late; do not block the table on a perfect bus)  
**Can run beside:** Feature 23  
**Deep topic:** tenant scope and duplicate leads

### Pre-context

Chats and calls do not create a sales lead object.

### What this is

A lead is a workspace-scoped record: source, contact fields, status, link to a conversation if we have one. **Discovery and enrichment** (web search, scrape company URL) go through web acquisition (10B), not ad hoc HTTP from the lead worker. Creating the same lead twice (same idempotency key or same external id) returns the first row.

Flexibility matches campaigns: workspace **`lead_schema`** + per-lead **`captured_fields` JSONB**. Thin indexed columns only; new customer fields never need `ALTER TABLE`.

### Why now

Campaigns and inbox need somewhere to put "this person should be followed up" that is not a random JSON note.

### Junior shortcut

The junior shortcut inserts on every event with no unique key. Replays create five leads. Contact fields from workspace A show up in workspace B's list because the list forgot the filter. Growing columns per CRM field is also rejected.

### Production shape

Postgres with unique `(workspace_id, external_id)` and `(workspace_id, idempotency_key)` when set. List APIs filter `workspace_id` + soft-delete and return an honest filtered `total`. Events may create leads later; outbox not required for v1 Done when.

### What breaks at scale

A list without an index becomes a sequential scan at high lead counts. The write path is not 1,000 per second. The read path still needs the index because staff will refresh the inbox all day. Uniqueness + workspace filter is correctness — not more columns.

### Choice

We take a relational lead and idempotent create, plus schema-as-data for extras.

We reject a spreadsheet JSON blob per workspace as the only truth.

Cost: we must choose a small set of columns. Extra fields sit in JSON. Schema labels drive the UI.

### Cloud later

Same Postgres. Exports, if any, are jobs, not requests that build a giant file in memory.

### Low-level design

- CRUD plus idempotent create / merge upsert
- `GET/PUT .../leads/schema`
- Test: replay does not duplicate
- Test: cross-workspace list is empty of the other tenant
- Test: conversation_id + custom attributes without migrations
- Proof: `scripts/check-lead-store-proof.mjs`

### Done when

Those tests pass and a conversation id can be stored on the lead. **Met** for v1 flexible store.

### Still unsafe

No CRM sync. No scoring model. No `lead.*` outbox. No lead-gen auto-handoff.

---

## 28. Feature 25 — Evaluation

**Status:** `done` (v1 async harness)  
**Needs:** runtime  
**Can run beside:** Feature 26  
**Deep topic:** do not run eval inside the user-facing request

### Pre-context

We can run a turn. We do not score it.

### What this is

An eval is an offline or async job: given a published version and a fixed set of cases, run the runtime and store scores. It does not sit on the widget's critical path.

### Why now

People will want "do not publish if the score dropped." That gate needs a place to live. We add the runner first. We can attach it to publish after it works. Do not block normal publish on eval in the first slice.

### Junior shortcut

The junior shortcut runs fifty model calls inside the publish HTTP request. Publish times out. A partial score is treated as success.

### Production shape

Publish stays fast. Eval is a job with its own worker, its own timeout per case, and a stored report. Cases are tenant scoped. The report records the agent version id so we know what was scored.

**Shipped:** `services/eval-service` (:3016), claim worker, exact-match + fake scripted scoring, runtime internal version pin, caps, `scripts/check-eval-proof.mjs`.

### What breaks at scale

Eval is a cost amplifier. A loop with no cap can spend a month of model budget overnight. Cap cases per run and runs per workspace per day.

### Choice

We take async reports with a cap.

We reject eval-in-the-publish-request for the first slice.

Cost: publish is not automatically safe. The report is visible. A later change can require a report id. Write that as a follow-up, not as silent scope growth.

### Cloud later

Workers scale separately from the gateway. Spend caps still live in our table, not only in the vendor dashboard.

### Low-level design

- Tables: cases, runs, case results
- Fake model gateway returns scripted answers
- Test: cap rejects the extra case
- Test: another workspace cannot read the report
- Proof: `scripts/check-eval-proof.mjs`

### Done when

A run finishes async and the report matches the scripted answers. **Met** for v1 harness.

### Still unsafe

No human labeling UI. No automatic publish block. No tool-expectation scoring. No dataset revision snapshots.

---

## 29. Feature 26 — Usage and billing

**Status:** `done` (v1 ledger)  
**Needs:** model usage events from the model gateway and runtime; acquisition usage facts from web acquisition (10B); **voice** usage facts from voice-service (21B STT/TTS units, 21C telephony minutes)  
**Deep topic:** idempotency and money

### Pre-context

The model gateway can emit a usage record. Web acquisition (10B) emits units per scrape/crawl page/search query. Voice-service emits call/STT/TTS/telephony units the same way. We do not turn that into a ledger on the request or on the live call.

### What this is

A ledger row per model call, per acquisition action, and per voice minute / speech unit: workspace_id, units, `kind` (`model` | `acquisition` | `voice`), idempotency key, price snapshot. Invoices are a later rollup. This feature stores the facts that an invoice would need.

### Why now

If we drop token counts, we cannot rebuild the bill. You cannot reconstruct money from logs you already rotated away.

### Junior shortcut

The junior shortcut adds counters in memory, or updates one "balance" cell without an idempotency key. A retried usage event double-charges. A restart loses the month.

### Production shape

Append-only usage rows in Postgres. Unique idempotency key. The price is copied onto the row so a later price change does not rewrite history. Aggregates for the UI are queries or a daily rollup job, not a single mutable balance as the only source of truth.

### What breaks at scale

Writing a row per token chunk, or a balance update on every voice second, will melt the primary at 5,000 concurrent calls. Write one ledger row per model call and one row per finished call interval (or per call), not per token and not per audio packet. The volume is "model calls and call intervals," which is lower than "HTTP requests." Still index `(workspace_id, created_at)`. The consumer is idempotent. The HTTP handler and the voice worker only emit the fact.

### Choice

We take an append-only ledger.

We reject a single balance column as the only record.

Cost: invoices need a query. That is fine.

### Cloud later

The ledger stays on the primary. A warehouse can copy it later. The product must be correct before the warehouse exists.

### Low-level design

- Table `usage_entries`
- Consumer of the usage event is idempotent
- Test: duplicate event, one row
- Test: cross-workspace sum does not include the other tenant
- Test: a completed call does not write the ledger inside the voice request path (event or outbox only)
- No card charging in this feature

### Shipped

`services/usage-service` (:3017), ADR 0026, internal ingest + staff GET, producer fire-and-forget emits, `scripts/check-usage-proof.mjs`.

### Done when

A completed fake model call creates one ledger row, and a replay does not add another. **Met** (proof green).

### Still unsafe

No payment provider. No tax. No PDF invoice. No F9 daily rollup API. Fire-and-forget ingest can lose facts if usage-service is down (outbox follow-up).

---

## 30. Feature 27 — Audit and security

**Status:** `done` (v1 trail)  
**Needs:** the write paths we care about (auth, role change, publish, secret delete)  
**Can run beside:** Feature 28  
**Deep topic:** tenant leaks and redaction

### Pre-context

Some tables store who changed a role. There is no single audit log a security review can read.

### What this is

An append-only audit row: workspace or org id, actor, action, target id, request_id, time. It does not store secrets or full prompts.

### Why now

We already have actions that will be questions later ("who published?", "who deleted the secret?"). Retrofitting audit after the fact means guessing.

### Junior shortcut

The junior shortcut logs the JSON body. The body contains instructions and sometimes keys. Logs are not an audit trail. They rotate, and they leak.

### Production shape

The service writes the audit row in the same transaction as the change when the change is in the same database. When the change is in another service, that service writes its own audit row. We do not build a perfect distributed transaction. We do require each service to record its own sensitive actions.

### What breaks at scale

An audit table that stores full prompts will be huge and unsafe. Store ids and action names. A list API without a time filter will scan forever. Require a time range and a workspace or org filter.

### Choice

We take a thin audit table per area (or one table with a type column) and a redaction rule.

We reject "CloudTrail will do it later" as a reason to skip app-level audit. CloudTrail sees cloud API calls. It does not see "who changed this member's role" inside our product.

Cost: every sensitive write grows by one insert.

### Cloud later

CloudTrail and the app audit answer different questions. Keep both. Ship the app audit now so it is true before the cluster exists.

### Low-level design

- Audit insert on publish, role change, secret create/delete, API key create/delete
- Test: secret value is absent from the audit row
- Test: another org cannot list these rows

### Shipped

`services/audit-service` (:3018), ADR 0027, same-TX writers (publish, role, secrets, publishable + org API keys), fail closed, `scripts/check-audit-proof.mjs`.

### Done when

Those actions write audit rows and the tests pass. **Met** (proof green).

### Still unsafe

No SIEM export. No immutable WORM storage. The rows are append-only in application code. A database admin can still delete them. Say that honestly.

---

## 31. Feature 28 — Observability and alerts

**Status:** `in_progress` — HTTP, 429, publish, Redis fail-closed, model timeout and eval database pool saturation signals, local Prometheus rules, and error-log proof; other services' saturation metrics remain.
**Needs:** services already emit logs and traces through the shared libraries  
**Deep topic:** observability

### Pre-context

We have an OpenTelemetry collector in Compose and structured logs. We do not have a written list of metrics that mean the product is unhealthy, and we do not page anyone.

### What this is

A small set of metrics and one dashboard description: request rate, error rate, latency, saturation (worker pool, Redis errors, database pool), and business counters (publishes, model timeouts, 429s). Alerts fire on error rate and on "Redis fail closed" spikes. Traces keep `request_id`.

### Why now

At 10,000 requests per second sustained you cannot SSH and read a log file. The signals have to exist before the cloud move, or we will deploy blind.

### Junior shortcut

The junior shortcut adds logs inside every if statement and never a metric. Or they alert on CPU only. A tenant-wide data leak does not show up as CPU. A retry storm shows up as success latency and vendor spend, which CPU will not explain.

### Production shape

Use the same `request_id` in logs and traces, never as a metric label. Do not put workspace id on a metric label if that creates 10,000 time series per metric without a plan. Prefer overall metrics plus a break-glass log query for one tenant.

Two copies of a service must export metrics the same way. An in-process counter that resets on deploy is a rate, not a monthly total. Monthly totals belong in the usage table.

### What breaks at scale

High-cardinality labels (raw URL, user id, email) will take down the metrics system. That is the junior metrics bug.

### Choice

We take a short metric list, low cardinality, and a written alert for gateway 5xx and model timeouts.

We reject "log everything and grep."

Cost: we must keep the label set boring.

### Cloud later

The same metrics go to a managed backend. The names should not change when we leave Compose. The collector config can change. The app instrumentation should not.

### Low-level design

- Document the metric names in `docs/architecture/observability.md`
- One alert rule in a file we can load locally
- A test or a script that hits an error path and shows the log line contains `request_id`
- No secret in the log line

### Done when

A teammate can point at the doc and say which chart answers "are we failing?" and "are we slow?"

### Still unsafe

No on-call rotation. No paging vendor. The rule file is the product of this feature.

---

## 32. Feature 29 — Cloud deploy

**Status:** `not_started`  
**Needs:** health checks and stateless services. Do not start this by rewriting features.  
**Deep topic:** horizontal scale and failure domains in a real cluster

### Pre-context

Daily work is Docker Compose on a laptop. Services bind to a port and read env vars. Kubernetes was intentionally not day-3 work.

### What this is

Infrastructure as code for a staging-like environment: managed Postgres, managed Redis, container images, a cluster, a public entry to the gateway only, internal services not on the public internet, migrations as a job that runs before traffic.

### Why now

This is the first time "two copies" is the default rather than a thought experiment. It must not be the first time we discover in-memory session state.

### Junior shortcut

The junior shortcut clicks resources in a console, puts the database on the public internet, and stores files on the container disk. Or they adopt a cluster by rewriting the app. The console path cannot be reviewed. The rewrite throws away the services.

### Production shape

Terraform (or the tool we already chose in `project_details.md`) creates the network and the data stores. Images are built in CI. The gateway is the only public Service. Security groups block direct access to identity, workspace, agent, and the rest. Migrations run as a job, once, not inside every replica startup (or we use a lock so two replicas cannot migrate at once).

Horizontal scaling is adding pods. It is allowed only because rate limits and locks are in Redis and rows are in Postgres.

Vertical scaling is a bigger node. It does not fix a tenant leak.

### What breaks at scale

A migrate-on-startup race with many pods corrupts schema history. A readiness probe that always returns OK sends traffic to a pod that cannot reach Postgres. A liveness probe that checks a slow dependency will restart healthy pods during a database blip. Readiness should fail closed. Liveness should mean "the process is stuck," not "Postgres is slow."

### Choice

We take infrastructure as code, private services, gateway ingress, and a migration job.

We reject click-ops as the source of truth.

We reject moving to a different orchestrator only to avoid Kubernetes if the project standard is Kubernetes. If we change that standard, we change `project_details.md` first.

Cost: YAML and IAM are a feature of their own. Timebox the first environment to staging, one region.

### Cloud later

This feature **is** the cloud move. Keep the region and the account story small. Multi-region is feature 30's recovery discussion, not the first apply.

### Low-level design

- One environment, documented apply/destroy
- Images for gateway and the services we actually run
- No public Postgres
- Health and readiness already in the apps; fix any probe that is wrong
- CI builds images. A manual apply is acceptable for the first slice if the steps are written. Automatic deploy can follow in the same feature if time remains.

### Done when

A second person can apply the staging environment from the repo and hit the gateway health check. Internal service ports are not public.

### Still unsafe

No production customer traffic required. No multi-region. Secrets in the cloud secret manager for the master key and model keys, not in the git repo.

---

## 33. Feature 30 — Load, failure, recovery, SDKs

**Status:** `not_started`  
**Needs:** 29 for the environment you load-test. You can still write the test plan before the cluster exists.  
**Deep topic:** failure domains, recovery, and what "done" means

### Pre-context

Features exist. We have not shown that a dead dependency returns a typed error instead of a hang, under load, with more than one copy.

### What this is

A written load and failure exercise: gateway with two copies, Redis rate limit shared, kill Postgres, kill the model fake, kill one gateway pod. Plus a small SDK that only calls the gateway. Plus a recovery note: backups, who restores, what "message data loss" means.

### Why now

This is the closeout that proves the earlier failure policies are real.

### Junior shortcut

The junior shortcut runs one `curl` on a laptop and calls it load. Or they load-test a path that skips the gateway. Or they write an SDK that calls internal ports.

### Production shape

Load hits the gateway. The report records achieved rate, error rate, and latency. It does not need to hit 10,000 requests per second on the laptop. It needs to show the shape: two gateway copies share the Redis limit, a killed upstream returns 503 or 504 with `request_id`, and the process does not need a manual restart to accept traffic again after the dependency returns. The production target remains 10,000 sustained, 20,000 peak, and 5,000 concurrent calls in each direction.

Recovery: Postgres backups exist in the staging design. The note says RPO and RTO in plain language (how much data we can lose, how long we take to restore). If we have not built backups, the status is "not done," not "we will do it later" hidden inside a green board.

### What breaks at scale

The failures we care about are retry storms, unbounded queues, and restores that bring back secrets into logs. The exercise should include one of each as a checklist, even if the first run is small.

### Choice

We take a repeatable script, a one-page report, and an SDK that uses the public API only.

We reject a new product feature in this slot. If the test finds a hole, fix the hole. Do not add a new domain.

Cost: this feels like "no new UI." It is the production proof.

### Cloud later

Run the exercise in the staging cluster from feature 29. Keep the script.

### Low-level design

- Script: two gateway replicas, shared Redis, health, a burst of authenticated reads, then stop Postgres and assert a typed error
- SDK: login or API key, list workspaces, create agent, publish if versions exist
- `docs/runbooks/recovery.md` with backup and restore steps
- Update this roadmap's board honestly

### Done when

The script's assertions pass, the SDK uses port 3000 only, and the recovery note has real commands.

### Still unsafe

We will not have a year of on-call practice. We will have a system another engineer can deploy, break, and explain.

---

## 34. How to update this file each day

1. Set **Current focus** in section 6.
2. Set the feature status to `in_progress`.
3. Tick the build boxes you finished.
4. Add three lines under the feature: date, what shipped, what is still unsafe.
5. Set status to `done` only when **Done when** is true.
6. If you are blocked, write the blocker in a sentence. Do not start a feature whose Needs are unfinished.
7. If the code and this board disagree, fix the board the same day. The board was wrong before. Do not let it drift again.

### Daily log

| Date | Feature | Shipped | Still unsafe |
| --- | --- | --- | --- |
| 2026-11-11 | 28 | OTLP HTTP, 429, publish, Redis fail-closed, model timeout and eval database pool saturation metrics, local Prometheus rules, and secret-free error log test | Other worker/database saturation, paging, and production metrics infrastructure remain |
| 2026-11-11 | F11 | Agent-scoped overview, accurate run status, browser response mapping, and comparison of recent compatible runs | End-to-end verification and run-history pagination remain; chart covers the latest 20 runs only |
| 2026-09-28 | 10B | `web-fetch-service` :3007, ADR 0011, contracts, tests | No ledger consumer; artifacts in Postgres only |
| 2026-09-28 | 12 | `runtime-service` :3006, gateway proxy, chat turns + tests | No stream; no voice-turn contract; no Redis membership on path |
| 2026-09-28 | roadmap | §5A–5C order; knowledge-first focus; board statuses | Voice in §5C; 09B → 11 → 13 is current focus |
| 2026-09-28 | 09B | `@quickstart/workspace-access`, ADR 0012, agent/conversation cache | Gateway still does not check URL membership |
| 2026-09-28 | 11 | `knowledge-service` :3009, SQS worker, OpenSearch, gateway proxy, ADR 0013 | Text sources only; no URL ingest via 10B yet |
| 2026-09-28 | 13 | Runtime `KnowledgeClient`, internal retrieve, message metadata | Match search v1; no reranker |
| 2026-09-28 | 14 | `memory-service` :3010, `conversations.subject_key`, runtime inject, ADR 0014 | No auto-extract; no vector memory; widget 17 not wired |
| 2026-09-30 | 15 | `agents.tools`, `tool_calls`, runtime tool loop, model-gateway tools, ADR 0015 | Streaming tools; F2 UI; full MCP SDK; secrets in headers (16) |
| 2026-09-29 | roadmap | Replaced frontend slots F1–F5 with complete F1–F13 roadmap | All 13 frontend slots documented with full detail; Section 35 fully rewritten |
| 2026-10-10 | 18, 19, F1, F4 | Handoff API + outbox slice; staff auth shell and inbox UI | 19 catalog incomplete; F4 has no SSE or list cursor |
| 2026-10-10 | roadmap | Section **6A** remaining end-to-end waves; board synced | Wave 1 is F2, F3, F10 on existing gateway APIs |
| 2026-10-10 | roadmap | Section 3 and **6A**: a product feature includes API and staff screen before it is done | Catch-up is Agents, Knowledge, Settings; new work starts as one slice |

---

## 35. Frontend Features (F1–F13) — Staff Web Application

The API surface is complete enough to begin building the staff console and public surfaces.
These thirteen slots cover the complete frontend application in dependency order.
All slots live in `apps/web/` (Next.js App Router).
No slot touches any service directory.
Both people can work in parallel — one on an F-slot, one on a product or platform feature — as long as they do not edit the same page files.

Words for this section:

| Word | Meaning |
| --- | --- |
| Staff user | An organization member logged into the dashboard (not the end-user of the widget). |
| Publishable key | A workspace-scoped key safe to embed in a browser. Issued by Feature 17. |
| Admin console | The Next.js web app at `apps/web/`. It calls the public gateway on port 3000 only. |
| Route group | A Next.js App Router layout boundary. Use `(public)`, `(auth)`, and `(app)` groups. |
| Server component | A Next.js component that runs on the server. It can read cookies and call the gateway. |
| Client component | A `"use client"` component that runs in the browser. Keep secret-adjacent work out of client components. |

Rules that do not change:

1. The admin console calls only `http://localhost:3000` (gateway). It never calls a service port directly.
2. JWT lives in an HTTP-only, `SameSite=Lax`, `Secure` cookie. Never `localStorage`.
3. Every authenticated page sends the JWT. A missing or expired token redirects to login.
4. No workspace data can appear on a page before the membership check passes.
5. Forms that write data use server actions or `POST` to the gateway. They never call service ports from the browser.
6. Error states are pages, not console logs. A failed API call shows a typed message the user can act on.
7. Every page is responsive — 375px, 768px, 1280px, and 2560px+.

---

### Feature F1 — Frontend Foundation (Landing Page, Auth, Layout, Design System)

**Status:** `done` — httpOnly auth, middleware, workspace shell, landing CTAs. Extra UI kit pieces ship with the feature that needs them.
**Needs:** identity (04), workspace (05), gateway (06)
**Can run beside:** any product feature that does not edit `apps/web/`
**Deep topic:** cookie-based JWT refresh in a server-rendered app; public vs authenticated routing

#### Pre-context

No frontend exists. All backend APIs are tested with curl only. This slot is the gate for all other F-slots. It also includes the public-facing landing/marketing page — the first thing anyone sees when they visit the product URL.

#### What this is

A Next.js 14+ App Router project at `apps/web/` with:
- A public-facing **landing page** at `/` — hero, feature highlights, how-it-works, pricing section, "Get started" CTA
- **Auth pages** — login, register, forgot password, reset password
- **HTTP-only cookie** JWT with server-side silent refresh in Next.js middleware
- **Shared app layout** — sidebar, top bar, workspace switcher, user menu
- **Design system** — color tokens, typography, spacing, button, input, card, badge, modal, toast, table, empty state, loading skeleton, error state
- **Route groups** — `(public)` for landing, `(auth)` for login/register, `(app)` for authenticated pages

#### Why now

Every other F-slot depends on auth, layout, and shared components. The landing page is the public face of the product. Without F1, nothing else can start.

#### Junior shortcut

JWT stored in `localStorage`. XSS on any page leaks the token. Refresh is manual, so the user is logged out after 15 minutes. The landing page is a plain HTML file outside the app with inconsistent styles and a "Get started" link that goes nowhere.

#### Production shape

JWT in HTTP-only cookie. Middleware reads the cookie on every request, silently refreshes if within 60 seconds of expiry, redirects unauthenticated requests to `/login`. A 401 on the refresh call clears the cookie and redirects to login — no infinite retry loop. Workspace id is in the URL path segment, not a query parameter.

#### What breaks at scale

Two browser tabs refreshing simultaneously race on the refresh token. The identity service already handles this with rotating refresh tokens. The frontend must treat a 401 on the refresh call as a hard logout, not a retry signal.

#### Choice

Next.js 14 App Router, HTTP-only cookie, server-side middleware refresh, route groups for layout separation, single shared design system.

Rejected: `localStorage`, client-only rendering for protected pages, per-page auth checks.

Cost: middleware adds a small latency on every request. We accept this because a missing check is a data leak.

#### Cloud later

The Next.js app deploys as a container (same Dockerfile pattern as services). The cookie `Secure` flag is already set so HTTPS in production requires no code change. The gateway URL becomes an environment variable.

#### Low-level design

Pages:
- `/` — Landing: hero, 3-column feature highlights, how-it-works flow, pricing cards, "Get started" CTA
- `/login` — Email + password, link to register, forgot password link
- `/register` — Name, org name, email, password; creates org + user + workspace
- `/forgot-password` — Email form, triggers reset email via gateway
- `/reset-password?token=` — New password form
- `/workspaces/[workspaceId]` — Workspace home (redirects to agents list)
- `apps/web/src/middleware.ts` — cookie check, silent refresh, redirect to `/login` on 401
- `apps/web/src/app/(app)/layout.tsx` — sidebar, top bar, workspace switcher, user menu
- `apps/web/src/components/ui/` — button, input, card, badge, modal, toast, table, skeleton, empty-state, error-state
- `apps/web/src/lib/api.ts` — typed fetch wrapper, reads cookie, sends `Authorization: Bearer` to gateway
- `apps/web/.env.local.example` — `NEXT_PUBLIC_GATEWAY_URL=http://localhost:3000`

#### Build checklist

- [ ] `apps/web/` bootstrapped and added to `pnpm-workspace.yaml`
- [ ] Landing page with hero, features, how-it-works, pricing, CTA
- [ ] Login page — gateway call, JWT stored in HTTP-only cookie on success
- [ ] Register page — creates org + user, redirects to workspace
- [ ] Forgot/reset password end-to-end
- [ ] Middleware: redirect unauthenticated to `/login`, silent refresh, hard logout on refresh 401
- [ ] Sidebar lists user's workspaces from `GET /workspaces`
- [ ] Workspace switcher updates URL without full reload
- [ ] Full design system (button, input, card, badge, modal, toast, table, skeleton, empty-state, error-state)
- [ ] Light and dark mode
- [ ] Fully responsive (375px to 2560px+)
- [ ] `apps/web/README.md` with `pnpm dev` and gateway URL setup

#### Done when

A visitor can see the landing page, click "Get started", register, log in, see workspaces in the sidebar, switch workspace, refresh and remain logged in, and be redirected to login after an expired token.

#### Still unsafe

No OAuth/SSO. No email verification flow. No mobile nav drawer (deferred to responsive polish pass).

---

### Feature F2 — Agent Builder and Agent Settings UI

**Status:** `done` — Agent list, creation form, multi-tab workbench (Identity, Instructions, Model, Tools, Versions), optimistic concurrency (expected_version), Publish/Rollback, and test drawer. Owns `apps/web/src/features/agents/`.
**Needs:** F1, agent drafts (07), agent versions (08), tools (15), secrets (16)
**Can run beside:** F3
**Deep topic:** optimistic concurrency (version field), 409 conflict handling, multi-tab editing

#### Pre-context

Agents can be created, configured, and published via the gateway API. There is no UI. Staff configure agents by curling the API. The agent object has many sub-sections: identity, instructions, model, tools, knowledge, memory, guardrails, channels.

#### What this is

The full agent builder with a tabbed settings page, publish flow, version history, rollback, and an in-page test chat panel.

#### Why now

The widget and voice platform both need a published agent. Without a UI to configure and publish, every demo is a curl command. Customers cannot self-serve.

#### Junior shortcut

Single long form, saves on every keystroke. Two tabs editing the same agent race and one silently overwrites the other. Publish fires even when there are unsaved form changes. No confirmation before publishing to production.

#### Production shape

Form state is local. Save is explicit and sends the current `version` field (optimistic concurrency). A 409 means another actor saved first — show a diff and let the user choose. Publish is a separate button, disabled until the draft is saved. Publish shows a confirmation modal. After publish, the version history updates immediately.

#### What breaks at scale

With 100,000 agents, the list must paginate with a cursor. A `SELECT *` returning all agents for a workspace will not load.

#### Choice

Explicit save, optimistic concurrency (version field), read-only version history list.

Rejected: auto-save on keystroke (too many requests, race conditions), overwriting on conflict (silent data loss).

#### Low-level design

Pages:
- `agents/page.tsx` — paginated agent list, search by name, create button, archive filter
- `agents/new/page.tsx` — create agent (name, description, channel selection)
- `agents/[agentId]/page.tsx` — agent detail shell with 8 tabs:
  - **Identity** — name, description, avatar, agent purpose
  - **Instructions** — system prompt editor with character count and live token estimate
  - **Model** — model selector (list from model gateway), temperature, max tokens, streaming toggle, fallback model
  - **Tools** — attached tools list, add/remove, per-tool permission (allowed/denied)
  - **Knowledge** — attached knowledge sources, add/remove
  - **Memory** — memory on/off toggle, subject_key source config
  - **Guardrails** — topic blocklist, max response length, content policy flags
  - **Channels** — chat/voice/API toggles, publishable key for widget, voice profile settings
- `agents/[agentId]/versions/page.tsx` — version history: version number, author, timestamp, status (production/archived); rollback button + confirmation
- `agents/[agentId]/test/page.tsx` — test chat side panel against the draft (calls runtime with test flag; tool calls shown inline)
- `apps/web/src/lib/agents.ts` — typed API: list, get, create, update, publish, rollback, delete

#### Build checklist

- [ ] Agent list with cursor pagination, search, archive filter
- [ ] Create agent form (name, description, channel selection)
- [ ] All 8 setting tabs built and connected to gateway API
- [ ] System prompt editor with live token count estimate
- [ ] Model selector populated from model gateway API
- [ ] Tool attach/detach with per-tool permission toggle
- [ ] Knowledge source attach/detach
- [ ] Explicit save with optimistic concurrency (version field)
- [ ] 409 conflict shown as visible banner with diff — not silent overwrite
- [ ] Publish button disabled when unsaved changes exist
- [ ] Publish confirmation modal
- [ ] Version history table with rollback + confirmation
- [ ] Test chat side panel (tool calls inline in thread)
- [ ] Archive/delete agent with confirmation

#### Done when

Staff can create an agent, configure all 8 tabs, save, publish, see the version in history, rollback, and test the draft in the side panel.

#### Still unsafe

No agent clone/duplicate. No A/B version comparison UI. No drag-and-drop tool reordering.

---

### Feature F3 — Knowledge and Memory UI

**Status:** `done` — **Wave 1.** Gateway already proxies knowledge and memory. Build `features/knowledge`. See section **6A**.
**Needs:** F1, knowledge ingest (11), memory (14)
**Can run beside:** F2
**Deep topic:** async ingest status polling with terminal stop condition; cross-system delete (UI must not orchestrate multi-system cleanup itself)

#### Pre-context

Staff can upload knowledge sources and read memory facts via the gateway API. There is no UI. The SQS ingest worker runs in the background and staff have no visibility into ingest status.

#### What this is

Pages for managing workspace knowledge sources and customer memory facts.

#### Why now

Retrieval (Feature 13) works but knowledge sources are invisible to non-technical users. Memory facts cannot be reviewed or removed without curl.

#### Junior shortcut

The junior adds a source and shows a spinner with no timeout. If the SQS worker fails silently, the spinner spins forever. The delete action removes only the Postgres row, leaving OpenSearch chunks and S3 objects orphaned.

#### Production shape

Source status polled with a 5-second interval that stops after `status === 'ready'` or `status === 'failed'`. Failed sources show the error reason. Delete calls a single API endpoint that removes the Postgres row, OpenSearch chunks, and S3 object — the service owns cross-system cleanup, not the UI.

#### Low-level design

Pages:
- `knowledge/page.tsx` — paginated source list: status badges (pending, processing, ready, failed), source type, name, chunk count, created at; filter by status; search by name
- `knowledge/new/page.tsx` — add source: type selector (URL, file upload, plain text), name, description
- `knowledge/[sourceId]/page.tsx` — source detail: status, error reason if failed, chunk count, re-ingest button, delete button
- `knowledge/[sourceId]/chunks/page.tsx` — paginated chunk list (for retrieval debugging): chunk text preview, embedding status
- `memory/page.tsx` — paginated fact list, filter by subject_key, search by fact text
- `memory/[factId]/page.tsx` — fact detail, edit fact text, delete with confirmation (GDPR)
- `memory/subject/[subjectKey]/page.tsx` — all facts for one subject_key; bulk erase all (GDPR)
- `useSourceStatus(sourceId)` hook — polls every 5 seconds, stops on terminal state, shows error reason on failed

#### Build checklist

- [ ] Knowledge source list with status badges, filter, search
- [ ] Add source form (URL, file upload, plain text)
- [ ] Status polling hook — terminal stop, error reason on failed
- [ ] Delete source — single API call (service owns cross-system cleanup), optimistic removal
- [ ] Re-ingest button
- [ ] Chunk viewer (paginated)
- [ ] Memory fact list with subject_key filter and cursor pagination
- [ ] Edit fact inline
- [ ] Delete fact with confirmation (GDPR)
- [ ] All facts by subject_key with bulk GDPR erase

#### Done when

Staff can add a source, watch it go from processing to ready, view chunks, delete a source, and list/edit/delete memory facts including bulk GDPR erase.

#### Still unsafe

No file upload progress bar. No citation link from inbox back to source chunk. No bulk delete of sources.

---

### Feature F4 — Conversation Inbox and Live Chat UI

**Status:** `done` (v1 staff inbox: list, thread, take, release, human send, transcript). Gaps listed in section **6A**. Do not reopen unless fixing a bug.
**Needs:** F1, conversations (09), inbox and human handoff (18)
**Can run beside:** F2
**Deep topic:** cursor pagination, after_seq message append, SSE streaming, 409 race condition on take

#### Pre-context

Conversations and messages exist in Postgres. Feature 18 adds state and assignee. There is no UI to read conversations or take over as a human agent.

#### What this is

A full conversation inbox where staff can see all workspace conversations, open a thread, read history, take over from the AI, send human messages, and release back to the bot.

#### Junior shortcut

Polls `GET /conversations` every second for new messages. At 10,000 concurrent chats, 10,000 browser tabs each polling every second is the full sustained gateway target used by the inbox alone. The message list fetches all messages on every render instead of using the cursor.

#### Production shape

Inbox list uses cursor pagination. Message thread uses SSE when available, or after_seq polling at a 3-second interval. New messages append at the bottom without a full list refresh. Take and release are single-button actions with optimistic local state update and server reconciliation.

#### Low-level design

Pages:
- `inbox/page.tsx` — conversation list: filter tabs (All, Bot, Waiting, Human, Resolved), search by subject_key or content, cursor pagination, unread count badge on sidebar nav
- `inbox/[conversationId]/page.tsx` — message thread:
  - Last 50 messages on open, scroll up to load earlier via cursor
  - Message bubbles: role (ai, human, system), timestamp, tool call events shown inline
  - New messages appended via after_seq poll or SSE
  - Right panel: channel, subject_key, assignee, state, started at, tags
  - Take button (disabled unless state is `waiting`; 409 toast if race lost)
  - Release button (returns to AI)
  - Resolve button
  - Human message input + send
- `inbox/[conversationId]/transcript/page.tsx` — full printable transcript
- `useMessages(conversationId, afterSeq)` hook — appends without replacement

#### Build checklist

- [ ] Inbox list with filter tabs (All, Bot, Waiting, Human, Resolved)
- [ ] Search by subject_key and message content
- [ ] Unread count badge on sidebar nav item
- [ ] Message thread with last-50 load, scroll-up to load earlier
- [ ] New message append via after_seq poll (SSE when streaming ships)
- [ ] Tool call events shown inline in thread
- [ ] Take button — disabled when not `waiting`, 409 toast on race
- [ ] Release button
- [ ] Resolve button
- [ ] Human message input and send
- [ ] Right panel conversation metadata
- [ ] Printable transcript view

#### Done when

Staff can open a conversation, read history, take it from the AI, send a human reply, confirm the bot is silent while state is `human`, and release back to the AI.

#### Still unsafe

No push notifications for new conversations. No audio playback for voice transcripts from this view (covered in F5).

---

### Feature F5 — Inbound Voice UI (Call Logs, Live Calls, Transcripts)

**Status:** `done`
**Needs:** F1, voice path (21), speech providers (21B)
**Can run beside:** F6
**Deep topic:** realtime call state polling; STT/LLM/TTS latency stage breakdown per turn; live transcript streaming

#### Pre-context

The voice service handles inbound calls. There is no UI to see active calls, completed call logs, or transcripts.

#### What this is

Pages for monitoring inbound voice calls — live and historical — with call detail, turn-by-turn transcript, and stage latency breakdown.

#### Low-level design

Pages:
- `voice/inbound/page.tsx` — call log: status badges (live, completed, failed, transferred), caller ID, duration, agent used, started at; filter by status and date range; cursor pagination
- `voice/inbound/live/page.tsx` — live call dashboard: all active inbound calls with real-time duration counter, caller ID, agent in use
- `voice/inbound/[callId]/page.tsx` — call detail:
  - Metadata: caller, agent, status, duration, disposition
  - Live status indicator if call is still active
  - Stage latency per turn: STT latency / LLM latency / TTS latency (from OTel trace data)
  - Turn-by-turn transcript: speaker labels (AI / Caller), timestamps, tool calls inline
  - Audio playback if recording exists
  - Link to corresponding conversation in inbox
- `useCallStatus(callId)` hook — polls every 3 seconds while call is live, stops on terminal state

#### Build checklist

- [x] Inbound call log with status filter and date range
- [x] Cursor pagination on call log
- [x] Live call dashboard with real-time duration counters
- [x] Call detail: metadata, live status indicator
- [x] Stage latency breakdown per turn (STT / LLM / TTS)
- [x] Turn-by-turn transcript with speaker labels and inline tool events
- [x] Audio playback from recording URL
- [x] Link to conversation inbox thread

#### Done when

Staff can see all live inbound calls, open a call, read the turn-by-turn transcript, see the latency per stage, and play back the recording.

#### Still unsafe

No live listen-in audio stream. No call transfer trigger from the UI. No voicemail playback.

---

### Feature F6 — Outbound Voice and Campaign Management UI

**Status:** `done`
**Needs:** F1, telephony (21C), campaigns (23)
**Can run beside:** F5
**Deep topic:** campaign state machine (draft→scheduled→running→paused→completed); concurrency cap configuration; retry policy builder

#### Pre-context

The campaign service handles outbound calling campaigns. There is no UI to create, manage, or monitor campaigns, and no outbound call log UI.

#### What this is

Full campaign management and outbound call log pages.

#### Why now

Feature 23 (campaigns) ships an API. Without a UI, staff cannot create or monitor outbound campaigns without writing API calls by hand. Customers cannot run campaigns at all.

#### Junior shortcut

Clicking "launch" fires the campaign without an audience, schedule, or retry policy. There is no per-contact status. The concurrency cap is not configurable, so one campaign can saturate all voice slots.

#### Production shape

Campaign creation is a 5-step wizard with per-step validation. The campaign detail page polls live metrics. Pause, Resume, and Stop are explicit actions with confirmation modals. Per-contact status is paginated with a cursor.

#### Low-level design

Pages:
- `campaigns/page.tsx` — campaign list: status badges (draft, scheduled, running, paused, completed, failed), audience size, calls made/total progress bar, success rate; filter by status; cursor pagination
- `campaigns/new/page.tsx` — campaign creation wizard (5 steps):
  - Step 1: Name, description, which agent to use
  - Step 2: Audience — upload CSV (column mapping: phone, name, custom fields) or select saved lead list
  - Step 3: Schedule — start datetime, timezone, daily call window (from/to hours), max concurrent calls cap
  - Step 4: Retry policy — max retries per contact, retry interval, no-answer handling, voicemail handling
  - Step 5: Review summary, launch or save as draft
- `campaigns/[campaignId]/page.tsx` — campaign detail: status cards (total contacts, calls made, answered, success rate, avg duration), live metrics (active now, queued, failed, retrying), progress bar, calls-per-hour timeline chart, Pause/Resume/Stop with confirmation
- `campaigns/[campaignId]/contacts/page.tsx` — per-contact status: name, phone, status (pending/called/answered/no-answer/voicemail/opted-out/failed), attempt count, last attempt; filter by status; cursor pagination
- `campaigns/[campaignId]/contacts/[contactId]/page.tsx` — contact attempt history within this campaign
- `voice/outbound/page.tsx` — outbound call log across all campaigns
- `voice/outbound/[callId]/page.tsx` — outbound call detail (transcript, latency breakdown, audio playback)

#### Build checklist

- [x] Campaign list with status filters and cursor pagination
- [x] Create campaign wizard (5 steps with per-step validation)
- [x] CSV audience upload with column mapping preview
- [x] Lead list selector as audience source
- [x] Campaign detail with live metrics cards and progress bar
- [x] Calls-per-hour timeline chart
- [x] Pause, Resume, Stop with confirmation modals
- [x] Per-contact status table with filter and cursor pagination
- [x] Contact attempt history with links to call detail
- [x] Outbound call log list
- [x] Outbound call detail (transcript, latency, audio)
- [x] Opt-out status visible on contact row

#### Done when

Staff can create a campaign, upload an audience CSV, schedule it, launch it, watch per-contact progress in real time, pause it, and see outbound call transcripts.

#### Still unsafe

No A/B campaign testing. No SMS/email fallback channel. No drag-and-drop audience builder.

---

### Feature F7 — Leads Management UI

**Status:** `done`
**Needs:** F1, leads (24)
**Can run beside:** F6
**Deep topic:** lead lifecycle (new→qualified→contacted→converted/lost); source attribution

#### Pre-context

Leads are created from conversations, campaigns, and the API. There is no UI to view, score, or manage them.

#### Low-level design

Pages:
- `leads/page.tsx` — lead list: name, phone, email, source (chat/voice/campaign/API/manual), score, status (new, qualified, contacted, converted, lost), created at; filter by status and score range; search by name/email/phone; cursor pagination
- `leads/new/page.tsx` — manually create a lead (name, phone, email, custom fields, notes)
- `leads/[leadId]/page.tsx` — lead detail:
  - Contact information card
  - Lead score with scoring breakdown by factor
  - Status selector dropdown
  - Notes textarea (saved on blur)
  - Activity timeline: conversations, voice calls, campaign touches, status changes in chronological order
  - Assign to campaign button (modal with campaign selector)

#### Build checklist

- [ ] Lead list with status filter, score range filter, search by name/email/phone
- [ ] Cursor pagination
- [ ] Manual lead creation
- [ ] Lead detail with scoring breakdown
- [ ] Status update inline
- [ ] Notes field
- [ ] Activity timeline (conversations, calls, campaign touches, status changes)
- [ ] Assign to campaign modal

#### Done when

Staff can see all leads, open a lead, read the full activity timeline across conversations and calls, update the status, add a note, and assign the lead to an outbound campaign.

#### Still unsafe

No CRM push from UI without a configured CRM tool. No bulk status update.

---

### Feature F8 — Workflow and Event Builder UI

**Status:** `done`
**Needs:** F1, event platform (19), workflow automation (20)
**Can run beside:** F7
**Deep topic:** visual trigger-condition-action builder; workflow execution run trace; idempotency of repeated triggers

#### Pre-context

The event platform publishes events and the workflow service can execute trigger-condition-action sequences. There is no UI to define or monitor workflows.

#### What this is

Pages for creating and monitoring automated workflows, and a workspace event log.

#### Low-level design

Pages:
- `workflows/page.tsx` — workflow list: name, trigger event, status (active/paused/draft), last triggered at, 7-day success rate
- `workflows/new/page.tsx` — workflow builder:
  - Trigger: event type dropdown (full list of all platform event types)
  - Conditions: condition rows (field / operator / value), AND/OR logic
  - Actions (ordered list): run agent, start campaign, call webhook (URL + method + body template), wait/delay, update lead status
  - Save as draft or activate immediately
- `workflows/[workflowId]/page.tsx` — workflow detail in edit mode, activate/pause toggle, delete
- `workflows/[workflowId]/runs/page.tsx` — run history: trigger event, status (success/failed/skipped), triggered at, duration; cursor pagination
- `workflows/[workflowId]/runs/[runId]/page.tsx` — run detail: per-step input, output, and error trace; re-run button (idempotent)
- `events/page.tsx` — workspace event log: event type, actor, resource, timestamp; filter by event type and date range; cursor pagination

#### Build checklist

- [ ] Workflow list with status badges
- [ ] Workflow builder: trigger selector, condition rows (AND/OR), action sequence
- [ ] 5 action types: run agent, start campaign, call webhook, wait/delay, update lead status
- [ ] Save as draft and activate controls
- [ ] Edit workflow, activate/pause toggle
- [ ] Run history with cursor pagination
- [ ] Run detail with per-step input/output trace
- [ ] Re-run button on failed runs
- [ ] Event log with type filter and date range

#### Done when

Staff can create a `lead.created` → condition → start campaign workflow, activate it, and see run history with a per-step trace when it fires.

#### Still unsafe

No drag-and-drop visual canvas. No if/else branching. No loop protection UI.

---

### Feature F9 — Analytics and Usage UI

**Status:** `done` (Dashboard UI implemented with 6 summary cards, 6 charts, 7d/30d/custom date picker, preview fixtures, and backend dependencies doc)
**Needs:** F1, usage and billing (26)
**Can run beside:** F8
**Deep topic:** pre-aggregated daily rollup (Feature 26 job); no live aggregation from raw usage_events; stored price snapshots for cost estimates

#### Pre-context

Usage rows exist in Postgres after Feature 26 ships. There is no read surface. Cost overruns are invisible until an invoice arrives.

#### Junior shortcut

Runs `SELECT SUM(tokens) FROM usage_events WHERE workspace_id = ?` on every page load without a date filter — full table scan on every visit. Cost estimates use live vendor prices, so a vendor API outage takes the usage page down.

#### Production shape

UI requests pre-aggregated daily totals from the Feature 26 rollup job for a date range. Cost estimates use stored price snapshots on each usage row, not live vendor calls. No raw aggregation in the frontend.

#### Low-level design

Pages:
- `analytics/page.tsx` — overview dashboard: total conversations, voice minutes, LLM tokens, estimated cost (current period); conversations per day bar chart; top 5 agents by token usage; top tool calls
- `analytics/usage/page.tsx` — usage deep dive: date range picker (default 30 days), token by day (bar chart stacked by model), voice minutes by day, acquisition units by day, per-agent breakdown table, per-model breakdown table, CSV export
- `analytics/conversations/page.tsx` — conversation metrics: resolution rate, human handoff rate, avg duration, by-channel pie chart (chat vs voice), top escalation reasons, conversation volume trend
- `analytics/voice/page.tsx` — voice metrics: avg call duration, failed call rate, transfer rate, STT/LLM/TTS latency per day (line chart), inbound vs outbound call volume
- `apps/web/src/lib/usage.ts` — typed API: `GET /usage/summary?start&end`, `GET /usage/agents?start&end`, `GET /usage/export`

#### Build checklist

- [x] Overview dashboard with summary cards and daily charts
- [x] Date range picker (default 30 days) with 7d, 30d, and custom popover
- [x] Token + voice minutes + acquisition units per day charts
- [ ] Per-agent breakdown with cursor pagination (waiting on F9 daily rollup API; ledger list/sum shipped in Feature 26)
- [ ] Per-model breakdown table
- [ ] CSV export button
- [ ] Conversation metrics page (resolution rate, handoff rate, by channel)
- [ ] Voice metrics page with latency breakdown
- [x] Empty/unavailable state when F9 analytics rollup not yet connected (ledger exists; charts wait on rollup)
- [x] Error state when usage API unavailable (typed message, not a broken chart)

#### Done when

Staff can see totals for the last 30 days, change the date range, drill into per-agent costs, and download a CSV.

#### Still unsafe

No spend cap or alert UI. No org-level rollup across workspaces. No invoice or payment UI.

---

### Feature F10 — Workspace Settings (Members, Roles, API Keys, Billing, Secrets)

**Status:** `done` — **Wave 1** in section **6A** for members, invites, API keys, secrets, publishable keys, and danger zone. Billing screens wait for Feature **26**. Own `apps/web/src/features/settings/` only.
**Needs:** F1, identity (04), workspace (05), secrets (16)
**Can run beside:** F9
**Deep topic:** RBAC permission display; API key value shown once then masked forever; secret vault — value never shown after creation

#### Pre-context

Workspace settings — member management, role assignment, API key creation, billing plan, and tool secrets — have no UI. Everything is done via API.

#### Low-level design

Pages:
- `settings/general/page.tsx` — workspace name, description, timezone, logo upload, slug
- `settings/members/page.tsx` — member list (name, email, role badge, joined at, remove); pending invites tab (resend/cancel)
- `settings/members/invite/page.tsx` — invite form: email + role selector with role description tooltips
- `settings/api-keys/page.tsx` — API key list: name, last 4 chars only (masked), scopes, created at, last used, revoke button; create button
- `settings/api-keys/new/page.tsx` — create key: name, expiry (optional), scope selector; shows full key once with copy button; "will not be shown again" warning banner
- `settings/secrets/page.tsx` — secret list (name only, value never shown after creation), created at, last rotated at; add, rotate, delete buttons
- `settings/secrets/new/page.tsx` — create secret: name, value (masked input)
- `settings/secrets/[secretId]/rotate/page.tsx` — provide new value; old value replaced
- `settings/publishable-keys/page.tsx` — publishable key list for website widget: key prefix, name, origin allow-list, created at; create, edit allow-list, revoke
- `settings/billing/page.tsx` — current plan name, usage vs quota bars (tokens, voice minutes), upgrade/downgrade button → billing portal redirect
- `settings/danger/page.tsx` — delete workspace: confirm by typing workspace name, permanent delete button

#### Build checklist

- [x] General settings with logo upload / initial avatar fallback
- [x] Member list with roles; pending invites
- [x] Invite by email with role selector and role description tooltips
- [x] Change member role (owner only)
- [x] Remove member with confirmation
- [x] API key list with create and revoke
- [x] Create API key — shows full value once with copy button + "not shown again" warning
- [x] Secret list (name only, value never shown) with add, rotate, delete
- [x] Rotate secret (re-encrypt / replace value, old value gone)
- [x] Publishable key list with origin allow-list editor per key
- [ ] Billing page: plan name + usage vs quota bars (deferred; ledger facts exist, no payments/quotas UI yet)
- [x] Delete workspace with workspace-name confirmation guard

#### Done when

An owner can invite a member, assign a role, create an API key (sees it once), add a secret (value never shown again), manage publishable keys and their origin allow-lists.

#### Still unsafe

No SSO/SAML configuration. No IP allowlisting. No audit log for secret access from this UI (covered in F12).

---

### Feature F11 — Agent Evaluation UI

**Status:** `in_progress` — evaluation screens and API integration exist; agent overview scoping and failed-read handling corrected. End-to-end verification and pagination remain.
**Needs:** F1, evaluation (25)
**Can run beside:** F9
**Deep topic:** offline eval run lifecycle (queued→running→scored); regression detection across versions; score comparison chart

#### Pre-context

The evaluation service can run a published agent version against a fixed test dataset and produce quality scores. There is no UI to define datasets, trigger runs, or compare version scores.

#### Low-level design

Pages:
- `agents/[agentId]/eval/page.tsx` — eval home: dataset list, recent run history, score trend chart (version vs score)
- `agents/[agentId]/eval/datasets/page.tsx` — dataset list with create, edit, delete
- `agents/[agentId]/eval/datasets/new/page.tsx` — create dataset: name, description; add test cases one by one
- `agents/[agentId]/eval/datasets/[datasetId]/page.tsx` — test case table: input, expected output, expected tools; edit inline; CSV import button
- `agents/[agentId]/eval/runs/page.tsx` — run history: version number, dataset name, overall score, pass count / total, status, created at; cursor pagination
- `agents/[agentId]/eval/runs/new/page.tsx` — trigger new eval run: select version + dataset, confirm
- `agents/[agentId]/eval/runs/[runId]/page.tsx` — run detail: overall score, per-case results (input, actual output, expected output, pass/fail badge, score per case); failure analysis section
- Version comparison bar chart: select 2+ versions, see scores side by side

#### Build checklist

- [ ] Dataset list with create/edit/delete
- [ ] Test case editor (input, expected output, expected tools)
- [ ] CSV import for test cases
- [ ] Trigger eval run (select version + dataset)
- [ ] Run history with scores and cursor pagination
- [ ] Run detail: overall score, per-case pass/fail table
- [ ] Version comparison bar chart
- [ ] Run status polling (queued → running → scored), stops on terminal state

#### Done when

Staff can define a 10-case dataset, run eval against two versions, see which scored higher, and drill into which cases failed.

#### Still unsafe

No automatic eval blocking of deployments. No human labeling UI for open-ended answer cases.

---

### Feature F12 — Audit Log and Notification Center

**Status:** `not_started`
**Needs:** F1, audit (27)
**Can run beside:** F11
**Deep topic:** append-only audit records; notification unread count without a global state store; 30-second poll is enough and does not flood the gateway

#### Pre-context

Every important action is logged in the audit service. Staff have no visibility into what other team members have done. There are no in-app notifications.

#### Low-level design

Pages:
- `audit/page.tsx` — workspace audit log: actor (name + avatar), action type badge, resource (type + name), timestamp; filter by actor, action type (multiselect), date range; search by resource ID; cursor pagination; CSV export
- `audit/[entryId]/page.tsx` — audit entry detail: full metadata JSON, request_id, before/after diff if applicable
- `notifications/page.tsx` — notification center: icon by type, title, description, time ago, read/unread state; filter by type (ingest failure, campaign failed, quota alert, new member, high error rate, agent publish); mark individual as read; mark all as read; cursor pagination
- Notification bell icon in top bar with unread count badge (number badge, not dot)
- `useNotificationCount()` hook — polls `GET /notifications/unread-count` every 30 seconds

#### Build checklist

- [ ] Audit log list with actor, action type badge, resource, timestamp
- [ ] Filter by actor, action type, date range; search by resource ID
- [ ] Audit entry detail with full metadata and before/after diff
- [ ] CSV export of audit log
- [ ] Notification center with type icons and filter
- [ ] Mark individual and all as read
- [ ] Notification bell in top bar with unread count badge (number)
- [ ] Unread count polling hook (30-second interval)

#### Done when

An owner can filter the audit log to agent publish events from the last 7 days, export to CSV, and see a number badge in the top bar when a new alert fires.

#### Still unsafe

No email notification delivery. No webhook-based notification forwarding. No push notifications.

---

### Feature F13 — Developer Portal (API Reference, SDK Docs, Webhooks)

**Status:** `not_started`
**Needs:** F1, public API finalized
**Can run beside:** F12
**Deep topic:** OpenAPI rendering with try-it console; HMAC signature verification documentation; API key scoping display

#### Pre-context

Developers can integrate QuickStart AI via the REST API and the TypeScript SDK in `sdk/`. There is no documentation UI. Webhook configuration has no management interface.

#### What this is

A developer-facing portal where integrators can read API docs, copy SDK examples, register webhooks, and debug webhook delivery failures.

#### Low-level design

Pages:
- `developer/page.tsx` — portal home: quick start code snippet, links to API reference, SDK docs, webhooks, changelog
- `developer/api-reference/page.tsx` — interactive API reference rendered from the OpenAPI spec: endpoints grouped by category (agents, conversations, knowledge, memory, runtime, voice); per endpoint: description, request and response schemas, example curl and TypeScript SDK call; try-it console with API key selector and live response
- `developer/sdks/page.tsx` — TypeScript SDK docs: install (`pnpm add @quickstart/sdk`), quick start example, streaming example, tool calling example, error handling example
- `developer/webhooks/page.tsx` — webhook list: URL, subscribed event types (badge list), status (active/failing), last delivery timestamp, success rate
- `developer/webhooks/new/page.tsx` — register webhook: URL input, event type multiselect (all platform event types), auto-generated HMAC secret shown once with copy button, test ping button
- `developer/webhooks/[webhookId]/page.tsx` — webhook detail: recent deliveries table (event type, status code, latency, delivered at), redeliver button per delivery, disable/enable toggle, delete with confirmation
- `developer/webhooks/[webhookId]/deliveries/[deliveryId]/page.tsx` — delivery detail: request headers and body, response status, headers, and body; HMAC signature used; redeliver button
- `developer/changelog/page.tsx` — API version changelog with dates and breaking-change badges

#### Build checklist

- [ ] Developer portal home with quick start snippet
- [ ] API reference rendered from OpenAPI spec with try-it console
- [ ] SDK docs with 5 copy-paste examples
- [ ] Webhook list with status indicators and success rate
- [ ] Register webhook with event type selector and auto-generated HMAC secret (shown once)
- [ ] Test ping on new webhook registration
- [ ] Delivery history table with redeliver button
- [ ] Delivery detail with full request and response body
- [ ] API changelog page

#### Done when

A developer can read the API reference, test an endpoint from the portal, register a webhook, trigger a test ping, and debug a failed delivery by reading the request and response bodies.

#### Still unsafe

No auto-generated SDK from the OpenAPI spec. No GraphQL surface. No rate limit visualization per API key.

