'use client'

import type { ConditionGroup } from '@auxx/lib/conditions'

import type { Active } from '@dnd-kit/core' // Import Active type
import React, { createContext, type ReactNode, useContext, useMemo } from 'react'

// Types for view mode and sorting
export type ViewMode = 'view' | 'edit'
export type SortOption = 'newest' | 'oldest' | 'sender' | 'subject'
export type SortDirection = 'asc' | 'desc'

/**
 * Defines the shape of the data stored in the MailFilterContext.
 */
interface MailFilterState {
  /** The type of the current mail view context (e.g., 'personal_inbox', 'tag'). */
  contextType: string
  /** The ID associated with the context, if applicable (e.g., tagId, inboxId). */
  contextId?: string
  /** The currently active status filter slug (e.g., 'open', 'done', 'assigned'). */
  statusSlug: string
  /** The search query currently applied to the list (use the deferred value for consistency). */
  searchQuery?: string // Use the deferred value from Mailbox here

  selectedThreadIds: string[]

  /** Current view mode - determines whether checkboxes are shown and selection behavior */
  viewMode: ViewMode
  /** Current sort option for thread list */
  sortBy: SortOption
  /** Current sort direction */
  sortDirection: SortDirection

  /** Pre-built filter conditions for client-side filtering (optimistic updates) */
  filterConditions: ConditionGroup[]
  // activeDragItem: Active | null
}

/**
 * Extended interface for context that includes action handlers.
 * This allows components to modify the filter state.
 */
interface MailFilterContextType extends MailFilterState {
  /** Function to change the view mode */
  setViewMode?: (mode: ViewMode) => void
  /** Function to change the sort option */
  setSortBy?: (sort: SortOption) => void
  /** Function to change the sort direction */
  setSortDirection?: (direction: SortDirection) => void
}

// Create the context with a default value (null indicates it's not yet provided)
const MailFilterContext = createContext<MailFilterContextType | null>(null)

/**
 * Props for the MailFilterProvider component.
 */
interface MailFilterProviderProps {
  children: ReactNode
  /** The filter values to provide to the context. */
  value: MailFilterContextType
}

/**
 * Provides the current mail filter state to its children components.
 * Should be placed high in the component tree (e.g., within Mailbox).
 */
export function MailFilterProvider({ children, value }: MailFilterProviderProps) {
  // Memoize the context value to prevent unnecessary re-renders of consumers
  // if the value object itself hasn't changed identity (though primitive changes will still trigger updates).
  const memoizedValue = useMemo(
    () => value,
    [
      value.contextType,
      value.contextId,
      value.statusSlug,
      value.searchQuery,
      value.selectedThreadIds,
      value.viewMode,
      value.sortBy,
      value.sortDirection,
      value.filterConditions,
      value.setViewMode,
      value.setSortBy,
      value.setSortDirection,
      // value.activeDragItem,
    ]
  )

  return <MailFilterContext.Provider value={memoizedValue}>{children}</MailFilterContext.Provider>
}

/**
 * Custom hook to easily consume the MailFilterContext.
 * Throws an error if used outside of a MailFilterProvider.
 * @returns {MailFilterContextType} The current mail filter state and action handlers.
 */
export function useMailFilter(): MailFilterContextType {
  const context = useContext(MailFilterContext)
  if (context === null) {
    throw new Error('useMailFilter must be used within a MailFilterProvider')
  }
  return context
}
