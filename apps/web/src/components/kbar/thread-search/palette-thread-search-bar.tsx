// apps/web/src/components/kbar/thread-search/palette-thread-search-bar.tsx
'use client'

import {
  getDefaultOperatorForField,
  getMailViewFieldDefinition,
  MAIL_VIEW_FIELD_DEFINITIONS,
  SEARCH_SCOPE_FIELD_ID,
} from '@auxx/lib/mail-views/client'
import { useCallback } from 'react'
import { v4 as generateId } from 'uuid'
import { useShallow } from 'zustand/react/shallow'
import { ConditionProvider } from '~/components/conditions/condition-context'
import {
  useDeleteRecentSearch,
  useSearchSuggestions,
} from '~/components/mail/searchbar/_hooks/use-search-suggestions'
import { AdvancedFilterMode } from '~/components/mail/searchbar/advanced-filter-mode'
import { RecentSearchDisplay } from '~/components/mail/searchbar/recent-search-display'
import { SearchBarShell } from '~/components/searchbar/searchbar-shell'
import type { SearchSuggestion } from '~/components/searchbar/types'
import { selectDisplayText, selectHasActiveConditions, usePaletteThreadSearchStore } from './store'

const MAIL_HIDDEN_FIELD_IDS = new Set([SEARCH_SCOPE_FIELD_ID])

interface PaletteThreadSearchBarProps {
  /** Callback when search is executed (Enter pressed or filter applied). */
  onSearch: (query: string) => void
  /** Additional CSS classes. */
  className?: string
  /** Loading state indicator. */
  isLoading?: boolean
}

/**
 * Isolated copy of `MailSearchBar` bound to {@link usePaletteThreadSearchStore}
 * instead of the inbox singleton (friction #1 in the thread-reader plan). The
 * only real differences from the original are the store import and a hardcoded
 * `showScopeBadge={false}` (the palette mounts outside `MailFilterProvider`, so
 * the original's lone `useMailFilter()` read is dropped). The
 * `ConditionProvider` + `SearchBarShell` body and the suggestions hooks are
 * unchanged, so this tracks the original closely.
 */
export function PaletteThreadSearchBar({
  onSearch,
  className,
  isLoading = false,
}: PaletteThreadSearchBarProps) {
  const conditions = usePaletteThreadSearchStore((s) => s.conditions)
  const highlightedIndex = usePaletteThreadSearchStore((s) => s.highlightedIndex)
  const hasActiveConditions = usePaletteThreadSearchStore(selectHasActiveConditions)
  const displayText = usePaletteThreadSearchStore(selectDisplayText)
  const actions = usePaletteThreadSearchStore(
    useShallow((s) => ({
      addCondition: s.addCondition,
      updateCondition: s.updateCondition,
      removeCondition: s.removeCondition,
      clearConditions: s.clearConditions,
      setConditions: s.setConditions,
      setHighlightedIndex: s.setHighlightedIndex,
    }))
  )

  const deleteRecentSearch = useDeleteRecentSearch()

  const { suggestions, isLoading: suggestionsLoading } = useSearchSuggestions({
    query: '',
    enabled: true,
  })

  const handleSuggestionSelect = useCallback(
    (suggestion: SearchSuggestion) => {
      if (suggestion.type === 'recent' && suggestion.conditions) {
        const conditionsWithIds = suggestion.conditions.map((c) => ({
          ...c,
          id: c.id || generateId(),
        }))
        actions.setConditions(conditionsWithIds)
        setTimeout(() => {
          onSearch(displayText)
        }, 0)
        return
      }

      if (suggestion.type === 'field' && suggestion.fieldId) {
        const defaultOperator = getDefaultOperatorForField(suggestion.fieldId)
        actions.addCondition(suggestion.fieldId, defaultOperator, undefined)
        return
      }
    },
    [actions, onSearch, displayText]
  )

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
      getFieldDefinition={(fieldId) =>
        typeof fieldId === 'string' ? (getMailViewFieldDefinition(fieldId) as any) : undefined
      }
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
        placeholder='Search all threads…'
        className={className}
        isLoading={isLoading}
        showScopeBadge={false}
        openOnFocus={false}
      />
    </ConditionProvider>
  )
}
