import { AppError, ErrorCode } from "@quickstart/errors";
import type { AudioChunk, SynthesisResult, TextToSpeech } from "./types.js";

export type CartesiaTtsOptions = {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class CartesiaTextToSpeech implements TextToSpeech {
  readonly id = "cartesia-tts";

  constructor(private readonly options: CartesiaTtsOptions) {
    if (!options.apiKey) throw new Error("CartesiaTextToSpeech requires apiKey");
  }

  async synthesize(
    text: string,
    voiceId: string,
    signal?: AbortSignal,
    language = "en",
  ): Promise<SynthesisResult> {
    const started = Date.now();
    const input = text.trim();
    if (!input) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Cartesia TTS requires non-empty text",
      });
    }
    const voice = voiceId.trim();
    if (!voice) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Cartesia TTS requires a voice id",
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const res = await fetchImpl("https://api.cartesia.ai/tts/bytes", {
        method: "POST",
        headers: {
          "X-API-Key": this.options.apiKey,
          "Cartesia-Version": "2024-06-10",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_id: this.options.model ?? "sonic-3.6",
          transcript: input.slice(0, 2000),
          voice: { mode: "id", id: voice },
          output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
          language: language.slice(0, 2) || "en",
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        const retryable = res.status === 429 || res.status >= 500;
        throw new AppError({
          code: retryable ? ErrorCode.UPSTREAM_UNAVAILABLE : ErrorCode.VALIDATION_FAILED,
          message: `Cartesia TTS failed (${res.status}): ${errBody.slice(0, 160)}`,
        });
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Cartesia TTS returned empty audio",
        });
      }
      const audio: AudioChunk = {
        bytes,
        encoding: "mp3",
        sampleRateHz: 44_100,
        mimeType: "audio/mpeg",
      };
      return { audio, latencyMs: Math.max(1, Date.now() - started), provider: this.id };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new AppError({ code: ErrorCode.UPSTREAM_TIMEOUT, message: "Cartesia TTS timed out" });
      }
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: err instanceof Error ? err.message : "Cartesia TTS failed",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async streamSynthesize(
    text: string,
    voiceId: string,
    onAudio: (audio: AudioChunk) => void,
    signal?: AbortSignal,
    language = "en",
  ): Promise<{ firstChunkLatencyMs: number; latencyMs: number }> {
    const started = Date.now();
    const transcript = text.trim();
    const voice = voiceId.trim();
    if (!transcript || !voice) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Cartesia TTS requires non-empty text and voice id",
      });
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);
    let firstChunkLatencyMs = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let pending = "";
    const decoder = new TextDecoder();

    const consumeFrame = (frame: string): boolean => {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) return false;
      const event = JSON.parse(data) as {
        type?: string;
        data?: string;
        done?: boolean;
        message?: string;
        title?: string;
      };
      if (event.type === "chunk" && event.data) {
        const bytes = Buffer.from(event.data, "base64");
        if (bytes.length) {
          if (!firstChunkLatencyMs) firstChunkLatencyMs = Math.max(1, Date.now() - started);
          onAudio({ bytes, encoding: "pcm16", sampleRateHz: 22_050, mimeType: "audio/pcm" });
        }
      } else if (event.type === "error") {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: `Cartesia TTS stream failed: ${(event.message ?? event.title ?? "provider error").slice(0, 160)}`,
        });
      }
      return event.type === "done" || event.done === true;
    };

    try {
      const response = await (this.options.fetchImpl ?? fetch)("https://api.cartesia.ai/tts/sse", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Cartesia-Version": "2026-08-14",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_id: this.options.model ?? "sonic-3.6",
          transcript: transcript.slice(0, 2000),
          voice,
          language: language.split(/[-_]/)[0].toLowerCase() || "en",
          output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 22_050 },
          add_timestamps: false,
          add_phoneme_timestamps: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new AppError({
          code:
            response.status === 429 || response.status >= 500
              ? ErrorCode.UPSTREAM_UNAVAILABLE
              : ErrorCode.VALIDATION_FAILED,
          message: `Cartesia TTS stream failed (${response.status}): ${detail.slice(0, 160)}`,
        });
      }
      reader = response.body.getReader();
      let done = false;
      while (!done) {
        const result = await reader.read();
        pending += decoder.decode(result.value, { stream: !result.done });
        let boundary = pending.search(/\r?\n\r?\n/);
        while (boundary >= 0) {
          done = consumeFrame(pending.slice(0, boundary));
          const separatorLength = pending.slice(boundary).startsWith("\r\n") ? 4 : 2;
          pending = pending.slice(boundary + separatorLength);
          if (done) break;
          boundary = pending.search(/\r?\n\r?\n/);
        }
        if (result.done) break;
      }
      if (!done && pending.trim()) consumeFrame(pending);
      if (!firstChunkLatencyMs) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Cartesia returned an empty audio stream",
        });
      }
      return { firstChunkLatencyMs, latencyMs: Math.max(1, Date.now() - started) };
    } catch (err) {
      if (controller.signal.aborted && !signal?.aborted) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_TIMEOUT,
          message: "Cartesia TTS stream timed out",
        });
      }
      if (signal?.aborted) throw new DOMException("Synthesis interrupted", "AbortError");
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (reader) void reader.cancel().catch(() => undefined);
    }
  }
}
