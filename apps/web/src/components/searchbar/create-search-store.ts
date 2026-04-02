// apps/web/src/components/searchbar/create-search-store.ts
'use client'

import type { Operator } from '@auxx/lib/conditions/client'
import { v4 as generateId } from 'uuid'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { SearchCondition } from './types'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SearchState {
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
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateSearchStoreOptions {
  /** Stable ID for this store instance (used as persistence key) */
  name: string
  /** Function to get display text for a condition's field */
  getFieldLabel?: (fieldId: string) => string | undefined
  /** Whether to persist recent searches to localStorage */
  persistRecent?: boolean
  /** Conditions always present (e.g., scope in mail). Re-added on clear/reset. */
  pinnedConditions?: SearchCondition[]
  /** Field IDs that are pinned and excluded from active counts / display text / recent saves */
  pinnedFieldIds?: Set<string>
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Create fresh copies of pinned conditions with new IDs */
function createPinnedConditions(templates: SearchCondition[]): SearchCondition[] {
  return templates.map((c) => ({ ...c, id: generateId() }))
}

/** Ensure conditions array contains all pinned conditions at the front */
function ensurePinned(
  conditions: SearchCondition[],
  pinnedFieldIds: Set<string>,
  pinnedTemplates: SearchCondition[]
): SearchCondition[] {
  const hasPinned = (fieldId: string) => conditions.some((c) => c.fieldId === fieldId)
  const missing = pinnedTemplates.filter((t) => !hasPinned(t.fieldId))
  if (missing.length === 0) return conditions
  return [...createPinnedConditions(missing), ...conditions]
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════

export function createSearchStore(
  options: CreateSearchStoreOptions
): UseBoundStore<StoreApi<SearchState>> {
  const {
    name,
    getFieldLabel,
    persistRecent = false,
    pinnedConditions: pinnedTemplates = [],
    pinnedFieldIds = new Set(),
  } = options

  const initialConditions = createPinnedConditions(pinnedTemplates)

  const storeCreator = immer<SearchState>((set) => ({
    // Core state
    conditions: initialConditions,

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
          state.conditions.push({
            id: generateId(),
            fieldId,
            operator,
            value,
            displayLabel,
          })
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
        state.conditions = createPinnedConditions(pinnedTemplates)
      }),

    setConditions: (conditions) =>
      set((state) => {
        // Preserve existing pinned condition operators (e.g., scope operator in mail)
        const currentPinned = state.conditions.find((c) => pinnedFieldIds.has(c.fieldId))
        const withPinned = ensurePinned(conditions, pinnedFieldIds, pinnedTemplates)
        // If there was an existing pinned condition, preserve its operator
        if (currentPinned) {
          const pinned = withPinned.find((c) => c.fieldId === currentPinned.fieldId)
          if (pinned) {
            pinned.operator = currentPinned.operator
          }
        }
        state.conditions = withPinned
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

    setContext: (contextKey) =>
      set((state) => {
        if (state.contextKey !== contextKey) {
          state.contextKey = contextKey
          state.conditions = createPinnedConditions(pinnedTemplates)
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
        // Exclude pinned conditions from recent searches
        const realConditions = state.conditions.filter((c) => !pinnedFieldIds.has(c.fieldId))
        if (realConditions.length === 0) return

        // Deep clone conditions (without pinned)
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
  }))

  if (persistRecent) {
    return create<SearchState>()(
      persist(storeCreator, {
        name,
        partialize: (state) => ({
          recentSearches: state.recentSearches,
        }),
      })
    )
  }

  return create<SearchState>()(storeCreator)
}

// ═══════════════════════════════════════════════════════════════════════════
// SELECTORS
// ═══════════════════════════════════════════════════════════════════════════

/** Create selectors scoped to a set of pinned field IDs */
export function createSearchSelectors(
  pinnedFieldIds: Set<string>,
  getFieldLabel?: (fieldId: string) => string | undefined
) {
  const selectHasActiveConditions = (state: SearchState): boolean => {
    return state.conditions.some((c) => !pinnedFieldIds.has(c.fieldId))
  }

  const selectConditionCount = (state: SearchState): number => {
    return state.conditions.filter((c) => !pinnedFieldIds.has(c.fieldId)).length
  }

  const selectDisplayText = (state: SearchState): string => {
    return state.conditions
      .filter((c) => !pinnedFieldIds.has(c.fieldId))
      .map((c) => {
        const label = getFieldLabel?.(c.fieldId)?.toLowerCase() || c.fieldId
        const displayValue = c.displayLabel || c.value
        return `${label}:${displayValue}`
      })
      .join(' ')
  }

  const selectConditionByFieldId = (
    state: SearchState,
    fieldId: string
  ): SearchCondition | undefined => {
    return state.conditions.find((c) => c.fieldId === fieldId)
  }

  return {
    selectHasActiveConditions,
    selectConditionCount,
    selectDisplayText,
    selectConditionByFieldId,
  }
}
