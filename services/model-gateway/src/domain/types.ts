import type { ChatMessage, ModelToolDefinition } from "@quickstart/contracts";

export type ProviderCallContext = {
  workspaceId: string;
  requestId: string;
  attempt: number;
};

export type ProviderCompletionInput = {
  modelId: string;
  messages: ChatMessage[];
  tools?: ModelToolDefinition[];
  temperature?: number;
  maxTokens?: number;
responseFormat?: { type: "json_object" };
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  verbosity?: "low" | "medium" | "high";
  context: ProviderCallContext;
};

export type ProviderCompletionOutput = {
  content: string;
  finishReason: string;
  toolCalls?: import("@quickstart/contracts").ModelToolCall[];
  providerItems?: unknown[];
  usage: { inputTokens: number; outputTokens: number };
};

export type ProviderStreamHandler = (delta: string) => void;

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(message: string, options: { retryable: boolean; httpStatus?: number; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ProviderError";
    this.retryable = options.retryable;
    this.httpStatus = options.httpStatus;
  }
}
