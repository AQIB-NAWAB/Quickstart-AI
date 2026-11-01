/** Shared API types and constants (expanded as services land). */
export const CONTRACTS_VERSION = "0.0.0";

export type HealthResponse = {
  status: "ok";
  service: string;
};

export {
  WORKSPACE_ROLES,
  WORKSPACE_PERMISSIONS,
  permissionsForRole,
  roleHasPermission,
  type WorkspacePermission,
  type WorkspaceRole,
} from "./workspace-permissions.js";

export {
  BUILTIN_INTEGRATION_ACTIONS,
  type AgentBuiltinCalendarToolDefinition,
  type AgentBuiltinIntegrationToolDefinition,
  type AgentBuiltinWebToolDefinition,
  type AgentHttpToolAuth,
  type AgentHttpToolDefinition,
  type AgentMcpToolDefinition,
  type AgentToolDefinition,
  type BuiltinIntegrationProvider,
  type ToolParameterProperty,
  type ToolParameterSchema,
} from "./agent-tools.js";

export {
  DEFAULT_AGENT_CONFIGURATION,
  normalizeAgentConfiguration,
  validateAgentConfiguration,
  type AgentConfiguration,
  type AgentGuardrailSettings,
  type AgentKnowledgeSettings,
  type AgentMemorySettings,
  type AgentObservabilitySettings,
  type AgentReleaseSettings,
  type DependencyFailurePolicy,
  type KnowledgeSearchMethod,
} from "./agent-configuration.js";

export type {
  AgentCatalogResponse,
  AgentModelCatalogItem,
  AgentToolCatalogItem,
} from "./agent-catalog.js";

export type { ToolCallRecord, ToolCallStatus, UpsertToolCallBody } from "./tool-calls.js";

export {
  MAX_CUSTOM_TOOLS_PER_WORKSPACE,
  toAgentToolDefinition,
  type CustomTool,
  type CustomToolConfig,
  type CustomToolHttpConfig,
  type CustomToolInput,
  type CustomToolKind,
  type CustomToolMcpConfig,
  type CustomToolUpdate,
} from "./custom-tools.js";

export {
  DEFAULT_TOOL_TIMEOUT_MS,
  MAX_TOOL_ARGUMENT_BYTES,
  MAX_TOOL_ROUNDS_PER_TURN,
  MAX_TOOL_TIMEOUT_MS,
  MAX_TOOLS_PER_AGENT,
} from "./agent-tools.js";

export type {
  ChatMessage,
  ChatMessageRole,
  CompletionFinishReason,
  CompletionRequestBody,
  CompletionResponseBody,
  ModelToolCall,
  ModelToolDefinition,
  DecideRequestBody,
  DecideResponseBody,
  JevQuestion,
  JevQuestionType,
  ModelCredentialSource,
  ModelReference,
  ModelRoutingMode,
  TokenUsage,
} from "./model-gateway.js";

export type { MembershipSnapshot } from "./membership.js";

export {
  PLATFORM_EVENTS_TOPIC,
  PLATFORM_EVENT_TYPES,
  isPlatformEventType,
  type PlatformEventType,
  type PlatformEventEnvelope,
  type ConversationHandedOffData,
  type ConversationReleasedData,
  type MessageAppendedData,
  type AgentPublishedData,
  type CampaignStartedData,
  type CampaignPausedData,
  type CampaignCompletedData,
  type CampaignTargetAttemptedData,
  type LeadCreatedData,
  type LeadUpdatedData,
  type LeadStatusChangedData,
} from "./platform-events.js";

export type {
  AcquisitionAction,
  AcquisitionJobStatus,
  AcquisitionUsage,
  CrawlRequestBody,
  CrawlResponseBody,
  FetchAction,
  FetchJobStatus,
  FetchUsage,
  JobGetResponseBody,
  ScrapeRequestBody,
  ScrapeResponseBody,
  SearchRequestBody,
  SearchResponseBody,
  SearchResultItem,
} from "./web-fetch.js";

export type {
  BusinessInput,
  LeadRunInput,
  LeadPolicy,
  LeadEvidence,
  CampaignLeadDelivery,
  LeadGenerationResearchStatus,
  LeadGenerationProfile,
  LeadProfileApproval,
  QualificationMode,
  ContactRequirement,
  LeadPriorityCriterion,
  CriterionEvaluation,
  BusinessFitAssessment,
  EvidenceCompletenessAssessment,
  ContactReadinessAssessment,
  OutreachEligibilityAssessment,
  DecisionMakerLead,
  ShortfallExpansionOption,
  ShortfallExplanation,
  LeadGenerationRunSummary,
  LeadGenerationRunCreateResponse,
  LeadGenerationCandidateResult,
  LeadGenerationDeliveryTask,
  LeadGenerationCursorPage,
  InboundSourceType,
  InboundConnectorStatus,
  InboundConnector,
  LeadCollection,
  InboundBatchRecordOutcome,
  InboundBatchEvent,
  LeadEmailDraftRequest,
  LeadEmailSendRequest,
  LeadEmailSendResult,
  LeadAIPhoneCallRequest,
  LeadAIPhoneCallResult,
  LeadEntityType,
  SalesStatus,
  CriterionOperator,
  SearchCriterion,
  LeadContactPoint,
  LeadObservation,
  LeadSalesMetadata,
  LeadSchedule,
  CrmMapping,
  CrmDeliveryJob,
  LeadRecord,
} from "./lead-generation.js";

export {
  CALL_DIRECTIONS,
  CALL_STATES,
  DEFAULT_AGENT_VOICE_SETTINGS,
  DEFAULT_VOICE_DEADLINE_MS,
  DEFAULT_VOICE_MODE,
  PHONE_NUMBER_STATUSES,
  PHONE_NUMBER_TYPES,
  TELEPHONY_PROVIDER_IDS,
  VOICE_MODES,
  isCallState,
  isVoiceMode,
  s2sProfileAllowed,
  type AgentVoiceSettings,
  type AvailablePhoneNumber,
  type CallDirection,
  type CallRecord,
  type CallStageTimings,
  type CallState,
  type CallTranscriptSegment,
  type PhoneNumberCapabilities,
  type PhoneNumberSearchFilters,
  type PhoneNumberSearchResult,
  type PhoneNumberStatus,
  type PhoneNumberType,
  type PurchasePhoneNumberInput,
  type TelephonyProviderId,
  type UpdatePhoneNumberInput,
  type VoiceMode,
  type VoiceTurnRequestBody,
  type WorkspacePhoneNumber,
} from "./voice.js";

export {
  TTS_PROVIDERS,
  VOICE_CATALOG,
  findVoiceCatalogEntry,
  type TtsProviderId,
  type VoiceCatalogEntry,
} from "./voice-catalog.js";

export {
  USAGE_KINDS,
  type UsageKind,
  type UsageFactIngestBody,
  type UsageEntry,
  type UsageListResponse,
} from "./usage.js";

export type { AuditEntry, AuditListResponse } from "./audit.js";

export {
  GRAPH_SCHEMA_VERSION,
  type AgentGraph,
  type AgentGraphEdge,
  type AgentGraphNode,
  type AiPromptNodeConfig,
  type CapturedFieldDefinition,
  type CapturedFieldType,
  type ConditionNodeConfig,
  type ConditionOperator,
  type ConditionRule,
  type ConversationNodeConfig,
  type EndConversationNodeConfig,
  type EntrypointNodeConfig,
  type FlowHandoffState,
  type FlowPendingAction,
  type FlowWaitState,
  type GraphExecutionTrace,
  type GraphNodeConfigMap,
  type NodeConfigMap,
  type GraphNodeExecutionStatus,
  type GraphNodePort,
  type GraphNodeType,
  type GraphPortType,
  type GraphSessionState,
  type GraphTraceEvent,
  type GraphValidationIssue,
  type GraphValidationIssueType,
  type GraphValidationResult,
  type GraphViewport,
  type HttpRequestNodeConfig,
  type HttpRequestParameterMapping,
  type HumanHandoffNodeConfig,
  type IntentBranch,
  type IntentRouterNodeConfig,
  type KnowledgeSearchNodeConfig,
  type ResponseNodeConfig,
  type WelcomeNodeConfig,
} from "./agent-graph.js";

export { validateAgentGraph, type GraphValidationOptions } from "./agent-graph-validator.js";

export {
  normalizeAgentGraph,
  graphOutputPorts,
  isAgentGraphShape,
} from "./agent-graph-normalize.js";

export type { GraphDraftSettings } from "./agent-graph.js";
export { createDefaultAgentGraph } from "./agent-graph-defaults.js";
export type { AgentAiEditRequest, AgentAiEditProposal } from "./agent-ai-editor.js";

export {
  type WorkflowStatus,
  type WorkflowRunStatus,
  type WorkflowStepStatus,
  type WorkflowNodeType,
  type WorkflowSourcePort,
  type TriggerNodeConfig,
  type ConditionRule as WorkflowConditionRule,
  type ConditionGroup as WorkflowConditionGroup,
  type ConditionNodeConfig as WorkflowConditionNodeConfig,
  type WebhookHeader,
  type WebhookNodeConfig,
  type HandoffNodeConfig as WorkflowHandoffNodeConfig,
  type NotificationNodeConfig,
  type UpdateTagsNodeConfig,
  type LogNodeConfig,
  type EndNodeConfig,
  type WorkflowNodeConfig,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowSettings,
  type WorkflowGraph,
  type WorkflowValidationSeverity,
  type WorkflowValidationIssue,
  type WorkflowValidationResult,
  type StepExecutionTrace,
  type WorkflowSimulationResult,
  type WorkflowStatsSummary,
} from "./workflow-graph.js";

export { validateWorkflowGraph } from "./workflow-graph-validator.js";

export {
  evaluateConditionGroup as evaluateWorkflowConditionGroup,
  compare as compareWorkflowCondition,
  getByPath as getWorkflowValue,
} from "./workflow-condition-evaluator.js";
export { evaluateRule as evaluateWorkflowRule } from "./workflow-condition-evaluator.js";
export { isWorkflowGraphShape, workflowOutputPorts } from "./workflow-graph-validator.js";

export type {
  AnalyticsSummary,
  AnalyticsDailyTokenBucket,
  AnalyticsDailyLatencyBucket,
  AnalyticsServiceUsage,
  AnalyticsResponse,
  AgentOperationalMetrics,
  MetricCoverage,
  MetricCoverageIndicators,
} from "./analytics.js";

export {
  INTEGRATION_PROVIDERS,
  INTEGRATION_CATEGORIES,
  type IntegrationProvider,
  type IntegrationCategory,
  type IntegrationStatus,
  type IntegrationCatalogItem,
  type IntegrationConnection,
  type ProviderCapabilities,
  type IntegrationAuthorizeResponse,
  type IntegrationsListResponse,
  type IntegrationSyncRequest,
  type IntegrationSyncResult,
} from "./integrations.js";

export type {
  NotificationCategory,
  NotificationSeverity,
  NotificationSource,
  WorkspaceNotificationItem,
  NotificationsListResponse,
  UnreadCountResponse,
} from "./notifications.js";

export type {
  WebhookStatus,
  WebhookEndpointItem,
  WebhookDeliveryAttemptItem,
  WebhookDeliveryItem,
  WebhooksListResponse,
  WebhookDeliveriesListResponse,
} from "./webhooks.js";

export type {
  BillingPlanInterval,
  BillingPlanTier,
  BillingSubscriptionStatus,
  BillingPlanFeature,
  BillingPlan,
  BillingSubscription,
  BillingInvoice,
  OrganizationEntitlements,
  BillingSummaryResponse,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  CreateCustomerPortalSessionRequest,
  CreateCustomerPortalSessionResponse,
  CancelSubscriptionRequest,
  BillingReservation,
  AcquireReservationRequest,
  AcquireReservationResponse,
  CommitReservationRequest,
  BillingCredit,
  SpendControls,
} from "./billing.js";

export type {
  QueuePriority,
  HandoffStatus,
  OperatorQueue,
  OperatorQueueMember,
  ConversationHandoffRecord,
  CreateQueueRequest,
  UpdateQueueRequest,
  EnqueueConversationRequest,
  ClaimConversationRequest,
  QueuesListResponse,
} from "./operator-queues.js";
