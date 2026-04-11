// apps/web/src/components/searchbar/searchbar-shell.tsx
'use client'

import type { Operator } from '@auxx/lib/conditions/client'
import type { AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Filter, Loader2, Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SearchFilterInput } from './search-filter-input'
import { SearchSuggestionsList } from './search-suggestions-list'
import type { SearchCondition, SearchSuggestion } from './types'

/**
 * Actions interface for the search store.
 * Passed from the consumer's store to the shell.
 */
interface SearchBarActions {
  addCondition: (fieldId: string, operator: Operator, value: any, displayLabel?: string) => void
  updateCondition: (id: string, updates: Partial<SearchCondition>) => void
  removeCondition: (id: string) => void
  clearConditions: () => void
  setConditions: (conditions: SearchCondition[]) => void
  setHighlightedIndex: (index: number | null) => void
}

/**
 * Props for SearchBarShell component
 */
export interface SearchBarShellProps {
  /** Controlled conditions array */
  conditions: SearchCondition[]
  /** Field IDs to hide from badge display */
  hiddenFieldIds?: Set<string>

  // Store callbacks
  actions: SearchBarActions
  highlightedIndex: number | null

  /** Whether any non-pinned conditions are active */
  hasActiveConditions: boolean
  /** Display text for current conditions (used for onSearch callback) */
  displayText: string

  /** Suggestions for the dropdown */
  suggestions: SearchSuggestion[]
  suggestionsLoading?: boolean
  onSuggestionSelect: (suggestion: SearchSuggestion) => void
  onDeleteRecentSuggestion?: (id: string) => void
  /** Render a custom display for recent search items in suggestions */
  renderRecentItem?: (suggestion: SearchSuggestion) => React.ReactNode

  /** Called when the user executes a search (Enter or apply) */
  onSearch: (conditions: SearchCondition[]) => void
  /** Called after search execution (e.g., save to recent, analytics) */
  onAfterSearch?: (conditions: SearchCondition[]) => void

  /** What field to use for free-text input (default: 'freeText') */
  freeTextField?: string
  /** Default operator for free-text conditions (default: 'contains') */
  freeTextOperator?: Operator

  /** Render the advanced filter panel */
  renderAdvancedFilter?: (props: {
    conditions: SearchCondition[]
    onApply: (conditions: SearchCondition[]) => void
    onCancel: () => void
  }) => React.ReactNode

  /** Field IDs that are pinned (non-removable, locked). Passed to SearchFilterInput for badge styling. */
  pinnedFieldIds?: Set<string>
  /** Custom class for pinned badges */
  pinnedBadgeClassName?: string
  /** Placeholder text for the input */
  placeholder?: string
  /** Additional CSS classes */
  className?: string
  /** Loading state indicator */
  isLoading?: boolean
  /** Show the filter toggle button (default: true) */
  showFilterButton?: boolean
  /** Whether to show the scope badge. Passed through to SearchFilterInput's visibility logic. */
  showScopeBadge?: boolean
}

/**
 * SearchBarShell - generic searchbar layout and keyboard orchestration.
 * Handles the visual shell, popover, keyboard shortcuts, and delegates
 * all domain logic to the consumer via props.
 */
export function SearchBarShell({
  conditions,
  hiddenFieldIds,
  actions,
  highlightedIndex,
  hasActiveConditions,
  displayText,
  suggestions,
  suggestionsLoading = false,
  onSuggestionSelect,
  onDeleteRecentSuggestion,
  renderRecentItem,
  onSearch,
  onAfterSearch,
  freeTextField = 'freeText',
  freeTextOperator = 'contains' as Operator,
  renderAdvancedFilter,
  pinnedFieldIds,
  pinnedBadgeClassName,
  placeholder = 'Search (/)...',
  className,
  isLoading = false,
  showFilterButton = true,
  showScopeBadge,
}: SearchBarShellProps) {
  const inputRef = useRef<AutosizeInputRef>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const searchBarContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRowRef = useRef<HTMLDivElement>(null)

  // Local UI state
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1)

  // Show pinned badges when: open, or consumer explicitly says so (showScopeBadge)
  const shouldShowPinnedBadges = showScopeBadge || isOpen
  const effectiveHiddenFieldIds = shouldShowPinnedBadges ? undefined : hiddenFieldIds

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

  /** Execute search with current conditions */
  const executeSearch = useCallback(() => {
    onSearch(conditions)
    onAfterSearch?.(conditions)
    setIsOpen(false)
  }, [conditions, onSearch, onAfterSearch])

  /** Handle input keydown for suggestion navigation and condition creation */
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Arrow navigation in suggestions
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        e.preventDefault()
        setHighlightedSuggestionIndex((prev) => Math.min(prev + 1, suggestions.length - 1))
        return
      }
      if (e.key === 'ArrowUp' && suggestions.length > 0) {
        e.preventDefault()
        setHighlightedSuggestionIndex((prev) => Math.max(prev - 1, -1))
        return
      }

      // Enter to select suggestion or add free text
      if (e.key === 'Enter') {
        e.preventDefault()

        // Select highlighted suggestion
        if (highlightedSuggestionIndex >= 0 && suggestions[highlightedSuggestionIndex]) {
          onSuggestionSelect(suggestions[highlightedSuggestionIndex])
          return
        }

        // Add typed value as free text condition
        if (inputValue.trim()) {
          actions.addCondition(freeTextField, freeTextOperator, inputValue.trim())
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
      freeTextField,
      freeTextOperator,
      onSuggestionSelect,
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
      onSearch([])
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

  /** Handle filter button click - toggles advanced mode */
  const handleFilterClick = useCallback(() => {
    const nextOpen = !showAdvanced
    setShowAdvanced(nextOpen)
    setIsOpen(nextOpen)
  }, [showAdvanced])

  return (
    <div ref={searchBarContainerRef} className={cn('w-full min-w-[20rem]', className)}>
      {/* Search input row - always visible, outside popover */}
      <div
        ref={searchInputRowRef}
        className={cn(
          'flex items-center h-7 sm:h-8 bg-primary-50 hover:bg-background pe-1 transition-colors border',
          isOpen
            ? 'rounded-t-2xl bg-background border border-b-0 border-foreground/15'
            : 'rounded-full border-transparent'
        )}>
        <Search className='size-4 shrink-0 opacity-50 ml-3 mr-2' />

        <SearchFilterInput
          conditions={conditions}
          hiddenFieldIds={effectiveHiddenFieldIds}
          highlightedIndex={highlightedIndex}
          onUpdateCondition={actions.updateCondition}
          onRemoveCondition={actions.removeCondition}
          onHighlightChange={actions.setHighlightedIndex}
          inputRef={inputRef}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onInputKeyDown={handleInputKeyDown}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          className='flex-1'
          searchBarRef={searchBarContainerRef}
          pinnedFieldIds={pinnedFieldIds}
          pinnedBadgeClassName={pinnedBadgeClassName}
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
        {showFilterButton && (
          <Button
            ref={filterButtonRef}
            variant='ghost'
            aria-selected={showAdvanced ? 'true' : 'false'}
            className={cn('size-6 rounded-full aria-[selected=true]:bg-primary-200')}
            onClick={handleFilterClick}>
            <Filter className='size-4 shrink-0 opacity-50' />
          </Button>
        )}
      </div>

      {/* Popover for dropdown - anchored below input */}
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverAnchor className='w-full flex-1' />
        <PopoverContent
          className='rounded-t-none rounded-b-2xl border-t-0 p-0 shadow-lg'
          align='start'
          sideOffset={0}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement
            // Prevent closing when clicking the filter button
            if (filterButtonRef.current?.contains(target)) {
              e.preventDefault()
              return
            }
            // Prevent closing when clicking inside the search input row
            if (searchInputRowRef.current?.contains(target)) {
              e.preventDefault()
              return
            }
            // Prevent closing when clicking inside portaled popover content
            // owned by searchbar badges (operator/value pickers portal to <body>)
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
          {showAdvanced && renderAdvancedFilter ? (
            renderAdvancedFilter({
              conditions,
              onApply: handleApplyAdvancedConditions,
              onCancel: () => setShowAdvanced(false),
            })
          ) : (
            <SearchSuggestionsList
              suggestions={suggestions}
              highlightedIndex={highlightedSuggestionIndex}
              onSelect={onSuggestionSelect}
              onDeleteRecent={onDeleteRecentSuggestion}
              renderRecentItem={renderRecentItem}
              showEmpty={!inputValue && !hasActiveConditions}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
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
