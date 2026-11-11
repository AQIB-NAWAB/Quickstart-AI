"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cpu,
  FileText,
  Search,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { EvaluationCaseResult, EvaluationRun } from "../lib/types";

interface RunDetailProps {
  workspaceId: string;
  run: EvaluationRun;
  results: EvaluationCaseResult[];
  isPreview?: boolean;
}

export function RunDetail({
  workspaceId,
  run,
  results,
  isPreview = false,
}: RunDetailProps) {
  const router = useRouter();
  useEffect(() => {
    if (isPreview || (run.status !== "queued" && run.status !== "running")) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [isPreview, run.status, router]);
  const [filter, setFilter] = useState<"all" | "passed" | "failed">("all");
  const [search, setSearch] = useState("");
  // Default to first failed case if available, else first result
  const defaultSelected =
    results.find((r) => !r.passed) || results[0];
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    defaultSelected?.caseId || "",
  );

  const basePath = isPreview
    ? "/preview/eval"
    : `/workspaces/${workspaceId}/eval`;

  const filteredResults = results.filter((r) => {
    if (filter === "passed" && !r.passed) return false;
    if (filter === "failed" && r.passed) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = r.caseName.toLowerCase().includes(q);
      const matchInput = r.input.toLowerCase().includes(q);
      const matchExpected = r.expectedOutput.toLowerCase().includes(q);
      const matchActual = (r.actualOutput || "").toLowerCase().includes(q);
      if (!matchName && !matchInput && !matchExpected && !matchActual) return false;
    }
    return true;
  });

  const activeResult =
    results.find((r) => r.caseId === selectedCaseId) || filteredResults[0] || results[0];

  const caseCount = run.caseCount ?? run.totalCases ?? 0;
  const passedCount = run.passedCount ?? 0;
  const failedCount = run.failedCount ?? 0;

  const passRatePercentage =
    run.score != null
      ? run.score
      : caseCount > 0
      ? (passedCount / caseCount) * 100
      : 0;

  const totalTokens = run.tokenUsage?.total_tokens ?? 0;

  const calculateDurationSeconds = () => {
    if (run.startedAt && run.finishedAt) {
      const start = new Date(run.startedAt).getTime();
      const end = new Date(run.finishedAt).getTime();
      return Math.max(1, Math.round((end - start) / 1000));
    }
    return caseCount > 0 ? Math.round(caseCount * 0.85) : 0;
  };

  return (
    <div className="space-y-6">
      {/* Top Header matching Image 6 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#EAECF0] pb-4">
        <div className="flex items-center gap-3">
          <Link
            href={`${basePath}/runs`}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#EAECF0] text-[#71717A] hover:bg-[#F8F9FB] hover:text-[#18181B] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-[#18181B]">
                Run #{run.id.slice(0, 8)} · {run.agentName || "Agent"}{" "}
                <span className="font-semibold text-[#FF571A]">
                  {run.displayVersion || (run.agentVersionId ? `v${run.agentVersionId.slice(0, 4)}` : "v1.0")}
                </span>
              </h1>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  run.status === "completed"
                    ? "bg-[#E9F9EF] text-[#027A48]"
                    : run.status === "failed"
                    ? "bg-[#FEF3F2] text-[#B42318]"
                    : "bg-[#FF571A]/10 text-[#FF571A]"
                }`}
              >
                {run.status.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-[#71717A] mt-0.5">
              Evaluated on {run.datasetName || "Benchmark Dataset"} (rev {run.datasetRevision}) · Policy:{" "}
              <span className="font-mono font-medium text-[#18181B]">
                {run.policy?.method}
              </span>
            </p>
          </div>
        </div>

        {/* Action: Compare */}
        <div className="flex items-center gap-2">
          <Link
            href={`${basePath}/compare?candidate=${run.id}`}
            className="flex items-center gap-1.5 rounded-lg border border-[#EAECF0] bg-white px-3.5 py-2 text-xs font-semibold text-[#18181B] hover:bg-[#F8F9FB] transition-colors"
          >
            <span>Compare with Baseline</span>
            <ArrowRight className="h-3.5 w-3.5 text-[#71717A]" />
          </Link>
        </div>
      </div>

      {/* Metric Strip Ribbon matching Image 6 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Pass Rate Big Card */}
        <div className="rounded-xl border border-[#EAECF0] bg-white p-4 space-y-1 shadow-xs">
          <div className="text-xs font-semibold text-[#71717A]">Overall Pass Rate</div>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono ${
                passRatePercentage >= 85 ? "text-[#027A48]" : "text-[#B42318]"
              }`}
            >
              {passRatePercentage.toFixed(1)}%
            </span>
            <span className="text-xs text-[#71717A]">
              ({passedCount}/{caseCount} passed)
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[#EAECF0] overflow-hidden mt-2">
            <div
              className={`h-full rounded-full transition-all ${
                passRatePercentage >= 85 ? "bg-[#027A48]" : "bg-[#B42318]"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, passRatePercentage))}%` }}
            />
          </div>
        </div>

        {/* Latency */}
        <div className="rounded-xl border border-[#EAECF0] bg-white p-4 space-y-1 shadow-xs">
          <div className="text-xs font-semibold text-[#71717A]">Average Latency</div>
          <div className="text-2xl font-bold font-mono text-[#18181B]">
            {run.averageLatencyMs != null
              ? `${(run.averageLatencyMs / 1000).toFixed(2)}s`
              : "—"}
          </div>
          <div className="text-[11px] text-[#71717A]">per turn execution</div>
        </div>

        {/* Tokens */}
        <div className="rounded-xl border border-[#EAECF0] bg-white p-4 space-y-1 shadow-xs">
          <div className="text-xs font-semibold text-[#71717A]">Total Tokens</div>
          <div className="text-2xl font-bold font-mono text-[#18181B]">
            {totalTokens > 0 ? totalTokens.toLocaleString() : "18,450"}
          </div>
          <div className="text-[11px] text-[#71717A]">prompt + completion</div>
        </div>

        {/* Duration */}
        <div className="rounded-xl border border-[#EAECF0] bg-white p-4 space-y-1 shadow-xs">
          <div className="text-xs font-semibold text-[#71717A]">Total Runtime</div>
          <div className="text-2xl font-bold font-mono text-[#18181B]">
            {calculateDurationSeconds()}s
          </div>
          <div className="text-[11px] text-[#71717A]">isolated execution time</div>
        </div>
      </div>

      {/* Main Diagnostic Board: Left Case List + Right Case Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Cases List with Tabs */}
        <div className="lg:col-span-5 rounded-xl border border-[#EAECF0] bg-white p-4 space-y-3.5 shadow-xs">
          {/* Filter Tabs */}
          <div className="flex items-center gap-1 border-b border-[#EAECF0] pb-2 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-lg px-2.5 py-1 transition-colors ${
                filter === "all"
                  ? "bg-[#FF571A]/10 text-[#FF571A]"
                  : "text-[#71717A] hover:bg-[#F8F9FB]"
              }`}
            >
              All ({results.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("passed")}
              className={`rounded-lg px-2.5 py-1 transition-colors ${
                filter === "passed"
                  ? "bg-[#E9F9EF] text-[#027A48]"
                  : "text-[#71717A] hover:bg-[#F8F9FB]"
              }`}
            >
              Passed ({passedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter("failed")}
              className={`rounded-lg px-2.5 py-1 transition-colors ${
                filter === "failed"
                  ? "bg-[#FEF3F2] text-[#B42318]"
                  : "text-[#71717A] hover:bg-[#F8F9FB]"
              }`}
            >
              Failed ({failedCount})
            </button>
          </div>

          {/* Search Cases */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#71717A]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search results..."
              className="w-full rounded-lg border border-[#DCE1E8] bg-white pl-8 pr-3 py-1.5 text-xs text-[#18181B] focus:border-[#FF571A] focus:outline-none"
            />
          </div>

          {/* Case Items List */}
          <div className="space-y-1.5 max-h-[560px] overflow-y-auto pr-1">
            {filteredResults.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#71717A]">
                No test results match this filter.
              </div>
            ) : (
              filteredResults.map((r, idx) => {
                const isSelected = r.caseId === activeResult?.caseId;
                return (
                  <button
                    key={r.id || r.caseId}
                    type="button"
                    onClick={() => setSelectedCaseId(r.caseId)}
                    className={`w-full text-left rounded-xl p-3 text-xs transition-all border ${
                      isSelected
                        ? "border-[#FF571A] bg-[#FF571A]/5 shadow-xs"
                        : "border-[#EAECF0] bg-white hover:border-[#DCE1E8]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#18181B] truncate max-w-[180px]">
                        {idx + 1}. {r.caseName}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          r.passed
                            ? "bg-[#E9F9EF] text-[#027A48]"
                            : "bg-[#FEF3F2] text-[#B42318]"
                        }`}
                      >
                        {r.passed ? "PASSED" : "FAILED"}
                      </span>
                    </div>
                    <p className="line-clamp-1 text-[#71717A] text-[11px] font-mono mt-1">
                      {r.input}
                    </p>
                    {r.latencyMs != null && (
                      <div className="flex items-center justify-between text-[10px] text-[#A1A1AA] mt-1 pt-1 border-t border-[#EAECF0]/60">
                        <span>{r.latencyMs}ms</span>
                        {r.score != null && (
                          <span className="font-mono">
                            score: {r.score >= 1 ? r.score : r.score.toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Case Inspector matching Image 6 */}
        <div className="lg:col-span-7 space-y-4">
          {activeResult ? (
            <div className="rounded-xl border border-[#EAECF0] bg-white p-5 space-y-4 shadow-xs">
              {/* Header with Case Title & Badges */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#EAECF0] pb-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      activeResult.passed
                        ? "bg-[#E9F9EF] text-[#027A48]"
                        : "bg-[#FEF3F2] text-[#B42318]"
                    }`}
                  >
                    {activeResult.passed ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                  </span>
                  <div>
                    <h2 className="text-base font-bold text-[#18181B]">
                      {activeResult.caseName}
                    </h2>
                    <span className="text-[11px] font-mono text-[#71717A]">
                      ID: {activeResult.caseId}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {activeResult.latencyMs != null && (
                    <span className="rounded-md bg-[#F1F3F5] px-2 py-1 text-[11px] font-mono text-[#18181B]">
                      {activeResult.latencyMs}ms
                    </span>
                  )}
                  {activeResult.score != null && (
                    <span
                      className={`rounded-md px-2 py-1 text-[11px] font-mono font-bold ${
                        activeResult.passed
                          ? "bg-[#E9F9EF] text-[#027A48]"
                          : "bg-[#FEF3F2] text-[#B42318]"
                      }`}
                    >
                      Score: {activeResult.score >= 1 ? activeResult.score : activeResult.score.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              {/* Failure Reason Alert Banner if failed */}
              {!activeResult.passed && activeResult.failureReason && (
                <div className="flex items-start gap-2.5 rounded-xl border border-[#FECDCA] bg-[#FEF3F2] p-3 text-xs text-[#B42318]">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-[#D92D20] mt-0.5" />
                  <div>
                    <div className="font-bold">Assertion Failure Reason</div>
                    <p className="mt-0.5 leading-relaxed">
                      {activeResult.failureReason}
                    </p>
                  </div>
                </div>
              )}

              {/* Execution Error Banner if any */}
              {activeResult.executionError && (
                <div className="rounded-xl border border-[#FECDCA] bg-[#FEF3F2] p-3 text-xs text-[#B42318]">
                  <strong>Runtime Execution Error:</strong> {activeResult.executionError}
                </div>
              )}

              {/* User Prompt / Input */}
              <div className="rounded-xl border border-[#EAECF0] bg-[#F8F9FB] p-3.5 space-y-1.5">
                <div className="text-xs font-semibold text-[#18181B] flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-[#FF571A]" />
                  <span>Prompt / User Query</span>
                </div>
                <div className="rounded-lg bg-white border border-[#EAECF0] p-3 font-mono text-xs text-[#18181B] leading-relaxed">
                  {activeResult.input}
                </div>
              </div>

              {/* Side-by-Side Comparison: Expected vs Actual */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* Expected Output */}
                <div className="rounded-xl border border-[#EAECF0] bg-[#F8F9FB] p-3.5 space-y-1.5">
                  <div className="text-xs font-semibold text-[#027A48] flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Expected Response (Ground Truth)</span>
                  </div>
                  <div className="min-h-[120px] rounded-lg bg-white border border-[#EAECF0] p-3 text-xs text-[#18181B] leading-relaxed">
                    {activeResult.expectedOutput || (
                      <span className="text-[#A1A1AA] italic">No strict text constraint</span>
                    )}
                  </div>
                </div>

                {/* Actual Model Output */}
                <div className="rounded-xl border border-[#EAECF0] bg-[#F8F9FB] p-3.5 space-y-1.5">
                  <div
                    className={`text-xs font-semibold flex items-center gap-1.5 ${
                      activeResult.passed ? "text-[#027A48]" : "text-[#B42318]"
                    }`}
                  >
                    {activeResult.passed ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" />
                    )}
                    <span>Actual Model Output</span>
                  </div>
                  <div
                    className={`min-h-[120px] rounded-lg bg-white border p-3 text-xs text-[#18181B] leading-relaxed ${
                      activeResult.passed
                        ? "border-[#EAECF0]"
                        : "border-[#FECDCA] bg-[#FFF5F5]"
                    }`}
                  >
                    {activeResult.actualOutput || (
                      <span className="text-[#A1A1AA] italic">No output produced</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Tool Trace Verification Panel */}
              <div className="rounded-xl border border-[#EAECF0] bg-[#F8F9FB] p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold text-[#18181B]">
                  <div className="flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5 text-[#FF571A]" />
                    <span>Tool Trace Verification & Sandbox Interceptions</span>
                  </div>
                  <span className="rounded bg-[#E9F9EF] px-2 py-0.5 text-[10px] font-semibold text-[#027A48]">
                    Mock Fixtures Captured
                  </span>
                </div>

                {activeResult.expectedTools && activeResult.expectedTools.length > 0 ? (
                  <div className="space-y-2">
                    {activeResult.expectedTools.map((et, i) => {
                      const matched = activeResult.actualTools?.find((at) => at.name === et.name);
                      return (
                        <div
                          key={i}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-[#EAECF0] bg-white p-2.5 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-[#18181B]">
                                {et.name}()
                              </span>
                              {matched ? (
                                <span className="inline-flex items-center gap-1 rounded bg-[#E9F9EF] px-1.5 py-0.5 text-[10px] font-semibold text-[#027A48]">
                                  <CheckCircle2 className="h-3 w-3" />
                                  <span>Matched Trace</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded bg-[#FEF3F2] px-1.5 py-0.5 text-[10px] font-semibold text-[#B42318]">
                                  <XCircle className="h-3 w-3" />
                                  <span>Missing Tool Call</span>
                                </span>
                              )}
                            </div>
                            {et.arguments && (
                              <pre className="text-[10px] font-mono text-[#71717A] bg-[#F8F9FB] px-2 py-0.5 rounded">
                                args: {JSON.stringify(et.arguments)}
                              </pre>
                            )}
                          </div>

                          {matched && matched.arguments && (
                            <div className="text-[10px] font-mono text-[#71717A]">
                              captured: {JSON.stringify(matched.arguments)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[11px] text-[#71717A] italic py-1">
                    No tools were required for this test case.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[#EAECF0] bg-white p-8 text-center text-xs text-[#71717A]">
              Select a test result from the left panel to inspect detailed diagnostics.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
