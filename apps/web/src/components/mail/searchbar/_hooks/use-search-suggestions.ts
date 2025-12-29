// src/components/mail/searchbar/_hooks/use-search-suggestions.ts
'use client'

import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { parseSearchQuery } from '@auxx/lib/mail-query'

interface UseSuggestionsProps {
  query: string
  enabled?: boolean
  debounceMs?: number
}

export function useSearchSuggestions({
  query,
  enabled = true,
  debounceMs = 300,
}: UseSuggestionsProps) {
  const [debouncedQuery] = useDebouncedValue(query, debounceMs)

  // Parse the query to determine the current operator context
  const parsed = parseSearchQuery(debouncedQuery)
  const tokens = parsed.tokens

  // Determine the current context (operator and partial value)
  let currentOperator: string | undefined
  let currentValue = ''

  if (debouncedQuery.endsWith(':')) {
    // User just typed an operator
    currentOperator = debouncedQuery.slice(0, -1)
    currentValue = ''
  } else {
    // Check if we're in the middle of typing an operator value
    const lastToken = tokens[tokens.length - 1]
    if (lastToken && lastToken.operator) {
      currentOperator = lastToken.operator
      currentValue = lastToken.value
    } else if (lastToken) {
      // Plain text search
      currentValue = lastToken.value
    }
  }

  // Fetch suggestions - use operator context when available
  const { data: allSuggestions = [], isLoading } = api.search.suggestions.useQuery(
    {
      operator: currentOperator, // Pass operator to get relevant suggestions
      query: currentOperator ? currentValue : debouncedQuery, // Use debounced query
      context: {
        // Add any context like current inbox if needed
      },
    },
    {
      enabled: enabled, // Always enabled when focused
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    }
  )

  // Client-side filtering based on current input
  const filteredSuggestions = useMemo(() => {
    if (currentOperator) {
      // When in operator context, filter by current value
      if (!currentValue) {
        return allSuggestions
      }

      return allSuggestions.filter((suggestion: any) => {
        const searchText = currentValue.toLowerCase()

        // Check if suggestion value or label contains the search text
        const valueMatch = suggestion.value?.toLowerCase().includes(searchText)
        const labelMatch = suggestion.label?.toLowerCase().includes(searchText)
        const descriptionMatch = suggestion.description?.toLowerCase().includes(searchText)

        return valueMatch || labelMatch || descriptionMatch
      })
    } else {
      // General search - filter by full query
      if (!query || query.length === 0) {
        return allSuggestions
      }

      return allSuggestions.filter((suggestion: any) => {
        const searchText = query.toLowerCase()

        // Check if suggestion value or label contains the search text
        const valueMatch = suggestion.value?.toLowerCase().includes(searchText)
        const labelMatch = suggestion.label?.toLowerCase().includes(searchText)
        const descriptionMatch = suggestion.description?.toLowerCase().includes(searchText)

        return valueMatch || labelMatch || descriptionMatch
      })
    }
  }, [allSuggestions, query, currentOperator, currentValue])

  const suggestions = filteredSuggestions

  return {
    suggestions,
    isLoading,
    currentOperator,
    currentValue,
  }
}

// Hook to save search query
export function useSaveSearchQuery() {
  const { mutate } = api.search.saveQuery.useMutation({
    onSuccess: () => {
      console.log('Search query saved successfully')
    },
    onError: (error) => {
      console.error('Failed to save search query:', error)
    },
  })

  return useCallback(
    (query: string) => {
      if (query.trim()) mutate({ query })
    },
    [mutate]
  )
}
