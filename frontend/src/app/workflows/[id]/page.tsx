'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { useAuthenticationStatus, useAccessToken, useUserData } from '@nhost/nextjs';
import { gqlFetch } from '@/lib/nhost';
import {
  GET_ORG_WORKFLOWS, CREATE_WORKFLOW, UPDATE_WORKFLOW,
  UPSERT_STEPS, UPSERT_TRIGGERS, TRIGGER_WORKFLOW_RUN, APPROVE_STEP, FIRE_EVENT,
} from '@/lib/queries';
import { WorkflowBuilder } from '@/components/WorkflowBuilder';
import { StepRunCard } from '@/components/StepRunCard';
import { useLiveRun } from '@/lib/useLiveRun';
import type { WorkflowStep, WorkflowTrigger, OrgRole, Workflow } from '@/lib/nhost';

function WorkflowPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const accessToken = useAccessToken();
  const user = useUserData();

  const isNew = params.id === 'new';
  const orgId = searchParams.get('orgId') || '';
  const workflowId = isNew ? null : (params.id as string);

  const [workflow, setWorkflow] = useState<Partial<Workflow>>({
    name: '', description: '', workflow_steps: [], workflow_triggers: [],
  });
  const [userRole, setUserRole] = useState<OrgRole>('viewer');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [savedWorkflowId, setSavedWorkflowId] = useState<string | null>(workflowId);

  const { stepRuns, runStatus, connected } = useLiveRun({
    runId: activeRunId,
    token: accessToken,
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/');
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (workflowId && accessToken) loadWorkflow();
  }, [workflowId, accessToken]);

  useEffect(() => {
    if (isNew && orgId && accessToken) loadRoleForNewWorkflow();
  }, [isNew, orgId, accessToken]);

  async function loadRoleForNewWorkflow() {
    const data = await gqlFetch(`
      query($orgId: uuid!) {
        org_members(where: {org_id: {_eq: $orgId}}) { role user_id }
      }
    `, { orgId }, accessToken);
    const member = data.org_members?.find((m: { user_id: string }) => m.user_id === user?.id);
    if (member) setUserRole(member.role);
  }

  async function loadWorkflow() {
    const data = await gqlFetch(`
      query($id: uuid!) {
        workflows_by_pk(id: $id) {
          id org_id name description is_active
          workflow_steps(order_by: {position: asc}) { id name step_type position config }
          workflow_triggers { id trigger_type config is_active }
        }
        org_members(where: {organization: {workflows: {id: {_eq: $id}}}}) { role user_id }
      }
    `, { id: workflowId }, accessToken);

    if (data.workflows_by_pk) {
      setWorkflow(data.workflows_by_pk);
      setSavedWorkflowId(data.workflows_by_pk.id);
      const member = data.org_members?.find(
        (m: { user_id: string }) => true // filtered by Hasura permissions
      );
      if (member) setUserRole(member.role);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      let wfId = savedWorkflowId;

      if (isNew || !wfId) {
        const data = await gqlFetch(CREATE_WORKFLOW, {
          orgId,
          name: workflow.name,
          description: workflow.description,
          userId: user?.id || ''
        }, accessToken);
        wfId = data.insert_workflows_one.id;
        setSavedWorkflowId(wfId);
        setWorkflow((w) => ({ ...w, org_id: orgId }));
      } else {
        await gqlFetch(UPDATE_WORKFLOW, {
          id: wfId,
          name: workflow.name,
          description: workflow.description,
        }, accessToken);
      }

      const stepObjects = (workflow.workflow_steps || []).map((s, i) => ({
        workflow_id: wfId,
        name: s.name,
        step_type: s.step_type,
        position: i,
        config: s.config,
      }));
      await gqlFetch(UPSERT_STEPS, { workflowId: wfId, steps: stepObjects }, accessToken);

      const triggerObjects = (workflow.workflow_triggers || []).map((t) => ({
        workflow_id: wfId,
        trigger_type: t.trigger_type,
        config: t.config,
        is_active: t.is_active ?? true,
      }));
      await gqlFetch(UPSERT_TRIGGERS, { workflowId: wfId, triggers: triggerObjects }, accessToken);

      if (isNew) router.replace(`/workflows/${wfId}`);
      alert('Workflow saved!');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    if (!savedWorkflowId) {
      alert('Save the workflow first.');
      return;
    }
    setRunning(true);
    try {
      const data = await gqlFetch(TRIGGER_WORKFLOW_RUN, { workflowId: savedWorkflowId }, accessToken);
      setActiveRunId(data.triggerWorkflowRun.workflow_run_id);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function handleApprove(stepRunId: string) {
    try {
      await gqlFetch(APPROVE_STEP, { stepRunId }, accessToken);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleFireEvent() {
    if (!workflow.org_id) return;
    try {
      await gqlFetch(FIRE_EVENT, {
        orgId: workflow.org_id,
        eventType: 'record_created',
        payload: { source: 'manual_test' },
      }, accessToken);
      alert('Database event fired! If a database_event trigger is configured, the workflow will start.');
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const canRun = userRole === 'owner' || userRole === 'editor';
  const canApprove = canRun;
  const isPaused = runStatus === 'paused' || stepRuns.some(s => s.status === 'paused');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-gray-700">
              ← Back
            </button>
            <input
              className="text-xl font-bold bg-transparent border-none focus:outline-none focus:ring-0"
              value={workflow.name || ''}
              onChange={(e) => setWorkflow({ ...workflow, name: e.target.value })}
              placeholder="Workflow name"
            />
          </div>
          <div className="flex items-center gap-2">
            {canRun && savedWorkflowId && (
              <>
                <button onClick={handleFireEvent} className="btn-secondary text-xs">Fire DB Event</button>
                <button onClick={handleRun} disabled={running} className="btn-success">
                  {running ? 'Starting...' : '▶ Run'}
                </button>
              </>
            )}
            {userRole !== 'viewer' && (
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            {userRole !== 'viewer' ? (
              <WorkflowBuilder
                steps={workflow.workflow_steps || []}
                triggers={workflow.workflow_triggers || []}
                onStepsChange={(steps) => setWorkflow({ ...workflow, workflow_steps: steps })}
                onTriggersChange={(triggers) => setWorkflow({ ...workflow, workflow_triggers: triggers })}
                userRole={userRole}
              />
            ) : (
              <div className="card p-6 text-center text-gray-500">
                You have read-only access to this workflow.
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Live Run Status</h3>
              {activeRunId && (
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span className="text-xs text-gray-500">{connected ? 'Live' : 'Connecting...'}</span>
                  {runStatus && (
                    <span className={`badge ${
                      runStatus === 'completed' ? 'bg-green-100 text-green-700' :
                      runStatus === 'running' ? 'bg-blue-100 text-blue-700' :
                      runStatus === 'paused' ? 'bg-amber-100 text-amber-700' :
                      runStatus === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{runStatus}</span>
                  )}
                </div>
              )}
            </div>

            {!activeRunId ? (
              <div className="card p-8 text-center text-gray-500">
                Run the workflow to see live step-by-step progress here.
              </div>
            ) : stepRuns.length === 0 ? (
              <div className="card p-8 text-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600 mx-auto" />
                <p className="text-sm text-gray-500 mt-2">Waiting for steps...</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stepRuns.map((sr) => (
                  <StepRunCard
                    key={sr.id}
                    stepRun={sr}
                    onApprove={handleApprove}
                    canApprove={canApprove}
                    isPaused={sr.status === 'paused'}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function WorkflowPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <WorkflowPageInner />
    </Suspense>
  );
}
