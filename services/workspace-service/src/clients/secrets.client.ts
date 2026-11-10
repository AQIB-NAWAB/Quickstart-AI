import { fetchWithPolicy } from "@quickstart/utilities";
import { AppError, ErrorCode } from "@quickstart/errors";

export class SecretsClient {
  private readonly baseUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs: number;

  constructor(options: { baseUrl?: string; internalToken: string; timeoutMs?: number }) {
    this.baseUrl = (options.baseUrl ?? process.env.SECRETS_URL ?? "http://127.0.0.1:3011").replace(/\/$/, "");
    this.internalToken = options.internalToken;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async storeIntegrationSecret(workspaceId: string, provider: string, value: Record<string, unknown>): Promise<string> {
    const secretName = `integration_${provider}_credentials`;
    const payload = JSON.stringify(value);

    try {
      const res = await fetchWithPolicy(
        `${this.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/secrets`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.internalToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ name: secretName, value: payload }),
        },
        { timeoutMs: this.timeoutMs, maxRetries: 0 },
      );

      if (!res.ok) {
        throw new Error("Vault write failed");
      }
      return secretName;
    } catch {
      throw new AppError({ code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: "Credential vault unavailable. Connection was not saved; please retry after the vault is healthy." });
    }
  }

  async getIntegrationSecret(workspaceId: string, provider: string): Promise<Record<string, unknown> | null> {
    const secretName = `integration_${provider}_credentials`;
    try {
      const res = await fetchWithPolicy(
        `${this.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/secrets/${encodeURIComponent(secretName)}/value`,
        {
          headers: {
            authorization: `Bearer ${this.internalToken}`,
          },
        },
        { timeoutMs: this.timeoutMs, maxRetries: 0 },
      );
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const data = (await res.json()) as { value?: string };
      if (!data.value) return null;
      return JSON.parse(data.value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async deleteIntegrationSecret(workspaceId: string, provider: string): Promise<void> {
    const secretName = `integration_${provider}_credentials`;
    try {
      await fetchWithPolicy(
        `${this.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/secrets/${encodeURIComponent(secretName)}`,
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${this.internalToken}`,
          },
        },
        { timeoutMs: this.timeoutMs, maxRetries: 0 },
      );
    } catch {
      // Best-effort deletion
    }
  }

  async storeNamedSecret(workspaceId: string, name: string, value: string): Promise<void> {
    const res = await fetchWithPolicy(
      `${this.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/secrets`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.internalToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name, value }),
      },
      { timeoutMs: this.timeoutMs, maxRetries: 0 },
    );
    if (!res.ok) {
      throw new Error(`Failed to store encrypted secret in secrets-service: HTTP ${res.status}`);
    }
  }

  async getNamedSecret(workspaceId: string, name: string): Promise<string | null> {
    try {
      const res = await fetchWithPolicy(
        `${this.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/secrets/${encodeURIComponent(name)}/value`,
        {
          headers: {
            authorization: `Bearer ${this.internalToken}`,
          },
        },
        { timeoutMs: this.timeoutMs, maxRetries: 0 },
      );
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const data = (await res.json()) as { value?: string };
      return typeof data.value === "string" ? data.value : null;
    } catch {
      return null;
    }
  }

  async deleteNamedSecret(workspaceId: string, name: string): Promise<void> {
    try {
      await fetchWithPolicy(
        `${this.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/secrets/${encodeURIComponent(name)}`,
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${this.internalToken}`,
          },
        },
        { timeoutMs: this.timeoutMs, maxRetries: 0 },
      );
    } catch {
      // Best-effort deletion
    }
  }
}
