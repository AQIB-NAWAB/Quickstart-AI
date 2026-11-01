CREATE TABLE IF NOT EXISTS lg_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES lg_tenants(org_id),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  qualification_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS lg_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES lg_tenants(org_id),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  source_type text NOT NULL CHECK(source_type IN ('generic_json','apify','custom_scraper','automation_webhook')),
  description text,
  token_prefix text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','revoked')),
  collection_id uuid REFERENCES lg_collections(id) ON DELETE SET NULL,
  default_qualification_mode text NOT NULL DEFAULT 'strict' CHECK(default_qualification_mode IN ('strict','best_match')),
  field_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  enrichment_enabled boolean NOT NULL DEFAULT false,
  auto_enroll_campaign_id uuid,
  rate_limit_per_minute integer NOT NULL DEFAULT 60,
  batch_size_limit integer NOT NULL DEFAULT 100,
  payload_size_limit_bytes integer NOT NULL DEFAULT 524288,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS lg_inbound_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES lg_tenants(org_id),
  workspace_id uuid NOT NULL,
  connector_id uuid NOT NULL REFERENCES lg_connectors(id) ON DELETE CASCADE,
  collection_id uuid REFERENCES lg_collections(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  records_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, connector_id, idempotency_key)
);

-- Backward-compatible columns on existing tables
ALTER TABLE lg_profiles ADD COLUMN IF NOT EXISTS confirmed_facts jsonb;
ALTER TABLE lg_profiles ADD COLUMN IF NOT EXISTS inferences jsonb;

ALTER TABLE lg_runs ADD COLUMN IF NOT EXISTS qualification_mode text NOT NULL DEFAULT 'strict';
ALTER TABLE lg_runs ADD COLUMN IF NOT EXISTS priorities jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lg_runs ADD COLUMN IF NOT EXISTS shortfall_explanation jsonb;
ALTER TABLE lg_runs ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES lg_collections(id) ON DELETE SET NULL;

ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS person_name text;
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS person_role text;
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS qualification_mode text NOT NULL DEFAULT 'strict';
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES lg_collections(id) ON DELETE SET NULL;
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS inbound_connector_id uuid REFERENCES lg_connectors(id) ON DELETE SET NULL;

-- Allow multiple decision-makers at the same domain without destructive merging
ALTER TABLE lg_leads DROP CONSTRAINT IF EXISTS lg_leads_workspace_id_domain_execution_mode_key;
CREATE UNIQUE INDEX IF NOT EXISTS lg_leads_workspace_domain_company_unique ON lg_leads(workspace_id, domain, execution_mode) WHERE person_name IS NULL AND contact_email IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lg_leads_workspace_email_unique ON lg_leads(workspace_id, domain, lower(contact_email), execution_mode) WHERE contact_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS lg_connectors_workspace ON lg_connectors(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lg_collections_workspace ON lg_collections(workspace_id, name);
CREATE INDEX IF NOT EXISTS lg_inbound_batches_connector ON lg_inbound_batches(connector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lg_leads_workspace_domain_email ON lg_leads(workspace_id, domain, lower(contact_email)) WHERE contact_email IS NOT NULL;
