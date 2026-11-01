"use client";

import { CheckCircle2, Cpu, FileText, Layers, Play, ShieldCheck, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { listVersions } from "../../agents/lib/client";
import type { AgentVersion } from "../../agents/lib/types";
import { EvaluationApiClient } from "../lib/api-repository";
import type { EvaluationDataset, EvaluationRun, ScoringMethod } from "../lib/types";

interface StartEvaluationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  datasets: EvaluationDataset[];
  agents?: Array<{ id: string; name: string }>;
  defaultAgentId?: string;
  defaultDatasetId?: string;
  isPreview?: boolean;
  onRunCreated?: (run: EvaluationRun) => void;
}

export function StartEvaluationDialog({
  isOpen,
  onClose,
  workspaceId,
  datasets,
  agents = [],
  defaultAgentId,
  defaultDatasetId,
  isPreview = false,
  onRunCreated,
}: StartEvaluationDialogProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(
    defaultAgentId || agents[0]?.id || datasets[0]?.agentId || "agent_support",
  );
  const [selectedVersion, setSelectedVersion] = useState("");
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState(
    defaultDatasetId || datasets[0]?.id || "",
  );
  const [scoringMethod, setScoringMethod] = useState<ScoringMethod>("exact_match");
  const [semanticThreshold, setSemanticThreshold] = useState(0.85);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || isPreview || !selectedAgentId) return;

    let cancelled = false;
    setIsLoadingVersions(true);
    setError(null);
    void listVersions(workspaceId, selectedAgentId).then((result) => {
      if (cancelled) return;
      const nextVersions = result.versions ?? [];
      setVersions(nextVersions);
      setSelectedVersion((current) =>
        nextVersions.some((version) => version.id === current)
          ? current
          : (nextVersions[0]?.id ?? ""),
      );
      if (result.error) setError(result.error.message);
      setIsLoadingVersions(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, isPreview, selectedAgentId, workspaceId]);

  if (!isOpen) return null;

  const activeDataset = datasets.find((d) => d.id === selectedDatasetId) || datasets[0];

  const caseCount = activeDataset?.caseCount ?? 0;
  const estimatedSeconds = Math.max(5, Math.round(caseCount * 0.9));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    if (!isPreview && !selectedVersion) {
      setError("Select a published agent version before starting an evaluation.");
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await EvaluationApiClient.startRun(workspaceId, {
        agentId: selectedAgentId,
        agentVersionId: selectedVersion,
        datasetId: selectedDatasetId || activeDataset?.id,
        expectedDatasetRevision: activeDataset?.revision,
        policy: {
          method: scoringMethod,
          config: scoringMethod === "semantic_similarity" ? { threshold: semanticThreshold } : {},
          scorerVersion: "v1",
        },
        idempotencyKey: `eval-run:${workspaceId}:${selectedAgentId}:${Date.now()}`,
      });

      if (!res.ok) {
        setError(res.error);
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      if (onRunCreated) {
        onRunCreated(res.data.run);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger evaluation run");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Start evaluation dialog"
        className="w-full max-w-xl rounded-2xl border border-[#EAECF0] bg-white p-6 shadow-2xl space-y-5"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#EAECF0] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FF571A]/10 text-[#FF571A]">
                <Play className="h-4 w-4 fill-[#FF571A]" />
              </span>
              <h2 className="text-base font-bold text-[#18181B]">Start Evaluation Run</h2>
            </div>
            <p className="text-xs text-[#71717A] mt-1">
              Benchmark agent accuracy and tool invocation against an immutable test suite.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-[#71717A] hover:bg-[#F8F9FB] hover:text-[#18181B] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-[#FEF3F2] border border-[#FEE4E2] p-3 text-xs text-[#B42318]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Agent & Version Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#18181B]">Target Agent</label>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="w-full rounded-lg border border-[#DCE1E8] bg-white px-3 py-2 text-xs font-medium text-[#18181B] focus:border-[#FF571A] focus:outline-none"
              >
                {agents.length > 0 ? (
                  agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))
                ) : (
                  <option value={selectedAgentId}>Support Assistant</option>
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#18181B]">Agent Version Snapshot</label>
              <select
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(e.target.value)}
                disabled={isPreview || isLoadingVersions || versions.length === 0}
                className="w-full rounded-lg border border-[#DCE1E8] bg-white px-3 py-2 text-xs font-medium text-[#18181B] focus:border-[#FF571A] focus:outline-none"
              >
                {isPreview ? (
                  <option value="preview-version">Sample published version</option>
                ) : versions.length > 0 ? (
                  versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.release_number} ·{" "}
                      {version.id === versions[0]?.id ? "Latest snapshot" : "Published snapshot"}
                    </option>
                  ))
                ) : (
                  <option value="">
                    {isLoadingVersions
                      ? "Loading published versions…"
                      : "No published versions available"}
                  </option>
                )}
              </select>
              {!isPreview && versions.length === 0 && !isLoadingVersions && (
                <p className="text-[11px] text-[#B42318]">
                  Publish the agent once before running a real evaluation.
                </p>
              )}
            </div>
          </div>

          {/* Dataset Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[#18181B]">Evaluation Dataset</label>
              {activeDataset && (
                <span className="text-[11px] font-mono text-[#71717A]">
                  rev {activeDataset.revision} · {activeDataset.caseCount} cases
                </span>
              )}
            </div>
            <select
              value={selectedDatasetId}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
              className="w-full rounded-lg border border-[#DCE1E8] bg-white px-3 py-2 text-xs font-medium text-[#18181B] focus:border-[#FF571A] focus:outline-none"
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} (rev {d.revision} · {d.caseCount} test cases)
                </option>
              ))}
            </select>
          </div>

          {/* Scoring Method Radio Cards */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[#18181B]">
              Scoring Policy & Evaluation Criteria
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Exact Match */}
              <button
                type="button"
                onClick={() => setScoringMethod("exact_match")}
                className={`relative flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  scoringMethod === "exact_match"
                    ? "border-[#FF571A] bg-[#FF571A]/5 shadow-xs"
                    : "border-[#EAECF0] bg-white hover:border-[#DCE1E8]"
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <FileText
                    className={`h-4 w-4 ${scoringMethod === "exact_match" ? "text-[#FF571A]" : "text-[#71717A]"}`}
                  />
                  {scoringMethod === "exact_match" && (
                    <CheckCircle2 className="h-4 w-4 text-[#FF571A]" />
                  )}
                </div>
                <div className="text-xs font-bold text-[#18181B]">Exact Match</div>
                <div className="text-[11px] text-[#71717A] mt-1 leading-snug">
                  Strict trimmed string equality.
                </div>
              </button>

              {/* Semantic Similarity */}
              <button
                type="button"
                onClick={() => setScoringMethod("semantic_similarity")}
                className={`relative flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  scoringMethod === "semantic_similarity"
                    ? "border-[#FF571A] bg-[#FF571A]/5 shadow-xs"
                    : "border-[#EAECF0] bg-white hover:border-[#DCE1E8]"
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <Sparkles
                    className={`h-4 w-4 ${scoringMethod === "semantic_similarity" ? "text-[#FF571A]" : "text-[#71717A]"}`}
                  />
                  {scoringMethod === "semantic_similarity" && (
                    <CheckCircle2 className="h-4 w-4 text-[#FF571A]" />
                  )}
                </div>
                <div className="text-xs font-bold text-[#18181B]">Semantic Similarity</div>
                <div className="text-[11px] text-[#71717A] mt-1 leading-snug">
                  Cosine similarity via text embeddings.
                </div>
              </button>

              {/* Tool Trace */}
              <button
                type="button"
                onClick={() => setScoringMethod("tool_trace")}
                className={`relative flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  scoringMethod === "tool_trace"
                    ? "border-[#FF571A] bg-[#FF571A]/5 shadow-xs"
                    : "border-[#EAECF0] bg-white hover:border-[#DCE1E8]"
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <Cpu
                    className={`h-4 w-4 ${scoringMethod === "tool_trace" ? "text-[#FF571A]" : "text-[#71717A]"}`}
                  />
                  {scoringMethod === "tool_trace" && (
                    <CheckCircle2 className="h-4 w-4 text-[#FF571A]" />
                  )}
                </div>
                <div className="text-xs font-bold text-[#18181B]">Tool Trace</div>
                <div className="text-[11px] text-[#71717A] mt-1 leading-snug">
                  Validates tool invocations & mock traces.
                </div>
              </button>
            </div>

            {scoringMethod === "semantic_similarity" && (
              <div className="rounded-xl border border-[#EAECF0] bg-[#F8F9FB] p-3 space-y-2 mt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#18181B]">Cosine Similarity Threshold</span>
                  <span className="font-mono font-bold text-[#FF571A]">
                    {(semanticThreshold * 100).toFixed(0)}% ({semanticThreshold})
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="0.99"
                  step="0.01"
                  value={semanticThreshold}
                  onChange={(e) => setSemanticThreshold(parseFloat(e.target.value))}
                  className="w-full accent-[#FF571A] cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#71717A]">
                  <span>0.50 (Permissive)</span>
                  <span>0.85 (Standard)</span>
                  <span>0.95 (Strict)</span>
                </div>
              </div>
            )}
          </div>

          {/* Sandbox Fixture Safety Callout */}
          <div className="flex items-start gap-2.5 rounded-xl border border-[#D1FADF] bg-[#ECFDF3] p-3 text-xs text-[#027A48]">
            <ShieldCheck className="h-5 w-5 shrink-0 text-[#12B76A]" />
            <div>
              <div className="font-semibold text-[#027A48]">Isolated Test Execution Mode</div>
              <p className="text-[11px] text-[#067647] mt-0.5 leading-relaxed">
                Model tool calls are resolved via configured mock fixtures. No live visitor chats,
                production databases, external email queues, or webhooks will be triggered.
              </p>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-[#EAECF0] pt-4">
            <div className="flex items-center gap-1.5 text-xs text-[#71717A]">
              <Layers className="h-3.5 w-3.5" />
              <span>
                {caseCount} test cases · Estimated duration: ~{estimatedSeconds}s
              </span>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[#EAECF0] bg-white px-3.5 py-2 text-xs font-semibold text-[#18181B] hover:bg-[#F8F9FB] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || caseCount === 0}
                className="flex items-center gap-1.5 rounded-lg bg-[#FF571A] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#E0460D] transition-colors disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Queuing Run...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-white" />
                    <span>Start Evaluation</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
