import type {
  AgentAiEditProposal,
  AgentGraph,
  GraphExecutionTrace,
  GraphSessionState,
  GraphValidationIssue,
} from "@quickstart/contracts";

export class CanvasApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CanvasApiError";
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errJson: any;
    try {
      errJson = await res.json();
    } catch {
      errJson = { error: { message: `Request failed with status ${res.status}` } };
    }
    const code = errJson?.error?.code || (res.status === 409 ? "CONFLICT" : "INTERNAL_ERROR");
    const message = errJson?.error?.message || errJson?.message || `HTTP ${res.status}`;
    throw new CanvasApiError(code, message, res.status, errJson);
  }
  return res.json() as Promise<T>;
}

export async function saveAgentGraph(
  workspaceId: string,
  agentId: string,
  graph: AgentGraph,
  expectedRevision: number,
  settings?: import("@quickstart/contracts").GraphDraftSettings,
): Promise<{ draft_revision: number; updated_at: string }> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/graph`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graph,
        expected_revision: expectedRevision,
        settings,
      }),
    },
  );
  return handleResponse(res);
}

export async function validateAgentGraph(
  workspaceId: string,
  agentId: string,
  graph: AgentGraph,
): Promise<{ valid: boolean; issues: GraphValidationIssue[] }> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/validate-graph`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph }),
    },
  );
  return handleResponse(res);
}

export async function proposeAiAgentEdit(
  workspaceId: string,
  agentId: string,
  prompt: string,
): Promise<AgentAiEditProposal> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/ai-edit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    },
  );
  return handleResponse<AgentAiEditProposal>(res);
}

export async function publishAgentGraph(
  workspaceId: string,
  agentId: string,
  expectedRevision: number,
  releaseNotes?: string,
): Promise<{ release_number: number; version_id: string }> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_revision: expectedRevision,
        release_notes: releaseNotes,
      }),
    },
  );
  return handleResponse(res);
}

export async function initPreviewSession(
  workspaceId: string,
  agentId: string,
  options?: { sessionId?: string; channel?: "chat" | "voice"; variables?: Record<string, unknown> },
): Promise<{
  sessionId: string;
  draftRevision: number;
  graph: AgentGraph;
  session: GraphSessionState;
  initialMessages: string[];
  trace?: GraphExecutionTrace;
}> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/preview/session`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options ?? {}),
    },
  );
  return handleResponse(res);
}

export async function executePreviewTurn(
  workspaceId: string,
  agentId: string,
  options: { sessionId: string; message?: string; channel?: "chat" | "voice"; timeoutMs?: number },
): Promise<{
  runId: string;
  sessionId: string;
  status: "succeeded" | "waiting_for_input" | "handed_off" | "completed" | "failed";
  currentNodeId: string;
  messages: string[];
  trace: GraphExecutionTrace;
  sessionState: GraphSessionState;
  draftRevision: number;
}> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/preview/turns`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(options),
    },
  );
  return handleResponse(res);
}

export async function resetPreviewSession(
  workspaceId: string,
  agentId: string,
  sessionId: string,
): Promise<{
  sessionId: string;
  draftRevision: number;
  initialMessages: string[];
  trace?: GraphExecutionTrace;
  session: GraphSessionState;
}> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/preview/reset`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    },
  );
  return handleResponse(res);
}

export async function listPreviewTraces(
  workspaceId: string,
  agentId: string,
  sessionId?: string,
): Promise<{ traces: GraphExecutionTrace[] }> {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/preview/traces${query}`,
    { method: "GET" },
  );
  return handleResponse(res);
}
