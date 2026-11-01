"use client";

import { Check, Copy, ExternalLink, Globe, Mail, MessageSquare, Phone, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { LeadSelect } from "@/features/lead-generation/components/lead-select";
import {
  formatFullUtcCaptured,
  formatLeadTag,
  getInitials,
  isValidEmail,
  isValidPhone,
} from "../lib/format";
import type { LeadDetail, LeadStatus } from "../lib/types";
import { LeadConversationTranscript } from "./lead-conversation-transcript";
import { QualificationIndicator } from "./qualification-indicator";

interface LeadDetailDrawerProps {
  lead: LeadDetail;
  workspaceId?: string;
  isPreview?: boolean;
  isOutsideFilter?: boolean;
  onClose: () => void;
  onUpdateStatus?: (newStatus: LeadStatus) => Promise<void> | void;
}
const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
const statusOptions: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "disqualified", label: "Disqualified" },
];

export function LeadDetailDrawer({
  lead,
  workspaceId,
  isPreview = false,
  isOutsideFilter = false,
  onClose,
  onUpdateStatus,
}: LeadDetailDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const drawer = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => closeRef.current(), []);
  useEffect(() => {
    setMounted(true);
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() =>
      drawer.current
        ?.querySelector<HTMLButtonElement>('button[aria-label="Close details"]')
        ?.focus(),
    );
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        drawer.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]',
        ) || [],
      ).filter((el) => el.getClientRects().length > 0);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        drawer.current?.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || !drawer.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !drawer.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [close]);
  useEffect(() => {
    setNotification(null);
    setCopied(null);
    drawer.current?.querySelector(".lead-library-drawer-body")?.scrollTo(0, 0);
  }, [lead.id]);
  async function changeStatus(value: LeadStatus) {
    if (updating || value === lead.status || !onUpdateStatus) return;
    setUpdating(true);
    setNotification(null);
    try {
      await onUpdateStatus(value);
      if (isPreview) setNotification("Preview change only. Not persisted.");
    } catch (error) {
      setNotification(error instanceof Error ? error.message : "Could not update status.");
    } finally {
      setUpdating(false);
    }
  }
  async function copy(value: string, field: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setNotification("Copy failed. Select the contact value and copy it manually.");
    }
  }
  const fields = Object.entries(lead.capturedFields || {});
  const fieldValue = (aliases: string[]) =>
    fields.find(
      ([key, value]) =>
        aliases.includes(normalizeKey(key)) && value !== null && String(value).trim() !== "",
    )?.[1];
  const name = lead.name || lead.email || lead.phone || "Unnamed lead";
  const rawWebsite = fieldValue(["website", "url", "domain"]);
  let website: string | null = null,
    hostname: string | null = null;
  if (rawWebsite) {
    try {
      const url = new URL(
        /^https?:\/\//i.test(String(rawWebsite)) ? String(rawWebsite) : `https://${rawWebsite}`,
      );
      if (["https:", "http:"].includes(url.protocol)) {
        website = url.href;
        hostname = url.hostname.replace(/^www\./, "");
      }
    } catch {
      /* Keep malformed source values out of clickable links. */
    }
  }
  const category =
    fieldValue(["category", "targetcategory"]) ||
    lead.tags.find((tag) => normalizeKey(tag) !== "leadgeneration");
  const rows: [string, string][] = [];
  const shownLabels = new Set<string>();
  const addRow = (label: string, value: unknown) => {
    if (
      value === undefined ||
      value === null ||
      String(value).trim() === "" ||
      shownLabels.has(normalizeKey(label))
    )
      return;
    shownLabels.add(normalizeKey(label));
    rows.push([label, String(value)]);
  };
  addRow("Company", fieldValue(["company", "companyname"]) || lead.name);
  addRow("Category", category ? formatLeadTag(String(category)) : null);
  addRow("Location", fieldValue(["location", "city"]));
  addRow("Product category", fieldValue(["productcategory"]));
  const excluded = new Set([
    "website",
    "url",
    "domain",
    "email",
    "phone",
    "name",
    "qualification",
    "qualificationscore",
    "qualificationmax",
    "fitscore",
    "score",
    "intent",
    "sentiment",
    "company",
    "companyname",
    "category",
    "targetcategory",
    "location",
    "city",
    "productcategory",
    "dataorigin",
  ]);
  for (const [key, value] of fields) {
    const label = lead.attributeLabels?.[key] || key.replace(/_/g, " ");
    if (!excluded.has(normalizeKey(key)) && !excluded.has(normalizeKey(label)))
      addRow(label, value);
  }
  if (!mounted) return null;
  return createPortal(
    <div
      className="lead-library-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <aside
        ref={drawer}
        className="lead-console lead-library-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-library-name"
        tabIndex={-1}
      >
        <header className="lead-library-drawer-header">
          <span>Lead details</span>
          <button type="button" onClick={close} aria-label="Close details">
            <X size={19} />
          </button>
        </header>
        <div className="lead-library-identity">
          <div className="lead-library-name">
            <span className="lead-library-avatar">{getInitials(name)}</span>
            <div>
              <h2 id="lead-library-name">{name}</h2>
              {hostname && (
                <a href={website!} target="_blank" rel="noopener noreferrer">
                  {hostname}
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          </div>
          <div className="lead-library-status">
            <LeadSelect
              label="Status"
              value={lead.status}
              options={statusOptions}
              disabled={updating || !onUpdateStatus}
              onChange={(value) => void changeStatus(value)}
            />
          </div>
        </div>
        <div className="lead-library-drawer-body">
          {isOutsideFilter && (
            <p className="lead-library-notice">This lead is outside the current filters.</p>
          )}
          {notification && (
            <p role="status" className="lead-library-notice">
              {notification}
            </p>
          )}
          <section className="lead-library-section">
            <h3>Contact details</h3>
            <div className="lead-library-contact-list">
              {(
                [
                  {
                    label: "Email",
                    value: lead.email,
                    icon: Mail,
                    href: lead.email && isValidEmail(lead.email) ? `mailto:${lead.email}` : null,
                  },
                  {
                    label: "Phone",
                    value: lead.phone,
                    icon: Phone,
                    href:
                      lead.phone && isValidPhone(lead.phone)
                        ? `tel:${lead.phone.replace(/[^0-9+]/g, "")}`
                        : null,
                  },
                  {
                    label: "Website",
                    value: hostname || (rawWebsite ? String(rawWebsite) : null),
                    icon: Globe,
                    href: website,
                  },
                ] as const
              ).map(({ label, value, icon: Icon, href }) => (
                <div key={label} className="lead-library-contact">
                  <Icon size={18} />
                  <div>
                    <span>{label}</span>
                    {value ? (
                      href ? (
                        <a
                          href={href}
                          target={label === "Website" ? "_blank" : undefined}
                          rel={label === "Website" ? "noopener noreferrer" : undefined}
                        >
                          {value}
                          {label === "Website" && <ExternalLink size={13} />}
                        </a>
                      ) : (
                        <p>{value}</p>
                      )
                    ) : (
                      <p className="lead-library-missing">Not available</p>
                    )}
                  </div>
                  {value && label !== "Website" && (
                    <button
                      type="button"
                      aria-label={`Copy ${label.toLowerCase()}`}
                      onClick={() => void copy(value, label)}
                    >
                      {copied === label ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
          <section className="lead-library-section">
            <div className="lead-library-section-title">
              <h3>Fit score</h3>
              <span>AI assessment</span>
            </div>
            <QualificationIndicator
              score={lead.qualificationScore}
              max={lead.qualificationMax}
              className="lead-library-fit"
            />
            {(lead.intent || lead.sentiment !== "unknown") && (
              <dl className="lead-library-facts">
                {lead.intent && (
                  <div>
                    <dt>Intent</dt>
                    <dd>{lead.intent}</dd>
                  </div>
                )}
                {lead.sentiment !== "unknown" && (
                  <div>
                    <dt>Sentiment</dt>
                    <dd>{lead.sentiment}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>
          <section className="lead-library-section">
            <h3>Business details</h3>
            {rows.length ? (
              <dl className="lead-library-facts">
                {rows.map(([label, value]) => (
                  <div key={normalizeKey(label)}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="lead-library-missing">No business details captured.</p>
            )}
            {lead.tags.length > 0 && (
              <div className="lead-library-tags" aria-label="Tags">
                {lead.tags.map((tag) => (
                  <span key={tag}>{formatLeadTag(tag)}</span>
                ))}
              </div>
            )}
          </section>
          {lead.originatingConversationId ? (
            <section className="lead-library-section">
              <h3>Conversation</h3>
              <LeadConversationTranscript
                conversationId={lead.originatingConversationId}
                workspaceId={workspaceId}
                status={lead.transcriptStatus}
                messages={lead.transcriptMessages}
              />
            </section>
          ) : (
            <p className="lead-library-empty-conversation">
              <MessageSquare size={16} />
              No linked conversation
            </p>
          )}
          <details className="lead-library-record">
            <summary>Record information</summary>
            <dl className="lead-library-facts">
              <div>
                <dt>Captured</dt>
                <dd>{formatFullUtcCaptured(lead.capturedAt)}</dd>
              </div>
              <div>
                <dt>Lead ID</dt>
                <dd>{lead.id}</dd>
              </div>
              {lead.source && (
                <div>
                  <dt>Source</dt>
                  <dd>{lead.source}</dd>
                </div>
              )}
              {fieldValue(["dataorigin"]) && (
                <div>
                  <dt>Data origin</dt>
                  <dd>{String(fieldValue(["dataorigin"]))}</dd>
                </div>
              )}
              {lead.version !== undefined && (
                <div>
                  <dt>Version</dt>
                  <dd>{lead.version}</dd>
                </div>
              )}
            </dl>
          </details>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
