"use client";

import Link from "next/link";
import { ArrowRight, Download, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { filterLeads } from "../lib/filters";
import { getLeadsRepository } from "../lib/repository";
import type { LeadDetail, LeadStatus, LeadSummary } from "../lib/types";
import { CsvExportDialog } from "./csv-export-dialog";
import { LeadDetailDrawer } from "./lead-detail-drawer";
import { LeadFilters, type VisibleColumns } from "./lead-filters";
import { LeadTable } from "./lead-table";
import { LeadSelect } from "@/features/lead-generation/components/lead-select";

interface LeadsPageProps {
  workspaceId: string;
  workspaceSlug?: string;
  isSampleData?: boolean;
}

export function LeadsPage({
  workspaceId,
  workspaceSlug = "acme-support",
  isSampleData = false,
}: LeadsPageProps) {
  // Construct on the client — class instances cannot cross the RSC boundary.
  const repository = useMemo(() => getLeadsRepository(isSampleData), [isSampleData]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL state synchronization
  const initialQ = searchParams?.get("q") || "";
  const initialStatus = searchParams?.get("status") || "all";
  const initialTag = searchParams?.get("tag") || "all";
  const initialLeadId = searchParams?.get("lead") || (isSampleData ? "lead_1042" : null);

  const [q, setQ] = useState(initialQ);
  const [status, setStatus] = useState(initialStatus);
  const [tag, setTag] = useState(initialTag);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(initialLeadId);

  const [allLeads, setAllLeads] = useState<LeadSummary[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [selectedLeadDetail, setSelectedLeadDetail] = useState<LeadDetail | null>(null);

  const [isUnavailable, setIsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState("7");

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<VisibleColumns>({
    contact: true,
    intent: false,
    qualification: true,
    sentiment: false,
    status: true,
    tags: true,
    captured: true,
  });

  function handleToggleColumn(key: keyof VisibleColumns) {
    if (key === "contact") return; // Contact is always visible
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Sync URL query state when filters or lead selection change
  function updateUrl(newParams: {
    q?: string;
    status?: string;
    tag?: string;
    lead?: string | null;
  }) {
    if (!searchParams) return;
    const params = new URLSearchParams(searchParams.toString());

    if (newParams.q !== undefined) {
      if (newParams.q.trim()) params.set("q", newParams.q.trim());
      else params.delete("q");
    }
    if (newParams.status !== undefined) {
      if (newParams.status !== "all") params.set("status", newParams.status);
      else params.delete("status");
    }
    if (newParams.tag !== undefined) {
      if (newParams.tag !== "all") params.set("tag", newParams.tag);
      else params.delete("tag");
    }
    if (newParams.lead !== undefined) {
      if (newParams.lead) params.set("lead", newParams.lead);
      else params.delete("lead");
    }

    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  // Initial load
  useEffect(() => {
    let active = true;
    const abortController = new AbortController();

    async function loadData() {
      try {
        setLoading(true);
        const res = await repository.listLeads(workspaceId, {}, abortController.signal);

        if (!active) return;

        if (res.status === "unavailable") {
          setIsUnavailable(true);
          setLoading(false);
          return;
        }

        if (res.status === "ready") {
          setAllLeads(res.data.leads);
          setAvailableTags(res.data.availableTags);
          setIsUnavailable(false);
        }
        setLoading(false);
      } catch (err: unknown) {
        if (!active || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        setLoading(false);
      }
    }

    loadData();

    return () => {
      active = false;
      abortController.abort();
    };
  }, [repository, workspaceId]);

  // Load detail for selected lead
  useEffect(() => {
    let active = true;
    const abortController = new AbortController();

    async function loadLeadDetail() {
      if (!selectedLeadId) {
        setSelectedLeadDetail(null);
        return;
      }

      try {
        const res = await repository.getLead(workspaceId, selectedLeadId, abortController.signal);
        if (!active) return;

        if (res.status === "ready") {
          setSelectedLeadDetail(res.data);
        } else {
          setSelectedLeadDetail(null);
        }
      } catch (err: unknown) {
        if (!active || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
      }
    }

    loadLeadDetail();

    return () => {
      active = false;
      abortController.abort();
    };
  }, [repository, workspaceId, selectedLeadId]);

  // Filter leads client-side
  const filteredLeads = useMemo(() => {
    return filterLeads(allLeads, { q, status, tag });
  }, [allLeads, q, status, tag]);

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / Number(pageSize)));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * Number(pageSize);
  const paginatedLeads = filteredLeads.slice(pageStart, pageStart + Number(pageSize));

  // Dynamic counts for status tabs from unfiltered dataset
  const statusCounts = useMemo(() => {
    return {
      all: allLeads.length,
      new: allLeads.filter((l) => l.status === "new").length,
      qualified: allLeads.filter((l) => l.status === "qualified").length,
      contacted: allLeads.filter((l) => l.status === "contacted").length,
      disqualified: allLeads.filter((l) => l.status === "disqualified").length,
    };
  }, [allLeads]);

  // Check if selected lead is outside currently filtered leads
  const isSelectedOutsideFilter = useMemo(() => {
    if (!selectedLeadId) return false;
    return !filteredLeads.some((l) => l.id === selectedLeadId);
  }, [filteredLeads, selectedLeadId]);

  // Update lead status
  async function handleUpdateStatus(newStatus: LeadStatus) {
    if (!selectedLeadId) return;

    const res = await repository.updateLeadStatus(
      workspaceId,
      selectedLeadId,
      newStatus,
      selectedLeadDetail?.version,
    );

    if (res.status !== "ready") {
      throw new Error(res.message);
    }
    if (res.status === "ready") {
      setSelectedLeadDetail(res.data);
      setAllLeads((prev) =>
        prev.map((l) => (l.id === selectedLeadId ? { ...l, status: newStatus } : l)),
      );
    }
  }

  // Filter change handlers
  function handleSearchChange(newQ: string) {
    setQ(newQ);
    setPage(1);
    updateUrl({ q: newQ });
  }

  function handleStatusChange(newStatus: string) {
    setStatus(newStatus);
    setPage(1);
    updateUrl({ status: newStatus });
  }

  function handleTagChange(newTag: string) {
    setTag(newTag);
    setPage(1);
    updateUrl({ tag: newTag });
  }

  function handleClearFilters() {
    setQ("");
    setPage(1);
    setStatus("all");
    setTag("all");
    updateUrl({ q: "", status: "all", tag: "all" });
  }

  function handleSelectLead(leadId: string) {
    setSelectedLeadDetail(null);
    setSelectedLeadId(leadId);
    updateUrl({ lead: leadId });
  }

  function handleCloseDrawer() {
    setSelectedLeadId(null);
    updateUrl({ lead: null });
  }

  // Render Unavailable State for production without service
  if (isUnavailable) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-faint">
          <div>
            <h1 className="text-2xl font-bold text-accent-black tracking-tight">Leads</h1>
            <p className="text-xs text-neutral-500 mt-1">
              Review captured contacts, intent, and qualification.
            </p>
          </div>
        </div>

        <div className="bg-white border border-border-faint rounded-12 p-8 sm:p-12 text-center max-w-xl mx-auto my-8 space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto text-neutral-500">
            <span className="text-xl">👥</span>
          </div>
          <h2 className="text-base font-bold text-accent-black tracking-tight">
            Lead management is not available yet.
          </h2>
          <p className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
            This workspace’s lead service is not connected. Lead capture, qualification scoring, and
            CRM export APIs are pending backend implementation.
          </p>
          <div className="pt-2">
            <p className="text-[11px] font-mono text-neutral-400">
              See apps/web/src/features/leads/BACKEND_DEPENDENCIES.md for contracts.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lead-console lead-list leads-redesign space-y-5">
      <header className="leads-heading">
        <div>
          <div className="leads-title">
            <h1>Leads</h1>
            <span>{allLeads.length}</span>
            {isSampleData && <span className="leads-sample">Sample data</span>}
          </div>
          <p>Review, organize and follow up with your leads.</p>
        </div>
        <div className="leads-header-actions">
          <button
            type="button"
            className="settings-button"
            disabled={loading}
            onClick={() => setExportOpen(true)}
          >
            <Download size={17} />
            Export CSV
          </button>
          <Link
            className="settings-button primary"
            href={`/workspaces/${workspaceId}/lead-generation/runs`}
          >
            Lead generation
            <ArrowRight size={17} />
          </Link>
        </div>
      </header>

      {loading && (
        <p role="status" className="text-xs text-neutral-500">
          Loading leads…
        </p>
      )}

      {/* Status Strip & Toolbar (Search, Tags, Columns) */}
      <LeadFilters
        search={q}
        status={status}
        tag={tag}
        availableTags={availableTags}
        statusCounts={statusCounts}
        visibleColumns={visibleColumns}
        onToggleColumn={handleToggleColumn}
        onSearchChange={handleSearchChange}
        onStatusChange={handleStatusChange}
        onTagChange={handleTagChange}
        onClearFilters={handleClearFilters}
      />

      {/* Main Table */}
      <div className="w-full">
        <LeadTable
          leads={paginatedLeads}
          selectedLeadId={selectedLeadId}
          visibleColumns={visibleColumns}
          isSampleData={isSampleData}
          onSelectLead={handleSelectLead}
        />
      </div>

      <footer className="leads-pagination">
        <p role="status">
          {filteredLeads.length
            ? `Showing ${pageStart + 1}–${pageStart + paginatedLeads.length} of ${filteredLeads.length} ${isSampleData ? "sample leads" : "leads"}`
            : "0 leads"}
        </p>
        <div>
          <LeadSelect
            label="Rows"
            value={pageSize}
            onChange={(value) => {
              setPageSize(value);
              setPage(1);
            }}
            options={[
              { value: "7", label: "7 per page" },
              { value: "15", label: "15 per page" },
              { value: "25", label: "25 per page" },
            ]}
          />
          <nav aria-label="Lead pages">
            <button
              type="button"
              aria-label="Previous page"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            {Array.from(
              { length: Math.min(5, totalPages) },
              (_, i) => Math.min(Math.max(1, currentPage - 2), Math.max(1, totalPages - 4)) + i,
            ).map((number) => (
              <button
                type="button"
                key={number}
                aria-current={currentPage === number ? "page" : undefined}
                aria-label={`Page ${number}`}
                onClick={() => setPage(number)}
              >
                {number}
              </button>
            ))}
            <button
              type="button"
              aria-label="Next page"
              disabled={currentPage === totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </nav>
        </div>
      </footer>
      <p className="leads-score-note">
        <Info size={13} />
        Fit scores are AI assessments
      </p>

      {/* Slide-over Detail Drawer */}
      {selectedLeadDetail && (
        <LeadDetailDrawer
          lead={selectedLeadDetail}
          workspaceId={workspaceId}
          isPreview={isSampleData}
          isOutsideFilter={isSelectedOutsideFilter}
          onClose={handleCloseDrawer}
          onUpdateStatus={handleUpdateStatus}
        />
      )}

      {/* CSV Export Dialog */}
      <CsvExportDialog
        open={exportOpen}
        leads={filteredLeads}
        workspaceSlug={workspaceSlug}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
