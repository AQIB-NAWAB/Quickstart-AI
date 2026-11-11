import type {
  CompletionRequestBody,
  CompletionResponseBody,
  ModelReference,
} from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";
import type { Logger } from "@quickstart/logging";
import { recordModelTimeout } from "@quickstart/tracing";
import { CircuitBreaker } from "@quickstart/utilities";
import type { ModelGatewayConfig } from "../config/environment.js";
import { ProviderError } from "../domain/types.js";
import type { ProviderCompletionInput } from "../domain/types.js";
import type { UsageIngestClient } from "../clients/usage.client.js";
import type { InflightCap } from "../lib/inflight-cap.js";
import { logModelUsage } from "../lib/usage-logger.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ChatProvider } from "../providers/types.js";

export type StreamCallbacks = {
  onToken: (delta: string) => void;
  tokensStarted: () => boolean;
  markTokensStarted: () => void;
};

function assertPlatformCredentials(body: CompletionRequestBody): void {
  const source = body.credential_source ?? "platform";
  if (source === "workspace") {
    throw new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Workspace credentials are not available until secrets (Feature 16)",
    });
  }
}

function toProviderInput(
  body: CompletionRequestBody,
  model: ModelReference,
  attempt: number,
): ProviderCompletionInput {
  return {
    modelId: model.model_id,
    messages: body.messages,
    tools: body.tools,
    temperature: body.temperature,
    maxTokens: body.max_tokens,
responseFormat: body.response_format,
    reasoningEffort: body.reasoning_effort,
    verbosity: body.verbosity,
    context: {
      workspaceId: body.workspace_id,
      requestId: body.request_id,
      attempt,
    },
  };
}

export class CompletionOrchestrator {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly config: ModelGatewayConfig,
    private readonly registry: ProviderRegistry,
    private readonly inflight: InflightCap,
    private readonly logger: Logger,
    private readonly usageIngest?: UsageIngestClient,
  ) {}

  async complete(body: CompletionRequestBody): Promise<CompletionResponseBody> {
    assertPlatformCredentials(body);
    await this.inflight.acquire();
    const started = Date.now();
    try {
      const primary = body.model;
      let result = await this.callWithPolicy(primary, body, { stream: false });
      if (!result && body.fallback_model) {
        result = await this.callWithPolicy(body.fallback_model, body, { stream: false });
      }
      if (!result) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Model completion failed",
        });
      }

      const response: CompletionResponseBody = {
        content: result.output.content,
        finish_reason: result.output.finishReason,
        tool_calls: result.output.toolCalls,
        provider_items: result.output.providerItems,
        usage: {
          input_tokens: result.output.usage.inputTokens,
          output_tokens: result.output.usage.outputTokens,
        },
        provider: result.provider.profileId,
        model: primary.model_id,
        latency_ms: Date.now() - started,
      };

      logModelUsage(
        this.logger,
        {
          workspace_id: body.workspace_id,
          request_id: body.request_id,
          agent_id: body.agent_id,
          conversation_id: body.conversation_id,
          channel: body.channel,
          provider: result.provider.profileId,
          model: primary.model_id,
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          latency_ms: response.latency_ms,
        },
        this.usageIngest,
      );

      return response;
    } finally {
      await this.inflight.release();
    }
  }

  async stream(
    body: CompletionRequestBody,
    callbacks: StreamCallbacks,
  ): Promise<CompletionResponseBody> {
    assertPlatformCredentials(body);
    await this.inflight.acquire();
    const started = Date.now();
    try {
      const primary = body.model;
      const wrappedCallbacks: StreamCallbacks = {
        onToken: (delta) => {
          callbacks.markTokensStarted();
          callbacks.onToken(delta);
        },
        tokensStarted: callbacks.tokensStarted,
        markTokensStarted: callbacks.markTokensStarted,
      };

      let result = await this.callWithPolicy(primary, body, {
        stream: true,
        callbacks: wrappedCallbacks,
      });

      if (!result && body.fallback_model && !callbacks.tokensStarted()) {
        result = await this.callWithPolicy(body.fallback_model, body, {
          stream: true,
          callbacks: wrappedCallbacks,
        });
      }

      if (!result) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Model stream failed",
        });
      }

      const response: CompletionResponseBody = {
        content: result.output.content,
        finish_reason: result.output.finishReason,
        tool_calls: result.output.toolCalls,
        provider_items: result.output.providerItems,
        usage: {
          input_tokens: result.output.usage.inputTokens,
          output_tokens: result.output.usage.outputTokens,
        },
        provider: result.provider.profileId,
        model: primary.model_id,
        latency_ms: Date.now() - started,
      };

      logModelUsage(
        this.logger,
        {
          workspace_id: body.workspace_id,
          request_id: body.request_id,
          agent_id: body.agent_id,
          conversation_id: body.conversation_id,
          channel: body.channel,
          provider: result.provider.profileId,
          model: primary.model_id,
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          latency_ms: response.latency_ms,
        },
        this.usageIngest,
      );

      return response;
    } finally {
      await this.inflight.release();
    }
  }

  private breakerFor(profileId: string): CircuitBreaker {
    let breaker = this.breakers.get(profileId);
    if (!breaker) {
      breaker = new CircuitBreaker({
        failureThreshold: this.config.circuitFailureThreshold,
        cooldownMs: this.config.circuitCooldownMs,
      });
      this.breakers.set(profileId, breaker);
    }
    return breaker;
  }

  private async callWithPolicy(
    model: ModelReference,
    body: CompletionRequestBody,
    options: { stream: boolean; callbacks?: StreamCallbacks },
  ): Promise<{
    provider: ChatProvider;
    output: Awaited<ReturnType<ChatProvider["complete"]>>;
  } | null> {
    const provider = this.registry.get(model.profile);
    const breaker = this.breakerFor(model.profile);

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (options.stream && options.callbacks?.tokensStarted()) {
        break;
      }

      try {
        const output = await breaker.execute(
          () => this.withTimeout(provider, toProviderInput(body, model, attempt), options),
          (err) =>
            !(
              err instanceof ProviderError &&
              (err.httpStatus === 429 ||
                err.httpStatus === 413 ||
                err.message.includes("rate_limit_exceeded") ||
                err.message.includes("TPM"))
            ),
        );
        return { provider, output };
      } catch (error) {
        this.logger.warn("model.call_failed", {
          profile: model.profile,
          model: model.model_id,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof Error && error.message === "CIRCUIT_OPEN") {
          // Let complete()/stream() try the configured fallback provider.
          return null;
        }
        if (error instanceof ProviderError && error.httpStatus === 429) {
          if (attempt === 1 && !options.callbacks?.tokensStarted()) {
            this.logger.warn("model.rate_limited_retry", {
              profile: model.profile,
              attempt,
            });
            const delayMs = Math.min(
              2500,
              Math.max(50, Math.floor(this.config.completionTimeoutMs / 4)),
            );
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }
          throw new AppError({
            code: ErrorCode.RATE_LIMITED,
            message: error.message || "Model provider rate limit exceeded",
          });
        }
        const retryable = this.isRetryable(error);
        if (!retryable || attempt === 2) {
          if (error instanceof AppError) throw error;
          return null;
        }
      }
    }
    return null;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof ProviderError) return error.retryable;
    if (error instanceof AppError && error.code === ErrorCode.UPSTREAM_TIMEOUT) return true;
    if (error instanceof Error && error.message === "CIRCUIT_OPEN") return false;
    if (error instanceof Error && error.name === "AbortError") return true;
    return false;
  }

  private async withTimeout(
    provider: ChatProvider,
    input: ProviderCompletionInput,
    options: { stream: boolean; callbacks?: StreamCallbacks },
  ): Promise<Awaited<ReturnType<ChatProvider["complete"]>>> {
    const timeoutMs = this.config.completionTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        recordModelTimeout();
        reject(
          new AppError({
            code: ErrorCode.UPSTREAM_TIMEOUT,
            message: "Model provider timed out",
          }),
        );
      }, timeoutMs);
    });

    try {
      const work = options.stream
        ? provider.stream(input, (delta) => options.callbacks?.onToken(delta))
        : provider.complete(input);
      return await Promise.race([work, timeoutPromise]);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
