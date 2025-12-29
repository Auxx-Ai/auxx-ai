// packages/lib/src/mail-query/search-query-parser.ts
// import { createScopedLogger } from '@auxx/logger'

// const logger = createScopedLogger('search-query-parser')

/**
 * Represents a single token in the parsed search query
 */
export interface SearchToken {
  operator: string | null // null for plain text search
  value: string
  negated: boolean // For terms like -tag:important
  raw: string // The original unparsed token
}

/**
 * Results of parsing a search query
 */
export interface ParsedSearchQuery {
  tokens: SearchToken[]
  plainTextTerms: string[] // For backward compatibility
  hasStructuredQuery: boolean // True if any operator tokens found
  originalQuery: string // The original full query
}

/**
 * Known operators supported by the search syntax
 */
export enum SearchOperator {
  // Assignment related
  ASSIGNEE = 'assignee',
  AUTHOR = 'author',
  WITH = 'with',

  // Content related
  SUBJECT = 'subject',
  BODY = 'body',

  // Context & status
  INBOX = 'inbox',
  TYPE = 'type',
  IS = 'is',
  TAG = 'tag',
  HAS = 'has',

  // Dates
  BEFORE = 'before',
  AFTER = 'after',
  DURING = 'during',

  // Participants
  FROM = 'from',
  TO = 'to',
  CC = 'cc',
  BCC = 'bcc',
  RECIPIENT = 'recipient',
}

/**
 * Values for the IS operator
 */
export enum IsOperatorValue {
  ARCHIVED = 'archived',
  UNREAD = 'unread',
  OPEN = 'open',
  UNREPLIED = 'unreplied',
  SPAM = 'spam',
  TRASHED = 'trashed',
  ASSIGNED = 'assigned',
  UNASSIGNED = 'unassigned',
}

/**
 * Parses a search query string into structured tokens
 * @param query The search query string to parse
 * @returns An object containing the parsed tokens and metadata
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  if (!query || typeof query !== 'string') {
    return { tokens: [], plainTextTerms: [], hasStructuredQuery: false, originalQuery: query || '' }
  }

  const tokens: SearchToken[] = []
  const plainTextTerms: string[] = []
  let hasStructuredQuery = false

  // Helper to match a quoted string and handle escaping
  function extractQuoted(
    text: string,
    startIndex: number
  ): { value: string; endIndex: number } | null {
    if (text[startIndex] !== '"') return null

    let value = ''
    let i = startIndex + 1
    let escaped = false

    while (i < text.length) {
      const char = text[i]

      if (escaped) {
        value += char
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        return { value, endIndex: i }
      } else {
        value += char
      }

      i++
    }

    // If we reach here, the closing quote was missing
    // Just return what we have so far
    return { value, endIndex: text.length - 1 }
  }

  // Split into tokens while preserving quoted strings
  let currentPosition = 0
  let currentToken = ''
  let inQuote = false
  let quoteStartPos = -1

  // Pre-process to identify token boundaries while respecting quotes
  const segments: string[] = []

  while (currentPosition < query.length) {
    const char = query[currentPosition]

    if (char === '"' && query[currentPosition - 1] !== '\\') {
      if (inQuote) {
        inQuote = false
        // Include the closing quote in the current token
        currentToken += char
        segments.push(currentToken)
        currentToken = ''
      } else {
        // If we have accumulated any text before the quote, add it as a segment
        if (currentToken.trim()) {
          segments.push(currentToken)
        }
        inQuote = true
        quoteStartPos = currentPosition
        currentToken = char // Start with the opening quote
      }
    } else if (char === ' ' && !inQuote) {
      if (currentToken.trim()) {
        segments.push(currentToken)
      }
      currentToken = ''
    } else {
      currentToken += char
    }

    currentPosition++
  }

  // Add any remaining token
  if (currentToken.trim()) {
    segments.push(currentToken)
  }

  // Parse each segment
  for (const segment of segments) {
    // Check if it's a negated term
    const isNegated = segment.startsWith('-') && segment.length > 1
    const actualSegment = isNegated ? segment.substring(1) : segment

    // Check if it's an operator:value pattern
    const operatorMatch = actualSegment.match(/^([a-zA-Z-]+):(.*)$/)

    if (operatorMatch) {
      const [, operator, rawValue] = operatorMatch

      // Handle quoted values
      let value = rawValue
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        value = value.substring(1, value.length - 1)
      }

      tokens.push({
        operator: operator.toLowerCase(),
        value: value.trim(),
        negated: isNegated,
        raw: segment,
      })

      hasStructuredQuery = true
    } else {
      // It's a plain text search term
      tokens.push({ operator: null, value: actualSegment, negated: isNegated, raw: segment })

      // Also add to plainTextTerms for backward compatibility
      plainTextTerms.push(actualSegment)
    }
  }

  // logger.debug('Parsed search query', {
  //   query,
  //   tokenCount: tokens.length,
  //   hasStructuredQuery,
  //   plainTextTermCount: plainTextTerms.length,
  // })

  return { tokens, plainTextTerms, hasStructuredQuery, originalQuery: query }
}

/**
 * Helper function to test if a token uses a specific operator
 */
export function isOperator(token: SearchToken, operator: string): boolean {
  return token.operator?.toLowerCase() === operator.toLowerCase()
}

/**
 * Helper function to test if a token is a plain text search term
 */
export function isPlainText(token: SearchToken): boolean {
  return token.operator === null
}

/**
 * Helper function to combine plain text terms for simplified search
 */
export function getPlainTextSearchValue(parsedQuery: ParsedSearchQuery): string {
  return parsedQuery.plainTextTerms.join(' ')
}
