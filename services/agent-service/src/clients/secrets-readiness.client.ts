import { fetchWithPolicy } from "@quickstart/utilities";

export type SecretReadinessClient = {
  listNames(workspaceId: string): Promise<Set<string>>;
};

export function createSecretsReadinessClient(options: {
  baseUrl: string;
  internalToken: string;
  timeoutMs?: number;
}): SecretReadinessClient {
  return {
    async listNames(workspaceId: string): Promise<Set<string>> {
      const response = await fetchWithPolicy(
        `${options.baseUrl.replace(/\/$/, "")}/internal/workspaces/${encodeURIComponent(workspaceId)}/secrets`,
        {
          headers: {
            authorization: `Bearer ${options.internalToken}`,
            accept: "application/json",
          },
        },
        { timeoutMs: options.timeoutMs ?? 5_000, maxRetries: 0 },
      );
      if (!response.ok) throw new Error(`Secrets service returned HTTP ${response.status}`);
      const body = (await response.json()) as { secrets?: Array<{ name?: string }> };
      return new Set(
        (body.secrets ?? [])
          .map((secret) => secret.name)
          .filter((name): name is string => typeof name === "string"),
      );
    },
  };
}
