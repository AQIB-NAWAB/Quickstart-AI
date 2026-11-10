export type LeadEvidence = { field: string; value: string; source_url: string; quote: string };

export type {
  InboundConnector,
  LeadCollection,
  InboundBatchEvent,
  InboundBatchRecordOutcome,
  ShortfallExplanation,
  ShortfallExpansionOption,
  CriterionEvaluation,
  BusinessFitAssessment,
  EvidenceCompletenessAssessment,
  ContactReadinessAssessment,
  OutreachEligibilityAssessment,
  LeadPriorityCriterion,
  LeadProfileApproval,
  DecisionMakerLead,
  QualificationMode,
  ContactRequirement,
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
} from "@quickstart/contracts";

import type {
  QualificationMode,
  ContactRequirement,
  LeadPriorityCriterion,
  CriterionEvaluation,
  BusinessFitAssessment,
  EvidenceCompletenessAssessment,
  ContactReadinessAssessment,
  OutreachEligibilityAssessment,
  DecisionMakerLead,
  ShortfallExplanation,
  ShortfallExpansionOption,
  LeadEntityType,
  SalesStatus,
  SearchCriterion,
  LeadContactPoint,
  LeadObservation,
  LeadSchedule,
} from "@quickstart/contracts";

export type BusinessInput = {
  name: string;
  website?: string;
  description: string;
  offerings: string[];
  target_categories: string[];
  locations: string[];
  target_audience?: string;
  value_proposition?: string;
  products_or_services?: string[];
  selling_points?: string[];
  ideal_customer_profile?: string;
  preferred_roles?: string[];
  exclusions?: string[];
  target_countries?: string[];
  target_industries?: string[];
};

export type LeadRunInput = {
  source_policy?: { preferred_sources?: string[]; disallowed_sources?: string[]; allow_fallback?: boolean };
  entity_type?: LeadEntityType;
  categories: string[];
  location?: string;
  locations?: string[];
  countries?: string[];
  industries?: string[];
  priorities?: LeadPriorityCriterion[];
  criteria?: SearchCriterion[];
  confirmed_assumptions?: string[];
  ambiguity_clarifications?: Record<string, string>;
  company_size?: string;
  contact_role?: string;
  instructions?: string;
  excluded_domains: string[];
  required_contact: ContactRequirement;
  target_count: number;
  qualification_mode?: QualificationMode;
  collection_id?: string;
  campaign_id?: string;
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
  data: LeadAssessment;
  created_at: string;
  checked_at: string;
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

export type LeadGenerationProfile = {
  id?: string;
  version?: number;
  research_status?: string;
  supplied?: BusinessInput;
  researched?: Record<string, unknown> | null;
  [key: string]: unknown;
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
  qualification_mode?: QualificationMode;
  collection_id?: string | null;
  shortfall_explanation?: ShortfallExplanation | null;
  deadline_at?: string;
  created_at?: string;
  [key: string]: unknown;
};

export type LeadGenerationRunCreateResponse = {
  run: LeadGenerationRunSummary;
  deduplicated?: boolean;
};

export type LeadAssessment = {
  company_name: string;
  website: string;
  category: string;
  location: string | null;
  company_size?: string | null;
  contact_role?: string | null;
  person_name?: string | null;
  person_role?: string | null;
  decision_maker?: DecisionMakerLead;
  email: string | null;
  phone: string | null;
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
    business_fit?: BusinessFitAssessment;
    evidence_completeness?: EvidenceCompletenessAssessment;
    contact_readiness?: ContactReadinessAssessment;
    outreach_eligibility?: OutreachEligibilityAssessment;
  };
  missing_evidence?: string[];
  discovered_fields?: Record<string, string>;
  evidence?: LeadEvidence[];
  checked_at?: string;
  outreach_eligible?: boolean;
  provenance?: {
    source_type?: string;
    raw_claims?: Record<string, unknown>;
    ingested_at?: string;
  };
};

export type LeadGenerationCandidateResult = {
  id: string;
  status: string;
  assessment?: LeadAssessment | null;
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
