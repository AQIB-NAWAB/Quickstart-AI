import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  CallDirection,
  CallStageTimings,
  CallState,
  CallTranscriptSegment,
  TelephonyProviderId,
  VoiceMode,
} from "@quickstart/contracts";

export type VoiceCallRow = {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  agent_id: string | null;
  agent_version_id: string | null;
  direction: CallDirection;
  state: CallState;
  voice_mode: VoiceMode;
  telephony_provider: string;
  caller: string | null;
  callee: string | null;
  failure_code: string | null;
  time_to_first_audio_ms: number | null;
  recording_object_key: string | null;
  caller_recording_object_key?: string | null;
  recording_offset_ms?: number;
  caller_recording_offset_ms?: number;
  started_at: Date;
  ended_at: Date | null;
  provider_call_sid?: string | null;
  stream_sid?: string | null;
  recording_url?: string | null;
  duration_seconds?: number | null;
  amd_status?: string | null;
  hangup_cause?: string | null;
  livekit_room_name?: string | null;
  livekit_participant_sid?: string | null;
  phone_number_id?: string | null;
  sip_call_id?: string | null;
};

export type CreateCallInput = {
  workspaceId: string;
  conversationId?: string | null;
  agentId?: string | null;
  agentVersionId?: string | null;
  direction: CallDirection;
  voiceMode?: VoiceMode;
  telephonyProvider: TelephonyProviderId | string;
  caller?: string | null;
  callee?: string | null;
  id?: string;
  providerCallSid?: string | null;
  streamSid?: string | null;
  livekitRoomName?: string | null;
  phoneNumberId?: string | null;
  sipCallId?: string | null;
};

export type VoiceInboundSummary = {
  totalInbound: number;
  averageCallDurationSeconds: number;
  answerRate: number;
  averageTimeToFirstAudioMs: number | null;
  activeCallsCount: number;
};

export type VoiceWaveform = {
  agentPeaks: number[];
  callerPeaks: number[];
  durationSeconds: number;
  stereo: boolean;
  sampleRate?: number;
};

export interface CallsRepository {
  create(input: CreateCallInput): Promise<VoiceCallRow>;
  updateState(
    workspaceId: string,
    callId: string,
    patch: Partial<{
      state: CallState;
      voiceMode: VoiceMode;
      conversationId: string | null;
      agentId: string | null;
      agentVersionId: string | null;
      caller: string | null;
      failureCode: string | null;
      timeToFirstAudioMs: number | null;
      recordingObjectKey: string | null;
      callerRecordingObjectKey: string | null;
      waveformPeaks: unknown;
      channelCount: number;
      stereoAvailable: boolean;
      disconnectReason: string | null;
      endedAt: Date | null;
      providerCallSid?: string | null;
      streamSid?: string | null;
      recordingUrl?: string | null;
      durationSeconds?: number | null;
      amdStatus?: string | null;
      hangupCause?: string | null;
      livekitRoomName?: string | null;
      livekitParticipantSid?: string | null;
      phoneNumberId?: string | null;
      sipCallId?: string | null;
    }>,
  ): Promise<VoiceCallRow | null>;
  get(workspaceId: string, callId: string): Promise<VoiceCallRow | null>;
  findByLivekitRoom(roomName: string): Promise<VoiceCallRow | null>;
  list(
    workspaceId: string,
    opts: {
      state?: string;
      direction?: CallDirection;
      limit: number;
      cursor?: string;
      q?: string;
      agentId?: string;
    },
  ): Promise<{ rows: VoiceCallRow[]; nextCursor?: string; total: number }>;
  listLive(workspaceId: string, direction?: CallDirection): Promise<VoiceCallRow[]>;
  summary(workspaceId: string): Promise<VoiceInboundSummary>;
  waveform(workspaceId: string, callId: string): Promise<VoiceWaveform | null>;
  addTranscript(
    workspaceId: string,
    callId: string,
    segment: Omit<CallTranscriptSegment, "id"> & { id?: string },
  ): Promise<CallTranscriptSegment>;
  listTranscript(workspaceId: string, callId: string): Promise<CallTranscriptSegment[]>;
  addTiming(
    workspaceId: string,
    callId: string,
    turnNumber: number,
    timing: CallStageTimings,
  ): Promise<void>;
  listTimings(
    workspaceId: string,
    callId: string,
  ): Promise<Array<CallStageTimings & { turn_number: number; id: string }>>;
}

export class PgCallsRepository implements CallsRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateCallInput): Promise<VoiceCallRow> {
    const id = input.id ?? randomUUID();
    const { rows } = await this.pool.query<VoiceCallRow>(
      `INSERT INTO voice_calls (
        id, workspace_id, conversation_id, agent_id, agent_version_id,
        direction, state, voice_mode, telephony_provider, caller, callee,
        provider_call_sid, stream_sid, livekit_room_name, phone_number_id, sip_call_id
      ) VALUES ($1,$2,$3,$4,$5,$6,'ringing',$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        id,
        input.workspaceId,
        input.conversationId ?? null,
        input.agentId ?? null,
        input.agentVersionId ?? null,
        input.direction,
        input.voiceMode ?? "cascade",
        input.telephonyProvider,
        input.caller ?? null,
        input.callee ?? null,
        input.providerCallSid ?? null,
        input.streamSid ?? null,
        input.livekitRoomName ?? null,
        input.phoneNumberId ?? null,
        input.sipCallId ?? null,
      ],
    );
    return rows[0];
  }

  async updateState(
    workspaceId: string,
    callId: string,
    patch: Partial<{
      state: CallState;
      voiceMode: VoiceMode;
      conversationId: string | null;
      agentId: string | null;
      agentVersionId: string | null;
      caller: string | null;
      failureCode: string | null;
      timeToFirstAudioMs: number | null;
      recordingObjectKey: string | null;
      callerRecordingObjectKey: string | null;
      endedAt: Date | null;
      providerCallSid?: string | null;
      streamSid?: string | null;
      recordingUrl?: string | null;
      durationSeconds?: number | null;
      amdStatus?: string | null;
      hangupCause?: string | null;
      livekitRoomName?: string | null;
      livekitParticipantSid?: string | null;
      phoneNumberId?: string | null;
      sipCallId?: string | null;
    }>,
  ): Promise<VoiceCallRow | null> {
    const { rows } = await this.pool.query<VoiceCallRow>(
      `UPDATE voice_calls SET
        state = COALESCE($3, state),
        voice_mode = COALESCE($23, voice_mode),
        conversation_id = COALESCE($4, conversation_id),
        agent_id = COALESCE($5, agent_id),
        agent_version_id = COALESCE($6, agent_version_id),
        failure_code = COALESCE($7, failure_code),
        time_to_first_audio_ms = COALESCE($8, time_to_first_audio_ms),
        recording_object_key = COALESCE($9, recording_object_key),
        caller_recording_object_key = COALESCE($22, caller_recording_object_key),
        ended_at = COALESCE($10, ended_at),
        provider_call_sid = COALESCE($11, provider_call_sid),
        stream_sid = COALESCE($12, stream_sid),
        recording_url = COALESCE($13, recording_url),
        duration_seconds = COALESCE($14, duration_seconds),
        amd_status = COALESCE($15, amd_status),
        hangup_cause = COALESCE($16, hangup_cause),
        livekit_room_name = COALESCE($17, livekit_room_name),
        livekit_participant_sid = COALESCE($18, livekit_participant_sid),
        phone_number_id = COALESCE($19, phone_number_id),
        sip_call_id = COALESCE($20, sip_call_id),
        caller = COALESCE($21, caller),
        updated_at = NOW()
      WHERE workspace_id = $1 AND id = $2
      RETURNING *`,
      [
        workspaceId,
        callId,
        patch.state ?? null,
        patch.conversationId === undefined ? null : patch.conversationId,
        patch.agentId === undefined ? null : patch.agentId,
        patch.agentVersionId === undefined ? null : patch.agentVersionId,
        patch.failureCode === undefined ? null : patch.failureCode,
        patch.timeToFirstAudioMs === undefined ? null : patch.timeToFirstAudioMs,
        patch.recordingObjectKey === undefined ? null : patch.recordingObjectKey,
        patch.endedAt === undefined ? null : patch.endedAt,
        patch.providerCallSid === undefined ? null : patch.providerCallSid,
        patch.streamSid === undefined ? null : patch.streamSid,
        patch.recordingUrl === undefined ? null : patch.recordingUrl,
        patch.durationSeconds === undefined ? null : patch.durationSeconds,
        patch.amdStatus === undefined ? null : patch.amdStatus,
        patch.hangupCause === undefined ? null : patch.hangupCause,
        patch.livekitRoomName === undefined ? null : patch.livekitRoomName,
        patch.livekitParticipantSid === undefined ? null : patch.livekitParticipantSid,
        patch.phoneNumberId === undefined ? null : patch.phoneNumberId,
        patch.sipCallId === undefined ? null : patch.sipCallId,
        patch.caller === undefined ? null : patch.caller,
        patch.callerRecordingObjectKey === undefined ? null : patch.callerRecordingObjectKey,
        patch.voiceMode === undefined ? null : patch.voiceMode,
      ],
    );
    return rows[0] ?? null;
  }

  async get(workspaceId: string, callId: string): Promise<VoiceCallRow | null> {
    const { rows } = await this.pool.query<VoiceCallRow>(
      `SELECT * FROM voice_calls WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, callId],
    );
    return rows[0] ?? null;
  }

  async findByLivekitRoom(roomName: string): Promise<VoiceCallRow | null> {
    const { rows } = await this.pool.query<VoiceCallRow>(
      `SELECT * FROM voice_calls
       WHERE livekit_room_name = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [roomName],
    );
    return rows[0] ?? null;
  }

  async list(
    workspaceId: string,
    opts: {
      state?: string;
      direction?: CallDirection;
      limit: number;
      cursor?: string;
      q?: string;
      agentId?: string;
    },
  ): Promise<{ rows: VoiceCallRow[]; nextCursor?: string; total: number }> {
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const params: unknown[] = [workspaceId, opts.direction ?? null, opts.state ?? null];
    let whereExtra = "";

    if (opts.q) {
      params.push(`%${opts.q}%`);
      whereExtra += ` AND (caller ILIKE $${params.length} OR callee ILIKE $${params.length} OR id::text ILIKE $${params.length})`;
    }

    if (opts.agentId) {
      params.push(opts.agentId);
      whereExtra += ` AND agent_id = $${params.length}`;
    }

    const countRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM voice_calls
       WHERE workspace_id = $1
         AND ($2::text IS NULL OR direction = $2)
         AND ($3::text IS NULL OR state = $3)
         ${whereExtra}`,
      params,
    );
    const total = Number(countRes.rows[0]?.count ?? 0);

    let cursorClause = "";
    if (opts.cursor) {
      params.push(opts.cursor);
      cursorClause = ` AND started_at < $${params.length}::timestamptz`;
    }

    params.push(limit + 1);
    const limitParamIdx = params.length;

    const { rows } = await this.pool.query<VoiceCallRow>(
      `SELECT * FROM voice_calls
       WHERE workspace_id = $1
         AND ($2::text IS NULL OR direction = $2)
         AND ($3::text IS NULL OR state = $3)
         ${whereExtra}
         ${cursorClause}
       ORDER BY started_at DESC
       LIMIT $${limitParamIdx}`,
      params,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      rows: page,
      nextCursor: hasMore ? page[page.length - 1]?.started_at.toISOString() : undefined,
      total,
    };
  }

  async summary(workspaceId: string): Promise<VoiceInboundSummary> {
    const { rows } = await this.pool.query<{
      total_inbound: string;
      answered_count: string;
      avg_duration: string | null;
      avg_ttfa: string | null;
    }>(
      `SELECT
        COUNT(*)::text as total_inbound,
        COUNT(*) FILTER (WHERE state = 'completed' OR state = 'live')::text as answered_count,
        AVG(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at))) FILTER (WHERE state = 'completed')::text as avg_duration,
        AVG(time_to_first_audio_ms) FILTER (WHERE time_to_first_audio_ms IS NOT NULL)::text as avg_ttfa
       FROM voice_calls
       WHERE workspace_id = $1 AND direction = 'inbound'`,
      [workspaceId],
    );

    const liveCalls = await this.listLive(workspaceId, "inbound");
    const row = rows[0];
    const totalInbound = Number(row?.total_inbound ?? 0);
    const answeredCount = Number(row?.answered_count ?? 0);
    const answerRate = totalInbound > 0 ? Number(((answeredCount / totalInbound) * 100).toFixed(1)) : 0;
    const avgDuration = row?.avg_duration ? Math.round(Number(row.avg_duration)) : 0;
    const avgTtfa = row?.avg_ttfa ? Math.round(Number(row.avg_ttfa)) : null;

    return {
      totalInbound,
      averageCallDurationSeconds: avgDuration,
      answerRate,
      averageTimeToFirstAudioMs: avgTtfa,
      activeCallsCount: liveCalls.length,
    };
  }

  async waveform(workspaceId: string, callId: string): Promise<VoiceWaveform | null> {
    const call = await this.get(workspaceId, callId);
    if (!call) return null;
    const ended = call.ended_at?.getTime() ?? Date.now();
    const durationSeconds = Math.max(1, Math.floor((ended - call.started_at.getTime()) / 1000));
    const transcript = await this.listTranscript(workspaceId, callId);
    const stereo = Boolean(call.caller_recording_object_key);

    const agentPeaks = computeNormalizedPeaks(durationSeconds, transcript, "agent", 80);
    const callerPeaks = computeNormalizedPeaks(durationSeconds, transcript, "caller", 80);

    return {
      agentPeaks,
      callerPeaks,
      durationSeconds,
      stereo,
      sampleRate: 8000,
    };
  }

  async listLive(workspaceId: string, direction?: CallDirection): Promise<VoiceCallRow[]> {
    await this.pool.query(
      `UPDATE voice_calls
       SET state = 'completed',
           ended_at = COALESCE(ended_at, NOW()),
           duration_seconds = GREATEST(
             1,
             FLOOR(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at)))::integer
           )
       WHERE workspace_id = $1
         AND state IN ('ringing', 'live')
         AND started_at <= NOW() - INTERVAL '1 hour'`,
      [workspaceId],
    );
    const { rows } = await this.pool.query<VoiceCallRow>(
      `SELECT * FROM voice_calls
       WHERE workspace_id = $1
         AND state IN ('ringing', 'live')
         AND ($2::text IS NULL OR direction = $2)
       ORDER BY started_at DESC`,
      [workspaceId, direction ?? null],
    );
    return rows;
  }

  async addTranscript(
    workspaceId: string,
    callId: string,
    segment: Omit<CallTranscriptSegment, "id"> & { id?: string },
  ): Promise<CallTranscriptSegment> {
    const id = segment.id ?? randomUUID();
    await this.pool.query(
      `INSERT INTO voice_transcript_segments (
        id, call_id, workspace_id, sequence, speaker, text, start_ms, end_ms, finalized
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        callId,
        workspaceId,
        segment.sequence,
        segment.speaker,
        segment.text,
        segment.start_ms,
        segment.end_ms,
        segment.finalized,
      ],
    );
    return { ...segment, id };
  }

  async listTranscript(workspaceId: string, callId: string): Promise<CallTranscriptSegment[]> {
    const { rows } = await this.pool.query<{
      id: string;
      sequence: number;
      speaker: "user" | "agent";
      text: string;
      start_ms: number;
      end_ms: number;
      finalized: boolean;
    }>(
      `SELECT id, sequence, speaker, text, start_ms, end_ms, finalized
       FROM voice_transcript_segments
       WHERE workspace_id = $1 AND call_id = $2
       ORDER BY sequence ASC`,
      [workspaceId, callId],
    );
    return rows;
  }

  async addTiming(
    workspaceId: string,
    callId: string,
    turnNumber: number,
    timing: CallStageTimings,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO voice_turn_timings (
        call_id, workspace_id, turn_number, stt_ms, runtime_ms, tts_ms, total_ms
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        callId,
        workspaceId,
        turnNumber,
        timing.stt_ms,
        timing.runtime_ms,
        timing.tts_ms,
        timing.total_ms,
      ],
    );
  }

  async listTimings(
    workspaceId: string,
    callId: string,
  ): Promise<Array<CallStageTimings & { turn_number: number; id: string }>> {
    const { rows } = await this.pool.query<{
      id: string;
      turn_number: number;
      stt_ms: number;
      runtime_ms: number;
      tts_ms: number;
      total_ms: number;
    }>(
      `SELECT id, turn_number, stt_ms, runtime_ms, tts_ms, total_ms
       FROM voice_turn_timings
       WHERE workspace_id = $1 AND call_id = $2
       ORDER BY turn_number ASC`,
      [workspaceId, callId],
    );
    return rows;
  }
}

/** In-memory repo for unit tests without Postgres. */
export class MemoryCallsRepository implements CallsRepository {
  private calls = new Map<string, VoiceCallRow>();
  private transcripts = new Map<string, CallTranscriptSegment[]>();
  private timings = new Map<string, Array<CallStageTimings & { turn_number: number; id: string }>>();

  async create(input: CreateCallInput): Promise<VoiceCallRow> {
    const row: VoiceCallRow = {
      id: input.id ?? randomUUID(),
      workspace_id: input.workspaceId,
      conversation_id: input.conversationId ?? null,
      agent_id: input.agentId ?? null,
      agent_version_id: input.agentVersionId ?? null,
      direction: input.direction,
      state: "ringing",
      voice_mode: input.voiceMode ?? "cascade",
      telephony_provider: input.telephonyProvider,
      caller: input.caller ?? null,
      callee: input.callee ?? null,
      failure_code: null,
      time_to_first_audio_ms: null,
      recording_object_key: null,
      started_at: new Date(),
      ended_at: null,
      livekit_room_name: input.livekitRoomName ?? null,
      phone_number_id: input.phoneNumberId ?? null,
      sip_call_id: input.sipCallId ?? null,
    };
    this.calls.set(row.id, row);
    return { ...row };
  }

  async updateState(
    workspaceId: string,
    callId: string,
    patch: Partial<{
      state: CallState;
      voiceMode: VoiceMode;
      conversationId: string | null;
      agentId: string | null;
      agentVersionId: string | null;
      caller: string | null;
      failureCode: string | null;
      timeToFirstAudioMs: number | null;
      recordingObjectKey: string | null;
      callerRecordingObjectKey: string | null;
      endedAt: Date | null;
      providerCallSid?: string | null;
      streamSid?: string | null;
      recordingUrl?: string | null;
      durationSeconds?: number | null;
      amdStatus?: string | null;
      hangupCause?: string | null;
      livekitRoomName?: string | null;
      livekitParticipantSid?: string | null;
      phoneNumberId?: string | null;
      sipCallId?: string | null;
    }>,
  ): Promise<VoiceCallRow | null> {
    const row = this.calls.get(callId);
    if (!row || row.workspace_id !== workspaceId) return null;
    if (patch.state !== undefined) row.state = patch.state;
    if (patch.voiceMode !== undefined) row.voice_mode = patch.voiceMode;
    if (patch.conversationId !== undefined) row.conversation_id = patch.conversationId;
    if (patch.agentId !== undefined) row.agent_id = patch.agentId;
    if (patch.agentVersionId !== undefined) row.agent_version_id = patch.agentVersionId;
    if (patch.caller !== undefined) row.caller = patch.caller;
    if (patch.failureCode !== undefined) row.failure_code = patch.failureCode;
    if (patch.timeToFirstAudioMs !== undefined) row.time_to_first_audio_ms = patch.timeToFirstAudioMs;
    if (patch.recordingObjectKey !== undefined) row.recording_object_key = patch.recordingObjectKey;
    if (patch.callerRecordingObjectKey !== undefined) {
      row.caller_recording_object_key = patch.callerRecordingObjectKey;
    }
    if (patch.endedAt !== undefined) row.ended_at = patch.endedAt;
    if (patch.providerCallSid !== undefined) row.provider_call_sid = patch.providerCallSid;
    if (patch.streamSid !== undefined) row.stream_sid = patch.streamSid;
    if (patch.recordingUrl !== undefined) row.recording_url = patch.recordingUrl;
    if (patch.durationSeconds !== undefined) row.duration_seconds = patch.durationSeconds;
    if (patch.amdStatus !== undefined) row.amd_status = patch.amdStatus;
    if (patch.hangupCause !== undefined) row.hangup_cause = patch.hangupCause;
    if (patch.livekitRoomName !== undefined) row.livekit_room_name = patch.livekitRoomName;
    if (patch.livekitParticipantSid !== undefined) {
      row.livekit_participant_sid = patch.livekitParticipantSid;
    }
    if (patch.phoneNumberId !== undefined) row.phone_number_id = patch.phoneNumberId;
    if (patch.sipCallId !== undefined) row.sip_call_id = patch.sipCallId;
    return { ...row };
  }

  async get(workspaceId: string, callId: string): Promise<VoiceCallRow | null> {
    const row = this.calls.get(callId);
    if (!row || row.workspace_id !== workspaceId) return null;
    return { ...row };
  }

  async findByLivekitRoom(roomName: string): Promise<VoiceCallRow | null> {
    const row = [...this.calls.values()].find((call) => call.livekit_room_name === roomName);
    return row ? { ...row } : null;
  }

  async list(
    workspaceId: string,
    opts: {
      state?: string;
      direction?: CallDirection;
      limit: number;
      cursor?: string;
      q?: string;
      agentId?: string;
    },
  ): Promise<{ rows: VoiceCallRow[]; nextCursor?: string; total: number }> {
    let rows = [...this.calls.values()].filter((c) => c.workspace_id === workspaceId);
    if (opts.direction) rows = rows.filter((c) => c.direction === opts.direction);
    if (opts.state) rows = rows.filter((c) => c.state === opts.state);
    if (opts.agentId) rows = rows.filter((c) => c.agent_id === opts.agentId);
    if (opts.q) {
      const qLower = opts.q.toLowerCase();
      rows = rows.filter(
        (c) =>
          (c.caller && c.caller.toLowerCase().includes(qLower)) ||
          (c.callee && c.callee.toLowerCase().includes(qLower)) ||
          c.id.toLowerCase().includes(qLower),
      );
    }
    const total = rows.length;
    rows.sort((a, b) => b.started_at.getTime() - a.started_at.getTime());
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      rows: page,
      nextCursor: hasMore ? page[page.length - 1]?.started_at.toISOString() : undefined,
      total,
    };
  }

  async summary(workspaceId: string): Promise<VoiceInboundSummary> {
    const inbound = [...this.calls.values()].filter(
      (c) => c.workspace_id === workspaceId && c.direction === "inbound",
    );
    const completed = inbound.filter((c) => c.state === "completed");
    const live = inbound.filter((c) => c.state === "live" || c.state === "ringing");
    const answeredCount = completed.length + live.filter((c) => c.state === "live").length;
    const answerRate =
      inbound.length > 0 ? Number(((answeredCount / inbound.length) * 100).toFixed(1)) : 0;

    let totalDuration = 0;
    for (const c of completed) {
      const ended = c.ended_at?.getTime() ?? c.started_at.getTime();
      totalDuration += Math.max(0, Math.floor((ended - c.started_at.getTime()) / 1000));
    }
    const avgDuration = completed.length > 0 ? Math.round(totalDuration / completed.length) : 0;

    const ttfaValues = completed
      .map((c) => c.time_to_first_audio_ms)
      .filter((v): v is number => typeof v === "number");
    const avgTtfa =
      ttfaValues.length > 0
        ? Math.round(ttfaValues.reduce((a, b) => a + b, 0) / ttfaValues.length)
        : null;

    return {
      totalInbound: inbound.length,
      averageCallDurationSeconds: avgDuration,
      answerRate,
      averageTimeToFirstAudioMs: avgTtfa,
      activeCallsCount: live.length,
    };
  }

  async waveform(workspaceId: string, callId: string): Promise<VoiceWaveform | null> {
    const call = await this.get(workspaceId, callId);
    if (!call) return null;
    const ended = call.ended_at?.getTime() ?? Date.now();
    const durationSeconds = Math.max(1, Math.floor((ended - call.started_at.getTime()) / 1000));
    const transcript = await this.listTranscript(workspaceId, callId);
    const stereo = Boolean(call.caller_recording_object_key);

    return {
      agentPeaks: computeNormalizedPeaks(durationSeconds, transcript, "agent", 80),
      callerPeaks: computeNormalizedPeaks(durationSeconds, transcript, "caller", 80),
      durationSeconds,
      stereo,
      sampleRate: 8000,
    };
  }

  async listLive(workspaceId: string, direction?: CallDirection): Promise<VoiceCallRow[]> {
    return [...this.calls.values()].filter(
      (c) =>
        c.workspace_id === workspaceId &&
        (c.state === "ringing" || c.state === "live") &&
        (!direction || c.direction === direction),
    );
  }

  async addTranscript(
    workspaceId: string,
    callId: string,
    segment: Omit<CallTranscriptSegment, "id"> & { id?: string },
  ): Promise<CallTranscriptSegment> {
    void workspaceId;
    const id = segment.id ?? randomUUID();
    const full = { ...segment, id };
    const list = this.transcripts.get(callId) ?? [];
    list.push(full);
    this.transcripts.set(callId, list);
    return full;
  }

  async listTranscript(workspaceId: string, callId: string): Promise<CallTranscriptSegment[]> {
    void workspaceId;
    return [...(this.transcripts.get(callId) ?? [])];
  }

  async addTiming(
    workspaceId: string,
    callId: string,
    turnNumber: number,
    timing: CallStageTimings,
  ): Promise<void> {
    void workspaceId;
    const list = this.timings.get(callId) ?? [];
    list.push({ ...timing, turn_number: turnNumber, id: randomUUID() });
    this.timings.set(callId, list);
  }

  async listTimings(
    workspaceId: string,
    callId: string,
  ): Promise<Array<CallStageTimings & { turn_number: number; id: string }>> {
    void workspaceId;
    return [...(this.timings.get(callId) ?? [])];
  }
}

export function computeNormalizedPeaks(
  durationSeconds: number,
  segments: CallTranscriptSegment[],
  channel: "agent" | "caller",
  totalPoints = 80,
): number[] {
  const peaks: number[] = new Array(totalPoints).fill(0.06);
  const totalMs = Math.max(durationSeconds * 1000, 1000);
  const channelSegments = segments.filter((s) =>
    channel === "agent" ? s.speaker === "agent" : s.speaker === "user",
  );

  for (const seg of channelSegments) {
    const startRatio = Math.max(0, Math.min(1, seg.start_ms / totalMs));
    const endRatio = Math.max(0, Math.min(1, seg.end_ms / totalMs));
    const startIdx = Math.floor(startRatio * totalPoints);
    const endIdx = Math.min(totalPoints - 1, Math.ceil(endRatio * totalPoints));

    for (let i = startIdx; i <= endIdx; i++) {
      const pos = (i - startIdx) / Math.max(1, endIdx - startIdx);
      const envelope = Math.sin(pos * Math.PI);
      const variation = 0.4 + 0.5 * Math.abs(Math.sin(i * 1.7 + (channel === "agent" ? 0.3 : 1.2)));
      peaks[i] = Math.max(peaks[i], Math.min(0.98, Number((0.2 + envelope * variation).toFixed(2))));
    }
  }

  // Smooth adjacent points
  return peaks.map((p) => Number(p.toFixed(2)));
}
