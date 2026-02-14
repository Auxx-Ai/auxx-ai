// apps/web/src/components/mail/searchbar/store/search-selectors.ts
'use client'

import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  buildFilterChips,
  EMPTY_CHIPS,
  type FilterChip,
  type SearchCondition,
  selectConditionCount,
  selectDisplayText,
  selectHasActiveConditions,
  useSearchStore,
} from './search-store'

/**
 * Hook for filter chips with stable reference.
 * Reuses shared buildFilterChips utility.
 */
export function useFilterChips(): FilterChip[] {
  const conditions = useSearchStore(useShallow((s) => s.conditions))
  const hasConditions = useSearchStore(selectHasActiveConditions)

  return useMemo(() => {
    if (!hasConditions) return EMPTY_CHIPS
    return buildFilterChips(conditions)
  }, [conditions, hasConditions])
}

/**
 * Hook for conditions with stable reference.
 */
export function useSearchConditions(): SearchCondition[] {
  return useSearchStore(useShallow((s) => s.conditions))
}

/**
 * Hook for all search store actions.
 */
export function useSearchActions() {
  return useSearchStore(
    useShallow((s) => ({
      // Condition actions
      addCondition: s.addCondition,
      updateCondition: s.updateCondition,
      removeCondition: s.removeCondition,
      clearConditions: s.clearConditions,
      setConditions: s.setConditions,
      // UI actions
      setOpen: s.setOpen,
      toggleAdvanced: s.toggleAdvanced,
      setEditingConditionId: s.setEditingConditionId,
      setHighlightedIndex: s.setHighlightedIndex,
      setContext: s.setContext,
      // Recent searches
      saveToRecent: s.saveToRecent,
      clearRecentSearches: s.clearRecentSearches,
    }))
  )
}

/**
 * Hook for search UI state (non-condition state).
 */
export function useSearchUIState() {
  return useSearchStore(
    useShallow((s) => ({
      isOpen: s.isOpen,
      showAdvanced: s.showAdvanced,
      editingConditionId: s.editingConditionId,
      highlightedIndex: s.highlightedIndex,
    }))
  )
}

/**
 * Hook for derived boolean/number selectors.
 * These are primitives so they don't need useShallow.
 */
export function useSearchStatus() {
  const hasActiveConditions = useSearchStore(selectHasActiveConditions)
  const conditionCount = useSearchStore(selectConditionCount)
  const displayText = useSearchStore(selectDisplayText)

  return {
    hasActiveConditions,
    conditionCount,
    displayText,
    // Legacy aliases
    hasActiveFilters: hasActiveConditions,
    activeFilterCount: conditionCount,
  }
}

/**
 * Hook for recent searches with stable reference.
 */
export function useRecentSearches() {
  return useSearchStore((s) => s.recentSearches)
}

/**
 * Hook to sync search context with current mailbox context.
 * Call this at the top of your mailbox component to reset conditions on context change.
 */
export function useSearchContext(contextType: string, contextId?: string) {
  const setContext = useSearchStore((s) => s.setContext)
  const contextKey = `${contextType}:${contextId || 'all'}`

  useEffect(() => {
    setContext(contextKey)
  }, [contextKey, setContext])
}

/**
 * Hook for conditions state (for direct access when needed).
 * @deprecated Use useSearchConditions instead
 */
export function useSearchFilters() {
  return useSearchStore(useShallow((s) => s.conditions))
}
