import {
  SAMPLE_INBOUND_CALLS,
  SAMPLE_INBOUND_CALL_DETAIL_1042,
  SAMPLE_LIVE_CALLS,
} from "./fixtures";
import type {
  CallLogFilters,
  InboundCall,
  InboundCallDetail,
  PhoneNumberSearchFilters,
  PhoneNumbersSnapshot,
  ProcessingTurn,
  PurchasePhoneNumberInput,
  RepositoryResult,
  SimulatedInboundCallResult,
  TranscriptSegment,
  UpdatePhoneNumberInput,
  VoiceInboundSummary,
  VoiceRepository,
  VoiceWaveform,
  WorkspacePhoneNumber,
} from "./types";

class InMemoryVoicePreviewStore implements VoiceRepository {
  private calls: InboundCall[] = [];
  private liveCalls: InboundCall[] = [];
  private callDetails: Map<string, InboundCallDetail> = new Map();

  constructor() {
    this.reset();
  }

  reset() {
    this.calls = JSON.parse(JSON.stringify(SAMPLE_INBOUND_CALLS));
    this.liveCalls = JSON.parse(JSON.stringify(SAMPLE_LIVE_CALLS));
    this.callDetails.clear();
    this.callDetails.set("call_1042", JSON.parse(JSON.stringify(SAMPLE_INBOUND_CALL_DETAIL_1042)));
  }

  async getInboundSummary(
    _workspaceId: string,
    _signal?: AbortSignal
  ): Promise<RepositoryResult<VoiceInboundSummary>> {
    void _workspaceId;
    void _signal;
    return {
      status: "ready",
      data: {
        totalCalls: this.calls.length,
        completedCalls: this.calls.filter((c) => c.status === "completed").length,
        failedCalls: this.calls.filter((c) => c.status === "failed").length,
        avgDurationSeconds: 142,
        avgFirstAudioMs: 420,
        activeCalls: this.liveCalls.length,
      },
    };
  }

  async getWaveform(
    _workspaceId: string,
    _callId: string,
    _signal?: AbortSignal
  ): Promise<RepositoryResult<VoiceWaveform>> {
    void _workspaceId;
    void _signal;
    return {
      status: "ready",
      data: {
        callId: _callId,
        durationSeconds: 120,
        peaks: [0.2, 0.5, 0.8, 0.6, 0.7, 0.8, 0.5, 0.9, 0.4, 0.1],
        agentPeaks: [0.1, 0.4, 0.8, 0.6, 0.2, 0.1, 0.5, 0.9, 0.3, 0.1],
        callerPeaks: [0.2, 0.5, 0.3, 0.1, 0.7, 0.8, 0.4, 0.2, 0.1, 0.0],
        stereoAvailable: true,
      },
    };
  }

  async getTranscript(
    _workspaceId: string,
    callId: string,
    _signal?: AbortSignal
  ): Promise<
    RepositoryResult<{
      segments: TranscriptSegment[];
      processingTurns?: ProcessingTurn[];
    }>
  > {
    void _workspaceId;
    void _signal;
    const detail = this.callDetails.get(callId);
    return {
      status: "ready",
      data: {
        segments: detail?.transcript ?? [],
        processingTurns: detail?.processingTurns ?? [],
      },
    };
  }

  async listInboundCalls(
    _workspaceId: string,
    filters?: CallLogFilters,
    _signal?: AbortSignal
  ): Promise<RepositoryResult<{ calls: InboundCall[]; nextCursor?: string; prevCursor?: string }>> {
    void _workspaceId;
    void _signal;
    let result = [...this.calls];

    if (filters?.q?.trim()) {
      const q = filters.q.trim().toLowerCase();
      result = result.filter(
        (c) => c.caller.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
      );
    }

    if (filters?.status && filters.status !== "all") {
      result = result.filter((c) => c.status.toLowerCase() === filters.status?.toLowerCase());
    }

    if (filters?.agent && filters.agent !== "all") {
      result = result.filter((c) => c.agentId === filters.agent || c.agentName === filters.agent);
    }

    return {
      status: "ready",
      data: {
        calls: result,
      },
    };
  }

  async listLiveInboundCalls(
    _workspaceId: string,
    _signal?: AbortSignal
  ): Promise<RepositoryResult<InboundCall[]>> {
    void _workspaceId;
    void _signal;
    return {
      status: "ready",
      data: JSON.parse(JSON.stringify(this.liveCalls)),
    };
  }

  async stopLiveInboundCall(
    _workspaceId: string,
    callId: string,
  ): Promise<RepositoryResult<{ stopped: boolean }>> {
    void _workspaceId;
    const index = this.liveCalls.findIndex((call) => call.id === callId);
    if (index < 0) return { status: "not_found", message: "Live call was not found." };
    this.liveCalls.splice(index, 1);
    return { status: "ready", data: { stopped: true } };
  }

  async simulateInboundCall(
    _workspaceId: string,
    _input: { agent_id: string; utterance_text: string; caller?: string },
    _signal?: AbortSignal,
  ): Promise<RepositoryResult<{ result: SimulatedInboundCallResult }>> {
    return { status: "unavailable", message: "Call simulation is available in a connected workspace." };
  }

  async getInboundCall(
    _workspaceId: string,
    callId: string,
    _signal?: AbortSignal
  ): Promise<RepositoryResult<InboundCallDetail>> {
    void _workspaceId;
    void _signal;
    const detail = this.callDetails.get(callId);
    if (detail) {
      return {
        status: "ready",
        data: JSON.parse(JSON.stringify(detail)),
      };
    }

    // Fallback: check if call exists in calls list and synthesize basic detail
    const basic = this.calls.find((c) => c.id === callId);
    if (basic) {
      const synthDetail: InboundCallDetail = {
        ...basic,
        recordingAvailable: false,
        recordingDurationSeconds: basic.durationSeconds,
        recordingUrl: null,
        transcript: [],
        processingTurns: [],
        disposition: basic.status === "completed" ? "Completed" : basic.status,
      };
      return {
        status: "ready",
        data: synthDetail,
      };
    }

    return {
      status: "not_found",
      message: `Inbound call ${callId} was not found.`,
    };
  }

  async listPhoneNumbers(
    _workspaceId: string,
    options?: { sync?: boolean },
    signal?: AbortSignal,
  ): Promise<RepositoryResult<PhoneNumbersSnapshot>> {
    void _workspaceId;
    void options;
    void signal;
    return {
      status: "ready",
      data: {
        configured: false,
        numbers: [previewNumber("+14155550142", "Support line")],
        pool: [previewNumber("+12125550199", "Platform pool")],
      },
    };
  }

  async searchAvailablePhoneNumbers(
    _workspaceId: string,
    filters?: PhoneNumberSearchFilters,
    _signal?: AbortSignal,
  ): Promise<
    RepositoryResult<{
      configured: boolean;
      numbers: import("./types").AvailablePhoneNumber[];
      pool: WorkspacePhoneNumber[];
    }>
  > {
    void _workspaceId;
    void _signal;
    const areaCode = filters?.area_code ?? "415";
    return {
      status: "ready",
      data: {
        configured: false,
        numbers: [0, 1, 2].map((index) => ({
          phone_number: `+1${areaCode}5551${String(index).padStart(3, "0")}`,
          country_code: "US",
          number_type: filters?.number_type ?? "local",
          region: "California",
          locality: filters?.locality ?? "San Francisco",
          area_code: areaCode,
          monthly_cost: 1,
          currency: "USD",
          features: ["voice", "sms"],
        })),
        pool: [previewNumber("+12125550199", "Platform pool")],
      },
    };
  }

  async purchasePhoneNumber(
    _workspaceId: string,
    input: PurchasePhoneNumberInput,
    _signal?: AbortSignal,
  ): Promise<RepositoryResult<WorkspacePhoneNumber>> {
    void _workspaceId;
    void _signal;
    return { status: "ready", data: previewNumber(input.e164, "New number") };
  }

  async updatePhoneNumber(
    _workspaceId: string,
    numberId: string,
    input: UpdatePhoneNumberInput,
    _signal?: AbortSignal,
  ): Promise<RepositoryResult<WorkspacePhoneNumber>> {
    void _workspaceId;
    void _signal;
    return {
      status: "ready",
      data: {
        ...previewNumber("+14155550142", "Support line"),
        id: numberId,
        assigned_agent_id: input.assigned_agent_id ?? null,
        friendly_name: input.friendly_name ?? "Support line",
      },
    };
  }

  async releasePhoneNumber(
    _workspaceId: string,
    numberId: string,
    _mode: "pool" | "provider",
    _signal?: AbortSignal,
  ): Promise<RepositoryResult<WorkspacePhoneNumber>> {
    void _workspaceId;
    void _mode;
    void _signal;
    return {
      status: "ready",
      data: { ...previewNumber("+14155550142", "Support line"), id: numberId, status: "available" },
    };
  }
}

function previewNumber(e164: string, label: string): WorkspacePhoneNumber {
  const now = new Date().toISOString();
  return {
    id: `preview-${e164.replace(/\D/g, "")}`,
    workspace_id: "preview",
    phone_number: e164,
    friendly_name: label,
    provider: "telnyx",
    provider_number_id: null,
    provider_connection_id: null,
    assigned_agent_id: null,
    status: "active",
    inbound_status: "active",
    livekit_trunk_id: null,
    livekit_dispatch_rule_id: null,
    country_code: "US",
    number_type: "local",
    region: "California",
    locality: "San Francisco",
    monthly_cost: 1,
    currency: "USD",
    capabilities: { voice: true, sms: true },
    provisioning_error: null,
    purchased_at: now,
    released_at: null,
    created_at: now,
    updated_at: now,
  };
}

export const voicePreviewStore = new InMemoryVoicePreviewStore();
