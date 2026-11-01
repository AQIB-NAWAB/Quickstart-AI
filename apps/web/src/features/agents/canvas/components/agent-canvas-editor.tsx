"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  graphOutputPorts,
  normalizeAgentGraph,
  validateAgentGraph as validateLocal,
  type AgentGraph,
  type GraphNodeType,
  type GraphValidationIssue,
  type GraphExecutionTrace,
  type GraphSessionState,
  type GraphDraftSettings,
} from "@quickstart/contracts";
import { CANVAS_NODE_TYPES, NODE_REGISTRY } from "../lib/node-registry";
import { CanvasEdge } from "./canvas-edge";
import { CanvasHeader } from "./canvas-header";
import { NodeLibrary } from "./node-library";
import { AddNodeMenu } from "./add-node-menu";
import { InspectorPanel } from "./inspectors/inspector-panel";
import { TestWorkbench } from "./workbench/test-workbench";
import { ExecutionTracePanel } from "./workbench/execution-trace-panel";
import { CanvasControls } from "./canvas-controls";
import { CanvasEmptyState } from "./canvas-empty-state";
import { PublishReleaseDialog } from "./publishing/publish-release-dialog";
import { AiAgentBuilderModal } from "./ai-agent-builder-modal";
import { graphToFlowElements, flowElementsToGraph } from "../lib/graph-adapter";
import {
  saveAgentGraph,
  validateAgentGraph,
  publishAgentGraph,
  initPreviewSession,
  executePreviewTurn,
  resetPreviewSession,
  proposeAiAgentEdit,
} from "../lib/client";
import type {
  CanvasFlowNode,
  CanvasFlowEdge,
  CanvasSaveState,
  InspectorTab,
  WorkbenchTab,
} from "../lib/types";
import type { ChatMessageItem } from "./workbench/chat-workbench";

const EDGE_TYPES = { canvasEdge: CanvasEdge };
type Snapshot = { nodes: CanvasFlowNode[]; edges: CanvasFlowEdge[]; settings: GraphDraftSettings };
export type AgentCanvasEditorProps = {
  workspaceId: string;
  agentId: string;
  agentName: string;
  initialRevision: number;
  initialPublishedRelease: number | null;
  initialGraph: AgentGraph | null;
  initialChannels?: { chat: boolean; voice: boolean };
  initialVoiceSettings?: GraphDraftSettings["voice"];
  initialTools?: import("@quickstart/contracts").AgentToolDefinition[];
  initialInstructions?: string;
  initialModelSettings?: Record<string, unknown>;
};

const InnerCanvas: React.FC<AgentCanvasEditorProps> = (props) => {
  const {
    workspaceId,
    agentId,
    agentName,
    initialRevision,
    initialPublishedRelease,
    initialGraph,
  } = props;
  const { screenToFlowPosition, fitView, getViewport, setCenter } = useReactFlow();
  const [document, setDocument] = useState<Snapshot>(() => ({
    ...(initialGraph ? graphToFlowElements(initialGraph) : { nodes: [], edges: [] }),
    settings: {
      instructions: props.initialInstructions ?? "",
      model_settings: props.initialModelSettings ?? {},
      channels: props.initialChannels ?? { chat: true, voice: false },
      voice: props.initialVoiceSettings,
    },
  }));
  const latest = useRef(document);
  latest.current = document;
  const revision = useRef(initialRevision);
  const [draftRevision, setDraftRevision] = useState(initialRevision);
  const [liveRelease, setLiveRelease] = useState(initialPublishedRelease);
  const [saveState, setSaveState] = useState<CanvasSaveState>("saved");
  const [notice, setNotice] = useState<string | null>(null);
  const [editSerial, setEditSerial] = useState(0);
  const serial = useRef(0),
    saving = useRef(false),
    savedSerial = useRef(0);
  const history = useRef<Snapshot[]>([document]);
  const index = useRef(0);
  const [historyPosition, setHistoryPosition] = useState({ index: 0, length: 1 });
  const [isLibraryOpen, setIsLibraryOpen] = useState(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState(Boolean(initialGraph?.nodes.length));
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("node");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isWorkbenchOpen, setIsWorkbenchOpen] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("chat");
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(null);
  const [previewRevision, setPreviewRevision] = useState(initialRevision);
  const [previewMessages, setPreviewMessages] = useState<ChatMessageItem[]>([]);
  const [previewSessionState, setPreviewSessionState] = useState<GraphSessionState | null>(null);
  const [activeTrace, setActiveTrace] = useState<GraphExecutionTrace | null>(null);
  const [isTurnExecuting, setIsTurnExecuting] = useState(false);
  const [validationIssues, setValidationIssues] = useState<GraphValidationIssue[]>([]);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [isAiBuilderOpen, setIsAiBuilderOpen] = useState(false);
  const [aiProposal, setAiProposal] = useState<
    import("@quickstart/contracts").AgentAiEditProposal | null
  >(null);
  const [isAiBuilderLoading, setIsAiBuilderLoading] = useState(false);
  const [aiBuilderError, setAiBuilderError] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState<{
    position: { x: number; y: number };
    flowPosition: { x: number; y: number };
    originatingPort?: { nodeId: string; portId: string; portLabel?: string };
  } | null>(null);
  const connectOrigin = useRef<{ nodeId: string; portId: string } | null>(null);
  const { nodes, edges, settings } = document;
  useEffect(() => {
    if (!previewSessionId || !isWorkbenchOpen) return;
    const events = new EventSource(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/preview/traces/stream?sessionId=${encodeURIComponent(previewSessionId)}`,
    );
    events.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as import("@quickstart/contracts").GraphTraceEvent;
        if (event.session_id !== previewSessionId) return;
        setActiveTrace((previous) => {
          const base =
            previous?.run_id === event.run_id
              ? previous
              : {
                  run_id: event.run_id,
                  session_id: event.session_id,
                  status: "running" as const,
                  total_duration_ms: 0,
                  steps: [],
                  started_at: event.start_time,
                };
          return {
            ...base,
            steps: [
              ...base.steps.filter(
                (e) =>
                  !(e.node_id === event.node_id && e.status === "running") &&
                  e.event_id !== event.event_id,
              ),
              event,
            ],
          };
        });
      } catch {
        /* Ignore malformed stream frames. The final response remains authoritative. */
      }
    };
    return () => events.close();
  }, [previewSessionId, isWorkbenchOpen, workspaceId, agentId]);
  const graphOf = (doc: Snapshot) =>
    normalizeAgentGraph(flowElementsToGraph(doc.nodes, doc.edges, getViewport()));
  const commit = useCallback((next: Snapshot) => {
    latest.current = next;
    setDocument(next);
    history.current = [...history.current.slice(0, index.current + 1), next].slice(-60);
    index.current = history.current.length - 1;
    setHistoryPosition({ index: index.current, length: history.current.length });
    serial.current += 1;
    setEditSerial(serial.current);
    setSaveState("unsaved");
  }, []);
  const travel = useCallback((delta: number) => {
    const next = index.current + delta;
    if (next < 0 || next >= history.current.length) return;
    index.current = next;
    latest.current = history.current[next];
    setDocument(history.current[next]);
    setHistoryPosition({ index: next, length: history.current.length });
    serial.current++;
    setEditSerial(serial.current);
    setSaveState("unsaved");
  }, []);
  useEffect(() => {
    if (!editSerial || saveState === "conflict" || saveState === "error") return;
    const timer = setTimeout(async () => {
      if (saving.current || savedSerial.current === serial.current) return;
      const ticket = serial.current;
      const doc = latest.current;
      saving.current = true;
      setSaveState("saving");
      try {
        const graph = graphOf(doc);
        const result = await saveAgentGraph(
          workspaceId,
          agentId,
          graph,
          revision.current,
          doc.settings,
        );
        revision.current = result.draft_revision;
        setDraftRevision(result.draft_revision);
        savedSerial.current = ticket;
        setValidationIssues(validateLocal(graph).issues);
        setSaveState(ticket === serial.current ? "saved" : "unsaved");
      } catch (error) {
        setSaveState((error as { code?: string }).code === "CONFLICT" ? "conflict" : "error");
        setNotice(
          error instanceof Error
            ? error.message
            : "Could not save. Your local changes are preserved.",
        );
      } finally {
        saving.current = false;
        if (ticket !== serial.current) setEditSerial((v) => v + 1);
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [editSerial, saveState, workspaceId, agentId]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (savedSerial.current !== serial.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable=true]"))
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        travel(e.shiftKey ? 1 : -1);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        travel(1);
      }
      if (e.key === "Escape") {
        setAddMenu(null);
        setIsPublishDialogOpen(false);
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("keydown", key);
    };
  }, [travel]);
  const addNode = (
    type: GraphNodeType,
    position?: { x: number; y: number },
    source?: { nodeId: string; portId: string },
  ) => {
    const doc = latest.current;
    if (type === "entrypoint" && doc.nodes.some((n) => n.type === type)) {
      setNotice("This flow already has an entrypoint.");
      return;
    }
    const id = `${type}_${crypto.randomUUID()}`;
    const node: CanvasFlowNode = {
      id,
      type,
      position:
        position ?? screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
      data: {
        type,
        label: NODE_REGISTRY[type].name,
        config: structuredClone(NODE_REGISTRY[type].defaultConfig),
      },
    };
    const nextEdges = source
      ? [
          ...doc.edges.filter(
            (e) => !(e.source === source.nodeId && e.sourceHandle === source.portId),
          ),
          {
            id: crypto.randomUUID(),
            source: source.nodeId,
            sourceHandle: source.portId,
            target: id,
            targetHandle: "in",
            type: "canvasEdge",
          },
        ]
      : doc.edges;
    commit({ ...doc, nodes: [...doc.nodes, node], edges: nextEdges });
    setSelectedNodeId(id);
    setIsInspectorOpen(true);
    setInspectorTab("node");
    setAddMenu(null);
  };
  const canConnect = (c: Connection | CanvasFlowEdge) => {
    const doc = latest.current;
    const source = doc.nodes.find((n) => n.id === c.source),
      target = doc.nodes.find((n) => n.id === c.target);
    return Boolean(
      source &&
      target &&
      target.type !== "entrypoint" &&
      source.type !== "end_conversation" &&
      source.id !== target.id &&
      graphOutputPorts(graphOf(doc).nodes.find((n) => n.id === source.id)!).includes(
        c.sourceHandle ?? "",
      ) &&
      !doc.edges.some((e) => e.source === c.source && e.sourceHandle === c.sourceHandle),
    );
  };
  const onConnect = (connection: Connection) => {
    if (!canConnect(connection)) return;
    commit({
      ...latest.current,
      edges: [
        ...latest.current.edges,
        { ...connection, id: crypto.randomUUID(), type: "canvasEdge" },
      ],
    });
  };
  const onNodesChange = (changes: NodeChange<CanvasFlowNode>[]) => {
    const doc = latest.current;
    const next = { ...doc, nodes: applyNodeChanges(changes, doc.nodes) };
    const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => c.id));
    if (removed.size) {
      next.edges = doc.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target));
      commit(next);
    } else {
      latest.current = next;
      setDocument(next);
    }
  };
  const onEdgesChange = (changes: EdgeChange<CanvasFlowEdge>[]) => {
    const next = { ...latest.current, edges: applyEdgeChanges(changes, latest.current.edges) };
    if (changes.some((c) => c.type === "remove")) commit(next);
    else {
      latest.current = next;
      setDocument(next);
    }
  };
  const updateNode = (id: string, change: Partial<CanvasFlowNode["data"]>) => {
    const next = {
      ...latest.current,
      nodes: latest.current.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...change } } : n,
      ),
    };
    // Prune removed branch connections using the same port contract as runtime.
    const normalized = graphOf(next);
    next.edges = next.edges.filter((e) =>
      graphOutputPorts(normalized.nodes.find((n) => n.id === e.source)!).includes(
        e.sourceHandle ?? "",
      ),
    );
    commit(next);
  };
  const deleteNode = (id: string) => {
    commit({
      ...latest.current,
      nodes: latest.current.nodes.filter((n) => n.id !== id),
      edges: latest.current.edges.filter((e) => e.source !== id && e.target !== id),
    });
    setSelectedNodeId(null);
  };
  const duplicateNode = (id: string) => {
    const n = latest.current.nodes.find((n) => n.id === id);
    if (!n || n.type === "entrypoint") return;
    const copy = {
      ...structuredClone(n),
      id: `${n.type}_${crypto.randomUUID()}`,
      selected: false,
      position: { x: n.position.x + 40, y: n.position.y + 40 },
    };
    commit({ ...latest.current, nodes: [...latest.current.nodes, copy] });
  };
  const focusNode = (id: string) => {
    setSelectedNodeId(id);
    setIsInspectorOpen(true);
    setInspectorTab("node");
    const n = latest.current.nodes.find((n) => n.id === id);
    if (n) void setCenter(n.position.x + 130, n.position.y + 80, { zoom: 1, duration: 200 });
  };
  const assistantMessages = (texts: string[]) =>
    texts.map((text) => ({
      id: crypto.randomUUID(),
      sender: "assistant" as const,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }));
  const openWorkbench = async () => {
    if (saveState !== "saved" || !nodes.length) {
      setNotice("Save a flow before starting a preview.");
      return;
    }
    setIsWorkbenchOpen(true);
    setIsLibraryOpen(false);
    setIsInspectorOpen(false);
    if (previewSessionId) return;
    setIsTurnExecuting(true);
    try {
      const res = await initPreviewSession(workspaceId, agentId, { channel: workbenchTab });
      setPreviewSessionId(res.sessionId);
      setPreviewRevision(res.draftRevision);
      setPreviewSessionState(res.session);
      setPreviewMessages(assistantMessages(res.initialMessages));
      setActiveTrace(res.trace ?? null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not initialize preview.");
    } finally {
      setIsTurnExecuting(false);
    }
  };
  const sendMessage = async (text: string) => {
    if (!previewSessionId || isTurnExecuting)
      throw new Error("Preview is not ready. Open or reset the workbench.");
    setPreviewMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        sender: "user",
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
    setIsTurnExecuting(true);
    try {
      const res = await executePreviewTurn(workspaceId, agentId, {
        sessionId: previewSessionId,
        message: text,
        channel: workbenchTab,
      });
      setPreviewMessages((prev) => [...prev, ...assistantMessages(res.messages)]);
      setPreviewSessionState(res.sessionState);
      setActiveTrace(res.trace);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Preview failed.");
      throw error;
    } finally {
      setIsTurnExecuting(false);
    }
  };
  const resetSession = async () => {
    if (!previewSessionId || isTurnExecuting) return;
    setIsTurnExecuting(true);
    try {
      const res = await resetPreviewSession(workspaceId, agentId, previewSessionId);
      setPreviewSessionId(res.sessionId);
      setPreviewRevision(res.draftRevision);
      setPreviewMessages(assistantMessages(res.initialMessages));
      setActiveTrace(res.trace ?? null);
      setPreviewSessionState(res.session);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Reset failed.");
    } finally {
      setIsTurnExecuting(false);
    }
  };
  const openPublish = async () => {
    if (saveState !== "saved" || !nodes.length) return;
    try {
      const result = await validateAgentGraph(workspaceId, agentId, graphOf(latest.current));
      setValidationIssues(result.issues);
      setIsPublishDialogOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Configuration could not be reviewed.");
    }
  };
  const openAiBuilder = () => {
    if (saveState !== "saved") {
      setNotice("Save the current draft before asking AI to update it.");
      return;
    }
    setAiProposal(null);
    setAiBuilderError(null);
    setIsAiBuilderOpen(true);
  };
  const generateAiEdit = async (prompt: string) => {
    setAiBuilderError(null);
    setAiProposal(null);
    setIsAiBuilderLoading(true);
    try {
      const proposal = await proposeAiAgentEdit(workspaceId, agentId, prompt);
      setAiProposal(proposal);
    } catch (error) {
      setAiBuilderError(
        error instanceof Error ? error.message : "Could not build an AI workflow draft.",
      );
    } finally {
      setIsAiBuilderLoading(false);
    }
  };
  const applyAiEdit = () => {
    if (!aiProposal?.validation.valid) return;
    const elements = graphToFlowElements(structuredClone(aiProposal.graph));
    commit({
      ...latest.current,
      ...elements,
      settings: { ...latest.current.settings, ...aiProposal.settings },
    });
    setSelectedNodeId(null);
    setIsInspectorOpen(false);
    setIsAiBuilderOpen(false);
    setAiProposal(null);
    setNotice("AI changes applied to the draft. Review the canvas before publishing.");
  };
  const decoratedNodes = nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      onDuplicate: duplicateNode,
      onDelete: deleteNode,
      hasErrors: validationIssues.some((i) => i.node_id === n.id && i.type === "error"),
      isExecuting:
        isTurnExecuting &&
        activeTrace?.steps.some((e) => e.node_id === n.id && e.status === "running"),
    },
  }));

  return (
    <div className="canvas-editor relative w-full h-full min-h-0 flex flex-col overflow-hidden bg-[#F9F9F9] text-[#262626]">
      <CanvasHeader
        workspaceId={workspaceId}
        agentId={agentId}
        agentName={agentName}
        draftRevision={draftRevision}
        publishedReleaseNumber={liveRelease}
        saveState={saveState}
        canUndo={historyPosition.index > 0}
        canRedo={historyPosition.index < historyPosition.length - 1}
        onUndo={() => travel(-1)}
        onRedo={() => travel(1)}
        onTestAgent={() => void openWorkbench()}
        onAiEdit={openAiBuilder}
        onPublish={() => void openPublish()}
        actionsDisabled={saveState !== "saved" || !nodes.length || isTurnExecuting}
        aiDisabled={saveState !== "saved" || isTurnExecuting}
      />
      {notice && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-orange-200 bg-orange-50 px-4 py-2 text-sm"
        >
          <span>{notice}</span>
          <div className="flex gap-3">
            {saveState === "error" && (
              <button
                onClick={() => {
                  setSaveState("unsaved");
                  setEditSerial(++serial.current);
                }}
              >
                Retry save
              </button>
            )}
            <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <NodeLibrary
          isOpen={isLibraryOpen}
          onToggle={() => setIsLibraryOpen((v) => !v)}
          onAddNode={addNode}
        />
        <div className="relative flex-1 min-w-0 min-h-0 flex flex-col">
          <div
            className="flex-1 min-h-0 relative"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const type = e.dataTransfer.getData("application/reactflow") as GraphNodeType;
              if (NODE_REGISTRY[type])
                addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
            }}
          >
            <ReactFlow
              nodes={decoratedNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={() => commit(latest.current)}
              onConnect={onConnect}
              isValidConnection={canConnect}
              onConnectStart={(_, p) => {
                connectOrigin.current =
                  p.handleType === "source" && p.nodeId && p.handleId
                    ? { nodeId: p.nodeId, portId: p.handleId }
                    : null;
              }}
              onConnectEnd={(event, state) => {
                if (!state.isValid && connectOrigin.current) {
                  const point = "changedTouches" in event ? event.changedTouches[0] : event;
                  setAddMenu({
                    position: {
                      x: Math.min(point.clientX, window.innerWidth - 370),
                      y: Math.min(point.clientY, window.innerHeight - 560),
                    },
                    flowPosition: screenToFlowPosition({ x: point.clientX, y: point.clientY }),
                    originatingPort: connectOrigin.current,
                  });
                }
                connectOrigin.current = null;
              }}
              onPaneContextMenu={(e) => {
                e.preventDefault();
                setAddMenu({
                  position: {
                    x: Math.min(e.clientX, window.innerWidth - 370),
                    y: Math.min(e.clientY, window.innerHeight - 560),
                  },
                  flowPosition: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
                });
              }}
              onNodeClick={(_, n) => focusNode(n.id)}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setAddMenu(null);
              }}
              nodeTypes={CANVAS_NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              defaultViewport={initialGraph?.viewport}
              fitView
              fitViewOptions={{ padding: 0.15, minZoom: 0.6, maxZoom: 0.9 }}
              snapToGrid
              snapGrid={[16, 16]}
              minZoom={0.2}
              maxZoom={2}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={0.8} color="#D9DDE3" />
              <CanvasControls />
            </ReactFlow>
            {!nodes.length && (
              <CanvasEmptyState
                onSelectGraph={(g) => {
                  const elements = graphToFlowElements(structuredClone(g));
                  commit({ ...latest.current, ...elements });
                  setIsInspectorOpen(false);
                  requestAnimationFrame(() => void fitView({ padding: 0.2 }));
                }}
              />
            )}
            {addMenu && (
              <AddNodeMenu
                isOpen
                position={addMenu.position}
                originatingPort={addMenu.originatingPort}
                hasExistingEntrypoint={nodes.some((n) => n.type === "entrypoint")}
                onSelectNode={(type) =>
                  addNode(type, addMenu.flowPosition, addMenu.originatingPort)
                }
                onClose={() => setAddMenu(null)}
              />
            )}
            {!isInspectorOpen && !isWorkbenchOpen && nodes.length > 0 && (
              <button
                className="absolute right-4 top-4 rounded-lg border bg-white px-3 py-2 text-xs shadow-sm"
                onClick={() => {
                  setInspectorTab("agent");
                  setIsInspectorOpen(true);
                }}
              >
                Agent settings
              </button>
            )}
          </div>
          {isWorkbenchOpen && (
            <div className="h-[260px] min-h-[180px] border-t border-[#EDEDED] bg-white">
              <ExecutionTracePanel trace={activeTrace} onSelectNode={focusNode} />
            </div>
          )}
        </div>
        {!isWorkbenchOpen && (
          <InspectorPanel
            workspaceId={workspaceId}
            tools={props.initialTools}
            nodes={nodes.map((n) => ({ id: n.id, name: n.data.label, type: n.data.type }))}
            targets={Object.fromEntries(
              edges
                .filter((e) => e.source === selectedNodeId)
                .map((e) => [e.sourceHandle ?? "", e.target]),
            )}
            onChangeTarget={(port, target) => {
              const next = latest.current.edges.filter(
                (e) => !(e.source === selectedNodeId && e.sourceHandle === port),
              );
              if (target && selectedNodeId)
                next.push({
                  id: crypto.randomUUID(),
                  source: selectedNodeId,
                  sourceHandle: port,
                  target,
                  targetHandle: "in",
                  type: "canvasEdge",
                });
              commit({ ...latest.current, edges: next });
            }}
            isOpen={isInspectorOpen}
            activeTab={inspectorTab}
            onTabChange={setInspectorTab}
            onClose={() => setIsInspectorOpen(false)}
            selectedNode={nodes.find((n) => n.id === selectedNodeId) ?? null}
            validationIssues={validationIssues}
            onUpdateNodeLabel={(id, label) => updateNode(id, { label })}
            onUpdateNodeConfig={(id, config) => updateNode(id, { config })}
            onDeleteNode={deleteNode}
            agentName={agentName}
            channels={settings.channels!}
            onChangeChannels={(channels) =>
              commit({ ...latest.current, settings: { ...latest.current.settings, channels } })
            }
            voiceSettings={settings.voice}
            onChangeVoiceSettings={(voice) =>
              commit({ ...latest.current, settings: { ...latest.current.settings, voice } })
            }
            instructions={settings.instructions ?? ""}
            onChangeInstructions={(instructions) =>
              commit({ ...latest.current, settings: { ...latest.current.settings, instructions } })
            }
            modelSettings={settings.model_settings ?? {}}
            onChangeModelSettings={(model_settings) =>
              commit({
                ...latest.current,
                settings: { ...latest.current.settings, model_settings },
              })
            }
            saveState={saveState}
          />
        )}
        <TestWorkbench
          isOpen={isWorkbenchOpen}
          onClose={() => setIsWorkbenchOpen(false)}
          activeTab={workbenchTab}
          onTabChange={(tab) => {
            if (tab !== workbenchTab) {
              setWorkbenchTab(tab);
            }
          }}
          draftRevision={previewRevision}
          messages={previewMessages}
          sessionState={previewSessionState}
          activeTrace={activeTrace}
          isLoading={isTurnExecuting}
          onSendMessage={sendMessage}
          onResetSession={previewSessionId ? resetSession : openWorkbench}
        />
      </div>
      {!isWorkbenchOpen && (
        <button
          className="h-10 shrink-0 flex items-center gap-4 border-t border-[#EDEDED] bg-white px-5 text-xs disabled:text-neutral-400"
          disabled={!nodes.length || saveState !== "saved"}
          onClick={() => void openWorkbench()}
        >
          <span className="font-semibold">▷ Test workbench</span>
          <span className="text-neutral-500">Chat or voice · inspect the execution path</span>
          <span className="ml-auto">Open workbench ›</span>
        </button>
      )}
      <PublishReleaseDialog
        isOpen={isPublishDialogOpen}
        onClose={() => setIsPublishDialogOpen(false)}
        agentName={agentName}
        draftRevision={draftRevision}
        currentReleaseNumber={liveRelease}
        nodesCount={nodes.length}
        edgesCount={edges.length}
        validationIssues={validationIssues}
        onOpenNode={focusNode}
        onConfirmPublish={async (notes) => {
          const result = await publishAgentGraph(workspaceId, agentId, revision.current, notes);
          setLiveRelease(result.release_number);
        }}
      />
      <AiAgentBuilderModal
        isOpen={isAiBuilderOpen}
        agentName={agentName}
        proposal={aiProposal}
        isLoading={isAiBuilderLoading}
        error={aiBuilderError}
        onClose={() => {
          if (!isAiBuilderLoading) setIsAiBuilderOpen(false);
        }}
        onReset={() => {
          setAiProposal(null);
          setAiBuilderError(null);
        }}
        onGenerate={(prompt) => void generateAiEdit(prompt)}
        onApply={applyAiEdit}
      />
    </div>
  );
};
export const AgentCanvasEditor: React.FC<AgentCanvasEditorProps> = (props) => (
  <ReactFlowProvider>
    <InnerCanvas {...props} />
  </ReactFlowProvider>
);
