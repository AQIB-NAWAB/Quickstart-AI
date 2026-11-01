"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Archive,
  ArchiveRestore,
  ChevronDown,
  FileText,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Play,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Agent } from "../lib/types";
import { DeleteAgentModal } from "./delete-agent-modal";
import { AgentOutlineIcon } from "@/components/brand/agent-outline-icon";

type Props = {
  agent: Agent;
  workspaceId: string;
  onTestAgent: (agent: Agent) => void;
  onDeleteAgent: (agentId: string) => Promise<boolean>;
  onArchiveAgent: (agentId: string, archived: boolean) => Promise<boolean>;
};

export function AgentCard({
  agent,
  workspaceId,
  onTestAgent,
  onDeleteAgent,
  onArchiveAgent,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfigExpanded, setIsConfigExpanded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isLive = Boolean(agent.production_version_id);
  const isArchived = Boolean(agent.archived_at);
  const modelName =
    (agent.model_settings?.model_id as string) ||
    (agent.model_settings?.model as string) ||
    "Not configured";

  const hasChat = Boolean(agent.channels?.chat);
  const hasVoice = Boolean(agent.channels?.voice);

  async function handleConfirmDelete() {
    setIsDeleting(true);
    const success = await onDeleteAgent(agent.id);
    setIsDeleting(false);
    if (success) {
      setDeleteModalOpen(false);
    }
  }

  return (
    <>
      <div className="w-full bg-white border border-[#DCE1E8] rounded-[8px] overflow-hidden transition-colors shadow-xs">
        {/* Main Row matching 1.png */}
        <div className="px-6 py-5 flex items-center justify-between gap-4">
          {/* Identity Column: approx 50% width on desktop */}
          <div className="flex items-center gap-4 flex-1 min-w-0 pr-4">
            {/* Small outline-brand tile (36px square, radius 8px, pale neutral background #F2F4F7) */}
            <div className="w-9 h-9 rounded-[8px] bg-[#F2F4F7] border border-[#DCE1E8] flex items-center justify-center shrink-0 text-[#475467]">
              <AgentOutlineIcon size={20} strokeWidth={16} />
            </div>

            <div className="min-w-0">
              <Link
                href={`/workspaces/${workspaceId}/agents/${agent.id}`}
                className="text-[16px] font-semibold text-[#202125] hover:text-[#FF571A] transition-colors truncate block leading-snug"
              >
                {agent.name}
              </Link>
              <p className="mt-0.5 text-[14px] text-[#667085] truncate leading-normal">
                {agent.description || "No description yet"}
              </p>
            </div>
          </div>

          {/* Channel Column */}
          <div className="hidden sm:flex items-center gap-2 w-[180px] shrink-0 text-[14px] text-[#202125]">
            {hasChat && (
              <span className="inline-flex items-center gap-1.5 truncate">
                <MessageSquare className="w-4 h-4 text-[#667085] shrink-0" />
                <span>Website chat</span>
              </span>
            )}
            {hasVoice && (
              <span className="inline-flex items-center gap-1.5 truncate">
                <Mic className="w-4 h-4 text-[#667085] shrink-0" />
                <span>Phone calls</span>
              </span>
            )}
            {!hasChat && !hasVoice && (
              <span className="text-[#98A2B3] text-[13px]">No channel</span>
            )}
          </div>

          {/* Status Column & Ellipsis Menu */}
          <div className="flex items-center justify-end gap-3 w-[140px] shrink-0">
            {isArchived ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[13px] font-medium bg-[#FFF4E5] text-[#B54708]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#B54708]" aria-hidden="true" />
                Archived
              </span>
            ) : isLive ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[13px] font-medium bg-[#E9F9EF] text-[#168A45]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#168A45]" aria-hidden="true" />
                Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[13px] font-medium bg-[#F2F4F7] text-[#667085]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#98A2B3]" aria-hidden="true" />
                Draft
              </span>
            )}

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Agent options"
                aria-expanded={menuOpen}
                className="p-1.5 text-[#667085] hover:text-[#202125] hover:bg-[#F8F9FA] rounded-md transition-colors"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-[calc(100%+4px)] z-20 w-44 rounded-lg border border-[#DCE1E8] bg-white py-1 shadow-lg">
                  <Link
                    href={`/workspaces/${workspaceId}/agents/${agent.id}/canvas`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-[14px] text-[#FA5D19] font-medium hover:bg-orange-50 transition-colors"
                  >
                    <Sparkles className="w-4 h-4 text-[#FA5D19]" />
                    Open Canvas
                  </Link>
                  <Link
                    href={`/workspaces/${workspaceId}/agents/${agent.id}`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-[14px] text-[#202125] hover:bg-[#F8F9FA] transition-colors"
                  >
                    Open agent
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      setMenuOpen(false);
                      await onArchiveAgent(agent.id, !isArchived);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[14px] text-[#202125] hover:bg-[#F8F9FA] transition-colors text-left"
                  >
                    {isArchived ? (
                      <ArchiveRestore className="w-3.5 h-3.5" />
                    ) : (
                      <Archive className="w-3.5 h-3.5" />
                    )}
                    {isArchived ? "Restore agent" : "Archive agent"}
                  </button>
                  {isArchived && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setDeleteModalOpen(true);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[14px] text-[#B42318] hover:bg-red-50 transition-colors text-left"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete agent
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Expandable Configuration Disclosure matching 1.png */}
        {isConfigExpanded && (
          <div className="px-6 py-4 bg-[#FAFBFB] border-t border-[#EAECF0] text-[13px] text-[#202125] space-y-3 animate-in fade-in duration-150">
            <div>
              <span className="font-semibold text-[#667085] block text-[11px] uppercase tracking-wider mb-1">
                Instructions Preview
              </span>
              <p className="text-[#344054] line-clamp-2 leading-relaxed">
                {agent.instructions || "No instructions defined yet."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#EAECF0] text-[13px]">
              <div>
                <span className="text-[#667085] block text-[11px] font-medium">Model</span>
                <span className="font-mono text-[#202125]">{modelName}</span>
              </div>
              <div>
                <span className="text-[#667085] block text-[11px] font-medium">Environment</span>
                <span className="capitalize text-[#202125]">
                  {agent.environment || "production"}
                </span>
              </div>
              <div>
                <span className="text-[#667085] block text-[11px] font-medium">Version</span>
                <span className="text-[#202125]">
                  Draft v{agent.version} {isLive ? "(Published)" : "(Unpublished)"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Action Strip matching 1.png */}
        <div className="px-6 py-3 bg-[#FAFBFB] border-t border-[#EAECF0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Configuration Disclosure Toggle */}
          <button
            type="button"
            onClick={() => setIsConfigExpanded((prev) => !prev)}
            aria-expanded={isConfigExpanded}
            className="inline-flex items-center gap-2 text-[14px] font-medium text-[#475467] hover:text-[#202125] transition-colors"
          >
            <FileText className="w-4 h-4 text-[#667085]" aria-hidden="true" />
            <span>Configuration</span>
            <ChevronDown
              className={`w-4 h-4 text-[#667085] transition-transform duration-150 ${
                isConfigExpanded ? "rotate-180" : ""
              }`}
            />
          </button>

          {/* Test & Open Actions */}
          <div className="flex items-center gap-2.5 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => onTestAgent(agent)}
              className="inline-flex items-center gap-2 px-4 py-2 text-[14px] font-medium text-[#202125] bg-white border border-[#DCE1E8] rounded-[6px] hover:bg-[#F8F9FA] transition-colors shadow-xs"
            >
              <Play className="w-3.5 h-3.5 fill-current text-[#202125]" />
              Test agent
            </button>

            <Link
              href={`/workspaces/${workspaceId}/agents/${agent.id}/canvas`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[14px] font-semibold text-[#FA5D19] bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-[6px] transition-colors shadow-xs"
            >
              <Sparkles className="w-4 h-4 text-[#FA5D19]" />
              <span>Canvas</span>
            </Link>

            <Link
              href={`/workspaces/${workspaceId}/agents/${agent.id}`}
              className="inline-flex items-center gap-2 px-4 py-2 text-[14px] font-medium text-white bg-black hover:bg-[#1F1F23] rounded-[6px] transition-colors shadow-xs"
            >
              <span>Open agent</span>
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      <DeleteAgentModal
        isOpen={deleteModalOpen}
        agentName={agent.name}
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModalOpen(false)}
      />
    </>
  );
}
