"use client";

import { useEffect, useState } from "react";
import type { AgentConfiguration } from "@quickstart/contracts";
import { DEFAULT_AGENT_CONFIGURATION } from "@quickstart/contracts";
import { listSources } from "@/features/knowledge/lib/client";
import type { KnowledgeSource } from "@/features/knowledge/lib/types";

type Props = {
  workspaceId: string;
  configuration: AgentConfiguration;
  onChange: (configuration: AgentConfiguration) => void;
};

export function PoliciesTab({ workspaceId, configuration, onChange }: Props) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void listSources(workspaceId, { limit: 100, status: "ready" }, controller.signal)
      .then((result) => {
        if (result.error) setSourceError(result.error.message);
        else setSources(result.sources ?? []);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSourceError("Could not load knowledge sources.");
      });
    return () => controller.abort();
  }, [workspaceId]);

  const knowledge = configuration.knowledge;
  const memory = configuration.memory;
  const guardrails = configuration.guardrails;
  const release = configuration.release;
  const observability = configuration.observability;
  const update = (patch: Partial<AgentConfiguration>) => onChange({ ...configuration, ...patch });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-[24px] font-semibold text-[#202125]">Knowledge, memory &amp; safety</h2>
        <p className="mt-1 text-[14px] text-[#667085]">
          Control what your agent can recall, retrieve, and refuse.
        </p>
      </div>

      <section className="rounded-lg border border-[#DCE1E8] bg-white p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[18px] font-semibold">Knowledge retrieval</h3>
            <p className="text-[13px] text-[#667085] mt-1">
              Ground answers in selected workspace sources.
            </p>
          </div>
          <input
            aria-label="Enable knowledge retrieval"
            type="checkbox"
            checked={knowledge.enabled}
            onChange={(e) => update({ knowledge: { ...knowledge, enabled: e.target.checked } })}
            className="mt-1 h-5 w-5 accent-[#FF571A]"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[13px] font-medium">
            Search method
            <select
              value={knowledge.search_method}
              onChange={(e) =>
                update({
                  knowledge: {
                    ...knowledge,
                    search_method: e.target.value as typeof knowledge.search_method,
                  },
                })
              }
              className="mt-1 block h-10 w-full rounded border border-[#DCE1E8] px-3 text-sm"
            >
              <option value="hybrid">Hybrid</option>
              <option value="semantic">Semantic</option>
              <option value="keyword">Keyword</option>
            </select>
          </label>
          <label className="text-[13px] font-medium">
            Maximum results
            <input
              type="number"
              min={1}
              max={20}
              value={knowledge.max_results}
              onChange={(e) =>
                update({ knowledge: { ...knowledge, max_results: Number(e.target.value) || 1 } })
              }
              className="mt-1 block h-10 w-full rounded border border-[#DCE1E8] px-3 text-sm"
            />
          </label>
        </div>
        <div>
          <p className="text-[13px] font-medium">Knowledge sources</p>
          {sourceError ? (
            <p className="mt-2 text-sm text-red-600">{sourceError}</p>
          ) : sources.length === 0 ? (
            <p className="mt-2 text-sm text-[#667085]">
              No ready sources found. Add sources in Workspace Knowledge.
            </p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {sources.map((source) => (
                <label
                  key={source.id}
                  className="flex items-center gap-2 rounded border border-[#EAECF0] p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={knowledge.source_ids.includes(source.id)}
                    onChange={(e) =>
                      update({
                        knowledge: {
                          ...knowledge,
                          source_ids: e.target.checked
                            ? [...knowledge.source_ids, source.id]
                            : knowledge.source_ids.filter((id) => id !== source.id),
                        },
                      })
                    }
                    className="h-4 w-4 accent-[#FF571A]"
                  />
                  {source.name}
                </label>
              ))}
            </div>
          )}
        </div>
      </section>
      <section className="rounded-lg border border-[#DCE1E8] bg-white p-6 space-y-5">
        <div>
          <h3 className="text-[18px] font-semibold">Observability &amp; privacy</h3>
          <p className="mt-1 text-[13px] text-[#667085]">
            Limit trace retention and avoid storing sensitive execution payloads.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-[13px] font-medium">
            Trace retention (days)
            <input
              type="number"
              min={1}
              max={30}
              value={observability.trace_retention_days}
              onChange={(e) =>
                update({
                  observability: {
                    ...observability,
                    trace_retention_days: Math.min(30, Math.max(1, Number(e.target.value) || 1)),
                  },
                })
              }
              className="mt-1 block h-10 w-full rounded border border-[#DCE1E8] px-3 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={observability.capture_inputs}
              onChange={(e) =>
                update({ observability: { ...observability, capture_inputs: e.target.checked } })
              }
              className="h-4 w-4 accent-[#FF571A]"
            />
            Capture trace inputs
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={observability.capture_outputs}
              onChange={(e) =>
                update({ observability: { ...observability, capture_outputs: e.target.checked } })
              }
              className="h-4 w-4 accent-[#FF571A]"
            />
            Capture trace outputs
          </label>
        </div>
        <p className="text-xs text-[#667085]">
          Guardrail PII redaction is applied to captured trace fields before they are stored.
        </p>
      </section>

      <section className="rounded-lg border border-[#DCE1E8] bg-white p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[18px] font-semibold">Conversation memory</h3>
            <p className="text-[13px] text-[#667085] mt-1">
              Remember small, subject-scoped facts such as language or preferences.
            </p>
          </div>
          <input
            aria-label="Enable conversation memory"
            type="checkbox"
            checked={memory.enabled}
            onChange={(e) => update({ memory: { ...memory, enabled: e.target.checked } })}
            className="mt-1 h-5 w-5 accent-[#FF571A]"
          />
        </div>
        <label className="block text-[13px] font-medium">
          Subject key template
          <input
            value={memory.subject_key_template}
            onChange={(e) =>
              update({ memory: { ...memory, subject_key_template: e.target.value } })
            }
            placeholder="anon:{visitor_id}"
            className="mt-1 block h-10 w-full rounded border border-[#DCE1E8] px-3 text-sm"
          />
          <span className="mt-1 block text-xs font-normal text-[#667085]">
            Use a stable visitor or customer identifier. Never use a staff actor ID.
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[13px] font-medium">
            Maximum facts
            <input
              type="number"
              min={1}
              max={50}
              value={memory.max_facts}
              onChange={(e) =>
                update({ memory: { ...memory, max_facts: Number(e.target.value) || 1 } })
              }
              className="mt-1 block h-10 w-full rounded border border-[#DCE1E8] px-3 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={memory.allow_runtime_writes}
              onChange={(e) =>
                update({ memory: { ...memory, allow_runtime_writes: e.target.checked } })
              }
              className="h-4 w-4 accent-[#FF571A]"
            />
            Allow runtime fact writes
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-[#DCE1E8] bg-white p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[18px] font-semibold">Guardrails</h3>
            <p className="text-[13px] text-[#667085] mt-1">
              Apply baseline safety checks before the model and tools run.
            </p>
          </div>
          <input
            aria-label="Enable guardrails"
            type="checkbox"
            checked={guardrails.enabled}
            onChange={(e) => update({ guardrails: { ...guardrails, enabled: e.target.checked } })}
            className="mt-1 h-5 w-5 accent-[#FF571A]"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={guardrails.block_prompt_injection}
              onChange={(e) =>
                update({ guardrails: { ...guardrails, block_prompt_injection: e.target.checked } })
              }
              className="h-4 w-4 accent-[#FF571A]"
            />
            Block prompt injection attempts
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={guardrails.redact_pii}
              onChange={(e) =>
                update({ guardrails: { ...guardrails, redact_pii: e.target.checked } })
              }
              className="h-4 w-4 accent-[#FF571A]"
            />
            Redact sensitive personal data
          </label>
        </div>
        <label className="block text-[13px] font-medium">
          Violation action
          <select
            value={guardrails.violation_action}
            onChange={(e) =>
              update({
                guardrails: {
                  ...guardrails,
                  violation_action: e.target.value as typeof guardrails.violation_action,
                },
              })
            }
            className="mt-1 block h-10 w-full rounded border border-[#DCE1E8] px-3 text-sm"
          >
            <option value="refuse">Refuse safely</option>
            <option value="handoff">Hand off to a person</option>
            <option value="sanitize">Sanitize and continue</option>
          </select>
        </label>
        <label className="block text-[13px] font-medium">
          Additional safety instructions
          <textarea
            value={guardrails.custom_instructions}
            onChange={(e) =>
              update({ guardrails: { ...guardrails, custom_instructions: e.target.value } })
            }
            rows={4}
            maxLength={4000}
            placeholder="Describe business-specific safety rules..."
            className="mt-1 block w-full rounded border border-[#DCE1E8] p-3 text-sm"
          />
        </label>
      </section>
      <section className="rounded-lg border border-[#DCE1E8] bg-white p-6 space-y-5">
        <div>
          <h3 className="text-[18px] font-semibold">Release controls</h3>
          <p className="mt-1 text-[13px] text-[#667085]">
            Require an explicit approval and checklist before a draft can become live.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={release.require_approval}
            onChange={(e) =>
              update({ release: { ...release, require_approval: e.target.checked } })
            }
            className="h-4 w-4 accent-[#FF571A]"
          />
          Require release approval
        </label>
        <label className="block text-[13px] font-medium">
          Auto-rollback canary error-rate threshold (%)
          <input
            type="number"
            min={1}
            max={100}
            placeholder="Disabled"
            value={release.auto_rollback_error_rate_pct ?? ""}
            onChange={(e) =>
              update({
                release: {
                  ...release,
                  auto_rollback_error_rate_pct: e.target.value
                    ? Math.min(100, Math.max(1, Number(e.target.value)))
                    : null,
                },
              })
            }
            className="mt-1 block h-10 w-full rounded border border-[#DCE1E8] px-3 text-sm"
          />
          <span className="mt-1 block text-xs font-normal text-[#667085]">
            Disable canary traffic automatically after the runtime observes enough failures.
          </span>
        </label>
        <label className="block text-[13px] font-medium">
          Required checklist items
          <textarea
            value={release.required_checklist.join("\n")}
            onChange={(e) =>
              update({
                release: {
                  ...release,
                  required_checklist: e.target.value
                    .split("\n")
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .slice(0, 20),
                },
              })
            }
            rows={4}
            placeholder="Regression suite passed\nSecurity review completed\nSupport sign-off"
            className="mt-1 block w-full rounded border border-[#DCE1E8] p-3 text-sm"
          />
          <span className="mt-1 block text-xs font-normal text-[#667085]">
            One item per line. These must be checked in the publish dialog.
          </span>
        </label>
      </section>
      <button
        type="button"
        className="text-xs text-[#667085] underline"
        onClick={() => onChange(structuredClone(DEFAULT_AGENT_CONFIGURATION))}
      >
        Reset policy settings
      </button>
    </div>
  );
}
