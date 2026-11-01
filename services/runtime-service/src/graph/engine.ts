import { normalizeAgentGraph } from "@quickstart/contracts";
import { setVariablePath } from "./eval-utils.js";
import { randomUUID } from "node:crypto";
import type {
  AgentConfiguration,
  AgentGraph,
  AgentGraphNode,
  GraphExecutionTrace,
  GraphSessionState,
  GraphTraceEvent,
} from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";
import { GraphNodeRegistry } from "./registry.js";
import { GraphSessionStore } from "./session-store.js";
import type { ExecutionContext, NodeExecutionResult } from "./types.js";

export type RunGraphTurnInput = {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  sessionId?: string;
  idempotencyKey?: string;
  releaseId: string | null;
  graph: AgentGraph;
  channel: "chat" | "voice" | "webhook";
  isPreview: boolean;
  visitorMessage?: string;
  authHeaders?: Record<string, string>;
  requestId: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  agentDefaults?: GraphSessionState["agent_defaults"];
  agentConfiguration?: AgentConfiguration;
  subjectKey?: string;
  allowTools?: boolean;
  onHandoff?: () => Promise<void>;
  humanReleased?: boolean;
  onAssistantMessage?: (text: string) => Promise<void>;
  onTraceEvent?: (event: GraphTraceEvent) => void;
};

export type RunGraphTurnResult = {
  runId: string;
  sessionId: string;
  status: "succeeded" | "waiting_for_input" | "handed_off" | "completed" | "failed";
  currentNodeId: string;
  messages: string[];
  trace: GraphExecutionTrace;
  sessionState: GraphSessionState;
};

const MAX_STEPS_PER_TURN = 25;

function redactPii(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
      .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[REDACTED_PHONE]")
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_CARD]");
  }
  if (Array.isArray(value)) return value.map(redactPii);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactPii(item)]));
  }
  return value;
}

function traceValue(value: unknown, redact: boolean, capture: boolean): unknown {
  if (!capture) return undefined;
  return redact ? redactPii(value) : value;
}

export class GraphEngine {
  constructor(
    private readonly registry: GraphNodeRegistry,
    private readonly sessionStore: GraphSessionStore,
  ) {}

  async executeTurn(input: RunGraphTurnInput): Promise<RunGraphTurnResult> {
    const sessionId = input.sessionId || `session_${input.conversationId}`;
    return this.sessionStore.withSessionLock(input.workspaceId, sessionId, async () => {
      if (input.idempotencyKey) {
        const previous = await this.sessionStore.getTurn<{
          message?: string;
          result: RunGraphTurnResult;
        }>(input.workspaceId, sessionId, input.idempotencyKey);
        if (previous) {
          if (previous.message !== input.visitorMessage)
            throw new AppError({
              code: ErrorCode.CONFLICT,
              message: "This idempotency key was already used for a different message.",
            });
          return previous.result;
        }
      }
      const result = await this.runTurn(input);
      if (input.idempotencyKey)
        await this.sessionStore.saveTurn(input.workspaceId, sessionId, input.idempotencyKey, {
          message: input.visitorMessage,
          result,
        });
      return result;
    });
  }

  private async runTurn(input: RunGraphTurnInput): Promise<RunGraphTurnResult> {
    const {
      workspaceId,
      agentId,
      conversationId,
      releaseId,
      channel,
      isPreview,
      visitorMessage,
      authHeaders,
      requestId,
      timeoutMs = 30_000,
      abortSignal,
    } = input;

    const runId = `run_${randomUUID()}`;
    const sessionId = input.sessionId || `session_${conversationId}`;
    const startTime = Date.now();
    const deadlineMs = startTime + timeoutMs;

    // 1. Load or initialize session state
    const existingSession = await this.sessionStore.getSession(workspaceId, sessionId);
    if (
      existingSession &&
      (existingSession.agent_id !== agentId || existingSession.is_preview !== isPreview)
    )
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Flow session not found" });
    const graph = normalizeAgentGraph(existingSession?.graph_snapshot ?? input.graph);
    const session: GraphSessionState = existingSession ?? {
      session_id: sessionId,
      workspace_id: workspaceId,
      agent_id: agentId,
      release_id: releaseId,
      is_preview: isPreview,
      channel,
      status: "active",
      current_node_id:
        graph.entry_node_id || graph.nodes.find((n) => n.type === "entrypoint")?.id || "",
      variables: {},
      turn_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    session.graph_snapshot ??= graph;
    session.agent_defaults ??= input.agentDefaults;
    if (session.status === "completed")
      throw new AppError({
        code: ErrorCode.CONFLICT,
        message: "This flow session has ended. Start a new session.",
      });
    if (visitorMessage) {
      session.variables = setVariablePath("visitor.message", visitorMessage, session.variables);
      session.variables.visitor_message = visitorMessage;
    }
    session.turn_count += 1;
    session.updated_at = new Date().toISOString();

    // Caller may authorize resumption only after authoritative conversation state is bot.
    if (session.status === "handed_off" && input.humanReleased) {
      const resumeId = session.handoff_state?.resume_target_node_id;
      if (!resumeId)
        throw new AppError({
          code: ErrorCode.CONFLICT,
          message: "Configure a handoff resume destination before continuing.",
        });
      session.current_node_id = resumeId;
      session.status = "active";
      delete session.handoff_state;
    }
    // Check if session was handed off to human
    if (session.status === "handed_off") {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        message: "Conversation is currently handled by a human operator; AI turns are paused.",
      });
    }

    session.status = "active";
    const messagesEmitted: string[] = [];
    const traceEvents: GraphTraceEvent[] = [];

    const onAssistantMessage = async (text: string) => {
      messagesEmitted.push(text);
      if (input.onAssistantMessage) {
        await input.onAssistantMessage(text);
      }
    };

    const emitTraceEvent = (event: GraphTraceEvent) => {
      traceEvents.push(event);
      void this.sessionStore.appendTraceEvent(workspaceId, sessionId, event);
      if (input.onTraceEvent) {
        input.onTraceEvent(event);
      }
    };

    let stepCount = 0;
    let turnStatus: RunGraphTurnResult["status"] = "succeeded";
    let visitorMessageConsumed = false;

    // 2. Main Step Loop
    while (stepCount < MAX_STEPS_PER_TURN) {
      if (Date.now() > deadlineMs || abortSignal?.aborted) {
        turnStatus = "failed";
        break;
      }

      const currentNode = graph.nodes.find((n) => n.id === session.current_node_id);
      if (!currentNode) {
        turnStatus = "failed";
        emitTraceEvent({
          event_id: randomUUID(),
          run_id: runId,
          session_id: sessionId,
          node_id: session.current_node_id,
          node_name: "Unknown Node",
          node_type: "entrypoint",
          status: "failed",
          start_time: new Date().toISOString(),
          duration_ms: 0,
          error: `Node with id "${session.current_node_id}" not found in graph`,
        });
        break;
      }

      const handler = this.registry.get(currentNode.type);
      if (!handler) {
        turnStatus = "failed";
        emitTraceEvent({
          event_id: randomUUID(),
          run_id: runId,
          session_id: sessionId,
          node_id: currentNode.id,
          node_name: currentNode.name,
          node_type: currentNode.type,
          status: "failed",
          start_time: new Date().toISOString(),
          duration_ms: 0,
          error: `No handler registered for node type "${currentNode.type}"`,
        });
        break;
      }

      const stepStart = Date.now();
      const inputsBefore = structuredClone(session.variables);
      emitTraceEvent({
        event_id: randomUUID(),
        run_id: runId,
        session_id: sessionId,
        node_id: currentNode.id,
        node_name: currentNode.name,
        node_type: currentNode.type,
        status: "running",
        start_time: new Date(stepStart).toISOString(),
        duration_ms: 0,
      });
      const execContext: ExecutionContext = {
        workspaceId,
        agentId,
        conversationId,
        sessionId,
        channel,
        isPreview,
        graph,
        sessionState: session,
        visitorMessage: visitorMessageConsumed ? undefined : visitorMessage,
        authHeaders,
        requestId,
        turnIndex: session.turn_count,
        deadlineMs,
        abortSignal,
        onHandoff: input.onHandoff,
        checkpoint: () => this.sessionStore.saveSession(session),
        onAssistantMessage,
        onTraceEvent: emitTraceEvent,
        agentConfiguration: input.agentConfiguration,
        subjectKey: input.subjectKey,
        allowTools: input.allowTools,
      };

      let result: NodeExecutionResult;
      try {
        result = await handler.execute(currentNode, execContext);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : "Node execution failed";
        result = {
          status: "failed",
          error: errorMsg,
        };
      }

      const durationMs = Date.now() - stepStart;
      const eventStatus =
        result.status === "succeeded"
          ? "succeeded"
          : result.status === "waiting_for_input"
            ? "waiting_for_input"
            : result.status === "handed_off"
              ? "handed_off"
              : result.status === "completed"
                ? "completed"
                : "failed";

      emitTraceEvent({
        event_id: randomUUID(),
        run_id: runId,
        session_id: sessionId,
        node_id: currentNode.id,
        node_name: currentNode.name,
        node_type: currentNode.type,
        status: eventStatus,
        chosen_branch_port: result.chosenBranchPort,
        start_time: new Date(stepStart).toISOString(),
        end_time: new Date().toISOString(),
        duration_ms: durationMs,
        inputs: {
          visitor_message: visitorMessage,
          variables_in: inputsBefore,
        },
        outputs: result.outputVariables || {},
        error: result.error,
      });

      // Update session variables
      if (result.outputVariables) {
        session.variables = { ...session.variables, ...result.outputVariables };
      }
      if (currentNode.type === "conversation" && visitorMessage) {
        visitorMessageConsumed = true;
      }

      stepCount += 1;

      // Handle terminal or waiting statuses
      if (result.status === "waiting_for_input") {
        session.status = "waiting_for_input";
        session.wait_state = {
          node_id: currentNode.id,
          expected_type: session.pending_action ? "action_confirmation" : "visitor_reply",
          captured_fields: result.waitForFields,
        };
        turnStatus = "waiting_for_input";

        // If the node itself determines next node after visitor reply, advance or preserve
        if (result.resumeAtNextNode && result.chosenBranchPort) {
          const nextNode = this.findNextNode(graph, currentNode.id, result.chosenBranchPort);
          if (nextNode) {
            session.current_node_id = nextNode.id;
          }
        }
        break;
      }

      if (result.status === "handed_off") {
        session.status = "handed_off";
        session.handoff_state ??= {
          original_node_id: currentNode.id,
          handed_off_at: new Date().toISOString(),
        };
        turnStatus = "handed_off";
        break;
      }

      if (result.status === "completed") {
        session.status = "completed";
        turnStatus = "completed";
        break;
      }

      if (
        result.status === "failed" &&
        (!result.chosenBranchPort ||
          !this.findNextNode(graph, currentNode.id, result.chosenBranchPort))
      ) {
        session.status = "failed";
        turnStatus = "failed";
        break;
      }

      delete session.wait_state;
      // Succeeded: Follow edge from chosen branch port
      const chosenPort = result.chosenBranchPort;
      if (!chosenPort) {
        // No outgoing branch chosen -> turn complete
        break;
      }

      const nextNode = this.findNextNode(graph, currentNode.id, chosenPort);
      if (!nextNode) {
        // No connected edge from this port -> flow pauses or ends here
        break;
      }

      session.current_node_id = nextNode.id;
    }

    if (stepCount >= MAX_STEPS_PER_TURN || Date.now() > deadlineMs || abortSignal?.aborted) {
      turnStatus = "failed";
      session.status = "failed";
    }
    session.updated_at = new Date().toISOString();
    // 3. Persist session state
    await this.sessionStore.saveSession(session);

    const totalDuration = Date.now() - startTime;
    const observability = input.agentConfiguration?.observability;
    const redact = input.agentConfiguration?.guardrails.redact_pii !== false;
    const executionTrace: GraphExecutionTrace = {
      run_id: runId,
      session_id: sessionId,
      agent_id: agentId,
      release_id: releaseId,
      is_preview: isPreview,
      status:
        turnStatus === "failed"
          ? "failed"
          : turnStatus === "waiting_for_input"
            ? "waiting_for_input"
            : "succeeded",
      total_duration_ms: totalDuration,
      steps: traceEvents.map((event) => ({
        ...event,
        inputs: traceValue(event.inputs, redact, observability?.capture_inputs !== false) as
          Record<string, unknown> | undefined,
        outputs: traceValue(event.outputs, redact, observability?.capture_outputs !== false) as
          Record<string, unknown> | undefined,
        error: traceValue(event.error, redact, true) as string | undefined,
      })),
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
    };

    await this.sessionStore.saveTrace(
      executionTrace,
      workspaceId,
      (observability?.trace_retention_days ?? 1) * 24 * 60 * 60,
    );

    return {
      runId,
      sessionId,
      status: turnStatus,
      currentNodeId: session.current_node_id,
      messages: messagesEmitted,
      trace: executionTrace,
      sessionState: session,
    };
  }

  private findNextNode(
    graph: AgentGraph,
    sourceNodeId: string,
    sourcePortId: string,
  ): AgentGraphNode | undefined {
    const edge = graph.edges.find(
      (e) => e.source === sourceNodeId && e.source_port === sourcePortId,
    );
    if (!edge) return undefined;
    return graph.nodes.find((n) => n.id === edge.target);
  }
}
