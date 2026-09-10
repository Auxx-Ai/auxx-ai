// apps/web/src/components/data-connectors/hooks/use-connector-mutations.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'

/** Statuses the entity mutations stamp optimistically (subset of `DataConnectorStatus`). */
type OptimisticStatus = 'paused' | 'live' | 'syncing' | 'ready' | 'deleting'

/**
 * Optimistic connector-entity mutations against the `list` + `getById` caches,
 * with rollback. `pause`/`resume`/`remove` are authoritative (the mutation owns
 * the resulting state). `syncNow` is a cosmetic bridge — it stamps `syncing` so
 * the UI reacts instantly, then the polled `getStatus` / ConnectorRunsPanel
 * reflects real worker progress; we do NOT model the sync result optimistically.
 * No Zustand store — RQ caches are the single client store (plan §3).
 *
 * See plans/data-connectors/claude/06-frontend-update-handling.md §4.
 */
export function useConnectorMutations() {
  const utils = api.useUtils()

  const syncNowM = api.dataConnector.syncNow.useMutation()
  const finishSetupM = api.dataConnector.finishSetup.useMutation()
  const backfillM = api.dataConnector.backfillPendingChange.useMutation()
  const confirmOrphanArchivalM = api.dataConnector.confirmOrphanArchival.useMutation()
  // Pause/resume are a `status` patch through the shared `update` route.
  const updateM = api.dataConnector.update.useMutation()
  const deleteM = api.dataConnector.delete.useMutation()

  // Patch a connector's status across both caches, run, roll back on error.
  const patchStatus = useCallback(
    async (
      id: string,
      status: OptimisticStatus,
      run: () => Promise<unknown>,
      errorTitle: string
    ) => {
      const prevList = utils.dataConnector.list.getData()
      const prevById = utils.dataConnector.getById.getData({ id })
      utils.dataConnector.list.setData(undefined, (old) =>
        old?.map((c) => (c.id === id ? { ...c, status } : c))
      )
      utils.dataConnector.getById.setData({ id }, (old) => (old ? { ...old, status } : old))
      try {
        await run()
      } catch (err) {
        utils.dataConnector.list.setData(undefined, prevList)
        utils.dataConnector.getById.setData({ id }, prevById)
        toastError({
          title: errorTitle,
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    },
    [utils.dataConnector.list, utils.dataConnector.getById]
  )

  const pause = useCallback(
    (id: string) =>
      patchStatus(
        id,
        'paused',
        () => updateM.mutateAsync({ id, status: 'paused' }),
        'Could not pause connector'
      ),
    [patchStatus, updateM]
  )

  const resume = useCallback(
    // Resume returns to an active state; patch to 'live' optimistically — the
    // next getStatus poll corrects it (e.g. straight to 'syncing').
    (id: string) =>
      patchStatus(
        id,
        'live',
        () => updateM.mutateAsync({ id, status: 'live' }),
        'Could not resume connector'
      ),
    [patchStatus, updateM]
  )

  // Cosmetic bridge: stamp 'syncing' so the button disables + pill flips now.
  // Truth comes from the worker via polling; on settle, nudge the getStatus poll
  // so it picks up immediately rather than waiting a full interval. `sampleLimit`
  // (trial-sync §4.1) makes it a sample run — a few of each stream, then parks for review.
  const syncNow = useCallback(
    async (id: string, opts?: { sampleLimit?: number }) => {
      await patchStatus(
        id,
        'syncing',
        () => syncNowM.mutateAsync({ id, sampleLimit: opts?.sampleLimit }),
        'Could not sync connector'
      )
      void utils.dataConnector.getStatus.invalidate({ id })
    },
    [patchStatus, syncNowM, utils.dataConnector.getStatus]
  )

  // "Sample sync" — a bounded first look (trial-sync §5.3). Same cosmetic bridge as
  // syncNow; the run parks `paused` once each stream has sampled `sampleLimit` records.
  const sampleSync = useCallback(
    (id: string, sampleLimit: number) => syncNow(id, { sampleLimit }),
    [syncNow]
  )

  // "Finish without syncing" — leave first-run setup configured-but-idle (optional-
  // first-sync §3.4). Stamp 'ready' optimistically so the stepper collapses to the flat
  // editor at once, then invalidate getById + list so the parent re-queries the truth.
  const finishSetup = useCallback(
    async (id: string) => {
      await patchStatus(
        id,
        'ready',
        () => finishSetupM.mutateAsync({ id }),
        'Could not finish setup'
      )
      void utils.dataConnector.getById.invalidate({ id })
      void utils.dataConnector.list.invalidate()
    },
    [patchStatus, finishSetupM, utils.dataConnector.getById, utils.dataConnector.list]
  )

  // "Backfill now" — same cosmetic bridge as syncNow (stamp 'syncing' so the banner's
  // button + pill react instantly), then nudge the getStatus poll. The backfill
  // finalize clears `resyncPending`, which removes the banner.
  const backfillPending = useCallback(
    async (id: string) => {
      await patchStatus(
        id,
        'syncing',
        () => backfillM.mutateAsync({ id }),
        'Could not start backfill'
      )
      void utils.dataConnector.getStatus.invalidate({ id })
    },
    [patchStatus, backfillM, utils.dataConnector.getStatus]
  )

  // "Archive N records anyway" (v12.1 Phase 3c) — the archive-cap banner's action. Same
  // cosmetic bridge as syncNow: the override is written and a sync enqueued, so stamp
  // 'syncing' and nudge the poll. The run's clean pass clears `archiveCapTripped`,
  // which removes the banner.
  const confirmOrphanArchival = useCallback(
    async (id: string) => {
      await patchStatus(
        id,
        'syncing',
        () => confirmOrphanArchivalM.mutateAsync({ id }),
        'Could not archive the removed records'
      )
      void utils.dataConnector.getStatus.invalidate({ id })
    },
    [patchStatus, confirmOrphanArchivalM, utils.dataConnector.getStatus]
  )

  // Returns true on success so the detail view only navigates away on a confirmed
  // delete (and restores on failure).
  //
  // 🛑 Only `keep` drops the row optimistically, because only `keep` actually
  // removes it: it runs `finalizeConnectorTeardown` inline and returns. `archive`
  // and `delete` hand the work to the teardown chain, and the connector row is
  // deliberately KEPT as that chain's anchor — `DataConnectorItem` cascades with
  // it and those rows are the record selection, so it cannot be deleted up front.
  // Dropping it from the list anyway made the connector vanish and then reappear
  // on the next refetch, which reads as a failed delete. It stays, showing
  // `Removing`, until the last slice takes it.
  const remove = useCallback(
    async (id: string, syncedData: 'keep' | 'archive' | 'delete'): Promise<boolean> => {
      const removesRowNow = syncedData === 'keep'
      const prevList = utils.dataConnector.list.getData()
      const prevById = utils.dataConnector.getById.getData({ id })
      if (removesRowNow) {
        utils.dataConnector.list.setData(undefined, (old) => old?.filter((c) => c.id !== id))
      } else {
        // 🛑 Patch BOTH caches, exactly as `patchStatus` does. Stamping only the
        // list left the detail page reading a pre-click `getById`, so opening the
        // connector you had just asked to delete showed it as though nothing had
        // happened — no Removing pill, no banner, a live Sync button — until a
        // manual reload. The value is not a guess: `deleteConnector` writes
        // `deleting` before it returns.
        utils.dataConnector.list.setData(undefined, (old) =>
          old?.map((c) => (c.id === id ? { ...c, status: 'deleting' as const } : c))
        )
        utils.dataConnector.getById.setData({ id }, (old) =>
          old ? { ...old, status: 'deleting' as const } : old
        )
      }
      try {
        await deleteM.mutateAsync({ id, syncedData })
        // `getStatus` is the detail view's other source and it outranks `getById`
        // (`live?.status ?? connector.status`), so a stale entry there would win
        // over the patch above.
        if (!removesRowNow) {
          void utils.dataConnector.getStatus.invalidate({ id })
          void utils.dataConnector.list.invalidate()
        }
        return true
      } catch (err) {
        utils.dataConnector.getById.setData({ id }, prevById)
        utils.dataConnector.list.setData(undefined, prevList)
        toastError({
          title: 'Could not delete connector',
          description: err instanceof Error ? err.message : 'Unknown error',
        })
        return false
      }
    },
    [utils.dataConnector.list, utils.dataConnector.getById, utils.dataConnector.getStatus, deleteM]
  )

  return {
    pause,
    resume,
    syncNow,
    sampleSync,
    finishSetup,
    backfillPending,
    confirmOrphanArchival,
    remove,
    isSyncing: syncNowM.isPending,
    isFinishing: finishSetupM.isPending,
    isBackfilling: backfillM.isPending,
    isConfirmingOrphanArchival: confirmOrphanArchivalM.isPending,
    isPausing: updateM.isPending,
    isResuming: updateM.isPending,
    isDeleting: deleteM.isPending,
  }
}
