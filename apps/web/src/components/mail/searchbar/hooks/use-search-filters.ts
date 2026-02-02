// apps/web/src/components/mail/searchbar/hooks/use-search-filters.ts
'use client'

import { useMemo } from 'react'
import { useSearchStore, selectHasActiveConditions } from '../store'
import { type SearchCondition } from '@auxx/lib/mail-query/client'

/**
 * Get raw search conditions from the store.
 * Use this hook with useThreadList's searchConditions parameter
 * for the new condition-based filtering API.
 *
 * @returns Array of search conditions, or undefined if no active conditions
 *
 * @example
 * ```typescript
 * const searchConditions = useSearchConditions()
 * const { threads } = useThreadList({
 *   contextType: 'all_inboxes',
 *   searchConditions,
 * })
 * ```
 */
export function useSearchConditions(): SearchCondition[] | undefined {
  const conditions = useSearchStore((s) => s.conditions)
  const hasConditions = useSearchStore(selectHasActiveConditions)

  return useMemo(() => {
    if (!hasConditions) return undefined
    // Filter out conditions without valid values
    return conditions.filter(
      (c) => c.value !== undefined && c.value !== '' && c.value !== null
    )
  }, [conditions, hasConditions])
}
