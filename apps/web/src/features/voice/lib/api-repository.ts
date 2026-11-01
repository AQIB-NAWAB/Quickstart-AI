import type {
  AvailablePhoneNumber,
  CallLogFilters,
  InboundCall,
  InboundCallDetail,
  PhoneNumberSearchFilters,
  PhoneNumberStatus,
  PhoneNumberType,
  RepositoryResult,
  SimulatedInboundCallResult,
  UpdatePhoneNumberInput,
  WorkspacePhoneNumber,
  VoiceRepository,
} from "./types";

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<RepositoryResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      signal,
      credentials: "include",
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      return { status: "forbidden", message: "Not allowed to manage phone numbers." };
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    } & Record<string, unknown>;
    if (!res.ok) {
      return {
        status: res.status === 404 ? "not_found" : "error",
        message: body.error?.message ?? "Phone number request failed.",
      };
    }
    return { status: "ready", data: body as T };
  } catch {
    return { status: "unavailable", message: "Voice service is not available." };
  }
}

function mapPhoneNumber(raw: Record<string, unknown>): WorkspacePhoneNumber {
  const capabilities =
    raw.capabilities && typeof raw.capabilities === "object"
      ? (raw.capabilities as { voice?: boolean; sms?: boolean })
      : undefined;
  return {
    id: String(raw.id ?? ""),
    workspace_id: raw.workspace_id == null ? null : String(raw.workspace_id),
    phone_number: String(raw.phone_number ?? ""),
    friendly_name: raw.friendly_name == null ? null : String(raw.friendly_name),
    provider: String(raw.provider ?? "telnyx"),
    provider_number_id: raw.provider_number_id == null ? null : String(raw.provider_number_id),
    provider_connection_id:
      raw.provider_connection_id == null ? null : String(raw.provider_connection_id),
    assigned_agent_id: raw.assigned_agent_id == null ? null : String(raw.assigned_agent_id),
    status: String(raw.status ?? "pending") as PhoneNumberStatus,
    inbound_status: String(raw.inbound_status ?? "pending") as PhoneNumberStatus,
    livekit_trunk_id: raw.livekit_trunk_id == null ? null : String(raw.livekit_trunk_id),
    livekit_dispatch_rule_id:
      raw.livekit_dispatch_rule_id == null ? null : String(raw.livekit_dispatch_rule_id),
    country_code: raw.country_code == null ? null : String(raw.country_code),
    number_type: raw.number_type == null ? null : (String(raw.number_type) as PhoneNumberType),
    region: raw.region == null ? null : String(raw.region),
    locality: raw.locality == null ? null : String(raw.locality),
    monthly_cost: raw.monthly_cost == null ? null : Number(raw.monthly_cost),
    currency: raw.currency == null ? null : String(raw.currency),
    capabilities: { voice: capabilities?.voice !== false, sms: capabilities?.sms === true },
    provisioning_error: raw.provisioning_error == null ? null : String(raw.provisioning_error),
    purchased_at: raw.purchased_at == null ? null : String(raw.purchased_at),
    released_at: raw.released_at == null ? null : String(raw.released_at),
    created_at: String(raw.created_at ?? new Date().toISOString()),
    updated_at: String(raw.updated_at ?? new Date().toISOString()),
  };
}

function mapAvailable(raw: Record<string, unknown>): AvailablePhoneNumber {
  return {
    phone_number: String(raw.phone_number ?? ""),
    country_code: String(raw.country_code ?? "US"),
    number_type: String(raw.number_type ?? "local") as PhoneNumberType,
    region: raw.region == null ? null : String(raw.region),
    locality: raw.locality == null ? null : String(raw.locality),
    area_code: raw.area_code == null ? null : String(raw.area_code),
    monthly_cost: raw.monthly_cost == null ? null : Number(raw.monthly_cost),
    upfront_cost: raw.upfront_cost == null ? null : Number(raw.upfront_cost),
    currency: raw.currency == null ? null : String(raw.currency),
    features: Array.isArray(raw.features) ? (raw.features as string[]) : [],
    owned: Boolean(raw.owned),
    number_id: raw.number_id == null ? null : String(raw.number_id),
  };
}

function mapNumberList(raw: Record<string, unknown>): WorkspacePhoneNumber[] {
  return Array.isArray(raw.numbers)
    ? (raw.numbers as Record<string, unknown>[]).map(mapPhoneNumber)
    : [];
}

function mapPool(raw: Record<string, unknown>): WorkspacePhoneNumber[] {
  return Array.isArray(raw.pool)
    ? (raw.pool as Record<string, unknown>[]).map(mapPhoneNumber)
    : [];
}

function mapStatus(status: string): InboundCall["status"] {
  if (status === "live" || status === "ringing") return "live";
  if (status === "failed") return "failed";
  if (status === "transferred") return "transferred";
  return "completed";
}

function mapCall(raw: Record<string, unknown>): InboundCall {
  return {
    id: String(raw.id),
    workspaceId: String(raw.workspace_id ?? ""),
    caller: String(raw.caller ?? "unknown"),
    agentId: String(raw.agent_id ?? ""),
    agentName: String(raw.agent_id ?? "Agent"),
    startedAt: String(raw.started_at ?? new Date().toISOString()),
    endedAt: raw.ended_at ? String(raw.ended_at) : null,
    durationSeconds: Number(raw.duration_seconds ?? 0),
    status: mapStatus(String(raw.status ?? "completed")),
    timeToFirstAudioMs:
      raw.time_to_first_audio_ms == null ? null : Number(raw.time_to_first_audio_ms),
    conversationId: raw.conversation_id ? String(raw.conversation_id) : null,
  };
}

async function fetchJson(
  path: string,
  signal?: AbortSignal,
): Promise<RepositoryResult<Record<string, unknown>>> {
  try {
    const res = await fetch(path, { signal, credentials: "include" });
    if (res.status === 401 || res.status === 403) {
      return { status: "forbidden", message: "Not allowed to view voice calls." };
    }
    if (res.status === 404) {
      return { status: "not_found", message: "Call not found." };
    }
    if (!res.ok) {
      return { status: "unavailable", message: "Voice service is not available." };
    }
    return { status: "ready", data: (await res.json()) as Record<string, unknown> };
  } catch {
    return { status: "unavailable", message: "Voice service is not available." };
  }
}

export class ApiVoiceRepository implements VoiceRepository {
  async getInboundSummary(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<import("./types").VoiceInboundSummary>> {
    const result = await fetchJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/inbound/summary`,
      signal,
    );
    if (result.status !== "ready") return result;
    const raw = result.data as Record<string, unknown>;
    return {
      status: "ready",
      data: {
        totalCalls: Number(raw.total_calls ?? 0),
        completedCalls: Number(raw.completed_calls ?? 0),
        failedCalls: Number(raw.failed_calls ?? 0),
        avgDurationSeconds: Number(raw.avg_duration_seconds ?? 0),
        avgFirstAudioMs: Number(raw.avg_first_audio_ms ?? 0),
        activeCalls: Number(raw.active_calls ?? 0),
      },
    };
  }

  async listInboundCalls(
    workspaceId: string,
    filters?: CallLogFilters,
    signal?: AbortSignal,
  ): Promise<
    RepositoryResult<{
      calls: InboundCall[];
      total?: number;
      nextCursor?: string;
      prevCursor?: string;
    }>
  > {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.cursor) params.set("cursor", filters.cursor);
    if (filters?.q) params.set("q", filters.q);
    if (filters?.agentId) params.set("agent_id", filters.agentId);
    else if (filters?.agent) params.set("agent_id", filters.agent);
    const qs = params.toString();
    const result = await fetchJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/inbound${qs ? `?${qs}` : ""}`,
      signal,
    );
    if (result.status !== "ready") return result;
    const calls = Array.isArray(result.data.calls)
      ? (result.data.calls as Record<string, unknown>[]).map(mapCall)
      : [];
    return {
      status: "ready",
      data: {
        calls,
        total: typeof result.data.total === "number" ? result.data.total : calls.length,
        nextCursor: result.data.next_cursor ? String(result.data.next_cursor) : undefined,
      },
    };
  }

  async listLiveInboundCalls(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<InboundCall[]>> {
    const result = await fetchJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/inbound/live`,
      signal,
    );
    if (result.status !== "ready") return result;
    const calls = Array.isArray(result.data.calls)
      ? (result.data.calls as Record<string, unknown>[]).map(mapCall)
      : [];
    return { status: "ready", data: calls };
  }

  async stopLiveInboundCall(
    workspaceId: string,
    callId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<{ stopped: boolean }>> {
    return requestJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/inbound/${encodeURIComponent(callId)}/stop`,
      { method: "POST" },
      signal,
    );
  }

  async simulateInboundCall(
    workspaceId: string,
    input: { agent_id: string; utterance_text: string; caller?: string },
    signal?: AbortSignal,
  ): Promise<RepositoryResult<{ result: SimulatedInboundCallResult }>> {
    return requestJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/inbound/simulate`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
      signal,
    );
  }

  async getInboundCall(
    workspaceId: string,
    callId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<InboundCallDetail>> {
    const result = await fetchJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/inbound/${encodeURIComponent(callId)}`,
      signal,
    );
    if (result.status !== "ready") return result;
    const callRaw = (result.data.call ?? result.data) as Record<string, unknown>;
    const base = mapCall(callRaw);
    const transcript = Array.isArray(callRaw.transcript)
      ? (callRaw.transcript as Record<string, unknown>[]).map((t, i) => ({
          id: String(t.id ?? i),
          sequence: Number(t.sequence ?? i),
          speaker: (t.speaker === "agent" ? "agent" : "user") as "user" | "agent",
          text: String(t.text ?? ""),
          startMs: Number(t.start_ms ?? 0),
          endMs: Number(t.end_ms ?? 0),
        }))
      : [];
    const processingTurns = Array.isArray(callRaw.processing_turns)
      ? (callRaw.processing_turns as Record<string, unknown>[]).map((t, i) => ({
          id: String(t.id ?? i),
          turnNumber: Number(t.turn_number ?? i + 1),
          sttMs: Number(t.stt_ms ?? 0),
          llmMs: Number(t.llm_ms ?? 0),
          ttsMs: Number(t.tts_ms ?? 0),
          totalMs: Number(t.total_ms ?? 0),
          isAdditive: Boolean(t.is_additive ?? true),
        }))
      : [];

    return {
      status: "ready",
      data: {
        ...base,
        recordingAvailable: Boolean(callRaw.recording_available),
        recordingDurationSeconds: callRaw.recording_duration_seconds
          ? Number(callRaw.recording_duration_seconds)
          : undefined,
        recordingUrl: callRaw.recording_available
          ? `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/inbound/${encodeURIComponent(callId)}/recording`
          : null,
        callerRecordingAvailable: Boolean(callRaw.caller_recording_available),
        callerRecordingUrl: callRaw.caller_recording_available
          ? `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/inbound/${encodeURIComponent(callId)}/recording?track=caller`
          : null,
        recordingOffsetMs: Number(callRaw.recording_offset_ms ?? 0),
        callerRecordingOffsetMs: Number(callRaw.caller_recording_offset_ms ?? 0),
        disconnectReason: callRaw.disconnect_reason ? String(callRaw.disconnect_reason) : null,
        transcript,
        processingTurns,
        disposition: String(callRaw.disposition ?? base.status),
      },
    };
  }

  async getWaveform(
    workspaceId: string,
    callId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<import("./types").VoiceWaveform>> {
    const result = await fetchJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/inbound/${encodeURIComponent(callId)}/waveform`,
      signal,
    );
    if (result.status !== "ready") return result;
    const raw = (result.data.waveform ?? result.data) as Record<string, unknown>;
    return {
      status: "ready",
      data: {
        callId: String(raw.call_id ?? callId),
        durationSeconds: Number(raw.duration_seconds ?? 0),
        peaks: Array.isArray(raw.peaks) ? (raw.peaks as number[]) : [],
        agentPeaks: Array.isArray(raw.agent_peaks) ? (raw.agent_peaks as number[]) : [],
        callerPeaks: Array.isArray(raw.caller_peaks) ? (raw.caller_peaks as number[]) : [],
        stereoAvailable: Boolean(raw.stereo_available),
      },
    };
  }

  async getTranscript(
    workspaceId: string,
    callId: string,
    signal?: AbortSignal,
  ): Promise<
    RepositoryResult<{
      segments: import("./types").TranscriptSegment[];
      processingTurns?: import("./types").ProcessingTurn[];
    }>
  > {
    const result = await fetchJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/inbound/${encodeURIComponent(callId)}/transcript`,
      signal,
    );
    if (result.status !== "ready") return result;
    const raw = result.data as Record<string, unknown>;
    const segments = Array.isArray(raw.segments)
      ? (raw.segments as Record<string, unknown>[]).map((t, i) => ({
          id: String(t.id ?? i),
          sequence: Number(t.sequence ?? i),
          speaker: (t.speaker === "agent" ? "agent" : "user") as "user" | "agent",
          text: String(t.text ?? ""),
          startMs: Number(t.start_ms ?? 0),
          endMs: Number(t.end_ms ?? 0),
          occurredAt: t.occurred_at ? String(t.occurred_at) : undefined,
          processingTurnId: t.processing_turn_id ? String(t.processing_turn_id) : undefined,
        }))
      : [];
    const turns = Array.isArray(raw.processing_turns)
      ? (raw.processing_turns as Record<string, unknown>[]).map((t, i) => ({
          id: String(t.id ?? i),
          turnNumber: Number(t.turn_number ?? i + 1),
          sttMs: Number(t.stt_ms ?? 0),
          llmMs: Number(t.llm_ms ?? 0),
          ttsMs: Number(t.tts_ms ?? 0),
          totalMs: Number(t.total_ms ?? 0),
          isAdditive: Boolean(t.is_additive ?? true),
        }))
      : undefined;
    return {
      status: "ready",
      data: {
        segments,
        processingTurns: turns,
      },
    };
  }

  async listPhoneNumbers(
    workspaceId: string,
    options?: { sync?: boolean },
    signal?: AbortSignal,
  ): Promise<RepositoryResult<import("./types").PhoneNumbersSnapshot>> {
    const result = await requestJson<Record<string, unknown>>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/numbers${
        options?.sync ? "?sync=true" : ""
      }`,
      undefined,
      signal,
    );
    if (result.status !== "ready") return result;
    return {
      status: "ready",
      data: {
        configured: Boolean(result.data.configured),
        numbers: mapNumberList(result.data),
        pool: mapPool(result.data),
      },
    };
  }

  async searchAvailablePhoneNumbers(
    workspaceId: string,
    filters?: PhoneNumberSearchFilters,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<import("./types").AvailablePhoneNumbersResult>> {
    const params = new URLSearchParams();
    if (filters?.country_code) params.set("country_code", filters.country_code);
    if (filters?.area_code) params.set("area_code", filters.area_code);
    if (filters?.locality) params.set("locality", filters.locality);
    if (filters?.state) params.set("state", filters.state);
    if (filters?.number_type) params.set("number_type", filters.number_type);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    const result = await requestJson<Record<string, unknown>>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/numbers/available${
        qs ? `?${qs}` : ""
      }`,
      undefined,
      signal,
    );
    if (result.status !== "ready") return result;
    return {
      status: "ready",
      data: {
        configured: Boolean(result.data.configured),
        numbers: Array.isArray(result.data.numbers)
          ? (result.data.numbers as Record<string, unknown>[]).map(mapAvailable)
          : [],
        pool: mapPool(result.data),
      },
    };
  }

  async purchasePhoneNumber(
    workspaceId: string,
    input: import("./types").PurchasePhoneNumberInput,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<WorkspacePhoneNumber>> {
    const result = await requestJson<{ number?: Record<string, unknown> }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/numbers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      signal,
    );
    if (result.status !== "ready") return result;
    if (!result.data.number) {
      return { status: "error", message: "Phone number purchase returned no number." };
    }
    return { status: "ready", data: mapPhoneNumber(result.data.number) };
  }

  async updatePhoneNumber(
    workspaceId: string,
    numberId: string,
    input: UpdatePhoneNumberInput,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<WorkspacePhoneNumber>> {
    const result = await requestJson<{ number?: Record<string, unknown> }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/numbers/${encodeURIComponent(
        numberId,
      )}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      signal,
    );
    if (result.status !== "ready") return result;
    if (!result.data.number) {
      return { status: "error", message: "Phone number update returned no number." };
    }
    return { status: "ready", data: mapPhoneNumber(result.data.number) };
  }

  async releasePhoneNumber(
    workspaceId: string,
    numberId: string,
    mode: "pool" | "provider",
    signal?: AbortSignal,
  ): Promise<RepositoryResult<WorkspacePhoneNumber>> {
    const result = await requestJson<{ number?: Record<string, unknown> }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/numbers/${encodeURIComponent(
        numberId,
      )}?mode=${mode}`,
      { method: "DELETE" },
      signal,
    );
    if (result.status !== "ready") return result;
    if (!result.data.number) {
      return { status: "error", message: "Phone number release returned no number." };
    }
    return { status: "ready", data: mapPhoneNumber(result.data.number) };
  }
}
