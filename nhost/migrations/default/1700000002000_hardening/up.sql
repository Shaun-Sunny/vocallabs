ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS quota_in_flight INTEGER NOT NULL DEFAULT 0;

ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';

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
      quota_used = quota_used + 1, updated_at = NOW()
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
