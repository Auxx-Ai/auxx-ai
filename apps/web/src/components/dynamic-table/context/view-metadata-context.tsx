// apps/web/src/components/dynamic-table/context/view-metadata-context.tsx
'use client'

import { createContext, useContext } from 'react'
import type { CustomField, ResourceField } from '../types'

// ============================================================================
// TYPES
// ============================================================================

/** View-specific metadata for kanban/custom rendering */
export interface ViewMetadataContextValue<TData = any> {
  /** Select fields (for kanban grouping) */
  selectFields: Array<{
    id: string
    name: string
    options: { options?: Array<{ id: string; label: string; color?: string }> }
  }>

  /** Custom fields (for kanban cards) */
  customFields: CustomField[]

  /** Entity label for "New X" buttons */
  entityLabel?: string

  /** Callback when "New" button is clicked */
  onAddNew?: () => void

  /** Callback when kanban card is clicked */
  onCardClick?: (card: TData) => void

  /** Callback to add a new card in a kanban column */
  onAddCard?: (columnId: string) => void

  /** Selected kanban card IDs (controlled) */
  selectedKanbanCardIds: Set<string>

  /** Callback when kanban card selection changes */
  onSelectedKanbanCardIdsChange: (ids: Set<string>) => void

  /** Active drag items (for drag and drop) */
  activeDragItems: TData[] | null

  /** Set active drag items */
  setActiveDragItems: (items: TData[] | null) => void
}

// ============================================================================
// CONTEXT
// ============================================================================

const ViewMetadataContext = createContext<ViewMetadataContextValue | null>(null)

export const ViewMetadataProvider = ViewMetadataContext.Provider

export function useViewMetadata<TData = any>(): ViewMetadataContextValue<TData> {
  const context = useContext(ViewMetadataContext)
  if (!context) {
    throw new Error('useViewMetadata must be used within ViewMetadataProvider')
  }
  return context as ViewMetadataContextValue<TData>
}
