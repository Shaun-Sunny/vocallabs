-- Demo setup script for Final Task scenario
-- Run AFTER creating user accounts via the signup page
-- Replace the placeholder user IDs with actual IDs from auth.users

-- Organizations (already seeded by migration, but ensure they exist)
INSERT INTO organizations (id, name, quota_limit, quota_used)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org Alpha', 50, 0),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Org Beta', 50, 0)
ON CONFLICT (id) DO NOTHING;

-- IMPORTANT: Replace these UUIDs with actual nhost auth user IDs
-- Find them in Hasura Console → Data → auth → users
--
-- Example:
-- SELECT id, email FROM auth.users;

-- Org Alpha members
-- INSERT INTO org_members (org_id, user_id, role) VALUES
--   ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '<owner-a-user-id>', 'owner'),
--   ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '<editor-a-user-id>', 'editor');

-- Org Beta members
-- Use an editor here so the cross-org test proves tenant isolation rather than
-- merely proving that a viewer cannot trigger/approve.
-- INSERT INTO org_members (org_id, user_id, role) VALUES
--   ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '<owner-b-user-id>', 'owner'),
--   ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '<editor-b-user-id>', 'editor');

-- Demo workflow for Org Alpha (run after owner-a is set up)
-- INSERT INTO workflows (id, org_id, name, description, created_by) VALUES
--   ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
--    'Content Review Pipeline', 'LLM analysis → conditional → HTTP → approval → notify',
--    '<owner-a-user-id>');

-- Demo steps
-- INSERT INTO workflow_steps (workflow_id, name, step_type, position, config) VALUES
--   ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'LLM Analysis', 'llm_call', 0,
--    '{"prompt": "Analyze this content and respond with APPROVE or REJECT: {{input}}", "system_prompt": "You are a content reviewer."}'),
--   ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Check Approval', 'conditional_branch', 1,
--    '{"condition": "contains", "field": "response", "value": "APPROVE"}'),
--   ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Fetch Reference', 'http_request', 2,
--    '{"url": "https://httpbin.org/get", "method": "GET"}'),
--   ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Manager Approval', 'approval_gate', 3,
--    '{"message": "Review the LLM analysis and HTTP response before proceeding."}'),
--   ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Send Notification', 'notify', 4,
--    '{"channel": "slack", "message": "Content review pipeline completed successfully.", "webhook_url": ""}');

-- Demo triggers
-- INSERT INTO workflow_triggers (workflow_id, trigger_type, config) VALUES
--   ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'webhook',
--    '{"secret": "demo-webhook-secret-123"}'),
--   ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'database_event',
--    '{"event_type": "record_created"}');

SELECT 'Demo setup template ready. Use owner/editor accounts in BOTH organizations, replace all user-ID placeholders, then uncomment the membership/workflow/trigger blocks.' AS status;
