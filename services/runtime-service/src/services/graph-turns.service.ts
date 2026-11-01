import { randomUUID } from "node:crypto";
import { createDefaultAgentGraph, normalizeAgentGraph } from "@quickstart/contracts";
import type {
  AgentGraph,
  GraphExecutionTrace,
  GraphSessionState,
  GraphTraceEvent,
} from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";
import type { AgentClient } from "../clients/agent.client.js";
import { GraphEngine } from "../graph/engine.js";
import type { GraphSessionStore } from "../graph/session-store.js";

export type InitPreviewSessionInput = {
  sessionId?: string;
  channel?: "chat" | "voice";
  variables?: Record<string, unknown>;
};

export type ExecutePreviewTurnInput = {
  sessionId: string;
  message?: string;
  channel?: "chat" | "voice";
  requestId: string;
  timeoutMs?: number;
  idempotencyKey?: string;
};

export type PreviewTurnResponse = {
  runId: string;
  sessionId: string;
  status: "succeeded" | "waiting_for_input" | "handed_off" | "completed" | "failed";
  currentNodeId: string;
  messages: string[];
  trace: GraphExecutionTrace;
  sessionState: GraphSessionState;
  draftRevision: number;
};

export class GraphTurnsService {
  constructor(
    private readonly agentClient: AgentClient,
    private readonly graphEngine: GraphEngine,
    private readonly sessionStore: GraphSessionStore,
  ) {}

  async initPreviewSession(
    workspaceId: string,
    agentId: string,
    input: InitPreviewSessionInput,
    authHeaders: Record<string, string>,
    requestId: string,
  ): Promise<{
    sessionId: string;
    draftRevision: number;
    graph: AgentGraph;
    session: GraphSessionState;
    initialMessages: string[];
    trace?: GraphExecutionTrace;
  }> {
    const draft = await this.agentClient.getDraftGraph(workspaceId, agentId, authHeaders);
    const sessionId = `prev_${randomUUID()}`;
    const agent = await this.agentClient.getAgent(workspaceId, agentId, authHeaders);
    const graph =
      draft.graph && draft.graph.nodes.length > 0
        ? draft.graph
        : agent.builder_mode === "legacy"
          ? createDefaultAgentGraph({
              channels: agent.channels ?? { chat: true, voice: false },
              knowledge: agent.configuration?.knowledge,
            })
          : null;
    if (!graph || graph.nodes.length === 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Agent does not have a configured canvas graph.",
      });
    }
    const entryId =
      graph.entry_node_id || graph.nodes.find((n) => n.type === "entrypoint")?.id || "";

    const sessionState: GraphSessionState = {
      session_id: sessionId,
      workspace_id: workspaceId,
      agent_id: agentId,
      release_id: null,
      graph_snapshot: normalizeAgentGraph(structuredClone(graph)),
      agent_defaults: {
        instructions: agent.instructions,
        model_settings: agent.model_settings ?? {},
        tools: agent.tools ?? [],
      },
      is_preview: true,
      channel: input.channel ?? "chat",
      status: "active",
      current_node_id: entryId,
      variables: {
        ...input.variables,
        _preview: true,
        _draft_revision: draft.draft_revision,
      },
      turn_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.sessionStore.saveSession(sessionState);

    // Run opening step (entrypoint -> welcome) if present
    let initialMessages: string[] = [];
    let initialTrace: GraphExecutionTrace | undefined;

    try {
      const turnResult = await this.graphEngine.executeTurn({
        workspaceId,
        agentId,
        conversationId: sessionId,
        sessionId,
        releaseId: null,
        graph,
        channel: input.channel ?? "chat",
        isPreview: true,
        authHeaders,
        requestId,
      });
      initialMessages = turnResult.messages;
      initialTrace = turnResult.trace;
    } catch (error) {
      await this.sessionStore.deleteSession(workspaceId, sessionId);
      throw error;
    }

    const updatedSession =
      (await this.sessionStore.getSession(workspaceId, sessionId)) ?? sessionState;

    return {
      sessionId,
      draftRevision: draft.draft_revision,
      graph,
      session: updatedSession,
      initialMessages,
      trace: initialTrace,
    };
  }

  async executePreviewTurn(
    workspaceId: string,
    agentId: string,
    input: ExecutePreviewTurnInput,
    authHeaders: Record<string, string>,
  ): Promise<PreviewTurnResponse> {
    // Check current access but execute the session's frozen definition.
    await this.agentClient.getDraftGraph(workspaceId, agentId, authHeaders);
    const session = await this.sessionStore.getSession(workspaceId, input.sessionId);

    if (
      !session ||
      session.agent_id !== agentId ||
      !session.is_preview ||
      !session.graph_snapshot
    ) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Preview session not found or expired. Please initialize or reset the preview.",
      });
    }

    const turnResult = await this.graphEngine.executeTurn({
      workspaceId,
      agentId,
      conversationId: input.sessionId,
      sessionId: input.sessionId,
      releaseId: null,
      graph: session.graph_snapshot!,
      channel: session.channel,
      isPreview: true,
      visitorMessage: input.message,
      authHeaders,
      requestId: input.requestId,
      timeoutMs: input.timeoutMs ?? 30_000,
      idempotencyKey: input.idempotencyKey,
    });

    return {
      runId: turnResult.runId,
      sessionId: turnResult.sessionId,
      status: turnResult.status,
      currentNodeId: turnResult.currentNodeId,
      messages: turnResult.messages,
      trace: turnResult.trace,
      sessionState: turnResult.sessionState,
      draftRevision: Number(session.variables._draft_revision),
    };
  }

  async resetPreviewSession(
    workspaceId: string,
    agentId: string,
    sessionId: string,
    authHeaders: Record<string, string>,
    requestId: string,
  ): Promise<{
    sessionId: string;
    draftRevision: number;
    initialMessages: string[];
    trace?: GraphExecutionTrace;
    session: GraphSessionState;
  }> {
    const session = await this.sessionStore.getSession(workspaceId, sessionId);
    if (!session || session.agent_id !== agentId || !session.is_preview)
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Preview session not found" });
    await this.sessionStore.deleteSession(workspaceId, sessionId);
    const result = await this.initPreviewSession(
      workspaceId,
      agentId,
      { channel: session.channel === "voice" ? "voice" : "chat" },
      authHeaders,
      requestId,
    );
    return {
      sessionId: result.sessionId,
      draftRevision: result.draftRevision,
      initialMessages: result.initialMessages,
      trace: result.trace,
      session: result.session,
    };
  }

  async authorizePreviewSession(
    workspaceId: string,
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await this.sessionStore.getSession(workspaceId, sessionId);
    if (!session || session.agent_id !== agentId || !session.is_preview)
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Preview session not found" });
  }

  async getTrace(
    workspaceId: string,
    runId: string,
    agentId: string,
  ): Promise<GraphExecutionTrace | null> {
    const trace = await this.sessionStore.getTrace(workspaceId, runId);
    if (trace) await this.authorizePreviewSession(workspaceId, agentId, trace.session_id);
    return trace;
  }

  async listTraces(
    workspaceId: string,
    sessionId: string | undefined,
    limit: number | undefined,
    agentId: string,
  ): Promise<GraphExecutionTrace[]> {
    if (sessionId) {
      await this.authorizePreviewSession(workspaceId, agentId, sessionId);
      return this.sessionStore.listTraces(workspaceId, sessionId, limit);
    }
    return this.sessionStore.listAgentTraces(workspaceId, agentId, limit);
  }

  subscribeTrace(
    workspaceId: string,
    sessionId: string,
    onEvent: (event: GraphTraceEvent) => void,
  ): () => void {
    return this.sessionStore.subscribeTrace(workspaceId, sessionId, onEvent);
  }
}
