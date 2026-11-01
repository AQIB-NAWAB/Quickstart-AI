import type { Identity, Store } from "../store.js";
import type { CrmDestinationAdapter, CrmPushResult } from "./adapter.js";
import { hubspotAdapter } from "./hubspot.adapter.js";
import { salesforceAdapter } from "./salesforce.adapter.js";
import { customWebhookAdapter } from "./custom-webhook.adapter.js";

export * from "./adapter.js";
export * from "./hubspot.adapter.js";
export * from "./salesforce.adapter.js";
export * from "./custom-webhook.adapter.js";

export function getCrmAdapter(provider: string): CrmDestinationAdapter {
  const norm = provider.trim().toLowerCase();
  switch (norm) {
    case "hubspot":
      return hubspotAdapter;
    case "salesforce":
      return salesforceAdapter;
    case "webhook":
    case "custom_webhook":
      return customWebhookAdapter;
    default:
      throw new Error(`UNSUPPORTED_CRM_PROVIDER: Provider '${provider}' is not supported.`);
  }
}

export async function deliverLeadToCrm(
  store: Store,
  identity: Identity,
  lead: any,
  provider: string,
  credentials: Record<string, unknown>,
  options?: { preserveConflicts?: boolean },
): Promise<CrmPushResult> {
  const adapter = getCrmAdapter(provider);
  const existingMapping = await store.getCrmMapping(identity, lead.id, provider);

  const result = await adapter.pushLead(lead, credentials, existingMapping, options);

  // Record mapping
  await store.recordCrmMapping(identity, {
    workspace_id: identity.workspaceId,
    provider,
    lead_id: lead.id,
    external_object_id: result.remote_record_id,
    external_object_type: provider === "salesforce" ? "Lead" : provider === "hubspot" ? "Contact" : "WebhookEvent",
    last_synced_at: new Date().toISOString(),
    last_synced_payload: {
      fields: {
        ...((existingMapping?.last_synced_payload?.fields ?? {}) as Record<string, unknown>),
        ...((result.details?.written_fields ?? {}) as Record<string, unknown>),
      },
      status: result.operation,
      remote_record_id: result.remote_record_id,
      conflict_detected: result.conflict_detected || false,
      preserved_fields: result.preserved_fields || [],
    },
    field_ownership: result.preserved_fields?.length ? { remote_preserved: result.preserved_fields.join(", ") } : {},
    status: "synced",
  });

  return result;
}
