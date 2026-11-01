import type { AgentGraph, AgentGraphEdge, AgentGraphNode } from "./agent-graph.js";

export type DefaultAgentGraphChannels = {
  chat: boolean;
  voice: boolean;
};

export type DefaultAgentGraphOptions = {
  channels?: DefaultAgentGraphChannels;
  knowledge?: {
    enabled?: boolean;
    source_ids?: string[];
    search_method?: "semantic" | "keyword" | "hybrid";
    max_results?: number;
  };
};

/**
 * Creates the shared baseline flow used when a legacy/manual agent is opened in
 * Canvas. The agent's global instructions remain in the agent draft settings;
 * the AI node deliberately inherits them instead of copying the text.
 */
export function createDefaultAgentGraph(options: DefaultAgentGraphOptions = {}): AgentGraph {
  const channels = options.channels ?? { chat: true, voice: false };
  const knowledge = options.knowledge;
  const includeKnowledge = knowledge?.enabled === true;
  const entryId = "manual_entry";
  const knowledgeId = "manual_knowledge";
  const aiId = "manual_ai";
  const responseId = "manual_response";
  const allowedChannels = [
    ...(channels.chat ? ["chat"] : []),
    ...(channels.voice ? ["voice"] : []),
  ];
  if (allowedChannels.length === 0) allowedChannels.push("chat");

  const nodes: AgentGraphNode[] = [
    {
      id: entryId,
      type: "entrypoint",
      name: "Incoming interaction",
      position: { x: 80, y: 240 },
      config: {
        allowed_channels: allowedChannels,
        visitor_metadata_fields: [],
      },
      presentation: {
        notes: "Generated from the manual agent editor.",
      },
    },
    ...(includeKnowledge
      ? [
          {
            id: knowledgeId,
            type: "knowledge_search" as const,
            name: "Search workspace knowledge",
            position: { x: 380, y: 240 },
            config: {
              ...(knowledge?.source_ids?.length
                ? { source_ids: [...knowledge.source_ids] }
                : { use_all_sources: true }),
              query_variable: "visitor.message",
              max_results: knowledge?.max_results ?? 5,
              search_method: knowledge?.search_method ?? "hybrid",
              output_variable: "search_context",
            },
            presentation: {
              notes: "Uses the same knowledge settings as the manual agent.",
            },
          },
        ]
      : []),
    {
      id: aiId,
      type: "ai_prompt",
      name: "Use agent instructions",
      position: { x: 720, y: 240 },
      config: {
        system_prompt: "",
        inherit_agent_instructions: true,
        context_variables: [...(includeKnowledge ? ["search_context"] : []), "visitor.message"],
        temperature: 0.3,
        output_variable: "ai_output",
      },
      presentation: {
        notes: "This node inherits the shared global instructions from the manual editor.",
      },
    },
    {
      id: responseId,
      type: "response",
      name: "Send response",
      position: { x: 1060, y: 240 },
      config: {
        content_type: "variable_reference",
        variable_name: "ai_output",
        wait_for_visitor: true,
        allow_markdown: true,
      },
    },
  ];

  const edge = (
    id: string,
    source: string,
    source_port: string,
    target: string,
  ): AgentGraphEdge => ({
    id,
    source,
    source_port,
    target,
    target_port: "in",
  });

  return {
    schema_version: 1,
    entry_node_id: entryId,
    nodes,
    edges: [
      ...(includeKnowledge
        ? [
            edge("manual_entry_to_knowledge", entryId, "interaction_received", knowledgeId),
            edge("manual_knowledge_found", knowledgeId, "results_found", aiId),
            edge("manual_knowledge_empty", knowledgeId, "no_matches", aiId),
            edge("manual_knowledge_failure", knowledgeId, "failure", aiId),
          ]
        : [edge("manual_entry_to_ai", entryId, "interaction_received", aiId)]),
      edge("manual_ai_success", aiId, "success", responseId),
      edge("manual_ai_failure", aiId, "failure", responseId),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
