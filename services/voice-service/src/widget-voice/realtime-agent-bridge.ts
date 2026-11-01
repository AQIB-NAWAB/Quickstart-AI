import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "@quickstart/logging";
import { streamWidgetTurn } from "../clients/runtime-widget-stream.js";

export const REALTIME_AGENT_TOOL = {
  name: "consult_agent",
  description:
    "Get an authoritative answer from the published agent, its knowledge base, and its configured tools for the caller's latest request. Required for facts, lookups, bookings, changes, confirmations, and human transfers. The server uses the actual caller transcript; this function accepts no arguments.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};
export const REALTIME_AGENT_INSTRUCTIONS = [
  "You have a server-side consult_agent function connected to the published agent's knowledge and tools.",
  "Call consult_agent before answering factual or business questions, doing lookups or actions, responding to action confirmations, or transferring to a human. Greetings and conversational acknowledgements can be spoken directly.",
  "Do not invent tool names, records, prices, availability, successful actions, or transfers. Never treat your own words as caller confirmation.",
  "The function reads the caller transcript automatically. Do not supply or invent arguments. Call it once per caller turn, then speak its answer faithfully and briefly in the caller's language. Do not add facts or promises not present in the result.",
  "If the function asks a clarification or confirmation, ask that question and wait. If it reports unavailable or unknown, say you could not verify the result; never retry an action automatically.",
  "Human transfers happen only when the function returns handoff=true, after caller confirmation. Do not announce a completed transfer on your own.",
].join(" ");

export type RealtimeAgentResult = {
  status: "ok" | "unavailable";
  answer: string;
  handoff?: boolean;
};
type Turn = {
  id: string;
  key: string;
  text: string;
  abort: AbortController;
  active: boolean;
  completed?: boolean;
  executing?: boolean;
  notify?: () => void;
  result?: Promise<RealtimeAgentResult>;
  persisted?: Promise<void>;
};

/** Shared runtime delegation; no provider receives credentials or raw executable tools. */
export class RealtimeAgentBridge {
  private readonly sessionId = randomUUID();
  private readonly turns = new Map<string, Turn>();
  private current: Turn | undefined;
  private closed = false;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly input: {
      workspaceId: string;
      conversationId: string;
      actorId: string;
      runtimeUrl: string;
      conversationUrl: string;
      internalToken: string;
      logger: Logger;
      turnTimeoutMs?: number;
      transcriptWaitMs?: number;
      transcriptSettlingMs?: number;
    },
  ) {}

  get turnId(): string | undefined {
    return this.current?.id;
  }

  beginTurn(id: string = randomUUID()): string {
    if (this.current?.id === id) return id;
    const turn = this.turns.get(id);
    if (turn) return id;
    if (!this.current?.completed) this.interrupt();
    const key = `realtime:${this.sessionId}:${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
    this.current = { id, key, text: "", active: true, abort: new AbortController() };
    this.turns.set(id, this.current);
    if (this.turns.size > 128) this.turns.delete(this.turns.keys().next().value!);
    return id;
  }

  transcript(id: string, text: string): void {
    const turn = this.turns.get(id);
    if (!turn || turn.abort.signal.aborted || turn.executing) return;
    turn.text = text.trim().slice(0, 12_000);
    if (turn.text) turn.notify?.();
  }

  isCurrent(id: string | undefined): boolean {
    return !this.closed && Boolean(id && this.current?.id === id && this.current.active);
  }

  consult(id: string | undefined): Promise<RealtimeAgentResult> {
    const turn = id ? this.turns.get(id) : undefined;
    if (!turn || !this.isCurrent(id)) return Promise.resolve(this.unavailable());
    // One immutable operation per caller turn, regardless of duplicated provider
    // call ids or a reconnect/repeated function event. Never retry unknown writes.
    turn.result ??= this.run(turn);
    return turn.result;
  }

  private async run(turn: Turn): Promise<RealtimeAgentResult> {
    const timeout = setTimeout(() => turn.abort.abort(), this.input.turnTimeoutMs ?? 20_000);
    try {
      if ((!turn.text || this.input.transcriptSettlingMs) && !(await this.waitForTranscript(turn)))
        return this.unavailable();
      turn.abort.signal.throwIfAborted();
      if (!turn.text) return this.unavailable();
      turn.executing = true;
      // Use the exact same user-message idempotency key in the transcript and
      // runtime paths; the runtime persists its authoritative assistant answer.
      await this.persistUser(turn);
      turn.abort.signal.throwIfAborted();
      let handoff = false;
      const result = await streamWidgetTurn(
        {
          runtimeUrl: this.input.runtimeUrl,
          internalToken: this.input.internalToken,
          workspaceId: this.input.workspaceId,
          conversationId: this.input.conversationId,
          actorId: this.input.actorId,
          text: turn.text,
          idempotencyKey: turn.key,
          requestId: randomUUID(),
          modality: "voice",
          deadlineMs: this.input.turnTimeoutMs ?? 20_000,
          signal: turn.abort.signal,
          onTransfer: () => {
            handoff = true;
          },
        },
        () => {},
      );
      turn.abort.signal.throwIfAborted();
      this.input.logger.info("voice.realtime.runtime_complete", {
        agent_id: result.agent_id,
        agent_version_id: result.agent_version_id,
        latency_ms: result.latency_ms,
        handoff,
      });
      return { status: "ok", answer: result.assistant_text, ...(handoff ? { handoff: true } : {}) };
    } catch (err) {
      this.input.logger.warn("voice.realtime.runtime_failed", {
        interrupted: turn.abort.signal.aborted,
        message: err instanceof Error ? err.message : "runtime unavailable",
      });
      return this.unavailable();
    } finally {
      clearTimeout(timeout);
    }
  }

  private waitForTranscript(turn: Turn): Promise<boolean> {
    return new Promise((resolve) => {
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (stable: boolean) => {
        clearTimeout(deadline);
        if (settleTimer) clearTimeout(settleTimer);
        turn.abort.signal.removeEventListener("abort", onAbort);
        turn.notify = undefined;
        resolve(stable);
      };
      const onAbort = () => finish(false);
      const onTranscript = () => {
        if (settleTimer) clearTimeout(settleTimer);
        if (!turn.text) return;
        const settlingMs = this.input.transcriptSettlingMs ?? 0;
        if (!settlingMs) finish(true);
        else settleTimer = setTimeout(() => finish(true), settlingMs);
      };
      const deadline = setTimeout(() => finish(false), this.input.transcriptWaitMs ?? 2_000);
      turn.notify = onTranscript;
      turn.abort.signal.addEventListener("abort", onAbort, { once: true });
      if (turn.abort.signal.aborted) onAbort();
      else onTranscript();
    });
  }

  private unavailable(): RealtimeAgentResult {
    return {
      status: "unavailable",
      answer:
        "I couldn't verify that result. Please check with a teammate before repeating the action.",
    };
  }

  private persistUser(turn: Turn): Promise<void> {
    if (!turn.text) return Promise.resolve();
    turn.persisted ??= this.persist("user", turn.text, turn.key, turn.abort.signal);
    return turn.persisted;
  }

  async complete(id: string | undefined, assistantText: string, responseId: string): Promise<void> {
    const turn = id ? this.turns.get(id) : undefined;
    if (!turn || !this.isCurrent(id)) return;
    turn.completed = true;
    try {
      await this.persistUser(turn);
      // Delegated results are already recorded by the shared runtime. Do not
      // add a second copy of the model's spoken paraphrase or acknowledgement.
      if (!turn.result && assistantText.trim()) {
        await this.persist(
          "assistant",
          assistantText.trim(),
          `${turn.key}:spoken:${responseId}`,
          turn.abort.signal,
        );
      }
    } catch (err) {
      this.input.logger.warn("voice.realtime.persist_failed", {
        message: err instanceof Error ? err.message : "persist failed",
      });
    }
  }

  private persist(
    sender: "user" | "assistant",
    text: string,
    key: string,
    signal: AbortSignal,
  ): Promise<void> {
    const request = this.persistChain.then(async () => {
      signal.throwIfAborted();
      const response = await fetch(
        `${this.input.conversationUrl}/internal/workspaces/${encodeURIComponent(this.input.workspaceId)}/widget/conversations/${encodeURIComponent(this.input.conversationId)}/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.input.internalToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            text,
            sender_type: sender,
            sender_id: this.input.actorId,
            idempotency_key: key,
            metadata: { channel: "widget", modality: "realtime" },
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
        },
      );
      if (!response.ok)
        throw new Error(`Realtime transcript persistence failed (${response.status})`);
      await response.body?.cancel();
    });
    this.persistChain = request.catch(() => undefined);
    return request;
  }

  interrupt(): void {
    if (this.current) {
      this.current.active = false;
      this.current.abort.abort();
    }
  }
  close(): void {
    this.closed = true;
    for (const turn of this.turns.values()) turn.abort.abort();
  }
}
