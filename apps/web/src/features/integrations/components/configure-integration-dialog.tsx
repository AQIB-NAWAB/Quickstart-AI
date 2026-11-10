"use client";

import { CheckCircle2, ExternalLink, KeyRound, LogOut, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { IntegrationCatalogItem } from "../lib/types";

interface ConfigureIntegrationDialogProps {
  open: boolean;
  integration: IntegrationCatalogItem | null;
  onClose: () => void;
  onSaveCredentials: (credentials: Record<string, string>) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function ConfigureIntegrationDialog({
  open,
  integration,
  onClose,
  onSaveCredentials,
  onDisconnect,
}: ConfigureIntegrationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        onClose();
      }
    }
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
      setError(null);
      setAccountSid("");
      setAuthToken("");
      setApiToken("");
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [open, onClose]);

  if (!open || !integration) return null;

  const isConnected = integration.status === "connected";
  const isTwilio = integration.id === "twilio";
  const isApify = integration.id === "apify";

  async function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (isTwilio && (!accountSid.trim() || !authToken.trim())) {
      setError("Please provide both Account SID and Auth Token.");
      return;
    }
    if (isApify && !apiToken.trim()) {
      setError("Please provide your Apify API Token.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isApify) {
        await onSaveCredentials({ apiToken: apiToken.trim() });
      } else {
        await onSaveCredentials({ accountSid, authToken });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save credentials");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnectClick() {
    setDisconnecting(true);
    try {
      await onDisconnect();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-modal-title"
        className="relative w-full max-w-[480px] bg-white rounded-16 p-6 shadow-xl border border-[#EAECF0] animate-in fade-in zoom-in-95 duration-150 space-y-5"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#EAECF0] pb-4">
          <div className="space-y-0.5">
            <h2 id="config-modal-title" className="text-lg font-bold text-[#18181B]">
              {isConnected ? `Configure ${integration.name}` : `Connect ${integration.name}`}
            </h2>
            <p className="text-xs text-[#71717A]">{integration.categoryLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-6 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-8 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Connected state details */}
        {isConnected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-[#E9F9EF] border border-green-200 rounded-8 text-xs text-[#027A48]">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Integration is active and healthy.</span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-2 border-b border-[#EAECF0]">
                <span className="text-[#71717A]">Connected Account</span>
                <span className="font-mono font-medium text-[#18181B]">
                  {integration.accountEmail || integration.accountIdentifier || "Primary Account"}
                </span>
              </div>
              {integration.connectedAt && (
                <div className="flex justify-between py-2 border-b border-[#EAECF0]">
                  <span className="text-[#71717A]">Connected At</span>
                  <span className="font-sans text-neutral-600">
                    {new Date(integration.connectedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
              {integration.grantedScopes && integration.grantedScopes.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <span className="text-[#71717A] block font-medium">Granted Scopes</span>
                  <div className="flex flex-wrap gap-1.5">
                    {integration.grantedScopes.map((scope, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-full bg-neutral-100 text-[10px] font-mono text-neutral-700"
                      >
                        {scope.split("/").pop()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-[#EAECF0]">
              <button
                type="button"
                onClick={handleDisconnectClick}
                disabled={disconnecting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-8 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{disconnecting ? "Disconnecting..." : "Disconnect"}</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-8 bg-white border border-[#DCE1E8] text-xs font-semibold text-[#344054] hover:bg-neutral-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : isApify ? (
          /* Apify connection & auth redirect form */
          <form onSubmit={handleSaveCredentials} className="space-y-4">
            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-8 text-xs text-amber-900 space-y-2">
              <p className="font-semibold text-amber-950">Step 1: Authorize access on Apify</p>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                Click below to open your Apify account in a new tab, grant permission or generate your personal API token.
              </p>
              <a
                href="https://console.apify.com/account/integrations"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-6 bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-semibold shadow-xs transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-amber-700" />
                <span>Open Apify Integrations Console</span>
              </a>
            </div>

            <div className="space-y-1 pt-1">
              <label className="text-xs font-semibold text-[#18181B]">Step 2: Paste your Apify API Token</label>
              <input
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 rounded-8 border border-[#EAECF0] text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#FF571A]"
                required
              />
              <p className="text-[11px] text-[#71717A]">
                QuickStart AI will verify your token live with Apify and link your account.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#EAECF0]">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 rounded-8 bg-white border border-[#DCE1E8] text-xs font-semibold text-[#344054] hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-8 bg-[#FF571A] hover:bg-[#E0460D] text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{saving ? "Verifying with Apify..." : "Connect Apify Account"}</span>
              </button>
            </div>
          </form>
        ) : isTwilio ? (
          /* Twilio credential input form */
          <form onSubmit={handleSaveCredentials} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#18181B]">Account SID</label>
              <input
                type="text"
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 rounded-8 border border-[#EAECF0] text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#FF571A]"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#18181B]">Auth Token</label>
              <input
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="••••••••••••••••••••••••••••••••"
                className="w-full px-3 py-2 rounded-8 border border-[#EAECF0] text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#FF571A]"
                required
              />
              <p className="text-[11px] text-[#71717A]">
                Credentials are encrypted using AES-256-GCM before storage.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#EAECF0]">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 rounded-8 bg-white border border-[#DCE1E8] text-xs font-semibold text-[#344054] hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-8 bg-[#FF571A] hover:bg-[#E0460D] text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{saving ? "Verifying..." : "Save credentials"}</span>
              </button>
            </div>
          </form>
        ) : (
          /* Generic connection instruction */
          <div className="space-y-4">
            <p className="text-xs text-[#71717A] leading-relaxed">
              {integration.description}
            </p>
            <div className="flex justify-end pt-4 border-t border-[#EAECF0]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-8 bg-white border border-[#DCE1E8] text-xs font-semibold text-[#344054] hover:bg-neutral-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
