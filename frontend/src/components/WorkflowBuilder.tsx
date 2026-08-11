'use client';

import { useState } from 'react';
import type { WorkflowStep, StepType, WorkflowTrigger, TriggerType, OrgRole } from '@/lib/nhost';
import { STEP_TYPE_LABELS, STEP_DEFAULTS, OWNER_ONLY_STEPS } from '@/lib/nhost';

interface WorkflowBuilderProps {
  steps: WorkflowStep[];
  triggers: WorkflowTrigger[];
  onStepsChange: (steps: WorkflowStep[]) => void;
  onTriggersChange: (triggers: WorkflowTrigger[]) => void;
  userRole: OrgRole;
}

const ALL_STEP_TYPES: StepType[] = [
  'llm_call', 'http_request', 'conditional_branch', 'approval_gate', 'db_write', 'notify',
];

const ALL_TRIGGER_TYPES: TriggerType[] = ['manual', 'webhook', 'scheduled', 'database_event'];

export function WorkflowBuilder({ steps, triggers, onStepsChange, onTriggersChange, userRole }: WorkflowBuilderProps) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const addStep = (type: StepType) => {
    if (OWNER_ONLY_STEPS.includes(type) && userRole !== 'owner') {
      alert(`Only owners can add ${STEP_TYPE_LABELS[type]} steps.`);
      return;
    }
    const newStep: WorkflowStep = {
      name: `${STEP_TYPE_LABELS[type]} ${steps.length + 1}`,
      step_type: type,
      position: steps.length,
      config: { ...STEP_DEFAULTS[type] },
    };
    onStepsChange([...steps, newStep]);
    setExpandedStep(steps.length);
  };

  const removeStep = (index: number) => {
    const updated = steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i }));
    onStepsChange(updated);
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= steps.length) return;
    const updated = [...steps];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    onStepsChange(updated.map((s, i) => ({ ...s, position: i })));
  };

  const updateStep = (index: number, field: string, value: unknown) => {
    const updated = [...steps];
    if (field === 'name') {
      updated[index] = { ...updated[index], name: value as string };
    } else if (field === 'step_type') {
      updated[index] = { ...updated[index], step_type: value as StepType };
    } else {
      updated[index] = { ...updated[index], config: { ...updated[index].config, [field]: value } };
    }
    onStepsChange(updated);
  };

  const addTrigger = (type: TriggerType) => {
    if ((type === 'webhook' || type === 'database_event') && userRole !== 'owner') {
      alert(`Only owners can add ${type} triggers.`);
      return;
    }
    const defaults: Record<TriggerType, Record<string, unknown>> = {
      manual: {},
      webhook: { secret: crypto.randomUUID().slice(0, 16) },
      scheduled: { cron: '*/5 * * * *' },
      database_event: { event_type: 'record_created' },
    };
    onTriggersChange([...triggers, { trigger_type: type, config: defaults[type], is_active: true }]);
  };

  return (
    <div className="space-y-6">
      {/* Steps */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Workflow Steps</h3>
          <div className="flex flex-wrap gap-2">
            {ALL_STEP_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => addStep(type)}
                disabled={OWNER_ONLY_STEPS.includes(type) && userRole !== 'owner'}
                className="btn-secondary text-xs disabled:opacity-40"
                title={OWNER_ONLY_STEPS.includes(type) && userRole !== 'owner' ? 'Owner only' : ''}
              >
                + {STEP_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        {steps.length === 0 ? (
          <div className="card p-8 text-center text-gray-500">
            No steps yet. Add steps above to build your workflow.
          </div>
        ) : (
          <div className="space-y-3">
            {steps.map((step, index) => (
              <div key={index} className="card p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-gray-400 w-6">#{index + 1}</span>
                    <input
                      className="input max-w-xs"
                      value={step.name}
                      onChange={(e) => updateStep(index, 'name', e.target.value)}
                    />
                    <span className="badge bg-brand-100 text-brand-700">{STEP_TYPE_LABELS[step.step_type]}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => moveStep(index, 'up')} disabled={index === 0} className="btn-secondary px-2 py-1 text-xs">↑</button>
                    <button onClick={() => moveStep(index, 'down')} disabled={index === steps.length - 1} className="btn-secondary px-2 py-1 text-xs">↓</button>
                    <button onClick={() => setExpandedStep(expandedStep === index ? null : index)} className="btn-secondary px-2 py-1 text-xs">
                      {expandedStep === index ? '▲' : '▼'}
                    </button>
                    <button onClick={() => removeStep(index)} className="btn-danger px-2 py-1 text-xs">✕</button>
                  </div>
                </div>

                {expandedStep === index && (
                  <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                    <StepConfigEditor step={step} onChange={(field, value) => updateStep(index, field, value)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Triggers */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Triggers</h3>
          <div className="flex gap-2">
            {ALL_TRIGGER_TYPES.filter(t => t !== 'manual').map((type) => (
              <button
                key={type}
                onClick={() => addTrigger(type)}
                disabled={(type === 'webhook' || type === 'database_event') && userRole !== 'owner'}
                className="btn-secondary text-xs disabled:opacity-40"
              >
                + {type.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="card p-3 flex items-center gap-2">
            <span className="badge bg-green-100 text-green-700">manual</span>
            <span className="text-sm text-gray-600">Always available via Run button</span>
          </div>
          {triggers.map((trigger, i) => (
            <div key={i} className="card p-3">
              <div className="flex items-center justify-between">
                <span className="badge bg-purple-100 text-purple-700">{trigger.trigger_type}</span>
                <button onClick={() => onTriggersChange(triggers.filter((_, j) => j !== i))} className="text-red-500 text-xs">Remove</button>
              </div>
              {trigger.trigger_type === 'webhook' && (
                <p className="mt-2 text-xs text-gray-500">Secret: <code className="bg-gray-100 px-1 rounded">{trigger.config.secret as string}</code></p>
              )}
              {trigger.trigger_type === 'scheduled' && (
                <div className="mt-2">
                  <label className="label">Cron Expression</label>
                  <input
                    className="input"
                    value={trigger.config.cron as string || ''}
                    onChange={(e) => {
                      const updated = [...triggers];
                      updated[i] = { ...updated[i], config: { ...updated[i].config, cron: e.target.value } };
                      onTriggersChange(updated);
                    }}
                  />
                </div>
              )}
              {trigger.trigger_type === 'database_event' && (
                <div className="mt-2">
                  <label className="label">Event Type</label>
                  <input
                    className="input"
                    value={trigger.config.event_type as string || ''}
                    onChange={(e) => {
                      const updated = [...triggers];
                      updated[i] = { ...updated[i], config: { ...updated[i].config, event_type: e.target.value } };
                      onTriggersChange(updated);
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepConfigEditor({ step, onChange }: { step: WorkflowStep; onChange: (field: string, value: unknown) => void }) {
  switch (step.step_type) {
    case 'llm_call':
      return (
        <>
          <div>
            <label className="label">Prompt</label>
            <textarea className="input h-24" value={step.config.prompt as string || ''} onChange={(e) => onChange('prompt', e.target.value)} />
          </div>
          <div>
            <label className="label">System Prompt</label>
            <textarea className="input h-16" value={step.config.system_prompt as string || ''} onChange={(e) => onChange('system_prompt', e.target.value)} />
          </div>
        </>
      );
    case 'http_request':
      return (
        <>
          <div>
            <label className="label">URL</label>
            <input className="input" value={step.config.url as string || ''} onChange={(e) => onChange('url', e.target.value)} />
          </div>
          <div>
            <label className="label">Method</label>
            <select className="input" value={step.config.method as string || 'GET'} onChange={(e) => onChange('method', e.target.value)}>
              <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
            </select>
          </div>
        </>
      );
    case 'conditional_branch':
      return (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Condition</label>
              <select className="input" value={step.config.condition as string || 'contains'} onChange={(e) => onChange('condition', e.target.value)}>
                <option value="contains">Contains</option>
                <option value="equals">Equals</option>
                <option value="starts_with">Starts With</option>
              </select>
            </div>
            <div>
              <label className="label">Field</label>
              <input className="input" value={step.config.field as string || 'response'} onChange={(e) => onChange('field', e.target.value)} />
            </div>
            <div>
              <label className="label">Value</label>
              <input className="input" value={step.config.value as string || 'APPROVE'} onChange={(e) => onChange('value', e.target.value)} />
            </div>
          </div>
        </>
      );
    case 'approval_gate':
      return (
        <div>
          <label className="label">Approval Message</label>
          <input className="input" value={step.config.message as string || ''} onChange={(e) => onChange('message', e.target.value)} />
        </div>
      );
    case 'db_write':
      return (
        <div>
          <label className="label">Result Key</label>
          <input className="input" value={step.config.key as string || 'result'} onChange={(e) => onChange('key', e.target.value)} />
        </div>
      );
    case 'notify':
      return (
        <>
          <div>
            <label className="label">Channel</label>
            <select className="input" value={step.config.channel as string || 'email'} onChange={(e) => onChange('channel', e.target.value)}>
              <option value="email">Email (Resend)</option>
              <option value="slack">Slack webhook</option>
            </select>
          </div>
          {step.config.channel === 'slack' ? (
            <div>
              <label className="label">Slack Webhook URL</label>
              <input className="input" type="url" value={step.config.webhook_url as string || ''} onChange={(e) => onChange('webhook_url', e.target.value)} placeholder="https://hooks.slack.com/services/..." />
              <p className="text-xs text-gray-500 mt-1">Stored only in the owner-controlled workflow config.</p>
            </div>
          ) : (
            <div>
              <label className="label">Recipient Email</label>
              <input className="input" type="email" value={step.config.to as string || ''} onChange={(e) => onChange('to', e.target.value)} placeholder="reviewer@example.com" />
            </div>
          )}
          <div>
            <label className="label">Message</label>
            <textarea className="input h-16" value={step.config.message as string || ''} onChange={(e) => onChange('message', e.target.value)} />
          </div>
        </>
      );
    default:
      return null;
  }
}
