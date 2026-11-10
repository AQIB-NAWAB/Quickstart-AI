/**
 * Formatting helpers for Lead Generation runs, candidates, and drawer views.
 */

export function formatStatusLabel(status?: string | null): string {
  if (!status) return "Unknown";
  switch (status.toLowerCase()) {
    case "completed":
      return "Completed";
    case "completed_with_errors":
      return "Completed with errors";
    case "running":
      return "Running";
    case "queued":
      return "Queued";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Rejected";
    case "duplicate":
      return "Duplicate";
    case "skipped":
      return "Skipped";
    default:
      return status
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function formatResearchTarget(categories: string[]): string {
  const first = categories[0];
  const second = categories[1];
  if (!first) return "Research run";
  if (!second) return first;
  if (/\s+brands$/i.test(first) && /\s+brands$/i.test(second)) {
    return `${first.replace(/\s+brands$/i, "")} & ${second.toLowerCase()}`;
  }
  return `${first} & ${second}`;
}

export function formatStopReason(reason?: string | null): string | null {
  if (!reason) return null;
  const normalized = reason.toLowerCase().trim();
  switch (normalized) {
    case "provider_quota_exhausted":
      return "AI provider quota exhausted. Retry after its allowance resets or connect a funded provider";
    case "user_cancelled":
      return "Cancelled by user";
    case "research_round_limit":
      return "Configured research rounds finished before the target was met";
    case "research_errors":
      return "Research finished with provider or task errors";
    case "sources_exhausted":
      return "Configured discovery finished";
    case "budget_reached":
      return "Research budget reached";
    case "target_reached":
      return "Target candidate count reached";
    case "cancelled":
      return "Research run cancelled";
    case "completed":
      return "All research tasks completed";
    case "timed_out":
      return "Execution time limit reached";
    default:
      return reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function formatFieldLabel(key: string): string {
  if (!key) return "";
  const cleaned = key.trim().replace(/_/g, " ");
  // Custom acronyms or special labels
  if (/^address\s*\d*$/i.test(cleaned)) {
    return cleaned.replace(/^address\s*(\d+)$/i, "Address $1").replace(/^address$/i, "Address");
  }
  if (cleaned.toLowerCase() === "company name") return "Company name";
  if (cleaned.toLowerCase() === "phone") return "Phone";
  if (cleaned.toLowerCase() === "email") return "Email";
  if (cleaned.toLowerCase() === "location") return "Location";
  if (cleaned.toLowerCase() === "website") return "Website";
  if (cleaned.toLowerCase() === "category") return "Category";
  if (cleaned.toLowerCase() === "services") return "Services";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function formatFitScore(score?: number | null): string {
  if (score === undefined || score === null || !Number.isFinite(score)) return "—";
  return `${Math.round(score)} / 100`;
}

export function cleanDomain(url?: string | null): string {
  if (!url) return "";
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

export function ensureAbsoluteUrl(url?: string | null): string {
  if (!url) return "#";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}
