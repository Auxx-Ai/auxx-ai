// apps/web/src/components/mail/searchbar/hooks/use-search-filters.ts
'use client'

import { useMemo } from 'react'
import { useSearchStore, selectHasActiveFilters } from '../store'
import {
  filtersToApiFilter,
  type ApiSearchFilter,
} from '@auxx/lib/mail-query'

/**
 * Convert search store filters to tRPC API filter format.
 * Extracts IDs from FilterRef objects.
 *
 * Use this hook in components that need to pass filters to the thread list query.
 */
export function useSearchFiltersForQuery(): ApiSearchFilter | undefined {
  const filters = useSearchStore((s) => s.filters)
  const hasFilters = useSearchStore(selectHasActiveFilters)

  return useMemo(() => {
    if (!hasFilters) return undefined
    return filtersToApiFilter(filters)
  }, [filters, hasFilters])
}
