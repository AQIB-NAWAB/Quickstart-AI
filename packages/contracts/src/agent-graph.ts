/**
 * Visual Agent Builder Canvas Graph Contracts & Runtime Types
 * Schema Version: 1
 */

export const GRAPH_SCHEMA_VERSION = 1;

export type GraphNodeType =
  | "entrypoint"
  | "welcome"
  | "conversation"
  | "intent_router"
  | "condition"
  | "ai_prompt"
  | "http_request"
  | "knowledge_search"
  | "response"
  | "human_handoff"
  | "end_conversation";

export type GraphPortType = "input" | "output";

export type GraphNodePort = {
  id: string;
  name: string;
  type: GraphPortType;
  color?: string;
  description?: string;
};

export type GraphViewport = {
  x: number;
  y: number;
  zoom: number;
};

// -----------------------------------------------------------------------------
// Node Configurations (Discriminated Union)
// -----------------------------------------------------------------------------

export type EntrypointNodeConfig = {
  channels?: {
    website_chat: boolean;
    inbound_phone: boolean;
    webhook: boolean;
  };
  allowed_channels?: string[];
  visitor_fields?: Array<{
    variable: string;
    source: string;
    optional?: boolean;
  }>;
  visitor_metadata_fields?: string[];
  first_step_node_id?: string;
  webhook_config?: {
    enabled: boolean;
    secret_token?: string;
    idempotency_header?: string;
  };
};

export type WelcomeNodeConfig = {
  mode?: "fixed" | "ai";
  message_mode?: "ai_generated" | "fixed" | "mixed";
  message?: string;
  fixed_text?: string;
  greeting_text?: string;
  greeting_text_voice?: string;
  ai_prompt?: string;
  instructions?: string;
  after_mode?: "continue" | "wait";
  transition?: "wait_for_input" | "continue" | "continue_immediately" | string;
  wait_for_user?: boolean;
  next_step_node_id?: string;
};

export type CapturedFieldType = "text" | "email" | "phone" | "date" | "number" | "boolean";

export type CapturedFieldDefinition = {
  variable: string;
  type: CapturedFieldType;
  required: boolean;
  field_name?: string;
  description?: string;
  allowed_values?: string[];
};

export type ConversationNodeConfig = {
  instructions: string;
  model_override?: {
    provider?: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
  };
  captured_fields?: CapturedFieldDefinition[];
  capture_fields?: Array<{
    field_name: string;
    type?: string;
    required?: boolean;
    description?: string;
  }>;
  continue_when?: "all_required" | "any_provided" | "always";
  completion_condition?: string;
  assistance_node_id?: string;
  handoff_on_failure?: boolean;
  failure_threshold?: number;
  max_turns_allowed?: number;
  max_turns?: number;
  completed_step_node_id?: string;
  fallback_step_node_id?: string;
};

export type IntentBranch = {
  id: string;
  name: string;
  description: string;
  condition?: string;
  color?: string;
};

export type IntentRouterNodeConfig = {
  routing_method?: "ai_intent" | "rules";
  mode?: "ai_intent" | "keyword" | "regex" | "rules" | string;
  model_override?: {
    provider?: string;
    model?: string;
    temperature?: number;
  };
  instructions?: string;
  intents?: IntentBranch[];
  branches?: IntentBranch[];
  default_branch_node_id?: string;
  fallback_branch_id?: string;
  confidence_threshold?: number;
  fallback_to_ai?: boolean;
  fallback_target_node_id?: string;
};

export type ConditionOperator =
  "equals" | "not_equals" | "greater_than" | "less_than" | "contains" | "is_empty" | "is_not_empty";

export type ConditionRule = {
  variable?: string;
  field?: string;
  operator: ConditionOperator;
  value: string | number | boolean;
};

export type ConditionNodeConfig = {
  match_mode?: "all" | "any";
  logical_operator?: "AND" | "OR" | "all" | "any" | string;
  rules: ConditionRule[];
  missing_value_behavior?: "otherwise" | "fail" | "evaluate_false";
  match_target_node_id?: string;
  otherwise_target_node_id?: string;
};

export type AiPromptNodeConfig = {
  instructions?: string;
  system_prompt?: string;
  inherit_agent_instructions?: boolean;
  model_profile?: string;
  /** Optional published specialist agent to run this prompt as a delegated step. */
  delegate_agent_id?: string;
  model_override?: {
    provider?: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
    reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    verbosity?: "low" | "medium" | "high";
  };
  temperature?: number;
  reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  verbosity?: "low" | "medium" | "high";
  context_variables?: string[];
  conversation_history_window?: number;
  output_variable?: string;
  continue_on_success_node_id?: string;
  on_generation_failure_node_id?: string;
};

export type HttpRequestParameterMapping = {
  param: string;
  variable: string;
  location?: "query" | "body" | "path";
};

export type HttpRequestNodeConfig = {
  tool_id?: string;
  tool_name?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | string;
  endpoint?: string;
  url?: string;
  parameter_mappings?: HttpRequestParameterMapping[] | Record<string, string>;
  auth_secret_ref?: string;
  timeout_seconds?: number;
  on_failure?: "follow_failure_branch" | "retry";
  output_variable?: string;
  requires_confirmation?: boolean;
  require_confirmation?: boolean;
  confirmation_prompt?: string;
};

export type KnowledgeSearchNodeConfig = {
  source_ids?: string[];
  use_all_sources?: boolean;
  query_variable?: string;
  max_results?: number;
  search_method?: "semantic" | "keyword" | "hybrid";
  output_variable?: string;
  results_found_target_node_id?: string;
  no_matches_target_node_id?: string;
};

export type ResponseNodeConfig = {
  response_mode?: "ai_response" | "fixed_message";
  content_type?: "variable_reference" | "fixed_text" | string;
  message?: string;
  fixed_text?: string;
  variable_name?: string;
  instructions?: string;
  context_variables?: string[];
  variable_path?: string;
  allow_markdown?: boolean;
  voice_settings?: {
    voice_id?: string;
    language?: string;
  };
  after_responding?: "wait_for_visitor" | "continue";
  wait_for_visitor?: boolean;
  next_step_node_id?: string;
};

export type HumanHandoffNodeConfig = {
  destination?: string;
  queue_name?: string;
  message_chat?: string;
  message_voice?: string;
  handoff_message?: string;
  handoff_note_template?: string;
  pause_ai?: boolean;
  pause_ai_replies?: boolean;
  resume_strategy?: "return_to_intent_router" | "next_node";
  resume_rule?: string;
  resume_node_id?: string;
};

export type EndConversationNodeConfig = {
  closing_message_enabled?: boolean;
  closing_message?: string;
  closing_message_chat?: string;
  closing_message_voice?: string;
  chat_behavior?: "finish_session" | "archive_session" | string;
  voice_behavior?: "end_call_after_speaking" | "graceful_hangup" | string;
  save_final_state?: boolean;
};

export type GraphNodeConfigMap = {
  entrypoint: EntrypointNodeConfig;
  welcome: WelcomeNodeConfig;
  conversation: ConversationNodeConfig;
  intent_router: IntentRouterNodeConfig;
  condition: ConditionNodeConfig;
  ai_prompt: AiPromptNodeConfig;
  http_request: HttpRequestNodeConfig;
  knowledge_search: KnowledgeSearchNodeConfig;
  response: ResponseNodeConfig;
  human_handoff: HumanHandoffNodeConfig;
  end_conversation: EndConversationNodeConfig;
};

export type NodeConfigMap = GraphNodeConfigMap;

export type AgentGraphNode<T extends GraphNodeType = GraphNodeType> = {
  id: string;
  type: T;
  name: string;
  position: { x: number; y: number };
  config: GraphNodeConfigMap[T];
  presentation?: {
    notes?: string;
    collapsed?: boolean;
    custom_color?: string;
  };
  presentation_metadata?: {
    notes?: string;
    collapsed?: boolean;
    custom_color?: string;
  };
};

export type AgentGraphEdge = {
  id: string;
  source?: string;
  source_port?: string;
  target?: string;
  target_port?: string;
  source_node_id?: string;
  source_port_id?: string;
  target_node_id?: string;
  target_port_id?: string;
  label?: string;
};

export type AgentGraph = {
  schema_version: number;
  entry_node_id: string;
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
  viewport?: GraphViewport;
};

// -----------------------------------------------------------------------------
// Validation Types
// -----------------------------------------------------------------------------

export type GraphValidationIssueType = "error" | "warning";

export type GraphValidationIssue = {
  node_id?: string;
  edge_id?: string;
  field?: string;
  type: GraphValidationIssueType;
  severity?: GraphValidationIssueType;
  message: string;
  code?: string;
  rule?: string;
  quick_fix_available?: boolean;
};

export type GraphValidationResult = {
  valid: boolean;
  issues: GraphValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
  };
};

// -----------------------------------------------------------------------------
// Execution & Trace Types
// -----------------------------------------------------------------------------

export type GraphNodeExecutionStatus =
  | "pending"
  | "running"
  | "waiting_for_input"
  | "succeeded"
  | "failed"
  | "skipped"
  | "handed_off"
  | "canceled"
  | "completed";

export type GraphTraceEvent = {
  event_id: string;
  run_id: string;
  session_id: string;
  node_id: string;
  node_name: string;
  node_type: GraphNodeType;
  status: GraphNodeExecutionStatus;
  chosen_branch_port?: string;
  chosen_port_id?: string;
  start_time: string;
  end_time?: string;
  duration_ms: number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
};

export type GraphExecutionTrace = {
  run_id: string;
  session_id: string;
  agent_id?: string;
  release_id?: string | null;
  is_preview?: boolean;
  status: "succeeded" | "failed" | "running" | "waiting_for_input";
  total_duration_ms: number;
  duration_ms?: number;
  steps: GraphTraceEvent[];
  events?: GraphTraceEvent[];
  started_at: string;
  completed_at?: string;
};

export type FlowWaitState = {
  node_id: string;
  expected_type?: "visitor_reply" | "action_confirmation";
  captured_fields?: string[];
  expires_at?: string;
};

export type FlowPendingAction = {
  action_id: string;
  tool_name: string;
  endpoint: string;
  method: string;
  args: Record<string, unknown>;
  confirmed: boolean;
  created_at: string;
};

export type FlowHandoffState = {
  original_node_id: string;
  resume_target_node_id?: string;
  handed_off_at: string;
  note?: string;
};

export type GraphSessionState = {
  session_id: string;
  workspace_id: string;
  agent_id: string;
  release_id: string | null;
  /** Frozen definition and defaults for the lifetime of this flow session. */
  graph_snapshot?: AgentGraph;
  agent_defaults?: {
    instructions: string;
    model_settings: Record<string, unknown>;
    tools: import("./agent-tools.js").AgentToolDefinition[];
  };
  is_preview: boolean;
  channel: "chat" | "voice" | "webhook";
  status: "active" | "waiting_for_input" | "handed_off" | "completed" | "failed";
  current_node_id: string;
  variables: Record<string, unknown>;
  wait_state?: FlowWaitState;
  pending_action?: FlowPendingAction;
  handoff_state?: FlowHandoffState;
  turn_count: number;
  created_at: string;
  updated_at: string;
};

export type GraphDraftSettings = {
  instructions?: string;
  model_settings?: Record<string, unknown>;
  channels?: { chat: boolean; voice: boolean };
  voice?: import("./index.js").AgentVoiceSettings;
};
