'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthenticationStatus, useUserData, useSignOut, useAccessToken } from '@nhost/nextjs';
import { gqlFetch } from '@/lib/nhost';
import { GET_MY_ORGS, CREATE_ORGANIZATION } from '@/lib/queries';
import { QuotaIndicator } from '@/components/QuotaIndicator';
import type { OrgMember, Organization } from '@/lib/nhost';

interface OrgWithMember {
  member: OrgMember;
  org: Organization & {
    usage_stats?: Array<{
      quota_usage_percent: number;
      avg_run_duration_seconds: number;
      runs_this_month: number;
    }>;
  };
}

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const user = useUserData();
  const { signOut } = useSignOut();
  const accessToken = useAccessToken();
  const router = useRouter();

  const [orgs, setOrgs] = useState<OrgWithMember[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<OrgWithMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/');
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (accessToken) loadOrgs();
  }, [accessToken]);

  async function loadOrgs() {
    try {
      const data = await gqlFetch(GET_MY_ORGS, {}, accessToken);
      const mapped: OrgWithMember[] = data.org_members.map((m: OrgMember & { organization: Organization & { usage_stats?: unknown[] } }) => ({
        member: { id: m.id, org_id: m.org_id, user_id: m.user_id, role: m.role },
        org: m.organization,
      }));
      setOrgs(mapped);
      if (mapped.length > 0 && !selectedOrg) setSelectedOrg(mapped[0]);
    } catch (err) {
      console.error('Failed to load orgs:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateOrg() {
    if (!newOrgName.trim() || !user) return;
    try {
      await gqlFetch(CREATE_ORGANIZATION, { name: newOrgName }, accessToken);
      setNewOrgName('');
      setShowCreateOrg(false);
      await loadOrgs();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  if (isLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  const stats = selectedOrg?.org.usage_stats?.[0];

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-900">AI Workflow Builder</h1>
            {orgs.length > 0 && (
              <select
                className="input max-w-xs"
                value={selectedOrg?.org.id || ''}
                onChange={(e) => {
                  const org = orgs.find(o => o.org.id === e.target.value);
                  if (org) setSelectedOrg(org);
                }}
              >
                {orgs.map((o) => (
                  <option key={o.org.id} value={o.org.id}>
                    {o.org.name} ({o.member.role})
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{user?.email}</span>
            <button onClick={() => signOut()} className="btn-secondary text-xs">Sign Out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {orgs.length === 0 ? (
          <div className="card p-8 text-center">
            <h2 className="text-lg font-semibold mb-2">Welcome!</h2>
            <p className="text-gray-500 mb-4">Create an organization to get started.</p>
            <button onClick={() => setShowCreateOrg(true)} className="btn-primary">Create Organization</button>
          </div>
        ) : selectedOrg ? (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1 space-y-4">
              <QuotaIndicator
                used={selectedOrg.org.quota_used}
                limit={selectedOrg.org.quota_limit}
                runsThisMonth={stats?.runs_this_month}
                avgDuration={stats?.avg_run_duration_seconds}
              />
              <div className="card p-4">
                <p className="text-sm text-gray-500">Your Role</p>
                <p className="text-lg font-semibold capitalize">{selectedOrg.member.role}</p>
              </div>
            </div>

            <div className="lg:col-span-3">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">Workflows</h2>
                {selectedOrg.member.role !== 'viewer' && (
                  <button
                    onClick={() => router.push(`/workflows/new?orgId=${selectedOrg.org.id}`)}
                    className="btn-primary"
                  >
                    + New Workflow
                  </button>
                )}
              </div>
              <WorkflowList orgId={selectedOrg.org.id} role={selectedOrg.member.role} token={accessToken} />
            </div>
          </div>
        ) : null}

        {showCreateOrg && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="card p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">Create Organization</h3>
              <input
                className="input mb-4"
                placeholder="Organization name"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={handleCreateOrg} className="btn-primary flex-1">Create</button>
                <button onClick={() => setShowCreateOrg(false)} className="btn-secondary flex-1">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function WorkflowList({ orgId, role, token }: { orgId: string; role: string; token: string | null }) {
  const [workflows, setWorkflows] = useState<Array<{
    id: string; name: string; description?: string; is_active: boolean;
    workflow_runs: Array<{ id: string; status: string; created_at: string }>;
  }>>([]);
  const router = useRouter();

  useEffect(() => {
    if (token) loadWorkflows();
  }, [orgId, token]);

  async function loadWorkflows() {
    const { GET_ORG_WORKFLOWS } = await import('@/lib/queries');
    const data = await gqlFetch(GET_ORG_WORKFLOWS, { orgId }, token);
    setWorkflows(data.workflows);
  }

  if (workflows.length === 0) {
    return (
      <div className="card p-8 text-center text-gray-500">
        No workflows yet. Create one to get started.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {workflows.map((wf) => {
        const lastRun = wf.workflow_runs[0];
        return (
          <div
            key={wf.id}
            className="card p-4 hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => router.push(`/workflows/${wf.id}`)}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">{wf.name}</h3>
                {wf.description && <p className="text-sm text-gray-500 mt-0.5">{wf.description}</p>}
              </div>
              <div className="flex items-center gap-3">
                {lastRun && (
                  <span className={`badge ${
                    lastRun.status === 'completed' ? 'bg-green-100 text-green-700' :
                    lastRun.status === 'running' ? 'bg-blue-100 text-blue-700' :
                    lastRun.status === 'paused' ? 'bg-amber-100 text-amber-700' :
                    lastRun.status === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {lastRun.status}
                  </span>
                )}
                <span className="text-gray-400">→</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
