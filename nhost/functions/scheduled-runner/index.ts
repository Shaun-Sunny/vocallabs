import { Request, Response } from 'express';

const HASURA_URL = process.env.NHOST_GRAPHQL_URL || process.env.NHOST_HASURA_URL || 'http://hasura:8080/v1/graphql';
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || '';
const FUNCTIONS_URL = process.env.NHOST_FUNCTIONS_URL || 'http://functions:4000/v1';

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

function cronMatches(cronExpr: string, now: Date): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const checks = [
    { field: now.getMinutes(), pattern: minute },
    { field: now.getHours(), pattern: hour },
    { field: now.getDate(), pattern: dayOfMonth },
    { field: now.getMonth() + 1, pattern: month },
    { field: now.getDay(), pattern: dayOfWeek },
  ];

  return checks.every(({ field, pattern }) => {
    if (pattern === '*') return true;
    if (pattern.startsWith('*/')) {
      const interval = parseInt(pattern.slice(2), 10);
      return field % interval === 0;
    }
    return parseInt(pattern, 10) === field;
  });
}

export default async (req: Request, res: Response) => {
  try {
    const suppliedSecret = req.headers['x-hasura-admin-secret'];
    if (suppliedSecret !== ADMIN_SECRET) {
      return res.status(401).json({ message: 'Invalid cron credentials' });
    }

    const payload = req.body.payload || {};

    if (payload.action === 'reset_quotas') {
      await gql(`mutation { update_organizations(where: {}, _set: {quota_used: 0, quota_period_start: "${new Date().toISOString()}"}) { affected_rows } }`);
      return res.json({ message: 'Quotas reset' });
    }

    const now = new Date();
    const triggers = await gql(`
      query GetScheduledTriggers {
        workflow_triggers(where: {trigger_type: {_eq: scheduled}, is_active: {_eq: true}}) {
          id workflow_id config
          workflow { is_active org_id organization { quota_used quota_limit } }
        }
      }
    `);

    const triggered: string[] = [];

    for (const trigger of triggers.workflow_triggers) {
      if (!trigger.workflow?.is_active) continue;
      if (trigger.workflow.organization.quota_used >= trigger.workflow.organization.quota_limit) continue;

      const cronExpr = trigger.config?.cron as string;
      if (!cronExpr || !cronMatches(cronExpr, now)) continue;

      await fetch(`${FUNCTIONS_URL}/trigger-workflow-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hasura-admin-secret': ADMIN_SECRET,
          // Identifies this as a system-initiated call (no user session
          // exists for a cron job) so trigger-workflow-run skips the
          // Layer 1 user/role check instead of rejecting it with 401.
          'x-scheduled-trigger': 'true',
        },
        body: JSON.stringify({
          input: { workflow_id: trigger.workflow_id, trigger_type: 'scheduled' },
        }),
      });

      triggered.push(trigger.workflow_id);
    }

    return res.json({ message: `Processed ${triggered.length} scheduled triggers`, triggered });
  } catch (err) {
    console.error('scheduled-runner error:', err);
    return res.status(500).json({ message: (err as Error).message });
  }
};
