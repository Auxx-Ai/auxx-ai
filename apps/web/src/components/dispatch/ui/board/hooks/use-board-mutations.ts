// apps/web/src/components/dispatch/ui/board/hooks/use-board-mutations.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import type { BoardResult, BoardVisit } from '../types'
import type { DateRange } from './use-board-data'

/**
 * All visit-mutating writes the board makes, each with an optimistic patch of the
 * `dispatch.getBoard` cache (snapshot → patch → rollback-on-error → invalidate-on-settle —
 * the `use-task-completion.ts` recipe adapted to `setQueriesData`-style cache surgery).
 * Realtime echo suppression is free (the acting client's socket id travels on the mutation
 * header automatically — `apps/web/src/trpc/react.tsx`), so no extra bookkeeping is needed
 * here beyond the local optimistic patch.
 */
export function useBoardMutations(range: DateRange) {
  const utils = api.useUtils()

  const patchVisit = useCallback(
    (visitId: string, patch: Partial<BoardVisit>): BoardResult | undefined => {
      const previous = utils.dispatch.getBoard.getData(range)
      if (previous) {
        utils.dispatch.getBoard.setData(range, {
          ...previous,
          visits: previous.visits.map((v) => (v.id === visitId ? { ...v, ...patch } : v)),
        })
      }
      return previous
    },
    [range, utils]
  )

  const rollback = useCallback(
    (previous: BoardResult | undefined) => {
      if (previous) utils.dispatch.getBoard.setData(range, previous)
    },
    [range, utils]
  )

  const settle = useCallback(() => {
    void utils.dispatch.getBoard.invalidate(range)
  }, [range, utils])

  const scheduleVisit = api.dispatch.scheduleVisit.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      const patch: Partial<BoardVisit> = { startTime: vars.startTime, endTime: vars.endTime }
      if (vars.assigneeUserId !== undefined) patch.assigneeUserId = vars.assigneeUserId
      return { previous: patchVisit(vars.visitId, patch) }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error scheduling visit', description: error.message })
    },
    onSettled: settle,
  })

  const unscheduleVisit = api.dispatch.unscheduleVisit.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      return { previous: patchVisit(vars.visitId, { startTime: null, endTime: null }) }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error unscheduling visit', description: error.message })
    },
    onSettled: settle,
  })

  const setVisitStatus = api.dispatch.setVisitStatus.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      return { previous: patchVisit(vars.visitId, { status: vars.status }) }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error updating visit status', description: error.message })
    },
    onSettled: settle,
  })

  const dispatchVisit = api.dispatch.dispatchVisit.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      return { previous: patchVisit(vars.visitId, { dispatchedAt: new Date() }) }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error dispatching visit', description: error.message })
    },
    onSettled: settle,
  })

  return {
    scheduleVisit,
    unscheduleVisit,
    setVisitStatus,
    dispatchVisit,
  }
}
