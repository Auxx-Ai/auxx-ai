// apps/web/src/components/mail/searchbar/store/search-store.ts
'use client'

import type { Operator } from '@auxx/lib/conditions/client'
import { getMailViewFieldDefinition, SEARCH_SCOPE_FIELD_ID } from '@auxx/lib/mail-views/client'
import {
  createSearchSelectors,
  createSearchStore,
  type SearchState,
} from '~/components/searchbar/create-search-store'

// Re-export shared types for backward compat
export type { EditingCondition, SearchCondition } from '~/components/searchbar/types'

// ═══════════════════════════════════════════════════════════════════════════
// MAIL SEARCH STORE
// ═══════════════════════════════════════════════════════════════════════════

const MAIL_PINNED_FIELD_IDS = new Set([SEARCH_SCOPE_FIELD_ID])

export const useSearchStore = createSearchStore({
  name: 'mail-search-store-v2',
  getFieldLabel: (fieldId) => getMailViewFieldDefinition(fieldId)?.label,
  persistRecent: true,
  pinnedConditions: [
    {
      id: 'scope',
      fieldId: SEARCH_SCOPE_FIELD_ID,
      operator: 'this_mailbox' as Operator,
      value: undefined,
    },
  ],
  pinnedFieldIds: MAIL_PINNED_FIELD_IDS,
})

// ═══════════════════════════════════════════════════════════════════════════
// SELECTORS
// ═══════════════════════════════════════════════════════════════════════════

const mailSelectors = createSearchSelectors(
  MAIL_PINNED_FIELD_IDS,
  (fieldId) => getMailViewFieldDefinition(fieldId)?.label
)

export const selectHasActiveConditions = mailSelectors.selectHasActiveConditions
export const selectConditionCount = mailSelectors.selectConditionCount
export const selectDisplayText = mailSelectors.selectDisplayText
export const selectConditionByFieldId = mailSelectors.selectConditionByFieldId

/**
 * Check if scope is set to something other than the default (this_mailbox).
 */
export const selectHasNonDefaultScope = (state: SearchState): boolean => {
  const scope = state.conditions.find((c) => c.fieldId === SEARCH_SCOPE_FIELD_ID)
  return scope?.operator !== 'this_mailbox'
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKWARD COMPATIBILITY - LEGACY FILTER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Legacy FilterRef for backward compatibility
 */
export interface FilterRef {
  id: string
  name: string
}

/**
 * Legacy filter chip type for backward compatibility.
 */
export interface FilterChip {
  key: string
  type: string
  label: string
  id?: string
  value: string
}

/** Stable empty conditions array */
export const EMPTY_CONDITIONS: import('~/components/searchbar/types').SearchCondition[] = []

/** Stable empty chips array */
export const EMPTY_CHIPS: FilterChip[] = []

/**
 * Convert conditions to legacy filter chips format.
 * Used for backward compatibility with existing components.
 */
export function buildFilterChips(
  conditions: import('~/components/searchbar/types').SearchCondition[]
): FilterChip[] {
  const chips: FilterChip[] = []

  for (const condition of conditions.filter((c) => c.fieldId !== SEARCH_SCOPE_FIELD_ID)) {
    const field = getMailViewFieldDefinition(condition.fieldId)
    const label = field?.label?.toLowerCase() || condition.fieldId

    // Handle array values (multiple items create multiple chips)
    if (Array.isArray(condition.value)) {
      for (const val of condition.value) {
        chips.push({
          key: `${condition.fieldId}-${val}`,
          type: condition.fieldId,
          label: `${label}: ${val}`,
          id: condition.id,
          value: val,
        })
      }
    } else {
      const displayValue = condition.displayLabel || condition.value
      chips.push({
        key: condition.id,
        type: condition.fieldId,
        label: `${label}: ${displayValue}`,
        id: condition.id,
        value: condition.value,
      })
    }
  }

  return chips
}

/**
 * WARNING: This selector creates new array/objects on every call.
 * DO NOT use directly in components - use useFilterChips() hook instead.
 */
export const selectFilterChipsRaw = (state: SearchState): FilterChip[] => {
  if (!selectHasActiveConditions(state)) return EMPTY_CHIPS
  return buildFilterChips(state.conditions)
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY SELECTORS - Keep for backward compatibility
// ═══════════════════════════════════════════════════════════════════════════

/** @deprecated Use selectHasActiveConditions instead */
export const selectHasActiveFilters = selectHasActiveConditions

/** @deprecated Use selectConditionCount instead */
export const selectActiveFilterCount = selectConditionCount
