// src/components/mail/searchbar/_hooks/use-query-to-filters.ts
'use client'

import { useMemo } from 'react'
import { parseSearchQuery, type SearchToken } from '@auxx/lib/mail-query'
import { parse, isValid } from 'date-fns'
import { api } from '~/trpc/react'

interface FilterValue {
  from?: string[]
  to?: string[]
  subject?: string
  body?: string
  assignee?: string[]
  tag?: string[]
  inbox?: string[]
  is?: string[]
  hasAttachment?: boolean
  before?: Date
  after?: Date
}

/**
 * Parse a date string in various formats
 */
function parseDate(dateStr: string): Date | undefined {
  if (!dateStr) return undefined

  // Try different date formats
  const formats = [
    'yyyy-MM-dd',
    'yyyy/MM/dd',
    'MM/dd/yyyy',
    'dd/MM/yyyy',
    'yyyy-MM-dd HH:mm:ss',
    'MMM dd, yyyy',
  ]

  for (const format of formats) {
    try {
      const parsed = parse(dateStr, format, new Date())
      if (isValid(parsed)) {
        return parsed
      }
    } catch (error) {
      // Continue to next format
    }
  }

  // Try native Date parsing as fallback
  const nativeDate = new Date(dateStr)
  if (isValid(nativeDate)) {
    return nativeDate
  }

  return undefined
}

/**
 * Remove quotes from a value if they exist
 */
function normalizeValue(value: string): string {
  if (!value) return value

  // Remove quotes if they exist
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Convert a search query string to FilterValue object
 * Now supports both tag IDs and tag names for backward compatibility
 */
export function parseQueryToFiltersWithTags(query: string, allTags: any[]): FilterValue {
  if (!query || typeof query !== 'string') {
    return {}
  }

  const parsed = parseSearchQuery(query)
  const filters: FilterValue = {}

  // Create tag lookup maps
  const tagIdMap = new Map(allTags.map((tag) => [tag.id, tag]))
  const tagNameMap = new Map(allTags.map((tag) => [tag.title.toLowerCase(), tag]))

  parsed.tokens.forEach((token: SearchToken) => {
    if (!token.operator) return

    const operator = token.operator.toLowerCase()
    const value = normalizeValue(token.value)

    switch (operator) {
      case 'assignee':
        filters.assignee = [...(filters.assignee || []), value]
        break

      case 'from':
        filters.from = [...(filters.from || []), value]
        break

      case 'to':
        filters.to = [...(filters.to || []), value]
        break

      case 'subject':
        // For subject, use the last value if multiple exist
        filters.subject = value
        break

      case 'body':
        // For body, use the last value if multiple exist
        filters.body = value
        break

      case 'tag':
        // Handle both tag IDs and tag names
        let tagId = value

        // If value is not a valid tag ID, try to find by name
        if (!tagIdMap.has(value)) {
          const tagByName = tagNameMap.get(value.toLowerCase())
          if (tagByName) {
            tagId = tagByName.id
          }
        }

        filters.tag = [...(filters.tag || []), tagId]
        break

      case 'inbox':
        filters.inbox = [...(filters.inbox || []), value]
        break

      case 'is':
        filters.is = [...(filters.is || []), value]
        break

      case 'has':
        if (value === 'attachments' || value === 'attachment') {
          filters.hasAttachment = true
        }
        break

      case 'before':
        const beforeDate = parseDate(value)
        if (beforeDate) {
          filters.before = beforeDate
        }
        break

      case 'after':
        const afterDate = parseDate(value)
        if (afterDate) {
          filters.after = afterDate
        }
        break

      // Handle additional operators that might be in the query
      case 'participants':
      case 'with':
        // Treat as 'from' for participants/with
        filters.from = [...(filters.from || []), value]
        break

      default:
        // Unknown operators are ignored
        console.warn(`Unknown search operator: ${operator}`)
        break
    }
  })

  return filters
}

/**
 * Convert a search query string to FilterValue object (legacy version)
 */
export function parseQueryToFilters(query: string): FilterValue {
  return parseQueryToFiltersWithTags(query, [])
}

/**
 * Hook to convert a search query to filter values with tag support
 */
export function useQueryToFilters(query: string): FilterValue {
  // Fetch all tags for name resolution
  const { data: allTags = [] } = api.tag.getAll.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })

  return useMemo(() => {
    return parseQueryToFiltersWithTags(query, allTags)
  }, [query, allTags])
}

/**
 * Extract free text (non-operator tokens) from a query
 */
export function extractFreeText(query: string): string {
  if (!query || typeof query !== 'string') {
    return ''
  }

  const parsed = parseSearchQuery(query)
  const freeTextTokens = parsed.tokens.filter((token) => !token.operator)
  return freeTextTokens
    .map((token) => token.value)
    .join(' ')
    .trim()
}

/**
 * Convert FilterValue back to query string
 */
export function filtersToQuery(filters: FilterValue, freeText: string = ''): string {
  const searchParts: string[] = []

  // Handle array fields
  if (filters.assignee?.length) {
    filters.assignee.forEach((email) => searchParts.push(`assignee:${email}`))
  }

  if (filters.from?.length) {
    filters.from.forEach((email) => searchParts.push(`from:${email}`))
  }

  if (filters.to?.length) {
    filters.to.forEach((email) => searchParts.push(`to:${email}`))
  }

  if (filters.tag?.length) {
    filters.tag.forEach((tag) => searchParts.push(`tag:${tag}`))
  }

  if (filters.is?.length) {
    filters.is.forEach((status) => searchParts.push(`is:${status}`))
  }

  // Handle single string fields
  if (filters.subject) {
    const quotedSubject = filters.subject.includes(' ') ? `"${filters.subject}"` : filters.subject
    searchParts.push(`subject:${quotedSubject}`)
  }

  if (filters.body) {
    const quotedBody = filters.body.includes(' ') ? `"${filters.body}"` : filters.body
    searchParts.push(`body:${quotedBody}`)
  }

  if (filters.inbox?.length) {
    filters.inbox.forEach((inbox) => searchParts.push(`inbox:${inbox}`))
  }

  // Handle boolean fields
  if (filters.hasAttachment) {
    searchParts.push('has:attachments')
  }

  // Handle date fields
  if (filters.before) {
    const dateStr = filters.before.toISOString().split('T')[0] // YYYY-MM-DD
    searchParts.push(`before:${dateStr}`)
  }

  if (filters.after) {
    const dateStr = filters.after.toISOString().split('T')[0] // YYYY-MM-DD
    searchParts.push(`after:${dateStr}`)
  }

  // Add free text at the end
  if (freeText && freeText.trim()) {
    searchParts.push(freeText.trim())
  }

  return searchParts.join(' ').trim()
}

export type { FilterValue }
