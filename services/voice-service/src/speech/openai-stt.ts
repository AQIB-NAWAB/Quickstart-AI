import { AppError, ErrorCode } from "@quickstart/errors";
import type { AudioChunk, SpeechToText, TranscriptResult } from "./types.js";

export type OpenAiSttOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  /** Injectable for fixture tests — never log this fetch's Authorization. */
  fetchImpl?: typeof fetch;
};

function filenameFor(chunk: AudioChunk): { name: string; mime: string } {
  switch (chunk.encoding) {
    case "mp3":
      return { name: "audio.mp3", mime: "audio/mpeg" };
    case "mulaw":
      return { name: "audio.wav", mime: "audio/wav" };
    case "pcm16":
      return { name: "audio.wav", mime: "audio/wav" };
    case "fake":
    default:
      // Fixture / local path: send as plain text file; Whisper accepts uploads.
      return { name: "audio.txt", mime: "text/plain" };
  }
}

export class OpenAiSpeechToText implements SpeechToText {
  readonly id = "openai-stt";

  constructor(private readonly options: OpenAiSttOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAiSpeechToText requires apiKey");
    }
  }

  async transcribe(chunk: AudioChunk, signal?: AbortSignal): Promise<TranscriptResult> {
    const started = Date.now();
    const baseUrl = (this.options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const model = this.options.model ?? "gpt-transcribe";
    const { name, mime } = filenameFor(chunk);
    const form = new FormData();
    form.append("model", model);
    const blob = new Blob([Uint8Array.from(chunk.bytes)], { type: mime });
    form.append("file", blob, name);

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 30_000,
    );
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const res = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const retryable = res.status === 429 || res.status >= 500;
        throw new AppError({
          code: retryable ? ErrorCode.UPSTREAM_UNAVAILABLE : ErrorCode.VALIDATION_FAILED,
          message: `OpenAI STT failed (${res.status}): ${body.slice(0, 160)}`,
        });
      }
      const json = (await res.json()) as { text?: string };
      const text = (json.text ?? "").trim();
      if (!text) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "OpenAI STT returned empty transcript",
        });
      }
      return {
        text,
        latencyMs: Math.max(1, Date.now() - started),
        provider: this.id,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new AppError({
          code: ErrorCode.UPSTREAM_TIMEOUT,
          message: "OpenAI STT timed out",
        });
      }
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: err instanceof Error ? err.message : "OpenAI STT failed",
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
