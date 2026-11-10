import type { CrmMapping, LeadRecord } from "@quickstart/contracts";
import type { CrmDestinationAdapter, CrmPushResult } from "./adapter.js";

export class SalesforceAdapter implements CrmDestinationAdapter {
  readonly name = "salesforce";

  private request(url: string, init: RequestInit = {}): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(15000), redirect: "error" });
  }


  private getCredentials(credentials: Record<string, unknown>): { instanceUrl: string; token: string } {
    const instanceUrl = (credentials.instanceUrl as string) || (credentials.instance_url as string);
    const token =
      (credentials.accessToken as string) ||
      (credentials.token as string) ||
      (credentials.access_token as string);

    if (!instanceUrl || typeof instanceUrl !== "string" || !instanceUrl.startsWith("http")) {
      throw new Error("SALESFORCE_CONFIG_ERROR: Valid Salesforce instance URL must be provided.");
    }
    if (!token || typeof token !== "string" || token.length < 10) {
      throw new Error("SALESFORCE_AUTHENTICATION_REQUIRED: Valid Salesforce access token must be provided.");
    }
    const parsed = new URL(instanceUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port
      || !parsed.hostname.endsWith(".salesforce.com") || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("SALESFORCE_CONFIG_ERROR: HTTPS Salesforce instance origin required.");
    }
    return { instanceUrl: parsed.origin, token };
  }

  async testConnection(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    try {
      const { instanceUrl, token } = this.getCredentials(credentials);
      const res = await this.request(`${instanceUrl}/services/data/v58.0/sobjects/Lead/describe`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (res.ok) {
        return { ok: true, message: "Salesforce connection verified." };
      }
      return { ok: false, message: `Salesforce returned HTTP ${res.status}: ${res.statusText}` };
    } catch (err: any) {
      return { ok: false, message: err?.message || "Failed to connect to Salesforce." };
    }
  }

  async pushLead(
    lead: LeadRecord | any,
    credentials: Record<string, unknown>,
    existingMapping?: CrmMapping | null,
    options: { preserveConflicts?: boolean } = { preserveConflicts: true },
  ): Promise<CrmPushResult> {
    const { instanceUrl, token } = this.getCredentials(credentials);
    const data = lead.data || lead;

    const email = lead.email || lead.contact_email || data.email || null;
    const phone = lead.phone || lead.contact_phone || data.phone || null;
    const company = data.company_name || data.company || null;
    if ((lead.entity_type ?? data.entity_type) === "consumer" || !company) {
      throw new Error("SALESFORCE_MAPPING_REQUIRED: Consumer/no-employer records need a configured person mapping; employer will not be invented.");
    }
    const website = lead.domain || data.website || null;
    const personName = lead.person_name || data.person_name || null;

    if (!personName || typeof personName !== "string" || !personName.trim()) {
      throw new Error("SALESFORCE_MAPPING_REQUIRED: A real person name is required for this Lead mapping.");
    }
    const parts = personName.trim().split(/\s+/);
    const firstName = parts.length > 1 ? parts[0] : "";
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];

    const targetFields: Record<string, string> = {
      FirstName: firstName,
      LastName: lastName,
      Company: company,
      ...(email ? { Email: email } : {}),
      ...(phone ? { Phone: phone } : {}),
      ...(website ? { Website: website } : {}),
    };

    let remoteLeadId: string | null = existingMapping?.external_object_id || null;
    let remoteRecord: Record<string, string> = {};

    // 1. If mapping exists, retrieve remote record to detect conflicts
    if (remoteLeadId) {
      {
        const getRes = await this.request(
          `${instanceUrl}/services/data/v58.0/sobjects/Lead/${encodeURIComponent(remoteLeadId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );
        if (getRes.ok) {
          remoteRecord = (await getRes.json()) as any;
        } else if (getRes.status === 404) {
          remoteLeadId = null;
        } else {
          throw new Error(`Salesforce read failed: HTTP ${getRes.status}; update cancelled`);
        }
      }
    }

    // 2. If no mapping, search by email to prevent duplicate leads
    if (!remoteLeadId && email) {
      {
        const query = encodeURIComponent(
          `SELECT Id, FirstName, LastName, Company, Email, Phone, Website, Status FROM Lead WHERE Email = '${email.replace(/'/g, "\\'")}' LIMIT 1`,
        );
        const searchRes = await this.request(`${instanceUrl}/services/data/v58.0/query?q=${query}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        if (searchRes.ok) {
          const searchBody = (await searchRes.json()) as any;
          if (searchBody.records?.[0]?.Id) {
            remoteLeadId = searchBody.records[0].Id;
            remoteRecord = searchBody.records[0];
          }
        } else {
          throw new Error(`Salesforce search failed: HTTP ${searchRes.status}; create cancelled`);
        }
      }
    }

    // 3. Update existing lead with conflict preservation
    if (remoteLeadId) {
      const preservedFields: string[] = [];
      let conflictDetected = false;
      const fieldsToUpdate: Record<string, string> = { ...targetFields };

      const priorFields = (existingMapping?.last_synced_payload?.fields ?? {}) as Record<string, unknown>;
      if (options.preserveConflicts !== false) {
        for (const [key, remoteVal] of Object.entries(remoteRecord)) {
          if (
            remoteVal &&
            targetFields[key] &&
            String(remoteVal) !== targetFields[key] &&
            String(remoteVal) !== priorFields[key]
          ) {
            conflictDetected = true;
            preservedFields.push(key);
            // Preserve the remote representative edit
            delete fieldsToUpdate[key];
          }
        }
      }

      const patchRes = await this.request(
        `${instanceUrl}/services/data/v58.0/sobjects/Lead/${encodeURIComponent(remoteLeadId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(fieldsToUpdate),
        },
      );

      if (!patchRes.ok && patchRes.status !== 204) {
        throw new Error(`Salesforce update lead failed: HTTP ${patchRes.status} ${patchRes.statusText}`);
      }

      return {
        remote_record_id: remoteLeadId,
        operation: "updated",
        conflict_detected: conflictDetected,
        preserved_fields: preservedFields,
        details: { updated_fields: fieldsToUpdate, written_fields: fieldsToUpdate, preserved_fields: preservedFields },
      };
    }

    // 4. Create new Salesforce Lead
    const createRes = await this.request(`${instanceUrl}/services/data/v58.0/sobjects/Lead`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(targetFields),
    });

    if (!createRes.ok) {
      throw new Error(`Salesforce create lead failed: HTTP ${createRes.status} ${createRes.statusText}`);
    }

    const created = (await createRes.json()) as any;
    return {
      remote_record_id: String(created.id),
      operation: "created",
      conflict_detected: false,
      preserved_fields: [],
      details: { id: created.id, written_fields: targetFields },
    };
  }
}

export const salesforceAdapter = new SalesforceAdapter();
