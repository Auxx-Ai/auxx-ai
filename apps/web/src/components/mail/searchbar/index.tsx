// apps/web/src/components/mail/searchbar/index.tsx
'use client'

import {
  getDefaultOperatorForField,
  getMailViewFieldDefinition,
  MAIL_VIEW_FIELD_DEFINITIONS,
  SEARCH_SCOPE_FIELD_ID,
} from '@auxx/lib/mail-views/client'
import type { AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Filter, Loader2, Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as generateId } from 'uuid'
import { ConditionProvider } from '~/components/conditions/condition-context'
import { useMailFilter } from '~/components/mail/mail-filter-context'
import { useAnalytics } from '~/hooks/use-analytics'
import { useSaveSearchQuery, useSearchSuggestions } from './_hooks/use-search-suggestions'
import { AdvancedFilterMode } from './advanced-filter-mode'
import { SearchFilterInput } from './search-filter-input'
import { type SearchSuggestion, SearchSuggestionsList } from './search-suggestions-list'
import {
  buildFilterChips,
  type SearchCondition,
  selectConditionCount,
  selectDisplayText,
  selectHasActiveConditions,
  useSearchActions,
  useSearchStore,
} from './store'

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
 * MailSearchBar component with store-driven condition management.
 * Supports both inline text input and structured condition badges.
 * Wrapped in ConditionProvider so ConditionBadge components can access context.
 */
export function MailSearchBar({
  onSearch,
  initialQuery = '',
  className,
  debounceDelay = 500,
  isLoading = false,
}: MailSearchBarProps) {
  const inputRef = useRef<AutosizeInputRef>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const searchInputRowRef = useRef<HTMLDivElement>(null)

  // Local UI state
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1)

  // Store state
  const hasActiveConditions = useSearchStore(selectHasActiveConditions)
  const conditionCount = useSearchStore(selectConditionCount)
  const displayText = useSearchStore(selectDisplayText)
  const conditions = useSearchStore((s) => s.conditions)
  const actions = useSearchActions()

  const posthog = useAnalytics()

  // Hide scope badge for view contexts — view filters ARE the scope
  const { contextType } = useMailFilter()
  const isViewContext = contextType === 'view'

  // Build chips for display
  const chips = buildFilterChips(conditions)

  // Save search query hook
  const saveSearchQuery = useSaveSearchQuery()

  // Get suggestions
  const { suggestions, isLoading: suggestionsLoading } = useSearchSuggestions({
    query: inputValue,
    enabled: isOpen && !showAdvanced,
  })

  // Reset suggestion highlight when suggestions change
  // biome-ignore lint/correctness/useExhaustiveDependencies: suggestions triggers index reset when results change
  useEffect(() => {
    setHighlightedSuggestionIndex(-1)
  }, [suggestions])

  // Keyboard shortcut to open (/)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !isOpen && !isInputFocused()) {
        e.preventDefault()
        setIsOpen(true)
        setTimeout(() => inputRef.current?.focus(), 50)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

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
        setInputValue('')
        // Execute search with restored conditions
        setTimeout(() => {
          onSearch(displayText)
        }, 0)
        setIsOpen(false)
        return
      }

      // Field selection - add condition with undefined value
      // The ConditionBadge will detect undefined value and auto-open the picker
      if (suggestion.type === 'field' && suggestion.fieldId) {
        const fieldDef = suggestion.fieldDefinition
        const defaultOperator = fieldDef ? getDefaultOperatorForField(suggestion.fieldId) : 'is'

        // Add condition with undefined value - picker will auto-open
        actions.addCondition(suggestion.fieldId, defaultOperator, undefined)
        setInputValue('')
        setHighlightedSuggestionIndex(-1)
        return
      }
    },
    [actions, onSearch, displayText]
  )

  /** Execute search with current conditions */
  const executeSearch = useCallback(() => {
    const query = displayText
    onSearch(query)
    posthog?.capture('search_performed', {
      context: 'tickets',
      has_filters: conditions.length > 0,
    })
    // Save conditions for recent searches (exclude scope — it's a UI setting, not a filter)
    const saveable = conditions.filter((c) => c.fieldId !== SEARCH_SCOPE_FIELD_ID)
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
    setIsOpen(false)
  }, [displayText, conditions, onSearch, saveSearchQuery, posthog])

  /** Handle input keydown for suggestion navigation and condition creation */
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Arrow navigation in suggestions
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        e.preventDefault()
        setHighlightedSuggestionIndex((i) => Math.min(i + 1, suggestions.length - 1))
        return
      }
      if (e.key === 'ArrowUp' && suggestions.length > 0) {
        e.preventDefault()
        setHighlightedSuggestionIndex((i) => Math.max(i - 1, -1))
        return
      }

      // Enter to select suggestion or add free text
      if (e.key === 'Enter') {
        e.preventDefault()

        // Select highlighted suggestion
        if (highlightedSuggestionIndex >= 0 && suggestions[highlightedSuggestionIndex]) {
          handleSuggestionSelect(suggestions[highlightedSuggestionIndex])
          return
        }

        // Add typed value as free text condition
        if (inputValue.trim()) {
          actions.addCondition('freeText', 'contains', inputValue.trim())
          setInputValue('')
        }

        // Execute search
        executeSearch()
        return
      }

      // Escape to close or clear
      if (e.key === 'Escape') {
        if (inputValue) {
          setInputValue('')
        } else {
          setIsOpen(false)
        }
      }
    },
    [
      suggestions,
      highlightedSuggestionIndex,
      inputValue,
      handleSuggestionSelect,
      actions,
      executeSearch,
    ]
  )

  /** Handle input focus */
  const handleInputFocus = useCallback(() => {
    setIsOpen(true)
  }, [])

  /** Clear all conditions and input */
  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setInputValue('')
      actions.clearConditions()
      onSearch('')
    },
    [actions, onSearch]
  )

  /** Handle open/close */
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open)
    if (!open) {
      setShowAdvanced(false)
    }
  }, [])

  /** Handle advanced filter application */
  const handleApplyAdvancedConditions = useCallback(
    (newConditions: SearchCondition[]) => {
      actions.setConditions(newConditions)
      setShowAdvanced(false)
      executeSearch()
    },
    [actions, executeSearch]
  )

  /** Handle conditions change from ConditionProvider */
  const handleConditionsChange = useCallback(
    (newConditions: any[]) => {
      // Convert from Condition type to SearchCondition type
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

  /** Handle filter button click - toggles advanced mode */
  const handleFilterClick = useCallback(() => {
    const nextOpen = !showAdvanced
    setShowAdvanced(nextOpen)
    setIsOpen(nextOpen)
  }, [showAdvanced])

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
      <div className={cn('w-full min-w-[20rem] ', className)}>
        {/* Search input row - always visible, outside popover */}
        <div
          ref={searchInputRowRef}
          className={cn(
            'flex items-center h-8 bg-primary-50 hover:bg-background pe-1 transition-colors border',
            isOpen
              ? 'rounded-t-2xl bg-background border border-b-0 border-foreground/15'
              : 'rounded-full border-transparent'
          )}>
          <Search className='size-4 shrink-0 opacity-50 ml-3 mr-2' />

          <SearchFilterInput
            inputRef={inputRef}
            inputValue={inputValue}
            showScopeBadge={!isViewContext && (isOpen || hasActiveConditions)}
            onInputChange={setInputValue}
            onInputKeyDown={handleInputKeyDown}
            onFocus={handleInputFocus}
            placeholder='Search...'
            className='flex-1'
          />

          {/* Loading indicator */}
          {(isLoading || suggestionsLoading) && (
            <Loader2 className='h-4 w-4 animate-spin text-muted-foreground mr-1' />
          )}

          {/* Clear button */}
          {(inputValue || hasActiveConditions) && (
            <Button
              variant='ghost'
              size='icon'
              className='size-6 rounded-full shrink-0 bg-primary-50 hover:bg-primary-100 [&_svg]:opacity-50 hover:[&_svg]:opacity-100'
              onClick={handleClear}>
              <X className='size-4 shrink-0' />
            </Button>
          )}

          {/* Filter button */}
          <Button
            ref={filterButtonRef}
            variant='ghost'
            aria-selected={showAdvanced ? 'true' : 'false'}
            className={cn('size-6 rounded-full aria-[selected=true]:bg-primary-200')}
            onClick={handleFilterClick}>
            <Filter className='size-4 shrink-0 opacity-50' />
          </Button>
        </div>

        {/* Popover for dropdown - anchored below input */}
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
          <PopoverAnchor className='w-full flex-1' />
          <PopoverContent
            className='rounded-t-none rounded-b-2xl border-t-0 p-0 shadow-lg'
            align='start'
            sideOffset={0}
            // onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              const target = e.target as HTMLElement
              // Prevent closing when clicking the filter button
              if (filterButtonRef.current?.contains(target)) {
                e.preventDefault()
                return
              }
              // Prevent closing when clicking inside the search input row
              // (badge triggers, operator buttons, input — all live outside PopoverContent)
              if (searchInputRowRef.current?.contains(target)) {
                e.preventDefault()
                return
              }
              // Prevent closing when clicking inside portaled popover content
              // owned by searchbar badges (operator/value pickers portal to <body>).
              // Trace back to the trigger via aria-controls to verify ownership.
              const popoverWrapper = target.closest('[data-radix-popper-content-wrapper]')
              if (popoverWrapper && searchInputRowRef.current) {
                const contentEl = popoverWrapper.querySelector('[id]')
                if (contentEl) {
                  const trigger = document.querySelector(`[aria-controls="${contentEl.id}"]`)
                  if (trigger && searchInputRowRef.current.contains(trigger)) {
                    e.preventDefault()
                    return
                  }
                }
              }
            }}
            style={{ width: 'var(--radix-popover-trigger-width)' }}>
            {showAdvanced ? (
              <AdvancedFilterMode
                initialConditions={conditions}
                onApply={handleApplyAdvancedConditions}
                onCancel={() => setShowAdvanced(false)}
              />
            ) : (
              <SearchSuggestionsList
                suggestions={suggestions}
                onSelect={handleSuggestionSelect}
                showEmpty={!inputValue && chips.length === 0}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
    </ConditionProvider>
  )
}

/** Check if an input element is currently focused */
function isInputFocused(): boolean {
  const active = document.activeElement
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active as HTMLElement)?.isContentEditable === true
  )
}
