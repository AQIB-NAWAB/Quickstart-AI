import type { SpeechProfile } from "../speech/factory.js";
import { resolveTelephonyProfile, type TelephonyProfile } from "../telephony/factory.js";

export type VoiceConfig = {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtAccessSecret: string;
  workspaceUrl: string;
  runtimeUrl: string;
  conversationUrl: string;
  agentUrl: string;
  knowledgeUrl: string;
  httpRequestTimeoutMs: number;
  membershipCacheTtlSec: number;
  membershipCacheNegativeTtlSec: number;
  internalToken: string;
  globalInboundCap: number;
  globalOutboundCap: number;
  defaultWorkspaceInboundCap: number;
  defaultWorkspaceOutboundCap: number;
  defaultVoiceDeadlineMs: number;
  spokenFallbackPhrase: string;
  recordingDir: string;
  recordingStore: "local" | "s3";
  recordingS3Endpoint?: string;
  recordingS3Bucket?: string;
  recordingS3Region: string;
  recordingS3AccessKeyId?: string;
  recordingS3SecretAccessKey?: string;
  sipBridgeSharedSecret: string;
  draining: boolean;
  speechProfile: SpeechProfile;
  speechOpenaiApiKey?: string;
  speechOpenaiBaseUrl?: string;
  speechOpenaiSttModel?: string;
  speechOpenaiTtsModel?: string;
  deepgramApiKey?: string;
  deepgramModel?: string;
  deepgramLanguage: string;
  deepgramEndpointingMs: number;
  speechTailMs: number;
  fishAudioApiKey?: string;
  fishAudioModel?: string;
  fishAudioReferenceId?: string;
  fishAudioAgentId?: string;
  fishCallsWorkspaceId?: string;
  fishCallsQuickstartAgentId?: string;
  upliftApiKey?: string;
  cartesiaApiKey?: string;
  cartesiaModel?: string;
  elevenLabsApiKey?: string;
  elevenLabsModel?: string;
  elevenLabsVoiceId?: string;
  elevenLabsRealtimeModel?: string;
  geminiApiKey?: string;
  geminiLiveModel?: string;
  openaiRealtimeModel?: string;
  openaiRealtimeTranscriptionModel: string;
  openaiRealtimeVoice: string;
  openaiRealtimeTranscriptionDelay: "minimal" | "low" | "medium" | "high" | "xhigh";
  /** auto = prefer cascade when configured, otherwise Gemini/OpenAI/ElevenLabs. */
  s2sProvider: "auto" | "gemini" | "openai" | "elevenlabs" | "none";
  requireRealSpeech: boolean;
  speechCircuitFailureThreshold: number;
  speechCircuitCooldownMs: number;
  speechHttpTimeoutMs: number;
  telephonyProfile: TelephonyProfile;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  telnyxApiKey?: string;
  telnyxPublicKey?: string;
  telnyxSipConnectionId?: string;
  telnyxSipConnectionName: string;
  telnyxWebhookToleranceSec: number;
  livekitUrl?: string;
  livekitApiKey?: string;
  livekitApiSecret?: string;
  livekitSipEndpoint?: string;
  livekitBridgeEnabled: boolean;
  voicePublicBaseUrl: string;
  requireRealTelephony: boolean;
  /** Fire-and-forget ledger ingest (Feature 26). */
  usageUrl: string;
  usageInternalToken: string;
};

function parseSpeechProfile(raw: string | undefined): SpeechProfile {
  const value = (raw ?? "fake").trim().toLowerCase();
  if (value === "openai") return "openai";
  if (value === "deepgram-fish" || value === "deepgram_fish") return "deepgram-fish";
  if (value === "fake" || value === "") return "fake";
  throw new Error(`SPEECH_PROFILE must be fake|openai|deepgram-fish, got: ${raw}`);
}

function parseS2sProvider(
  raw: string | undefined,
): "auto" | "gemini" | "openai" | "elevenlabs" | "none" {
  const value = (raw ?? "auto").trim().toLowerCase();
  if (
    value === "auto" ||
    value === "gemini" ||
    value === "openai" ||
    value === "elevenlabs" ||
    value === "none"
  ) {
    return value;
  }
  return "auto";
}

export function loadVoiceConfig(): VoiceConfig {
  const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;
  if (!jwtAccessSecret || jwtAccessSecret.length < 32) {
    throw new Error("JWT_ACCESS_SECRET must be set and at least 32 characters");
  }

  const internalToken = process.env.VOICE_INTERNAL_TOKEN ?? process.env.INTERNAL_TOKEN;
  if (!internalToken || internalToken.length < 32) {
    throw new Error("VOICE_INTERNAL_TOKEN must be set and at least 32 characters");
  }

  const speechOpenaiApiKey =
    process.env.SPEECH_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined;

  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID?.trim() || undefined;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN?.trim() || undefined;
  const telnyxApiKey = process.env.TELNYX_API_KEY?.trim() || undefined;
  const telnyxPublicKey = process.env.TELNYX_PUBLIC_KEY?.trim() || undefined;
  const livekitUrl = process.env.LIVEKIT_URL?.trim() || undefined;
  const livekitApiKey = process.env.LIVEKIT_API_KEY?.trim() || undefined;
  const livekitApiSecret = process.env.LIVEKIT_API_SECRET?.trim() || undefined;
  const livekitSipEndpoint = process.env.LIVEKIT_SIP_ENDPOINT?.trim() || undefined;
  const livekitConfigured = Boolean(
    livekitUrl && livekitApiKey && livekitApiSecret && livekitSipEndpoint,
  );
  const voicePublicBaseUrl = (
    process.env.VOICE_PUBLIC_BASE_URL ??
    process.env.VOICE_URL ??
    "http://127.0.0.1:3008"
  ).replace(/\/$/, "");

  return {
    port: Number(process.env.PORT ?? process.env.VOICE_PORT ?? 3008),
    databaseUrl:
      process.env.DATABASE_URL ?? "postgresql://quickstart:quickstart@127.0.0.1:5433/quickstart",
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    jwtAccessSecret,
    workspaceUrl: (process.env.WORKSPACE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, ""),
    runtimeUrl: (process.env.RUNTIME_URL ?? "http://127.0.0.1:3006").replace(/\/$/, ""),
    conversationUrl: (process.env.CONVERSATION_URL ?? "http://127.0.0.1:3004").replace(/\/$/, ""),
    agentUrl: (process.env.AGENT_URL ?? "http://127.0.0.1:3003").replace(/\/$/, ""),
    knowledgeUrl: (process.env.KNOWLEDGE_URL ?? "http://127.0.0.1:3009").replace(/\/$/, ""),
    httpRequestTimeoutMs: Number(process.env.HTTP_REQUEST_TIMEOUT_MS ?? 30_000),
    membershipCacheTtlSec: Number(process.env.MEMBERSHIP_CACHE_TTL_SEC ?? 60),
    membershipCacheNegativeTtlSec: Number(process.env.MEMBERSHIP_CACHE_NEGATIVE_TTL_SEC ?? 30),
    internalToken,
    globalInboundCap: Number(process.env.VOICE_GLOBAL_INBOUND_CAP ?? 5000),
    globalOutboundCap: Number(process.env.VOICE_GLOBAL_OUTBOUND_CAP ?? 5000),
    defaultWorkspaceInboundCap: Number(process.env.VOICE_WORKSPACE_INBOUND_CAP ?? 100),
    defaultWorkspaceOutboundCap: Number(process.env.VOICE_WORKSPACE_OUTBOUND_CAP ?? 100),
    defaultVoiceDeadlineMs: Number(process.env.VOICE_DEADLINE_MS ?? 15_000),
    spokenFallbackPhrase:
      process.env.VOICE_SPOKEN_FALLBACK ?? "Sorry, I am having trouble right now. Please try again.",
    recordingDir: process.env.VOICE_RECORDING_DIR ?? "/tmp/quickstart-voice-recordings",
    recordingStore: process.env.VOICE_RECORDING_STORE?.trim().toLowerCase() === "s3" ? "s3" : "local",
    recordingS3Endpoint: process.env.VOICE_RECORDING_S3_ENDPOINT?.trim() || undefined,
    recordingS3Bucket: process.env.VOICE_RECORDING_S3_BUCKET?.trim() || undefined,
    recordingS3Region: process.env.VOICE_RECORDING_S3_REGION?.trim() || "auto",
    recordingS3AccessKeyId: process.env.VOICE_RECORDING_S3_ACCESS_KEY_ID?.trim() || undefined,
    recordingS3SecretAccessKey: process.env.VOICE_RECORDING_S3_SECRET_ACCESS_KEY?.trim() || undefined,
    sipBridgeSharedSecret:
      process.env.VOICE_SIP_BRIDGE_SECRET ?? internalToken.slice(0, 32).padEnd(32, "0"),
    draining: process.env.VOICE_DRAINING === "1",
    speechProfile: parseSpeechProfile(process.env.SPEECH_PROFILE),
    speechOpenaiApiKey,
    speechOpenaiBaseUrl: process.env.SPEECH_OPENAI_BASE_URL?.replace(/\/$/, "") || undefined,
    speechOpenaiSttModel: process.env.SPEECH_OPENAI_STT_MODEL?.trim() || undefined,
    speechOpenaiTtsModel: process.env.SPEECH_OPENAI_TTS_MODEL?.trim() || undefined,
    deepgramApiKey: process.env.DEEPGRAM_API_KEY?.trim() || undefined,
    deepgramModel: process.env.DEEPGRAM_MODEL?.trim() || undefined,
    deepgramLanguage: process.env.DEEPGRAM_LANGUAGE?.trim() || "multi",
    deepgramEndpointingMs: Math.max(
      10,
      Number(process.env.DEEPGRAM_ENDPOINTING_MS ?? 100) || 100,
    ),
    speechTailMs: Math.max(0, Number(process.env.VOICE_SPEECH_TAIL_MS ?? 180) || 180),
    fishAudioApiKey: process.env.FISH_AUDIO_API_KEY?.trim() || undefined,
    fishAudioModel: process.env.FISH_AUDIO_MODEL?.trim() || undefined,
    fishAudioReferenceId: process.env.FISH_AUDIO_REFERENCE_ID?.trim() || undefined,
    fishAudioAgentId: process.env.FISH_AUDIO_AGENT_ID?.trim() || undefined,
    fishCallsWorkspaceId: process.env.QUICKSTART_CUSTOM_LLM_WORKSPACE_ID?.trim() || undefined,
    fishCallsQuickstartAgentId: process.env.QUICKSTART_CUSTOM_LLM_AGENT_ID?.trim() || undefined,
    upliftApiKey: process.env.UPLIFT_AI_API_KEY?.trim() || process.env.UPLIFTAI_API_KEY?.trim() || undefined,
    cartesiaApiKey: process.env.CARTESIA_API_KEY?.trim() || undefined,
    cartesiaModel: process.env.CARTESIA_MODEL?.trim() || undefined,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY?.trim() || undefined,
    elevenLabsModel: process.env.ELEVENLABS_MODEL?.trim() || undefined,
    elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || undefined,
    elevenLabsRealtimeModel:
      process.env.ELEVENLABS_REALTIME_MODEL?.trim() || "eleven_realtime_v1_mini",
    geminiApiKey:
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      undefined,
    geminiLiveModel: process.env.GEMINI_LIVE_MODEL?.trim() || undefined,
    openaiRealtimeModel: process.env.OPENAI_REALTIME_MODEL?.trim() || undefined,
    openaiRealtimeTranscriptionModel:
      process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() || "gpt-live-transcribe",
    openaiRealtimeVoice: process.env.OPENAI_REALTIME_VOICE?.trim() || "marin",
    openaiRealtimeTranscriptionDelay: (() => {
      const value = process.env.OPENAI_REALTIME_TRANSCRIPTION_DELAY?.trim().toLowerCase();
      return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
        ? value
        : "minimal";
    })(),
    s2sProvider: parseS2sProvider(process.env.VOICE_S2S_PROVIDER),
    requireRealSpeech: process.env.VOICE_REQUIRE_REAL_SPEECH === "1",
    speechCircuitFailureThreshold: Number(process.env.SPEECH_CIRCUIT_FAILURE_THRESHOLD ?? 5),
    speechCircuitCooldownMs: Number(process.env.SPEECH_CIRCUIT_COOLDOWN_MS ?? 30_000),
    speechHttpTimeoutMs: Number(
      process.env.SPEECH_HTTP_TIMEOUT_MS ?? process.env.HTTP_REQUEST_TIMEOUT_MS ?? 30_000,
    ),
    telephonyProfile: resolveTelephonyProfile(
      process.env.TELEPHONY_PROFILE,
      Boolean(twilioAccountSid && twilioAuthToken),
      Boolean(telnyxApiKey && telnyxPublicKey && livekitConfigured),
    ),
    twilioAccountSid,
    twilioAuthToken,
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER?.trim() || undefined,
    telnyxApiKey,
    telnyxPublicKey,
    telnyxSipConnectionId: process.env.TELNYX_SIP_CONNECTION_ID?.trim() || undefined,
    telnyxSipConnectionName:
      process.env.TELNYX_SIP_CONNECTION_NAME?.trim() || "QuickStart Inbound",
    telnyxWebhookToleranceSec: Number(process.env.TELNYX_WEBHOOK_TOLERANCE_SEC ?? 300),
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
    livekitSipEndpoint,
    livekitBridgeEnabled:
      process.env.LIVEKIT_BRIDGE_ENABLED === "0" ? false : livekitConfigured,
    voicePublicBaseUrl,
    requireRealTelephony: process.env.TELEPHONY_REQUIRE_REAL === "1",
    usageUrl: (process.env.USAGE_URL ?? process.env.USAGE_SERVICE_URL ?? "http://127.0.0.1:3017").replace(
      /\/$/,
      "",
    ),
    usageInternalToken:
      process.env.USAGE_INTERNAL_TOKEN ?? process.env.INTERNAL_TOKEN ?? internalToken,
  };
}
