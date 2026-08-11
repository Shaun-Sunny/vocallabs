import { NhostClient } from '@nhost/nextjs';

export const nhost = new NhostClient({
  authUrl: process.env.NEXT_PUBLIC_NHOST_AUTH_URL || 'https://local.auth.local.nhost.run/v1',
  storageUrl: process.env.NEXT_PUBLIC_NHOST_STORAGE_URL || 'https://local.storage.local.nhost.run/v1',
  graphqlUrl: process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL || 'https://local.graphql.local.nhost.run/v1',
  functionsUrl: process.env.NEXT_PUBLIC_NHOST_FUNCTIONS_URL || 'https://local.functions.local.nhost.run/v1',
});

export const graphqlUrl =
  process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL || 'https://local.graphql.local.nhost.run/v1';

export async function gqlFetch(
  query: string,
  variables?: Record<string, unknown>,
  token?: string | null
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error');
  return json.data;
}

export type OrgRole = 'owner' | 'editor' | 'viewer';
export type StepType =
  | 'llm_call'
  | 'http_request'
  | 'db_write'
  | 'notify'
  | 'conditional_branch'
  | 'approval_gate';
export type TriggerType = 'manual' | 'webhook' | 'scheduled' | 'database_event';
export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StepRunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'skipped';

export interface Organization {
  id: string;
  name: string;
  quota_limit: number;
  quota_used: number;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
}

export interface WorkflowStep {
  id?: string;
  name: string;
  step_type: StepType;
  position: number;
  config: Record<string, unknown>;
}

export interface WorkflowTrigger {
  id?: string;
  trigger_type: TriggerType;
  config: Record<string, unknown>;
  is_active?: boolean;
}

export interface Workflow {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  workflow_steps: WorkflowStep[];
  workflow_triggers: WorkflowTrigger[];
  workflow_runs: Array<{ id: string; status: RunStatus; created_at: string }>;
}

export interface StepRun {
  id: string;
  workflow_run_id: string;
  workflow_step_id: string;
  status: StepRunStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  attempt_count: number;
  approved_by?: string;
  approved_at?: string;
  started_at?: string;
  completed_at?: string;
  workflow_step: { name: string; step_type: StepType; position: number };
}

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  llm_call: 'LLM Call',
  http_request: 'HTTP Request',
  db_write: 'DB Write',
  notify: 'Notify',
  conditional_branch: 'Conditional Branch',
  approval_gate: 'Approval Gate',
};

export const OWNER_ONLY_STEPS: StepType[] = ['db_write', 'notify'];

export const STEP_DEFAULTS: Record<StepType, Record<string, unknown>> = {
  llm_call: {
    prompt: 'Analyze the following: {{input}}',
    system_prompt: 'You are a helpful assistant. Respond with APPROVE or REJECT.',
  },
  http_request: { url: 'https://httpbin.org/get', method: 'GET', headers: {} },
  db_write: { key: 'result' },
  notify: { channel: 'email', to: '', message: 'Workflow completed: {{last_output}}' },
  conditional_branch: { condition: 'contains', field: 'response', value: 'APPROVE', skip_remaining_on_false: false },
  approval_gate: { message: 'This step requires manual approval before continuing.' },
};
