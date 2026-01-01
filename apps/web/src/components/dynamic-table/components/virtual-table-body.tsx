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

  // Note: CSS variables for column widths are now set in table-body.tsx
  // which wraps both headers and body rows

  const { rows } = table.getRowModel()

  // Intersection observer for bottom detection - trigger 500px before bottom for early prefetch
  const { ref: bottomRef, inView } = useInView({ threshold: 0, rootMargin: '500px' })

  // Call onScrollToBottom when the bottom element is in view
  useEffect(() => {
    if (inView && onScrollToBottom) {
      onScrollToBottom()
    }
  }, [inView, onScrollToBottom])

  // Calculate shadow position based on left-pinned columns
  const shadowLeftPosition = useMemo(() => {
    const leftPinnedColumns = table.getAllColumns().filter((col) => col.getIsPinned() === 'left')
    if (leftPinnedColumns.length === 0) return 0

    // Get the rightmost edge of the last pinned column
    const lastPinnedColumn = leftPinnedColumns[leftPinnedColumns.length - 1]
    return lastPinnedColumn!.getStart('left') + lastPinnedColumn!.getSize()
  }, [table, table.getState().columnPinning, table.getState().columnSizing])

  // Set CSS variable for scroll-margin-left (used by keyboard navigation)
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.style.setProperty('--pinned-left-width', `${shadowLeftPosition}px`)
    }
  }, [shadowLeftPosition, scrollContainerRef])

  // Ref for direct DOM manipulation of shadow element
  const shadowRef = useRef<HTMLDivElement>(null)

  // Track component visibility
  const [isVisible, setIsVisible] = useState(true)

  // Detect visibility changes (tab switches, etc.)
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden)
    }

    // Also use intersection observer as backup for tab switching
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


  // Set up scroll event listener with cleanup
  useLayoutEffect(() => {
    let scrollContainer: HTMLElement | null = null
    let cleanupFn: (() => void) | null = null

    // Small delay to ensure DOM is ready after tab switch
    const timeoutId = setTimeout(() => {
      // Find the scroll container - it's the element with overflow-auto class

      // First try the ref
      if (scrollContainerRef.current) {
        scrollContainer = scrollContainerRef.current
      } else {
        // Fallback: find the scroll container by class
        const container = containerRef.current
        if (container) {
          // Look for the parent with overflow-auto class
          let parent = container.closest('.overflow-auto')
          if (parent instanceof HTMLElement) {
            scrollContainer = parent
          }
        }
      }

      if (!scrollContainer) {
        return
      }

      // Initial opacity calculation
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

      // Set initial state
      initialHandleScroll()

      // Add the scroll listener
      scrollContainer.addEventListener('scroll', scrollHandler, { passive: true })

      // Store cleanup function
      cleanupFn = () => {
        scrollContainer?.removeEventListener('scroll', scrollHandler)
      }
    }, 50) // Small delay to ensure DOM is ready

    // Cleanup
    return () => {
      clearTimeout(timeoutId)
      if (cleanupFn) {
        cleanupFn()
      }
    }
  }, [scrollContainerRef, containerRef, rows.length, shadowLeftPosition, isVisible])

  // Important: Keep the row virtualizer in the lowest component possible to avoid unnecessary re-renders
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => containerRef.current,
    // Measure dynamic row height, except in firefox because it measures table border height incorrectly
    measureElement:
      typeof window !== 'undefined' && navigator.userAgent.indexOf('Firefox') === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
    overscan: 10, // Increased from 5 for smoother fast scrolling
  })

  // Use refs for stable callbacks - avoid breaking row memoization
  const tableRef = useRef(table)
  tableRef.current = table
  const onRowClickRef = useRef(onRowClick)
  onRowClickRef.current = onRowClick

  // Handle row click - stable reference via refs
  const handleRowClick = useCallback(
    (row: TData, event: React.MouseEvent, rowId: string) => {
      // Don't trigger row click if clicking on interactive elements
      const target = event.target as HTMLElement
      if (
        target.closest('button') ||
        target.closest('a') ||
        target.closest('input') ||
        target.closest('[role="checkbox"]')
      ) {
        return
      }

      // Track the last clicked row
      setLastClickedRowId(rowId)

      // Call onRowClick with enhanced parameters including table object
      onRowClickRef.current?.(row, event, rowId, tableRef.current)
    },
    [setLastClickedRowId]
  )

  return (
    <>
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`, // tells scrollbar how big the table is
          position: 'relative', // needed for absolute positioning of rows
        }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (!row) return null

          const isLastClicked = row.id === getLastClickedRowId()
          const isSelected = row.getIsSelected()

          // Use DragDropRow if drag-and-drop is enabled
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
              'absolute top-[-40px] left-full bottom-0 w-[1px] ml-[-1px] bg-transparent shadow-[6px_0_16px_4px_rgb(0,0,0,0.2)] dark:shadow-[6px_0_16px_4px_rgb(0,0,0,0.7)] [clip-path:inset(0px_-38px_0px_0px)] transition-opacity duration-200'
            )}
          />
        </div>
      </div>
      {/* Sentinel element for bottom detection */}
      <div ref={bottomRef} style={{ height: 1 }} />
    </>
  )
}
