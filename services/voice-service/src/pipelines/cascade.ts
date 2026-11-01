import type { AgentVoiceSettings, CallStageTimings } from "@quickstart/contracts";
import type { RuntimeClient } from "../clients/runtime.client.js";
import type { UsageIngestClient } from "../clients/usage.client.js";
import type { AudioChunk, SpeechToText, TextToSpeech } from "../speech/types.js";

export type CascadeTurnInput = {
  workspaceId: string;
  conversationId: string;
  callId: string;
  audio: AudioChunk;
  voice: AgentVoiceSettings;
  authHeaders: Record<string, string>;
  requestId: string;
  deadlineMs: number;
  spokenFallback: string;
  abortSignal?: AbortSignal;
};

export type CascadeTurnResult = {
  userText: string;
  assistantText: string;
  ttsAudio: AudioChunk;
  timings: CallStageTimings;
  agentId: string;
  agentVersionId: string;
  bargedIn: boolean;
};

export class CascadePipeline {
  private speechSeq = 0;

  constructor(
    private readonly stt: SpeechToText,
    private readonly tts: TextToSpeech,
    private readonly runtime: RuntimeClient,
    private readonly usageIngest?: UsageIngestClient,
  ) {}

  private emitSpeech(
    input: CascadeTurnInput,
    unit: "stt" | "tts",
    provider: string,
    units: number,
  ): void {
    if (!this.usageIngest) return;
    const seq = ++this.speechSeq;
    const source = input.callId || input.requestId;
    this.usageIngest.emit({
      workspace_id: input.workspaceId,
      kind: "voice",
      units,
      unit_label: unit,
      provider,
      idempotency_key: `speech:${input.workspaceId}:${source}:${unit}:${seq}`,
      request_id: input.requestId,
      source_id: input.callId,
      detail: { unit, call_id: input.callId },
    });
  }

  async runUtterance(input: CascadeTurnInput): Promise<CascadeTurnResult> {
    let bargedIn = false;
    if (input.abortSignal?.aborted) {
      bargedIn = true;
    }

    // Keep simulated and real media on the same STT path. Apart from making
    // preview behavior representative, this ensures cancellation and timing
    // semantics are exercised identically in tests and production.
    const sttResult = await this.stt.transcribe(input.audio, input.abortSignal);
    this.emitSpeech(input, "stt", sttResult.provider, 1);
    let assistantText = input.spokenFallback;
    let agentId = "";
    let agentVersionId = "";
    let runtimeMs = 0;

    try {
      const turn = await this.runtime.executeVoiceTurn({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        text: sttResult.text,
        callId: input.callId,
        idempotencyKey: `${input.callId}:${Date.now()}`,
        authHeaders: input.authHeaders,
        deadlineMs: input.deadlineMs,
        requestId: input.requestId,
      });
      assistantText = turn.assistant_text.slice(0, input.voice.max_response_chars);
      agentId = turn.agent_id;
      agentVersionId = turn.agent_version_id;
      runtimeMs = turn.latency_ms;
    } catch (err) {
      // Spoken fallback is for live UX only after a successful STT path is productized.
      // Do not mark simulate/Done-when success when the runtime hop failed.
      void input.spokenFallback;
      throw err;
    }

    if (input.abortSignal?.aborted) {
      bargedIn = true;
      return {
        userText: sttResult.text,
        assistantText: "",
        ttsAudio: { bytes: Buffer.alloc(0), encoding: "fake", sampleRateHz: 8000 },
        timings: {
          stt_ms: sttResult.latencyMs,
          runtime_ms: runtimeMs,
          tts_ms: 0,
          total_ms: sttResult.latencyMs + runtimeMs,
        },
        agentId,
        agentVersionId,
        bargedIn,
      };
    }

    try {
      const ttsResult = await this.tts.synthesize(
        assistantText,
        input.voice.tts_voice_id,
        input.abortSignal,
      );
      this.emitSpeech(input, "tts", ttsResult.provider, 1);

      return {
        userText: sttResult.text,
        assistantText,
        ttsAudio: ttsResult.audio,
        timings: {
          stt_ms: sttResult.latencyMs,
          runtime_ms: runtimeMs,
          tts_ms: ttsResult.latencyMs,
          total_ms: sttResult.latencyMs + runtimeMs + ttsResult.latencyMs,
        },
        agentId,
        agentVersionId,
        bargedIn,
      };
    } catch (err) {
      if (input.abortSignal?.aborted) {
        return {
          userText: sttResult.text,
          assistantText: "",
          ttsAudio: { bytes: Buffer.alloc(0), encoding: "fake", sampleRateHz: 8000 },
          timings: {
            stt_ms: sttResult.latencyMs,
            runtime_ms: runtimeMs,
            tts_ms: 0,
            total_ms: sttResult.latencyMs + runtimeMs,
          },
          agentId,
          agentVersionId,
          bargedIn: true,
        };
      }
      throw err;
    }
  }
}
