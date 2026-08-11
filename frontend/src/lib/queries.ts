export const GET_MY_ORGS = `
  query GetMyOrgs {
    org_members {
      id org_id role
      organization {
        id name quota_limit quota_used
        usage_stats { quota_usage_percent avg_run_duration_seconds runs_this_month }
      }
    }
  }
`;

export const GET_ORG_WORKFLOWS = `
  query GetOrgWorkflows($orgId: uuid!) {
    workflows(where: {org_id: {_eq: $orgId}}, order_by: {updated_at: desc}) {
      id org_id name description is_active created_at updated_at
      workflow_steps(order_by: {position: asc}) {
        id name step_type position config
      }
      workflow_triggers {
        id trigger_type config is_active
      }
      workflow_runs(order_by: {created_at: desc}, limit: 1) {
        id status created_at started_at completed_at
      }
    }
  }
`;

export const CREATE_WORKFLOW = `
  mutation CreateWorkflow($orgId: uuid!, $name: String!, $description: String, $userId: uuid!) {
    insert_workflows_one(object: {
      org_id: $orgId, name: $name, description: $description, created_by: $userId
    }) { id }
  }
`;

export const UPDATE_WORKFLOW = `
  mutation UpdateWorkflow($id: uuid!, $name: String!, $description: String) {
    update_workflows_by_pk(pk_columns: {id: $id}, _set: {
      name: $name, description: $description
    }) { id }
  }
`;

export const UPSERT_STEPS = `
  mutation UpsertSteps($workflowId: uuid!, $steps: [workflow_steps_insert_input!]!) {
    delete_workflow_steps(where: {workflow_id: {_eq: $workflowId}}) { affected_rows }
    insert_workflow_steps(objects: $steps) { affected_rows }
  }
`;

export const UPSERT_TRIGGERS = `
  mutation UpsertTriggers($workflowId: uuid!, $triggers: [workflow_triggers_insert_input!]!) {
    delete_workflow_triggers(where: {workflow_id: {_eq: $workflowId}}) { affected_rows }
    insert_workflow_triggers(objects: $triggers) { affected_rows }
  }
`;

export const TRIGGER_WORKFLOW_RUN = `
  mutation TriggerWorkflowRun($workflowId: uuid!) {
    triggerWorkflowRun(input: {workflow_id: $workflowId}) {
      workflow_run_id status message
    }
  }
`;

export const APPROVE_STEP = `
  mutation ApproveStep($stepRunId: uuid!) {
    approveStep(input: {step_run_id: $stepRunId}) {
      success message workflow_run_id
    }
  }
`;

export const GET_WORKFLOW_RUN = `
  query GetWorkflowRun($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id status started_at completed_at error trigger_type
      workflow { name }
      step_runs(order_by: {created_at: asc}) {
        id workflow_step_id status input output error attempt_count
        approved_by approved_at started_at completed_at
        workflow_step { name step_type position }
      }
    }
  }
`;

export const SUBSCRIBE_STEP_RUNS = `
  subscription SubscribeStepRuns($runId: uuid!) {
    step_runs(where: {workflow_run_id: {_eq: $runId}}, order_by: {created_at: asc}) {
      id workflow_step_id status input output error attempt_count
      approved_by approved_at started_at completed_at
      workflow_step { name step_type position }
    }
  }
`;

export const SUBSCRIBE_WORKFLOW_RUN = `
  subscription SubscribeWorkflowRun($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id status started_at completed_at error
    }
  }
`;

export const CREATE_ORGANIZATION = `
  mutation CreateOrganization($name: String!) {
    createOrganization(input: {name: $name}) {
      id name
    }
  }
`;

export const FIRE_EVENT = `
  mutation FireEvent($orgId: uuid!, $eventType: String!, $payload: jsonb!) {
    insert_workflow_events_one(object: {
      org_id: $orgId, event_type: $eventType, payload: $payload
    }) { id }
  }
`;

export const GET_USAGE_STATS = `
  query GetUsageStats($orgId: uuid!) {
    org_usage_stats(where: {org_id: {_eq: $orgId}}) {
      org_id org_name quota_used quota_limit quota_usage_percent
      avg_run_duration_seconds runs_this_month
    }
  }
`;
