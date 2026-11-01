import React, { useEffect, useState } from "react";
import { Plus, Trash2, Lock, Info } from "lucide-react";
import {
  graphOutputPorts,
  normalizeAgentGraph,
  type GraphNodeType,
  type AgentToolDefinition,
  type AgentGraphNode,
} from "@quickstart/contracts";
import { NODE_REGISTRY } from "../../lib/node-registry";
import { listSources } from "@/features/knowledge/lib/client";

export type NodeInspectorProps = {
  nodeId: string;
  nodeType: GraphNodeType;
  nodeLabel: string;
  config: any;
  onChangeLabel: (label: string) => void;
  onChangeConfig: (config: any) => void;
  workspaceId?: string;
  tools?: AgentToolDefinition[];
  nodes?: { id: string; name: string; type: GraphNodeType }[];
  targets?: Record<string, string>;
  onChangeTarget?: (port: string, target: string) => void;
};
const fieldClass =
  "w-full min-w-0 rounded-md border border-[#E2E5E9] bg-white px-3 py-2 text-[13px] text-[#262626] outline-none focus:border-[#FA5D19] focus:ring-1 focus:ring-[#FA5D19]/20";
const Label = ({
  title,
  children,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
}) => (
  <label className="block space-y-2 text-xs font-medium text-neutral-800">
    <span>{title}</span>
    {children}
    {hint && (
      <span className="block text-[11px] leading-relaxed font-normal text-neutral-500">{hint}</span>
    )}
  </label>
);
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3 border-t border-[#EDEDED] pt-4">
    <h3 className="text-[13px] font-semibold">{title}</h3>
    {children}
  </section>
);
export const NodeInspector: React.FC<NodeInspectorProps> = (p) => {
  const { nodeType, config: c, onChangeConfig: set } = p;
  const def = NODE_REGISTRY[nodeType],
    Icon = def.icon;
  const update = (key: string, value: unknown) => set({ ...c, [key]: value });
  const [sources, setSources] = useState<{ id: string; name?: string; title?: string }[]>([]),
    [sourceError, setSourceError] = useState<string | null>(null);
  useEffect(() => {
    if (nodeType !== "knowledge_search" || !p.workspaceId) return;
    const controller = new AbortController();
    void listSources(p.workspaceId, { limit: 100 }, controller.signal)
      .then((r) => {
        setSources(r.sources ?? []);
        setSourceError(r.error?.message ?? null);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setSourceError("Could not load knowledge sources.");
      });
    return () => controller.abort();
  }, [nodeType, p.workspaceId]);
  const input = (key: string, placeholder = "", type = "text") => (
    <input
      aria-label={key.replaceAll("_", " ")}
      className={fieldClass + (key.includes("variable") ? " font-mono" : "")}
      type={type}
      value={c[key] ?? ""}
      placeholder={placeholder}
      onChange={(e) => update(key, type === "number" ? Number(e.target.value) : e.target.value)}
    />
  );
  const area = (key: string, rows = 4) => (
    <textarea
      aria-label={key.replaceAll("_", " ")}
      className={fieldClass + " resize-y leading-relaxed"}
      rows={rows}
      value={c[key] ?? ""}
      onChange={(e) => update(key, e.target.value)}
    />
  );
  const select = (key: string, options: [string, string][], fallback?: string) => (
    <select
      aria-label={key.replaceAll("_", " ")}
      className={fieldClass}
      value={c[key] ?? fallback ?? options[0]?.[0]}
      onChange={(e) => update(key, e.target.value)}
    >
      {options.map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </select>
  );
  const toggle = (key: string, title: string, defaultValue = false) => (
    <label className="flex items-center justify-between gap-3 text-[13px]">
      <span>{title}</span>
      <input
        type="checkbox"
        className="accent-[#FA5D19] w-4 h-4"
        checked={c[key] ?? defaultValue}
        onChange={(e) => update(key, e.target.checked)}
      />
    </label>
  );
  const canonical = normalizeAgentGraph({
    schema_version: 1,
    entry_node_id: p.nodeId,
    nodes: [
      {
        id: p.nodeId,
        type: nodeType,
        name: p.nodeLabel,
        position: { x: 0, y: 0 },
        config: c,
      } as AgentGraphNode,
    ],
    edges: [],
  }).nodes[0];
  const ports = graphOutputPorts(canonical);
  const portName = (port: string) =>
    ({
      message_sent: c.wait_for_visitor ? "After visitor replies" : "After responding",
      interaction_received: "First step",
      details_complete: "When details are complete",
      needs_assistance: "If the visitor needs help",
      success: "On success",
      failure: "On failure",
      results_found: "When results are found",
      no_matches: "When no results are found",
      match: "When rules match",
      otherwise: "Otherwise",
      fallback: "Fallback",
      resumed: "When the operator releases",
    })[port] ?? port.replace(/^intent_/, "");
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className={`p-2 rounded-lg shrink-0 ${def.iconBgColor}`}>
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold mb-2">{def.name}</h2>
          <input
            aria-label="Node name"
            className={fieldClass}
            value={p.nodeLabel}
            onChange={(e) => p.onChangeLabel(e.target.value)}
          />
          <p className="mt-2 text-xs leading-relaxed text-neutral-500">{def.description}</p>
        </div>
      </div>
      {nodeType === "entrypoint" && (
        <>
          <Section title="Incoming channels">
            <div className="rounded-lg border border-[#EDEDED] divide-y">
              {["chat", "voice", "webhook"].map((ch) => (
                <label key={ch} className="flex items-center justify-between p-3 text-xs">
                  <span>
                    {ch === "chat"
                      ? "Website chat"
                      : ch === "voice"
                        ? "Inbound phone"
                        : "Webhook · setup required"}
                  </span>
                  <input
                    type="checkbox"
                    disabled={ch === "webhook"}
                    checked={(c.allowed_channels ?? ["chat", "voice"]).includes(ch)}
                    onChange={(e) =>
                      update(
                        "allowed_channels",
                        e.target.checked
                          ? [...(c.allowed_channels ?? []), ch]
                          : (c.allowed_channels ?? []).filter((v: string) => v !== ch),
                      )
                    }
                    className="accent-[#FA5D19]"
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-neutral-500">
              Channel access is also controlled by agent settings.
            </p>
          </Section>
          <Section title="Session context">
            <div className="space-y-3 text-[11px]">
              {[
                ["conversation.channel", "Incoming channel"],
                ["conversation.session_id", "Session identifier"],
                ["visitor.phone", "Caller or visitor metadata"],
              ].map(([key, source]) => (
                <div key={key} className="flex justify-between gap-2">
                  <code className="bg-neutral-50 rounded px-1 font-mono">{key}</code>
                  <span className="text-neutral-500">{source}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-neutral-500">Unavailable values remain empty.</p>
          </Section>
        </>
      )}
      {nodeType === "welcome" && (
        <Section title="Welcome message">
          <Label title="Message">{area("fixed_text")}</Label>
          <Label title="After greeting">
            {select("transition", [
              ["wait_for_input", "Wait for visitor reply"],
              ["continue_immediately", "Continue immediately"],
            ])}
          </Label>
        </Section>
      )}
      {nodeType === "conversation" && (
        <>
          <Section title="Instructions">
            {area("instructions", 5)}
            <p className="text-[11px] text-neutral-500">
              Added to the agent’s global instructions.
            </p>
          </Section>
          <Section title="Capture visitor details">
            {(c.capture_fields ?? []).map((f: any, i: number) => (
              <div key={i} className="rounded-md border border-[#EDEDED] p-2 space-y-2">
                <div className="flex gap-2">
                  <input
                    aria-label={`Variable ${i + 1}`}
                    className={fieldClass + " font-mono flex-1"}
                    value={f.field_name}
                    onChange={(e) =>
                      update(
                        "capture_fields",
                        c.capture_fields.map((x: any, j: number) =>
                          j === i ? { ...x, field_name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <button
                    aria-label={`Remove field ${i + 1}`}
                    onClick={() =>
                      update(
                        "capture_fields",
                        c.capture_fields.filter((_: unknown, j: number) => j !== i),
                      )
                    }
                  >
                    <Trash2 className="w-4 h-4 text-neutral-400" />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    aria-label={`Type ${i + 1}`}
                    className={fieldClass}
                    value={f.type}
                    onChange={(e) =>
                      update(
                        "capture_fields",
                        c.capture_fields.map((x: any, j: number) =>
                          j === i ? { ...x, type: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {["text", "phone", "email", "date", "number", "boolean"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <label className="text-xs flex items-center gap-1">
                    <input
                      className="accent-[#FA5D19]"
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) =>
                        update(
                          "capture_fields",
                          c.capture_fields.map((x: any, j: number) =>
                            j === i ? { ...x, required: e.target.checked } : x,
                          ),
                        )
                      }
                    />
                    Required
                  </label>
                </div>
              </div>
            ))}
            <button
              className="text-xs text-[#FA5D19] flex gap-1 items-center"
              onClick={() =>
                update("capture_fields", [
                  ...(c.capture_fields ?? []),
                  { field_name: "", type: "text", required: true },
                ])
              }
            >
              <Plus className="w-3.5 h-3.5" />
              Add field
            </button>
            <p className="text-[11px] text-neutral-500">
              Keep captured values for the current conversation.
            </p>
          </Section>
        </>
      )}
      {nodeType === "intent_router" && (
        <>
          <Section title="Routing method">
            {select("mode", [
              ["ai_intent", "AI intent"],
              ["rules", "Rules"],
            ])}
            <Label title="Routing instructions">{area("instructions", 3)}</Label>
          </Section>
          <Section title="Intent branches">
            {(c.branches ?? []).map((b: any, i: number) => (
              <details key={b.id} className="rounded-lg border border-[#EDEDED] p-3" open={i === 0}>
                <summary className="text-xs font-semibold cursor-pointer">
                  {String(i + 1).padStart(2, "0")} · {b.name || "New intent"}
                </summary>
                <div className="space-y-3 pt-3">
                  <Label title="Intent name">
                    <input
                      className={fieldClass}
                      value={b.name}
                      onChange={(e) =>
                        update(
                          "branches",
                          c.branches.map((x: any, j: number) =>
                            j === i ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Label>
                  <Label title={c.mode === "rules" ? "Match phrase" : "When to use"}>
                    <textarea
                      className={fieldClass}
                      rows={3}
                      value={c.mode === "rules" ? (b.condition ?? "") : (b.description ?? "")}
                      onChange={(e) =>
                        update(
                          "branches",
                          c.branches.map((x: any, j: number) =>
                            j === i
                              ? {
                                  ...x,
                                  [c.mode === "rules" ? "condition" : "description"]:
                                    e.target.value,
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </Label>
                  <button
                    className="text-xs text-red-600"
                    onClick={() =>
                      update(
                        "branches",
                        c.branches.filter((_: unknown, j: number) => j !== i),
                      )
                    }
                  >
                    Remove intent
                  </button>
                </div>
              </details>
            ))}
            <button
              className="text-xs text-[#FA5D19]"
              onClick={() =>
                update("branches", [
                  ...(c.branches ?? []),
                  { id: crypto.randomUUID(), name: "New intent", description: "" },
                ])
              }
            >
              + Add intent
            </button>
          </Section>
        </>
      )}
      {nodeType === "condition" && (
        <Section title="Match rules">
          {select("logical_operator", [
            ["AND", "All rules (AND)"],
            ["OR", "Any rule (OR)"],
          ])}
          {(c.rules ?? []).map((r: any, i: number) => (
            <div key={i} className="rounded-lg border border-[#EDEDED] p-3 space-y-3">
              <div className="flex justify-between text-xs font-semibold">
                Rule {i + 1}
                <button
                  aria-label="Remove rule"
                  onClick={() =>
                    update(
                      "rules",
                      c.rules.filter((_: unknown, j: number) => j !== i),
                    )
                  }
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <Label title="Variable">
                <input
                  className={fieldClass + " font-mono"}
                  value={r.field ?? r.variable ?? ""}
                  onChange={(e) =>
                    update(
                      "rules",
                      c.rules.map((x: any, j: number) =>
                        j === i ? { ...x, field: e.target.value, variable: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Label>
              <Label title="Operator">
                <select
                  className={fieldClass}
                  value={r.operator}
                  onChange={(e) =>
                    update(
                      "rules",
                      c.rules.map((x: any, j: number) =>
                        j === i ? { ...x, operator: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {[
                    ["equals", "equals"],
                    ["not_equals", "does not equal"],
                    ["greater_than", "is greater than"],
                    ["less_than", "is less than"],
                    ["contains", "contains"],
                    ["is_empty", "is empty"],
                    ["is_not_empty", "is not empty"],
                  ].map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </Label>
              <Label title="Value">
                <input
                  className={fieldClass}
                  value={r.value ?? ""}
                  onChange={(e) =>
                    update(
                      "rules",
                      c.rules.map((x: any, j: number) =>
                        j === i ? { ...x, value: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Label>
            </div>
          ))}
          <button
            className="text-xs text-[#FA5D19]"
            onClick={() =>
              update("rules", [...(c.rules ?? []), { field: "", operator: "equals", value: "" }])
            }
          >
            + Add rule
          </button>
          <Label title="If a value is missing">
            {select("missing_value_behavior", [
              ["otherwise", "Follow the otherwise path"],
              ["fail", "Fail this step"],
            ])}
          </Label>
        </Section>
      )}
      {nodeType === "ai_prompt" && (
        <>
          <Section title="Model & context">
            <Label title="Provider profile">{input("model_profile", "Use agent default")}</Label>
            <Label
              title="Delegated specialist agent"
              hint="Optional published agent used for this step. Leave blank to use this agent."
            >
              {input("delegate_agent_id", "Agent UUID")}
            </Label>
            <Label title="Instructions">{area("system_prompt", 5)}</Label>
            <Label title={`Temperature · ${c.temperature ?? 0.3}`}>
              <input
                className="accent-[#FA5D19] w-full"
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={c.temperature ?? 0.3}
                onChange={(e) => update("temperature", Number(e.target.value))}
              />
            </Label>
            <Label
              title="Reasoning effort"
              hint="Use low for fast tool planning, medium or high for complex decisions."
            >
              {select("reasoning_effort", [
                ["auto", "Use agent default"],
                ["none", "None (fastest)"],
                ["minimal", "Minimal"],
                ["low", "Low"],
                ["medium", "Medium"],
                ["high", "High"],
                ["xhigh", "Extra high"],
                ["max", "Maximum"],
              ], "auto")}
            </Label>
            <Label title="Output verbosity">
              {select("verbosity", [
                ["auto", "Use agent default"],
                ["low", "Low — concise"],
                ["medium", "Medium — balanced"],
                ["high", "High — detailed"],
              ], "auto")}
            </Label>
            <Label title="Context variables">
              <input
                className={fieldClass + " font-mono"}
                value={(c.context_variables ?? []).join(", ")}
                placeholder="knowledge.results, visitor.message"
                onChange={(e) =>
                  update(
                    "context_variables",
                    e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  )
                }
              />
            </Label>
            <Label title="Save output as">{input("output_variable", "answer.text")}</Label>
          </Section>
        </>
      )}
      {nodeType === "http_request" && (
        <>
          <Section title="Connected tool">
            <select
              aria-label="Connected tool"
              className={fieldClass}
              value={c.tool_id ?? ""}
              onChange={(e) => {
                const t = p.tools?.find((t) => t.id === e.target.value);
                if (t?.type === "http")
                  set({
                    ...c,
                    tool_id: t.id,
                    tool_name: t.name,
                    method: t.method,
                    url: t.base_url,
                    endpoint: t.base_url,
                    parameter_mappings: Object.fromEntries(
                      Object.keys(t.parameters?.properties ?? {}).map((key) => [
                        key,
                        c.parameter_mappings?.[key] ?? "",
                      ]),
                    ),
                  });
              }}
            >
              <option value="">Select an attached HTTP tool</option>
              {(p.tools ?? [])
                .filter((t) => t.type === "http")
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
            {!p.tools?.length && (
              <p className="text-xs text-neutral-500">
                Attach a workspace tool in the agent’s Tools settings first.
              </p>
            )}
            <Label title="Request">
              <div className="flex gap-2">
                <span className="rounded-md border bg-neutral-50 p-2 text-xs">
                  {c.method ?? "GET"}
                </span>
                <input
                  className={fieldClass + " font-mono"}
                  readOnly
                  value={c.url ?? c.endpoint ?? ""}
                  placeholder="Managed by connected tool"
                />
              </div>
            </Label>
          </Section>
          <Section title="Parameter mapping">
            {Object.entries(
              Array.isArray(c.parameter_mappings)
                ? Object.fromEntries(c.parameter_mappings.map((m: any) => [m.param, m.variable]))
                : (c.parameter_mappings ?? {}),
            ).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <input
                  aria-label={`Parameter name ${key}`}
                  className="w-24 min-w-0 rounded border border-[#EDEDED] p-2 font-mono"
                  defaultValue={key}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (
                      !name ||
                      name === key ||
                      ["__proto__", "constructor", "prototype"].includes(name)
                    ) {
                      e.target.value = key;
                      return;
                    }
                    const mappings = Array.isArray(c.parameter_mappings)
                      ? Object.fromEntries(
                          c.parameter_mappings.map((m: any) => [m.param, m.variable]),
                        )
                      : { ...c.parameter_mappings };
                    if (Object.hasOwn(mappings, name)) {
                      e.target.value = key;
                      return;
                    }
                    delete mappings[key];
                    mappings[name] = value;
                    update("parameter_mappings", mappings);
                  }}
                />
                <span>→</span>
                <input
                  aria-label={`Map ${key}`}
                  className={fieldClass + " font-mono"}
                  value={String(value ?? "")}
                  onChange={(e) =>
                    update("parameter_mappings", {
                      ...(Array.isArray(c.parameter_mappings)
                        ? Object.fromEntries(
                            c.parameter_mappings.map((m: any) => [m.param, m.variable]),
                          )
                        : c.parameter_mappings),
                      [key]: e.target.value,
                    })
                  }
                />
                <button
                  aria-label={`Remove parameter ${key}`}
                  onClick={() => {
                    const next = { ...c.parameter_mappings };
                    delete next[key];
                    update("parameter_mappings", next);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              className="text-xs text-[#FA5D19]"
              onClick={() =>
                update("parameter_mappings", {
                  ...c.parameter_mappings,
                  [`parameter_${Object.keys(c.parameter_mappings ?? {}).length + 1}`]: "",
                })
              }
            >
              + Add parameter
            </button>
            <Label title="Save response as">{input("output_variable", "http.response")}</Label>
          </Section>
          <details className="border-t border-[#EDEDED] pt-4 text-xs">
            <summary className="cursor-pointer flex justify-between">
              Authentication
              <Lock className="w-3.5 h-3.5" />
            </summary>
            <p className="mt-2 text-neutral-500">
              Credentials are resolved from the selected tool’s workspace secret.
            </p>
          </details>
          <Section title="Error handling">
            <Label title="Timeout (seconds)">{input("timeout_seconds", "15", "number")}</Label>
            <p className="text-xs text-neutral-500">
              Follow the failure branch if the request cannot complete. Data-changing actions always
              require visitor confirmation.
            </p>
          </Section>
        </>
      )}
      {nodeType === "knowledge_search" && (
        <>
          <Section title="Knowledge sources">
            {sourceError && (
              <p role="alert" className="text-xs text-amber-700">
                {sourceError}
              </p>
            )}
            {!sources.length && !sourceError && (
              <p className="text-xs text-neutral-500">
                No sources available. Add sources in workspace Knowledge.
              </p>
            )}
            <div className="rounded-lg border border-[#EDEDED] divide-y">
              {sources.map((s) => (
                <label key={s.id} className="p-3 flex items-center gap-3 text-xs">
                  <input
                    className="accent-[#FA5D19]"
                    type="checkbox"
                    checked={(c.source_ids ?? []).includes(s.id)}
                    onChange={(e) =>
                      update(
                        "source_ids",
                        e.target.checked
                          ? [...(c.source_ids ?? []), s.id]
                          : (c.source_ids ?? []).filter((id: string) => id !== s.id),
                      )
                    }
                  />
                  {s.name ?? s.title ?? s.id}
                </label>
              ))}
            </div>
          </Section>
          <Section title="Search query">
            <Label title="Query variable">{input("query_variable", "visitor.message")}</Label>
          </Section>
          <Section title="Retrieval">
            <Label title="Maximum results">{input("max_results", "5", "number")}</Label>
            <div className="flex justify-between text-xs">
              <span>Search method</span>
              <span className="text-neutral-500">Semantic search</span>
            </div>
            <Label title="Save results as">{input("output_variable", "knowledge.results")}</Label>
          </Section>
        </>
      )}
      {nodeType === "response" && (
        <>
          <Section title="Response mode">
            {select("content_type", [
              ["fixed_text", "Fixed message"],
              ["variable_reference", "Use AI text output"],
            ])}
            {c.content_type === "variable_reference" ? (
              <Label title="Response context">{input("variable_name", "answer.text")}</Label>
            ) : (
              <Label title="Message">{area("fixed_text", 5)}</Label>
            )}
          </Section>
          <Section title="Channel formatting">
            {toggle("allow_markdown", "Allow Markdown", true)}
            <div className="rounded-lg border p-3 space-y-2">
              <h3 className="text-xs font-medium">Voice behavior</h3>
              <p className="text-xs text-neutral-500">
                Voice replies use plain spoken text and the agent’s configured voice.
              </p>
            </div>
            {toggle("wait_for_visitor", "Wait for visitor reply")}
          </Section>
        </>
      )}
      {nodeType === "human_handoff" && (
        <>
          <Section title="Destination">
            <div className={fieldClass}>Operator Inbox</div>
          </Section>
          <Section title="Message before handoff">{area("handoff_message", 4)}</Section>
          <Section title="Context for the operator">
            <Label title="Handoff note">{area("handoff_note_template", 4)}</Label>
          </Section>
          <div className="rounded-lg border p-3 text-xs space-y-2">
            <p className="font-semibold flex gap-2">
              <Lock className="w-4 h-4" />
              Pause AI replies{" "}
              <span className="ml-auto bg-neutral-100 rounded px-1 text-[10px]">Required</span>
            </p>
            <p className="text-neutral-500">
              Visitor messages continue to arrive. The agent stays paused until an operator releases
              the conversation.
            </p>
          </div>
        </>
      )}
      {nodeType === "end_conversation" && (
        <>
          <Section title="Closing message">{area("closing_message", 4)}</Section>
          <Section title="Chat behavior">
            <h3 className="text-xs font-medium">Finish the current session</h3>
            <p className="text-xs text-neutral-500">
              Preserve conversation history. A new visitor message requires a new flow session.
            </p>
          </Section>
          <Section title="Voice behavior">
            <p className="text-xs text-neutral-500">
              Finish speaking the closing message before ending the call.
            </p>
          </Section>
          <div className="rounded-lg border bg-neutral-50 p-3 text-xs flex gap-2">
            <Info className="w-4 h-4 shrink-0" />
            <p>
              This terminal node has no outgoing connections. Use handoff when a teammate should
              continue.
            </p>
          </div>
        </>
      )}
      {ports.length > 0 && p.onChangeTarget && (
        <Section title="Transitions">
          {ports.map((port) => (
            <Label key={port} title={portName(port)}>
              <select
                className={fieldClass}
                value={p.targets?.[port] ?? ""}
                onChange={(e) => p.onChangeTarget?.(port, e.target.value)}
              >
                <option value="">Connect a next step</option>
                {p.nodes
                  ?.filter((n) => n.id !== p.nodeId && n.type !== "entrypoint")
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
            </Label>
          ))}
        </Section>
      )}
    </div>
  );
};
