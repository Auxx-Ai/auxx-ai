// apps/web/src/components/mail/searchbar/store/search-store.ts
'use client'

import type { Operator } from '@auxx/lib/conditions/client'
import { getMailViewFieldDefinition, SEARCH_SCOPE_FIELD_ID } from '@auxx/lib/mail-views/client'
import { v4 as generateId } from 'uuid'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search condition - the core data type for the search store.
 * Uses Condition[] as the single source of truth.
 */
export interface SearchCondition {
  id: string
  fieldId: string
  operator: Operator
  value: any
  /** Display label for entity references (tags, assignees, inboxes) */
  displayLabel?: string
}

/**
 * Editing condition reference with index
 */
export interface EditingCondition {
  id: string
  index: number
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

interface SearchState {
  /** Core state - CONDITIONS are the SINGLE SOURCE OF TRUTH */
  conditions: SearchCondition[]

  /** Context scoping - conditions are reset when context changes */
  contextKey: string | null

  /** UI state */
  isOpen: boolean
  showAdvanced: boolean
  editingConditionId: string | null
  highlightedIndex: number | null
  /** Persisted state */
  recentSearches: SearchCondition[][]

  /** Condition actions */
  addCondition: (fieldId: string, operator: Operator, value: any, displayLabel?: string) => void
  updateCondition: (id: string, updates: Partial<SearchCondition>) => void
  removeCondition: (id: string) => void
  clearConditions: () => void
  setConditions: (conditions: SearchCondition[]) => void

  /** UI actions */
  setOpen: (open: boolean) => void
  toggleAdvanced: () => void
  setEditingConditionId: (id: string | null) => void
  setHighlightedIndex: (index: number | null) => void
  setContext: (contextKey: string) => void

  /** Recent searches */
  saveToRecent: () => void
  clearRecentSearches: () => void
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Stable empty conditions array */
export const EMPTY_CONDITIONS: SearchCondition[] = []

/** Create a scope condition with a default or specified operator */
function createScopeCondition(operator: Operator = 'this_mailbox' as Operator): SearchCondition {
  return { id: generateId(), fieldId: SEARCH_SCOPE_FIELD_ID, operator, value: undefined }
}

/** Ensure conditions array always contains a scope condition at the front */
function ensureScope(conditions: SearchCondition[], operator?: Operator): SearchCondition[] {
  if (conditions.some((c) => c.fieldId === SEARCH_SCOPE_FIELD_ID)) return conditions
  return [createScopeCondition(operator), ...conditions]
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

export const useSearchStore = create<SearchState>()(
  persist(
    immer((set) => ({
      // Core state — scope condition always present
      conditions: [createScopeCondition()],

      // Context scoping
      contextKey: null,

      // UI state
      isOpen: false,
      showAdvanced: false,
      editingConditionId: null,
      highlightedIndex: null,

      // Persisted state
      recentSearches: [],

      // ─────────────────────────────────────────────────────────────────
      // Condition actions
      // ─────────────────────────────────────────────────────────────────

      addCondition: (fieldId, operator, value, displayLabel) =>
        set((state) => {
          // Check if condition with same fieldId already exists
          const existingIndex = state.conditions.findIndex((c) => c.fieldId === fieldId)

          if (existingIndex !== -1) {
            // Update existing condition value (merge for arrays)
            const existing = state.conditions[existingIndex]
            if (Array.isArray(existing.value) && !Array.isArray(value)) {
              if (!existing.value.includes(value)) {
                existing.value.push(value)
              }
            } else if (Array.isArray(existing.value) && Array.isArray(value)) {
              existing.value = [...new Set([...existing.value, ...value])]
            } else {
              existing.value = value
            }
            if (displayLabel) {
              existing.displayLabel = displayLabel
            }
          } else {
            // Add new condition
            const newCondition: SearchCondition = {
              id: generateId(),
              fieldId,
              operator,
              value,
              displayLabel,
            }
            state.conditions.push(newCondition)
          }
        }),

      updateCondition: (id, updates) =>
        set((state) => {
          const condition = state.conditions.find((c) => c.id === id)
          if (condition) {
            Object.assign(condition, updates)
          }
        }),

      removeCondition: (id) =>
        set((state) => {
          state.conditions = state.conditions.filter((c) => c.id !== id)
        }),

      clearConditions: () =>
        set((state) => {
          state.conditions = [createScopeCondition()]
        }),

      setConditions: (conditions) =>
        set((state) => {
          const currentScope = state.conditions.find((c) => c.fieldId === SEARCH_SCOPE_FIELD_ID)
          state.conditions = ensureScope(conditions, currentScope?.operator)
        }),

      // ─────────────────────────────────────────────────────────────────
      // UI actions
      // ─────────────────────────────────────────────────────────────────

      setOpen: (open) =>
        set((state) => {
          state.isOpen = open
          if (!open) {
            state.showAdvanced = false
            state.editingConditionId = null
            state.highlightedIndex = null
          }
        }),

      toggleAdvanced: () =>
        set((state) => {
          state.showAdvanced = !state.showAdvanced
        }),

      setEditingConditionId: (id) =>
        set((state) => {
          state.editingConditionId = id
          state.highlightedIndex = null
        }),

      setHighlightedIndex: (index) =>
        set((state) => {
          state.highlightedIndex = index
        }),

      // Context scoping - reset conditions when switching contexts
      setContext: (contextKey) =>
        set((state) => {
          if (state.contextKey !== contextKey) {
            state.contextKey = contextKey
            state.conditions = [createScopeCondition()]
            state.isOpen = false
            state.showAdvanced = false
            state.editingConditionId = null
            state.highlightedIndex = null
          }
        }),

      // ─────────────────────────────────────────────────────────────────
      // Recent searches
      // ─────────────────────────────────────────────────────────────────

      saveToRecent: () =>
        set((state) => {
          // Exclude scope condition from recent searches
          const realConditions = state.conditions.filter((c) => c.fieldId !== SEARCH_SCOPE_FIELD_ID)
          if (realConditions.length === 0) return

          // Deep clone conditions (without scope)
          const clone = JSON.parse(JSON.stringify(realConditions)) as SearchCondition[]

          // Remove duplicates and limit to 10
          const isDuplicate = (a: SearchCondition[], b: SearchCondition[]) =>
            JSON.stringify(a) === JSON.stringify(b)

          state.recentSearches = [
            clone,
            ...state.recentSearches.filter((r) => !isDuplicate(r, clone)),
          ].slice(0, 10)
        }),

      clearRecentSearches: () =>
        set((state) => {
          state.recentSearches = []
        }),
    })),
    {
      name: 'mail-search-store-v2',
      partialize: (state) => ({
        recentSearches: state.recentSearches,
      }),
    }
  )
)

// ═══════════════════════════════════════════════════════════════════════════
// SELECTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if any conditions are currently active (excluding scope).
 */
export const selectHasActiveConditions = (state: SearchState): boolean => {
  return state.conditions.some((c) => c.fieldId !== SEARCH_SCOPE_FIELD_ID)
}

/**
 * Check if scope is set to something other than the default (this_mailbox).
 */
export const selectHasNonDefaultScope = (state: SearchState): boolean => {
  const scope = state.conditions.find((c) => c.fieldId === SEARCH_SCOPE_FIELD_ID)
  return scope?.operator !== 'this_mailbox'
}

/**
 * Count the number of active conditions (excluding scope).
 */
export const selectConditionCount = (state: SearchState): number => {
  return state.conditions.filter((c) => c.fieldId !== SEARCH_SCOPE_FIELD_ID).length
}

/**
 * Generate display text from conditions (for showing in collapsed search bar).
 * Excludes scope condition.
 */
export const selectDisplayText = (state: SearchState): string => {
  return state.conditions
    .filter((c) => c.fieldId !== SEARCH_SCOPE_FIELD_ID)
    .map((c) => {
      const field = getMailViewFieldDefinition(c.fieldId)
      const label = field?.label?.toLowerCase() || c.fieldId
      const displayValue = c.displayLabel || c.value
      return `${label}:${displayValue}`
    })
    .join(' ')
}

/**
 * Get condition by fieldId (for checking if a condition type already exists).
 */
export const selectConditionByFieldId = (
  state: SearchState,
  fieldId: string
): SearchCondition | undefined => {
  return state.conditions.find((c) => c.fieldId === fieldId)
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKWARD COMPATIBILITY - LEGACY FILTER INTERFACE
// These functions help bridge the gap during migration
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

/** Stable empty chips array */
export const EMPTY_CHIPS: FilterChip[] = []

/**
 * Convert conditions to legacy filter chips format.
 * Used for backward compatibility with existing components.
 */
export function buildFilterChips(conditions: SearchCondition[]): FilterChip[] {
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

/**
 * @deprecated Use selectHasActiveConditions instead
 */
export const selectHasActiveFilters = selectHasActiveConditions

/**
 * @deprecated Use selectConditionCount instead
 */
export const selectActiveFilterCount = selectConditionCount
