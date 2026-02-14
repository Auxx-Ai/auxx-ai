// apps/web/src/components/dynamic-table/components/table-content-skeleton.tsx

'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { CHECKBOX_WIDTH, HEADER_HEIGHT, ROW_HEIGHT } from '../utils/constants'

interface TableContentSkeletonProps {
  /** Number of skeleton rows to show */
  rowCount?: number
  /** Show checkbox column skeleton */
  showCheckbox?: boolean
  /** Column count (excluding checkbox) */
  columnCount?: number
  /** Custom class name */
  className?: string
}

/**
 * Generate realistic column widths for skeleton
 */
function generateColumnWidths(count: number): number[] {
  const baseWidths = [180, 140, 200, 120, 160, 140, 180, 120]
  return Array.from({ length: count }, (_, i) => baseWidths[i % baseWidths.length])
}

/**
 * Deterministic "random" width for skeleton cells
 */
function getRandomWidth(row: number, col: number): number {
  const seed = (row * 7 + col * 13) % 100
  return 40 + (seed % 50) // 40-90%
}

/**
 * Pixel-perfect skeleton that matches real table dimensions.
 * Renders inside DynamicTable to avoid layout shift.
 */
export function TableContentSkeleton({
  rowCount = 12,
  showCheckbox = true,
  columnCount = 5,
  className,
}: TableContentSkeletonProps) {
  const columnWidths = generateColumnWidths(columnCount)

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header skeleton - matches real header structure */}
      <div
        className='flex items-center border-b border-primary-200/50 bg-gradient-to-b from-white to-white/50 dark:from-primary-100 dark:to-primary-100/50'
        style={{ height: HEADER_HEIGHT }}>
        {/* Checkbox column */}
        {showCheckbox && (
          <div
            className='flex items-center justify-center shrink-0'
            style={{ width: CHECKBOX_WIDTH }}>
            <Skeleton className='h-4 w-4 rounded' />
          </div>
        )}

        {/* Column headers */}
        {columnWidths.map((width, i) => (
          <div key={i} className='flex items-center px-3 py-2' style={{ width }}>
            <Skeleton className='h-4' style={{ width: `${60 + (i % 3) * 20}%` }} />
          </div>
        ))}
      </div>

      {/* Row skeletons - exact ROW_HEIGHT */}
      {Array.from({ length: rowCount }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className='flex items-center border-b border-primary-200/30'
          style={{ height: ROW_HEIGHT }}>
          {/* Checkbox cell */}
          {showCheckbox && (
            <div
              className='flex items-center justify-center shrink-0'
              style={{ width: CHECKBOX_WIDTH }}>
              <Skeleton className='h-4 w-4 rounded' />
            </div>
          )}

          {/* Data cells */}
          {columnWidths.map((width, colIndex) => (
            <div key={colIndex} className='flex items-center px-3' style={{ width }}>
              <Skeleton
                className='h-4'
                style={{
                  width: `${getRandomWidth(rowIndex, colIndex)}%`,
                  opacity: 0.7 + (rowIndex % 3) * 0.1,
                }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
