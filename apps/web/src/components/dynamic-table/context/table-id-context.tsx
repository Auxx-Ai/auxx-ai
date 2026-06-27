// apps/web/src/components/dynamic-table/context/table-id-context.tsx
'use client'

import { createContext, useContext } from 'react'

/**
 * Minimal context that exposes only the immutable `tableId`.
 *
 * Per-cell hooks (cell-selection range/active/editing checks) need `tableId`
 * to scope their selection-store reads. Reading it from the large
 * `TableConfigContext` subscribed every cell to a value that changes on each
 * DynamicView render (it bundles JSX like emptyState/footerElement plus
 * isLoading), forcing the whole grid to re-render on unrelated updates.
 * `tableId` never changes for a mounted table, so a dedicated string-valued
 * context lets those cells stay put.
 */
const TableIdContext = createContext<string | null>(null)

export const TableIdProvider = TableIdContext.Provider

export function useTableId(): string {
  const tableId = useContext(TableIdContext)
  if (tableId === null) {
    throw new Error('useTableId must be used within TableIdProvider')
  }
  return tableId
}
