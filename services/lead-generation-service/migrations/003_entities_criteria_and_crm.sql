-- Additive Migration 003: Entity Types (Business, Professional, Consumer), Criteria, Observations, Sales Status, Schedules & CRM Mappings

-- 1. Extend lg_leads with entity_type, sales metadata, notes, activity history, and optional domain for consumers
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'business';
ALTER TABLE lg_leads ALTER COLUMN domain DROP NOT NULL;
ALTER TABLE lg_candidates ALTER COLUMN domain DROP NOT NULL;
ALTER TABLE lg_candidates ALTER COLUMN url DROP NOT NULL;
ALTER TABLE lg_candidates ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES lg_leads(id) ON DELETE SET NULL;

ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS sales_status text NOT NULL DEFAULT 'new';
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS user_edits jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS activity_history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS refresh_history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS contact_points jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lg_leads ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Consumer unique index: unique by workspace and email when domain is null/empty
CREATE UNIQUE INDEX IF NOT EXISTS lg_leads_workspace_consumer_email_unique
  ON lg_leads(workspace_id, lower(contact_email), execution_mode)
  WHERE (domain IS NULL OR domain = '') AND contact_email IS NOT NULL;

-- 2. Extend lg_profiles with name and versioned identification
ALTER TABLE lg_profiles ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Default Profile';
ALTER TABLE lg_profiles ADD COLUMN IF NOT EXISTS target_audience text;
ALTER TABLE lg_profiles ADD COLUMN IF NOT EXISTS value_proposition text;

-- 3. Extend lg_runs with entity_type, criteria, assumptions, and source policy
ALTER TABLE lg_runs ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'business';
ALTER TABLE lg_runs ADD COLUMN IF NOT EXISTS criteria jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lg_runs ADD COLUMN IF NOT EXISTS confirmed_assumptions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lg_runs ADD COLUMN IF NOT EXISTS budget_limits jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE lg_runs ADD COLUMN IF NOT EXISTS source_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 4. Granular Observations / Evidence Lineage
CREATE TABLE IF NOT EXISTS lg_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES lg_tenants(org_id),
  workspace_id uuid NOT NULL,
  lead_id uuid REFERENCES lg_leads(id) ON DELETE CASCADE,
  field text NOT NULL,
  value text NOT NULL,
  quote text,
  source_url text,
  provider text,
  external_record_id text,
  confidence double precision,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lg_observations_lead ON lg_observations(lead_id, field);
CREATE INDEX IF NOT EXISTS lg_observations_workspace ON lg_observations(workspace_id, observed_at DESC);

-- 5. Database-Coordinated Scheduled Searches with Unique Occurrence Keys
CREATE TABLE IF NOT EXISTS lg_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES lg_tenants(org_id),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  brief jsonb NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  cron_expression text NOT NULL,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  enabled boolean NOT NULL DEFAULT true,
  overlap_policy text NOT NULL DEFAULT 'skip' CHECK(overlap_policy IN ('skip', 'allow', 'queue')),
  budget_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  destination_config jsonb,
  last_occurrence_key text,
  last_run_id uuid REFERENCES lg_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lg_schedules_claim ON lg_schedules(enabled, next_run_at) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS lg_schedules_workspace ON lg_schedules(workspace_id, name);

-- 6. Optional CRM Entity Mappings & Deliveries
CREATE TABLE IF NOT EXISTS lg_crm_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES lg_tenants(org_id),
  workspace_id uuid NOT NULL,
  provider text NOT NULL,
  lead_id uuid NOT NULL REFERENCES lg_leads(id) ON DELETE CASCADE,
  external_object_id text NOT NULL,
  external_object_type text NOT NULL,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  last_synced_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_ownership jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'synced',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, provider, lead_id)
);

CREATE INDEX IF NOT EXISTS lg_crm_mappings_external ON lg_crm_mappings(workspace_id, provider, external_object_id);

CREATE TABLE IF NOT EXISTS lg_crm_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES lg_tenants(org_id),
  workspace_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES lg_leads(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'uncertain')),
  attempts integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS lg_crm_deliveries_pending ON lg_crm_deliveries(status, created_at) WHERE status IN ('pending', 'running');
