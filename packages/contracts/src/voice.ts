/** Voice platform contracts (Features 21–21C, 22). */

export const VOICE_MODES = ["cascade", "s2s"] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export const CALL_DIRECTIONS = ["inbound", "outbound"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_STATES = ["ringing", "live", "completed", "failed", "transferred"] as const;
export type CallState = (typeof CALL_STATES)[number];

export const TELEPHONY_PROVIDER_IDS = ["twilio", "telnyx", "sip", "fake"] as const;
export type TelephonyProviderId = (typeof TELEPHONY_PROVIDER_IDS)[number];

/** Default spoken path: STT → runtime → TTS. */
export const DEFAULT_VOICE_MODE: VoiceMode = "cascade";

/** Stricter than chat; human is waiting on the phone. */
export const DEFAULT_VOICE_DEADLINE_MS = 15_000;

export type AgentVoiceSettings = {
  voice_mode: VoiceMode;
  language: string;
  tts_voice_id: string;
  max_response_chars: number;
  turn_detection_profile_id: string;
  recording_enabled: boolean;
};

export const DEFAULT_AGENT_VOICE_SETTINGS: AgentVoiceSettings = {
  voice_mode: "cascade",
  language: "en-US",
  tts_voice_id: "default",
  max_response_chars: 500,
  turn_detection_profile_id: "default",
  recording_enabled: true,
};

/** Runtime turn from the voice edge (same idempotency rules as chat). */
export type VoiceTurnRequestBody = {
  channel: "voice";
  text: string;
  idempotency_key: string;
  call_id: string;
  deadline_ms?: number;
  voice_mode?: VoiceMode;
};

export type CallTranscriptSegment = {
  id: string;
  sequence: number;
  speaker: "user" | "agent";
  text: string;
  start_ms: number;
  end_ms: number;
  finalized: boolean;
};

export type CallStageTimings = {
  stt_ms: number;
  runtime_ms: number;
  tts_ms: number;
  total_ms: number;
};

export type CallRecord = {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  agent_id: string | null;
  agent_version_id: string | null;
  direction: CallDirection;
  state: CallState;
  voice_mode: VoiceMode;
  telephony_provider: TelephonyProviderId | string;
  caller: string | null;
  callee: string | null;
  failure_code: string | null;
  time_to_first_audio_ms: number | null;
  started_at: string;
  ended_at: string | null;
  recording_object_key: string | null;
  livekit_room_name?: string | null;
  livekit_participant_sid?: string | null;
  phone_number_id?: string | null;
  sip_call_id?: string | null;
};

export const PHONE_NUMBER_STATUSES = [
  "pending",
  "available",
  "provisioning",
  "active",
  "releasing",
  "released",
  "error",
] as const;
export type PhoneNumberStatus = (typeof PHONE_NUMBER_STATUSES)[number];

export const PHONE_NUMBER_TYPES = ["local", "national", "toll_free", "mobile"] as const;
export type PhoneNumberType = (typeof PHONE_NUMBER_TYPES)[number];

export type PhoneNumberCapabilities = {
  voice: boolean;
  sms: boolean;
};

/**
 * A number owned by the platform. `workspace_id` is null while the number sits in
 * the platform pool (purchased but not rented to a workspace yet).
 */
export type WorkspacePhoneNumber = {
  id: string;
  workspace_id: string | null;
  phone_number: string;
  friendly_name: string | null;
  provider: TelephonyProviderId | string;
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
  capabilities: PhoneNumberCapabilities;
  provisioning_error: string | null;
  purchased_at: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AvailablePhoneNumber = {
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
  /** Already purchased on the platform account (can be claimed without a new order). */
  owned?: boolean;
  number_id?: string | null;
};

export type PhoneNumberSearchFilters = {
  country_code?: string;
  area_code?: string;
  locality?: string;
  state?: string;
  number_type?: PhoneNumberType;
  limit?: number;
  /** Include numbers already sitting in the platform pool. */
  include_owned?: boolean;
};

export type PurchasePhoneNumberInput = {
  e164: string;
  agent_id?: string | null;
  friendly_name?: string | null;
  country_code?: string;
  number_type?: PhoneNumberType;
};

export type UpdatePhoneNumberInput = {
  assigned_agent_id?: string | null;
  friendly_name?: string | null;
};

export type PhoneNumberSearchResult = {
  configured: boolean;
  numbers: AvailablePhoneNumber[];
  pool: WorkspacePhoneNumber[];
};

export function isVoiceMode(value: unknown): value is VoiceMode {
  return typeof value === "string" && (VOICE_MODES as readonly string[]).includes(value);
}

export function isCallState(value: unknown): value is CallState {
  return typeof value === "string" && (CALL_STATES as readonly string[]).includes(value);
}

/**
 * Tools/RAG require a native realtime session with the shared runtime bridge.
 * Legacy batch S2S adapters must keep the restrictive default.
 */
export function s2sProfileAllowed(input: {
  voice_mode: VoiceMode;
  toolsCount: number;
  knowledgeEnabled: boolean;
  runtimeBridge?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.voice_mode !== "s2s" || input.runtimeBridge === true) {
    return { ok: true };
  }
  if (input.toolsCount > 0) {
    return { ok: false, reason: "voice_mode s2s cannot be combined with tools; use cascade" };
  }
  if (input.knowledgeEnabled) {
    return { ok: false, reason: "voice_mode s2s cannot be combined with RAG; use cascade" };
  }
  return { ok: true };
}
