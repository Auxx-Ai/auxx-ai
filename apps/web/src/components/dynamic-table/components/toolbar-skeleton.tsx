// apps/web/src/components/dynamic-table/components/toolbar-skeleton.tsx

'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { TOOLBAR_HEIGHT } from '../utils/constants'

interface ToolbarSkeletonProps {
  /** Show search input skeleton */
  showSearch?: boolean
}

/**
 * Toolbar skeleton matching real toolbar dimensions.
 */
export function ToolbarSkeleton({ showSearch = true }: ToolbarSkeletonProps) {
  return (
    <div
      className='flex items-center gap-1.5 py-2 px-3 bg-background'
      style={{ minHeight: TOOLBAR_HEIGHT }}>
      {/* View selector */}
      <Skeleton className='h-7 w-24 rounded-md' />

      {/* Filter button */}
      <Skeleton className='h-7 w-16 rounded-md' />

      {/* Columns button */}
      <Skeleton className='h-7 w-16 rounded-md' />
      {/* Import button */}
      <Skeleton className='h-7 w-16 rounded-md' />

      {/* Spacer */}
      <div className='my-2' />

      {/* Search input */}
      {showSearch && <Skeleton className='h-7 flex-1 rounded-md' />}
    </div>
  )
}
