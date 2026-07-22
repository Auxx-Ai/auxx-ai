// apps/web/src/components/dispatch/ui/board/hooks/use-board-bulk-actions.ts

'use client'

import { useCallback } from 'react'
import type { useBoardBulkRunner } from './use-board-bulk-runner'
import type { useBoardMutations } from './use-board-mutations'

const noun = (n: number) => `${n} visit${n === 1 ? '' : 's'}`

interface UseBoardBulkActionsArgs {
  mutations: ReturnType<typeof useBoardMutations>
  bulkRunner: ReturnType<typeof useBoardBulkRunner>
  /** Runs after backlog/cancel settle — clears the board selection. */
  onClearSelection: () => void
}

/**
 * The board's bulk visit actions (plan 44 §6), parameterized by a target id set instead of baking
 * in the current selection — so the bulk bar (targets `selectedVisitIds`) and the chip context menu
 * (targets its resolved right-click ids) drive the IDENTICAL runner: same confirm gates, same
 * sequential loop over the single-visit mutations, same summary toast + `pendingVisitIds` dimming.
 * Cancel IS the delete semantics on the board (visits cancel, never hard-delete — 37c §5.2).
 */
export interface BoardBulkActions {
  /** `assigneeWorkerId` is a `DispatchWorker.id` (individual or team) — never a `User.id`. */
  assign: (ids: string[], assigneeWorkerId: string | null) => void
  dispatch: (ids: string[]) => void
  moveToBacklog: (ids: string[]) => void
  cancel: (ids: string[]) => void
}

export function useBoardBulkActions({
  mutations,
  bulkRunner,
  onClearSelection,
}: UseBoardBulkActionsArgs): BoardBulkActions {
  const { run } = bulkRunner

  const assign = useCallback(
    (ids: string[], assigneeWorkerId: string | null) => {
      void run(ids, (visitId) => mutations.assignVisit.mutateAsync({ visitId, assigneeWorkerId }), {
        failureTitle: 'Some visits could not be assigned',
        failureNoun: 'visits',
      })
    },
    [run, mutations.assignVisit]
  )

  const dispatch = useCallback(
    (ids: string[]) => {
      void run(ids, (visitId) => mutations.dispatchVisit.mutateAsync({ visitId }), {
        failureTitle: 'Some visits could not be dispatched',
        failureNoun: 'visits',
      })
    },
    [run, mutations.dispatchVisit]
  )

  const moveToBacklog = useCallback(
    (ids: string[]) => {
      void run(ids, (visitId) => mutations.unscheduleVisit.mutateAsync({ visitId }), {
        failureTitle: 'Some visits could not be moved to the backlog',
        failureNoun: 'visits',
        onDone: onClearSelection,
      })
    },
    [run, mutations.unscheduleVisit, onClearSelection]
  )

  const cancel = useCallback(
    (ids: string[]) => {
      void run(
        ids,
        (visitId) => mutations.setVisitStatus.mutateAsync({ visitId, status: 'canceled' }),
        {
          confirm: {
            title: `Cancel ${noun(ids.length)}?`,
            description: 'This cannot be undone.',
            confirmText: 'Cancel visits',
            destructive: true,
          },
          failureTitle: 'Some visits could not be canceled',
          failureNoun: 'visits',
          onDone: onClearSelection,
        }
      )
    },
    [run, mutations.setVisitStatus, onClearSelection]
  )

  return { assign, dispatch, moveToBacklog, cancel }
}
