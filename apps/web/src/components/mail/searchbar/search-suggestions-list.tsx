// src/components/mail/searchbar/search-suggestions-list.tsx
'use client'

import React from 'react'
import { CommandGroup, CommandItem, CommandEmpty } from '@auxx/ui/components/command'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { History, Search, User, Tag, Inbox, Hash } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import Image from 'next/image'

export interface SearchSuggestion {
  type: 'operator' | 'recent' | 'user' | 'participant' | 'tag' | 'inbox' | 'status' | 'has'
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

  const getIcon = (type: string) => {
    switch (type) {
      case 'recent':
        return History
      case 'user':
        return User
      case 'participant':
        return User
      case 'tag':
        return Tag
      case 'inbox':
        return Inbox
      case 'operator':
        return Hash
      case 'to':
        return User
      default:
        return Search
    }
  }

  const getGroupLabel = (type: string) => {
    switch (type) {
      case 'recent':
        return 'Recent Searches'
      case 'operator':
        return 'Search Operators'
      case 'user':
        return 'Team Members'
      case 'participant':
        return 'Participants'
      case 'tag':
        return 'Tags'
      case 'inbox':
        return 'Inboxes'
      case 'status':
        return 'Status'
      case 'has':
        return 'Properties'
      default:
        return 'Suggestions'
    }
  }

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
        <CommandGroup key={type} heading={getGroupLabel(type)} className="">
          {items.map((suggestion, index) => (
            <CommandItem
              key={`${type}-${index}`}
              value={`${type}-${suggestion.value}-${index}`}
              onSelect={() => onSelect(suggestion)}
              className="cursor-pointer border border-transparent hover:border-primary-100">
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
                    React.createElement(getIcon(type), {
                      className: 'size-3 text-muted-foreground',
                    })
                  )}{' '}
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-primary-700">{suggestion.label}</span>
                    {suggestion.secondary && (
                      <span className="text-xs text-primary-300 truncate">
                        {suggestion.secondary}
                      </span>
                    )}
                  </div>
                  {suggestion.description && (
                    <div className="text-xs text-primary-400">{suggestion.description}</div>
                  )}
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </>
  )
}
