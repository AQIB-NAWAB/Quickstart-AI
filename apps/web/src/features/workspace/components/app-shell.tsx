"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Database,
  ChevronDown,
  Code2,
  ClipboardList,
  Compass,
  Cable,
  HelpCircle,
  LogOut,
  Menu,
  MessageSquare,
  Megaphone,
  Phone,
  Plus,
  Send,
  UsersRound,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { AgentOutlineIcon } from "@/components/brand/agent-outline-icon";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { NotificationsProvider } from "@/features/notifications/context/notifications-context";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";
import type { WorkspaceSummary } from "@/lib/server/workspace/workspaces";

type Props = {
  workspaceId: string;
  workspaceName: string;
  userEmail: string;
  workspaces: WorkspaceSummary[];
  organizations?: { id: string; name: string }[];
  activeOrgId?: string;
  isPreview?: boolean;
  children: React.ReactNode;
};

type NavItem = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string; size?: number | string }>;
  match?: string;
  exact?: boolean;
};

type NavSection = { label: string; items: NavItem[] };

export function AppShell({
  workspaceId,
  workspaceName,
  userEmail,
  workspaces,
  organizations,
  activeOrgId,
  isPreview = false,
  children,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const isInbox = pathname.includes("/inbox");
  const isCanvas = pathname.includes("/canvas");
  const isFullScreen = isInbox || isCanvas;
  const base = `/workspaces/${workspaceId}`;
  const route = (path: string) => (isPreview ? `/preview/${path}` : `${base}/${path}`);

  const sections: NavSection[] = [
    {
      label: "BUILD",
      items: [
        { name: "Agents", href: route("agents"), icon: AgentOutlineIcon, match: "/agents" },
        {
          name: "Evaluation",
          href: isPreview ? "/preview/eval" : `${base}/eval/datasets`,
          icon: ClipboardList,
          match: "/eval",
        },
        { name: "Knowledge", href: route("knowledge"), icon: BookOpen, match: "/knowledge" },
        { name: "Memory", href: route("memory"), icon: Database, match: "/memory" },
      ],
    },
    {
      label: "OPERATE",
      items: [
        { name: "Inbox", href: route("inbox"), icon: MessageSquare, match: "/inbox" },
        { name: "Leads", href: route("leads"), icon: UsersRound, match: "/leads" },
        {
          name: "Lead generation",
          href: route("lead-generation/runs"),
          icon: Compass,
          match: "/lead-generation",
        },
        {
          name: "Calls",
          href: route("voice/inbound"),
          icon: Phone,
          match: "/voice",
        },
        { name: "Campaigns", href: route("campaigns"), icon: Megaphone, match: "/campaigns" },
      ],
    },
    {
      label: "WORKSPACE",
      items: [
        { name: "Workflows", href: route("workflows"), icon: Workflow, match: "/workflows" },
        { name: "Analytics", href: route("analytics"), icon: BarChart3, match: "/analytics" },
        { name: "Audit", href: route("audit"), icon: ClipboardList, match: "/audit" },
        {
          name: "Notifications",
          href: isPreview ? "/preview/notifications" : `${base}/notifications`,
          icon: Send,
          match: "/notifications",
        },
        { name: "Integrations", href: route("integrations"), icon: Cable, match: "/integrations" },
        { name: "Developer", href: route("developer"), icon: Code2, match: "/developer" },
      ],
    },
  ];

  const navItems = sections.flatMap((section) => section.items);
  const activePath = isPreview ? pathname.replace("/preview", base) : pathname;

  const isItemActive = (item: NavItem) => {
    if (item.name === "Evaluation")
      return activePath.includes("/eval/") || activePath.endsWith("/eval");
    const href = isPreview ? item.href.replace(/^\/preview/, base) : item.href;
    if (item.exact) return activePath === href;
    if (
      item.name === "Agents" &&
      (activePath.includes("/agents") || activePath.includes("/agents/"))
    )
      return true;
    if (item.name === "Campaigns" && activePath.includes("/campaigns")) return true;
    if (item.name === "Calls" && activePath.includes("/voice")) return true;
    if (item.name === "Leads" && activePath.includes("/leads")) return true;
    if (item.name === "Lead generation" && activePath.includes("/lead-generation")) return true;
    return activePath.startsWith(item.match ? `${base}${item.match}` : href);
  };

  const activeItem = navItems.find(isItemActive) ?? navItems[0];

  useEffect(() => setMobileNavOpen(false), [pathname]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "QS";

  return (
    <NotificationsProvider workspaceId={workspaceId} isPreview={isPreview}>
      <div className="staff-shell min-h-screen bg-[#F8F9FB] text-[#202125] flex font-sans antialiased">
        {/* White Staff Navigation Sidebar matching Aqib's design with responsive md:flex */}
        <aside className="hidden md:flex flex-col w-64 border-r border-[#EAECF0] bg-white shrink-0 select-none sticky top-0 h-[100dvh]">
          {/* Top Brand Lockup */}
          <div className="h-16 px-6 flex items-center border-b border-[#EAECF0] shrink-0">
            <Link
              href={route("agents")}
              className="flex items-center gap-2 text-[17px] font-bold tracking-tight text-[#202125]"
            >
              <BrandLogo className="w-6 h-6 shrink-0" />
              <span>
                QuickStart<span className="text-[#FF571A]"> AI</span>
              </span>
            </Link>
          </div>

          {/* Grouped Destination Navigation */}
          <nav
            aria-label="Workspace sections"
            className="flex-1 overflow-y-auto px-3 py-4 space-y-5"
          >
            {sections.map((section) => (
              <section key={section.label}>
                <h2 className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8B98A5]">
                  {section.label}
                </h2>
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const ItemIcon = item.icon;
                    const active = isItemActive(item);
                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                          active
                            ? "bg-[#FFF4ED] text-[#FF571A] font-semibold"
                            : "text-[#344054] hover:bg-[#F9FAFB] hover:text-[#101828]"
                        }`}
                      >
                        <ItemIcon
                          className={`w-4 h-4 shrink-0 ${active ? "text-[#FF571A]" : "text-[#667085]"}`}
                        />
                        <span className="truncate">{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>

          {/* User Profile & Sign Out Footer */}
          <div className="p-4 border-t border-[#EAECF0] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-[#FFF4ED] border border-[#FFE2D4] text-[#FF571A] flex items-center justify-center font-semibold text-[11px] shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-[#202125] truncate">{userEmail}</p>
                <p className="text-[11px] text-[#667085]">Staff</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="text-[#667085] hover:text-[#B42318] p-2 rounded-md hover:bg-[#F9FAFB] transition-colors"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </aside>

        {/* Main Workspace Frame */}
        <div className="flex-1 flex flex-col min-w-0 h-[100dvh] overflow-hidden bg-[#F8F9FB]">
          {/* Top Bar with Workspace Switcher, Breadcrumb & Actions */}
          <header className="sticky top-0 z-20 shrink-0 border-b border-[#EAECF0] bg-white h-16 px-4 sm:px-6 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <button
                type="button"
                className="md:hidden p-2 rounded-lg border border-[#DCE1E8] text-[#667085] hover:bg-[#F8F9FA]"
                aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
                aria-expanded={mobileNavOpen}
                aria-controls="workspace-mobile-navigation"
                onClick={() => setMobileNavOpen((value) => !value)}
              >
                {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>

              {/* Workspace Switcher */}
              <div className="relative shrink-0" ref={workspaceMenuRef}>
                <button
                  type="button"
                  onClick={() => setWorkspaceMenuOpen((value) => !value)}
                  aria-expanded={workspaceMenuOpen}
                  aria-label="Switch workspace"
                  className="flex max-w-[240px] items-center gap-2 rounded-lg border border-[#DCE1E8] bg-white px-3 py-1.5 text-left hover:border-[#B6C0C9] hover:bg-[#F8F9FA] transition-colors"
                >
                  <span className="min-w-0 truncate text-[13px] font-semibold text-[#202125]">
                    {workspaceName}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-[#667085] transition-transform ${workspaceMenuOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {workspaceMenuOpen && (
                  <div className="absolute left-0 top-[calc(100%+6px)] z-30 max-h-72 w-64 overflow-auto rounded-lg border border-[#DCE1E8] bg-white py-1 shadow-lg">
                    <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#8B98A5] border-b border-[#EAECF0]">
                      Workspaces ({workspaces.length})
                    </div>
                    {workspaces.map((workspace) => {
                      const wsOrgId = workspace.orgId ?? workspace.org_id;
                      const orgName =
                        wsOrgId && organizations
                          ? organizations.find((o) => o.id === wsOrgId)?.name
                          : null;
                      return (
                        <Link
                          key={workspace.id}
                          href={`/workspaces/${workspace.id}/agents`}
                          onClick={() => setWorkspaceMenuOpen(false)}
                          className={`block px-3 py-2.5 text-[13px] font-medium hover:bg-[#F8F9FA] transition-colors ${
                            workspace.id === workspaceId
                              ? "bg-[#FFF4ED] font-semibold text-[#FF571A]"
                              : "text-[#202125]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{workspace.name}</span>
                            {orgName && organizations && organizations.length > 1 && (
                              <span className="text-[10px] text-[#8B98A5] shrink-0 truncate max-w-[80px]">
                                {orgName}
                              </span>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                    <div className="p-1 border-t border-[#EAECF0]">
                      <button
                        type="button"
                        onClick={() => {
                          setWorkspaceMenuOpen(false);
                          setCreateWorkspaceOpen(true);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] font-medium text-[#FF571A] hover:bg-[#FFF4ED] rounded-md transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Create new workspace</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="hidden sm:block w-[1px] h-5 bg-[#EAECF0] mx-1 shrink-0" />

              {/* Breadcrumb Path */}
              <div className="flex items-center gap-2 text-xs min-w-0 flex-1 truncate">
                <span className="text-[#8B98A5] font-normal hidden sm:inline">Workspace</span>
                <span className="text-[#DCE1E8] font-normal hidden sm:inline">/</span>
                <h1 className="font-bold text-[#202125] truncate text-xs sm:text-[14px]">
                  {activeItem.name}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href={route("developer")}
                className="p-2 text-[#667085] hover:text-[#202125] hover:bg-[#F8F9FA] rounded-md transition-colors"
                title="Documentation & help"
                aria-label="Documentation & help"
              >
                <HelpCircle className="w-5 h-5" />
              </Link>
              <NotificationBell workspaceId={workspaceId} isPreview={isPreview} />
            </div>
          </header>

          {/* Mobile Drawer Navigation */}
          {mobileNavOpen && (
            <nav
              id="workspace-mobile-navigation"
              aria-label="Workspace navigation"
              className="md:hidden fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-[#EAECF0] bg-white p-4 shadow-xl"
            >
              <div className="space-y-4">
                {sections.map((section) => (
                  <section key={section.label}>
                    <h2 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8B98A5]">
                      {section.label}
                    </h2>
                    <div className="grid grid-cols-2 gap-1.5">
                      {section.items.map((item) => {
                        const ItemIcon = item.icon;
                        const active = isItemActive(item);
                        return (
                          <Link
                            key={item.name}
                            href={item.href}
                            onClick={() => setMobileNavOpen(false)}
                            className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${
                              active
                                ? "bg-[#FFF4ED] text-[#FF571A] font-semibold"
                                : "text-[#344054] hover:bg-[#F9FAFB]"
                            }`}
                          >
                            <ItemIcon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                ))}
                <div className="pt-3 border-t border-[#EAECF0]">
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-medium text-[#B42318] bg-red-50 hover:bg-red-100 transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              </div>
            </nav>
          )}

          {/* Main Content Viewport */}
          <main
            className={`flex-1 min-w-0 flex flex-col ${
              isFullScreen ? "overflow-hidden" : "overflow-y-auto"
            }`}
          >
            <div
              className={
                isFullScreen
                  ? "flex-1 flex flex-col min-h-0 w-full h-full"
                  : "p-4 sm:p-6 lg:p-8 max-w-[1586px] w-full mx-auto"
              }
            >
              {children}
            </div>
          </main>
        </div>
      </div>

      <CreateWorkspaceDialog
        isOpen={createWorkspaceOpen}
        onClose={() => setCreateWorkspaceOpen(false)}
        organizations={organizations}
        defaultOrgId={activeOrgId}
      />
    </NotificationsProvider>
  );
}
