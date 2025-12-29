// src/components/mail/searchbar/index.tsx
'use client'

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { Filter, Loader2, Search, X } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Command, CommandList } from '@auxx/ui/components/command'
import { SearchInputWithHighlighting } from './search-input-with-highlighting'
import { SearchSuggestionsList } from './search-suggestions-list'
import { AdvancedFilterMode } from './advanced-filter-mode'
import { useSearchState } from './_hooks/use-search-state'
import { useSearchSuggestions, useSaveSearchQuery } from './_hooks/use-search-suggestions'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { parseSearchQuery } from '@auxx/lib/mail-query/client'
import {
  useQueryToFilters,
  extractFreeText,
  filtersToQuery,
  type FilterValue,
} from './_hooks/use-query-to-filters'
import { useTags } from '~/hooks/use-tags'
import { Badge } from '@auxx/ui/components/badge'

interface MailSearchBarProps {
  /** Function to call when the search query changes */
  onSearch: (query: string) => void
  /** Initial query value for the search bar */
  initialQuery?: string
  /** Optional className to pass styling from parent */
  className?: string
  /** Delay in milliseconds for debouncing the search input */
  debounceDelay?: number
  /** Optional prop to indicate if the parent component is loading results */
  isLoading?: boolean
}

// Alias for backward compatibility
export interface SearchBarProps extends MailSearchBarProps {}
export const SearchBar = MailSearchBar

export function MailSearchBar({
  onSearch,
  initialQuery = '',
  className,
  debounceDelay = 500,
  isLoading = false,
}: MailSearchBarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [localQuery, setLocalQuery] = useState(initialQuery)
  const [isFocused, setIsFocused] = useState(false)
  const [hasUserTyped, setHasUserTyped] = useState(false) // Track if user has actually typed
  const [shouldSaveQuery, setShouldSaveQuery] = useState(false) // Track if query should be saved (Enter pressed in input)
  const lastSavedQueryRef = useRef<string>('') // Track last saved query to prevent duplicates
  const commandRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const localQueryRef = useRef<string>(localQuery) // Add ref to track current localQuery

  // Tag editing state
  const [isTagEditing, setIsTagEditing] = useState(false)
  const [tagEditingContext, setTagEditingContext] = useState<{
    operator: string
    value: string
  } | null>(null)

  // Search state
  const { showFilters, setShowFilters, clearSearch } = useSearchState()

  // Save search query hook
  const saveSearchQuery = useSaveSearchQuery()

  // Track the last executed search to avoid duplicate calls
  const [lastExecutedSearch, setLastExecutedSearch] = useState(initialQuery)

  // Save search query only when user stops typing (longer debounce)
  const [debouncedQueryForSaving] = useDebouncedValue(localQuery, debounceDelay * 3)

  // Derive filter values from current query
  const derivedFilters = useQueryToFilters(localQuery)
  const freeText = extractFreeText(localQuery)

  // Debug: Log whenever the component renders with a new localQuery
  // useEffect(() => {
  //   console.log('MailSearchBar rendered with localQuery:', localQuery)
  // })

  // Keep ref in sync with state
  useEffect(() => {
    localQueryRef.current = localQuery
  }, [localQuery])

  useEffect(() => {
    if (
      debouncedQueryForSaving &&
      debouncedQueryForSaving.trim() &&
      hasUserTyped &&
      shouldSaveQuery &&
      debouncedQueryForSaving !== lastSavedQueryRef.current
    ) {
      saveSearchQuery(debouncedQueryForSaving)
      lastSavedQueryRef.current = debouncedQueryForSaving
      setShouldSaveQuery(false) // Reset flag after saving
    }
  }, [debouncedQueryForSaving, saveSearchQuery, hasUserTyped, shouldSaveQuery])

  // Execute search - only called on Enter or other explicit actions
  const executeSearch = useCallback(
    (query?: string) => {
      const searchQuery = query ?? localQueryRef.current // Use ref to get current value
      if (searchQuery !== lastExecutedSearch) {
        onSearch(searchQuery)
        setLastExecutedSearch(searchQuery)
      }
    },
    [onSearch, lastExecutedSearch]
  )

  // Update local query when initialQuery changes from parent (but don't mark as user typed)
  useEffect(() => {
    if (initialQuery !== localQuery && !hasUserTyped) {
      setLocalQuery(initialQuery || '')
      // Execute search immediately for programmatic changes (URL navigation, etc.)
      if (initialQuery !== lastExecutedSearch) {
        onSearch(initialQuery || '')
        setLastExecutedSearch(initialQuery || '')
      }
    }
  }, [initialQuery, localQuery, hasUserTyped, lastExecutedSearch, onSearch])

  // For suggestions, we need a different approach:
  // - If input is empty (just focused), show recent searches
  // - If typing partial operator (like "w"), show filtered operators + recent searches containing that text
  // - Don't debounce for empty queries to show immediate results

  const getSuggestionQuery = useCallback(() => {
    const parsed = parseSearchQuery(localQuery)
    let remaining = localQuery

    // Remove complete operator tags, keep any partial typing
    parsed.tokens.forEach((token: any) => {
      if (token.operator && token.raw.includes(':') && !localQuery.endsWith(token.raw)) {
        remaining = remaining.replace(token.raw, '').trim()
      }
    })

    return remaining
  }, [localQuery])

  const suggestionQuery = getSuggestionQuery()

  // Get search suggestions - consider tag editing context
  const finalSuggestionQuery =
    isTagEditing && tagEditingContext
      ? `${tagEditingContext.operator}:${tagEditingContext.value}`
      : suggestionQuery

  const { suggestions, isLoading: suggestionsLoading } = useSearchSuggestions({
    query: finalSuggestionQuery,
    enabled: (isFocused && isOpen) || isTagEditing,
  })

  // Handle tag editing
  const handleTagEditing = useCallback((isEditing: boolean, operator?: string, value?: string) => {
    setIsTagEditing(isEditing)
    if (isEditing && operator && value !== undefined) {
      setTagEditingContext({ operator, value })
      setIsOpen(true) // Show suggestions when editing tag
    } else {
      setTagEditingContext(null)
    }
  }, [])

  // Handle input changes
  const handleInputChange = (value: string) => {
    setLocalQuery(value)
    localQueryRef.current = value // Update ref immediately
    setHasUserTyped(true) // Mark that user has actually typed
    setShouldSaveQuery(false) // Reset save flag when typing (only save on explicit Enter)
  }

  // Handle suggestion selection
  const handleSelectSuggestion = (suggestion: any) => {
    // Mark that user has typed (since selecting a suggestion is user action)
    setHasUserTyped(true)
    // Don't save query when selecting suggestions
    setShouldSaveQuery(false)

    // Check if we're in tag editing mode
    if (isTagEditing && tagEditingContext) {
      // We're editing a tag, so apply the suggestion to the tag
      const newTagValue = `${tagEditingContext.operator}:${suggestion.value}`

      // Find the current tag being edited and replace it
      const parsed = parseSearchQuery(localQuery)
      const updatedTags: string[] = []
      let found = false

      parsed.tokens.forEach((token: any) => {
        if (
          token.operator &&
          token.operator.toLowerCase() === tagEditingContext.operator.toLowerCase() &&
          !found
        ) {
          // Replace the first matching tag
          updatedTags.push(newTagValue)
          found = true
        } else if (token.operator) {
          updatedTags.push(token.raw)
        }
      })

      // If no existing tag was found, add the new tag
      if (!found) {
        updatedTags.push(newTagValue)
      }

      const newQuery = updatedTags.join(' ').trim()
      setLocalQuery(newQuery)
      setIsTagEditing(false)
      setTagEditingContext(null)
      setIsOpen(false)

      return
    }

    // Determine how to apply the suggestion
    if (suggestion.type === 'operator') {
      // For operator suggestions, we want to create a tag and focus inside it
      const parsed = parseSearchQuery(localQuery)
      const existingTags: string[] = []
      let inputTextPart = localQuery

      // Extract existing tags
      parsed.tokens.forEach((token: any) => {
        if (token.operator) {
          existingTags.push(token.raw)
          inputTextPart = inputTextPart.replace(token.raw, '').trim()
        }
      })

      // Create new query with the selected operator, replacing any partial input
      const newTags = [...existingTags, suggestion.value]
      const newQuery = newTags.join(' ')

      setLocalQuery(newQuery)

      // The search input component will automatically detect the operator and create a tag
      // We need to let it process first, then focus the tag
      setTimeout(() => {
        const tagButtons = document.querySelectorAll('.tag-edit-button')
        const lastTagBtn = tagButtons[tagButtons.length - 1] as HTMLElement | undefined
        lastTagBtn?.click()
      }, 50)
    } else if (suggestion.type === 'recent') {
      // Replace entire query with recent search

      // Use flushSync to force synchronous state update
      flushSync(() => {
        setLocalQuery(suggestion.value)
        // Update the ref immediately to ensure executeSearch uses the new value
        localQueryRef.current = suggestion.value
      })

      executeSearch(suggestion.value) // Execute search immediately for recent searches
      setIsOpen(false)
    } else {
      // For other types, append the value to the current operator
      const words = localQuery.trim().split(' ')
      const lastWord = words[words.length - 1]

      if (lastWord && lastWord.endsWith(':')) {
        // We have an operator waiting for a value
        words[words.length - 1] = lastWord + suggestion.value
      } else {
        // Replace the partial value
        const colonIndex = lastWord.lastIndexOf(':')
        if (colonIndex > -1) {
          words[words.length - 1] = lastWord.substring(0, colonIndex + 1) + suggestion.value
        }
      }

      setLocalQuery(words.join(' ') + ' ')
      setIsOpen(false)
    }
  }

  // Clear search
  const handleClear = () => {
    setLocalQuery('')
    setHasUserTyped(false) // Reset user typed flag
    setShouldSaveQuery(false) // Reset save flag
    lastSavedQueryRef.current = '' // Reset last saved query
    clearSearch()
    executeSearch('') // Execute empty search
    setIsOpen(false)
    inputRef.current?.blur()
  }

  // Remove chip function
  const removeRawToken = useCallback(
    (raw: string) => {
      const parsed = parseSearchQuery(localQuery)
      const remainder = parsed.tokens
        .filter((t: any) => t.raw !== raw)
        .map((t: any) => t.raw)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()

      setLocalQuery(remainder)
      executeSearch(remainder)
    },
    [localQuery, executeSearch]
  )

  // Handle filter application
  const handleApplyFilters = (filters: FilterValue) => {
    // Convert filters to query string, preserving any free text
    const newQuery = filtersToQuery(filters, freeText)

    setLocalQuery(newQuery)
    executeSearch(newQuery) // Execute search immediately for filter application
    setShowFilters(false)
    setIsOpen(false)
  }

  // Handle real-time filter changes (for bidirectional sync)
  const handleFiltersChange = (filters: FilterValue) => {
    // Convert filters to query string, preserving any free text
    const newQuery = filtersToQuery(filters, freeText)

    // Update local query but don't execute search (real-time preview)
    setLocalQuery(newQuery)
    setHasUserTyped(true) // Mark as user interaction
  }

  // Focus input when popover opens
  useEffect(() => {
    if (isOpen && !showFilters) {
      // Small delay to ensure the popover content is rendered
      setTimeout(() => {
        const input = document.querySelector('[role="textbox"]') as HTMLElement
        if (input) {
          console.log('Focusing input:', input)
          const range = document.createRange()
          const selection = window.getSelection()
          range.setStart(input, input.childNodes.length)
          range.collapse(true)
          selection.removeAllRanges()
          selection.addRange(range)

          // input.focus()
        }
      }, 100)
    }
  }, [isOpen, showFilters])

  // Keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement !== inputRef.current &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName || '') &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault()
        setIsOpen(true)
        inputRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open)
      if (!open) setShowFilters(false)
    },
    [setShowFilters]
  )

  // Component to display the query with tags in the button
  const SearchQueryDisplay = ({
    query,
    onRemove,
  }: {
    query: string
    onRemove: (rawTag: string) => void
  }) => {
    const { getTagDisplayName } = useTags()

    if (!query) {
      return <span className="text-muted-foreground/60">Search...</span>
    }

    const parsed = parseSearchQuery(query)
    const tags: string[] = []
    let remaining = query

    // Extract valid tags
    parsed.tokens.forEach((token) => {
      if (token.operator) {
        const operatorName = token.operator.toLowerCase()
        const VALID_OPERATORS = [
          'assignee',
          'from',
          'to',
          'cc',
          'bcc',
          'subject',
          'body',
          'content',
          'tag',
          'label',
          'inbox',
          'status',
          'priority',
          'is',
          'has',
          'in',
          'date',
          'before',
          'after',
          'during',
          'author',
          'recipient',
          'size',
          'attachment',
          'filename',
          'thread',
          'conversation',
          'participants',
          'with',
          'without',
        ]
        if (VALID_OPERATORS.includes(operatorName)) {
          tags.push(token.raw)
          remaining = remaining.replace(token.raw, '').trim()
        }
      }
    })

    return (
      <div className="w-full flex items-center flex-1">
        <div className="flex items-center gap-1  w-full overflow-x-auto no-scrollbar">
          {tags.map((tag, index) => {
            const colonIndex = tag.indexOf(':')
            const operator = colonIndex > -1 ? tag.substring(0, colonIndex + 1) : tag
            const value = colonIndex > -1 ? tag.substring(colonIndex + 1).trim() : ''

            // For tag operator, display the tag name instead of ID
            const displayValue = operator === 'tag:' && value ? getTagDisplayName(value) : value
            // className="inline-flex items-center shrink-0 rounded-md px-1 bg-blue-100 text-blue-800">

            return (
              <Badge variant="user" key={index} className="px-2 pe-1 shrink-0 hover:border-info/40">
                <span className="text-blue-600 font-medium">{operator}&nbsp;</span>
                {displayValue && <span>{displayValue}</span>}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(tag)
                  }}
                  className="rounded-full size-4 flex items-center justify-center text-blue-600 hover:text-blue-800"
                  aria-label="Remove">
                  ×
                </button>
              </Badge>
            )
          })}
          {remaining && <span className="text-sm ">{remaining}</span>}
        </div>
      </div>
    )
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        asChild
        className="w-full h-7 flex flex-1 min-w-[20rem] max-w-[30rem] justify-start items-center relative bg-primary-50 hover:bg-background rounded-full pe-1">
        <div>
          <div
            onClick={() => {
              setShowFilters(false)
              setIsOpen(true)
            }}
            className="px-3 whitespace-nowrap rounded-md font-medium transition-colors gap-2 text-sm inline-flex items-center shrink-0 w-full flex-1 h-7 overflow-hidden justify-start relative bg-transparent shadow-none hover:bg-transparent focus:ring-0 focus:ring-offset-0 focus:outline-hidden">
            <Search className="size-4 shrink-0 opacity-50" />
            <SearchQueryDisplay query={localQuery} onRemove={removeRawToken} />
          </div>
          <div className=" flex items-center gap-1 absolute right-7">
            {(isLoading || suggestionsLoading) && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground " />
            )}
          </div>

          <Button
            variant="ghost"
            aria-selected={showFilters ? 'true' : 'false'}
            className={cn('size-6 rounded-full aria-[selected=true]:bg-primary-200')}
            onClick={(e) => {
              e.stopPropagation()
              setShowFilters(true)
              if (!showFilters) {
                setIsOpen(true)
              }
            }}>
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
        }}>
        {showFilters ? (
          <div className="flex flex-col">
            <AdvancedFilterMode
              initialFilters={derivedFilters}
              onApply={handleApplyFilters}
              onFiltersChange={handleFiltersChange}
              onCancel={() => {
                setShowFilters(false)
              }}
            />
          </div>
        ) : (
          <Command
            ref={commandRef}
            shouldFilter={false}
            className="bg-transparent rounded-t-xl shadow-none">
            <div className="flex items-center border-b px-3 relative h-7">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50 ml-[-1px]" />
              <SearchInputWithHighlighting
                inputId="mail-search-editor"
                value={localQuery}
                onChange={handleInputChange}
                onFocus={() => setIsFocused(true)}
                onBlur={() => {
                  setTimeout(() => setIsFocused(false), 200)
                }}
                onTagEditing={handleTagEditing}
                onSelectHighlightedSuggestion={() => {
                  const el = commandRef.current?.querySelector(
                    '[cmdk-item][data-selected="true"]'
                  ) as HTMLElement | null
                  if (el) {
                    el.click()
                    return true
                  }
                  return false
                }}
                onKeyDown={(e) => {
                  // Handle command navigation
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    // Dispatch the event to the Command component
                    const commandElement = commandRef.current
                    if (commandElement) {
                      const event = new KeyboardEvent('keydown', {
                        key: e.key,
                        bubbles: true,
                        cancelable: true,
                      })
                      commandElement.dispatchEvent(event)
                      e.preventDefault()
                    }
                    return
                  }

                  if (e.key === 'Enter') {
                    // Check if there's a highlighted suggestion
                    const highlightedItem = commandRef.current?.querySelector(
                      '[cmdk-item][data-selected="true"]'
                    )
                    if (highlightedItem && suggestions.length > 0) {
                      // Trigger click on highlighted item (don't save query for suggestion selection)
                      ;(highlightedItem as HTMLElement).click()
                      e.preventDefault()
                      return
                    } else {
                      e.preventDefault()
                      executeSearch() // Execute search on Enter only if no suggestion is selected
                      setShouldSaveQuery(true) // Set flag to save query only when Enter is pressed in input
                      setIsOpen(false)
                      inputRef.current?.blur()
                    }
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    if (localQuery) {
                      handleClear()
                    } else {
                      setIsOpen(false)
                    }
                  }
                }}
                className="border-0"
              />
              <div className=" flex items-center gap-1 absolute right-[29px]">
                {(isLoading || suggestionsLoading) && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground " />
                )}
              </div>

              <Button
                variant="ghost"
                aria-selected={showFilters ? 'true' : 'false'}
                className={cn(
                  'size-6 rounded-full aria-[selected=true]:bg-primary-200 absolute right-[4px]'
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  setShowFilters(true)
                  if (!showFilters) {
                    setIsOpen(true)
                  }
                }}>
                <Filter className="size-4 shrink-0 opacity-50" />
              </Button>

              {localQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-full shrink-0 bg-primary-50 hover:bg-primary-100 absolute right-[29px] [&_svg]:opacity-50 hover:[&_svg]:opacity-100"
                  onClick={handleClear}>
                  <X className="size-4 shrink-0" />
                </Button>
              )}
            </div>

            <CommandList>
              <SearchSuggestionsList
                suggestions={suggestions}
                onSelect={handleSelectSuggestion}
                showEmpty={isFocused && !localQuery}
              />
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}
