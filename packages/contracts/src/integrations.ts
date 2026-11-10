/**
 * Workspace Integrations Catalog, Connection Models, and Operation Contracts
 */

export const INTEGRATION_PROVIDERS = [
  "google_calendar",
  "hubspot",
  "salesforce",
  "slack",
  "twilio",
  "zendesk",
  "google_sheets",
  "notion",
  "mailchimp",
  "apify",
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_CATEGORIES = [
  "all",
  "crm_leads",
  "calendar_booking",
  "communication",
  "telephony",
  "productivity",
  "marketing",
] as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export type IntegrationStatus =
  | "not_connected"
  | "connecting"
  | "connected"
  | "needs_reauthorization"
  | "incomplete"
  | "error";

export type ProviderCapabilities = {
  authorizationSupport: "oauth2" | "credentials" | "api_key";
  credentialVerification: boolean;
  accountDiscovery: boolean;
  refreshSupport: boolean;
  revocationSupport: boolean;
  supportedOperations: string[];
  syncDirections: Array<"inbound" | "outbound" | "bidirectional">;
  requiredScopes: string[];
  optionalScopes?: string[];
  rateLimitPerMinute?: number;
};

export type IntegrationCatalogItem = {
  id: IntegrationProvider;
  name: string;
  category: IntegrationCategory;
  categoryLabel: string;
  description: string;
  connectionType: "oauth" | "credentials";
  status: IntegrationStatus;
  connectionId?: string | null;
  accountIdentifier?: string | null;
  accountEmail?: string | null;
  accountName?: string | null;
  grantedScopes?: string[];
  capabilities?: ProviderCapabilities;
  connectedAt?: string | null;
  updatedAt?: string | null;
  lastVerifiedAt?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  requiredScopes?: string[];
  configurationRequired?: boolean;
  configurationHelpUrl?: string;
};

export type IntegrationConnection = {
  id: string;
  workspaceId: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  providerAccountId?: string | null;
  accountIdentifier?: string | null;
  accountEmail?: string | null;
  accountName?: string | null;
  grantedScopes: string[];
  secretReferenceId?: string | null;
  tokenExpiresAt?: string | null;
  lastVerifiedAt?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  revision: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  disconnectedAt?: string | null;
};

export type IntegrationAuthorizeResponse = {
  authorization_url: string;
  state: string;
  provider: IntegrationProvider;
};

export type IntegrationsListResponse = {
  connected_count: number;
  catalog: IntegrationCatalogItem[];
  categories: {
    id: string;
    label: string;
    count: number;
  }[];
};

export type IntegrationSyncRequest = {
  operation: "manual_sync" | "test_connection" | "discover_resources";
  resourceType?: string;
  options?: Record<string, unknown>;
};

export type IntegrationSyncResult = {
  success: boolean;
  provider: IntegrationProvider;
  recordsSynced?: number;
  durationMs: number;
  message?: string;
  resources?: Array<{ id: string; name: string; type: string; metadata?: Record<string, unknown> }>;
  error?: { code: string; message: string };
};

