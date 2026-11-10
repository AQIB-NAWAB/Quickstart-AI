import { AppError } from "@quickstart/errors";
import { ApifyActorOrchestrator } from "./apify-orchestrator.js";
import { ResearchError } from "./research-error.js";
import { normalizeWebsite } from "./domain.js";
import type { Store, Task, Run } from "./store.js";

export type DiscoveredBusiness = {
  url: string;
  category: string;
  source_page?: { url: string; text: string };
  source_record?: Record<string, unknown>;
};

/** One durable, customer-funded Maps actor per search task; never replay uncertain creation. */
export class BusinessDiscovery {
  constructor(
    private readonly store: Store,
    private readonly apify = new ApifyActorOrchestrator(),
  ) {}

  async discover(t: Task, run: Run): Promise<DiscoveredBusiness[] | null> {
    const policy = run.brief.source_policy;
    const selected = policy?.preferred_sources ?? [];
    const mapsAllowed =
      !policy?.disallowed_sources?.includes("google_maps") &&
      (selected.length === 0 || selected.includes("google_maps"));
    if (!mapsAllowed) return null;
    const webAllowed =
      !policy?.disallowed_sources?.includes("web") &&
      (selected.length === 0 || selected.includes("web") || policy?.allow_fallback === true);
    const mapsRequired = !webAllowed;
    // One Maps batch; subsequent approved web rounds diversify discovery without paying for the same Maps batch again.
    if (Number(t.payload.round) !== 0) return mapsRequired ? [] : null;
    let token: string;
    try {
      token = await this.apify.resolveCustomerToken(t.workspace_id);
    } catch {
      if (mapsRequired) throw new ResearchError("APIFY_CONNECTION_REQUIRED");
      return null;
    }
    let saved = await this.store.sourceRun(t);
    if (!saved) {
      saved = await this.store.beginSourceRun(t, "compass~crawler-google-places");
      if (!saved) throw new ResearchError("SOURCE_PENDING", true, 5);
      const usage = await this.store.reserve(t, "apify.google_maps.start", 0);
      const limit = Math.min(
        50,
        run.policy_snapshot.max_candidates,
        Math.max(5, run.brief.target_count * 5),
      );
      try {
        const started = await this.apify.startActorRun(token, saved.actor_id, {
          searchStringsArray: [String(t.payload.category)],
          ...(run.brief.location ? { locationQuery: run.brief.location } : {}),
          maxCrawledPlacesPerSearch: limit,
          language: "en",
        });
        await this.store.saveSourceRun(t, "running", { ...started, offset: 0, limit, items: [] });
        await this.store.settle(usage, 0);
        throw new ResearchError("SOURCE_PENDING", true, 5);
      } catch (error) {
        if (error instanceof ResearchError && error.code === "SOURCE_PENDING") throw error;
        const details =
          error instanceof AppError && error.details && typeof error.details === "object"
            ? (error.details as Record<string, unknown>)
            : {};
        if (details.creation_rejected === true) {
          const code = `APIFY_START_REJECTED_HTTP_${details.upstream_status}`;
          await this.store.saveSourceRun(t, "failed", { error: code });
          throw new ResearchError(code);
        }
        await this.store.saveSourceRun(t, "uncertain", {
          error: "Creation outcome could not be safely confirmed; no automatic restart",
        });
        throw new ResearchError("APIFY_START_UNCERTAIN");
      }
    }
    if (saved.status === "starting" || saved.status === "uncertain")
      throw new ResearchError("APIFY_START_UNCERTAIN");
    const state = saved.state as {
      runId: string;
      datasetId: string;
      offset: number;
      limit: number;
      items: Record<string, unknown>[];
    };
    if (saved.status !== "succeeded") {
      const status = await this.apify.getActorRun(token, state.runId).catch(() => {
        throw new ResearchError("APIFY_STATUS_UNAVAILABLE", true, 5);
      });
      if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status.status)) {
        await this.store.saveSourceRun(t, "failed", { ...state, error: status.status });
        throw new ResearchError(`APIFY_RUN_${status.status}`);
      }
      if (status.status !== "SUCCEEDED") throw new ResearchError("SOURCE_PENDING", true, 5);
      const page = await this.apify
        .fetchDatasetItemsPaged(
          token,
          state.datasetId,
          state.offset,
          Math.min(100, state.limit - state.offset),
        )
        .catch(() => {
          throw new ResearchError("APIFY_DATASET_UNAVAILABLE", true, 5);
        });
      state.items.push(...page.items);
      state.offset += page.items.length;
      const complete =
        state.offset >= state.limit || page.items.length === 0 || state.offset >= page.total;
      await this.store.saveSourceRun(t, complete ? "succeeded" : "running", state);
      if (!complete) throw new ResearchError("SOURCE_PENDING", true, 1);
    }
    return state.items.flatMap((item) => {
      try {
        // Website-less records remain in the dataset; do not invent a company website.
        if (typeof item.website !== "string" || !item.website.trim()) return [];
        const url = normalizeWebsite(item.website);
        const sourceUrl =
          typeof item.url === "string" && item.url.startsWith("https://") ? item.url : url;
        const record = Object.fromEntries(
          Object.entries(item).filter(([key]) =>
            [
              "title",
              "website",
              "url",
              "placeId",
              "address",
              "city",
              "state",
              "countryCode",
              "phone",
              "phoneUnformatted",
              "categoryName",
              "categories",
              "permanentlyClosed",
            ].includes(key),
          ),
        );
        if (record.permanentlyClosed === true) return [];
        return [
          {
            url,
            category: String(t.payload.category),
            source_page: { url: sourceUrl, text: JSON.stringify(record) },
            source_record: record,
          },
        ];
      } catch {
        return [];
      }
    });
  }
}
