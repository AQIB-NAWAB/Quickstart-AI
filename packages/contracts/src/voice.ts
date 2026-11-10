/** Voice platform contracts (Features 21–21C, 22). */

export const VOICE_MODES = ["cascade", "s2s"] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export const CALL_DIRECTIONS = ["inbound", "outbound"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_STATES = ["ringing", "live", "completed", "failed", "transferred"] as const;
export type CallState = (typeof CALL_STATES)[number];

export const TELEPHONY_PROVIDER_IDS = ["twilio", "telnyx", "sip", "byo_sip", "fake"] as const;
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
  /**
   * Present for bring-your-own-SIP numbers (`provider: "byo_sip"`). Never contains the
   * trunk password; that is returned exactly once when it is generated or rotated.
   */
  sip?: ByoSipSummary | null;
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

/** Provider id stored on numbers that arrive over a customer-managed SIP trunk. */
export const BYO_SIP_PROVIDER_ID = "byo_sip" as const;

export const SIP_TRANSPORTS = ["udp", "tcp", "tls"] as const;
export type SipTransport = (typeof SIP_TRANSPORTS)[number];

/** Where the SIP/media edge runs: LiveKit Cloud, a self-hosted livekit-sip, or nowhere yet. */
export const SIP_INBOUND_MODES = ["livekit_cloud", "self_hosted", "not_configured"] as const;
export type SipInboundMode = (typeof SIP_INBOUND_MODES)[number];

export type ByoSipSummary = {
  allowed_addresses: string[];
  auth_username: string | null;
  has_credentials: boolean;
};

/**
 * Register a number that is delivered by your own SIP server, PBX, or carrier trunk.
 * A trunk must be locked down by source address, SIP credentials, or both. An open
 * trunk would let anyone on the internet place calls into your workspace.
 */
export type ByoSipNumberInput = {
  e164: string;
  agent_id?: string | null;
  friendly_name?: string | null;
  /** Source IPs or CIDRs your SIP server sends from (IPv4 /16+ or IPv6 /48+). */
  allowed_addresses?: string[];
  /** SIP digest username. Generated when `generate_credentials` is true and this is empty. */
  auth_username?: string | null;
  generate_credentials?: boolean;
};

export type ByoSipAccessUpdate = {
  allowed_addresses?: string[];
};

/** What an operator types into their PBX or carrier portal to deliver calls to us. */
export type SipConnectionInfo = {
  host: string | null;
  port: number;
  tls_port: number | null;
  transports: SipTransport[];
  /** Example Request-URI / origination URI, e.g. `sip:+14155550123@sip.example.com:5060`. */
  sip_uri: string;
  /** Number formats the trunk accepts in the To / Request-URI user part. */
  accepted_number_formats: string[];
  allowed_addresses: string[];
  auth_username: string | null;
  /** Only present in the response that generated or rotated the password. */
  auth_password?: string;
  codecs: string[];
  dtmf: "rfc2833";
  rtp_port_range: string | null;
  /** Public IPs of the SIP edge, for carrier-side firewalls and ACLs. */
  server_ips: string[];
};

export type ByoSipNumberResult = {
  number: WorkspacePhoneNumber;
  connection: SipConnectionInfo;
};

export type SipSetupCheckStatus = "ok" | "warn" | "error";

export type SipSetupCheck = {
  id: string;
  label: string;
  status: SipSetupCheckStatus;
  detail: string;
};

/** Operator-facing readiness report for the inbound calling stack. */
export type InboundSetupInfo = {
  mode: SipInboundMode;
  /** True when a real LiveKit SIP edge is wired (not the local fake). */
  configured: boolean;
  /** Buying numbers from the platform carrier account is enabled. */
  purchase_available: boolean;
  /** Registering your own SIP trunk is enabled. */
  byo_sip_available: boolean;
  /** All blocking checks pass; inbound calls can be answered. */
  ready: boolean;
  connection: Omit<SipConnectionInfo, "sip_uri" | "accepted_number_formats" | "allowed_addresses" | "auth_username" | "auth_password">;
  webhooks: {
    livekit: string;
    telnyx: string;
  };
  checks: SipSetupCheck[];
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
