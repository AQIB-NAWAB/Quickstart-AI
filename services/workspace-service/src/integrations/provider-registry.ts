import { createHash } from "node:crypto";
import { AppError, ErrorCode } from "@quickstart/errors";
import type { IntegrationProvider, ProviderCapabilities } from "@quickstart/contracts";
import type {
  ProviderAdapter,
  ProviderCredentialsVerification,
  ProviderSyncParams,
  ProviderSyncResult,
  ProviderTokenResult,
} from "./types.js";

function base64UrlSha256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function basicAuth(username: string, password = ""): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

export class ProviderRegistry {
  private readonly adapters = new Map<IntegrationProvider, ProviderAdapter>();

  constructor() {
    this.registerGoogleCalendarAdapter();
    this.registerGoogleSheetsAdapter();
    this.registerHubSpotAdapter();
    this.registerSalesforceAdapter();
    this.registerSlackAdapter();
    this.registerTwilioAdapter();
    this.registerZendeskAdapter();
    this.registerNotionAdapter();
    this.registerMailchimpAdapter();
    this.registerApifyAdapter();
  }

  getAdapter(provider: IntegrationProvider): ProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: `No provider adapter registered for '${provider}'`,
      });
    }
    return adapter;
  }

  listCapabilities(): Record<IntegrationProvider, ProviderCapabilities> {
    const result = {} as Record<IntegrationProvider, ProviderCapabilities>;
    for (const [provider, adapter] of this.adapters.entries()) {
      result[provider] = adapter.capabilities;
    }
    return result;
  }

  // 1. Google Calendar
  private registerGoogleCalendarAdapter(): void {
    const capabilities: ProviderCapabilities = {
      authorizationSupport: "oauth2",
      credentialVerification: true,
      accountDiscovery: true,
      refreshSupport: true,
      revocationSupport: true,
      supportedOperations: ["discover_calendars", "read_freebusy", "create_event", "cancel_event"],
      syncDirections: ["bidirectional"],
      requiredScopes: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
        "openid",
        "email",
        "profile",
      ],
      rateLimitPerMinute: 600,
    };

    this.adapters.set("google_calendar", {
      provider: "google_calendar",
      capabilities,
      getAuthorizationUrl({ state, redirectUri, codeVerifier, scopes }) {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "GOOGLE_CLIENT_ID is not configured in environment.",
          });
        }
        const effectiveScopes = scopes && scopes.length > 0 ? scopes : capabilities.requiredScopes;
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: effectiveScopes.join(" "),
          state,
          access_type: "offline",
          prompt: "consent",
        });
        if (codeVerifier) {
          params.set("code_challenge", base64UrlSha256(codeVerifier));
          params.set("code_challenge_method", "S256");
        }
        return {
          url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
          codeChallenge: codeVerifier ? base64UrlSha256(codeVerifier) : undefined,
        };
      },
      async exchangeCode({ code, redirectUri, codeVerifier }): Promise<ProviderTokenResult> {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) not configured.",
          });
        }
        const body = new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        });
        if (codeVerifier) body.set("code_verifier", codeVerifier);

        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        const tokenJson = (await tokenRes.json()) as Record<string, any>;
        if (!tokenRes.ok || tokenJson.error) {
          throw new AppError({
            code: ErrorCode.UPSTREAM_UNAVAILABLE,
            message: `Google OAuth token exchange failed: ${tokenJson.error_description || tokenJson.error || "Unknown error"}`,
          });
        }

        // Discover real account identity via userinfo
        const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });
        const userinfo = userinfoRes.ok ? ((await userinfoRes.json()) as Record<string, any>) : {};

        return {
          accessToken: tokenJson.access_token,
          refreshToken: tokenJson.refresh_token,
          expiresIn: tokenJson.expires_in,
          tokenType: tokenJson.token_type,
          grantedScopes: (tokenJson.scope || "").split(" ").filter(Boolean),
          accountIdentifier: userinfo.email || userinfo.sub || "google-calendar-account",
          accountEmail: userinfo.email || null,
          accountName: userinfo.name || null,
          providerAccountId: userinfo.sub || null,
          rawPayload: tokenJson,
        };
      },
      async refreshToken(refreshToken: string) {
        const clientId = process.env.GOOGLE_CLIENT_ID!;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }).toString(),
        });
        const json = (await res.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          error_description?: string;
        };
        if (!res.ok) throw new Error(json.error_description || "Token refresh failed");
        return {
          accessToken: json.access_token ?? "",
          refreshToken: json.refresh_token || refreshToken,
          expiresIn: json.expires_in,
        };
      },
      async syncResource({ accessToken, operation }: ProviderSyncParams): Promise<ProviderSyncResult> {
        if (operation === "discover_resources" || operation === "manual_sync") {
          const calRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!calRes.ok) throw new Error(`Google Calendar API error HTTP ${calRes.status}`);
          const data = (await calRes.json()) as { items?: Array<{ id: string; summary: string; primary?: boolean }> };
          const items = (data.items || []).map((c) => ({
            id: c.id,
            name: c.summary,
            type: "calendar",
            metadata: { is_primary: Boolean(c.primary) },
          }));
          return { recordsSynced: items.length, resources: items };
        }
        return { recordsSynced: 0 };
      },
    });
  }

  // 2. Google Sheets
  private registerGoogleSheetsAdapter(): void {
    const capabilities: ProviderCapabilities = {
      authorizationSupport: "oauth2",
      credentialVerification: true,
      accountDiscovery: true,
      refreshSupport: true,
      revocationSupport: true,
      supportedOperations: ["discover_sheets", "export_rows", "append_row"],
      syncDirections: ["outbound"],
      requiredScopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.readonly",
        "openid",
        "email",
      ],
      rateLimitPerMinute: 300,
    };

    this.adapters.set("google_sheets", {
      provider: "google_sheets",
      capabilities,
      getAuthorizationUrl({ state, redirectUri, codeVerifier, scopes }) {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "GOOGLE_CLIENT_ID not configured.",
          });
        }
        const effectiveScopes = scopes && scopes.length > 0 ? scopes : capabilities.requiredScopes;
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: effectiveScopes.join(" "),
          state,
          access_type: "offline",
          prompt: "consent",
        });
        if (codeVerifier) {
          params.set("code_challenge", base64UrlSha256(codeVerifier));
          params.set("code_challenge_method", "S256");
        }
        return {
          url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
          codeChallenge: codeVerifier ? base64UrlSha256(codeVerifier) : undefined,
        };
      },
      async exchangeCode({ code, redirectUri, codeVerifier }): Promise<ProviderTokenResult> {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "Google OAuth credentials not configured.",
          });
        }
        const body = new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        });
        if (codeVerifier) body.set("code_verifier", codeVerifier);

        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        const tokenJson = (await tokenRes.json()) as Record<string, any>;
        if (!tokenRes.ok || tokenJson.error) {
          throw new AppError({
            code: ErrorCode.UPSTREAM_UNAVAILABLE,
            message: `Google Sheets OAuth failed: ${tokenJson.error_description || tokenJson.error}`,
          });
        }

        const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });
        const userinfo = userinfoRes.ok ? ((await userinfoRes.json()) as Record<string, any>) : {};

        return {
          accessToken: tokenJson.access_token,
          refreshToken: tokenJson.refresh_token,
          expiresIn: tokenJson.expires_in,
          tokenType: tokenJson.token_type,
          grantedScopes: (tokenJson.scope || "").split(" ").filter(Boolean),
          accountIdentifier: userinfo.email || userinfo.sub || "google-sheets-account",
          accountEmail: userinfo.email || null,
          accountName: userinfo.name || null,
          providerAccountId: userinfo.sub || null,
          rawPayload: tokenJson,
        };
      },
      async refreshToken(refreshToken: string) {
        const clientId = process.env.GOOGLE_CLIENT_ID!;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }).toString(),
        });
        const json = (await res.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          error_description?: string;
        };
        if (!res.ok) throw new Error(json.error_description || "Token refresh failed");
        return {
          accessToken: json.access_token ?? "",
          refreshToken: json.refresh_token || refreshToken,
          expiresIn: json.expires_in,
        };
      },
      async syncResource({ accessToken, operation }: ProviderSyncParams): Promise<ProviderSyncResult> {
        if (operation === "discover_resources" || operation === "manual_sync") {
          const filesRes = await fetch(
            "https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'&fields=files(id,name)",
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (!filesRes.ok) throw new Error(`Google Drive API error HTTP ${filesRes.status}`);
          const data = (await filesRes.json()) as { files?: Array<{ id: string; name: string }> };
          const items = (data.files || []).map((f) => ({
            id: f.id,
            name: f.name,
            type: "spreadsheet",
          }));
          return { recordsSynced: items.length, resources: items };
        }
        return { recordsSynced: 0 };
      },
    });
  }

  // 3. HubSpot
  private registerHubSpotAdapter(): void {
    const capabilities: ProviderCapabilities = {
      authorizationSupport: "oauth2",
      credentialVerification: true,
      accountDiscovery: true,
      refreshSupport: true,
      revocationSupport: true,
      supportedOperations: ["sync_contacts", "sync_deals", "create_contact"],
      syncDirections: ["bidirectional"],
      requiredScopes: ["crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.deals.read"],
      rateLimitPerMinute: 100,
    };

    this.adapters.set("hubspot", {
      provider: "hubspot",
      capabilities,
      getAuthorizationUrl({ state, redirectUri, scopes }) {
        const clientId = process.env.HUBSPOT_CLIENT_ID;
        if (!clientId) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "HUBSPOT_CLIENT_ID not configured.",
          });
        }
        const effectiveScopes = scopes && scopes.length > 0 ? scopes : capabilities.requiredScopes;
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: effectiveScopes.join(" "),
          state,
        });
        return { url: `https://app.hubspot.com/oauth/authorize?${params.toString()}` };
      },
      async exchangeCode({ code, redirectUri }): Promise<ProviderTokenResult> {
        const clientId = process.env.HUBSPOT_CLIENT_ID;
        const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "HubSpot OAuth credentials (HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET) not configured.",
          });
        }
        const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
          }).toString(),
        });
        const json = (await res.json()) as Record<string, any>;
        if (!res.ok) {
          throw new AppError({
            code: ErrorCode.UPSTREAM_UNAVAILABLE,
            message: `HubSpot token exchange failed: ${json.message || json.error}`,
          });
        }

        // Discover account metadata
        const metaRes = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${json.access_token}`);
        const meta = metaRes.ok ? ((await metaRes.json()) as Record<string, any>) : {};

        return {
          accessToken: json.access_token,
          refreshToken: json.refresh_token,
          expiresIn: json.expires_in,
          grantedScopes: (json.scopes || meta.scopes || []).map(String),
          accountIdentifier: String(meta.hub_id || meta.user || "hubspot-portal"),
          accountEmail: meta.user || null,
          accountName: meta.hub_domain || `HubSpot Portal ${meta.hub_id || ""}`,
          providerAccountId: meta.hub_id ? String(meta.hub_id) : null,
          rawPayload: json,
        };
      },
      async syncResource({ accessToken, operation }: ProviderSyncParams): Promise<ProviderSyncResult> {
        if (operation === "sync_contacts" || operation === "manual_sync") {
          const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=25", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) throw new Error(`HubSpot API error HTTP ${res.status}`);
          const data = (await res.json()) as { results?: Array<{ id: string; properties?: Record<string, any> }> };
          const items = (data.results || []).map((c) => ({
            id: c.id,
            name: `${c.properties?.firstname || ""} ${c.properties?.lastname || ""}`.trim() || c.id,
            type: "contact",
            metadata: { email: c.properties?.email },
          }));
          return { recordsSynced: items.length, resources: items };
        }
        return { recordsSynced: 0 };
      },
    });
  }

  // 4. Salesforce
  private registerSalesforceAdapter(): void {
    const capabilities: ProviderCapabilities = {
      authorizationSupport: "oauth2",
      credentialVerification: true,
      accountDiscovery: true,
      refreshSupport: true,
      revocationSupport: true,
      supportedOperations: ["sync_leads", "sync_contacts", "create_lead"],
      syncDirections: ["bidirectional"],
      requiredScopes: ["api", "refresh_token", "offline_access", "id"],
      rateLimitPerMinute: 200,
    };

    this.adapters.set("salesforce", {
      provider: "salesforce",
      capabilities,
      getAuthorizationUrl({ state, redirectUri, codeVerifier, scopes }) {
        const clientId = process.env.SALESFORCE_CLIENT_ID;
        if (!clientId) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "SALESFORCE_CLIENT_ID not configured.",
          });
        }
        const effectiveScopes = scopes && scopes.length > 0 ? scopes : capabilities.requiredScopes;
        const params = new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: effectiveScopes.join(" "),
          state,
        });
        if (codeVerifier) {
          params.set("code_challenge", base64UrlSha256(codeVerifier));
          params.set("code_challenge_method", "S256");
        }
        return {
          url: `https://login.salesforce.com/services/oauth2/authorize?${params.toString()}`,
          codeChallenge: codeVerifier ? base64UrlSha256(codeVerifier) : undefined,
        };
      },
      async exchangeCode({ code, redirectUri, codeVerifier }): Promise<ProviderTokenResult> {
        const clientId = process.env.SALESFORCE_CLIENT_ID;
        const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "Salesforce credentials not configured.",
          });
        }
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        });
        if (codeVerifier) body.set("code_verifier", codeVerifier);

        const res = await fetch("https://login.salesforce.com/services/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        const json = (await res.json()) as Record<string, any>;
        if (!res.ok) {
          throw new AppError({
            code: ErrorCode.UPSTREAM_UNAVAILABLE,
            message: `Salesforce OAuth error: ${json.error_description || json.error}`,
          });
        }

        // Fetch User Info
        let userInfo: Record<string, any> = {};
        if (json.id) {
          const userRes = await fetch(json.id, {
            headers: { Authorization: `Bearer ${json.access_token}` },
          });
          if (userRes.ok) userInfo = (await userRes.json()) as Record<string, any>;
        }

        return {
          accessToken: json.access_token,
          refreshToken: json.refresh_token,
          grantedScopes: (json.scope || "").split(" ").filter(Boolean),
          accountIdentifier: userInfo.preferred_username || userInfo.email || json.instance_url || "salesforce-org",
          accountEmail: userInfo.email || null,
          accountName: userInfo.organization_id ? `Salesforce Org (${userInfo.organization_id})` : null,
          providerAccountId: userInfo.organization_id || null,
          rawPayload: { ...json, instance_url: json.instance_url },
        };
      },
    });
  }

  // 5. Slack
  private registerSlackAdapter(): void {
    const capabilities: ProviderCapabilities = {
      authorizationSupport: "oauth2",
      credentialVerification: true,
      accountDiscovery: true,
      refreshSupport: false,
      revocationSupport: true,
      supportedOperations: ["discover_channels", "post_notification"],
      syncDirections: ["outbound"],
      requiredScopes: ["chat:write", "channels:read", "groups:read", "team:read"],
      rateLimitPerMinute: 300,
    };

    this.adapters.set("slack", {
      provider: "slack",
      capabilities,
      getAuthorizationUrl({ state, redirectUri, scopes }) {
        const clientId = process.env.SLACK_CLIENT_ID;
        if (!clientId) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "SLACK_CLIENT_ID not configured.",
          });
        }
        const effectiveScopes = scopes && scopes.length > 0 ? scopes : capabilities.requiredScopes;
        const params = new URLSearchParams({
          client_id: clientId,
          scope: effectiveScopes.join(","),
          redirect_uri: redirectUri,
          state,
        });
        return { url: `https://slack.com/oauth/v2/authorize?${params.toString()}` };
      },
      async exchangeCode({ code, redirectUri }): Promise<ProviderTokenResult> {
        const clientId = process.env.SLACK_CLIENT_ID;
        const clientSecret = process.env.SLACK_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "Slack OAuth credentials not configured.",
          });
        }
        const res = await fetch("https://slack.com/api/oauth.v2.access", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
          }).toString(),
        });
        const json = (await res.json()) as Record<string, any>;
        if (!res.ok || !json.ok) {
          throw new AppError({
            code: ErrorCode.UPSTREAM_UNAVAILABLE,
            message: `Slack OAuth exchange failed: ${json.error || "Unknown error"}`,
          });
        }

        const team = json.team as { id?: string; name?: string } | undefined;
        return {
          accessToken: json.access_token,
          grantedScopes: (json.scope || "").split(",").filter(Boolean),
          accountIdentifier: team?.name || team?.id || "slack-team",
          accountName: team?.name || null,
          providerAccountId: team?.id || null,
          rawPayload: json,
        };
      },
      async syncResource({ accessToken, operation }: ProviderSyncParams): Promise<ProviderSyncResult> {
        if (operation === "discover_resources" || operation === "manual_sync") {
          const res = await fetch("https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=100", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const json = (await res.json()) as { ok?: boolean; channels?: Array<{ id: string; name: string }> };
          if (!json.ok) throw new Error("Failed to list Slack channels");
          const items = (json.channels || []).map((ch) => ({
            id: ch.id,
            name: `#${ch.name}`,
            type: "channel",
          }));
          return { recordsSynced: items.length, resources: items };
        }
        return { recordsSynced: 0 };
      },
    });
  }

  // 6. Twilio
  private registerTwilioAdapter(): void {
    const capabilities: ProviderCapabilities = {
      authorizationSupport: "credentials",
      credentialVerification: true,
      accountDiscovery: true,
      refreshSupport: false,
      revocationSupport: false,
      supportedOperations: ["discover_phone_numbers", "make_call", "send_sms"],
      syncDirections: ["bidirectional"],
      requiredScopes: [],
      rateLimitPerMinute: 1000,
    };

    this.adapters.set("twilio", {
      provider: "twilio",
      capabilities,
      getAuthorizationUrl() {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "Twilio uses Account SID and Auth Token credentials, not OAuth authorization.",
        });
      },
      async exchangeCode() {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "Twilio does not support OAuth exchange.",
        });
      },
      async verifyCredentials(credentials: Record<string, string>): Promise<ProviderCredentialsVerification> {
        const accountSid = credentials.accountSid?.trim() || credentials.account_sid?.trim();
        const authToken = credentials.authToken?.trim() || credentials.auth_token?.trim();
        if (!accountSid || !authToken) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "Both Twilio Account SID and Auth Token are required.",
          });
        }

        // Verify account with official Twilio API
        const auth = basicAuth(accountSid, authToken);
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`, {
          headers: { Authorization: auth },
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new AppError({
            code: ErrorCode.UNAUTHORIZED,
            message: `Twilio credential verification failed (HTTP ${res.status}): ${text.slice(0, 150)}`,
          });
        }

        const data = (await res.json()) as { friendly_name?: string; status?: string; sid?: string };
        if (data.status !== "active") {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: `Twilio account status is '${data.status}', expected 'active'`,
          });
        }

        // Discover configured incoming phone numbers
        const numbersRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PageSize=50`,
          { headers: { Authorization: auth } },
        );
        let phoneNumbers: Array<{ phone_number: string; friendly_name: string }> = [];
        if (numbersRes.ok) {
          const numJson = (await numbersRes.json()) as { incoming_phone_numbers?: Array<any> };
          phoneNumbers = (numJson.incoming_phone_numbers || []).map((n) => ({
            phone_number: n.phone_number,
            friendly_name: n.friendly_name,
          }));
        }

        return {
          valid: true,
          accountIdentifier: accountSid,
          accountName: data.friendly_name || `Twilio (${accountSid.slice(-4)})`,
          providerAccountId: accountSid,
          metadata: {
            friendly_name: data.friendly_name,
            phone_numbers: phoneNumbers,
            verified_at: new Date().toISOString(),
          },
        };
      },
      async syncResource({ accessToken }: ProviderSyncParams): Promise<ProviderSyncResult> {
        // Here accessToken stores "accountSid:authToken"
        const [accountSid, authToken] = accessToken.split(":");
        if (!accountSid || !authToken) return { recordsSynced: 0 };

        const auth = basicAuth(accountSid, authToken);
        const numbersRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PageSize=50`,
          { headers: { Authorization: auth } },
        );
        if (!numbersRes.ok) throw new Error("Failed to discover Twilio phone numbers");
        const json = (await numbersRes.json()) as { incoming_phone_numbers?: Array<any> };
        const items = (json.incoming_phone_numbers || []).map((n) => ({
          id: n.sid,
          name: n.phone_number,
          type: "phone_number",
          metadata: { friendly_name: n.friendly_name, capabilities: n.capabilities },
        }));
        return { recordsSynced: items.length, resources: items };
      },
    });
  }

  // 7. Zendesk
  private registerZendeskAdapter(): void {
    const capabilities: ProviderCapabilities = {
      authorizationSupport: "oauth2",
      credentialVerification: true,
      accountDiscovery: true,
      refreshSupport: false,
      revocationSupport: true,
      supportedOperations: ["sync_tickets", "create_ticket"],
      syncDirections: ["bidirectional"],
      requiredScopes: ["read", "write"],
      rateLimitPerMinute: 200,
    };

    this.adapters.set("zendesk", {
      provider: "zendesk",
      capabilities,
      getAuthorizationUrl({ state, redirectUri, subdomain }) {
        const clientId = process.env.ZENDESK_CLIENT_ID;
        const sub = subdomain || process.env.ZENDESK_SUBDOMAIN;
        if (!clientId || !sub) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "Zendesk Client ID and Subdomain must be provided.",
          });
        }
        const params = new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: "read write",
          state,
        });
        return { url: `https://${sub}.zendesk.com/oauth/authorizations/new?${params.toString()}` };
      },
      async exchangeCode({ code, redirectUri, subdomain }): Promise<ProviderTokenResult> {
        const clientId = process.env.ZENDESK_CLIENT_ID;
        const clientSecret = process.env.ZENDESK_CLIENT_SECRET;
        const sub = subdomain || process.env.ZENDESK_SUBDOMAIN;
        if (!clientId || !clientSecret || !sub) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "Zendesk OAuth credentials not configured.",
          });
        }
        const res = await fetch(`https://${sub}.zendesk.com/oauth/tokens`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            scope: "read write",
          }),
        });
        const json = (await res.json()) as Record<string, any>;
        if (!res.ok) {
          throw new AppError({
            code: ErrorCode.UPSTREAM_UNAVAILABLE,
            message: `Zendesk token exchange failed: ${json.error_description || json.error}`,
          });
        }

        // Discover current agent
        const meRes = await fetch(`https://${sub}.zendesk.com/api/v2/users/me.json`, {
          headers: { Authorization: `Bearer ${json.access_token}` },
        });
        const me = meRes.ok ? ((await meRes.json()) as { user?: { name?: string; email?: string; id?: number } }) : {};

        return {
          accessToken: json.access_token,
          tokenType: json.token_type,
          grantedScopes: (json.scope || "").split(" ").filter(Boolean),
          accountIdentifier: me.user?.email || `${sub}.zendesk.com`,
          accountEmail: me.user?.email || null,
          accountName: me.user?.name || `${sub}.zendesk.com`,
          providerAccountId: me.user?.id ? String(me.user.id) : null,
          rawPayload: { ...json, subdomain: sub },
        };
      },
    });
  }

  // 8. Notion
  private registerNotionAdapter(): void {
    const capabilities: ProviderCapabilities = {
      authorizationSupport: "oauth2",
      credentialVerification: true,
      accountDiscovery: true,
      refreshSupport: false,
      revocationSupport: false,
      supportedOperations: ["discover_databases", "sync_pages"],
      syncDirections: ["inbound"],
      requiredScopes: [],
      rateLimitPerMinute: 180,
    };

    this.adapters.set("notion", {
      provider: "notion",
      capabilities,
      getAuthorizationUrl({ state, redirectUri }) {
        const clientId = process.env.NOTION_CLIENT_ID;
        if (!clientId) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "NOTION_CLIENT_ID not configured.",
          });
        }
        const params = new URLSearchParams({
          client_id: clientId,
          response_type: "code",
          owner: "user",
          redirect_uri: redirectUri,
          state,
        });
        return { url: `https://api.notion.com/v1/oauth/authorize?${params.toString()}` };
      },
      async exchangeCode({ code, redirectUri }): Promise<ProviderTokenResult> {
        const clientId = process.env.NOTION_CLIENT_ID;
        const clientSecret = process.env.NOTION_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "Notion credentials (NOTION_CLIENT_ID, NOTION_CLIENT_SECRET) not configured.",
          });
        }
        const auth = basicAuth(clientId, clientSecret);
        const res = await fetch("https://api.notion.com/v1/oauth/token", {
          method: "POST",
          headers: {
            Authorization: auth,
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
          },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
          }),
        });
        const json = (await res.json()) as Record<string, any>;
        if (!res.ok) {
          throw new AppError({
            code: ErrorCode.UPSTREAM_UNAVAILABLE,
            message: `Notion token exchange failed: ${json.message || json.error}`,
          });
        }

        return {
          accessToken: json.access_token,
          grantedScopes: [],
          accountIdentifier: json.workspace_name || json.workspace_id || "notion-workspace",
          accountName: json.workspace_name || null,
          providerAccountId: json.workspace_id || null,
          rawPayload: json,
        };
      },
      async syncResource({ accessToken, operation }: ProviderSyncParams): Promise<ProviderSyncResult> {
        if (operation === "discover_resources" || operation === "manual_sync") {
          const res = await fetch("https://api.notion.com/v1/search", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "Notion-Version": "2022-06-28",
            },
            body: JSON.stringify({
              filter: { value: "database", property: "object" },
              page_size: 20,
            }),
          });
          if (!res.ok) throw new Error("Failed to list Notion databases");
          const json = (await res.json()) as { results?: Array<{ id: string; title?: Array<{ plain_text?: string }> }> };
          const items = (json.results || []).map((db) => ({
            id: db.id,
            name: db.title?.[0]?.plain_text || db.id,
            type: "database",
          }));
          return { recordsSynced: items.length, resources: items };
        }
        return { recordsSynced: 0 };
      },
    });
  }

  // 9. Mailchimp
  private registerMailchimpAdapter(): void {
    const capabilities: ProviderCapabilities = {
      authorizationSupport: "oauth2",
      credentialVerification: true,
      accountDiscovery: true,
      refreshSupport: false,
      revocationSupport: false,
      supportedOperations: ["discover_audiences", "sync_subscribers"],
      syncDirections: ["outbound"],
      requiredScopes: [],
      rateLimitPerMinute: 600,
    };

    this.adapters.set("mailchimp", {
      provider: "mailchimp",
      capabilities,
      getAuthorizationUrl({ state, redirectUri }) {
        const clientId = process.env.MAILCHIMP_CLIENT_ID;
        if (!clientId) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "MAILCHIMP_CLIENT_ID not configured.",
          });
        }
        const params = new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          state,
        });
        return { url: `https://login.mailchimp.com/oauth2/authorize?${params.toString()}` };
      },
      async exchangeCode({ code, redirectUri }): Promise<ProviderTokenResult> {
        const clientId = process.env.MAILCHIMP_CLIENT_ID;
        const clientSecret = process.env.MAILCHIMP_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "Mailchimp credentials not configured.",
          });
        }
        const res = await fetch("https://login.mailchimp.com/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
          }).toString(),
        });
        const json = (await res.json()) as Record<string, any>;
        if (!res.ok) {
          throw new AppError({
            code: ErrorCode.UPSTREAM_UNAVAILABLE,
            message: `Mailchimp token exchange failed: ${json.error}`,
          });
        }

        // Discover data center metadata
        const metaRes = await fetch("https://login.mailchimp.com/oauth2/metadata", {
          headers: { Authorization: `OAuth ${json.access_token}` },
        });
        const meta = metaRes.ok ? ((await metaRes.json()) as Record<string, any>) : {};

        return {
          accessToken: json.access_token,
          grantedScopes: [],
          accountIdentifier: meta.accountname || meta.login?.email || "mailchimp-account",
          accountEmail: meta.login?.email || null,
          accountName: meta.accountname || null,
          providerAccountId: meta.user_id ? String(meta.user_id) : null,
          rawPayload: { ...json, dc: meta.dc, api_endpoint: meta.api_endpoint },
        };
      },
      async syncResource({ accessToken, operation, options }: ProviderSyncParams): Promise<ProviderSyncResult> {
        const dc = (options?.dc as string) || "us1";
        if (operation === "discover_audiences" || operation === "manual_sync") {
          const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists?count=50`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) throw new Error("Failed to list Mailchimp audiences");
          const json = (await res.json()) as { lists?: Array<{ id: string; name: string; stats?: { member_count?: number } }> };
          const items = (json.lists || []).map((l) => ({
            id: l.id,
            name: l.name,
            type: "audience",
            metadata: { member_count: l.stats?.member_count },
          }));
          return { recordsSynced: items.length, resources: items };
        }
        return { recordsSynced: 0 };
      },
    });
  }

  // 10. Apify
  private registerApifyAdapter(): void {
    const capabilities: ProviderCapabilities = {
      authorizationSupport: "credentials",
      credentialVerification: true,
      accountDiscovery: true,
      refreshSupport: false,
      revocationSupport: false,
      supportedOperations: ["run_actor", "fetch_dataset", "list_actors"],
      syncDirections: ["inbound"],
      requiredScopes: [],
      rateLimitPerMinute: 600,
    };

    this.adapters.set("apify", {
      provider: "apify",
      capabilities,
      getAuthorizationUrl() {
        return {
          url: "https://console.apify.com/account/integrations",
          state: "",
        };
      },
      async exchangeCode() {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "Apify uses API token authentication. Please provide your Apify API Token.",
        });
      },
      async verifyCredentials(credentials: Record<string, string>): Promise<ProviderCredentialsVerification> {
        const token = (credentials.apiToken || credentials.token || credentials.apiKey || credentials.api_token || "").trim();
        if (!token) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "Apify API Token is required.",
          });
        }

        const res = await fetch("https://api.apify.com/v2/users/me", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new AppError({
            code: ErrorCode.UNAUTHORIZED,
            message: `Apify authentication failed (HTTP ${res.status}): ${text.slice(0, 150) || "Invalid API token"}`,
          });
        }

        const json = (await res.json()) as { data?: { id?: string; username?: string; email?: string; profile?: { name?: string }; plan?: { id?: string } } };
        const data = json.data || {};
        const userId = data.id || "apify_user";
        const username = data.username || data.profile?.name || "Apify Account";

        return {
          valid: true,
          accountIdentifier: userId,
          accountEmail: data.email || null,
          accountName: username,
          providerAccountId: userId,
          metadata: {
            username,
            email: data.email,
            plan: data.plan?.id,
            verified_at: new Date().toISOString(),
          },
        };
      },
    });
  }
}
