import { fetchWithPolicy } from "@quickstart/utilities";
import type { AcquisitionProviderProfileConfig } from "../config/environment.js";
import { ProviderError } from "../domain/types.js";
import type { ScrapeProviderInput, ScrapeProviderOutput } from "../domain/types.js";
import type { AcquisitionProvider } from "./types.js";

type ApifyWebFetchItem = {
  url?: string;
  markdown?: string | null;
  text?: string | null;
  content?: string | null;
  metadata?: {
    canonicalUrl?: string | null;
    title?: string | null;
    description?: string | null;
    languageCode?: string | null;
  };
  fetch?: {
    httpStatusCode?: number;
    loadedUrl?: string;
  };
};

export class ApifyAcquisitionProvider implements AcquisitionProvider {
  readonly profileId: string;
  readonly driver = "apify";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(profile: AcquisitionProviderProfileConfig, timeoutMs: number) {
    this.profileId = profile.id;
    this.baseUrl = (profile.baseUrl ?? "https://api.apify.com").replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  private async customerKey(workspaceId: string): Promise<string> {
    const root = (process.env.SECRETS_URL ?? "http://127.0.0.1:3011").replace(/\/$/, "");
    const response = await fetch(`${root}/internal/workspaces/${encodeURIComponent(workspaceId)}/secrets/integration_apify_credentials/value`, {
      headers: { authorization: `Bearer ${process.env.SECRETS_INTERNAL_TOKEN ?? process.env.INTERNAL_TOKEN ?? ""}` },
      signal: AbortSignal.timeout(5000), redirect: "error",
    });
    if (!response.ok) throw new ProviderError("Workspace Apify connection required", { retryable: false, httpStatus: 409 });
    const body = await response.json() as { value?: string };
    const credentials = JSON.parse(body.value ?? "{}");
    const key = credentials.apiToken || credentials.apiKey || credentials.api_token || credentials.token;
    if (typeof key !== "string" || !key.trim()) throw new ProviderError("Workspace Apify credentials missing", { retryable: false, httpStatus: 409 });
    return key.trim();
  }

  async scrape(input: ScrapeProviderInput): Promise<ScrapeProviderOutput> {
    // Browser fallback; each call resolves the requesting workspace credential.
    const key = await this.customerKey(input.context.workspaceId);
    const endpoint = `${this.baseUrl}/v2/acts/apify~web-fetch/run-sync-get-dataset-items`;

    const response = await fetchWithPolicy(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          url: input.url,
        }),
      },
      { timeoutMs: this.timeoutMs, maxRetries: 0 },
    );

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(`apify scrape status ${response.status}`, {
        retryable,
        httpStatus: response.status,
      });
    }

    const items = (await response.json()) as ApifyWebFetchItem[];
    if (!Array.isArray(items) || items.length === 0) {
      throw new ProviderError("apify returned empty dataset", {
        retryable: false,
        httpStatus: 422,
      });
    }

    const item = items[0];
    const text = item.markdown?.trim() || item.text?.trim() || item.content?.trim() || "";
    if (!text) {
      throw new ProviderError("apify returned empty content for url", {
        retryable: false,
        httpStatus: 422,
      });
    }

    const finalUrl = item.metadata?.canonicalUrl ?? item.fetch?.loadedUrl ?? item.url ?? input.url;

    return {
      text,
      title: item.metadata?.title ?? undefined,
      finalUrl,
    };
  }

  async search(input: import("../domain/types.js").SearchProviderInput): Promise<import("../domain/types.js").SearchProviderOutput> {
    const key = await this.customerKey(input.context.workspaceId);
    const endpoint = `${this.baseUrl}/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items`;

    const response = await fetchWithPolicy(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          queries: input.query,
          maxPagesPerQuery: 1,
          resultsPerPage: Math.min(input.maxResults, 10),
        }),
      },
      { timeoutMs: this.timeoutMs, maxRetries: 0 },
    );

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(`apify search status ${response.status}`, {
        retryable,
        httpStatus: response.status,
      });
    }

    const items = (await response.json()) as Array<{
      organicResults?: Array<{ url?: string; title?: string; description?: string }>;
    }>;

    const results: Array<{ url: string; title: string; snippet: string }> = [];
    if (Array.isArray(items)) {
      for (const item of items) {
        for (const org of item.organicResults ?? []) {
          if (org.url) {
            results.push({
              url: org.url,
              title: org.title ?? "",
              snippet: org.description ?? "",
            });
          }
        }
      }
    }

    return { results: results.slice(0, input.maxResults) };
  }

  async enrichBusinessProfile(input: {
    workspaceId: string;
    businessName: string;
    location?: string;
    website?: string;
  }): Promise<EnrichedBusinessProfile | null> {
    const query = `${input.businessName} ${input.location ?? ""}`.trim();
    const key = await this.customerKey(input.workspaceId);
    const endpoint = `${this.baseUrl}/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items?timeout=25`;

    try {
      const response = await fetchWithPolicy(
        endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            searchStringsArray: [query],
            maxCrawledPlacesPerSearch: 1,
            language: "en",
          }),
        },
        { timeoutMs: 30000, maxRetries: 0 },
      );

      if (!response.ok) {
        return null;
      }

      const items = (await response.json()) as any[];
      if (!Array.isArray(items) || items.length === 0) {
        return null;
      }

      const expectedHost = input.website ? new URL(input.website).hostname.toLowerCase().replace(/^www\./, "") : null;
      const item = expectedHost ? items.find((candidate) => {
        try { return new URL(String(candidate.website)).hostname.toLowerCase().replace(/^www\./, "") === expectedHost; }
        catch { return false; }
      }) : items[0];
      if (!item) return null;
      return {
        title: item.title ?? undefined,
        address: item.address ?? undefined,
        street: item.street ?? undefined,
        city: item.city ?? undefined,
        state: item.state ?? undefined,
        postalCode: item.postalCode ?? undefined,
        countryCode: item.countryCode ?? undefined,
        phone: item.phone ?? item.phoneUnformatted ?? undefined,
        website: item.website ?? undefined,
        categoryName: item.categoryName ?? undefined,
        categories: Array.isArray(item.categories) ? item.categories : undefined,
        totalScore: typeof item.totalScore === "number" ? item.totalScore : undefined,
        reviewsCount: typeof item.reviewsCount === "number" ? item.reviewsCount : undefined,
        instagram: typeof item.instagram === "string" ? item.instagram : undefined,
      };
    } catch {
      return null;
    }
  }
}

export type EnrichedBusinessProfile = {
  title?: string;
  address?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
  phone?: string;
  website?: string;
  categoryName?: string;
  categories?: string[];
  totalScore?: number;
  reviewsCount?: number;
  instagram?: string;
};
