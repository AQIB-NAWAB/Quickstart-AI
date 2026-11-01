"use client";

import React from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  History,
  Play,
  RotateCcw,
  RotateCw,
  Send,
  Sparkles,
} from "lucide-react";
import type { CanvasSaveState } from "../lib/types";

export type CanvasHeaderProps = {
  workspaceId: string;
  agentId: string;
  agentName: string;
  draftRevision: number;
  publishedReleaseNumber: number | null;
  saveState: CanvasSaveState;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onTestAgent: () => void;
  onAiEdit: () => void;
  onPublish: () => void;
  actionsDisabled?: boolean;
  aiDisabled?: boolean;
};

export const CanvasHeader: React.FC<CanvasHeaderProps> = ({
  workspaceId,
  agentId,
  agentName,
  draftRevision,
  publishedReleaseNumber,
  saveState,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onTestAgent,
  onAiEdit,
  onPublish,
  actionsDisabled,
  aiDisabled,
}) => {
  return (
    <header className="h-16 bg-white border-b border-neutral-200 px-4 flex items-center justify-between select-none z-20 gap-3 [&_button:disabled]:opacity-40 [&_button:disabled]:cursor-not-allowed shrink-0">
      {/* Left: Back + Name + Revision status */}
      <div className="flex items-center gap-3">
        <Link
          href={`/workspaces/${workspaceId}/agents`}
          className="p-1.5 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"
          title="Back to agents"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div className="hidden xl:flex items-center gap-2">
          <BrandLogo size={26} animated={false} fillColor="#FA5D19" />
          <span className="font-bold text-base">QuickStart AI</span>
        </div>
        <div className="h-5 w-px bg-neutral-200" />

        <div className="flex items-center gap-2">
          <span className="font-semibold text-[15px] text-neutral-900 tracking-tight max-w-[280px] truncate">
            {agentName}
          </span>

          <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-neutral-100 text-neutral-600 border border-neutral-200">
            Draft v{draftRevision}
          </span>

          {publishedReleaseNumber ? (
            <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Release #{publishedReleaseNumber} live
            </span>
          ) : (
            <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-neutral-100 text-neutral-500">
              Unpublished
            </span>
          )}
        </div>
      </div>

      {/* Center: Save state + Undo/Redo */}
      <div className="flex items-center gap-3 ml-auto">
        {/* Save State Indicator */}
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          {saveState === "saving" && (
            <>
              <Clock className="w-3.5 h-3.5 animate-spin text-amber-500" />
              <span>Saving...</span>
            </>
          )}
          {saveState === "saved" && (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-neutral-600">All changes saved</span>
            </>
          )}
          {saveState === "unsaved" && (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-amber-700">Unsaved changes</span>
            </>
          )}
          {saveState === "error" && (
            <>
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-red-600 font-medium">Save failed</span>
            </>
          )}
          {saveState === "conflict" && (
            <>
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-red-600 font-medium">Revision conflict</span>
            </>
          )}
        </div>

        <div className="h-4 w-px bg-neutral-200" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Right: AI edit + Test agent + Publish release */}
      <div className="flex items-center gap-2.5">
        <Link
          href={`/workspaces/${workspaceId}/agents/${agentId}?tab=releases`}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg border border-neutral-200 transition-colors"
          title="Release history & comparison"
        >
          <History className="w-3.5 h-3.5" />
          <span>Releases</span>
        </Link>

        <button
          type="button"
          onClick={onAiEdit}
          disabled={aiDisabled ?? actionsDisabled}
          className="flex items-center gap-1.5 h-10 px-3 text-[13px] font-medium text-neutral-700 bg-white hover:bg-neutral-100 rounded-lg transition-colors border border-neutral-200"
          title="Describe a workflow change and let AI prepare a draft"
        >
          <Sparkles className="w-3.5 h-3.5 text-neutral-500" />
          <span>AI edit</span>
        </button>

        <button
          type="button"
          onClick={onTestAgent}
          disabled={actionsDisabled}
          className="flex items-center gap-1.5 h-10 px-4 text-[13px] font-medium text-neutral-800 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors border border-neutral-200"
        >
          <Play className="w-3.5 h-3.5 text-[#FA5D19] fill-current" />
          <span>Test agent</span>
        </button>

        <button
          type="button"
          onClick={onPublish}
          disabled={actionsDisabled}
          className="flex items-center gap-1.5 h-10 px-4 text-[13px] font-semibold text-white bg-[#FA5D19] hover:bg-[#FF571A] rounded-lg shadow-xs transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Publish release</span>
        </button>
      </div>
    </header>
  );
};
