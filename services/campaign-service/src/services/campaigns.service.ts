import { AppError, ErrorCode } from "@quickstart/errors";
import type { CampaignLeadDelivery } from "@quickstart/contracts";
import type {
  AudienceFieldDef,
  CampaignAttempt,
  CampaignDetail,
  CampaignPacing,
  CampaignRecord,
  CampaignRetryPolicy,
  CampaignSchedule,
  CampaignTimezoneMode,
  CampaignsDirectorySummary,
  CampaignStatus,
  CampaignSummary,
  CampaignTarget,
  IncomingTarget,
} from "../domain/types.js";
import type { CampaignsRepository } from "../repository/campaigns.repository.js";
import {
  assertAudienceSchemaHasDial,
  assertAudienceSchemaHasReachableContact,
  normalizeAudienceSchema,
  normalizeIncomingTargets,
  sanitizeAttributes,
  schemaUsesTelephony,
  syntheticDialFromKey,
} from "../utils/audience.js";
import { isValidE164, normalizePhone } from "../utils/phone.js";
import { isValidIanaTimezone } from "../utils/schedule-window.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TERMINAL_FOR_CONTROL = new Set<CampaignStatus>(["completed", "failed"]);

function defaultSchedule(): CampaignSchedule {
  const today = new Date().toISOString().slice(0, 10);
  return {
    startDate: today,
    startTime: "09:00",
    timezone: "UTC",
    dailyWindowFrom: "09:00",
    dailyWindowTo: "17:00",
    timezoneMode: "campaign",
    weekdays: ["mon", "tue", "wed", "thu", "fri"],
  };
}

function defaultRetry(): CampaignRetryPolicy {
  return {
    maxRetries: 2,
    retryIntervalMinutes: 30,
    eligibleOutcomes: ["no_answer", "busy"],
  };
}

export class CampaignsService {
  constructor(
    private readonly repo: CampaignsRepository,
    private readonly limits: {
      maxTargetsPerImport: number;
      maxAttributeKeys: number;
      maxAttributeValueLength: number;
      defaultMaxConcurrentCalls: number;
      defaultMaxStartsPerMinute: number;
    },
  ) {}

  list(workspaceId: string, filters?: { q?: string; status?: string }): Promise<CampaignSummary[]> {
    return this.repo.list(workspaceId, filters);
  }

  directorySummary(workspaceId: string): Promise<CampaignsDirectorySummary> {
    return this.repo.directorySummary(workspaceId);
  }

  async getDetail(workspaceId: string, campaignId: string): Promise<CampaignDetail> {
    const campaign = await this.requireCampaign(workspaceId, campaignId);
    const metrics = await this.repo.metrics(workspaceId, campaignId);
    return toDetail(campaign, metrics);
  }

  async create(
    workspaceId: string,
    body: {
      name?: string;
      description?: string | null;
      agent_id?: string;
      agent_name?: string;
      caller_id?: string | null;
      agent_version_id?: string | null;
      timezone_mode?: CampaignTimezoneMode;
      weekdays?: string[] | number[];
      audience_schema?: unknown;
      schedule?: Partial<CampaignSchedule>;
      pacing?: Partial<CampaignPacing>;
      retry_policy?: Partial<CampaignRetryPolicy>;
      idempotency_key?: string | null;
      targets?: IncomingTarget[];
      status?: CampaignStatus;
    },
  ): Promise<CampaignDetail> {
    const name = body.name?.trim();
    if (!name) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "name is required" });
    }
    const agentId = body.agent_id?.trim();
    if (!agentId || !UUID_RE.test(agentId)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "agent_id must be a valid UUID",
      });
    }

    if (body.idempotency_key) {
      const existing = await this.repo.getByIdempotencyKey(workspaceId, body.idempotency_key);
      if (existing) {
        return this.getDetail(workspaceId, existing.id);
      }
    }

    let audienceSchema = normalizeAudienceSchema(body.audience_schema);
    if (audienceSchema.length === 0) {
      audienceSchema = [
        { key: "phone", label: "Phone", role: "dial", required: true },
        { key: "name", label: "Name", role: "identity" },
        { key: "email", label: "Email", role: "contact_email" },
      ];
    }
    const telephonyRequired = schemaUsesTelephony(audienceSchema);
    if (telephonyRequired) assertAudienceSchemaHasDial(audienceSchema);
    else assertAudienceSchemaHasReachableContact(audienceSchema);

    const schedule: CampaignSchedule = {
      ...defaultSchedule(),
      ...(body.schedule ?? {}),
      timezoneMode: body.timezone_mode ?? body.schedule?.timezoneMode ?? "campaign",
      weekdays: body.weekdays ?? body.schedule?.weekdays ?? ["mon", "tue", "wed", "thu", "fri"],
    };
    const pacing: CampaignPacing = {
      maxConcurrentCalls:
        body.pacing?.maxConcurrentCalls ?? this.limits.defaultMaxConcurrentCalls,
      maxCallStartsPerMinute:
        body.pacing?.maxCallStartsPerMinute ?? this.limits.defaultMaxStartsPerMinute,
    };
    const retryPolicy = { ...defaultRetry(), ...(body.retry_policy ?? {}) };

    const status: CampaignStatus = body.status === "scheduled" ? "scheduled" : "draft";
    const scheduledStart = parseScheduledStart(schedule);

    const campaign = await this.repo.create({
      workspaceId,
      name,
      description: body.description ?? null,
      agentId,
      agentName: body.agent_name?.trim() || "Agent",
      callerId: body.caller_id ?? null,
      agentVersionId: body.agent_version_id ?? null,
      timezoneMode: schedule.timezoneMode ?? "campaign",
      weekdays: schedule.weekdays ?? ["mon", "tue", "wed", "thu", "fri"],
      status,
      audienceSchema,
      schedule,
      pacing,
      retryPolicy,
      idempotencyKey: body.idempotency_key ?? null,
      scheduledStart,
    });

    if (body.targets?.length) {
      await this.importTargets(workspaceId, campaign.id, body.targets, audienceSchema, {
        telephonyRequired,
      });
    }

    return this.getDetail(workspaceId, campaign.id);
  }

  async updateDraft(
    workspaceId: string,
    campaignId: string,
    expectedVersion: number,
    patch: {
      name?: string;
      description?: string | null;
      agent_id?: string;
      agent_name?: string;
      caller_id?: string | null;
      agent_version_id?: string | null;
      timezone_mode?: CampaignTimezoneMode;
      weekdays?: string[] | number[];
      schedule?: CampaignSchedule;
      pacing?: CampaignPacing;
      retry_policy?: CampaignRetryPolicy;
    },
  ): Promise<CampaignDetail> {
    await this.repo.updateDraft(workspaceId, campaignId, expectedVersion, {
      name: patch.name,
      description: patch.description,
      agentId: patch.agent_id,
      agentName: patch.agent_name,
      callerId: patch.caller_id,
      agentVersionId: patch.agent_version_id,
      timezoneMode: patch.timezone_mode,
      weekdays: patch.weekdays,
      schedule: patch.schedule,
      pacing: patch.pacing,
      retryPolicy: patch.retry_policy,
    });
    return this.getDetail(workspaceId, campaignId);
  }

  async delete(workspaceId: string, campaignId: string): Promise<void> {
    const campaign = await this.requireCampaign(workspaceId, campaignId);
    if (campaign.status === "running") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Cannot delete an actively running campaign; pause or stop it first",
      });
    }
    await this.repo.deleteCampaign(workspaceId, campaignId);
  }

  /**
   * Internal ingest for lead-generation `CampaignLeadDelivery`.
   * Idempotent on `idempotency_key` via `source_ref`.
   */
  async ingestLeadDelivery(payload: CampaignLeadDelivery): Promise<{
    workspace_id: string;
    idempotency_key: string;
    campaign_lead_id: string;
  }> {
    if (payload.schema_version !== 1) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "schema_version must be 1",
      });
    }
    if (!UUID_RE.test(payload.workspace_id) || !UUID_RE.test(payload.campaign_id)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "workspace_id and campaign_id must be UUIDs",
      });
    }
    if (!payload.idempotency_key?.trim()) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "idempotency_key is required",
      });
    }

    const campaign = await this.requireCampaign(payload.workspace_id, payload.campaign_id);
    if (campaign.status === "completed" || campaign.status === "failed") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Cannot ingest leads into a finished campaign",
      });
    }

    const existing = await this.repo.getTargetBySourceRef(
      payload.workspace_id,
      payload.campaign_id,
      payload.idempotency_key,
    );
    if (existing) {
      return {
        workspace_id: payload.workspace_id,
        idempotency_key: payload.idempotency_key,
        campaign_lead_id: existing.id,
      };
    }

    const phone = normalizePhone(payload.lead.phone ?? "");
    const dialNormalized = isValidE164(phone)
      ? phone
      : syntheticDialFromKey(payload.lead_id);
    const target = await this.repo.insertTargetReturning(
      payload.workspace_id,
      payload.campaign_id,
      {
        dialAddress: dialNormalized,
        dialNormalized,
        displayName: payload.lead.company_name || payload.lead.person_name || null,
        email: payload.lead.email,
        attributes: sanitizeAttributes(
          {
            website: payload.lead.website ?? "",
            category: payload.lead.category,
            location: payload.lead.location ?? "",
            fit_score: String(payload.lead.fit_score),
            lg_lead_id: payload.lead_id,
            lg_run_id: payload.run_id,
          },
          {
            maxKeys: this.limits.maxAttributeKeys,
            maxValueLength: this.limits.maxAttributeValueLength,
          },
        ),
        sourceKind: "lead",
        sourceRef: payload.idempotency_key,
      },
    );

    return {
      workspace_id: payload.workspace_id,
      idempotency_key: payload.idempotency_key,
      campaign_lead_id: target.id,
    };
  }

  async importTargets(
    workspaceId: string,
    campaignId: string,
    targets: IncomingTarget[],
    schema?: AudienceFieldDef[],
    options?: { telephonyRequired?: boolean },
  ): Promise<{ inserted: number; invalidCount: number; duplicateCount: number }> {
    const campaign = await this.requireCampaign(workspaceId, campaignId);
    if (campaign.status === "completed" || campaign.status === "failed") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Cannot import targets into a finished campaign",
      });
    }
    if (targets.length > this.limits.maxTargetsPerImport) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `At most ${this.limits.maxTargetsPerImport} targets per import`,
      });
    }

    const telephonyRequired =
      options?.telephonyRequired ?? (schema?.length ? schemaUsesTelephony(schema) : true);
    if (schema?.length) {
      if (telephonyRequired) assertAudienceSchemaHasDial(schema);
      else assertAudienceSchemaHasReachableContact(schema);
    }

    const normalized = normalizeIncomingTargets(
      targets,
      {
        maxKeys: this.limits.maxAttributeKeys,
        maxValueLength: this.limits.maxAttributeValueLength,
      },
      { telephonyRequired },
    );
    const isRecipientLocal = campaign.timezoneMode === "recipient_local";
    const targetsToInsert = [];
    for (const item of normalized.valid) {
      let isHeld = false;
      let heldReason: string | null = null;
      let tz = item.timezone;
      let provenance = "provided";

      if (isRecipientLocal) {
        if (!tz || !isValidIanaTimezone(tz)) {
          isHeld = true;
          heldReason = "unknown_timezone";
          provenance = "unknown";
          tz = null;
        }
      } else {
        tz = campaign.schedule.timezone || "UTC";
      }

      targetsToInsert.push({
        ...item,
        timezone: tz,
        timezoneProvenance: provenance,
        isHeld,
        heldReason,
      });
    }

    const inserted = await this.repo.insertTargets(workspaceId, campaignId, targetsToInsert);
    return {
      inserted,
      invalidCount: normalized.invalidCount,
      duplicateCount: normalized.duplicateCount + (normalized.valid.length - inserted),
    };
  }

  async exportCsv(workspaceId: string, campaignId: string): Promise<string> {
    await this.requireCampaign(workspaceId, campaignId);
    const rows = await this.repo.exportResults(workspaceId, campaignId);
    if (rows.length === 0) {
      return "phone,name,email,timezone,status,attempts_count,latest_outcome,duration_seconds,call_id\r\n";
    }

    const standardHeaders = [
      "phone",
      "name",
      "email",
      "timezone",
      "status",
      "attempts_count",
      "latest_outcome",
      "duration_seconds",
      "call_id",
      "created_at",
    ];

    const allKeys = new Set<string>(standardHeaders);
    for (const r of rows) {
      for (const k of Object.keys(r)) {
        if (k !== "id") allKeys.add(k);
      }
    }
    const headerList = Array.from(allKeys);
    const lines: string[] = [];
    lines.push(headerList.map(escapeCsvValue).join(","));

    for (const r of rows) {
      const line = headerList.map((h) => escapeCsvValue(r[h] ?? "")).join(",");
      lines.push(line);
    }

    // Formula injection protection + UTF-8 BOM
    return "\uFEFF" + lines.join("\r\n");
  }

  async launch(workspaceId: string, campaignId: string, expectedVersion?: number): Promise<CampaignDetail> {
    const campaign = await this.requireCampaign(workspaceId, campaignId);
    this.assertVersion(campaign, expectedVersion);
    if (!["draft", "scheduled", "paused"].includes(campaign.status)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Cannot launch campaign in status ${campaign.status}`,
      });
    }
    const count = await this.repo.countTargets(workspaceId, campaignId);
    if (count === 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Campaign requires at least one target",
      });
    }
    await this.repo.updateStatus(workspaceId, campaignId, campaign.version, {
      status: "running",
      startedAt: campaign.startedAt ?? new Date(),
    });
    return this.getDetail(workspaceId, campaignId);
  }

  async pause(workspaceId: string, campaignId: string, expectedVersion?: number): Promise<CampaignDetail> {
    const campaign = await this.requireCampaign(workspaceId, campaignId);
    this.assertVersion(campaign, expectedVersion);
    if (campaign.status !== "running") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Only running campaigns can be paused",
      });
    }
    await this.repo.updateStatus(workspaceId, campaignId, campaign.version, { status: "paused" });
    return this.getDetail(workspaceId, campaignId);
  }

  async resume(workspaceId: string, campaignId: string, expectedVersion?: number): Promise<CampaignDetail> {
    const campaign = await this.requireCampaign(workspaceId, campaignId);
    this.assertVersion(campaign, expectedVersion);
    if (campaign.status !== "paused") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Only paused campaigns can be resumed",
      });
    }
    await this.repo.updateStatus(workspaceId, campaignId, campaign.version, { status: "running" });
    return this.getDetail(workspaceId, campaignId);
  }

  async stop(workspaceId: string, campaignId: string, expectedVersion?: number): Promise<CampaignDetail> {
    const campaign = await this.requireCampaign(workspaceId, campaignId);
    this.assertVersion(campaign, expectedVersion);
    if (TERMINAL_FOR_CONTROL.has(campaign.status)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Campaign is already finished",
      });
    }
    await this.repo.updateStatus(workspaceId, campaignId, campaign.version, {
      status: "completed",
      completedAt: new Date(),
    });
    return this.getDetail(workspaceId, campaignId);
  }

  listTargets(
    workspaceId: string,
    campaignId: string,
    filters?: { q?: string; status?: string },
  ): Promise<CampaignTarget[]> {
    return this.requireCampaign(workspaceId, campaignId).then(() =>
      this.repo.listTargets(workspaceId, campaignId, filters),
    );
  }

  async getTargetWithAttempts(
    workspaceId: string,
    campaignId: string,
    targetId: string,
  ): Promise<{ contact: CampaignTarget; attempts: CampaignAttempt[] }> {
    await this.requireCampaign(workspaceId, campaignId);
    const contact = await this.repo.getTarget(workspaceId, campaignId, targetId);
    if (!contact) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Campaign target not found" });
    }
    const attempts = await this.repo.listAttemptsForTarget(workspaceId, campaignId, targetId);
    return { contact, attempts };
  }

  listAttempts(workspaceId: string, campaignId: string): Promise<CampaignAttempt[]> {
    return this.requireCampaign(workspaceId, campaignId).then(() =>
      this.repo.listAttempts(workspaceId, campaignId),
    );
  }

  async reconcileAttempt(input: {
    providerCallSid: string;
    status: CampaignAttempt["status"];
    durationSeconds?: number;
    hangupCause?: string;
    amdResult?: string;
  }): Promise<CampaignAttempt | null> {
    return this.repo.reconcileAttemptByCallSid(input);
  }

  private async requireCampaign(workspaceId: string, campaignId: string): Promise<CampaignRecord> {
    const campaign = await this.repo.get(workspaceId, campaignId);
    if (!campaign) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Campaign not found" });
    }
    return campaign;
  }

  private assertVersion(campaign: CampaignRecord, expectedVersion?: number): void {
    if (typeof expectedVersion === "number" && expectedVersion !== campaign.version) {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        message: "Campaign version conflict; refresh and retry",
      });
    }
  }
}

function parseScheduledStart(schedule: CampaignSchedule): Date | null {
  if (!schedule.startDate || !schedule.startTime) return null;
  const iso = `${schedule.startDate}T${schedule.startTime}:00Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function escapeCsvValue(val: unknown): string {
  if (val == null) return '""';
  let s = String(val);
  // Formula injection defense: prefix with ' if it starts with =, +, -, @, \t, \r
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  // Escape double quotes
  s = s.replace(/"/g, '""');
  return `"${s}"`;
}

function toDetail(
  campaign: CampaignRecord,
  metrics: Awaited<ReturnType<CampaignsRepository["metrics"]>>,
): CampaignDetail {
  return {
    id: campaign.id,
    workspaceId: campaign.workspaceId,
    name: campaign.name,
    description: campaign.description,
    agentId: campaign.agentId,
    agentName: campaign.agentName,
    callerId: campaign.callerId,
    agentVersionId: campaign.agentVersionId,
    timezoneMode: campaign.timezoneMode,
    weekdays: campaign.weekdays,
    status: campaign.status,
    eligibleContacts: metrics.eligibleContacts,
    completedContacts: metrics.completedContacts,
    answerRate: metrics.eligibleContacts > 0 ? metrics.answerRate : null,
    scheduledStart: campaign.scheduledStart?.toISOString() ?? null,
    heldContactsCount: campaign.heldContactsCount,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    version: campaign.version,
    audienceSchema: campaign.audienceSchema,
    schedule: campaign.schedule,
    pacing: campaign.pacing,
    retryPolicy: campaign.retryPolicy,
    metrics,
  };
}
