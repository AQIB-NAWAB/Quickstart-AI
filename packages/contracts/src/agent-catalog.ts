import type { AgentToolDefinition } from "./agent-tools.js";

export type AgentModelCatalogItem = {
  id: string;
  name: string;
  provider: string;
  description: string;
  enabled: boolean;
  supports_tools?: boolean;
  supports_vision?: boolean;
};

export type AgentToolCatalogItem = {
  name: string;
  label: string;
  description: string;
  type: AgentToolDefinition["type"];
  enabled: boolean;
  requires_connection?: boolean;
};

export type AgentCatalogResponse = {
  models: AgentModelCatalogItem[];
  tools: AgentToolCatalogItem[];
  generated_at: string;
};
