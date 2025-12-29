// apps/web/src/components/dynamic-table/context/cell-selection-context.tsx
'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { CellSelectionState, CellSelectionConfig } from '../types'

interface CellSelectionContextValue {
  selectedCell: CellSelectionState | null
  setSelectedCell: (cell: CellSelectionState | null) => void
  editingCell: CellSelectionState | null
  setEditingCell: (cell: CellSelectionState | null) => void
  cellSelectionConfig?: CellSelectionConfig
}

const CellSelectionContext = createContext<CellSelectionContextValue | null>(null)

interface CellSelectionProviderProps {
  children: ReactNode
  value: CellSelectionContextValue
}

/** Provider for cell selection state - kept separate from main TableContext for performance */
export function CellSelectionProvider({ children, value }: CellSelectionProviderProps) {
  return <CellSelectionContext.Provider value={value}>{children}</CellSelectionContext.Provider>
}

/** Hook to access cell selection state */
export function useCellSelection(): CellSelectionContextValue {
  const context = useContext(CellSelectionContext)
  if (!context) {
    throw new Error('useCellSelection must be used within CellSelectionProvider')
  }
  return context
}

/** Hook for components that optionally support cell selection */
export function useCellSelectionOptional(): CellSelectionContextValue | null {
  return useContext(CellSelectionContext)
}
