import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError, ErrorCode } from "@quickstart/errors";
import type {
  IntegrationAuthorizeResponse,
  IntegrationCatalogItem,
  IntegrationProvider,
  IntegrationsListResponse,
  IntegrationStatus,
  IntegrationSyncRequest,
  IntegrationSyncResult,
} from "@quickstart/contracts";
import type {
  IntegrationsRepository,
  SyncLogRow,
  WorkspaceEmailCampaignRow,
} from "../repository/integrations.repository.js";
import { ProviderRegistry } from "../integrations/provider-registry.js";
import { SecretsClient } from "../clients/secrets.client.js";
import {
  executeIntegrationAction,
  INTEGRATION_ACTION_PROVIDERS,
  type IntegrationActionResult,
} from "../integrations/integration-actions.js";

export type CalendarActionInput = {
  action: "check_availability" | "book_slot" | "cancel_event";
  calendar_id?: string;
  timezone?: string;
  date?: string;
  start?: string;
  end?: string;
  slot_minutes?: number;
  working_hours?: { start?: string; end?: string };
  max_slots?: number;
  summary?: string;
  description?: string;
  attendee_email?: string;
  event_id?: string;
};

export type CalendarActionResult = Record<string, unknown>;

export type MailchimpAudience = {
  id: string;
  name: string;
  memberCount: number | null;
};

export type MailchimpCampaign = {
  id: string;
  webId: number | null;
  status: string;
  type: string;
  subject: string;
  title: string;
  fromName: string;
  audienceId: string;
  recipientCount: number;
  createdAt: string | null;
  sendTime: string | null;
  emailsSent: number;
  editUrl: string | null;
};

export type CreateMailchimpCampaignInput = {
  audienceId: string;
  recipientEmails: string[];
  subject: string;
  fromName: string;
  replyTo: string;
  previewText?: string;
  title?: string;
  html: string;
  confirmConsent: boolean;
  lead?: EmailLeadInput;
};

export type MailchimpCampaignDraft = {
  campaignId: string;
  webId: number | null;
  status: string;
  audienceId: string;
  segmentId: number;
  recipients: {
    total: number;
    valid: number;
    subscribed: number;
    pending: number;
    unsubscribed: number;
    failed: number;
    invalid: number;
  };
  editUrl: string | null;
  previewHtml: string;
};

export type EmailLeadInput = {
  email: string;
  name?: string;
  company?: string;
  website?: string;
  category?: string;
  location?: string;
  summary?: string;
  notes?: string;
  runId?: string;
  fitReasons?: string[];
  evidence?: Array<{
    field?: string;
    value?: string;
    source_url?: string;
    quote?: string;
  }>;
  source?: "lead_generation" | "manual" | "campaign";
};

export type PersonalizeEmailInput = {
  lead: EmailLeadInput;
  brief: string;
  fromName: string;
  replyTo?: string;
};

export type PersonalizedEmail = {
  subject: string;
  html: string;
  source: "ai" | "fallback";
};

export type MailchimpCampaignDetail = MailchimpCampaign & {
  html: string;
  recipients: Array<{ email: string; status?: string; name?: string }>;
  stats: {
    emailsSent: number;
    opens: number;
    clicks: number;
    bounces: number;
    unsubscribes: number;
    openRate: number | null;
    clickRate: number | null;
  };
  lead: EmailLeadInput | null;
  links: {
    mailchimpEdit: string | null;
    mailchimpReport: string | null;
    audience: string | null;
    website: string | null;
    run: string | null;
    sources: string[];
  };
};

export type InstantlyAccount = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: number | string | null;
  statusLabel: string;
  healthy: boolean;
  warmupStatus: number | string | null;
  dailyLimit: number | null;
  providerCode: number | null;
  setupPending: boolean;
  statusMessage: string | null;
};

export type ConnectGoogleMailboxInput = {
  email: string;
  appPassword: string;
  firstName: string;
  lastName: string;
  dailyLimit?: number;
  enableWarmup?: boolean;
};

export type ConnectGoogleMailboxResult = {
  account: InstantlyAccount;
  connected: boolean;
  message: string;
};

export type InstantlyCampaignStats = {
  leads: number;
  contacted: number;
  opens: number;
  replies: number;
};

export type InstantlyCampaign = {
  id: string;
  name: string;
  status: number;
  statusLabel: string;
  accounts: string[];
  leadEmail: string | null;
  leadName: string | null;
  company: string | null;
  subject: string;
  createdAt: string | null;
  updatedAt: string | null;
  activatedAt: string | null;
  link: string | null;
  stats: InstantlyCampaignStats;
};

export type CreateInstantlyCampaignInput = {
  name?: string;
  subject: string;
  html: string;
  lead: EmailLeadInput;
  accountEmails?: string[];
  confirmCompliance: boolean;
};

export type InstantlyCampaignDetail = InstantlyCampaign & {
  body: string;
  lead: EmailLeadInput | null;
  sendEvent: {
    status: "sent" | "pending" | "unavailable";
    sentAt: string | null;
    messageId: string | null;
  };
  links: {
    instantly: string | null;
    accounts: string | null;
    website: string | null;
    run: string | null;
    sources: string[];
  };
};

function instantlyStatusLabel(status: number): string {
  switch (status) {
    case 0:
      return "Draft";
    case 1:
      return "Active";
    case 2:
      return "Paused";
    case 3:
      return "Completed";
    case 4:
      return "Archived";
    case -1:
      return "Stopped";
    case -2:
      return "Error";
    case -99:
      return "Archived";
    default:
      return `Status ${status}`;
  }
}

function instantlyItems<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items as T[];
    if (Array.isArray(record.data)) return record.data as T[];
    if (Array.isArray(record.results)) return record.results as T[];
  }
  return [];
}

function parseGeneratedEmail(content: string): { subject: string; html: string } | null {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
    const rawHtml =
      typeof parsed.html === "string"
        ? parsed.html
        : typeof parsed.body === "string"
          ? parsed.body
          : "";
    if (!subject || !rawHtml.trim()) return null;
    const html = /<[a-z][\s\S]*>/i.test(rawHtml)
      ? rawHtml.replace(/<script[\s\S]*?<\/script>/gi, "")
      : mailchimpHtml(rawHtml);
    return { subject: subject.slice(0, 150), html };
  } catch {
    return null;
  }
}

function mailchimpHtml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Email body is required.",
    });
  }
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return trimmed;
  const escaped = trimmed.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">${escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}

/**
 * OAuth state is opaque to providers but carries the workspace/provider route
 * so a single registered callback URL can serve every tenant. Keep this under
 * the 128-char `state_token` column; the random suffix is what the repository
 * stores and verifies. The prefix is only used by the web callback route.
 */
function encodeOAuthState(workspaceId: string, provider: IntegrationProvider): string {
  return `${workspaceId}.${provider}.${randomBytes(16).toString("hex")}`;
}

class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function timezoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(instant);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second"),
  );
  return asUtc - instant.getTime();
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Expected date YYYY-MM-DD and time HH:mm",
    });
  }
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = timezoneOffsetMs(new Date(guess), timeZone);
  let utc = guess - firstOffset;
  const secondOffset = timezoneOffsetMs(new Date(utc), timeZone);
  if (secondOffset !== firstOffset) utc = guess - secondOffset;
  return new Date(utc);
}

function parseCalendarTime(value: string, timeZone: string): Date {
  const trimmed = value.trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "Invalid start/end time" });
    }
    return parsed;
  }
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/.exec(trimmed);
  if (local) return zonedDateTimeToUtc(local[1], local[2], timeZone);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "Invalid start/end time" });
  }
  return parsed;
}

function formatLocalTime(instantMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(instantMs));
}

const CATALOG_DEFINITIONS: Omit<IntegrationCatalogItem, "status">[] = [
  {
    id: "hubspot",
    name: "HubSpot",
    category: "crm_leads",
    categoryLabel: "CRM & Leads",
    description: "Sync contacts, deals, and activity between HubSpot and QuickStart AI.",
    connectionType: "oauth",
    requiredScopes: ["crm.objects.contacts.read", "crm.objects.deals.read"],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "crm_leads",
    categoryLabel: "CRM & Leads",
    description: "Sync leads, contacts, and opportunities from Salesforce.",
    connectionType: "oauth",
    requiredScopes: ["api", "refresh_token", "offline_access"],
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    category: "calendar_booking",
    categoryLabel: "Calendar & Booking",
    description: "Check availability and create appointment events in selected calendars.",
    connectionType: "oauth",
    requiredScopes: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
  },
  {
    id: "slack",
    name: "Slack",
    category: "communication",
    categoryLabel: "Communication",
    description: "Send notifications, share updates, and collaborate with your team.",
    connectionType: "oauth",
    requiredScopes: ["chat:write", "channels:read"],
  },
  {
    id: "twilio",
    name: "Twilio",
    category: "telephony",
    categoryLabel: "Telephony",
    description: "Make and receive calls, send SMS, and manage your phone numbers.",
    connectionType: "credentials",
  },
  {
    id: "zendesk",
    name: "Zendesk",
    category: "crm_leads",
    categoryLabel: "CRM & Leads",
    description: "Sync support tickets and customer conversations.",
    connectionType: "oauth",
    requiredScopes: ["read", "write"],
  },
  {
    id: "google_sheets",
    name: "Google Sheets",
    category: "productivity",
    categoryLabel: "Data & Productivity",
    description: "Export call logs, leads, and analytics to Google Sheets.",
    connectionType: "oauth",
    requiredScopes: ["https://www.googleapis.com/auth/spreadsheets"],
  },
  {
    id: "notion",
    name: "Notion",
    category: "productivity",
    categoryLabel: "Productivity",
    description: "Sync knowledge base and documentation.",
    connectionType: "oauth",
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    category: "marketing",
    categoryLabel: "Marketing",
    description: "Sync contacts and campaigns.",
    connectionType: "oauth",
  },
  {
    id: "apify",
    name: "Apify",
    category: "crm_leads",
    categoryLabel: "CRM & Leads",
    description: "Scrape Google Maps, business directories, and web sources directly into your lead pipeline.",
    connectionType: "credentials",
  },
];

export class IntegrationsService {
  private readonly registry: ProviderRegistry;
  private readonly secrets: SecretsClient;

  constructor(
    private readonly repo: IntegrationsRepository,
    secretsClient?: SecretsClient,
    registry?: ProviderRegistry,
  ) {
    this.registry = registry ?? new ProviderRegistry();
    this.secrets =
      secretsClient ??
      new SecretsClient({
        internalToken:
          process.env.SECRETS_INTERNAL_TOKEN ??
          process.env.WORKSPACE_INTERNAL_TOKEN ??
          process.env.INTERNAL_TOKEN ??
          "internal-token",
      });
  }

  async listIntegrations(workspaceId: string): Promise<IntegrationsListResponse> {
    const existing = await this.repo.listByWorkspace(workspaceId);
    const existingMap = new Map(existing.map((e) => [e.provider, e]));
    const capabilitiesMap = this.registry.listCapabilities();

    let connectedCount = 0;
    const catalog: IntegrationCatalogItem[] = CATALOG_DEFINITIONS.map((def) => {
      const persisted = existingMap.get(def.id);
      const status: IntegrationStatus = (persisted?.status as IntegrationStatus) ?? "not_connected";
      if (status === "connected") {
        connectedCount += 1;
      }

      return {
        ...def,
        status,
        connectionId: persisted?.id ?? null,
        accountIdentifier: persisted?.account_identifier ?? null,
        accountEmail: persisted?.account_email ?? null,
        accountName: persisted?.account_name ?? null,
        grantedScopes: persisted?.granted_scopes ?? [],
        capabilities: capabilitiesMap[def.id],
        connectedAt: persisted?.connected_at ? persisted.connected_at.toISOString() : null,
        updatedAt: persisted?.updated_at ? persisted.updated_at.toISOString() : null,
        lastVerifiedAt: persisted?.last_verified_at
          ? persisted.last_verified_at.toISOString()
          : null,
        lastSyncAt: persisted?.last_sync_at ? persisted.last_sync_at.toISOString() : null,
        lastError: persisted?.last_error ?? null,
      };
    });

    const categories = [
      { id: "all", label: "All", count: catalog.length },
      {
        id: "crm_leads",
        label: "CRM & Leads",
        count: catalog.filter((c) => c.category === "crm_leads").length,
      },
      {
        id: "calendar_booking",
        label: "Calendar & Booking",
        count: catalog.filter((c) => c.category === "calendar_booking").length,
      },
      {
        id: "communication",
        label: "Communication",
        count: catalog.filter((c) => c.category === "communication").length,
      },
      {
        id: "telephony",
        label: "Telephony",
        count: catalog.filter((c) => c.category === "telephony").length,
      },
      {
        id: "productivity",
        label: "Productivity",
        count: catalog.filter((c) => c.category === "productivity").length,
      },
      {
        id: "marketing",
        label: "Marketing",
        count: catalog.filter((c) => c.category === "marketing").length,
      },
    ];

    return {
      connected_count: connectedCount,
      catalog,
      categories,
    };
  }

  async getIntegration(
    workspaceId: string,
    provider: IntegrationProvider,
  ): Promise<IntegrationCatalogItem> {
    const def = CATALOG_DEFINITIONS.find((d) => d.id === provider);
    if (!def) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: `Unknown integration provider '${provider}'`,
      });
    }

    const persisted = await this.repo.getByProvider(workspaceId, provider);
    const status: IntegrationStatus = (persisted?.status as IntegrationStatus) ?? "not_connected";
    const capabilities = this.registry.getAdapter(provider).capabilities;

    return {
      ...def,
      status,
      connectionId: persisted?.id ?? null,
      accountIdentifier: persisted?.account_identifier ?? null,
      accountEmail: persisted?.account_email ?? null,
      accountName: persisted?.account_name ?? null,
      grantedScopes: persisted?.granted_scopes ?? [],
      capabilities,
      connectedAt: persisted?.connected_at ? persisted.connected_at.toISOString() : null,
      updatedAt: persisted?.updated_at ? persisted.updated_at.toISOString() : null,
      lastVerifiedAt: persisted?.last_verified_at ? persisted.last_verified_at.toISOString() : null,
      lastSyncAt: persisted?.last_sync_at ? persisted.last_sync_at.toISOString() : null,
      lastError: persisted?.last_error ?? null,
    };
  }

  async initiateOAuth(
    workspaceId: string,
    userId: string,
    provider: IntegrationProvider,
    redirectUri: string,
    options?: { scopes?: string[]; subdomain?: string },
  ): Promise<IntegrationAuthorizeResponse> {
    const def = CATALOG_DEFINITIONS.find((d) => d.id === provider);
    if (!def || def.connectionType !== "oauth") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Provider '${provider}' does not support OAuth authorization.`,
      });
    }

    const adapter = this.registry.getAdapter(provider);
    const stateToken = encodeOAuthState(workspaceId, provider);
    const codeVerifier = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.repo.saveOAuthState({
      workspaceId,
      userId,
      provider,
      stateToken,
      codeVerifier,
      redirectUri,
      expiresAt,
    });

    const { url } = adapter.getAuthorizationUrl({
      state: stateToken,
      redirectUri,
      codeVerifier,
      scopes: options?.scopes,
      subdomain: options?.subdomain,
    });

    return {
      authorization_url: url,
      state: stateToken,
      provider,
    };
  }

  async handleOAuthCallback(
    workspaceId: string,
    userId: string,
    provider: IntegrationProvider,
    code: string,
    state: string,
    options?: { subdomain?: string },
  ): Promise<IntegrationCatalogItem> {
    const storedState = await this.repo.getOAuthState(state);
    if (!storedState) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Invalid or expired OAuth state token.",
      });
    }

    if (
      storedState.workspace_id !== workspaceId ||
      storedState.user_id !== userId ||
      storedState.provider !== provider
    ) {
      throw new AppError({
        code: ErrorCode.FORBIDDEN,
        message: "OAuth state does not match workspace or session.",
      });
    }

    // Delete one-time state token
    await this.repo.deleteOAuthState(state);

    const adapter = this.registry.getAdapter(provider);
    const tokenResult = await adapter.exchangeCode({
      code,
      redirectUri: storedState.redirect_uri,
      codeVerifier: storedState.code_verifier ?? undefined,
      subdomain: options?.subdomain,
    });

    // Store encrypted credentials in secrets-service
    try {
      await this.secrets.storeIntegrationSecret(workspaceId, provider, {
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken,
        tokenType: tokenResult.tokenType,
        expiresIn: tokenResult.expiresIn,
        rawPayload: tokenResult.rawPayload,
        storedAt: new Date().toISOString(),
      });
    } catch (err) {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message:
          err instanceof Error
            ? err.message
            : "Could not store the provider credentials. Please try again.",
      });
    }

    const tokenExpiresAt = tokenResult.expiresIn
      ? new Date(Date.now() + tokenResult.expiresIn * 1000)
      : null;

    await this.repo.upsertConnection({
      workspaceId,
      provider,
      status: "connected",
      accountIdentifier: tokenResult.accountIdentifier,
      accountEmail: tokenResult.accountEmail,
      accountName: tokenResult.accountName,
      providerAccountId: tokenResult.providerAccountId,
      grantedScopes: tokenResult.grantedScopes,
      tokenExpiresAt,
      metadata: {
        connected_by_user_id: userId,
        has_refresh_token: Boolean(tokenResult.refreshToken),
        ...(provider === "zendesk" && tokenResult.rawPayload?.subdomain
          ? { subdomain: String(tokenResult.rawPayload.subdomain) }
          : {}),
        ...(provider === "salesforce" && tokenResult.rawPayload?.instance_url
          ? { instance_url: String(tokenResult.rawPayload.instance_url) }
          : {}),
        ...(provider === "mailchimp" && tokenResult.rawPayload?.dc
          ? { dc: String(tokenResult.rawPayload.dc) }
          : {}),
        ...(provider === "mailchimp" && tokenResult.rawPayload?.api_endpoint
          ? { api_endpoint: String(tokenResult.rawPayload.api_endpoint) }
          : {}),
      },
    });

    return this.getIntegration(workspaceId, provider);
  }

  /**
   * Complete an OAuth callback from the one-time state alone. Used by the
   * server-side web callback so a missing/expired browser session (for example
   * after a host change between localhost and 127.0.0.1) cannot lose the
   * connection the provider just authorized.
   */
  async handleOAuthCallbackFromState(
    code: string,
    state: string,
  ): Promise<{
    workspaceId: string;
    provider: IntegrationProvider;
    integration: IntegrationCatalogItem;
  }> {
    const stored = await this.repo.getOAuthState(state);
    if (!stored) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Invalid or expired OAuth state token.",
      });
    }

    const provider = stored.provider as IntegrationProvider;
    const integration = await this.handleOAuthCallback(
      stored.workspace_id,
      stored.user_id,
      provider,
      code,
      state,
    );
    return { workspaceId: stored.workspace_id, provider, integration };
  }

  private async mailchimpContext(workspaceId: string): Promise<{ token: string; dc: string }> {
    const connection = await this.repo.getByProvider(workspaceId, "mailchimp");
    if (!connection || connection.status !== "connected") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Mailchimp is not connected for this workspace.",
      });
    }
    const credentials = await this.secrets.getIntegrationSecret(workspaceId, "mailchimp");
    const token = typeof credentials?.accessToken === "string" ? credentials.accessToken : "";
    if (!token) {
      throw new AppError({
        code: ErrorCode.UNAUTHORIZED,
        message: "Missing Mailchimp credentials. Reconnect the integration.",
      });
    }
    const raw = (credentials?.rawPayload as Record<string, unknown> | undefined) ?? {};
    const dc = typeof raw.dc === "string" && raw.dc ? raw.dc : "us1";
    return { token, dc };
  }

  private async mailchimpRequest<T>(
    ctx: { token: string; dc: string },
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${ctx.token}`);
    headers.set("Content-Type", "application/json");
    const res = await fetch(`https://${ctx.dc}.api.mailchimp.com/3.0${path}`, {
      ...init,
      headers,
    });
    if (res.status === 204) return {} as T;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const detail =
        (typeof body.detail === "string" && body.detail) ||
        (typeof body.title === "string" && body.title) ||
        `Mailchimp API error HTTP ${res.status}`;
      throw new AppError({
        code: res.status >= 500 ? ErrorCode.UPSTREAM_UNAVAILABLE : ErrorCode.VALIDATION_FAILED,
        message: detail,
      });
    }
    return body as T;
  }

  async listMailchimpAudiences(workspaceId: string): Promise<MailchimpAudience[]> {
    const ctx = await this.mailchimpContext(workspaceId);
    const body = await this.mailchimpRequest<{
      lists?: Array<{
        id?: string;
        name?: string;
        stats?: { member_count?: number };
      }>;
    }>(ctx, "/lists?count=100");
    return (body.lists ?? [])
      .filter((list) => typeof list.id === "string" && list.id)
      .map((list) => ({
        id: String(list.id),
        name: String(list.name ?? list.id),
        memberCount: typeof list.stats?.member_count === "number" ? list.stats.member_count : null,
      }));
  }

  private mapMailchimpCampaign(campaign: Record<string, unknown>, dc: string): MailchimpCampaign {
    const settings = (campaign.settings as Record<string, unknown> | undefined) ?? {};
    const recipients = (campaign.recipients as Record<string, unknown> | undefined) ?? {};
    const webId = typeof campaign.web_id === "number" ? campaign.web_id : null;
    const rawStatus = String(campaign.status ?? "unknown");
    const emailsSent = Number(campaign.emails_sent ?? 0);
    const sendTime = typeof campaign.send_time === "string" ? campaign.send_time : null;
    // Mailchimp can leave a sent campaign's status as "save" briefly/after an
    // edit even though delivery data proves it was sent. Prefer delivery data.
    const status = rawStatus === "save" && (emailsSent > 0 || sendTime) ? "sent" : rawStatus;
    return {
      id: String(campaign.id ?? ""),
      webId,
      status,
      type: String(campaign.type ?? "regular"),
      subject: String(settings.subject_line ?? ""),
      title: String(settings.title ?? ""),
      fromName: String(settings.from_name ?? ""),
      audienceId: String(recipients.list_id ?? ""),
      recipientCount: Number(recipients.recipient_count ?? 0),
      createdAt: typeof campaign.create_time === "string" ? campaign.create_time : null,
      sendTime,
      emailsSent,
      editUrl: webId ? `https://${dc}.admin.mailchimp.com/campaigns/edit?id=${webId}` : null,
    };
  }

  private applyLocalCampaignState(
    campaign: MailchimpCampaign,
    row?: WorkspaceEmailCampaignRow | null,
  ): MailchimpCampaign {
    const sentAt =
      row?.metadata && typeof row.metadata.sent_at === "string" ? row.metadata.sent_at : null;
    if (campaign.status === "save" && sentAt) {
      return {
        ...campaign,
        status: campaign.emailsSent > 0 || campaign.sendTime ? "sent" : "sending",
      };
    }
    return campaign;
  }

  async listMailchimpCampaigns(workspaceId: string): Promise<MailchimpCampaign[]> {
    const ctx = await this.mailchimpContext(workspaceId);
    const rows = await this.repo.listEmailCampaigns(workspaceId, "mailchimp");
    if (rows.length === 0) return [];

    // Only show campaigns this workspace created. The connected Mailchimp
    // account can be shared by several workspaces, so the account-wide list
    // would otherwise leak campaigns across workspaces.
    const campaigns: MailchimpCampaign[] = [];
    for (let index = 0; index < rows.length; index += 10) {
      await Promise.all(
        rows.slice(index, index + 10).map(async (row) => {
          try {
            const campaign = await this.mailchimpRequest<Record<string, unknown>>(
              ctx,
              `/campaigns/${encodeURIComponent(row.campaign_id)}`,
            );
            campaigns.push(
              this.applyLocalCampaignState(this.mapMailchimpCampaign(campaign, ctx.dc), row),
            );
          } catch {
            // A campaign deleted in Mailchimp is simply omitted.
          }
        }),
      );
    }
    return campaigns.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }

  async getMailchimpCampaign(
    workspaceId: string,
    campaignId: string,
  ): Promise<MailchimpCampaignDetail> {
    const owned = await this.repo.isEmailCampaignOwned(workspaceId, "mailchimp", campaignId);
    if (!owned) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Campaign not found in this workspace.",
      });
    }

    const ctx = await this.mailchimpContext(workspaceId);
    const campaign = await this.mailchimpRequest<Record<string, unknown>>(
      ctx,
      `/campaigns/${encodeURIComponent(campaignId)}`,
    );
    const mapped = this.mapMailchimpCampaign(campaign, ctx.dc);
    const row = await this.repo.getEmailCampaign(workspaceId, "mailchimp", campaignId);
    const campaignState = this.applyLocalCampaignState(mapped, row);

    let html = "";
    try {
      const content = await this.mailchimpRequest<{ html?: string }>(
        ctx,
        `/campaigns/${encodeURIComponent(campaignId)}/content`,
      );
      html = typeof content.html === "string" ? content.html : "";
    } catch {
      html = "";
    }

    let report: Record<string, unknown> | null = null;
    try {
      report = await this.mailchimpRequest<Record<string, unknown>>(
        ctx,
        `/reports/${encodeURIComponent(campaignId)}`,
      );
    } catch {
      report = null;
    }

    const recipientsObj = (campaign.recipients as Record<string, unknown> | undefined) ?? {};
    const listId = String(recipientsObj.list_id ?? "");
    const segmentOpts = (recipientsObj.segment_opts as Record<string, unknown> | undefined) ?? {};
    const segmentId =
      typeof segmentOpts.saved_segment_id === "number" ? segmentOpts.saved_segment_id : null;

    let recipients: Array<{ email: string; status?: string; name?: string }> = (
      row?.recipient_emails ?? []
    ).map((email) => ({ email }));
    if (recipients.length === 0 && listId && segmentId) {
      try {
        const members = await this.mailchimpRequest<{
          members?: Array<Record<string, unknown>>;
        }>(ctx, `/lists/${encodeURIComponent(listId)}/segments/${segmentId}/members?count=1000`);
        recipients = (members.members ?? [])
          .map((member) => {
            const mergeFields = (member.merge_fields as Record<string, unknown> | undefined) ?? {};
            return {
              email: String(member.email_address ?? ""),
              status: typeof member.status === "string" ? member.status : undefined,
              name: typeof mergeFields.FNAME === "string" ? mergeFields.FNAME : undefined,
            };
          })
          .filter((member) => member.email);
      } catch {
        recipients = [];
      }
    }

    const statsObj = report ?? {};
    const opensObj = (statsObj.opens as Record<string, unknown> | undefined) ?? {};
    const clicksObj = (statsObj.clicks as Record<string, unknown> | undefined) ?? {};
    const bouncesObj = (statsObj.bounces as Record<string, unknown> | undefined) ?? {};
    const percent = (value: unknown): number | null => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.round(numeric * 1000) / 10 : null;
    };
    const emailsSent = Number(statsObj.emails_sent ?? campaign.emails_sent ?? 0);
    const leads = (row?.lead as EmailLeadInput | null) ?? null;
    const webId = campaignState.webId;

    return {
      ...campaignState,
      html,
      recipients,
      stats: {
        emailsSent,
        opens: Number(opensObj.opens_total ?? 0),
        clicks: Number(clicksObj.clicks_total ?? 0),
        bounces: Number(bouncesObj.hard_bounces ?? 0) + Number(bouncesObj.soft_bounces ?? 0),
        unsubscribes: Number(statsObj.unsubscribed ?? 0),
        openRate: percent(opensObj.open_rate),
        clickRate: percent(clicksObj.click_rate),
      },
      lead: leads,
      links: {
        mailchimpEdit: campaignState.editUrl,
        mailchimpReport: webId
          ? `https://${ctx.dc}.admin.mailchimp.com/reports/summary?id=${webId}`
          : null,
        audience: listId
          ? `https://${ctx.dc}.admin.mailchimp.com/lists/members/?id=${listId}`
          : null,
        website: leads?.website && /^https?:\/\//i.test(leads.website) ? leads.website : null,
        run: leads?.runId
          ? `/workspaces/${workspaceId}/lead-generation/runs/${encodeURIComponent(leads.runId)}`
          : null,
        sources: [
          ...new Set(
            (leads?.evidence ?? [])
              .map((item) => item.source_url)
              .filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url)),
          ),
        ].slice(0, 5),
      },
    };
  }

  private instantlyApiKey(): string {
    const key = process.env.INSTANTLY_API_KEY?.trim();
    if (!key) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          "Instantly is not configured. Add INSTANTLY_API_KEY and connect a sending email account in Instantly.",
      });
    }
    return key;
  }

  private async instantlyRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.instantlyApiKey()}`);
    headers.set("Content-Type", "application/json");
    const method = (init.method ?? "GET").toUpperCase();
    const send = () =>
      fetch(`https://api.instantly.ai/api/v2${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(method === "GET" ? 10_000 : 20_000),
      });
    let res: Response;
    try {
      res = await send();
    } catch {
      if (method !== "GET") {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Could not reach Instantly. Check the server's network access.",
        });
      }
      try {
        await new Promise((resolve) => setTimeout(resolve, 250));
        res = await send();
      } catch {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Could not reach Instantly after retrying. Check the server's network access.",
        });
      }
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const detail =
        (typeof body.message === "string" && body.message) ||
        (typeof body.error === "string" && body.error) ||
        `Instantly API error HTTP ${res.status}`;
      if (res.status === 401) {
        throw new AppError({
          code: ErrorCode.UNAUTHORIZED,
          message: "Instantly API key is invalid or missing the required scopes.",
        });
      }
      if (res.status === 402) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "Instantly workspace does not have an active paid plan.",
        });
      }
      if (res.status === 404) {
        throw new AppError({ code: ErrorCode.NOT_FOUND, message: detail });
      }
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: detail,
      });
    }
    return body as T;
  }

  private mapInstantlyAccount(account: Record<string, unknown>): InstantlyAccount {
    const status =
      typeof account.status === "number" || typeof account.status === "string"
        ? account.status
        : null;
    const statusNumber = Number(status);
    const setupPending = account.setup_pending === true;
    const healthy = statusNumber === 1 && !setupPending;
    const statusMessageValue = account.status_message;
    let statusMessage: string | null = null;
    if (typeof statusMessageValue === "string") {
      statusMessage = statusMessageValue;
    } else if (statusMessageValue && typeof statusMessageValue === "object") {
      const message = statusMessageValue as Record<string, unknown>;
      const text = message.e_message ?? message.response ?? message.message;
      if (typeof text === "string" && text.trim()) statusMessage = text.trim();
    }
    return {
      email: String(account.email ?? ""),
      firstName: typeof account.first_name === "string" ? account.first_name : null,
      lastName: typeof account.last_name === "string" ? account.last_name : null,
      status,
      statusLabel: healthy
        ? "Active"
        : setupPending
          ? "Setting up"
          : statusNumber === 2
            ? "Paused"
            : "Needs attention",
      healthy,
      warmupStatus:
        typeof account.warmup_status === "number" || typeof account.warmup_status === "string"
          ? account.warmup_status
          : null,
      dailyLimit: typeof account.daily_limit === "number" ? account.daily_limit : null,
      providerCode: typeof account.provider_code === "number" ? account.provider_code : null,
      setupPending,
      statusMessage,
    };
  }

  async listInstantlyAccounts(): Promise<InstantlyAccount[]> {
    const body = await this.instantlyRequest<unknown>("/accounts?limit=100");
    return instantlyItems<Record<string, unknown>>(body)
      .map((account) => this.mapInstantlyAccount(account))
      .filter((account) => account.email);
  }

  async connectInstantlyGoogleAccount(
    _workspaceId: string,
    input: ConnectGoogleMailboxInput,
  ): Promise<ConnectGoogleMailboxResult> {
    const email = String(input.email ?? "")
      .trim()
      .toLowerCase();
    const appPassword = String(input.appPassword ?? "").replace(/[\s-]+/g, "");
    const firstName = String(input.firstName ?? "").trim();
    const lastName = String(input.lastName ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "A valid Google email address is required.",
      });
    }
    if (!/^[A-Za-z0-9]{16}$/.test(appPassword)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          "Google app passwords are 16 characters. Copy the app password from Google without spaces.",
      });
    }
    if (!firstName || !lastName) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "First and last name are required for the sending account.",
      });
    }
    const dailyLimit = Math.min(Math.max(Number(input.dailyLimit ?? 30) || 30, 1), 100);

    const existing = (await this.listInstantlyAccounts()).find(
      (account) => account.email.toLowerCase() === email,
    );
    if (existing?.healthy) {
      return {
        account: existing,
        connected: true,
        message: "This mailbox is already connected and active.",
      };
    }
    if (existing) {
      try {
        await this.instantlyRequest(`/accounts/${encodeURIComponent(email)}`, {
          method: "DELETE",
        });
      } catch (err) {
        if (!(err instanceof AppError && err.code === ErrorCode.NOT_FOUND)) {
          throw err;
        }
      }
    }

    const payload: Record<string, unknown> = {
      email,
      first_name: firstName,
      last_name: lastName,
      provider_code: 2,
      imap_username: email,
      imap_password: appPassword,
      imap_host: "imap.gmail.com",
      imap_port: 993,
      smtp_username: email,
      smtp_password: appPassword,
      smtp_host: "smtp.gmail.com",
      smtp_port: 587,
      daily_limit: dailyLimit,
      sending_gap: 10,
    };
    if (input.enableWarmup) {
      payload.warmup = {
        limit: 20,
        advanced: {
          warm_ctd: false,
          open_rate: 0.95,
          important_rate: 0.8,
          read_emulation: true,
          spam_save_rate: 0.02,
          weekday_only: true,
        },
        warmup_custom_ftag: "warmup",
        increment: "disabled",
        reply_rate: 0.1,
      };
    }
    const account = await this.instantlyRequest<Record<string, unknown>>("/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const mapped = this.mapInstantlyAccount(account);
    return {
      account: mapped,
      connected: mapped.healthy,
      message: mapped.healthy
        ? "Mailbox connected and active."
        : (mapped.statusMessage ??
          "Instantly accepted the mailbox, but it is not active yet. Verify the app password and 2-Step Verification."),
    };
  }

  private async getInstantlyCampaignStats(
    campaignId: string,
  ): Promise<InstantlyCampaignStats | null> {
    try {
      const body = await this.instantlyRequest<unknown>("/leads/list", {
        method: "POST",
        body: JSON.stringify({ campaign: campaignId, limit: 100 }),
      });
      const leads = instantlyItems<Record<string, unknown>>(body);
      let contacted = 0;
      let opens = 0;
      let replies = 0;
      for (const lead of leads) {
        if (lead.timestamp_last_contact) contacted += 1;
        opens += Number(lead.email_open_count ?? 0) || 0;
        replies += Number(lead.email_reply_count ?? 0) || 0;
      }
      return { leads: leads.length, contacted, opens, replies };
    } catch {
      return null;
    }
  }

  private async getInstantlySendEvent(
    campaignId: string,
  ): Promise<InstantlyCampaignDetail["sendEvent"]> {
    try {
      const body = await this.instantlyRequest<unknown>(
        `/emails?campaign_id=${encodeURIComponent(campaignId)}&limit=100`,
      );
      const email = instantlyItems<Record<string, unknown>>(body).find(
        (item) => item.campaign_id === campaignId && Number(item.ue_type) === 1,
      );
      return email
        ? {
            status: "sent",
            sentAt: typeof email.timestamp_email === "string" ? email.timestamp_email : null,
            messageId: typeof email.message_id === "string" ? email.message_id : null,
          }
        : { status: "pending", sentAt: null, messageId: null };
    } catch {
      return { status: "unavailable", sentAt: null, messageId: null };
    }
  }

  private mapInstantlyCampaign(
    campaign: Record<string, unknown>,
    row?: WorkspaceEmailCampaignRow | null,
    stats?: InstantlyCampaignStats | null,
  ): InstantlyCampaign {
    const sequences = Array.isArray(campaign.sequences)
      ? (campaign.sequences as Array<Record<string, unknown>>)
      : [];
    const steps = Array.isArray(sequences[0]?.steps)
      ? (sequences[0].steps as Array<Record<string, unknown>>)
      : [];
    const variants = Array.isArray(steps[0]?.variants)
      ? (steps[0].variants as Array<Record<string, unknown>>)
      : [];
    const subject = String(variants[0]?.subject ?? row?.subject ?? "");
    const lead = (row?.lead as EmailLeadInput | null) ?? null;
    const rawStatus = Number(campaign.status ?? 1);
    const activatedAt =
      row?.metadata && typeof row.metadata.sent_at === "string" ? row.metadata.sent_at : null;
    const accounts = Array.isArray(campaign.email_list)
      ? campaign.email_list.map(String).filter(Boolean)
      : [];
    return {
      id: String(campaign.id ?? row?.campaign_id ?? ""),
      name: String(
        campaign.name ??
          (row?.metadata && typeof row.metadata.campaign_name === "string"
            ? row.metadata.campaign_name
            : "Outbound campaign"),
      ),
      status: rawStatus,
      statusLabel: instantlyStatusLabel(rawStatus),
      accounts,
      leadEmail: lead?.email ?? row?.recipient_emails?.[0] ?? null,
      leadName: lead?.name ?? lead?.company ?? null,
      company: lead?.company ?? null,
      subject,
      createdAt: typeof campaign.timestamp_created === "string" ? campaign.timestamp_created : null,
      updatedAt: typeof campaign.timestamp_updated === "string" ? campaign.timestamp_updated : null,
      activatedAt,
      link: campaign.id ? `https://app.instantly.ai/app/campaigns/${String(campaign.id)}` : null,
      stats: stats ?? {
        leads: row?.recipient_emails?.length ?? 0,
        contacted: 0,
        opens: 0,
        replies: 0,
      },
    };
  }

  private instantlyDetailLinks(
    workspaceId: string,
    campaignId: string,
    lead: EmailLeadInput | null,
  ) {
    return {
      instantly: `https://app.instantly.ai/app/campaigns/${campaignId}`,
      accounts: "https://app.instantly.ai/app/accounts",
      website: lead?.website && /^https?:\/\//i.test(lead.website) ? lead.website : null,
      run: lead?.runId
        ? `/workspaces/${workspaceId}/lead-generation/runs/${encodeURIComponent(lead.runId)}`
        : null,
      sources: [
        ...new Set(
          (lead?.evidence ?? [])
            .map((item) => item.source_url)
            .filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url)),
        ),
      ].slice(0, 5),
    };
  }

  async listInstantlyCampaigns(workspaceId: string): Promise<InstantlyCampaign[]> {
    const rows = await this.repo.listEmailCampaigns(workspaceId, "instantly");
    if (rows.length === 0) return [];
    const campaigns: InstantlyCampaign[] = [];
    for (let index = 0; index < rows.length; index += 10) {
      await Promise.all(
        rows.slice(index, index + 10).map(async (row) => {
          try {
            const [campaign, stats] = await Promise.all([
              this.instantlyRequest<Record<string, unknown>>(
                `/campaigns/${encodeURIComponent(row.campaign_id)}`,
              ),
              this.getInstantlyCampaignStats(row.campaign_id),
            ]);
            campaigns.push(this.mapInstantlyCampaign(campaign, row, stats));
          } catch (err) {
            if (
              err instanceof AppError &&
              (err.code === ErrorCode.UNAUTHORIZED ||
                err.code === ErrorCode.VALIDATION_FAILED ||
                err.code === ErrorCode.UPSTREAM_UNAVAILABLE)
            ) {
              throw err;
            }
          }
        }),
      );
    }
    return campaigns.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }

  async getInstantlyCampaign(
    workspaceId: string,
    campaignId: string,
  ): Promise<InstantlyCampaignDetail> {
    const row = await this.repo.getEmailCampaign(workspaceId, "instantly", campaignId);
    if (!row) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Campaign not found in this workspace.",
      });
    }
    const [campaign, stats, sendEvent] = await Promise.all([
      this.instantlyRequest<Record<string, unknown>>(
        `/campaigns/${encodeURIComponent(campaignId)}`,
      ),
      this.getInstantlyCampaignStats(campaignId),
      this.getInstantlySendEvent(campaignId),
    ]);
    const mapped = this.mapInstantlyCampaign(campaign, row, stats);
    const sequences = Array.isArray(campaign.sequences)
      ? (campaign.sequences as Array<Record<string, unknown>>)
      : [];
    const steps = Array.isArray(sequences[0]?.steps)
      ? (sequences[0].steps as Array<Record<string, unknown>>)
      : [];
    const variants = Array.isArray(steps[0]?.variants)
      ? (steps[0].variants as Array<Record<string, unknown>>)
      : [];
    const body = String(
      variants[0]?.body ??
        (row.metadata && typeof row.metadata.body === "string" ? row.metadata.body : ""),
    );
    const lead = (row.lead as EmailLeadInput | null) ?? null;
    return {
      ...mapped,
      body,
      lead,
      sendEvent,
      links: this.instantlyDetailLinks(workspaceId, campaignId, lead),
    };
  }

  async createInstantlyCampaign(
    workspaceId: string,
    input: CreateInstantlyCampaignInput,
    createdBy?: string,
  ): Promise<InstantlyCampaignDetail> {
    if (!input.confirmCompliance) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Confirm that this outreach complies with applicable email law.",
      });
    }
    const email = String(input.lead?.email ?? "")
      .trim()
      .toLowerCase();
    const subject = String(input.subject ?? "")
      .trim()
      .slice(0, 150);
    const html = String(input.html ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "A valid lead email is required.",
      });
    }
    if (!subject || !html) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Subject and email body are required.",
      });
    }

    const accountList = await this.listInstantlyAccounts();
    const healthyAccounts = accountList
      .filter((account) => account.healthy)
      .map((account) => account.email.toLowerCase());
    const requestedAccounts =
      input.accountEmails?.map((item) => item.trim().toLowerCase()).filter(Boolean) ?? [];
    const availableAccounts =
      requestedAccounts.length > 0
        ? requestedAccounts.filter((account) => healthyAccounts.includes(account))
        : healthyAccounts;
    if (availableAccounts.length === 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          "No active sending account found. Connect a Google mailbox with an app password and make sure the account status is Active.",
      });
    }

    const lead: EmailLeadInput = {
      email,
      name: String(input.lead.name ?? "").trim(),
      company: String(input.lead.company ?? "").trim(),
      website: String(input.lead.website ?? "").trim(),
      category: String(input.lead.category ?? "").trim(),
      location: String(input.lead.location ?? "").trim(),
      summary: String(input.lead.summary ?? "").trim(),
      notes: String(input.lead.notes ?? "").trim(),
      runId: input.lead.runId,
      fitReasons: Array.isArray(input.lead.fitReasons) ? input.lead.fitReasons.slice(0, 5) : [],
      evidence: Array.isArray(input.lead.evidence) ? input.lead.evidence.slice(0, 5) : [],
      source: input.lead.source ?? "manual",
    };
    const campaignName =
      input.name?.trim().slice(0, 120) ||
      `QuickStart — ${lead.company || lead.email}`.slice(0, 120);
    const today = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const body = `${html}<p style="font-size:12px;color:#666;margin-top:24px">If this is not relevant, reply "unsubscribe" and I will not follow up.</p>`;

    const campaign = await this.instantlyRequest<Record<string, unknown>>("/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: campaignName,
        campaign_schedule: {
          schedules: [
            {
              name: "QuickStart outbound",
              timing: { from: "00:00", to: "23:59" },
              days: {
                "0": true,
                "1": true,
                "2": true,
                "3": true,
                "4": true,
                "5": true,
                "6": true,
              },
              timezone: "Etc/GMT+12",
            },
          ],
          start_date: today,
          end_date: endDate,
        },
        sequences: [
          {
            steps: [
              {
                type: "email",
                delay: 0,
                delay_unit: "days",
                pre_delay: 0,
                pre_delay_unit: "days",
                variants: [{ subject, body }],
              },
            ],
          },
        ],
        email_list: availableAccounts,
        daily_limit: 50,
        stop_on_reply: true,
        insert_unsubscribe_header: true,
        open_tracking: true,
        link_tracking: true,
        text_only: false,
      }),
    });
    const campaignId = String(campaign.id ?? "");
    if (!campaignId) {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: "Instantly did not return a campaign id.",
      });
    }

    const nameParts = lead.name?.trim().split(/\s+/) ?? [];
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ");
    try {
      await this.instantlyRequest("/leads", {
        method: "POST",
        body: JSON.stringify({
          campaign: campaignId,
          email: lead.email,
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
          ...(lead.company ? { company_name: lead.company } : {}),
          ...(lead.website ? { website: lead.website } : {}),
          personalization: lead.summary || lead.notes || "",
          custom_variables: {
            quickstart_source: lead.source ?? "manual",
            category: lead.category ?? "",
            location: lead.location ?? "",
            run_id: lead.runId ?? "",
          },
          skip_if_in_workspace: false,
          skip_if_in_campaign: true,
          verify_leads_on_import: false,
        }),
      });
    } catch (err) {
      await this.instantlyRequest(`/campaigns/${encodeURIComponent(campaignId)}`, {
        method: "DELETE",
      }).catch(() => undefined);
      throw err;
    }

    await this.repo.saveEmailCampaign({
      workspaceId,
      provider: "instantly",
      campaignId,
      subject,
      createdBy: createdBy ?? null,
      recipientEmails: [lead.email],
      lead: { ...lead },
      metadata: {
        campaign_name: campaignName,
        account_emails: availableAccounts,
        body,
      },
    });

    const row = await this.repo.getEmailCampaign(workspaceId, "instantly", campaignId);
    return {
      ...this.mapInstantlyCampaign(campaign, row, {
        leads: 1,
        contacted: 0,
        opens: 0,
        replies: 0,
      }),
      body,
      lead,
      sendEvent: { status: "pending", sentAt: null, messageId: null },
      links: this.instantlyDetailLinks(workspaceId, campaignId, lead),
    };
  }

  async activateInstantlyCampaign(
    workspaceId: string,
    campaignId: string,
    activatedBy?: string,
  ): Promise<{ activated: boolean; campaignId: string }> {
    const row = await this.repo.getEmailCampaign(workspaceId, "instantly", campaignId);
    if (!row) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Campaign not found in this workspace.",
      });
    }
    if (row.metadata && typeof row.metadata.sent_at === "string") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Campaign has already been activated.",
      });
    }
    await this.instantlyRequest(`/campaigns/${encodeURIComponent(campaignId)}/activate`, {
      method: "POST",
    });
    await this.repo
      .markEmailCampaignSent(workspaceId, "instantly", campaignId, activatedBy ?? null)
      .catch(() => undefined);
    return { activated: true, campaignId };
  }

  async pauseInstantlyCampaign(
    workspaceId: string,
    campaignId: string,
  ): Promise<{ paused: boolean; campaignId: string }> {
    const row = await this.repo.getEmailCampaign(workspaceId, "instantly", campaignId);
    if (!row) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Campaign not found in this workspace.",
      });
    }
    await this.instantlyRequest(`/campaigns/${encodeURIComponent(campaignId)}/pause`, {
      method: "POST",
    });
    return { paused: true, campaignId };
  }

  async resumeInstantlyCampaign(
    workspaceId: string,
    campaignId: string,
  ): Promise<{ resumed: boolean; campaignId: string }> {
    const row = await this.repo.getEmailCampaign(workspaceId, "instantly", campaignId);
    if (!row) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Campaign not found in this workspace.",
      });
    }
    await this.instantlyRequest(`/campaigns/${encodeURIComponent(campaignId)}/activate`, {
      method: "POST",
    });
    return { resumed: true, campaignId };
  }

  async deleteInstantlyCampaign(
    workspaceId: string,
    campaignId: string,
  ): Promise<{ deleted: boolean; campaignId: string }> {
    const row = await this.repo.getEmailCampaign(workspaceId, "instantly", campaignId);
    if (!row) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Campaign not found in this workspace.",
      });
    }
    await this.instantlyRequest(`/campaigns/${encodeURIComponent(campaignId)}`, {
      method: "DELETE",
    });
    await this.repo.deleteEmailCampaign(workspaceId, "instantly", campaignId);
    return { deleted: true, campaignId };
  }

  async personalizeMailchimpEmail(
    workspaceId: string,
    input: PersonalizeEmailInput,
  ): Promise<PersonalizedEmail> {
    const email = String(input.lead?.email ?? "")
      .trim()
      .toLowerCase();
    const brief = String(input.brief ?? "").trim();
    const fromName = String(input.fromName ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "A valid lead email is required.",
      });
    }
    if (!brief || !fromName) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "A campaign brief and sender name are required.",
      });
    }

    const lead = {
      email,
      name: String(input.lead.name ?? "").trim(),
      company: String(input.lead.company ?? "").trim(),
      website: String(input.lead.website ?? "").trim(),
      category: String(input.lead.category ?? "").trim(),
      location: String(input.lead.location ?? "").trim(),
      summary: String(input.lead.summary ?? "").trim(),
      notes: String(input.lead.notes ?? "").trim(),
      fitReasons: Array.isArray(input.lead.fitReasons) ? input.lead.fitReasons.slice(0, 5) : [],
      evidence: Array.isArray(input.lead.evidence) ? input.lead.evidence.slice(0, 5) : [],
    };

    const fallbackEmail = (): PersonalizedEmail => {
      const recipient = lead.name ? lead.name.split(/\s+/)[0] : "there";
      const context =
        lead.summary ||
        lead.notes ||
        (lead.company
          ? `I came across ${lead.company}${
              lead.category ? ` while looking at ${lead.category} businesses` : ""
            }${lead.location ? ` in ${lead.location}` : ""}.`
          : "");
      const html = mailchimpHtml(
        [
          `Hi ${recipient},`,
          brief,
          context,
          "Would you be open to a quick 10-minute call this week?",
          `Best,\n${fromName}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
      return {
        subject: `A quick idea for ${lead.company || "your practice"}`.slice(0, 150),
        html,
        source: "fallback",
      };
    };

    const internalToken = process.env.MODEL_GATEWAY_INTERNAL_TOKEN;
    if (!internalToken) return fallbackEmail();
    const baseUrl = (process.env.MODEL_GATEWAY_URL ?? "http://127.0.0.1:3005").replace(/\/$/, "");
    const profile = process.env.EMAIL_CAMPAIGN_MODEL_PROFILE?.trim() || "groq";
    const modelId = process.env.EMAIL_CAMPAIGN_MODEL_ID?.trim() || "openai/gpt-oss-120b";

    try {
      const res = await fetch(`${baseUrl}/internal/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${internalToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          request_id: randomUUID(),
          model: { profile, model_id: modelId },
          messages: [
            {
              role: "system",
              content:
                'You write concise, personalized B2B cold emails. Return strict JSON only: {"subject":"...","html":"..."}. Use 80-130 words. Be specific and friendly. Reference the lead\'s company, category, location, and one concrete detail from the summary or evidence. Do not invent facts. Include one clear call to action. Use simple HTML with <p> tags. No markdown fences.',
            },
            {
              role: "user",
              content: `Campaign brief:\n${brief}\n\nSender: ${fromName}\n\nLead details JSON:\n${JSON.stringify(lead)}`,
            },
          ],
          max_tokens: 900,
          temperature: 0.6,
        }),
      });
      if (!res.ok) return fallbackEmail();
      const body = (await res.json()) as { content?: string };
      const parsed = parseGeneratedEmail(String(body.content ?? ""));
      if (parsed) return { ...parsed, source: "ai" };
    } catch {
      // Fall through to the deterministic personalized template.
    }
    return fallbackEmail();
  }

  async createMailchimpCampaign(
    workspaceId: string,
    input: CreateMailchimpCampaignInput,
    createdBy?: string,
  ): Promise<MailchimpCampaignDraft> {
    if (!input.confirmConsent) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Confirm that the recipients consented to receive email.",
      });
    }

    const audienceId = input.audienceId?.trim();
    const subject = input.subject?.trim().slice(0, 150);
    const fromName = input.fromName?.trim().slice(0, 100);
    const replyTo = input.replyTo?.trim();
    if (!audienceId || !subject || !fromName || !replyTo) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Audience, subject, from name, and reply-to are required.",
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Reply-to must be a valid email address.",
      });
    }

    const html = mailchimpHtml(input.html);
    const emailInput = Array.isArray(input.recipientEmails) ? input.recipientEmails : [];
    const uniqueEmails = [
      ...new Set(emailInput.map((email) => String(email).trim().toLowerCase()).filter(Boolean)),
    ];
    if (uniqueEmails.length === 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "At least one recipient email is required.",
      });
    }
    const validEmails = uniqueEmails.filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (validEmails.length === 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "None of the recipient emails are valid.",
      });
    }

    const ctx = await this.mailchimpContext(workspaceId);
    const recipients = {
      total: uniqueEmails.length,
      valid: validEmails.length,
      subscribed: 0,
      pending: 0,
      unsubscribed: 0,
      failed: 0,
      invalid: uniqueEmails.length - validEmails.length,
    };
    let lastError: unknown = null;

    // Upsert members in small batches to stay well below Mailchimp's rate limit.
    for (let index = 0; index < validEmails.length; index += 10) {
      await Promise.all(
        validEmails.slice(index, index + 10).map(async (email) => {
          try {
            const member = await this.mailchimpRequest<{ status?: string }>(
              ctx,
              `/lists/${encodeURIComponent(audienceId)}/members/${createHash("md5").update(email).digest("hex")}`,
              {
                method: "PUT",
                body: JSON.stringify({
                  email_address: email,
                  status_if_new: "subscribed",
                }),
              },
            );
            const status = member.status ?? "subscribed";
            if (status === "pending") recipients.pending += 1;
            else if (status === "unsubscribed" || status === "cleaned")
              recipients.unsubscribed += 1;
            else recipients.subscribed += 1;
          } catch (err) {
            recipients.failed += 1;
            lastError = err;
          }
        }),
      );
    }

    if (recipients.subscribed === 0) {
      if (lastError instanceof AppError) throw lastError;
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          recipients.pending > 0
            ? "Recipients are pending double opt-in confirmation in Mailchimp."
            : "No recipients could be added to the Mailchimp audience.",
      });
    }

    const segment = await this.mailchimpRequest<{ id?: number }>(
      ctx,
      `/lists/${encodeURIComponent(audienceId)}/segments`,
      {
        method: "POST",
        body: JSON.stringify({
          name: `QuickStart ${subject} ${new Date().toISOString()}`,
          static_segment: validEmails,
        }),
      },
    );
    if (typeof segment.id !== "number") {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: "Mailchimp did not return a segment id.",
      });
    }

    const campaign = await this.mailchimpRequest<{
      id?: string;
      web_id?: number;
      status?: string;
    }>(ctx, "/campaigns", {
      method: "POST",
      body: JSON.stringify({
        type: "regular",
        recipients: {
          list_id: audienceId,
          segment_opts: { saved_segment_id: segment.id },
        },
        settings: {
          subject_line: subject,
          title: (input.title?.trim() || subject).slice(0, 100),
          from_name: fromName,
          reply_to: replyTo,
          preview_text: String(input.previewText ?? "")
            .trim()
            .slice(0, 150),
        },
      }),
    });
    if (!campaign.id) {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: "Mailchimp did not return a campaign id.",
      });
    }

    await this.mailchimpRequest(ctx, `/campaigns/${encodeURIComponent(campaign.id)}/content`, {
      method: "PUT",
      body: JSON.stringify({ html }),
    });

    try {
      await this.repo.saveEmailCampaign({
        workspaceId,
        provider: "mailchimp",
        campaignId: campaign.id,
        audienceId,
        subject,
        createdBy: createdBy ?? null,
        recipientEmails: validEmails,
        lead: input.lead ? { ...input.lead } : null,
      });
    } catch {
      // Do not leave an unowned draft behind if ownership tracking fails.
      await this.mailchimpRequest(ctx, `/campaigns/${encodeURIComponent(campaign.id)}`, {
        method: "DELETE",
      }).catch(() => undefined);
      throw new AppError({
        code: ErrorCode.INTERNAL,
        message:
          "The Mailchimp draft was created but could not be registered to this workspace. Please try again.",
      });
    }

    const webId = typeof campaign.web_id === "number" ? campaign.web_id : null;
    return {
      campaignId: campaign.id,
      webId,
      status: campaign.status ?? "save",
      audienceId,
      segmentId: segment.id,
      recipients,
      editUrl: webId ? `https://${ctx.dc}.admin.mailchimp.com/campaigns/edit?id=${webId}` : null,
      previewHtml: html,
    };
  }

  async sendMailchimpCampaign(
    workspaceId: string,
    campaignId: string,
    confirm: boolean,
    sentBy?: string,
  ): Promise<{ sent: boolean; campaignId: string }> {
    if (!confirm) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Sending requires explicit confirmation.",
      });
    }
    if (!campaignId?.trim()) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "campaignId is required.",
      });
    }

    const ctx = await this.mailchimpContext(workspaceId);
    const row = await this.repo.getEmailCampaign(workspaceId, "mailchimp", campaignId);
    if (!row) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Campaign not found in this workspace.",
      });
    }
    if (row.metadata && typeof row.metadata.sent_at === "string") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Campaign has already been sent.",
      });
    }

    const campaign = await this.mailchimpRequest<{
      status?: string;
      emails_sent?: number;
      send_time?: string;
      recipients?: { recipient_count?: number };
    }>(ctx, `/campaigns/${encodeURIComponent(campaignId)}`);

    if (Number(campaign.emails_sent ?? 0) > 0 || campaign.send_time) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Campaign has already been sent.",
      });
    }
    if (campaign.status !== "save") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Only draft campaigns can be sent (current status: ${campaign.status ?? "unknown"}).`,
      });
    }
    if (!campaign.recipients?.recipient_count) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Campaign has no recipients.",
      });
    }

    await this.mailchimpRequest(ctx, `/campaigns/${encodeURIComponent(campaignId)}/actions/send`, {
      method: "POST",
      body: "{}",
    });
    await this.repo
      .markEmailCampaignSent(workspaceId, "mailchimp", campaignId, sentBy ?? null)
      .catch(() => undefined);
    return { sent: true, campaignId };
  }

  async saveCredentials(
    workspaceId: string,
    provider: IntegrationProvider,
    credentials: Record<string, string>,
  ): Promise<IntegrationCatalogItem> {
    const def = CATALOG_DEFINITIONS.find((d) => d.id === provider);
    if (!def) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: `Unknown provider '${provider}'`,
      });
    }

    const adapter = this.registry.getAdapter(provider);
    if (!adapter.verifyCredentials) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Provider '${provider}' does not support credential submission.`,
      });
    }

    // Verify real credentials with the provider
    const verification = await adapter.verifyCredentials(credentials);

    // Store encrypted credentials in secrets-service
    await this.secrets.storeIntegrationSecret(workspaceId, provider, {
      ...credentials,
      verifiedAt: new Date().toISOString(),
    });

    await this.repo.upsertConnection({
      workspaceId,
      provider,
      status: "connected",
      accountIdentifier: verification.accountIdentifier,
      accountEmail: verification.accountEmail,
      accountName: verification.accountName,
      providerAccountId: verification.providerAccountId,
      grantedScopes: verification.grantedScopes ?? [],
      metadata: verification.metadata ?? {},
    });

    return this.getIntegration(workspaceId, provider);
  }

  async syncIntegration(
    workspaceId: string,
    provider: IntegrationProvider,
    body: IntegrationSyncRequest,
  ): Promise<IntegrationSyncResult> {
    const connection = await this.repo.getByProvider(workspaceId, provider);
    if (!connection || connection.status !== "connected") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Integration '${provider}' is not connected.`,
      });
    }

    const adapter = this.registry.getAdapter(provider);
    if (!adapter.syncResource) {
      return {
        success: true,
        provider,
        recordsSynced: 0,
        durationMs: 0,
        message: `Provider '${provider}' does not support resource synchronization.`,
      };
    }

    // Retrieve decrypted token
    const creds = await this.secrets.getIntegrationSecret(workspaceId, provider);
    const token =
      (creds?.accessToken as string) ||
      (creds?.accountSid && creds?.authToken ? `${creds.accountSid}:${creds.authToken}` : "");

    if (!token) {
      throw new AppError({
        code: ErrorCode.UNAUTHORIZED,
        message: `Missing stored credentials for '${provider}'. Please reconnect.`,
      });
    }

    const start = Date.now();
    try {
      const syncResult = await adapter.syncResource({
        accessToken: token,
        operation: body.operation,
        resourceType: body.resourceType,
        options: body.options,
      });
      const durationMs = Date.now() - start;

      await this.repo.recordSyncLog({
        workspaceId,
        provider,
        operation: body.operation,
        status: "success",
        recordsSynced: syncResult.recordsSynced,
        durationMs,
        metadata: syncResult.details ?? {},
      });

      return {
        success: true,
        provider,
        recordsSynced: syncResult.recordsSynced,
        durationMs,
        resources: syncResult.resources,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : "Sync failed";

      await this.repo.recordSyncLog({
        workspaceId,
        provider,
        operation: body.operation,
        status: "failed",
        recordsSynced: 0,
        durationMs,
        errorMessage,
      });

      return {
        success: false,
        provider,
        durationMs,
        error: { code: "SYNC_FAILED", message: errorMessage },
      };
    }
  }

  async listSyncHistory(
    workspaceId: string,
    provider?: IntegrationProvider,
  ): Promise<SyncLogRow[]> {
    return this.repo.listSyncLogs(workspaceId, provider, 20);
  }

  /**
   * Appointment actions for the built-in agent calendar tool.
   * Credentials stay in workspace-service; callers only see the calendar result.
   */
  async executeCalendarAction(
    workspaceId: string,
    input: CalendarActionInput,
  ): Promise<CalendarActionResult> {
    const provider: IntegrationProvider = "google_calendar";
    const connection = await this.repo.getByProvider(workspaceId, provider);
    if (!connection || connection.status !== "connected") {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          "Google Calendar is not connected for this workspace. Connect it in Settings → Integrations.",
      });
    }

    const credentials = await this.secrets.getIntegrationSecret(workspaceId, provider);
    let accessToken = typeof credentials?.accessToken === "string" ? credentials.accessToken : "";
    let refreshToken =
      typeof credentials?.refreshToken === "string" ? credentials.refreshToken : "";
    if (!accessToken) {
      throw new AppError({
        code: ErrorCode.UNAUTHORIZED,
        message: "Missing stored Google Calendar credentials. Reconnect the integration.",
      });
    }

    if (this.tokenExpiring(connection.token_expires_at)) {
      const refreshed = await this.refreshProviderAccess(
        workspaceId,
        provider,
        refreshToken,
        connection.granted_scopes,
      );
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
    }

    const calendarId = input.calendar_id?.trim() || "primary";
    const timezone = input.timezone?.trim() || "UTC";

    try {
      return await this.runCalendarAction(accessToken, calendarId, timezone, input);
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 401 && refreshToken) {
        const refreshed = await this.refreshProviderAccess(
          workspaceId,
          provider,
          refreshToken,
          connection.granted_scopes,
        );
        return this.runCalendarAction(refreshed.accessToken, calendarId, timezone, input);
      }
      if (err instanceof GoogleApiError) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: `Google Calendar error (${err.status || "network"}): ${err.message}`,
        });
      }
      throw err;
    }
  }

  /**
   * Execute a built-in action on a connected integration. Credentials stay in
   * workspace-service; the runtime only supplies the action and its arguments.
   */
  async executeIntegrationAction(
    workspaceId: string,
    provider: IntegrationProvider,
    action: string,
    input: Record<string, unknown>,
  ): Promise<IntegrationActionResult> {
    if (!INTEGRATION_ACTION_PROVIDERS.has(provider)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Integration '${provider}' has no built-in agent actions`,
      });
    }
    const connection = await this.repo.getByProvider(workspaceId, provider);
    if (!connection || connection.status !== "connected") {
      return {
        ok: false,
        error: `${provider} is not connected for this workspace`,
        notConnected: true,
      };
    }

    const credentials = (await this.secrets.getIntegrationSecret(workspaceId, provider)) ?? {};
    let accessToken =
      typeof credentials.accessToken === "string" ? credentials.accessToken : undefined;
    let refreshToken = typeof credentials.refreshToken === "string" ? credentials.refreshToken : "";
    const adapter = this.registry.getAdapter(provider);

    if (
      accessToken &&
      refreshToken &&
      adapter.refreshToken &&
      this.tokenExpiring(connection.token_expires_at)
    ) {
      const refreshed = await this.refreshProviderAccess(
        workspaceId,
        provider,
        refreshToken,
        connection.granted_scopes,
      );
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
    }

    const run = () =>
      executeIntegrationAction({
        provider,
        action,
        input,
        accessToken,
        credentials,
        connection: {
          accountIdentifier: connection.account_identifier,
          accountName: connection.account_name ?? null,
          metadata: connection.metadata,
        },
      });

    let result = await run();
    if (!result.ok && result.status === 401 && refreshToken && adapter.refreshToken) {
      const refreshed = await this.refreshProviderAccess(
        workspaceId,
        provider,
        refreshToken,
        connection.granted_scopes,
      );
      accessToken = refreshed.accessToken;
      result = await run();
    }
    return result;
  }

  private tokenExpiring(expiresAt?: Date | null): boolean {
    if (!expiresAt) return false;
    return expiresAt.getTime() - Date.now() < 60_000;
  }

  private async refreshProviderAccess(
    workspaceId: string,
    provider: IntegrationProvider,
    refreshToken: string,
    grantedScopes: string[],
  ): Promise<{ accessToken: string; refreshToken: string }> {
    if (!refreshToken) {
      throw new AppError({
        code: ErrorCode.UNAUTHORIZED,
        message: `${provider} refresh token is missing. Reconnect the integration.`,
      });
    }
    const adapter = this.registry.getAdapter(provider);
    if (!adapter.refreshToken) {
      throw new AppError({
        code: ErrorCode.UNAUTHORIZED,
        message: `${provider} token refresh is not supported. Reconnect the integration.`,
      });
    }
    let refreshed: { accessToken: string; refreshToken?: string; expiresIn?: number };
    try {
      refreshed = await adapter.refreshToken(refreshToken);
    } catch (err) {
      throw new AppError({
        code: ErrorCode.UNAUTHORIZED,
        message: `${provider} token refresh failed: ${
          err instanceof Error ? err.message : "unknown error"
        }. Reconnect the integration.`,
      });
    }
    const nextRefreshToken = refreshed.refreshToken ?? refreshToken;
    const existing = (await this.secrets.getIntegrationSecret(workspaceId, provider)) ?? {};
    await this.secrets.storeIntegrationSecret(workspaceId, provider, {
      ...existing,
      accessToken: refreshed.accessToken,
      refreshToken: nextRefreshToken,
      storedAt: new Date().toISOString(),
    });
    await this.repo.upsertConnection({
      workspaceId,
      provider,
      status: "connected",
      grantedScopes,
      tokenExpiresAt: refreshed.expiresIn
        ? new Date(Date.now() + refreshed.expiresIn * 1000)
        : null,
    });
    return { accessToken: refreshed.accessToken, refreshToken: nextRefreshToken };
  }

  private async runCalendarAction(
    accessToken: string,
    calendarId: string,
    timezone: string,
    input: CalendarActionInput,
  ): Promise<CalendarActionResult> {
    if (input.action === "check_availability") {
      const date = input.date?.trim() ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "date must be YYYY-MM-DD for check_availability",
        });
      }
      const workStart = input.working_hours?.start?.trim() || "09:00";
      const workEnd = input.working_hours?.end?.trim() || "17:00";
      const timeMin = zonedDateTimeToUtc(date, workStart, timezone);
      const timeMax = zonedDateTimeToUtc(date, workEnd, timezone);
      if (timeMax.getTime() <= timeMin.getTime()) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "working_hours.end must be after working_hours.start",
        });
      }
      const slotMinutes = clamp(input.slot_minutes ?? 30, 5, 240);
      const maxSlots = clamp(input.max_slots ?? 6, 1, 20);

      const body = await this.googleJson(
        "https://www.googleapis.com/calendar/v3/freeBusy",
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            timeZone: timezone,
            items: [{ id: calendarId }],
          }),
        },
      );
      const calendars = body.calendars as
        Record<string, { busy?: Array<{ start?: string; end?: string }> }> | undefined;
      const busy = (calendars?.[calendarId]?.busy ?? [])
        .map((interval) => {
          const start = interval.start ? new Date(interval.start).getTime() : NaN;
          const end = interval.end ? new Date(interval.end).getTime() : NaN;
          return Number.isFinite(start) && Number.isFinite(end) ? [start, end] : null;
        })
        .filter((interval): interval is [number, number] => interval !== null);

      const slotMs = slotMinutes * 60_000;
      const slots: Array<{ start: string; end: string; label: string }> = [];
      for (let start = timeMin.getTime(); start + slotMs <= timeMax.getTime(); start += slotMs) {
        const end = start + slotMs;
        if (busy.some(([busyStart, busyEnd]) => start < busyEnd && end > busyStart)) continue;
        slots.push({
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          label: formatLocalTime(start, timezone),
        });
        if (slots.length >= maxSlots) break;
      }

      return {
        action: "check_availability",
        calendar_id: calendarId,
        timezone,
        date,
        slot_minutes: slotMinutes,
        slots,
        busy_periods: busy.length,
      };
    }

    if (input.action === "book_slot") {
      const rawStart = input.start?.trim() ?? "";
      const rawEnd = input.end?.trim() ?? "";
      if (!rawStart || !rawEnd) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "start and end are required for book_slot",
        });
      }
      const start = parseCalendarTime(rawStart, timezone);
      const end = parseCalendarTime(rawEnd, timezone);
      if (end.getTime() <= start.getTime()) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "end must be after start",
        });
      }
      const summary = input.summary?.trim() || "Appointment";
      const body = await this.googleJson(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            summary,
            description: input.description?.trim() || "",
            start: { dateTime: start.toISOString(), timeZone: timezone },
            end: { dateTime: end.toISOString(), timeZone: timezone },
            ...(input.attendee_email?.trim()
              ? { attendees: [{ email: input.attendee_email.trim() }] }
              : {}),
          }),
        },
      );
      return {
        action: "book_slot",
        calendar_id: calendarId,
        event_id: body.id ?? null,
        html_link: body.htmlLink ?? null,
        summary,
        start: start.toISOString(),
        end: end.toISOString(),
      };
    }

    const eventId = input.event_id?.trim();
    if (!eventId) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "event_id is required for cancel_event",
      });
    }
    await this.googleJson(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarId,
      )}/events/${encodeURIComponent(eventId)}`,
      accessToken,
      { method: "DELETE" },
    );
    return {
      action: "cancel_event",
      calendar_id: calendarId,
      event_id: eventId,
      cancelled: true,
    };
  }

  private async googleJson(
    url: string,
    accessToken: string,
    init: { method: string; body?: string },
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: init.method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: init.body,
        signal: controller.signal,
      });
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        body = { raw: text.slice(0, 200) };
      }
      if (!res.ok) {
        const error = body.error as { message?: string } | string | undefined;
        const message =
          typeof error === "string" ? error : (error?.message ?? `HTTP ${res.status}`);
        throw new GoogleApiError(res.status, message);
      }
      return body;
    } catch (err) {
      if (err instanceof GoogleApiError) throw err;
      throw new GoogleApiError(
        0,
        err instanceof Error ? err.message : "Google Calendar network error",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async disconnect(
    workspaceId: string,
    provider: IntegrationProvider,
  ): Promise<IntegrationCatalogItem> {
    const creds = await this.secrets.getIntegrationSecret(workspaceId, provider);
    const token = creds?.accessToken as string | undefined;

    const adapter = this.registry.getAdapter(provider);
    if (token && adapter.revokeToken) {
      try {
        await adapter.revokeToken(token);
      } catch {
        // Best-effort remote revocation
      }
    }

    // Delete credentials from secrets-service
    await this.secrets.deleteIntegrationSecret(workspaceId, provider);

    // Update connection status in database
    await this.repo.deleteConnection(workspaceId, provider);

    return this.getIntegration(workspaceId, provider);
  }
}
