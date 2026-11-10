import type {
  BusinessInput,
  LeadGenerationCandidateResult,
  LeadGenerationCursorPage,
  LeadGenerationDeliveryTask,
  LeadGenerationProfile,
  LeadGenerationRunCreateResponse,
  LeadGenerationRunSummary,
  LeadPolicy,
  LeadRunInput,
} from "./types";

type ApiError = { code?: string; message: string };

async function bff<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; data?: T; error?: ApiError }> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: ApiError;
    };
    if (!res.ok) {
      return {
        status: res.status,
        error:
          body.error ?? { code: `HTTP_${res.status}`, message: res.statusText || "Request failed" },
      };
    }
    return { status: res.status, data: body as unknown as T };
  } catch (err: unknown) {
    const isAbort =
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError") ||
      (typeof err === "object" && err !== null && "name" in err && (err as { name: string }).name === "AbortError");
    if (isAbort) {
      return {
        status: 0,
        error: { code: "ABORTED", message: "Request aborted" },
      };
    }
    return {
      status: 0,
      error: {
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "Network request failed",
      },
    };
  }
}

function base(workspaceId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/lead-generation`;
}

export async function getProfile(workspaceId: string, signal?: AbortSignal) {
  return bff<{ profile: LeadGenerationProfile | null }>(`${base(workspaceId)}/profile`, { signal });
}

export async function putProfile(
  workspaceId: string,
  body: { expected_version: number; business: BusinessInput },
) {
  return bff<{ profile: LeadGenerationProfile; research_scheduled?: boolean }>(
    `${base(workspaceId)}/profile`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

export async function getPolicy(workspaceId: string, signal?: AbortSignal) {
  return bff<{ policy: LeadPolicy; version?: string }>(`${base(workspaceId)}/policy`, { signal });
}

export async function listRuns(workspaceId: string, signal?: AbortSignal) {
  return bff<LeadGenerationCursorPage<LeadGenerationRunSummary>>(`${base(workspaceId)}/runs`, {
    signal,
  });
}

export async function createRun(
  workspaceId: string,
  body: LeadRunInput,
  idempotencyKey: string,
) {
  return bff<LeadGenerationRunCreateResponse>(`${base(workspaceId)}/runs`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export async function getRun(workspaceId: string, runId: string, signal?: AbortSignal) {
  return bff<{ run: LeadGenerationRunSummary }>(
    `${base(workspaceId)}/runs/${encodeURIComponent(runId)}`,
    { signal },
  );
}

export async function getRunResults(workspaceId: string, runId: string, signal?: AbortSignal) {
  return bff<LeadGenerationCursorPage<LeadGenerationCandidateResult>>(
    `${base(workspaceId)}/runs/${encodeURIComponent(runId)}/results`,
    { signal },
  );
}

/** Pages through a run until every candidate row is loaded. */
export async function listAllRunResults(
  workspaceId: string,
  runId: string,
  signal?: AbortSignal,
) {
  const items: LeadGenerationCandidateResult[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ limit: "100" });
    if (after) params.set("after", after);
    const res = await bff<LeadGenerationCursorPage<LeadGenerationCandidateResult>>(
      `${base(workspaceId)}/runs/${encodeURIComponent(runId)}/results?${params.toString()}`,
      { signal },
    );
    if (res.error || !res.data) return res;
    items.push(...res.data.items);
    after = res.data.next_cursor;
    if (!after) break;
  }
  return { status: 200, data: { items, next_cursor: null as string | null } };
}

export async function getRunDeliveries(workspaceId: string, runId: string, signal?: AbortSignal) {
  return bff<{ items: LeadGenerationDeliveryTask[] }>(
    `${base(workspaceId)}/runs/${encodeURIComponent(runId)}/deliveries`,
    { signal },
  );
}

export async function cancelRun(workspaceId: string, runId: string) {
  return bff<{ run: LeadGenerationRunSummary }>(
    `${base(workspaceId)}/runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST", body: "{}" },
  );
}

// Profile fact confirmation
export async function confirmProfileFacts(
  workspaceId: string,
  body: {
    approved: boolean;
    confirmed_facts: Record<string, unknown>;
    inferences?: Record<string, unknown>;
    notes?: string;
  },
) {
  return bff<{ profile: LeadGenerationProfile }>(`${base(workspaceId)}/profile/confirm`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Collections
export async function listCollections(workspaceId: string, signal?: AbortSignal) {
  return bff<{ items: import("./types").LeadCollection[] }>(`${base(workspaceId)}/collections`, { signal });
}

export async function createCollection(
  workspaceId: string,
  body: {
    name: string;
    description?: string;
    qualification_overrides?: {
      qualification_mode?: import("./types").QualificationMode;
      required_contact?: import("./types").ContactRequirement;
      min_fit_score?: number;
      mandatory_criteria?: string[];
    };
  },
) {
  return bff<{ collection: import("./types").LeadCollection }>(`${base(workspaceId)}/collections`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateCollection(
  workspaceId: string,
  collectionId: string,
  body: Partial<import("./types").LeadCollection>,
) {
  return bff<{ collection: import("./types").LeadCollection }>(
    `${base(workspaceId)}/collections/${encodeURIComponent(collectionId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export async function deleteCollection(workspaceId: string, collectionId: string) {
  return bff<{ ok: boolean }>(`${base(workspaceId)}/collections/${encodeURIComponent(collectionId)}`, {
    method: "DELETE",
  });
}

// Connectors
export async function listConnectors(workspaceId: string, signal?: AbortSignal) {
  return bff<{ items: import("./types").InboundConnector[] }>(`${base(workspaceId)}/connectors`, { signal });
}

export async function createConnector(
  workspaceId: string,
  body: {
    name: string;
    source_type?: string;
    collection_id?: string;
    default_qualification_mode?: import("./types").QualificationMode;
    field_mapping?: Record<string, string>;
    batch_size_limit?: number;
    auto_enroll_campaign_id?: string;
  },
) {
  return bff<{ connector: import("./types").InboundConnector; secret_token: string }>(
    `${base(workspaceId)}/connectors`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function updateConnector(
  workspaceId: string,
  connectorId: string,
  body: Partial<import("./types").InboundConnector>,
) {
  return bff<{ connector: import("./types").InboundConnector }>(
    `${base(workspaceId)}/connectors/${encodeURIComponent(connectorId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export async function rotateConnectorToken(workspaceId: string, connectorId: string) {
  return bff<{ connector: import("./types").InboundConnector; secret_token: string }>(
    `${base(workspaceId)}/connectors/${encodeURIComponent(connectorId)}/rotate`,
    { method: "POST", body: "{}" },
  );
}

export async function revokeConnector(workspaceId: string, connectorId: string) {
  return bff<{ ok: boolean }>(
    `${base(workspaceId)}/connectors/${encodeURIComponent(connectorId)}`,
    { method: "DELETE" },
  );
}

export async function listConnectorBatches(
  workspaceId: string,
  connectorId: string,
  signal?: AbortSignal,
) {
  return bff<{ items: import("./types").InboundBatchEvent[] }>(
    `${base(workspaceId)}/connectors/${encodeURIComponent(connectorId)}/batches`,
    { signal },
  );
}

export async function listWorkspaceBatches(workspaceId: string, signal?: AbortSignal) {
  return bff<{ items: import("./types").InboundBatchEvent[] }>(
    `${base(workspaceId)}/inbound/batches`,
    { signal },
  );
}

export async function testFieldMapping(
  workspaceId: string,
  body: { sample_payload: Record<string, unknown>; mapping: Record<string, string> },
) {
  return bff<{ transformed: Record<string, unknown>; missing_fields: string[] }>(
    `${base(workspaceId)}/connectors/test-mapping`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function suggestFieldMapping(
  workspaceId: string,
  body: { sample_payload: Record<string, unknown> },
) {
  return bff<{ suggested_mapping: Record<string, string> }>(
    `${base(workspaceId)}/connectors/suggest-mapping`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function updateLeadSalesStatus(
  workspaceId: string,
  leadId: string,
  body: {
    status?: import("./types").SalesStatus;
    sales_status?: import("./types").SalesStatus;
    notes?: string;
    user_edited_fields?: Record<string, unknown>;
  },
) {
  return bff<{ lead: import("./types").LeadRecord }>(
    `${base(workspaceId)}/leads/${encodeURIComponent(leadId)}/sales-status`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export async function getLeadDetails(
  workspaceId: string,
  leadId: string,
  signal?: AbortSignal,
) {
  return bff<{ lead: import("./types").LeadRecord }>(
    `${base(workspaceId)}/leads/${encodeURIComponent(leadId)}`,
    { signal },
  );
}

export async function getLeadObservations(
  workspaceId: string,
  leadId: string,
  signal?: AbortSignal,
) {
  return bff<{ items: import("./types").LeadObservation[] }>(
    `${base(workspaceId)}/leads/${encodeURIComponent(leadId)}/observations`,
    { signal },
  );
}

export async function exportLeadsCsv(workspaceId: string, runId?: string): Promise<Blob> {
  const url = `${base(workspaceId)}/leads/export/csv${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to export leads CSV");
  return res.blob();
}

export async function listSchedules(workspaceId: string, signal?: AbortSignal) {
  return bff<{ items: import("./types").LeadSchedule[] }>(
    `${base(workspaceId)}/schedules`,
    { signal },
  );
}

export async function createSchedule(
  workspaceId: string,
  body: Omit<import("./types").LeadSchedule, "id" | "workspace_id" | "created_at" | "updated_at">,
) {
  return bff<{ schedule: import("./types").LeadSchedule }>(
    `${base(workspaceId)}/schedules`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function deleteSchedule(workspaceId: string, scheduleId: string) {
  return bff<{ deleted: boolean }>(
    `${base(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}`,
    { method: "DELETE" },
  );
}
