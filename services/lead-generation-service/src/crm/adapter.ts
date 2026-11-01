import type { CrmMapping, LeadRecord } from "@quickstart/contracts";

export interface CrmPushResult {
  remote_record_id: string;
  operation: "created" | "updated" | "skipped";
  remote_version?: string;
  conflict_detected?: boolean;
  preserved_fields?: string[];
  details?: Record<string, unknown>;
}

export interface CrmDestinationAdapter {
  readonly name: string;
  testConnection(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  pushLead(
    lead: LeadRecord | any,
    credentials: Record<string, unknown>,
    existingMapping?: CrmMapping | null,
    options?: { preserveConflicts?: boolean },
  ): Promise<CrmPushResult>;
}
