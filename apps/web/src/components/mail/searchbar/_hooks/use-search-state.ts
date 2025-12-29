// src/components/mail/searchbar/_hooks/use-search-state.ts
'use client'

import { useState, useCallback } from 'react'
import { parseSearchQuery, type SearchToken } from '@auxx/lib/mail-query'

interface SearchState {
  // Search state
  query: string
  parsedTokens: SearchToken[]
  isSearchMode: boolean
  showFilters: boolean

  // Filter state for advanced mode
  activeFilters: Record<string, any>

  // Cursor position for operator navigation
  cursorPosition: number
  activeTokenIndex: number | null
}

export function useSearchState() {
  const [state, setState] = useState<SearchState>({
    query: '',
    parsedTokens: [],
    isSearchMode: false,
    showFilters: false,
    activeFilters: {},
    cursorPosition: 0,
    activeTokenIndex: null,
  })

  const setQuery = useCallback((query: string) => {
    const parsed = parseSearchQuery(query)
    setState((prev) => ({
      ...prev,
      query,
      parsedTokens: parsed.tokens,
      isSearchMode: query.length > 0,
    }))
  }, [])

  const setSearchMode = useCallback((mode: boolean) => {
    setState((prev) => ({ ...prev, isSearchMode: mode }))
  }, [])

  const setShowFilters = useCallback((show: boolean) => {
    setState((prev) => ({ ...prev, showFilters: show }))
  }, [])

  const setActiveFilters = useCallback((filters: Record<string, any>) => {
    setState((prev) => ({ ...prev, activeFilters: filters }))
  }, [])

  const setCursorPosition = useCallback((position: number) => {
    setState((prev) => {
      let activeIndex = null
      let charCount = 0

      for (let i = 0; i < prev.parsedTokens.length; i++) {
        const tokenLength = prev.parsedTokens[i].raw.length
        if (position >= charCount && position <= charCount + tokenLength) {
          activeIndex = i
          break
        }
        charCount += tokenLength + 1 // +1 for space
      }

      return { ...prev, cursorPosition: position, activeTokenIndex: activeIndex }
    })
  }, [])

  const clearSearch = useCallback(() => {
    setState({
      query: '',
      parsedTokens: [],
      isSearchMode: false,
      showFilters: false,
      activeFilters: {},
      cursorPosition: 0,
      activeTokenIndex: null,
    })
  }, [])

  const applyFilters = useCallback(() => {
    const queryParts: string[] = []

    Object.entries(state.activeFilters).forEach(([key, value]) => {
      if (value) {
        if (Array.isArray(value)) {
          value.forEach((v) => queryParts.push(`${key}:${v}`))
        } else if (typeof value === 'boolean') {
          queryParts.push(key)
        } else {
          queryParts.push(`${key}:${value}`)
        }
      }
    })

    const newQuery = queryParts.join(' ')
    setQuery(newQuery)
    setShowFilters(false)
  }, [state.activeFilters, setQuery, setShowFilters])

  return {
    ...state,
    setQuery,
    setSearchMode,
    setShowFilters,
    setActiveFilters,
    setCursorPosition,
    clearSearch,
    applyFilters,
  }
}
