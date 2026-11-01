/** Agent tool definitions (Feature 15) — frozen in published version snapshot. */

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

export type AgentToolDefinitionBase = {
  id: string;
  name: string;
  description: string;
  parameters?: ToolParameterSchema;
  timeout_ms?: number;
  /** When false, timeout → unknown and no automatic retry. */
  idempotent?: boolean;
  policy?: {
    enabled?: boolean;
    allowed_channels?: Array<"chat" | "voice" | "webhook">;
    confirmation?: "never" | "user" | "staff";
    risk?: "read" | "write";
    max_calls_per_turn?: number;
  };
};

export type AgentHttpToolAuth = {
  type: "bearer_secret";
  /** Name of a workspace secret (secrets vault). Resolved by the runtime at execution time. */
  secret_name: string;
};

export type AgentHttpToolDefinition = AgentToolDefinitionBase & {
  type: "http";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  base_url: string;
  allowed_hosts: string[];
  path_template?: string;
  /** Static headers sent with every call. `authorization`/`x-api-key` are rejected — use `auth`. */
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
  /**
   * start/status/results/cancel manage lead-generation research runs.
   * capture saves the current conversation as a qualified lead.
   * request_callback saves a qualified lead with a callback time for the team.
   */
  action: "start" | "status" | "results" | "cancel" | "capture" | "request_callback";
};

/**
 * Appointment booking through the workspace's connected Google Calendar.
 * `check_availability` returns open slots, `book_slot` creates the event, and
 * `cancel_event` removes it. The workspace must connect Google Calendar first.
 */
export type AgentBuiltinCalendarToolDefinition = AgentToolDefinitionBase & {
  type: "builtin_calendar";
  action: "check_availability" | "book_slot" | "cancel_event";
  calendar_id?: string;
  timezone?: string;
  slot_minutes?: number;
  working_hours?: {
    start?: string;
    end?: string;
  };
};

/**
 * Built-in actions on the workspace's connected integrations. The agent never
 * receives provider credentials; workspace-service resolves them.
 */
export const BUILTIN_INTEGRATION_ACTIONS = {
  zendesk: ["create_ticket", "get_ticket", "add_comment"],
  slack: ["post_message"],
  hubspot: ["create_or_update_contact"],
  salesforce: ["create_lead"],
  google_sheets: ["append_row"],
  mailchimp: ["add_subscriber"],
  twilio: ["send_sms"],
} as const;

export type BuiltinIntegrationProvider = keyof typeof BUILTIN_INTEGRATION_ACTIONS;

export type AgentBuiltinIntegrationToolDefinition = AgentToolDefinitionBase & {
  type: "builtin_integration";
  provider: BuiltinIntegrationProvider;
  action: (typeof BUILTIN_INTEGRATION_ACTIONS)[BuiltinIntegrationProvider][number];
};

export type AgentToolDefinition =
  | AgentBuiltinLeadToolDefinition
  | AgentBuiltinCalendarToolDefinition
  | AgentBuiltinIntegrationToolDefinition
  | AgentHttpToolDefinition
  | AgentBuiltinWebToolDefinition
  | AgentMcpToolDefinition;

export const MAX_TOOLS_PER_AGENT = 20;
export const MAX_TOOL_ROUNDS_PER_TURN = 5;
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const MAX_TOOL_TIMEOUT_MS = 60_000;
export const MAX_TOOL_ARGUMENT_BYTES = 16_384;
