import type {
  AgentToolDefinition,
  ChatMessage,
  CompletionRequestBody,
  ModelToolDefinition,
} from "@quickstart/contracts";
import { MAX_TOOL_ROUNDS_PER_TURN } from "@quickstart/contracts";
import type { ModelGatewayClient } from "../clients/model-gateway.client.js";
import type { ToolCallsClient } from "../clients/tool-calls.client.js";
import { repairAndParseJson } from "../lib/json-repair.js";
import { buildToolCallKey } from "../lib/tool-call-key.js";
import type { ToolExecutor } from "./tool-executor.js";
import {
  spokenToolNudge,
  toolChangesData,
  visitorConfirmed,
  VOICE_TRANSFER_TOOL_NAME,
} from "./voice-tools.js";

function toModelTools(tools: AgentToolDefinition[]): ModelToolDefinition[] {
  return tools.map((t) => {
    const pathArgs = t.type === "http" ? [...(t.path_template ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]) : [];
    const properties = t.parameters?.properties ?? {};
    return {
      name: t.name,
      description: t.description,
      parameters: t.parameters
        ? { ...t.parameters, required: [...new Set([...(t.parameters.required ?? []), ...pathArgs])] }
        : pathArgs.length > 0
          ? { type: "object", properties, required: pathArgs }
          : undefined,
    };
  });
}

function findTool(tools: AgentToolDefinition[], name: string): AgentToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}

/** Required parameters the model did not supply. Empty values count as missing. */
function missingRequiredArgs(tool: AgentToolDefinition, args: Record<string, unknown>): string[] {
  const pathArgs = tool.type === "http" ? [...(tool.path_template ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]) : [];
  const required = [...new Set([...(tool.parameters?.required ?? []), ...pathArgs])];
  return required.filter((key) => {
    const value = args[key];
    return (
      value === undefined || value === null || (typeof value === "string" && value.trim() === "")
    );
  });
}

const SPOKEN_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

function normalizeSpokenNumbers(value: string): string {
  return value.toLowerCase().replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/g, (word) =>
    String(SPOKEN_NUMBERS[word]),
  );
}

function normalizePathArgs(
  tool: AgentToolDefinition,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (tool.type !== "http") return args;
  const normalized = { ...args };
  for (const match of (tool.path_template ?? "").matchAll(/\{(\w+)\}/g)) {
    const key = match[1];
    const value = normalized[key];
    if (typeof value === "string") {
      const numeric = SPOKEN_NUMBERS[value.trim().toLowerCase()];
      if (numeric !== undefined) normalized[key] = String(numeric);
    }
  }
  return normalized;
}

function assistantAskedForIdentifier(messages: ChatMessage[]): boolean {
  const previousAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && !message.tool_calls?.length)?.content;
  return /\b(?:what|which|provide|give|tell me|share).{0,60}\b(?:id|identifier|number|post|order|ticket|invoice|run|record|account|shipment|booking|payment|lead|customer)\b|\b(?:id|identifier|number).{0,45}\?\s*$/i.test(
    previousAssistant ?? "",
  );
}

function inventedPathArgs(
  tool: AgentToolDefinition,
  args: Record<string, unknown>,
  visitorText: string | undefined,
  chatMessages: ChatMessage[],
): string[] {
  if (tool.type !== "http") return [];
  const text = normalizeSpokenNumbers(visitorText ?? "");
  return [...(tool.path_template ?? "").matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .filter((key) => {
      const value = args[key];
      if (typeof value !== "string" && typeof value !== "number") return true;
      const normalizedValue = normalizeSpokenNumbers(String(value).trim());
      if (!text.includes(normalizedValue)) return true;
      if (!/id$/i.test(key)) return false;
      const escapedValue = normalizedValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const explicitId = new RegExp(
        `(?:\\b(?:id|number)\\s*(?:is\\s*)?#?\\s*${escapedValue}\\b|#\\s*${escapedValue}\\b|\\b(?:order|post|ticket|invoice|run|record|account|shipment|booking|payment|lead|customer)\\s+(?:id\\s+)?${escapedValue}\\b)`,
      );
      return !explicitId.test(text) && !assistantAskedForIdentifier(chatMessages);
    });
}

function toolGuardMessage(message: string): string {
  return JSON.stringify({ error: "tool_guard", instruction: message });
}

export type ToolExecutionSummary = {
  name: string;
  status: "succeeded" | "failed" | "pending" | "unknown";
  args?: Record<string, unknown>;
  error?: string;
};

export type ToolLoopInput = {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  requestId: string;
  turnIdempotencyKey: string;
  authHeaders: Record<string, string>;
  model: CompletionRequestBody["model"];
  temperature?: number;
  tools: AgentToolDefinition[];
  chatMessages: ChatMessage[];
  maxTokens?: number;
  reasoningEffort?: CompletionRequestBody["reasoning_effort"];
  verbosity?: CompletionRequestBody["verbosity"];
  replyLanguage?: string;
  replyGender?: "female" | "male" | "neutral";
  /** Spoken before the tool runs so the caller is not left in silence. */
  onToolStart?: (event: { name: string; spoken: string; args?: Record<string, unknown> }) => void;
  onToolDone?: (event: ToolExecutionSummary) => void;
  visitorText?: string;
  signal?: AbortSignal;
  channel?: "chat" | "voice" | "webhook";
};

export class ToolLoop {
  constructor(
    private readonly modelClient: ModelGatewayClient,
    private readonly toolCallsClient: ToolCallsClient,
    private readonly executor: ToolExecutor,
  ) {}

  async run(
    input: ToolLoopInput,
  ): Promise<{
    content: string;
    chatMessages: ChatMessage[];
    transferred: boolean;
    toolCalls: ToolExecutionSummary[];
  }> {
    const messages = [...input.chatMessages];
    const modelTools = input.tools.length > 0 ? toModelTools(input.tools) : undefined;
    let transferred = false;
    const executedCalls = new Map<string, number>();
    const toolCallCounts = new Map<string, number>();
    const toolCalls: ToolExecutionSummary[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS_PER_TURN; round += 1) {
      if (input.signal?.aborted) throw new DOMException("Turn interrupted", "AbortError");
      const completion = await this.modelClient.complete({
        workspace_id: input.workspaceId,
        request_id: input.requestId,
        agent_id: input.agentId,
        conversation_id: input.conversationId,
        channel: input.channel,
        model: input.model,
        messages,
        tools: modelTools,
        temperature: input.temperature,
        reasoning_effort: input.reasoningEffort,
        verbosity: input.verbosity,
        ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
      }, input.signal);
      if (input.signal?.aborted) throw new DOMException("Turn interrupted", "AbortError");

      if (completion.finish_reason !== "tool_calls" || !completion.tool_calls?.length) {
        return { content: completion.content, chatMessages: messages, transferred, toolCalls };
      }

      messages.push({
        role: "assistant",
        content: completion.content ?? "",
        tool_calls: completion.tool_calls,
        ...(completion.provider_items ? { provider_items: completion.provider_items } : {}),
      });

      // The audit ledger is shared by every tool call in this model round.
      // Read it once instead of adding one network round-trip per call.
      const priorToolCalls = await this.listPrior(input, input.turnIdempotencyKey);

      for (const [callIndex, call] of completion.tool_calls.entries()) {
        if (call.name === VOICE_TRANSFER_TOOL_NAME) {
          transferred = true;
          input.onToolStart?.({
            name: call.name,
            spoken: spokenToolNudge(call.name, input.replyLanguage, input.replyGender),
          });
          const transferEvent: ToolExecutionSummary = { name: call.name, status: "succeeded" };
          toolCalls.push(transferEvent);
          input.onToolDone?.(transferEvent);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({
              ok: true,
              status: "waiting_for_teammate",
              instruction: "The caller already heard the switch line. Reply with an empty string.",
            }),
          });
          continue;
        }
        const tool = findTool(input.tools, call.name);
        if (!tool) {
          const failEvent: ToolExecutionSummary = {
            name: call.name,
            status: "failed",
            error: "tool not configured on agent version",
          };
          toolCalls.push(failEvent);
          input.onToolDone?.(failEvent);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({ error: "tool not configured on agent version" }),
          });
          continue;
        }

        const policy = tool.policy;
        if (policy?.enabled === false) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: toolGuardMessage("This tool is disabled for this agent. Do not call it again."),
          });
          continue;
        }
        const channel = input.channel ?? "chat";
        if (policy?.allowed_channels?.length && !policy.allowed_channels.includes(channel)) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: toolGuardMessage("This tool is not available on the current channel. Choose another approach."),
          });
          continue;
        }
        const count = toolCallCounts.get(call.name) ?? 0;
        if (policy?.max_calls_per_turn !== undefined && count >= policy.max_calls_per_turn) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: toolGuardMessage(`The per-turn call limit for ${call.name} has been reached.`),
          });
          continue;
        }

        const rawCallArgs = call.arguments ?? {};
        const resolvedArgs =
          typeof rawCallArgs.raw === "string"
            ? repairAndParseJson(rawCallArgs.raw)
            : rawCallArgs;
        const args = normalizePathArgs(tool, resolvedArgs);
        const callFingerprint = `${call.name}:${JSON.stringify(args)}`;
        if (executedCalls.has(callFingerprint)) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: toolGuardMessage(
              `You already called ${call.name} with these arguments in this reply. Do not call it again — answer the visitor using the result you already received.`,
            ),
          });
          continue;
        }

        const missing = missingRequiredArgs(tool, args);
        const invented = inventedPathArgs(tool, args, input.visitorText, messages);
        const needsDetails = [...new Set([...missing, ...invented])];
        if (needsDetails.length > 0) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: toolGuardMessage(
              `The visitor did not give ${needsDetails.join(", ")}. If they were only asking a normal question, ignore this tool and answer from the knowledge base. If they asked you to run this action, ask one short question for that detail. Do not invent a value.`,
            ),
          });
          continue;
        }

        const requiresConfirmation =
          policy?.confirmation === "staff" ||
          policy?.confirmation === "user" ||
          policy?.risk === "write" ||
          (policy?.confirmation !== "never" && toolChangesData(tool));
        if (policy?.confirmation === "staff") {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: toolGuardMessage("This action requires staff approval and cannot run in the current turn."),
          });
          continue;
        }
        if (requiresConfirmation && !visitorConfirmed(input.visitorText)) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: toolGuardMessage(
              "This action changes data. Ask the visitor one short confirmation question and wait. Do not call this tool again until they say yes.",
            ),
          });
          continue;
        }

        executedCalls.set(callFingerprint, round);
        toolCallCounts.set(call.name, count + 1);
        input.onToolStart?.({
          name: call.name,
          spoken: spokenToolNudge(call.name, input.replyLanguage, input.replyGender),
          args,
        });

        // Barge-in can arrive while the model is choosing a tool. Never start
        // the external action after the caller has interrupted that turn.
        if (input.signal?.aborted) throw new DOMException("Turn interrupted", "AbortError");

        const toolCallKey = buildToolCallKey(
          input.turnIdempotencyKey,
          round,
          `${call.name}:${callIndex}`,
        );
        const prior = priorToolCalls.find((r) => r.tool_call_key === toolCallKey);
        if (prior && ["succeeded", "failed", "unknown"].includes(prior.status)) {
          const replay =
            prior.response_json != null
              ? JSON.stringify(prior.response_json)
              : (prior.error_code ?? prior.status);
          const replayEvent: ToolExecutionSummary = {
            name: call.name,
            status: prior.status as ToolExecutionSummary["status"],
            args,
          };
          toolCalls.push(replayEvent);
          input.onToolDone?.(replayEvent);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: replay,
          });
          continue;
        }

        await this.remember(input, {
          turn_idempotency_key: input.turnIdempotencyKey,
          tool_call_key: toolCallKey,
          tool_name: call.name,
          status: "pending",
          request_json: args,
        });

        const timeoutMs = tool.timeout_ms ?? 30_000;
        const result = await this.executor.execute(tool, args, {
          workspaceId: input.workspaceId,
          requestId: input.requestId,
          toolCallKey,
          timeoutMs,
          authorization: input.authHeaders.authorization,
          conversationId: input.conversationId,
          channel,
        });

        await this.remember(input, {
          turn_idempotency_key: input.turnIdempotencyKey,
          tool_call_key: toolCallKey,
          tool_name: call.name,
          status: result.status,
          request_json: args,
          response_json: result.ok ? { content: result.content } : null,
          error_code: result.errorCode ?? null,
        });

        const doneEvent: ToolExecutionSummary = {
          name: call.name,
          status: result.status,
          args,
          error: result.status === "failed" ? result.errorCode : undefined,
        };
        toolCalls.push(doneEvent);
        input.onToolDone?.(doneEvent);

        let toolContent = result.content;
        if (!result.ok) {
          toolContent = JSON.stringify({
            status: "error",
            error_code: result.errorCode ?? "TOOL_EXECUTION_FAILED",
            message: result.content,
            instruction:
              "The tool call failed. Do not call this tool again with identical arguments. Either ask the visitor for clarification if an argument was invalid, try an alternative approach, or politely explain the issue to the visitor without technical error dumps.",
          });
        } else {
          const trimmed = result.content.trim();
          if (
            trimmed === "[]" ||
            trimmed === "{}" ||
            /^\{\s*"(?:items|results|data|records|slots)"\s*:\s*\[\s*\]\s*\}$/.test(trimmed) ||
            /^\{\s*"(?:count|total|total_results)"\s*:\s*0\s*\}$/.test(trimmed)
          ) {
            try {
              const parsed = JSON.parse(trimmed) as unknown;
              toolContent = JSON.stringify({
                data: parsed,
                notice:
                  "Zero matching records found. Report this outcome truthfully to the visitor; do not fabricate fake IDs, mock appointments, or assumptions.",
              });
            } catch {
              /* keep original content */
            }
          }
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: toolContent,
        });
      }
    }

    // Graceful Fallback on Max Tool Rounds:
    // Instead of throwing AppError and failing the user's turn, make one final synthesis call without tools.
    try {
      messages.push({
        role: "system",
        content:
          "The maximum tool execution steps for this turn have been reached. Do not invoke any further tools. Using the information gathered from prior tool calls, synthesize a clear, helpful response explaining what was completed and what remains pending.",
      });

      const finalCompletion = await this.modelClient.complete(
        {
          workspace_id: input.workspaceId,
          request_id: input.requestId,
          agent_id: input.agentId,
          conversation_id: input.conversationId,
          channel: input.channel,
          model: input.model,
          messages,
          tools: undefined,
          temperature: input.temperature,
          reasoning_effort: input.reasoningEffort,
          verbosity: input.verbosity,
          ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
        },
        input.signal,
      );

      if (finalCompletion.content && finalCompletion.content.trim()) {
        return {
          content: finalCompletion.content,
          chatMessages: messages,
          transferred,
          toolCalls,
        };
      }
    } catch {
      /* fallback to default polite message */
    }

    const fallbackSummary =
      "I was able to perform part of your request, but reached the maximum allowed steps for this turn. Here is the latest update based on the actions taken so far. Please let me know if you would like me to continue.";

    return {
      content: fallbackSummary,
      chatMessages: messages,
      transferred,
      toolCalls,
    };
  }

  /** Widget voice has no staff token. A failed audit write must not block the function. */
  private async listPrior(input: ToolLoopInput, turnIdempotencyKey: string) {
    try {
      return await this.toolCallsClient.listByTurn(
        input.workspaceId,
        input.conversationId,
        turnIdempotencyKey,
        input.authHeaders,
      );
    } catch {
      return [];
    }
  }

  private async remember(
    input: ToolLoopInput,
    body: Parameters<ToolCallsClient["upsert"]>[2],
  ): Promise<void> {
    try {
      await this.toolCallsClient.upsert(
        input.workspaceId,
        input.conversationId,
        body,
        input.authHeaders,
      );
    } catch {
      /* the function result is still returned to the model */
    }
  }
}
