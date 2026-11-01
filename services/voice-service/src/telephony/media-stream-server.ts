import type { Server, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { Logger } from "@quickstart/logging";
import type { CallsRepository } from "../repository/calls.repository.js";
import type { RecordingStore } from "../repository/recording.store.js";
import type { UsageIngestClient } from "../clients/usage.client.js";
import type { WidgetVoiceLiveSessionManager } from "../widget-voice/session-manager.js";
import { pcm16ToTwilioMulawBase64, twilioMulawToPcm16 } from "./audio-codecs.js";

export type MediaStreamServerOptions = {
  server: Server;
  callsRepo: CallsRepository;
  recordings: RecordingStore;
  liveSessionManager: WidgetVoiceLiveSessionManager | null;
  usageIngest?: UsageIngestClient;
  logger: Logger;
  path?: string;
};

export type TwilioStreamStartMessage = {
  event: "start";
  sequenceNumber?: string;
  start: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    customParameters?: Record<string, string>;
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  streamSid: string;
};

export type TwilioStreamMediaMessage = {
  event: "media";
  sequenceNumber?: string;
  media: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string; // base64 encoded mulaw
  };
  streamSid: string;
};

export type TwilioStreamMarkMessage = {
  event: "mark";
  sequenceNumber?: string;
  mark: {
    name: string;
  };
  streamSid: string;
};

export type TwilioStreamStopMessage = {
  event: "stop";
  sequenceNumber?: string;
  stop: {
    accountSid: string;
    callSid: string;
  };
  streamSid: string;
};

export type TwilioInboundMessage =
  | { event: "connected"; protocol?: string; version?: string }
  | TwilioStreamStartMessage
  | TwilioStreamMediaMessage
  | TwilioStreamMarkMessage
  | TwilioStreamStopMessage;

export function setupTwilioMediaStreamServer(options: MediaStreamServerOptions): {
  wss: WebSocketServer;
  close: () => Promise<void>;
} {
  const {
    server,
    callsRepo,
    liveSessionManager,
    usageIngest,
    logger,
    path = "/media-stream",
  } = options;

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (
      url.pathname === path ||
      url.pathname === `/voice${path}` ||
      url.pathname === "/twiml/stream"
    ) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let streamSid = "";
    let callSid = "";
    let callId = "";
    let workspaceId = "";
    let liveSessionId = "";
    let unsubscribeLive: (() => void) | null = null;
    let startTime = Date.now();
    let audioSequence = 0;

    logger.info("telephony.media_stream.connected", {
      remoteAddress: req.socket.remoteAddress,
      url: req.url,
    });

    ws.on("message", async (data: Buffer | string) => {
      let msg: TwilioInboundMessage;
      try {
        msg = JSON.parse(data.toString()) as TwilioInboundMessage;
      } catch {
        logger.warn("telephony.media_stream.invalid_json");
        return;
      }

      switch (msg.event) {
        case "connected":
          logger.info("telephony.media_stream.handshake", {
            protocol: msg.protocol,
            version: msg.version,
          });
          break;

        case "start": {
          streamSid = msg.start.streamSid;
          callSid = msg.start.callSid;
          startTime = Date.now();

          const custom = msg.start.customParameters ?? {};
          workspaceId = custom.workspaceId || custom.workspace_id || "";
          const conversationId = custom.conversationId || custom.conversation_id || "";
          const agentId = custom.agentId || custom.agent_id || "";
          callId = custom.callId || custom.call_id || "";

          logger.info("telephony.media_stream.started", {
            streamSid,
            callSid,
            workspaceId,
            conversationId,
            agentId,
          });

          // Link provider call sid and stream sid in DB
          if (workspaceId && callId) {
            await callsRepo
              .updateState(workspaceId, callId, {
                state: "live",
                providerCallSid: callSid,
                streamSid,
              })
              .catch((err) => {
                logger.warn("telephony.media_stream.call_update_failed", {
                  callId,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
          }

          // If liveSessionManager is available, initiate live voice session
          if (liveSessionManager && workspaceId && conversationId) {
            try {
              liveSessionId = await liveSessionManager.create({
                workspaceId,
                conversationId,
                actorId: `caller-${callSid.slice(-6)}`,
              });

              // Start recording
              await liveSessionManager.startRecording(liveSessionId, workspaceId, "audio/x-pcm16");

              // Subscribe to live audio emitted from the AI agent
              unsubscribeLive = liveSessionManager.subscribe(liveSessionId, (event) => {
                if (event.type === "audio" && event.data) {
                  const pcm = Buffer.from(event.data, "base64");
                  const mulawB64 = pcm16ToTwilioMulawBase64(pcm, event.sample_rate ?? 16000);
                  audioSequence++;

                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(
                      JSON.stringify({
                        event: "media",
                        streamSid,
                        media: {
                          payload: mulawB64,
                        },
                      }),
                    );

                    ws.send(
                      JSON.stringify({
                        event: "mark",
                        streamSid,
                        mark: {
                          name: `audio_chunk_${audioSequence}`,
                        },
                      }),
                    );
                  }
                } else if (event.type === "interrupt") {
                  // User interrupted the model -> clear Twilio's audio buffer
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(
                      JSON.stringify({
                        event: "clear",
                        streamSid,
                      }),
                    );
                  }
                }
              });
            } catch (err) {
              logger.error("telephony.media_stream.session_init_failed", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          break;
        }

        case "media": {
          if (!msg.media?.payload) return;

          // Convert incoming 8kHz mu-law audio to 16kHz linear PCM
          const pcm16 = twilioMulawToPcm16(msg.media.payload, 16000);

          if (liveSessionManager && liveSessionId) {
            liveSessionManager.pushAudio(liveSessionId, pcm16);

            // Append the decoded caller track. The live session finalizes both
            // caller and agent PCM tracks as playable WAV files.
            void liveSessionManager.appendRecording(liveSessionId, workspaceId, pcm16);
          }
          break;
        }

        case "mark":
          // Twilio finished playing marked audio buffer
          break;

        case "stop": {
          logger.info("telephony.media_stream.stopped", {
            streamSid,
            callSid: msg.stop.callSid,
            durationMs: Date.now() - startTime,
          });

          await cleanupSession();
          break;
        }
      }
    });

    async function cleanupSession(): Promise<void> {
      if (unsubscribeLive) {
        unsubscribeLive();
        unsubscribeLive = null;
      }

      if (liveSessionManager && liveSessionId) {
        await liveSessionManager.finishRecording(liveSessionId, workspaceId).catch(() => undefined);
        await liveSessionManager.close(liveSessionId).catch(() => undefined);
        liveSessionId = "";
      }

      const durationSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));
      if (workspaceId && callId) {
        await callsRepo
          .updateState(workspaceId, callId, {
            state: "completed",
            durationSeconds,
            endedAt: new Date(),
          })
          .catch(() => undefined);

        if (usageIngest) {
          usageIngest.emit({
            workspace_id: workspaceId,
            kind: "voice",
            units: durationSeconds / 60,
            unit_label: "minutes",
            provider: "twilio",
            idempotency_key: `telephony:${workspaceId}:${callId}:stream_completed`,
            request_id: callSid,
            source_id: callId,
            detail: { call_id: callId, stream_sid: streamSid, duration_seconds: durationSeconds },
          });
        }
      }
    }

    ws.on("close", () => {
      void cleanupSession();
    });

    ws.on("error", (err) => {
      logger.warn("telephony.media_stream.socket_error", {
        streamSid,
        error: err.message,
      });
      void cleanupSession();
    });
  });

  return {
    wss,
    async close() {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}
