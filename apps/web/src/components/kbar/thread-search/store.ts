// apps/web/src/components/kbar/thread-search/store.ts
'use client'

import { getMailViewFieldDefinition, SEARCH_SCOPE_FIELD_ID } from '@auxx/lib/mail-views/client'
import {
  createSearchSelectors,
  createSearchStore,
} from '~/components/searchbar/create-search-store'

/**
 * An isolated mail-search store instance for the command palette's "Search
 * threads" page. It mirrors the inbox's `mail-search-store-v2` (same field
 * labels, same selectors) but is a *second, independent* store so palette
 * searches never read or write the inbox's live conditions.
 *
 * Differences from the inbox store (friction #1 in the plan):
 * - No `this_mailbox` scope pin — palette scope is "all" (driven by
 *   `contextType: 'all'` passed to `buildConditionGroups`, not the searchbar).
 * - `persistRecent: false` — palette searches aren't saved to localStorage.
 */
export const usePaletteThreadSearchStore = createSearchStore({
  name: 'palette-thread-search',
  getFieldLabel: (fieldId) => getMailViewFieldDefinition(fieldId)?.label,
  persistRecent: false,
  pinnedConditions: [],
  pinnedFieldIds: new Set(),
})

const paletteSelectors = createSearchSelectors(
  new Set([SEARCH_SCOPE_FIELD_ID]),
  (fieldId) => getMailViewFieldDefinition(fieldId)?.label
)

export const selectHasActiveConditions = paletteSelectors.selectHasActiveConditions
export const selectConditionCount = paletteSelectors.selectConditionCount
export const selectDisplayText = paletteSelectors.selectDisplayText
