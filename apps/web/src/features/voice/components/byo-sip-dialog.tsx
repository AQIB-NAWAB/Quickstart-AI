"use client";

import { AlertCircle, CheckCircle2, Loader2, PlugZap } from "lucide-react";
import { useState } from "react";
import type { Agent } from "@/features/agents/lib/types";
import {
  isE164,
  MIN_IPV4_PREFIX,
  MIN_IPV6_PREFIX,
  parseAddressList,
  validateAddressList,
} from "../lib/sip-validation";
import type {
  ByoSipNumberInput,
  SipConnectionInfo,
  VoiceRepository,
  WorkspacePhoneNumber,
} from "../lib/types";
import { SipConnectionDetails } from "./sip-connection-details";
import { SipModal } from "./sip-modal";

interface ByoSipDialogProps {
  workspaceId: string;
  repository: VoiceRepository;
  agents: Agent[];
  onClose: () => void;
  onRegistered?: (number: WorkspacePhoneNumber) => void;
}

const INPUT_CLASS =
  "w-full text-xs bg-neutral-50 border border-neutral-200 rounded-8 px-2.5 py-1.5 text-accent-black focus:outline-none focus:ring-1 focus:ring-heat-100";

export function ByoSipDialog({
  workspaceId,
  repository,
  agents,
  onClose,
  onRegistered,
}: ByoSipDialogProps) {
  const [e164, setE164] = useState("");
  const [friendlyName, setFriendlyName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [addressText, setAddressText] = useState("");
  const [requireCredentials, setRequireCredentials] = useState(false);
  const [username, setUsername] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    number: WorkspacePhoneNumber;
    connection: SipConnectionInfo;
  } | null>(null);

  const addresses = parseAddressList(addressText);
  const numberError =
    e164.trim() === ""
      ? "Enter the phone number in E.164 format, e.g. +14155550123."
      : !isE164(e164)
        ? "Use E.164 format: a leading + and 7–15 digits, e.g. +14155550123."
        : null;
  const addressError = addresses.length > 0 ? validateAddressList(addresses) : null;
  const accessError =
    addresses.length === 0 && !requireCredentials
      ? "Restrict the trunk by at least one allowed IP/CIDR, SIP username & password, or both."
      : null;
  const hasErrors = Boolean(numberError || addressError || accessError);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (hasErrors) return;
    const input: ByoSipNumberInput = {
      e164: e164.trim(),
      agent_id: agentId || null,
      friendly_name: friendlyName.trim() || null,
      allowed_addresses: addresses,
      generate_credentials: requireCredentials,
    };
    if (requireCredentials && username.trim()) input.auth_username = username.trim();
    setSaving(true);
    const response = await repository.registerByoSipNumber(workspaceId, input);
    setSaving(false);
    if (response.status !== "ready") {
      setServerError(response.message);
      return;
    }
    setCreated(response.data);
    onRegistered?.(response.data.number);
  }

  if (created) {
    return (
      <SipModal
        title="SIP trunk connected"
        description={`${created.number.phone_number} is ready to receive calls from your PBX or carrier.`}
        onClose={onClose}
        maxWidthClass="max-w-3xl"
      >
        <div className="flex items-center gap-2 rounded-10 border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Number registered. Configure your side with the details below.
        </div>
        <SipConnectionDetails connection={created.connection} phoneNumber={created.number.phone_number} />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-accent-black hover:bg-neutral-800 text-white text-xs font-semibold rounded-8 transition-colors"
          >
            Done
          </button>
        </div>
      </SipModal>
    );
  }

  return (
    <SipModal
      title="Connect your SIP trunk"
      description="Bring your own SIP server, PBX or carrier. Calls to this number are delivered to your workspace agent."
      onClose={onClose}
    >
      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <label htmlFor="byo-e164" className="text-[11px] font-semibold text-neutral-600">
              Phone number (E.164)
            </label>
            <input
              id="byo-e164"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={e164}
              onChange={(event) => setE164(event.target.value)}
              placeholder="+14155550123"
              aria-invalid={submitted && numberError ? true : undefined}
              aria-describedby={submitted && numberError ? "byo-e164-error" : undefined}
              className={`${INPUT_CLASS} font-mono`}
            />
            {submitted && numberError && (
              <p id="byo-e164-error" className="text-[11px] text-red-700">
                {numberError}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label htmlFor="byo-name" className="text-[11px] font-semibold text-neutral-600">
              Friendly name
            </label>
            <input
              id="byo-name"
              value={friendlyName}
              onChange={(event) => setFriendlyName(event.target.value)}
              placeholder="Front desk PBX"
              className={INPUT_CLASS}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="byo-agent" className="text-[11px] font-semibold text-neutral-600">
              Agent that answers
            </label>
            <select
              id="byo-agent"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">Assign agent later</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="rounded-12 border border-border-faint p-3.5 space-y-3">
          <legend className="px-1 text-xs font-bold text-accent-black">Access control</legend>
          <p className="text-[11px] text-neutral-500 leading-relaxed">
            An open trunk would let anyone on the internet call into your workspace, so lock it down
            by source address, credentials, or both.
          </p>
          <div className="space-y-1">
            <label htmlFor="byo-addresses" className="text-[11px] font-semibold text-neutral-600">
              Allowed IPs / CIDRs
            </label>
            <textarea
              id="byo-addresses"
              rows={3}
              value={addressText}
              onChange={(event) => setAddressText(event.target.value)}
              placeholder={"203.0.113.10\n198.51.100.0/24"}
              aria-invalid={addressError ? true : undefined}
              aria-describedby="byo-addresses-hint"
              className={`${INPUT_CLASS} font-mono resize-y`}
            />
            <p id="byo-addresses-hint" className="text-[11px] text-neutral-400">
              One per line or comma separated. IPv4 up to /{MIN_IPV4_PREFIX}, IPv6 up to /
              {MIN_IPV6_PREFIX} wide.
            </p>
            {addressError && <p className="text-[11px] text-red-700">{addressError}</p>}
          </div>
          <label className="flex items-start gap-2 text-xs text-accent-black cursor-pointer">
            <input
              type="checkbox"
              checked={requireCredentials}
              onChange={(event) => setRequireCredentials(event.target.checked)}
              className="mt-0.5 accent-heat-100"
            />
            <span>
              <span className="font-semibold">Require SIP username &amp; password</span>
              <span className="block text-[11px] text-neutral-500">
                We generate a strong password and show it once.
              </span>
            </span>
          </label>
          {requireCredentials && (
            <div className="space-y-1">
              <label htmlFor="byo-username" className="text-[11px] font-semibold text-neutral-600">
                Username (optional)
              </label>
              <input
                id="byo-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
                placeholder="Generated if left empty"
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
          )}
          {submitted && accessError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-8 border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
            >
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {accessError}
            </div>
          )}
        </fieldset>

        {serverError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-8 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {serverError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold text-neutral-600 hover:text-accent-black bg-neutral-100 hover:bg-neutral-200 rounded-8 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-heat-100 hover:bg-heat-200 text-white text-xs font-semibold rounded-8 shadow-xs transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
            Connect trunk
          </button>
        </div>
      </form>
    </SipModal>
  );
}
