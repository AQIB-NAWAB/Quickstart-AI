"use client";

import { AlertCircle, PhoneCall, PhoneOff } from "lucide-react";
import Link from "next/link";
import { useEffect,useState } from "react";
import { SAMPLE_LIVE_TRANSCRIPT_SNIPPETS } from "../lib/fixtures";
import { formatDuration,formatUtcDateTime } from "../lib/format";
import { getVoiceRepository } from "../lib/repository";
import type { InboundCall,RepositoryResult,VoiceRepository } from "../lib/types";
import { VoiceStatusBadge } from "./voice-status-badge";
import { VoiceSubnav } from "./voice-subnav";

interface LiveInboundDashboardProps {
  workspaceId: string;
  isPreview?: boolean;
  repository?: VoiceRepository;
  baseInboundUrl?: string;
}

export function LiveInboundDashboard({
  workspaceId,
  isPreview = false,
  repository,
  baseInboundUrl,
}: LiveInboundDashboardProps) {
  const repo = repository || getVoiceRepository(isPreview);
  const basePath = baseInboundUrl || (isPreview ? "/preview/voice/inbound" : `/workspaces/${workspaceId}/voice/inbound`);

  const [result, setResult] = useState<RepositoryResult<InboundCall[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [stoppingCallId, setStoppingCallId] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);

  async function handleStopCall(callId: string) {
    setStoppingCallId(callId);
    setStopError(null);
    const stopped = await repo.stopLiveInboundCall(workspaceId, callId);
    if (stopped.status === "ready") {
      setResult((current) =>
        current?.status === "ready"
          ? { ...current, data: current.data.filter((call) => call.id !== callId) }
          : current,
      );
    } else {
      setStopError(stopped.message);
    }
    setStoppingCallId(null);
  }

  // Tick elapsed duration every second from actual start time without drifting
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    repo
      .listLiveInboundCalls(workspaceId)
      .then((res) => {
        if (!cancelled) {
          setResult(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load live calls",
          });
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repo, workspaceId]);

  const calls = result?.status === "ready" ? result.data : [];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-accent-black">
            Live inbound calls
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Status and transcript monitor.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-orange-200 text-heat-100 bg-orange-50/60 text-xs font-semibold rounded-10 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-heat-100 animate-pulse" />
            <span>{calls.length} active</span>
          </div>
        </div>
      </div>

      {/* Voice Subnav */}
      <VoiceSubnav workspaceId={workspaceId} isPreview={isPreview} liveCount={calls.length} />

      {stopError && (
        <div role="alert" className="rounded-8 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {stopError}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="bg-white border border-border-faint rounded-12 p-8 shadow-xs space-y-3">
          <div className="h-4 bg-neutral-100 rounded-4 w-1/4 animate-pulse" />
          <div className="h-16 bg-neutral-50 rounded-8 w-full animate-pulse" />
          <div className="h-16 bg-neutral-50 rounded-8 w-full animate-pulse" />
        </div>
      ) : result?.status === "unavailable" ? (
        <div className="bg-white border border-border-faint rounded-12 p-8 shadow-xs text-center space-y-3 max-w-lg mx-auto my-6">
          <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center mx-auto text-neutral-500">
            <PhoneCall className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-bold text-accent-black">
            Live call monitoring is not available.
          </h2>
          <p className="text-xs text-neutral-500 leading-relaxed">
            {result.message || "Telephony carrier stream is not connected."}
          </p>
          <div className="pt-2">
            <Link
              href="/preview/voice/inbound/live"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-heat-100 hover:text-heat-200 transition-colors"
            >
              Explore sample live calls in visual preview &rarr;
            </Link>
          </div>
        </div>
      ) : result?.status === "error" ? (
        <div className="bg-red-50 border border-red-200 rounded-12 p-6 text-center space-y-2 max-w-lg mx-auto">
          <AlertCircle className="w-5 h-5 text-red-600 mx-auto" />
          <h2 className="text-sm font-semibold text-red-900">Failed to load live calls</h2>
          <p className="text-xs text-red-700">{result.message}</p>
        </div>
      ) : calls.length === 0 ? (
        <div className="bg-white border border-border-faint rounded-12 p-12 shadow-xs text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center mx-auto text-neutral-400">
            <PhoneCall className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-bold text-accent-black">No active inbound calls.</h2>
          <p className="text-xs text-neutral-500">
            Active calls will appear here in real-time as callers connect to your voice agents.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Live Call Cards Grid */}
          <div className="space-y-3">
            {calls.map((call) => {
              // Calculate elapsed seconds from startedAt vs current time
              const startEpoch = new Date(call.startedAt).getTime();
              const elapsedSecs =
                !isNaN(startEpoch) && startEpoch > 0
                  ? isPreview ? call.durationSeconds + Math.max(0, Math.floor((now - previewStartedAt) / 1000)) : Math.max(0, Math.floor((now - startEpoch) / 1000))
                  : call.durationSeconds;

              return (
                <div
                  key={call.id}
                  className="bg-white border border-border-faint rounded-12 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start sm:items-center gap-4">
                    <div className="shrink-0 pt-0.5 sm:pt-0">
                      <VoiceStatusBadge status="live" />
                    </div>

                    <div className="space-y-0.5">
                      <div className="text-base font-bold text-accent-black font-mono">
                        {call.caller}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {call.agentName}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-6 pt-3 sm:pt-0 border-t sm:border-t-0 border-border-faint">
                    <div className="text-left sm:text-right">
                      <span className="text-[10px] text-neutral-400  block font-semibold">
                        Duration
                      </span>
                      <span className="text-xl font-bold font-mono text-accent-black tabular-nums">
                        {formatDuration(elapsedSecs)}
                      </span>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-[10px] text-neutral-400  block font-semibold">
                        Started
                      </span>
                      <span className="text-xs font-mono text-neutral-600">
                        {formatUtcDateTime(call.startedAt, true)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Link
                        href={`${basePath}/${call.id}`}
                        className="px-4 py-2 border border-heat-100 text-heat-100 hover:bg-orange-50/80 rounded-8 text-xs font-semibold shadow-xs transition-colors"
                      >
                        Inspect
                      </Link>
                      {!isPreview && (
                        <button
                          type="button"
                          onClick={() => void handleStopCall(call.id)}
                          disabled={stoppingCallId === call.id}
                          className="inline-flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-700 hover:bg-red-50 rounded-8 text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                        >
                          <PhoneOff className="h-3.5 w-3.5" />
                          {stoppingCallId === call.id ? "Stopping…" : "Stop call"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Latest transcript preview for primary live call */}
          {calls[0] && (
            <div className="bg-white border border-border-faint rounded-12 p-5 shadow-xs space-y-3">
              <h2 className="text-xs font-bold text-accent-black">
                Latest transcript <span className="font-mono text-neutral-400 font-normal">(call {calls[0].caller})</span>
              </h2>

              <div className="space-y-2 text-xs">
                {(SAMPLE_LIVE_TRANSCRIPT_SNIPPETS[calls[0].id] || [
                  { speaker: "user", text: "Can you help me update my account?", time: "00:03" },
                  { speaker: "agent", text: "Yes, I can help with that.", time: "00:06" },
                ]).map((turn, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="text-neutral-400 font-mono text-[11px] shrink-0 pt-0.5">
                      {turn.time}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0  ${
                        turn.speaker === "agent"
                          ? "bg-orange-50 text-heat-100 border border-orange-200"
                          : "bg-neutral-100 text-neutral-600 border border-neutral-200"
                      }`}
                    >
                      {turn.speaker}
                    </span>
                    <span className="text-neutral-700 leading-relaxed">{turn.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer Note */}
          <p className="text-[11px] text-neutral-400 leading-relaxed px-1">
            Elapsed counters update while calls remain live. Inspecting opens live transcript and turn metadata.
          </p>
        </div>
      )}
    </div>
  );
}
