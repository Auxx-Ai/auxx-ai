// apps/web/src/components/manufacturing/stock-setup/use-stock-setup.ts
'use client'

import { useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import type { StockSetupStep } from './stock-setup-href'

export type StockSetupStatus = RouterOutputs['purchasing']['stockSetupStatus']
export type StockSetupStepState = 'todo' | 'done' | 'skipped'

export const STOCK_SETUP_STEPS: { id: StockSetupStep; name: string }[] = [
  { id: 'kinds', name: 'Check parts' },
  { id: 'builds', name: 'Record past builds' },
  { id: 'count', name: 'Count and cost' },
]

function isStep(value: string | null): value is StockSetupStep {
  return value === 'kinds' || value === 'builds' || value === 'count'
}

/** Step states for a status; `skipped` only when the builds step is done by skipping it. */
export function resolveStepStates(
  status: StockSetupStatus | undefined
): Record<StockSetupStep, StockSetupStepState> {
  if (!status) return { kinds: 'todo', builds: 'todo', count: 'todo' }
  return {
    kinds: status.steps.kinds ? 'done' : 'todo',
    builds: status.unbuiltPartCount === 0 ? 'done' : status.buildsSkipped ? 'skipped' : 'todo',
    count: status.steps.count ? 'done' : 'todo',
  }
}

/** The page opens on the first step still to do; with all done, on counting. */
export function firstOpenStep(states: Record<StockSetupStep, StockSetupStepState>): StockSetupStep {
  return STOCK_SETUP_STEPS.find((step) => states[step.id] === 'todo')?.id ?? 'count'
}

/** The page's status read, step states and the `?step=` selection (plans/mrp/17 §5). */
export function useStockSetup() {
  const utils = api.useUtils()
  const [stepParam, setStepParam] = useQueryState('step')
  const status = api.purchasing.stockSetupStatus.useQuery(undefined, {
    // Picks up a finished backflush run while its step is open; the read is one bulk pass.
    refetchInterval: (query) => {
      const open = resolveStepStates(query.state.data)
      const shown = isStep(stepParam) ? stepParam : firstOpenStep(open)
      return query.state.data && shown === 'builds' && open.builds === 'todo' ? 15_000 : false
    },
  })

  const states = useMemo(() => resolveStepStates(status.data), [status.data])
  const selected: StockSetupStep = isStep(stepParam) ? stepParam : firstOpenStep(states)

  const selectStep = useCallback((step: StockSetupStep) => void setStepParam(step), [setStepParam])

  const refresh = useCallback(() => {
    void utils.purchasing.stockSetupStatus.invalidate()
    void utils.gettingStarted.getStatus.invalidate()
  }, [utils])

  return {
    status: status.data,
    // Without an explicit step the selection waits for the status, so it never jumps.
    isLoading: status.isPending && !isStep(stepParam),
    states,
    selected,
    selectStep,
    refresh,
  }
}
