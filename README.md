# AI Agent Workflow Builder

A mini n8n purpose-built for chaining AI agent steps, built on **nhost + Hasura + PostgreSQL + GraphQL** with a **Next.js** frontend.

## Architecture Overview

```
┌─────────────┐     GraphQL      ┌──────────────┐     SQL      ┌────────────┐
│  Next.js    │ ◄──────────────► │    Hasura    │ ◄──────────► │ PostgreSQL │
│  Frontend   │   subscriptions  │   Engine     │              │            │
└──────┬──────┘                  └──────┬───────┘              └────────────┘
       │                                │
       │ Auth (JWT)                     │ Actions / Event Triggers / Cron
       ▼                                ▼
┌─────────────┐                  ┌──────────────┐
│  nhost Auth │                  │   Functions  │
└─────────────┘                  │  (Node.js)   │
                                 └──────┬───────┘
                                        │
                                        ▼
                                 External APIs
                                 (Groq LLM, HTTP, etc.)
```

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 20+](https://nodejs.org/)
- [nhost CLI](https://docs.nhost.io/platform/cli/installation): `npm install -g nhost`

### 1. Start nhost Backend

```bash
cd nhost
nhost up
```

This starts PostgreSQL, Hasura, Auth, Storage, and Functions locally.

- Hasura Console: https://local.hasura.local.nhost.run
- GraphQL API: https://local.graphql.local.nhost.run
- Auth: https://local.auth.local.nhost.run
- Functions: https://local.functions.local.nhost.run

### 2. Apply Metadata

```bash
cd nhost
nhost hasura metadata apply
```

### 3. Start Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Open http://localhost:3000

### 4. Environment Variables

**nhost functions** (set in nhost dashboard or `.secrets` file):

| Variable | Description | Default |
|----------|-------------|---------|
| `GROQ_API_KEY` | Groq API key for LLM calls | (stub mode if empty) |
| `LLM_STUB_DELAY_MS` | Artificial delay for stubbed LLM | `1500` |
| `NHOST_GRAPHQL_URL` | GraphQL endpoint the functions call back into; Nhost supplies this automatically | `https://local.graphql.local.nhost.run/v1/graphql` |
| `NHOST_ADMIN_SECRET` | Nhost-managed admin secret used for privileged GraphQL calls; do not commit or hardcode it | provided automatically by Nhost |
| `NHOST_FUNCTIONS_URL` | Base URL the scheduled-runner uses to call trigger-workflow-run | `http://localhost:3000` |
| `RESEND_API_KEY` | Optional Resend key for real email notify steps | empty |
| `NOTIFY_FROM_EMAIL` | Verified sender for Resend | empty |
| `SLACK_WEBHOOK_URL` | Optional fallback Slack webhook for notify steps | empty |

**Frontend** (`.env.local`):

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_NHOST_AUTH_URL` | nhost Auth service URL |
| `NEXT_PUBLIC_NHOST_STORAGE_URL` | nhost Storage service URL |
| `NEXT_PUBLIC_NHOST_GRAPHQL_URL` | Hasura GraphQL endpoint |
| `NEXT_PUBLIC_NHOST_FUNCTIONS_URL` | nhost Functions base URL |

The frontend nhost client is configured with these explicit per-service
URLs (not `subdomain`/`region`/`backendUrl`) so it works the same way
against a local `nhost up` stack or a self-hosted/custom-domain deployment.
For nhost Cloud, swap in your project's actual auth/storage/graphql/
functions URLs (found in the nhost dashboard).

### LLM Configuration

The system uses Groq's free tier by default. Get a key at https://console.groq.com/

```bash
# In nhost/.secrets or via nhost dashboard
GROQ_API_KEY=gsk_your_key_here
```

Without an API key, LLM steps use a **stubbed response** with a 1.5s artificial delay (disclosed in UI).

## Demo Scenario Setup

For the Final Task walkthrough, create these accounts via the signup page:

| Email | Password | Organization | Role |
|-------|----------|-------------|------|
| owner-a@demo.com | demo1234 | Org Alpha | owner |
| editor-a@demo.com | demo1234 | Org Alpha | editor |
| owner-b@demo.com | demo1234 | Org Beta | owner |
| editor-b@demo.com | demo1234 | Org Beta | editor |

After signup, run the demo seed script to set up orgs and memberships:

```bash
# Connect to local postgres
psql postgresql://postgres:postgres@localhost:5432/local -f scripts/demo-setup.sql
```

Then update the user IDs in `scripts/demo-setup.sql` with actual nhost auth user IDs from the Hasura console (`auth.users` table).

(The in-app "Create Organization" button on the dashboard also works now via
the `createOrganization` action — the SQL seed script above is just the
faster path to get the exact two-org demo scenario the Final Task expects.)

### Demo Workflow (Org Alpha)

Build a workflow with these steps:

1. **LLM Call** — "Analyze this request and respond with APPROVE or REJECT"
2. **Conditional Branch** — if response contains "APPROVE", continue; else skip
3. **HTTP Request** — GET https://httpbin.org/get
4. **Approval Gate** — "Review LLM analysis before proceeding"
5. **Notify** — Send a real Slack/email notification through the Hasura Event Trigger

Add triggers:
- **Webhook** (owner only) — for external triggering
- **Database Event** — fires on `record_created` events

### Running the Final Task

1. Sign in as `owner-a@demo.com`
2. Create/edit the demo workflow above
3. Click **Run** — watch live step progress via subscription
4. When the approval gate pauses, click **Approve & Continue**
5. Click **Fire DB Event** to trigger via database event
6. Sign out, sign in as `editor-b@demo.com` (Org Beta)
7. Verify: cannot see Org Alpha workflows, cannot trigger, cannot approve — despite having the same editor role in Org Beta

## Final Task Demo

See [`DEMO_RUNBOOK.md`](./DEMO_RUNBOOK.md) for the exact live walkthrough and the stronger cross-organization proof using an **editor in Org B**. The submission checklist is in [`SUBMISSION_CHECKLIST.md`](./SUBMISSION_CHECKLIST.md).

## Project Structure

```
ai-workflow-builder/
├── nhost/
│   ├── migrations/          # PostgreSQL schema migrations
│   ├── metadata/            # Hasura metadata (permissions, actions, triggers)
│   ├── functions/
│   │   ├── _shared/engine.ts      # Shared step-execution engine (single
│   │   │                          # source of truth — both functions below
│   │   │                          # import runWorkflow() from here so a
│   │   │                          # resumed run can never race a fresh one)
│   │   ├── trigger-workflow-run/  # Main workflow executor (manual,
│   │   │                          # webhook, database_event, scheduled)
│   │   ├── approve-step/          # Approval gate handler — resumes via
│   │   │                          # the shared engine, doesn't re-implement it
│   │   ├── scheduled-runner/      # Cron trigger processor
│   │   ├── notify-handler/       # Hasura Event Trigger delivery handler (Slack/email)
│   │   └── create-organization/   # Bootstraps an org + its owner
│   │                              # membership atomically (admin-side, to
│   │                              # sidestep the org_members chicken-and-egg)
│   └── nhost.toml
├── frontend/
│   └── src/
│       ├── app/               # Next.js pages
│       ├── components/        # UI components
│       └── lib/               # GraphQL queries, nhost client, hooks
├── scripts/
│   └── demo-setup.sql         # Demo data seeding
├── ARCHITECTURE.md            # Design write-up
└── README.md
```

## GraphQL Operations

| Operation | Type | Description |
|-----------|------|-------------|
| `createOrganization` | Action | Bootstrap a new org + owner membership atomically |
| `GetOrgWorkflows` | Query | Org workflows with steps, triggers, latest run |
| `CreateWorkflow` + `UpsertSteps/Triggers` | Mutation | Create/edit workflow |
| `triggerWorkflowRun` | Action | Start a workflow run |
| `approveStep` | Action | Approve paused approval_gate step |
| `SubscribeStepRuns` | Subscription | Live step-by-step progress |

## Deployment

### nhost Cloud

```bash
nhost login
nhost init  # link to cloud project
nhost deploy
```

### Frontend (Vercel)

From the `frontend` directory, deploy the Next.js app using Vercel or another Next.js-compatible host. Before the first production run, configure:

```text
NEXT_PUBLIC_NHOST_AUTH_URL
NEXT_PUBLIC_NHOST_STORAGE_URL
NEXT_PUBLIC_NHOST_GRAPHQL_URL
NEXT_PUBLIC_NHOST_FUNCTIONS_URL
NEXT_PUBLIC_NHOST_BACKEND_URL
```

Use the production URLs shown by the Nhost project. Then add the deployed frontend origin to Hasura's CORS configuration. Open the production URL in a clean browser and verify authentication, GraphQL queries, Actions, and subscriptions before submitting.

For a reviewer-ready submission, provide the deployed URL and a short recording of the Final Task scenario. See `DEMO_RUNBOOK.md` and `SUBMISSION_CHECKLIST.md`.

## License

MIT
