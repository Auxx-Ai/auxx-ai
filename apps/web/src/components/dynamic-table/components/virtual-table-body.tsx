// apps/web/src/components/dynamic-table/components/virtual-table-body.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { Table } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useInView } from 'react-intersection-observer'
import { useRowSelection } from '../context/row-selection-context'
import { useTableConfig } from '../context/table-config-context'
import type { DragDropConfig } from '../types'
import { ROW_HEIGHT } from '../utils/constants'
import { DragDropRow } from './drag-drop-row'
import { SelectionOverlay } from './selection-overlay'
import { VirtualTableRow } from './virtual-table-row'

interface VirtualTableBodyProps<TData> {
  table: Table<TData>
  containerRef: React.RefObject<HTMLDivElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  dragDropConfig?: DragDropConfig<TData>
  /** Whether cell selection is enabled - passed as prop to avoid context re-renders */
  cellSelectionEnabled?: boolean
}

/**
 * Virtualized table body component for performance with large datasets
 *
 * Migrated to use split contexts instead of monolithic TableContext
 */
export function VirtualTableBody<TData>({
  table,
  containerRef,
  scrollContainerRef,
  dragDropConfig,
  cellSelectionEnabled = false,
}: VirtualTableBodyProps<TData>) {
  const { onRowClick, rowClassName, onScrollToBottom } = useTableConfig<TData>()
  const {
    getLastClickedRowId,
    setLastClickedRowId,
    getIsBulkMode,
    enableCheckbox,
    toggleRowSelection,
  } = useRowSelection<TData>()

  const { rows } = table.getRowModel()

  // Extract state values once at component level to avoid new object references
  const tableState = table.getState()
  const columnPinning = tableState.columnPinning
  const columnVisibility = tableState.columnVisibility
  const columnOrder = tableState.columnOrder
  const visibleColumns = table.getVisibleLeafColumns()
  const visibleColumnIds = visibleColumns.map((c) => c.id).join(',')
  // Compute column signature - changes when column config changes
  const columnSignature = useMemo(() => {
    return JSON.stringify({
      pinning: columnPinning,
      visibility: columnVisibility,
      order: columnOrder,
      ids: visibleColumnIds,
    })
  }, [columnPinning, columnVisibility, columnOrder, visibleColumnIds])

  // Intersection observer for bottom detection
  const { ref: bottomRef, inView } = useInView({ threshold: 0, rootMargin: '500px' })

  useEffect(() => {
    if (inView && onScrollToBottom) {
      onScrollToBottom()
    }
  }, [inView, onScrollToBottom])

  // Calculate shadow position based on left-pinned columns
  const shadowLeftPosition = useMemo(() => {
    const leftPinnedIds = columnPinning.left ?? []
    if (leftPinnedIds.length === 0) return 0

    // Get the last pinned column ID from the pinning array (which is in visual order)
    const lastPinnedId = leftPinnedIds[leftPinnedIds.length - 1]
    const lastPinnedColumn = table.getColumn(lastPinnedId!)

    if (!lastPinnedColumn) return 0

    return lastPinnedColumn.getStart('left') + lastPinnedColumn.getSize()
  }, [table, columnPinning])
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: rows.length, shadowLeftPosition, isVisible intentionally trigger scroll handler re-setup
  useLayoutEffect(() => {
    let scrollContainer: HTMLElement | null = null
    let cleanupFn: (() => void) | null = null

    const timeoutId = setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainer = scrollContainerRef.current
      } else {
        const container = containerRef.current
        if (container) {
          const parent = container.closest('.overflow-auto')
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
        {cellSelectionEnabled && <SelectionOverlay scrollContainerRef={scrollContainerRef} />}
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
          className='hidden sm:block sticky top-0 w-0'
          style={{
            left: `${shadowLeftPosition}px`,
            zIndex: 22,
            height: `${rowVirtualizer.getTotalSize()}px`,
          }}>
          <div
            ref={shadowRef}
            className={cn(
              'absolute top-[-45px] left-full bottom-0 w-[1px] ml-[-1px] bg-transparent shadow-[6px_0_16px_4px_rgb(0,0,0,0.2)] dark:shadow-[6px_0_16px_4px_rgb(0,0,0,0.9)] [clip-path:inset(0px_-38px_0px_0px)] transition-opacity duration-200'
            )}
          />
        </div>
      </div>
      <div ref={bottomRef} style={{ height: 1 }} />
    </>
  )
}
