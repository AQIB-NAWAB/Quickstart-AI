import {
  requestIdFromResponse,
  sendPlatformJson,
  type RequestHandler,
} from "@quickstart/http-server";
import { AppError, ErrorCode } from "@quickstart/errors";
import type { IntegrationProvider } from "@quickstart/contracts";
import type {
  CreateInstantlyCampaignInput,
  ConnectGoogleMailboxInput,
  CreateMailchimpCampaignInput,
  PersonalizeEmailInput,
  IntegrationsService,
  CalendarActionInput,
} from "../services/integrations.service.js";
import { routeParam } from "../utils/route-param.js";

function getWorkspaceId(req: { params: Record<string, string | string[] | undefined> }): string {
  const wid = routeParam(req.params.workspaceId);
  if (!wid) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "workspaceId parameter is required",
    });
  }
  return wid;
}

function getProvider(req: {
  params: Record<string, string | string[] | undefined>;
}): IntegrationProvider {
  const p = routeParam(req.params.provider) as IntegrationProvider;
  if (!p) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "provider parameter is required",
    });
  }
  return p;
}

function getCampaignId(req: { params: Record<string, string | string[] | undefined> }): string {
  const campaignId = routeParam(req.params.campaignId);
  if (!campaignId) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "campaignId parameter is required",
    });
  }
  return campaignId;
}

export function createIntegrationsController(service: IntegrationsService) {
  return {
    list: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const result = await service.listIntegrations(workspaceId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    get: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const provider = getProvider(req);
      const result = await service.getIntegration(workspaceId, provider);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        integration: result,
      });
    }) as RequestHandler,

    authorize: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const provider = getProvider(req);
      const userId = res.locals.tenantContext?.actorId ?? res.locals.actorUserId;
      if (!userId) {
        throw new AppError({
          code: ErrorCode.UNAUTHORIZED,
          message: "Authenticated user is required for OAuth authorization.",
        });
      }
      const body = (req.body ?? {}) as { redirect_uri?: string };
      const configuredRedirect =
        provider === "mailchimp" ? process.env.MAILCHIMP_REDIRECT_URI?.trim() : undefined;
      const redirectUri =
        configuredRedirect ||
        body.redirect_uri ||
        `http://localhost:3000/api/workspaces/${workspaceId}/integrations/${provider}/callback`;

      const result = await service.initiateOAuth(workspaceId, userId, provider, redirectUri);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    callback: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const provider = getProvider(req);
      const userId = res.locals.tenantContext?.actorId ?? res.locals.actorUserId;
      if (!userId) {
        throw new AppError({
          code: ErrorCode.UNAUTHORIZED,
          message: "Authenticated user is required for OAuth callback.",
        });
      }
      const body = (req.body ?? {}) as { code?: string; state?: string };
      if (!body.state) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "state parameter is required in callback",
        });
      }

      const result = await service.handleOAuthCallback(
        workspaceId,
        userId,
        provider,
        body.code ?? "auth_code",
        body.state,
      );
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        integration: result,
      });
    }) as RequestHandler,

    credentials: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const provider = getProvider(req);
      const body = (req.body ?? {}) as { credentials?: Record<string, string> } & Record<string, string>;
      const creds = body.credentials ?? body;
      const result = await service.saveCredentials(workspaceId, provider, creds);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        integration: result,
      });
    }) as RequestHandler,

    disconnect: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const provider = getProvider(req);
      const result = await service.disconnect(workspaceId, provider);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        integration: result,
      });
    }) as RequestHandler,

    sync: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const provider = getProvider(req);
      const body = (req.body ?? {}) as {
        operation?: "manual_sync" | "test_connection" | "discover_resources";
        resourceType?: string;
        options?: Record<string, unknown>;
      };
      const result = await service.syncIntegration(workspaceId, provider, {
        operation: body.operation || "manual_sync",
        resourceType: body.resourceType,
        options: body.options,
      });
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    syncHistory: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const provider = getProvider(req);
      const history = await service.listSyncHistory(workspaceId, provider);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        history,
      });
    }) as RequestHandler,

    mailchimpAudiences: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const audiences = await service.listMailchimpAudiences(workspaceId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        audiences,
      });
    }) as RequestHandler,

    mailchimpCampaigns: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const campaigns = await service.listMailchimpCampaigns(workspaceId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        campaigns,
      });
    }) as RequestHandler,

    mailchimpCampaign: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const campaignId = getCampaignId(req);
      const campaign = await service.getMailchimpCampaign(workspaceId, campaignId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        campaign,
      });
    }) as RequestHandler,

    instantlyAccounts: (async (_req, res) => {
      const accounts = await service.listInstantlyAccounts();
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        accounts,
      });
    }) as RequestHandler,

    connectInstantlyGoogleAccount: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const body = (req.body ?? {}) as ConnectGoogleMailboxInput;
      const result = await service.connectInstantlyGoogleAccount(workspaceId, body);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    instantlyCampaigns: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const campaigns = await service.listInstantlyCampaigns(workspaceId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        campaigns,
      });
    }) as RequestHandler,

    instantlyCampaign: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const campaignId = getCampaignId(req);
      const campaign = await service.getInstantlyCampaign(workspaceId, campaignId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        campaign,
      });
    }) as RequestHandler,

    createInstantlyCampaign: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const body = (req.body ?? {}) as CreateInstantlyCampaignInput;
      const createdBy = res.locals.tenantContext?.actorId ?? res.locals.actorUserId ?? undefined;
      const campaign = await service.createInstantlyCampaign(workspaceId, body, createdBy);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        campaign,
      });
    }) as RequestHandler,

    activateInstantlyCampaign: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const campaignId = getCampaignId(req);
      const activatedBy = res.locals.tenantContext?.actorId ?? res.locals.actorUserId ?? undefined;
      const result = await service.activateInstantlyCampaign(workspaceId, campaignId, activatedBy);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    pauseInstantlyCampaign: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const campaignId = getCampaignId(req);
      const result = await service.pauseInstantlyCampaign(workspaceId, campaignId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    resumeInstantlyCampaign: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const campaignId = getCampaignId(req);
      const result = await service.resumeInstantlyCampaign(workspaceId, campaignId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    deleteInstantlyCampaign: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const campaignId = getCampaignId(req);
      const result = await service.deleteInstantlyCampaign(workspaceId, campaignId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    personalizeEmail: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const body = (req.body ?? {}) as PersonalizeEmailInput;
      const result = await service.personalizeMailchimpEmail(workspaceId, body);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    personalizeMailchimpEmail: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const body = (req.body ?? {}) as PersonalizeEmailInput;
      const result = await service.personalizeMailchimpEmail(workspaceId, body);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    createMailchimpCampaign: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const body = (req.body ?? {}) as CreateMailchimpCampaignInput;
      const createdBy = res.locals.tenantContext?.actorId ?? res.locals.actorUserId ?? undefined;
      const result = await service.createMailchimpCampaign(workspaceId, body, createdBy);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    sendMailchimpCampaign: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const campaignId = getCampaignId(req);
      const body = (req.body ?? {}) as { confirm?: boolean };
      const sentBy = res.locals.tenantContext?.actorId ?? res.locals.actorUserId ?? undefined;
      const result = await service.sendMailchimpCampaign(
        workspaceId,
        campaignId,
        Boolean(body.confirm),
        sentBy,
      );
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    /**
     * Internal OAuth callback completion. The one-time state identifies the
     * workspace/user/provider, so the web server can finish a provider redirect
     * even when the browser session cookie is missing.
     */
    internalOAuthCallback: (async (req, res) => {
      const body = (req.body ?? {}) as { code?: string; state?: string };
      if (!body.code || !body.state) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "code and state are required",
        });
      }
      const result = await service.handleOAuthCallbackFromState(body.code, body.state);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    /**
     * Internal integration action for built-in agent tools. Verified with the
     * workspace internal token; provider credentials never leave this service.
     */
    integrationAction: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const provider = getProvider(req);
      const body = (req.body ?? {}) as {
        action?: string;
        input?: Record<string, unknown>;
      };
      const action = body.action?.trim();
      if (!action) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "action is required",
        });
      }
      const result = await service.executeIntegrationAction(
        workspaceId,
        provider,
        action,
        body.input ?? {},
      );
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        result,
      });
    }) as RequestHandler,

    /**
     * Internal calendar action for the built-in agent booking tool.
     * Verified with the workspace internal token, not a staff JWT.
     */
    calendarAction: (async (req, res) => {
      const workspaceId = getWorkspaceId(req);
      const body = (req.body ?? {}) as CalendarActionInput;
      const result = await service.executeCalendarAction(workspaceId, body);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        result,
      });
    }) as RequestHandler,
  };
}
