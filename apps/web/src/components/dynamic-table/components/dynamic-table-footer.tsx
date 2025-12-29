// apps/web/src/components/dynamic-table/components/dynamic-table-footer.tsx
'use client'

import type { ReactNode } from 'react'
import { useTableContext } from '../context/table-context'

interface DynamicTableFooterProps {
  children: ReactNode
  className?: string
}

/**
 * Footer component for DynamicTable that can access table context
 * Must be used as a child of DynamicTable
 */
export function DynamicTableFooter({ children, className }: DynamicTableFooterProps) {
  const { table } = useTableContext()

  if (!table) {
    console.warn('DynamicTableFooter must be used within a DynamicTable')
    return null
  }

  return <div className={className}>{children}</div>
}

// Export a default footer content component for convenience
export function DefaultFooterContent() {
  const { table } = useTableContext()

  return (
    <div className="flex items-center justify-between px-2 py-2">
      <div className="text-sm text-muted-foreground">
        {table.getFilteredRowModel().rows.length} of {table.getCoreRowModel().rows.length} row(s)
      </div>
    </div>
  )
}
