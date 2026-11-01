import type { AgentGraph, GraphDraftSettings, GraphValidationResult } from "./agent-graph.js";

export type AgentAiEditRequest = {
  prompt: string;
};

export type AgentAiEditProposal = {
  graph: AgentGraph;
  settings: GraphDraftSettings;
  summary: string;
  changes: string[];
  validation: GraphValidationResult;
};
