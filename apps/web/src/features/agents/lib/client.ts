import type {
  Agent,
  AgentChannels,
  AgentToolDefinition,
  AgentVersion,
  AgentVersionDiff,
  AgentVoiceSettings,
  ApiError,
} from "./types";
import type { AgentCatalogResponse, AgentConfiguration } from "@quickstart/contracts";

type BffResponse<T> = { data?: T; error?: ApiError; status: number };

async function bff<T>(path: string, init?: RequestInit): Promise<BffResponse<T>> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as {
    agent?: Agent;
    agents?: Agent[];
    version?: AgentVersion;
    versions?: AgentVersion[];
    error?: ApiError;
    [key: string]: unknown;
  };

  if (!res.ok) {
    return {
      status: res.status,
      error: body?.error ?? {
        code: `HTTP_${res.status}`,
        message: res.statusText || "Request failed",
      },
    };
  }

  return { status: res.status, data: body as unknown as T };
}

export async function listAgents(
  workspaceId: string,
  options: { limit?: number; cursor?: string; includeArchived?: boolean } = {},
): Promise<{ agents?: Agent[]; nextCursor?: string | null; error?: ApiError }> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.includeArchived) params.set("include_archived", "true");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const { data, error } = await bff<{ agents: Agent[] }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents${suffix}`,
  );
  return error
    ? { error }
    : {
        agents: data?.agents ?? [],
        nextCursor: (data as { next_cursor?: string | null } | undefined)?.next_cursor,
      };
}

export async function getAgentCatalog(
  workspaceId: string,
): Promise<{ catalog?: AgentCatalogResponse; error?: ApiError }> {
  const { data, error } = await bff<AgentCatalogResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/catalog`,
  );
  return error ? { error } : { catalog: data };
}

export async function getAgent(
  workspaceId: string,
  agentId: string,
): Promise<{ agent?: Agent; error?: ApiError }> {
  const { data, error } = await bff<{ agent: Agent }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}`,
  );
  return error ? { error } : { agent: data?.agent };
}

export type CreateAgentPayload = {
  name: string;
  description?: string | null;
  instructions?: string;
  environment?: string;
  model_settings?: Record<string, unknown>;
  channels?: Partial<AgentChannels>;
  tools?: AgentToolDefinition[];
  voice?: AgentVoiceSettings;
  configuration?: AgentConfiguration;
};

export async function createAgent(
  workspaceId: string,
  payload: CreateAgentPayload,
): Promise<{ agent?: Agent; error?: ApiError }> {
  const { data, error } = await bff<{ agent: Agent }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  return error ? { error } : { agent: data?.agent };
}

export type UpdateAgentPayload = {
  name?: string;
  description?: string | null;
  instructions?: string;
  environment?: string;
  model_settings?: Record<string, unknown>;
  channels?: Partial<AgentChannels>;
  tools?: AgentToolDefinition[];
  voice?: AgentVoiceSettings;
  configuration?: AgentConfiguration;
  expected_version: number;
};

export async function updateAgent(
  workspaceId: string,
  agentId: string,
  payload: UpdateAgentPayload,
): Promise<{ agent?: Agent; error?: ApiError; isConflict?: boolean }> {
  const result = await bff<{ agent: Agent }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
  if (result.error) {
    return {
      error: result.error,
      isConflict: result.status === 409 || result.error.code === "CONFLICT",
    };
  }
  return { agent: result.data?.agent };
}

export async function deleteAgent(
  workspaceId: string,
  agentId: string,
): Promise<{ success: boolean; error?: ApiError }> {
  const { error } = await bff<{ deleted: boolean }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}`,
    {
      method: "DELETE",
    },
  );
  return error ? { success: false, error } : { success: true };
}

export async function archiveAgent(
  workspaceId: string,
  agentId: string,
  archived: boolean,
): Promise<{ agent?: Agent; error?: ApiError }> {
  const { data, error } = await bff<{ agent: Agent }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/archive`,
    { method: "POST", body: JSON.stringify({ archived }) },
  );
  return error ? { error } : { agent: data?.agent };
}

export async function archiveAgents(
  workspaceId: string,
  agentIds: string[],
  archived: boolean,
): Promise<{ agents?: Agent[]; error?: ApiError }> {
  const { data, error } = await bff<{ agents: Agent[] }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/archive-batch`,
    { method: "POST", body: JSON.stringify({ agent_ids: agentIds, archived }) },
  );
  return error ? { error } : { agents: data?.agents ?? [] };
}

export async function setCanary(
  workspaceId: string,
  agentId: string,
  versionId: string | null,
  percentage: number,
): Promise<{ agent?: Agent; error?: ApiError }> {
  const { data, error } = await bff<{ agent: Agent }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/canary`,
    {
      method: "POST",
      body: JSON.stringify({ version_id: versionId, canary_percentage: percentage }),
    },
  );
  return error ? { error } : { agent: data?.agent };
}

export async function scheduleRelease(
  workspaceId: string,
  agentId: string,
  versionId: string,
  publishAt: string,
): Promise<{ agent?: Agent; error?: ApiError }> {
  const { data, error } = await bff<{ agent: Agent }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/schedule-release`,
    {
      method: "POST",
      body: JSON.stringify({ version_id: versionId, publish_at: publishAt }),
    },
  );
  return error ? { error } : { agent: data?.agent };
}

export type AgentEnvironmentComparison = {
  draft: AgentVersion["snapshot"];
  staging: AgentVersion | null;
  production: AgentVersion | null;
  canary: AgentVersion | null;
};

export async function getEnvironmentComparison(
  workspaceId: string,
  agentId: string,
): Promise<{ environments?: AgentEnvironmentComparison; error?: ApiError }> {
  const { data, error } = await bff<{ environments: AgentEnvironmentComparison }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/environments`,
  );
  return error ? { error } : { environments: data?.environments };
}

export type ReleaseReadiness = {
  ready: boolean;
  blockers: Array<{ code: string; message: string }>;
  warnings: string[];
};

export async function getReleaseReadiness(
  workspaceId: string,
  agentId: string,
): Promise<{ readiness?: ReleaseReadiness; error?: ApiError }> {
  const { data, error } = await bff<ReleaseReadiness>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/release-readiness`,
  );
  return error ? { error } : { readiness: data };
}

export async function publishAgent(
  workspaceId: string,
  agentId: string,
  baseVersion: number,
  options: {
    approval?: { approved: boolean; note?: string };
    completedChecklist?: string[];
    releaseNotes?: string;
  } = {},
): Promise<{ version?: AgentVersion; agent?: Agent; error?: ApiError }> {
  const { data, error } = await bff<{ version: AgentVersion; agent: Agent }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/publish`,
    {
      method: "POST",
      body: JSON.stringify({
        base_version: baseVersion,
        approval: options.approval,
        completed_checklist: options.completedChecklist,
        release_notes: options.releaseNotes,
      }),
    },
  );
  return error ? { error } : { version: data?.version, agent: data?.agent };
}

export async function rollbackAgent(
  workspaceId: string,
  agentId: string,
  versionId: string,
): Promise<{ version?: AgentVersion; agent?: Agent; error?: ApiError }> {
  const { data, error } = await bff<{ version: AgentVersion; agent: Agent }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/rollback`,
    {
      method: "POST",
      body: JSON.stringify({ version_id: versionId }),
    },
  );
  return error ? { error } : { version: data?.version, agent: data?.agent };
}

export async function listVersions(
  workspaceId: string,
  agentId: string,
): Promise<{ versions?: AgentVersion[]; error?: ApiError }> {
  const { data, error } = await bff<{ versions: AgentVersion[] }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/versions`,
  );
  return error ? { error } : { versions: data?.versions ?? [] };
}

export async function diffVersions(
  workspaceId: string,
  agentId: string,
  leftId: string,
  rightId: string,
): Promise<{ diff?: AgentVersionDiff; error?: ApiError }> {
  const { data, error } = await bff<AgentVersionDiff>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(leftId)}/diff/${encodeURIComponent(rightId)}`,
  );
  return error ? { error } : { diff: data };
}

export async function createTestConversation(
  workspaceId: string,
  agentId: string,
): Promise<{ conversationId?: string; error?: ApiError }> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentId }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    conversation?: { id: string };
    error?: ApiError;
  };
  if (!res.ok) {
    return {
      error: body.error ?? {
        code: `HTTP_${res.status}`,
        message: "Failed to create test conversation",
      },
    };
  }
  return { conversationId: body.conversation?.id };
}

export type TestTurnToolCall = {
  name: string;
  status: "succeeded" | "failed" | "pending" | "unknown";
  args?: Record<string, unknown>;
  error?: string;
};

export type TestTurnUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

export type TestTurnCallbacks = {
  onToken?: (delta: string) => void;
  onToolStart?: (event: { name: string; args?: Record<string, unknown> }) => void;
  onToolDone?: (event: TestTurnToolCall) => void;
};

export type TestTurnResult = {
  assistantText?: string;
  toolCalls?: TestTurnToolCall[];
  usage?: TestTurnUsage;
  error?: ApiError;
};

export async function executeTestTurn(
  workspaceId: string,
  conversationId: string,
  message: string,
  callbacks?: ((delta: string) => void) | TestTurnCallbacks,
): Promise<TestTurnResult> {
  const onToken = typeof callbacks === "function" ? callbacks : callbacks?.onToken;
  const onToolStart = typeof callbacks === "object" ? callbacks.onToolStart : undefined;
  const onToolDone = typeof callbacks === "object" ? callbacks.onToolDone : undefined;

  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/turns`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        message,
        idempotency_key: `test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      }),
    },
  );
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !res.body) {
    const body = (await res.json().catch(() => ({}))) as {
      assistant_message?: { text: string };
      turn?: {
        tool_calls?: TestTurnToolCall[];
        usage?: TestTurnUsage;
        assistant_message?: { text?: string };
      };
      error?: ApiError;
    };
    if (!res.ok) {
      return {
        error: body.error ?? {
          code: `HTTP_${res.status}`,
          message: "Failed to run test turn",
        },
      };
    }
    return {
      assistantText: body.assistant_message?.text ?? body.turn?.assistant_message?.text,
      toolCalls: body.turn?.tool_calls,
      usage: body.turn?.usage,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";
  let toolCalls: TestTurnToolCall[] = [];
  let usage: TestTurnUsage | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      let eventName = "message";
      let dataLine = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      }
      if (!dataLine) continue;
      try {
        const data = JSON.parse(dataLine) as {
          delta?: string;
          message?: string;
          name?: string;
          status?: "succeeded" | "failed" | "pending" | "unknown";
          args?: Record<string, unknown>;
          error?: string;
          turn?: {
            assistant_message?: { text?: string };
            tool_calls?: TestTurnToolCall[];
            usage?: TestTurnUsage;
          };
        };

        if (eventName === "token" && data.delta) {
          assistantText += data.delta;
          onToken?.(data.delta);
        } else if (eventName === "tool_start" && data.name) {
          const tc: TestTurnToolCall = {
            name: data.name,
            status: "pending",
            args: data.args,
          };
          toolCalls.push(tc);
          onToolStart?.({ name: data.name, args: data.args });
        } else if (eventName === "tool_done" && data.name) {
          const existing = toolCalls.find((t) => t.name === data.name && t.status === "pending");
          if (existing) {
            existing.status = data.status ?? "succeeded";
            if (data.args) existing.args = data.args;
            if (data.error) existing.error = data.error;
          } else {
            toolCalls.push({
              name: data.name,
              status: data.status ?? "succeeded",
              args: data.args,
              error: data.error,
            });
          }
          onToolDone?.({
            name: data.name,
            status: data.status ?? "succeeded",
            args: data.args,
            error: data.error,
          });
        } else if (eventName === "done") {
          if (data.turn?.assistant_message?.text && !assistantText) {
            assistantText = data.turn.assistant_message.text;
          }
          if (data.turn?.tool_calls?.length) {
            toolCalls = data.turn.tool_calls;
          }
          if (data.turn?.usage) {
            usage = data.turn.usage;
          }
        } else if (eventName === "error") {
          return {
            error: { code: "STREAM_ERROR", message: data.message || "Turn stream failed" },
            assistantText,
            toolCalls,
            usage,
          };
        }
      } catch {
        /* skip corrupted line */
      }
    }
  }
  if (!res.ok && !assistantText) {
    return { error: { code: `HTTP_${res.status}`, message: "Failed to run test turn" } };
  }
  return { assistantText, toolCalls, usage };
}
