import type {
  AgentConfiguration,
  AgentGraph,
  AgentGraphNode,
  GraphNodeType,
  GraphSessionState,
  GraphTraceEvent,
} from "@quickstart/contracts";

export type ExecutionContext = {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  sessionId: string;
  channel: "chat" | "voice" | "webhook";
  isPreview: boolean;
  graph: AgentGraph;
  sessionState: GraphSessionState;
  visitorMessage?: string;
  authHeaders?: Record<string, string>;
  requestId: string;
  turnIndex: number;
  deadlineMs: number;
  abortSignal?: AbortSignal;
  onHandoff?: () => Promise<void>;
  checkpoint?: () => Promise<void>;
  onAssistantMessage?: (text: string) => Promise<void>;
  onTraceEvent?: (event: GraphTraceEvent) => void;
  agentConfiguration?: AgentConfiguration;
  subjectKey?: string;
  allowTools?: boolean;
};

export type NodeExecutionResult = {
  status: "succeeded" | "waiting_for_input" | "handed_off" | "completed" | "failed";
  chosenBranchPort?: string;
  nextNodeId?: string;
  /** Message nodes may advance while waiting; capture and confirmation must remain on the node. */
  resumeAtNextNode?: boolean;
  waitForFields?: string[];
  outputVariables?: Record<string, unknown>;
  assistantMessage?: string;
  error?: string;
};

export interface GraphNodeHandler<T extends GraphNodeType = GraphNodeType> {
  type: T;
  execute(node: AgentGraphNode<T>, ctx: ExecutionContext): Promise<NodeExecutionResult>;
}
