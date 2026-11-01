"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { Agent } from "../lib/types";
import { archiveAgent, deleteAgent, listAgents } from "../lib/client";
import { AgentCard } from "./agent-card";
import { CreateAgentDialog } from "./create-agent-dialog";
import { TestAgentPanel } from "./test-agent-panel";

type Props = {
  workspaceId: string;
  workspaceName?: string;
  initialAgents: Agent[];
  initialNextCursor?: string | null;
};

type StatusFilter = "all" | "published" | "unpublished";
type SortOrder = "asc" | "desc";

function CreateQueryOpener({ onOpen }: { onOpen: () => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("create") === "1") onOpen();
  }, [searchParams, onOpen]);
  return null;
}

export function AgentList({ workspaceId, workspaceName = "Workspace", initialAgents, initialNextCursor = null }: Props) {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [showArchived, setShowArchived] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Create wizard state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const openCreate = useCallback(() => setIsCreateOpen(true), []);

  function closeCreate() {
    setIsCreateOpen(false);
    if (typeof window !== "undefined" && window.location.search.includes("create=1")) {
      router.replace(`/workspaces/${workspaceId}/agents`);
    }
  }

  // Active test modal state (centered modal matching 9.png)
  const [activeTestingAgent, setActiveTestingAgent] = useState<Agent | null>(null);

  // Filter & sort agents
  const filteredAndSortedAgents = useMemo(() => {
    return agents
      .filter((agent) => {
        // Status filter
        if (statusFilter === "published" && !agent.production_version_id) return false;
        if (statusFilter === "unpublished" && agent.production_version_id) return false;

        // Search query filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const nameMatch = agent.name.toLowerCase().includes(q);
          const descMatch = (agent.description || "").toLowerCase().includes(q);
          const instructionsMatch = (agent.instructions || "").toLowerCase().includes(q);
          return nameMatch || descMatch || instructionsMatch;
        }

        return true;
      })
      .sort((a, b) => {
        const comparison = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        return sortOrder === "asc" ? comparison : -comparison;
      });
  }, [agents, statusFilter, searchQuery, sortOrder]);

  // Handle agent deletion
  async function handleDeleteAgent(agentId: string): Promise<boolean> {
    const res = await deleteAgent(workspaceId, agentId);
    if (res.success) {
      setAgents((prev) => prev.filter((a) => a.id !== agentId));
      if (activeTestingAgent?.id === agentId) {
        setActiveTestingAgent(null);
      }
      return true;
    }
    return false;
  }

  async function reloadAgents(includeArchived: boolean) {
    setIsLoadingMore(true);
    const result = await listAgents(workspaceId, { limit: 50, includeArchived });
    setIsLoadingMore(false);
    if (result.error) return;
    setAgents(result.agents ?? []);
    setNextCursor(result.nextCursor ?? null);
  }

  async function handleArchiveAgent(agentId: string, archived: boolean): Promise<boolean> {
    const result = await archiveAgent(workspaceId, agentId, archived);
    if (result.error || !result.agent) return false;
    if (showArchived) {
      setAgents((prev) => prev.map((agent) => (agent.id === agentId ? result.agent! : agent)));
    } else if (archived) {
      setAgents((prev) => prev.filter((agent) => agent.id !== agentId));
    }
    return true;
  }

  return (
    <div className="space-y-6 w-full pb-12">
      {/* Page Header matching 1.png */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[36px] font-bold text-[#202125] tracking-tight leading-tight">Agents</h1>
          <p className="mt-1 text-[15px] text-[#667085]">
            Build and manage your customer-facing assistants.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-[6px] bg-[#FF571A] text-white text-[14px] font-medium hover:bg-[#E04B14] transition-colors shadow-xs self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Create agent</span>
        </button>
      </div>

      {/* Toolbar matching 1.png: "All agents {count}" on left, Search on right */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2 text-[18px] font-semibold text-[#202125]">
          <span>All agents</span>
          <span className="text-[#667085] font-normal text-[15px]">
            {filteredAndSortedAgents.length}
          </span>
        </div>

        <div className="flex items-center gap-2.5 flex-1 max-w-[480px] justify-end">
          {/* Search agents input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#98A2B3] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agents..."
              className="w-full pl-9 pr-8 h-10 rounded-[6px] border border-[#DCE1E8] bg-white text-[14px] text-[#202125] placeholder-[#98A2B3] focus:outline-none focus:border-[#FF571A] focus:ring-1 focus:ring-[#FF571A] transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#98A2B3] hover:text-[#202125]"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Compact Status Filter */}
          <div className="relative shrink-0">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Filter by status"
              className="appearance-none pl-3 pr-7 h-10 rounded-[6px] border border-[#DCE1E8] bg-white text-[13px] text-[#202125] font-medium focus:outline-none focus:border-[#FF571A] cursor-pointer"
            >
              <option value="all">All statuses</option>
              <option value="published">Live</option>
              <option value="unpublished">Draft</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-[#667085] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <button
            type="button"
            onClick={() => {
              const next = !showArchived;
              setShowArchived(next);
              void reloadAgents(next);
            }}
            className={`h-10 px-3 rounded-[6px] border text-[13px] font-medium transition-colors ${
              showArchived
                ? "border-[#FF571A] bg-orange-50 text-[#C43F0E]"
                : "border-[#DCE1E8] bg-white text-[#475467] hover:bg-[#F8F9FA]"
            }`}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </button>

          {/* Sort order toggle */}
          <button
            type="button"
            onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
            className="p-2 h-10 rounded-[6px] border border-[#DCE1E8] bg-white text-[#667085] hover:text-[#202125] hover:bg-[#F8F9FA] transition-colors shrink-0"
            title={`Sort ${sortOrder === "asc" ? "Z to A" : "A to Z"}`}
            aria-label="Toggle alphabetical sort"
          >
            {sortOrder === "asc" ? (
              <ArrowDownAZ className="w-4 h-4" />
            ) : (
              <ArrowUpAZ className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Thin divider beneath toolbar matching 1.png */}
      <div className="border-b border-[#EAECF0]" />

      {/* Directory Table Structure */}
      {agents.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-[#DCE1E8] bg-white p-12 text-center">
          <h3 className="text-[18px] font-semibold text-[#202125]">No agents yet</h3>
          <p className="mt-1 text-[14px] text-[#667085] max-w-sm mx-auto leading-relaxed">
            Create your first agent to set up instructions, AI models, and tools for your business.
          </p>
          <div className="mt-6">
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[6px] bg-[#FF571A] text-white text-[14px] font-medium hover:bg-[#E04B14] transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              Create agent
            </button>
          </div>
        </div>
      ) : filteredAndSortedAgents.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-[8px] border border-[#DCE1E8] space-y-3">
          <p className="text-[15px] text-[#667085]">
            No agents match your search or selected filters.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
            }}
            className="px-3.5 py-1.5 rounded-[6px] text-[14px] font-medium text-[#202125] bg-white border border-[#DCE1E8] hover:bg-[#F8F9FA] transition-colors"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Table-like column headings matching 1.png */}
          <div className="hidden sm:flex items-center justify-between px-6 text-[11px] font-semibold tracking-wider text-[#667085] uppercase">
            <span className="flex-1">AGENT</span>
            <span className="w-[180px]">CHANNEL</span>
            <span className="w-[140px] text-left">STATUS</span>
          </div>

          {/* Agent Records */}
          <div className="space-y-3">
            {filteredAndSortedAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                workspaceId={workspaceId}
                onTestAgent={(a) => setActiveTestingAgent(a)}
                onDeleteAgent={handleDeleteAgent}
                onArchiveAgent={handleArchiveAgent}
              />
            ))}
          </div>
        </div>
      )}

      {/* Footer count indicator matching 1.png: "1 agent in Demo Workspace" */}
      {agents.length > 0 && (
        <div className="pt-2 text-[13px] text-[#667085]">
          <span>
            {filteredAndSortedAgents.length}{" "}
            {filteredAndSortedAgents.length === 1 ? "agent" : "agents"} in {workspaceName}
          </span>
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            disabled={isLoadingMore}
            onClick={async () => {
              if (!nextCursor) return;
              setIsLoadingMore(true);
              const result = await listAgents(workspaceId, {
                limit: 50,
                cursor: nextCursor,
                includeArchived: showArchived,
              });
              setIsLoadingMore(false);
              if (result.error) return;
              setAgents((prev) => [...prev, ...(result.agents ?? [])]);
              setNextCursor(result.nextCursor ?? null);
            }}
            className="px-4 py-2 rounded-[6px] border border-[#DCE1E8] bg-white text-[14px] font-medium text-[#202125] hover:bg-[#F8F9FA] disabled:opacity-50"
          >
            {isLoadingMore ? "Loading..." : "Load more agents"}
          </button>
        </div>
      )}

      {/* Deep Link URL opener for ?create=1 */}
      <Suspense fallback={null}>
        <CreateQueryOpener onOpen={openCreate} />
      </Suspense>

      {/* Create Agent Wizard Dialog (10.png, 11.png, 12.png) */}
      <CreateAgentDialog
        isOpen={isCreateOpen}
        onClose={closeCreate}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
      />

      {/* Centered Test Agent Modal (9.png) */}
      {activeTestingAgent && (
        <TestAgentPanel
          agent={activeTestingAgent}
          workspaceId={workspaceId}
          releaseNumber={undefined}
          isOpen={true}
          onClose={() => setActiveTestingAgent(null)}
        />
      )}
    </div>
  );
}
