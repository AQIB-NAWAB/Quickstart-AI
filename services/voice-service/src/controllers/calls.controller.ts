import { requestIdFromResponse, sendPlatformJson, type RequestHandler } from "@quickstart/http-server";
import type { CallsRepository } from "../repository/calls.repository.js";
import type { RecordingStore } from "../repository/recording.store.js";
import type { CallSessionOrchestrator } from "../session/orchestrator.js";
import type { ConversationClient } from "../clients/conversation.client.js";
import { routeParam } from "../lib/route-param.js";
import type { CallDirection, VoiceMode } from "@quickstart/contracts";

export function createCallsController(
  calls: CallsRepository,
  orchestrator: CallSessionOrchestrator,
  recordings: RecordingStore,
  conversations: ConversationClient,
) {
  return {
    listInbound: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const result = await calls.list(workspaceId, {
        direction: "inbound",
        state: typeof req.query.status === "string" ? req.query.status : undefined,
        limit: Number(req.query.limit ?? 50),
        cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        agentId: typeof req.query.agent_id === "string" ? req.query.agent_id : undefined,
      });
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        calls: result.rows.map(toStaffCall),
        next_cursor: result.nextCursor,
        total: result.total,
      });
    }) as RequestHandler,

    summary: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const data = await calls.summary(workspaceId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        summary: {
          total_inbound: data.totalInbound,
          average_call_duration_seconds: data.averageCallDurationSeconds,
          answer_rate: data.answerRate,
          average_time_to_first_audio_ms: data.averageTimeToFirstAudioMs,
          active_calls_count: data.activeCallsCount,
        },
      });
    }) as RequestHandler,

    listLiveInbound: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const rows = await calls.listLive(workspaceId, "inbound");
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        calls: rows.map(toStaffCall),
      });
    }) as RequestHandler,

    simulateInbound: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const body = (req.body ?? {}) as { agent_id?: string; utterance_text?: string; caller?: string };
      const agentId = body.agent_id?.trim();
      const utteranceText = body.utterance_text?.trim();
      if (!agentId || !utteranceText) {
        sendPlatformJson(res, 400, {
          request_id: requestIdFromResponse(res),
          error: { code: "VALIDATION_FAILED", message: "agent_id and utterance_text are required" },
        });
        return;
      }

      const conversation = await conversations.createWidgetConversation({ workspaceId, agentId });
      const result = await orchestrator.simulateCall({
        workspaceId,
        conversationId: conversation.id,
        agentId,
        direction: "inbound",
        caller: body.caller?.trim() || "+15550192834",
        utterance: { bytes: Buffer.from(utteranceText, "utf8"), encoding: "fake", sampleRateHz: 8000 },
        voiceMode: "cascade",
        telephonyProvider: "fake",
        authHeaders: {
          authorization: typeof req.headers.authorization === "string" ? req.headers.authorization : "",
        },
        requestId: requestIdFromResponse(res),
      });

      sendPlatformJson(res, 201, { request_id: requestIdFromResponse(res), result });
    }) as RequestHandler,

    getInbound: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const callId = routeParam(req.params.callId);
      const row = await calls.get(workspaceId, callId);
      if (!row || row.direction !== "inbound") {
        sendPlatformJson(res, 404, {
          request_id: requestIdFromResponse(res),
          error: { code: "NOT_FOUND", message: "Call not found" },
        });
        return;
      }
      const transcript = await calls.listTranscript(workspaceId, callId);
      const timings = await calls.listTimings(workspaceId, callId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        call: {
          ...toStaffCall(row),
          recording_available: Boolean(row.recording_object_key),
          recording_url: row.recording_object_key ? "available" : null,
          caller_recording_available: Boolean(row.caller_recording_object_key),
          recording_offset_ms: row.recording_offset_ms ?? 0,
          caller_recording_offset_ms: row.caller_recording_offset_ms ?? 0,
          transcript,
          processing_turns: timings.map((t) => ({
            id: t.id,
            turn_number: t.turn_number,
            stt_ms: t.stt_ms,
            llm_ms: t.runtime_ms,
            tts_ms: t.tts_ms,
            total_ms: t.total_ms,
            is_additive: true,
          })),
          disposition: row.state,
        },
      });
    }) as RequestHandler,

    getTranscript: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const callId = routeParam(req.params.callId);
      const row = await calls.get(workspaceId, callId);
      if (!row || row.direction !== "inbound") {
        sendPlatformJson(res, 404, {
          request_id: requestIdFromResponse(res),
          error: { code: "NOT_FOUND", message: "Call not found" },
        });
        return;
      }
      const transcript = await calls.listTranscript(workspaceId, callId);
      const timings = await calls.listTimings(workspaceId, callId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        transcript,
        processing_turns: timings.map((t) => ({
          id: t.id,
          turn_number: t.turn_number,
          stt_ms: t.stt_ms,
          llm_ms: t.runtime_ms,
          tts_ms: t.tts_ms,
          total_ms: t.total_ms,
          is_additive: true,
        })),
      });
    }) as RequestHandler,

    getWaveform: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const callId = routeParam(req.params.callId);
      const waveform = await calls.waveform(workspaceId, callId);
      if (!waveform) {
        sendPlatformJson(res, 404, {
          request_id: requestIdFromResponse(res),
          error: { code: "NOT_FOUND", message: "Waveform data not found" },
        });
        return;
      }
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        waveform: {
          agent_peaks: waveform.agentPeaks,
          caller_peaks: waveform.callerPeaks,
          duration_seconds: waveform.durationSeconds,
          stereo: waveform.stereo,
          sample_rate: waveform.sampleRate ?? 8000,
        },
      });
    }) as RequestHandler,

    getRecording: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const callId = routeParam(req.params.callId);
      const row = await calls.get(workspaceId, callId);
      const recordingTrack = typeof req.query.track === "string" ? req.query.track : "agent";
      const objectKey = recordingTrack === "caller"
        ? row?.caller_recording_object_key
        : row?.recording_object_key;
      if (!row || row.direction !== "inbound" || !objectKey) {
        sendPlatformJson(res, 404, {
          request_id: requestIdFromResponse(res),
          error: { code: "NOT_FOUND", message: "Call recording not found" },
        });
        return;
      }
      const bytes = await recordings.getBytes(objectKey);
      if (!bytes) {
        sendPlatformJson(res, 404, {
          request_id: requestIdFromResponse(res),
          error: { code: "NOT_FOUND", message: "Call recording not found" },
        });
        return;
      }
      const extension = objectKey.split(".").pop()?.toLowerCase();
      const contentType = extension === "webm" ? "audio/webm" : extension === "mp3" ? "audio/mpeg" : extension === "ogg" ? "audio/ogg" : extension === "wav" ? "audio/wav" : "application/octet-stream";
      const range = typeof req.headers.range === "string" ? req.headers.range : "";
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let body = bytes;
      let status = 200;
      if (match && bytes.length > 0) {
        const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2] || 0));
        const end = match[2] && match[1] ? Math.min(bytes.length - 1, Number(match[2])) : bytes.length - 1;
        if (start <= end && start < bytes.length) {
          body = bytes.subarray(start, end + 1);
          status = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
        }
      }
      res.status(status);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", body.length);
      res.setHeader("Content-Disposition", `inline; filename="${callId}.${extension ?? "audio"}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(body);
    }) as RequestHandler,

    listOutbound: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const result = await calls.list(workspaceId, {
        direction: "outbound",
        limit: Number(req.query.limit ?? 50),
        cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      });
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        calls: result.rows.map(toStaffCall),
        next_cursor: result.nextCursor,
      });
    }) as RequestHandler,

    simulate: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const body = (req.body ?? {}) as {
        conversation_id?: string;
        agent_id?: string;
        utterance_audio_b64?: string;
        utterance_text?: string;
        direction?: CallDirection;
        caller?: string;
        voice_mode?: VoiceMode;
        telephony_provider?: string;
        call_id?: string;
        tools_count?: number;
        knowledge_enabled?: boolean;
      };
      if (!body.conversation_id) {
        sendPlatformJson(res, 400, {
          request_id: requestIdFromResponse(res),
          error: { code: "VALIDATION_FAILED", message: "conversation_id is required" },
        });
        return;
      }
      const text = body.utterance_text ?? "hello from caller";
      const bytes = body.utterance_audio_b64
        ? Buffer.from(body.utterance_audio_b64, "base64")
        : Buffer.from(text, "utf8");

      const result = await orchestrator.simulateCall({
        workspaceId,
        conversationId: body.conversation_id,
        agentId: body.agent_id,
        direction: body.direction ?? "inbound",
        caller: body.caller,
        utterance: { bytes, encoding: "fake", sampleRateHz: 8000 },
        voiceMode: body.voice_mode,
        telephonyProvider: body.telephony_provider,
        callId: body.call_id,
        toolsCount: body.tools_count,
        knowledgeEnabled: body.knowledge_enabled,
        authHeaders: {
          authorization: typeof req.headers.authorization === "string" ? req.headers.authorization : "",
        },
        requestId: requestIdFromResponse(res),
      });

      sendPlatformJson(res, 201, {
        request_id: requestIdFromResponse(res),
        result,
      });
    }) as RequestHandler,
  };
}

function toStaffCall(row: {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  agent_id: string | null;
  direction: string;
  state: string;
  caller: string | null;
  callee: string | null;
  time_to_first_audio_ms: number | null;
  started_at: Date;
  ended_at: Date | null;
}) {
  const ended = row.ended_at?.getTime() ?? Date.now();
  const durationSeconds = Math.max(0, Math.floor((ended - row.started_at.getTime()) / 1000));
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    conversation_id: row.conversation_id,
    agent_id: row.agent_id,
    direction: row.direction,
    status: row.state === "ringing" || row.state === "live" ? (row.state === "live" ? "live" : "live") : row.state,
    caller: row.caller ?? row.callee ?? "unknown",
    started_at: row.started_at.toISOString(),
    ended_at: row.ended_at?.toISOString() ?? null,
    duration_seconds: durationSeconds,
    time_to_first_audio_ms: row.time_to_first_audio_ms,
  };
}
