import type {
  CrawlRequestBody,
  CrawlResponseBody,
  JobGetResponseBody,
  ScrapeRequestBody,
  ScrapeResponseBody,
  SearchRequestBody,
  SearchResponseBody,
} from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";
import type { Request, Response } from "@quickstart/http-server";
import { sendPlatformJson } from "@quickstart/http-server";
import type { JobRepository } from "../jobs/types.js";
import type { AcquisitionOrchestrator } from "../services/acquisition-orchestrator.js";

function parseScrapeBody(req: Request): ScrapeRequestBody {
  const body = req.body as Partial<ScrapeRequestBody>;
  if (!body.workspace_id || !body.request_id || !body.url) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "workspace_id, request_id, and url are required",
    });
  }
  return body as ScrapeRequestBody;
}

function parseCrawlBody(req: Request): CrawlRequestBody {
  const body = req.body as Partial<CrawlRequestBody>;
  if (!body.workspace_id || !body.request_id || !body.idempotency_key || !body.seed_url) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "workspace_id, request_id, idempotency_key, and seed_url are required",
    });
  }
  return body as CrawlRequestBody;
}

function parseSearchBody(req: Request): SearchRequestBody {
  const body = req.body as Partial<SearchRequestBody>;
  if (!body.workspace_id || !body.request_id || !body.query) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "workspace_id, request_id, and query are required",
    });
  }
  return body as SearchRequestBody;
}

export function createInternalController(
  orchestrator: AcquisitionOrchestrator,
  jobs: JobRepository,
) {
  return {
    scrape: async (req: Request, res: Response): Promise<void> => {
      const body = parseScrapeBody(req);
      const result: ScrapeResponseBody = await orchestrator.scrape(body);
      sendPlatformJson(res, 200, result);
    },

    crawl: async (req: Request, res: Response): Promise<void> => {
      const body = parseCrawlBody(req);
      const result: CrawlResponseBody = await orchestrator.enqueueCrawl(body);
      sendPlatformJson(res, 202, result);
    },

    search: async (req: Request, res: Response): Promise<void> => {
      const body = parseSearchBody(req);
      const result: SearchResponseBody = await orchestrator.search(body);
      sendPlatformJson(res, 200, result);
    },

    getJob: async (req: Request, res: Response): Promise<void> => {
      const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
      const workspaceId = (req.query.workspace_id as string | undefined) ?? undefined;
      if (!jobId) {
        throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "jobId required" });
      }
      const job = await jobs.getJob(jobId, workspaceId);
      if (!job) {
        throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Job not found" });
      }

      const artifact = job.artifactText ?? "";
      const preview =
        artifact.length > 500 ? `${artifact.slice(0, 500)}…` : artifact.length > 0 ? artifact : undefined;

      const payload: JobGetResponseBody = {
        job_id: job.id,
        workspace_id: job.workspaceId,
        status: job.status,
        pages_fetched: job.pagesFetched,
        error_code: job.errorCode,
        artifact_length: artifact.length,
        artifact_preview: preview,
      };
      sendPlatformJson(res, 200, payload);
    },

    enrichProfile: async (req: Request, res: Response): Promise<void> => {
      const body = req.body as {
        workspace_id: string;
        request_id: string;
        business_name: string;
        location?: string;
        website?: string;
      };
      if (!body.workspace_id || !body.business_name) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "workspace_id and business_name are required",
        });
      }
      const result = await orchestrator.enrichBusinessProfile({
        workspace_id: body.workspace_id,
        request_id: body.request_id || "enrich",
        business_name: body.business_name,
        location: body.location,
        website: body.website,
      });
      sendPlatformJson(res, 200, { profile: result });
    },
  };
}
