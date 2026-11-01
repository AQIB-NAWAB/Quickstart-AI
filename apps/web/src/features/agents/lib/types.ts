import type { AgentConfiguration, AgentGraph } from "@quickstart/contracts";

export type AgentChannels = {
  chat: boolean;
  voice: boolean;
};

export type ToolParameterProperty = {
  type: string;
  description?: string;
  items?: { type: string };
  enum?: Array<string | number | boolean>;
};

export type ToolParameterSchema = {
  type: "object";
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
};

export type AgentHttpToolAuth = {
  type: "bearer_secret";
  secret_name: string;
};

export type AgentToolDefinitionBase = {
  id: string;
  name: string;
  description: string;
  parameters?: ToolParameterSchema;
  timeout_ms?: number;
  idempotent?: boolean;
  policy?: {
    enabled?: boolean;
    allowed_channels?: Array<"chat" | "voice" | "webhook">;
    confirmation?: "never" | "user" | "staff";
    risk?: "read" | "write";
    max_calls_per_turn?: number;
  };
};

export type AgentHttpToolDefinition = AgentToolDefinitionBase & {
  type: "http";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  base_url: string;
  allowed_hosts: string[];
  path_template?: string;
  headers?: Record<string, string>;
  auth?: AgentHttpToolAuth;
};

export type AgentBuiltinWebToolDefinition = AgentToolDefinitionBase & {
  type: "builtin_web";
  action: "scrape" | "search";
};

export type AgentMcpToolDefinition = AgentToolDefinitionBase & {
  type: "mcp";
  server_url: string;
  allowed_tool_names: string[];
};

export type AgentBuiltinLeadToolDefinition = AgentToolDefinitionBase & {
  type: "builtin_leads";
  action: "start" | "status" | "results" | "cancel" | "capture" | "request_callback";
};

export type AgentBuiltinCalendarToolDefinition = AgentToolDefinitionBase & {
  type: "builtin_calendar";
  action: "check_availability" | "book_slot" | "cancel_event";
  calendar_id?: string;
  timezone?: string;
  slot_minutes?: number;
  working_hours?: { start?: string; end?: string };
};

export type AgentBuiltinIntegrationProvider =
  "zendesk" | "slack" | "hubspot" | "salesforce" | "google_sheets" | "mailchimp" | "twilio";

export type AgentBuiltinIntegrationAction =
  | "create_ticket"
  | "get_ticket"
  | "add_comment"
  | "post_message"
  | "create_or_update_contact"
  | "create_lead"
  | "append_row"
  | "add_subscriber"
  | "send_sms";

export type AgentBuiltinIntegrationToolDefinition = AgentToolDefinitionBase & {
  type: "builtin_integration";
  provider: AgentBuiltinIntegrationProvider;
  action: AgentBuiltinIntegrationAction;
};

export type AgentToolDefinition =
  | AgentBuiltinLeadToolDefinition
  | AgentBuiltinCalendarToolDefinition
  | AgentBuiltinIntegrationToolDefinition
  | AgentHttpToolDefinition
  | AgentBuiltinWebToolDefinition
  | AgentMcpToolDefinition;

export type AgentSnapshot = {
  name: string;
  description: string | null;
  instructions: string;
  environment: string;
  model_settings: Record<string, unknown>;
  channels: AgentChannels;
  tools: AgentToolDefinition[];
  configuration: AgentConfiguration;
  draft_version: number;
  graph?: AgentGraph;
  builder_mode?: "legacy" | "canvas";
};

export type AgentVoiceSettings = {
  voice_mode: "cascade" | "s2s";
  language: string;
  tts_voice_id: string;
  max_response_chars: number;
  turn_detection_profile_id: string;
  recording_enabled: boolean;
};

export type Agent = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  instructions: string;
  environment: string;
  model_settings: Record<string, unknown>;
  channels: AgentChannels;
  tools: AgentToolDefinition[];
  configuration?: AgentConfiguration;
  voice?: AgentVoiceSettings;
  version: number;
  draft_revision?: number;
  builder_mode?: "legacy" | "canvas";
  draft_graph?: AgentGraph | null;
  production_version_id: string | null;
  scheduled_version_id?: string | null;
  scheduled_publish_at?: string | null;
  canary_version_id: string | null;
  canary_percentage: number;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
};

export type AgentVersion = {
  id: string;
  workspace_id: string;
  agent_id: string;
  release_number: number;
  release_notes?: string | null;
  snapshot: AgentSnapshot;
  created_by: string;
  created_at: string;
};

export type VersionFieldDiff = {
  before: unknown;
  after: unknown;
};

export type AgentVersionDiff = {
  left_id: string;
  right_id: string;
  fields: Record<string, VersionFieldDiff>;
};

export type ApiError = {
  code: string;
  message: string;
  request_id?: string;
};
