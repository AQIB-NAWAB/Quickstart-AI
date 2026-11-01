export type InboundCallStatus = "live" | "completed" | "failed" | "transferred";

export interface InboundCall {
  id: string;
  workspaceId: string;
  caller: string; // phone number or display identity
  agentId: string;
  agentName: string;
  startedAt: string; // ISO UTC
  endedAt: string | null;
  durationSeconds: number; // total duration
  status: InboundCallStatus;
  timeToFirstAudioMs: number | null; // e.g. 910
  conversationId?: string | null;
  disconnectReason?: string | null;
  recordingAvailable?: boolean;
}

export interface TranscriptSegment {
  id: string;
  sequence: number;
  speaker: "user" | "agent";
  text: string;
  startMs: number; // offset from audio start
  endMs: number;
  occurredAt?: string;
  processingTurnId?: string;
}

export interface ProcessingTurn {
  id: string;
  turnNumber: number;
  sttMs: number;
  llmMs: number;
  ttsMs: number;
  totalMs: number;
  isAdditive: boolean;
}

export interface VoiceWaveform {
  callId: string;
  durationSeconds: number;
  peaks: number[];
  agentPeaks: number[];
  callerPeaks: number[];
  stereoAvailable: boolean;
}

export interface VoiceInboundSummary {
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  avgDurationSeconds: number;
  avgFirstAudioMs: number;
  activeCalls: number;
}

export interface SimulatedInboundCallResult {
  call_id: string;
  state: string;
  user_text: string;
  assistant_text: string;
  timings: { stt_ms: number; runtime_ms: number; tts_ms: number; total_ms: number };
}

export interface InboundCallDetail extends InboundCall {
  recordingAvailable: boolean;
  recordingDurationSeconds?: number;
  recordingUrl?: string | null;
  callerRecordingUrl?: string | null;
  callerRecordingAvailable?: boolean;
  recordingOffsetMs?: number;
  callerRecordingOffsetMs?: number;
  waveform?: VoiceWaveform | null;
  transcript: TranscriptSegment[];
  processingTurns: ProcessingTurn[];
  disposition: string;
}

export type RepositoryResult<T> =
  | { status: "ready"; data: T }
  | { status: "unavailable"; message: string }
  | { status: "forbidden"; message: string }
  | { status: "not_found"; message: string }
  | { status: "error"; message: string };

export type PhoneNumberStatus =
  | "pending"
  | "available"
  | "provisioning"
  | "active"
  | "releasing"
  | "released"
  | "error";

export type PhoneNumberType = "local" | "national" | "toll_free" | "mobile";

export interface WorkspacePhoneNumber {
  id: string;
  workspace_id: string | null;
  phone_number: string;
  friendly_name: string | null;
  provider: string;
  provider_number_id: string | null;
  provider_connection_id: string | null;
  assigned_agent_id: string | null;
  status: PhoneNumberStatus;
  inbound_status: PhoneNumberStatus;
  livekit_trunk_id: string | null;
  livekit_dispatch_rule_id: string | null;
  country_code: string | null;
  number_type: PhoneNumberType | null;
  region: string | null;
  locality: string | null;
  monthly_cost: number | null;
  currency: string | null;
  capabilities: { voice: boolean; sms: boolean };
  provisioning_error: string | null;
  purchased_at: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailablePhoneNumber {
  phone_number: string;
  country_code: string;
  number_type: PhoneNumberType;
  region?: string | null;
  locality?: string | null;
  area_code?: string | null;
  monthly_cost?: number | null;
  upfront_cost?: number | null;
  currency?: string | null;
  features?: string[];
  owned?: boolean;
  number_id?: string | null;
}

export interface PhoneNumberSearchFilters {
  country_code?: string;
  area_code?: string;
  locality?: string;
  state?: string;
  number_type?: PhoneNumberType;
  limit?: number;
}

export interface PhoneNumbersSnapshot {
  configured: boolean;
  numbers: WorkspacePhoneNumber[];
  pool: WorkspacePhoneNumber[];
}

export interface AvailablePhoneNumbersResult {
  configured: boolean;
  numbers: AvailablePhoneNumber[];
  pool: WorkspacePhoneNumber[];
}

export interface PurchasePhoneNumberInput {
  e164: string;
  agent_id?: string | null;
  friendly_name?: string | null;
  country_code?: string;
  number_type?: PhoneNumberType;
}

export interface UpdatePhoneNumberInput {
  assigned_agent_id?: string | null;
  friendly_name?: string | null;
}

export interface CallLogFilters {
  q?: string;
  status?: string;
  agent?: string;
  agentId?: string;
  range?: "7d" | "30d" | "custom";
  fromDate?: string;
  toDate?: string;
  cursor?: string;
}

export interface VoiceRepository {
  getInboundSummary(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<VoiceInboundSummary>>;

  listInboundCalls(
    workspaceId: string,
    filters?: CallLogFilters,
    signal?: AbortSignal,
  ): Promise<
    RepositoryResult<{
      calls: InboundCall[];
      total?: number;
      nextCursor?: string;
      prevCursor?: string;
    }>
  >;

  listLiveInboundCalls(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<InboundCall[]>>;

  stopLiveInboundCall(
    workspaceId: string,
    callId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<{ stopped: boolean }>>;

  simulateInboundCall(
    workspaceId: string,
    input: { agent_id: string; utterance_text: string; caller?: string },
    signal?: AbortSignal,
  ): Promise<RepositoryResult<{ result: SimulatedInboundCallResult }>>;

  getInboundCall(
    workspaceId: string,
    callId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<InboundCallDetail>>;

  getWaveform(
    workspaceId: string,
    callId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<VoiceWaveform>>;

  getTranscript(
    workspaceId: string,
    callId: string,
    signal?: AbortSignal,
  ): Promise<
    RepositoryResult<{
      segments: TranscriptSegment[];
      processingTurns?: ProcessingTurn[];
    }>
  >;

  listPhoneNumbers(
    workspaceId: string,
    options?: { sync?: boolean },
    signal?: AbortSignal,
  ): Promise<RepositoryResult<PhoneNumbersSnapshot>>;

  searchAvailablePhoneNumbers(
    workspaceId: string,
    filters?: PhoneNumberSearchFilters,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<AvailablePhoneNumbersResult>>;

  purchasePhoneNumber(
    workspaceId: string,
    input: PurchasePhoneNumberInput,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<WorkspacePhoneNumber>>;

  updatePhoneNumber(
    workspaceId: string,
    numberId: string,
    input: UpdatePhoneNumberInput,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<WorkspacePhoneNumber>>;

  releasePhoneNumber(
    workspaceId: string,
    numberId: string,
    mode: "pool" | "provider",
    signal?: AbortSignal,
  ): Promise<RepositoryResult<WorkspacePhoneNumber>>;
}
