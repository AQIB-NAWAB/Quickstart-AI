/** Backend contract. Campaign service must deduplicate the delivery key within a workspace. */
export type LeadEvidence = {
  field: string;
  value: string;
  source_url: string;
  quote: string;
  retrieved_at?: string;
};

export type LeadEntityType = "business" | "professional" | "consumer";

export type SalesStatus = "new" | "contacted" | "replied" | "meeting" | "won" | "lost";

export type CriterionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "greater_than"
  | "less_than"
  | "exists"
  | "semantic_match";

export type SearchCriterion = {
  id: string;
  field: string;
  operator: CriterionOperator;
  value?: string;
  mandatory: boolean;
  weight?: number;
  applicable_entity_types?: LeadEntityType[];
  semantic_description?: string;
  evidence_required?: boolean;
};

export type LeadContactPoint = {
  type: "email" | "phone" | "linkedin" | "website" | "social";
  raw_value: string;
  normalized_value: string;
  source_url?: string;
  observed_at: string;
  status:
    | "observed"
    | "format_valid"
    | "format_invalid"
    | "domain_routable"
    | "domain_not_routable"
    | "domain_unknown"
    | "provider_verified";
  provider?: string;
  verified_at?: string;
};

export type LeadObservation = {
  id?: string;
  lead_id?: string;
  field: string;
  value: string;
  quote?: string;
  source_url?: string;
  provider?: string;
  external_record_id?: string;
  confidence?: number;
  observed_at: string;
};

export type LeadSalesMetadata = {
  status: SalesStatus;
  notes?: string;
  user_edited_fields?: Record<string, unknown>;
  last_contacted_at?: string;
  updated_at?: string;
  activity_history?: Array<{
    timestamp: string;
    actor: string;
    action: string;
    details?: Record<string, unknown>;
  }>;
};

export type LeadRecord = {
  id: string;
  workspace_id: string;
  domain: string | null;
  entity_type: LeadEntityType;
  sales_status: SalesStatus;
  notes?: string | null;
  user_edits?: Record<string, unknown>;
  activity_history?: Array<{
    timestamp: string;
    actor: string;
    action: string;
    details?: Record<string, unknown>;
  }>;
  refresh_history?: Array<{
    refreshed_at: string;
    run_id: string;
    previous_summary?: string | null;
    new_summary?: string | null;
    fit_score?: number | null;
  }>;
  contact_points?: LeadContactPoint[];
  observations?: LeadObservation[];
  data: Record<string, any>;
  created_at: string;
  checked_at: string;
};

export type BusinessInput = {
  name: string;
  website?: string;
  description: string;
  offerings: string[];
  target_categories: string[];
  locations: string[];
  target_audience?: string;
  value_proposition?: string;
  products_and_services?: string[];
  selling_points?: string[];
  target_countries?: string[];
  target_industries?: string[];
  preferred_roles?: string[];
  exclusions?: string[];
  ideal_customer_profile?: {
    characteristics?: string[];
    company_sizes?: string[];
    countries?: string[];
    industries?: string[];
    preferred_roles?: string[];
    exclusions?: string[];
  };
};

export type LeadProfileApproval = {
  approved: boolean;
  approved_at?: string;
  approved_by?: string;
  confirmed_facts?: Record<string, unknown>;
  notes?: string;
};

export type QualificationMode = "strict" | "best_match";
export type ContactRequirement = "none" | "email" | "phone" | "either" | "both";

export type LeadPriorityCriterion = {
  field: string;
  priority: number;
  mandatory: boolean;
};

export type LeadRunInput = {
  entity_type?: LeadEntityType;
  categories: string[];
  location?: string;
  company_size?: string;
  contact_role?: string;
  instructions?: string;
  excluded_domains: string[];
  required_contact: ContactRequirement;
  target_count: number;
  campaign_id?: string;
  qualification_mode?: QualificationMode;
  countries?: string[];
  industries?: string[];
  target_roles?: string[];
  buying_signals?: string[];
  priorities?: LeadPriorityCriterion[];
  criteria?: SearchCriterion[];
  confirmed_assumptions?: string[];
  ambiguity_clarifications?: Record<string, string>;
  collection_id?: string;
  budget_limits?: {
    max_cost_usd?: number;
    max_candidates?: number;
    max_runtime_seconds?: number;
  };
  source_policy?: {
    preferred_sources?: string[];
    allow_fallback?: boolean;
    disallowed_sources?: string[];
  };
};

export type LeadPolicy = {
  enabled: boolean;
  subscription_limits_enabled: boolean;
  max_categories: number;
  max_queued_runs: number;
  max_active_tasks: number;
  daily_runs: number;
  daily_units: number;
  daily_tokens: number;
  scheduling_weight: number;
  max_rounds: number;
  max_candidates: number;
  max_target_count: number;
  run_deadline_seconds: number;
  request_rate_per_minute: number;
  min_fit_score: number;
};

export type CriterionEvaluation = {
  criterion: string;
  status: "matched" | "unmet" | "unknown";
  mandatory: boolean;
  value?: string;
  source_url?: string;
  quote?: string;
  explanation: string;
};

export type BusinessFitAssessment = {
  score: number;
  max: 100;
  reasons: string[];
  gaps: string[];
};

export type EvidenceCompletenessAssessment = {
  status: "complete" | "partial" | "insufficient";
  verified_count: number;
  unknown_count: number;
  verified_criteria: string[];
  unknown_criteria: string[];
};

export type ContactReadinessAssessment = {
  email_available: boolean;
  email_verified: boolean;
  phone_available: boolean;
  phone_verified: boolean;
  status: "ready" | "unverified" | "missing";
};

export type OutreachEligibilityAssessment = {
  eligible: boolean;
  channel: "email" | "phone" | "both" | "none";
  reason: string;
  cold_outreach: boolean;
  suppressed?: boolean;
  requires_consent?: boolean;
};

export type DecisionMakerLead = {
  name?: string;
  role?: string;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string;
  confidence?: number;
};

export type CampaignLeadDelivery = {
  schema_version: 1;
  idempotency_key: string;
  workspace_id: string;
  campaign_id: string;
  run_id: string;
  lead_id: string;
  lead: {
    data_origin?: "demo" | "live";
    entity_type?: LeadEntityType;
    company_name?: string;
    website?: string;
    category: string;
    location: string | null;
    company_size?: string | null;
    contact_role?: string | null;
    person_name?: string | null;
    person_role?: string | null;
    decision_maker?: DecisionMakerLead;
    email: string | null;
    phone: string | null;
    contact_points?: LeadContactPoint[];
    sales_metadata?: LeadSalesMetadata;
    observations?: LeadObservation[];
    is_provisional?: boolean;
    refresh_history?: Array<{
      refreshed_at: string;
      run_id: string;
      changes: Record<string, { from: unknown; to: unknown }>;
    }>;
    summary: string;
    fit_score: number;
    fit_reasons: string[];
    reject_reasons?: string[];
    explanation?: string | null;
    technical_error?: string | null;
    qualification_mode?: QualificationMode;
    criteria_version?: string;
    criterion_evaluations?: CriterionEvaluation[];
    dimensions?: {
      business_fit: BusinessFitAssessment;
      evidence_completeness: EvidenceCompletenessAssessment;
      contact_readiness: ContactReadinessAssessment;
      outreach_eligibility: OutreachEligibilityAssessment;
    };
    missing_evidence?: string[];
    evidence: LeadEvidence[];
    discovered_fields?: Record<string, string>;
    checked_at: string;
    outreach_eligible: false;
    provenance?: {
      source_type: "web_research" | "inbound_connector" | "manual" | "apify_actor";
      connector_id?: string;
      connector_name?: string;
      external_id?: string;
      raw_claims?: Record<string, unknown>;
      ingested_at: string;
    };
  };
};

export type LeadSchedule = {
  id: string;
  workspace_id: string;
  name: string;
  brief: LeadRunInput;
  timezone: string;
  cron_expression: string;
  next_run_at: string;
  enabled: boolean;
  overlap_policy: "skip" | "allow" | "queue";
  budget_limits?: Record<string, unknown>;
  destination_config?: Record<string, unknown>;
  last_occurrence_key?: string | null;
  last_run_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmMapping = {
  id: string;
  workspace_id: string;
  provider: "hubspot" | "salesforce" | "custom_webhook" | string;
  lead_id: string;
  external_object_id: string;
  external_object_type: string;
  last_synced_at: string;
  last_synced_payload?: Record<string, unknown>;
  field_ownership?: Record<string, string>;
  status: "synced" | "conflict" | "error";
};

export type CrmDeliveryJob = {
  id: string;
  workspace_id: string;
  lead_id: string;
  provider: string;
  status: "pending" | "running" | "completed" | "failed" | "uncertain";
  attempts: number;
  idempotency_key: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
};

/** Staff-facing shapes for lead-generation profile / runs (gateway responses). */
export type LeadGenerationResearchStatus =
  | "idle"
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | string;

export type LeadGenerationProfile = {
  id?: string;
  version?: number;
  research_status?: LeadGenerationResearchStatus;
  supplied?: BusinessInput;
  researched?: Record<string, unknown> | null;
  confirmed_facts?: LeadProfileApproval | null;
  inferences?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type ShortfallExpansionOption = {
  type: "expand_geography" | "expand_industries" | "switch_mode" | "relax_contact" | "increase_rounds";
  label: string;
  description: string;
  suggested_patch: Partial<LeadRunInput>;
};

export type ShortfallExplanation = {
  shortfall: number;
  target: number;
  found: number;
  causes: {
    research_failed?: number;
    category_mismatch: number;
    location_mismatch: number;
    contact_missing: number;
    fit_score_below_bar: number;
    domain_excluded: number;
    provider_limits_hit: boolean;
  };
  summary: string;
  expansion_options: ShortfallExpansionOption[];
};

export type LeadGenerationRunSummary = {
  source_runs?: Array<{ actor_id: string; status: string; external_run_id?: string | null; dataset_id?: string | null; error?: string | null }>;
  id: string;
  status: string;
  accepted?: number;
  errors?: number;
  rounds?: number;
  stop_reason?: string | null;
  brief?: LeadRunInput;
  shortfall_explanation?: ShortfallExplanation | null;
  deadline_at?: string;
  created_at?: string;
  [key: string]: unknown;
};

export type LeadGenerationRunCreateResponse = {
  run: LeadGenerationRunSummary;
  deduplicated?: boolean;
};

export type LeadGenerationCandidateResult = {
  id: string;
  status: string;
  assessment?: CampaignLeadDelivery["lead"] | null;
  [key: string]: unknown;
};

export type LeadGenerationDeliveryTask = {
  id: string;
  state: string;
  attempts?: number;
  error_code?: string | null;
  result?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type LeadGenerationCursorPage<T> = {
  items: T[];
  next_cursor: string | null;
};

/* Inbound Connectors & Collections Contracts */

export type InboundSourceType = "generic_json" | "apify" | "custom_scraper" | "automation_webhook";
export type InboundConnectorStatus = "active" | "paused" | "revoked";

export type InboundConnector = {
  id: string;
  workspace_id: string;
  name: string;
  source_type: InboundSourceType;
  description?: string;
  status: InboundConnectorStatus;
  token_prefix: string;
  token_hash?: string;
  collection_id?: string | null;
  default_qualification_mode: QualificationMode;
  field_mapping: Record<string, string>;
  enrichment_enabled: boolean;
  auto_enroll_campaign_id?: string | null;
  rate_limit_per_minute: number;
  batch_size_limit: number;
  payload_size_limit_bytes: number;
  created_at: string;
  last_used_at?: string | null;
  revoked_at?: string | null;
};

export type LeadCollection = {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  qualification_overrides?: {
    qualification_mode?: QualificationMode;
    required_contact?: ContactRequirement;
    min_fit_score?: number;
    target_roles?: string[];
    instructions?: string;
  };
  created_at: string;
};

export type InboundBatchRecordOutcome = {
  record_index: number;
  external_id?: string;
  lead_id?: string;
  outcome: "created" | "updated" | "failed";
  qualification_status: "qualified" | "best_match" | "disqualified";
  reasons: string[];
  error?: string;
};

export type InboundBatchEvent = {
  id: string;
  workspace_id: string;
  connector_id: string;
  collection_id?: string | null;
  idempotency_key: string;
  records_count: number;
  created_count: number;
  updated_count: number;
  failed_count: number;
  status: "completed" | "partial_failure" | "failed";
  errors?: Array<{ record_index: number; external_id?: string; error: string }>;
  outcomes?: InboundBatchRecordOutcome[];
  created_at: string;
};

/* Outreach and Campaign Boundary Contracts */

export type LeadEmailDraftRequest = {
  workspace_id: string;
  lead_id: string;
  recipient_email: string;
  lead_context: {
    company_name: string;
    website: string;
    person_name?: string | null;
    person_role?: string | null;
    summary: string;
    fit_reasons: string[];
    discovered_fields?: Record<string, string>;
  };
  business_context: {
    name: string;
    offering: string;
    selling_points: string[];
  };
  campaign_id?: string;
  template_id?: string;
};

export type LeadEmailSendRequest = {
  workspace_id: string;
  lead_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  consent_basis: "cold_b2b" | "opt_in" | "legitimate_interest";
  campaign_id?: string;
};

export type LeadEmailSendResult = {
  status: "sent" | "queued" | "failed" | "not_connected";
  provider: string;
  external_message_id?: string;
  error?: string;
  timestamp: string;
};

export type LeadAIPhoneCallRequest = {
  workspace_id: string;
  lead_id: string;
  to_phone: string;
  agent_id?: string;
  preferred_provider?: string;
  human_transfer_number?: string;
  context?: Record<string, unknown>;
};

export type LeadAIPhoneCallResult = {
  call_id: string;
  status: "initiated" | "failed" | "unconfigured";
  provider: string;
  human_transfer_configured: boolean;
  error?: string;
};

