// apps/web/src/components/mail/searchbar/_hooks/use-search-suggestions.ts

'use client'

import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import {
  MAIL_VIEW_FIELD_DEFINITIONS,
  type MailViewFieldDefinition,
} from '@auxx/lib/mail-views/client'
import type { SearchSuggestion } from '../search-suggestions-list'

/**
 * Props for useSearchSuggestions hook
 */
interface UseSuggestionsProps {
  query: string
  enabled?: boolean
  debounceMs?: number
}

/**
 * useSearchSuggestions hook
 * Provides client-side field filtering for mail view field definitions
 * and server-side recent searches fetching.
 */
export function useSearchSuggestions({
  query,
  enabled = true,
  debounceMs = 300,
}: UseSuggestionsProps) {
  const [debouncedQuery] = useDebouncedValue(query, debounceMs)

  // Client-side field filtering from MAIL_VIEW_FIELD_DEFINITIONS
  const fieldSuggestions = useMemo((): SearchSuggestion[] => {
    // Filter out 'freeText' - it's not a selectable filter field
    const filterableFields = MAIL_VIEW_FIELD_DEFINITIONS.filter((f) => f.id !== 'freeText')

    if (!debouncedQuery || debouncedQuery.length === 0) {
      // Show all filterable fields when no query
      return filterableFields.map((field) => mapFieldToSuggestion(field))
    }

    // Filter fields by query (match against label or id)
    const lowerQuery = debouncedQuery.toLowerCase()
    return filterableFields
      .filter(
        (field) =>
          field.label.toLowerCase().includes(lowerQuery) ||
          field.id.toLowerCase().includes(lowerQuery)
      )
      .map((field) => mapFieldToSuggestion(field))
  }, [debouncedQuery])

  // Recent searches from server - only fetch when no query
  const { data: recentSearches = [], isLoading } = api.search.recentSearches.useQuery(undefined, {
    enabled: enabled && (!debouncedQuery || debouncedQuery.length === 0),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })

  // Map recent searches to suggestions
  const recentSuggestions = useMemo((): SearchSuggestion[] => {
    return recentSearches.map((search) => ({
      type: 'recent' as const,
      value: search.id,
      label: search.displayText,
      description: search.conditionCount > 0 ? `${search.conditionCount} filters` : undefined,
      conditions: search.conditions,
    }))
  }, [recentSearches])

  // Combine suggestions: recent first (when no query), then fields
  const suggestions = useMemo(() => {
    if (!debouncedQuery || debouncedQuery.length === 0) {
      return [...recentSuggestions, ...fieldSuggestions]
    }
    return fieldSuggestions
  }, [debouncedQuery, recentSuggestions, fieldSuggestions])

  return {
    suggestions,
    isLoading,
  }
}

/**
 * Maps a MailViewFieldDefinition to a SearchSuggestion
 */
function mapFieldToSuggestion(field: MailViewFieldDefinition): SearchSuggestion {
  return {
    type: 'field',
    fieldId: field.id,
    fieldDefinition: field,
    value: field.id,
    label: field.label,
    description: field.description,
  }
}

/**
 * Hook to save search query - now saves conditions instead of text
 */
export function useSaveSearchQuery() {
  const { mutate } = api.search.saveSearch.useMutation({
    onError: (error) => {
      console.error('Failed to save search:', error)
    },
  })

  return useCallback(
    (conditions: Array<{ fieldId: string; operator: string; value: unknown }>, displayText: string) => {
      if (conditions.length > 0) {
        mutate({ conditions, displayText })
      }
    },
    [mutate]
  )
}
