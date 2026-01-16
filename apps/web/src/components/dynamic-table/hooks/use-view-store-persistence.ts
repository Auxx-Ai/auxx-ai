// apps/web/src/components/dynamic-table/hooks/use-view-store-persistence.ts
'use client'

import { useCallback, useEffect, useRef } from 'react'
import { api } from '~/trpc/react'
import { useDynamicTableStore } from '../stores/dynamic-table-store'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { toastError } from '@auxx/ui/components/toast'

/** Debounce delay for auto-save (ms) */
const SAVE_DEBOUNCE_MS = 300

/**
 * Hook that manages persistence between the unified store and API.
 * Call this hook in components that need to save view changes.
 *
 * Uses the new unified DynamicTableStore with slices:
 * - All state (views, UI config, filters) is now in one store
 * - Cross-slice reads are consistent (no stale subscriptions)
 *
 * @param viewId - The view ID to manage
 * @param tableId - The table ID (for cache invalidation)
 */
export function useViewStorePersistence(viewId: string | null, tableId: string) {
  const utils = api.useUtils()

  // ─── STORE METHODS ──────────────────────────────────────────────────────────
  const getActiveViewConfig = useDynamicTableStore((state) => state.getActiveViewConfig)
  const hasUnsavedChanges = useDynamicTableStore((state) => state.hasUnsavedChanges)
  const startSaving = useDynamicTableStore((state) => state.startSaving)
  const finishSaving = useDynamicTableStore((state) => state.finishSaving)
  const confirmSave = useDynamicTableStore((state) => state.confirmSave)

  // ─── DIRTY TRACKING ─────────────────────────────────────────────────────────
  // Subscribe to dirty state for auto-save trigger (now from unified store)
  const isDirty = useDynamicTableStore((state) => (viewId ? state.dirtyViewIds.has(viewId) : false))

  // ─── MUTATION ───────────────────────────────────────────────────────────────
  const updateMutation = api.tableView.update.useMutation()

  // Track the last saved config to detect actual changes
  const lastSavedRef = useRef<string | null>(null)

  /** Save view to API */
  const saveView = useCallback(async () => {
    if (!viewId) return
    if (!hasUnsavedChanges(viewId)) return

    const mergedConfig = getActiveViewConfig(tableId)
    if (!mergedConfig) return

    // Serialize to check if actually changed
    const serialized = JSON.stringify(mergedConfig)
    if (serialized === lastSavedRef.current) return

    startSaving(viewId)

    try {
      const result = await updateMutation.mutateAsync({
        id: viewId,
        config: mergedConfig,
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
    tableId,
    hasUnsavedChanges,
    getActiveViewConfig,
    startSaving,
    confirmSave,
    finishSaving,
    updateMutation,
    utils,
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
    isSaving: viewId ? useDynamicTableStore.getState().isSaving(viewId) : false,
  }
}
