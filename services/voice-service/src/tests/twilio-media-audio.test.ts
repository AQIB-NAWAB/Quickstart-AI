import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import WebSocket from "ws";
import { createLogger } from "@quickstart/logging";
import { setupTwilioMediaStreamServer } from "../telephony/media-stream-server.js";
import { MemoryCallsRepository } from "../repository/calls.repository.js";
import { createMemoryRecordingStore } from "../repository/recording.store.js";
import type { WidgetVoiceLiveSessionManager } from "../widget-voice/session-manager.js";
import type { VoiceLiveEvent } from "../widget-voice/live-session.js";

test(
  "Twilio uses the provider PCM sample rate so voice duration and pitch stay correct",
  { timeout: 3000 },
  async () => {
    const server = createServer();
    let emit!: (event: VoiceLiveEvent) => void;
    let ready!: () => void;
    const subscribed = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const sessions = {
      async create() {
        return "session";
      },
      async startRecording() {},
      subscribe(_id: string, listener: typeof emit) {
        emit = listener;
        ready();
        return () => {};
      },
      async finishRecording() {},
      async close() {},
    } as unknown as WidgetVoiceLiveSessionManager;
    const bridge = setupTwilioMediaStreamServer({
      server,
      callsRepo: new MemoryCallsRepository(),
      recordings: createMemoryRecordingStore(),
      liveSessionManager: sessions,
      logger: createLogger({ service: "twilio-audio-test" }),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/media-stream`);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      socket.send(
        JSON.stringify({
          event: "start",
          start: {
            streamSid: "stream",
            callSid: "call",
            customParameters: { workspaceId: "workspace", conversationId: "conversation" },
          },
        }),
      );
      await subscribed;
      for (const rate of [16000, 22050, 24000]) {
        const message = new Promise<{ media: { payload: string } }>((resolve) => {
          const listen = (data: WebSocket.RawData) => {
            const event = JSON.parse(data.toString());
            if (event.event === "media") {
              socket.off("message", listen);
              resolve(event);
            }
          };
          socket.on("message", listen);
        });
        // 100 ms of source audio must remain 100 ms at Twilio's 8 kHz rate.
        emit({
          type: "audio",
          mime: "audio/pcm",
          encoding: "pcm16",
          sample_rate: rate,
          data: Buffer.alloc((rate / 10) * 2).toString("base64"),
        });
        assert.equal(Buffer.from((await message).media.payload, "base64").length, 800);
      }
      const cleared = new Promise<void>((resolve) =>
        socket.on("message", (data) => {
          if (JSON.parse(data.toString()).event === "clear") resolve();
        }),
      );
      emit({ type: "interrupt" });
      await cleared;
    } finally {
      socket.terminate();
      for (const client of bridge.wss.clients) client.terminate();
      await bridge.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
