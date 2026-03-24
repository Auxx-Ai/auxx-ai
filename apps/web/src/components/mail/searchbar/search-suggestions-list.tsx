// apps/web/src/components/mail/searchbar/search-suggestions-list.tsx

'use client'

import type { MailViewFieldDefinition } from '@auxx/lib/mail-views/client'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { VAR_TYPE_ICON_MAP } from '~/components/workflow/utils/icon-helper'
import { useDeleteRecentSearch } from './_hooks/use-search-suggestions'
import { RecentSearchDisplay } from './recent-search-display'
import type { SearchCondition } from './store'

/**
 * Suggestion types for search suggestions
 * - 'field': A field from MAIL_VIEW_FIELD_DEFINITIONS to add as a condition
 * - 'recent': A recent search that restores a full set of conditions
 */
export type SearchSuggestionType = 'field' | 'recent'

/**
 * Search suggestion interface
 */
export interface SearchSuggestion {
  type: SearchSuggestionType

  /** For 'field' type: the field ID from MAIL_VIEW_FIELD_DEFINITIONS */
  fieldId?: string

  /** For 'field' type: full field definition for display */
  fieldDefinition?: MailViewFieldDefinition

  /** For 'recent' type: stored conditions to restore */
  conditions?: SearchCondition[]

  /** Common display props */
  value: string
  label: string
  description?: string
}

/** Default icon for unknown types */
const DEFAULT_ICON = 'filter'

/**
 * Group labels for suggestion types
 */
const GROUP_LABELS: Record<SearchSuggestionType, string> = {
  recent: 'Recent Searches',
  field: 'Filter by',
}

/**
 * Get icon for a suggestion based on type and field definition
 */
function getSuggestionIcon(suggestion: SearchSuggestion): string {
  if (suggestion.type === 'recent') {
    return 'history'
  }

  if (suggestion.type === 'field' && suggestion.fieldDefinition) {
    return VAR_TYPE_ICON_MAP[suggestion.fieldDefinition.type] ?? DEFAULT_ICON
  }

  return DEFAULT_ICON
}

/**
 * Props for SearchSuggestionsList component
 */
interface SearchSuggestionsListProps {
  suggestions: SearchSuggestion[]
  highlightedIndex?: number
  onSelect: (suggestion: SearchSuggestion) => void
  showEmpty?: boolean
  emptyMessage?: string
}

/**
 * SearchSuggestionsList component
 * Renders grouped suggestions for field selection and recent searches.
 */
export function SearchSuggestionsList({
  suggestions,
  highlightedIndex = -1,
  onSelect,
  showEmpty = true,
  emptyMessage = 'Type to search or select a filter field',
}: SearchSuggestionsListProps) {
  const deleteRecentSearch = useDeleteRecentSearch()

  // Scroll highlighted item into view
  const highlightedRef = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ block: 'nearest' })
  }, [])

  if (suggestions.length === 0 && !showEmpty) {
    return null
  }

  // Group suggestions by type
  const groupedSuggestions = suggestions.reduce(
    (acc, suggestion) => {
      const type = suggestion.type
      if (!acc[type]) {
        acc[type] = []
      }
      acc[type].push(suggestion)
      return acc
    },
    {} as Record<SearchSuggestionType, SearchSuggestion[]>
  )

  // Order: recent first, then fields
  const typeOrder: SearchSuggestionType[] = ['recent', 'field']

  // Build a flat-index counter so we can map highlightedIndex to the right item
  let flatIndex = 0

  return (
    <Command
      className='bg-transparent [&_[cmdk-item][data-selected=true]:not([data-highlighted])]:bg-transparent'
      shouldFilter={false}>
      <CommandList>
        {suggestions.length === 0 ? (
          <CommandEmpty>
            <div className='px-2 py-3 text-xs text-muted-foreground'>
              <p>{emptyMessage}</p>
            </div>
          </CommandEmpty>
        ) : (
          typeOrder.map((type) => {
            const items = groupedSuggestions[type]
            if (!items || items.length === 0) return null

            return (
              <CommandGroup key={type} heading={GROUP_LABELS[type]} className=''>
                {items.map((suggestion, index) => {
                  const currentFlatIndex = flatIndex++
                  const isHighlighted = currentFlatIndex === highlightedIndex
                  return (
                    <CommandItem
                      ref={isHighlighted ? highlightedRef : undefined}
                      key={`${type}-${suggestion.value}-${index}`}
                      value={`${type}-${suggestion.value}-${index}`}
                      data-highlighted={isHighlighted || undefined}
                      className='data-[highlighted]:ring-border-illustration data-[highlighted]:ring-1 data-[highlighted]:bg-accent/50 data-[highlighted]:text-accent-foreground'
                      onSelect={() => {
                        console.log(
                          '[SearchSuggestionsList] CommandItem onSelect:',
                          suggestion.label,
                          suggestion.type
                        )
                        onSelect(suggestion)
                      }}>
                      <div data-slot='suggestion-item' className='flex items-center gap-2 w-full'>
                        <div className='border bg-primary-50 rounded-md size-6 flex items-center justify-center relative'>
                          <EntityIcon size='sm' iconId={getSuggestionIcon(suggestion)} />
                        </div>

                        {/* Main content */}
                        <div className='flex-1 min-w-0'>
                          <div className='flex items-center gap-1'>
                            {suggestion.type === 'recent' && suggestion.conditions ? (
                              <RecentSearchDisplay conditions={suggestion.conditions} />
                            ) : (
                              <span className='truncate text-primary-700'>{suggestion.label}</span>
                            )}
                            {suggestion.description && (
                              <span className='text-xs text-primary-400 truncate'>
                                {suggestion.description}
                              </span>
                            )}
                          </div>
                        </div>

                        {suggestion.type === 'recent' && (
                          <Button
                            size='icon-sm'
                            variant='destructive-hover'
                            className='opacity-0 [[data-selected=true]_&]:opacity-100 [[data-highlighted]_&]:opacity-100 hover:opacity-100'
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteRecentSearch(suggestion.value)
                            }}>
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )
          })
        )}
      </CommandList>
    </Command>
  )
}
