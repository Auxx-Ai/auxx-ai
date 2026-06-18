// apps/web/src/components/data-connectors/hooks/use-connector-mutations.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'

/** Statuses the entity mutations stamp optimistically (subset of `DataConnectorStatus`). */
type OptimisticStatus = 'paused' | 'live' | 'syncing'

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
  // so it picks up immediately rather than waiting a full interval.
  const syncNow = useCallback(
    async (id: string) => {
      await patchStatus(
        id,
        'syncing',
        () => syncNowM.mutateAsync({ id }),
        'Could not sync connector'
      )
      void utils.dataConnector.getStatus.invalidate({ id })
    },
    [patchStatus, syncNowM, utils.dataConnector.getStatus]
  )

  // Optimistically drop from the list; returns true on success so the detail
  // view only navigates away on a confirmed delete (and restores on failure).
  const remove = useCallback(
    async (id: string, syncedData: 'keep' | 'archive' | 'delete'): Promise<boolean> => {
      const prevList = utils.dataConnector.list.getData()
      utils.dataConnector.list.setData(undefined, (old) => old?.filter((c) => c.id !== id))
      try {
        await deleteM.mutateAsync({ id, syncedData })
        return true
      } catch (err) {
        utils.dataConnector.list.setData(undefined, prevList)
        toastError({
          title: 'Could not delete connector',
          description: err instanceof Error ? err.message : 'Unknown error',
        })
        return false
      }
    },
    [utils.dataConnector.list, deleteM]
  )

  return {
    pause,
    resume,
    syncNow,
    remove,
    isSyncing: syncNowM.isPending,
    isPausing: updateM.isPending,
    isResuming: updateM.isPending,
    isDeleting: deleteM.isPending,
  }
}
