# Agent platform improvement plan

This plan turns the agent builder into a complete, safe, scalable operating surface.

## Phase 1 — Configuration foundation (complete)

- [x] Persist knowledge, memory, and guardrail settings on agents.
- [x] Freeze those settings in published release snapshots.
- [x] Add source selection and policy controls to the agent editor.
- [x] Add tool-policy fields to the shared tool contract.
- [x] Add archive metadata and cursor-aware agent listing APIs.
- [x] Add archive endpoint and gateway/BFF plumbing.
- [x] Enforce tool policies in runtime execution.

## Phase 2 — Catalogs and governance

- [x] Expose a backend-owned model/tool catalog with environment overrides.
- [x] Replace hardcoded model options in the editor.
- [x] Use the backend tool catalog to control available built-ins in the editor.
- [x] Add per-tool channel, confirmation, risk, and rate-limit controls.
- [x] Add release-readiness checks and surface publish blockers before deployment.
- [x] Add names-only connection/secret readiness checks before publish.

## Phase 3 — Scale and collaboration

- [x] Connect cursor pagination to the agent list UI.
- [x] Add archived-agent filtering and restore actions.
- [x] Add draft-preserving conflict resolution instead of overwriting local edits.
- [x] Add safe deletion dependency checks; agents must be archived and have no live release.
- [x] Add bulk archive.

## Phase 4 — Testing and release safety

- [x] Add saved test cases and regression suites to the agent workspace.
- [x] Link the editor to the saved evaluation workspace for immutable release comparisons.
- [x] Run evaluations against real published version IDs, with publish-first validation.
- [x] Compare draft, staging, production, and canary release snapshots and rollout pointers.
- [x] Add publish approvals, release checklists, and scheduled releases.
- [x] Add canary rollout and automatic rollback gates.

## Phase 5 — Operations (in progress)

- [x] Add per-agent token, latency, and cost attribution to the usage ledger.
- [x] Add an agent-scoped observability tab backed by analytics filters.
- [x] Add per-agent quality, tool, and handoff metrics.
- [x] Add trace/error drill-down from a release to a graph execution session.
- [x] Add retention, PII, and release-audit controls to the agent settings.
- [x] Add load and failure tests for high-volume agent lists, trace histories, and runtime turns.

### Delivered implementation notes

- Scheduled releases persist a version pointer and UTC activation time, are promoted by the agent-service worker, and are exposed as the staging environment until activation.
- Environment comparison returns draft, staging, production, and canary immutable snapshots so evaluation and UI clients can compare behavior/configuration before rollout.
- Canary routing uses a stable conversation hash, records canary release traces, and disables the canary after the configured rolling error-rate threshold is exceeded.
- Agent observability settings control trace retention, input/output capture, and guardrail-driven PII redaction; release approvals and checklist completion are written into the append-only publish audit record.
