# Architecture Write-Up

## Schema Reasoning

The data model follows a strict hierarchy: **Organization → Members → Workflows → Steps/Triggers → Runs → Step Runs**. This mirrors how real multi-tenant SaaS products isolate data.

### Core Tables

| Table | Purpose | Key Design Choice |
|-------|---------|-------------------|
| `organizations` | Tenant boundary with quota tracking | `quota_used`/`quota_limit` on the org itself, not per-user, because billing is org-level |
| `org_members` | User-to-org mapping with roles | Composite unique on `(org_id, user_id)` prevents duplicate memberships |
| `workflows` | Workflow definitions scoped to org | `org_id` FK ensures every workflow belongs to exactly one org |
| `workflow_steps` | Ordered steps with JSONB config | JSONB for config allows each step type to have different fields without schema changes |
| `workflow_triggers` | Multiple trigger types per workflow | Separate table (not embedded in workflow) because a workflow can have manual + webhook + scheduled simultaneously |
| `workflow_runs` | Execution instances with `paused` status | `context` JSONB carries inter-step data; `paused` is a first-class run status |
| `step_runs` | Per-step execution records | `approved_by`/`approved_at` only populated for approval_gate steps |

### Aggregation

The `org_usage_stats` Postgres view computes:
- **Quota usage percentage** — used/limit ratio for the UI indicator
- **Average run duration** — completed runs this month, for operational insight
- **Runs this month** — count for the dashboard

This is exposed as a Hasura-tracked view with org-scoped permissions, so the frontend gets it via a simple GraphQL query without client-side computation.

### Supporting Tables

- `workflow_events` — watched table for database event triggers; inserting a row fires the Hasura event trigger
- `workflow_results` — target for `db_write` steps
- `notification_log` — target for `notify` steps; a Hasura Event Trigger invokes `notify-handler`, which sends to Slack or Resend email

## Two Permission Layers

The assignment requires two *separate* permission mechanisms, not one role check reused everywhere.

### Layer 1: Org + Role Scoping (Hasura Row Permissions)

Every table's select/insert/update/delete permissions filter through `org_members`:

```yaml
filter:
  organization:
    org_members:
      user_id:
        _eq: X-Hasura-User-Id
```

This means:
- An editor in Org A **never sees** Org B's workflows, even with the same role name
- Viewers can read but not insert/update/delete (no insert permission on workflows)
- Only owners can delete workflows or manage org members
- Direct ID guessing is blocked: querying `workflows_by_pk(id: "org-b-workflow-id")` returns `null` because the row filter excludes it

Role capabilities:

| Action | Owner | Editor | Viewer |
|--------|-------|--------|--------|
| View workflows | ✓ | ✓ | ✓ |
| Create/edit workflows | ✓ | ✓ | ✗ |
| Delete workflows | ✓ | ✗ | ✗ |
| Trigger runs | ✓ | ✓ | ✗ |
| Manage members | ✓ | ✗ | ✗ |

### Layer 2: Step-Level Gating (Action Handler + Row-Level Checks)

Some step types reach outside the sandbox and need tighter control than an org/role check alone provides:

| Restricted Step/Trigger | Who Can Add | Where Enforced |
|------------------------|-------------|----------------|
| `db_write` step | Owner only | `workflow_steps` insert/update permission (row check on `step_type`) + `trigger-workflow-run` at run time |
| `notify` step | Owner only | `workflow_steps` insert/update permission (row check on `step_type`) + `trigger-workflow-run` at run time |
| `webhook` trigger | Owner only | `workflow_triggers` insert/update permission (row check on `trigger_type`) + Frontend UI |
| `database_event` trigger | Owner only | `workflow_triggers` insert/update permission (row check on `trigger_type`) + Frontend UI |
| Approval gate clearance | Owner/Editor in same org | `approve-step` function (only) |

**Why two enforcement points for steps/triggers, but only one for approval gates?**

1. **Step/trigger type restrictions turned out to be expressible as a row permission after all** — Hasura's `check`/`filter` expressions can reference columns on the row being written, not just session variables. So `workflow_steps` insert/update permissions include `_or: [{step_type: {_nin: [db_write, notify]}}, {<caller is owner>}]`, which rejects an editor's attempt to insert or retype a step into `db_write`/`notify` at the database layer itself — the request never reaches an Action. The `trigger-workflow-run` check (`validateStepPermissions`) is kept as a second layer so a workflow can't become runnable-by-a-non-owner even if it somehow ended up holding an owner-only step (e.g. an org member's role was downgraded after the step was created).

2. **Approval gate clearance is a genuinely different kind of decision** — it's not "can this row be written" but "should this *in-progress execution* be allowed to continue," decided at the moment of approval. The approver's role has to be checked *then*, not when the row was created, because it could have changed since the run paused. A static Hasura permission has no notion of "the parent run is currently paused" combined with "resume execution" as a side effect — that only makes sense as code in the Action handler.

The Action handlers implement their part of Layer 2:

```typescript
// In trigger-workflow-run (defense in depth, on top of the DB-level check):
const role = await getUserRole(userId, workflow.org_id);
if (!role || role === 'viewer') return 403;

const stepError = validateStepPermissions(steps, role);
if (stepError) return 403;

// In approve-step (the only enforcement point for this one):
const role = await getUserRole(userId, orgId);
if (!role || role === 'viewer') return 403;
// Then approve and resume execution via the shared engine
```

## Approval Gate Pause/Resume

The approval gate is the most complex interaction because it spans database state, Action handlers, and live subscriptions.

### Flow

```
Step N-1 completes
       │
       ▼
Step N (approval_gate) starts
       │
       ├── step_run.status = 'paused'
       ├── workflow_run.status = 'paused'
       └── Function returns (stops execution loop)
       
       ... user sees "Awaiting Approval" via subscription ...
       
User clicks "Approve" → approveStep Action
       │
       ├── Verify approver role (Layer 2)
       ├── step_run.status = 'completed'
       ├── step_run.approved_by = userId
       ├── workflow_run.status = 'running'
       └── Resume execution from step N+1
       
Step N+1, N+2, ... execute normally
       │
       └── workflow_run.status = 'completed', quota_used += 1
```

### Why the run stops

The workflow executor (`runWorkflow`) is a synchronous loop over steps. When it hits an `approval_gate`:

1. It sets the step_run to `paused` and the workflow_run to `paused`
2. It **returns immediately** — no further steps execute
3. The subscription picks up the status change in real-time

### Resume mechanism

The `approveStep` Action:
1. Validates the approver (Layer 2)
2. Marks the approval_gate step_run as `completed`
3. Sets workflow_run back to `running`
4. Calls `resumeWorkflow()` starting from the next step index

Both the approve-step function and trigger-workflow-run share the same step execution logic, ensuring consistent behavior whether starting fresh or resuming.

### Subscription behavior

The frontend subscribes to two channels simultaneously:
- `step_runs(where: {workflow_run_id})` — per-step status changes
- `workflow_runs_by_pk(id)` — overall run status

When the run pauses, the subscription immediately shows the approval_gate step with status `paused` and the run with status `paused`. No page refresh needed.

## Trigger Types

| Trigger | Mechanism | Implementation |
|---------|-----------|---------------|
| Manual | Frontend button → `triggerWorkflowRun` Action | User JWT forwarded; role checked in handler |
| Webhook | `webhookTrigger` Action with secret validation | Secret stored in trigger config; no user JWT required |
| Scheduled | Hasura cron trigger → `scheduled-runner` function | Matches cron expressions against active triggers every minute |
| Database Event | Hasura event trigger on `workflow_events` INSERT | Finds matching triggers by org_id + event_type |

## Retry and Quota

- **Retry**: `executeWithRetry()` wraps external calls (LLM, HTTP) with 2 attempts and exponential backoff
- **Quota**: Checked before run creation; incremented on successful completion (not on failure or pause)
- **Quota reset**: Monthly cron trigger calls `reset_org_quotas_if_needed()`

## Cross-Org Isolation Proof

The Final Task requires proving Org B users cannot access Org A data. This is enforced at three levels:

1. **Hasura permissions** — all queries filter by org_members.user_id; cross-org IDs return null
2. **Action handlers** — verify org membership before any mutation; viewer role rejected
3. **Webhook secrets** — scoped per workflow; no org context leakage

Even if an Org B user obtains an Org A workflow ID, workflow run ID, or step run ID, every GraphQL operation and Action returns 403 or null.
