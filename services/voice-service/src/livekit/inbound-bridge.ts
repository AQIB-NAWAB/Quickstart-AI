import { randomUUID } from "node:crypto";
import type { Logger } from "@quickstart/logging";
import {
  AudioFrame,
  AudioResampler,
  AudioResamplerQuality,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  type RemoteAudioTrack,
} from "@livekit/rtc-node";
import { MPEGDecoder } from "mpg123-decoder";
import type { SipProvisioner } from "../telephony/livekit/sip-provisioner.js";
import type { WidgetVoiceLiveSessionManager } from "../widget-voice/session-manager.js";
import type { InboundBridgeStartInput, InboundCallBridge } from "./types.js";

const INPUT_SAMPLE_RATE = 48_000;
const SESSION_SAMPLE_RATE = 16_000;
const BRIDGE_IDENTITY_PREFIX = "qs-bridge-";

type BridgeSession = {
  room: Room;
  workspaceId: string;
  sessionId: string;
  audioSource: AudioSource;
  track: LocalAudioTrack;
  outboundResamplers: Map<number, AudioResampler>;
  decoder: MPEGDecoder;
  reader?: ReadableStreamDefaultReader<AudioFrame>;
  unsubSession: () => void;
  outboundChain: Promise<void>;
  /** Incremented on barge-in so frames queued before the interrupt are dropped. */
  generation: number;
  seenTracks: Set<string>;
  closed: boolean;
};

function frameToPcm16(frame: AudioFrame): Buffer {
  return Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
}

function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    out[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return out;
}

/**
 * Joins the LiveKit room created by the SIP dispatch rule and bridges audio to
 * the existing live voice session (our own agents infrastructure).
 *
 * Inbound: LiveKit native 16 kHz stream → WidgetVoiceLiveSession (Deepgram STT).
 * Outbound: session PCM/MP3 → 48 kHz → LiveKit AudioSource → SIP caller.
 *
 * Session transcripts, tool calls, barge-in and usage flow through the same
 * session manager the widget uses, so inbound calls are not a second agent stack.
 */
export class InboundMediaBridge implements InboundCallBridge {
  private readonly sessions = new Map<string, BridgeSession>();

  constructor(
    private readonly deps: {
      livekitUrl: string;
      provisioner: SipProvisioner;
      sessions: WidgetVoiceLiveSessionManager;
      logger: Logger;
    },
  ) {}

  async start(input: InboundBridgeStartInput): Promise<void> {
    if (this.sessions.has(input.roomName)) return;

    const identity = `${BRIDGE_IDENTITY_PREFIX}${randomUUID()}`;
    const token = await this.deps.provisioner.mintJoinToken({
      roomName: input.roomName,
      identity,
      name: "QuickStart Voice Agent",
    });

    const room = new Room();
    const audioSource = new AudioSource(INPUT_SAMPLE_RATE, 1, 1000);
    const track = LocalAudioTrack.createAudioTrack("agent-voice", audioSource);
    const decoder = new MPEGDecoder();
    await decoder.ready;

    let sessionCreateError: unknown = null;
    const sessionPromise = this.deps.sessions
      .create({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        actorId: "caller",
        provider: "telnyx",
        callId: input.callId,
        caller: input.caller,
        agentId: input.agentId,
      })
      .catch((err: unknown) => {
        sessionCreateError = err;
        return null;
      });

    try {
      await room.connect(this.deps.livekitUrl, token);
      if (!room.localParticipant) {
        throw new Error("LiveKit local participant unavailable after connect");
      }
      await room.localParticipant.publishTrack(
        track,
        new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
      );

      const createdSessionId = await sessionPromise;
      if (!createdSessionId) {
        throw sessionCreateError ?? new Error("Live voice session could not be created");
      }
      // LiveKit delivers native PCM. Start the dual-track recorder before
      // subscribing so caller audio and agent audio share the same call row.
      await this.deps.sessions.startRecording(
        createdSessionId,
        input.workspaceId,
        "audio/x-pcm16",
      );

      const session: BridgeSession = {
        room,
        workspaceId: input.workspaceId,
        sessionId: createdSessionId,
        audioSource,
        track,
        outboundResamplers: new Map(),
        decoder,
        unsubSession: () => undefined,
        outboundChain: Promise.resolve(),
        generation: 0,
        seenTracks: new Set(),
        closed: false,
      };

      session.unsubSession = this.deps.sessions.subscribe(createdSessionId, (event) => {
        if (event.type === "audio") {
          this.pushAgentAudio(session, event).catch((err: unknown) => {
            this.deps.logger.warn("livekit.bridge.audio_playback_failed", {
              room: input.roomName,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          return;
        }
        if (event.type === "interrupt") {
          session.generation += 1;
          session.audioSource.clearQueue();
          return;
        }
        if (event.type === "error") {
          this.deps.logger.warn("livekit.bridge.session_error", {
            room: input.roomName,
            message: event.message,
          });
        }
      }) ?? (() => undefined);

      room.on(RoomEvent.TrackSubscribed, (remoteTrack, _publication, participant) => {
        if (remoteTrack.kind !== TrackKind.KIND_AUDIO) return;
        if (participant.identity === identity) return;
        this.attachCallerTrack(input.roomName, session, remoteTrack as RemoteAudioTrack);
      });

      room.on(RoomEvent.Disconnected, () => {
        void this.stop(input.roomName);
      });

      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.kind === TrackKind.KIND_AUDIO && publication.track) {
            this.attachCallerTrack(
              input.roomName,
              session,
              publication.track as RemoteAudioTrack,
            );
          }
        }
      }

      this.sessions.set(input.roomName, session);

      this.deps.logger.info("livekit.bridge.started", {
        room: input.roomName,
        call_id: input.callId,
        conversation_id: input.conversationId,
        agent_id: input.agentId,
      });
    } catch (err) {
      await room.disconnect().catch(() => undefined);
      audioSource.close();
      await track.close(true).catch(() => undefined);
      decoder.free();
      const orphanSessionId = await sessionPromise;
      if (orphanSessionId) {
        await this.deps.sessions.close(orphanSessionId).catch(() => undefined);
      }
      throw err;
    }
  }

  async stop(roomName: string): Promise<void> {
    const session = this.sessions.get(roomName);
    if (!session || session.closed) return;
    session.closed = true;
    this.sessions.delete(roomName);

    session.unsubSession();
    await this.deps.sessions.finishRecording(
      session.sessionId,
      session.workspaceId,
    ).catch((err: unknown) => {
      this.deps.logger.warn("livekit.bridge.recording_finish_failed", {
        room: roomName,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    await session.reader?.cancel().catch(() => undefined);
    await session.room.disconnect().catch(() => undefined);
    session.audioSource.close();
    await session.track.close(true).catch(() => undefined);
    for (const resampler of session.outboundResamplers.values()) {
      resampler.close();
    }
    session.decoder.free();
    await this.deps.sessions.close(session.sessionId).catch(() => undefined);

    this.deps.logger.info("livekit.bridge.stopped", {
      room: roomName,
      call_session: session.sessionId,
    });
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((room) => this.stop(room)));
  }

  private attachCallerTrack(
    roomName: string,
    session: BridgeSession,
    track: RemoteAudioTrack,
  ): void {
    if (session.closed) return;
    const key = track.sid ?? track.name ?? `track-${session.seenTracks.size}`;
    if (session.seenTracks.has(key)) return;
    session.seenTracks.add(key);

    const stream = new AudioStream(track, {
      sampleRate: SESSION_SAMPLE_RATE,
      numChannels: 1,
    });
    const reader = stream.getReader();
    session.reader = reader;

    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || session.closed) break;
          if (!value) continue;
          // AudioStream resamples natively to 16 kHz for Deepgram.
          const pcm = frameToPcm16(value);
          this.deps.sessions.pushAudio(session.sessionId, pcm);
          void this.deps.sessions.appendRecording(
            session.sessionId,
            session.workspaceId,
            pcm,
          );
        }
      } catch (err) {
        if (!session.closed) {
          this.deps.logger.warn("livekit.bridge.caller_audio_failed", {
            room: roomName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
  }

  private async pushAgentAudio(
    session: BridgeSession,
    event: { data: string; encoding?: "mp3" | "pcm16"; sample_rate?: number },
  ): Promise<void> {
    const bytes = Buffer.from(event.data, "base64");
    if (bytes.length === 0) return;

    let pcm: Int16Array;
    let sampleRate: number;

    if (event.encoding === "pcm16") {
      sampleRate = event.sample_rate ?? SESSION_SAMPLE_RATE;
      pcm = new Int16Array(
        bytes.buffer,
        bytes.byteOffset,
        Math.floor(bytes.byteLength / 2),
      );
    } else {
      const decoded = session.decoder.decode(
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
      const channel = decoded.channelData[0];
      if (!channel || channel.length === 0) return;
      sampleRate = decoded.sampleRate;
      pcm = floatToPcm16(channel);
    }

    const resampler = this.outboundResampler(session, sampleRate);
    const frame = new AudioFrame(pcm, sampleRate, 1, pcm.length);
    const frames = resampler.push(frame);
    if (frames.length === 0) return;

    const generation = session.generation;
    session.outboundChain = session.outboundChain
      .then(async () => {
        for (const out of frames) {
          if (session.closed || session.generation !== generation) return;
          await session.audioSource.captureFrame(out);
        }
      })
      .catch((err: unknown) => {
        this.deps.logger.warn("livekit.bridge.playback_chain_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    await session.outboundChain;
  }

  private outboundResampler(session: BridgeSession, inputRate: number): AudioResampler {
    const existing = session.outboundResamplers.get(inputRate);
    if (existing) return existing;
    const resampler = new AudioResampler(
      inputRate,
      INPUT_SAMPLE_RATE,
      1,
      AudioResamplerQuality.MEDIUM,
    );
    session.outboundResamplers.set(inputRate, resampler);
    return resampler;
  }
}
