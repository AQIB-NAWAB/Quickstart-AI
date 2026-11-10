# QuickStart AI

QuickStart AI is a **multi-tenant platform for building, deploying, and operating AI agents** for real businesses. A workspace configures agents with instructions, models, tools, and knowledge; those agents then serve customers on the **website widget**, in the **staff inbox** (chat and voice), through **outbound campaigns**, and via **automated lead generation** that finds and qualifies prospects before humans follow up.

We are building this as a **production engineering system**, not a demo chatbot: tenant isolation, evidence-backed lead research, idempotent APIs, fair job scheduling, and observability are first-class from the start. The long-form product and scale targets live in [docs/project_details.md](docs/project_details.md).

## What you get today

| Area | What it does |
|------|----------------|
| **Agents** | Create and publish workspace agents (instructions, channels, tools). |
| **Conversations & inbox** | Staff handle visitor threads, live voice, and handoff. |
| **Embeddable widget** | Publishable-key chat (and voice paths) on customer sites. |
| **Lead generation** | Business profile research, category/location runs, accepted leads with evidence. |
| **Campaigns** | Audience from CSV or an accepted lead-gen run; voice campaigns when telephony is connected; audience-only campaigns without dial requirements. |
| **Gateway** | Public API, widget routes, and service proxy behind one edge. |

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
- **Docker Compose v2** for local Postgres, Valkey, and related data plane pieces

## Setup

```bash
pnpm install
pnpm check          # lint, typecheck, test, build across workspaces
```

Copy [`.env.example`](.env.example) to `.env` and adjust ports if needed.

### Local data plane

```bash
make up
make smoke
```

Migrations and per-service READMEs are under each `services/*/README.md` (e.g. `make identity-migrate`, `make lead-generation-migrate`).

### Staff web UI

```bash
pnpm --filter @quickstart/web dev
```

Default local URL is often **http://127.0.0.1:3015** when `PORT=3015` is set (see stack scripts).

### Widget on a customer-style page (port 8080)

```bash
pnpm seed:demo              # once, with stack up
pnpm widget:test:prepare    # writes fixtures/widget-test/config.local.js (gitignored)
pnpm widget:test:serve      # http://127.0.0.1:8080 — Northline demo host + embedded widget
```

Add `http://127.0.0.1:8080` to the publishable key’s allowed origins. Widget script is served from the web app (`/quickstart-widget.js`); gateway handles public widget API on **:3000**.

### Lead generation stack (optional)

```bash
bash scripts/start-lead-generation.sh
```

See [services/lead-generation-service/README.md](services/lead-generation-service/README.md) for `LEAD_GENERATION_MODE=live` vs demo and provider keys.

## Branching & commits

Day-to-day work lands on **`aqib`**; **`main`** is integration. Use clear commit messages; no AI co-author trailers (see [.cursorrules](.cursorrules)).

## License

TBD.
