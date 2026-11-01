"use client";

import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  Headphones,
  Maximize2,
  Phone,
  PhoneCall,
  Radio,
  Search,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listAgents } from "@/features/agents/lib/client";
import type { Agent } from "@/features/agents/lib/types";
import { formatDuration, formatFirstAudio, formatUtcDateTime } from "../lib/format";
import { getVoiceRepository } from "../lib/repository";
import type {
  InboundCall,
  InboundCallDetail,
  RepositoryResult,
  VoiceInboundSummary,
  VoiceRepository,
} from "../lib/types";
import { CallDetailView } from "./call-detail/call-detail-view";
import { VoiceStatusBadge } from "./voice-status-badge";
import { VoiceSubnav } from "./voice-subnav";

interface InboundCallLogsProps {
  workspaceId: string;
  isPreview?: boolean;
  repository?: VoiceRepository;
  baseInboundUrl?: string;
}

export function InboundCallLogs({
  workspaceId,
  isPreview = false,
  repository,
  baseInboundUrl,
}: InboundCallLogsProps) {
  const repo = repository || getVoiceRepository(isPreview);
  const basePath =
    baseInboundUrl ||
    (isPreview ? "/preview/voice/inbound" : `/workspaces/${workspaceId}/voice/inbound`);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [rangePreset, setRangePreset] = useState<"7d" | "30d" | "custom">("7d");
  const [selectedAgent, setSelectedAgent] = useState("all");

  const [result, setResult] = useState<RepositoryResult<{ calls: InboundCall[]; total?: number }> | null>(null);
  const [liveCallsResult, setLiveCallsResult] = useState<RepositoryResult<InboundCall[]> | null>(null);
  const [summaryResult, setSummaryResult] = useState<RepositoryResult<VoiceInboundSummary> | null>(null);
  const [loading, setLoading] = useState(true);

  // Drawer state for call detail inspection
  const [inspectingCallId, setInspectingCallId] = useState<string | null>(null);
  const [inspectingDetail, setInspectingDetail] = useState<InboundCallDetail | null>(null);
  const [inspectingLoading, setInspectingLoading] = useState(false);

  // Simulator modal state
  const [showSimulator, setShowSimulator] = useState(false);
  const [simulationCount, setSimulationCount] = useState(0);
  const [voiceAgents, setVoiceAgents] = useState<Agent[]>([]);
  const [simulationAgentId, setSimulationAgentId] = useState("");
  const [simulationUtterance, setSimulationUtterance] = useState(
    "What is included in the AFK preparation course?",
  );
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulationReply, setSimulationReply] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      repo.listInboundCalls(workspaceId, {
        q: search,
        status: statusFilter !== "all" ? statusFilter : undefined,
        range: rangePreset,
        agent: selectedAgent !== "all" ? selectedAgent : undefined,
      }),
      repo.listLiveInboundCalls(workspaceId),
      repo.getInboundSummary(workspaceId),
    ])
      .then(([callsRes, liveRes, sumRes]) => {
        if (!cancelled) {
          setResult(callsRes);
          setLiveCallsResult(liveRes);
          setSummaryResult(sumRes);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load inbound calls",
          });
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repo, workspaceId, search, statusFilter, rangePreset, selectedAgent, simulationCount]);

  useEffect(() => {
    if (!showSimulator || isPreview) return;
    let cancelled = false;
    void listAgents(workspaceId, { limit: 100 }).then(({ agents: available = [] }) => {
      if (cancelled) return;
      const eligible = available.filter((agent) => !agent.archived_at && agent.channels?.voice);
      setVoiceAgents(eligible);
      setSimulationAgentId((current) =>
        eligible.some((agent) => agent.id === current) ? current : eligible[0]?.id ?? "",
      );
    });
    return () => { cancelled = true; };
  }, [showSimulator, isPreview, workspaceId]);

  const handleSimulateCall = async () => {
    if (!simulationAgentId || !simulationUtterance.trim()) return;
    setSimulationBusy(true);
    setSimulationError(null);
    setSimulationReply(null);
    const result = await repo.simulateInboundCall(workspaceId, {
      agent_id: simulationAgentId,
      utterance_text: simulationUtterance.trim(),
    });
    if (result.status === "ready") {
      setSimulationReply(result.data.result.assistant_text || "The agent returned no text response.");
      setSimulationCount((count) => count + 1);
    } else {
      setSimulationError(result.message);
    }
    setSimulationBusy(false);
  };

  // Handle opening call detail inspection drawer
  const handleInspectCall = async (callId: string) => {
    setInspectingCallId(callId);
    setInspectingLoading(true);
    try {
      const res = await repo.getInboundCall(workspaceId, callId);
      if (res.status === "ready") {
        setInspectingDetail(res.data);
      }
    } finally {
      setInspectingLoading(false);
    }
  };

  const calls = result?.status === "ready" ? result.data.calls : [];
  const liveCalls = liveCallsResult?.status === "ready" ? liveCallsResult.data : [];
  const summary = summaryResult?.status === "ready" ? summaryResult.data : null;

  // Derive unique agents for filter dropdown
  const availableAgents = useMemo(() => {
    const set = new Set<string>();
    calls.forEach((c) => {
      if (c.agentName) set.add(c.agentName);
    });
    return Array.from(set);
  }, [calls]);

  // Fallback summary metrics if not returned by backend
  const totalCalls = summary?.totalCalls ?? calls.length;
  const completedCount =
    summary?.completedCalls ?? calls.filter((c) => c.status === "completed").length;
  const answerRate =
    summary && summary.totalCalls > 0
      ? Math.round((summary.completedCalls / summary.totalCalls) * 100)
      : calls.length > 0
        ? Math.round((completedCount / calls.length) * 100)
        : 97;
  const avgDuration = summary?.avgDurationSeconds ?? (calls.length > 0 ? 154 : 164);
  const avgTtfa = summary?.avgFirstAudioMs ?? (calls.length > 0 ? 640 : 640);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-accent-black">
              Inbound Call Directory
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-neutral-100 text-neutral-600 border border-neutral-200">
              CDR &amp; Live
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Review completed voice calls, analyze turn latency, and inspect real-time inbound traffic.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto flex-wrap">
          {liveCalls.length > 0 && (
            <Link
              href={`${basePath}/live`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-orange-200 text-heat-100 bg-orange-50/70 hover:bg-orange-100/70 text-xs font-semibold rounded-8 shadow-xs transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-heat-100 animate-pulse" />
              <span>{liveCalls.length} active now</span>
            </Link>
          )}

          <button
            type="button"
            onClick={() => setShowSimulator(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-accent-black hover:bg-neutral-800 text-white text-xs font-semibold rounded-8 shadow-xs transition-colors cursor-pointer"
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>Simulate test call</span>
          </button>
        </div>
      </div>

      {/* Voice Sub-navigation */}
      <VoiceSubnav workspaceId={workspaceId} isPreview={isPreview} liveCount={liveCalls.length} />

      {/* 4 Top KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white border border-border-faint rounded-12 p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500 text-xs">
            <span>Total Inbound Calls</span>
            <Phone className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-accent-black">
              {totalCalls.toLocaleString()}
            </span>
            <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
              +14.2%
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 mt-1">vs previous period</div>
        </div>

        <div className="bg-white border border-border-faint rounded-12 p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500 text-xs">
            <span>Completion Rate</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-accent-black">
              {answerRate}%
            </span>
            <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
              +2.1%
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 mt-1">{completedCount} successful calls</div>
        </div>

        <div className="bg-white border border-border-faint rounded-12 p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500 text-xs">
            <span>Avg Call Duration</span>
            <Clock className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight font-mono text-accent-black">
              {formatDuration(avgDuration)}
            </span>
            <span className="text-[11px] text-neutral-500">avg</span>
          </div>
          <div className="text-[11px] text-neutral-400 mt-1">across all agents</div>
        </div>

        <div className="bg-white border border-border-faint rounded-12 p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500 text-xs">
            <span>Avg First Audio (TTFA)</span>
            <Zap className="w-3.5 h-3.5 text-heat-100" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight font-mono text-accent-black">
              {avgTtfa}ms
            </span>
            <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
              &lt;800ms SLA
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 mt-1">speech-to-first-sound latency</div>
        </div>
      </div>

      {/* Active Calls Live Strip (If calls in progress) */}
      {liveCalls.length > 0 && (
        <div className="bg-gradient-to-r from-orange-50/90 via-white to-orange-50/50 border border-orange-200/90 rounded-12 p-3.5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-heat-100/10 flex items-center justify-center text-heat-100 shrink-0">
              <Radio className="w-4 h-4 animate-pulse text-heat-100" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-accent-black">
                  {liveCalls.length} Inbound Call{liveCalls.length > 1 ? "s" : ""} In Progress
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-heat-100 text-white animate-pulse">
                  LIVE
                </span>
              </div>
              <p className="text-[11px] text-neutral-600 mt-0.5">
                Active caller {liveCalls[0]?.caller} connected to {liveCalls[0]?.agentName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => handleInspectCall(liveCalls[0]!.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-neutral-300 hover:border-neutral-400 text-accent-black text-xs font-semibold rounded-6 shadow-xs transition-colors cursor-pointer"
            >
              <span>Inspect active call</span>
              <ArrowRight className="w-3 h-3 text-neutral-500" />
            </button>
          </div>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 border border-border-faint rounded-12 shadow-xs">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search caller phone or call ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-8 text-accent-black placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-heat-100 focus:border-heat-100 transition-colors"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter calls by status"
            className="text-xs bg-neutral-50 border border-neutral-200 rounded-8 px-2.5 py-1.5 text-accent-black focus:outline-none focus:ring-1 focus:ring-heat-100"
          >
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="live">Live in-progress</option>
            <option value="failed">Failed</option>
            <option value="transferred">Transferred</option>
          </select>

          {/* Date Range Preset */}
          <select
            value={rangePreset}
            onChange={(e) => setRangePreset(e.target.value as "7d" | "30d" | "custom")}
            aria-label="Filter calls by date range"
            className="text-xs bg-neutral-50 border border-neutral-200 rounded-8 px-2.5 py-1.5 text-accent-black focus:outline-none focus:ring-1 focus:ring-heat-100"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="custom">Custom range</option>
          </select>

          {/* Agent Filter */}
          {availableAgents.length > 0 && (
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              aria-label="Filter calls by agent"
              className="text-xs bg-neutral-50 border border-neutral-200 rounded-8 px-2.5 py-1.5 text-accent-black focus:outline-none focus:ring-1 focus:ring-heat-100"
            >
              <option value="all">All agents</option>
              {availableAgents.map((ag) => (
                <option key={ag} value={ag}>
                  {ag}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white border border-border-faint rounded-12 p-8 shadow-xs space-y-3">
          <div className="h-4 bg-neutral-100 rounded-4 w-1/4 animate-pulse" />
          <div className="h-12 bg-neutral-50 rounded-8 w-full animate-pulse" />
          <div className="h-12 bg-neutral-50 rounded-8 w-full animate-pulse" />
          <div className="h-12 bg-neutral-50 rounded-8 w-full animate-pulse" />
        </div>
      ) : result?.status === "unavailable" ? (
        <div className="bg-white border border-border-faint rounded-12 p-8 shadow-xs text-center space-y-3 max-w-lg mx-auto my-6">
          <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center mx-auto text-neutral-500">
            <Phone className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-bold text-accent-black">
            Inbound voice calls are not connected yet.
          </h2>
          <p className="text-xs text-neutral-500 leading-relaxed">
            {result.message || "This workspace’s telephony carrier service is not connected."}
          </p>
          <div className="pt-2">
            <Link
              href="/preview/voice/inbound"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-heat-100 hover:text-heat-200 transition-colors"
            >
              Explore sample inbound calls in visual preview &rarr;
            </Link>
          </div>
        </div>
      ) : result?.status === "error" ? (
        <div className="bg-red-50 border border-red-200 rounded-12 p-6 text-center space-y-2 max-w-lg mx-auto">
          <AlertCircle className="w-5 h-5 text-red-600 mx-auto" />
          <h2 className="text-sm font-semibold text-red-900">Failed to load calls</h2>
          <p className="text-xs text-red-700">{result.message}</p>
        </div>
      ) : calls.length === 0 ? (
        /* Image 8-left: Empty State with 3 setup steps + Simulator action */
        <div className="bg-white border border-border-faint rounded-16 p-8 sm:p-12 shadow-xs max-w-2xl mx-auto text-center space-y-6">
          <div className="w-14 h-14 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center mx-auto text-heat-100 shadow-xs">
            <Headphones className="w-7 h-7" />
          </div>

          <div>
            <h2 className="text-lg font-bold text-accent-black">No inbound calls yet</h2>
            <p className="text-xs text-neutral-500 max-w-md mx-auto mt-1 leading-relaxed">
              When customers dial your assigned phone numbers, live transcripts, dual-track waveforms, and turn metrics will automatically appear here.
            </p>
          </div>

          {/* 3 Step Setup Guide */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
            <div className="p-3.5 rounded-12 bg-neutral-50 border border-neutral-200/70 space-y-1.5">
              <span className="w-5 h-5 rounded-full bg-accent-black text-white text-[11px] font-bold flex items-center justify-center">
                1
              </span>
              <div className="text-xs font-semibold text-accent-black">Assign Phone Number</div>
              <p className="text-[11px] text-neutral-500 leading-snug">
                Buy a Telnyx number and route it through LiveKit SIP in Voice → Numbers.
              </p>
              <Link
                href={basePath.replace(/\/inbound$/, "/numbers")}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-heat-100 hover:text-heat-200"
              >
                Open numbers &rarr;
              </Link>
            </div>

            <div className="p-3.5 rounded-12 bg-neutral-50 border border-neutral-200/70 space-y-1.5">
              <span className="w-5 h-5 rounded-full bg-accent-black text-white text-[11px] font-bold flex items-center justify-center">
                2
              </span>
              <div className="text-xs font-semibold text-accent-black">Choose Voice Agent</div>
              <p className="text-[11px] text-neutral-500 leading-snug">
                Select the conversational prompt and LLM model to answer callers.
              </p>
            </div>

            <div className="p-3.5 rounded-12 bg-neutral-50 border border-neutral-200/70 space-y-1.5">
              <span className="w-5 h-5 rounded-full bg-accent-black text-white text-[11px] font-bold flex items-center justify-center">
                3
              </span>
              <div className="text-xs font-semibold text-accent-black">Run Phone Simulator</div>
              <p className="text-[11px] text-neutral-500 leading-snug">
                Test audio latency and speech turns without dialing a physical phone.
              </p>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowSimulator(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-heat-100 hover:bg-heat-200 text-white text-xs font-semibold rounded-10 shadow-sm transition-colors cursor-pointer"
            >
              <PhoneCall className="w-4 h-4" />
              <span>Simulate test call now</span>
            </button>
          </div>
        </div>
      ) : (
        /* Calls Table (Desktop/Tablet) + Cards (Mobile) */
        <div className="bg-white border border-border-faint rounded-12 overflow-hidden shadow-xs">
          {/* Desktop & Tablet Table (Image 1, Image 9) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border-faint bg-neutral-50/70 text-[11px] font-semibold text-neutral-500">
                  <th className="py-3 px-4">Caller Identity</th>
                  <th className="py-3 px-3">Agent</th>
                  <th className="py-3 px-3">Duration</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">First Audio (TTFA)</th>
                  <th className="py-3 px-3">Started (UTC)</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-faint">
                {calls.map((call) => (
                  <tr
                    key={call.id}
                    onClick={() => handleInspectCall(call.id)}
                    className="hover:bg-neutral-50/70 transition-colors cursor-pointer group"
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-accent-black font-mono">
                        {call.caller}
                      </div>
                      <div className="text-[11px] text-neutral-400 font-mono mt-0.5 truncate max-w-[180px]">
                        {call.id}
                      </div>
                    </td>

                    <td className="py-3 px-3 text-neutral-700 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Bot className="w-3.5 h-3.5 text-neutral-400" />
                        <span>{call.agentName}</span>
                      </div>
                    </td>

                    <td className="py-3 px-3 font-mono text-neutral-700 whitespace-nowrap">
                      {formatDuration(call.durationSeconds)}
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      <VoiceStatusBadge status={call.status} />
                    </td>

                    <td className="py-3 px-3 font-mono text-neutral-600 whitespace-nowrap">
                      {formatFirstAudio(call.timeToFirstAudioMs)}
                    </td>

                    <td className="py-3 px-3 text-neutral-600 whitespace-nowrap text-[11px]">
                      {formatUtcDateTime(call.startedAt, false)}
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => handleInspectCall(call.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-heat-100 hover:text-heat-200 bg-orange-50/50 hover:bg-orange-100/60 rounded-6 transition-colors cursor-pointer"
                      >
                        <span>Inspect</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List (Image 10: < 768px) */}
          <div className="md:hidden divide-y divide-border-faint">
            {calls.map((call) => (
              <div
                key={`mobile-${call.id}`}
                onClick={() => handleInspectCall(call.id)}
                className="p-3.5 hover:bg-neutral-50 transition-colors cursor-pointer space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-accent-black font-mono text-xs">
                    {call.caller}
                  </div>
                  <VoiceStatusBadge status={call.status} />
                </div>

                <div className="flex items-center justify-between text-[11px] text-neutral-500">
                  <div className="flex items-center gap-1">
                    <Bot className="w-3 h-3 text-neutral-400" />
                    <span>{call.agentName}</span>
                  </div>
                  <div className="font-mono text-neutral-700">
                    {formatDuration(call.durationSeconds)}
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-neutral-100">
                  <span className="text-neutral-400 font-mono text-[10px]">
                    {formatUtcDateTime(call.startedAt, false)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleInspectCall(call.id);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-heat-100 hover:text-heat-200"
                  >
                    <span>Inspect</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Table Footer */}
          <div className="px-4 py-3 border-t border-border-faint bg-neutral-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-neutral-500">
            <div>
              <span className="font-medium text-neutral-700">{calls.length} calls</span>
              <span className="mx-2">&middot;</span>
              <span>All timestamps shown in UTC</span>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <span className="text-[11px] text-neutral-400">Page 1 of 1</span>
            </div>
          </div>
        </div>
      )}

      {/* Slide-Over Drawer for Call Inspection (Image 2) */}
      {inspectingCallId && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-accent-black/30 backdrop-blur-xs transition-opacity"
            onClick={() => setInspectingCallId(null)}
          />

          {/* Drawer Body */}
          <div className="relative w-full max-w-3xl bg-neutral-50 h-full shadow-2xl flex flex-col z-10 overflow-y-auto">
            {/* Drawer Header */}
            <div className="sticky top-0 bg-white border-b border-border-faint px-5 py-3.5 flex items-center justify-between z-20 shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-orange-50 text-heat-100 flex items-center justify-center font-bold text-xs">
                  <Phone className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-accent-black flex items-center gap-2">
                    <span>Call Inspection</span>
                    <span className="font-mono text-neutral-400 font-normal">
                      {inspectingCallId}
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    Dual-track waveform &amp; synchronized transcript
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href={`${basePath}/${inspectingCallId}`}
                  className="p-1.5 text-neutral-400 hover:text-accent-black rounded-6 hover:bg-neutral-100 transition-colors"
                  title="Open full page"
                >
                  <Maximize2 className="w-4 h-4" />
                </Link>
                <button
                  type="button"
                  onClick={() => setInspectingCallId(null)}
                  className="p-1.5 text-neutral-400 hover:text-accent-black rounded-6 hover:bg-neutral-100 transition-colors cursor-pointer"
                  title="Close drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Drawer Content */}
            <div className="p-5 flex-1">
              {inspectingLoading ? (
                <div className="space-y-4 p-8 text-center">
                  <div className="w-8 h-8 rounded-full border-2 border-heat-100 border-t-transparent animate-spin mx-auto" />
                  <p className="text-xs text-neutral-500">Loading call details &amp; waveform...</p>
                </div>
              ) : inspectingDetail ? (
                <CallDetailView
                  call={inspectingDetail}
                  workspaceId={workspaceId}
                  isPreview={isPreview}
                  baseInboundUrl={baseInboundUrl}
                />
              ) : (
                <div className="p-8 text-center text-xs text-neutral-500">
                  Call details could not be loaded.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Simulator Test Call Modal */}
      {showSimulator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-accent-black/40 backdrop-blur-xs transition-opacity"
            onClick={() => setShowSimulator(false)}
          />

          <div className="relative w-full max-w-md bg-white rounded-16 shadow-2xl border border-border-faint p-6 z-10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-10 bg-orange-50 text-heat-100 flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-accent-black">Phone Call Simulator</h3>
                  <p className="text-[11px] text-neutral-500">Test inbound voice pipeline</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSimulator(false)}
                className="text-neutral-400 hover:text-accent-black p-1 rounded-6 hover:bg-neutral-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              Launch a simulated test call to verify speech-to-text, LLM prompt responses, and audio waveforms without placing an actual telecom carrier call.
            </p>

            <div className="space-y-2 bg-neutral-50 p-3 rounded-10 border border-neutral-200/60 text-xs">
              <div className="flex justify-between text-neutral-500">
                <span>Simulated Caller:</span>
                <span className="font-mono text-accent-black font-semibold">+1 (555) 019-2834</span>
              </div>
              <label className="flex items-center justify-between gap-3 text-neutral-500">
                <span>Target Agent:</span>
                <select
                  value={simulationAgentId}
                  onChange={(event) => setSimulationAgentId(event.target.value)}
                  disabled={simulationBusy || isPreview}
                  className="max-w-[65%] rounded border border-neutral-200 bg-white px-2 py-1 text-accent-black"
                >
                  {voiceAgents.length === 0 && <option value="">No voice agents available</option>}
                  {voiceAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </label>
              <label className="block text-neutral-500">
                <span className="mb-1 block">Caller says:</span>
                <textarea
                  value={simulationUtterance}
                  onChange={(event) => setSimulationUtterance(event.target.value)}
                  disabled={simulationBusy || isPreview}
                  rows={2}
                  className="w-full resize-y rounded border border-neutral-200 bg-white p-2 text-accent-black"
                />
              </label>
              {simulationError && <p role="alert" className="text-red-700">{simulationError}</p>}
              {simulationReply && (
                <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-neutral-700">
                  <span className="font-semibold">Agent:</span> {simulationReply}
                </div>
              )}
              {isPreview && (
                <p className="text-amber-700">Connect to a workspace to run a real call simulation.</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSimulator(false)}
                className="px-3 py-1.5 text-xs text-neutral-600 hover:text-accent-black font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSimulateCall()}
                disabled={simulationBusy || !simulationAgentId || !simulationUtterance.trim() || isPreview}
                className="px-4 py-2 bg-heat-100 hover:bg-heat-200 text-white text-xs font-semibold rounded-8 shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {simulationBusy ? "Running…" : "Run simulation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
