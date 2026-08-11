-- Seed data for demo scenario (Org A and Org B)
-- User IDs are placeholders; replace with actual nhost auth user IDs after signup

INSERT INTO organizations (id, name, quota_limit, quota_used) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org Alpha', 50, 0),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Org Beta', 50, 0);

-- Note: org_members will be populated via the frontend onboarding flow
-- or manually after users sign up. See README for demo user setup.
