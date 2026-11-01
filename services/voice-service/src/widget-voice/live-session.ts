import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { Logger } from "@quickstart/logging";
import type { AudioChunk, TextToSpeech } from "../speech/types.js";
import { textForSpeech } from "../services/widget-voice.service.js";
import { streamWidgetTurn } from "../clients/runtime-widget-stream.js";
import { eagerCommitDelayMs, frameEnergy } from "../turn-detection/eager-commit.js";
import {
  BargeInDetector,
  NoiseFloorTracker,
  PRE_READY_FRAME_LIMIT,
  SPEECH_ENERGY_THRESHOLD,
  SPEECH_TAIL_SILENCE_MS,
  firstSpeakableCut,
  isFillerOnly,
  speechTailDelayMs,
} from "../turn-detection/live-turn-policy.js";

const TOOL_NUDGE = "Let me check that for you.";
const DEFAULT_SPOKEN_FALLBACK = "Sorry, I am having trouble right now. Please try again.";
const DEFAULT_TURN_TIMEOUT_MS = 20_000;
/** Wait briefly before speaking the tool acknowledgement so fast tools stay silent. */
const TOOL_NUDGE_DELAY_MS = 250;
const toolNudgeCache = new WeakMap<TextToSpeech, Map<string, Promise<AudioChunk[]>>>();

function prewarmToolNudge(tts: TextToSpeech, voiceId: string): Promise<AudioChunk[]> {
  let voices = toolNudgeCache.get(tts);
  if (!voices) {
    voices = new Map();
    toolNudgeCache.set(tts, voices);
  }
  const cached = voices.get(voiceId);
  if (cached) return cached;

  const audioPromise = (async () => {
    const chunks: AudioChunk[] = [];
    if (tts.streamSynthesize) {
      await tts.streamSynthesize(TOOL_NUDGE, voiceId, (audio) => chunks.push(audio));
    } else {
      chunks.push((await tts.synthesize(TOOL_NUDGE, voiceId)).audio);
    }
    if (chunks.length === 0) throw new Error("TTS returned no audio for the tool acknowledgement");
    return chunks;
  })();
  voices.set(voiceId, audioPromise);
  void audioPromise.catch(() => {
    if (voices?.get(voiceId) === audioPromise) voices.delete(voiceId);
  });
  return audioPromise;
}

/** Speak the first clause as soon as it exists so TTS overlaps the rest of the reply. */

export type VoiceLiveEvent =
  | { type: "ready" }
  | { type: "level"; value: number }
  | { type: "transcript"; text: string; interim: boolean }
  | { type: "thinking" }
  | { type: "assistant_token"; delta: string }
  | { type: "audio"; mime: string; data: string; encoding?: "mp3" | "pcm16"; sample_rate?: number }
  | { type: "assistant_done"; text: string }
  | { type: "interrupt" }
  | { type: "turn_done" }
  | { type: "handoff"; status: "waiting" }
  | { type: "human_joined"; name: string }
  | { type: "human_left" }
  | { type: "error"; message: string };

type Listener = (event: VoiceLiveEvent) => void;

export class WidgetVoiceLiveSession {
  private readonly listeners = new Set<Listener>();
  private dgSocket: WebSocket | null = null;
  private closed = false;
  private ready = false;
  private processingTurn = false;
  private lastProcessedText = "";
  private lastProcessedAt = 0;
  /** Finalized phrases in the current utterance. A short pause must not commit these. */
  private utteranceParts: string[] = [];
  private openInterim = "";
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private turnAbort: AbortController | null = null;
  private turnDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private bargeDetector = new BargeInDetector();
  private noiseFloor = new NoiseFloorTracker();
  private lastVoiceAt = 0;
  private preReadyFrames: Buffer[] = [];
  private turnStartedAt = 0;
  private firstTokenAt = 0;
  private firstAudioAt = 0;
  private nudgeSpoken = false;
  private resolvedVoiceId = "uplift:v_8eelc901";
  private replyLanguage = "en";
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private dgReconnectAttempts = 0;
  private dgReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly input: {
      workspaceId: string;
      conversationId: string;
      actorId: string;
      deepgramApiKey: string;
      deepgramModel: string;
      deepgramLanguage?: string;
      runtimeUrl: string;
      internalToken: string;
      tts: TextToSpeech;
      ttsVoiceId: Promise<string>;
      replyLanguage: Promise<string>;
      /** Overall wall-clock budget for one caller turn. */
      turnTimeoutMs?: number;
      /** Deepgram endpointing window; lower is faster but more eager. */
      endpointingMs?: number;
      /** Silence required after the last caller voice frame before commit. */
      speechTailMs?: number;
      /** Spoken when the turn times out. */
      spokenFallback?: string;
      onTransferSpoken?: () => void;
      logger: Logger;
    },
  ) {}

  private held = false;
  private speakChain: Promise<void> = Promise.resolve();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.ready) listener({ type: "ready" });
    return () => this.listeners.delete(listener);
  }

  private emit(event: VoiceLiveEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  async start(): Promise<void> {
    // Open STT immediately. The agent brief (conversation/agent/knowledge) is
    // fetched in parallel so its HTTP hops never delay the first caller words.
    this.openDeepgram();
    void Promise.all([
      this.input.replyLanguage.catch(() => "en"),
      this.input.ttsVoiceId.catch(() => this.resolvedVoiceId),
    ]).then(([replyLanguage, voiceId]) => {
      if (this.closed) return;
      this.replyLanguage = replyLanguage;
      if (voiceId) this.resolvedVoiceId = voiceId;
      this.input.logger.info("widget.voice.brief_ready", {
        language: replyLanguage,
        voice_id: this.resolvedVoiceId,
        stt_ready: this.ready,
      });
      if (!replyLanguage.toLowerCase().startsWith("ur")) {
        void prewarmToolNudge(this.input.tts, this.resolvedVoiceId).then(
          () =>
            this.input.logger.info("widget.voice.tool_nudge_ready", {
              voice_id: this.resolvedVoiceId,
            }),
          (err) =>
            this.input.logger.warn("widget.voice.tool_nudge_prewarm_failed", {
              message: err instanceof Error ? err.message : "TTS prewarm failed",
            }),
        );
      }
    });
  }

  private openDeepgram(): void {
    if (this.closed) return;
    const configuredModel = this.input.deepgramModel || "nova-3";
    const model = configuredModel;
    const params = new URLSearchParams({
      model,
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      punctuate: "true",
      smart_format: "true",
      // Do not force every caller through English STT. The agent language is
      // resolved asynchronously and Deepgram's multilingual mode gives the
      // recognizer a useful fallback while the brief is loading.
      language: this.input.deepgramLanguage?.trim() || "multi",
      // Aggressive endpointing lowers dead air; the local speech-tail guard in
      // scheduleCommit prevents cutting off a caller who is still talking.
      endpointing: String(this.input.endpointingMs ?? 100),
      // Deepgram rejects values below its configured step size; 1000 ms is
      // the minimum supported value for this streaming configuration.
      utterance_end_ms: "1000",
      vad_events: "true",
    });
    const url = `wss://api.deepgram.com/v1/listen?${params}`;
    const dg = new WebSocket(url, {
      headers: { Authorization: `Token ${this.input.deepgramApiKey}` },
    });
    this.dgSocket = dg;

    dg.addEventListener("open", () => {
      this.input.logger.info("widget.voice.stt_connected", {
        model,
        language: this.input.deepgramLanguage?.trim() || "multi",
      });
      this.dgReconnectAttempts = 0;
      if (this.dgReconnectTimer) {
        clearTimeout(this.dgReconnectTimer);
        this.dgReconnectTimer = null;
      }
      this.ready = true;
      this.emit({ type: "ready" });
      this.flushPreReadyFrames();
      if (!this.keepAliveTimer) {
        this.keepAliveTimer = setInterval(() => {
          if (this.closed || !this.dgSocket || this.dgSocket.readyState !== WebSocket.OPEN) return;
          this.dgSocket.send(JSON.stringify({ type: "KeepAlive" }));
        }, 4_000);
      }
    });

    dg.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: {
        type?: string;
        is_final?: boolean;
        channel?: { alternatives?: Array<{ transcript?: string }> };
        speech_final?: boolean;
      };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handleTranscript(msg);
    });

    dg.addEventListener("error", () => {
      this.input.logger.warn("widget.voice.dg_error", { model, language: "en" });
    });

    dg.on("unexpected-response", (_request, response) => {
      let detail = "";
      response.on("data", (chunk: Buffer) => {
        if (detail.length < 300) detail += chunk.toString("utf8").slice(0, 300 - detail.length);
      });
      response.on("end", () => {
        let message = detail;
        try {
          const parsed = JSON.parse(detail) as { err_msg?: string; err_code?: string };
          message = parsed.err_msg ?? parsed.err_code ?? detail;
        } catch {
          // Keep the bounded provider response text for diagnostics.
        }
        this.input.logger.warn("widget.voice.dg_rejected", {
          status: response.statusCode,
          model,
          language: "en",
          message,
        });
      });
    });

    dg.on("close", (code: number, reason: Buffer) => {
      if (this.closed || this.dgSocket !== dg) return;
      this.ready = false;
      this.dgSocket = null;
      this.input.logger.warn("widget.voice.dg_closed", {
        code,
        reason: reason.toString("utf8"),
      });
      this.scheduleDeepgramReconnect();
    });
  }

  private handleTranscript(msg: {
    type?: string;
    is_final?: boolean;
    speech_final?: boolean;
    channel?: { alternatives?: Array<{ transcript?: string }> };
  }): void {
    if (this.closed || this.held) return;
    if (msg.type === "UtteranceEnd") {
      if (!this.commitTimer) {
        const text = this.currentUtterance();
        this.scheduleCommit(
          Math.max(
            eagerCommitDelayMs(text),
            speechTailDelayMs(
              this.lastVoiceAt,
              Date.now(),
              this.input.speechTailMs ?? SPEECH_TAIL_SILENCE_MS,
            ),
          ),
        );
      }
      return;
    }
    const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
    // Deepgram can end an utterance with an empty Results event. Preserve
    // earlier finalized segments and commit them on that endpoint too.
    if (!transcript) {
      if (msg.speech_final && this.currentUtterance()) {
        this.scheduleCommit(eagerCommitDelayMs(this.currentUtterance()));
      }
      return;
    }
    this.cancelCommit();
    if (msg.is_final) {
      this.utteranceParts.push(transcript);
      this.openInterim = "";
    } else {
      this.openInterim = transcript;
    }
    this.emit({
      type: "transcript",
      text: this.currentUtterance(),
      interim: true,
    });
    if (msg.speech_final) {
      // Do not hard-commit at 40 ms: an open-ended phrase ("...and", "..."),
      // a short utterance, or a still-active speech tail should wait longer.
      this.scheduleCommit(
        Math.max(
          40,
          eagerCommitDelayMs(this.currentUtterance()),
          speechTailDelayMs(
            this.lastVoiceAt,
            Date.now(),
            this.input.speechTailMs ?? SPEECH_TAIL_SILENCE_MS,
          ),
        ),
      );
    }
  }

  private scheduleDeepgramReconnect(): void {
    if (this.closed || this.dgReconnectTimer) return;
    if (this.dgReconnectAttempts >= 6) {
      this.emit({ type: "error", message: "Live speech connection closed" });
      return;
    }
    this.dgReconnectAttempts += 1;
    this.dgReconnectTimer = setTimeout(() => {
      this.dgReconnectTimer = null;
      this.openDeepgram();
    }, 250 * this.dgReconnectAttempts);
  }

  holdModel(): void {
    this.held = true;
    this.cancelCommit();
  }

  releaseModel(): void {
    this.held = false;
  }

  sayTransfer(name: string): void {
    const safe =
      name
        .replace(/[^\p{L}\p{N} .'-]/gu, " ")
        .trim()
        .slice(0, 40) || "a teammate";
    const line = this.replyLanguage.toLowerCase().startsWith("ur")
      ? `ٹھیک ہے، میں آپ کو ${safe} کے پاس بھیج رہا ہوں۔`
      : `Okay, I'm switching you to ${safe}.`;
    void this.input.ttsVoiceId.then((id) => {
      if (id) this.resolvedVoiceId = id;
      this.speak(line);
    });
  }

  private speak(sentence: string, signal?: AbortSignal): void {
    const clean = textForSpeech(sentence);
    if (!clean) return;
    const voiceId = this.resolvedVoiceId;
    this.speakChain = this.speakChain
      .then(async () => {
        if (this.closed || signal?.aborted) return;
        if (clean === TOOL_NUDGE && !this.replyLanguage.toLowerCase().startsWith("ur")) {
          try {
            const chunks = await prewarmToolNudge(this.input.tts, voiceId);
            if (this.closed || signal?.aborted) return;
            for (const audio of chunks) this.emitAudio(audio);
            this.input.logger.info("widget.voice.tool_nudge_played", { cached: true });
            return;
          } catch {
            // Keep the live turn moving if the prewarm provider call failed.
          }
        }
        if (this.input.tts.streamSynthesize) {
          const metrics = await this.input.tts.streamSynthesize(
            clean,
            voiceId,
            (audio) => {
              if (this.closed || signal?.aborted) return;
              this.emitAudio(audio);
            },
            signal,
          );
          if (!this.closed && !signal?.aborted) {
            this.input.logger.info("widget.voice.tts_stream_complete", {
              provider: this.input.tts.id,
              first_chunk_ms: metrics.firstChunkLatencyMs,
              total_ms: metrics.latencyMs,
            });
          }
          return;
        }
        const tts = await this.input.tts.synthesize(clean, voiceId, signal);
        if (this.closed || signal?.aborted) return;
        this.emitAudio(tts.audio);
      })
      .catch((err) => {
        if (this.closed || signal?.aborted) return;
        this.input.logger.warn("widget.voice.tts_failed", {
          message: err instanceof Error ? err.message : "TTS failed",
        });
      });
  }

  private emitAudio(audio: AudioChunk): void {
    if (!this.firstAudioAt && this.turnStartedAt) {
      this.firstAudioAt = Date.now();
    }
    const pcm = audio.encoding === "pcm16";
    this.emit({
      type: "audio",
      mime: audio.mimeType ?? (pcm ? "audio/pcm" : "audio/mpeg"),
      data: audio.bytes.toString("base64"),
      ...(pcm ? { encoding: "pcm16" as const, sample_rate: audio.sampleRateHz } : {}),
    });
  }

  pushPcm(int16: Buffer): void {
    if (int16.length < 2) return;
    const level = frameEnergy(int16);
    this.emit({ type: "level", value: level });
    if (this.held) return;

    if (level >= SPEECH_ENERGY_THRESHOLD) {
      this.lastVoiceAt = Date.now();
    } else {
      this.noiseFloor.update(level);
    }

    if (this.processingTurn && this.bargeDetector.push(level, this.noiseFloor.value)) {
      this.bargeIn(level);
    }

    const socket = this.dgSocket;
    if (!this.ready || !socket || socket.readyState !== WebSocket.OPEN) {
      if (this.preReadyFrames.length >= PRE_READY_FRAME_LIMIT) this.preReadyFrames.shift();
      this.preReadyFrames.push(Buffer.from(int16));
      return;
    }
    socket.send(int16);
  }

  private flushPreReadyFrames(): void {
    const socket = this.dgSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const frames = this.preReadyFrames;
    this.preReadyFrames = [];
    for (const frame of frames) socket.send(frame);
    if (frames.length > 0) {
      this.input.logger.info("widget.voice.stt_prebuffer_flushed", {
        frames: frames.length,
        buffered_ms: frames.length * 20,
      });
    }
  }

  private bargeIn(level: number): void {
    this.bargeDetector.reset();
    this.clearTurnTimers();
    this.turnAbort?.abort();
    this.turnAbort = null;
    this.processingTurn = false;
    // An aborted provider may settle slowly; new speech must not queue behind it.
    this.speakChain = Promise.resolve();
    // A caller repeating the same words after interrupting must not be
    // suppressed by the duplicate-transcript guard.
    this.lastProcessedText = "";
    this.lastProcessedAt = 0;
    this.input.logger.info("widget.voice.barge_in", {
      level: Number(level.toFixed(3)),
      noise_floor: Number(this.noiseFloor.value.toFixed(3)),
      turn_elapsed_ms: this.turnStartedAt ? Date.now() - this.turnStartedAt : null,
    });
    this.emit({ type: "interrupt" });
  }

  private currentUtterance(): string {
    return [...this.utteranceParts, this.openInterim]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private cancelCommit(): void {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
  }

  /** Eager when the phrase looks finished; longer when it still sounds open. */
  private scheduleCommit(delayMs = 180): void {
    if (this.processingTurn || this.closed) return;
    this.cancelCommit();
    this.commitTimer = setTimeout(() => {
      this.commitTimer = null;
      void this.commitUtterance();
    }, delayMs);
  }

  private async commitUtterance(): Promise<void> {
    if (this.processingTurn || this.closed || this.held) return;
    // Recheck at execution time: the caller may have resumed while the timer
    // was pending, before STT has delivered their next transcript.
    const tailDelay = speechTailDelayMs(
      this.lastVoiceAt,
      Date.now(),
      this.input.speechTailMs ?? SPEECH_TAIL_SILENCE_MS,
    );
    if (tailDelay > 0) {
      this.scheduleCommit(tailDelay);
      return;
    }
    const text = this.currentUtterance();
    this.utteranceParts = [];
    this.openInterim = "";
    if (!text) return;
    if (isFillerOnly(text)) return;
    const now = Date.now();
    // Only suppress the exact same final transcript arriving twice from STT,
    // not a caller who deliberately repeats an answer after a barge-in.
    if (text === this.lastProcessedText && now - this.lastProcessedAt < 800) return;
    if (text.length < 2) return;
    this.processingTurn = true;
    this.bargeDetector.reset();
    this.lastProcessedText = text;
    this.lastProcessedAt = now;
    this.turnStartedAt = now;
    this.firstTokenAt = 0;
    this.firstAudioAt = 0;
    this.nudgeSpoken = false;
    const turnAbort = new AbortController();
    this.turnAbort = turnAbort;
    const requestId = randomUUID();
    const idempotencyKey = randomUUID();
    const turnTimeoutMs =
      this.input.turnTimeoutMs && this.input.turnTimeoutMs > 0
        ? this.input.turnTimeoutMs
        : DEFAULT_TURN_TIMEOUT_MS;
    let timedOut = false;
    let assistantBuffer = "";

    this.emit({ type: "transcript", text, interim: false });
    this.emit({ type: "thinking" });

    // Bound the entire turn (tool loop + model + streaming), not just the
    // HTTP connect. A hung runtime must not leave the caller in silence.
    this.turnDeadlineTimer = setTimeout(() => {
      if (this.turnAbort !== turnAbort) return;
      timedOut = true;
      this.input.logger.warn("widget.voice.turn_timeout", {
        request_id: requestId,
        timeout_ms: turnTimeoutMs,
      });
      turnAbort.abort();
    }, turnTimeoutMs);

    const cancelNudge = () => {
      if (this.nudgeTimer) {
        clearTimeout(this.nudgeTimer);
        this.nudgeTimer = null;
      }
    };

    try {
      let pending = "";
      let firstSpeechChunk = true;
      const speak = (sentence: string) => this.speak(sentence, turnAbort.signal);

      const turn = await streamWidgetTurn(
        {
          runtimeUrl: this.input.runtimeUrl,
          internalToken: this.input.internalToken,
          workspaceId: this.input.workspaceId,
          conversationId: this.input.conversationId,
          actorId: this.input.actorId,
          text,
          idempotencyKey,
          requestId,
          modality: "voice",
          replyLanguage: this.replyLanguage,
          deadlineMs: turnTimeoutMs,
          signal: turnAbort.signal,
          onNudge: (line) => {
            // Fast tools do not need "let me check that": wait briefly and let
            // the first model token cancel the acknowledgement.
            if (this.nudgeTimer || this.nudgeSpoken) return;
            this.nudgeTimer = setTimeout(() => {
              this.nudgeTimer = null;
              if (this.closed || turnAbort.signal.aborted) return;
              this.nudgeSpoken = true;
              this.input.logger.info("widget.voice.tool_nudge_played", {
                request_id: requestId,
                elapsed_ms: Date.now() - this.turnStartedAt,
                delayed: true,
              });
              speak(line);
            }, TOOL_NUDGE_DELAY_MS);
          },
          onTransfer: () => {
            this.held = true;
            this.input.onTransferSpoken?.();
          },
        },
        (delta) => {
          if (turnAbort.signal.aborted || this.turnAbort !== turnAbort) return;
          cancelNudge();
          if (!this.firstTokenAt) {
            this.firstTokenAt = Date.now();
            this.input.logger.info("widget.voice.turn_first_token", {
              request_id: requestId,
              elapsed_ms: this.firstTokenAt - this.turnStartedAt,
            });
          }
          assistantBuffer += delta;
          pending += delta;
          this.emit({ type: "assistant_token", delta });
          let cut = firstSpeakableCut(pending, firstSpeechChunk);
          while (cut > 0) {
            speak(pending.slice(0, cut));
            firstSpeechChunk = false;
            pending = pending.slice(cut);
            cut = firstSpeakableCut(pending, firstSpeechChunk);
          }
        },
      );
      if (this.turnAbort !== turnAbort) return;
      turnAbort.signal.throwIfAborted();
      cancelNudge();
      const assistantText = turn.assistant_text || assistantBuffer;
      // Idempotent runtime replays can contain only a done event, with no tokens.
      if (!assistantBuffer) pending = assistantText;
      if (pending.trim()) speak(pending);
      this.emit({ type: "assistant_done", text: assistantText });
      await this.speakChain;
      if (this.turnAbort !== turnAbort) return;
      turnAbort.signal.throwIfAborted();
      this.emit({ type: "turn_done" });
      this.logTurnCompleted(requestId, "completed");
    } catch (err) {
      if (this.turnAbort !== turnAbort) return;
      cancelNudge();
      if (turnAbort.signal.aborted && !timedOut) return; // barge-in owns this path
      if (this.closed) return;
      const message = err instanceof Error ? err.message : "Voice turn failed";
      this.input.logger.warn("widget.voice.live_turn_failed", {
        message,
        timed_out: timedOut,
      });
      this.emit({ type: "error", message });
      if (timedOut) {
        const fallback = this.input.spokenFallback?.trim() || DEFAULT_SPOKEN_FALLBACK;
        this.speak(fallback);
        await this.speakChain.catch(() => undefined);
      }
      this.logTurnCompleted(requestId, timedOut ? "timeout" : "failed");
    } finally {
      // An interrupted turn can finish after its replacement has already begun.
      // Only the owning turn may clear its deadline, nudge and timing state.
      if (this.turnAbort === turnAbort) {
        this.clearTurnTimers();
        this.turnAbort = null;
        this.processingTurn = false;
        this.turnStartedAt = 0;
        if (this.currentUtterance())
          this.scheduleCommit(eagerCommitDelayMs(this.currentUtterance()));
      }
    }
  }

  private logTurnCompleted(requestId: string, outcome: string): void {
    if (!this.turnStartedAt) return;
    this.input.logger.info("widget.voice.turn_complete", {
      request_id: requestId,
      outcome,
      first_token_ms: this.firstTokenAt ? this.firstTokenAt - this.turnStartedAt : null,
      first_audio_ms: this.firstAudioAt ? this.firstAudioAt - this.turnStartedAt : null,
      total_ms: Date.now() - this.turnStartedAt,
      nudge: this.nudgeSpoken,
    });
  }

  private clearTurnTimers(): void {
    if (this.turnDeadlineTimer) {
      clearTimeout(this.turnDeadlineTimer);
      this.turnDeadlineTimer = null;
    }
    if (this.nudgeTimer) {
      clearTimeout(this.nudgeTimer);
      this.nudgeTimer = null;
    }
  }

  close(): void {
    this.closed = true;
    this.turnAbort?.abort();
    this.turnAbort = null;
    this.processingTurn = false;
    this.cancelCommit();
    this.clearTurnTimers();
    this.bargeDetector.reset();
    this.preReadyFrames = [];
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.dgSocket && this.dgSocket.readyState === WebSocket.OPEN) {
      this.dgSocket.close();
    }
    this.dgSocket = null;
    if (this.dgReconnectTimer) {
      clearTimeout(this.dgReconnectTimer);
      this.dgReconnectTimer = null;
    }
  }
}
