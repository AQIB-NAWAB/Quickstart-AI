"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import "@/features/marketing/styles/footer.css";
import { DeveloperResourceDialog, type DeveloperDialogType } from "@/features/marketing/sections/developers/developer-resource-dialog";

interface FooterNavLink {
  label: string;
  href?: string;
  resource?: "docs" | "api";
  hasArrow?: boolean;
}

interface FooterNavGroup {
  title: string;
  links: FooterNavLink[];
}

/**
 * Approved footer navigation links mapped to verified destinations in the project.
 * Developer resources reuse the existing local resource dialogs.
 * Legal links are omitted until actual legal pages exist.
 */
const FOOTER_NAV_GROUPS: FooterNavGroup[] = [
  {
    title: "Product",
    links: [
      { label: "Agents", href: "#builder" },
      { label: "Knowledge & memory", href: "#knowledge" },
      { label: "Voice calls", href: "#quality" },
      { label: "Lead generation", href: "#lead-generation" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    title: "Use cases",
    links: [
      { label: "Customer support", href: "#use-cases" },
      { label: "Appointment booking", href: "#use-cases" },
      { label: "Sales outreach", href: "#use-cases" },
      { label: "Website chat", href: "#channels" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", resource: "docs" },
      { label: "API reference", resource: "api" },
      { label: "Integrations", href: "#integrations" },
    ],
  },
  {
    title: "Explore",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "FAQ", href: "#faq" },
      { label: "Log in", href: "/request-access" },
      { label: "Request access", href: "/request-access", hasArrow: true },
    ],
  },
];

export function Footer() {
  const [resource, setResource] = useState<DeveloperDialogType>(null);
  const resourceTrigger = useRef<HTMLElement | null>(null);
  const closeResource = useCallback(() => setResource(null), []);
  const [currentYear, setCurrentYear] = useState<number>(2026);

  useEffect(() => {
    setCurrentYear(new Date().getFullYear());
  }, []);



  return (
    <footer className="marketing-footer" role="contentinfo">
      <BrandLogo className="marketing-footer-watermark" size="100%" fillColor="currentColor" aria-hidden="true" />
      <div className="marketing-footer-container">


        {/* ============================================================== */}
        {/* BAND A: UPPER NAVIGATION                                       */}
        {/* ============================================================== */}
        <div className="marketing-footer-upper">
          <nav aria-label="Footer navigation" className="marketing-footer-nav-grid">
            {/* Left Column: Compact Brand Introduction */}
            <div className="marketing-footer-brand-col">
              <Link
                href="/"
                className="marketing-footer-brand-link"
                aria-label="QuickStart AI home"
              >
                <BrandLogo size={38} aria-hidden="true" />
                <span className="marketing-footer-brand-wordmark">
                  QuickStart<span className="marketing-footer-brand-accent"> AI</span>
                </span>
              </Link>

            </div>

            {/* Right Columns: Four Navigation Groups */}
            {FOOTER_NAV_GROUPS.map((group) => (
              <div key={group.title} className="marketing-footer-group">
                <h3 className="marketing-footer-group-title">{group.title}</h3>
                <ul role="list" className="marketing-footer-list">
                  {group.links.map((link) => (
                    <li key={link.label} className="marketing-footer-item">
                      {link.resource ? (
                        <button
                          type="button"
                          className="marketing-footer-link"
                          aria-haspopup="dialog"
                          onClick={(event) => {
                            resourceTrigger.current = event.currentTarget;
                            setResource(link.resource ?? null);
                          }}
                        >{link.label}</button>
                      ) : (
                      <Link
                        href={link.href!}
                        className={`marketing-footer-link ${
                          link.hasArrow ? "marketing-footer-link--cta" : ""
                        }`}
                      >
                        <span>{link.label}</span>
                        {link.hasArrow && (
                          <svg
                            className="marketing-footer-link-arrow"
                            viewBox="0 0 12 12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M2.5 9.5L9.5 2.5M9.5 2.5H4M9.5 2.5V8" />
                          </svg>
                        )}
                      </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <hr className="marketing-footer-divider" aria-hidden="true" />
        <div className="marketing-footer-signature">
          <p className="marketing-footer-copyright">&copy; {currentYear} QuickStart AI</p>
          <div className="marketing-footer-wordmark" aria-hidden="true">
            <span>QuickStart</span>{" "}
            <span className="marketing-footer-wordmark-orange">AI</span>
          </div>
        </div>
      </div>
      <DeveloperResourceDialog type={resource} isOpen={resource !== null} onClose={closeResource} triggerRef={resourceTrigger} />
    </footer>
  );
}
