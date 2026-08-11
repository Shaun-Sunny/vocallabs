# Final Task Live Demo Runbook

This runbook is designed to demonstrate the assessment's required end-to-end scenario in 6–8 minutes.

## Demo accounts

Create four users in Nhost Auth:

| User | Org | Role |
|---|---|---|
| `owner-a@demo.com` | Org Alpha | owner |
| `editor-a@demo.com` | Org Alpha | editor |
| `owner-b@demo.com` | Org Beta | owner |
| `editor-b@demo.com` | Org Beta | editor |

Use a throwaway demo password. Do not record production credentials.

**Important:** Use `editor-b` for the cross-organization proof. This demonstrates that an editor in Org B is blocked because of tenant isolation, not merely because the user is a viewer.

## 1. Prepare the data

After creating the users, copy their Auth user IDs from Nhost/Hasura and fill the placeholders in `scripts/demo-setup.sql`.

The script creates:

- Org Alpha and Org Beta
- two Alpha members (owner + editor)
- two Beta members (owner + editor)
- the Alpha demo workflow
- five workflow steps
- manual + webhook + database-event triggers

Run it against the project database.

## 2. Show the workflow

Log in as `owner-a@demo.com`.

Open the Alpha workflow and show:

1. `llm_call`
2. `conditional_branch`
3. `http_request`
4. `approval_gate`
5. `notify`

Point out that the conditional step evaluates the previous LLM output.

## 3. Manual execution

Click **Run**.

Keep the live run panel visible. Do not refresh.

Show the statuses changing in real time:

```text
LLM Analysis       → completed
Conditional Branch → completed
HTTP Request       → completed
Approval Gate      → paused / awaiting approval
```

This demonstrates the GraphQL subscription and the required paused state.

## 4. Approval

While the run is paused, click **Approve & Continue** as the Alpha owner/editor.

Show:

```text
approved_by
approved_at
approval_gate → completed
workflow_run → running → completed
```

Then show the remaining step(s) completing live, including the notify Event Trigger delivery if a Slack/email destination is configured.

## 5. Second trigger

Use the webhook trigger from an external HTTP client such as curl/Postman, or fire the configured database event. This proves a non-manual trigger actually starts a run.

The important point is that the run starts without clicking the normal Run button.

## 6. Cross-organization isolation

Sign out and log in as `editor-b@demo.com`.

Show that Org Alpha is not visible.

For the strongest proof, use the exact Alpha workflow ID and attempt all three operations:

1. Query the Alpha workflow directly by ID.
2. Attempt to trigger the Alpha workflow.
3. Attempt to approve the Alpha paused step/run by ID.

Expected result:

```text
Alpha workflow query → null / inaccessible
triggerWorkflowRun   → rejected
approveStep          → rejected
```

This is the critical tenant-isolation proof: the user has the **editor** role, but only in Org Beta.

## 7. Quota

Return to the Alpha owner dashboard and show the usage/quota indicator. Explain that usage is tracked at organization level.

## Recording tips

- Record the browser and, if possible, a small terminal window for the webhook request.
- Do not show API keys, Nhost admin secrets, or real credentials.
- Keep the browser network/devtools closed unless needed; the visible UI should be enough.
- Do not refresh during the live subscription demonstration.
- Start the recording with a 10-second architecture overview, then perform the scenario.
