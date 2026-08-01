// apps/web/src/components/dynamic-table/context/view-metadata-context.tsx
'use client'

import { createContext, type Dispatch, type SetStateAction, useContext } from 'react'
import type { CustomField } from '../types'

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

  /** DATE/DATETIME fields (for the calendar view's date-axis pickers) */
  dateFields: Array<{ id: string; name: string }>

  /** Entity label for "New X" buttons */
  entityLabel?: string

  /** Callback when "New" button is clicked. Optional `presetValues`
   *  (`{ fieldId: value }`) lets the calendar view's click-empty-day-to-create
   *  prefill the create dialog. */
  onAddNew?: (presetValues?: Record<string, unknown>) => void

  /** Callback when kanban card is clicked */
  onCardClick?: (card: TData) => void

  /** Callback to add a new card in a kanban column */
  onAddCard?: (columnId: string) => void

  /** Selected kanban card IDs (controlled) */
  selectedKanbanCardIds: Set<string>

  /**
   * Kanban selection setter. Must accept the `SetStateAction` updater form —
   * toggling a single card reads the previous set.
   */
  onSelectedKanbanCardIdsChange: Dispatch<SetStateAction<Set<string>>>

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
