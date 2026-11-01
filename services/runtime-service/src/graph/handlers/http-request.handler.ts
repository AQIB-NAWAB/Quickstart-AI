import { randomUUID } from "node:crypto";
import type { AgentGraphNode, HttpRequestNodeConfig } from "@quickstart/contracts";
import type { ExecutionContext, GraphNodeHandler, NodeExecutionResult } from "../types.js";
import { resolveVariablePath, setVariablePath } from "../eval-utils.js";
import type { ToolExecutor } from "../../services/tool-executor.js";

export class HttpRequestHandler implements GraphNodeHandler<"http_request"> {
  type = "http_request" as const;
  constructor(private readonly toolExecutor?: ToolExecutor) {}
  async execute(
    node: AgentGraphNode<"http_request">,
    ctx: ExecutionContext,
  ): Promise<NodeExecutionResult> {
    const config = node.config as HttpRequestNodeConfig;
    const tools = ctx.sessionState.agent_defaults?.tools ?? [];
    const tool = tools.find(
      (t) =>
        (config.tool_id && t.id === config.tool_id) ||
        (config.tool_name && t.name === config.tool_name),
    );
    // Only execute a validated tool from the frozen agent snapshot. Never construct an
    // unrestricted HTTP tool from a graph URL supplied by a browser.
    if (!tool || tool.type !== "http" || !this.toolExecutor)
      return {
        status: "failed",
        chosenBranchPort: "failure",
        error: "Select a configured HTTP tool attached to this agent.",
      };
    const args: Record<string, unknown> = {};
    const mappings = config.parameter_mappings ?? {};
    const pairs = Array.isArray(mappings)
      ? mappings.map((m) => [m.param, m.variable])
      : Object.entries(mappings);
    for (const [param, variable] of pairs)
      args[param] = resolveVariablePath(variable, ctx.sessionState.variables);
    const required = [
      ...(tool.parameters?.required ?? []),
      ...[...(tool.path_template ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
    ];
    if (required.some((k) => args[k] === undefined || args[k] === null || args[k] === ""))
      return {
        status: "failed",
        chosenBranchPort: "failure",
        error: "A required tool argument is missing.",
      };
    const method = tool.method ?? "GET";
    const mutating = method !== "GET";
    if (mutating) {
      const pending = ctx.sessionState.pending_action;
      const same =
        pending?.tool_name === tool.name &&
        pending.method === method &&
        JSON.stringify(pending.args) === JSON.stringify(args);
      if (same && pending.confirmed)
        return {
          status: "failed",
          chosenBranchPort: "failure",
          error:
            "The previous action outcome is uncertain. Ask an operator to verify it before retrying.",
        };
      const confirmed =
        same &&
        Date.now() - Date.parse(pending.created_at) < 600000 &&
        /^(?:yes|yes please|confirm|i confirm|proceed|ok|okay|sure|go ahead|book it|cancel it)[.!\s]*$/i.test(
          ctx.visitorMessage?.trim() ?? "",
        );
      if (!confirmed) {
        ctx.sessionState.pending_action = {
          action_id: randomUUID(),
          tool_name: tool.name,
          endpoint: tool.base_url,
          method,
          args,
          confirmed: false,
          created_at: new Date().toISOString(),
        };
        await ctx.onAssistantMessage?.(
          config.confirmation_prompt ?? `Would you like me to proceed with ${node.name}?`,
        );
        return { status: "waiting_for_input" };
      }
      // Persist the action fence before external I/O. A crash must never reuse this confirmation.
      ctx.sessionState.pending_action!.confirmed = true;
      await ctx.checkpoint?.();
    }
    const result = await this.toolExecutor.execute(tool, args, {
      workspaceId: ctx.workspaceId,
      requestId: ctx.requestId,
      toolCallKey: `graph:${ctx.sessionId}:${ctx.turnIndex}:${node.id}`,
      timeoutMs: Math.min(
        (config.timeout_seconds ?? 15) * 1000,
        Math.max(1, ctx.deadlineMs - Date.now()),
      ),
      authorization: ctx.authHeaders?.authorization,
      channel: ctx.channel,
    });
    if (!result.ok && result.status !== "unknown") delete ctx.sessionState.pending_action;
    if (!result.ok)
      return {
        status: "failed",
        chosenBranchPort: "failure",
        error:
          result.status === "unknown"
            ? "The action outcome is unknown. Verify it before trying again."
            : "The connected tool could not complete the request.",
      };
    delete ctx.sessionState.pending_action;
    let output: unknown = result.content;
    try {
      output = JSON.parse(result.content);
    } catch {
      /* Tools may return plain text. */
    }
    return {
      status: "succeeded",
      chosenBranchPort: "success",
      outputVariables: setVariablePath(
        config.output_variable ?? "http.response",
        output,
        ctx.sessionState.variables,
      ),
    };
  }
}
