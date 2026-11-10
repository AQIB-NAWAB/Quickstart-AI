"use client";

import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Server,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SipConnectionInfo } from "../lib/types";

interface CopyButtonProps {
  value: string;
  label: string;
  className?: string;
}

export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(area);
      }
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      className={
        className ??
        "p-1 rounded-6 text-neutral-400 hover:text-accent-black hover:bg-neutral-100 transition-colors shrink-0"
      }
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-600" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  copyValue?: string | null;
  mono?: boolean;
}

function DetailRow({ label, value, copyValue, mono = true }: DetailRowProps) {
  const toCopy = copyValue === undefined ? value : copyValue;
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-neutral-500">{label}</div>
        <div
          className={`text-xs text-accent-black mt-0.5 break-all ${mono ? "font-mono" : ""}`}
        >
          {value}
        </div>
      </div>
      {toCopy ? <CopyButton value={toCopy} label={label} /> : null}
    </div>
  );
}

function transportSummary(connection: SipConnectionInfo): string {
  const parts: string[] = [];
  for (const transport of connection.transports) {
    if (transport === "tls") {
      if (connection.tls_port) parts.push(`TLS ${connection.tls_port}`);
    } else {
      parts.push(`${transport.toUpperCase()} ${connection.port}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : String(connection.port);
}

export function buildSipConfigText(connection: SipConnectionInfo, phoneNumber: string): string {
  const lines = [
    `QuickStart AI — SIP trunk configuration for ${phoneNumber}`,
    "",
    `SIP host: ${connection.host ?? "(not configured)"}`,
    `Ports / transports: ${transportSummary(connection)}`,
    `SIP URI: ${connection.sip_uri}`,
    `Accepted number formats: ${connection.accepted_number_formats.join(", ") || "-"}`,
    `Allowed source IPs: ${connection.allowed_addresses.join(", ") || "(none)"}`,
    `Username: ${connection.auth_username ?? "(none)"}`,
  ];
  if (connection.auth_password) lines.push(`Password: ${connection.auth_password}`);
  lines.push(
    `Codecs: ${connection.codecs.join(", ") || "-"}`,
    `DTMF: ${connection.dtmf}`,
    `RTP port range: ${connection.rtp_port_range ?? "-"}`,
    `Allow traffic from/to server IPs: ${connection.server_ips.join(", ") || "-"}`,
    "",
  );
  return lines.join("\n");
}

interface SipConnectionDetailsProps {
  connection: SipConnectionInfo;
  phoneNumber: string;
}

export function SipConnectionDetails({ connection, phoneNumber }: SipConnectionDetailsProps) {
  const [revealed, setRevealed] = useState(false);
  const password = connection.auth_password;
  const hasCredentials = Boolean(connection.auth_username);

  function handleDownload() {
    const blob = new Blob([buildSipConfigText(connection, phoneNumber)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sip-trunk-${phoneNumber.replace(/\D/g, "") || "number"}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {password && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-10 border border-amber-300 bg-amber-50 px-3.5 py-3 text-xs text-amber-900"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Copy the password now — it will not be shown again.</p>
            <p className="mt-0.5 text-amber-800">
              We only store a hash. If you lose it, rotate the credentials to get a new one.
            </p>
          </div>
        </div>
      )}

      <div className="bg-white border border-border-faint rounded-12 shadow-xs">
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-accent-black">
            <Server className="w-3.5 h-3.5 text-neutral-400" />
            Point your SIP trunk here
          </div>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-6 text-[11px] font-semibold text-neutral-600 hover:text-accent-black bg-neutral-100 hover:bg-neutral-200 transition-colors"
          >
            <Download className="w-3 h-3" />
            Download as text
          </button>
        </div>
        <div className="px-4 pb-2 divide-y divide-border-faint">
          <DetailRow label="SIP host" value={connection.host ?? "Not configured"} copyValue={connection.host} />
          <DetailRow label="Ports / transports" value={transportSummary(connection)} copyValue={null} />
          <DetailRow label="SIP URI" value={connection.sip_uri} />
          <DetailRow
            label="Accepted number formats"
            value={connection.accepted_number_formats.join(", ") || phoneNumber}
            copyValue={connection.accepted_number_formats[0] ?? phoneNumber}
          />
          <DetailRow
            label="Allowed source IPs"
            value={connection.allowed_addresses.join(", ") || "None (credentials only)"}
            copyValue={
              connection.allowed_addresses.length > 0 ? connection.allowed_addresses.join(", ") : null
            }
          />
          {hasCredentials && (
            <>
              <DetailRow label="Username" value={connection.auth_username ?? ""} />
              <div className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-neutral-500 flex items-center gap-1">
                    <KeyRound className="w-3 h-3" />
                    Password
                  </div>
                  <div className="text-xs text-accent-black mt-0.5 font-mono break-all">
                    {password
                      ? revealed
                        ? password
                        : "•".repeat(Math.min(password.length, 24))
                      : "Hidden — rotate credentials to generate a new one"}
                  </div>
                </div>
                {password && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setRevealed((prev) => !prev)}
                      aria-label={revealed ? "Hide password" : "Show password"}
                      aria-pressed={revealed}
                      className="p-1 rounded-6 text-neutral-400 hover:text-accent-black hover:bg-neutral-100 transition-colors"
                    >
                      {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <CopyButton value={password} label="password" />
                  </div>
                )}
              </div>
            </>
          )}
          <DetailRow
            label="Codecs"
            value={connection.codecs.join(", ") || "—"}
            copyValue={null}
          />
          <DetailRow label="DTMF" value={connection.dtmf.toUpperCase() === "RFC2833" ? "RFC 2833 (telephone-event)" : connection.dtmf} copyValue={null} />
          <DetailRow label="RTP port range" value={connection.rtp_port_range ?? "—"} copyValue={connection.rtp_port_range} />
          <DetailRow
            label="Server IPs to allow on your firewall / carrier ACL"
            value={connection.server_ips.join(", ") || "—"}
            copyValue={connection.server_ips.length > 0 ? connection.server_ips.join(", ") : null}
          />
        </div>
      </div>

      <div className="rounded-12 border border-border-faint bg-neutral-50/70 px-4 py-3">
        <h4 className="text-xs font-bold text-accent-black">On your PBX / carrier</h4>
        <ol className="mt-2 list-decimal pl-4 space-y-1 text-[11px] text-neutral-600 leading-relaxed">
          <li>
            Create an outbound SIP trunk (or origination URI) to{" "}
            <span className="font-mono">{connection.host ?? "the SIP host above"}</span> using{" "}
            {transportSummary(connection)}.
          </li>
          <li>
            Route calls for <span className="font-mono">{phoneNumber}</span> to that trunk, using one of
            the accepted number formats in the To / Request-URI.
          </li>
          {connection.allowed_addresses.length > 0 && (
            <li>Send from one of the allowed source IPs above; other addresses are rejected.</li>
          )}
          {hasCredentials && (
            <li>Enable SIP digest authentication with the username and password above.</li>
          )}
          <li>
            Allow RTP ({connection.rtp_port_range ?? "UDP"}) to and from the server IPs, offer{" "}
            {connection.codecs.join("/") || "G.711"}, and send DTMF as RFC 2833.
          </li>
          <li>Place a test call to {phoneNumber} and check the call log.</li>
        </ol>
      </div>
    </div>
  );
}
