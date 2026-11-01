import type { AgentGraph, AgentGraphNode, GraphNodeType } from "./agent-graph.js";

/** Accept the initial editor aliases at the boundary; persist canonical execution fields. */
export function normalizeAgentGraph(graph: AgentGraph): AgentGraph {
  const nodes = graph.nodes.map((node) => {
    const c = { ...node.config } as Record<string, unknown>;
    if (node.type === "welcome") {
      c.mode = c.message_mode
        ? c.message_mode === "ai_generated"
          ? "ai"
          : "fixed"
        : (c.mode ?? "fixed");
      c.message = c.fixed_text ?? c.message ?? c.greeting_text ?? "";
      c.after_mode = c.transition
        ? c.transition === "wait_for_input"
          ? "wait"
          : "continue"
        : (c.after_mode ?? "continue");
    }
    if (node.type === "conversation") {
      c.captured_fields = Array.isArray(c.capture_fields)
        ? c.capture_fields.map((f: Record<string, unknown>) => ({ ...f, variable: f.field_name }))
        : (c.captured_fields ?? []);
      c.continue_when ??= "all_required";
    }
    if (node.type === "intent_router") {
      c.intents = c.branches ?? c.intents ?? [];
      c.routing_method = c.mode
        ? c.mode === "ai_intent"
          ? "ai_intent"
          : "rules"
        : (c.routing_method ?? "ai_intent");
    }
    if (node.type === "condition") {
      c.match_mode = c.logical_operator
        ? c.logical_operator === "OR"
          ? "any"
          : "all"
        : (c.match_mode ?? "all");
      c.rules = Array.isArray(c.rules)
        ? c.rules.map((r: Record<string, unknown>) => ({ ...r, variable: r.variable ?? r.field }))
        : [];
    }
    if (node.type === "ai_prompt") {
      c.instructions = c.system_prompt ?? c.instructions ?? "";
    }
    if (node.type === "http_request") {
      c.endpoint = c.url ?? c.endpoint ?? "";
      c.requires_confirmation = c.require_confirmation ?? c.requires_confirmation ?? true;
    }
    if (node.type === "response") {
      c.response_mode = c.content_type
        ? c.content_type === "variable_reference"
          ? "ai_response"
          : "fixed_message"
        : (c.response_mode ?? "fixed_message");
      c.message = c.fixed_text ?? c.message ?? "";
      c.context_variables = c.variable_name ? [c.variable_name] : (c.context_variables ?? []);
      c.after_responding =
        c.wait_for_visitor !== undefined
          ? c.wait_for_visitor
            ? "wait_for_visitor"
            : "continue"
          : (c.after_responding ?? "continue");
    }
    if (node.type === "human_handoff") {
      c.destination ??= "operator_inbox";
      c.message_chat = c.handoff_message ?? c.message_chat;
      c.message_voice = c.handoff_message ?? c.message_voice;
    }
    if (node.type === "end_conversation") {
      c.closing_message_enabled ??= Boolean(
        c.closing_message || c.closing_message_chat || c.closing_message_voice,
      );
      c.closing_message_chat = c.closing_message ?? c.closing_message_chat;
      c.closing_message_voice = c.closing_message ?? c.closing_message_voice;
    }
    return { ...node, config: c } as AgentGraphNode;
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const aliases: Partial<Record<GraphNodeType, Record<string, string>>> = {
    entrypoint: { out: "interaction_received" },
    welcome: { out: "message_sent" },
    conversation: { out_completed: "details_complete", out_fallback: "needs_assistance" },
    condition: { out_match: "match", out_otherwise: "otherwise" },
    ai_prompt: { out_success: "success", out_error: "failure" },
    http_request: { out_success: "success", out_error: "failure" },
    knowledge_search: { out_found: "results_found", out_empty: "no_matches", out_error: "failure" },
    response: { out: "message_sent" },
    human_handoff: { out_released: "resumed" },
  };
  return {
    ...graph,
    nodes,
    edges: graph.edges.map((e) => {
      const source = e.source ?? e.source_node_id ?? "";
      const node = byId.get(source);
      let port = e.source_port ?? e.source_port_id ?? "";
      if (node?.type === "intent_router" && port !== "fallback") {
        const intents = (node.config as { intents?: { id: string }[] }).intents ?? [];
        if (intents.some((i) => i.id === port)) port = `intent_${port}`;
      }
      port = (node && aliases[node.type]?.[port]) ?? port;
      // Welcome/response have one continuation output; waiting affects execution, not port identity.
      if (node?.type === "welcome" && port === "visitor_replies") port = "message_sent";
      if (node?.type === "response" && port === "wait_for_visitor") port = "message_sent";
      return {
        id: e.id,
        source,
        source_port: port,
        target: e.target ?? e.target_node_id ?? "",
        target_port: e.target_port ?? e.target_port_id ?? "in",
        ...(e.label ? { label: e.label } : {}),
      };
    }),
  };
}

export function graphOutputPorts(node: AgentGraphNode): string[] {
  switch (node.type) {
    case "entrypoint":
      return ["interaction_received"];
    case "welcome":
    case "response":
      return ["message_sent"];
    case "conversation":
      return ["details_complete", "needs_assistance"];
    case "intent_router":
      return [
        ...(
          (node.config as { intents?: { id: string }[]; branches?: { id: string }[] }).intents ??
          (node.config as { branches?: { id: string }[] }).branches ??
          []
        ).map((i) => `intent_${i.id}`),
        "fallback",
      ];
    case "condition":
      return ["match", "otherwise"];
    case "ai_prompt":
    case "http_request":
      return ["success", "failure"];
    case "knowledge_search":
      return ["results_found", "no_matches", "failure"];
    case "human_handoff":
      return ["resumed"];
    case "end_conversation":
      return [];
  }
}

/** Drafts may be incomplete, but JSON shapes and values must be safe to interpret. */
export function isAgentGraphShape(value: unknown): value is AgentGraph {
  if (!value || typeof value !== "object") return false;
  const graph = value as AgentGraph;
  if (
    graph.schema_version !== 1 ||
    typeof graph.entry_node_id !== "string" ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    graph.nodes.length > 250 ||
    graph.edges.length > 500
  )
    return false;
  const object = (v: unknown): v is Record<string, unknown> =>
    Boolean(v && typeof v === "object" && !Array.isArray(v));
  for (const n of graph.nodes) {
    if (
      !object(n) ||
      typeof n.id !== "string" ||
      n.id.length > 200 ||
      typeof n.type !== "string" ||
      typeof n.name !== "string" ||
      n.name.length > 500 ||
      !object(n.position) ||
      !Number.isFinite(n.position.x) ||
      !Number.isFinite(n.position.y) ||
      !object(n.config)
    )
      return false;
    const c = n.config as Record<string, unknown>;
    const strings = [
      "instructions",
      "system_prompt",
      "fixed_text",
      "message",
      "closing_message",
      "url",
      "endpoint",
      "query_variable",
      "output_variable",
      "variable_name",
      "tool_id",
      "tool_name",
      "model_profile",
      "handoff_message",
    ];
    if (
      strings.some(
        (k) => c[k] !== undefined && (typeof c[k] !== "string" || (c[k] as string).length > 64000),
      )
    )
      return false;
    const arrays = ["capture_fields", "captured_fields", "intents", "branches", "rules"];
    if (
      arrays.some(
        (k) =>
          c[k] !== undefined &&
          (!Array.isArray(c[k]) ||
            (c[k] as unknown[]).length > 100 ||
            (c[k] as unknown[]).some((v) => !object(v))),
      )
    )
      return false;
    for (const key of arrays) {
      for (const item of (c[key] ?? []) as Record<string, unknown>[]) {
        if (
          item.allowed_values !== undefined &&
          (!Array.isArray(item.allowed_values) ||
            item.allowed_values.length > 100 ||
            item.allowed_values.some((value) => typeof value !== "string" || value.length > 1000))
        )
          return false;
        for (const field of [
          "id",
          "variable",
          "field",
          "field_name",
          "label",
          "description",
          "type",
          "operator",
          "name",
        ]) {
          if (
            item[field] !== undefined &&
            (typeof item[field] !== "string" || (item[field] as string).length > 64000)
          )
            return false;
        }
      }
    }
    for (const key of ["source_ids", "context_variables", "allowed_channels"])
      if (
        c[key] !== undefined &&
        (!Array.isArray(c[key]) || (c[key] as unknown[]).some((v) => typeof v !== "string"))
      )
        return false;
    if (c.parameter_mappings !== undefined) {
      const m = c.parameter_mappings;
      if (
        Array.isArray(m)
          ? m.some(
              (v) => !object(v) || typeof v.param !== "string" || typeof v.variable !== "string",
            )
          : !object(m) || Object.values(m).some((v) => typeof v !== "string")
      )
        return false;
    }
  }
  return graph.edges.every(
    (e) =>
      object(e) &&
      typeof e.id === "string" &&
      typeof (e.source ?? e.source_node_id) === "string" &&
      typeof (e.target ?? e.target_node_id) === "string" &&
      typeof (e.source_port ?? e.source_port_id) === "string",
  );
}
