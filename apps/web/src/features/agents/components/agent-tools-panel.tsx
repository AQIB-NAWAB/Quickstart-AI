"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Globe,
  Grid,
  LifeBuoy,
  List,
  Mail,
  MessageSquare,
  PhoneCall,
  Plus,
  Puzzle,
  Search,
  Send,
  Sliders,
  Table,
  UserPlus,
  Users,
  X,
  XCircle,
  FileText,
} from "lucide-react";
import type { AgentToolDefinition } from "../lib/types";
import { BUILTIN_TOOLS, customToolToAgentTool } from "../lib/tools";
import type { CustomToolItem } from "@/features/settings/lib/types";
import { CustomToolsModal } from "@/features/settings/components/custom-tools-modal";
import { AgentToolsManageDrawer } from "./agent-tools-manage-drawer";
import { listSecrets } from "@/features/settings/lib/client";
import { getAgentCatalog } from "../lib/client";

type CategoryFilter = "all" | "web" | "calendar" | "leads" | "integrations" | "custom";
type StatusFilter = "all" | "attached" | "not_attached";

type Props = {
  workspaceId: string;
  canManageCustomTools: boolean;
  attachedTools: AgentToolDefinition[];
  onToggle: (tool: AgentToolDefinition) => void;
  onUpdate: (tool: AgentToolDefinition) => void;
  customTools: CustomToolItem[];
  customToolsLoading: boolean;
  customToolsError: string | null;
  onCustomToolsChange: (tools: CustomToolItem[]) => void;
};

// Friendly name & icon mapping matching 4.png specification
const FRIENDLY_NAMES: Record<string, { label: string; icon: ComponentType<{ className?: string }> }> = {
  web_scrape: { label: "Scrape a webpage", icon: Globe },
  web_search: { label: "Search the web", icon: Globe },
  leads_start_research: { label: "Start research", icon: Search },
  leads_run_status: { label: "Check progress", icon: List },
  leads_run_results: { label: "Get results", icon: FileText },
  leads_cancel_run: { label: "Cancel research", icon: XCircle },
  save_qualified_lead: { label: "Save qualified lead", icon: UserPlus },
  request_callback: { label: "Request a callback", icon: PhoneCall },
  check_calendar_availability: { label: "Check calendar availability", icon: CalendarDays },
  book_calendar_slot: { label: "Book an appointment", icon: CalendarDays },
  cancel_calendar_event: { label: "Cancel an appointment", icon: CalendarDays },
  create_support_ticket: { label: "Create support ticket", icon: LifeBuoy },
  get_support_ticket: { label: "Look up support ticket", icon: LifeBuoy },
  add_support_ticket_comment: { label: "Comment on support ticket", icon: MessageSquare },
  post_team_message: { label: "Notify team in Slack", icon: Send },
  save_crm_contact: { label: "Save CRM contact", icon: Users },
  create_salesforce_lead: { label: "Create Salesforce lead", icon: UserPlus },
  append_google_sheet_row: { label: "Append Google Sheet row", icon: Table },
  add_mailchimp_subscriber: { label: "Add Mailchimp subscriber", icon: Mail },
  send_sms: { label: "Send SMS", icon: MessageSquare },
};

export function AgentToolsPanel({
  workspaceId,
  canManageCustomTools,
  attachedTools,
  onToggle,
  onUpdate,
  customTools,
  customToolsLoading,
  customToolsError,
  onCustomToolsChange,
}: Props) {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [secretNames, setSecretNames] = useState<string[]>([]);
  const [enabledToolNames, setEnabledToolNames] = useState<Set<string> | null>(null);

  useEffect(() => {
    let active = true;
    void getAgentCatalog(workspaceId).then((result) => {
      if (!active || !result.catalog) return;
      setEnabledToolNames(
        new Set(result.catalog.tools.filter((tool) => tool.enabled).map((tool) => tool.name)),
      );
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  // Format custom tools
  const customAgentTools = useMemo(
    () => customTools.map((t) => customToolToAgentTool(t)),
    [customTools],
  );

  // All available tools
  const builtinTools = useMemo(
    () =>
      enabledToolNames
        ? BUILTIN_TOOLS.filter((tool) => enabledToolNames.has(tool.name))
        : BUILTIN_TOOLS,
    [enabledToolNames],
  );
  const allTools = useMemo(() => [...builtinTools, ...customAgentTools], [builtinTools, customAgentTools]);

  // Counts for library categories
  const webTools = useMemo(() => builtinTools.filter((t) => t.type === "builtin_web"), [builtinTools]);
  const calendarTools = useMemo(
    () => builtinTools.filter((t) => t.type === "builtin_calendar"),
    [builtinTools],
  );
  const leadTools = useMemo(() => builtinTools.filter((t) => t.type === "builtin_leads"), [builtinTools]);
  const integrationTools = useMemo(
    () => builtinTools.filter((t) => t.type === "builtin_integration"),
    [builtinTools],
  );

  // Filtered tools based on category, status, and search query
  const filteredTools = useMemo(() => {
    return allTools.filter((tool) => {
      // Category filter
      if (category === "web" && tool.type !== "builtin_web") return false;
      if (category === "calendar" && tool.type !== "builtin_calendar") return false;
      if (category === "leads" && tool.type !== "builtin_leads") return false;
      if (category === "integrations" && tool.type !== "builtin_integration") return false;
      if (category === "custom" && tool.type !== "http" && tool.type !== "mcp") return false;

      // Status filter
      const isAttached = attachedTools.some((t) => t.name === tool.name);
      if (statusFilter === "attached" && !isAttached) return false;
      if (statusFilter === "not_attached" && isAttached) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const friendly = (FRIENDLY_NAMES[tool.name]?.label || "").toLowerCase();
        const techId = tool.name.toLowerCase();
        const desc = (tool.description || "").toLowerCase();
        return friendly.includes(q) || techId.includes(q) || desc.includes(q);
      }

      return true;
    });
  }, [allTools, category, statusFilter, searchQuery, attachedTools]);

  async function openQuickAdd() {
    if (secretNames.length === 0) {
      const res = await listSecrets(workspaceId);
      setSecretNames((res.secrets ?? []).map((s) => s.name));
    }
    setQuickAddOpen(true);
  }

  return (
    <div className="space-y-6 max-w-full">
      {/* Header matching 4.png */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-[24px] font-semibold text-[#202125] leading-tight">Tools &amp; functions</h2>
          <p className="mt-1 text-[14px] text-[#667085]">
            Manage the actions available to your agent.
          </p>
        </div>

        {/* Header Actions: Manage tools (outlined), Add custom tool (orange) */}
        {canManageCustomTools && (
          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="inline-flex items-center gap-2 h-10 px-4 text-[14px] font-medium text-[#202125] bg-white border border-[#DCE1E8] rounded-[6px] hover:bg-[#F8F9FA] transition-colors shadow-xs"
            >
              <Sliders className="w-3.5 h-3.5 text-[#667085]" />
              <span>Manage tools</span>
            </button>

            <button
              type="button"
              onClick={() => void openQuickAdd()}
              className="inline-flex items-center gap-2 h-10 px-4 text-[14px] font-medium text-white bg-[#FF571A] hover:bg-[#E04B14] rounded-[6px] transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Add custom tool</span>
            </button>
          </div>
        )}
      </div>

      {attachedTools.length > 0 && (
        <div className="rounded-[8px] border border-[#DCE1E8] bg-white p-5 shadow-xs space-y-4">
          <div>
            <h3 className="text-[15px] font-semibold text-[#202125]">Attached tool policies</h3>
            <p className="mt-1 text-[13px] text-[#667085]">
              Keep high-impact actions scoped to the right channels and confirmation level.
            </p>
          </div>
          <div className="space-y-3">
            {attachedTools.map((tool) => {
              const policy = tool.policy ?? {};
              const updatePolicy = (patch: NonNullable<AgentToolDefinition["policy"]>) =>
                onUpdate({ ...tool, policy: { ...policy, ...patch } });
              return (
                <div key={tool.name} className="rounded-[6px] border border-[#EAECF0] p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-[#202125]">{tool.name}</div>
                      <div className="text-[12px] text-[#667085] truncate">{tool.description}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`${tool.name} confirmation policy`}
                        value={policy.confirmation ?? "user"}
                        onChange={(event) => updatePolicy({ confirmation: event.target.value as "never" | "user" | "staff" })}
                        className="h-8 rounded border border-[#DCE1E8] bg-white px-2 text-[12px]"
                      >
                        <option value="user">User confirmation</option>
                        <option value="never">No confirmation</option>
                        <option value="staff">Staff approval</option>
                      </select>
                      <select
                        aria-label={`${tool.name} risk policy`}
                        value={policy.risk ?? "read"}
                        onChange={(event) => updatePolicy({ risk: event.target.value as "read" | "write" })}
                        className="h-8 rounded border border-[#DCE1E8] bg-white px-2 text-[12px]"
                      >
                        <option value="read">Read</option>
                        <option value="write">Write</option>
                      </select>
                      <input
                        aria-label={`${tool.name} max calls per turn`}
                        type="number"
                        min={1}
                        max={20}
                        value={policy.max_calls_per_turn ?? 3}
                        onChange={(event) => updatePolicy({ max_calls_per_turn: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })}
                        className="h-8 w-20 rounded border border-[#DCE1E8] px-2 text-[12px]"
                        title="Maximum calls per turn"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-[#475467]">
                    {(["chat", "voice", "webhook"] as const).map((channel) => {
                      const channels = policy.allowed_channels ?? ["chat", "voice", "webhook"];
                      return (
                        <label key={channel} className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={channels.includes(channel)}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...new Set([...channels, channel])]
                                : channels.filter((item) => item !== channel);
                              updatePolicy({ allowed_channels: next });
                            }}
                            className="accent-[#FF571A]"
                          />
                          {channel}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* One Unified Tool Browser matching 4.png */}
      <div className="bg-white border border-[#DCE1E8] rounded-[8px] overflow-hidden shadow-xs flex flex-col md:flex-row min-h-[460px]">
        {/* Left Category Rail (~230px wide desktop) */}
        <div className="w-full md:w-[230px] border-b md:border-b-0 md:border-r border-[#EAECF0] p-4 flex flex-col shrink-0 bg-white">
          <span className="text-[11px] font-semibold tracking-wider text-[#8B98A5] uppercase px-3 py-1">
            LIBRARY
          </span>

          <div className="mt-2 space-y-1">
            {/* All tools */}
            <button
              type="button"
              onClick={() => setCategory("all")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-[6px] text-[14px] font-medium transition-colors ${
                category === "all"
                  ? "bg-[#EEF0F3] text-[#202125] font-semibold"
                  : "text-[#475467] hover:bg-[#F8F9FA] hover:text-[#202125]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Grid className="w-4 h-4 text-[#667085]" />
                <span>All tools</span>
              </div>
              <span className="text-[12px] text-[#667085]">{allTools.length}</span>
            </button>

            {/* Web */}
            <button
              type="button"
              onClick={() => setCategory("web")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-[6px] text-[14px] font-medium transition-colors ${
                category === "web"
                  ? "bg-[#EEF0F3] text-[#202125] font-semibold"
                  : "text-[#475467] hover:bg-[#F8F9FA] hover:text-[#202125]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Globe className="w-4 h-4 text-[#667085]" />
                <span>Web</span>
              </div>
              <span className="text-[12px] text-[#667085]">{webTools.length}</span>
            </button>

            {/* Calendar & booking */}
            <button
              type="button"
              onClick={() => setCategory("calendar")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-[6px] text-[14px] font-medium transition-colors ${
                category === "calendar"
                  ? "bg-[#EEF0F3] text-[#202125] font-semibold"
                  : "text-[#475467] hover:bg-[#F8F9FA] hover:text-[#202125]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <CalendarDays className="w-4 h-4 text-[#667085]" />
                <span>Calendar &amp; booking</span>
              </div>
              <span className="text-[12px] text-[#667085]">{calendarTools.length}</span>
            </button>

            {/* Lead research */}
            <button
              type="button"
              onClick={() => setCategory("leads")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-[6px] text-[14px] font-medium transition-colors ${
                category === "leads"
                  ? "bg-[#EEF0F3] text-[#202125] font-semibold"
                  : "text-[#475467] hover:bg-[#F8F9FA] hover:text-[#202125]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Search className="w-4 h-4 text-[#667085]" />
                <span>Lead research</span>
              </div>
              <span className="text-[12px] text-[#667085]">{leadTools.length}</span>
            </button>

            <div className="pt-2 pb-1 border-t border-[#EAECF0] my-1" />

            {/* Connected integrations */}
            <button
              type="button"
              onClick={() => setCategory("integrations")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-[6px] text-[14px] font-medium transition-colors ${
                category === "integrations"
                  ? "bg-[#EEF0F3] text-[#202125] font-semibold"
                  : "text-[#475467] hover:bg-[#F8F9FA] hover:text-[#202125]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <LifeBuoy className="w-4 h-4 text-[#667085]" />
                <span>Integrations</span>
              </div>
              <span className="text-[12px] text-[#667085]">{integrationTools.length}</span>
            </button>

            {/* Custom tools */}
            <button
              type="button"
              onClick={() => setCategory("custom")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-[6px] text-[14px] font-medium transition-colors ${
                category === "custom"
                  ? "bg-[#EEF0F3] text-[#202125] font-semibold"
                  : "text-[#475467] hover:bg-[#F8F9FA] hover:text-[#202125]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Puzzle className="w-4 h-4 text-[#667085]" />
                <span>Custom tools</span>
              </div>
              <span className="text-[12px] text-[#667085]">{customTools.length}</span>
            </button>
          </div>
        </div>

        {/* Right Searchable Tools Pane */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Toolbar: Search input & All statuses dropdown */}
          <div className="p-4 border-b border-[#EAECF0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#98A2B3] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tools..."
                className="w-full pl-9 pr-8 h-10 rounded-[6px] border border-[#DCE1E8] bg-white text-[14px] text-[#202125] placeholder-[#98A2B3] focus:outline-none focus:border-[#FF571A] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#98A2B3] hover:text-[#202125]"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="relative shrink-0">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                aria-label="Filter by status"
                className="appearance-none pl-3 pr-8 h-10 rounded-[6px] border border-[#DCE1E8] bg-white text-[14px] text-[#202125] font-medium focus:outline-none focus:border-[#FF571A] cursor-pointer"
              >
                <option value="all">All statuses</option>
                <option value="attached">Attached</option>
                <option value="not_attached">Not attached</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#667085] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* List of tools */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#EAECF0]">
            {customToolsLoading && category === "custom" ? (
              <div className="p-8 text-center text-[#667085] text-[14px]">Loading tools...</div>
            ) : customToolsError && category === "custom" ? (
              <div className="p-6 text-center text-[#B42318] text-[14px]">{customToolsError}</div>
            ) : filteredTools.length === 0 ? (
              <div className="p-12 text-center text-[#667085] text-[14px]">
                No tools found matching your current filter.
              </div>
            ) : (
              filteredTools.map((tool) => {
                const isAttached = attachedTools.some((t) => t.name === tool.name);
                const info = FRIENDLY_NAMES[tool.name] || { label: tool.name, icon: Puzzle };
                const IconComponent = info.icon;

                return (
                  <div
                    key={tool.name}
                    className="p-4 sm:px-6 flex items-start justify-between gap-4 hover:bg-[#FAFBFB] transition-colors"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="w-9 h-9 rounded-[6px] bg-[#F2F4F7] text-[#667085] flex items-center justify-center shrink-0 mt-0.5">
                        <IconComponent className="w-4 h-4" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-[15px] font-semibold text-[#202125]">
                            {info.label}
                          </span>
                          <span className="font-mono text-[12px] text-[#667085]">
                            {tool.name}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[14px] text-[#667085] leading-relaxed">
                          {tool.description}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 pt-0.5">
                      {isAttached ? (
                        <div className="flex items-center gap-2">
                          <span className="hidden sm:inline-flex items-center gap-1 text-[13px] font-medium text-[#168A45]">
                            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                            Attached
                          </span>
                          <button
                            type="button"
                            onClick={() => onToggle(tool)}
                            className="px-3 py-1.5 rounded-[6px] text-[13px] font-medium border border-[#DCE1E8] bg-white text-[#B42318] hover:bg-red-50 hover:border-red-200 transition-colors shadow-xs"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onToggle(tool)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[13px] font-medium border border-[#DCE1E8] bg-white text-[#202125] hover:bg-[#F8F9FA] transition-colors shadow-xs"
                        >
                          <Plus className="w-3.5 h-3.5 text-[#667085]" />
                          <span>Attach</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer inside card matching 4.png: "6 tools available" */}
          <div className="px-6 py-3 border-t border-[#EAECF0] bg-white text-[13px] text-[#667085] shrink-0">
            {filteredTools.length} {filteredTools.length === 1 ? "tool" : "tools"} available
          </div>
        </div>
      </div>

      <CustomToolsModal
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        workspaceId={workspaceId}
        tool={null}
        secretNames={secretNames}
        onSaved={(tool) => {
          onCustomToolsChange([tool, ...customTools.filter((t) => t.id !== tool.id)]);
          setQuickAddOpen(false);
        }}
      />

      <AgentToolsManageDrawer
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        workspaceId={workspaceId}
        canManage={canManageCustomTools}
        onToolsChange={onCustomToolsChange}
      />
    </div>
  );
}
