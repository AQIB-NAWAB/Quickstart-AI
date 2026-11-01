import {
  createDefaultAgentGraph,
  normalizeAgentGraph,
  isAgentGraphShape,
  graphOutputPorts,
  validateAgentGraph,
  validateAgentConfiguration,
} from "@quickstart/contracts";
import type {
  AgentAiEditProposal,
  AgentAiEditRequest,
  AgentGraph,
  GraphDraftSettings,
} from "@quickstart/contracts";
import type { TenantContext } from "@quickstart/auth";
import { s2sProfileAllowed } from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";
import type {
  Agent,
  AgentEnvironmentComparison,
  AgentReleaseReadiness,
  AgentVersion,
  AgentVersionDiff,
  PublishResult,
} from "../domain/types.js";
import type { SecretReadinessClient } from "../clients/secrets-readiness.client.js";
import type { AgentModelGateway } from "../clients/model-gateway.client.js";
import { validateAgentTools } from "../lib/validate-tools.js";
import { snapshotFromAgent } from "../domain/types.js";
import type { AgentStore, CreateAgentInput, UpdateAgentInput } from "../repository/types.js";

type BuilderResponse = {
  graph?: AgentGraph;
  settings?: GraphDraftSettings;
  summary?: string;
  changes: string[];
};

function resolveBuilderModel(modelSettings: Record<string, unknown>) {
  const modelId = String(modelSettings.model_id ?? modelSettings.model ?? "gpt-6-luna");
  const profile = String(
    modelSettings.profile ??
      process.env.DEFAULT_CHAT_MODEL_PROFILE ??
      (modelId.startsWith("claude")
        ? "anthropic"
        : /llama|mixtral|gemma|gpt-oss/i.test(modelId)
          ? "groq"
          : "openai"),
  );
  return { profile, model_id: modelId };
}

function resolveBuilderFallback(primary: { profile: string; model_id: string }) {
  const profile =
    process.env.AI_BUILDER_FALLBACK_PROFILE ??
    (process.env.GROQ_API_KEY ? "groq" : process.env.OPENROUTER_API_KEY ? "openrouter" : undefined);
  if (!profile || profile === primary.profile) return undefined;

  const modelId =
    process.env.AI_BUILDER_FALLBACK_MODEL_ID ??
    (profile === "groq" ? "openai/gpt-oss-120b" : "gpt-6-luna");
  return { profile, model_id: modelId };
}

function buildBuilderSystemPrompt(): string {
  return [
    "You are the QuickStart AI workflow architect.",
    "Convert the user's request into a safe, production-quality draft for the visual agent builder.",
    "Return one JSON object only. Do not use markdown fences or explanatory text outside JSON.",
    'The JSON shape is {"summary": string, "changes": string[], "settings": object, "graph": object}.',
    "The graph must use schema_version 1, exactly one entrypoint, and canonical edge fields: source, source_port, target, target_port (target_port is always 'in'). Use only these exact source_port values: entrypoint=interaction_received; welcome/response=message_sent; conversation=details_complete or needs_assistance; intent_router=intent_<branch id> for each configured branch plus fallback; condition=match or otherwise; ai_prompt/http_request=success or failure; knowledge_search=results_found, no_matches, or failure; human_handoff=resumed; end_conversation has no outputs.",
    "Allowed node types: entrypoint, welcome, conversation, intent_router, condition, ai_prompt, http_request, knowledge_search, response, human_handoff, end_conversation.",
    "Preserve existing node IDs and positions when possible. Add new IDs with stable readable prefixes and avoid duplicate IDs.",
    "Every new node must be reachable from the entrypoint. Never create cycles. Ensure every branch output that is required by validation is connected.",
    "Every condition node must define at least one non-empty comparison rule in config.rules, using a real captured or context variable, an explicit operator, and a value. Never leave condition rules empty; if the comparison is unclear from the request, ask for clarification instead of inventing it.",
    "Keep the existing behavior unless the user's request asks to change it. Do not invent tool IDs, tool names, knowledge source IDs, URLs, secrets, or credentials.",
    "Only add an http_request node when a listed attached tool is an appropriate match. Set require_confirmation true for irreversible actions.",
    "For knowledge search, use use_all_sources true instead of inventing source IDs.",
    "Keep settings.instructions as the complete, concise global agent policy. Preserve model settings, channels, and voice unless the user asks to change them.",
    "For every value a condition checks, collect that value first in a Conversation node. Use captured_fields with required=true; use allowed_values for finite choices. Never substitute visitor.message for a named field. For conditional business identifiers, collect the identifier in a separate required Conversation node on the relevant branch before checking it.",
    "Use an AI response or response node for user-facing output and include a safe fallback path for failures or handoff when appropriate.",
    "Do not leave a conversational response node without an outgoing connection. If users may ask follow-up questions after a fixed answer, set it to wait for visitor input and connect it to a focused AI response step; explicitly end the path only when the conversation should close.",
    "The returned graph must be usable immediately by the editor, not a partial patch.",
  ].join(" ");
}

function parseBuilderResponse(content: string): BuilderResponse {
  const trimmed = content.trim();
  const candidates = [trimmed, trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")];
  let value: unknown;
  for (const candidate of candidates) {
    try {
      value = JSON.parse(candidate);
      break;
    } catch {
      /* Try the next safe JSON extraction. */
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        value = JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        value = undefined;
      }
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError({
      code: ErrorCode.UPSTREAM_UNAVAILABLE,
      message: "The AI builder returned an unreadable workflow proposal.",
    });
  }
  const result = value as Record<string, unknown>;
  if (result.graph !== undefined && !isAgentGraphShape(result.graph)) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "The AI builder returned an invalid workflow graph.",
    });
  }
  return {
    graph: result.graph as AgentGraph | undefined,
    settings:
      result.settings && typeof result.settings === "object" && !Array.isArray(result.settings)
        ? (result.settings as GraphDraftSettings)
        : undefined,
    summary: typeof result.summary === "string" ? result.summary.slice(0, 1000) : undefined,
    changes: Array.isArray(result.changes)
      ? result.changes.filter((item): item is string => typeof item === "string").slice(0, 20)
      : [],
  };
}

function mergeBuilderSettings(
  current: GraphDraftSettings,
  proposed?: GraphDraftSettings,
): GraphDraftSettings {
  const next = proposed ?? {};
  return {
    instructions:
      typeof next.instructions === "string"
        ? next.instructions.slice(0, 64_000)
        : current.instructions,
    model_settings:
      next.model_settings &&
      typeof next.model_settings === "object" &&
      !Array.isArray(next.model_settings)
        ? next.model_settings
        : current.model_settings,
    channels:
      next.channels &&
      typeof next.channels.chat === "boolean" &&
      typeof next.channels.voice === "boolean"
        ? next.channels
        : current.channels,
    voice: next.voice ?? current.voice,
  };
}

function inferConditionRule(
  nodeName: string,
  variables: string[],
): { variable: string; operator: "equals"; value: string } | undefined {
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = nodeName.match(/\b(equals?|is)\s+["']?([^"']+?)["']?$/i);
  const hasBusinessCheck = /\bif\s+business\b/i.test(nodeName);
  if (!match && !hasBusinessCheck) return undefined;

  const prefix = match ? nodeName.slice(0, match.index).trim() : nodeName;
  const subject = prefix.replace(/^(?:check|verify|test|condition)\s+(?:if\s+)?/i, "").trim();
  const subjectKey = compact(subject);
  const candidates = variables.filter(Boolean);
  const variable = candidates
    .map((candidate) => {
      const key = compact(candidate);
      let score = 0;
      if (subjectKey && key === subjectKey) score += 100;
      if (subjectKey && key.endsWith(subjectKey)) score += 70;
      if (subjectKey && subjectKey.endsWith(key)) score += 60;
      if (/\bid\b/i.test(subject) && /id$/i.test(candidate)) score += 50;
      if (hasBusinessCheck && /(?:customer_?)?type$/i.test(candidate)) score += 80;
      if (hasBusinessCheck && /business/i.test(candidate) && /type/i.test(candidate)) score += 90;
      return { candidate, score };
    })
    .sort((left, right) => right.score - left.score)[0];

  if (!variable || variable.score === 0) return undefined;
  const value = match?.[2]?.trim() ?? "business";
  if (!value) return undefined;
  return { variable: variable.candidate, operator: "equals", value };
}

function repairBuilderGraph(input: AgentGraph): AgentGraph {
  const graph = normalizeAgentGraph(input);
  const nodes = [...graph.nodes];
  const edges = graph.edges.map((edge) => ({ ...edge }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const compact = (value: unknown) =>
    typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";

  for (const node of nodes) {
    if (node.type !== "conversation") continue;
    const config = node.config as {
      capture_variable?: string;
      captured_fields?: Array<Record<string, unknown>>;
    };
    if (
      (!Array.isArray(config.captured_fields) || config.captured_fields.length === 0) &&
      typeof config.capture_variable === "string" &&
      config.capture_variable.trim()
    ) {
      config.captured_fields = [
        {
          variable: config.capture_variable,
          field_name: config.capture_variable,
          type: "text",
          required: true,
        },
      ];
    }
  }

  for (const edge of edges) {
    const source = nodeById.get(edge.source ?? "");
    if (!source) continue;
    const ports = graphOutputPorts(source);
    if (ports.includes(edge.source_port ?? "")) continue;

    const rawPort = edge.source_port ?? "";
    const token = compact(rawPort);
    const directMatch = ports.find((port) => compact(port) === token);
    if (directMatch) {
      edge.source_port = directMatch;
      continue;
    }

    let repairedPort: string | undefined;
    if (source.type === "intent_router") {
      const config = source.config as { intents?: Array<{ id?: string; name?: string }> };
      const branchToken = token.replace(/^(intent|branch|out)/, "");
      const matchingIntent = config.intents?.find((intent) => {
        const id = compact(intent?.id);
        const name = compact(intent?.name);
        const idMatches =
          id && (id === branchToken || id.includes(branchToken) || branchToken.includes(id));
        const nameMatches =
          name &&
          (name === branchToken || name.includes(branchToken) || branchToken.includes(name));
        return Boolean(branchToken && (idMatches || nameMatches));
      });
      if (matchingIntent?.id) repairedPort = `intent_${matchingIntent.id}`;
      if (!repairedPort && /fallback|default|otherwise|other|else/.test(token)) {
        repairedPort = "fallback";
      }
      if (!repairedPort) {
        const indexedBranch = Number(branchToken.match(/\d+$/)?.[0]);
        const branches = config.intents ?? [];
        if (indexedBranch > 0 && branches[indexedBranch - 1]?.id) {
          repairedPort = `intent_${branches[indexedBranch - 1].id}`;
        }
      }
      repairedPort ??= "fallback";
    } else if (source.type === "condition") {
      repairedPort = /yes|true|match|pass/.test(token) ? "match" : "otherwise";
    } else if (source.type === "conversation") {
      repairedPort = /assist|handoff|help|fail|fallback/.test(token)
        ? "needs_assistance"
        : "details_complete";
    } else if (source.type === "http_request" || source.type === "ai_prompt") {
      repairedPort = /fail|error|fallback/.test(token) ? "failure" : "success";
    } else if (source.type === "knowledge_search") {
      repairedPort = /fail|error/.test(token)
        ? "failure"
        : /empty|none|no.?match|not.?found/.test(token)
          ? "no_matches"
          : "results_found";
    } else if (ports.length === 1) {
      repairedPort = ports[0];
    }
    if (repairedPort && ports.includes(repairedPort)) edge.source_port = repairedPort;
  }

  const capturedVariables = nodes.flatMap((node) =>
    node.type === "conversation"
      ? ((node.config as { captured_fields?: Array<{ variable?: string }> }).captured_fields ?? [])
          .map((field) => field.variable ?? "")
          .filter(Boolean)
      : [],
  );
  for (const condition of nodes.filter((node) => node.type === "condition")) {
    const config = condition.config as {
      rules?: Array<{ variable?: string; operator?: string; value?: unknown }>;
    };
    if (!Array.isArray(config.rules)) continue;
    for (const rule of config.rules) {
      if (
        /business[ _-]*id|check[ _-]*id/i.test(condition.name) &&
        (!rule.variable || rule.variable === "visitor.message")
      ) {
        rule.variable = "business_id";
      }
    }
  }

  for (const condition of nodes.filter(
    (node) => node.type === "condition" && /business[ _-]*id|check[ _-]*id/i.test(node.name),
  )) {
    if (capturedVariables.includes("business_id")) continue;
    const branchEdge = edges.find((edge) => {
      const source = nodeById.get(edge.source ?? "");
      return (
        edge.target === condition.id &&
        edge.source_port === "otherwise" &&
        source?.type === "condition" &&
        /customer|type/i.test(source.name)
      );
    });
    if (!branchEdge) continue;

    let captureId = "capture_business_id";
    let suffix = 1;
    while (nodeById.has(captureId)) captureId = `capture_business_id_${++suffix}`;
    const captureNode: AgentGraph["nodes"][number] = {
      id: captureId,
      type: "conversation",
      name: "Collect Business ID",
      position: { x: condition.position.x - 300, y: condition.position.y },
      config: {
        instructions: "Ask the visitor for their business ID before checking plan eligibility.",
        captured_fields: [
          {
            variable: "business_id",
            field_name: "business_id",
            type: "text",
            required: true,
          },
        ],
        continue_when: "all_required",
      },
    };
    nodes.push(captureNode);
    nodeById.set(captureId, captureNode);
    branchEdge.target = captureId;
    let edgeId = `${captureId}_complete`;
    let edgeSuffix = 1;
    while (edges.some((edge) => edge.id === edgeId))
      edgeId = `${captureId}_complete_${++edgeSuffix}`;
    edges.push({
      id: edgeId,
      source: captureId,
      source_port: "details_complete",
      target: condition.id,
      target_port: "in",
    });
    capturedVariables.push("business_id");
  }

  for (const node of nodes) {
    if (node.type !== "condition") continue;
    const config = node.config as { rules?: unknown[] };
    if (Array.isArray(config.rules) && config.rules.length > 0) continue;
    const inferred = inferConditionRule(node.name, capturedVariables);
    if (inferred) config.rules = [inferred];
  }

  for (const router of nodes.filter((node) => node.type === "intent_router")) {
    if (edges.some((edge) => edge.source === router.id && edge.source_port === "fallback"))
      continue;
    let suffix = 1;
    let responseId = `${router.id}_fallback_response`;
    while (nodeById.has(responseId)) responseId = `${router.id}_fallback_response_${++suffix}`;
    const response = {
      id: responseId,
      type: "response" as const,
      name: `${router.name} Fallback`,
      position: { x: router.position.x + 320, y: router.position.y + 220 },
      config: {
        response_mode: "fixed_message" as const,
        message: "I’m not sure I understood that. Could you rephrase your request?",
        wait_for_visitor: true,
      },
    };
    nodes.push(response);
    nodeById.set(responseId, response);
    let edgeSuffix = 1;
    let edgeId = `${router.id}_fallback_edge`;
    while (edges.some((edge) => edge.id === edgeId))
      edgeId = `${router.id}_fallback_edge_${++edgeSuffix}`;
    edges.push({
      id: edgeId,
      source: router.id,
      source_port: "fallback",
      target: responseId,
      target_port: "in",
    });
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const seenEdgeIds = new Set<string>();
  const seenOutputPorts = new Set<string>();
  const cleanEdges = edges.filter((edge) => {
    const sourceId = edge.source ?? edge.source_node_id;
    const targetId = edge.target ?? edge.target_node_id;
    if (!sourceId || !targetId || !nodeIds.has(sourceId) || !nodeIds.has(targetId)) return false;

    let edgeId = edge.id;
    let suffix = 1;
    while (seenEdgeIds.has(edgeId)) edgeId = `${edge.id}_repair_${suffix++}`;
    edge.id = edgeId;
    seenEdgeIds.add(edgeId);

    const outputPortKey = `${sourceId}:${edge.source_port ?? edge.source_port_id ?? ""}`;
    if (seenOutputPorts.has(outputPortKey)) return false;
    seenOutputPorts.add(outputPortKey);
    return true;
  });

  return normalizeAgentGraph({ ...graph, nodes, edges: cleanEdges });
}

export class AgentsService {
  constructor(
    private readonly store: AgentStore,
    private readonly secrets?: SecretReadinessClient,
    private readonly modelGateway?: AgentModelGateway,
  ) {}

  async proposeAiEdit(
    tenant: TenantContext,
    agentId: string,
    request: AgentAiEditRequest,
  ): Promise<AgentAiEditProposal> {
    const prompt = request.prompt?.trim();
    if (!prompt || prompt.length < 4 || prompt.length > 10_000) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Describe the workflow change in 4 to 10,000 characters.",
      });
    }
    if (!this.modelGateway) {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: "The AI builder is not configured.",
      });
    }

    const agent = await this.getAgent(tenant, agentId);
    const graph = normalizeAgentGraph(
      agent.draftGraph ??
        createDefaultAgentGraph({
          channels: agent.channels,
          knowledge: agent.configuration?.knowledge,
        }),
    );
    const settings: GraphDraftSettings = {
      instructions: agent.instructions,
      model_settings: agent.modelSettings,
      channels: agent.channels,
      voice: agent.voice,
    };
    const model = resolveBuilderModel(agent.modelSettings);
    const completion = await this.modelGateway.complete({
      workspace_id: tenant.workspaceId,
      request_id: crypto.randomUUID(),
      agent_id: agentId,
      channel: "chat",
      model,
      fallback_model: resolveBuilderFallback(model),
      temperature: 0.1,
      max_tokens: 12_000,
      messages: [
        {
          role: "system",
          content: buildBuilderSystemPrompt(),
        },
        {
          role: "user",
          content: JSON.stringify({
            request: prompt,
            agent: {
              name: agent.name,
              description: agent.description,
              tools: agent.tools.map((tool) => ({
                id: tool.id,
                name: tool.name,
                type: tool.type,
                description: tool.description,
              })),
            },
            current_graph: graph,
            current_settings: settings,
          }),
        },
      ],
    });

    const parsed = parseBuilderResponse(completion.content);
    const candidateGraph = repairBuilderGraph(parsed.graph ?? graph);
    const candidateSettings = mergeBuilderSettings(settings, parsed.settings);
    const validation = validateAgentGraph(candidateGraph, {
      availableTools: agent.tools.map((tool) => tool.name),
      availableToolIds: agent.tools.filter((tool) => tool.type === "http").map((tool) => tool.id),
    });

    return {
      graph: candidateGraph,
      settings: candidateSettings,
      summary: parsed.summary || "Prepared an updated workflow proposal.",
      changes:
        parsed.changes.length > 0
          ? parsed.changes
          : ["Updated the agent workflow from your request."],
      validation,
    };
  }

  async createAgent(tenant: TenantContext, input: CreateAgentInput): Promise<Agent> {
    if (!input.name || input.name.trim().length === 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Agent name is required",
      });
    }
    const tools = input.tools !== undefined ? validateAgentTools(input.tools) : undefined;
    const configuration =
      input.configuration !== undefined
        ? validateAgentConfiguration(input.configuration)
        : undefined;
    return this.store.createAgent(tenant, { ...input, tools, configuration });
  }

  async listAgents(
    tenant: TenantContext,
    options?: { includeArchived?: boolean; limit?: number; cursor?: string },
  ) {
    return this.store.listAgents(tenant, options);
  }

  async getAgent(tenant: TenantContext, agentId: string): Promise<Agent> {
    const agent = await this.store.getAgent(tenant, agentId);
    if (!agent) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Agent not found",
      });
    }
    return agent;
  }

  async updateAgent(
    tenant: TenantContext,
    agentId: string,
    input: UpdateAgentInput,
  ): Promise<Agent> {
    if (input.expectedVersion === undefined || !Number.isInteger(input.expectedVersion)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "expected_version is required and must be an integer",
      });
    }
    const tools = input.tools !== undefined ? validateAgentTools(input.tools) : undefined;
    const configuration =
      input.configuration !== undefined
        ? validateAgentConfiguration(input.configuration)
        : undefined;
    return this.store.updateAgent(tenant, agentId, { ...input, tools, configuration });
  }

  async updateGraph(
    tenant: TenantContext,
    agentId: string,
    graph: import("@quickstart/contracts").AgentGraph,
    expectedVersion: number,
    settings: import("@quickstart/contracts").GraphDraftSettings = {},
  ): Promise<Agent> {
    if (expectedVersion === undefined || !Number.isInteger(expectedVersion)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "expected_version is required and must be an integer",
      });
    }
    if (!isAgentGraphShape(graph)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "graph must contain a valid nodes array",
      });
    }
    if (graph.nodes.length > 250) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Graph exceeds maximum allowable node limit (250 nodes)",
      });
    }
    if (Array.isArray(graph.edges) && graph.edges.length > 500) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Graph exceeds maximum allowable edge limit (500 edges)",
      });
    }

    if (
      !settings ||
      typeof settings !== "object" ||
      (settings.instructions !== undefined &&
        (typeof settings.instructions !== "string" || settings.instructions.length > 64000)) ||
      (settings.channels &&
        (typeof settings.channels.chat !== "boolean" ||
          typeof settings.channels.voice !== "boolean")) ||
      (settings.model_settings &&
        (typeof settings.model_settings !== "object" || Array.isArray(settings.model_settings)))
    )
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "Invalid agent settings" });
    return this.store.updateGraph(
      tenant,
      agentId,
      normalizeAgentGraph(graph),
      expectedVersion,
      settings,
    );
  }

  async validateGraph(
    tenant: TenantContext,
    agentId: string,
    graph: import("@quickstart/contracts").AgentGraph,
  ) {
    const agent = await this.getAgent(tenant, agentId);
    const availableTools = agent.tools?.map((t) => t.name) ?? [];
    const { validateAgentGraph } = await import("@quickstart/contracts");
    return validateAgentGraph(graph, {
      availableTools,
      availableToolIds: agent.tools?.filter((t) => t.type === "http").map((t) => t.id) ?? [],
    });
  }

  async deleteAgent(tenant: TenantContext, agentId: string): Promise<void> {
    const agent = await this.getAgent(tenant, agentId);
    if (agent.productionVersionId || agent.canaryVersionId || agent.scheduledVersionId) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Unpublish the live release before deleting this agent",
      });
    }
    if (!agent.archivedAt) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Archive the agent before deleting it",
      });
    }
    const deleted = await this.store.deleteAgent(tenant, agentId);
    if (!deleted) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Agent not found",
      });
    }
  }

  async archiveAgent(tenant: TenantContext, agentId: string, archived: boolean): Promise<Agent> {
    return this.store.archiveAgent(tenant, agentId, archived);
  }

  async setCanary(
    tenant: TenantContext,
    agentId: string,
    versionId: string | null,
    percentage: number,
  ): Promise<Agent> {
    if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "canary_percentage must be an integer between 0 and 100",
      });
    }
    if (percentage > 0 && !versionId) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "version_id is required when canary traffic is enabled",
      });
    }
    return this.store.setCanary(tenant, agentId, versionId?.trim() || null, percentage);
  }

  async scheduleRelease(
    tenant: TenantContext,
    agentId: string,
    versionId: string,
    publishAt: string,
  ): Promise<Agent> {
    const date = new Date(publishAt);
    if (!versionId?.trim() || !Number.isFinite(date.getTime())) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "version_id and a valid publish_at timestamp are required",
      });
    }
    const agent = await this.getAgent(tenant, agentId);
    if (agent.archivedAt) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Restore the agent before scheduling a release",
      });
    }
    const readiness = await this.getReleaseReadiness(tenant, agentId);
    if (!readiness.ready) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Scheduling is blocked: ${readiness.blockers.map((blocker) => blocker.message).join("; ")}`,
      });
    }
    return this.store.scheduleRelease(tenant, agentId, versionId.trim(), date);
  }

  async applyDueSchedules(now = new Date()): Promise<number> {
    return this.store.applyDueSchedules(now);
  }

  async getEnvironmentComparison(
    tenant: TenantContext,
    agentId: string,
  ): Promise<AgentEnvironmentComparison> {
    const agent = await this.getAgent(tenant, agentId);
    const [staging, production, canary] = await Promise.all(
      [agent.scheduledVersionId, agent.productionVersionId, agent.canaryVersionId].map(
        (versionId) =>
          versionId ? this.store.getVersion(tenant, agentId, versionId) : Promise.resolve(null),
      ),
    );
    return {
      draft: snapshotFromAgent(agent),
      staging,
      production,
      canary,
    };
  }

  async archiveAgents(
    tenant: TenantContext,
    agentIds: string[],
    archived: boolean,
  ): Promise<Agent[]> {
    const ids = [...new Set(agentIds.filter((id) => typeof id === "string" && id.trim()))];
    if (ids.length === 0 || ids.length > 100) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "agent_ids must contain between 1 and 100 agent IDs",
      });
    }
    const agents = await Promise.all(ids.map((id) => this.getAgent(tenant, id)));
    if (
      archived &&
      agents.some(
        (agent) => agent.productionVersionId || agent.canaryVersionId || agent.scheduledVersionId,
      )
    ) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Unpublish live releases before archiving those agents",
      });
    }
    return Promise.all(ids.map((id) => this.store.archiveAgent(tenant, id, archived)));
  }

  async getReleaseReadiness(
    tenant: TenantContext,
    agentId: string,
  ): Promise<AgentReleaseReadiness> {
    const agent = await this.getAgent(tenant, agentId);
    const blockers: Array<{ code: string; message: string }> = [];
    const warnings: string[] = [];

    if (agent.archivedAt) {
      blockers.push({ code: "ARCHIVED", message: "Restore the agent before publishing it" });
    }
    if (!agent.channels.chat && !agent.channels.voice) {
      blockers.push({ code: "NO_CHANNEL", message: "Enable at least one delivery channel" });
    }

    try {
      validateAgentTools(agent.tools);
    } catch (error) {
      blockers.push({
        code: "INVALID_TOOLS",
        message: error instanceof Error ? error.message : "Tool configuration is invalid",
      });
    }

    try {
      validateAgentConfiguration(agent.configuration);
    } catch (error) {
      blockers.push({
        code: "INVALID_CONFIGURATION",
        message: error instanceof Error ? error.message : "Agent configuration is invalid",
      });
    }

    if (agent.builderMode === "canvas") {
      if (!agent.draftGraph) {
        blockers.push({
          code: "GRAPH_MISSING",
          message: "Canvas agents require a graph before publishing",
        });
      } else {
        const { validateAgentGraph } = await import("@quickstart/contracts");
        const validation = validateAgentGraph(agent.draftGraph, {
          availableTools: agent.tools.map((tool) => tool.name),
          availableToolIds: agent.tools
            .filter((tool) => tool.type === "http")
            .map((tool) => tool.id),
          requirePublishReady: true,
        });
        if (!validation.valid) {
          blockers.push({
            code: "INVALID_GRAPH",
            message: `Graph has ${validation.summary.errors} publish-blocking issue(s)`,
          });
        }
      }
    }

    const knowledgeEnabled =
      agent.configuration.knowledge.enabled ||
      Boolean((agent.modelSettings as { knowledge_enabled?: boolean }).knowledge_enabled);
    const s2sCheck = s2sProfileAllowed({
      voice_mode: agent.voice.voice_mode,
      toolsCount: agent.tools.length,
      knowledgeEnabled,
      runtimeBridge: true,
    });
    if (!s2sCheck.ok) {
      blockers.push({ code: "MODEL_PROFILE", message: s2sCheck.reason });
    }
    if (
      agent.tools.some(
        (tool) => tool.policy?.risk === "write" && tool.policy.confirmation === "never",
      )
    ) {
      warnings.push("One or more write tools can execute without confirmation");
    }

    const requiredSecrets = [
      ...new Set(
        agent.tools
          .filter((tool): tool is Extract<typeof tool, { type: "http" }> => tool.type === "http")
          .map((tool) => tool.auth?.secret_name)
          .filter((name): name is string => Boolean(name)),
      ),
    ];
    if (requiredSecrets.length > 0) {
      if (!this.secrets) {
        blockers.push({
          code: "SECRETS_CHECK_UNAVAILABLE",
          message: "Cannot verify tool secrets in this environment",
        });
      } else {
        try {
          const available = await this.secrets.listNames(agent.workspaceId);
          const missing = requiredSecrets.filter((name) => !available.has(name));
          if (missing.length > 0) {
            blockers.push({
              code: "MISSING_SECRET",
              message: `Create the required workspace secret(s): ${missing.join(", ")}`,
            });
          }
        } catch {
          blockers.push({
            code: "SECRETS_SERVICE_UNAVAILABLE",
            message: "Secrets service is unavailable",
          });
        }
      }
    }

    return { ready: blockers.length === 0, blockers, warnings };
  }

  async publish(
    tenant: TenantContext,
    agentId: string,
    baseVersion: number,
    audit?: {
      requestId?: string;
      releaseNotes?: string;
      approval?: { approved: boolean; note?: string };
      completedChecklist?: string[];
    },
  ): Promise<PublishResult> {
    if (!Number.isInteger(baseVersion)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "base_version is required and must be an integer",
      });
    }
    const agent = await this.getAgent(tenant, agentId);

    const readiness = await this.getReleaseReadiness(tenant, agentId);
    if (!readiness.ready) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Publishing is blocked: ${readiness.blockers.map((blocker) => blocker.message).join("; ")}`,
      });
    }

    const releasePolicy = agent.configuration.release;
    const completedChecklist = new Set(audit?.completedChecklist ?? []);
    const missingChecklist = releasePolicy.required_checklist.filter(
      (item) => !completedChecklist.has(item),
    );
    if (missingChecklist.length > 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Publishing requires completing the release checklist: ${missingChecklist.join(", ")}`,
      });
    }
    if (releasePolicy.require_approval && audit?.approval?.approved !== true) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Publishing requires an explicit release approval",
      });
    }

    // If agent is a canvas graph agent, validate before publishing
    if (agent.builderMode === "canvas" && agent.draftGraph) {
      const { validateAgentGraph } = await import("@quickstart/contracts");
      const validation = validateAgentGraph(agent.draftGraph, {
        availableTools: agent.tools?.map((t) => t.name) ?? [],
        availableToolIds: agent.tools?.filter((t) => t.type === "http").map((t) => t.id) ?? [],
        requirePublishReady: true,
      });
      if (!validation.valid) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: `Publishing is blocked by ${validation.summary.errors} configuration issue(s).`,
        });
      }
    }

    const knowledgeEnabled =
      agent.configuration.knowledge.enabled ||
      Boolean((agent.modelSettings as { knowledge_enabled?: boolean }).knowledge_enabled);
    const s2sCheck = s2sProfileAllowed({
      voice_mode: agent.voice.voice_mode,
      toolsCount: agent.tools.length,
      knowledgeEnabled,
      runtimeBridge: true,
    });
    if (!s2sCheck.ok) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: s2sCheck.reason,
      });
    }
    return this.store.publish(tenant, agentId, baseVersion, audit);
  }

  async rollback(
    tenant: TenantContext,
    agentId: string,
    versionId: string,
  ): Promise<PublishResult> {
    if (!versionId?.trim()) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "version_id is required",
      });
    }
    return this.store.rollback(tenant, agentId, versionId.trim());
  }

  async listVersions(
    tenant: TenantContext,
    agentId: string,
    limit?: number,
  ): Promise<AgentVersion[]> {
    return this.store.listVersions(tenant, agentId, limit);
  }

  async getVersion(
    tenant: TenantContext,
    agentId: string,
    versionId: string,
  ): Promise<AgentVersion> {
    const version = await this.store.getVersion(tenant, agentId, versionId);
    if (!version) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Agent version not found",
      });
    }
    return version;
  }

  async diffVersions(
    tenant: TenantContext,
    agentId: string,
    leftId: string,
    rightId: string,
  ): Promise<AgentVersionDiff> {
    return this.store.diffVersions(tenant, agentId, leftId, rightId);
  }
}
