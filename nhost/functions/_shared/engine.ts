// Shared workflow execution engine.
//
// IMPORTANT: this file is intentionally under `_shared/` (underscore prefix).
// nhost's function router skips underscore-prefixed paths when building HTTP
// routes, so this module is bundled into whichever function imports it but
// never exposed as its own endpoint. Both `trigger-workflow-run` and
// `approve-step` import from here so there is a single implementation of
// step execution and resume logic — previously `approve-step` carried its
// own copy of this logic that had drifted from the original (no retries, no
// http templating, ignored the notify channel config, etc.) and, worse, was
// invoked *in addition to* re-entering `trigger-workflow-run`, causing every
// step after an approval gate to run twice concurrently.

const HASURA_URL = process.env.NHOST_GRAPHQL_URL || process.env.NHOST_HASURA_URL || 'http://hasura:8080/v1/graphql';
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const LLM_STUB_DELAY_MS = parseInt(process.env.LLM_STUB_DELAY_MS || '1500', 10);

export interface HasuraSession {
  'x-hasura-user-id'?: string;
  'x-hasura-role'?: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  step_type: string;
  position: number;
  config: Record<string, unknown>;
}

export interface StepRun {
  id: string;
  workflow_step_id: string;
  status: string;
}

export async function gql(query: string, variables: Record<string, unknown> = {}, session?: HasuraSession) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-hasura-admin-secret': ADMIN_SECRET,
  };
  if (session?.['x-hasura-user-id']) {
    headers['x-hasura-role'] = session['x-hasura-role'] || 'user';
    headers['x-hasura-user-id'] = session['x-hasura-user-id'];
  }

  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

export async function getUserRole(userId: string, orgId: string): Promise<string | null> {
  const data = await gql(`
    query GetRole($userId: uuid!, $orgId: uuid!) {
      org_members(where: {user_id: {_eq: $userId}, org_id: {_eq: $orgId}}) {
        role
      }
    }
  `, { userId, orgId });
  return data.org_members[0]?.role || null;
}

export const OWNER_ONLY_STEPS = ['db_write', 'notify'];
export const OWNER_ONLY_TRIGGERS = ['webhook', 'database_event'];

export function validateStepPermissions(steps: WorkflowStep[], role: string): string | null {
  if (role === 'owner') return null;
  for (const step of steps) {
    if (OWNER_ONLY_STEPS.includes(step.step_type)) {
      return `Only owners can use ${step.step_type} steps. Step "${step.name}" requires owner role.`;
    }
  }
  return null;
}

async function callLLM(prompt: string, systemPrompt?: string): Promise<string> {
  if (GROQ_API_KEY) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
        max_tokens: 512,
      }),
    });
    if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    return data.choices[0].message.content;
  }

  // Stubbed LLM with artificial delay
  await new Promise(r => setTimeout(r, LLM_STUB_DELAY_MS));
  const lower = prompt.toLowerCase();
  if (lower.includes('approve') || lower.includes('yes')) return 'APPROVE: The request looks good and should proceed.';
  if (lower.includes('reject') || lower.includes('no')) return 'REJECT: The request has issues and should not proceed.';
  return 'APPROVE: Analysis complete. The content appears valid and safe to proceed.';
}

async function executeHttpRequest(config: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown> {
  const url = (config.url as string || '').replace(/\{\{(\w+)\}\}/g, (_, key) => String(context[key] ?? ''));
  const method = (config.method as string) || 'GET';
  const headers = (config.headers as Record<string, string>) || {};
  const body = config.body ? JSON.stringify(config.body) : undefined;

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, body: text }; }
}

export async function executeStep(
  step: WorkflowStep,
  context: Record<string, unknown>,
  orgId: string,
  workflowRunId: string,
): Promise<{ output: unknown; branch?: string }> {
  switch (step.step_type) {
    case 'llm_call': {
      const prompt = (step.config.prompt as string || '').replace(/\{\{(\w+)\}\}/g, (_, key) => String(context[key] ?? ''));
      const systemPrompt = step.config.system_prompt as string;
      const result = await callLLM(prompt, systemPrompt);
      return { output: { response: result, model: GROQ_API_KEY ? 'groq/llama-3.1-8b-instant' : 'stub' } };
    }
    case 'http_request': {
      const result = await executeHttpRequest(step.config, context);
      return { output: result };
    }
    case 'db_write': {
      const key = step.config.key as string || 'result';
      const value = context.last_output ?? step.config.value;
      await gql(`
        mutation InsertResult($orgId: uuid!, $runId: uuid!, $key: String!, $value: jsonb!) {
          insert_workflow_results_one(object: {
            org_id: $orgId, workflow_run_id: $runId, key: $key, value: $value
          }) { id }
        }
      `, { orgId, runId: workflowRunId, key, value });
      return { output: { saved: true, key, value } };
    }
    case 'notify': {
      const channel = step.config.channel as string || 'email';
      const message = (step.config.message as string || 'Workflow notification')
        .replace(/\{\{(\w+)\}\}/g, (_, key) => String(context[key] ?? ''));
      const config = {
        webhook_url: step.config.webhook_url,
        to: step.config.to,
      };
      await gql(`
        mutation InsertNotification($orgId: uuid!, $runId: uuid!, $channel: String!, $message: String!, $config: jsonb!) {
          insert_notification_log_one(object: {
            org_id: $orgId, workflow_run_id: $runId, channel: $channel, message: $message, config: $config
          }) { id }
        }
      `, { orgId, runId: workflowRunId, channel, message, config });
      return { output: { notified: true, channel, message } };
    }
    case 'conditional_branch': {
      const condition = step.config.condition as string || 'contains';
      const field = step.config.field as string || 'response';
      const value = step.config.value as string || 'APPROVE';
      const lastOutput = context.last_output as Record<string, unknown>;
      const fieldValue = String(lastOutput?.[field] ?? lastOutput ?? '');

      let matched = false;
      switch (condition) {
        case 'contains': matched = fieldValue.includes(value); break;
        case 'equals': matched = fieldValue === value; break;
        case 'starts_with': matched = fieldValue.startsWith(value); break;
        default: matched = fieldValue.includes(value);
      }
      const branch = matched ? 'true' : 'false';
      return { output: { matched, branch, fieldValue }, branch };
    }
    case 'approval_gate':
      return { output: { awaiting_approval: true, message: step.config.message || 'Awaiting approval' } };
    default:
      throw new Error(`Unknown step type: ${step.step_type}`);
  }
}

async function executeWithRetry<T>(
  fn: () => Promise<T>,
  onAttempt: (attempt: number) => Promise<void>,
  maxAttempts = 2,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await onAttempt(attempt);
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastError || new Error('Step failed');
}

/**
 * Runs (or resumes) a workflow run starting at `startFromStep`, mutating
 * step_runs/workflow_runs as it goes so the live subscription reflects
 * progress. Stops (without erroring) when it hits a pending approval_gate.
 *
 * This is the ONLY place step execution happens — both a fresh
 * `triggerWorkflowRun` call and an `approveStep` resume call into this same
 * function, so there is no risk of the two diverging or double-running.
 */
export async function runWorkflow(workflowRunId: string, startFromStep = 0): Promise<void> {
  const runData = await gql(`
    query GetRun($id: uuid!) {
      workflow_runs_by_pk(id: $id) {
        id workflow_id org_id status context
        workflow {
          workflow_steps(order_by: {position: asc}) {
            id name step_type position config
          }
        }
        step_runs(order_by: {created_at: asc}) {
          id workflow_step_id status
        }
      }
    }
  `, { id: workflowRunId });

  const run = runData.workflow_runs_by_pk;
  if (!run) throw new Error('Workflow run not found');

  const steps: WorkflowStep[] = run.workflow.workflow_steps;
  const stepRuns: StepRun[] = run.step_runs;
  let context: Record<string, unknown> = run.context || {};

  await gql(`
    mutation UpdateRun($id: uuid!, $status: run_status!, $started: timestamptz) {
      update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {
        status: $status, started_at: $started
      }) { id }
    }
  `, { id: workflowRunId, status: 'running', started: new Date().toISOString() });

  for (let i = startFromStep; i < steps.length; i++) {
    const step = steps[i];
    const stepRun = stepRuns[i];
    if (!stepRun) continue;

    if (stepRun.status === 'completed' || stepRun.status === 'skipped') {
      continue;
    }

    await gql(`
      mutation StartStepRun($id: uuid!, $status: step_run_status!, $started: timestamptz, $input: jsonb!) {
        update_step_runs_by_pk(pk_columns: {id: $id}, _set: {
          status: $status, started_at: $started, input: $input, attempt_count: 0, error: null
        }) { id }
      }
    `, { id: stepRun.id, status: 'running', started: new Date().toISOString(), input: context });

    try {
      if (step.step_type === 'approval_gate') {
        await gql(`
          mutation PauseStep($stepId: uuid!, $runId: uuid!, $input: jsonb!, $output: jsonb!) {
            update_step_runs_by_pk(pk_columns: {id: $stepId}, _set: {
              status: paused, input: $input, output: $output
            }) { id }
            update_workflow_runs_by_pk(pk_columns: {id: $runId}, _set: {status: paused}) { id }
          }
        `, {
          stepId: stepRun.id,
          runId: workflowRunId,
          input: context,
          output: { awaiting_approval: true, message: step.config.message || 'Awaiting approval' },
        });
        return; // Stop execution, wait for approval
      }

      const result = await executeWithRetry(
        () => executeStep(step, context, run.org_id, workflowRunId),
        async (attempt) => {
          await gql(`
            mutation UpdateAttempt($id: uuid!, $attempts: Int!) {
              update_step_runs_by_pk(pk_columns: {id: $id}, _set: {attempt_count: $attempts}) { id }
            }
          `, { id: stepRun.id, attempts: attempt });
        },
        2,
      );

      context = { ...context, last_output: result.output, [`step_${step.position}`]: result.output };

      const now = new Date().toISOString();
      await gql(`
        mutation CompleteStep($id: uuid!, $output: jsonb!, $ctx: jsonb!, $runId: uuid!, $completedAt: timestamptz!) {
          update_step_runs_by_pk(pk_columns: {id: $id}, _set: {
            status: completed, output: $output, completed_at: $completedAt
          }) { id }
          update_workflow_runs_by_pk(pk_columns: {id: $runId}, _set: {context: $ctx}) { id }
        }
      `, { id: stepRun.id, output: result.output, ctx: context, runId: workflowRunId, completedAt: now });

      if (step.step_type === 'conditional_branch' && result.branch === 'false') {
        // Skip remaining steps on false branch if configured
        const skipOnFalse = step.config.skip_remaining_on_false;
        if (skipOnFalse) {
          for (let j = i + 1; j < steps.length; j++) {
            if (stepRuns[j]) {
              await gql(`
                mutation SkipStep($id: uuid!) {
                  update_step_runs_by_pk(pk_columns: {id: $id}, _set: {status: skipped}) { id }
                }
              `, { id: stepRuns[j].id });
            }
          }
          break;
        }
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      const failNow = new Date().toISOString();
      await gql(`
        mutation FailStep($stepId: uuid!, $runId: uuid!, $error: String!, $completedAt: timestamptz!) {
          update_step_runs_by_pk(pk_columns: {id: $stepId}, _set: {
            status: failed, error: $error, completed_at: $completedAt
          }) { id }
          update_workflow_runs_by_pk(pk_columns: {id: $runId}, _set: {
            status: failed, error: $error, completed_at: $completedAt
          }) { id }
        }
      `, { stepId: stepRun.id, runId: workflowRunId, error: errorMsg, completedAt: failNow });
      await gql(`
        mutation ReleaseQuota($orgId: uuid!) {
          release_org_quota(args: {p_org_id: $orgId}) {
            org_id
            quota_used
            quota_in_flight
          }
        }
      `, { orgId: run.org_id });
      return;
    }
  }

  // Workflow completed successfully
  const completeNow = new Date().toISOString();
  await gql(`
    mutation CompleteRun($id: uuid!, $orgId: uuid!, $completedAt: timestamptz!) {
      update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {
        status: completed, completed_at: $completedAt
      }) { id }
      finalize_org_quota(args: {p_org_id: $orgId}) {
        org_id
        quota_used
        quota_in_flight
      }
    }
  `, { id: workflowRunId, orgId: run.org_id, completedAt: completeNow });
}
