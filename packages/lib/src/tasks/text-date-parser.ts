// packages/lib/src/tasks/text-date-parser.ts

import type { RelativeDate } from '@auxx/types/task'
import { type DatePattern, getSortedPatterns } from './date-patterns'

/**
 * Result of parsing text for date expressions
 */
export interface DateParseResult {
  /** Whether a date was found */
  found: boolean
  /** The matched text (e.g., "tomorrow", "next Friday") */
  matchedText: string | null
  /** Start index of match in original text */
  startIndex: number
  /** End index of match in original text */
  endIndex: number
  /** Parsed duration (for DateLanguageModule) */
  duration: RelativeDate | 'eom' | 'next-quarter' | null
  /** Human-readable label for display */
  label: string | null
  /** Confidence score 0-1 (based on pattern specificity) */
  confidence: number
  /** Whether this is a past date (negative duration) */
  isPast: boolean
}

/**
 * Parser configuration options
 */
export interface TextDateParserOptions {
  /** Only match future dates (default: true for task deadlines) */
  futureOnly?: boolean
}

/**
 * TextDateParser
 * Parses free-form text to extract date expressions using regex patterns.
 * No AI/ML - purely pattern-based matching.
 *
 * Usage:
 * ```typescript
 * import { TextDateParser } from '@auxx/lib/tasks/client'
 *
 * // Default: future dates only (for task deadlines)
 * const parser = new TextDateParser()
 * const result = parser.parse("Call John tomorrow about the proposal")
 * // { found: true, matchedText: "tomorrow", duration: { days: 1 }, label: "Tomorrow", isPast: false, ... }
 *
 * // Include past dates
 * const parserWithPast = new TextDateParser({ futureOnly: false })
 * const result2 = parserWithPast.parse("Sent email yesterday")
 * // { found: true, matchedText: "yesterday", duration: { days: -1 }, label: "Yesterday", isPast: true, ... }
 * ```
 */
export class TextDateParser {
  private patterns: DatePattern[]
  private baseDate: Date
  private futureOnly: boolean

  /**
   * Create a TextDateParser instance
   * @param options Parser options (futureOnly defaults to true)
   * @param baseDate Reference date for relative calculations (default: now)
   */
  constructor(options: TextDateParserOptions = {}, baseDate: Date = new Date()) {
    this.patterns = getSortedPatterns()
    this.baseDate = baseDate
    this.futureOnly = options.futureOnly ?? true
  }

  /**
   * Parse text to find date expressions
   * Returns the first (highest priority) match found.
   * If futureOnly is true (default), past dates are skipped.
   *
   * @param text Input text to parse
   * @returns DateParseResult with match details or empty result
   */
  parse(text: string): DateParseResult {
    if (!text || text.trim().length === 0) {
      return this.emptyResult()
    }

    for (const pattern of this.patterns) {
      if (this.futureOnly && pattern.isPast) {
        continue
      }

      const match = text.match(pattern.pattern)

      if (match && match.index !== undefined) {
        const matchedText = match[0]
        const duration = pattern.extractor(match, this.baseDate)
        const label = pattern.labelGenerator(match)

        return {
          found: true,
          matchedText,
          startIndex: match.index,
          endIndex: match.index + matchedText.length,
          duration,
          label,
          confidence: pattern.confidence,
          isPast: pattern.isPast ?? false,
        }
      }
    }

    return this.emptyResult()
  }

  /**
   * Parse text and return all matches (for debugging/testing)
   * Respects futureOnly setting.
   *
   * @param text Input text to parse
   * @returns Array of all matches found
   */
  parseAll(text: string): DateParseResult[] {
    if (!text || text.trim().length === 0) {
      return []
    }

    const results: DateParseResult[] = []

    for (const pattern of this.patterns) {
      if (this.futureOnly && pattern.isPast) {
        continue
      }

      const match = text.match(pattern.pattern)

      if (match && match.index !== undefined) {
        const matchedText = match[0]
        const duration = pattern.extractor(match, this.baseDate)
        const label = pattern.labelGenerator(match)

        results.push({
          found: true,
          matchedText,
          startIndex: match.index,
          endIndex: match.index + matchedText.length,
          duration,
          label,
          confidence: pattern.confidence,
          isPast: pattern.isPast ?? false,
        })
      }
    }

    return results
  }

  /**
   * Update the base date for relative calculations
   * @param date New base date
   */
  setBaseDate(date: Date): void {
    this.baseDate = date
  }

  /**
   * Get current base date
   */
  getBaseDate(): Date {
    return this.baseDate
  }

  /**
   * Set futureOnly option
   * @param futureOnly Whether to only match future dates
   */
  setFutureOnly(futureOnly: boolean): void {
    this.futureOnly = futureOnly
  }

  /**
   * Get futureOnly setting
   */
  getFutureOnly(): boolean {
    return this.futureOnly
  }

  /**
   * Create empty parse result
   */
  private emptyResult(): DateParseResult {
    return {
      found: false,
      matchedText: null,
      startIndex: -1,
      endIndex: -1,
      duration: null,
      label: null,
      confidence: 0,
      isPast: false,
    }
  }
}
