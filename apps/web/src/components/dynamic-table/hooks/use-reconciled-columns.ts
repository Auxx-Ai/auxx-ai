// apps/web/src/components/dynamic-table/hooks/use-reconciled-columns.ts

import { useMemo } from 'react'
import type { ExtendedColumnDef } from '../types'
import { isFieldColumnId } from '../utils/column-id'
import { createDynamicFieldColumn } from '../utils/create-dynamic-column'

interface UseReconciledColumnsOptions<T> {
  /** Base columns from createCustomFieldColumns and other sources */
  columns: ExtendedColumnDef<T>[]
  /** Column order from store - source of truth for which columns should exist */
  columnOrder: string[] | undefined
  /** Entity definition ID for cell rendering */
  entityDefinitionId: string
}

/**
 * Reconciles column definitions with columnOrder.
 * Creates dynamic column definitions for any field IDs in columnOrder
 * that don't have existing definitions.
 */
export function useReconciledColumns<T extends { id: string }>({
  columns,
  columnOrder,
  entityDefinitionId,
}: UseReconciledColumnsOptions<T>): ExtendedColumnDef<T>[] {
  return useMemo(() => {
    if (!columnOrder?.length) {
      return columns
    }

    // Build set of existing column IDs for fast lookup
    const existingIds = new Set(columns.map((col) => col.id).filter(Boolean))

    // Find column IDs in order that don't have definitions
    const missingIds = columnOrder.filter((id) => {
      // Skip if already has a definition
      if (existingIds.has(id)) return false
      // Skip special columns (checkbox, etc.)
      if (id.startsWith('_')) return false
      // Only create for field columns (contain colon)
      return isFieldColumnId(id)
    })

    // No missing columns - return original
    if (missingIds.length === 0) {
      return columns
    }

    // Create dynamic columns for missing IDs
    const dynamicColumns = missingIds.map((id) =>
      createDynamicFieldColumn<T>(id, entityDefinitionId)
    )

    return [...columns, ...dynamicColumns]
  }, [columns, columnOrder, entityDefinitionId])
}
