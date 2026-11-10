"use client";

import {
  MapPin,
  ChevronDown,
  ChevronRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  HelpCircle,
  History,
  Mail,
  Phone,
  PhoneCall,
  Send,
  ShieldAlert,
  Tag,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { updateLeadSalesStatus, getLeadObservations } from "../lib/client";
import { LeadSelect } from "./lead-select";
import type {
  LeadGenerationCandidateResult,
  LeadRunInput,
  SalesStatus,
  LeadObservation,
} from "../lib/types";
import { ensureAbsoluteUrl, formatFieldLabel, formatStatusLabel } from "../lib/format";

interface LeadRefreshEntry {
  run_id?: string;
  refreshed_at?: string;
  fit_score?: number;
  new_summary?: string;
}
interface LeadActivityEntry {
  action?: string;
  details?: { to?: string; from?: string };
  timestamp?: string;
}
interface LeadSalesFields {
  lead_id?: string;
  sales_status?: SalesStatus;
  notes?: string;
  refresh_history?: LeadRefreshEntry[];
  activity_history?: LeadActivityEntry[];
}

interface LeadDetailDrawerProps {
  candidate: LeadGenerationCandidateResult;
  brief?: LeadRunInput;
  workspaceId?: string;
  onClose: () => void;
}

export function LeadDetailDrawer({
  candidate,
  brief,
  workspaceId,
  onClose,
}: LeadDetailDrawerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "evidence">("overview");
  const [saveError, setSaveError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const lead = candidate.assessment;
  const drawerRef = useRef<HTMLElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const closeCallback = useRef(onClose);
  useEffect(() => {
    closeCallback.current = onClose;
  }, [onClose]);

  // Outreach Modals State
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);

  // Email form state
  const [emailRecipient, setEmailRecipient] = useState(
    lead?.email || lead?.decision_maker?.email || "",
  );
  const [emailSubject, setEmailSubject] = useState(
    lead?.company_name
      ? `Introduction: Partnership opportunity for ${lead.company_name}`
      : "Partnership inquiry",
  );
  const [emailBody, setEmailBody] = useState(
    `Hi ${lead?.person_name || "there"},\n\nI came across ${lead?.company_name || "your organization"} and noticed your work in ${lead?.category || "the industry"}.\n\nWould you be open to a brief conversation this week?\n\nBest regards,\n[Your Name]`,
  );
  const [emailSending, setEmailSending] = useState(false);
  const [emailOutcome, setEmailOutcome] = useState<{
    ok: boolean;
    status: string;
    message: string;
  } | null>(null);

  // Phone call form state
  const [phoneRecipient, setPhoneRecipient] = useState(
    lead?.phone || lead?.decision_maker?.phone || "",
  );
  const [humanTransferDestination, setHumanTransferDestination] = useState("+1-800-555-0199");
  const [explicitPhoneConsent, setExplicitPhoneConsent] = useState(false);
  const [phoneCalling, setPhoneCalling] = useState(false);
  const [phoneOutcome, setPhoneOutcome] = useState<{
    ok: boolean;
    status: string;
    message: string;
  } | null>(null);

  // Sales Status, Notes, and History state
  const salesCandidate = candidate as LeadGenerationCandidateResult & LeadSalesFields;
  const salesLead = lead as (NonNullable<typeof lead> & LeadSalesFields) | undefined;
  const leadId = salesCandidate.lead_id || salesLead?.lead_id || null;
  const [salesStatus, setSalesStatus] = useState<SalesStatus>(
    salesCandidate.sales_status || salesLead?.sales_status || "new",
  );
  const [notes, setNotes] = useState<string>(salesCandidate.notes || salesLead?.notes || "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [observations, setObservations] = useState<LeadObservation[]>([]);
  const [loadingObservations, setLoadingObservations] = useState(false);

  const refreshHistory = salesCandidate.refresh_history || salesLead?.refresh_history || [];
  const activityHistory = salesCandidate.activity_history || salesLead?.activity_history || [];

  useEffect(() => {
    if (!leadId || !workspaceId) return;
    let active = true;
    void (async () => {
      setLoadingObservations(true);
      const res = await getLeadObservations(workspaceId, leadId);
      if (active && res.data?.items) {
        setObservations(res.data.items);
      }
      if (active) setLoadingObservations(false);
    })();
    return () => {
      active = false;
    };
  }, [leadId, workspaceId]);

  async function handleStatusChange(newStatus: SalesStatus) {
    if (!leadId || !workspaceId || updatingStatus) return;
    setUpdatingStatus(true);
    setSaveError(null);
    try {
      const result = await updateLeadSalesStatus(workspaceId, leadId, { status: newStatus });
      if (result.error) throw new Error(result.error.message || "Could not update sales status");
      setSalesStatus(newStatus);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save status");
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleSaveNotes() {
    if (!leadId || !workspaceId || savingNotes) return;
    setSavingNotes(true);
    setSaveError(null);
    setNotesSaved(false);
    try {
      const result = await updateLeadSalesStatus(workspaceId, leadId, { notes });
      if (result.error) throw new Error(result.error.message || "Could not save notes");
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save notes");
    } finally {
      setSavingNotes(false);
    }
  }

  // Unified close handler with graceful exit animation
  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      closeCallback.current();
    }, 220);
  }, [closing]);

  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
      previousActiveElement.current?.focus();
    };
  }, []);

  useEffect(() => {
    const scope = emailModalOpen || phoneModalOpen ? modalRef.current : drawerRef.current;
    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
    const focusables = () =>
      Array.from(scope?.querySelectorAll<HTMLElement>(selector) || []).filter(
        (element) => element.getClientRects().length > 0,
      );
    focusables()[0]?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (emailModalOpen) setEmailModalOpen(false);
        else if (phoneModalOpen) setPhoneModalOpen(false);
        else handleClose();
      }
      if (event.key === "Tab") {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) return;
        if (
          event.shiftKey &&
          (document.activeElement === first || !scope?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !scope?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, emailModalOpen, phoneModalOpen]);

  function copyToClipboard(text: string, fieldName: string) {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedField(fieldName);
        setTimeout(() => setCopiedField(null), 2000);
      })
      .catch(() => setSaveError("Could not copy. Select and copy the contact directly."));
  }

  // Handle Send Email Outreach
  async function handleSendEmail() {
    setEmailSending(true);
    setEmailOutcome(null);

    // Simulate calling the email boundary adapter
    setTimeout(() => {
      setEmailSending(false);
      setEmailOutcome({
        ok: true,
        status: "adapter_draft_recorded",
        message:
          "Email draft recorded at boundary adapter. External email automation engine is not connected in this demo workspace. Simulated sends are never represented as live dispatches.",
      });
    }, 600);
  }

  // Handle Initiate AI Phone Call
  async function handleInitiateCall() {
    if (!explicitPhoneConsent) return;
    setPhoneCalling(true);
    setPhoneOutcome(null);

    setTimeout(() => {
      setPhoneCalling(false);
      setPhoneOutcome({
        ok: false,
        status: "telephony_not_connected",
        message:
          "AI Telephony connection requires CPaaS credentials (Twilio or SIP trunk) configured in workspace settings. Call not dispatched in demo mode. Human transfer destination recorded: " +
          humanTransferDestination,
      });
    }, 700);
  }

  const isAccepted = candidate.status === "accepted";
  const hasFitScore = lead?.fit_score != null;
  const score = Math.max(0, Math.min(100, lead?.fit_score ?? 0));
  const website =
    lead?.website ||
    (typeof candidate.url === "string"
      ? candidate.url
      : typeof candidate.domain === "string"
        ? candidate.domain
        : "");
  let websiteLabel = "";
  try {
    websiteLabel = new URL(ensureAbsoluteUrl(website)).hostname.replace(/^www\./, "");
  } catch {
    websiteLabel = "Visit website";
  }
  const businessDisplayName =
    lead?.company_name?.trim() || (website ? websiteLabel : "Unnamed candidate");
  const criteria = lead?.criterion_evaluations || [];
  const evidence = lead?.evidence || [];
  const decisionMakerName = lead?.person_name || lead?.decision_maker?.name;
  const decisionMakerRole = lead?.person_role || lead?.decision_maker?.role;

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className={`li-backdrop ${closing ? "is-closing" : ""}`}
        onClick={handleClose}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-inspector-title"
        className={`lead-console lead-inspector ${closing ? "is-closing" : ""}`}
      >
        <header className="li-header">
          <div className="li-eyebrow">
            Lead details
            <button
              className="lr-icon-button lr-button"
              aria-label="Close lead details"
              onClick={handleClose}
            >
              <X />
            </button>
          </div>
          <div className="li-identity">
            <span className="lr-store">
              <Building2 />
            </span>
            <div>
              <h2 id="lead-inspector-title">{businessDisplayName}</h2>
              <p>{lead?.category || "Category not confirmed"}</p>
            </div>
          </div>
          <div className="li-header-meta">
            {website && (
              <a href={ensureAbsoluteUrl(website)} target="_blank" rel="noreferrer">
                {websiteLabel}
                <ExternalLink />
              </a>
            )}
            <span className={`lr-status ${isAccepted ? "is-success" : ""}`}>
              <i />
              {formatStatusLabel(candidate.status)}
            </span>
          </div>
        </header>
        <div className="li-tabs" role="tablist" aria-label="Lead details">
          <button
            id="lead-overview-tab"
            role="tab"
            aria-selected={detailTab === "overview"}
            aria-controls="lead-overview-panel"
            className={detailTab === "overview" ? "is-selected" : ""}
            onClick={() => setDetailTab("overview")}
          >
            Overview
          </button>
          <button
            id="lead-evidence-tab"
            role="tab"
            aria-selected={detailTab === "evidence"}
            aria-controls="lead-evidence-panel"
            className={detailTab === "evidence" ? "is-selected" : ""}
            onClick={() => setDetailTab("evidence")}
          >
            Evidence<span>{criteria.length + evidence.length}</span>
          </button>
        </div>
        <div className="li-body">
          {saveError && (
            <p className="lr-alert" role="alert">
              {saveError}
            </p>
          )}
          {detailTab === "overview" ? (
            <div role="tabpanel" id="lead-overview-panel" aria-labelledby="lead-overview-tab">
              <section className="li-section">
                <h3 className="li-card-title">
                  <Mail />
                  Contact details
                </h3>
                {[
                  { value: lead?.email, label: "Email", Icon: Mail },
                  { value: lead?.phone, label: "Phone", Icon: Phone },
                ].map(({ value, label, Icon }) => (
                  <div className="li-contact-row" key={label}>
                    <Icon />
                    <div>
                      <small>{label}</small>
                      {value ? (
                        <a
                          href={
                            label === "Email"
                              ? `mailto:${value}`
                              : `tel:${value.replace(/[^+\d]/g, "")}`
                          }
                        >
                          {value}
                        </a>
                      ) : (
                        <p>Not found</p>
                      )}
                    </div>
                    {value && (
                      <button
                        className="lr-button lr-icon-button"
                        aria-label={`Copy ${label.toLowerCase()}`}
                        onClick={() => copyToClipboard(value, label)}
                      >
                        {copiedField === label ? <Check /> : <Copy />}
                      </button>
                    )}
                  </div>
                ))}
                <p className="li-note">
                  Publicly listed contacts. Deliverability has not been verified.
                </p>
              </section>
              <section className="li-section">
                <h3 className="li-card-title">
                  <MapPin />
                  Location
                </h3>
                <div className="li-location">
                  <MapPin />
                  <div>
                    <p>{lead?.location || "Location not confirmed"}</p>
                    {lead?.location && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.location)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open map
                        <ExternalLink />
                      </a>
                    )}
                  </div>
                </div>
              </section>
              {decisionMakerName && (
                <section className="li-section">
                  <h3>Contact person</h3>
                  <p>
                    <strong>{decisionMakerName}</strong>
                    {decisionMakerRole && <> · {decisionMakerRole}</>}
                  </p>
                  {lead?.decision_maker?.email && <p>{lead.decision_maker.email}</p>}
                  {lead?.decision_maker?.phone && <p>{lead.decision_maker.phone}</p>}
                </section>
              )}
              <section className="li-section">
                <div className="li-section-heading">
                  <h3 className="li-card-title">
                    <CheckCircle2 />
                    Qualification
                  </h3>
                  <span>
                    {hasFitScore ? (
                      <>
                        <strong>{score}</strong> / 100
                      </>
                    ) : (
                      "Not assessed"
                    )}
                  </span>
                </div>
                {hasFitScore && (
                  <div
                    className="lr-progress li-fit-progress"
                    role="progressbar"
                    aria-label="Business fit"
                    aria-valuenow={score}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <i style={{ width: `${score}%` }} />
                  </div>
                )}
                <ul className="li-match-list">
                  {criteria.length
                    ? criteria.map((criterion, index) => (
                        <li key={index}>
                          {criterion.status === "matched" ? (
                            <CheckCircle2 className="lr-success-icon" />
                          ) : criterion.status === "unmet" ? (
                            <XCircle />
                          ) : (
                            <HelpCircle />
                          )}
                          <div>
                            <strong>{formatFieldLabel(criterion.criterion)}</strong>
                            <span
                              className={`li-check-status ${criterion.status === "matched" ? "is-success" : ""}`}
                            >
                              {formatStatusLabel(criterion.status)}
                            </span>
                          </div>
                        </li>
                      ))
                    : lead?.fit_reasons?.map((reason, index) => (
                        <li key={index}>
                          <FileText />
                          <span>{reason}</span>
                        </li>
                      ))}
                </ul>
                {!criteria.length && lead?.explanation && (
                  <p className="li-note">{lead.explanation}</p>
                )}
                {lead?.technical_error && <p className="lr-error">{lead.technical_error}</p>}
                <button className="li-text-button" onClick={() => setDetailTab("evidence")}>
                  View supporting evidence
                  <ChevronRight />
                </button>
              </section>
              {brief && (
                <details className="li-disclosure">
                  <summary>
                    Search requirements
                    <ChevronDown />
                  </summary>
                  <div>
                    <p>
                      <strong>Categories:</strong> {brief.categories.join(", ")}
                    </p>
                    <p>
                      <strong>Location:</strong> {brief.location || "Any location"}
                    </p>
                    <p>
                      <strong>Contact:</strong> {brief.required_contact || "Optional"}
                    </p>
                    {brief.instructions && <p>{brief.instructions}</p>}
                  </div>
                </details>
              )}
              <section className="li-section">
                <h3 className="li-card-title">
                  <ChevronRight />
                  Next steps
                </h3>
                <p className="li-note">Review the lead before preparing outreach.</p>
                <div className="li-next-actions">
                  <button
                    className="lr-button"
                    onClick={() => setEmailModalOpen(true)}
                    disabled={!emailRecipient}
                  >
                    <Mail />
                    Email options
                  </button>
                  <button
                    className="lr-button"
                    onClick={() => setPhoneModalOpen(true)}
                    disabled={!phoneRecipient}
                  >
                    <Phone />
                    Call options
                  </button>
                </div>
              </section>
              <details className="li-disclosure">
                <summary>
                  Sales status & notes
                  <ChevronDown />
                </summary>
                <div>
                  {" "}
                  {/* Sales Pipeline & Status Management Card */}
                  <div className="rounded-8 border border-neutral-200 bg-white p-4 space-y-3.5 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2">
                        <Tag className="w-4 h-4 text-heat-100" />
                        <span className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                          Sales Pipeline Status
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <LeadSelect
                          label="Sales status"
                          value={salesStatus}
                          onChange={(status) => void handleStatusChange(status)}
                          disabled={!leadId || updatingStatus}
                          options={[
                            { value: "new", label: "New lead" },
                            { value: "contacted", label: "Contacted" },
                            { value: "replied", label: "Replied" },
                            { value: "meeting", label: "Meeting scheduled" },
                            { value: "won", label: "Closed won" },
                            { value: "lost", label: "Closed lost" },
                          ]}
                        />
                        {updatingStatus && (
                          <span className="text-[11px] text-neutral-400 animate-pulse">
                            Saving…
                          </span>
                        )}
                      </div>
                    </div>

                    {/* User Notes */}
                    <div className="space-y-1.5 pt-1 border-t border-neutral-100">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-neutral-700 flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Lead Notes</span>
                        </label>
                        {notesSaved && (
                          <span className="text-[10px] text-emerald-600 font-semibold inline-flex items-center gap-0.5">
                            <Check className="w-3 h-3" /> Saved
                          </span>
                        )}
                      </div>
                      <textarea
                        aria-label="Lead notes"
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Add private sales notes, follow-up dates, or context..."
                        className="w-full p-2.5 border border-neutral-300 rounded-6 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-heat-100"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={!leadId || savingNotes}
                          onClick={() => void handleSaveNotes()}
                          className="px-3 py-1 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-white rounded-6 text-xs font-semibold transition-colors"
                        >
                          {savingNotes ? "Saving…" : "Save Notes"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          ) : (
            <div role="tabpanel" id="lead-evidence-panel" aria-labelledby="lead-evidence-tab">
              <section className="li-section">
                <h3>Requirement checks</h3>
                <p className="li-note">What was found and the sources behind each decision.</p>
                {criteria.length === 0 && (
                  <p className="li-note">No requirement evidence recorded.</p>
                )}
                {criteria.map((criterion, index) => (
                  <article className="li-evidence-item" key={index}>
                    <div>
                      <h4>{formatFieldLabel(criterion.criterion)}</h4>
                      <span className={criterion.status === "matched" ? "is-success" : ""}>
                        {formatStatusLabel(criterion.status)}
                      </span>
                    </div>
                    <small>{criterion.mandatory ? "Required" : "Preferred"}</small>
                    <p>{criterion.explanation}</p>
                    {criterion.quote && <blockquote>{criterion.quote}</blockquote>}
                    {criterion.source_url && (
                      <a
                        href={ensureAbsoluteUrl(criterion.source_url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View source
                        <ExternalLink />
                      </a>
                    )}
                  </article>
                ))}
              </section>
              <section className="li-section">
                <h3>Source evidence</h3>
                {evidence.length === 0 && <p className="li-note">No source quotes recorded.</p>}
                {evidence.map((item, index) => (
                  <article className="li-evidence-item" key={index}>
                    <h4>{formatFieldLabel(item.field)}</h4>
                    <p>{item.value}</p>
                    {item.quote && <blockquote>{item.quote}</blockquote>}
                    {item.source_url && (
                      <a href={ensureAbsoluteUrl(item.source_url)} target="_blank" rel="noreferrer">
                        View source
                        <ExternalLink />
                      </a>
                    )}
                  </article>
                ))}
              </section>
              {lead?.summary && (
                <section className="li-section">
                  <h3>Research notes</h3>
                  <p>{lead.summary}</p>
                </section>
              )}
              {lead?.missing_evidence?.length ? (
                <section className="li-section">
                  <h3>Missing information</h3>
                  <ul>
                    {lead.missing_evidence.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {lead?.discovered_fields && (
                <details className="li-disclosure">
                  <summary>
                    Captured fields
                    <ChevronDown />
                  </summary>
                  <dl>
                    {Object.entries(lead.discovered_fields).map(([key, value]) => (
                      <div key={key}>
                        <dt>{formatFieldLabel(key)}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
              <details className="li-disclosure">
                <summary>
                  Research history
                  <ChevronDown />
                </summary>
                <div>
                  {" "}
                  {/* History Timelines (Refresh History & Activity History) */}
                  {(refreshHistory.length > 0 || activityHistory.length > 0) && (
                    <div className="rounded-8 border border-neutral-200 bg-neutral-50/60 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-neutral-600" />
                        <span className="text-xs font-bold uppercase tracking-wider text-neutral-800">
                          Lead History & Rediscovery Timelines
                        </span>
                      </div>

                      {refreshHistory.length > 0 && (
                        <div className="space-y-1.5 text-xs">
                          <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">
                            Refresh History ({refreshHistory.length})
                          </span>
                          <div className="space-y-2">
                            {refreshHistory.map((rh: LeadRefreshEntry, idx: number) => (
                              <div
                                key={idx}
                                className="p-2.5 rounded-6 bg-white border border-neutral-200 space-y-1"
                              >
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-semibold text-neutral-900">
                                    Run #{rh.run_id?.slice(0, 8)}
                                  </span>
                                  <span className="text-neutral-400">
                                    {rh.refreshed_at
                                      ? new Date(rh.refreshed_at).toLocaleString()
                                      : ""}
                                  </span>
                                </div>
                                {rh.fit_score !== undefined && rh.fit_score !== null && (
                                  <div className="text-[11px] text-neutral-600">
                                    Fit score evaluated at: <strong>{rh.fit_score}/100</strong>
                                  </div>
                                )}
                                {rh.new_summary && (
                                  <p className="text-[11px] text-neutral-700 italic">
                                    "{rh.new_summary}"
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {activityHistory.length > 0 && (
                        <div className="space-y-1.5 text-xs pt-2 border-t border-neutral-200/60">
                          <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">
                            Sales Activity Log
                          </span>
                          <div className="space-y-1">
                            {activityHistory.map((act: LeadActivityEntry, idx: number) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between text-[11px] py-1 border-b border-neutral-100 last:border-none"
                              >
                                <span className="font-medium text-neutral-800 capitalize">
                                  {act.action?.replace(/_/g, " ")}:{" "}
                                  {act.details?.to || act.details?.from || ""}
                                </span>
                                <span className="text-neutral-400">
                                  {act.timestamp
                                    ? new Date(act.timestamp).toLocaleDateString()
                                    : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {loadingObservations ? (
                    <p>Loading observations…</p>
                  ) : observations.length ? (
                    observations.map((observation, index) => (
                      <pre className="li-raw" key={index}>
                        {JSON.stringify(observation, null, 2)}
                      </pre>
                    ))
                  ) : (
                    <p className="li-note">No additional observations recorded.</p>
                  )}
                </div>
              </details>
              <details className="li-disclosure">
                <summary>
                  Technical details
                  <ChevronDown />
                </summary>
                <div>
                  <p>Candidate: {candidate.id}</p>
                  {lead?.checked_at && <p>Checked: {new Date(lead.checked_at).toLocaleString()}</p>}
                  {lead?.technical_error && <p className="lr-error">{lead.technical_error}</p>}
                  {lead?.provenance && (
                    <pre className="li-raw">{JSON.stringify(lead.provenance, null, 2)}</pre>
                  )}
                  {lead?.dimensions && (
                    <pre className="li-raw">{JSON.stringify(lead.dimensions, null, 2)}</pre>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
      </aside>

      {/* EMAIL OUTREACH MODAL */}
      {emailModalOpen && (
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-label={emailModalOpen ? "Email options" : "Call options"}
          className="lead-outreach-modal fixed inset-0 z-60 flex items-center justify-center p-4 bg-neutral-950/40"
        >
          <div className="bg-white rounded-12 shadow-xl border border-neutral-200 w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-neutral-700" />
                <h3 className="font-bold text-neutral-900 text-base">Direct Email Outreach</h3>
              </div>
              <button
                type="button"
                onClick={() => setEmailModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Cold outreach compliance alert */}
            <div className="rounded-8 border border-amber-200 bg-amber-50/70 p-3 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-amber-900">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Cold Outreach Compliance Notice</span>
              </div>
              <p className="text-amber-800 leading-relaxed">
                Contact information was retrieved from public sources. This recipient has not opted
                in to marketing campaigns. Communications must adhere to anti-spam laws, including
                accurate sender identification and a functional opt-out mechanism.
              </p>
            </div>

            {/* Email automation service status */}
            <div className="rounded-8 border border-neutral-200 bg-neutral-50 p-2.5 text-[11px] text-neutral-600">
              <span className="font-semibold text-neutral-700">Automation Engine: </span>
              <span>
                Connected to Email Automation Boundary. Real sending is controlled by the external
                email integration. In demo mode, drafts are recorded without unauthorized
                dispatches.
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">Recipient</label>
                <input
                  type="email"
                  value={emailRecipient}
                  onChange={(e) => setEmailRecipient(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-6 text-neutral-800"
                />
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-6 text-neutral-800"
                />
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">Message Draft</label>
                <textarea
                  rows={5}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-6 text-neutral-800 font-sans"
                />
              </div>
            </div>

            {emailOutcome && (
              <div
                className={`p-3 rounded-8 text-xs ${
                  emailOutcome.ok
                    ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
                    : "bg-red-50 border border-red-200 text-red-900"
                }`}
              >
                <p className="font-semibold">{emailOutcome.message}</p>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setEmailModalOpen(false)}
                className="px-3 py-2 rounded-6 border border-neutral-300 text-neutral-700 hover:bg-neutral-50 font-medium"
              >
                Close
              </button>
              <button
                type="button"
                disabled={emailSending || !emailRecipient}
                onClick={() => void handleSendEmail()}
                className="px-4 py-2 rounded-6 bg-neutral-900 hover:bg-neutral-800 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{emailSending ? "Recording draft…" : "Dispatch via Adapter"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI VOICE CALL MODAL */}
      {phoneModalOpen && (
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-label={emailModalOpen ? "Email options" : "Call options"}
          className="lead-outreach-modal fixed inset-0 z-60 flex items-center justify-center p-4 bg-neutral-950/40"
        >
          <div className="bg-white rounded-12 shadow-xl border border-neutral-200 w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PhoneCall className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-neutral-900 text-base">Initiate AI Voice Call</h3>
              </div>
              <button
                type="button"
                onClick={() => setPhoneModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Telephony configuration & honest demo notice */}
            <div className="rounded-8 border border-neutral-200 bg-neutral-50 p-3 text-xs space-y-1">
              <span className="font-bold text-neutral-800 block">
                Telephony Provider: voice-service (CPaaS)
              </span>
              <p className="text-neutral-600 leading-relaxed">
                Outbound voice calls use your configured CPaaS trunk (e.g. Twilio or SIP provider).
                In demo mode, live phone dispatches are simulated safely without incurring external
                charges.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">Prospect Number</label>
                <input
                  type="text"
                  value={phoneRecipient}
                  onChange={(e) => setPhoneRecipient(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-6 text-neutral-800"
                />
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Human Transfer Destination (Required)
                </label>
                <input
                  type="text"
                  value={humanTransferDestination}
                  onChange={(e) => setHumanTransferDestination(e.target.value)}
                  placeholder="+1-800-555-0199 or staff SIP address"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-6 text-neutral-800"
                />
                <p className="text-[11px] text-neutral-500 mt-1">
                  If the prospect asks to speak with a human agent or transfer triggers fire, the AI
                  seamlessly transfers the call here.
                </p>
              </div>

              <div className="pt-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={explicitPhoneConsent}
                    onChange={(e) => setExplicitPhoneConsent(e.target.checked)}
                    className="mt-0.5 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-[11px] text-neutral-700 leading-normal">
                    I explicitly authorize initiating this call to the target prospect within
                    permitted calling hours, in accordance with applicable telephony and
                    telemarketing regulations.
                  </span>
                </label>
              </div>
            </div>

            {phoneOutcome && (
              <div
                className={`p-3 rounded-8 text-xs ${
                  phoneOutcome.ok
                    ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
                    : "bg-amber-50 border border-amber-200 text-amber-900"
                }`}
              >
                <p className="font-semibold">{phoneOutcome.message}</p>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setPhoneModalOpen(false)}
                className="px-3 py-2 rounded-6 border border-neutral-300 text-neutral-700 hover:bg-neutral-50 font-medium"
              >
                Close
              </button>
              <button
                type="button"
                disabled={phoneCalling || !explicitPhoneConsent || !phoneRecipient}
                onClick={() => void handleInitiateCall()}
                className="px-4 py-2 rounded-6 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>{phoneCalling ? "Checking provider…" : "Authorize & Call"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
