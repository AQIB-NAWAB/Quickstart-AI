"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Globe2,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type { Agent } from "../lib/types";
import {
  createTestConversation,
  executeTestTurn,
  type TestTurnToolCall,
  type TestTurnUsage,
} from "../lib/client";
import { AgentOutlineIcon } from "@/components/brand/agent-outline-icon";
import { FormattedChatMessage } from "./formatted-chat-message";

type Props = {
  workspaceId: string;
  agent: Agent;
  releaseNumber?: number;
  isOpen?: boolean;
  onClose?: () => void;
  // Backward compatibility props if any
  isDrawer?: boolean;
  isInline?: boolean;
  onCloseDrawer?: () => void;
  onCollapseInline?: () => void;
  isCollapsedInline?: boolean;
};

type ChatMessage = {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: string;
  toolCalls?: TestTurnToolCall[];
  usage?: TestTurnUsage;
  latencyMs?: number;
};

const TEST_PRESETS = [
  {
    id: "knowledge",
    title: "Knowledge Query",
    shortLabel: "Knowledge",
    icon: Sparkles,
    badge: "RAG",
    prompt: "What can you help with and what services do you provide?",
    desc: "Tests FAQ retrieval and semantic knowledge base accuracy.",
  },
  {
    id: "tool",
    title: "Tool Execution",
    shortLabel: "Tool Action",
    icon: Zap,
    badge: "Action",
    prompt: "Can you check the current available appointment slots or records?",
    desc: "Triggers connected agent tools and function arguments.",
  },
  {
    id: "confirm",
    title: "Confirmation Flow",
    shortLabel: "Guardrails",
    icon: ShieldCheck,
    badge: "Safety",
    prompt: "Yes, I confirm I want to proceed and finalize this booking.",
    desc: "Tests state changes and user confirmation safety checks.",
  },
  {
    id: "roman_urdu",
    title: "Roman Urdu",
    shortLabel: "Roman Urdu",
    icon: Globe2,
    badge: "Voice/Lang",
    prompt: "Mujhe appointment book karni hai kal sham ko, timing check karo",
    desc: "Tests multilingual voice and chat intent comprehension.",
  },
];

export function TestAgentPanel({
  workspaceId,
  agent,
  releaseNumber,
  isOpen = true,
  onClose,
  onCloseDrawer,
  onCollapseInline,
}: Props) {
  const handleClose = onClose || onCloseDrawer || onCollapseInline;

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [liveTools, setLiveTools] = useState<TestTurnToolCall[]>([]);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionRef = useRef<string | null>(null);
  const sendLockRef = useRef(false);

  const isPublished = Boolean(agent.production_version_id);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    if (messages.length || liveTools.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages, isSending, liveTools]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose?.();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  // Reset conversation session
  function handleReset() {
    activeSessionRef.current = null;
    setConversationId(null);
    setMessages([]);
    setLiveTools([]);
    setError(null);
    setInput("");
  }

  function toggleToolExpand(toolKey: string) {
    setExpandedTools((prev) => ({ ...prev, [toolKey]: !prev[toolKey] }));
  }

  function handleCopyParams(key: string, data: unknown) {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  async function sendMessage(textToSend: string) {
    const text = textToSend.trim();
    if (!text || sendLockRef.current || isSending || !isPublished) return;
    sendLockRef.current = true;

    setError(null);
    setInput("");
    setLiveTools([]);

    // Create conversation lazily if not yet initialized
    let currentConvId = conversationId;
    if (!currentConvId) {
      try {
        const initRes = await createTestConversation(workspaceId, agent.id);
        if (initRes.error || !initRes.conversationId) {
          setError(initRes.error?.message || "Could not start test conversation.");
          setInput(text);
          sendLockRef.current = false;
          return;
        }
        currentConvId = initRes.conversationId;
        setConversationId(currentConvId);
        activeSessionRef.current = currentConvId;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize test conversation.");
        setInput(text);
        sendLockRef.current = false;
        return;
      }
    }

    const sessionId = currentConvId;
    activeSessionRef.current = sessionId;

    const userMsgId = `u-${Date.now()}`;
    const assistantMsgId = `a-${Date.now()}`;
    const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const startTime = performance.now();

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, sender: "user", text, timestamp: nowTime },
      { id: assistantMsgId, sender: "assistant", text: "", timestamp: nowTime },
    ]);

    setIsSending(true);

    try {
      const turnRes = await executeTestTurn(workspaceId, sessionId, text, {
        onToken: (delta) => {
          if (activeSessionRef.current !== sessionId) return;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId ? { ...msg, text: msg.text + delta } : msg,
            ),
          );
        },
        onToolStart: (tool) => {
          if (activeSessionRef.current !== sessionId) return;
          setLiveTools((prev) => {
            if (prev.some((t) => t.name === tool.name && t.status === "pending")) return prev;
            return [...prev, { name: tool.name, status: "pending", args: tool.args }];
          });
        },
        onToolDone: (tool) => {
          if (activeSessionRef.current !== sessionId) return;
          setLiveTools((prev) =>
            prev.map((t) =>
              t.name === tool.name
                ? { ...t, status: tool.status, args: tool.args, error: tool.error }
                : t,
            ),
          );
        },
      });

      if (activeSessionRef.current !== sessionId) return;

      const latencyMs = Math.round(performance.now() - startTime);

      if (turnRes.error) {
        setError(turnRes.error.message || "Failed to get assistant response.");
      } else {
        const finalTools = turnRes.toolCalls?.length ? turnRes.toolCalls : liveTools;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  text: msg.text || turnRes.assistantText || "",
                  toolCalls: finalTools.length > 0 ? finalTools : undefined,
                  usage: turnRes.usage,
                  latencyMs,
                }
              : msg,
          ),
        );
      }
    } catch (err) {
      if (activeSessionRef.current === sessionId) {
        setError(err instanceof Error ? err.message : "Turn request failed.");
      }
    } finally {
      sendLockRef.current = false;
      if (activeSessionRef.current === sessionId) {
        setIsSending(false);
        setLiveTools([]);
      }
    }
  }

  function handleSend() {
    void sendMessage(input);
  }

  function handlePresetClick(presetPrompt: string) {
    if (isSending) return;
    void sendMessage(presetPrompt);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-agent-panel-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#101828]/40 animate-in fade-in duration-150 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose?.();
      }}
    >
      <div className="w-full max-w-[720px] h-[720px] max-h-[calc(100dvh-32px)] bg-white rounded-[10px] border border-[#E4E7EC] shadow-xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between border-b border-[#EDF0F2] bg-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-[8px] bg-[#F8F9FA] border border-[#E4E7EC] flex items-center justify-center text-[#475467] shrink-0">
              <AgentOutlineIcon className="w-5 h-5 text-[#475467]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2
                  id="test-agent-panel-title"
                  className="text-[16px] font-semibold text-[#202125] truncate"
                >
                  Test Agent Workbench
                </h2>
                {releaseNumber && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F2F4F7] text-[#475467]">
                    Release #{releaseNumber}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-[#667085] truncate">{agent.name}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label="Close test dialog"
            className="p-1.5 text-[#667085] hover:text-[#202125] hover:bg-[#F8F9FA] rounded-[6px] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status & Reset Toolbar */}
        <div className="px-5 py-2.5 bg-[#FCFCFD] border-b border-[#EDF0F2] flex items-center justify-between text-[13px] shrink-0">
          {isPublished ? (
            <div className="flex items-center gap-2 font-medium text-[#202125]">
              <span className="w-2 h-2 rounded-full bg-[#12B76A]" aria-hidden="true" />
              <span className="text-[12px]">
                {releaseNumber ? `Live release #${releaseNumber} loaded` : "Live published runtime"}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[#B54708] font-medium text-[12px]">
              <span className="w-2 h-2 rounded-full bg-[#F79009]" aria-hidden="true" />
              <span>Unpublished (publish to enable real tool execution)</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              title="Reset conversation session"
              className="inline-flex items-center gap-1.5 text-[#475467] hover:text-[#202125] font-medium border border-[#D0D5DD] px-2.5 py-1 rounded-[6px] bg-white hover:bg-[#F8F9FA] transition-colors text-[12px]"
            >
              <RotateCcw className="w-3 h-3" />
              Reset Session
            </button>
          </div>
        </div>

        {/* Messages Viewport */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4 flex flex-col bg-white">
          {messages.length === 0 ? (
            /* Empty State with One-Click Test Presets */
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-4">
              <div className="w-11 h-11 rounded-[8px] bg-[#F8F9FA] border border-[#E4E7EC] text-[#667085] flex items-center justify-center mb-2.5">
                <Sparkles className="w-5 h-5 text-[#667085]" />
              </div>
              <h3 className="text-[15px] font-semibold text-[#202125]">
                Interactive Test Workbench
              </h3>
              <p className="mt-1 text-[13px] text-[#667085] max-w-[360px]">
                {isPublished
                  ? "Test conversation flow, tool invocations, and guardrails with one-click presets."
                  : "Publish this agent to start testing live conversations and tools."}
              </p>

              {isPublished && (
                <div className="mt-5 w-full max-w-[520px]">
                  <div className="text-[11px] uppercase font-medium tracking-[0.04em] text-[#667085] mb-2.5 text-left">
                    One-Click Test Presets
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
                    {TEST_PRESETS.map((preset) => {
                      const Icon = preset.icon;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handlePresetClick(preset.prompt)}
                          className="p-3 rounded-[8px] border border-[#E4E7EC] bg-white hover:bg-[#FAFAFA] hover:border-[#D0D5DD] transition-colors flex flex-col items-start text-left group"
                        >
                          <div className="w-full flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <div className="w-6 h-6 rounded-[6px] bg-[#F8F9FA] border border-[#EAECF0] flex items-center justify-center shrink-0">
                                <Icon className="w-3.5 h-3.5 text-[#475467]" />
                              </div>
                              <span className="text-[13px] font-semibold text-[#202125]">
                                {preset.title}
                              </span>
                            </div>
                            <span className="text-[10px] font-medium uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[4px] bg-[#F8F9FA] border border-[#EAECF0] text-[#667085]">
                              {preset.badge}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#667085] leading-relaxed line-clamp-2">
                            {preset.desc}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            messages.map((msg) => {
              const isAssistant = msg.sender === "assistant";
              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                >
                  {isAssistant && (
                    <div className="w-7 h-7 rounded-[6px] bg-white border border-[#DCE1E8] flex items-center justify-center text-[#202125] shrink-0 mt-0.5">
                      <AgentOutlineIcon className="w-4 h-4 text-[#202125]" />
                    </div>
                  )}

                  <div
                    className={`flex flex-col ${
                      msg.sender === "user" ? "items-end" : "items-start"
                    } max-w-[85%] sm:max-w-[80%]`}
                  >
                    <div
                      className={`w-full rounded-[12px] px-4 py-3 text-[14px] leading-relaxed break-words [overflow-wrap:anywhere] ${
                        msg.sender === "user"
                          ? "bg-[#202125] text-white rounded-br-[2px]"
                          : "bg-[#F8F9FB] border border-[#DCE1E8] text-[#202125] rounded-bl-[2px]"
                      }`}
                    >
                      {/* Live tool execution indicator during turn */}
                      {isAssistant &&
                        isSending &&
                        msg.id === messages[messages.length - 1]?.id &&
                        liveTools.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2.5">
                            {liveTools.map((tc, idx) => (
                              <div
                                key={idx}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-[12px] font-medium bg-[#F8F9FA] border border-[#E4E7EC] text-[#475467] animate-pulse"
                              >
                                <Zap className="w-3.5 h-3.5 text-[#667085]" />
                                <span>Calling {tc.name}...</span>
                              </div>
                            ))}
                          </div>
                        )}

                      {/* Completed Tool Execution Badges & Diagnostics */}
                      {isAssistant && msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="flex flex-col gap-1.5 mb-2.5">
                          {msg.toolCalls.map((tc, idx) => {
                            const toolKey = `${msg.id}-${tc.name}-${idx}`;
                            const isExpanded = Boolean(expandedTools[toolKey]);
                            const isSuccess = tc.status === "succeeded";
                            const isFailed = tc.status === "failed";

                            return (
                              <div
                                key={toolKey}
                                className="rounded-[8px] border border-[#DCE1E8] bg-white overflow-hidden text-[12px] shadow-xs"
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleToolExpand(toolKey)}
                                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[#F8F9FB] transition-colors text-left"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Zap className="w-3.5 h-3.5 text-[#667085] shrink-0" />
                                    <span className="font-mono font-semibold text-[#202125] truncate">
                                      {tc.name}
                                    </span>
                                    {isSuccess ? (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[#E9F9EF] text-[#15803D] border border-[#B6EAC4]">
                                        <CheckCircle2 className="w-3 h-3" />
                                        success
                                      </span>
                                    ) : isFailed ? (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-50 text-red-700 border border-red-200">
                                        <AlertCircle className="w-3 h-3" />
                                        failed
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                        pending
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1 text-[#667085] shrink-0 text-[11px] font-medium ml-2">
                                    <span>{isExpanded ? "Hide params" : "View params"}</span>
                                    <ChevronDown
                                      className={`w-3.5 h-3.5 transition-transform duration-150 ${
                                        isExpanded ? "rotate-180" : ""
                                      }`}
                                    />
                                  </div>
                                </button>

                                {isExpanded && (
                                  <div className="p-3 bg-[#FAFBFD] border-t border-[#EDF0F2] font-mono text-[11px] text-[#344054]">
                                    <div className="flex items-center justify-between mb-1.5 text-[10px] font-sans font-semibold text-[#667085] uppercase tracking-wider">
                                      <span>Input Arguments</span>
                                      <button
                                        type="button"
                                        onClick={() => handleCopyParams(toolKey, tc.args ?? {})}
                                        className="inline-flex items-center gap-1 text-[#475467] hover:text-[#202125] transition-colors"
                                      >
                                        {copiedKey === toolKey ? (
                                          <>
                                            <Check className="w-3 h-3 text-[#15803D]" />
                                            <span className="text-[#15803D]">Copied</span>
                                          </>
                                        ) : (
                                          <>
                                            <Copy className="w-3 h-3" />
                                            <span>Copy JSON</span>
                                          </>
                                        )}
                                      </button>
                                    </div>

                                    {tc.args && Object.keys(tc.args).length > 0 ? (
                                      <pre className="overflow-x-auto whitespace-pre-wrap p-2 rounded-[6px] bg-white border border-[#E4E7EC] max-h-36">
                                        {JSON.stringify(tc.args, null, 2)}
                                      </pre>
                                    ) : (
                                      <span className="text-[#667085] italic font-sans">
                                        No input parameters passed
                                      </span>
                                    )}

                                    {tc.error && (
                                      <div className="mt-2 p-2 rounded-[6px] bg-red-50 border border-red-200 text-red-700 font-sans text-[11px]">
                                        <span className="font-semibold">Error:</span> {tc.error}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Main Message Text */}
                      {msg.text ? (
                        <FormattedChatMessage text={msg.text} isUser={msg.sender === "user"} />
                      ) : isSending && isAssistant ? (
                        <span className="inline-flex items-center gap-1 text-[#667085] py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#667085] animate-pulse" />
                          <span className="w-1.5 h-1.5 rounded-full bg-[#667085] animate-pulse delay-75" />
                          <span className="w-1.5 h-1.5 rounded-full bg-[#667085] animate-pulse delay-150" />
                        </span>
                      ) : null}
                    </div>

                    {/* Metadata Footer: Timestamp + Latency + Token Usage */}
                    <div className="flex items-center gap-2 mt-1 px-1 text-[11px] text-[#7A808A]">
                      <span>{msg.timestamp}</span>
                      {msg.latencyMs !== undefined && (
                        <>
                          <span>•</span>
                          <span>{(msg.latencyMs / 1000).toFixed(2)}s latency</span>
                        </>
                      )}
                      {msg.usage?.total_tokens !== undefined && (
                        <>
                          <span>•</span>
                          <span
                            title={`Input: ${msg.usage.input_tokens ?? 0}, Output: ${msg.usage.output_tokens ?? 0}`}
                          >
                            {msg.usage.total_tokens} tokens
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="px-5 py-2.5 bg-red-50 text-[12px] text-[#B42318] border-t border-red-200 flex items-center justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-red-700 hover:text-red-900 font-medium text-[11px]"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Composer & Quick Presets Toolbar */}
        <div className="p-4 bg-white border-t border-[#EDF0F2] shrink-0">
          {/* Quick Preset Chip Strip */}
          {isPublished && (
            <div className="mb-2.5 flex items-center gap-1.5 overflow-x-auto pb-1 text-[12px]">
              <span className="text-[11px] font-medium text-[#667085] uppercase tracking-[0.04em] shrink-0 mr-1">
                Presets:
              </span>
              {TEST_PRESETS.map((preset) => {
                const Icon = preset.icon;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handlePresetClick(preset.prompt)}
                    disabled={isSending}
                    title={preset.prompt}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] border border-[#D0D5DD] bg-white hover:bg-[#F8F9FA] hover:border-[#98A2B3] text-[#344054] text-[12px] font-medium transition-colors shrink-0 disabled:opacity-40"
                  >
                    <Icon className="w-3 h-3 text-[#667085]" />
                    <span>{preset.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="relative border border-[#D0D5DD] rounded-[8px] focus-within:border-[#98A2B3] focus-within:ring-1 focus-within:ring-[#E4E7EC] transition-all bg-white">
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!isPublished || isSending}
              placeholder={
                isPublished ? "Message your agent..." : "Publish to enable live testing..."
              }
              className="w-full resize-none p-3 pr-12 text-[14px] text-[#202125] bg-transparent focus:outline-none placeholder-[#98A2B3] disabled:opacity-50 min-h-[68px]"
            />
            <button
              type="button"
              onClick={() => handleSend()}
              disabled={!input.trim() || isSending || !isPublished}
              aria-label="Send message"
              className="absolute right-2.5 bottom-2.5 p-2 rounded-[8px] bg-[#202125] text-white hover:bg-black disabled:opacity-30 disabled:hover:bg-[#202125] transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-[#667085]">
            <span>Press Enter to send, Shift+Enter for new line</span>
            <span>Live tool calls execute in real time</span>
          </div>
        </div>
      </div>
    </div>
  );
}
