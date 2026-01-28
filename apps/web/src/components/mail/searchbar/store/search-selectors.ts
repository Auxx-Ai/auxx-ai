// apps/web/src/components/mail/searchbar/store/search-selectors.ts
'use client'

import { useMemo, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  useSearchStore,
  selectHasActiveFilters,
  selectActiveFilterCount,
  selectDisplayText,
  buildFilterChips,
  EMPTY_CHIPS,
  type FilterChip,
} from './search-store'

/**
 * Hook for filter chips with stable reference.
 * Reuses shared buildFilterChips utility.
 */
export function useFilterChips(): FilterChip[] {
  const filters = useSearchStore(useShallow((s) => s.filters))
  const hasFilters = useSearchStore(selectHasActiveFilters)

  return useMemo(() => {
    if (!hasFilters) return EMPTY_CHIPS
    return buildFilterChips(filters)
  }, [filters, hasFilters])
}

/**
 * Hook for all search store actions.
 * Actions are stable references, but batching prevents multiple subscriptions.
 */
export function useSearchActions() {
  return useSearchStore(
    useShallow((s) => ({
      // Tag actions
      addTag: s.addTag,
      removeTag: s.removeTag,
      // Assignee actions
      addAssignee: s.addAssignee,
      removeAssignee: s.removeAssignee,
      // Inbox actions
      addInbox: s.addInbox,
      removeInbox: s.removeInbox,
      // Email participant actions
      addFrom: s.addFrom,
      removeFrom: s.removeFrom,
      addTo: s.addTo,
      removeTo: s.removeTo,
      // Text filter actions
      setFreeText: s.setFreeText,
      setSubject: s.setSubject,
      setBody: s.setBody,
      // Status actions
      toggleIs: s.toggleIs,
      // Property actions
      setHasAttachments: s.setHasAttachments,
      // Date actions
      setBefore: s.setBefore,
      setAfter: s.setAfter,
      // Bulk actions
      clearFilters: s.clearFilters,
      setFilters: s.setFilters,
      setContext: s.setContext,
      // UI actions
      setOpen: s.setOpen,
      toggleAdvanced: s.toggleAdvanced,
      // Badge editing actions
      setEditingFilter: s.setEditingFilter,
      setHighlightedBadgeIndex: s.setHighlightedBadgeIndex,
      updateFilterValue: s.updateFilterValue,
      removeFilter: s.removeFilter,
      // Recent searches
      saveToRecent: s.saveToRecent,
      clearRecentSearches: s.clearRecentSearches,
    }))
  )
}

/**
 * Hook for search UI state (non-filter state).
 */
export function useSearchUIState() {
  return useSearchStore(
    useShallow((s) => ({
      isOpen: s.isOpen,
      showAdvanced: s.showAdvanced,
      editingFilter: s.editingFilter,
      highlightedBadgeIndex: s.highlightedBadgeIndex,
    }))
  )
}

/**
 * Hook for derived boolean/number selectors.
 * These are primitives so they don't need useShallow.
 */
export function useSearchStatus() {
  const hasActiveFilters = useSearchStore(selectHasActiveFilters)
  const activeFilterCount = useSearchStore(selectActiveFilterCount)
  const displayText = useSearchStore(selectDisplayText)

  return { hasActiveFilters, activeFilterCount, displayText }
}

/**
 * Hook for recent searches with stable reference.
 */
export function useRecentSearches() {
  return useSearchStore((s) => s.recentSearches)
}

/**
 * Hook to sync search context with current mailbox context.
 * Call this at the top of your mailbox component to reset filters on context change.
 *
 * @param contextType - 'inbox' | 'organization' | etc.
 * @param contextId - The specific ID (inbox ID, org ID, etc.)
 */
export function useSearchContext(contextType: string, contextId?: string) {
  const setContext = useSearchStore((s) => s.setContext)
  const contextKey = `${contextType}:${contextId || 'all'}`

  useEffect(() => {
    setContext(contextKey)
  }, [contextKey, setContext])
}

/**
 * Hook for filters state (for direct access when needed).
 */
export function useSearchFilters() {
  return useSearchStore(useShallow((s) => s.filters))
}
