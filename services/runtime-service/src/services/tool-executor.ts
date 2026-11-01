import type { AgentToolDefinition } from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";
import { fetchWithPolicy } from "@quickstart/utilities";
import type { SecretsClient } from "../clients/secrets.client.js";
import type { WebFetchClient } from "../clients/web-fetch.client.js";
import type { LeadClient, LeadCaptureInput } from "../clients/lead.client.js";
import type { CalendarClient, CalendarActionInput } from "../clients/calendar.client.js";
import type { IntegrationClient } from "../clients/integration.client.js";
import type { McpToolRunner } from "./mcp-tool-runner.js";

export type ToolExecutionResult = {
  ok: boolean;
  content: string;
  errorCode?: string;
  status: "succeeded" | "failed" | "unknown";
};

type ToolExecutionContext = {
  workspaceId: string;
  requestId: string;
  toolCallKey: string;
  timeoutMs: number;
  authorization?: string;
  conversationId?: string;
  channel?: "chat" | "voice" | "webhook";
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hostAllowed(url: URL, allowedHosts: string[]): boolean {
  const host = url.hostname.toLowerCase();
  return allowedHosts.some((h) => h.toLowerCase() === host);
}

export class ToolExecutor {
  constructor(
    private readonly webFetch?: WebFetchClient,
    private readonly mcpRunner?: McpToolRunner,
    private readonly secrets?: SecretsClient,
    private readonly leads?: LeadClient,
    private readonly calendar?: CalendarClient,
    private readonly integrations?: IntegrationClient,
  ) {}

  async execute(
    tool: AgentToolDefinition,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      const policy = tool.policy;
      if (policy?.enabled === false) {
        return {
          ok: false,
          content: "This tool is disabled for the published agent.",
          errorCode: "TOOL_DISABLED",
          status: "failed",
        };
      }
      if (policy?.allowed_channels?.length && ctx.channel && !policy.allowed_channels.includes(ctx.channel)) {
        return {
          ok: false,
          content: "This tool is not enabled for the current channel.",
          errorCode: "TOOL_CHANNEL_NOT_ALLOWED",
          status: "failed",
        };
      }
      if (tool.type === "builtin_leads") {
        return await this.executeLeads(tool, args, ctx);
      }
      if (tool.type === "builtin_calendar") {
        return await this.executeCalendar(tool, args, ctx);
      }
      if (tool.type === "builtin_integration") {
        return await this.executeIntegration(tool, args, ctx);
      }
      if (tool.type === "http") {
        return await this.executeHttp(tool, args, ctx);
      }
      if (tool.type === "builtin_web") {
        return await this.executeBuiltinWeb(tool, args, ctx);
      }
      if (tool.type === "mcp") {
        if (!this.mcpRunner) {
          return {
            ok: false,
            content: "MCP runner not configured",
            errorCode: "MCP_UNAVAILABLE",
            status: "failed",
          };
        }
        return await this.mcpRunner.run(tool, args, ctx);
      }
      return {
        ok: false,
        content: "Unknown tool type",
        errorCode: "VALIDATION_FAILED",
        status: "failed",
      };
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCode.RATE_LIMITED) {
        return {
          ok: false,
          content: error.message,
          errorCode: ErrorCode.RATE_LIMITED,
          status: "failed",
        };
      }
      if (error instanceof AppError) {
        return {
          ok: false,
          content: error.message,
          errorCode: error.code,
          status: error.code === ErrorCode.UPSTREAM_TIMEOUT ? "unknown" : "failed",
        };
      }
      const message = error instanceof Error ? error.message : "tool execution failed";
      return { ok: false, content: message, errorCode: "TOOL_FAILED", status: "unknown" };
    }
  }

  private async executeLeads(
    tool: AgentToolDefinition & { type: "builtin_leads" },
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (tool.action === "capture" || tool.action === "request_callback") {
      return this.executeLeadCapture(tool, args, ctx);
    }
    if (!ctx.authorization)
      throw new AppError({
        code: ErrorCode.UNAUTHORIZED,
        message: "Lead tools require the caller's access token",
      });
    const base = (process.env.LEAD_GENERATION_URL ?? "http://127.0.0.1:3019").replace(/\/$/, "");
    const root = `${base}/v1/workspaces/${encodeURIComponent(ctx.workspaceId)}/lead-generation/runs`;
    const id = String(args.run_id ?? "");
    if (tool.action !== "start" && !/^[0-9a-f-]{36}$/i.test(id))
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "run_id required" });
    const url =
      tool.action === "start"
        ? root
        : `${root}/${encodeURIComponent(id)}${tool.action === "results" ? "/results" : tool.action === "cancel" ? "/cancel" : ""}`;
    const res = await fetchWithPolicy(
      url,
      {
        method: ["start", "cancel"].includes(tool.action) ? "POST" : "GET",
        headers: {
          authorization: ctx.authorization,
          "content-type": "application/json",
          "x-request-id": ctx.requestId,
          "idempotency-key": ctx.toolCallKey,
        },
        body: tool.action === "start" ? JSON.stringify(args) : undefined,
      },
      { timeoutMs: ctx.timeoutMs, maxRetries: 0 },
    );
    const content = (await res.text()).slice(0, 16000);
    return {
      ok: res.ok,
      content,
      status: res.ok ? "succeeded" : "failed",
      ...(res.ok ? {} : { errorCode: `LEAD_HTTP_${res.status}` }),
    };
  }

  /**
   * Save the conversation as a qualified lead, or record a callback request.
   * Both paths go through lead-service's internal upsert so the result is
   * visible in the Leads UI and is idempotent per tool call.
   */
  private async executeLeadCapture(
    tool: AgentToolDefinition & { type: "builtin_leads" },
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.leads) {
      return {
        ok: false,
        content: "Lead capture is not configured on this runtime",
        errorCode: "LEADS_UNAVAILABLE",
        status: "failed",
      };
    }

    const isCallback = tool.action === "request_callback";
    const callbackAt = asString(args.callback_at);
    const reason = asString(args.reason);
    const captured = asRecord(args.captured_fields);
    const phone = asString(args.phone);
    const email = asString(args.email);
    const name = asString(args.name);

    if (isCallback && (!phone || !callbackAt)) {
      return {
        ok: false,
        content: "A callback needs both a phone number and a preferred time",
        errorCode: "VALIDATION_FAILED",
        status: "failed",
      };
    }

    // Never save a "lead" that only contains an intent. Ask for the missing
    // contact details instead of writing an unusable row.
    if (!isCallback && (!name || (!email && !phone))) {
      return {
        ok: false,
        content:
          "Before saving a qualified lead, collect the visitor's name and either an email or a phone number",
        errorCode: "VALIDATION_FAILED",
        status: "failed",
      };
    }

    const notes = isCallback
      ? [`Callback requested${callbackAt ? ` for ${callbackAt}` : ""}`, reason]
          .filter(Boolean)
          .join(". ")
      : asString(args.notes);

    const input: LeadCaptureInput = {
      name,
      email,
      phone,
      intent: asString(args.intent) ?? (isCallback ? "Follow-up call request" : null),
      qualificationScore: asNumber(args.qualification_score),
      notes,
      status: "qualified",
      source: isCallback ? "agent_callback" : "agent",
      conversationId: ctx.conversationId ?? null,
      capturedFields: {
        ...captured,
        ...(callbackAt ? { callback_at: callbackAt } : {}),
        ...(reason ? { callback_reason: reason } : {}),
      },
      idempotencyKey: ctx.toolCallKey,
    };

    const result = await this.leads.capture(ctx.workspaceId, input);
    if (!result.ok) {
      return {
        ok: false,
        content: result.error,
        errorCode: "LEAD_CAPTURE_FAILED",
        status: "failed",
      };
    }

    return {
      ok: true,
      status: "succeeded",
      content: JSON.stringify({
        status: isCallback ? "callback_requested" : "lead_saved",
        lead_id: result.lead.id ?? null,
        created: result.created,
        instruction: isCallback
          ? "Tell the visitor the team will call them at the requested time. Do not promise a specific person."
          : "Tell the visitor their details were passed to the team. Do not invent follow-up timing.",
      }),
    };
  }

  private async executeCalendar(
    tool: AgentToolDefinition & { type: "builtin_calendar" },
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.calendar) {
      return {
        ok: false,
        content: "Appointment booking is not configured on this runtime",
        errorCode: "CALENDAR_UNAVAILABLE",
        status: "failed",
      };
    }

    const input: CalendarActionInput = {
      action: tool.action,
      calendar_id: asString(args.calendar_id) ?? tool.calendar_id,
      timezone: asString(args.timezone) ?? tool.timezone,
      date: asString(args.date) ?? undefined,
      start: asString(args.start) ?? undefined,
      end: asString(args.end) ?? undefined,
      slot_minutes: asNumber(args.slot_minutes) ?? tool.slot_minutes,
      working_hours: {
        start: asString(args.working_hours_start) ?? tool.working_hours?.start,
        end: asString(args.working_hours_end) ?? tool.working_hours?.end,
      },
      max_slots: asNumber(args.max_slots) ?? undefined,
      summary: asString(args.summary) ?? undefined,
      description: asString(args.description) ?? undefined,
      attendee_email: asString(args.attendee_email) ?? undefined,
      event_id: asString(args.event_id) ?? undefined,
    };

    const result = await this.calendar.execute(ctx.workspaceId, input);
    if (!result.ok) {
      if (result.notConnected) {
        return {
          ok: true,
          status: "succeeded",
          content: JSON.stringify({
            status: "calendar_not_connected",
            message: result.error,
            instruction:
              "Google Calendar is not connected for this workspace. Apologize briefly, do not invent availability or a confirmation, and offer to save the visitor's details for a callback or hand off to the team.",
          }),
        };
      }
      return {
        ok: false,
        content: result.error,
        errorCode: "CALENDAR_FAILED",
        status: "failed",
      };
    }

    return {
      ok: true,
      status: "succeeded",
      content: JSON.stringify({
        status: "ok",
        action: tool.action,
        ...result.data,
      }),
    };
  }

  private async executeIntegration(
    tool: AgentToolDefinition & { type: "builtin_integration" },
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.integrations) {
      return {
        ok: false,
        content: "Workspace integrations are not configured on this runtime",
        errorCode: "INTEGRATIONS_UNAVAILABLE",
        status: "failed",
      };
    }
    const result = await this.integrations.execute(
      ctx.workspaceId,
      tool.provider,
      tool.action,
      args,
    );
    if (!result.ok) {
      if (result.notConnected) {
        return {
          ok: true,
          status: "succeeded",
          content: JSON.stringify({
            status: "integration_not_connected",
            provider: tool.provider,
            message: result.error,
            instruction: `The ${tool.provider} integration is not connected for this workspace. Apologize briefly, do not pretend the action succeeded, and either help with what you can or offer a handoff.`,
          }),
        };
      }
      return {
        ok: false,
        content: result.error,
        errorCode: "INTEGRATION_ACTION_FAILED",
        status: "failed",
      };
    }
    return {
      ok: true,
      status: "succeeded",
      content: JSON.stringify({
        status: "ok",
        provider: tool.provider,
        action: tool.action,
        ...result.data,
      }),
    };
  }

  private async executeHttp(
    tool: AgentToolDefinition & { type: "http" },
    args: Record<string, unknown>,
    ctx: { workspaceId: string; requestId: string; timeoutMs: number; toolCallKey: string },
  ): Promise<ToolExecutionResult> {
    const pathKeys = new Set<string>();
    if (tool.path_template) {
      for (const match of tool.path_template.matchAll(/\{(\w+)\}/g)) {
        pathKeys.add(match[1]);
      }
    }

    const path =
      typeof args.path === "string"
        ? args.path
        : tool.path_template
          ? tool.path_template.replace(/\{(\w+)\}/g, (_, key: string) => String(args[key] ?? ""))
          : "";
    const base = tool.base_url.replace(/\/$/, "");
    const url = new URL(path.startsWith("/") ? `${base}${path}` : `${base}/${path}`);
    if (!hostAllowed(url, tool.allowed_hosts)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "HTTP tool host is not on the allow-list",
      });
    }
    const method = tool.method ?? "GET";

    let body: string | undefined;
    if (method !== "GET" && method !== "DELETE") {
      if (args.body !== undefined) {
        body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
      } else {
        const bodyArgs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(args)) {
          if (k !== "path" && !pathKeys.has(k) && v !== undefined) {
            bodyArgs[k] = v;
          }
        }
        if (Object.keys(bodyArgs).length > 0) {
          body = JSON.stringify(bodyArgs);
        }
      }
    } else if (method === "GET") {
      for (const [k, v] of Object.entries(args)) {
        if (k !== "path" && !pathKeys.has(k) && v !== undefined && v !== null) {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers: Record<string, string> = {
      ...(tool.headers ?? {}),
      "Idempotency-Key": ctx.toolCallKey,
      ...(body ? { "content-type": "application/json" } : {}),
    };
    if (tool.auth?.type === "bearer_secret" && tool.auth.secret_name) {
      if (!this.secrets) {
        return {
          ok: false,
          content: "Secret-backed tool auth is not configured on the runtime",
          errorCode: "SECRETS_UNAVAILABLE",
          status: "failed",
        };
      }
      const value = await this.secrets.reveal(
        ctx.workspaceId,
        tool.auth.secret_name,
        ctx.requestId,
      );
      headers.authorization = `Bearer ${value}`;
    }

    const res = await fetchWithPolicy(
      url.toString(),
      {
        method,
        headers,
        body,
      },
      { timeoutMs: ctx.timeoutMs, maxRetries: 0 },
    ).catch(() => {
      throw new AppError({
        code: ErrorCode.UPSTREAM_TIMEOUT,
        message: "HTTP tool timed out",
      });
    });
    const text = await res.text();
    const snippet = text.slice(0, 8000);
    if (!res.ok) {
      return {
        ok: false,
        content: `HTTP ${res.status}: ${snippet}`,
        errorCode: "HTTP_TOOL_ERROR",
        status: "failed",
      };
    }
    return { ok: true, content: snippet, status: "succeeded" };
  }

  private async executeBuiltinWeb(
    tool: AgentToolDefinition & { type: "builtin_web" },
    args: Record<string, unknown>,
    ctx: { workspaceId: string; requestId: string; toolCallKey: string },
  ): Promise<ToolExecutionResult> {
    if (!this.webFetch) {
      return {
        ok: false,
        content: "Web fetch client not configured",
        errorCode: "WEB_FETCH_UNAVAILABLE",
        status: "failed",
      };
    }
    if (tool.action === "scrape") {
      const url = String(args.url ?? "");
      if (!url) {
        throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "url argument required" });
      }
      const result = await this.webFetch.scrape(
        ctx.workspaceId,
        ctx.requestId,
        url,
        ctx.toolCallKey,
      );
      return { ok: true, content: result.text.slice(0, 8000), status: "succeeded" };
    }
    const query = String(args.query ?? "");
    if (!query) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "query argument required" });
    }
    const result = await this.webFetch.search(
      ctx.workspaceId,
      ctx.requestId,
      query,
      ctx.toolCallKey,
    );
    const joined = result.results
      .map((result) =>
        [
          result.title ? `Title: ${result.title}` : "",
          result.url ? `URL: ${result.url}` : "",
          result.snippet ? `Snippet: ${result.snippet}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .filter(Boolean)
      .join("\n\n");
    return { ok: true, content: joined.slice(0, 8000), status: "succeeded" };
  }
}
