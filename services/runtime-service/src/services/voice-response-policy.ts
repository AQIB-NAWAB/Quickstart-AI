import type { CompletionRequestBody } from "@quickstart/contracts";

/** Reasoning and visible speech share the provider's output-token budget. */
export function voiceOutputBudget(input: {
  configuredMax?: number;
  environmentMax?: string;
  reasoningEffort?: CompletionRequestBody["reasoning_effort"];
}): number {
  const positive = (value: unknown): number | undefined => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1
      ? Math.min(32_000, Math.floor(number))
      : undefined;
  };
  const reasoning = input.reasoningEffort && input.reasoningEffort !== "none";
  const defaultBudget = reasoning
    ? ["medium", "high", "xhigh", "max"].includes(input.reasoningEffort!)
      ? 4096
      : 2048
    : 256;
  const cap = positive(input.environmentMax);
  const budget = positive(input.configuredMax) ?? defaultBudget;
  return cap ? Math.min(budget, cap) : budget;
}

/** Start optional-context timeouts with the request, not after another await. */
export function optionalVoiceContext<T>(
  request: Promise<T>,
  timeoutMs: number,
  fallback: T,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      resolve(fallback);
    }, timeoutMs);
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
