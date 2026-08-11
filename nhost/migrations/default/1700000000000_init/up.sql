-- AI Agent Workflow Builder Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Organizations with usage quota
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  quota_limit INTEGER NOT NULL DEFAULT 100,
  quota_used INTEGER NOT NULL DEFAULT 0,
  quota_in_flight INTEGER NOT NULL DEFAULT 0,
  quota_period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Org membership with roles
CREATE TYPE org_role AS ENUM ('owner', 'editor', 'viewer');

CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role org_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_org ON org_members(org_id);

-- Workflows
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflows_org ON workflows(org_id);

-- Step types enum
CREATE TYPE step_type AS ENUM (
  'llm_call',
  'http_request',
  'db_write',
  'notify',
  'conditional_branch',
  'approval_gate'
);

CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  step_type step_type NOT NULL,
  position INTEGER NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_id, position)
);

CREATE INDEX idx_workflow_steps_workflow ON workflow_steps(workflow_id);

-- Trigger types enum
CREATE TYPE trigger_type AS ENUM ('manual', 'webhook', 'scheduled', 'database_event');

CREATE TABLE workflow_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_type trigger_type NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_triggers_workflow ON workflow_triggers(workflow_id);

-- Run statuses
CREATE TYPE run_status AS ENUM ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled');
CREATE TYPE step_run_status AS ENUM ('pending', 'running', 'paused', 'completed', 'failed', 'skipped');

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status run_status NOT NULL DEFAULT 'pending',
  triggered_by UUID,
  trigger_type trigger_type NOT NULL DEFAULT 'manual',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  context JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_org ON workflow_runs(org_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);

CREATE TABLE step_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_step_id UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  status step_run_status NOT NULL DEFAULT 'pending',
  input JSONB,
  output JSONB,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_step_runs_workflow_run ON step_runs(workflow_run_id);
CREATE INDEX idx_step_runs_step ON step_runs(workflow_step_id);

-- Watched table for database event triggers
CREATE TABLE workflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_events_org ON workflow_events(org_id);
CREATE INDEX idx_workflow_events_processed ON workflow_events(processed);

-- Table for db_write step results
CREATE TABLE workflow_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_results_org ON workflow_results(org_id);

-- Notification log for notify steps
CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  message TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Aggregation view: org usage this month + average run duration
CREATE OR REPLACE VIEW org_usage_stats AS
SELECT
  o.id AS org_id,
  o.name AS org_name,
  o.quota_used,
  o.quota_limit,
  o.quota_period_start,
  CASE WHEN o.quota_limit > 0
    THEN ROUND((o.quota_used::NUMERIC / o.quota_limit) * 100, 2)
    ELSE 0
  END AS quota_usage_percent,
  COALESCE(
    (SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))
     FROM workflow_runs wr
     WHERE wr.org_id = o.id
       AND wr.status = 'completed'
       AND wr.completed_at >= date_trunc('month', NOW())),
    0
  ) AS avg_run_duration_seconds,
  (SELECT COUNT(*) FROM workflow_runs wr
   WHERE wr.org_id = o.id
     AND wr.created_at >= date_trunc('month', NOW())) AS runs_this_month
FROM organizations o;

-- Helper function to check org membership role
CREATE OR REPLACE FUNCTION get_user_org_role(p_user_id UUID, p_org_id UUID)
RETURNS org_role AS $$
  SELECT role FROM org_members
  WHERE user_id = p_user_id AND org_id = p_org_id
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Atomic quota reservation/finalization helpers. A run reserves a slot
-- before execution; only completed runs increment quota_used. Failed runs
-- release the reservation. Row-level locking makes concurrent starts safe.
CREATE OR REPLACE FUNCTION reserve_org_quota(p_org_id UUID)
RETURNS TABLE(org_id UUID, quota_used INTEGER, quota_in_flight INTEGER, quota_limit INTEGER)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE organizations
  SET quota_in_flight = quota_in_flight + 1, updated_at = NOW()
  WHERE id = p_org_id
    AND quota_used + quota_in_flight < quota_limit
  RETURNING id, organizations.quota_used, organizations.quota_in_flight, organizations.quota_limit;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_org_quota(p_org_id UUID)
RETURNS TABLE(org_id UUID, quota_used INTEGER, quota_in_flight INTEGER)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE organizations
  SET quota_in_flight = GREATEST(quota_in_flight - 1, 0),
      quota_used = quota_used + 1,
      updated_at = NOW()
  WHERE id = p_org_id
  RETURNING id, organizations.quota_used, organizations.quota_in_flight;
END;
$$;

CREATE OR REPLACE FUNCTION release_org_quota(p_org_id UUID)
RETURNS TABLE(org_id UUID, quota_used INTEGER, quota_in_flight INTEGER)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE organizations
  SET quota_in_flight = GREATEST(quota_in_flight - 1, 0), updated_at = NOW()
  WHERE id = p_org_id
  RETURNING id, organizations.quota_used, organizations.quota_in_flight;
END;
$$;

-- Reset quota at period start (called by scheduled function)
CREATE OR REPLACE FUNCTION reset_org_quotas_if_needed()
RETURNS void AS $$
BEGIN
  UPDATE organizations
  SET quota_used = 0,
      quota_period_start = date_trunc('month', NOW()),
      updated_at = NOW()
  WHERE quota_period_start < date_trunc('month', NOW());
END;
$$ LANGUAGE plpgsql;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workflows_updated_at BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workflow_steps_updated_at BEFORE UPDATE ON workflow_steps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
