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
   * Whether the action removes the row from the list (delete) vs keeps it (archive).
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

/** One reason a batch mutation refused part of its set, with how many it covers. */
export interface BulkBatchRefusal {
  /** Machine reason, e.g. `mail-authority`. Grouping key, not display text. */
  reason: string
  /** How many items were refused for this reason. */
  count: number
  /** Human tail of the summary line, e.g. `conversations in Support need inbox access`. */
  label: string
}

/**
 * What a `runBatch` mutation returns: how many items it actually processed, and
 * the refusals it declined to process. Partial failure is read off this payload
 * rather than counted from caught throws — one round trip has one outcome.
 */
export interface BulkBatchResult {
  revoked: number
  refused: BulkBatchRefusal[]
}

/**
 * Shared driver for bulk actions on `ListCard` grids: one confirm up front, then
 * a **sequential** loop over the per-item async mutation, collecting failures and
 * surfacing a single summary toast. No new router endpoint — each surface passes
 * the single-item mutation its card menu already uses.
 *
 * `runBatch` is the same choreography over a **single** mutation for the whole
 * set — use it whenever a batch endpoint exists, since the per-item loop costs
 * one round trip per row.
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

  const runBatch = useCallback(
    async (
      ids: string[],
      // `void` is deliberate, not laziness: it is what keeps a caller written as
      // `async () => { await mutateAsync(...) }` assignable here. A mutation with
      // no payload simply reports no refusals.
      // biome-ignore lint/suspicious/noConfusingVoidType: see above
      batchFn: (ids: string[]) => Promise<Partial<BulkBatchResult> | undefined | void>,
      opts: RunOptions
    ) => {
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
      // Every row goes pending up front: one mutation covers the whole set, so
      // there is no per-item settle to stagger the overlays against.
      for (const id of ids) addPending(id)

      // One round trip, one outcome: a rejection means the whole batch failed,
      // while partial failure comes back inside the payload.
      // The `Promise.resolve()` head is what catches a `batchFn` that throws
      // synchronously; without it that throw escapes and strands every overlay.
      const outcome = await Promise.resolve()
        .then(() => batchFn(ids))
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      setIsRunning(false)

      const result = outcome.ok ? outcome.value : undefined
      const refused = result?.refused ?? []

      if (!outcome.ok) {
        toastError({
          title: opts.failureTitle ?? 'Some items could not be processed',
          description:
            outcome.error instanceof Error ? outcome.error.message : 'The request failed.',
        })
      }
      // Keep the overlays only in the case they were designed for: a delete that
      // fully succeeded, where the marker bridges the gap until the list refetch
      // prunes the row. The payload carries counts, not the refused ids, so a
      // partial result cannot say which rows survive — clearing all of them lets
      // the survivors return to normal instead of stranding a permanent overlay.
      if (!outcome.ok || refused.length > 0 || opts.removesItem === false) {
        for (const id of ids) removePending(id)
      }

      if (outcome.ok && refused.length > 0) {
        // Counted off the payload, not off `ids`: a scope-based mutation ("remove
        // all 340") is handed the loaded page's ids, so `ids.length` would be the
        // page size rather than what the server actually touched.
        const done = result?.revoked ?? 0
        const total = done + refused.reduce((sum, r) => sum + r.count, 0)
        toastError({
          title: opts.failureTitle ?? 'Some items could not be processed',
          description: [
            `${done} of ${total} processed.`,
            ...refused.map((r) => `${r.count} ${r.label}.`),
          ].join(' '),
        })
      }
      opts.onDone?.()
    },
    [confirm, addPending, removePending, setPendingLabel]
  )

  return { ConfirmDialog, run, runBatch, isRunning }
}
