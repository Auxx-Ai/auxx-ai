// apps/web/src/components/mail/searchbar/hooks/use-search-filters.ts
'use client'

import type { SearchCondition } from '@auxx/lib/mail-query/client'
import { SEARCH_SCOPE_FIELD_ID } from '@auxx/lib/mail-views/client'
import { useMemo } from 'react'
import { selectHasActiveConditions, selectHasNonDefaultScope, useSearchStore } from '../store'

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
  const hasNonDefaultScope = useSearchStore(selectHasNonDefaultScope)

  return useMemo(() => {
    if (!hasConditions && !hasNonDefaultScope) return undefined
    // Keep scope condition (no value needed) + conditions with valid values
    return conditions.filter(
      (c) =>
        c.fieldId === SEARCH_SCOPE_FIELD_ID ||
        (c.value !== undefined && c.value !== '' && c.value !== null)
    )
  }, [conditions, hasConditions, hasNonDefaultScope])
}
