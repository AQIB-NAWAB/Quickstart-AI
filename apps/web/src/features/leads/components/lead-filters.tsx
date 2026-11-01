"use client";

import { Columns3, Search, X } from "lucide-react";
import { LeadSelect } from "@/features/lead-generation/components/lead-select";
import { formatLeadTag } from "../lib/format";
import { useEffect, useRef, useState } from "react";

export type VisibleColumns = {
  contact: boolean;
  intent: boolean;
  qualification: boolean;
  sentiment: boolean;
  status: boolean;
  tags: boolean;
  captured: boolean;
};

interface LeadFiltersProps {
  search: string;
  status: string;
  tag: string;
  availableTags: string[];
  statusCounts: {
    all: number;
    new: number;
    qualified: number;
    contacted: number;
    disqualified: number;
  };
  visibleColumns: VisibleColumns;
  onToggleColumn: (key: keyof VisibleColumns) => void;
  onSearchChange: (val: string) => void;
  onStatusChange: (val: string) => void;
  onTagChange: (val: string) => void;
  onClearFilters: () => void;
}

const STATUS_TABS = [
  { id: "all", label: "All leads" },
  { id: "new", label: "New" },
  { id: "qualified", label: "Qualified" },
  { id: "contacted", label: "Contacted" },
  { id: "disqualified", label: "Disqualified" },
] as const;

export function LeadFilters({
  search,
  status,
  tag,
  availableTags,
  statusCounts,
  visibleColumns,
  onToggleColumn,
  onSearchChange,
  onStatusChange,
  onTagChange,
  onClearFilters,
}: LeadFiltersProps) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close columns popover on outside click and Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setColumnsOpen(false);
    }
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setColumnsOpen(false);
      }
    }
    if (columnsOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [columnsOpen]);

  const hasActiveFilters = search.trim() !== "" || tag !== "all" || status !== "all";

  return (
    <div className="space-y-4">
      {/* 1. Status Strip */}
      <div className="leads-status-tabs" aria-label="Lead status">
        {STATUS_TABS.map((tab) => {
          const isActive = status === tab.id;
          const count = statusCounts[tab.id as keyof typeof statusCounts] ?? 0;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onStatusChange(tab.id)}
              aria-pressed={isActive}
              className={`pb-3 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors border-b-2 font-medium ${
                isActive
                  ? "border-heat-100 text-heat-100 font-semibold -mb-[1px]"
                  : "border-transparent text-neutral-600 hover:text-neutral-900"
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`tabular-nums text-[11px] ${
                  isActive ? "text-heat-100 font-bold" : "text-neutral-400 font-normal"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 2. Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          {/* Search Input: ~360–420px wide on desktop */}
          <div className="relative w-full sm:max-w-[380px]">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label="Search name, email or phone"
              placeholder="Search name, email or phone…"
              className="w-full h-11 pl-10 pr-3 border border-neutral-300 rounded-8 bg-white focus:outline-none focus:border-heat-100 focus:ring-1 focus:ring-heat-100 text-neutral-800 placeholder:text-neutral-400 transition-colors"
            />
          </div>

          {/* Tags Dropdown selector */}
          <div className="flex items-center">
            <LeadSelect
              label="Tags"
              value={tag}
              onChange={onTagChange}
              options={[
                { value: "all", label: "All tags" },
                ...availableTags.map((value) => ({ value, label: formatLeadTag(value) })),
              ]}
            />
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="h-11 inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900 px-3 py-1 rounded-8 hover:bg-neutral-100 transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear filters</span>
            </button>
          )}
        </div>

        {/* 3. Columns Popover Trigger (Aligned Right) */}
        <div className="relative shrink-0" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setColumnsOpen((prev) => !prev)}
            aria-expanded={columnsOpen}
            aria-label="Toggle visible columns"
            className="h-11 inline-flex items-center gap-1.5 px-3.5 rounded-8 border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-700 font-medium shadow-xs transition-colors"
          >
            <Columns3 className="w-4 h-4 text-neutral-500" />
            <span>Columns</span>
          </button>

          {/* Columns Popover Menu */}
          {columnsOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-neutral-200 rounded-8 shadow-lg p-3 z-30 space-y-2 animate-in fade-in zoom-in-95 duration-100">
              <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider pb-1 border-b border-neutral-100">
                Visible Columns
              </p>

              <div className="space-y-1.5 text-xs">
                <label className="flex items-center gap-2 text-neutral-700 cursor-not-allowed opacity-75">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled={true}
                    className="rounded text-heat-100 focus:ring-heat-100"
                  />
                  <span>Contact (always visible)</span>
                </label>

                <label className="flex items-center gap-2 text-neutral-700 cursor-pointer hover:text-neutral-900">
                  <input
                    type="checkbox"
                    checked={visibleColumns.qualification}
                    onChange={() => onToggleColumn("qualification")}
                    className="rounded text-heat-100 focus:ring-heat-100 cursor-pointer"
                  />
                  <span>Fit score</span>
                </label>

                <label className="flex items-center gap-2 text-neutral-700 cursor-pointer hover:text-neutral-900">
                  <input
                    type="checkbox"
                    checked={visibleColumns.status}
                    onChange={() => onToggleColumn("status")}
                    className="rounded text-heat-100 focus:ring-heat-100 cursor-pointer"
                  />
                  <span>Status</span>
                </label>

                <label className="flex items-center gap-2 text-neutral-700 cursor-pointer hover:text-neutral-900">
                  <input
                    type="checkbox"
                    checked={visibleColumns.tags}
                    onChange={() => onToggleColumn("tags")}
                    className="rounded text-heat-100 focus:ring-heat-100 cursor-pointer"
                  />
                  <span>Tags</span>
                </label>

                <label className="flex items-center gap-2 text-neutral-700 cursor-pointer hover:text-neutral-900">
                  <input
                    type="checkbox"
                    checked={visibleColumns.captured}
                    onChange={() => onToggleColumn("captured")}
                    className="rounded text-heat-100 focus:ring-heat-100 cursor-pointer"
                  />
                  <span>Added</span>
                </label>

                <div className="pt-1 border-t border-neutral-100" />

                <label className="flex items-center gap-2 text-neutral-700 cursor-pointer hover:text-neutral-900">
                  <input
                    type="checkbox"
                    checked={visibleColumns.intent}
                    onChange={() => onToggleColumn("intent")}
                    className="rounded text-heat-100 focus:ring-heat-100 cursor-pointer"
                  />
                  <span>Intent (optional)</span>
                </label>

                <label className="flex items-center gap-2 text-neutral-700 cursor-pointer hover:text-neutral-900">
                  <input
                    type="checkbox"
                    checked={visibleColumns.sentiment}
                    onChange={() => onToggleColumn("sentiment")}
                    className="rounded text-heat-100 focus:ring-heat-100 cursor-pointer"
                  />
                  <span>Sentiment (optional)</span>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
