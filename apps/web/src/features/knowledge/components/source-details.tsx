"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  X,
  Trash2,
  AlertTriangle,
  RotateCcw,
  Clock,
  FileText,
  Globe,
  ExternalLink,
} from "lucide-react";
import type { KnowledgeSource } from "../lib/types";
import { getSource } from "../lib/client";
import { SourceStatusBadge } from "./source-status-badge";
import { SourceTypeLabel, SourceTypeIconTile } from "./source-type-label";
import { useSourceStatus } from "../hooks/use-source-status";
import { formatBytes } from "../lib/format";

interface SourceDetailsProps {
  workspaceId: string;
  sourceId: string | null;
  open?: boolean;
  onClose?: () => void;
  onDeleteRequest?: (source: KnowledgeSource) => void;
  onSourceUpdated?: (updated: KnowledgeSource) => void;
  isPreview?: boolean;
}

export function SourceDetails({
  workspaceId,
  sourceId,
  open = true,
  onClose = () => {},
  onDeleteRequest = () => {},
  onSourceUpdated,
}: SourceDetailsProps) {
  const [source, setSource] = useState<KnowledgeSource | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const drawerRef = useRef<HTMLDivElement>(null);

  const loadSource = useCallback(async () => {
    if (!sourceId) return;
    setIsLoading(true);
    setError(null);
    const res = await getSource(workspaceId, sourceId);
    setIsLoading(false);

    if (res.source) {
      setSource(res.source);
      if (onSourceUpdated) onSourceUpdated(res.source);
    } else {
      setError(res.error?.message || "Failed to load knowledge source");
    }
  }, [workspaceId, sourceId, onSourceUpdated]);

  useEffect(() => {
    if (open && sourceId) {
      void loadSource();
    } else if (!open) {
      setSource(null);
    }
  }, [open, sourceId, loadSource]);

  // Live polling for queued/processing status
  const { source: liveSource, refreshError } = useSourceStatus({
    workspaceId,
    initialSource: source,
    onUpdate: (updated) => {
      setSource(updated);
      if (onSourceUpdated) onSourceUpdated(updated);
    },
    enabled: Boolean(
      open && source && (source.status === "queued" || source.status === "processing"),
    ),
  });

  const displaySource = liveSource || source;

  // Handle ESC key to close drawer
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Body scroll lock while drawer is open
  useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  if (!open) return null;

  const charCount = displaySource?.char_count ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={displaySource ? `Details for ${displaySource.name}` : "Source details"}
      className="fixed inset-0 z-50 overflow-hidden"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-accent-black/30 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Surface */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-6 sm:pl-10">
        <div
          ref={drawerRef}
          className="w-screen max-w-[560px] bg-white border-l border-border-faint shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200"
        >
          <div className="flex flex-col h-full">
            {/* Drawer Top Header */}
            <div className="px-5 py-4 border-b border-border-faint flex items-center justify-between shrink-0 bg-neutral-50/70">
              <div className="flex items-center gap-3 min-w-0">
                {displaySource && <SourceTypeIconTile kind={displaySource.kind} size="md" />}
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-accent-black truncate tracking-tight">
                    {isLoading ? "Loading source..." : displaySource?.name || "Source details"}
                  </h2>
                  {displaySource && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <SourceTypeLabel kind={displaySource.kind} showIcon={false} />
                      <span className="text-neutral-300">•</span>
                      <SourceStatusBadge status={displaySource.status} />
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close drawer"
                className="p-1.5 rounded-8 text-neutral-400 hover:text-accent-black hover:bg-neutral-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Body Scrollable */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {isLoading ? (
                <div className="space-y-5 animate-pulse">
                  <div className="grid grid-cols-3 gap-2.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-20 rounded-12 bg-neutral-100" />
                    ))}
                  </div>
                  <div className="h-44 rounded-12 bg-neutral-100" />
                  <div className="h-32 rounded-12 bg-neutral-100" />
                </div>
              ) : error ? (
                <div className="p-8 bg-red-50 border border-red-200 rounded-12 text-center space-y-3">
                  <p className="text-xs font-semibold text-accent-crimson">{error}</p>
                  <button
                    type="button"
                    onClick={() => void loadSource()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-8 bg-white border border-border-faint text-xs font-semibold text-accent-black hover:bg-neutral-50 transition-colors shadow-sm"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                </div>
              ) : displaySource ? (
                <div className="space-y-6">
                  {/* Status Alerts if applicable */}
                  {displaySource.status === "failed" ? (
                    <div
                      role="alert"
                      className="p-4 rounded-12 bg-red-50 border border-red-200 flex items-start gap-3 text-xs text-accent-crimson"
                    >
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <div className="space-y-1">
                        <p className="font-semibold">Ingestion failed</p>
                        <p className="text-[11px] text-red-700 leading-relaxed">
                          {displaySource.error_message ||
                            "Ingestion failed. No additional reason was reported."}
                        </p>
                      </div>
                    </div>
                  ) : displaySource.status === "queued" || displaySource.status === "processing" ? (
                    <div
                      role="status"
                      className="p-4 rounded-12 bg-amber-50/70 border border-amber-200 flex items-start gap-3 text-xs text-amber-900"
                    >
                      <Clock
                        className="w-4 h-4 text-amber-600 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <div className="space-y-1">
                        <p className="font-semibold">
                          This source is being prepared for retrieval.
                        </p>
                        <p className="text-[11px] text-amber-700 leading-relaxed">
                          Background worker is extracting, chunking, and embedding content. Status
                          refreshes automatically.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {refreshError && (
                    <p className="text-[11px] text-neutral-400 italic">
                      Notice: {refreshError} (will retry automatically)
                    </p>
                  )}

                  {/* Overview 2x2 / 4-Col Grid */}
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-semibold text-accent-black tracking-wide uppercase">
                      At a glance
                    </h3>
                    <div className="grid grid-cols-3 gap-2.5">
                      <div className="p-3.5 rounded-10 bg-neutral-50 border border-border-faint space-y-1">
                        <span className="text-[11px] text-neutral-500 font-medium">
                          Extracted text
                        </span>
                        <p className="text-xs font-semibold text-accent-black font-mono">
                          {charCount.toLocaleString()} chars
                        </p>
                      </div>

                      <div className="p-3.5 rounded-10 bg-neutral-50 border border-border-faint space-y-1">
                        <span className="text-[11px] text-neutral-500 font-medium">
                          Indexed chunks
                        </span>
                        <p className="text-xs font-semibold text-accent-black font-mono">
                          {displaySource.chunk_count.toLocaleString()}
                        </p>
                      </div>

                      <div className="p-3.5 rounded-10 bg-neutral-50 border border-border-faint space-y-1">
                        <span className="text-[11px] text-neutral-500 font-medium">Version</span>
                        <p className="text-xs font-semibold text-accent-black font-mono">
                          v{displaySource.version}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Essential source metadata */}
                  <div className="rounded-12 border border-border-faint bg-white divide-y divide-border-faint text-xs">
                    {displaySource.file_name && (
                      <div className="px-4 py-3 flex items-center justify-between gap-3">
                        <span className="text-neutral-500 font-medium flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5 text-neutral-400" />
                          Original file
                        </span>
                        <span className="font-semibold text-accent-black truncate max-w-[280px]">
                          {displaySource.file_name}{" "}
                          {displaySource.file_size_bytes
                            ? `(${formatBytes(displaySource.file_size_bytes)})`
                            : ""}
                        </span>
                      </div>
                    )}

                    {displaySource.source_url && (
                      <div className="px-4 py-3 flex items-center justify-between gap-3">
                        <span className="text-neutral-500 font-medium flex items-center gap-2">
                          <Globe className="w-3.5 h-3.5 text-neutral-400" />
                          Source URL
                        </span>
                        <a
                          href={displaySource.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-heat-100 hover:underline inline-flex items-center gap-1 truncate max-w-[280px]"
                        >
                          <span className="truncate">{displaySource.source_url}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </div>
                    )}

                    {!displaySource.file_name && !displaySource.source_url && (
                      <div className="px-4 py-3 text-neutral-500">Workspace knowledge source</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Drawer Sticky Footer */}
            <div className="px-5 py-3 border-t border-border-faint bg-neutral-50/70 flex items-center justify-between shrink-0">
              {displaySource ? (
                <button
                  type="button"
                  onClick={() => onDeleteRequest(displaySource)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-10 border border-red-200 text-accent-crimson bg-white hover:bg-red-50 text-xs font-semibold transition-colors shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete source</span>
                </button>
              ) : (
                <div />
              )}

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-10 border border-border-faint bg-white text-xs font-semibold text-accent-black hover:bg-neutral-50 transition-colors shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
