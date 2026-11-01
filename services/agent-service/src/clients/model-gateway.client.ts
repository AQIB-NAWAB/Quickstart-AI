import type { CompletionRequestBody, CompletionResponseBody } from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";
import { fetchWithPolicy } from "@quickstart/utilities";

export interface AgentModelGateway {
  complete(body: CompletionRequestBody, signal?: AbortSignal): Promise<CompletionResponseBody>;
}

export class ModelGatewayClient implements AgentModelGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async complete(
    body: CompletionRequestBody,
    signal?: AbortSignal,
  ): Promise<CompletionResponseBody> {
    const response = await fetchWithPolicy(
      `${this.baseUrl}/internal/complete`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.internalToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal,
      },
      { timeoutMs: this.timeoutMs, maxRetries: 0 },
    ).catch((error: Error) => {
      throw new AppError({
        code:
          error.name === "AbortError" ? ErrorCode.UPSTREAM_TIMEOUT : ErrorCode.UPSTREAM_UNAVAILABLE,
        message:
          error.name === "AbortError"
            ? "AI builder request timed out"
            : `AI builder is unavailable: ${error.message}`,
      });
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new AppError({
        code: response.status === 429 ? ErrorCode.RATE_LIMITED : ErrorCode.UPSTREAM_UNAVAILABLE,
        message: body.error?.message ?? `AI builder request failed with status ${response.status}`,
      });
    }

    return (await response.json()) as CompletionResponseBody;
  }
}
