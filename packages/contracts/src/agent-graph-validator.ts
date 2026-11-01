import {
  normalizeAgentGraph,
  graphOutputPorts,
  isAgentGraphShape,
} from "./agent-graph-normalize.js";
import type {
  AgentGraph,
  AgentGraphNode,
  GraphValidationIssue,
  GraphValidationResult,
  GraphNodeType,
} from "./agent-graph.js";

const VALID_NODE_TYPES: Set<GraphNodeType> = new Set([
  "entrypoint",
  "welcome",
  "conversation",
  "intent_router",
  "condition",
  "ai_prompt",
  "http_request",
  "knowledge_search",
  "response",
  "human_handoff",
  "end_conversation",
]);

export type GraphValidationOptions = {
  availableTools?: string[];
  availableToolIds?: string[];
  availableKnowledgeSources?: string[];
  requirePublishReady?: boolean;
};

export function validateAgentGraph(
  graph: AgentGraph | null | undefined,
  options: GraphValidationOptions = {},
): GraphValidationResult {
  const issues: GraphValidationIssue[] = [];

  if (!isAgentGraphShape(graph)) {
    return {
      valid: false,
      issues: [
        {
          code: "GRAPH_EMPTY",
          type: "error",
          message: "Flow graph is empty. Add an Incoming interaction entrypoint to begin.",
        },
      ],
      summary: { errors: 1, warnings: 0 },
    };
  }

  graph = normalizeAgentGraph(graph);
  if (graph.schema_version !== 1 || graph.nodes.length > 250 || graph.edges.length > 500) {
    return {
      valid: false,
      issues: [
        {
          type: "error",
          code: "GRAPH_SCHEMA_INVALID",
          message: "Unsupported graph schema or graph exceeds size limits.",
        },
      ],
      summary: { errors: 1, warnings: 0 },
    };
  }
  const nodes = graph.nodes;
  if (!nodes.some((n) => n.type === "entrypoint" && n.id === graph.entry_node_id))
    issues.push({
      type: "error",
      code: "ENTRY_ID_INVALID",
      message: "The entry node must reference the flow's entrypoint.",
    });
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  // 1. Entrypoint Validation: Exactly one entrypoint
  const entryNodes = nodes.filter((n) => n.type === "entrypoint");
  if (entryNodes.length === 0) {
    issues.push({
      code: "ENTRYPOINT_MISSING",
      type: "error",
      message: "Graph has no entrypoint. Add an Incoming interaction node.",
    });
  } else if (entryNodes.length > 1) {
    for (let i = 1; i < entryNodes.length; i++) {
      issues.push({
        node_id: entryNodes[i].id,
        code: "ENTRYPOINT_DUPLICATE",
        type: "error",
        message: "Only one Incoming interaction entrypoint is permitted per flow.",
      });
    }
  }

  // 2. ID Uniqueness
  const nodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();
  for (const n of nodes) {
    if (!n.id) {
      issues.push({
        code: "NODE_ID_EMPTY",
        type: "error",
        message: "A node has an empty or missing identifier.",
      });
    } else if (nodeIds.has(n.id)) {
      duplicateNodeIds.add(n.id);
    } else {
      nodeIds.add(n.id);
    }
  }

  for (const id of duplicateNodeIds) {
    issues.push({
      node_id: id,
      code: "NODE_ID_DUPLICATE",
      type: "error",
      message: `Duplicate node ID detected: ${id}`,
    });
  }

  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (edgeIds.has(e.id)) {
      issues.push({
        edge_id: e.id,
        code: "EDGE_ID_DUPLICATE",
        type: "error",
        message: `Duplicate edge ID detected: ${e.id}`,
      });
    } else {
      edgeIds.add(e.id);
    }
  }

  // 3. Unknown node types & node configuration validation
  for (const node of nodes) {
    if (!VALID_NODE_TYPES.has(node.type)) {
      issues.push({
        node_id: node.id,
        code: "NODE_TYPE_UNKNOWN",
        type: "error",
        message: `Unknown node type: ${(node as { type: string }).type}`,
      });
      continue;
    }

    validateNodeConfig(node, issues, options);
  }

  // 4. Edge Endpoints Validation
  const outgoingEdgeMap = new Map<string, typeof edges>();
  const incomingEdgeMap = new Map<string, typeof edges>();

  for (const node of nodes) {
    outgoingEdgeMap.set(node.id, []);
    incomingEdgeMap.set(node.id, []);
  }

  const usedPorts = new Set<string>();
  for (const edge of edges) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);

    if (!sourceNode) {
      issues.push({
        edge_id: edge.id,
        code: "EDGE_SOURCE_INVALID",
        type: "error",
        message: `Edge ${edge.id} references non-existent source node: ${edge.source}`,
      });
    } else {
      outgoingEdgeMap.get(sourceNode.id)?.push(edge);
    }

    if (!targetNode) {
      issues.push({
        edge_id: edge.id,
        code: "EDGE_TARGET_INVALID",
        type: "error",
        message: `Edge ${edge.id} references non-existent target node: ${edge.target}`,
      });
    } else {
      incomingEdgeMap.get(targetNode.id)?.push(edge);
    }

    if (
      sourceNode &&
      VALID_NODE_TYPES.has(sourceNode.type) &&
      !graphOutputPorts(sourceNode).includes(edge.source_port ?? "")
    )
      issues.push({
        type: "error",
        edge_id: edge.id,
        node_id: sourceNode.id,
        code: "PORT_INVALID",
        message: `Connection from "${sourceNode.name}" uses unknown output port "${edge.source_port ?? "(missing)"}". Valid outputs: ${graphOutputPorts(sourceNode).join(", ") || "none"}.`,
      });
    if (edge.target_port !== "in")
      issues.push({
        type: "error",
        edge_id: edge.id,
        code: "PORT_INVALID",
        message: "Connection references an unknown input port.",
      });
    const portKey = `${edge.source}:${edge.source_port}`;
    if (usedPorts.has(portKey))
      issues.push({
        type: "error",
        edge_id: edge.id,
        code: "PORT_MULTIPLE_TARGETS",
        message: "An output port can connect to only one next step.",
      });
    usedPorts.add(portKey);
    // Terminal node cannot have outgoing edges
    if (sourceNode && sourceNode.type === "end_conversation") {
      issues.push({
        node_id: sourceNode.id,
        edge_id: edge.id,
        code: "TERMINAL_NODE_OUTGOING",
        type: "error",
        message: `End conversation node "${sourceNode.name}" cannot have outgoing connections.`,
      });
    }

    // Entrypoint node cannot have incoming edges
    if (targetNode && targetNode.type === "entrypoint") {
      issues.push({
        node_id: targetNode.id,
        edge_id: edge.id,
        code: "ENTRYPOINT_INCOMING",
        type: "error",
        message: `Incoming interaction entrypoint cannot have incoming connections.`,
      });
    }
  }

  // 5. Connectivity & Reachability Validation
  if (entryNodes.length > 0) {
    const entryId = entryNodes[0].id;
    const reachable = new Set<string>([entryId]);
    const queue = [entryId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const outEdges = outgoingEdgeMap.get(current) || [];
      for (const edge of outEdges) {
        const target = edge.target || edge.target_node_id;
        if (target && !reachable.has(target)) {
          reachable.add(target);
          queue.push(target);
        }
      }
    }

    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          node_id: node.id,
          code: "NODE_UNREACHABLE",
          type: "warning",
          message: `Node "${node.name}" is not reachable from the entrypoint.`,
        });
      }
    }
  }

  // 6. Branch Completion / Required Port Connection
  for (const node of nodes) {
    const outEdges = outgoingEdgeMap.get(node.id) || [];

    if (node.type === "intent_router") {
      const config = node.config as import("./agent-graph.js").IntentRouterNodeConfig;
      // Check fallback connection
      const fallbackEdge = outEdges.find((e) => e.source_port === "fallback");
      if (!fallbackEdge && !config.fallback_target_node_id) {
        issues.push({
          node_id: node.id,
          field: "fallback",
          code: "INTENT_FALLBACK_UNCONNECTED",
          type: "error",
          message: `Fallback is not connected for Intent Router "${node.name}". Connect the fallback output to a conversation or response node.`,
        });
      }

      // Check intent branches
      if (Array.isArray(config.intents)) {
        for (const intent of config.intents) {
          const branchPort = `intent_${intent.id}`;
          const branchEdge = outEdges.find((e) => e.source_port === branchPort);
          if (!branchEdge) {
            issues.push({
              node_id: node.id,
              field: `intent_${intent.id}`,
              code: "INTENT_BRANCH_UNCONNECTED",
              type: "warning",
              message: `Intent branch "${intent.name}" on "${node.name}" is not connected to a target node.`,
            });
          }
        }
      }
    }

    if (node.type === "condition") {
      const matchEdge = outEdges.find((e) => e.source_port === "match");
      const otherwiseEdge = outEdges.find((e) => e.source_port === "otherwise");
      if (!matchEdge) {
        issues.push({
          node_id: node.id,
          field: "match",
          code: "CONDITION_MATCH_UNCONNECTED",
          type: "error",
          message: `Match (Yes) path is not connected on Condition node "${node.name}".`,
        });
      }
      if (!otherwiseEdge) {
        issues.push({
          node_id: node.id,
          field: "otherwise",
          code: "CONDITION_OTHERWISE_UNCONNECTED",
          type: "error",
          message: `Otherwise (No) path is not connected on Condition node "${node.name}".`,
        });
      }
    }

    if (node.type === "http_request") {
      const successEdge = outEdges.find((e) => e.source_port === "success");
      const failureEdge = outEdges.find((e) => e.source_port === "failure");
      if (!successEdge) {
        issues.push({
          node_id: node.id,
          field: "success",
          code: "HTTP_SUCCESS_UNCONNECTED",
          type: "warning",
          message: `Success branch on HTTP request "${node.name}" is not connected.`,
        });
      }
      if (!failureEdge) {
        issues.push({
          node_id: node.id,
          field: "failure",
          code: "HTTP_FAILURE_UNCONNECTED",
          type: "warning",
          message: `Failure branch on HTTP request "${node.name}" is not connected.`,
        });
      }
    }
  }

  const errors = issues.filter((i) => i.type === "error").length;
  const warnings = issues.filter((i) => i.type === "warning").length;

  return {
    valid: errors === 0,
    issues,
    summary: { errors, warnings },
  };
}

function validateNodeConfig(
  node: AgentGraphNode,
  issues: GraphValidationIssue[],
  options: GraphValidationOptions,
): void {
  const { availableTools, availableKnowledgeSources } = options;

  switch (node.type) {
    case "entrypoint": {
      const cfg = node.config as import("./agent-graph.js").EntrypointNodeConfig;
      const hasChannels = cfg.channels
        ? Boolean(cfg.channels.website_chat || cfg.channels.inbound_phone || cfg.channels.webhook)
        : Boolean(cfg.allowed_channels && cfg.allowed_channels.length > 0);
      if (!hasChannels) {
        issues.push({
          node_id: node.id,
          field: "channels",
          code: "CHANNELS_NONE_ENABLED",
          type: "error",
          message: `Entrypoint "${node.name}" must have at least one channel enabled.`,
        });
      }
      break;
    }

    case "conversation": {
      const cfg = node.config as import("./agent-graph.js").ConversationNodeConfig;
      if (Array.isArray(cfg.captured_fields)) {
        for (const f of cfg.captured_fields) {
          if (!f.variable || !f.variable.trim()) {
            issues.push({
              node_id: node.id,
              field: "captured_fields",
              code: "VARIABLE_NAME_EMPTY",
              type: "error",
              message: `Conversation node "${node.name}" has a captured field with an empty variable name.`,
            });
          }
        }
      }
      break;
    }

    case "intent_router": {
      const cfg = node.config as import("./agent-graph.js").IntentRouterNodeConfig;
      if (!Array.isArray(cfg.intents) || cfg.intents.length === 0) {
        issues.push({
          node_id: node.id,
          field: "intents",
          code: "INTENTS_EMPTY",
          type: "error",
          message: `Intent router "${node.name}" must declare at least one intent branch.`,
        });
      }
      break;
    }

    case "condition": {
      const cfg = node.config as import("./agent-graph.js").ConditionNodeConfig;
      if (!Array.isArray(cfg.rules) || cfg.rules.length === 0) {
        issues.push({
          node_id: node.id,
          field: "rules",
          code: "CONDITION_RULES_EMPTY",
          type: "error",
          message: `Condition "${node.name}" has no comparison rules defined.`,
        });
      } else {
        for (const rule of cfg.rules) {
          if (!rule.variable || !rule.variable.trim()) {
            issues.push({
              node_id: node.id,
              field: "rules",
              code: "RULE_VARIABLE_EMPTY",
              type: "error",
              message: `A rule in condition "${node.name}" has an empty variable path.`,
            });
          }
        }
      }
      break;
    }

    case "http_request": {
      const cfg = node.config as import("./agent-graph.js").HttpRequestNodeConfig;
      const toolId = (cfg as { tool_id?: string }).tool_id;
      if (!toolId && !cfg.tool_name)
        issues.push({
          node_id: node.id,
          field: "tool_id",
          code: "TOOL_REQUIRED",
          type: "error",
          message: `HTTP request "${node.name}" must select an attached HTTP tool.`,
        });
      if (toolId && options.availableToolIds && !options.availableToolIds.includes(toolId))
        issues.push({
          node_id: node.id,
          field: "tool_id",
          code: "TOOL_NOT_FOUND",
          type: "error",
          message: `The selected HTTP tool on "${node.name}" is not attached to this agent.`,
        });
      if (!cfg.endpoint || !cfg.endpoint.trim()) {
        issues.push({
          node_id: node.id,
          field: "endpoint",
          code: "HTTP_ENDPOINT_EMPTY",
          type: "error",
          message: `HTTP request "${node.name}" has an empty endpoint path.`,
        });
      }

      // Check required parameters
      if (Array.isArray(cfg.parameter_mappings)) {
        for (const mapping of cfg.parameter_mappings) {
          if (!mapping.variable || !mapping.variable.trim()) {
            issues.push({
              node_id: node.id,
              field: "parameter_mappings",
              code: "HTTP_PARAMETER_VARIABLE_MISSING",
              type: "error",
              message: `Required parameter missing: Map the "${mapping.param}" parameter on "${node.name}" before this node can run.`,
            });
          }
        }
      }

      // Check tool exists if tool_name is provided
      if (cfg.tool_name && availableTools && !availableTools.includes(cfg.tool_name)) {
        issues.push({
          node_id: node.id,
          field: "tool_name",
          code: "TOOL_NOT_FOUND",
          type: "error",
          message: `Connected tool "${cfg.tool_name}" on node "${node.name}" is not attached to this workspace.`,
        });
      }
      break;
    }

    case "knowledge_search": {
      const cfg = node.config as import("./agent-graph.js").KnowledgeSearchNodeConfig;
      if (cfg.use_all_sources) {
        break;
      }
      if (!Array.isArray(cfg.source_ids) || cfg.source_ids.length === 0) {
        issues.push({
          node_id: node.id,
          field: "source_ids",
          code: "KNOWLEDGE_SOURCES_EMPTY",
          type: "error",
          message: `Knowledge search "${node.name}" has no knowledge sources selected.`,
        });
      } else if (availableKnowledgeSources) {
        for (const src of cfg.source_ids) {
          if (!availableKnowledgeSources.includes(src)) {
            issues.push({
              node_id: node.id,
              field: "source_ids",
              code: "KNOWLEDGE_SOURCE_NOT_FOUND",
              type: "warning",
              message: `Knowledge source "${src}" is not found or inaccessible in this workspace.`,
            });
          }
        }
      }
      break;
    }

    case "response": {
      const cfg = node.config as import("./agent-graph.js").ResponseNodeConfig;
      if (cfg.response_mode === "fixed_message" && (!cfg.message || !cfg.message.trim())) {
        issues.push({
          node_id: node.id,
          field: "message",
          code: "RESPONSE_MESSAGE_EMPTY",
          type: "error",
          message: `Fixed response node "${node.name}" has an empty message.`,
        });
      }
      break;
    }

    case "human_handoff": {
      const cfg = node.config as import("./agent-graph.js").HumanHandoffNodeConfig;
      if (!cfg.destination) {
        issues.push({
          node_id: node.id,
          field: "destination",
          code: "HANDOFF_DESTINATION_EMPTY",
          type: "error",
          message: `Human handoff node "${node.name}" requires a destination (e.g. Operator Inbox).`,
        });
      }
      break;
    }

    case "ai_prompt": {
      const cfg = node.config as import("./agent-graph.js").AiPromptNodeConfig;
      if (
        cfg.inherit_agent_instructions !== true &&
        (!cfg.instructions || !cfg.instructions.trim())
      ) {
        issues.push({
          node_id: node.id,
          field: "instructions",
          code: "PROMPT_INSTRUCTIONS_EMPTY",
          type: "error",
          message: `AI & prompt node "${node.name}" has empty instructions.`,
        });
      }
      if (!cfg.output_variable || !cfg.output_variable.trim()) {
        issues.push({
          node_id: node.id,
          field: "output_variable",
          code: "OUTPUT_VARIABLE_EMPTY",
          type: "error",
          message: `AI & prompt node "${node.name}" must specify an output variable (e.g. answer.text).`,
        });
      }
      break;
    }

    default:
      break;
  }
}
