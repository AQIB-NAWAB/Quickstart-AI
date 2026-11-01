export type KnowledgeSearchMethod = "semantic" | "keyword" | "hybrid";
export type DependencyFailurePolicy = "open" | "closed";

export type AgentKnowledgeSettings = {
  enabled: boolean;
  source_ids: string[];
  search_method: KnowledgeSearchMethod;
  max_results: number;
  failure_policy: DependencyFailurePolicy;
};

export type AgentMemorySettings = {
  enabled: boolean;
  subject_key_template: string;
  max_facts: number;
  failure_policy: DependencyFailurePolicy;
  allow_runtime_writes: boolean;
};

export type AgentGuardrailSettings = {
  enabled: boolean;
  block_prompt_injection: boolean;
  redact_pii: boolean;
  blocked_topics: string[];
  allowed_topics: string[];
  violation_action: "refuse" | "handoff" | "sanitize";
  custom_instructions: string;
};

export type AgentReleaseSettings = {
  require_approval: boolean;
  required_checklist: string[];
  auto_rollback_error_rate_pct: number | null;
};

export type AgentObservabilitySettings = {
  trace_retention_days: number;
  capture_inputs: boolean;
  capture_outputs: boolean;
};

export type AgentConfiguration = {
  knowledge: AgentKnowledgeSettings;
  memory: AgentMemorySettings;
  guardrails: AgentGuardrailSettings;
  release: AgentReleaseSettings;
  observability: AgentObservabilitySettings;
};

export const DEFAULT_AGENT_CONFIGURATION: AgentConfiguration = {
  knowledge: {
    enabled: false,
    source_ids: [],
    search_method: "hybrid",
    max_results: 5,
    failure_policy: "closed",
  },
  memory: {
    enabled: false,
    subject_key_template: "anon:{visitor_id}",
    max_facts: 20,
    failure_policy: "open",
    allow_runtime_writes: false,
  },
  guardrails: {
    enabled: true,
    block_prompt_injection: true,
    redact_pii: true,
    blocked_topics: [],
    allowed_topics: [],
    violation_action: "refuse",
    custom_instructions: "",
  },
  release: {
    require_approval: false,
    required_checklist: [],
    auto_rollback_error_rate_pct: null,
  },
  observability: {
    trace_retention_days: 1,
    capture_inputs: true,
    capture_outputs: true,
  },
};

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function normalizeAgentConfiguration(value: unknown): AgentConfiguration {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const knowledge =
    input.knowledge && typeof input.knowledge === "object"
      ? (input.knowledge as Record<string, unknown>)
      : {};
  const memory =
    input.memory && typeof input.memory === "object"
      ? (input.memory as Record<string, unknown>)
      : {};
  const guardrails =
    input.guardrails && typeof input.guardrails === "object"
      ? (input.guardrails as Record<string, unknown>)
      : {};
  const release =
    input.release && typeof input.release === "object"
      ? (input.release as Record<string, unknown>)
      : {};
  const observability =
    input.observability && typeof input.observability === "object"
      ? (input.observability as Record<string, unknown>)
      : {};
  const method = knowledge.search_method;
  const failurePolicy = (v: unknown, fallback: DependencyFailurePolicy) =>
    v === "open" || v === "closed" ? v : fallback;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((item): item is string => typeof item === "string").slice(0, 100)
      : [];

  return {
    knowledge: {
      ...DEFAULT_AGENT_CONFIGURATION.knowledge,
      enabled: knowledge.enabled === true,
      source_ids: list(knowledge.source_ids),
      search_method:
        method === "semantic" || method === "keyword" || method === "hybrid" ? method : "hybrid",
      max_results: boundedInteger(knowledge.max_results, 5, 1, 20),
      failure_policy: failurePolicy(knowledge.failure_policy, "closed"),
    },
    memory: {
      ...DEFAULT_AGENT_CONFIGURATION.memory,
      enabled: memory.enabled === true,
      subject_key_template:
        typeof memory.subject_key_template === "string" && memory.subject_key_template.trim()
          ? memory.subject_key_template.trim().slice(0, 200)
          : DEFAULT_AGENT_CONFIGURATION.memory.subject_key_template,
      max_facts: boundedInteger(memory.max_facts, 20, 1, 50),
      failure_policy: failurePolicy(memory.failure_policy, "open"),
      allow_runtime_writes: memory.allow_runtime_writes === true,
    },
    guardrails: {
      ...DEFAULT_AGENT_CONFIGURATION.guardrails,
      enabled: guardrails.enabled !== false,
      block_prompt_injection: guardrails.block_prompt_injection !== false,
      redact_pii: guardrails.redact_pii !== false,
      blocked_topics: list(guardrails.blocked_topics),
      allowed_topics: list(guardrails.allowed_topics),
      violation_action:
        guardrails.violation_action === "handoff" || guardrails.violation_action === "sanitize"
          ? guardrails.violation_action
          : "refuse",
      custom_instructions:
        typeof guardrails.custom_instructions === "string"
          ? guardrails.custom_instructions.slice(0, 4000)
          : "",
    },
    release: {
      ...DEFAULT_AGENT_CONFIGURATION.release,
      require_approval: release.require_approval === true,
      required_checklist: list(release.required_checklist)
        .map((item) => item.trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 20),
      auto_rollback_error_rate_pct:
        release.auto_rollback_error_rate_pct === null ||
        release.auto_rollback_error_rate_pct === undefined
          ? null
          : boundedInteger(release.auto_rollback_error_rate_pct, 25, 1, 100),
    },
    observability: {
      ...DEFAULT_AGENT_CONFIGURATION.observability,
      trace_retention_days: boundedInteger(observability.trace_retention_days, 1, 1, 30),
      capture_inputs: observability.capture_inputs !== false,
      capture_outputs: observability.capture_outputs !== false,
    },
  };
}

export function validateAgentConfiguration(value: unknown): AgentConfiguration {
  const normalized = normalizeAgentConfiguration(value);
  if (normalized.knowledge.enabled && normalized.knowledge.source_ids.length === 0) {
    throw new Error("Knowledge is enabled but no knowledge sources are selected");
  }
  if (normalized.memory.enabled && !normalized.memory.subject_key_template.includes("{")) {
    throw new Error("Memory subject key must include a runtime variable, such as {visitor_id}");
  }
  if (normalized.release.required_checklist.some((item) => item.length === 0)) {
    throw new Error("Release checklist items cannot be empty");
  }
  return normalized;
}
