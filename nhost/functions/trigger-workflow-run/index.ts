import { Request, Response } from 'express';
import {
  gql,
  getUserRole,
  validateStepPermissions,
  runWorkflow,
  WorkflowStep,
} from '../_shared/engine';

export default async (req: Request, res: Response) => {
  let reservedOrgId: string | null = null;
  try {
    const sessionVars = req.body.session_variables || req.body.event?.session_variables || {};
    const userId = sessionVars['x-hasura-user-id'];
    const isEventTrigger = req.headers['x-event-trigger'] === 'database_event';
    // The scheduled-runner cron function calls this endpoint directly (not
    // through a Hasura Action), so it can't carry a user session. It
    // identifies itself with this header instead, admin-secret-authenticated
    // just like the event trigger path, and skips the Layer 1 user/role
    // check the same way.
    const isScheduledTrigger = req.headers['x-scheduled-trigger'] === 'true';
    const isSystemTriggered = isEventTrigger || isScheduledTrigger;
    const isWebhook = req.body.action?.name === 'webhookTrigger';

    // Event-trigger and cron calls are internal Hasura/Nhost traffic.
    // Require the same admin secret that metadata attaches to those calls.
    if (isSystemTriggered) {
      const suppliedSecret = req.headers['x-hasura-admin-secret'];
      if (suppliedSecret !== (process.env.NHOST_ADMIN_SECRET || '')) {
        return res.status(401).json({ message: 'Invalid internal trigger credentials' });
      }
    }
    const resumeRunId = req.headers['x-resume-run'] as string || req.body.input?.resume_run_id;
    const resumeFromStep = parseInt(
      (req.headers['x-resume-from-step'] as string) || String(req.body.input?.start_from_step ?? 0),
      10
    );

    // Handle resume from approval
    if (resumeRunId) {
      runWorkflow(resumeRunId, resumeFromStep).catch(console.error);
      return res.json({ workflow_run_id: resumeRunId, status: 'running', message: 'Workflow resumed' });
    }

    let workflowId: string;
    let triggerType = 'manual';

    if (isEventTrigger) {
      const event = req.body.event?.data?.new;
      if (!event) return res.json({ message: 'No event data' });

      const triggers = await gql(`
        query FindEventTriggers($orgId: uuid!, $eventType: String!) {
          workflow_triggers(where: {
            trigger_type: {_eq: database_event},
            is_active: {_eq: true},
            config: {_contains: {event_type: $eventType}},
            workflow: {org_id: {_eq: $orgId}, is_active: {_eq: true}}
          }) { workflow_id }
        }
      `, { orgId: event.org_id, eventType: event.event_type });

      if (!triggers.workflow_triggers.length) {
        return res.json({ message: 'No matching triggers' });
      }
      workflowId = triggers.workflow_triggers[0].workflow_id;
      triggerType = 'database_event';
    } else if (isScheduledTrigger) {
      const input = req.body.input?.input || req.body.input;
      workflowId = input.workflow_id;
      triggerType = 'scheduled';
    } else if (isWebhook) {
      const input = req.body.input?.input || req.body.input;
      workflowId = input.workflow_id;
      const secret = input.webhook_secret;

      const trigger = await gql(`
        query GetWebhookTrigger($wfId: uuid!) {
          workflow_triggers(where: {
            workflow_id: {_eq: $wfId}, trigger_type: {_eq: webhook}, is_active: {_eq: true}
          }) { config }
        }
      `, { wfId: workflowId });

      const expectedSecret = trigger.workflow_triggers[0]?.config?.secret;
      if (!expectedSecret || expectedSecret !== secret) {
        return res.status(403).json({ message: 'Invalid webhook secret' });
      }
      triggerType = 'webhook';
    } else {
      const input = req.body.input?.input || req.body.input;
      workflowId = input.workflow_id;
      triggerType = input.trigger_type || 'manual';

      if (!userId) {
        return res.status(401).json({ message: 'Authentication required' });
      }
    }

    const wfData = await gql(`
      query GetWorkflow($id: uuid!) {
        workflows_by_pk(id: $id) {
          id org_id is_active
          organization { quota_used quota_limit }
          workflow_steps(order_by: {position: asc}) {
            id name step_type position config
          }
        }
      }
    `, { id: workflowId });

    const workflow = wfData.workflows_by_pk;
    if (!workflow || !workflow.is_active) {
      return res.status(404).json({ message: 'Workflow not found or inactive' });
    }

    // Layer 1: Org + role check (skipped for system-initiated triggers —
    // database events and cron schedules aren't acting on behalf of a user,
    // so there's no user/role to check; the workflow itself is already
    // scoped to its org)
    if (!isSystemTriggered && !isWebhook) {
      const role = await getUserRole(userId, workflow.org_id);
      if (!role || role === 'viewer') {
        return res.status(403).json({ message: 'Insufficient permissions. Owner or editor role required.' });
      }

      // Layer 2: Step-level permission gating
      const stepError = validateStepPermissions(workflow.workflow_steps, role);
      if (stepError) {
        return res.status(403).json({ message: stepError });
      }
    }

    // Atomically reserve one quota slot before execution. The reservation is
    // finalized only when the workflow completes, and released on failure.
    // This prevents concurrent requests from racing past the quota limit.
    const quotaResult = await gql(`
      mutation ReserveQuota($orgId: uuid!) {
        reserve_org_quota(args: {p_org_id: $orgId}) {
          org_id
          quota_used
          quota_in_flight
          quota_limit
        }
      }
    `, { orgId: workflow.org_id });

    if (!quotaResult.reserve_org_quota?.length) {
      return res.status(429).json({ message: 'Organization quota exhausted for this period.' });
    }
    reservedOrgId = workflow.org_id;

    // Create workflow run and step runs
    const runResult = await gql(`
      mutation CreateRun($wfId: uuid!, $orgId: uuid!, $triggeredBy: uuid, $triggerType: trigger_type!) {
        insert_workflow_runs_one(object: {
          workflow_id: $wfId, org_id: $orgId, status: pending,
          triggered_by: $triggeredBy, trigger_type: $triggerType
        }) { id }
      }
    `, {
      wfId: workflowId,
      orgId: workflow.org_id,
      triggeredBy: userId || null,
      triggerType,
    });

    const workflowRunId = runResult.insert_workflow_runs_one.id;

    const stepRunObjects = workflow.workflow_steps.map((step: WorkflowStep) => ({
      workflow_run_id: workflowRunId,
      workflow_step_id: step.id,
      status: 'pending',
    }));

    await gql(`
      mutation CreateStepRuns($objects: [step_runs_insert_input!]!) {
        insert_step_runs(objects: $objects) { affected_rows }
      }
    `, { objects: stepRunObjects });

    // Execute workflow asynchronously
    runWorkflow(workflowRunId).catch(console.error);

    const output = {
      workflow_run_id: workflowRunId,
      status: 'running',
      message: 'Workflow run started',
    };

    return res.json(output);
  } catch (err) {
    console.error('triggerWorkflowRun error:', err);
    if (reservedOrgId) {
      try {
        await gql(`mutation ReleaseQuota($orgId: uuid!) { release_org_quota(args: {p_org_id: $orgId}) { org_id } }`, { orgId: reservedOrgId });
      } catch (releaseErr) {
        console.error('Failed to release reserved quota:', releaseErr);
      }
    }
    return res.status(500).json({ message: (err as Error).message });
  }
};
