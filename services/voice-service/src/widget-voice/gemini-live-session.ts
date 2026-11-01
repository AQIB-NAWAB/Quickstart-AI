import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  REALTIME_AGENT_TOOL,
  REALTIME_AGENT_INSTRUCTIONS,
  RealtimeAgentBridge,
} from "./realtime-agent-bridge.js";
import type { Logger } from "@quickstart/logging";
import type { VoiceLiveEvent } from "./live-session.js";

type Listener = (event: VoiceLiveEvent) => void;

type GeminiServerMessage = {
  setupComplete?: Record<string, unknown>;
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: unknown }> };
  toolCallCancellation?: { ids?: string[] };
  error?: { message?: string };
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    generationComplete?: boolean;
    inputTranscription?: { text?: string };
    interimInputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
      }>;
    };
  };
};

/**
 * Speech-to-speech session on Gemini Live.
 * Browser audio is already 16 kHz PCM, which is the Live API input rate.
 * Spoken replies come back as 24 kHz PCM.
 */
export class GeminiLiveSession {
  private readonly listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private closed = false;
  private ready = false;
  private assistantText = "";
  private userText = "";
  /** Audio that arrived before setup finished. Capped at about two seconds. */
  private pendingAudio: Buffer[] = [];
  private pendingAudioBytes = 0;
  private held = false;
  private readonly bridge: RealtimeAgentBridge;
  private turnId: string | undefined;
  private generation = 0;
  private handoffPending = false;
  private announcingTransfer = false;
  private readonly handledCalls = new Set<string>();
  private readonly pendingCalls = new Set<string>();
  private readonly cancelledCalls = new Set<string>();
  private pendingTransferName: string | null = null;

  constructor(
    private readonly input: {
      apiKey: string;
      model: string;
      workspaceId: string;
      conversationId: string;
      actorId: string;
      conversationUrl: string;
      runtimeUrl: string;
      turnTimeoutMs?: number;
      url?: string;
      internalToken: string;
      logger: Logger;
      brief: Promise<string>;
      onTransferSpoken?: () => void;
    },
  ) {
    // Gemini transcription is an independent stream of text fragments. Give
    // late fragments a short quiet window before authorizing a runtime action.
    this.bridge = new RealtimeAgentBridge({ ...input, transcriptSettlingMs: 100 });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.ready) listener({ type: "ready" });
    return () => this.listeners.delete(listener);
  }

  private emit(event: VoiceLiveEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async start(): Promise<void> {
    const model = this.input.model || "gemini-3.8-live";
    const instruction = await this.input.brief;
    if (this.closed) return;
    const url =
      this.input.url ??
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" +
        encodeURIComponent(this.input.apiKey);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.input.logger.info("widget.voice.gemini_socket", { event: "open", model });
      socket.send(
        JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
              },
            },
            systemInstruction: {
              parts: [{ text: `${instruction}\n\n${REALTIME_AGENT_INSTRUCTIONS}` }],
            },
            tools: [
              {
                functionDeclarations: [
                  {
                    name: REALTIME_AGENT_TOOL.name,
                    description: REALTIME_AGENT_TOOL.description,
                    parameters: { type: "OBJECT", properties: {} },
                  },
                ],
              },
            ],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                silenceDurationMs: 320,
                prefixPaddingMs: 120,
                endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
              },
            },
          },
        }),
      );
    });

    socket.on("message", (data) => {
      void this.onSocketMessage(data.toString()).catch((err) => {
        this.input.logger.warn("voice.gemini.message_failed", {
          message: err instanceof Error ? err.message : "message failed",
        });
        this.emit({ type: "error", message: "Realtime agent response failed" });
      });
    });

    socket.addEventListener("error", () => {
      this.emit({ type: "error", message: "Gemini Live connection failed" });
      this.input.logger.warn("widget.voice.gemini_socket", { event: "error" });
    });
    socket.addEventListener("close", (ev) => {
      const close = ev as { code?: number; reason?: string };
      const reason = String(close.reason || "");
      this.input.logger.warn("widget.voice.gemini_socket", {
        event: "close",
        code: close.code ?? 0,
        reason: reason.slice(0, 300),
      });
      this.bridge.close();
      this.ready = false;
      if (!this.closed) {
        this.emit({
          type: "error",
          message: reason || "Gemini Live connection closed",
        });
      }
    });
  }

  private async onSocketMessage(data: unknown): Promise<void> {
    if (this.closed) return;
    let raw = "";
    if (typeof data === "string") raw = data;
    else if (data instanceof ArrayBuffer) raw = Buffer.from(data).toString("utf8");
    else if (ArrayBuffer.isView(data))
      raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
    else if (data && typeof (data as Blob).text === "function") raw = await (data as Blob).text();
    if (!raw) return;
    let msg: GeminiServerMessage;
    try {
      msg = JSON.parse(raw) as GeminiServerMessage;
    } catch {
      return;
    }
    if (msg.setupComplete) {
      this.ready = true;
      this.input.logger.info("widget.voice.gemini_socket", { event: "setup_complete" });
      const queued = this.pendingAudio;
      this.pendingAudio = [];
      this.pendingAudioBytes = 0;
      for (const chunk of queued) this.sendPcm(chunk);
      this.flushTransfer();
      this.emit({ type: "ready" });
      return;
    }
    if (msg.error?.message) {
      this.emit({ type: "error", message: msg.error.message });
      this.input.logger.warn("widget.voice.gemini_error", { message: msg.error.message });
      return;
    }
    if (msg.toolCallCancellation) {
      for (const id of msg.toolCallCancellation.ids ?? []) {
        this.cancelledCalls.add(id);
        if (this.pendingCalls.has(id)) this.cancelTurn();
      }
      if (this.cancelledCalls.size > 128) this.cancelledCalls.clear();
      return;
    }
    if (msg.toolCall?.functionCalls) {
      void this.handleToolCalls(msg.toolCall.functionCalls).catch((err) => {
        this.input.logger.warn("voice.gemini.tool_failed", {
          message: err instanceof Error ? err.message : "tool failed",
        });
        this.emit({ type: "error", message: "Realtime agent tool failed" });
      });
      return;
    }
    const content = msg.serverContent;
    if (!content || (this.held && !this.announcingTransfer)) return;
    if (content.interrupted) {
      this.cancelTurn();
      this.emit({ type: "interrupt" });
      return;
    }
    const interim = content.interimInputTranscription?.text?.trim();
    if (interim) this.emit({ type: "transcript", text: interim, interim: true });
    const heard = content.inputTranscription?.text;
    if (heard) {
      const id = this.ensureTurn();
      this.userText = heard.startsWith(this.userText) ? heard : this.userText + heard;
      this.bridge.transcript(id, this.userText);
      this.emit({ type: "transcript", text: this.userText.trim(), interim: true });
    }
    const spoken = content.outputTranscription?.text ?? "";
    if (spoken) {
      const delta = spoken.startsWith(this.assistantText)
        ? spoken.slice(this.assistantText.length)
        : spoken;
      this.assistantText = spoken.startsWith(this.assistantText)
        ? spoken
        : this.assistantText + spoken;
      if (delta) this.emit({ type: "assistant_token", delta });
    }
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data)
        this.emit({
          type: "audio",
          mime: part.inlineData.mimeType || "audio/pcm",
          data: part.inlineData.data,
          encoding: "pcm16",
          sample_rate: 24000,
        });
    }
    if (content.turnComplete) {
      if (this.pendingCalls.size > 0) return;
      this.announcingTransfer = false;
      const id = this.turnId;
      const generation = this.generation;
      if (this.userText.trim())
        this.emit({ type: "transcript", text: this.userText.trim(), interim: false });
      if (this.assistantText.trim())
        this.emit({ type: "assistant_done", text: this.assistantText.trim() });
      const text = this.assistantText;
      this.assistantText = "";
      this.userText = "";
      this.turnId = undefined;
      await this.bridge.complete(id, text, randomUUID());
      if (this.closed || generation !== this.generation || this.turnId) return;
      this.emit({ type: "turn_done" });
      if (this.handoffPending) {
        this.handoffPending = false;
        this.held = true;
        this.input.onTransferSpoken?.();
      }
    }
  }

  private ensureTurn(): string {
    this.turnId ??= this.bridge.beginTurn();
    return this.turnId;
  }

  private cancelTurn(): void {
    this.generation++;
    this.bridge.interrupt();
    this.assistantText = "";
    this.userText = "";
    this.turnId = undefined;
    this.handoffPending = false;
  }

  private async handleToolCalls(
    calls: Array<{ id?: string; name?: string; args?: unknown }>,
  ): Promise<void> {
    if (this.closed || this.held) return;
    const id = this.ensureTurn();
    const generation = this.generation;
    const responses: Array<{ id: string; name: string; response: unknown }> = [];
    for (const call of calls.slice(0, 8)) {
      if (!call.id || this.handledCalls.has(call.id) || this.cancelledCalls.has(call.id)) continue;
      this.handledCalls.add(call.id);
      if (this.handledCalls.size > 128)
        this.handledCalls.delete(this.handledCalls.values().next().value!);
      this.pendingCalls.add(call.id);
      const args = call.args ?? {};
      const valid =
        call.name === REALTIME_AGENT_TOOL.name &&
        args &&
        typeof args === "object" &&
        !Array.isArray(args) &&
        Object.keys(args).length === 0;
      const result = valid
        ? await this.bridge.consult(id)
        : {
            status: "unavailable",
            answer: "Unsupported function or arguments. No action was taken.",
          };
      this.pendingCalls.delete(call.id);
      if (
        this.closed ||
        this.held ||
        generation !== this.generation ||
        this.cancelledCalls.has(call.id)
      )
        return;
      if ("handoff" in result && result.handoff) this.handoffPending = true;
      responses.push({ id: call.id, name: call.name ?? "unknown", response: result });
    }
    if (responses.length && this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
  }

  sayTransfer(name: string): void {
    const safe =
      name
        .replace(/[\r\n"]/g, " ")
        .trim()
        .slice(0, 80) || "a teammate";
    this.pendingTransferName = safe;
    this.announcingTransfer = true;
    this.flushTransfer();
  }

  holdModel(): void {
    this.held = true;
    this.cancelTurn();
  }

  releaseModel(): void {
    this.held = false;
  }

  private flushTransfer(): void {
    const name = this.pendingTransferName;
    if (!name || !this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.pendingTransferName = null;
    this.socket.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: `A human teammate named ${name} is joining this call. Say exactly: I'm switching you to ${name} now.`,
                },
              ],
            },
          ],
          turnComplete: true,
        },
      }),
    );
  }

  pushPcm(int16: Buffer): void {
    if (this.held || int16.length < 2) return;
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.pendingAudio.push(int16);
      this.pendingAudioBytes += int16.length;
      while (this.pendingAudioBytes > 64_000 && this.pendingAudio.length > 1) {
        const dropped = this.pendingAudio.shift();
        if (dropped) this.pendingAudioBytes -= dropped.length;
      }
      return;
    }
    this.sendPcm(int16);
  }

  private sendPcm(int16: Buffer): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            data: int16.toString("base64"),
            mimeType: "audio/pcm;rate=16000",
          },
        },
      }),
    );
  }

  close(): void {
    this.closed = true;
    this.bridge.close();
    this.ready = false;
    this.pendingAudio = [];
    this.pendingAudioBytes = 0;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      this.socket.close();
    }
    this.socket = null;
  }
}
