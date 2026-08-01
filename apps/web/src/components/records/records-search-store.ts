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
 * The field id `SearchBarShell` stamps on free-standing typed text for records.
 *
 * It is a designation, not a real field: the shell is handed this as
 * `freeTextField` and builds the condition from it, which is exactly why the
 * free text can be recovered from the condition list with no heuristic. Mail
 * designates `'freeText'` for the same purpose.
 */
export const RECORDS_FREE_TEXT_FIELD = 'displayName'

/**
 * Convert flat SearchCondition[] from the search store into a ConditionGroup
 * that can be merged with existing view filters and passed to useRecordList.
 *
 * Keeps the free-text condition IN the group — the pre-search-param behaviour
 * (`displayName contains`, compiled to `ILIKE '%q%'`). `RecordsView` uses
 * {@link splitRecordSearch} instead; this remains for surfaces that have not
 * been moved onto the `search` param yet (the KB articles table).
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

/**
 * Split the search bar's state into its two axes: the **narrowing conditions**
 * and the **free text**.
 *
 * This is the whole of plan decision 0.3 on the client. The search bar is a
 * two-part control by design — the shell already knows which condition is the
 * free-text one, because it created it from `freeTextField`
 * ({@link RECORDS_FREE_TEXT_FIELD}). Only the query layer used to flatten the
 * two together and compile the typed text to `ILIKE '%q%'` like any other
 * filter. Emitting it as `search` is what routes it to the ranked predicate.
 *
 * @returns `search` (undefined when nothing was typed) and the remaining
 *   conditions as a group (null when there are none)
 */
export function splitRecordSearch(conditions: SearchCondition[]): {
  search: string | undefined
  group: ConditionGroup | null
} {
  const valid = conditions.filter((c) => c.value !== undefined && c.value !== '')

  const freeText = valid.find((c) => c.fieldId === RECORDS_FREE_TEXT_FIELD)
  const rest = valid.filter((c) => c !== freeText)

  const search =
    typeof freeText?.value === 'string' ? freeText.value.trim() || undefined : undefined

  return {
    search,
    group:
      rest.length > 0
        ? {
            id: 'search',
            logicalOperator: 'AND',
            conditions: rest.map((c) => ({
              id: c.id,
              fieldId: c.fieldId,
              operator: c.operator,
              value: c.value,
            })),
          }
        : null,
  }
}
