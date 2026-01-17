// apps/web/src/components/dynamic-table/components/table-body.tsx
'use client'

import { useRef, useEffect, useMemo } from 'react'
import { useTableConfig } from '../context/table-config-context'
import { useTableInstance } from '../context/table-instance-context'
import { useCellSelection } from '../context/cell-selection-context'
import { useDynamicTableStore } from '../stores/dynamic-table-store'
import { VirtualTableBody } from './virtual-table-body'
import { HeaderCellWrapper } from './header-cell-wrapper'
import { CheckboxHeaderCell } from './checkbox-header-cell'
import { ColumnDndProvider } from './column-dnd-provider'
import { RowDndProvider } from './row-dnd-provider'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { sanitizeColumnId } from '../utils/sanitize-column-id'

/**
 * Props for TableBody component
 */
interface TableBodyProps {
  /** Hide toolbar - affects sticky header positioning */
  hideToolbar?: boolean
  /** Reference to the scroll container (for virtualization and cell navigation) */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Table body component - renders header and virtualized rows.
 */
export function TableBody<TData extends object>({
  hideToolbar,
  scrollContainerRef,
}: TableBodyProps) {
  // Get config from focused contexts
  const { isLoading, headerActions, dragDropConfig, emptyState } = useTableConfig<TData>()
  const { table } = useTableInstance<TData>()
  const { cellSelectionConfig } = useCellSelection()

  // Get view loading state from store
  const isLoadingViews = useDynamicTableStore((state) => !state.initialized)

  // Container ref for virtualization AND CSS variables
  const containerRef = useRef<HTMLDivElement>(null)

  // Generate column IDs string first - used as dependency for CSS variables
  const visibleColumns = table.getVisibleLeafColumns()
  const columnIds = visibleColumns.map((c) => c.id).join(',')

  // Update CSS variables directly on DOM when columns or sizing changes
  const columnSizing = table.getState().columnSizing
  useEffect(() => {
    if (!containerRef.current) return
    const style = containerRef.current.style
    table.getVisibleLeafColumns().forEach((col) => {
      style.setProperty(`--col-${sanitizeColumnId(col.id)}-w`, `${col.getSize()}px`)
    })
  }, [columnSizing, columnIds, table])
  const columnStyleRules = useMemo(() => {
    return visibleColumns
      .map(
        (c) =>
          `[data-col="${sanitizeColumnId(c.id)}"] { width: var(--col-${sanitizeColumnId(c.id)}-w); min-width: var(--col-${sanitizeColumnId(c.id)}-w); }`
      )
      .join('\n')
  }, [columnIds])

  return (
    <div className="">
      {/* CSS rules for column widths - generated once per column set */}
      <style>{columnStyleRules}</style>
      <div className="max-w-full pl-0">
        {/* Container with CSS variables for column widths */}
        <div
          ref={containerRef}
          className="min-w-full"
          style={{ width: `${table.getTotalSize()}px` }}>
          {/* Table Header with Column DndContext */}
          <ColumnDndProvider table={table} visibleColumns={visibleColumns}>
            <div
              className={cn(
                'sticky z-21 min-w-full from-white to-white/50 bg-gradient-to-b dark:from-[#2c313a] dark:to-[#2c313a] backdrop-blur border-b border-primary-200/50 dark:border-[#1e2227]',
                hideToolbar ? 'top-0' : 'top-11'
              )}>
              {table.getHeaderGroups().map((headerGroup) => (
                <div key={headerGroup.id} className="flex min-w-full items-stretch">
                  {/* Render left pinned columns */}
                  {headerGroup.headers
                    .filter((header) => header.column.getIsPinned() === 'left')
                    .map((header) => {
                      const isCheckboxColumn = header.column.id === '_checkbox'

                      if (isCheckboxColumn) {
                        return <CheckboxHeaderCell key={header.id} header={header} />
                      }

                      return (
                        <div
                          key={header.id}
                          className="sticky shrink-0 z-30 backdrop-blur bg-background/40 dark:bg-transparent"
                          style={{ left: header.column.getStart('left') }}>
                          <HeaderCellWrapper header={header} />
                        </div>
                      )
                    })}

                  {/* Render center (non-pinned) columns */}
                  {headerGroup.headers
                    .filter((header) => !header.column.getIsPinned())
                    .map((header) => {
                      const isCheckboxColumn = header.column.id === '_checkbox'

                      if (isCheckboxColumn) {
                        return <CheckboxHeaderCell key={header.id} header={header} />
                      }

                      return <HeaderCellWrapper key={header.id} header={header} />
                    })}

                  {/* Header Actions (e.g., add column button) - positioned sticky to stay visible on scroll */}
                  {headerActions && (
                    <div className="sticky right-0 h-10 flex items-center bg-gradient-to-r from-transparent via-white to-white dark:via-transparent dark:to-transparent">
                      {headerActions}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ColumnDndProvider>

          {/* Table Body with Row DndContext */}
          <RowDndProvider>
            <div className="relative block flex-1 h-full">
              {(isLoading && table.getRowModel().rows?.length === 0) || isLoadingViews ? (
                // Loading state
                Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex min-w-full items-stretch border-b border-primary-200/50">
                    {table.getAllColumns().map((column) => (
                      <div
                        key={column.id}
                        className="px-3 py-2 flex items-center"
                        style={{ width: column.getSize() }}>
                        <Skeleton className="h-4 w-full" />
                      </div>
                    ))}
                  </div>
                ))
              ) : table.getRowModel().rows?.length ? (
                // Virtual table body with data rows
                <VirtualTableBody
                  table={table}
                  containerRef={containerRef}
                  scrollContainerRef={scrollContainerRef}
                  dragDropConfig={dragDropConfig}
                  cellSelectionEnabled={cellSelectionConfig?.enabled}
                />
              ) : null}
            </div>
          </RowDndProvider>
        </div>
      </div>

      {/* Empty state */}
      {!isLoading &&
        !isLoadingViews &&
        table.getRowModel().rows?.length === 0 &&
        (emptyState ? (
          <div className="inset-0 absolute flex flex-1 min-h-0 flex-col">{emptyState}</div>
        ) : (
          <div className="flex min-w-full items-stretch border-b border-primary-200/50">
            <div className="px-3 py-12 text-center text-muted-foreground" style={{ width: '100%' }}>
              No results.
            </div>
          </div>
        ))}
    </div>
  )
}
