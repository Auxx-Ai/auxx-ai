// apps/web/src/components/mail/searchbar/hooks/use-search-filters.ts
'use client'

import { useMemo } from 'react'
import { useSearchStore, selectHasActiveConditions } from '../store'
import {
  conditionsToApiFilter,
  type ApiSearchFilter,
} from '@auxx/lib/mail-query/client'

/**
 * Convert search store conditions to tRPC API filter format.
 * This hook bridges the condition-based store with the API filter format.
 *
 * Use this hook in components that need to pass filters to the thread list query.
 */
export function useSearchFiltersForQuery(): ApiSearchFilter | undefined {
  const conditions = useSearchStore((s) => s.conditions)
  const hasConditions = useSearchStore(selectHasActiveConditions)

  return useMemo(() => {
    if (!hasConditions) return undefined
    return conditionsToApiFilter(conditions)
  }, [conditions, hasConditions])
}
