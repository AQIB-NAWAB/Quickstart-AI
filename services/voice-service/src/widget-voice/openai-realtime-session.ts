import WebSocket from "ws";
import {
  REALTIME_AGENT_TOOL,
  REALTIME_AGENT_INSTRUCTIONS,
  RealtimeAgentBridge,
} from "./realtime-agent-bridge.js";
import type { Logger } from "@quickstart/logging";
import type { VoiceLiveEvent } from "./live-session.js";

type Listener = (event: VoiceLiveEvent) => void;

/** Linear resample 16 kHz PCM16 → 24 kHz PCM16 (OpenAI Realtime input rate). */
export function resamplePcm16(input: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return input;
  const inSamples = Math.floor(input.length / 2);
  if (inSamples < 2) return Buffer.alloc(0);
  const outSamples = Math.max(1, Math.floor((inSamples * toRate) / fromRate));
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const src = (i * fromRate) / toRate;
    const i0 = Math.min(inSamples - 1, Math.floor(src));
    const i1 = Math.min(inSamples - 1, i0 + 1);
    const frac = src - i0;
    const s0 = input.readInt16LE(i0 * 2);
    const s1 = input.readInt16LE(i1 * 2);
    const sample = Math.round(s0 + (s1 - s0) * frac);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }
  return out;
}

type RealtimeResponse = {
  id?: string;
  status?: string;
  output?: Array<{ type?: string; call_id?: string; name?: string; arguments?: string }>;
};
type ResponseState = {
  turnId?: string;
  text: string;
  cancelled: boolean;
  finished?: boolean;
  announcement?: boolean;
};

/** Native audio stays on the provider socket; actions and RAG stay in runtime. */
export class OpenAiRealtimeLiveSession {
  private readonly listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private closed = false;
  private ready = false;
  private held = false;
  private pendingAudio: Buffer[] = [];
  private pendingAudioBytes = 0;
  private readonly bridge: RealtimeAgentBridge;
  private readonly responses = new Map<string, ResponseState>();
  private readonly handledResponses = new Set<string>();
  private activeResponseId = "";
  private handoffTurn: string | undefined;
  private announcingTransfer = false;

  constructor(
    private readonly input: {
      apiKey: string;
      model: string;
      workspaceId: string;
      conversationId: string;
      actorId: string;
      conversationUrl: string;
      runtimeUrl: string;
      internalToken: string;
      logger: Logger;
      url?: string;
      headers?: Record<string, string>;
      voice?: string;
      transcriptionModel?: string;
      transcriptionDelay?: "minimal" | "low" | "medium" | "high" | "xhigh";
      instructions?: string | Promise<string>;
      turnTimeoutMs?: number;
      onTransferSpoken?: () => void;
    },
  ) {
    this.bridge = new RealtimeAgentBridge(input);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.ready) listener({ type: "ready" });
    return () => this.listeners.delete(listener);
  }
  private emit(event: VoiceLiveEvent): void {
    for (const listener of this.listeners) listener(event);
  }
  private send(message: unknown): void {
    if (!this.closed && this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(message));
  }

  async start(): Promise<void> {
    const model = this.input.model || "gpt-realtime-2.1";
    // ws supports server-side Authorization headers; the browser WebSocket API does not.
    const socket = new WebSocket(
      this.input.url ?? `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      {
        headers: this.input.headers ?? { Authorization: `Bearer ${this.input.apiKey}` },
      },
    );
    this.socket = socket;
    socket.on("open", () => {
      void (async () => {
        const fallback =
          "You are a helpful voice agent. Give short, natural spoken answers without markdown.";
        const instructions = await Promise.resolve(this.input.instructions ?? fallback).catch(
          () => fallback,
        );
        const transcriptionModel = this.input.transcriptionModel ?? "gpt-live-transcribe";
        this.send({
          type: "session.update",
          session: {
            type: "realtime",
            model,
            output_modalities: ["audio"],
            instructions: `${instructions}\n\n${REALTIME_AGENT_INSTRUCTIONS}`,
            tools: [{ type: "function", ...REALTIME_AGENT_TOOL }],
            tool_choice: "auto",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: 24000 },
                transcription: {
                  model: transcriptionModel,
                  ...(transcriptionModel === "gpt-live-transcribe"
                    ? { delay: this.input.transcriptionDelay ?? "minimal" }
                    : {}),
                },
                turn_detection: { type: "semantic_vad" },
              },
              output: {
                format: { type: "audio/pcm", rate: 24000 },
                voice: this.input.voice ?? "marin",
              },
            },
          },
        });
      })().catch(() => this.emit({ type: "error", message: "Realtime voice setup failed" }));
    });
    socket.on("message", (data) => this.onMessage(data.toString()));
    socket.on("error", () =>
      this.emit({ type: "error", message: "Realtime voice connection failed" }),
    );
    socket.on("close", () => {
      this.ready = false;
      this.bridge.close();
      if (!this.closed) this.emit({ type: "error", message: "Realtime voice connection closed" });
    });
  }

  private onMessage(raw: string): void {
    if (this.closed) return;
    let msg: {
      type?: string;
      delta?: string;
      transcript?: string;
      item_id?: string;
      response_id?: string;
      response?: RealtimeResponse;
      error?: { message?: string };
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "session.updated") {
      this.ready = true;
      for (const pcm of this.pendingAudio) this.sendAudio(pcm);
      this.pendingAudio = [];
      this.pendingAudioBytes = 0;
      this.emit({ type: "ready" });
      return;
    }
    if (msg.type === "input_audio_buffer.speech_started") {
      this.bridge.interrupt();
      for (const response of this.responses.values()) response.cancelled = true;
      this.handoffTurn = undefined;
      this.emit({ type: "interrupt" });
      if (msg.item_id) this.bridge.beginTurn(msg.item_id);
      return;
    }
    if (msg.type === "input_audio_buffer.committed") {
      if (msg.item_id) this.bridge.beginTurn(msg.item_id);
      return;
    }
    if (msg.type === "conversation.item.input_audio_transcription.completed") {
      if (msg.item_id && msg.transcript?.trim()) {
        this.bridge.beginTurn(msg.item_id);
        this.bridge.transcript(msg.item_id, msg.transcript);
        this.emit({ type: "transcript", text: msg.transcript.trim(), interim: false });
      }
      return;
    }
    if (msg.type === "response.created") {
      const id = msg.response?.id;
      if (!id) return;
      this.activeResponseId = id;
      this.responses.set(id, {
        turnId: this.bridge.turnId,
        text: "",
        cancelled: this.held && !this.announcingTransfer,
        announcement: this.announcingTransfer,
      });
      this.announcingTransfer = false;
      if (this.responses.size > 128) this.responses.delete(this.responses.keys().next().value!);
      this.emit({ type: "thinking" });
      return;
    }
    const responseId = msg.response_id ?? msg.response?.id ?? this.activeResponseId;
    const state = this.responses.get(responseId);
    if (msg.type === "error") {
      this.emit({ type: "error", message: msg.error?.message || "Realtime voice failed" });
      return;
    }
    if (!state || state.cancelled || (this.held && !state.announcement)) return;
    switch (msg.type) {
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        if (msg.delta) {
          state.text += msg.delta;
          this.emit({ type: "assistant_token", delta: msg.delta });
        }
        break;
      case "response.output_audio.delta":
      case "response.audio.delta":
        if (msg.delta)
          this.emit({
            type: "audio",
            mime: "audio/pcm",
            data: msg.delta,
            encoding: "pcm16",
            sample_rate: 24000,
          });
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        if (msg.transcript?.trim()) state.text = msg.transcript.trim();
        break;
      case "response.done":
        if (this.handledResponses.has(responseId)) return;
        state.finished = true;
        this.handledResponses.add(responseId);
        if (this.handledResponses.size > 128)
          this.handledResponses.delete(this.handledResponses.values().next().value!);
        void this.finishResponse(msg.response, state, responseId).catch((err) => {
          this.input.logger.warn("voice.realtime.response_failed", {
            message: err instanceof Error ? err.message : "response failed",
          });
          this.emit({ type: "error", message: "Realtime agent response failed" });
        });
        break;
    }
  }

  private async finishResponse(
    response: RealtimeResponse | undefined,
    state: ResponseState,
    responseId: string,
  ): Promise<void> {
    if (response?.status && response.status !== "completed") return;
    if (state.announcement) {
      if (state.text.trim()) this.emit({ type: "assistant_done", text: state.text.trim() });
      this.emit({ type: "turn_done" });
      return;
    }
    const calls = response?.output?.filter((item) => item.type === "function_call") ?? [];
    if (calls.length) {
      for (const call of calls.slice(0, 8)) {
        let valid = false;
        try {
          const args: unknown = JSON.parse(call.arguments ?? "{}");
          valid =
            call.name === REALTIME_AGENT_TOOL.name &&
            Boolean(
              args &&
              typeof args === "object" &&
              !Array.isArray(args) &&
              Object.keys(args).length === 0,
            );
        } catch {
          /* Invalid arguments never reach runtime. */
        }
        const result = valid
          ? await this.bridge.consult(state.turnId)
          : {
              status: "unavailable",
              answer: "Unsupported function or arguments. No action was taken.",
            };
        if (state.cancelled || this.closed || this.held || !this.bridge.isCurrent(state.turnId))
          return;
        if ("handoff" in result && result.handoff) this.handoffTurn = state.turnId;
        this.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result),
          },
        });
      }
      // Results are already authoritative. Prevent repeated tool calls while
      // the provider voices this answer; the next caller turn uses session auto.
      this.send({ type: "response.create", response: { tool_choice: "none" } });
      return;
    }
    if (state.text.trim()) this.emit({ type: "assistant_done", text: state.text.trim() });
    await this.bridge.complete(state.turnId, state.text, responseId);
    if (state.cancelled || this.closed || this.held) return;
    this.emit({ type: "turn_done" });
    if (this.handoffTurn && this.handoffTurn === state.turnId) {
      this.handoffTurn = undefined;
      this.held = true;
      this.input.onTransferSpoken?.();
    }
  }

  holdModel(): void {
    this.held = true;
    this.bridge.interrupt();
    const response = this.responses.get(this.activeResponseId);
    if (response && !response.finished && !response.announcement && !this.announcingTransfer)
      this.send({ type: "response.cancel" });
  }
  releaseModel(): void {
    this.held = false;
  }
  sayTransfer(name: string): void {
    const safe =
      name
        .replace(/[\r\n"]/g, " ")
        .trim()
        .slice(0, 80) || "a teammate";
    this.announcingTransfer = true;
    this.send({
      type: "response.create",
      response: {
        tool_choice: "none",
        instructions: `Say only: I'm switching you to ${safe} now.`,
      },
    });
  }
  pushPcm(pcm: Buffer): void {
    if (this.closed || this.held || pcm.length < 2) return;
    if (!this.ready) {
      this.pendingAudio.push(Buffer.from(pcm));
      this.pendingAudioBytes += pcm.length;
      while (this.pendingAudioBytes > 64_000 && this.pendingAudio.length)
        this.pendingAudioBytes -= this.pendingAudio.shift()!.length;
      return;
    }
    this.sendAudio(pcm);
  }
  private sendAudio(pcm: Buffer): void {
    const audio = resamplePcm16(pcm, 16_000, 24_000);
    if (audio.length)
      this.send({ type: "input_audio_buffer.append", audio: audio.toString("base64") });
  }
  close(): void {
    this.closed = true;
    this.ready = false;
    this.bridge.close();
    this.pendingAudio = [];
    this.pendingAudioBytes = 0;
    this.socket?.close();
    this.socket = null;
  }
}
