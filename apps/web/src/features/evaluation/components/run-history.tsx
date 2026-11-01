"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Filter,
  Play,
  RefreshCw,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EvaluationApiClient } from "../lib/api-repository";
import type { EvaluationDataset, EvaluationRun, RunStatus } from "../lib/types";
import { StartEvaluationDialog } from "./start-evaluation-dialog";

interface RunHistoryProps {
  workspaceId: string;
  runs: EvaluationRun[];
  datasets?: EvaluationDataset[];
  isPreview?: boolean;
  isCompact?: boolean;
  agentId?: string;
  onStartRunClick?: () => void;
}

export function RunHistory({
  workspaceId,
  runs: initialRuns,
  datasets = [],
  isPreview = false,
  isCompact = false,
  agentId,
}: RunHistoryProps) {
  const [runs, setRuns] = useState<EvaluationRun[]>(initialRuns);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [isStartEvalOpen, setIsStartEvalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const basePath = isPreview ? "/preview/eval" : `/workspaces/${workspaceId}/eval`;

  // Live polling: every 3s if any run is running or queued
  const hasActiveRun = runs.some((r) => r.status === "queued" || r.status === "running");

  useEffect(() => {
    if (!hasActiveRun || isPreview) return;

    const interval = setInterval(async () => {
      try {
        const res = await EvaluationApiClient.listRuns(workspaceId, { agentId });
        if (res.ok) {
          setRuns(res.data.runs);
        }
      } catch {
        // Ignored
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [hasActiveRun, isPreview, workspaceId, agentId]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await EvaluationApiClient.listRuns(workspaceId, { agentId });
      if (res.ok) {
        setRuns(res.data.runs);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const filteredRuns = runs.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (agentId && r.agentId !== agentId) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchId = r.id.toLowerCase().includes(q);
      const matchAgent = (r.agentName || "").toLowerCase().includes(q);
      const matchDataset = (r.datasetName || "").toLowerCase().includes(q);
      const matchVersion = (r.displayVersion || r.agentVersionId || "").toLowerCase().includes(q);
      if (!matchId && !matchAgent && !matchDataset && !matchVersion) return false;
    }
    return true;
  });

  const getStatusBadge = (status: RunStatus) => {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E9F9EF] px-2.5 py-0.5 text-[11px] font-semibold text-[#027A48]">
            <CheckCircle2 className="h-3 w-3" />
            <span>Completed</span>
          </span>
        );
      case "running":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FF571A]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#FF571A]">
            <span className="h-2 w-2 rounded-full bg-[#FF571A] animate-ping" />
            <span>Running</span>
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF3F2] px-2.5 py-0.5 text-[11px] font-semibold text-[#B42318]">
            <AlertCircle className="h-3 w-3" />
            <span>Failed</span>
          </span>
        );
      case "queued":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#F1F3F5] px-2.5 py-0.5 text-[11px] font-semibold text-[#71717A]">
            <Clock className="h-3 w-3" />
            <span>Queued</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center rounded-full bg-[#F1F3F5] px-2.5 py-0.5 text-[11px] font-semibold text-[#71717A]">
            {status}
          </span>
        );
    }
  };

  const formatDate = (isoString: string | null) => {
    if (!isoString) return "—";
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return isoString;
    }
  };

  const calculatePassPercentage = (run: EvaluationRun) => {
    if (run.score != null) return run.score;
    const count = run.caseCount ?? run.totalCases ?? 0;
    if (count > 0 && run.passedCount != null) {
      return (run.passedCount / count) * 100;
    }
    return 0;
  };

  return (
    <div className="space-y-6">
      {!isCompact && (
        <>
          {/* Top Navigation Tabs matching Image 5 */}
          <div className="flex items-center gap-1 border-b border-[#EAECF0] pb-px text-xs font-semibold">
            <Link
              href={`${basePath}/datasets`}
              className="flex items-center gap-2 border-b-2 border-transparent px-4 py-2.5 text-[#71717A] hover:border-[#DCE1E8] hover:text-[#18181B] transition-colors"
            >
              <span>Datasets</span>
            </Link>
            <Link
              href={`${basePath}/runs`}
              className="flex items-center gap-2 border-b-2 border-[#FF571A] px-4 py-2.5 text-[#FF571A]"
            >
              <span>Evaluation Runs</span>
              <span className="rounded-full bg-[#FF571A]/10 px-2 py-0.5 text-[10px] font-bold text-[#FF571A]">
                {runs.length}
              </span>
            </Link>
            <Link
              href={`${basePath}/compare`}
              className="flex items-center gap-2 border-b-2 border-transparent px-4 py-2.5 text-[#71717A] hover:border-[#DCE1E8] hover:text-[#18181B] transition-colors"
            >
              <span>Version Comparisons</span>
            </Link>
          </div>

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-[#18181B]">Evaluation Runs</h1>
                {hasActiveRun && (
                  <span className="flex items-center gap-1 rounded-full bg-[#FF571A]/10 px-2 py-0.5 text-[11px] font-semibold text-[#FF571A]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#FF571A] animate-ping" />
                    Live polling (3s)
                  </span>
                )}
              </div>
              <p className="text-xs text-[#71717A] mt-1">
                Historical benchmark executions across published agent versions and test datasets.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 rounded-lg border border-[#EAECF0] bg-white px-3 py-2 text-xs font-semibold text-[#18181B] hover:bg-[#F8F9FB] transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 text-[#71717A] ${isRefreshing ? "animate-spin" : ""}`}
                />
                <span>Refresh</span>
              </button>

              <button
                type="button"
                onClick={() => setIsStartEvalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-[#FF571A] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#E0460D] transition-colors"
              >
                <Play className="h-3.5 w-3.5 fill-white" />
                <span>Start Evaluation</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#71717A]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search runs by ID, agent, or version..."
            className="w-full rounded-lg border border-[#DCE1E8] bg-white pl-9 pr-3 py-2 text-xs text-[#18181B] focus:border-[#FF571A] focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[#71717A]">
            <Filter className="h-3.5 w-3.5" />
            <span>Status:</span>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[#DCE1E8] bg-white px-3 py-1.5 text-xs font-medium text-[#18181B] focus:border-[#FF571A] focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="queued">Queued</option>
          </select>
        </div>
      </div>

      {/* Runs Table matching Image 5 */}
      <div className="rounded-xl border border-[#EAECF0] bg-white overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F8F9FB] border-b border-[#EAECF0] text-[11px] font-semibold text-[#71717A]">
              <tr>
                <th className="px-5 py-3 font-semibold">Run ID & Agent</th>
                <th className="px-5 py-3 font-semibold">Dataset & Revision</th>
                <th className="px-5 py-3 font-semibold">Policy</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Pass Rate</th>
                <th className="px-5 py-3 font-semibold">Latency</th>
                <th className="px-5 py-3 font-semibold">Executed</th>
                <th className="px-5 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAECF0]">
              {filteredRuns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-xs text-[#71717A]">
                    No evaluation runs recorded yet. Click "Start Evaluation" to trigger your first
                    run.
                  </td>
                </tr>
              ) : (
                filteredRuns.map((r) => {
                  const passPct = calculatePassPercentage(r);
                  return (
                    <tr key={r.id} className="group hover:bg-[#F8F9FB]/60 transition-colors">
                      {/* Run ID & Agent */}
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col">
                          <Link
                            href={`${basePath}/runs/${r.id}`}
                            className="font-mono font-bold text-[#18181B] hover:text-[#FF571A] transition-colors"
                          >
                            #{r.id.slice(0, 8)}
                          </Link>
                          <span className="text-[11px] text-[#71717A]">
                            {r.agentName || "Agent"} ·{" "}
                            <span className="font-semibold text-[#18181B]">
                              {r.displayVersion ||
                                (r.agentVersionId ? `v${r.agentVersionId.slice(0, 4)}` : "v1.0")}
                            </span>
                          </span>
                        </div>
                      </td>

                      {/* Dataset & Snapshot */}
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col">
                          <span className="font-medium text-[#18181B]">
                            {r.datasetName || "Benchmark Dataset"}
                          </span>
                          <span className="text-[11px] font-mono text-[#71717A]">
                            rev {r.datasetRevision} · {r.caseCount} cases
                          </span>
                        </div>
                      </td>

                      {/* Policy */}
                      <td className="px-5 py-3.5 font-mono text-[11px] text-[#71717A]">
                        {r.policy?.method === "exact_match"
                          ? "exact_match"
                          : r.policy?.method === "semantic_similarity"
                            ? `semantic (${(r.policy.config?.threshold as number) ?? 0.85})`
                            : "tool_trace"}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3.5">{getStatusBadge(r.status)}</td>

                      {/* Pass Rate & Progress Bar */}
                      <td className="px-5 py-3.5 min-w-[140px]">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="font-bold text-[#18181B]">{passPct.toFixed(1)}%</span>
                            <span className="text-[#71717A]">
                              {r.passedCount}/{r.caseCount}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-[#EAECF0] overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                passPct >= 85 ? "bg-[#027A48]" : "bg-[#B42318]"
                              }`}
                              style={{ width: `${Math.min(100, Math.max(0, passPct))}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Latency */}
                      <td className="px-5 py-3.5 font-mono text-xs text-[#71717A]">
                        {r.averageLatencyMs != null
                          ? `${(r.averageLatencyMs / 1000).toFixed(2)}s`
                          : "—"}
                      </td>

                      {/* Executed Date */}
                      <td className="px-5 py-3.5 text-[#71717A] text-[11px]">
                        {formatDate(r.createdAt || r.startedAt)}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`${basePath}/runs/${r.id}`}
                            className="inline-flex items-center gap-1 rounded-md bg-[#F1F3F5] px-2.5 py-1 text-[11px] font-semibold text-[#18181B] hover:bg-[#EAECF0] transition-colors"
                          >
                            <span>Inspect</span>
                            <ArrowRight className="h-3 w-3 text-[#71717A]" />
                          </Link>

                          <Link
                            href={`${basePath}/compare?candidate=${r.id}`}
                            className="rounded-md border border-[#EAECF0] bg-white px-2 py-1 text-[11px] font-semibold text-[#71717A] hover:text-[#18181B] hover:bg-[#F8F9FB] transition-colors"
                            title="Compare against another run"
                          >
                            Compare
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Start Evaluation Modal */}
      <StartEvaluationDialog
        isOpen={isStartEvalOpen}
        onClose={() => setIsStartEvalOpen(false)}
        workspaceId={workspaceId}
        datasets={datasets}
        defaultAgentId={agentId}
        isPreview={isPreview}
        onRunCreated={(newRun) => {
          setRuns((prev) => [newRun, ...prev]);
        }}
      />
    </div>
  );
}
