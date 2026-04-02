// apps/web/src/components/mail/searchbar/index.tsx
'use client'

import {
  getDefaultOperatorForField,
  getMailViewFieldDefinition,
  MAIL_VIEW_FIELD_DEFINITIONS,
  SEARCH_SCOPE_FIELD_ID,
} from '@auxx/lib/mail-views/client'
import { useCallback } from 'react'
import { v4 as generateId } from 'uuid'
import { ConditionProvider } from '~/components/conditions/condition-context'
import { useMailFilter } from '~/components/mail/mail-filter-context'
import { SearchBarShell } from '~/components/searchbar/searchbar-shell'
import type { SearchCondition, SearchSuggestion } from '~/components/searchbar/types'
import { useAnalytics } from '~/hooks/use-analytics'
import {
  useDeleteRecentSearch,
  useSaveSearchQuery,
  useSearchSuggestions,
} from './_hooks/use-search-suggestions'
import { AdvancedFilterMode } from './advanced-filter-mode'
import { RecentSearchDisplay } from './recent-search-display'
import {
  buildFilterChips,
  selectConditionCount,
  selectDisplayText,
  selectHasActiveConditions,
  useSearchActions,
  useSearchStore,
} from './store'

const MAIL_HIDDEN_FIELD_IDS = new Set([SEARCH_SCOPE_FIELD_ID])

/**
 * Props for MailSearchBar component
 */
interface MailSearchBarProps {
  /** Callback when search is executed (Enter pressed or filter applied) */
  onSearch: (query: string) => void
  /** Initial query string for the search bar */
  initialQuery?: string
  /** Additional CSS classes */
  className?: string
  /** Debounce delay in milliseconds */
  debounceDelay?: number
  /** Loading state indicator */
  isLoading?: boolean
}

/** Alias for backward compatibility */
export interface SearchBarProps extends MailSearchBarProps {}
export const SearchBar = MailSearchBar

/**
 * MailSearchBar - thin wrapper around SearchBarShell.
 * Wires mail-specific store, suggestions, and advanced filter UI.
 */
export function MailSearchBar({
  onSearch,
  initialQuery = '',
  className,
  debounceDelay = 500,
  isLoading = false,
}: MailSearchBarProps) {
  // Store state
  const hasActiveConditions = useSearchStore(selectHasActiveConditions)
  const conditionCount = useSearchStore(selectConditionCount)
  const displayText = useSearchStore(selectDisplayText)
  const conditions = useSearchStore((s) => s.conditions)
  const highlightedIndex = useSearchStore((s) => s.highlightedIndex)
  const actions = useSearchActions()

  const posthog = useAnalytics()
  const deleteRecentSearch = useDeleteRecentSearch()

  // Hide scope badge for view contexts — view filters ARE the scope
  const { contextType } = useMailFilter()
  const isViewContext = contextType === 'view'

  // Build chips for display
  const chips = buildFilterChips(conditions)

  // Save search query hook
  const saveSearchQuery = useSaveSearchQuery()

  // Get suggestions (SearchBarShell manages its own isOpen/inputValue state,
  // but we need to pass suggestions. We'll use a simple approach: always fetch
  // suggestions and let the shell handle when to show them)
  const { suggestions, isLoading: suggestionsLoading } = useSearchSuggestions({
    query: '', // Shell manages input value internally; suggestions are fetched for empty state
    enabled: true,
  })

  /** Handle suggestion selection */
  const handleSuggestionSelect = useCallback(
    (suggestion: SearchSuggestion) => {
      // Recent search - restore conditions and execute
      if (suggestion.type === 'recent' && suggestion.conditions) {
        const conditionsWithIds = suggestion.conditions.map((c) => ({
          ...c,
          id: c.id || generateId(),
        }))
        actions.setConditions(conditionsWithIds)
        // Execute search with restored conditions
        setTimeout(() => {
          onSearch(displayText)
        }, 0)
        return
      }

      // Field selection - add condition with undefined value
      if (suggestion.type === 'field' && suggestion.fieldId) {
        const defaultOperator = getDefaultOperatorForField(suggestion.fieldId)
        actions.addCondition(suggestion.fieldId, defaultOperator, undefined)
        return
      }
    },
    [actions, onSearch, displayText]
  )

  /** After search: analytics + save to recent */
  const handleAfterSearch = useCallback(
    (searchConditions: SearchCondition[]) => {
      const query = displayText
      posthog?.capture('search_performed', {
        context: 'tickets',
        has_filters: searchConditions.length > 0,
      })
      // Save conditions for recent searches (exclude scope)
      const saveable = searchConditions.filter((c) => c.fieldId !== SEARCH_SCOPE_FIELD_ID)
      if (saveable.length > 0) {
        saveSearchQuery(
          saveable.map((c) => ({
            id: c.id,
            fieldId: c.fieldId,
            operator: c.operator,
            value: c.value,
            displayLabel: c.displayLabel,
          })),
          query
        )
      }
    },
    [displayText, posthog, saveSearchQuery]
  )

  /** Handle conditions change from ConditionProvider */
  const handleConditionsChange = useCallback(
    (newConditions: any[]) => {
      actions.setConditions(
        newConditions.map((c) => ({
          id: c.id,
          fieldId: c.fieldId,
          operator: c.operator,
          value: c.value,
          displayLabel: c.displayLabel,
        }))
      )
    },
    [actions]
  )

  /** Render recent search item with mail-specific badges */
  const renderRecentItem = useCallback((suggestion: SearchSuggestion) => {
    if (suggestion.conditions) {
      return <RecentSearchDisplay conditions={suggestion.conditions} />
    }
    return <span className='truncate text-primary-700'>{suggestion.label}</span>
  }, [])

  return (
    <ConditionProvider
      conditions={conditions}
      config={{
        mode: 'resource',
        fields: MAIL_VIEW_FIELD_DEFINITIONS.filter((f) => f.id !== SEARCH_SCOPE_FIELD_ID),
        showGrouping: false,
        compactMode: true,
      }}
      getFieldDefinition={(fieldId) => getMailViewFieldDefinition(fieldId) as any}
      onConditionsChange={handleConditionsChange}>
      <SearchBarShell
        conditions={conditions}
        hiddenFieldIds={MAIL_HIDDEN_FIELD_IDS}
        actions={actions}
        highlightedIndex={highlightedIndex}
        hasActiveConditions={hasActiveConditions}
        displayText={displayText}
        suggestions={suggestions}
        suggestionsLoading={suggestionsLoading}
        onSuggestionSelect={handleSuggestionSelect}
        onDeleteRecentSuggestion={deleteRecentSearch}
        renderRecentItem={renderRecentItem}
        onSearch={() => onSearch(displayText)}
        onAfterSearch={handleAfterSearch}
        freeTextField='freeText'
        renderAdvancedFilter={({ conditions: advConditions, onApply, onCancel }) => (
          <AdvancedFilterMode
            initialConditions={advConditions}
            onApply={onApply}
            onCancel={onCancel}
          />
        )}
        pinnedFieldIds={MAIL_HIDDEN_FIELD_IDS}
        pinnedBadgeClassName='bg-accent/30 border-accent/40'
        placeholder='Search (/)...'
        className={className}
        isLoading={isLoading}
        showScopeBadge={!isViewContext && hasActiveConditions}
      />
    </ConditionProvider>
  )
}
