DROP FUNCTION IF EXISTS release_org_quota(UUID);
DROP FUNCTION IF EXISTS finalize_org_quota(UUID);
DROP FUNCTION IF EXISTS reserve_org_quota(UUID);
ALTER TABLE notification_log DROP COLUMN IF EXISTS config;
ALTER TABLE organizations DROP COLUMN IF EXISTS quota_in_flight;
