"use client";

import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  DollarSign,
  Loader2,
  KeyRound,
  Pencil,
  Phone,
  Plug,
  PlugZap,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { listAgents } from "@/features/agents/lib/client";
import type { Agent } from "@/features/agents/lib/types";
import { getVoiceRepository } from "../lib/repository";
import { parseAddressList, validateAddressList } from "../lib/sip-validation";
import type {
  AvailablePhoneNumber,
  InboundSetupInfo,
  PhoneNumberSearchFilters,
  PhoneNumberStatus,
  PhoneNumberType,
  PhoneNumbersSnapshot,
  RepositoryResult,
  SipConnectionInfo,
  VoiceRepository,
  WorkspacePhoneNumber,
} from "../lib/types";
import { ByoSipDialog } from "./byo-sip-dialog";
import { InboundReadinessPanel } from "./inbound-readiness-panel";
import { SipConnectionDetails } from "./sip-connection-details";
import { SipModal } from "./sip-modal";
import { VoiceSubnav } from "./voice-subnav";

interface PhoneNumbersPanelProps {
  workspaceId: string;
  isPreview?: boolean;
  repository?: VoiceRepository;
}

const TYPE_OPTIONS: Array<{ value: PhoneNumberType; label: string }> = [
  { value: "local", label: "Local" },
  { value: "national", label: "National" },
  { value: "toll_free", label: "Toll-free" },
  { value: "mobile", label: "Mobile" },
];

function statusTone(status: PhoneNumberStatus): string {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "provisioning":
    case "pending":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "error":
      return "bg-red-50 text-red-700 border-red-200";
    case "releasing":
      return "bg-sky-50 text-sky-700 border-sky-200";
    default:
      return "bg-neutral-100 text-neutral-600 border-neutral-200";
  }
}

function StatusBadge({ status }: { status: PhoneNumberStatus }) {
  const active = status === "active";
  const pending = status === "provisioning" || status === "pending";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold capitalize ${statusTone(
        status,
      )}`}
    >
      {active ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : pending ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <AlertCircle className="w-3 h-3" />
      )}
      {status.replace("_", " ")}
    </span>
  );
}

function formatCost(number: WorkspacePhoneNumber | AvailablePhoneNumber): string {
  const cost = number.monthly_cost;
  if (cost == null) return "—";
  const currency = number.currency ?? "USD";
  return `${currency} ${cost.toFixed(2)}/mo`;
}

function isByoSip(number: WorkspacePhoneNumber): boolean {
  return number.provider === "byo_sip";
}

function headerChipText(snapshot: PhoneNumbersSnapshot | null, setup: InboundSetupInfo | null): string {
  const purchase = snapshot?.purchase_available ?? setup?.purchase_available ?? true;
  const byo = snapshot?.byo_sip_available ?? setup?.byo_sip_available ?? true;
  const edge =
    setup?.mode === "self_hosted"
      ? "Self-hosted SIP"
      : setup?.mode === "livekit_cloud"
        ? "LiveKit Cloud SIP"
        : "LiveKit SIP";
  const sources = [purchase ? "Telnyx" : null, byo ? "Your SIP trunk" : null].filter(Boolean);
  return `${sources.length > 0 ? sources.join(" + ") : "No number source"} → ${edge}`;
}

function formatLocation(number: WorkspacePhoneNumber | AvailablePhoneNumber): string {
  const parts = [number.locality, number.region].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : (number.country_code ?? "—");
}

export function PhoneNumbersPanel({
  workspaceId,
  isPreview = false,
  repository,
}: PhoneNumbersPanelProps) {
  const repo = repository || getVoiceRepository(isPreview);

  const [snapshot, setSnapshot] = useState<PhoneNumbersSnapshot | null>(null);
  const [result, setResult] = useState<RepositoryResult<PhoneNumbersSnapshot> | null>(null);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [setup, setSetup] = useState<InboundSetupInfo | null>(null);
  const [byoOpen, setByoOpen] = useState(false);
  const [sipView, setSipView] = useState<{
    number: WorkspacePhoneNumber;
    connection: SipConnectionInfo | null;
    error: string | null;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const [buyOpen, setBuyOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [available, setAvailable] = useState<AvailablePhoneNumber[]>([]);
  const [purchaseAgentId, setPurchaseAgentId] = useState("");
  const [filters, setFilters] = useState<PhoneNumberSearchFilters>({
    country_code: "US",
    area_code: "",
    locality: "",
    number_type: "local",
    limit: 10,
  });

  const load = useCallback(async (sync = false) => {
    setLoading(true);
    const response = await repo.listPhoneNumbers(workspaceId, { sync });
    setResult(response);
    setSnapshot(response.status === "ready" ? response.data : null);
    setLoading(false);
  }, [repo, workspaceId]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (isPreview) return;
    void listAgents(workspaceId).then((response) => {
      if (response.agents) setAgents(response.agents);
    });
  }, [isPreview, workspaceId]);

  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) map.set(agent.id, agent.name);
    return map;
  }, [agents]);

  const purchaseAvailable = snapshot?.purchase_available !== false;
  const byoAvailable = snapshot?.byo_sip_available !== false;
  const numbers = snapshot?.numbers ?? [];
  const pool = snapshot?.pool ?? [];
  const activeCount = numbers.filter((number) => number.status === "active").length;
  const unassignedCount = numbers.filter((number) => !number.assigned_agent_id).length;

  async function runAction(
    key: string,
    action: () => Promise<RepositoryResult<WorkspacePhoneNumber>>,
    successMessage: string,
  ) {
    setBusyId(key);
    setActionError(null);
    setNotice(null);
    const response = await action();
    setBusyId(null);
    if (response.status !== "ready") {
      setActionError(response.message);
      return;
    }
    setNotice(successMessage);
    await load(false);
  }

  async function handleSearch() {
    setSearching(true);
    setSearchError(null);
    const response = await repo.searchAvailablePhoneNumbers(workspaceId, filters);
    setSearching(false);
    if (response.status !== "ready") {
      setSearchError(response.message);
      setAvailable([]);
      return;
    }
    setAvailable(response.data.numbers);
  }

  async function handlePurchase(e164: string) {
    await runAction(
      `buy-${e164}`,
      () =>
        repo.purchasePhoneNumber(workspaceId, {
          e164,
          agent_id: purchaseAgentId || null,
          country_code: filters.country_code,
          number_type: filters.number_type,
        }),
      `${e164} purchased and routed to LiveKit.`,
    );
    setBuyOpen(false);
    setAvailable([]);
  }

  async function handleAssign(number: WorkspacePhoneNumber, agentId: string) {
    await runAction(
      `assign-${number.id}`,
      () =>
        repo.updatePhoneNumber(workspaceId, number.id, {
          assigned_agent_id: agentId || null,
        }),
      agentId ? "Agent assigned." : "Agent unassigned.",
    );
  }

  async function handleRelease(number: WorkspacePhoneNumber, mode: "pool" | "provider") {
    const byo = isByoSip(number);
    const label = byo
      ? `Remove ${number.phone_number}? The SIP trunk and its credentials are deleted and calls from your PBX will be rejected. This cannot be undone.`
      : mode === "provider"
        ? `Release ${number.phone_number} at Telnyx? This cannot be undone.`
        : `Return ${number.phone_number} to the platform pool?`;
    if (typeof window !== "undefined" && !window.confirm(label)) return;
    await runAction(
      `release-${number.id}`,
      () => repo.releasePhoneNumber(workspaceId, number.id, mode),
      byo
        ? "SIP number removed."
        : mode === "provider"
          ? "Number released at Telnyx."
          : "Number returned to the pool.",
    );
  }

  async function handleShowSipDetails(number: WorkspacePhoneNumber) {
    setSipView({ number, connection: null, error: null });
    const response = await repo.getSipConnection(workspaceId, number.id);
    setSipView((prev) => {
      if (!prev || prev.number.id !== number.id) return prev;
      return response.status === "ready"
        ? { ...prev, connection: response.data }
        : { ...prev, error: response.message };
    });
  }

  async function handleRotate(number: WorkspacePhoneNumber) {
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(
        `Rotate the SIP password for ${number.phone_number}? Your PBX will stop authenticating until you update it with the new password.`,
      );
    if (!confirmed) return;
    setBusyId(`rotate-${number.id}`);
    setActionError(null);
    setNotice(null);
    const response = await repo.rotateSipCredentials(workspaceId, number.id);
    setBusyId(null);
    if (response.status !== "ready") {
      setActionError(response.message);
      return;
    }
    setSipView({ number: response.data.number, connection: response.data.connection, error: null });
    await load(false);
  }

  function startEditAddresses(number: WorkspacePhoneNumber) {
    setEditingId(number.id);
    setEditText((number.sip?.allowed_addresses ?? []).join("\n"));
    setEditError(null);
  }

  async function handleSaveAddresses(number: WorkspacePhoneNumber) {
    const addresses = parseAddressList(editText);
    const validation = validateAddressList(addresses);
    if (validation) {
      setEditError(validation);
      return;
    }
    if (addresses.length === 0 && !number.sip?.has_credentials) {
      setEditError("Keep at least one allowed IP/CIDR, since this trunk has no SIP credentials.");
      return;
    }
    setBusyId(`sip-access-${number.id}`);
    setEditError(null);
    const response = await repo.updateSipAccess(workspaceId, number.id, addresses);
    setBusyId(null);
    if (response.status !== "ready") {
      setEditError(response.message);
      return;
    }
    setEditingId(null);
    setNotice("Allowed IPs updated.");
    await load(false);
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-accent-black">Phone numbers</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-neutral-100 text-neutral-600 border border-neutral-200">
              {headerChipText(snapshot, setup)}
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            {purchaseAvailable && byoAvailable
              ? "Buy a number on the platform account or connect your own SIP trunk, route it through LiveKit, and assign the agent that answers inbound calls."
              : purchaseAvailable
                ? "Buy a number on the platform account, route it through LiveKit, and assign the agent that answers inbound calls."
                : byoAvailable
                  ? "Connect your own SIP trunk or PBX, route it through LiveKit, and assign the agent that answers inbound calls. Buying numbers is not available on this deployment."
                  : "Number purchasing and SIP trunks are not enabled on this deployment."}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {byoAvailable && (
            <button
              type="button"
              onClick={() => setByoOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-accent-black hover:bg-neutral-800 text-white text-xs font-semibold rounded-8 shadow-xs transition-colors cursor-pointer"
            >
              <PlugZap className="w-3.5 h-3.5" />
              <span>Connect your SIP trunk</span>
            </button>
          )}
          {purchaseAvailable && (
            <button
              type="button"
              onClick={() => {
                setBuyOpen(true);
                setSearchError(null);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-heat-100 hover:bg-heat-200 text-white text-xs font-semibold rounded-8 shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Buy a number</span>
            </button>
          )}
        </div>
      </div>

      <VoiceSubnav workspaceId={workspaceId} isPreview={isPreview} liveCount={0} />

      {snapshot && purchaseAvailable && !snapshot.configured && (
        <div className="flex items-start gap-2.5 rounded-12 border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Telnyx is not connected in this environment.</p>
            <p className="mt-0.5 text-amber-800">
              The inventory below is demo data. Set <code>TELNYX_API_KEY</code>,{" "}
              <code>TELNYX_PUBLIC_KEY</code>, <code>LIVEKIT_URL</code>,{" "}
              <code>LIVEKIT_API_KEY</code>, <code>LIVEKIT_API_SECRET</code> and{" "}
              <code>LIVEKIT_SIP_ENDPOINT</code> to purchase and route real numbers.
            </p>
          </div>
        </div>
      )}

      {(notice || actionError) && (
        <div
          className={`flex items-center justify-between gap-3 rounded-10 border px-4 py-2.5 text-xs ${
            actionError
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          <span className="flex items-center gap-2">
            {actionError ? (
              <AlertCircle className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {actionError ?? notice}
          </span>
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setActionError(null);
            }}
            className="text-current/70 hover:text-current"
            aria-label="Dismiss message"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <InboundReadinessPanel workspaceId={workspaceId} repository={repo} onLoaded={setSetup} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-white border border-border-faint rounded-12 p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500 text-xs">
            <span>Workspace numbers</span>
            <Phone className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-accent-black">
            {numbers.length}
          </div>
          <div className="text-[11px] text-neutral-400 mt-1">rented from the platform pool</div>
        </div>
        <div className="bg-white border border-border-faint rounded-12 p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500 text-xs">
            <span>Answering inbound</span>
            <Radio className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-accent-black">
            {activeCount}
          </div>
          <div className="text-[11px] text-neutral-400 mt-1">LiveKit routes active</div>
        </div>
        <div className="bg-white border border-border-faint rounded-12 p-4 shadow-xs">
          <div className="flex items-center justify-between text-neutral-500 text-xs">
            <span>Awaiting an agent</span>
            <Bot className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-accent-black">
            {unassignedCount}
          </div>
          <div className="text-[11px] text-neutral-400 mt-1">calls would be declined</div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-border-faint rounded-12 p-8 shadow-xs space-y-3">
          <div className="h-4 bg-neutral-100 rounded-4 w-1/4 animate-pulse" />
          <div className="h-12 bg-neutral-50 rounded-8 w-full animate-pulse" />
          <div className="h-12 bg-neutral-50 rounded-8 w-full animate-pulse" />
        </div>
      ) : result?.status === "forbidden" ? (
        <div className="bg-white border border-border-faint rounded-12 p-8 text-center text-sm text-neutral-600">
          You do not have permission to view phone numbers in this workspace.
        </div>
      ) : result && result.status !== "ready" ? (
        <div className="bg-red-50 border border-red-200 rounded-12 p-6 text-center space-y-2">
          <AlertCircle className="w-5 h-5 text-red-600 mx-auto" />
          <h2 className="text-sm font-semibold text-red-900">Could not load phone numbers</h2>
          <p className="text-xs text-red-700">{result.message}</p>
        </div>
      ) : numbers.length === 0 ? (
        <div className="bg-white border border-border-faint rounded-16 p-8 sm:p-12 shadow-xs max-w-2xl mx-auto text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center mx-auto text-heat-100 shadow-xs">
            <Phone className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-accent-black">No numbers yet</h2>
            <p className="text-xs text-neutral-500 max-w-md mx-auto mt-1 leading-relaxed">
              {purchaseAvailable &&
                "Buy a number to give this workspace a real inbound line. We order it on the platform Telnyx account, point it at LiveKit SIP, and create the dispatch rule automatically."}
              {purchaseAvailable && byoAvailable && " Or "}
              {byoAvailable &&
                (purchaseAvailable
                  ? "connect your own SIP trunk or PBX and we will show you exactly what to configure."
                  : "Connect your own SIP trunk or PBX and we will show you exactly what to configure.")}
              {!purchaseAvailable && !byoAvailable &&
                "Number purchasing and SIP trunks are not enabled on this deployment."}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {purchaseAvailable && (
              <button
                type="button"
                onClick={() => setBuyOpen(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-heat-100 hover:bg-heat-200 text-white text-xs font-semibold rounded-10 shadow-sm transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Buy your first number
              </button>
            )}
            {byoAvailable && (
              <button
                type="button"
                onClick={() => setByoOpen(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent-black hover:bg-neutral-800 text-white text-xs font-semibold rounded-10 shadow-sm transition-colors cursor-pointer"
              >
                <PlugZap className="w-4 h-4" />
                Connect your SIP trunk
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-border-faint rounded-12 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border-faint bg-neutral-50/70 text-[11px] font-semibold text-neutral-500">
                  <th className="py-3 px-4">Number</th>
                  <th className="py-3 px-3">Agent</th>
                  <th className="py-3 px-3">Inbound routing</th>
                  <th className="py-3 px-3">Cost</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-faint">
                {numbers.map((number) => {
                  const busy = busyId?.includes(number.id);
                  const byo = isByoSip(number);
                  return (
                    <Fragment key={number.id}>
                    <tr className="hover:bg-neutral-50/60 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-accent-black font-mono">
                          {number.phone_number}
                          {byo && (
                            <span className="ml-2 text-[10px] font-sans font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5">
                              SIP
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-0.5">
                          {number.friendly_name ?? formatLocation(number)} ·{" "}
                          {byo ? "your SIP trunk" : (number.number_type ?? "local")}
                        </div>
                        {byo && number.sip && (
                          <div className="text-[11px] text-neutral-400 mt-0.5">
                            {number.sip.allowed_addresses.length} allowed IP
                            {number.sip.allowed_addresses.length === 1 ? "" : "s"}
                            {number.sip.has_credentials
                              ? ` · user ${number.sip.auth_username ?? "set"}`
                              : " · no credentials"}
                          </div>
                        )}
                        {number.provisioning_error && (
                          <div className="text-[11px] text-red-600 mt-1 max-w-xs truncate">
                            {number.provisioning_error}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 min-w-[190px]">
                        <div className="flex items-center gap-1.5">
                          <Bot className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          <select
                            value={number.assigned_agent_id ?? ""}
                            disabled={busy}
                            onChange={(event) => void handleAssign(number, event.target.value)}
                            aria-label={`Agent for ${number.phone_number}`}
                            className="w-full text-xs bg-white border border-neutral-200 rounded-6 px-2 py-1 text-accent-black focus:outline-none focus:ring-1 focus:ring-heat-100 disabled:opacity-60"
                          >
                            <option value="">Select an agent…</option>
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.name}
                              </option>
                            ))}
                            {number.assigned_agent_id &&
                              !agentNames.has(number.assigned_agent_id) && (
                                <option value={number.assigned_agent_id}>
                                  {number.assigned_agent_id}
                                </option>
                              )}
                          </select>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadge status={number.inbound_status} />
                        <div className="text-[10px] text-neutral-400 mt-1 font-mono">
                          {byo
                            ? number.livekit_trunk_id
                              ? `trunk ${number.livekit_trunk_id.slice(0, 12)}…`
                              : "no trunk"
                            : number.livekit_dispatch_rule_id
                              ? `rule ${number.livekit_dispatch_rule_id.slice(0, 12)}…`
                              : "no dispatch rule"}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-neutral-600 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <DollarSign className="w-3 h-3 text-neutral-400" />
                          {formatCost(number)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {byo ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleShowSipDetails(number)}
                              title="View SIP trunk connection details"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-6 text-[11px] font-semibold text-neutral-700 hover:text-accent-black bg-neutral-100 hover:bg-neutral-200 transition-colors disabled:opacity-50"
                            >
                              <Plug className="w-3 h-3" />
                              Details
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleRotate(number)}
                              title="Rotate SIP credentials"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-6 text-[11px] font-semibold text-neutral-700 hover:text-accent-black bg-neutral-100 hover:bg-neutral-200 transition-colors disabled:opacity-50"
                            >
                              <KeyRound className="w-3 h-3" />
                              Rotate
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                editingId === number.id
                                  ? setEditingId(null)
                                  : startEditAddresses(number)
                              }
                              title="Edit allowed source IPs"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-6 text-[11px] font-semibold text-neutral-700 hover:text-accent-black bg-neutral-100 hover:bg-neutral-200 transition-colors disabled:opacity-50"
                            >
                              <Pencil className="w-3 h-3" />
                              IPs
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleRelease(number, "provider")}
                              title="Remove this SIP number"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-6 text-[11px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="w-3 h-3" />
                              Remove
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleRelease(number, "pool")}
                              title="Return to platform pool"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-6 text-[11px] font-semibold text-neutral-600 hover:text-accent-black bg-neutral-100 hover:bg-neutral-200 transition-colors disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Pool
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleRelease(number, "provider")}
                              title="Release at Telnyx"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-6 text-[11px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="w-3 h-3" />
                              Release
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {editingId === number.id && (
                      <tr className="bg-neutral-50/70">
                        <td colSpan={5} className="py-3 px-4">
                          <div className="space-y-2 max-w-lg">
                            <label className="text-[11px] font-semibold text-neutral-700 block">
                              Allowed source IPs / CIDRs for {number.phone_number} (one per line):
                            </label>
                            <textarea
                              rows={3}
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className="w-full text-xs font-mono bg-white border border-neutral-200 rounded-6 p-2 text-accent-black focus:outline-none focus:ring-1 focus:ring-heat-100"
                              placeholder="203.0.113.10&#10;198.51.100.0/24"
                            />
                            {editError && <p className="text-[11px] text-red-600">{editError}</p>}
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleSaveAddresses(number)}
                                className="px-2.5 py-1 text-[11px] font-semibold text-white bg-heat-100 hover:bg-heat-200 rounded-6 disabled:opacity-50"
                              >
                                Save IPs
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="px-2.5 py-1 text-[11px] font-semibold text-neutral-600 hover:text-neutral-900"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pool.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-accent-black">Platform pool</h2>
            <p className="text-xs text-neutral-500">
              Numbers already purchased on the platform account. Claim one without a new Telnyx
              order.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pool.map((number) => (
              <div
                key={number.id}
                className="bg-white border border-border-faint rounded-12 p-4 shadow-xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-accent-black">
                    {number.phone_number}
                  </span>
                  <StatusBadge status={number.inbound_status} />
                </div>
                <div className="text-[11px] text-neutral-500">
                  {formatLocation(number)} · {formatCost(number)}
                </div>
                <button
                  type="button"
                  disabled={busyId === `buy-${number.phone_number}`}
                  onClick={() => void handlePurchase(number.phone_number)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-heat-100 hover:text-heat-200 disabled:opacity-50"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  Claim for this workspace
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {buyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-accent-black/40 backdrop-blur-xs"
            onClick={() => setBuyOpen(false)}
          />
          <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-16 shadow-2xl border border-border-faint p-6 z-10 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-accent-black">Buy a phone number</h3>
                <p className="text-[11px] text-neutral-500">
                  Live Telnyx inventory on the platform account. Purchases are routed through
                  LiveKit automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBuyOpen(false)}
                className="p-1 rounded-6 text-neutral-400 hover:text-accent-black hover:bg-neutral-100"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <label className="text-[11px] font-semibold text-neutral-600 space-y-1">
                Country
                <input
                  value={filters.country_code ?? "US"}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      country_code: event.target.value.toUpperCase().slice(0, 2),
                    }))
                  }
                  className="w-full px-2.5 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-8 focus:outline-none focus:ring-1 focus:ring-heat-100"
                />
              </label>
              <label className="text-[11px] font-semibold text-neutral-600 space-y-1">
                Area code
                <input
                  value={filters.area_code ?? ""}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      area_code: event.target.value.replace(/\D/g, "").slice(0, 3),
                    }))
                  }
                  placeholder="415"
                  className="w-full px-2.5 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-8 focus:outline-none focus:ring-1 focus:ring-heat-100"
                />
              </label>
              <label className="text-[11px] font-semibold text-neutral-600 space-y-1">
                City
                <input
                  value={filters.locality ?? ""}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, locality: event.target.value }))
                  }
                  placeholder="San Francisco"
                  className="w-full px-2.5 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-8 focus:outline-none focus:ring-1 focus:ring-heat-100"
                />
              </label>
              <label className="text-[11px] font-semibold text-neutral-600 space-y-1">
                Type
                <select
                  value={filters.number_type ?? "local"}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      number_type: event.target.value as PhoneNumberType,
                    }))
                  }
                  className="w-full px-2.5 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-8 focus:outline-none focus:ring-1 focus:ring-heat-100"
                >
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center justify-between gap-2">
              <select
                value={purchaseAgentId}
                onChange={(event) => setPurchaseAgentId(event.target.value)}
                aria-label="Agent to assign on purchase"
                className="text-xs bg-neutral-50 border border-neutral-200 rounded-8 px-2.5 py-1.5 text-accent-black focus:outline-none focus:ring-1 focus:ring-heat-100"
              >
                <option value="">Assign agent later</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleSearch()}
                disabled={searching}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-accent-black hover:bg-neutral-800 text-white text-xs font-semibold rounded-8 transition-colors disabled:opacity-60"
              >
                {searching ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                Search inventory
              </button>
            </div>

            {searchError && (
              <div className="rounded-8 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {searchError}
              </div>
            )}

            {available.length === 0 ? (
              <div className="rounded-10 border border-dashed border-neutral-200 py-10 text-center text-xs text-neutral-500">
                Search Telnyx inventory to see numbers available for this workspace.
              </div>
            ) : (
              <div className="border border-border-faint rounded-10 overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-neutral-50/70 text-[11px] font-semibold text-neutral-500 border-b border-border-faint">
                      <th className="py-2.5 px-3">Number</th>
                      <th className="py-2.5 px-3">Location</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Cost</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-faint">
                    {available.map((number) => (
                      <tr key={number.phone_number} className="hover:bg-neutral-50/60">
                        <td className="py-2.5 px-3 font-mono font-semibold text-accent-black">
                          {number.phone_number}
                          {number.owned && (
                            <span className="ml-2 text-[10px] font-sans font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">
                              owned
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-neutral-600">{formatLocation(number)}</td>
                        <td className="py-2.5 px-3 text-neutral-600 capitalize">
                          {number.number_type.replace("_", " ")}
                        </td>
                        <td className="py-2.5 px-3 text-neutral-600">{formatCost(number)}</td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            disabled={busyId === `buy-${number.phone_number}`}
                            onClick={() => void handlePurchase(number.phone_number)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-6 text-[11px] font-semibold text-white bg-heat-100 hover:bg-heat-200 transition-colors disabled:opacity-60"
                          >
                            {busyId === `buy-${number.phone_number}` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Plus className="w-3 h-3" />
                            )}
                            Purchase
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {byoOpen && (
        <ByoSipDialog
          workspaceId={workspaceId}
          repository={repo}
          agents={agents}
          onClose={() => setByoOpen(false)}
          onRegistered={() => {
            void load(false);
          }}
        />
      )}

      {sipView && (
        <SipModal
          title={`SIP trunk · ${sipView.number.phone_number}`}
          description="Configuration for your PBX, carrier trunk, or softphone."
          onClose={() => setSipView(null)}
        >
          {sipView.error ? (
            <div className="rounded-8 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {sipView.error}
            </div>
          ) : sipView.connection ? (
            <SipConnectionDetails
              connection={sipView.connection}
              phoneNumber={sipView.number.phone_number}
            />
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
            </div>
          )}
        </SipModal>
      )}
    </div>
  );
}
