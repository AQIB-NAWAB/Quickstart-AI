"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Search,
  RotateCcw,
  BookOpen,
  Trash2,
  X,
  Sparkles,
  ChevronRight,
  Layers,
} from "lucide-react";
import type { KnowledgeSource, SourceStatusCounts } from "../lib/types";
import { listSources } from "../lib/client";
import { SourceStatusBadge } from "./source-status-badge";
import { SourceTypeLabel, SourceTypeIconTile } from "./source-type-label";
import { AddSourceModal } from "./add-source-modal";
import { DeleteSourceModal } from "./delete-source-modal";
import { SourceDetails } from "./source-details";
import { KnowledgeNavSwitcher } from "./knowledge-nav-switcher";
import { formatRelativeTime, formatDateTime } from "../lib/format";

interface KnowledgeSourceListProps {
  workspaceId: string;
}

const TEMPLATES = [
  {
    id: "return-policy",
    title: "Return & Cancellation Policy",
    description: "Standard return windows, refunds, and exchange guidelines.",
    content: `[Company Name] Return & Cancellation Policy

1. Return Window: Items may be returned within 30 days of delivery with original proof of purchase.
2. Condition: Items must be unused, in original packaging, and include all tags and accessories.
3. Refunds: Approved returns will be credited to the original payment method within 5–7 business days.
4. Cancellations: Orders can be cancelled within 1 hour of placement before dispatch begins.
5. Support Contact: Contact support at support@example.com for assistance with returns or exchanges.`,
  },
  {
    id: "services-hours",
    title: "Company Services & Hours",
    description: "Operating hours, primary services, and contact channels.",
    content: `[Company Name] Services & Operating Hours

1. Operating Hours (EST):
- Monday to Friday: 9:00 AM – 6:00 PM
- Saturday: 10:00 AM – 4:00 PM
- Sunday & Public Holidays: Closed

2. Primary Services:
- Client Onboarding and Consultation
- Account Advisory and Technical Diagnostics
- Regular Maintenance and Service Reviews

3. Contact Channels:
- Phone: 1-800-555-0199
- Support Email: support@example.com
- Knowledge Center: https://example.com/help`,
  },
  {
    id: "faq",
    title: "Frequently Asked Questions",
    description: "Common customer questions and structured answers.",
    content: `[Company Name] Frequently Asked Questions

Q: How do I track my order or service request?
A: You will receive an automated tracking link by email as soon as your order has dispatched or ticket has been assigned.

Q: How can I reset my account credentials?
A: Select 'Forgot Password' on the login screen to receive a secure time-sensitive reset link.

Q: Where can I manage my payment methods and invoices?
A: Go to Workspace Settings > Billing to manage credit cards and download official invoices.

Q: What is the average response time for support inquiries?
A: Inquiries submitted during normal business hours typically receive a response within 2 hours.`,
  },
];

export function KnowledgeSourceList({ workspaceId }: KnowledgeSourceListProps) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [totalWorkspaceCount, setTotalWorkspaceCount] = useState(0);
  const [statusCounts, setStatusCounts] = useState<SourceStatusCounts>({
    ready: 0,
    indexing: 0,
    failed: 0,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // Drawer & Modals state
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<{ name: string; content: string } | null>(
    null,
  );
  const [deletingSource, setDeletingSource] = useState<KnowledgeSource | null>(null);

  // Screen reader announcements
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const searchParams = useSearchParams();

  // If URL has ?source=id on mount, open drawer
  useEffect(() => {
    const initialSource = searchParams?.get("source");
    if (initialSource) {
      setSelectedSourceId(initialSource);
      setDrawerOpen(true);
    }
  }, [searchParams]);

  // Debounce search query 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Authoritative server fetch
  const fetchSources = useCallback(
    async (isBackground = false) => {
      if (!isBackground) setIsLoading(true);
      if (isBackground) setIsRefreshing(true);
      setError(null);

      const res = await listSources(workspaceId, {
        search: debouncedSearch || undefined,
        status: statusFilter !== "all" ? (statusFilter as any) : undefined,
        type: typeFilter !== "all" ? (typeFilter as any) : undefined,
        limit: 100,
      });

      if (!isBackground) setIsLoading(false);
      if (isBackground) setIsRefreshing(false);

      if (res.sources) {
        setSources(res.sources);
        setTotalFiltered(res.total ?? 0);
        setTotalWorkspaceCount(res.total_workspace_count ?? 0);
        if (res.status_counts) setStatusCounts(res.status_counts);
      } else {
        if (!isBackground) {
          setError(res.error?.message || "Failed to load knowledge sources");
        }
      }
    },
    [workspaceId, debouncedSearch, statusFilter, typeFilter],
  );

  useEffect(() => {
    void fetchSources();
  }, [fetchSources]);

  // Polling loop for nonterminal sources
  const hasPendingSources = useMemo(() => {
    return sources.some((s) => s.status === "queued" || s.status === "processing");
  }, [sources]);

  useEffect(() => {
    if (!hasPendingSources) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (cancelled || document.hidden) return;
      await fetchSources(true);
      if (!cancelled && !document.hidden) {
        timer = setTimeout(poll, 3000);
      }
    };

    timer = setTimeout(poll, 3000);

    const handleVisibilityChange = () => {
      if (!document.hidden && !cancelled) {
        clearTimeout(timer);
        void fetchSources(true);
        timer = setTimeout(poll, 3000);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasPendingSources, fetchSources]);

  function handleOpenDetails(sourceId: string) {
    setSelectedSourceId(sourceId);
    setDrawerOpen(true);
  }

  function handleSourceCreated(newSource: KnowledgeSource) {
    setSources((prev) => [newSource, ...prev]);
    setTotalFiltered((prev) => prev + 1);
    setTotalWorkspaceCount((prev) => prev + 1);
    setStatusCounts((prev: SourceStatusCounts) => ({
      ...prev,
      indexing: (prev.indexing ?? 0) + 1,
    }));
    setAnnouncement(`Added knowledge source "${newSource.name}".`);
    // Optionally open details drawer for the newly added source
    setSelectedSourceId(newSource.id);
    setDrawerOpen(true);
  }

  function handleSourceDeleted(deletedId: string) {
    setSources((prev) => prev.filter((s) => s.id !== deletedId));
    setTotalFiltered((prev) => Math.max(0, prev - 1));
    setTotalWorkspaceCount((prev) => Math.max(0, prev - 1));
    setAnnouncement("Source deleted. Content cleanup has been scheduled.");
    setDeletingSource(null);
    if (selectedSourceId === deletedId) {
      setDrawerOpen(false);
      setSelectedSourceId(null);
    }
  }

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setSelectedSourceId(null);
  }, []);

  const handleDeleteRequest = useCallback((source: KnowledgeSource) => {
    setDeletingSource(source);
  }, []);

  const handleSourceUpdated = useCallback((updated: KnowledgeSource) => {
    setSources((prev) => prev.map((source) => (source.id === updated.id ? updated : source)));
  }, []);

  function handleUseTemplate(template: (typeof TEMPLATES)[number]) {
    setActiveTemplate({
      name: template.title,
      content: template.content,
    });
    setAddModalOpen(true);
  }

  const isFiltering = Boolean(debouncedSearch) || statusFilter !== "all" || typeFilter !== "all";

  return (
    <div className="console-feature knowledge-feature space-y-6">
      {/* Screen reader live notification */}
      {announcement && (
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
      )}

      {/* Header (Image 1 & Image 8) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-bold text-accent-black tracking-tight">
              Knowledge Base
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-700 border border-border-faint">
              {totalWorkspaceCount} {totalWorkspaceCount === 1 ? "source" : "sources"}
            </span>
          </div>
          <p className="text-xs text-neutral-500 max-w-2xl leading-relaxed">
            Upload documents, company policies, and FAQs for your agents to use as ground-truth
            context.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto w-full sm:w-auto">
          <KnowledgeNavSwitcher workspaceId={workspaceId} />
          <button
            type="button"
            onClick={() => {
              setActiveTemplate(null);
              setAddModalOpen(true);
            }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-10 bg-heat-100 text-white text-xs font-semibold hover:bg-heat-100/90 transition-colors shadow-sm min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>Add source</span>
          </button>
        </div>
      </div>

      {/* Toolbar (Image 1 & Image 8) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search sources by name or content"
            placeholder="Search sources by name or content"
            className="w-full pl-10 pr-9 py-2.5 rounded-10 border border-border-faint bg-white text-xs text-accent-black placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-heat-24 focus:border-heat-40 transition-shadow min-h-[42px]"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Clear search query"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-4 text-neutral-400 hover:text-accent-black transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Dropdown Filters & Refresh */}
        <div className="flex items-center gap-2.5">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="flex-1 sm:flex-none px-3 py-2.5 rounded-10 border border-border-faint bg-white text-xs font-medium text-accent-black focus:outline-none focus:ring-2 focus:ring-heat-24 transition-shadow min-h-[42px]"
          >
            <option value="all">All statuses</option>
            <option value="ready">Ready</option>
            <option value="indexing">Indexing</option>
            <option value="failed">Failed</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by type"
            className="flex-1 sm:flex-none px-3 py-2.5 rounded-10 border border-border-faint bg-white text-xs font-medium text-accent-black focus:outline-none focus:ring-2 focus:ring-heat-24 transition-shadow min-h-[42px]"
          >
            <option value="all">All types</option>
            <option value="text">Plain text</option>
            <option value="file">File upload</option>
            <option value="url">URL</option>
          </select>

          <button
            type="button"
            onClick={() => void fetchSources(true)}
            disabled={isRefreshing}
            aria-label="Refresh sources"
            className="p-2.5 rounded-10 border border-border-faint bg-white text-neutral-500 hover:text-accent-black hover:bg-neutral-50 transition-colors shrink-0 disabled:opacity-50 min-h-[42px] min-w-[42px] flex items-center justify-center shadow-xs"
          >
            <RotateCcw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-heat-100" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="border border-border-faint rounded-12 bg-white p-6 space-y-4 animate-pulse">
          <div className="h-5 bg-neutral-100 rounded w-1/4" />
          <div className="h-12 bg-neutral-50 rounded" />
          <div className="h-12 bg-neutral-50 rounded" />
          <div className="h-12 bg-neutral-50 rounded" />
        </div>
      ) : error ? (
        <div className="p-8 bg-red-50 border border-red-200 rounded-12 text-center space-y-3">
          <p className="text-xs font-semibold text-accent-crimson">{error}</p>
          <button
            type="button"
            onClick={() => void fetchSources()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-8 bg-white border border-border-faint text-xs font-semibold text-accent-black hover:bg-neutral-50 transition-colors shadow-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : totalWorkspaceCount === 0 && !isFiltering ? (
        /* Zero-Source Empty State with 3 Starter Templates (Image 7) */
        <div className="border border-border-faint rounded-16 bg-white p-8 sm:p-12 text-center space-y-8 shadow-sm">
          <div className="space-y-3 max-w-md mx-auto">
            <div className="w-14 h-14 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto border border-border-faint">
              <BookOpen className="w-7 h-7 text-neutral-600" />
            </div>
            <h2 className="text-lg font-bold text-accent-black">Add your first knowledge source</h2>
            <p className="text-xs text-neutral-500 leading-relaxed">
              Connect business documents or plain text to give agents reliable business context.
            </p>
          </div>

          {/* Starter Template Cards (Image 7) */}
          <div className="space-y-3 max-w-4xl mx-auto text-left">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider text-center">
              Quick start with editable templates
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {TEMPLATES.map((tmpl) => (
                <div
                  key={tmpl.id}
                  className="rounded-12 border border-border-faint bg-neutral-50/60 p-4 flex flex-col justify-between space-y-3 hover:border-neutral-300 transition-colors"
                >
                  <div className="space-y-1.5">
                    <div className="w-8 h-8 rounded-8 bg-white border border-border-faint flex items-center justify-center text-heat-100 shadow-xs">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <h3 className="text-xs font-bold text-accent-black">{tmpl.title}</h3>
                    <p className="text-[11px] text-neutral-500 leading-relaxed">
                      {tmpl.description}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleUseTemplate(tmpl)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-8 bg-white border border-border-faint text-xs font-semibold text-accent-black hover:bg-neutral-50 transition-colors shadow-xs"
                  >
                    <span>Use template</span>
                    <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-neutral-400 text-center">
              Review starter text before saving. Templates are not your company policies.
            </p>
          </div>
        </div>
      ) : sources.length === 0 ? (
        /* Empty Filtered Result */
        <div className="p-12 bg-white border border-border-faint rounded-12 text-center space-y-3 shadow-sm">
          <p className="text-sm font-semibold text-accent-black">No sources match your filters</p>
          <p className="text-xs text-neutral-500">Try adjusting your query or resetting filters.</p>
          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              setStatusFilter("all");
              setTypeFilter("all");
            }}
            className="px-4 py-2 rounded-10 bg-neutral-100 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 transition-colors shadow-xs"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Desktop & Tablet Table View (Image 1 & Image 8) */}
          <div className="hidden sm:block border border-border-faint rounded-12 bg-white overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border-faint bg-neutral-50/60 text-neutral-500 font-medium">
                    <th scope="col" className="py-3 px-4 font-semibold">
                      Source
                    </th>
                    <th scope="col" className="py-3 px-4 font-semibold">
                      Type
                    </th>
                    <th scope="col" className="py-3 px-4 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="py-3 px-4 font-semibold">
                      Chunks
                    </th>
                    <th scope="col" className="py-3 px-4 font-semibold hidden md:table-cell">
                      Updated
                    </th>
                    <th scope="col" className="py-3 px-4 font-semibold text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-faint">
                  {sources.map((source) => {
                    const chunkDisplay =
                      source.status === "ready" && typeof source.chunk_count === "number"
                        ? source.chunk_count
                        : "—";

                    return (
                      <tr
                        key={source.id}
                        onClick={() => handleOpenDetails(source.id)}
                        className="hover:bg-neutral-50/70 transition-colors cursor-pointer group"
                      >
                        {/* Source Cell: Icon tile + Name + Subtitle/Error */}
                        <td className="py-3 px-4 min-w-[240px]">
                          <div className="flex items-center gap-3">
                            <SourceTypeIconTile kind={source.kind} size="md" />
                            <div className="min-w-0 space-y-0.5">
                              <span className="font-semibold text-accent-black group-hover:text-heat-100 transition-colors block truncate max-w-xs">
                                {source.name}
                              </span>
                              {source.status === "failed" && source.error_message ? (
                                <p className="text-[11px] text-accent-crimson line-clamp-1">
                                  {source.error_message}
                                </p>
                              ) : source.file_name ? (
                                <p className="text-[11px] text-neutral-400 truncate max-w-xs">
                                  {source.file_name}
                                </p>
                              ) : source.source_url ? (
                                <p className="text-[11px] text-neutral-400 truncate max-w-xs font-mono">
                                  {source.source_url}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </td>

                        {/* Type Cell */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <SourceTypeLabel kind={source.kind} showIcon={false} />
                        </td>

                        {/* Status Cell */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <SourceStatusBadge status={source.status} />
                        </td>

                        {/* Chunks Cell */}
                        <td className="py-3 px-4 whitespace-nowrap font-mono text-neutral-600">
                          {chunkDisplay}
                        </td>

                        {/* Updated Cell (Hidden on smaller tablet) */}
                        <td
                          className="py-3 px-4 whitespace-nowrap text-neutral-500 hidden md:table-cell"
                          title={formatDateTime(source.updated_at)}
                        >
                          {formatRelativeTime(source.updated_at)}
                        </td>

                        {/* Actions Cell */}
                        <td
                          className="py-3 px-4 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenDetails(source.id)}
                              className="px-2.5 py-1 rounded-6 text-xs font-medium text-neutral-600 hover:text-accent-black hover:bg-neutral-100 transition-colors"
                            >
                              Inspect
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingSource(source)}
                              aria-label={`Delete ${source.name}`}
                              className="p-1.5 rounded-6 text-neutral-400 hover:text-accent-crimson hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Stacked Source Cards (Image 8) */}
          <div className="block sm:hidden space-y-3">
            {sources.map((source) => {
              const chunkDisplay =
                source.status === "ready" && typeof source.chunk_count === "number"
                  ? `${source.chunk_count} ${source.chunk_count === 1 ? "chunk" : "chunks"}`
                  : "—";

              return (
                <article
                  key={source.id}
                  onClick={() => handleOpenDetails(source.id)}
                  className="rounded-12 border border-border-faint bg-white p-4 space-y-3 shadow-xs cursor-pointer active:bg-neutral-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <SourceTypeIconTile kind={source.kind} size="md" />
                      <div className="min-w-0">
                        <h3 className="font-semibold text-xs text-accent-black truncate">
                          {source.name}
                        </h3>
                        <p className="text-[11px] text-neutral-400 mt-0.5">
                          {formatRelativeTime(source.updated_at)}
                        </p>
                      </div>
                    </div>
                    <SourceStatusBadge status={source.status} />
                  </div>

                  {source.status === "failed" && source.error_message && (
                    <p className="text-[11px] text-accent-crimson leading-tight p-2 bg-red-50 rounded-6 border border-red-100">
                      {source.error_message}
                    </p>
                  )}

                  <div className="flex items-center justify-between text-xs text-neutral-500 pt-1 border-t border-border-faint">
                    <SourceTypeLabel kind={source.kind} showIcon={false} />
                    <span className="font-mono text-[11px]">{chunkDisplay}</span>
                  </div>

                  <div
                    className="flex items-center gap-2 pt-2 border-t border-border-faint"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenDetails(source.id)}
                      className="flex-1 py-2 rounded-8 bg-neutral-100 hover:bg-neutral-200 text-xs font-semibold text-accent-black transition-colors min-h-[44px] flex items-center justify-center gap-1.5"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Inspect</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingSource(source)}
                      aria-label={`Delete ${source.name}`}
                      className="px-3.5 py-2 rounded-8 border border-red-200 text-accent-crimson hover:bg-red-50 transition-colors min-h-[44px] flex items-center justify-center"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Directory Footer (Image 1) */}
          <div className="p-4 rounded-12 bg-white border border-border-faint flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500 shadow-xs">
            <div>
              Showing {sources.length} of {totalFiltered}{" "}
              {totalFiltered === 1 ? "source" : "sources"}
              {totalWorkspaceCount > 0 && (
                <span className="ml-1 text-neutral-400">
                  • {statusCounts.ready} ready, {statusCounts.indexing} indexing,{" "}
                  {statusCounts.failed} failed
                </span>
              )}
            </div>

            <p className="text-[11px] text-neutral-400 text-center sm:text-right">
              Ready sources provide context for agent responses. Review indexed chunks to verify the
              content.
            </p>
          </div>
        </div>
      )}

      {/* Slide-over Source Details Drawer (Image 5, Image 6, Image 8) */}
      <SourceDetails
        workspaceId={workspaceId}
        sourceId={selectedSourceId}
        open={drawerOpen}
        onClose={handleDrawerClose}
        onDeleteRequest={handleDeleteRequest}
        onSourceUpdated={handleSourceUpdated}
      />

      {/* Add Source Modal (Image 2, 3, 4) */}
      <AddSourceModal
        open={addModalOpen}
        onClose={() => {
          setAddModalOpen(false);
          setActiveTemplate(null);
        }}
        workspaceId={workspaceId}
        initialTemplate={activeTemplate}
        onSourceCreated={handleSourceCreated}
      />

      {/* Delete Confirmation Modal (Image 7) */}
      {deletingSource && (
        <DeleteSourceModal
          open={Boolean(deletingSource)}
          onClose={() => setDeletingSource(null)}
          workspaceId={workspaceId}
          sourceId={deletingSource.id}
          sourceName={deletingSource.name}
          chunkCount={deletingSource.chunk_count}
          onDeleted={() => handleSourceDeleted(deletingSource.id)}
        />
      )}
    </div>
  );
}
