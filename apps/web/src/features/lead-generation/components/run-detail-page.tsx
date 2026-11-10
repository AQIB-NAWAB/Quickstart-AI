"use client";

import Link from "next/link";
import {
  Building2,
  MapPin,
  CheckCircle2,
  ArrowLeft,
  ArrowUpDown,
  Users,
  Ban,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Mail,
  Phone,
  RefreshCw,
  Search,
  StopCircle,
  Truck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelRun, getRun, getRunDeliveries, getRunResults } from "../lib/client";
import type {
  LeadGenerationCandidateResult,
  LeadGenerationDeliveryTask,
  LeadGenerationRunSummary,
} from "../lib/types";
import {
  cleanDomain,
  ensureAbsoluteUrl,
  formatStatusLabel,
  formatResearchTarget,
  formatStopReason,
} from "../lib/format";
import { LeadDetailDrawer } from "./lead-detail-drawer";
import { LeadSelect } from "./lead-select";

function candidateWebsite(candidate: LeadGenerationCandidateResult): string {
  if (candidate.assessment?.website) return candidate.assessment.website;
  if (typeof candidate.url === "string" && candidate.url) return candidate.url;
  if (typeof candidate.domain === "string") return candidate.domain;
  return "";
}

function candidateDomain(candidate: LeadGenerationCandidateResult): string {
  const website = candidateWebsite(candidate);
  if (!website) return "";
  try {
    return new URL(ensureAbsoluteUrl(website)).hostname.replace(/^www\./, "");
  } catch {
    return cleanDomain(website).split(/[/?#]/)[0];
  }
}

export function LeadGenerationRunDetailPage({
  workspaceId,
  runId,
}: {
  workspaceId: string;
  runId: string;
}) {
  const [run, setRun] = useState<LeadGenerationRunSummary | null>(null);
  const [results, setResults] = useState<LeadGenerationCandidateResult[]>([]);
  const [deliveries, setDeliveries] = useState<LeadGenerationDeliveryTask[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<LeadGenerationCandidateResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Filters & Sorting state
  const [candidateTab, setCandidateTab] = useState<
    "all" | "accepted" | "provisional" | "rejected" | "failed" | "cancelled"
  >("accepted");
  const [search, setSearch] = useState("");
  const [contactFilter, setContactFilter] = useState<
    "all" | "email" | "phone" | "contact" | "none"
  >("all");
  const [sortBy, setSortBy] = useState<"outcome" | "score" | "name">("outcome");
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  const isFetchingRef = useRef(false);
  const hasLoadedRunRef = useRef(false);
  const hasInitializedTabRef = useRef(false);
  const [authExpired, setAuthExpired] = useState(false);

  const load = useCallback(
    async (isManualRefresh = false) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      if (isManualRefresh) setRefreshing(true);

      try {
        const [runRes, resultsRes, deliveriesRes] = await Promise.all([
          getRun(workspaceId, runId),
          getRunResults(workspaceId, runId),
          getRunDeliveries(workspaceId, runId),
        ]);

        if ([runRes, resultsRes, deliveriesRes].some((result) => result.status === 401)) {
          setAuthExpired(true);
          setError("Session expired. Sign in again to refresh this run or cancel it.");
          return;
        }
        if (runRes.error) {
          setError(
            runRes.error.message ?? "Could not refresh run; displayed results may be stale.",
          );
        }
        if (runRes.data?.run) {
          setRun(runRes.data.run);
          hasLoadedRunRef.current = true;
          setError(null);
        } else if (!hasLoadedRunRef.current && runRes.error) {
          setError(runRes.error.message ?? "Failed to load run");
          return;
        }

        if (resultsRes.data?.items) {
          const items = resultsRes.data.items;
          if (!hasInitializedTabRef.current) {
            setCandidateTab(items.some((item) => item.status === "accepted") ? "accepted" : "all");
            hasInitializedTabRef.current = true;
          }
          setResults(items);
          setSelectedCandidate((current) => {
            if (!current) return null;
            return items.find((r) => r.id === current.id) ?? current;
          });
        }

        if (deliveriesRes.data?.items) {
          setDeliveries(deliveriesRes.data.items);
        }
      } finally {
        isFetchingRef.current = false;
        setRefreshing(false);
      }
    },
    [workspaceId, runId],
  );

  useEffect(() => {
    hasLoadedRunRef.current = false;
    hasInitializedTabRef.current = false;
    void load();
  }, [load]);

  const isRunning = run ? ["queued", "running"].includes(run.status) : false;

  useEffect(() => {
    if (!isRunning || authExpired) return;
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void load();
    }, 3000);
    return () => clearInterval(t);
  }, [isRunning, authExpired, load]);

  async function onCancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      const result = await cancelRun(workspaceId, runId);
      if (result.error || !result.data?.run) {
        if (result.status === 401) setAuthExpired(true);
        setError(
          result.status === 401
            ? "Session expired. Sign in again to cancel this run."
            : (result.error?.message ?? "Could not cancel the run. Please try again."),
        );
        return;
      }
      setRun(result.data.run);
      setError(null);
      await load(true);
    } finally {
      setCancelling(false);
    }
  }

  async function handleExportCsv() {
    if (exportingCsv) return;
    setExportingCsv(true);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/lead-generation/leads/export/csv?run_id=${encodeURIComponent(runId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ run_id: runId }),
        },
      );
      if (!res.ok) {
        throw new Error("Failed to export CSV");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-run-${runId.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "CSV Export failed");
    } finally {
      setExportingCsv(false);
    }
  }

  // Derived counts for summary band
  const totalCandidates = results.length;
  const acceptedCount = results.filter((r) => r.status === "accepted").length;
  const provisionalCount = results.filter((r) =>
    ["queued", "running", "evaluating", "discovered"].includes(r.status),
  ).length;
  const rejectedOrDuplicateCount = results.filter(
    (r) => r.status === "duplicate" || r.status === "rejected",
  ).length;
  const cancelledCount = results.filter((r) => r.status === "cancelled").length;
  const failedCount = results.filter(
    (r) => r.status === "failed" || r.status === "research_failed",
  ).length;

  // Filtered and sorted candidate list
  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = results.filter((item) => {
      // Tab filter
      if (candidateTab === "accepted" && item.status !== "accepted") return false;
      if (candidateTab === "cancelled" && item.status !== "cancelled") return false;
      if (
        candidateTab === "provisional" &&
        !["queued", "running", "evaluating", "discovered"].includes(item.status)
      ) {
        return false;
      }
      if (
        candidateTab === "rejected" &&
        item.status !== "rejected" &&
        item.status !== "duplicate"
      ) {
        return false;
      }
      if (
        candidateTab === "failed" &&
        item.status !== "failed" &&
        item.status !== "research_failed"
      ) {
        return false;
      }

      // Contact availability filter
      const hasEmail = Boolean(item.assessment?.email);
      const hasPhone = Boolean(item.assessment?.phone);
      if (contactFilter === "email" && !hasEmail) return false;
      if (contactFilter === "phone" && !hasPhone) return false;
      if (contactFilter === "contact" && !hasEmail && !hasPhone) return false;
      if (contactFilter === "none" && (hasEmail || hasPhone)) return false;

      // Text search
      if (!q) return true;
      const company = (item.assessment?.company_name || "").toLowerCase();
      const domain = candidateDomain(item).toLowerCase();
      const category = (item.assessment?.category || "").toLowerCase();
      const candidateId = item.id.toLowerCase();
      return (
        company.includes(q) || domain.includes(q) || category.includes(q) || candidateId.includes(q)
      );
    });

    // Sorting (create shallow copy so fetched array is not mutated)
    return [...filtered].sort((a, b) => {
      if (sortBy === "outcome") {
        const order = (s: string) =>
          s === "accepted" ? 0 : s === "rejected" ? 1 : s === "duplicate" ? 2 : 3;
        const diff = order(a.status) - order(b.status);
        if (diff !== 0) return diff;
        // Secondary sort by fit score descending
        return (b.assessment?.fit_score ?? 0) - (a.assessment?.fit_score ?? 0);
      }
      if (sortBy === "score") {
        return (b.assessment?.fit_score ?? 0) - (a.assessment?.fit_score ?? 0);
      }
      if (sortBy === "name") {
        const nameA = a.assessment?.company_name || candidateDomain(a);
        const nameB = b.assessment?.company_name || candidateDomain(b);
        return nameA.localeCompare(nameB);
      }
      return 0;
    });
  }, [results, candidateTab, contactFilter, search, sortBy]);

  if (!run && !error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <RefreshCw className="h-4 w-4 animate-spin text-heat-100" />
          <span>Loading lead research run…</span>
        </div>
      </div>
    );
  }

  const isCompleted = run?.status === "completed";

  // Category-derived heading
  const categories = run?.brief?.categories ?? [];
  const primaryHeading = formatResearchTarget(categories);
  const locationText = run?.brief?.location || null;
  const shortRunId = runId.slice(0, 8);
  const stopReason = formatStopReason(run?.stop_reason);

  const target = run?.brief?.target_count || 0;
  const targetProgress = target ? Math.min(100, (acceptedCount / target) * 100) : 0;
  const tabs = [
    { value: "accepted", label: "Accepted", count: acceptedCount },
    { value: "all", label: "All", count: totalCandidates },
    { value: "rejected", label: "Excluded", count: rejectedOrDuplicateCount },
    { value: "cancelled", label: "Not assessed", count: cancelledCount },
    { value: "provisional", label: "Pending", count: provisionalCount },
    { value: "failed", label: "Failed", count: failedCount },
  ] as const;

  return (
    <div className="lead-console lead-results lead-results-redesign">
      <header className="lr-header">
        <div className="lr-title-block">
          <Link
            className="lr-title-back lr-button lr-primary"
            href={`/workspaces/${workspaceId}/lead-generation/runs`}
            aria-label="Back to runs"
            title="Back to runs"
          >
            <ArrowLeft />
          </Link>
          <div className="lr-title-copy">
            <h1>{primaryHeading}</h1>
            <p className="lr-meta">
              {locationText || "Any location"}
              <span>·</span>
              {
                {
                  email: "Email required",
                  phone: "Phone required",
                  both: "Email & phone required",
                  either: "Email or phone",
                  none: "Contact optional",
                }[run?.brief?.required_contact || "none"]
              }
              <span>·</span>
              {run?.qualification_mode === "strict" ? "Strict match" : "Best match"}
            </p>
          </div>
        </div>
        <div className="lr-actions">
          {run && (
            <span className={`lr-status ${isCompleted ? "is-success" : ""}`}>
              <i />
              {formatStatusLabel(run.status)}
            </span>
          )}
          <button
            className="lr-button lr-icon-button"
            aria-label="Refresh run results"
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} />
          </button>
          {isRunning && (
            <button className="lr-button" disabled={cancelling} onClick={() => void onCancel()}>
              <StopCircle />
              {cancelling ? "Cancelling…" : "Cancel run"}
            </button>
          )}
          <button
            className="lr-button lr-primary"
            onClick={() => void handleExportCsv()}
            disabled={exportingCsv || acceptedCount === 0}
          >
            <Download />
            {exportingCsv ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </header>
      {error && (
        <div className="lr-alert" role="alert">
          {error}
        </div>
      )}
      <section
        className={`lr-completion ${isCompleted ? "is-complete" : ""}`}
        aria-label="Run progress"
      >
        <div>
          {isCompleted ? (
            <CheckCircle2 className="lr-success-icon" />
          ) : isRunning ? (
            <RefreshCw className="animate-spin" />
          ) : (
            <AlertTriangle />
          )}
          <div>
            <strong>
              {acceptedCount} of {target || "—"} leads found
            </strong>
            <p>
              {isRunning
                ? "Research in progress"
                : isCompleted
                  ? "Search complete"
                  : stopReason || formatStatusLabel(run?.status || "unavailable")}
            </p>
          </div>
        </div>
        <div className="lr-target">
          <span>{Math.round(targetProgress)}% of target</span>
          <div
            className="lr-progress"
            role="progressbar"
            aria-label="Lead target progress"
            aria-valuenow={Math.round(targetProgress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: `${targetProgress}%` }} />
          </div>
        </div>
      </section>
      {run?.shortfall_explanation && !isRunning && (
        <details className="lr-disclosure lr-shortfall">
          <summary>
            <AlertTriangle />
            Why the target was not reached
            <ChevronDown />
          </summary>
          <div>
            <p>{run.shortfall_explanation.summary}</p>
            {run.shortfall_explanation.expansion_options?.map((option, index) => (
              <p key={index}>
                <strong>{option.label}.</strong> {option.description}
              </p>
            ))}
          </div>
        </details>
      )}
      <div className="lr-counts">
        <span>
          <strong>{totalCandidates}</strong> discovered
        </span>
        <span>
          <strong>{acceptedCount}</strong> accepted
        </span>
        <span>
          <strong>{rejectedOrDuplicateCount}</strong> excluded
        </span>
        <span>
          <strong>{cancelledCount}</strong> not assessed
        </span>
        {failedCount > 0 && (
          <span>
            <strong>{failedCount}</strong> failed
          </span>
        )}
      </div>
      <section className="lr-leads" aria-label="Research results">
        <div className="lr-toolbar">
          <div className="lr-tabs" role="tablist" aria-label="Candidate outcomes">
            {tabs.map((tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={candidateTab === tab.value}
                key={tab.value}
                className={candidateTab === tab.value ? "is-selected" : ""}
                onClick={() => setCandidateTab(tab.value)}
              >
                {tab.label}
                <span>{tab.count}</span>
              </button>
            ))}
          </div>
          <div className="lr-tools">
            <label className="lr-search">
              <Search />
              <input
                aria-label="Search businesses"
                placeholder="Search businesses…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <LeadSelect
              label="Contact"
              value={contactFilter}
              onChange={setContactFilter}
              icon={Mail}
              options={[
                { value: "all", label: "All contacts", icon: Mail },
                { value: "email", label: "Has email", icon: Mail },
                { value: "phone", label: "Has phone", icon: Phone },
                { value: "contact", label: "Email or phone", icon: Users },
                { value: "none", label: "No contact found", icon: Ban },
              ]}
            />
            <LeadSelect
              label="Sort"
              value={sortBy}
              onChange={setSortBy}
              icon={ArrowUpDown}
              options={[
                { value: "outcome", label: "Outcome", icon: CheckCircle2 },
                { value: "score", label: "Best fit", icon: ArrowUpDown },
                { value: "name", label: "Business name", icon: Building2 },
              ]}
            />
          </div>
        </div>
        <table className="lr-table">
          <colgroup>
            <col className="lr-business-col" />
            <col className="lr-contact-col" />
            <col className="lr-location-col" />
            <col className="lr-fit-col" />
            <col className="lr-open-col" />
          </colgroup>
          <thead>
            <tr>
              <th>Business</th>
              <th>Contact</th>
              <th>Location</th>
              <th>Fit</th>
              <th>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredCandidates.map((item) => {
              const lead = item.assessment;
              const score =
                lead?.fit_score == null ? null : Math.max(0, Math.min(100, lead.fit_score));
              return (
                <tr
                  key={item.id}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("a, button, input, select, textarea"))
                      return;
                    setSelectedCandidate(item);
                  }}
                  className={selectedCandidate?.id === item.id ? "is-selected" : ""}
                >
                  <td>
                    <div className="lr-business">
                      <span className="lr-store">
                        <Building2 />
                      </span>
                      <div>
                        <button
                          className="lr-business-name"
                          onClick={() => setSelectedCandidate(item)}
                        >
                          {lead?.company_name || candidateDomain(item) || "Unnamed candidate"}
                        </button>
                        {candidateWebsite(item) && (
                          <a
                            className="lr-domain"
                            href={ensureAbsoluteUrl(candidateWebsite(item))}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {candidateDomain(item)}
                            <ExternalLink />
                          </a>
                        )}
                        {candidateTab !== "accepted" && (
                          <span
                            className={`lr-outcome ${item.status === "accepted" ? "is-success" : ""}`}
                          >
                            {formatStatusLabel(item.status)}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td data-label="Contact">
                    <div className="lr-contact">
                      {lead?.email && (
                        <a href={`mailto:${lead.email}`}>
                          <Mail />
                          <span>{lead.email}</span>
                        </a>
                      )}
                      {lead?.phone && (
                        <a href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`}>
                          <Phone />
                          <span>{lead.phone}</span>
                        </a>
                      )}
                      {!lead?.email && !lead?.phone && (
                        <span className="lr-muted">
                          {["queued", "running", "evaluating", "discovered"].includes(item.status)
                            ? "Research pending"
                            : "No contact found"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td data-label="Location">
                    <div className="lr-location">
                      <MapPin />
                      <span>{lead?.location || "Not confirmed"}</span>
                    </div>
                  </td>
                  <td data-label="Fit">
                    {score !== null ? (
                      <div className="lr-fit">
                        <span>
                          <strong>{score}</strong>
                          <small> / 100</small>
                        </span>
                        <div
                          className="lr-progress"
                          role="progressbar"
                          aria-label="Business fit"
                          aria-valuenow={score}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <i style={{ width: `${score}%` }} />
                        </div>
                      </div>
                    ) : (
                      <span className="lr-muted">Not assessed</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="lr-open"
                      aria-label={`View ${lead?.company_name || candidateDomain(item)} details`}
                      onClick={() => setSelectedCandidate(item)}
                    >
                      <ChevronRight />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredCandidates.length === 0 && (
          <div className="lr-empty">
            <Search />
            <strong>No leads in this view</strong>
            <p>
              {isRunning
                ? "Research is still running. Check All or Pending to see progress."
                : "Try another outcome or adjust your search and filters."}
            </p>
            <button
              className="lr-button"
              onClick={() => {
                setCandidateTab("all");
                setSearch("");
                setContactFilter("all");
              }}
            >
              Show all candidates
            </button>
          </div>
        )}
        <footer className="lr-table-footer">
          <span>
            {filteredCandidates.length} {filteredCandidates.length === 1 ? "lead" : "leads"}
          </span>
          <span>Publicly listed contacts. Deliverability has not been verified.</span>
        </footer>
      </section>
      <details className="lr-disclosure">
        <summary>
          <ChevronRight />
          Run details<span>#{shortRunId}</span>
        </summary>
        <div>
          <p>{stopReason}</p>
          {run?.source_runs?.map((source, index) => (
            <p key={index}>
              <strong>{source.actor_id}</strong> · {source.status}
              {source.external_run_id && <> · Run: {source.external_run_id}</>}
              {source.error && <span className="lr-error"> · {source.error}</span>}
            </p>
          ))}
          <p>
            Fit score does not determine acceptance alone. Required criteria and contact
            availability also apply.
          </p>
        </div>
      </details>
      <div className="lr-disclosure">
        <button
          className="lr-disclosure-button"
          aria-expanded={deliveriesOpen}
          onClick={() => setDeliveriesOpen((value) => !value)}
        >
          <Truck />
          Campaign deliveries<span>{deliveries.length}</span>
          <ChevronDown />
        </button>
        {deliveriesOpen && (
          <div>
            {deliveries.length === 0 ? (
              <p>No campaign deliveries for this run.</p>
            ) : (
              deliveries.map((delivery) => (
                <p key={delivery.id}>
                  #{delivery.id.slice(0, 8)} · {formatStatusLabel(delivery.state)} · Attempts:{" "}
                  {delivery.attempts ?? 0}
                  {delivery.error_code && (
                    <span className="lr-error"> · {delivery.error_code}</span>
                  )}
                </p>
              ))
            )}
          </div>
        )}
      </div>
      {selectedCandidate && (
        <LeadDetailDrawer
          key={selectedCandidate.id}
          candidate={selectedCandidate}
          brief={run?.brief}
          workspaceId={workspaceId}
          onClose={() => setSelectedCandidate(null)}
        />
      )}
    </div>
  );
}
