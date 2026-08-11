'use client';

import type { StepRunStatus, StepType } from '@/lib/nhost';

const STATUS_COLORS: Record<StepRunStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  running: 'bg-blue-100 text-blue-700 animate-pulse',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-400',
};

const STEP_ICONS: Record<StepType, string> = {
  llm_call: '🤖',
  http_request: '🌐',
  db_write: '💾',
  notify: '📢',
  conditional_branch: '🔀',
  approval_gate: '✋',
};

interface StepRunCardProps {
  stepRun: {
    id: string;
    status: StepRunStatus;
    output?: unknown;
    error?: string;
    attempt_count: number;
    approved_by?: string;
    approved_at?: string;
    workflow_step: { name: string; step_type: StepType; position: number };
  };
  onApprove?: (stepRunId: string) => void;
  canApprove?: boolean;
  isPaused?: boolean;
}

export function StepRunCard({ stepRun, onApprove, canApprove, isPaused }: StepRunCardProps) {
  const { workflow_step: step, status, output, error, attempt_count } = stepRun;
  const icon = STEP_ICONS[step.step_type] || '⚙️';

  return (
    <div className={`card p-4 ${status === 'running' ? 'ring-2 ring-blue-300' : ''} ${isPaused ? 'ring-2 ring-amber-400' : ''}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono">#{step.position + 1}</span>
              <h4 className="font-medium text-gray-900">{step.name}</h4>
            </div>
            <p className="text-xs text-gray-500 capitalize">{step.step_type.replace(/_/g, ' ')}</p>
          </div>
        </div>
        <span className={`badge ${STATUS_COLORS[status]}`}>
          {status === 'paused' ? '⏸ Awaiting Approval' : status}
        </span>
      </div>

      {attempt_count > 1 && (
        <p className="mt-2 text-xs text-gray-500">Attempt {attempt_count}</p>
      )}

      {Boolean(output) && status !== 'pending' && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3">
          <p className="text-xs font-medium text-gray-500 mb-1">Output</p>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto max-h-32">
            {JSON.stringify(output, null, 2)}
          </pre>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 p-3">
          <p className="text-xs font-medium text-red-600 mb-1">Error</p>
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {status === 'paused' && step.step_type === 'approval_gate' && canApprove && onApprove && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => onApprove(stepRun.id)}
            className="btn-success flex-1"
          >
            ✓ Approve & Continue
          </button>
        </div>
      )}

      {stepRun.approved_by && (
        <p className="mt-2 text-xs text-green-600">
          Approved at {new Date(stepRun.approved_at!).toLocaleString()}
        </p>
      )}
    </div>
  );
}
