import type {
  AgentToolDefinition,
  CustomToolConfig,
  CustomToolKind,
  CustomToolInput,
} from "@quickstart/contracts";
import {
  BUILTIN_INTEGRATION_ACTIONS,
  MAX_TOOL_TIMEOUT_MS,
  MAX_TOOLS_PER_AGENT,
  DEFAULT_TOOL_TIMEOUT_MS,
} from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "127.0.0.1" || h.startsWith("127.")) return true;
  if (h.startsWith("10.") || h.startsWith("192.168.") || h === "0.0.0.0") return true;
  if (h.startsWith("169.254.")) return true;
  const parts = h.split(".");
  if (parts[0] === "172") {
    const second = Number(parts[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const SECRET_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const FORBIDDEN_HEADERS = new Set(["authorization", "x-api-key", "api-key"]);

function validateHttpAuth(tool: AgentToolDefinition & { type: "http" }): void {
  if (!tool.headers) return;
  if (typeof tool.headers !== "object" || Array.isArray(tool.headers)) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "http tool headers must be an object",
    });
  }
  for (const [key, value] of Object.entries(tool.headers)) {
    if (!HEADER_NAME_PATTERN.test(key)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `invalid static header name: ${key}`,
      });
    }
    if (FORBIDDEN_HEADERS.has(key.toLowerCase())) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `header '${key}' is not allowed on tools; use a workspace secret via auth instead`,
      });
    }
    if (typeof value !== "string" || value.length > 4096) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `header '${key}' value must be a string under 4096 characters`,
      });
    }
  }
  if (tool.auth) {
    if (tool.auth.type !== "bearer_secret" || !tool.auth.secret_name?.trim()) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "http tool auth requires type 'bearer_secret' and secret_name",
      });
    }
    if (!SECRET_NAME_PATTERN.test(tool.auth.secret_name)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "auth secret_name must match [A-Za-z0-9_.-]{1,64}",
      });
    }
  }
}

function validateHttpTool(tool: AgentToolDefinition & { type: "http" }): void {
  if (!tool.base_url?.trim()) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "http tool requires base_url",
    });
  }
  let url: URL;
  try {
    url = new URL(tool.base_url);
  } catch {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "http tool base_url must be a valid URL",
    });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "http tool base_url must be http or https",
    });
  }
  const host = url.hostname;
  if (isPrivateHost(host)) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "http tool host is not allow-listed for production",
    });
  }
  if (!tool.allowed_hosts?.length) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "http tool requires allowed_hosts",
    });
  }
  const allowed = tool.allowed_hosts.map((h) => h.toLowerCase());
  if (!allowed.includes(host.toLowerCase())) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "base_url host must appear in allowed_hosts",
    });
  }
  for (const ah of tool.allowed_hosts) {
    if (isPrivateHost(ah)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "allowed_hosts may not include private hosts",
      });
    }
  }
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(tool.method)) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "http tool method must be GET, POST, PUT, PATCH, or DELETE",
    });
  }
  validateHttpAuth(tool);
}

function validateMcpTool(tool: AgentToolDefinition & { type: "mcp" }): void {
  if (!tool.server_url?.trim()) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "mcp tool requires server_url",
    });
  }
  let url: URL;
  try {
    url = new URL(tool.server_url);
  } catch {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "mcp server_url must be a valid URL",
    });
  }
  if (isPrivateHost(url.hostname)) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "mcp server_url host is not allow-listed",
    });
  }
  if (!tool.allowed_tool_names?.length) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "mcp tool requires allowed_tool_names",
    });
  }
}

export function validateAgentTools(tools: AgentToolDefinition[]): AgentToolDefinition[] {
  if (!Array.isArray(tools)) {
    throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "tools must be an array" });
  }
  if (tools.length > MAX_TOOLS_PER_AGENT) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: `At most ${MAX_TOOLS_PER_AGENT} tools per agent`,
    });
  }
  const names = new Set<string>();
  const normalized: AgentToolDefinition[] = [];
  for (const raw of tools) {
    if (!raw?.id?.trim() || !raw?.name?.trim() || !raw?.description?.trim()) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Each tool requires id, name, and description",
      });
    }
    const name = raw.name.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "tool name must be alphanumeric with underscores",
      });
    }
    if (names.has(name)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `duplicate tool name: ${name}`,
      });
    }
    names.add(name);
    const timeout = raw.timeout_ms ?? DEFAULT_TOOL_TIMEOUT_MS;
    if (timeout < 1000 || timeout > MAX_TOOL_TIMEOUT_MS) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `tool timeout_ms must be between 1000 and ${MAX_TOOL_TIMEOUT_MS}`,
      });
    }
    if (raw.policy) {
      const policy = raw.policy;
      if (
        policy.max_calls_per_turn !== undefined &&
        (!Number.isInteger(policy.max_calls_per_turn) || policy.max_calls_per_turn < 1 || policy.max_calls_per_turn > 20)
      ) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "tool policy max_calls_per_turn must be an integer between 1 and 20",
        });
      }
      if (policy.allowed_channels?.some((channel) => !["chat", "voice", "webhook"].includes(channel))) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "tool policy contains an unsupported channel",
        });
      }
      if (policy.confirmation && !["never", "user", "staff"].includes(policy.confirmation)) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "tool policy confirmation must be never, user, or staff",
        });
      }
      if (policy.risk && !["read", "write"].includes(policy.risk)) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "tool policy risk must be read or write",
        });
      }
    }
    const tool = {
      ...raw,
      name,
      id: raw.id.trim(),
      description: raw.description.trim(),
      timeout_ms: timeout,
    };
    if (tool.type === "http") {
      validateHttpTool(tool);
    } else if (tool.type === "builtin_web") {
      if (tool.action !== "scrape" && tool.action !== "search") {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "builtin_web action must be scrape or search",
        });
      }
    } else if (tool.type === "builtin_leads") {
      if (
        !["start", "status", "results", "cancel", "capture", "request_callback"].includes(
          tool.action,
        )
      ) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "Invalid builtin_leads action",
        });
      }
    } else if (tool.type === "builtin_calendar") {
      if (!["check_availability", "book_slot", "cancel_event"].includes(tool.action)) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "Invalid builtin_calendar action",
        });
      }
      if (
        tool.slot_minutes !== undefined &&
        (tool.slot_minutes < 5 || tool.slot_minutes > 240)
      ) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "builtin_calendar slot_minutes must be between 5 and 240",
        });
      }
    } else if (tool.type === "builtin_integration") {
      const allowed = BUILTIN_INTEGRATION_ACTIONS[tool.provider];
      if (!allowed) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "Invalid builtin_integration provider",
        });
      }
      if (!(allowed as readonly string[]).includes(tool.action)) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: `Invalid ${tool.provider} action '${tool.action}'`,
        });
      }
    } else if (tool.type === "mcp") {
      validateMcpTool(tool);
    } else {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "unknown tool type" });
    }
    normalized.push(tool);
  }
  return normalized;
}

/** Validates a workspace custom tool (registry row) before create/update. */
export function validateCustomToolInput(input: CustomToolInput): CustomToolInput {
  if (!input?.name?.trim()) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "custom tool requires a name",
    });
  }
  const name = input.name.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "custom tool name must be alphanumeric with underscores",
    });
  }
  if (input.description !== undefined && input.description.trim().length > 500) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "custom tool description must be under 500 characters",
    });
  }
  if (input.kind !== "http" && input.kind !== "mcp") {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "custom tool kind must be http or mcp",
    });
  }
  if (!input.config || typeof input.config !== "object" || Array.isArray(input.config)) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "custom tool requires a config object",
    });
  }

  const config = input.config as CustomToolConfig;
  const timeout =
    input.kind === "http"
      ? (config as import("@quickstart/contracts").CustomToolHttpConfig).timeout_ms
      : undefined;
  if (timeout !== undefined && (timeout < 1000 || timeout > MAX_TOOL_TIMEOUT_MS)) {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: `custom tool timeout_ms must be between 1000 and ${MAX_TOOL_TIMEOUT_MS}`,
    });
  }

  if (input.kind === "http") {
    const httpConfig = config as import("@quickstart/contracts").CustomToolHttpConfig;
    const synthetic: AgentToolDefinition & { type: "http" } = {
      id: "custom:validation",
      name,
      description: input.description?.trim() || name,
      type: "http",
      method: httpConfig.method ?? "GET",
      base_url: httpConfig.base_url ?? "",
      allowed_hosts: httpConfig.allowed_hosts ?? [],
      ...(httpConfig.path_template ? { path_template: httpConfig.path_template } : {}),
      ...(httpConfig.headers ? { headers: httpConfig.headers } : {}),
      ...(httpConfig.auth ? { auth: httpConfig.auth } : {}),
      ...(timeout !== undefined ? { timeout_ms: timeout } : {}),
      ...(httpConfig.idempotent !== undefined ? { idempotent: httpConfig.idempotent } : {}),
    };
    validateHttpTool(synthetic);
  } else {
    const mcpConfig = config as import("@quickstart/contracts").CustomToolMcpConfig;
    const synthetic: AgentToolDefinition & { type: "mcp" } = {
      id: "custom:validation",
      name,
      description: input.description?.trim() || name,
      type: "mcp",
      server_url: mcpConfig.server_url ?? "",
      allowed_tool_names: mcpConfig.allowed_tool_names ?? [],
    };
    validateMcpTool(synthetic);
  }

  return {
    name,
    description: input.description?.trim() || "",
    kind: input.kind as CustomToolKind,
    config: input.config as CustomToolConfig,
  };
}
