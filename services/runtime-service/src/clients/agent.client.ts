import type { AgentConfiguration, AgentGraph, AgentToolDefinition } from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";
import { fetchWithPolicy } from "@quickstart/utilities";

export type AgentInfo = {
  id: string;
  workspace_id: string;
  name: string;
  production_version_id: string | null;
  canary_version_id?: string | null;
  canary_percentage?: number;
  configuration?: AgentConfiguration;
  instructions: string;
  channels?: { chat: boolean; voice: boolean };
  draft_revision?: number;
  draft_graph?: AgentGraph | null;
  builder_mode?: "legacy" | "canvas";
  model_settings?: Record<string, unknown>;
  tools?: AgentToolDefinition[];
};

export type AgentVersionInfo = {
  id: string;
  workspace_id: string;
  agent_id: string;
  release_number: number;
  __canary?: boolean;
  __canaryFailureThreshold?: number | null;
  snapshot: {
    name: string;
    instructions: string;
    model_settings: Record<string, unknown>;
    configuration?: AgentConfiguration;
    channels?: { chat?: boolean; voice?: boolean };
    tools?: AgentToolDefinition[];
    graph?: AgentGraph;
    builder_mode?: "legacy" | "canvas";
  };
};

export class AgentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = 5000,
    private readonly widgetInternalToken?: string,
  ) {}

  private widgetAuthHeaders(requestId: string): Record<string, string> {
    if (!this.widgetInternalToken) {
      throw new Error("widget internal token not configured");
    }
    return {
      Authorization: `Bearer ${this.widgetInternalToken}`,
      "x-request-id": requestId,
      Accept: "application/json",
    };
  }

  async getAgent(
    workspaceId: string,
    agentId: string,
    headers: Record<string, string>,
  ): Promise<AgentInfo> {
    const url = `${this.baseUrl}/v1/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}`;
    const res = await fetchWithPolicy(
      url,
      {
        method: "GET",
        headers: {
          ...headers,
          Accept: "application/json",
        },
      },
      { timeoutMs: this.timeoutMs, maxRetries: 1 },
    );

    if (res.status === 404) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Agent not found in workspace",
      });
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: body?.error?.message ?? `Agent service failed with status ${res.status}`,
      });
    }

    const data = (await res.json()) as { agent: AgentInfo };
    return data.agent;
  }

  async getVersion(
    workspaceId: string,
    agentId: string,
    versionId: string,
    headers: Record<string, string>,
  ): Promise<AgentVersionInfo> {
    const url = `${this.baseUrl}/v1/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(versionId)}`;
    const res = await fetchWithPolicy(
      url,
      {
        method: "GET",
        headers: {
          ...headers,
          Accept: "application/json",
        },
      },
      { timeoutMs: this.timeoutMs, maxRetries: 1 },
    );

    if (res.status === 404) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Agent version not found",
      });
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: body?.error?.message ?? `Agent service failed with status ${res.status}`,
      });
    }

    const data = (await res.json()) as { version: AgentVersionInfo };
    return data.version;
  }

  async getAgentWidget(
    workspaceId: string,
    agentId: string,
    requestId: string,
  ): Promise<AgentInfo> {
    const url = `${this.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/widget/agents/${encodeURIComponent(agentId)}`;
    const res = await fetchWithPolicy(
      url,
      { method: "GET", headers: this.widgetAuthHeaders(requestId) },
      { timeoutMs: this.timeoutMs, maxRetries: 1 },
    );
    if (res.status === 404) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Agent not found in workspace",
      });
    }
    if (!res.ok) {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: `Agent service failed with status ${res.status}`,
      });
    }
    const data = (await res.json()) as { agent: AgentInfo };
    return data.agent;
  }

  async disableCanaryWidget(
    workspaceId: string,
    agentId: string,
    requestId: string,
  ): Promise<void> {
    const res = await fetchWithPolicy(
      `${this.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/widget/agents/${encodeURIComponent(agentId)}/canary`,
      {
        method: "POST",
        headers: { ...this.widgetAuthHeaders(requestId), "content-type": "application/json" },
        body: JSON.stringify({ version_id: null, canary_percentage: 0 }),
      },
      { timeoutMs: this.timeoutMs, maxRetries: 0 },
    );
    if (!res.ok) throw new Error(`Failed to disable canary traffic (${res.status})`);
  }

  async getVersionWidget(
    workspaceId: string,
    agentId: string,
    versionId: string,
    requestId: string,
  ): Promise<AgentVersionInfo> {
    const url = `${this.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/widget/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(versionId)}`;
    const res = await fetchWithPolicy(
      url,
      { method: "GET", headers: this.widgetAuthHeaders(requestId) },
      { timeoutMs: this.timeoutMs, maxRetries: 1 },
    );
    if (res.status === 404) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Agent version not found",
      });
    }
    if (!res.ok) {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: `Agent service failed with status ${res.status}`,
      });
    }
    const data = (await res.json()) as { version: AgentVersionInfo };
    return data.version;
  }

  async getDraftGraph(
    workspaceId: string,
    agentId: string,
    headers: Record<string, string>,
  ): Promise<{ graph: AgentGraph; draft_revision: number; builder_mode: "legacy" | "canvas" }> {
    const url = `${this.baseUrl}/v1/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/graph`;
    const res = await fetchWithPolicy(
      url,
      {
        method: "GET",
        headers: {
          ...headers,
          Accept: "application/json",
        },
      },
      { timeoutMs: this.timeoutMs, maxRetries: 1 },
    );

    if (res.status === 404) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Agent or graph not found in workspace",
      });
    }
    if (!res.ok) {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: `Agent service failed with status ${res.status}`,
      });
    }
    return (await res.json()) as {
      graph: AgentGraph;
      draft_revision: number;
      builder_mode: "legacy" | "canvas";
    };
  }
}
