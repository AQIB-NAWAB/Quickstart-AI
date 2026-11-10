"use client";

import { ChevronRight, Mail, Phone } from "lucide-react";
import {
  formatCapturedDateTime,
  formatLeadTag,
  getInitials,
  isValidEmail,
  isValidPhone,
} from "../lib/format";
import type { LeadSummary } from "../lib/types";
import { LeadStatusBadge } from "./lead-status-badge";
import { QualificationIndicator } from "./qualification-indicator";
import { SentimentLabel } from "./sentiment-label";
import type { VisibleColumns } from "./lead-filters";

interface LeadTableProps {
  leads: LeadSummary[];
  selectedLeadId: string | null;
  visibleColumns?: VisibleColumns;
  isSampleData?: boolean;
  onSelectLead: (leadId: string) => void;
}

const DEFAULT_VISIBLE_COLUMNS: VisibleColumns = {
  contact: true,
  intent: false,
  qualification: true,
  sentiment: false,
  status: true,
  tags: true,
  captured: true,
};

export function LeadTable({
  leads,
  selectedLeadId,
  visibleColumns = DEFAULT_VISIBLE_COLUMNS,
  onSelectLead,
}: LeadTableProps) {
  return (
    <div className="lead-data-table bg-white border border-neutral-200 rounded-8 overflow-hidden shadow-xs">
      <div className="leads-table-container">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50/80 text-neutral-600 font-semibold">
              <th className="leads-business-heading">Business / contact</th>
              {visibleColumns.intent && <th>Intent</th>}
              {visibleColumns.qualification && <th className="leads-fit-heading">Fit score</th>}
              {visibleColumns.sentiment && <th>Sentiment</th>}
              {visibleColumns.status && <th className="leads-status-heading">Status</th>}
              {visibleColumns.tags && <th className="leads-tags-heading">Tags</th>}
              {visibleColumns.captured && <th className="leads-added-heading">Added</th>}
              <th className="leads-action-heading">
                <span className="sr-only">Open details</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 text-neutral-700">
            {leads.length === 0 ? (
              <tr className="leads-empty-row">
                <td
                  colSpan={
                    2 +
                    Object.entries(visibleColumns).filter(
                      ([key, visible]) => key !== "contact" && visible,
                    ).length
                  }
                  className="py-12 text-center text-neutral-400 italic"
                >
                  No leads match these filters.
                </td>
              </tr>
            ) : (
              leads.map((lead) => {
                const isSelected = lead.id === selectedLeadId;
                const displayName = lead.name || lead.email || lead.phone || "Unnamed lead";
                const initials = getInitials(displayName);
                const hasContact = Boolean(lead.email || lead.phone);
                const captured = formatCapturedDateTime(lead.capturedAt);
                const shownTags = [...lead.tags].sort(
                  (a, b) =>
                    Number(a.toLowerCase().replace(/[_-]/g, " ") === "lead generation") -
                    Number(b.toLowerCase().replace(/[_-]/g, " ") === "lead generation"),
                );

                return (
                  <tr
                    key={lead.id}
                    onClick={() => onSelectLead(lead.id)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectLead(lead.id);
                      }
                    }}
                    data-selected={isSelected}
                    aria-pressed={isSelected}
                    className={`transition-colors cursor-pointer select-none outline-none ${
                      isSelected ? "bg-orange-50/70 hover:bg-orange-50" : "hover:bg-neutral-50/80"
                    }`}
                  >
                    {/* 1. Contact (widest column, initials tile + name + email/phone) */}
                    <td className="py-3.5 px-4 leads-contact-cell">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-6 bg-neutral-100 text-neutral-700 font-semibold text-xs flex items-center justify-center shrink-0 border border-neutral-200/60 uppercase">
                          {initials}
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-semibold text-neutral-900 leading-tight truncate">
                            {displayName}
                          </p>
                          {lead.email && (
                            <p className="text-[12px] text-neutral-500 leads-contact-line">
                              <Mail size={14} />
                              {isValidEmail(lead.email) ? (
                                <a
                                  href={`mailto:${lead.email}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="hover:text-heat-100 hover:underline"
                                >
                                  {lead.email}
                                </a>
                              ) : (
                                lead.email
                              )}
                            </p>
                          )}
                          {lead.phone && (
                            <p className="text-[12px] text-neutral-500 leads-contact-line">
                              <Phone size={14} />
                              {isValidPhone(lead.phone) ? (
                                <a
                                  href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="hover:text-heat-100 hover:underline"
                                >
                                  {lead.phone}
                                </a>
                              ) : (
                                lead.phone
                              )}
                            </p>
                          )}
                          {!hasContact && (
                            <p className="text-[12px] text-neutral-400">No contact details</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Optional: Intent */}
                    {visibleColumns.intent && (
                      <td data-label="Intent" className="py-3.5 px-4 text-neutral-800 font-medium">
                        {lead.intent || "—"}
                      </td>
                    )}

                    {/* 2. Qualification */}
                    {visibleColumns.qualification && (
                      <td data-label="Fit score" className="py-3.5 px-4">
                        <QualificationIndicator
                          score={lead.qualificationScore}
                          max={lead.qualificationMax}
                          isCompact={true}
                        />
                      </td>
                    )}

                    {/* Optional: Sentiment */}
                    {visibleColumns.sentiment && (
                      <td data-label="Sentiment" className="py-3.5 px-4">
                        <SentimentLabel sentiment={lead.sentiment} />
                      </td>
                    )}

                    {/* 3. Status */}
                    {visibleColumns.status && (
                      <td data-label="Status" className="py-3.5 px-4 whitespace-nowrap">
                        <LeadStatusBadge status={lead.status} />
                      </td>
                    )}

                    {/* 4. Tags */}
                    {visibleColumns.tags && (
                      <td data-label="Tags" className="py-3.5 px-4">
                        {lead.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 items-center">
                            {shownTags.slice(0, 1).map((t) => (
                              <span
                                key={t}
                                className="px-2 py-0.5 rounded-6 text-xs bg-neutral-100 text-neutral-700 border border-neutral-200/60 font-medium"
                              >
                                {formatLeadTag(t)}
                              </span>
                            ))}
                            {shownTags.length > 1 && (
                              <span
                                className="text-xs text-neutral-500 font-medium"
                                title={shownTags.slice(1).join(", ")}
                              >
                                +{shownTags.length - 1}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                    )}

                    {/* 5. Captured (date above time) */}
                    {visibleColumns.captured && (
                      <td
                        data-label="Added"
                        className="py-3.5 px-4 text-neutral-600 font-sans text-xs whitespace-nowrap"
                      >
                        {captured ? (
                          <div className="space-y-0.5 leading-tight">
                            <p className="text-neutral-700 font-medium">{captured.date}</p>
                            <p className="text-[11px] text-neutral-400">{captured.time}</p>
                          </div>
                        ) : (
                          <span className="text-neutral-400">Not recorded</span>
                        )}
                      </td>
                    )}

                    {/* Details Chevron */}
                    <td className="py-3.5 px-3 text-right">
                      <ChevronRight className="w-4 h-4 text-neutral-400 inline-block" />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
