import { AppError, ErrorCode } from "@quickstart/errors";
import type { Logger } from "@quickstart/logging";
import { requestIdFromResponse, sendPlatformJson, type RequestHandler } from "@quickstart/http-server";
import type { CapLease, CallCaps } from "../caps/call-caps.js";
import type { UsageIngestClient } from "../clients/usage.client.js";
import type { ConversationClient } from "../clients/conversation.client.js";
import type { CallsRepository, VoiceCallRow } from "../repository/calls.repository.js";
import type { PhoneNumbersService } from "../services/phone-numbers.service.js";
import type { StatusIdempotencyStore } from "../telephony/status-idempotency.js";
import {
  numberIdFromRoomName,
  type SipProvisioner,
} from "../telephony/livekit/sip-provisioner.js";
import type { TelnyxNumbersClient } from "../telephony/telnyx/types.js";
import type { InboundCallBridge } from "../livekit/types.js";
import type { TelephonyRouter } from "../telephony/router.js";
import type { WidgetVoiceLiveSessionManager } from "../widget-voice/session-manager.js";

const SIP_PARTICIPANT_KIND = 3;
const TERMINAL_CALL_STATES = new Set(["completed", "failed", "busy", "no_answer", "canceled"]);

function rawBodyOf(req: { body?: unknown; rawBody?: string }): string {
  if (typeof req.rawBody === "string") return req.rawBody;
  if (typeof req.body === "string") return req.body;
  return JSON.stringify(req.body ?? {});
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

export type InboundCallsDeps = {
  provisioner: SipProvisioner;
  phoneNumbers: PhoneNumbersService;
  telnyx: TelnyxNumbersClient;
  calls: CallsRepository;
  caps: CallCaps;
  conversations: ConversationClient;
  statusIdempotency: StatusIdempotencyStore;
  bridge?: InboundCallBridge | null;
  telephony?: TelephonyRouter;
  widgetSessions?: WidgetVoiceLiveSessionManager | null;
  usageIngest?: UsageIngestClient;
  logger: Logger;
};

/**
 * Public inbound webhooks.
 *
 * Telnyx authenticates number-order notifications with Ed25519.
 * LiveKit authenticates room lifecycle events with its own signed webhook token.
 * Neither route uses staff auth.
 */
export function createInboundCallsController(deps: InboundCallsDeps) {
  const leases = new Map<string, CapLease>();
  const blockedRooms = new Map<string, string>();
  const startedRooms = new Set<string>();

  async function ensureCall(
    roomName: string,
  ): Promise<{ call: VoiceCallRow; agentId: string | null } | null> {
    const existing = await deps.calls.findByLivekitRoom(roomName);
    if (existing) {
      if (typeof existing.agent_id === "string") {
        return { call: existing, agentId: existing.agent_id };
      }
      return { call: existing, agentId: null };
    }

    const numberId = numberIdFromRoomName(roomName);
    if (!numberId) return null;
    const route = await deps.phoneNumbers.resolveInboundByNumberId(numberId);
    if (!route) return null;

    const call = await deps.calls.create({
      workspaceId: route.workspaceId,
      agentId: route.agentId,
      direction: "inbound",
      telephonyProvider: "telnyx",
      callee: route.e164,
      livekitRoomName: roomName,
      phoneNumberId: route.numberId,
    });

    if (!route.agentId) {
      blockedRooms.set(roomName, "no_agent_assigned");
      await deps.calls.updateState(route.workspaceId, call.id, {
        state: "failed",
        failureCode: "no_agent_assigned",
        endedAt: new Date(),
      });
      return { call, agentId: null };
    }

    try {
      const lease = await deps.caps.tryAcquire(route.workspaceId, "inbound");
      leases.set(roomName, lease);
    } catch (err) {
      const reason = err instanceof AppError ? err.message : "capacity_exceeded";
      blockedRooms.set(roomName, "capacity_exceeded");
      await deps.calls.updateState(route.workspaceId, call.id, {
        state: "failed",
        failureCode: reason.slice(0, 200),
        endedAt: new Date(),
      });
    }

    return { call, agentId: route.agentId };
  }

  async function finishCall(roomName: string): Promise<void> {
    const call = await deps.calls.findByLivekitRoom(roomName);
    if (!call) return;
    if (TERMINAL_CALL_STATES.has(call.state)) {
      await releaseLease(roomName);
      return;
    }

    if (deps.bridge) {
      await deps.bridge.stop(roomName).catch((err: unknown) => {
        deps.logger.warn("livekit.bridge.stop_failed", {
          room: roomName,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    startedRooms.delete(roomName);

    const endedAt = new Date();
    const durationSeconds = Math.max(
      1,
      Math.round((endedAt.getTime() - call.started_at.getTime()) / 1000),
    );
    await deps.calls.updateState(call.workspace_id, call.id, {
      state: "completed",
      durationSeconds,
      endedAt,
    });
    await releaseLease(roomName);

    deps.usageIngest?.emit({
      workspace_id: call.workspace_id,
      kind: "voice",
      units: durationSeconds / 60,
      unit_label: "minutes",
      provider: "telnyx",
      idempotency_key: `telephony:${call.workspace_id}:${call.id}:livekit_completed`,
      request_id: roomName,
      source_id: call.id,
      detail: { call_id: call.id, room: roomName, duration_seconds: durationSeconds },
    });
  }

  async function releaseLease(roomName: string): Promise<void> {
    const lease = leases.get(roomName);
    if (!lease) return;
    leases.delete(roomName);
    await deps.caps.release(lease).catch(() => undefined);
  }

  /**
   * Create the conversation and join the media bridge as early as possible.
   * Running this at `room_started` pre-opens Deepgram and the agent brief before
   * the SIP caller is connected, so the first words are not lost to setup time.
   */
  async function startBridge(
    call: VoiceCallRow,
    agentId: string | null,
    caller: string | null,
  ): Promise<string | null> {
    const roomName = call.livekit_room_name ?? "";
    if (!roomName || !agentId || blockedRooms.has(roomName)) return call.conversation_id;

    let conversationId = call.conversation_id;
    if (!conversationId) {
      const conversation = await deps.conversations
        .createWidgetConversation({
          workspaceId: call.workspace_id,
          agentId,
        })
        .catch((err: unknown) => {
          deps.logger.error("livekit.call.conversation_failed", {
            room: roomName,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        });
      conversationId = conversation?.id ?? null;
      if (conversationId) {
        await deps.calls
          .updateState(call.workspace_id, call.id, { conversationId })
          .catch(() => undefined);
      }
    }

    if (deps.bridge && conversationId && !startedRooms.has(roomName)) {
      startedRooms.add(roomName);
      try {
        await deps.bridge.start({
          roomName,
          workspaceId: call.workspace_id,
          agentId,
          callId: call.id,
          conversationId,
          caller,
        });
      } catch (err) {
        startedRooms.delete(roomName);
        blockedRooms.set(roomName, "bridge_failed");
        deps.logger.error("livekit.bridge.start_failed", {
          room: roomName,
          error: err instanceof Error ? err.message : String(err),
        });
        await deps.calls
          .updateState(call.workspace_id, call.id, {
            state: "failed",
            failureCode: "bridge_failed",
            endedAt: new Date(),
          })
          .catch(() => undefined);
      }
    }

    return conversationId;
  }

  return {
    staffStopCall: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const workspaceId = String(req.params.workspaceId ?? "");
      const callId = String(req.params.callId ?? "");
      const call = await deps.calls.get(workspaceId, callId);
      if (!call || call.direction !== "inbound") {
        throw new AppError({
          code: ErrorCode.NOT_FOUND,
          message: "Call not found",
          requestId,
        });
      }
      if (TERMINAL_CALL_STATES.has(call.state)) {
        sendPlatformJson(res, 200, { request_id: requestId, stopped: true, already_ended: true });
        return;
      }

      if (call.livekit_room_name) {
        await deps.provisioner.endRoom(call.livekit_room_name);
        await finishCall(call.livekit_room_name);
      } else if (call.telephony_provider === "widget") {
        if (deps.widgetSessions) {
          await deps.widgetSessions.stopCall(workspaceId, callId);
        } else {
          const endedAt = new Date();
          await deps.calls.updateState(workspaceId, callId, {
            state: "completed",
            endedAt,
            durationSeconds: Math.max(1, Math.floor((endedAt.getTime() - call.started_at.getTime()) / 1000)),
          });
        }
      } else {
        if (call.provider_call_sid) {
          const provider = deps.telephony?.list().find((item) => item.id === call.telephony_provider);
          if (!provider) {
            throw new AppError({
              code: ErrorCode.UPSTREAM_UNAVAILABLE,
              message: "The call provider is unavailable, so the call could not be stopped",
              requestId,
            });
          }
          await provider.hangup(call.provider_call_sid);
        }
        const endedAt = new Date();
        await deps.calls.updateState(workspaceId, callId, {
          state: "completed",
          endedAt,
          durationSeconds: Math.max(1, Math.floor((endedAt.getTime() - call.started_at.getTime()) / 1000)),
        });
      }
      sendPlatformJson(res, 200, { request_id: requestId, stopped: true });
    }) as RequestHandler,

    /** Telnyx number-order / call event webhook. */
    telnyxWebhook: (async (req, res) => {
      const rawBody = rawBodyOf(req);
      const headers = req.headers as Record<string, string | string[] | undefined>;
      if (!deps.telnyx.verifyWebhook(headers, rawBody)) {
        sendPlatformJson(res, 401, {
          request_id: requestIdFromResponse(res),
          error: { code: "UNAUTHORIZED", message: "Invalid Telnyx signature" },
        });
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        sendPlatformJson(res, 400, {
          request_id: requestIdFromResponse(res),
          error: { code: "VALIDATION_FAILED", message: "Invalid JSON body" },
        });
        return;
      }
      const result = await deps.phoneNumbers.handleTelnyxEvent(body);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        accepted: true,
        handled: result.handled,
      });
    }) as RequestHandler,

    /** LiveKit room lifecycle webhook. */
    livekitWebhook: (async (req, res) => {
      const rawBody = rawBodyOf(req);
      const authorization = firstHeader(
        req.headers as Record<string, string | string[] | undefined>,
        "authorization",
      );
      const event = await deps.provisioner.verifyWebhook(rawBody, authorization);
      if (!event) {
        sendPlatformJson(res, 401, {
          request_id: requestIdFromResponse(res),
          error: { code: "UNAUTHORIZED", message: "Invalid LiveKit webhook signature" },
        });
        return;
      }

      const roomName = event.room?.name ?? "";
      const eventName = event.event;
      const participant = event.participant;

      if (!roomName) {
        sendPlatformJson(res, 200, {
          request_id: requestIdFromResponse(res),
          accepted: true,
          ignored: "missing_room",
        });
        return;
      }

      if (eventName === "room_started") {
        const first = await deps.statusIdempotency.claim(roomName, "room_started");
        if (first) {
          const ensured = await ensureCall(roomName);
          if (ensured) {
            await startBridge(ensured.call, ensured.agentId, ensured.call.caller);
          }
        }
        sendPlatformJson(res, 200, {
          request_id: requestIdFromResponse(res),
          accepted: true,
          duplicate: !first,
        });
        return;
      }

      if (eventName === "participant_joined" && participant) {
        const isSip =
          Number(participant.kind) === SIP_PARTICIPANT_KIND ||
          Object.keys(participant.attributes ?? {}).some((key) => key.startsWith("sip."));
        const isBridge = participant.identity.startsWith("qs-bridge-");
        if (!isSip || isBridge) {
          sendPlatformJson(res, 200, {
            request_id: requestIdFromResponse(res),
            accepted: true,
            ignored: "not_a_sip_participant",
          });
          return;
        }

        const first = await deps.statusIdempotency.claim(
          `${roomName}:${participant.sid}`,
          "participant_joined",
        );
        if (!first) {
          sendPlatformJson(res, 200, {
            request_id: requestIdFromResponse(res),
            accepted: true,
            duplicate: true,
          });
          return;
        }

        const ensured = await ensureCall(roomName);
        if (!ensured) {
          sendPlatformJson(res, 200, {
            request_id: requestIdFromResponse(res),
            accepted: true,
            ignored: "unknown_number",
          });
          return;
        }

        const blocked = blockedRooms.get(roomName);
        if (blocked) {
          await deps.provisioner.removeParticipant(roomName, participant.identity);
          sendPlatformJson(res, 200, {
            request_id: requestIdFromResponse(res),
            accepted: true,
            rejected: blocked,
          });
          return;
        }

        const attributes = participant.attributes ?? {};
        const caller =
          attributes["sip.phoneNumber"] ??
          attributes["sip.from"] ??
          attributes["sip.trunkPhoneNumber"] ??
          null;
        const sipCallId = attributes["sip.callID"] ?? null;

        await deps.calls.updateState(ensured.call.workspace_id, ensured.call.id, {
          state: "live",
          caller,
          livekitParticipantSid: participant.sid,
          sipCallId,
        });

        // Usually the bridge was already prewarmed at room_started; this is
        // both the normal path and the fallback when room_started was missed.
        const conversationId = await startBridge(ensured.call, ensured.agentId, caller);

        sendPlatformJson(res, 200, {
          request_id: requestIdFromResponse(res),
          accepted: true,
          call_id: ensured.call.id,
          conversation_id: conversationId,
        });
        return;
      }

      if (eventName === "participant_left" && participant) {
        const isSip =
          Number(participant.kind) === SIP_PARTICIPANT_KIND ||
          Object.keys(participant.attributes ?? {}).some((key) => key.startsWith("sip."));
        if (!isSip) {
          sendPlatformJson(res, 200, {
            request_id: requestIdFromResponse(res),
            accepted: true,
            ignored: "not_a_sip_participant",
          });
          return;
        }
        const first = await deps.statusIdempotency.claim(roomName, "terminal");
        if (first) await finishCall(roomName);
        sendPlatformJson(res, 200, {
          request_id: requestIdFromResponse(res),
          accepted: true,
          duplicate: !first,
        });
        return;
      }

      if (eventName === "room_finished") {
        const first = await deps.statusIdempotency.claim(roomName, "terminal");
        if (first) await finishCall(roomName);
        sendPlatformJson(res, 200, {
          request_id: requestIdFromResponse(res),
          accepted: true,
          duplicate: !first,
        });
        return;
      }

      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        accepted: true,
        ignored: eventName,
      });
    }) as RequestHandler,
  };
}
