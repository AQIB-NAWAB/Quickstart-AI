"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, History, Play, Redo2, Send, Undo2 } from "lucide-react";
import type { Agent } from "../lib/types";

type Props = {
  workspaceId: string;
  agent: Agent;
  releaseNumber?: number;
  isDirty: boolean;
  isSaving: boolean;
  saveSuccess: boolean;
  saveError?: string | null;
  onSave: () => void;
  onPublish: () => void;
  onOpenTest: () => void;
  onOpenReleases: () => void;
};

export function EditorHeader({
  workspaceId,
  agent,
  releaseNumber,
  isDirty,
  isSaving,
  saveSuccess,
  saveError = null,
  onSave,
  onPublish,
  onOpenTest,
  onOpenReleases,
}: Props) {
  const isLive = Boolean(agent.production_version_id);

  let statusText = "All changes saved";
  let statusColor = "text-[#667085]";

  if (saveError) {
    statusText = `Save failed: ${saveError}`;
    statusColor = "text-[#B42318]";
  } else if (isSaving) {
    statusText = "Saving changes...";
    statusColor = "text-[#667085]";
  } else if (isDirty) {
    statusText = "Unsaved changes";
    statusColor = "text-[#B54708]";
  } else if (saveSuccess || !isDirty) {
    statusText = "All changes saved";
    statusColor = "text-[#168A45]";
  }

  return (
    <div className="border-b border-[#EAECF0] bg-white px-1 py-3">
      <div className="flex flex-wrap items-center gap-2.5 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Link
            href={`/workspaces/${workspaceId}/agents`}
            aria-label="Back to agents"
            className="p-1.5 text-[#202125] hover:bg-[#F2F4F7] rounded-md transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <h1 className="min-w-0 truncate text-[18px] font-semibold tracking-tight text-[#202125]">
            {agent.name}
          </h1>

          <span className="shrink-0 rounded-[4px] border border-[#DCE1E8] bg-[#F2F4F7] px-2.5 py-1 font-mono text-[12px] text-[#475467]">
            Draft v{agent.version}
          </span>

          {isLive ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#A6F4C5] bg-[#ECFDF3] px-3 py-1 text-[13px] font-medium text-[#168A45]">
              <span className="h-2 w-2 rounded-full bg-[#12B76A]" aria-hidden="true" />
              {releaseNumber ? `Release #${releaseNumber} live` : "Release live"}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#DCE1E8] bg-[#F8F9FA] px-3 py-1 text-[13px] font-medium text-[#667085]">
              <span className="h-2 w-2 rounded-full bg-[#98A2B3]" aria-hidden="true" />
              Unpublished
            </span>
          )}

          <span
            className={`inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium ${statusColor}`}
          >
            {!isDirty && !isSaving && !saveError && <CheckCircle2 className="h-4 w-4" />}
            {statusText}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="mx-1 hidden h-7 w-px bg-[#DCE1E8] lg:block" aria-hidden="true" />

          <button
            type="button"
            disabled
            aria-label="Undo"
            className="rounded-md p-2 text-[#98A2B3] disabled:cursor-not-allowed"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled
            aria-label="Redo"
            className="rounded-md p-2 text-[#98A2B3] disabled:cursor-not-allowed"
          >
            <Redo2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onOpenReleases}
            className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#DCE1E8] bg-white px-3.5 text-[14px] font-medium text-[#344054] shadow-xs transition-colors hover:bg-[#F8F9FA]"
          >
            <History className="h-4 w-4" />
            <span>Releases</span>
          </button>

          {isDirty && (
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="h-10 rounded-[8px] border border-[#DCE1E8] bg-white px-3.5 text-[14px] font-medium text-[#344054] shadow-xs transition-colors hover:bg-[#F8F9FA] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          )}

          <button
            type="button"
            onClick={onOpenTest}
            disabled={!isLive}
            className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#EAECF0] bg-[#F8F9FA] px-4 text-[14px] font-medium text-[#98A2B3] shadow-xs transition-colors enabled:bg-white enabled:text-[#344054] enabled:hover:bg-[#F8F9FA] disabled:cursor-not-allowed"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Test agent</span>
          </button>

          <button
            type="button"
            onClick={onPublish}
            disabled={isDirty || isSaving}
            title={isDirty ? "Save changes before publishing" : "Publish release to live agent"}
            className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#FFB89F] px-4 text-[14px] font-semibold text-white shadow-xs transition-colors hover:bg-[#F29A7C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            <span>Publish release</span>
          </button>
        </div>
      </div>
    </div>
  );
}
