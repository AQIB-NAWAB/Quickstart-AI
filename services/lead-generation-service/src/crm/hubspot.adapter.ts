import type { CrmMapping, LeadRecord } from "@quickstart/contracts";
import type { CrmDestinationAdapter, CrmPushResult } from "./adapter.js";

export class HubSpotAdapter implements CrmDestinationAdapter {
  readonly name = "hubspot";

  private request(url: string, init: RequestInit = {}): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(15000), redirect: "error" });
  }


  private getAccessToken(credentials: Record<string, unknown>): string {
    const token =
      (credentials.accessToken as string) ||
      (credentials.token as string) ||
      (credentials.api_key as string);
    if (!token || typeof token !== "string" || token.length < 10) {
      throw new Error("HUBSPOT_AUTHENTICATION_REQUIRED: Valid HubSpot access token must be provided.");
    }
    return token;
  }

  async testConnection(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    try {
      const token = this.getAccessToken(credentials);
      const res = await this.request("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (res.ok) {
        return { ok: true, message: "HubSpot connection verified." };
      }
      return { ok: false, message: `HubSpot returned HTTP ${res.status}: ${res.statusText}` };
    } catch (err: any) {
      return { ok: false, message: err?.message || "Failed to connect to HubSpot." };
    }
  }

  async pushLead(
    lead: LeadRecord | any,
    credentials: Record<string, unknown>,
    existingMapping?: CrmMapping | null,
    options: { preserveConflicts?: boolean } = { preserveConflicts: true },
  ): Promise<CrmPushResult> {
    const token = this.getAccessToken(credentials);
    const data = lead.data || lead;

    const email = lead.email || lead.contact_email || data.email || null;
    const phone = lead.phone || lead.contact_phone || data.phone || null;
    const company = data.company_name || data.company || null;
    const website = lead.domain || data.website || null;
    const personName = lead.person_name || data.person_name || null;

    let firstName = "";
    let lastName = "";
    if (personName && typeof personName === "string") {
      const parts = personName.trim().split(/\s+/);
      firstName = parts[0] || "";
      lastName = parts.slice(1).join(" ") || "";
    }

    const targetProperties: Record<string, string> = {
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(company ? { company } : {}),
      ...(website ? { website } : {}),
      ...(firstName ? { firstname: firstName } : {}),
      ...(lastName ? { lastname: lastName } : {}),
      hs_lead_status: "NEW",
    };

    let remoteContactId: string | null = existingMapping?.external_object_id || null;
    let remoteProperties: Record<string, string> = {};

    // 1. If mapping exists, retrieve remote record to detect conflicts
    if (remoteContactId) {
      {
        const getRes = await this.request(
          `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(remoteContactId)}?properties=email,phone,company,website,firstname,lastname,hs_lead_status`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );
        if (getRes.ok) {
          const body = (await getRes.json()) as any;
          remoteProperties = body.properties || {};
        } else if (getRes.status === 404) {
          remoteContactId = null;
        } else {
          throw new Error(`HubSpot read failed: HTTP ${getRes.status}; update cancelled`);
        }
      }
    }

    // 2. If no mapping or remote was deleted, check by email
    if (!remoteContactId && email) {
      {
        const searchRes = await this.request("https://api.hubapi.com/crm/v3/objects/contacts/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "email",
                    operator: "EQ",
                    value: email,
                  },
                ],
              },
            ],
            properties: ["email", "phone", "company", "website", "firstname", "lastname", "hs_lead_status"],
            limit: 1,
          }),
        });
        if (searchRes.ok) {
          const searchBody = (await searchRes.json()) as any;
          if (searchBody.results?.[0]?.id) {
            remoteContactId = searchBody.results[0].id;
            remoteProperties = searchBody.results[0].properties || {};
          }
        } else {
          throw new Error(`HubSpot search failed: HTTP ${searchRes.status}; create cancelled`);
        }
      }
    }

    // 3. Update existing contact with conflict preservation
    if (remoteContactId) {
      const preservedFields: string[] = [];
      let conflictDetected = false;
      const propertiesToUpdate: Record<string, string> = { ...targetProperties };

      const priorFields = (existingMapping?.last_synced_payload?.fields ?? {}) as Record<string, unknown>;
      if (options.preserveConflicts !== false) {
        for (const [key, remoteVal] of Object.entries(remoteProperties)) {
          if (
            remoteVal &&
            targetProperties[key] &&
            String(remoteVal) !== targetProperties[key] &&
            String(remoteVal) !== priorFields[key]
          ) {
            conflictDetected = true;
            preservedFields.push(key);
            // Preserve the remote user edit
            delete propertiesToUpdate[key];
          }
        }
      }

      const updateRes = await this.request(
        `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(remoteContactId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ properties: propertiesToUpdate }),
        },
      );

      if (!updateRes.ok) {
        throw new Error(`HubSpot update contact failed: HTTP ${updateRes.status} ${updateRes.statusText}`);
      }

      return {
        remote_record_id: remoteContactId,
        operation: "updated",
        conflict_detected: conflictDetected,
        preserved_fields: preservedFields,
        details: { updated_properties: propertiesToUpdate, written_fields: propertiesToUpdate, preserved_fields: preservedFields },
      };
    }

    // 4. Create new contact
    const createRes = await this.request("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: targetProperties }),
    });

    if (!createRes.ok) {
      throw new Error(`HubSpot create contact failed: HTTP ${createRes.status} ${createRes.statusText}`);
    }

    const created = (await createRes.json()) as any;
    return {
      remote_record_id: String(created.id),
      operation: "created",
      conflict_detected: false,
      preserved_fields: [],
      details: { created_id: created.id, written_fields: targetProperties },
    };
  }
}

export const hubspotAdapter = new HubSpotAdapter();
