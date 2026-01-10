// apps/web/src/components/dynamic-table/hooks/use-view-store-persistence.ts
'use client'

import { useCallback, useEffect, useRef } from 'react'
import { api } from '~/trpc/react'
import { useViewStore } from '../stores/view-store'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { toastError } from '@auxx/ui/components/toast'

/** Debounce delay for auto-save (ms) */
const SAVE_DEBOUNCE_MS = 300

/**
 * Hook that manages persistence between view store and API.
 * Call this hook in components that need to save view changes.
 *
 * @param viewId - The view ID to manage
 * @param tableId - The table ID (for cache invalidation)
 */
export function useViewStorePersistence(viewId: string | null, tableId: string) {
  const utils = api.useUtils()

  const getMergedConfig = useViewStore((state) => state.getMergedConfig)
  const hasUnsavedChanges = useViewStore((state) => state.hasUnsavedChanges)
  const startSaving = useViewStore((state) => state.startSaving)
  const finishSaving = useViewStore((state) => state.finishSaving)
  const confirmSave = useViewStore((state) => state.confirmSave)
  const dirtyViewIds = useViewStore((state) => state.dirtyViewIds)

  const updateMutation = api.tableView.update.useMutation()

  // Track the last saved config to detect actual changes
  const lastSavedRef = useRef<string | null>(null)

  /** Save view to API */
  const saveView = useCallback(async () => {
    if (!viewId) return
    if (!hasUnsavedChanges(viewId)) return

    const mergedConfig = getMergedConfig(viewId)
    if (!mergedConfig) return

    // Get the original saved filters to preserve them (don't overwrite with session filters)
    // Session filters live in pending config but should NOT be persisted to DB
    const savedFilters = useViewStore.getState().savedConfigs[viewId]?.filters ?? []

    // Build config to save: use merged config but preserve original saved filters
    const { filters: _sessionFilters, ...restConfig } = mergedConfig
    const configToSave = { ...restConfig, filters: savedFilters }

    // Serialize to check if actually changed
    const serialized = JSON.stringify(configToSave)
    if (serialized === lastSavedRef.current) return

    startSaving(viewId)

    try {
      const result = await updateMutation.mutateAsync({
        id: viewId,
        config: configToSave,
      })

      confirmSave(viewId, result.config)
      lastSavedRef.current = JSON.stringify(result.config)

      // Invalidate React Query cache (for components that still use it)
      utils.tableView.list.invalidate({ tableId })
    } catch (error) {
      toastError({
        title: 'Failed to save view',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      finishSaving(viewId)
    }
  }, [
    viewId,
    hasUnsavedChanges,
    getMergedConfig,
    startSaving,
    confirmSave,
    finishSaving,
    updateMutation,
    utils,
    tableId,
  ])

  /** Debounced save - called automatically when config changes */
  const debouncedSave = useDebouncedCallback(saveView, SAVE_DEBOUNCE_MS)

  // Auto-save when dirty state changes
  useEffect(() => {
    if (!viewId) return
    if (dirtyViewIds.has(viewId)) {
      debouncedSave()
    }
  }, [viewId, dirtyViewIds, debouncedSave])

  // Cleanup debounced callback on unmount
  useEffect(() => {
    return () => {
      debouncedSave.cancel?.()
    }
  }, [debouncedSave])

  return {
    saveView, // Immediate save (for explicit save button)
    isSaving: viewId ? useViewStore.getState().isSaving(viewId) : false,
  }
}
