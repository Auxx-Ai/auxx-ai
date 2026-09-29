// apps/web/src/components/data-import/plan-preview/use-plan-preview-data.ts

'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { api } from '~/trpc/react'
import type { PlanPreviewRow } from './types'

const PAGE_SIZE = 200
/** How often the saved plan is re-read while planning is still inserting rows. */
const PLANNING_REFRESH_MS = 1500

interface UsePlanPreviewDataOptions {
  jobId: string
  /** Current job status */
  jobStatus?: string
}

interface UsePlanPreviewDataResult {
  rows: PlanPreviewRow[]
  /** Rows saved to the plan so far */
  total: number
  isLoading: boolean
  /** Planning is still running, so `rows` and `total` are partial */
  isPlanning: boolean
  hasMore: boolean
  isFetchingMore: boolean
  loadMore: () => void
}

/** The saved plan's rows, paged; re-read while planning so rows appear as each batch lands. */
export function usePlanPreviewData(options: UsePlanPreviewDataOptions): UsePlanPreviewDataResult {
  const { jobId, jobStatus } = options
  const isPlanning = jobStatus === 'planning'
  const enabled = isPlanning || jobStatus === 'ready'

  const query = api.dataImport.getPlanPreview.useInfiniteQuery(
    { jobId, limit: PAGE_SIZE },
    {
      enabled,
      getNextPageParam: (last) => last.nextCursor,
      refetchInterval: isPlanning ? PLANNING_REFRESH_MS : false,
    }
  )

  // One last read once planning ends, so the final batch is not left to the next interval.
  const { refetch } = query
  useEffect(() => {
    if (jobStatus === 'ready') void refetch()
  }, [jobStatus, refetch])

  const rows = useMemo<PlanPreviewRow[]>(
    () =>
      query.data?.pages.flatMap((page) =>
        page.rows.map((row) => ({
          ...row,
          errors: row.errorMessage ? [row.errorMessage] : [],
          warnings: row.warningMessage ? [row.warningMessage] : [],
        }))
      ) ?? [],
    [query.data]
  )

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return {
    rows,
    total: query.data?.pages[0]?.total ?? 0,
    isLoading: enabled && query.isLoading,
    isPlanning,
    hasMore: !!hasNextPage,
    isFetchingMore: isFetchingNextPage,
    loadMore,
  }
}
