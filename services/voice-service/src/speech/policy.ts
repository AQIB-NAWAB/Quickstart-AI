import { CircuitBreaker } from "@quickstart/utilities";
import { AppError, ErrorCode } from "@quickstart/errors";
import type {
  AudioChunk,
  SpeechToText,
  SpeechUsageEmitter,
  SynthesisResult,
  TextToSpeech,
  TranscriptResult,
} from "./types.js";

export type SpeechPolicyOptions = {
  failureThreshold?: number;
  cooldownMs?: number;
  emitUsage?: SpeechUsageEmitter;
  callId?: string;
  workspaceId?: string;
};

function isRetryable(err: unknown): boolean {
  if (err instanceof AppError) {
    return err.code === ErrorCode.UPSTREAM_TIMEOUT || err.code === ErrorCode.UPSTREAM_UNAVAILABLE;
  }
  if (err instanceof Error && err.message === "CIRCUIT_OPEN") {
    return false;
  }
  return true;
}

/**
 * One retry only when no billable output was committed; circuit breaker per provider id.
 */
export function withSpeechPolicy(
  stt: SpeechToText,
  tts: TextToSpeech,
  options: SpeechPolicyOptions = {},
): { stt: SpeechToText; tts: TextToSpeech } {
  const breaker = new CircuitBreaker({
    failureThreshold: options.failureThreshold ?? 5,
    cooldownMs: options.cooldownMs ?? 30_000,
  });
  const emit = options.emitUsage;

  const wrappedStt: SpeechToText = {
    id: stt.id,
    async transcribe(chunk: AudioChunk, signal?: AbortSignal): Promise<TranscriptResult> {
      let billableCommitted = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await breaker.execute(() => stt.transcribe(chunk, signal));
          billableCommitted = result.text.length > 0;
          emit?.({
            type: "speech.usage",
            provider: stt.id,
            unit: "stt",
            units: 1,
            call_id: options.callId,
            workspace_id: options.workspaceId,
          });
          return result;
        } catch (err) {
          if (err instanceof Error && err.message === "CIRCUIT_OPEN") {
            throw new AppError({
              code: ErrorCode.UPSTREAM_UNAVAILABLE,
              message: "Speech STT circuit open",
            });
          }
          if (signal?.aborted || billableCommitted || !isRetryable(err) || attempt === 2) {
            throw err;
          }
        }
      }
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: "Speech STT failed",
      });
    },
  };

  const wrappedTts: TextToSpeech = {
    id: tts.id,
    async synthesize(
      text: string,
      voiceId: string,
      signal?: AbortSignal,
    ): Promise<SynthesisResult> {
      let billableCommitted = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await breaker.execute(() => tts.synthesize(text, voiceId, signal));
          billableCommitted = result.audio.bytes.length > 0;
          emit?.({
            type: "speech.usage",
            provider: tts.id,
            unit: "tts",
            units: 1,
            call_id: options.callId,
            workspace_id: options.workspaceId,
          });
          return result;
        } catch (err) {
          if (err instanceof Error && err.message === "CIRCUIT_OPEN") {
            throw new AppError({
              code: ErrorCode.UPSTREAM_UNAVAILABLE,
              message: "Speech TTS circuit open",
            });
          }
          if (signal?.aborted || billableCommitted || !isRetryable(err) || attempt === 2) {
            throw err;
          }
        }
      }
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: "Speech TTS failed",
      });
    },
  };

  if (tts.streamSynthesize) {
    wrappedTts.streamSynthesize = async (text, voiceId, onAudio, signal) => {
      let committed = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        signal?.throwIfAborted();
        try {
          return await breaker.execute(() =>
            tts.streamSynthesize!(
              text,
              voiceId,
              (audio) => {
                signal?.throwIfAborted();
                if (!audio.bytes.length) return;
                if (!committed) {
                  committed = true;
                  emit?.({
                    type: "speech.usage",
                    provider: tts.id,
                    unit: "tts",
                    units: 1,
                    call_id: options.callId,
                    workspace_id: options.workspaceId,
                  });
                }
                onAudio(audio);
              },
              signal,
            ),
          );
        } catch (err) {
          if (signal?.aborted || committed || !isRetryable(err) || attempt === 2) throw err;
        }
      }
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: "Speech TTS stream failed",
      });
    };
  }

  return { stt: wrappedStt, tts: wrappedTts };
}
