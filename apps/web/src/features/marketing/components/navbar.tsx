"use client";

import Link from "next/link";
import {
  ArrowRight, CalendarDays, ChevronDown, Database, Headphones,
  Menu, MessageCircle, Moon, Plug, ShieldCheck, Target, Users,
  Workflow, X, type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import "../styles/navbar.css";

type MenuName = "product" | "use-cases";
type NavigationItem = { label: string; description: string; href: string; icon: LucideIcon };

// Row order follows the approved two-column dropdown.
const menus: Record<MenuName, { label: string; items: NavigationItem[] }> = {
  product: {
    label: "Product",
    items: [
      { label: "Visual builder", description: "Build your agent’s workflow", href: "#builder", icon: Workflow },
      { label: "Human handoff", description: "Bring your team into the conversation", href: "#inbox", icon: Users },
      { label: "Knowledge & memory", description: "Give answers business context", href: "#knowledge", icon: Database },
      { label: "Integrations", description: "Connect your tools", href: "#integrations", icon: Plug },
      { label: "Chat & voice", description: "Meet customers where they are", href: "#channels", icon: MessageCircle },
      { label: "Security & control", description: "Manage workspace access", href: "#security", icon: ShieldCheck },
    ],
  },
  "use-cases": {
    label: "Use cases",
    items: [
      { label: "Customer support", description: "Answer everyday questions", href: "#use-case-customer-questions", icon: Headphones },
      { label: "Appointment booking", description: "Help customers book a time", href: "#use-case-appointment-booking", icon: CalendarDays },
      { label: "Lead generation", description: "Find businesses that fit", href: "#lead-generation", icon: Users },
      { label: "Sales outreach", description: "Start the next conversation", href: "#use-case-follow-up-call", icon: Target },
      { label: "Website chat", description: "Help visitors in the moment", href: "#channels", icon: MessageCircle },
      { label: "After-hours support", description: "Answer beyond business hours", href: "#use-case-after-hours", icon: Moon },
    ],
  },
};
const directLinks = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Developers", href: "#developers" },
  { label: "Pricing", href: "#pricing" },
];

export function Navbar() {
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const desktopTriggerRefs = useRef<Partial<Record<MenuName, HTMLButtonElement | null>>>({});
  const mobileTriggerRefs = useRef<Partial<Record<MenuName, HTMLButtonElement | null>>>({});
  const focusFirstItem = useRef(false);

  const closeAll = () => { setOpenMenu(null); setMobileOpen(false); };
  const activeGroup = activeSection === "use-cases" || activeSection === "lead-generation" || activeSection?.startsWith("use-case-")
    ? "use-cases"
    : ["builder", "inbox", "knowledge", "integrations", "channels", "security", "quality", "scale"].includes(activeSection ?? "")
      ? "product" : null;

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("main > section[id], main [id^='use-case-']"));
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 76;
      const probe = headerHeight + Math.min(160, window.innerHeight * .2);
      const current = sections.filter((section) => {
        const bounds = section.getBoundingClientRect();
        return bounds.top <= probe && bounds.bottom > headerHeight;
      }).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
      setActiveSection(current?.id ?? null);
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(update); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  useEffect(() => {
    // Mobile navigation scrolls internally; only page scrolling dismisses desktop menus.
    if (!openMenu || mobileOpen) return;
    const dismiss = () => {
      const panel = document.getElementById(`qs-desktop-${openMenu}`);
      if (panel?.contains(document.activeElement)) desktopTriggerRefs.current[openMenu]?.focus({ preventScroll: true });
      setOpenMenu(null);
    };
    window.addEventListener("scroll", dismiss, { passive: true });
    return () => window.removeEventListener("scroll", dismiss);
  }, [openMenu, mobileOpen]);


  useEffect(() => {
    if (!openMenu || !focusFirstItem.current) return;
    headerRef.current?.querySelector<HTMLAnchorElement>(`#qs-desktop-${openMenu} a`)?.focus();
    focusFirstItem.current = false;
  }, [openMenu]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setOpenMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openMenu) {
        event.preventDefault();
        (mobileOpen ? mobileTriggerRefs : desktopTriggerRefs).current[openMenu]?.focus();
        setOpenMenu(null);
      } else if (mobileOpen) {
        setMobileOpen(false);
        mobileToggleRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [openMenu, mobileOpen]);

  useEffect(() => {
    const breakpoint = window.matchMedia("(min-width: 1100px)");
    const reset = () => { setMobileOpen(false); setOpenMenu(null); };
    breakpoint.addEventListener("change", reset);
    return () => breakpoint.removeEventListener("change", reset);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const header = headerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const siblings = Array.from(header?.parentElement?.children ?? []).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== header
    );
    const inertStates = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(header?.querySelectorAll<HTMLElement>("a[href], button") ?? [])
        .filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      siblings.forEach((element, index) => { element.inert = inertStates[index]; });
      document.removeEventListener("keydown", trapFocus);
    };
  }, [mobileOpen]);

  function renderItems(name: MenuName) {
    return menus[name].items.map(({ label, description, href, icon: Icon }) => (
      <Link key={label} href={href} className="qs-nav-option" aria-current={href === `#${activeSection}` ? "location" : undefined} onClick={closeAll}>
        <span className="qs-nav-option-icon"><Icon size={20} strokeWidth={1.65} aria-hidden="true" /></span>
        <span className="qs-nav-option-copy">
          <span className="qs-nav-option-title">{label}</span>
          <span className="qs-nav-option-description">{description}</span>
        </span>
        <ArrowRight className="qs-nav-option-arrow" size={16} aria-hidden="true" />
      </Link>
    ));
  }

  return (
    <header ref={headerRef} className="qs-navbar" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenMenu(null);
    }}>
      <div className="landing-container qs-nav-bar">
        <Link href="/" className="qs-nav-brand" aria-label="QuickStart AI home" onClick={closeAll}>
          <BrandLogo size={34} animated fillColor="#fa5d19" aria-hidden="true" />
          <span>QuickStart<span className="qs-nav-brand-ai"> AI</span></span>
        </Link>
        <nav className="qs-nav-desktop" aria-label="Main navigation">
          {(Object.keys(menus) as MenuName[]).map((name) => (
            <div key={name} className="qs-nav-menu">
              <button ref={(element) => { desktopTriggerRefs.current[name] = element; }} type="button"
                className="qs-nav-link qs-nav-trigger" data-active={activeGroup === name} aria-expanded={openMenu === name}
                aria-controls={`qs-desktop-${name}`} onClick={() => setOpenMenu(openMenu === name ? null : name)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown") return;
                  event.preventDefault();
                  if (openMenu === name) headerRef.current?.querySelector<HTMLAnchorElement>(`#qs-desktop-${openMenu} a`)?.focus();
                  else { focusFirstItem.current = true; setOpenMenu(name); }
                }}>
                {menus[name].label}<ChevronDown size={13} aria-hidden="true" />
              </button>
              <div id={`qs-desktop-${name}`} className="qs-nav-dropdown"
                data-open={openMenu === name && !mobileOpen}
                aria-hidden={openMenu !== name || mobileOpen}
                ref={(element) => { if (element) element.inert = openMenu !== name || mobileOpen; }}
                aria-label={`${menus[name].label} links`}>
                {renderItems(name)}
                {name === "use-cases" && <Link href="#use-cases" className="qs-nav-view-all" onClick={closeAll}>View all use cases<ArrowRight size={15} aria-hidden="true" /></Link>}
              </div>
            </div>
          ))}
          {directLinks.map(({ label, href }) => <Link key={href} className="qs-nav-link" aria-current={href === `#${activeSection}` ? "location" : undefined} href={href} onClick={closeAll}>{label}</Link>)}
        </nav>
        <div className="qs-nav-account">
          <Link href="/request-access" className="qs-nav-link">Log in</Link>
          <Link href="/request-access" className="qs-nav-cta">Request access<ArrowRight size={17} aria-hidden="true" /></Link>
        </div>
        <button ref={mobileToggleRef} type="button" className="qs-nav-mobile-toggle"
          aria-expanded={mobileOpen} aria-controls="qs-mobile-navigation" aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => { setMobileOpen(!mobileOpen); setOpenMenu(null); }}>
          {mobileOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
        </button>
      </div>
      <nav id="qs-mobile-navigation" className="qs-nav-mobile" aria-label="Mobile navigation"
        data-open={mobileOpen} aria-hidden={!mobileOpen}
        ref={(element) => { if (element) element.inert = !mobileOpen; }}>
          {(Object.keys(menus) as MenuName[]).map((name) => (
            <div key={name} className="qs-nav-mobile-group">
              <button ref={(element) => { mobileTriggerRefs.current[name] = element; }} type="button" className="qs-nav-mobile-heading" data-active={activeGroup === name}
                aria-expanded={openMenu === name} aria-controls={`qs-mobile-${name}`}
                onClick={() => setOpenMenu(openMenu === name ? null : name)}>
                {menus[name].label}<ChevronDown size={16} aria-hidden="true" />
              </button>
              <div id={`qs-mobile-${name}`} className="qs-nav-mobile-reveal" data-open={openMenu === name}
                aria-hidden={openMenu !== name}
                ref={(element) => { if (element) element.inert = openMenu !== name; }}>
                <div className="qs-nav-mobile-reveal-inner">
                  <div className="qs-nav-mobile-options">{renderItems(name)}</div>
                  {name === "use-cases" && <Link href="#use-cases" className="qs-nav-view-all" onClick={closeAll}>View all use cases<ArrowRight size={15} aria-hidden="true" /></Link>}
                </div>
              </div>
            </div>
          ))}
          {directLinks.map(({ label, href }) => <Link key={href} className="qs-nav-mobile-heading" aria-current={href === `#${activeSection}` ? "location" : undefined} href={href} onClick={closeAll}>{label}</Link>)}
          <div className="qs-nav-mobile-account">
            <Link href="/request-access" className="qs-nav-link" onClick={closeAll}>Log in</Link>
            <Link href="/request-access" className="qs-nav-cta" onClick={closeAll}>Request access<ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
      </nav>
    </header>
  );
}
