// apps/web/src/components/manufacturing/stock-setup/use-stock-setup.ts
'use client'

import { useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import type { StockSetupStep } from './stock-setup-href'

export type StockSetupStatus = RouterOutputs['purchasing']['stockSetupStatus']
export type StockSetupStepState = 'todo' | 'done' | 'skipped' | 'empty'

export const STOCK_SETUP_STEPS: { id: StockSetupStep; name: string }[] = [
  { id: 'kinds', name: 'Check parts' },
  { id: 'costs', name: 'Set costs' },
  { id: 'builds', name: 'Record past builds' },
  { id: 'count', name: 'Count stock' },
]

function isStep(value: string | null): value is StockSetupStep {
  return STOCK_SETUP_STEPS.some((step) => step.id === value)
}

/**
 * Step states for a status; `skipped` only when a step is done by skipping it, `empty` when
 * there is nothing for it to act on yet (no parts, or no part that moved).
 */
export function resolveStepStates(
  status: StockSetupStatus | undefined
): Record<StockSetupStep, StockSetupStepState> {
  if (!status) return { kinds: 'todo', costs: 'todo', builds: 'todo', count: 'todo' }
  const moved = status.hasStockedMovements
  return {
    kinds: status.stockedPartCount === 0 ? 'empty' : status.steps.kinds ? 'done' : 'todo',
    costs: !moved
      ? 'empty'
      : status.neededUncostedCount === 0
        ? 'done'
        : status.costsSkipped
          ? 'skipped'
          : 'todo',
    builds: !moved
      ? 'empty'
      : status.unbuiltPartCount === 0
        ? 'done'
        : status.buildsSkipped
          ? 'skipped'
          : 'todo',
    count: status.steps.count ? 'done' : 'todo',
  }
}

/** The page opens on the first step not yet done or skipped; with all done, on counting. */
export function firstOpenStep(states: Record<StockSetupStep, StockSetupStepState>): StockSetupStep {
  return (
    STOCK_SETUP_STEPS.find((step) => states[step.id] === 'todo' || states[step.id] === 'empty')
      ?.id ?? 'count'
  )
}

/** The page's status read, step states and the `?step=` selection (plans/mrp/17 §5). */
export function useStockSetup() {
  const utils = api.useUtils()
  const [stepParam, setStepParam] = useQueryState('step')
  // Writers on this page invalidate it; a finished backflush run does so via `onFinished`.
  const status = api.purchasing.stockSetupStatus.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
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
