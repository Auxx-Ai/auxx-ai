// src/components/mail/searchbar/search-suggestions-list.tsx
'use client'

import React from 'react'
import { CommandGroup, CommandItem, CommandEmpty } from '@auxx/ui/components/command'
import Image from 'next/image'
import { EntityIcon } from '@auxx/ui/components/icons'

/** Suggestion type for search suggestions */
export type SearchSuggestionType =
  | 'operator'
  | 'recent'
  | 'user'
  | 'participant'
  | 'tag'
  | 'inbox'
  | 'status'
  | 'has'

/** Maps suggestion types to EntityIcon iconIds */
const SUGGESTION_TYPE_ICON_MAP: Record<SearchSuggestionType, string> = {
  recent: 'history',
  user: 'user',
  participant: 'user',
  tag: 'tag',
  inbox: 'inbox',
  operator: 'hash',
  status: 'circle',
  has: 'check',
}

/** Default icon for unknown suggestion types */
const DEFAULT_SUGGESTION_ICON = 'search'

/** Maps suggestion types to group labels */
const SUGGESTION_TYPE_LABEL_MAP: Record<SearchSuggestionType, string> = {
  recent: 'Recent Searches',
  operator: 'Search Operators',
  user: 'Team Members',
  participant: 'Participants',
  tag: 'Tags',
  inbox: 'Inboxes',
  status: 'Status',
  has: 'Properties',
}

/** Default label for unknown suggestion types */
const DEFAULT_GROUP_LABEL = 'Suggestions'

/** Gets the group label for a suggestion type */
const getGroupLabel = (type: SearchSuggestionType): string =>
  SUGGESTION_TYPE_LABEL_MAP[type] ?? DEFAULT_GROUP_LABEL

/** Gets the iconId for a suggestion type */
const getIconId = (type: SearchSuggestionType): string =>
  SUGGESTION_TYPE_ICON_MAP[type] ?? DEFAULT_SUGGESTION_ICON

export interface SearchSuggestion {
  type: SearchSuggestionType
  value: string
  label: string
  description?: string
  secondary?: string
  image?: string
  emoji?: string
  color?: string
  icon?: string
}

interface SearchSuggestionsListProps {
  suggestions: SearchSuggestion[]
  onSelect: (suggestion: SearchSuggestion) => void
  showEmpty?: boolean
  emptyMessage?: string
  className?: string
}

export function SearchSuggestionsList({
  suggestions,
  onSelect,
  showEmpty = true,
  emptyMessage = 'Try operators like: assignee:name, is:unread, subject:"hello", tag:urgent',
  className,
}: SearchSuggestionsListProps) {
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
    {} as Record<string, SearchSuggestion[]>
  )

  if (suggestions.length === 0) {
    return (
      <CommandEmpty>
        <div className="px-2 py-3 text-xs text-muted-foreground">
          <p>{emptyMessage}</p>
        </div>
      </CommandEmpty>
    )
  }

  return (
    <>
      {Object.entries(groupedSuggestions).map(([type, items]) => (
        <CommandGroup key={type} heading={getGroupLabel(type as SearchSuggestionType)} className="">
          {items.map((suggestion, index) => (
            <CommandItem
              key={`${type}-${index}`}
              value={`${type}-${suggestion.value}-${index}`}
              onSelect={() => onSelect(suggestion)}>
              <div className="flex items-center gap-2 w-full">
                <div className="border bg-primary-50 rounded-md size-6 flex items-center justify-center relative">
                  {/* Icon or Avatar */}
                  {suggestion.image ? (
                    <Image
                      fill
                      src={suggestion.image}
                      alt={suggestion.label}
                      className="size-4 rounded-md object-cover"
                    />
                  ) : suggestion.emoji ? (
                    <span className="text-lg w-6 text-center">{suggestion.emoji}</span>
                  ) : suggestion.color ? (
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: suggestion.color }}
                    />
                  ) : (
                    <EntityIcon size="sm" iconId={getIconId(type as SearchSuggestionType)} />
                  )}
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-primary-700">{suggestion.label}</span>
                    {suggestion.secondary && (
                      <span className="text-xs text-primary-300 truncate">
                        {suggestion.secondary}
                      </span>
                    )}
                    {suggestion.description && (
                      <div className="text-xs text-primary-400">{suggestion.description}</div>
                    )}
                  </div>
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </>
  )
}
