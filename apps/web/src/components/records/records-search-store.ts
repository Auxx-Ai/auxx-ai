// apps/web/src/components/records/records-search-store.ts
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { useShallow } from 'zustand/react/shallow'
import {
  createSearchSelectors,
  createSearchStore,
} from '~/components/searchbar/create-search-store'
import type { SearchCondition } from '~/components/searchbar/types'

// ═══════════════════════════════════════════════════════════════════════════
// RECORDS SEARCH STORE
// ═══════════════════════════════════════════════════════════════════════════

const EMPTY_PINNED = new Set<string>()

export const useRecordsSearchStore = createSearchStore({
  name: 'records-search-store',
  persistRecent: false,
})

const selectors = createSearchSelectors(EMPTY_PINNED)

export const selectHasActiveConditions = selectors.selectHasActiveConditions
export const selectConditionCount = selectors.selectConditionCount
export const selectDisplayText = selectors.selectDisplayText

// ═══════════════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/** Hook for all search store actions. */
export function useRecordsSearchActions() {
  return useRecordsSearchStore(
    useShallow((s) => ({
      addCondition: s.addCondition,
      updateCondition: s.updateCondition,
      removeCondition: s.removeCondition,
      clearConditions: s.clearConditions,
      setConditions: s.setConditions,
      setHighlightedIndex: s.setHighlightedIndex,
      setContext: s.setContext,
    }))
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CONDITION CONVERSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert flat SearchCondition[] from the search store into a ConditionGroup
 * that can be merged with existing view filters and passed to useRecordList.
 */
export function searchConditionsToGroup(conditions: SearchCondition[]): ConditionGroup | null {
  const valid = conditions.filter((c) => c.value !== undefined && c.value !== '')
  if (valid.length === 0) return null

  return {
    id: 'search',
    logicalOperator: 'AND',
    conditions: valid.map((c) => ({
      id: c.id,
      fieldId: c.fieldId,
      operator: c.operator,
      value: c.value,
    })),
  }
}
