// apps/web/src/components/dynamic-table/components/table-body.tsx
'use client'

import { useRef, useEffect, useMemo } from 'react'
import { useTableContext } from '../context/table-context'
import { useCellSelection } from '../context/cell-selection-context'
import { VirtualTableBody } from './virtual-table-body'
import { HeaderCellWrapper } from './header-cell-wrapper'
import { CheckboxHeaderCell } from './checkbox-header-cell'
import { ColumnDndProvider } from './column-dnd-provider'
import { RowDndProvider } from './row-dnd-provider'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Props for TableBody component
 */
interface TableBodyProps {
  /** Hide toolbar - affects sticky header positioning */
  hideToolbar?: boolean
  /** Reference to the scroll container (for virtualization and cell navigation) */
  scrollContainerRef: React.RefObject<HTMLDivElement>
}

/**
 * Table body component - renders header and virtualized rows.
 * Expects to be wrapped in TableProvider and CellSelectionProvider contexts.
 */
export function TableBody<TData extends object>({
  hideToolbar,
  scrollContainerRef,
}: TableBodyProps) {
  const {
    table,
    isLoadingViews,
    isLoading,
    headerActions,
    dragDropConfig,
    emptyState,
  } = useTableContext<TData>()

  const { cellSelectionConfig } = useCellSelection()

  // Container ref for virtualization AND CSS variables
  const containerRef = useRef<HTMLDivElement>(null)

  // Update CSS variables directly on DOM when column sizing changes - bypasses React
  const columnSizing = table.getState().columnSizing
  useEffect(() => {
    if (!containerRef.current) return
    const style = containerRef.current.style
    table.getVisibleLeafColumns().forEach((col) => {
      style.setProperty(`--col-${col.id}-w`, `${col.getSize()}px`)
    })
  }, [columnSizing, table])

  // Generate CSS rules once (only changes when column IDs change)
  const visibleColumns = table.getVisibleLeafColumns()
  const columnIds = visibleColumns.map((c) => c.id).join(',')
  const columnStyleRules = useMemo(() => {
    return visibleColumns
      .map((c) => `[data-col="${c.id}"] { width: var(--col-${c.id}-w); min-width: var(--col-${c.id}-w); }`)
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
          <ColumnDndProvider table={table}>
            <div
              className={cn(
                'sticky z-21 min-w-full from-white to-white/50 bg-gradient-to-b dark:from-primary-100 dark:to-primary-100/50 backdrop-blur border-b border-primary-200/50',
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
                          className="sticky shrink-0 z-30 backdrop-blur bg-background/40"
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
                    <div className="sticky right-0 h-10 flex items-center bg-gradient-to-r from-transparent via-white to-white dark:via-primary-100 dark:to-primary-100">
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
            <div
              className="px-3 py-12 text-center text-muted-foreground"
              style={{ width: '100%' }}>
              No results.
            </div>
          </div>
        ))}
    </div>
  )
}
