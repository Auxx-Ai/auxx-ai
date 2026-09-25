// apps/web/src/components/mrp/hooks/use-next-order.ts

'use client'

import { keepPreviousData } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import { clampPercent, excludedIds, toggleExcluded } from '../ui/suppliers/next-order-lines'

export type LiveNextOrder = RouterOutputs['mrp']['recomputeNextOrder']
export type NextOrderPartPlan = LiveNextOrder['plan']['parts'][number]
export type NextOrderBridge = LiveNextOrder['bridges'][number]

export interface UseNextOrder {
  /** Parts unticked on this card; component state only (02 §6.4: unticks are never saved). */
  excluded: ReadonlySet<string>
  toggle: (partId: string) => void
  /** The live plan for the current ticks; the previous ticks' answer while the next one loads. */
  live: LiveNextOrder | undefined
  isFetching: boolean
  error: string | null
  /** The "+x %" on top of every order line; UI-only, reset on reload. */
  percent: number
  setPercent: (value: number) => void
}

/** A scheduled supplier's next order for the current ticks, via `mrp.recomputeNextOrder`. */
export function useNextOrder({
  supplierId,
  runId,
  enabled = true,
}: {
  supplierId: string
  runId?: string | null
  enabled?: boolean
}): UseNextOrder {
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set())
  const [percent, setPercentState] = useState(0)

  const input = useMemo(
    () => ({ supplierId, excludedPartIds: excludedIds(excluded), runId: runId ?? null }),
    [supplierId, excluded, runId]
  )
  // Even with nothing unticked: the stored items carry the order date as each part's order-by, the live plan its own.
  const query = api.mrp.recomputeNextOrder.useQuery(input, {
    enabled,
    placeholderData: keepPreviousData,
  })

  const toggle = useCallback(
    (partId: string) => setExcluded((prev) => toggleExcluded(prev, partId)),
    []
  )
  const setPercent = useCallback((value: number) => setPercentState(clampPercent(value)), [])

  return {
    excluded,
    toggle,
    live: query.data,
    isFetching: query.isFetching,
    error: query.error?.message ?? null,
    percent,
    setPercent,
  }
}
