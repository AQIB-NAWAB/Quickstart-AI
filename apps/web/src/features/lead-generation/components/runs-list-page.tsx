"use client";

import {
  AlertTriangle,
  FileText,
  Users,
  Play,
  ChevronLeft,
  Building2,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FeatureDialog } from "@/features/knowledge/components/feature-dialog";
import { listRuns } from "../lib/client";
import { formatResearchTarget } from "../lib/format";
import type { LeadGenerationRunSummary } from "../lib/types";
import { LeadSelect } from "./lead-select";
import { LeadGenerationNewRunPage } from "./new-run-page";

function CreateQueryOpener({ onOpen }: { onOpen: () => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("create") === "1") onOpen();
  }, [searchParams, onOpen]);
  return null;
}

function formatRunCreatedDate(iso?: string) {
  if (!iso) return { date: "—", time: "" };
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: iso, time: "" };

    const date = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const time = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return { date, time };
  } catch {
    return { date: iso, time: "" };
  }
}

function renderRunStatusBadge(status: string) {
  const norm = (status || "").toLowerCase();

  if (norm === "completed_with_errors") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200/80">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        <span>Completed with errors</span>
      </span>
    );
  }

  if (norm === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-900 border border-emerald-200/80">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
        <span>Completed</span>
      </span>
    );
  }

  if (norm === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-orange-50 text-neutral-800 border border-orange-200/80">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shrink-0" />
        <span>Running</span>
      </span>
    );
  }

  if (norm === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-50 text-red-900 border border-red-200/80">
        <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
        <span>Failed</span>
      </span>
    );
  }

  if (norm === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700 border border-neutral-200/80">
        <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 shrink-0" />
        <span>Cancelled</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700 border border-neutral-200/80 capitalize">
      <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 shrink-0" />
      <span>{norm === "queued" ? "Queued" : norm.replace(/_/g, " ")}</span>
    </span>
  );
}

export function LeadGenerationRunsListPage({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [runs, setRuns] = useState<LeadGenerationRunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [tabFilter, setTabFilter] = useState<
    "all" | "active" | "completed" | "errors" | "cancelled"
  >("all");
  const [statusDropdown, setStatusDropdown] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [sort, setSort] = useState("newest");
  const [pageSize, setPageSize] = useState("8");
  const [page, setPage] = useState(1);

  const openCreate = useCallback(() => setCreateOpen(true), []);

  function closeCreate() {
    setCreateOpen(false);
    if (typeof window !== "undefined" && window.location.search.includes("create=1")) {
      router.replace(`/workspaces/${workspaceId}/lead-generation/runs`);
    }
  }

  const loadData = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const res = await listRuns(workspaceId);
      if (res.error || !res.data) {
        setError(res.error?.message ?? "Failed to load runs");
      } else {
        setRuns(res.data.items ?? []);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [workspaceId],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Dynamic summary metrics adhering strictly to Section 8 specifications
  const metrics = useMemo(() => {
    const total = runs.length;
    const acceptedLeads = runs.reduce((sum, r) => sum + Number(r.accepted ?? 0), 0);
    const activeRuns = runs.filter((r) => r.status === "queued" || r.status === "running").length;
    const runsWithErrors = runs.filter(
      (r) => r.status === "completed_with_errors" || r.status === "failed",
    ).length;
    const completedClean = runs.filter((r) => r.status === "completed").length;
    return { total, acceptedLeads, activeRuns, runsWithErrors, completedClean };
  }, [runs]);

  // Tab counts
  const tabCounts = useMemo(() => {
    return {
      all: runs.length,
      active: metrics.activeRuns,
      completed: metrics.completedClean,
      errors: metrics.runsWithErrors,
    };
  }, [runs, metrics]);

  // Filtered runs
  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((run) => {
      // Tab filter
      if (tabFilter === "active" && run.status !== "queued" && run.status !== "running") {
        return false;
      }
      if (tabFilter === "completed" && run.status !== "completed") {
        return false;
      }
      if (
        tabFilter === "errors" &&
        run.status !== "completed_with_errors" &&
        run.status !== "failed"
      ) {
        return false;
      }

      if (tabFilter === "cancelled" && run.status !== "cancelled") return false;

      // Dropdown status filter
      if (statusDropdown !== "all" && run.status !== statusDropdown) {
        return false;
      }

      // Search query
      if (!q) return true;
      const categories = (run.brief?.categories ?? []).join(" ").toLowerCase();
      const location = (run.brief?.location ?? "").toLowerCase();
      const id = run.id.toLowerCase();
      return categories.includes(q) || location.includes(q) || id.includes(q);
    });
  }, [runs, tabFilter, statusDropdown, search]);

  const sortedRuns = [...filteredRuns].sort((a, b) => {
    const time = (run: LeadGenerationRunSummary) => Date.parse(run.created_at || "") || 0;
    return sort === "oldest"
      ? time(a) - time(b)
      : sort === "accepted"
        ? Number(b.accepted || 0) - Number(a.accepted || 0)
        : time(b) - time(a);
  });
  const size = Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(sortedRuns.length / size));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * size;
  const visibleRuns = sortedRuns.slice(offset, offset + size);

  return (
    <div className="lead-console lead-runs lead-runs-redesign">
      <Suspense fallback={null}>
        <CreateQueryOpener onOpen={openCreate} />
      </Suspense>
      <header className="runs-header">
        <div>
          <h1>Lead generation</h1>
          <p>Find and review leads for your business.</p>
        </div>
        <div className="runs-actions">
          <Link className="lr-button" href={`/workspaces/${workspaceId}/lead-generation/profile`}>
            <Building2 />
            Business profile
          </Link>
          <Link
            className="lr-button"
            href={`/workspaces/${workspaceId}/lead-generation/connectors`}
          >
            <Webhook />
            Inbound connectors
          </Link>
          <button className="lr-button lr-primary" onClick={openCreate}>
            <Plus />
            New run
          </button>
        </div>
      </header>
      {error && (
        <div className="lr-alert" role="alert">
          {error}
        </div>
      )}
      <section className="runs-metrics" aria-label="Research summary">
        {[
          { label: "Total runs", value: metrics.total, Icon: FileText },
          { label: "Accepted leads", value: metrics.acceptedLeads, Icon: Users },
          { label: "Active runs", value: metrics.activeRuns, Icon: Play },
          { label: "Runs with errors", value: metrics.runsWithErrors, Icon: AlertTriangle },
        ].map(({ label, value, Icon }) => (
          <div key={label}>
            <Icon />
            <div>
              <span>{label}</span>
              <strong>{loading ? "—" : value}</strong>
            </div>
          </div>
        ))}
      </section>
      <div className="lr-tabs runs-tabs" role="tablist" aria-label="Run outcomes">
        {(
          [
            { id: "all", label: "All runs", count: tabCounts.all },
            { id: "active", label: "Active", count: tabCounts.active },
            { id: "completed", label: "Completed", count: tabCounts.completed },
            { id: "errors", label: "With errors", count: tabCounts.errors },
            {
              id: "cancelled",
              label: "Cancelled",
              count: runs.filter((run) => run.status === "cancelled").length,
            },
          ] as const
        ).map((tab) => (
          <button
            role="tab"
            aria-selected={tabFilter === tab.id}
            className={tabFilter === tab.id ? "is-selected" : ""}
            key={tab.id}
            onClick={() => {
              setTabFilter(tab.id);
              setPage(1);
            }}
          >
            {tab.label}
            <span>{tab.count}</span>
          </button>
        ))}
      </div>
      <div className="runs-toolbar">
        <label className="lr-search">
          <Search />
          <input
            aria-label="Search runs"
            placeholder="Search categories, location, or run ID…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <LeadSelect
          label="Status"
          value={statusDropdown}
          onChange={(value) => {
            setStatusDropdown(value);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All statuses" },
            { value: "queued", label: "Queued" },
            { value: "running", label: "Running" },
            { value: "completed", label: "Completed" },
            { value: "completed_with_errors", label: "Completed with errors" },
            { value: "failed", label: "Failed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
        <LeadSelect
          label="Sort"
          value={sort}
          onChange={(value) => {
            setSort(value);
            setPage(1);
          }}
          options={[
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
            { value: "accepted", label: "Most accepted" },
          ]}
        />
        <button
          className="lr-button lr-icon-button"
          aria-label="Refresh runs"
          disabled={loading || refreshing}
          onClick={() => void loadData(true)}
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>
      {loading && (
        <p role="status" className="runs-loading">
          Loading runs…
        </p>
      )}
      <div className="runs-table-wrap">
        <table className="runs-table">
          <colgroup>
            <col style={{ width: "28%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "23%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "4%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Research target</th>
              <th>Location</th>
              <th>Status</th>
              <th>Leads found</th>
              <th>Created</th>
              <th>
                <span className="sr-only">Open run</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRuns.map((run) => {
              const target = Number(run.brief?.target_count || 0),
                accepted = Number(run.accepted || 0);
              const progress = target > 0 ? Math.min(100, (accepted / target) * 100) : 0;
              const created = formatRunCreatedDate(run.created_at);
              const href = `/workspaces/${workspaceId}/lead-generation/runs/${run.id}`;
              return (
                <tr
                  key={run.id}
                  onClick={(event) => {
                    if (!(event.target as HTMLElement).closest("a,button")) router.push(href);
                  }}
                >
                  <td>
                    <div className="runs-target">
                      <span className="lr-store">
                        <Building2 />
                      </span>
                      <div>
                        <Link href={href}>{formatResearchTarget(run.brief?.categories || [])}</Link>
                        <small>#{run.id.slice(0, 8)}</small>
                      </div>
                    </div>
                  </td>
                  <td data-label="Location">{run.brief?.location || "Any location"}</td>
                  <td data-label="Status">{renderRunStatusBadge(run.status)}</td>
                  <td data-label="Leads found">
                    <div className="runs-attainment">
                      <span>
                        <strong>{accepted}</strong> / {target || "—"}
                      </span>
                      <div
                        className="lr-progress"
                        role="progressbar"
                        aria-label="Lead target progress"
                        aria-valuenow={Math.round(progress)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <i style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  </td>
                  <td data-label="Created">
                    <span>{created.date}</span>
                    <small className="runs-time">{created.time}</small>
                  </td>
                  <td>
                    <Link
                      className="runs-open"
                      href={href}
                      aria-label={`Open ${formatResearchTarget(run.brief?.categories || [])} run`}
                    >
                      <ChevronRight />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && visibleRuns.length === 0 && (
          <div className="lr-empty">
            <Search />
            <strong>No research runs found</strong>
            <p>
              {runs.length
                ? "Try another search or status filter."
                : "Create your first run to start finding leads."}
            </p>
            {runs.length > 0 && (
              <button
                className="lr-button"
                onClick={() => {
                  setSearch("");
                  setStatusDropdown("all");
                  setTabFilter("all");
                  setPage(1);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
        <footer className="runs-pagination">
          <span>
            {sortedRuns.length
              ? `Showing ${offset + 1}–${Math.min(offset + size, sortedRuns.length)} of ${sortedRuns.length} runs`
              : "0 runs"}
          </span>
          <div>
            <LeadSelect
              label="Rows"
              value={pageSize}
              onChange={(value) => {
                setPageSize(value);
                setPage(1);
              }}
              options={[
                { value: "8", label: "8" },
                { value: "16", label: "16" },
                { value: "32", label: "32" },
              ]}
            />
            <button
              className="lr-button lr-icon-button"
              aria-label="Previous page"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft />
            </button>
            <span className="runs-page-label">
              {currentPage} / {totalPages}
            </span>
            <button
              className="lr-button lr-icon-button"
              aria-label="Next page"
              disabled={currentPage === totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight />
            </button>
          </div>
        </footer>
      </div>
      <FeatureDialog
        open={createOpen}
        onClose={closeCreate}
        title="New research run"
        description="Define your search, set requirements, then review."
        maxWidthClass="max-w-[1080px]"
        roundedClass="rounded-12"
        backdropClass="bg-black/25"
        layout="lead-wizard"
      >
        <LeadGenerationNewRunPage workspaceId={workspaceId} embedded onCancel={closeCreate} />
      </FeatureDialog>
    </div>
  );
}
