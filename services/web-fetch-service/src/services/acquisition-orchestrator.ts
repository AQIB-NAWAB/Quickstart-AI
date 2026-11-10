import type {
  CrawlRequestBody,
  CrawlResponseBody,
  ScrapeRequestBody,
  ScrapeResponseBody,
  SearchRequestBody,
  SearchResponseBody,
} from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";
import type { Logger } from "@quickstart/logging";
import { CircuitBreaker } from "@quickstart/utilities";
import type { WebFetchConfig } from "../config/environment.js";
import { ProviderError } from "../domain/types.js";
import type { UsageIngestClient } from "../clients/usage.client.js";
import type { DailyUnitBudget } from "../lib/daily-budget.js";
import type { InflightCap } from "../lib/inflight-cap.js";
import { logAcquisitionUsage } from "../lib/usage-logger.js";
import { assertHttpUrl, assertWorkspaceId } from "../lib/validate.js";
import type { CreateCrawlJobInput, JobRepository } from "../jobs/types.js";
import { decideAcquisitionProviders } from "../policy/decide.js";
import type { ProviderRegistry } from "../providers/registry.js";

export type ScrapeForJobInput = {
  workspaceId: string;
  requestId: string;
  url: string;
  renderJs: boolean;
};

export class AcquisitionOrchestrator {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly config: WebFetchConfig,
    private readonly registry: ProviderRegistry,
    private readonly inflight: InflightCap,
    private readonly budget: DailyUnitBudget,
    private readonly jobs: JobRepository,
    private readonly logger: Logger,
    private readonly usageIngest?: UsageIngestClient,
  ) {}

  async scrape(body: ScrapeRequestBody): Promise<ScrapeResponseBody> {
    assertWorkspaceId(body.workspace_id);
    assertHttpUrl(body.url);
    if (!body.request_id) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "request_id is required",
      });
    }

    const started = Date.now();
    await this.inflight.acquire();
    try {
      const result = await this.executeScrape({
        workspaceId: body.workspace_id,
        requestId: body.request_id,
        url: body.url,
        renderJs: body.render_js ?? false,
      });

      const profile = this.registry.listEnabledProfiles().find((p) => p.id === result.profileId);
      const unitCost = profile?.unitCostMicrosScrape ?? 0;

      logAcquisitionUsage(
        this.logger,
        {
          workspace_id: body.workspace_id,
          request_id: body.request_id,
          action: "scrape",
          provider: result.profileId,
          units: 1,
          estimated_cost_micros: unitCost,
          latency_ms: Date.now() - started,
        },
        this.usageIngest,
      );

      return {
        text: result.output.text,
        title: result.output.title,
        final_url: result.output.finalUrl,
        provider: result.profileId,
        usage: {
          action: "scrape",
          units: 1,
          estimated_cost_micros: unitCost,
        },
        latency_ms: Date.now() - started,
      };
    } finally {
      await this.inflight.release();
    }
  }

  async scrapeForJob(input: ScrapeForJobInput): Promise<{ text: string }> {
    const result = await this.executeScrape({
      workspaceId: input.workspaceId,
      requestId: input.requestId,
      url: input.url,
      renderJs: input.renderJs,
    });
    return { text: result.output.text };
  }

  async search(body: SearchRequestBody): Promise<SearchResponseBody> {
    assertWorkspaceId(body.workspace_id);
    if (!body.request_id || !body.query?.trim()) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "request_id and query are required",
      });
    }

    const maxResults = Math.min(
      body.max_results ?? this.config.searchMaxResultsCap,
      this.config.searchMaxResultsCap,
    );

    const decision = decideAcquisitionProviders({
      action: "search",
      renderJs: false,
      profiles: this.registry.listEnabledProfiles(),
    });
    if (!decision.allow) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Search unavailable: ${decision.reason}`,
      });
    }

    const started = Date.now();
    await this.inflight.acquire();
    try {
      await this.budget.reserve(1, body.workspace_id);

      let lastError: unknown;
      for (const profileId of decision.profileIds) {
        const provider = this.registry.get(profileId);
        if (!provider.search) continue;

        try {
          const output = await this.callWithBreaker(`${profileId}:search`, async () =>
            provider.search!({
              query: body.query,
              maxResults,
              context: {
                workspaceId: body.workspace_id,
                requestId: body.request_id,
                attempt: 1,
              },
            }),
          );

          const profile = this.registry.listEnabledProfiles().find((p) => p.id === profileId);
          const unitCost = profile?.unitCostMicrosSearch ?? 0;

          logAcquisitionUsage(
            this.logger,
            {
              workspace_id: body.workspace_id,
              request_id: body.request_id,
              action: "search",
              provider: profileId,
              units: 1,
              estimated_cost_micros: unitCost,
              latency_ms: Date.now() - started,
            },
            this.usageIngest,
          );

          return {
            results: output.results,
            provider: profileId,
            usage: {
              action: "search",
              units: 1,
              estimated_cost_micros: unitCost,
            },
            latency_ms: Date.now() - started,
          };
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new AppError({
            code: ErrorCode.UPSTREAM_UNAVAILABLE,
            message: "Search failed",
          });
    } finally {
      await this.inflight.release();
    }
  }

  async enqueueCrawl(body: CrawlRequestBody): Promise<CrawlResponseBody> {
    assertWorkspaceId(body.workspace_id);
    assertHttpUrl(body.seed_url, "seed_url");
    if (!body.request_id || !body.idempotency_key) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "request_id and idempotency_key are required",
      });
    }

    const maxPages = Math.min(
      body.max_pages ?? this.config.crawlMaxPagesCap,
      this.config.crawlMaxPagesCap,
    );
    const maxDepth = Math.min(
      body.max_depth ?? this.config.crawlMaxDepthCap,
      this.config.crawlMaxDepthCap,
    );

    const input: CreateCrawlJobInput = {
      workspaceId: body.workspace_id,
      seedUrl: body.seed_url,
      maxDepth,
      maxPages,
      renderJs: body.render_js ?? false,
      idempotencyKey: body.idempotency_key,
      requestId: body.request_id,
    };

    const job = await this.jobs.createCrawlJob(input);
    return { job_id: job.id, status: job.status };
  }

  private async executeScrape(input: {
    workspaceId: string;
    requestId: string;
    url: string;
    renderJs: boolean;
  }): Promise<{ profileId: string; output: { text: string; title?: string; finalUrl?: string } }> {
    const decision = decideAcquisitionProviders({
      action: "scrape",
      renderJs: input.renderJs,
      profiles: this.registry.listEnabledProfiles(),
    });

    if (!decision.allow) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Scrape unavailable: ${decision.reason}`,
      });
    }

    await this.budget.reserve(1, input.workspaceId);

    let lastError: unknown;
    let billed = false;

    for (const profileId of decision.profileIds) {
      let attempt = 0;
      const maxAttempts = this.registry.get(profileId).driver === "apify" ? 1 : 2;

      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          const provider = this.registry.get(profileId);
          const output = await this.callWithBreaker(`${profileId}:scrape`, async () =>
            provider.scrape({
              url: input.url,
              renderJs: input.renderJs,
              context: {
                workspaceId: input.workspaceId,
                requestId: input.requestId,
                attempt,
              },
            }),
          );

          if (!output.text.trim() && profileId !== decision.profileIds.at(-1)) {
            throw new ProviderError("empty scrape", { retryable: false, httpStatus: 422 });
          }

          billed = true;
          return { profileId, output };
        } catch (error) {
          lastError = error;
          const retryable = error instanceof ProviderError && error.retryable && !billed;
          if (retryable && attempt < maxAttempts) {
            continue;
          }
          break;
        }
      }
    }

    if (lastError instanceof AppError) {
      throw lastError;
    }
    if (lastError instanceof ProviderError) {
      throw new AppError({
        code:
          lastError.httpStatus === 504
            ? ErrorCode.UPSTREAM_TIMEOUT
            : ErrorCode.UPSTREAM_UNAVAILABLE,
        message: lastError.message,
        details: { retryable: lastError.retryable, upstream_status: lastError.httpStatus ?? null },
      });
    }
    throw new AppError({
      code: ErrorCode.UPSTREAM_UNAVAILABLE,
      message: "Scrape failed",
    });
  }

  private async callWithBreaker<T>(profileId: string, fn: () => Promise<T>): Promise<T> {
    let breaker = this.breakers.get(profileId);
    if (!breaker) {
      breaker = new CircuitBreaker({
        failureThreshold: this.config.circuitFailureThreshold,
        cooldownMs: this.config.circuitCooldownMs,
      });
      this.breakers.set(profileId, breaker);
    }

    try {
      return await breaker.execute(fn);
    } catch (error) {
      if (error instanceof Error && error.message === "CIRCUIT_OPEN") {
        throw new ProviderError(`circuit open for ${profileId}`, {
          retryable: true,
          httpStatus: 503,
        });
      }
      throw error;
    }
  }

  async enrichBusinessProfile(body: {
    workspace_id: string;
    request_id: string;
    business_name: string;
    location?: string;
    website?: string;
  }) {
    assertWorkspaceId(body.workspace_id);
    const provider = typeof this.registry.findDriver === "function" ? this.registry.findDriver("apify") : undefined;
    if (!provider || typeof provider.enrichBusinessProfile !== "function") {
      return null;
    }
    const started = Date.now();
    try {
      const result = await provider.enrichBusinessProfile({
        workspaceId: body.workspace_id,
        businessName: body.business_name,
        location: body.location,
        website: body.website,
      });
      this.logger.info("acquisition.enrich_profile", {
        workspace_id: body.workspace_id,
        request_id: body.request_id,
        provider: "apify",
        found: Boolean(result),
        latency_ms: Date.now() - started,
      });
      return result;
    } catch (error) {
      this.logger.warn("acquisition.enrich_profile_failed", {
        workspace_id: body.workspace_id,
        request_id: body.request_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
