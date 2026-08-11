'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from 'graphql-ws';
import { graphqlUrl } from './nhost';
import type { StepRun, RunStatus } from './nhost';

interface UseLiveRunOptions {
  runId: string | null;
  token: string | null;
}

export function useLiveRun({ runId, token }: UseLiveRunOptions) {
  const [stepRuns, setStepRuns] = useState<StepRun[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null);

  const wsUrl = graphqlUrl.replace(/^http/, 'ws');

  const subscribe = useCallback(() => {
    if (!runId || !token) return;

    const client = createClient({
      url: wsUrl,
      connectionParams: { headers: { Authorization: `Bearer ${token}` } },
    });
    clientRef.current = client;

    const unsubSteps = client.subscribe(
      {
        query: `
          subscription($runId: uuid!) {
            step_runs(where: {workflow_run_id: {_eq: $runId}}, order_by: {created_at: asc}) {
              id workflow_step_id status input output error attempt_count
              approved_by approved_at started_at completed_at
              workflow_step { name step_type position }
            }
          }
        `,
        variables: { runId },
      },
      {
        next: (data) => {
          if (data.data?.step_runs) {
            setStepRuns(data.data.step_runs as StepRun[]);
          }
          setConnected(true);
        },
        error: (err) => {
          console.error('Step runs subscription error:', err);
          setConnected(false);
        },
        complete: () => setConnected(false),
      }
    );

    const unsubRun = client.subscribe(
      {
        query: `
          subscription($runId: uuid!) {
            workflow_runs_by_pk(id: $runId) { id status started_at completed_at error }
          }
        `,
        variables: { runId },
      },
      {
        next: (data) => {
          const run = data.data?.workflow_runs_by_pk as { status: RunStatus } | null | undefined;
          if (run) {
            setRunStatus(run.status);
          }
        },
        error: (err) => console.error('Run subscription error:', err),
        complete: () => {},
      }
    );

    return () => {
      unsubSteps();
      unsubRun();
      client.dispose();
    };
  }, [runId, token, wsUrl]);

  useEffect(() => {
    const cleanup = subscribe();
    return cleanup;
  }, [subscribe]);

  return { stepRuns, runStatus, connected };
}
