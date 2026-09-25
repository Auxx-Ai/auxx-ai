// apps/web/src/components/mrp/hooks/use-mrp-run.ts

'use client'

import { parseAsString, useQueryState } from 'nuqs'
import { useCallback } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'

export type MrpRun = NonNullable<RouterOutputs['mrp']['summary']['run']>
export type MrpRunAttempt = RouterOutputs['mrp']['runs'][number]

export interface UseMrpRun {
  /** `?run=`; undefined reads the latest completed run. */
  runId: string | undefined
  /** The completed run every read answers from; null when the org has none, undefined while loading. */
  run: MrpRun | null | undefined
  /** The newest finished attempt when it failed after `run` (or with no `run` at all); null otherwise. */
  failedRun: MrpRunAttempt | null
  /** A run is being planned right now, per the runs list. */
  isRunning: boolean
  isLoading: boolean
  isPinned: boolean
  pin: (runId: string) => void
  clear: () => void
}

/** The run every MRP page reads: `?run=` pinned to an older one, or the latest completed. */
export function useMrpRun(): UseMrpRun {
  const [param, setParam] = useQueryState('run', parseAsString)
  const runId = param ?? undefined
  // The page's `mrp.summary` call uses the same input, so this is one request.
  const summary = api.mrp.summary.useQuery({ runId: runId ?? null })
  const runs = api.mrp.runs.useQuery({ limit: 5 })

  const run = summary.data ? summary.data.run : undefined
  const attempts = runs.data ?? []
  const lastFinished = attempts.find((attempt) => attempt.status !== 'running') ?? null
  const failedRun =
    !runId &&
    lastFinished?.status === 'failed' &&
    (!run || lastFinished.startedAt.getTime() > run.startedAt.getTime())
      ? lastFinished
      : null

  const pin = useCallback((id: string) => void setParam(id), [setParam])
  const clear = useCallback(() => void setParam(null), [setParam])

  return {
    runId,
    run,
    failedRun,
    isRunning: attempts[0]?.status === 'running',
    isLoading: summary.isPending || runs.isPending,
    isPinned: !!runId,
    pin,
    clear,
  }
}
