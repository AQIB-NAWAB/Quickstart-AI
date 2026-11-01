"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, GitCompare, RotateCcw, AlertCircle, RefreshCw } from "lucide-react";
import type { Agent, AgentVersion } from "../lib/types";
import { RollbackModal } from "./rollback-modal";

type Props = {
  agent: Agent;
  versions: AgentVersion[];
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
  onRollback: (versionId: string) => Promise<void>;
  onSetCanary: (versionId: string | null, percentage: number) => Promise<void>;
  onScheduleRelease: (versionId: string, publishAt: string) => Promise<void>;
  onOpenDiff: (leftId: string, rightId: string, leftTitle: string, rightTitle: string) => void;
};

export function ReleasesTab({
  agent,
  versions,
  loading,
  error,
  onRefresh,
  onRollback,
  onSetCanary,
  onScheduleRelease,
  onOpenDiff,
}: Props) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<AgentVersion | null>(null);
  const [canaryVersionId, setCanaryVersionId] = useState(agent.canary_version_id ?? "");
  const [canaryPercentage, setCanaryPercentage] = useState(agent.canary_percentage ?? 0);
  const [canarySaving, setCanarySaving] = useState(false);
  const [scheduledVersionId, setScheduledVersionId] = useState(agent.scheduled_version_id ?? "");
  const [scheduledAt, setScheduledAt] = useState(
    agent.scheduled_publish_at ? agent.scheduled_publish_at.slice(0, 16) : "",
  );
  const [scheduleSaving, setScheduleSaving] = useState(false);

  useEffect(() => {
    setCanaryVersionId(agent.canary_version_id ?? "");
    setCanaryPercentage(agent.canary_percentage ?? 0);
    setScheduledVersionId(agent.scheduled_version_id ?? "");
    setScheduledAt(agent.scheduled_publish_at ? agent.scheduled_publish_at.slice(0, 16) : "");
  }, [agent.canary_version_id, agent.canary_percentage]);

  // Default selection: currently live release or first release in list
  const activeSelectedId =
    (versions.some((version) => version.id === selectedVersionId) ? selectedVersionId : null) ||
    (agent.production_version_id
      ? versions.find((v) => v.id === agent.production_version_id)?.id
      : versions[0]?.id) ||
    versions[0]?.id ||
    null;

  const selectedVersion = versions.find((v) => v.id === activeSelectedId) || null;
  const isSelectedLive = selectedVersion
    ? selectedVersion.id === agent.production_version_id
    : false;

  function handleCompareClick() {
    if (versions.length < 2) return;
    // Default compare: selected vs live, or live vs previous
    const liveVersion = versions.find((v) => v.id === agent.production_version_id) || versions[0];
    const otherVersion =
      selectedVersion && selectedVersion.id !== liveVersion?.id
        ? selectedVersion
        : versions.find((v) => v.id !== liveVersion?.id) || versions[1];

    if (!liveVersion || !otherVersion) return;

    onOpenDiff(
      otherVersion.id,
      liveVersion.id,
      `Release #${otherVersion.release_number}`,
      `Release #${liveVersion.release_number} (Live)`,
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-[24px] font-semibold text-[#202125] tracking-tight">
          Releases & rollback
        </h2>
        <p className="text-[14px] text-[#667085] mt-1">
          Review published versions and choose what runs live.
        </p>
      </div>

      <section className="rounded-[12px] border border-[#DCE1E8] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-[16px] font-semibold text-[#202125]">Canary rollout</h3>
            <p className="mt-1 max-w-2xl text-[13px] text-[#667085]">
              Send a stable percentage of conversations to an immutable release while production
              remains the fallback.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] font-medium text-[#667085]">
              Candidate release
              <select
                value={canaryVersionId}
                onChange={(event) => setCanaryVersionId(event.target.value)}
                className="mt-1 block h-9 min-w-40 rounded border border-[#DCE1E8] bg-white px-2 text-[12px] text-[#202125]"
              >
                <option value="">Select release</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    Release #{version.release_number}
                    {version.id === agent.production_version_id ? " (live)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium text-[#667085]">
              Traffic %
              <input
                type="number"
                min={0}
                max={100}
                value={canaryPercentage}
                onChange={(event) =>
                  setCanaryPercentage(Math.min(100, Math.max(0, Number(event.target.value) || 0)))
                }
                className="mt-1 block h-9 w-20 rounded border border-[#DCE1E8] px-2 text-[12px] text-[#202125]"
              />
            </label>
            <button
              type="button"
              disabled={canarySaving || (canaryPercentage > 0 && !canaryVersionId)}
              onClick={async () => {
                setCanarySaving(true);
                try {
                  await onSetCanary(
                    canaryPercentage > 0 ? canaryVersionId : null,
                    canaryPercentage,
                  );
                } finally {
                  setCanarySaving(false);
                }
              }}
              className="h-9 rounded bg-[#FF571A] px-3 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {canarySaving ? "Saving…" : "Apply"}
            </button>
            {agent.canary_version_id && (
              <span className="rounded-full bg-[#FFF6F2] px-2 py-1 text-[11px] font-medium text-[#FF571A]">
                {agent.canary_percentage}% canary active
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[12px] border border-[#DCE1E8] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-[16px] font-semibold text-[#202125]">Staged release</h3>
            <p className="mt-1 max-w-2xl text-[13px] text-[#667085]">
              Schedule an immutable release to become production at a specific UTC time.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] font-medium text-[#667085]">
              Release
              <select
                value={scheduledVersionId}
                onChange={(event) => setScheduledVersionId(event.target.value)}
                className="mt-1 block h-9 min-w-40 rounded border border-[#DCE1E8] bg-white px-2 text-[12px] text-[#202125]"
              >
                <option value="">Select release</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    Release #{version.release_number}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium text-[#667085]">
              UTC time
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="mt-1 block h-9 rounded border border-[#DCE1E8] px-2 text-[12px] text-[#202125]"
              />
            </label>
            <button
              type="button"
              disabled={scheduleSaving || !scheduledVersionId || !scheduledAt}
              onClick={async () => {
                setScheduleSaving(true);
                try {
                  await onScheduleRelease(
                    scheduledVersionId,
                    new Date(`${scheduledAt}:00Z`).toISOString(),
                  );
                } finally {
                  setScheduleSaving(false);
                }
              }}
              className="h-9 rounded bg-[#202125] px-3 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {scheduleSaving ? "Scheduling…" : "Schedule"}
            </button>
            {agent.scheduled_publish_at && (
              <span className="rounded-full bg-[#F4F6F8] px-2 py-1 text-[11px] font-medium text-[#667085]">
                Staged for {new Date(agent.scheduled_publish_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </section>

      {loading && (
        <div className="py-16 text-center text-[#667085] flex flex-col items-center justify-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin text-[#FF571A]" />
          <span className="text-[14px]">Loading release history...</span>
        </div>
      )}

      {error && !loading && (
        <div className="p-4 rounded-[12px] bg-red-50 border border-red-200 text-red-700 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[14px]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="px-3 py-1.5 rounded-[8px] bg-white border border-red-200 text-red-700 text-[13px] font-medium hover:bg-red-50 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && versions.length === 0 && (
        <div className="rounded-[12px] border border-[#DCE1E8] bg-white p-12 text-center">
          <div className="w-12 h-12 rounded-[10px] bg-[#F8F9FB] border border-[#DCE1E8] text-[#667085] mx-auto flex items-center justify-center mb-4">
            <Clock className="w-6 h-6" />
          </div>
          <h3 className="text-[18px] font-semibold text-[#202125]">No releases published yet</h3>
          <p className="text-[14px] text-[#667085] mt-1 max-w-md mx-auto">
            Publishing creates an immutable release from your current draft. You can inspect
            differences and roll back to any previous release at any time.
          </p>
        </div>
      )}

      {!loading && !error && versions.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6 items-start">
          {/* Left: Release History Table (approx 58%) */}
          <div className="min-w-0 rounded-[12px] border border-[#DCE1E8] bg-white overflow-hidden shadow-sm flex flex-col">
            <div className="p-5 flex items-center justify-between border-b border-[#EDF0F2]">
              <div>
                <h3 className="text-[20px] font-semibold text-[#202125]">
                  Release history ({versions.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCompareClick}
                disabled={versions.length < 2}
                title={
                  versions.length < 2
                    ? "Publish a second release to compare versions or roll back"
                    : "Compare releases"
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[13px] font-medium border border-[#DCE1E8] bg-white text-[#202125] hover:bg-[#F8F9FB] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <GitCompare className="w-3.5 h-3.5 text-[#667085]" />
                Compare
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-[#EDF0F2] text-[#667085] font-medium text-[12px] uppercase tracking-wider bg-[#F8F9FB]">
                    <th className="py-3 px-5 font-medium">Release</th>
                    <th className="py-3 px-5 font-medium">Published</th>
                    <th className="py-3 px-5 font-medium">Model</th>
                    <th className="py-3 px-5 font-medium">Tools</th>
                    <th className="py-3 px-5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDF0F2]">
                  {versions.map((ver) => {
                    const isLive = ver.id === agent.production_version_id;
                    const isSelected = ver.id === activeSelectedId;
                    const liveVersion =
                      versions.find((v) => v.id === agent.production_version_id) || versions[0];
                    const toolCount = ver.snapshot?.tools?.length ?? 0;

                    return (
                      <tr
                        key={ver.id}
                        tabIndex={0}
                        aria-selected={isSelected}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedVersionId(ver.id);
                          }
                        }}
                        onClick={() => setSelectedVersionId(ver.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-[#F4F6F8] text-[#202125] border-l-[3px] border-l-[#FF571A]"
                            : "hover:bg-[#F8F9FB] text-[#202125] border-l-[3px] border-l-transparent"
                        }`}
                      >
                        <td className="py-4 px-5">
                          <div className="flex flex-col items-start gap-1.5">
                            <span className="font-semibold text-[#202125] text-[14px]">
                              Release #{ver.release_number}
                            </span>
                            {isLive ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-medium text-[#15803D] bg-[#E9F9EF]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                                Live
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium text-[#667085] bg-[#F2F4F7]">
                                Previous
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-5 text-[#667085] whitespace-nowrap text-[13px]">
                          {new Date(ver.created_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-4 px-5 text-[#667085] font-mono text-[13px] truncate max-w-[150px]">
                          {String(
                            ver.snapshot?.model_settings?.model_id ||
                              ver.snapshot?.model_settings?.model ||
                              "Not configured",
                          )}
                        </td>
                        <td className="py-4 px-5">
                          {toolCount > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-[#FFF6F2] text-[#FF571A] border border-[#FFD9CC]">
                              ⚡ {toolCount} {toolCount === 1 ? "tool" : "tools"}
                            </span>
                          ) : (
                            <span className="text-[#98A2B3] text-[12px]">None</span>
                          )}
                        </td>
                        <td className="py-4 px-5 text-right whitespace-nowrap">
                          {!isLive && liveVersion && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenDiff(
                                  ver.id,
                                  liveVersion.id,
                                  `Release #${ver.release_number}`,
                                  `Release #${liveVersion.release_number} (Live)`,
                                );
                              }}
                              className="text-[12px] font-medium text-[#FF571A] hover:underline"
                            >
                              Diff vs Live
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-4 bg-[#F8F9FB] border-t border-[#EDF0F2] text-[13px] text-[#667085] leading-relaxed">
              <span className="font-semibold text-[#202125]">How releases work:</span> Publishing
              freezes an immutable release snapshot. You can roll back to any previous release at
              any time.
            </div>
          </div>

          {/* Right: Selected Release Inspector (approx 42%) */}
          <div className="min-w-0 rounded-[12px] border border-[#DCE1E8] bg-white p-6 shadow-sm space-y-5">
            {selectedVersion ? (
              <>
                <div className="flex items-center justify-between pb-4 border-b border-[#EDF0F2]">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-[18px] font-semibold text-[#202125]">
                        Release #{selectedVersion.release_number}
                      </h3>
                      {isSelectedLive ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-medium text-[#15803D] bg-[#E9F9EF]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                          Live
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium text-[#667085] bg-[#F2F4F7]">
                          Previous
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-[#667085] mt-1">
                      Published{" "}
                      {new Date(selectedVersion.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>

                  {!isSelectedLive && (
                    <button
                      type="button"
                      onClick={() => {
                        const liveVersion =
                          versions.find((v) => v.id === agent.production_version_id) || versions[0];
                        if (liveVersion) {
                          onOpenDiff(
                            selectedVersion.id,
                            liveVersion.id,
                            `Release #${selectedVersion.release_number}`,
                            `Release #${liveVersion.release_number} (Live)`,
                          );
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-medium border border-[#DCE1E8] bg-white text-[#202125] hover:bg-[#F8F9FB] transition-colors"
                    >
                      <GitCompare className="w-3.5 h-3.5 text-[#FF571A]" />
                      Diff vs Live
                    </button>
                  )}
                </div>

                {/* System Instructions snapshot */}
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-[#667085]">
                    System instructions
                  </label>
                  <div className="py-2 text-[14px] text-[#202125] max-h-56 overflow-y-auto whitespace-pre-wrap font-sans leading-relaxed">
                    {selectedVersion.snapshot?.instructions ||
                      "No instructions in this release snapshot."}
                  </div>
                </div>

                {/* Model snapshot */}
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-[#667085]">Model</label>
                  <div className="py-1 text-[14px] text-[#202125] font-mono">
                    {String(
                      selectedVersion.snapshot?.model_settings?.model_id ||
                        selectedVersion.snapshot?.model_settings?.model ||
                        "Not configured",
                    )}
                  </div>
                </div>

                {/* Attached Tools snapshot */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[13px] font-medium text-[#667085]">Attached tools</label>
                    <span className="text-[11px] text-[#98A2B3]">
                      {selectedVersion.snapshot?.tools?.length ?? 0} configured
                    </span>
                  </div>
                  {selectedVersion.snapshot?.tools && selectedVersion.snapshot.tools.length > 0 ? (
                    <div className="space-y-1.5">
                      {selectedVersion.snapshot.tools.map((t) => (
                        <div
                          key={t.name}
                          className="p-2.5 rounded-[8px] bg-[#FAFBFD] border border-[#EDF0F2] text-[12px]"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-semibold text-[#202125]">
                              ⚡ {t.name}
                            </span>
                            {"method" in t && Boolean((t as { method?: string }).method) && (
                              <span className="font-mono text-[10px] uppercase font-bold text-[#667085]">
                                {(t as { method?: string }).method}
                              </span>
                            )}
                          </div>
                          {t.description && (
                            <p className="text-[11px] text-[#667085] mt-0.5 line-clamp-1">
                              {t.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-2 text-[13px] text-[#98A2B3] italic">
                      No tools attached to this release snapshot.
                    </div>
                  )}
                </div>

                <div className="pt-1 text-[13px] text-[#667085]">
                  Published settings are read-only.
                </div>

                {/* Rollback / Status action */}
                <div className="pt-4 border-t border-[#EDF0F2]">
                  {isSelectedLive ? (
                    <div className="text-[14px] text-[#15803D] font-medium flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                      This release is currently serving customers.
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRollbackTarget(selectedVersion)}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[8px] text-[14px] font-medium text-[#202125] bg-white border border-[#DCE1E8] hover:bg-[#F8F9FB] transition-colors shadow-sm"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#FF571A]" />
                      Restore this release
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="py-12 text-center text-[#667085] text-[14px]">
                Select a release to inspect its snapshot details.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rollback confirmation modal */}
      <RollbackModal
        isOpen={Boolean(rollbackTarget)}
        onClose={() => setRollbackTarget(null)}
        onConfirm={async () => {
          if (rollbackTarget) {
            await onRollback(rollbackTarget.id);
          }
        }}
        version={rollbackTarget}
        agentName={agent.name}
      />
    </div>
  );
}
