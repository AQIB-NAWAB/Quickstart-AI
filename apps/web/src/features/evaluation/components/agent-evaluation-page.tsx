"use client";

import { Database, Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { EvaluationOverviewData } from "../lib/types";
import { DatasetList } from "./dataset-list";
import { RunHistory } from "./run-history";
import { StartEvaluationDialog } from "./start-evaluation-dialog";
import { VersionScoreComparison } from "./version-score-comparison";

interface AgentEvaluationPageProps {
  workspaceId: string;
  agentId: string;
  initialData: EvaluationOverviewData;
  isPreview?: boolean;
}

export function AgentEvaluationPage({
  workspaceId,
  agentId,
  initialData,
  isPreview = false,
}: AgentEvaluationPageProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "datasets" | "runs">("overview");
  const [overviewData, setOverviewData] = useState<EvaluationOverviewData>(initialData);
  const [isStartRunOpen, setIsStartRunOpen] = useState(false);

  const basePath = isPreview ? "/preview/eval" : `/workspaces/${workspaceId}/eval`;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#EAECF0] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-[#18181B]">
              Agent Evaluation · {overviewData.agentName}
            </h1>
            {isPreview && (
              <span className="rounded bg-[#FF571A]/10 px-2 py-0.5 text-[11px] font-semibold text-[#FF571A]">
                Sample data
              </span>
            )}
          </div>
          <p className="text-xs text-[#71717A] mt-1">
            Evaluate published immutable versions against fixed test datasets and sandbox fixtures.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href={`${basePath}/datasets`}
            className="flex items-center gap-1.5 rounded-lg border border-[#EAECF0] bg-white px-3.5 py-2 text-xs font-semibold text-[#18181B] hover:bg-[#F8F9FB] transition-colors"
          >
            <Database className="h-3.5 w-3.5 text-[#71717A]" />
            <span>Manage Datasets</span>
          </Link>

          <button
            type="button"
            onClick={() => setIsStartRunOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#FF571A] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#E0460D] transition-colors"
          >
            <Play className="h-3.5 w-3.5 fill-white" />
            <span>Run Evaluation</span>
          </button>
        </div>
      </div>

      {/* Subnavigation Tabs */}
      <div className="flex items-center gap-1 border-b border-[#EAECF0] pb-px text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "overview"
              ? "border-[#FF571A] text-[#FF571A]"
              : "border-transparent text-[#71717A] hover:text-[#18181B]"
          }`}
        >
          <span>Overview</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("datasets")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "datasets"
              ? "border-[#FF571A] text-[#FF571A]"
              : "border-transparent text-[#71717A] hover:text-[#18181B]"
          }`}
        >
          <span>Datasets</span>
          <span className="rounded-full bg-[#F1F3F5] px-2 py-0.5 text-[10px] text-[#71717A]">
            {overviewData.datasets.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("runs")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "runs"
              ? "border-[#FF571A] text-[#FF571A]"
              : "border-transparent text-[#71717A] hover:text-[#18181B]"
          }`}
        >
          <span>Runs</span>
          <span className="rounded-full bg-[#F1F3F5] px-2 py-0.5 text-[10px] text-[#71717A]">
            {overviewData.recentRuns.length}
          </span>
        </button>
      </div>

      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* 4 Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Pass Rate */}
            <div className="rounded-xl border border-[#EAECF0] bg-white p-4 space-y-1 shadow-xs">
              <div className="flex items-center justify-between text-[#71717A]">
                <span className="text-xs font-medium">Latest Overall Score</span>
                <Sparkles className="h-3.5 w-3.5 text-[#FF571A]" />
              </div>
              <div className="flex items-baseline gap-2 pt-1">
                <span className="text-2xl font-bold font-mono text-[#18181B]">
                  {overviewData.latestScore != null ? `${overviewData.latestScore}%` : "—"}
                </span>
                <span className="text-xs text-[#71717A]">/{overviewData.scoreScale}</span>
              </div>
            </div>

            {/* Card 2: Passed cases */}
            <div className="rounded-xl border border-[#EAECF0] bg-white p-4 space-y-1 shadow-xs">
              <div className="text-xs font-medium text-[#71717A]">Passed Cases</div>
              <div className="flex items-baseline gap-2 pt-1">
                <span className="text-2xl font-bold font-mono text-[#027A48]">
                  {overviewData.passedCases ?? "—"}
                </span>
                <span className="text-xs text-[#71717A]">/{overviewData.totalCases}</span>
              </div>
            </div>

            {/* Card 3: Failed cases */}
            <div className="rounded-xl border border-[#EAECF0] bg-white p-4 space-y-1 shadow-xs">
              <div className="text-xs font-medium text-[#71717A]">Failed Cases</div>
              <div className="flex items-baseline gap-2 pt-1">
                <span className="text-2xl font-bold font-mono text-[#B42318]">
                  {overviewData.failedCases ?? "—"}
                </span>
                <span className="text-xs text-[#71717A]">/{overviewData.totalCases}</span>
              </div>
            </div>

            {/* Card 4: Latest run */}
            <div className="rounded-xl border border-[#EAECF0] bg-white p-4 space-y-1 shadow-xs">
              <div className="text-xs font-medium text-[#71717A]">Latest Run</div>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xl font-bold font-mono text-[#18181B]">
                  {overviewData.latestRun?.displayVersion || "v8"}
                </span>
                <span className="rounded-full bg-[#E9F9EF] px-2 py-0.5 text-[10px] font-semibold text-[#027A48]">
                  Completed
                </span>
              </div>
              <p className="text-[11px] text-[#71717A] truncate font-mono mt-1">
                {overviewData.latestRun?.datasetName} (rev {overviewData.latestRun?.datasetRevision}
                )
              </p>
            </div>
          </div>

          {/* Datasets Preview & Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <VersionScoreComparison
              points={overviewData.comparison}
              datasetName={overviewData.selectedDataset.name}
              datasetRevision={overviewData.selectedDataset.revision}
              scoringPolicy={overviewData.scoringPolicy}
            />

            <div className="rounded-xl border border-[#EAECF0] bg-white p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#71717A]">
                  Active Benchmark Datasets
                </h3>
                <Link
                  href={`${basePath}/datasets`}
                  className="text-xs font-semibold text-[#FF571A] hover:underline"
                >
                  View all ({overviewData.datasets.length})
                </Link>
              </div>

              <div className="divide-y divide-[#EAECF0]">
                {overviewData.datasets.slice(0, 3).map((d) => (
                  <div key={d.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <Link
                        href={`${basePath}/datasets/${d.id}`}
                        className="font-bold text-[#18181B] hover:text-[#FF571A]"
                      >
                        {d.name}
                      </Link>
                      <p className="text-[11px] text-[#71717A]">
                        {d.caseCount} test cases · rev {d.revision}
                      </p>
                    </div>
                    <Link
                      href={`${basePath}/datasets/${d.id}`}
                      className="rounded border border-[#EAECF0] px-2 py-1 text-[11px] font-medium text-[#18181B] hover:bg-[#F8F9FB]"
                    >
                      Edit
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent Runs Table */}
          <RunHistory
            workspaceId={workspaceId}
            runs={overviewData.recentRuns}
            datasets={overviewData.datasets}
            isPreview={isPreview}
            isCompact={true}
            agentId={agentId}
          />
        </div>
      )}

      {activeTab === "datasets" && (
        <DatasetList
          workspaceId={workspaceId}
          datasets={overviewData.datasets}
          isPreview={isPreview}
          isCompact={false}
        />
      )}

      {activeTab === "runs" && (
        <RunHistory
          workspaceId={workspaceId}
          runs={overviewData.recentRuns}
          datasets={overviewData.datasets}
          isPreview={isPreview}
          isCompact={false}
          agentId={agentId}
        />
      )}

      {/* Start Evaluation Dialog */}
      <StartEvaluationDialog
        isOpen={isStartRunOpen}
        onClose={() => setIsStartRunOpen(false)}
        workspaceId={workspaceId}
        datasets={overviewData.datasets}
        defaultAgentId={overviewData.agentId}
        isPreview={isPreview}
        onRunCreated={(run) => {
          setOverviewData((prev) => ({
            ...prev,
            recentRuns: [run, ...prev.recentRuns],
          }));
        }}
      />
    </div>
  );
}
