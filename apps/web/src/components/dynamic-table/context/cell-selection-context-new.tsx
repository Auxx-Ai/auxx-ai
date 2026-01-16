// apps/web/src/components/dynamic-table/context/cell-selection-context-new.tsx
'use client'

import { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react'
import { useSelectionStore } from '../stores/selection-store'
import { useTableConfig } from './table-config-context'
import type { CellSelectionState, CellSelectionConfig } from '../types'

// ============================================================================
// TYPES
// ============================================================================

interface CellSelectionContextValue {
  selectedCell: CellSelectionState | null
  setSelectedCell: (cell: CellSelectionState | null) => void
  editingCell: CellSelectionState | null
  setEditingCell: (cell: CellSelectionState | null) => void
  cellSelectionConfig?: CellSelectionConfig
}

// ============================================================================
// CONTEXT FOR CONFIG
// ============================================================================
// We keep a minimal context for the static config (cellSelectionConfig)
// but use Zustand store for the reactive state (selectedCell, editingCell)

const CellSelectionConfigContext = createContext<CellSelectionConfig | undefined>(undefined)

interface CellSelectionConfigProviderProps {
  children: ReactNode
  config?: CellSelectionConfig
}

/**
 * Provider for cell selection config (static configuration)
 */
export function CellSelectionConfigProvider({
  children,
  config,
}: CellSelectionConfigProviderProps) {
  return (
    <CellSelectionConfigContext.Provider value={config}>
      {children}
    </CellSelectionConfigContext.Provider>
  )
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to access cell selection state
 *
 * Replaces the old React Context pattern with direct Zustand store access.
 * Uses proper selectors to avoid unnecessary re-renders.
 */
export function useCellSelection(): CellSelectionContextValue {
  const { tableId } = useTableConfig()
  const cellSelectionConfig = useContext(CellSelectionConfigContext)

  // ─── CELL SELECTION STATE ───────────────────────────────────────────────────
  // Use proper selectors to avoid re-renders
  const selectedCell = useSelectionStore((state) => state.tables[tableId]?.selectedCell ?? null)
  const editingCell = useSelectionStore((state) => state.tables[tableId]?.editingCell ?? null)
  const storeSetSelectedCell = useSelectionStore((state) => state.setSelectedCell)
  const storeSetEditingCell = useSelectionStore((state) => state.setEditingCell)

  // ─── STABLE CALLBACKS ───────────────────────────────────────────────────────
  const setSelectedCell = useCallback(
    (cell: CellSelectionState | null) => {
      storeSetSelectedCell(tableId, cell)
    },
    [tableId, storeSetSelectedCell]
  )

  const setEditingCell = useCallback(
    (cell: CellSelectionState | null) => {
      storeSetEditingCell(tableId, cell)
    },
    [tableId, storeSetEditingCell]
  )

  // ─── RETURN VALUE ───────────────────────────────────────────────────────────
  // Only depend on primitive values that actually change
  return useMemo(
    () => ({
      selectedCell,
      setSelectedCell,
      editingCell,
      setEditingCell,
      cellSelectionConfig,
    }),
    [
      selectedCell?.rowId,
      selectedCell?.columnId,
      setSelectedCell,
      editingCell?.rowId,
      editingCell?.columnId,
      setEditingCell,
      cellSelectionConfig?.enabled,
    ]
  )
}

/**
 * Hook for components that optionally support cell selection
 *
 * Returns null if not within a TableConfig context (backwards compatible)
 */
export function useCellSelectionOptional(): CellSelectionContextValue | null {
  try {
    return useCellSelection()
  } catch {
    return null
  }
}
