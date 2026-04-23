// apps/web/src/components/dynamic-table/context/cell-active-context.tsx
'use client'

import { createContext, useContext } from 'react'

interface CellActiveValue {
  isActive: boolean
  isEditing: boolean
}

const CellActiveContext = createContext<CellActiveValue>({ isActive: false, isEditing: false })

export const CellActiveProvider = CellActiveContext.Provider

/**
 * Read the active/editing state of the nearest enclosing SelectableTableCell.
 * Used by descendants (e.g. ItemsCellView) that need JS-side knowledge of
 * selection without coupling to DOM attributes or MutationObservers.
 *
 * Visual state is still driven by the .cell-active / .cell-editing CSS classes
 * on the cell wrapper — this context only powers JS branches like lazy mounting.
 */
export function useCellActive(): CellActiveValue {
  return useContext(CellActiveContext)
}
