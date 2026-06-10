// apps/web/src/components/kopilot/hooks/use-task-watchers.tsx
//
// Per-kind terminal detection for task watches. Each kind contributes a
// headless watcher component; `KopilotRuntime` mounts one per active watch.
// The browser-side poll is only a *detector* — the completion event of record
// stays the worker's DB write (plans/kopilot/task-notifications/plan.md §D).

'use client'

import type { ComponentType } from 'react'
import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { type TaskWatch, taskWatchKey, useTaskWatchStore } from '../stores/task-watch-store'

export interface TaskWatcherProps {
  watch: TaskWatch
}

/** Suite orchestration statuses that mean "stop watching". */
const EVAL_SUITE_TERMINAL = new Set(['completed', 'cancelled', 'error'])

/**
 * Poll the suite-run status (~4s) while the watch is live and flip it to
 * terminal-queued on the first terminal tick. A few seconds of latency on a
 * minutes-long task is invisible; no dedicated suite SSE channel needed in v1.
 */
function EvalSuiteWatcher({ watch }: TaskWatcherProps) {
  const markTerminal = useTaskWatchStore((s) => s.markTerminal)
  const watching = watch.state === 'watching'

  const suite = api.eval.getSuiteRun.useQuery(
    { suiteRunId: watch.ref },
    { enabled: watching, refetchInterval: watching ? 4000 : false }
  )

  const status = suite.data?.status
  useEffect(() => {
    if (watching && status && EVAL_SUITE_TERMINAL.has(status)) {
      markTerminal(taskWatchKey(watch))
    }
  }, [watching, status, markTerminal, watch])

  return null
}

/**
 * kind → watcher component. Adding a task-notification consumer client-side =
 * one watcher entry here (the server side is a kind handler in
 * `@auxx/lib/ai/kopilot/task-notifications`).
 */
export const TASK_WATCHERS: Record<string, ComponentType<TaskWatcherProps>> = {
  'eval-suite': EvalSuiteWatcher,
}
