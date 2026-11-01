import { AppError, ErrorCode } from "@quickstart/errors";
import type { AnalyticsResponse } from "@quickstart/contracts";
import type { AnalyticsRepository } from "../repository/analytics.repository.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AnalyticsService {
  constructor(private readonly repo: AnalyticsRepository) {}

  async getRollup(
    workspaceId: string,
    query: { from?: string; to?: string; timezone?: string; agentId?: string },
  ): Promise<AnalyticsResponse> {
    if (!UUID_REGEX.test(workspaceId)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Valid workspace UUID required",
      });
    }
    if (query.agentId && !UUID_REGEX.test(query.agentId)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "agent_id must be a valid UUID",
      });
    }

    const now = new Date();
    // Default to 7 days
    let to = query.to ? new Date(query.to) : now;
    let from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

    // If dates are YYYY-MM-DD strings without time, normalize UTC
    if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
      to = new Date(`${query.to}T23:59:59.999Z`);
    }
    if (query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from)) {
      from = new Date(`${query.from}T00:00:00.000Z`);
    }

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "from and to must be valid timestamps",
      });
    }

    if (from >= to) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "from timestamp must be strictly before to timestamp",
      });
    }

    const maxIntervalMs = 366 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > maxIntervalMs) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Date range cannot exceed 366 days",
      });
    }

    return this.repo.getWorkspaceAnalytics(workspaceId, {
      from,
      to,
      timezone: query.timezone ?? "UTC",
      agentId: query.agentId,
    });
  }
}
