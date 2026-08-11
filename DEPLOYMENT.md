# Production Deployment Guide

This repository is prepared for a split deployment:

- **Backend:** Nhost Cloud (Postgres + Hasura + Auth + Storage + Functions)
- **Frontend:** Vercel / any Next.js 14 host

## Nhost

1. Create a new Nhost project.
2. Link this repository/project with the Nhost CLI.
3. Deploy migrations and metadata.
4. Configure the custom function secrets from `nhost/functions/.env.example`. Nhost automatically provides system variables such as `NHOST_GRAPHQL_URL`, `NHOST_FUNCTIONS_URL`, and `NHOST_ADMIN_SECRET`.
5. Set a real `GROQ_API_KEY`, or explicitly leave it empty to use the disclosed stub mode.
6. Verify the Action endpoints from the Nhost dashboard.
7. Verify both Hasura Event Triggers (`workflow_events` and `notification_log`) and both cron triggers are enabled.
8. Add the final frontend origin to Hasura CORS.

## Vercel

Deploy the `frontend` directory as a Next.js project.

Set these production environment variables:

```text
NEXT_PUBLIC_NHOST_AUTH_URL=<production auth URL>
NEXT_PUBLIC_NHOST_STORAGE_URL=<production storage URL>
NEXT_PUBLIC_NHOST_GRAPHQL_URL=<production GraphQL URL>
NEXT_PUBLIC_NHOST_FUNCTIONS_URL=<production functions URL>
NEXT_PUBLIC_NHOST_BACKEND_URL=<production backend URL>
```

Never place `NHOST_ADMIN_SECRET` or a Groq key in `NEXT_PUBLIC_*` variables.

## Smoke test

After deployment:

1. Sign up/log in.
2. Create an organization.
3. Build a workflow.
4. Run it manually.
5. Confirm live subscription updates.
6. Confirm approval pause/resume.
7. Trigger through the configured non-manual trigger.
8. Test an Org B editor against an Org A workflow ID.
9. Test the notify Event Trigger with a disposable Slack webhook or Resend recipient.
10. Record the successful Final Task scenario.
# Deployment trigger
