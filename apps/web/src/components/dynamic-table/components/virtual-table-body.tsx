// apps/web/src/components/dynamic-table/components/virtual-table-body.tsx

'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { type Table } from '@tanstack/react-table'
import { VirtualTableRow } from './virtual-table-row'
import { DragDropRow } from './drag-drop-row'
import { useTableContext } from '../context/table-context'
import { useRowSelection } from '../context/row-selection-context'
import { ROW_HEIGHT } from '../utils/constants'
import { useInView } from 'react-intersection-observer'
import { useEffect, useRef, useMemo, useLayoutEffect, useCallback, useState } from 'react'
import { type DragDropConfig } from '../types'
import { cn } from '@auxx/ui/lib/utils'

interface VirtualTableBodyProps<TData> {
  table: Table<TData>
  containerRef: React.RefObject<HTMLDivElement>
  scrollContainerRef: React.RefObject<HTMLDivElement>
  dragDropConfig?: DragDropConfig<TData>
  /** Whether cell selection is enabled - passed as prop to avoid context re-renders */
  cellSelectionEnabled?: boolean
}

/**
 * Virtualized table body component for performance with large datasets
 */
export function VirtualTableBody<TData>({
  table,
  containerRef,
  scrollContainerRef,
  dragDropConfig,
  cellSelectionEnabled = false,
}: VirtualTableBodyProps<TData>) {
  const { onRowClick, rowClassName, onScrollToBottom } = useTableContext<TData>()
  const {
    getLastClickedRowId,
    setLastClickedRowId,
    getIsBulkMode,
    enableCheckbox,
    toggleRowSelection,
  } = useRowSelection<TData>()

  const { rows } = table.getRowModel()

  // Compute column signature - changes when column config changes
  const columnSignature = useMemo(() => {
    const { columnPinning, columnVisibility, columnOrder } = table.getState()
    const visibleColumnIds = table.getVisibleLeafColumns().map((c) => c.id)
    return JSON.stringify({
      pinning: columnPinning,
      visibility: columnVisibility,
      order: columnOrder,
      ids: visibleColumnIds,
    })
  }, [
    table.getState().columnPinning,
    table.getState().columnVisibility,
    table.getState().columnOrder,
    table.getVisibleLeafColumns().length,
  ])

  // Intersection observer for bottom detection
  const { ref: bottomRef, inView } = useInView({ threshold: 0, rootMargin: '500px' })

  useEffect(() => {
    if (inView && onScrollToBottom) {
      onScrollToBottom()
    }
  }, [inView, onScrollToBottom])

  // Calculate shadow position based on left-pinned columns
  const shadowLeftPosition = useMemo(() => {
    const leftPinnedColumns = table.getAllColumns().filter((col) => col.getIsPinned() === 'left')
    if (leftPinnedColumns.length === 0) return 0
    const lastPinnedColumn = leftPinnedColumns[leftPinnedColumns.length - 1]
    return lastPinnedColumn!.getStart('left') + lastPinnedColumn!.getSize()
  }, [table, table.getState().columnPinning, table.getState().columnSizing])

  // Set CSS variable for scroll-margin-left
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.style.setProperty('--pinned-left-width', `${shadowLeftPosition}px`)
    }
  }, [shadowLeftPosition, scrollContainerRef])

  const shadowRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry!.isIntersecting)
      },
      { threshold: 0 }
    )

    if (scrollContainerRef.current) {
      observer.observe(scrollContainerRef.current)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (scrollContainerRef.current) {
        observer.unobserve(scrollContainerRef.current)
      }
      observer.disconnect()
    }
  }, [scrollContainerRef])

  useLayoutEffect(() => {
    let scrollContainer: HTMLElement | null = null
    let cleanupFn: (() => void) | null = null

    const timeoutId = setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainer = scrollContainerRef.current
      } else {
        const container = containerRef.current
        if (container) {
          let parent = container.closest('.overflow-auto')
          if (parent instanceof HTMLElement) {
            scrollContainer = parent
          }
        }
      }

      if (!scrollContainer) {
        return
      }

      const initialHandleScroll = () => {
        if (!shadowRef.current || !scrollContainer) return
        const scrollLeft = scrollContainer.scrollLeft
        const opacity = Math.min(scrollLeft / 50, 1)
        shadowRef.current.style.opacity = opacity.toString()
      }

      const scrollHandler = () => {
        if (!shadowRef.current || !scrollContainer) return
        const scrollLeft = scrollContainer.scrollLeft
        const opacity = Math.min(scrollLeft / 50, 1)
        shadowRef.current.style.opacity = opacity.toString()
      }

      initialHandleScroll()
      scrollContainer.addEventListener('scroll', scrollHandler, { passive: true })

      cleanupFn = () => {
        scrollContainer?.removeEventListener('scroll', scrollHandler)
      }
    }, 50)

    return () => {
      clearTimeout(timeoutId)
      if (cleanupFn) {
        cleanupFn()
      }
    }
  }, [scrollContainerRef, containerRef, rows.length, shadowLeftPosition, isVisible])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => containerRef.current,
    measureElement:
      typeof window !== 'undefined' && navigator.userAgent.indexOf('Firefox') === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
    overscan: 10,
  })

  const tableRef = useRef(table)
  tableRef.current = table
  const onRowClickRef = useRef(onRowClick)
  onRowClickRef.current = onRowClick

  const handleRowClick = useCallback(
    (row: TData, event: React.MouseEvent, rowId: string) => {
      const target = event.target as HTMLElement
      if (
        target.closest('button') ||
        target.closest('a') ||
        target.closest('input') ||
        target.closest('[role="checkbox"]')
      ) {
        return
      }

      setLastClickedRowId(rowId)
      onRowClickRef.current?.(row, event, rowId, tableRef.current)
    },
    [setLastClickedRowId]
  )

  return (
    <>
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
        }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (!row) return null

          const isLastClicked = row.id === getLastClickedRowId()
          const isSelected = row.getIsSelected()

          if (dragDropConfig?.enabled) {
            return (
              <DragDropRow
                key={row.id}
                row={row}
                virtualRow={virtualRow}
                rowVirtualizer={rowVirtualizer}
                onRowClick={handleRowClick}
                rowClassName={rowClassName}
                isLastClicked={isLastClicked}
                isSelected={isSelected}
                getIsBulkMode={getIsBulkMode}
                enableCheckbox={enableCheckbox}
                toggleRowSelection={toggleRowSelection}
                dragDropConfig={dragDropConfig}
                cellSelectionEnabled={cellSelectionEnabled}
                columnSignature={columnSignature}
              />
            )
          }

          return (
            <VirtualTableRow
              key={row.id}
              row={row}
              virtualRow={virtualRow}
              rowVirtualizer={rowVirtualizer}
              onRowClick={handleRowClick}
              rowClassName={rowClassName}
              isLastClicked={isLastClicked}
              isSelected={isSelected}
              getIsBulkMode={getIsBulkMode}
              enableCheckbox={enableCheckbox}
              toggleRowSelection={toggleRowSelection}
              cellSelectionEnabled={cellSelectionEnabled}
              columnSignature={columnSignature}
            />
          )
        })}
        <div
          className="sticky top-0 w-0"
          style={{
            left: `${shadowLeftPosition}px`,
            zIndex: 11,
            height: `${rowVirtualizer.getTotalSize()}px`,
          }}>
          <div
            ref={shadowRef}
            className={cn(
              'absolute top-[-40px] left-full bottom-0 w-[1px] ml-[-1px] bg-transparent shadow-[6px_0_16px_4px_rgb(0,0,0,0.2)] dark:shadow-[6px_0_16px_4px_rgb(0,0,0,0.9)] [clip-path:inset(0px_-38px_0px_0px)] transition-opacity duration-200'
            )}
          />
        </div>
      </div>
      <div ref={bottomRef} style={{ height: 1 }} />
    </>
  )
}
