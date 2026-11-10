"use client";

import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  Globe,
  MapPin,
  Save,
  ShieldCheck,
  Target,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChipInput } from "@/components/ui/chip-input";
import { confirmProfileFacts, getProfile, putProfile } from "../lib/client";
import type { BusinessInput, LeadGenerationProfile } from "../lib/types";

const emptyBusiness = (): BusinessInput => ({
  name: "",
  website: "https://",
  description: "",
  offerings: [],
  target_categories: [],
  locations: [],
  products_or_services: [],
  selling_points: [],
  ideal_customer_profile: "",
  preferred_roles: [],
  exclusions: [],
  target_countries: [],
  target_industries: [],
});

export function LeadGenerationProfilePage({ workspaceId }: { workspaceId: string }) {
  const [profile, setProfile] = useState<LeadGenerationProfile | null>(null);
  const [business, setBusiness] = useState<BusinessInput>(emptyBusiness());
  const [error, setError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [confirmSuccess, setConfirmSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<"business" | "targets" | "sources">("business");

  // Track if user has made edits so polling does NOT overwrite dirty inputs
  const isDirtyRef = useRef(false);
  const isFetchingRef = useRef(false);

  const load = useCallback(
    async (isInitial = false) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      if (isInitial) setLoading(true);

      try {
        const res = await getProfile(workspaceId);
        if (res.error || !res.data) {
          if (isInitial) setError(res.error?.message ?? "Failed to load profile");
          return;
        }

        const p = res.data.profile;
        setProfile(p);

        // Only update input form values if not dirty or on initial load
        if (isInitial || !isDirtyRef.current) {
          const confirmed = p?.confirmed_facts as { confirmed_facts?: BusinessInput } | undefined;
          const supplied = (confirmed?.confirmed_facts || p?.supplied) as BusinessInput | undefined;
          const base = supplied ?? emptyBusiness();

          setBusiness({
            name: base.name || "",
            website: base.website || "https://",
            description: base.description || "",
            offerings: base.offerings ?? [],
            target_categories: base.target_categories ?? [],
            locations: base.locations ?? [],
            products_or_services: base.products_or_services ?? [],
            selling_points: base.selling_points ?? [],
            ideal_customer_profile: base.ideal_customer_profile || "",
            preferred_roles: base.preferred_roles ?? [],
            exclusions: base.exclusions ?? [],
            target_countries: base.target_countries ?? [],
            target_industries: base.target_industries ?? [],
          });
          if (isInitial) isDirtyRef.current = false;
        }
      } finally {
        if (isInitial) setLoading(false);
        isFetchingRef.current = false;
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const isResearching = profile?.research_status
    ? ["queued", "running"].includes(String(profile.research_status))
    : false;

  // Poll research status without wiping user's unsaved edits
  useEffect(() => {
    if (!isResearching) return;
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load(false);
    }, 3000);
    return () => clearInterval(t);
  }, [isResearching, load]);

  function updateField<K extends keyof BusinessInput>(field: K, value: BusinessInput[K]) {
    isDirtyRef.current = true;
    setSavedSuccess(false);
    setConfirmSuccess(false);
    setBusiness((prev) => ({ ...prev, [field]: value }));
  }

  function validateBusiness() {
    let message = "";
    let target: "business" | "targets" = "business";
    if (!business.name.trim()) message = "Company name is required.";
    else if (!business.description.trim()) message = "Company description is required.";
    else if (!business.target_categories.some((value) => value.trim())) {
      message = "At least one target category is required.";
      target = "targets";
    } else if (!business.locations.some((value) => value.trim())) {
      message = "At least one location is required.";
      target = "targets";
    }
    const website = business.website?.trim();
    if (!message && website && website !== "https://") {
      try {
        const url = new URL(website);
        if (!["https:", "http:"].includes(url.protocol) || !url.hostname.includes("."))
          throw new Error();
      } catch {
        message = "Enter a valid website URL, including https://, or leave it blank.";
      }
    }
    if (message) {
      setError(message);
      setSection(target);
      return false;
    }
    return true;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving || confirming) return;

    if (!validateBusiness()) return;
    const websiteClean = business.website?.trim() || "";

    setSaving(true);
    setError(null);
    setSavedSuccess(false);

    const body = {
      expected_version: Number(profile?.version ?? 0),
      business: {
        ...business,
        name: business.name.trim(),
        ...(websiteClean && websiteClean !== "https://" ? { website: websiteClean } : {}),
        description: business.description.trim(),
        offerings: business.offerings.map((s) => s.trim()).filter(Boolean),
        target_categories: business.target_categories.map((s) => s.trim()).filter(Boolean),
        locations: business.locations.map((s) => s.trim()).filter(Boolean),
        products_or_services: (business.products_or_services ?? [])
          .map((s) => s.trim())
          .filter(Boolean),
        selling_points: (business.selling_points ?? []).map((s) => s.trim()).filter(Boolean),
        ideal_customer_profile: (business.ideal_customer_profile ?? "").trim(),
        preferred_roles: (business.preferred_roles ?? []).map((s) => s.trim()).filter(Boolean),
        exclusions: (business.exclusions ?? []).map((s) => s.trim()).filter(Boolean),
        target_countries: (business.target_countries ?? []).map((s) => s.trim()).filter(Boolean),
        target_industries: (business.target_industries ?? []).map((s) => s.trim()).filter(Boolean),
      },
    };

    const res = await putProfile(workspaceId, body);
    setSaving(false);

    if (res.error || !res.data) {
      setError(res.error?.message ?? "Failed to save profile");
      return;
    }

    setProfile(res.data.profile);
    isDirtyRef.current = false;
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
    await load(false);
  }

  async function handleConfirmFacts() {
    if (saving || confirming || !validateBusiness()) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await confirmProfileFacts(workspaceId, {
        approved: true,
        confirmed_facts: { ...business },
        notes: "Approved by workspace user via portal",
      });
      if (res.data) {
        setProfile(res.data.profile);
        isDirtyRef.current = false;
        setConfirmSuccess(true);
        setTimeout(() => setConfirmSuccess(false), 4000);
      } else {
        setError(res.error?.message || "Failed to confirm facts");
      }
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-5xl">
        <div className="h-8 w-48 bg-neutral-100 rounded-8 animate-pulse" />
        <div className="h-96 bg-white border border-neutral-200 rounded-8 animate-pulse" />
      </div>
    );
  }

  const isResearchFailed = profile?.research_status === "failed";
  const isResearchReady = profile?.research_status === "ready";
  const hasSavedDetails = Boolean(profile?.supplied && (profile.supplied as BusinessInput).name);
  const isFactsConfirmed =
    !isDirtyRef.current &&
    Boolean(
      profile?.confirmed_facts && (profile.confirmed_facts as { approved?: boolean }).approved,
    );
  const hasResearchedFacts = Boolean(
    profile?.researched && Object.keys(profile.researched).length > 0,
  );

  return (
    <div className="lead-console lead-profile-redesign settings-page">
      <header className="settings-heading">
        <div className="settings-title">
          <Link
            className="settings-back"
            href={`/workspaces/${workspaceId}/lead-generation/runs`}
            title="Back to runs"
            aria-label="Back to runs"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1>Business profile</h1>
            <p>Your business, ideal customers and research defaults.</p>
          </div>
        </div>
        <button
          className="settings-button primary"
          type="submit"
          form="business-profile"
          disabled={saving || confirming}
        >
          <Save size={16} />
          {saving ? "Saving…" : "Save profile"}
        </button>
      </header>
      {!isFactsConfirmed && (hasResearchedFacts || isResearchReady) && (
        <div className="settings-notice">
          <div>
            <strong>Website findings need review</strong>
            <p>Review proposed findings before approving them for future runs.</p>
          </div>
          <button type="button" className="settings-button" onClick={() => setSection("sources")}>
            Review findings
          </button>
        </div>
      )}
      {isResearching && (
        <p role="status" className="settings-message">
          Website research is in progress. You can keep editing your profile.
        </p>
      )}
      {isResearchFailed && (
        <p role="status" className="settings-message">
          <AlertTriangle size={18} />
          Website research failed.
          {hasSavedDetails
            ? " Your saved details are still available."
            : " You can enter business details manually."}
        </p>
      )}
      {(savedSuccess || confirmSuccess) && (
        <p role="status" className="settings-message success">
          <Check size={17} />
          {confirmSuccess ? "Business facts approved." : "Profile saved."}
        </p>
      )}
      {error && (
        <p role="alert" className="settings-message error">
          <AlertCircle size={18} />
          {error}
        </p>
      )}
      <form id="business-profile" noValidate onSubmit={onSave} className="settings-workspace">
        <nav className="settings-rail" aria-label="Profile sections">
          {(
            [
              { id: "business", label: "Your business", icon: Building2 },
              { id: "targets", label: "Target prospects", icon: Target },
              { id: "sources", label: "Sources & approval", icon: ShieldCheck },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
          <p>Set up once. Reuse across research runs.</p>
        </nav>
        <div className="settings-content">
          <section
            hidden={section !== "business"}
            aria-label="Your business"
            className="settings-section space-y-6"
          >
            <div>
              <h2>Your business</h2>
              <p>Tell us what you offer and what makes it useful.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="profile-company-name"
                  className="block text-xs font-semibold text-neutral-800"
                >
                  Company name <span className="text-heat-100">*</span>
                </label>
                <input
                  id="profile-company-name"
                  type="text"
                  required
                  value={business.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="e.g. Acme Innovations"
                  className="w-full h-11 px-3.5 border border-neutral-300 rounded-8 bg-white text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-heat-100 focus:ring-1 focus:ring-heat-100 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="profile-website"
                  className="block text-xs font-semibold text-neutral-800"
                >
                  Website <span className="settings-optional">Optional</span>
                </label>
                <div className="relative">
                  <Globe className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                  <input
                    id="profile-website"
                    type="url"
                    value={business.website}
                    onChange={(e) => updateField("website", e.target.value)}
                    placeholder="https://example.com"
                    className="w-full h-11 pl-10 pr-3.5 border border-neutral-300 rounded-8 bg-white text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-heat-100 focus:ring-1 focus:ring-heat-100 transition-colors"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="profile-description"
                className="block text-xs font-semibold text-neutral-800"
              >
                Description <span className="text-heat-100">*</span>
              </label>
              <textarea
                required
                id="profile-description"
                rows={3}
                value={business.description}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="What does your company do and what value do you provide?"
                className="w-full p-3.5 border border-neutral-300 rounded-8 bg-white text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-heat-100 focus:ring-1 focus:ring-heat-100 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <ChipInput
                label="Core offerings"
                values={business.offerings}
                onChange={(vals) => updateField("offerings", vals)}
                placeholder="Add offering..."
                helperText="Add an offering and press Enter."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <ChipInput
                  label="Products / Services"
                  values={business.products_or_services ?? []}
                  onChange={(vals) => updateField("products_or_services", vals)}
                  placeholder="Add a product or service…"
                />
              </div>
              <div className="space-y-1.5">
                <ChipInput
                  label="Key Selling Points"
                  values={business.selling_points ?? []}
                  onChange={(vals) => updateField("selling_points", vals)}
                  placeholder="Add a selling point…"
                />
              </div>
            </div>

            <div className="settings-summary">
              <div className="settings-section-heading">
                <h3>Targeting defaults</h3>
                <button type="button" onClick={() => setSection("targets")}>
                  Edit targeting →
                </button>
              </div>
              <p>{business.target_categories.join(" · ") || "No categories added"}</p>
              <p>
                <MapPin size={15} />
                {business.locations.join(" · ") || "No locations added"}
              </p>
            </div>
          </section>
          <section
            hidden={section !== "targets"}
            aria-label="Target prospects"
            className="settings-section space-y-6"
          >
            <div>
              <h2>Target prospects</h2>
              <p>Define the customers you want to reach.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="profile-icp" className="block text-xs font-semibold text-neutral-800">
                Ideal Customer Profile (ICP)
              </label>
              <textarea
                id="profile-icp"
                rows={2}
                value={business.ideal_customer_profile ?? ""}
                onChange={(e) => updateField("ideal_customer_profile", e.target.value)}
                placeholder="Describe your ideal company characteristics, buying signals, or business needs..."
                className="w-full p-3.5 border border-neutral-300 rounded-8 bg-white text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-heat-100 focus:ring-1 focus:ring-heat-100 transition-colors"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <ChipInput
                  label="Target categories / industries"
                  required
                  values={business.target_categories}
                  onChange={(vals) => updateField("target_categories", vals)}
                  placeholder="Add category..."
                />
              </div>

              <div className="space-y-1.5">
                <ChipInput
                  label="Locations / Countries"
                  required
                  icon={MapPin}
                  values={business.locations}
                  onChange={(vals) => updateField("locations", vals)}
                  placeholder="Add location..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <ChipInput
                  label="Preferred Decision-Maker Roles"
                  icon={UserCheck}
                  values={business.preferred_roles ?? []}
                  onChange={(vals) => updateField("preferred_roles", vals)}
                  placeholder="e.g. VP Sales, Founder, CTO..."
                />
              </div>

              <div className="space-y-1.5">
                <ChipInput
                  label="Exclusions & Competitors"
                  values={business.exclusions ?? []}
                  onChange={(vals) => updateField("exclusions", vals)}
                  placeholder="e.g. competitor.com, agencies..."
                />
              </div>
            </div>
          </section>
          <section
            hidden={section !== "sources"}
            aria-label="Sources and approval"
            className="settings-section space-y-6"
          >
            <div>
              <h2>Sources & approval</h2>
              <p>Keep supplied details separate from proposed research findings.</p>
            </div>
            <div className="settings-source">
              <Building2 size={20} />
              <div>
                <h3>Supplied details</h3>
                <p>{profile?.supplied?.name || "No saved business details yet"}</p>
                <p>Business information supplied by your team.</p>
              </div>
            </div>
            <div className="settings-source">
              <Globe size={20} />
              <div>
                <h3>Website research</h3>
                <p>Status: {profile?.research_status || "Not started"}</p>
                <p>
                  Findings may include inferred details. Review the source data before approving.
                </p>
              </div>
            </div>
            {hasResearchedFacts && (
              <details className="settings-evidence">
                <summary>View research findings</summary>
                <pre>{JSON.stringify(profile?.researched, null, 2)}</pre>
              </details>
            )}
            <div className="settings-source">
              <ShieldCheck size={20} />
              <div>
                <h3>{isFactsConfirmed ? "Facts approved" : "Approval pending"}</h3>
                <p>
                  {isFactsConfirmed
                    ? "This profile has approved facts for qualification."
                    : "Approve the current business details after reviewing your profile and research."}
                </p>
                {!isFactsConfirmed && (
                  <button
                    className="settings-button"
                    type="button"
                    onClick={handleConfirmFacts}
                    disabled={confirming || saving}
                  >
                    {confirming ? "Approving…" : "Approve business facts"}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
        <footer className="settings-footer">
          <span>Changes apply to future runs.</span>
          <button className="settings-button primary" type="submit" disabled={saving || confirming}>
            <Save size={16} />
            {saving ? "Saving…" : "Save profile"}
          </button>
        </footer>
      </form>
    </div>
  );
}
