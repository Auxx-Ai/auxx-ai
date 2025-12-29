// apps/web/src/components/dynamic-table/hooks/use-view-persistence.ts

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import type {
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  SortingState,
  Table,
  VisibilityState,
} from '@tanstack/react-table'
import type { TableFilter, TableView, ViewConfig, ColumnFormatting } from '../types'
import { areViewConfigsEqual, buildViewConfig, normalizeViewConfig } from '../utils/view-config'

/**
 * Parameters for the view persistence hook.
 */
export interface UseViewPersistenceProps<TData> {
  table: Table<TData>
  currentView: TableView | null | undefined
  enabled: boolean
  filters?: TableFilter[]
  columnVisibility?: VisibilityState
  columnSizing?: ColumnSizingState
  columnOrder?: ColumnOrderState
  columnPinning?: ColumnPinningState
  columnLabels?: Record<string, string>
  columnFormatting?: Record<string, ColumnFormatting>
  sorting?: SortingState
}

/**
 * Persistent view management helpers exposed to the table components.
 */
export interface ViewPersistenceState {
  currentConfig: ViewConfig
  hasUnsavedChanges: boolean
  isSaving: boolean
  error: unknown
  save: () => Promise<void>
  markClean: (config?: ViewConfig) => void
  getLastSavedConfig: () => ViewConfig | null
}

/**
 * Hook that encapsulates manual view persistence with dirty-state tracking.
 */
export function useViewPersistence<TData>(
  props: UseViewPersistenceProps<TData>
): ViewPersistenceState {
  const updateViewMutation = api.tableView.update.useMutation()
  const lastSavedConfigRef = useRef<ViewConfig | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [savedVersion, setSavedVersion] = useState(0)

  const currentViewId = props.currentView?.id ?? null
  const currentViewConfig = props.currentView?.config
  const persistenceEnabled = props.enabled && !!currentViewId

  const columnVisibility =
    props.columnVisibility ?? props.table.getState().columnVisibility
  const columnSizing = props.columnSizing ?? props.table.getState().columnSizing
  const columnOrder = props.columnOrder ?? props.table.getState().columnOrder
  const columnPinning = props.columnPinning ?? props.table.getState().columnPinning
  const sorting = props.sorting ?? props.table.getState().sorting

  const currentConfig = useMemo(
    () =>
      buildViewConfig({
        sorting,
        columnVisibility,
        columnOrder,
        columnSizing,
        columnPinning,
        columnLabels: props.columnLabels,
        columnFormatting: props.columnFormatting,
        filters: props.filters,
      }),
    [
      sorting,
      columnVisibility,
      columnOrder,
      columnSizing,
      columnPinning,
      props.columnLabels,
      props.columnFormatting,
      props.filters,
    ]
  )

  useEffect(() => {
    if (!persistenceEnabled || !currentViewConfig) {
      lastSavedConfigRef.current = null
      setHasUnsavedChanges(false)
      setSavedVersion((version) => version + 1)
      return
    }

    lastSavedConfigRef.current = normalizeViewConfig(currentViewConfig)
    setSavedVersion((version) => version + 1)
  }, [currentViewConfig, currentViewId, persistenceEnabled])

  useEffect(() => {
    if (!persistenceEnabled || !currentViewConfig) {
      setHasUnsavedChanges(false)
      return
    }

    const referenceConfig =
      lastSavedConfigRef.current ?? normalizeViewConfig(currentViewConfig)

    setHasUnsavedChanges(!areViewConfigsEqual(currentConfig, referenceConfig))
  }, [currentConfig, currentViewConfig, currentViewId, persistenceEnabled, savedVersion])

  const markClean = useCallback(
    (config?: ViewConfig) => {
      if (!persistenceEnabled || !currentViewConfig) {
        return
      }

      const normalized = normalizeViewConfig(config ?? currentConfig)
      lastSavedConfigRef.current = normalized
      setSavedVersion((version) => version + 1)
      setHasUnsavedChanges(false)
    },
    [currentConfig, currentViewConfig, persistenceEnabled]
  )

  const save = useCallback(async () => {
    if (!persistenceEnabled || !currentViewId) {
      return
    }
    if (!hasUnsavedChanges) {
      return
    }

    const payload = normalizeViewConfig(currentConfig)
    await updateViewMutation.mutateAsync({ id: currentViewId, config: payload })
    markClean(payload)
  }, [currentConfig, currentViewId, hasUnsavedChanges, markClean, persistenceEnabled, updateViewMutation])

  const getLastSavedConfig = useCallback(() => {
    if (!persistenceEnabled || !currentViewConfig) {
      return null
    }

    const baseline =
      lastSavedConfigRef.current ?? normalizeViewConfig(currentViewConfig)
    return normalizeViewConfig(baseline)
  }, [currentViewConfig, currentViewId, persistenceEnabled, savedVersion])

  return {
    currentConfig,
    hasUnsavedChanges,
    isSaving: updateViewMutation.isPending,
    error: updateViewMutation.error,
    save,
    markClean,
    getLastSavedConfig,
  }
}
