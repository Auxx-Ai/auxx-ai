// apps/web/src/components/dispatch/ui/board/hooks/use-board-bulk-runner.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'

interface ConfirmSpec {
  /** Confirm dialog title, e.g. `Cancel 7 visits?`. */
  title: string
  /** Confirm dialog body. */
  description?: string
  /** Confirm button label. Default `Confirm`. */
  confirmText?: string
  /** Style the confirm as destructive (red). Default `true`. */
  destructive?: boolean
}

interface RunOptions {
  /** Confirm gate up front — omit for non-destructive actions (Assign, Dispatch) that don't
   * want one; the loop starts immediately. */
  confirm?: ConfirmSpec
  /** Toast title shown when one or more items fail. */
  failureTitle?: string
  /** Noun used in the summary toast, e.g. "3 of 12 visits skipped". Default `items`. */
  failureNoun?: string
  /** Runs once after the loop settles (e.g. clear the selection). */
  onDone?: () => void
}

/**
 * Board-local mirror of `list-selection/use-bulk-runner.ts` (plan 37c §5.2): one optional
 * `useConfirm` gate up front, then a **sequential** loop over the per-item async mutation,
 * collecting failures into a single summary toast. Deliberately drops the list-selection
 * store coupling (`addPending`/`removePending`/`setPendingLabel` drive `ListCard` blur
 * overlays that don't exist on calendar chips) — instead it exposes `pendingVisitIds`, the
 * set of ids currently mid-flight, so the board can dim their chips directly.
 */
export function useBoardBulkRunner() {
  const [confirm, ConfirmDialog] = useConfirm()
  const [isRunning, setIsRunning] = useState(false)
  const [pendingVisitIds, setPendingVisitIds] = useState<Set<string>>(new Set())

  const run = useCallback(
    async (ids: string[], perItem: (id: string) => Promise<unknown>, opts: RunOptions = {}) => {
      if (ids.length === 0) return
      if (opts.confirm) {
        const confirmed = await confirm({
          title: opts.confirm.title,
          description: opts.confirm.description,
          confirmText: opts.confirm.confirmText ?? 'Confirm',
          cancelText: 'Cancel',
          destructive: opts.confirm.destructive ?? true,
        })
        if (!confirmed) return
      }

      setIsRunning(true)
      let failures = 0
      for (const id of ids) {
        setPendingVisitIds((prev) => new Set(prev).add(id))
        try {
          await perItem(id)
        } catch {
          failures++
        } finally {
          setPendingVisitIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }
      }
      setIsRunning(false)

      if (failures > 0) {
        toastError({
          title: opts.failureTitle ?? 'Some items could not be processed',
          description: `${failures} of ${ids.length} ${opts.failureNoun ?? 'items'} skipped`,
        })
      }
      opts.onDone?.()
    },
    [confirm]
  )

  return { ConfirmDialog, run, isRunning, pendingVisitIds }
}
