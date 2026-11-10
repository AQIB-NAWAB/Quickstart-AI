"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  InboundSetupInfo,
  SipInboundMode,
  SipSetupCheckStatus,
  VoiceRepository,
} from "../lib/types";
import { CopyButton } from "./sip-connection-details";

interface InboundReadinessPanelProps {
  workspaceId: string;
  repository: VoiceRepository;
  /** Called whenever the setup report loads, so the parent can adapt its header. */
  onLoaded?: (setup: InboundSetupInfo | null) => void;
}

const MODE_LABEL: Record<SipInboundMode, string> = {
  livekit_cloud: "LiveKit Cloud",
  self_hosted: "Self-hosted SIP",
  not_configured: "Not configured",
};

const MODE_TONE: Record<SipInboundMode, string> = {
  livekit_cloud: "bg-sky-50 text-sky-700 border-sky-200",
  self_hosted: "bg-violet-50 text-violet-700 border-violet-200",
  not_configured: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

function CheckIcon({ status }: { status: SipSetupCheckStatus }) {
  if (status === "ok") {
    return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />;
  }
  if (status === "error") {
    return <XCircle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />;
  }
  return <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />;
}

const STATUS_TEXT: Record<SipSetupCheckStatus, string> = {
  ok: "OK",
  warn: "Warning",
  error: "Error",
};

function WebhookRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-8 bg-neutral-50 border border-neutral-200 px-2.5 py-1.5">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold text-neutral-500">{label}</div>
        <div className="text-[11px] font-mono text-accent-black break-all">{url || "—"}</div>
      </div>
      {url ? <CopyButton value={url} label={`${label} webhook URL`} /> : null}
    </div>
  );
}

export function InboundReadinessPanel({
  workspaceId,
  repository,
  onLoaded,
}: InboundReadinessPanelProps) {
  const [setup, setSetup] = useState<InboundSetupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await repository.getInboundSetup(workspaceId);
    if (response.status === "ready") {
      setSetup(response.data);
      setFailed(false);
      onLoaded?.(response.data);
    } else {
      setSetup(null);
      setFailed(true);
      onLoaded?.(null);
    }
    setLoading(false);
    // onLoaded is intentionally excluded so a new callback identity does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const issues = setup?.checks.filter((check) => check.status !== "ok").length ?? 0;

  return (
    <section
      aria-label="Inbound readiness"
      className="bg-white border border-border-faint rounded-12 shadow-xs"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="flex items-center gap-2 min-w-0 text-left"
        >
          {open ? (
            <ChevronDown className="w-4 h-4 text-neutral-400 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
          )}
          <span className="text-xs font-bold text-accent-black">Inbound readiness</span>
          {loading && !setup ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400" />
          ) : setup ? (
            <>
              <span
                className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${MODE_TONE[setup.mode]}`}
              >
                {MODE_LABEL[setup.mode]}
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
                  setup.ready
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}
              >
                {setup.ready ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  <AlertCircle className="w-3 h-3" />
                )}
                {setup.ready ? "Ready" : "Needs attention"}
              </span>
              {!open && issues > 0 && (
                <span className="text-[11px] text-neutral-500 hidden sm:inline">
                  {issues} check{issues === 1 ? "" : "s"} to review
                </span>
              )}
            </>
          ) : failed ? (
            <span className="text-[11px] text-red-700">Could not load readiness</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh readiness"
          title="Refresh readiness"
          className="p-1 rounded-6 text-neutral-400 hover:text-accent-black hover:bg-neutral-100 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="border-t border-border-faint px-4 py-3 space-y-4">
          {failed && !setup ? (
            <div className="rounded-8 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              Could not load readiness. The voice service may be unavailable — try refreshing.
            </div>
          ) : setup ? (
            <>
              <ul className="space-y-2">
                {setup.checks.length === 0 && (
                  <li className="text-xs text-neutral-500">No checks reported.</li>
                )}
                {setup.checks.map((check) => (
                  <li key={check.id} className="flex items-start gap-2.5 text-xs">
                    <CheckIcon status={check.status} />
                    <div className="min-w-0">
                      <div className="font-semibold text-accent-black">
                        {check.label}
                        <span className="sr-only"> — {STATUS_TEXT[check.status]}</span>
                      </div>
                      {check.detail && <div className="text-[11px] text-neutral-500">{check.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
              {(setup.webhooks.livekit || setup.webhooks.telnyx) && (
                <div className="space-y-1.5">
                  <h4 className="text-[11px] font-semibold text-neutral-600">Webhook URLs</h4>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    <WebhookRow label="LiveKit" url={setup.webhooks.livekit} />
                    {setup.purchase_available && <WebhookRow label="Telnyx" url={setup.webhooks.telnyx} />}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="h-10 bg-neutral-50 rounded-8 animate-pulse" />
          )}
        </div>
      )}
    </section>
  );
}
