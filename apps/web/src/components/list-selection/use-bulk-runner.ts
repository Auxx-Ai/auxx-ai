// apps/web/src/components/list-selection/use-bulk-runner.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useListSelection } from './store'

interface RunOptions {
  /** Confirm dialog title, e.g. `Delete 7 workflows?`. */
  title: string
  /** Confirm dialog body. */
  description?: string
  /** Confirm button label. Default `Delete`. */
  confirmText?: string
  /** Style the confirm as destructive (red). Default `true`. */
  destructive?: boolean
  /** Verb shown in each card's pending overlay. Default `Deleting…`. */
  pendingLabel?: string
  /**
   * Whether `perItem` removes the row from the list (delete) vs keeps it (archive).
   * Default `true` (delete): the overlay persists until the list refetch prunes the
   * row, so it never flashes back to a normal row. Set `false` (archive) to clear
   * the overlay as soon as the item settles, since the row stays on screen.
   */
  removesItem?: boolean
  /** Toast title shown when one or more items fail. */
  failureTitle?: string
  /** Runs once after the loop settles (e.g. invalidate the list + exit bulk mode). */
  onDone?: () => void
}

/**
 * Shared driver for bulk actions on `ListCard` grids: one confirm up front, then
 * a **sequential** loop over the per-item async mutation, collecting failures and
 * surfacing a single summary toast. No new router endpoint — each surface passes
 * the single-item mutation its card menu already uses.
 */
export function useBulkRunner() {
  const [confirm, ConfirmDialog] = useConfirm()
  const [isRunning, setIsRunning] = useState(false)
  const addPending = useListSelection((s) => s.addPending)
  const removePending = useListSelection((s) => s.removePending)
  const setPendingLabel = useListSelection((s) => s.setPendingLabel)

  const run = useCallback(
    async (ids: string[], perItem: (id: string) => Promise<unknown>, opts: RunOptions) => {
      if (ids.length === 0) return
      const confirmed = await confirm({
        title: opts.title,
        description: opts.description,
        confirmText: opts.confirmText ?? 'Delete',
        cancelText: 'Cancel',
        destructive: opts.destructive ?? true,
      })
      if (!confirmed) return

      setPendingLabel(opts.pendingLabel ?? 'Deleting…')
      setIsRunning(true)
      let failures = 0
      for (const id of ids) {
        // Mark the card pending → it shows the blurred overlay. For a delete the
        // marker stays until the list refetch removes the row (no flash back to a
        // normal row); for an archive (item stays) we clear it on settle; on
        // failure we always clear it so the card returns to normal.
        addPending(id)
        try {
          await perItem(id)
          if (opts.removesItem === false) removePending(id)
        } catch {
          failures++
          removePending(id)
        }
      }
      setIsRunning(false)

      if (failures > 0) {
        toastError({
          title: opts.failureTitle ?? 'Some items could not be processed',
          description: `${failures} of ${ids.length} failed.`,
        })
      }
      opts.onDone?.()
    },
    [confirm, addPending, removePending, setPendingLabel]
  )

  return { ConfirmDialog, run, isRunning }
}
