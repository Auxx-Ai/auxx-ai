// apps/web/src/components/dynamic-table/hooks/use-combined-filters.ts

'use client'

import { useMemo } from 'react'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ViewConfig } from '../types'

/** Stable empty array for reference equality */
const EMPTY_FILTERS: ConditionGroup[] = []

interface UseCombinedFiltersOptions {
  /** View config from useActiveViewConfig (may be null) */
  viewConfig: ViewConfig | null
  /** Page-level filters (search, status dropdown, etc.) */
  pageFilters?: ConditionGroup[]
}

/**
 * Merge view filters with page-level filters.
 * Returns undefined if no filters (not empty array) for useRecordList compatibility.
 */
export function useCombinedFilters({
  viewConfig,
  pageFilters,
}: UseCombinedFiltersOptions): ConditionGroup[] | undefined {
  return useMemo(() => {
    const viewFilters = viewConfig?.filters ?? EMPTY_FILTERS
    const combined: ConditionGroup[] = []

    if (viewFilters.length > 0) combined.push(...viewFilters)
    if (pageFilters?.length) combined.push(...pageFilters)

    return combined.length > 0 ? combined : undefined
  }, [viewConfig?.filters, pageFilters])
}
