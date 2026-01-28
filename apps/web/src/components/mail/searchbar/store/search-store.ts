// apps/web/src/components/mail/searchbar/store/search-store.ts
'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist } from 'zustand/middleware'
import { v4 as generateId } from 'uuid'
import type { Operator } from '@auxx/lib/conditions/client'
import {
  getMailViewFieldDefinition,
  getDefaultOperatorForField,
} from '@auxx/lib/mail-views/client'

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
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Stable empty conditions array */
export const EMPTY_CONDITIONS: SearchCondition[] = []

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

export const useSearchStore = create<SearchState>()(
  persist(
    immer((set) => ({
      // Core state
      conditions: EMPTY_CONDITIONS,

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
          state.conditions = []
        }),

      setConditions: (conditions) =>
        set((state) => {
          state.conditions = conditions
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
            state.conditions = []
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
          if (state.conditions.length === 0) return

          // Deep clone conditions
          const clone = JSON.parse(JSON.stringify(state.conditions)) as SearchCondition[]

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
 * Check if any conditions are currently active.
 */
export const selectHasActiveConditions = (state: SearchState): boolean => {
  return state.conditions.length > 0
}

/**
 * Count the number of active conditions.
 */
export const selectConditionCount = (state: SearchState): number => {
  return state.conditions.length
}

/**
 * Generate display text from conditions (for showing in collapsed search bar).
 */
export const selectDisplayText = (state: SearchState): string => {
  return state.conditions
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

  for (const condition of conditions) {
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
