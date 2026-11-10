"use client";

import { Search, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { apiIntegrationsRepository } from "../lib/api-repository";
import type {
  IntegrationCatalogItem,
  IntegrationCategory,
  IntegrationProvider,
  IntegrationsListResponse,
} from "../lib/types";
import { ConfigureIntegrationDialog } from "./configure-integration-dialog";
import { GoogleCalendarModal } from "./google-calendar-modal";

interface IntegrationsDirectoryProps {
  workspaceId: string;
  workspaceName?: string;
}

export function IntegrationsDirectory({
  workspaceId,
  workspaceName = "Workspace",
}: IntegrationsDirectoryProps) {
  const [data, setData] = useState<IntegrationsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<IntegrationCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedForConfig, setSelectedForConfig] = useState<IntegrationCatalogItem | null>(null);
  const [isGCalModalOpen, setIsGCalModalOpen] = useState(false);

  async function loadData() {
    setLoading(true);
    const res = await apiIntegrationsRepository.listIntegrations(workspaceId);
    if (res.status === "ready") {
      setData(res.data);
      setError(null);
    } else if (res.status === "forbidden") {
      setError("You do not have permission to view workspace integrations.");
    } else {
      setError("message" in res ? res.message : "Failed to load integrations");
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, [workspaceId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const oauthError = params.get("error");
    if (connected) setSuccess(`${connected} connected successfully.`);
    if (oauthError) setError(oauthError);
    if (connected || oauthError) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("connected");
      clean.searchParams.delete("error");
      window.history.replaceState({}, "", clean.toString());
    }
  }, []);

  // Handle Google Calendar OAuth initiation
  async function handleGCalAuthorize() {
    const res = await apiIntegrationsRepository.authorize(workspaceId, "google_calendar");
    if (res.status === "ready") {
      // In production/simulated flow, mock the completion callback or redirect
      await apiIntegrationsRepository.callback(
        workspaceId,
        "google_calendar",
        "mock_google_auth_code",
        res.data.state,
      );
      setIsGCalModalOpen(false);
      await loadData();
    }
  }

  // Handle Connect with OAuth for other providers
  async function handleConnectOAuth(provider: IntegrationProvider) {
    if (provider === "google_calendar") {
      setIsGCalModalOpen(true);
      return;
    }
    setError(null);
    setSuccess(null);
    const redirectUri = `${window.location.origin}/api/integrations/oauth/callback`;
    const res = await apiIntegrationsRepository.authorize(
      workspaceId,
      provider,
      redirectUri,
    );
    if (res.status === "ready") {
      window.location.assign(res.data.authorization_url);
      return;
    }
    setError("message" in res ? res.message : "Failed to start OAuth authorization");
  }

  // Handle Twilio / Apify credentials
  async function handleSaveCredentials(credentials: Record<string, string>) {
    if (!selectedForConfig) return;
    const res = await apiIntegrationsRepository.saveCredentials(workspaceId, selectedForConfig.id, credentials);
    if (res.status === "error") {
      throw new Error(res.message);
    }
    await loadData();
  }

  // Handle Disconnect
  async function handleDisconnect() {
    if (!selectedForConfig) return;
    await apiIntegrationsRepository.disconnect(workspaceId, selectedForConfig.id);
    await loadData();
  }

  const catalog = data?.catalog ?? [];
  const filteredCatalog = catalog.filter((item) => {
    if (activeCategory !== "all" && item.category !== activeCategory) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q)
      );
    }
    return true;
  });

  function renderProviderLogo(provider: IntegrationProvider) {
    switch (provider) {
      case "hubspot":
        return (
          <div className="w-10 h-10 rounded-10 bg-[#FF7A59]/10 text-[#FF7A59] flex items-center justify-center font-bold text-lg">
            <span>●</span>
          </div>
        );
      case "salesforce":
        return (
          <div className="w-10 h-10 rounded-10 bg-[#00A1E0]/15 text-[#00A1E0] flex items-center justify-center font-semibold text-xs">
            <span>SF</span>
          </div>
        );
      case "google_calendar":
        return (
          <div className="w-10 h-10 rounded-10 bg-white border border-[#DCE1E8] shadow-xs flex flex-col items-center justify-center overflow-hidden">
            <div className="w-full bg-[#1A73E8] py-0.2 text-center">
              <span className="text-[6px] font-bold text-white uppercase">Google</span>
            </div>
            <span className="text-sm font-bold text-[#1A73E8] leading-none">31</span>
          </div>
        );
      case "slack":
        return (
          <div className="w-10 h-10 rounded-10 bg-[#4A154B]/10 text-[#4A154B] flex items-center justify-center font-bold text-sm">
            <span>#</span>
          </div>
        );
      case "twilio":
        return (
          <div className="w-10 h-10 rounded-10 bg-[#F22F46]/10 text-[#F22F46] flex items-center justify-center font-bold text-xs">
            <span>:::</span>
          </div>
        );
      case "zendesk":
        return (
          <div className="w-10 h-10 rounded-10 bg-[#03363D]/10 text-[#03363D] flex items-center justify-center font-bold text-base">
            <span>Z</span>
          </div>
        );
      case "google_sheets":
        return (
          <div className="w-10 h-10 rounded-10 bg-[#0F9D58]/10 text-[#0F9D58] flex items-center justify-center font-bold text-xs">
            <span>田</span>
          </div>
        );
      case "notion":
        return (
          <div className="w-10 h-10 rounded-10 bg-neutral-900 text-white flex items-center justify-center font-bold text-sm">
            <span>N</span>
          </div>
        );
      case "mailchimp":
        return (
          <div className="w-10 h-10 rounded-10 bg-[#FFE01B]/30 text-neutral-800 flex items-center justify-center font-bold text-xs">
            <span>MC</span>
          </div>
        );
      case "apify":
        return (
          <div className="w-10 h-10 rounded-10 bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center font-bold text-xs">
            <span>API</span>
          </div>
        );
      default:
        return (
          <div className="w-10 h-10 rounded-10 bg-neutral-100 text-neutral-700 flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
        );
    }
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      {/* Header matching Image 2 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-[#18181B]">
              Integrations
            </h1>
            {data && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#E9F9EF] text-[#027A48] border border-green-200">
                <span className="w-1.5 h-1.5 rounded-full bg-[#027A48]" />
                <span>{data.connected_count} connected</span>
              </span>
            )}
          </div>
          <p className="text-xs sm:text-[13px] text-[#71717A]">
            Connect your CRM, calendar, ticketing, and telephony tools.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-[#71717A] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search integrations..."
            className="w-full pl-9 pr-3 py-2 rounded-8 bg-white border border-[#EAECF0] text-xs text-[#18181B] placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FF571A] shadow-xs"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#EAECF0] overflow-x-auto select-none">
        {(data?.categories ?? [
          { id: "all", label: "All", count: 12 },
          { id: "crm_leads", label: "CRM & Leads", count: 3 },
          { id: "calendar_booking", label: "Calendar & Booking", count: 2 },
          { id: "communication", label: "Communication", count: 3 },
          { id: "telephony", label: "Telephony", count: 2 },
        ]).map((cat) => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id as IntegrationCategory)}
              className={`pb-3 px-2 text-xs font-medium whitespace-nowrap border-b-2 transition-all ${
                isActive
                  ? "border-[#FF571A] text-[#FF571A] font-semibold"
                  : "border-transparent text-[#71717A] hover:text-[#18181B]"
              }`}
            >
              {cat.label} ({cat.count})
            </button>
          );
        })}
      </div>

      {success && (
        <div className="p-4 bg-[#E9F9EF] border border-green-200 rounded-12 text-xs text-[#027A48]">
          {success}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-12 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Grid of Integration Cards matching Image 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-white border border-[#EAECF0] rounded-12 p-5 space-y-4 animate-pulse"
            >
              <div className="w-10 h-10 rounded-10 bg-neutral-200" />
              <div className="h-4 w-1/3 bg-neutral-200 rounded" />
              <div className="h-3 w-3/4 bg-neutral-100 rounded" />
            </div>
          ))
        ) : filteredCatalog.length === 0 ? (
          <div className="col-span-full py-12 text-center text-xs text-[#71717A]">
            No integrations found matching your filter.
          </div>
        ) : (
          filteredCatalog.map((item) => {
            const isConnected = item.status === "connected";

            return (
              <div
                key={item.id}
                className="bg-white border border-[#EAECF0] rounded-12 p-5 flex flex-col justify-between space-y-4 shadow-xs hover:border-[#DCE1E8] transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    {renderProviderLogo(item.id)}
                    <span className="text-[11px] font-medium text-[#71717A]">
                      {item.categoryLabel}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-[#18181B]">{item.name}</h3>
                    <p className="text-xs text-[#71717A] leading-relaxed line-clamp-2">
                      {item.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-[#EAECF0]">
                  {/* Status Indicator */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isConnected ? "bg-[#027A48]" : "bg-neutral-400"
                      }`}
                    />
                    <span
                      className={`font-medium ${
                        isConnected ? "text-[#027A48]" : "text-[#71717A]"
                      }`}
                    >
                      {isConnected ? "Connected" : "Not connected"}
                    </span>
                  </div>

                  {/* Action Button */}
                  {isConnected ? (
                    <button
                      type="button"
                      onClick={() => setSelectedForConfig(item)}
                      className="px-3.5 py-1.5 rounded-8 bg-white border border-[#DCE1E8] text-xs font-semibold text-[#344054] hover:bg-neutral-50 transition-colors shadow-xs"
                    >
                      {item.id === "google_sheets"
                        ? "Configure account"
                        : item.id === "twilio"
                        ? "Configure credentials"
                        : item.id === "apify"
                        ? "Configure Apify"
                        : "Configure"}
                    </button>
                  ) : item.id === "apify" ? (
                    <button
                      type="button"
                      onClick={() => setSelectedForConfig(item)}
                      className="px-3.5 py-1.5 rounded-8 bg-[#FF571A] hover:bg-[#E0460D] text-white text-xs font-semibold transition-colors shadow-xs"
                    >
                      Connect Apify
                    </button>
                  ) : item.connectionType === "oauth" ? (
                    <button
                      type="button"
                      onClick={() => handleConnectOAuth(item.id)}
                      className="px-3.5 py-1.5 rounded-8 bg-[#FF571A] hover:bg-[#E0460D] text-white text-xs font-semibold transition-colors shadow-xs"
                    >
                      Connect with OAuth
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSelectedForConfig(item)}
                      className="px-3.5 py-1.5 rounded-8 bg-white border border-[#DCE1E8] text-xs font-semibold text-[#344054] hover:bg-neutral-50 transition-colors shadow-xs"
                    >
                      Configure credentials
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Google Calendar Modal matching Image 2 */}
      <GoogleCalendarModal
        open={isGCalModalOpen}
        workspaceName={workspaceName}
        onClose={() => setIsGCalModalOpen(false)}
        onAuthorize={handleGCalAuthorize}
      />

      {/* Configure Dialog */}
      <ConfigureIntegrationDialog
        open={Boolean(selectedForConfig)}
        integration={selectedForConfig}
        onClose={() => setSelectedForConfig(null)}
        onSaveCredentials={handleSaveCredentials}
        onDisconnect={handleDisconnect}
      />
    </div>
  );
}
