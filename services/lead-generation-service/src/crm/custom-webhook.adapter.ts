import { requestPublicWebhook } from "./public-request.js";
import * as crypto from "node:crypto";
import type { CrmMapping, LeadRecord } from "@quickstart/contracts";
import type { CrmDestinationAdapter, CrmPushResult } from "./adapter.js";

export class CustomWebhookAdapter implements CrmDestinationAdapter {
  readonly name = "webhook";

  constructor(private readonly request = requestPublicWebhook) {}

  private getWebhookConfig(credentials: Record<string, unknown>): { url: string; secret: string } {
    const url =
      (credentials.url as string) ||
      (credentials.webhookUrl as string) ||
      (credentials.webhook_url as string);
    const secret =
      (credentials.secret as string) ||
      (credentials.signing_secret as string) ||
      (credentials.signingSecret as string) ||
      "";

    if (!url || typeof url !== "string" || !url.startsWith("http")) {
      throw new Error("WEBHOOK_CONFIG_ERROR: A valid HTTP/HTTPS webhook URL must be provided.");
    }
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("WEBHOOK_CONFIG_ERROR: HTTPS URL without embedded credentials required.");
    }
    return { url, secret };
  }

  signPayload(payload: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  }

  async testConnection(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    try {
      const { url, secret } = this.getWebhookConfig(credentials);
      const timestamp = new Date().toISOString();
      const testPayload = JSON.stringify({
        event: "webhook.test",
        timestamp,
        message: "QuickStart AI Webhook connection test.",
      });

      const signature = secret ? this.signPayload(testPayload, secret) : "";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Quickstart-Event": "webhook.test",
        "X-Quickstart-Timestamp": timestamp,
      };
      if (signature) {
        headers["X-Quickstart-Signature"] = `sha256=${signature}`;
      }

      const res = await this.request(url, {
        method: "POST",
        headers,
        body: testPayload,
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok || res.status === 200 || res.status === 202 || res.status === 204) {
        return { ok: true, message: `Webhook endpoint verified (HTTP ${res.status}).` };
      }
      return { ok: false, message: `Webhook endpoint returned HTTP ${res.status}: ${res.statusText}` };
    } catch (err: any) {
      return { ok: false, message: err?.message || "Failed to reach webhook endpoint." };
    }
  }

  async pushLead(
    lead: LeadRecord | any,
    credentials: Record<string, unknown>,
    existingMapping?: CrmMapping | null,
    _options?: { preserveConflicts?: boolean },
  ): Promise<CrmPushResult> {
    const { url, secret } = this.getWebhookConfig(credentials);
    const timestamp = new Date().toISOString();
    const leadId = String(lead.id || crypto.randomUUID());

    const payloadObj = {
      event: "lead.qualified",
      timestamp,
      lead_id: leadId,
      entity_type: lead.entity_type || lead.data?.entity_type || "business",
      sales_status: lead.sales_status || "new",
      lead: {
        id: leadId,
        company_name: lead.data?.company_name || lead.company_name || null,
        domain: lead.domain || lead.data?.website || null,
        email: lead.contact_email || lead.email || lead.data?.email || null,
        phone: lead.contact_phone || lead.phone || lead.data?.phone || null,
        person_name: lead.person_name || lead.data?.person_name || null,
        person_role: lead.person_role || lead.data?.person_role || null,
        location: lead.data?.location || lead.location || null,
        fit_score: lead.data?.fit_score ?? lead.fit_score ?? null,
        summary: lead.data?.summary || lead.summary || null,
        notes: lead.notes || null,
        contact_points: lead.contact_points || lead.data?.contact_points || [],
      },
    };

    const payloadStr = JSON.stringify(payloadObj);
    const signature = secret ? this.signPayload(payloadStr, secret) : "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Quickstart-Event": "lead.qualified",
      "X-Quickstart-Timestamp": timestamp,
      "X-Quickstart-Idempotency-Key": `lead:${leadId}`,
    };
    if (signature) {
      headers["X-Quickstart-Signature"] = `sha256=${signature}`;
    }

    const res = await this.request(url, {
      method: "POST",
      headers,
      body: payloadStr,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`Custom webhook delivery failed: HTTP ${res.status} ${res.statusText}`);
    }

    return {
      remote_record_id: existingMapping?.external_object_id ?? `webhook:${leadId}`,
      operation: existingMapping ? "updated" : "created",
      conflict_detected: false,
      preserved_fields: [],
      details: {
        status_code: res.status,
        delivered_at: timestamp,
      },
    };
  }
}

export const customWebhookAdapter = new CustomWebhookAdapter();
