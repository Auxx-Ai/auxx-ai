// apps/web/src/components/dynamic-table/hooks/use-view-store-persistence-new.ts
'use client'

import { useCallback, useEffect, useRef } from 'react'
import { api } from '~/trpc/react'
import { useViewStore } from '../stores/view-store-new'
import { useTableUIStore } from '../stores/table-ui-store'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { toastError } from '@auxx/ui/components/toast'

/** Debounce delay for auto-save (ms) */
const SAVE_DEBOUNCE_MS = 300

/**
 * Hook that manages persistence between view store and API.
 * Call this hook in components that need to save view changes.
 *
 * Migrated to use new store architecture:
 * - ViewStore: Metadata and coordination
 * - TableUIStore: UI configuration (columns, sorting, etc.)
 * - FilterStore: Filters (saved to DB)
 *
 * @param viewId - The view ID to manage
 * @param tableId - The table ID (for cache invalidation)
 */
export function useViewStorePersistence(viewId: string | null, tableId: string) {
  const utils = api.useUtils()

  // ─── STORE METHODS ──────────────────────────────────────────────────────────
  const getMergedConfig = useViewStore((state) => state.getMergedConfig)
  const hasUnsavedChanges = useViewStore((state) => state.hasUnsavedChanges)
  const startSaving = useViewStore((state) => state.startSaving)
  const finishSaving = useViewStore((state) => state.finishSaving)
  const confirmSave = useViewStore((state) => state.confirmSave)

  // ─── DIRTY TRACKING ─────────────────────────────────────────────────────────
  // Subscribe to TableUIStore's dirty state for auto-save trigger
  const isDirty = useTableUIStore((state) => (viewId ? state.dirtyViewIds.has(viewId) : false))

  // ─── MUTATION ───────────────────────────────────────────────────────────────
  const updateMutation = api.tableView.update.useMutation()

  // Track the last saved config to detect actual changes
  const lastSavedRef = useRef<string | null>(null)

  /** Save view to API */
  const saveView = useCallback(async () => {
    if (!viewId) return
    if (!hasUnsavedChanges(viewId)) return

    const mergedConfig = getMergedConfig(viewId)
    if (!mergedConfig) return

    // In the new architecture, filters are cleanly separated:
    // - viewFilters[viewId] = saved filters (persisted to DB)
    // - sessionFilters[tableId] = session filters (NOT persisted)
    //
    // getMergedConfig already returns the correct saved filters from FilterStore,
    // so we don't need to manually preserve them like in the old hook.
    const configToSave = mergedConfig

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

  // ─── AUTO-SAVE TRIGGER ──────────────────────────────────────────────────────
  // Auto-save when dirty state changes
  useEffect(() => {
    if (!viewId) return
    if (isDirty) {
      debouncedSave()
    }
  }, [viewId, isDirty, debouncedSave])

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
