"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  PhoneOff,
  Search,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listConversations,
  listMessages,
  listWidgetLiveCalls,
  stopWidgetLiveCall,
  type WidgetLiveCall,
} from "@/features/inbox/lib/client";
import {
  conversationRef,
  conversationTitle,
  visitorIdentity,
  type Conversation,
  type ConversationState,
} from "@/features/inbox/lib/types";

const LIST_REFRESH_MS = 8000;

type Props = {
  workspaceId: string;
  isPreview?: boolean;
};

export function InboxSidebar({ workspaceId, isPreview = false }: Props) {
  const pathname = usePathname();
  const [filter, setFilter] = useState<"all" | ConversationState>("all");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [liveCalls, setLiveCalls] = useState<WidgetLiveCall[]>([]);
  const [stoppingLiveCallId, setStoppingLiveCallId] = useState<string | null>(null);
  const [messagePreviews, setMessagePreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const lastFetchedSeqRef = useRef<Record<string, number>>({});

  const handleStopLiveCall = useCallback(async (conversationId: string) => {
    setStoppingLiveCallId(conversationId);
    const result = await stopWidgetLiveCall(workspaceId, conversationId);
    if (result.error) {
      setError(result.error.message || "Could not stop this call.");
    } else {
      setLiveCalls((current) => current.filter((call) => call.conversation_id !== conversationId));
    }
    setStoppingLiveCallId(null);
  }, [workspaceId]);

  // Determine active conversation ID from URL
  const activeId = useMemo(() => {
    const prefix = isPreview ? "/preview/inbox/" : `/workspaces/${workspaceId}/inbox/`;
    if (!pathname.startsWith(prefix)) {
      return null;
    }
    const rest = pathname.slice(prefix.length).split("/")[0];
    return rest || null;
  }, [pathname, workspaceId, isPreview]);

  const load = useCallback(async () => {
    const { conversations: list, error: err } = await listConversations(workspaceId, { limit: 50 });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setError(null);
    const convs = list ?? [];
    setConversations(convs);

    const live = await listWidgetLiveCalls(workspaceId);
    setLiveCalls(live.calls ?? []);
    setLoading(false);

    // Fetch latest message previews only for conversations whose last_seq changed or missing
    const toFetch = convs
      .slice(0, 15)
      .filter((c) => lastFetchedSeqRef.current[c.id] !== c.last_seq);
    if (toFetch.length > 0) {
      const previews: Record<string, string> = {};
      await Promise.all(
        toFetch.map(async (c) => {
          try {
            const res = await listMessages(workspaceId, c.id, { afterSeq: Math.max(0, c.last_seq - 1), limit: 1 });
            if (res.messages && res.messages.length > 0) {
              previews[c.id] = res.messages[res.messages.length - 1]!.text;
            }
            lastFetchedSeqRef.current[c.id] = c.last_seq;
          } catch {
            // ignore preview fetch errors
          }
        }),
      );
      if (Object.keys(previews).length > 0) {
        setMessagePreviews((prev) => ({ ...prev, ...previews }));
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), LIST_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const hrefFor = useCallback(
    (conversationId: string) =>
      isPreview ? `/preview/inbox/${conversationId}` : `/workspaces/${workspaceId}/inbox/${conversationId}`,
    [isPreview, workspaceId],
  );

  const byId = useMemo(
    () => new Map(conversations.map((c) => [c.id, c])),
    [conversations],
  );

  // Tab counts
  const botCount = useMemo(() => conversations.filter((c) => c.state === "bot").length, [conversations]);
  const waitingCount = useMemo(() => conversations.filter((c) => c.state === "waiting").length, [conversations]);
  const humanCount = useMemo(() => conversations.filter((c) => c.state === "human").length, [conversations]);

  const query = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return conversations
      .filter((conversation) => {
        if (filter !== "all" && conversation.state !== filter) return false;
        if (!query) return true;
        const title = conversationTitle(conversation).toLowerCase();
        const email = (visitorIdentity(conversation)?.email ?? "").toLowerCase();
        const ref = conversationRef(conversation).toLowerCase();
        const preview = (messagePreviews[conversation.id] || "").toLowerCase();
        return title.includes(query) || email.includes(query) || ref.includes(query) || preview.includes(query);
      })
      .sort((a, b) => {
        const timeA = new Date(a.updated_at).getTime();
        const timeB = new Date(b.updated_at).getTime();
        return sortOrder === "newest" ? timeB - timeA : timeA - timeB;
      });
  }, [conversations, filter, query, sortOrder, messagePreviews]);

  // Format relative time concisely (2m, 5m, 1h, 2d)
  function formatConciseTime(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diffMs)) return "";
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  return (
    <aside
      className={clsx(
        activeId ? "hidden md:flex" : "flex",
        "relative shrink-0 overflow-hidden border-r border-[#E3E6EA] bg-white flex-col min-h-0 transition-[width] duration-200",
        collapsed ? "w-14" : "w-full md:w-[340px]",
      )}
    >
      {/* Collapsed State Bar */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-4 py-4 h-full">
          <button
            type="button"
            aria-label="Expand inbox"
            onClick={() => setCollapsed(false)}
            className="p-2 rounded-lg text-[#667085] hover:text-[#202125] hover:bg-[#F8F9FA] transition-colors"
          >
            <PanelLeftOpen className="w-5 h-5" />
          </button>
          <div className="w-7 h-7 rounded-full bg-[#FFF3EE] text-[#F15A24] flex items-center justify-center text-[12px] font-semibold">
            {conversations.length}
          </div>
          {liveCalls.length > 0 && (
            <div className="w-7 h-7 rounded-full bg-[#22C55E]/10 text-[#15803D] flex items-center justify-center text-[12px] font-semibold">
              <Phone className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-full min-h-0 w-full flex-col">
          {/* Header & Controls matching Images 1, 2, 3 */}
          <div className="p-5 pb-3 space-y-4 shrink-0">
            {/* Inbox title & conversation count */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-[24px] font-semibold text-[#202125] tracking-tight leading-tight">
                  Inbox
                </h1>
                <p className="text-[14px] text-[#667085] mt-0.5">
                  {conversations.length} {conversations.length === 1 ? "conversation" : "conversations"}
                </p>
              </div>
              <button
                type="button"
                aria-label="Collapse inbox list"
                onClick={() => setCollapsed(true)}
                className="p-1.5 rounded-md text-[#667085] hover:text-[#202125] hover:bg-[#F8F9FA] transition-colors mt-0.5"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>

            {/* Search input matching 40px height */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#667085] pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations..."
                aria-label="Search conversations"
                className="w-full pl-9 pr-8 h-10 text-[14px] text-[#202125] bg-white border border-[#E3E6EA] rounded-[6px] placeholder-[#667085] focus:outline-none focus:border-[#F15A24] transition-colors"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#667085] hover:text-[#202125]"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Horizontal Text-Tab Filters matching Images 1, 2, 3 */}
            <div className="flex items-center gap-4 text-[14px] border-b border-[#EDF0F2] pt-1 select-none">
              <button
                type="button"
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
                className={clsx(
                  "pb-2 min-h-10 font-medium transition-colors border-b-2",
                  filter === "all"
                    ? "text-[#F15A24] border-[#F15A24]"
                    : "text-[#667085] border-transparent hover:text-[#202125]",
                )}
              >
                All <span className="ml-0.5 text-[12px]">{conversations.length}</span>
              </button>
              <button
                type="button"
                aria-pressed={filter === "bot"}
                onClick={() => setFilter("bot")}
                className={clsx(
                  "pb-2 min-h-10 font-medium transition-colors border-b-2",
                  filter === "bot"
                    ? "text-[#F15A24] border-[#F15A24]"
                    : "text-[#667085] border-transparent hover:text-[#202125]",
                )}
              >
                Bot <span className="ml-0.5 text-[12px]">{botCount}</span>
              </button>
              <button
                type="button"
                aria-pressed={filter === "waiting"}
                onClick={() => setFilter("waiting")}
                className={clsx(
                  "pb-2 min-h-10 font-medium transition-colors border-b-2",
                  filter === "waiting"
                    ? "text-[#F15A24] border-[#F15A24]"
                    : "text-[#667085] border-transparent hover:text-[#202125]",
                )}
              >
                Waiting <span className="ml-0.5 text-[12px]">{waitingCount}</span>
              </button>
              <button
                type="button"
                aria-pressed={filter === "human"}
                onClick={() => setFilter("human")}
                className={clsx(
                  "pb-2 min-h-10 font-medium transition-colors border-b-2",
                  filter === "human"
                    ? "text-[#F15A24] border-[#F15A24]"
                    : "text-[#667085] border-transparent hover:text-[#202125]",
                )}
              >
                Human <span className="ml-0.5 text-[12px]">{humanCount}</span>
              </button>
            </div>
          </div>

          {/* Live Calls Section matching Images 1, 2, 3 */}
          <div className="px-5 py-4 border-b border-[#EDF0F2] bg-white shrink-0">
            <button
              type="button"
              aria-expanded={liveOpen}
              onClick={() => setLiveOpen((open) => !open)}
              className="flex w-full items-center justify-between text-left group"
            >
              <div className="flex items-center gap-2.5">
                <Phone className={`w-4 h-4 ${liveCalls.length > 0 ? "text-[#F15A24]" : "text-[#202125]"}`} />
                <span className="text-[14px] font-semibold text-[#202125]">Live calls</span>
              </div>
              <div className="flex items-center gap-1.5 text-[14px]">
                <span className={liveCalls.length > 0 ? "font-semibold text-[#F15A24]" : "text-[#F15A24]"}>
                  {liveCalls.length}
                </span>
                <ChevronRight
                  className={`w-4 h-4 text-[#667085] transition-transform ${liveOpen ? "rotate-90" : ""}`}
                />
              </div>
            </button>

            {liveOpen && (
              <div className="pt-2.5 pb-1 space-y-1.5">
                {liveCalls.length === 0 ? (
                  <p className="text-[12px] text-[#667085]">No live calls right now.</p>
                ) : (
                  <ul className="space-y-1 max-h-36 overflow-y-auto">
                    {liveCalls.map((call) => {
                      const conv = byId.get(call.conversation_id);
                      const isCallActive = activeId === call.conversation_id;
                      return (
                        <li key={call.conversation_id} className="flex items-center gap-1">
                          <Link
                            href={hrefFor(call.conversation_id)}
                            className={clsx(
                              "flex min-w-0 flex-1 items-center justify-between p-2 rounded-md text-[12px] transition-colors",
                              isCallActive
                                ? "bg-[#FFF3EE] text-[#202125] font-medium"
                                : "hover:bg-[#F8F9FA] text-[#202125]",
                            )}
                          >
                            <span className="truncate">
                              {conv ? conversationTitle(conv) : "Website visitor"}
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#22C55E]/10 text-[#15803D]">
                              Live
                            </span>
                          </Link>
                          {!isPreview && (
                            <button
                              type="button"
                              aria-label="Stop live call"
                              title="Stop call"
                              disabled={stoppingLiveCallId === call.conversation_id}
                              onClick={() => void handleStopLiveCall(call.conversation_id)}
                              className="shrink-0 rounded-md p-2 text-neutral-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                            >
                              <PhoneOff className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Conversations Section Header & Sort */}
          <div className="px-5 py-3 flex items-center justify-between bg-white shrink-0">
            <h2 className="text-[14px] font-semibold text-[#202125]">Conversations</h2>
            <button
              type="button"
              onClick={() => setSortOrder((prev) => (prev === "newest" ? "oldest" : "newest"))}
              className="inline-flex items-center gap-1 text-[14px] text-[#667085] hover:text-[#202125] transition-colors"
            >
              <span>{sortOrder === "newest" ? "Newest" : "Oldest"}</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Conversation Rows List (Continuous with dividers) */}
          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-[#EDF0F2]">
            {loading && conversations.length === 0 ? (
              <div className="p-6 text-center text-[14px] text-[#667085]">Loading conversations...</div>
            ) : null}

            {error ? (
              <div className="p-4 text-[14px] text-red-600 bg-red-50 m-4 rounded-md border border-red-200">
                {error}
              </div>
            ) : null}

            {!loading && filtered.length === 0 ? (
              <div className="p-8 text-center text-[14px] text-[#667085]">
                {query ? "No conversations match your search." : "No conversations found."}
              </div>
            ) : null}

            {filtered.map((c) => {
              const active = activeId === c.id;
              const title = conversationTitle(c);
              const preview =
                messagePreviews[c.id] ||
                (c.last_seq === 0 ? "No messages yet" : "Open conversation to read messages");
              const time = formatConciseTime(c.updated_at);
              const ref = conversationRef(c);

              return (
                <Link
                  key={c.id}
                  aria-current={active ? "page" : undefined}
                  href={hrefFor(c.id)}
                  className={clsx(
                    "block min-h-[112px] px-5 py-4 border-l-2 transition-colors relative cursor-pointer",
                    active
                      ? "bg-[#FFF3EE] border-l-[#F15A24]"
                      : "bg-white border-l-transparent hover:bg-[#F8F9FA]",
                  )}
                >
                  <div className="flex items-start gap-3">
                    {/* Visitor Avatar matching Images 1, 2, 3 */}
                    <div className="w-9 h-9 rounded-full bg-[#E4E7EC] text-[#667085] flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-4 h-4 stroke-[2]" />
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Top line: Name & relative time */}
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[15px] font-semibold text-[#202125] truncate leading-tight">
                          {title}
                        </span>
                        <span className="text-[12px] text-[#667085] shrink-0 font-normal">
                          {time}
                        </span>
                      </div>

                      {/* Middle line: Message preview */}
                      <p className="text-[14px] text-[#667085] truncate mt-1 leading-snug">
                        {preview}
                      </p>

                      {/* Bottom line: Channel reference & State badge */}
                      <div className="flex items-center justify-between mt-2.5">
                        <div className="flex items-center gap-1.5 text-[12px] text-[#667085]">
                          <MessageSquare className="w-3.5 h-3.5 stroke-[1.5] text-[#3B82F6]" />
                          <span className="font-mono text-[12px]">{ref}</span>
                        </div>

                        {/* State pill */}
                        <span
                          className={clsx(
                            "px-2 py-0.5 rounded-full text-[12px] font-medium border capitalize",
                            c.state === "bot"
                              ? "bg-[#F2F4F7] text-[#667085] border-[#E1E5EA]"
                              : c.state === "waiting"
                                ? "bg-[#FFF8ED] text-[#B54708] border-[#FCD9C7]"
                                : "bg-[#EDFDF2] text-[#15803D] border-[#B7F3C8]",
                          )}
                        >
                          {c.state === "bot" ? "Bot" : c.state === "waiting" ? "Waiting" : "Human"}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
