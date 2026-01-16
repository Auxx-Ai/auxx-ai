// apps/web/src/components/dynamic-table/context/row-selection-context.tsx
'use client'

import { useCallback, useMemo } from 'react'
import { useSelectionStore } from '../stores/selection-store'
import { useTableConfig } from './table-config-context'
import type { BulkAction } from '../types'
import type { RowSelectionState } from '@tanstack/react-table'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Stable empty row selection to prevent unnecessary re-renders */
const EMPTY_ROW_SELECTION: RowSelectionState = {}

// ============================================================================
// TYPES
// ============================================================================

interface RowSelectionContextValue<TData = any> {
  /** Whether checkboxes are enabled */
  enableCheckbox: boolean
  /** Whether any rows are selected (bulk mode active) */
  isBulkMode: boolean
  /** Stable getter for bulk mode - doesn't trigger re-renders */
  getIsBulkMode: () => boolean
  /** Toggle row selection with shift-click support */
  toggleRowSelection: (rowId: string, event: React.MouseEvent) => void
  /** Get last selected index for shift-click range selection */
  getLastSelectedIndex: () => number | null
  /** Set last selected index */
  setLastSelectedIndex: (index: number | null) => void
  /** Get last clicked row ID */
  getLastClickedRowId: () => string | null
  /** Set last clicked row ID */
  setLastClickedRowId: (id: string | null) => void
  /** Bulk actions configuration */
  bulkActions?: BulkAction<TData>[]
  /** Callback when row selection changes */
  onRowSelectionChange?: (selectedRows: Set<string>) => void
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to access row selection state
 *
 * Replaces the old React Context pattern with direct Zustand store access.
 * Uses proper selectors to avoid unnecessary re-renders.
 */
export function useRowSelection<TData = any>(allRowIds?: string[]): RowSelectionContextValue<TData> {
  const config = useTableConfig<TData>()
  const { tableId, enableCheckbox, bulkActions, onRowSelectionChange } = config

  // ─── ROW SELECTION STATE ────────────────────────────────────────────────────
  // Use proper selectors to avoid re-renders
  const rowSelection = useSelectionStore((state) => state.tables[tableId]?.rowSelection ?? EMPTY_ROW_SELECTION)
  const toggleRow = useSelectionStore((state) => state.toggleRow)
  const setLastClickedRowId = useSelectionStore((state) => state.setLastClickedRowId)
  const setLastSelectedIndex = useSelectionStore((state) => state.setLastSelectedIndex)
  const getRowSelection = useSelectionStore((state) => state.getRowSelection)

  // ─── COMPUTED STATE ─────────────────────────────────────────────────────────
  const isBulkMode = Object.keys(rowSelection).length > 0

  // ─── STABLE CALLBACKS ───────────────────────────────────────────────────────
  const getIsBulkMode = useCallback(() => {
    const selection = getRowSelection(tableId)
    return Object.keys(selection).length > 0
  }, [getRowSelection, tableId])

  const toggleRowSelection = useCallback(
    (rowId: string, event: React.MouseEvent) => {
      toggleRow(tableId, rowId, event, allRowIds)

      // Notify parent if callback is provided
      if (onRowSelectionChange) {
        const newSelection = useSelectionStore.getState().getRowSelection(tableId)
        const selectedIds = new Set(Object.keys(newSelection).filter((id) => newSelection[id]))
        onRowSelectionChange(selectedIds)
      }
    },
    [tableId, toggleRow, allRowIds, onRowSelectionChange]
  )

  const getLastSelectedIndex = useCallback((): number | null => {
    return useSelectionStore.getState().tables[tableId]?.lastSelectedIndex ?? null
  }, [tableId])

  const handleSetLastSelectedIndex = useCallback(
    (index: number | null) => {
      setLastSelectedIndex(tableId, index)
    },
    [tableId, setLastSelectedIndex]
  )

  const getLastClickedRowId = useCallback((): string | null => {
    return useSelectionStore.getState().tables[tableId]?.lastClickedRowId ?? null
  }, [tableId])

  const handleSetLastClickedRowId = useCallback(
    (id: string | null) => {
      setLastClickedRowId(tableId, id)
    },
    [tableId, setLastClickedRowId]
  )

  // ─── RETURN VALUE ───────────────────────────────────────────────────────────
  // All callbacks are stable via useCallback, so we only need to depend on
  // primitive values and the stable callback references
  return useMemo(
    () => ({
      enableCheckbox,
      isBulkMode,
      getIsBulkMode,
      toggleRowSelection,
      getLastSelectedIndex,
      setLastSelectedIndex: handleSetLastSelectedIndex,
      getLastClickedRowId,
      setLastClickedRowId: handleSetLastClickedRowId,
      bulkActions,
      onRowSelectionChange,
    }),
    [
      enableCheckbox,
      isBulkMode,
      getIsBulkMode,
      toggleRowSelection,
      getLastSelectedIndex,
      handleSetLastSelectedIndex,
      getLastClickedRowId,
      handleSetLastClickedRowId,
      bulkActions,
      onRowSelectionChange,
    ]
  )
}

/**
 * Hook for components that optionally support row selection
 *
 * Returns null if not within a TableConfig context (backwards compatible)
 */
export function useRowSelectionOptional<TData = any>(
  allRowIds?: string[]
): RowSelectionContextValue<TData> | null {
  try {
    return useRowSelection<TData>(allRowIds)
  } catch {
    return null
  }
}
