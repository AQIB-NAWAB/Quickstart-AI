export type DateRangePreset = "7d" | "30d" | "90d" | "custom";

export interface DateRange {
  preset: DateRangePreset;
  from: string; // YYYY-MM-DD (UTC)
  to: string; // YYYY-MM-DD (UTC)
  timezone: "UTC";
}

export interface SummaryMetrics {
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  conversations: number | null;
  conversationsTrendPct?: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  estimatedSpendUsd: number | null;
  modelSpendUsd: number | null;
  voiceSpendUsd: number | null;
  voiceMinutes: number | null;
  voiceCalls: number | null;
  billableAcquisitionActions: number | null;
}

export interface DailyTokensPoint {
  date: string; // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

export interface ModelUsageItem {
  provider: string;
  model: string;
  tokens: number;
  percentage: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface DailyConversationPoint {
  date: string; // YYYY-MM-DD
  conversations: number;
}

export interface HourlyConversationPoint {
  hour: number; // 0..23
  conversations: number;
}

export interface DailyLatencyPoint {
  date: string; // YYYY-MM-DD
  p50Ms: number | null;
  p95Ms: number | null;
  sampleCount: number | null;
  concurrentTurns?: number;
}

export interface ServiceUsageItem {
  service: string;
  provider: string;
  kind: string;
  units: number;
  unitLabel: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number;
  isUnpriced: boolean;
}

export interface OperationalMetrics {
  toolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  toolSuccessRatePct: number | null;
  handoffs: number;
  evaluationRuns: number;
  evaluationPassRatePct: number | null;
}

export interface AcquisitionUsageItem {
  action: string;
  label: string;
  billableUnits: number;
}

export interface AnalyticsData {
  range: DateRange;
  summary: SummaryMetrics;
  dailyTokens: DailyTokensPoint[];
  models: ModelUsageItem[];
  dailyConversations: DailyConversationPoint[];
  hourlyConversations: HourlyConversationPoint[];
  dailyLatency: DailyLatencyPoint[];
  usageByService: ServiceUsageItem[];
  operationalMetrics?: OperationalMetrics;
  acquisitions: AcquisitionUsageItem[];
  voice: {
    minutes: number | null;
    calls: number | null;
  };
  latencyDefinition: string | null;
  coverage: Record<string, "complete" | "partial" | "unavailable">;
  coverageMessage?: string;
}

export type AnalyticsResult =
  | { status: "ready"; data: AnalyticsData }
  | { status: "unavailable"; message: string; description?: string }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string };

export interface AnalyticsDataSource {
  fetchAnalytics(range: DateRange, signal?: AbortSignal): Promise<AnalyticsResult>;
}
