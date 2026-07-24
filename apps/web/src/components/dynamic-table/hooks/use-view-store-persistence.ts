// apps/web/src/components/dynamic-table/hooks/use-view-store-persistence.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef } from 'react'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { DYNAMIC_TABLE_CONFIG } from '../config/table-config'
import { useDynamicTableStore } from '../stores/dynamic-table-store'
import type { TableView } from '../types'
import { tableViewPreferenceKey } from '../utils/constants'
import {
  hasPresentationPreference,
  toTableViewPreferenceConfig,
} from '../utils/table-view-preference'

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
export function useViewStorePersistence(view: TableView | null, tableId: string) {
  const utils = api.useUtils()
  const viewId = view?.id ?? null

  // ─── STORE METHODS ──────────────────────────────────────────────────────────
  const getActiveViewConfig = useDynamicTableStore((state) => state.getActiveViewConfig)
  const hasUnsavedChanges = useDynamicTableStore((state) => state.hasUnsavedChanges)
  const startSaving = useDynamicTableStore((state) => state.startSaving)
  const finishSaving = useDynamicTableStore((state) => state.finishSaving)
  const confirmSave = useDynamicTableStore((state) => state.confirmSave)
  const clearPersonalConfig = useDynamicTableStore((state) => state.clearPersonalConfig)
  const clearPersonalFilters = useDynamicTableStore((state) => state.clearPersonalFilters)
  const upsertViewPreference = useDynamicTableStore((state) => state.upsertViewPreference)
  const clearViewPreference = useDynamicTableStore((state) => state.clearViewPreference)

  // ─── DIRTY TRACKING ─────────────────────────────────────────────────────────
  // Subscribe to dirty state for auto-save trigger (now from unified store)
  const isDirty = useDynamicTableStore((state) => (viewId ? state.dirtyViewIds.has(viewId) : false))
  const personalConfig = useDynamicTableStore((state) =>
    viewId && view?.isShared ? state.personalConfigs[viewId] : undefined
  )
  const personalFilters = useDynamicTableStore((state) =>
    viewId && view?.isShared ? state.personalFilters[viewId] : undefined
  )
  const savedPreference = useDynamicTableStore((state) =>
    viewId ? state.viewPreferences[tableViewPreferenceKey(tableId, viewId)] : undefined
  )

  // ─── MUTATION ───────────────────────────────────────────────────────────────
  const updateMutation = api.tableView.update.useMutation()
  const upsertPreference = api.tableView.upsertPreference.useMutation({
    onSuccess: upsertViewPreference,
    onError: (error) => {
      toastError({ title: 'Failed to save table preferences', description: error.message })
    },
  })
  const deletePreference = api.tableView.deletePreference.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to reset table preferences', description: error.message })
    },
  })

  // Track the last saved config to detect actual changes
  const lastSavedRef = useRef<string | null>(null)
  const lastPreferenceRef = useRef<string | null>(null)
  const preferenceWriteRef = useRef<Promise<unknown> | null>(null)

  useEffect(() => {
    lastPreferenceRef.current = savedPreference ? JSON.stringify(savedPreference.config) : null
  }, [savedPreference])

  const persistPreference = useCallback(() => {
    if (!viewId || !view?.isShared || !personalConfig) return
    const config = toTableViewPreferenceConfig(personalConfig)
    if (!hasPresentationPreference(config) && !savedPreference) return

    const serialized = JSON.stringify(config)
    if (serialized === lastPreferenceRef.current) return
    lastPreferenceRef.current = serialized
    const previousWrite = preferenceWriteRef.current ?? Promise.resolve()
    const nextWrite = previousWrite
      .then(() => upsertPreference.mutateAsync({ tableId, tableViewId: viewId, config }))
      .catch(() => undefined)
    preferenceWriteRef.current = nextWrite
    void nextWrite.finally(() => {
      if (preferenceWriteRef.current === nextWrite) preferenceWriteRef.current = null
    })
  }, [viewId, view?.isShared, personalConfig, savedPreference, upsertPreference, tableId])

  const debouncedPreferenceSave = useDebouncedCallback(
    persistPreference,
    DYNAMIC_TABLE_CONFIG.AUTO_SAVE_DEBOUNCE_MS
  )

  useEffect(() => {
    if (!view?.isShared || !personalConfig) return
    debouncedPreferenceSave()
  }, [view?.isShared, personalConfig, debouncedPreferenceSave])

  /** Save view to API */
  const saveView = useCallback(async () => {
    if (!viewId) return
    if (view?.isShared && !view.canUpdate) return
    if (!view?.isShared && !hasUnsavedChanges(viewId)) return

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

      if (view?.isShared) {
        debouncedPreferenceSave.cancel?.()
        await preferenceWriteRef.current
        clearPersonalConfig(viewId)
        clearPersonalFilters(viewId)
        await deletePreference.mutateAsync({ tableId, tableViewId: viewId })
        clearViewPreference(tableId, viewId)
        lastPreferenceRef.current = null
      }

      // Invalidate React Query cache (for components that still use it)
      utils.tableView.listAll.invalidate()
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
    view?.isShared,
    view?.canUpdate,
    tableId,
    hasUnsavedChanges,
    getActiveViewConfig,
    startSaving,
    confirmSave,
    clearPersonalConfig,
    clearPersonalFilters,
    clearViewPreference,
    finishSaving,
    updateMutation,
    deletePreference,
    debouncedPreferenceSave,
    utils,
  ])

  /** Debounced save - called automatically when config changes */
  const debouncedSave = useDebouncedCallback(saveView, DYNAMIC_TABLE_CONFIG.AUTO_SAVE_DEBOUNCE_MS)

  // ─── AUTO-SAVE TRIGGER ──────────────────────────────────────────────────────
  // Auto-save when dirty state changes (only if auto-save is enabled)
  useEffect(() => {
    if (!viewId || view?.isShared) return
    // Skip auto-save if disabled - user must manually click save
    if (!DYNAMIC_TABLE_CONFIG.AUTO_SAVE_ENABLED) return
    if (isDirty) {
      debouncedSave()
    }
  }, [viewId, view?.isShared, isDirty, debouncedSave])

  const resetPersonalization = useCallback(async () => {
    if (!viewId || !view?.isShared) return
    debouncedPreferenceSave.cancel?.()
    await preferenceWriteRef.current
    clearPersonalConfig(viewId)
    clearPersonalFilters(viewId)
    clearViewPreference(tableId, viewId)
    lastPreferenceRef.current = null
    await deletePreference.mutateAsync({ tableId, tableViewId: viewId })
  }, [
    viewId,
    view?.isShared,
    tableId,
    clearPersonalConfig,
    clearPersonalFilters,
    clearViewPreference,
    deletePreference,
    debouncedPreferenceSave,
  ])

  // Cleanup debounced callback on unmount
  useEffect(() => {
    return () => {
      debouncedSave.cancel?.()
      debouncedPreferenceSave.cancel?.()
    }
  }, [debouncedSave, debouncedPreferenceSave])

  // Subscribe to isSaving state for reactivity
  const isSaving = useDynamicTableStore((state) => (viewId ? state.isSaving(viewId) : false))
  const hasPersonalization = Boolean(
    view?.isShared && (personalConfig || personalFilters || savedPreference)
  )

  return {
    saveView, // Immediate save (for explicit save button)
    resetPersonalization,
    hasPersonalization,
    isSaving,
  }
}
