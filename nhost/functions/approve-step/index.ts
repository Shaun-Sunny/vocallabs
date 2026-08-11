import { Request, Response } from 'express';
import { gql, runWorkflow } from '../_shared/engine';

export default async (req: Request, res: Response) => {
  try {
    const sessionVars = req.body.session_variables || {};
    const userId = sessionVars['x-hasura-user-id'];
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const input = req.body.input?.input || req.body.input;
    const stepRunId = input.step_run_id;

    const stepData = await gql(`
      query GetStepRun($id: uuid!) {
        step_runs_by_pk(id: $id) {
          id status workflow_step_id
          workflow_run {
            id org_id status
            workflow {
              workflow_steps(order_by: {position: asc}) { id position step_type }
            }
          }
          workflow_step { step_type name }
        }
      }
    `, { id: stepRunId });

    const stepRun = stepData.step_runs_by_pk;
    if (!stepRun) {
      return res.status(404).json({ message: 'Step run not found' });
    }

    if (stepRun.workflow_step.step_type !== 'approval_gate') {
      return res.status(400).json({ message: 'This step is not an approval gate' });
    }

    if (stepRun.status !== 'paused') {
      return res.status(400).json({ message: `Step is not paused (current status: ${stepRun.status})` });
    }

    const orgId = stepRun.workflow_run.org_id;

    // Layer 2: verify the approver is owner/editor in the SAME org as the
    // run. This has to happen here, in the Action handler, rather than as a
    // database permission — approving is a mid-execution decision (resume a
    // paused run) rather than a simple row read/write that a Hasura row
    // filter could express.
    const roleData = await gql(`
      query GetRole($userId: uuid!, $orgId: uuid!) {
        org_members(where: {user_id: {_eq: $userId}, org_id: {_eq: $orgId}}) { role }
      }
    `, { userId, orgId });

    const role = roleData.org_members[0]?.role;
    if (!role || role === 'viewer') {
      return res.status(403).json({
        message: 'Insufficient permissions. Only owners and editors in this organization can approve.',
      });
    }

    // Mark the gate approved
    const approvedAt = new Date().toISOString();
    const approvalResult = await gql(`
      mutation ApproveStep($id: uuid!, $approvedBy: uuid!, $approvedAt: timestamptz!) {
        update_step_runs(
          where: {id: {_eq: $id}, status: {_eq: paused}}
          _set: {
            status: completed,
            approved_by: $approvedBy,
            approved_at: $approvedAt,
            output: {approved: true},
            completed_at: $approvedAt
          }
        ) { affected_rows }
      }
    `, { id: stepRunId, approvedBy: userId, approvedAt });

    if (approvalResult.update_step_runs.affected_rows !== 1) {
      return res.status(409).json({ message: 'Approval was already processed or the step is no longer paused.' });
    }

    // Find the index of this step to resume from the next one
    const steps = stepRun.workflow_run.workflow.workflow_steps;
    const currentStepIndex = steps.findIndex(
      (s: { id: string }) => s.id === stepRun.workflow_step_id
    );
    const nextStepIndex = currentStepIndex + 1;
    const workflowRunId = stepRun.workflow_run.id;

    await gql(`
      mutation ResumeRun($id: uuid!) {
        update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {status: running}) { id }
      }
    `, { id: workflowRunId });

    // Resume execution from the next step. This calls the exact same
    // engine used by triggerWorkflowRun — there is only one place workflow
    // steps get executed, so a resumed run can never race with itself.
    runWorkflow(workflowRunId, nextStepIndex).catch(console.error);

    return res.json({
      success: true,
      message: 'Step approved. Workflow resumed.',
      workflow_run_id: workflowRunId,
    });
  } catch (err) {
    console.error('approveStep error:', err);
    return res.status(500).json({ message: (err as Error).message });
  }
};
