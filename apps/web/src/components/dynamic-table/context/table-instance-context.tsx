// apps/web/src/components/dynamic-table/context/table-instance-context.tsx
'use client'

import { createContext, useContext } from 'react'
import type { Table } from '@tanstack/react-table'

// ============================================================================
// TYPES
// ============================================================================

/** Table instance - changes when data changes (BY DESIGN) */
export interface TableInstanceContextValue<TData = any> {
  /** TanStack table instance */
  table: Table<TData>
}

// ============================================================================
// CONTEXT
// ============================================================================

const TableInstanceContext = createContext<TableInstanceContextValue | null>(null)

export const TableInstanceProvider = TableInstanceContext.Provider

export function useTableInstance<TData = any>(): TableInstanceContextValue<TData> {
  const context = useContext(TableInstanceContext)
  if (!context) {
    throw new Error('useTableInstance must be used within TableInstanceProvider')
  }
  return context as TableInstanceContextValue<TData>
}
