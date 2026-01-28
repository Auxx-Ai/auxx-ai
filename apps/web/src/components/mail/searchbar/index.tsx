// apps/web/src/components/mail/searchbar/index.tsx
'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Filter, Loader2, Search, X } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Command, CommandList } from '@auxx/ui/components/command'
import { Badge } from '@auxx/ui/components/badge'

import { SearchFilterInput } from './search-filter-input'
import { SearchSuggestionsList, type SearchSuggestion } from './search-suggestions-list'
import { AdvancedFilterMode } from './advanced-filter-mode'
import { useSearchSuggestions, useSaveSearchQuery } from './_hooks/use-search-suggestions'
import { ConditionProvider } from '~/components/conditions/condition-context'
import { MAIL_VIEW_FIELD_DEFINITIONS } from '@auxx/lib/mail-views/client'
import {
  useSearchStore,
  selectHasActiveConditions,
  selectConditionCount,
  selectDisplayText,
  buildFilterChips,
  useSearchActions,
  type SearchCondition,
} from './store'
import { getDefaultOperatorForField } from '@auxx/lib/mail-views/client'

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
 * Map suggestion type to condition fieldId
 */
function mapSuggestionTypeToFieldId(type: string): string {
  const map: Record<string, string> = {
    tag: 'tag',
    user: 'assignee',
    participant: 'from',
    inbox: 'inbox',
    status: 'status',
    has: 'hasAttachments',
    operator: 'freeText',
    recent: 'freeText',
  }
  return map[type] || 'freeText'
}

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
  const inputRef = useRef<HTMLInputElement>(null)
  const commandRef = useRef<HTMLDivElement>(null)

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

  // Build chips for display
  const chips = buildFilterChips(conditions)

  // Save search query hook
  const saveSearchQuery = useSaveSearchQuery()

  // Parse operator from input (e.g., "tag:urgent" -> operator: "tag", query: "urgent")
  const operatorMatch = inputValue.match(/^(\w+):(.*)$/)
  const currentOperator = operatorMatch?.[1]?.toLowerCase()
  const currentQuery = operatorMatch?.[2] ?? inputValue

  // Get suggestions
  const { suggestions, isLoading: suggestionsLoading } = useSearchSuggestions({
    query: inputValue,
    enabled: isOpen && !showAdvanced,
  })

  // Reset suggestion highlight when suggestions change
  useEffect(() => {
    setHighlightedSuggestionIndex(-1)
  }, [suggestions])

  // Keyboard shortcut to open (/)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !isOpen && !isInputFocused()) {
        e.preventDefault()
        setIsOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Focus input when popover opens
  useEffect(() => {
    if (isOpen && !showAdvanced) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, showAdvanced])

  /** Handle suggestion selection */
  const handleSuggestionSelect = useCallback(
    (suggestion: SearchSuggestion) => {
      // Operator selection - set input to that operator
      if (suggestion.type === 'operator') {
        setInputValue(suggestion.value)
        return
      }

      // Recent search - execute immediately
      if (suggestion.type === 'recent') {
        onSearch(suggestion.value)
        setInputValue('')
        setIsOpen(false)
        return
      }

      // Map suggestion to fieldId and add condition
      const fieldId = mapSuggestionTypeToFieldId(currentOperator || suggestion.type)
      const operator = getDefaultOperatorForField(fieldId)

      // Handle different field types
      switch (fieldId) {
        case 'tag':
        case 'assignee':
        case 'inbox':
          // Entity fields use value as ID, label as display
          actions.addCondition(fieldId, operator, suggestion.value, suggestion.label)
          break
        case 'hasAttachments':
          actions.addCondition(fieldId, 'is', true)
          break
        case 'status':
          actions.addCondition(fieldId, 'is', suggestion.value)
          break
        default:
          // Text fields use value directly
          actions.addCondition(fieldId, operator, suggestion.value)
      }

      setInputValue('')
      setHighlightedSuggestionIndex(-1)
    },
    [currentOperator, actions, onSearch]
  )

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

      // Enter to select suggestion or add condition
      if (e.key === 'Enter') {
        e.preventDefault()

        // Select highlighted suggestion
        if (highlightedSuggestionIndex >= 0 && suggestions[highlightedSuggestionIndex]) {
          handleSuggestionSelect(suggestions[highlightedSuggestionIndex])
          return
        }

        // Add typed value as condition
        if (currentOperator && currentQuery) {
          // Entity operators need autocomplete selection
          if (['tag', 'assignee', 'inbox'].includes(currentOperator)) {
            // Don't add without selection
            return
          }

          switch (currentOperator) {
            case 'from':
              actions.addCondition('from', 'contains', currentQuery)
              break
            case 'to':
              actions.addCondition('to', 'contains', currentQuery)
              break
            case 'subject':
              actions.addCondition('subject', 'contains', currentQuery)
              break
            case 'body':
              actions.addCondition('body', 'contains', currentQuery)
              break
            case 'is':
              actions.addCondition('status', 'is', currentQuery)
              break
            case 'has':
              if (currentQuery === 'attachments') {
                actions.addCondition('hasAttachments', 'is', true)
              }
              break
            case 'before': {
              const date = new Date(currentQuery)
              if (!isNaN(date.getTime())) {
                actions.addCondition('before', 'before', date.toISOString())
              }
              break
            }
            case 'after': {
              const date = new Date(currentQuery)
              if (!isNaN(date.getTime())) {
                actions.addCondition('after', 'after', date.toISOString())
              }
              break
            }
          }
          setInputValue('')
          return
        }

        // Free text or execute search
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
      currentOperator,
      currentQuery,
      inputValue,
      handleSuggestionSelect,
      actions,
    ]
  )

  /** Execute search with current conditions */
  const executeSearch = useCallback(() => {
    const query = displayText
    onSearch(query)
    saveSearchQuery(query)
    setIsOpen(false)
  }, [displayText, onSearch, saveSearchQuery])

  /** Clear all conditions and input */
  const handleClear = useCallback(() => {
    setInputValue('')
    actions.clearConditions()
    onSearch('')
    setIsOpen(false)
  }, [actions, onSearch])

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

  return (
    <ConditionProvider
      conditions={conditions}
      config={{
        mode: 'resource',
        fields: MAIL_VIEW_FIELD_DEFINITIONS,
        showGrouping: false,
        compactMode: true,
      }}
      onConditionsChange={handleConditionsChange}
    >
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          asChild
          className="w-full h-7 flex flex-1 min-w-[20rem] max-w-[30rem] justify-start items-center relative bg-primary-50 hover:bg-background rounded-full pe-1"
        >
          <div>
            <div
              onClick={() => {
                setShowAdvanced(false)
                setIsOpen(true)
              }}
              className="px-3 whitespace-nowrap rounded-md font-medium transition-colors gap-2 text-sm inline-flex items-center shrink-0 w-full flex-1 h-7 overflow-hidden justify-start relative bg-transparent shadow-none hover:bg-transparent focus:ring-0 focus:ring-offset-0 focus:outline-hidden"
            >
              <Search className="size-4 shrink-0 opacity-50" />
              <TriggerDisplay
                hasConditions={hasActiveConditions}
                conditionCount={conditionCount}
                chips={chips}
              />
            </div>

            <div className="flex items-center gap-1 absolute right-7">
              {(isLoading || suggestionsLoading) && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            <Button
              variant="ghost"
              aria-selected={showAdvanced ? 'true' : 'false'}
              className={cn('size-6 rounded-full aria-[selected=true]:bg-primary-200')}
              onClick={(e) => {
                e.stopPropagation()
                setShowAdvanced(true)
                setIsOpen(true)
              }}
            >
              <Filter className="size-4 shrink-0 opacity-50" />
            </Button>
          </div>
        </PopoverTrigger>

        <PopoverContent
          className="w-full p-0 ml-[1px] animate-none! border-0 rounded-t-2xl bg-background"
          align="start"
          sideOffset={-28}
          style={{
            width: 'calc(0px + var(--radix-popover-trigger-width))',
            maxHeight: 'var(--radix-popover-content-available-height)',
          }}
        >
          {showAdvanced ? (
            <div className="flex flex-col">
              <AdvancedFilterMode
                initialConditions={conditions}
                onApply={handleApplyAdvancedConditions}
                onCancel={() => setShowAdvanced(false)}
              />
            </div>
          ) : (
            <Command
              ref={commandRef}
              shouldFilter={false}
              className="bg-transparent rounded-t-xl shadow-none"
            >
              <div className="flex items-center border-b px-3 relative min-h-7">
                <Search className="mr-2 h-4 w-4 shrink-0 opacity-50 ml-[-1px]" />
                <SearchFilterInput
                  inputRef={inputRef}
                  inputValue={inputValue}
                  onInputChange={setInputValue}
                  onInputKeyDown={handleInputKeyDown}
                  placeholder="Search..."
                  className="flex-1"
                />

                <div className="flex items-center gap-1 absolute right-[29px]">
                  {(isLoading || suggestionsLoading) && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>

                <Button
                  variant="ghost"
                  aria-selected={showAdvanced ? 'true' : 'false'}
                  className={cn(
                    'size-6 rounded-full aria-[selected=true]:bg-primary-200 absolute right-[4px]'
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowAdvanced(true)
                  }}
                >
                  <Filter className="size-4 shrink-0 opacity-50" />
                </Button>

                {(inputValue || hasActiveConditions) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 rounded-full shrink-0 bg-primary-50 hover:bg-primary-100 absolute right-[29px] [&_svg]:opacity-50 hover:[&_svg]:opacity-100"
                    onClick={handleClear}
                  >
                    <X className="size-4 shrink-0" />
                  </Button>
                )}
              </div>

              <CommandList>
                <SearchSuggestionsList
                  suggestions={suggestions}
                  onSelect={handleSuggestionSelect}
                  showEmpty={!inputValue && chips.length === 0}
                />
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>
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

/** Display component for the trigger button */
function TriggerDisplay({
  hasConditions,
  conditionCount,
  chips,
}: {
  hasConditions: boolean
  conditionCount: number
  chips: Array<{ key: string; type: string; value: string }>
}) {
  if (!hasConditions) {
    return <span className="text-muted-foreground/60">Search...</span>
  }

  return (
    <div className="w-full flex items-center flex-1">
      <div className="flex items-center gap-1 w-full overflow-x-auto no-scrollbar">
        {chips.slice(0, 3).map((chip) => (
          <Badge key={chip.key} variant="user" className="px-2 pe-1 shrink-0">
            <span className="text-blue-600 font-medium">{chip.type}:</span>
            <span className="max-w-[100px] truncate">{chip.value}</span>
          </Badge>
        ))}
        {chips.length > 3 && (
          <span className="text-xs text-muted-foreground">+{chips.length - 3} more</span>
        )}
      </div>
    </div>
  )
}
