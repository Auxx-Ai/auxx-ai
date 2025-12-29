// packages/redis/src/utils/channel-matcher.ts
import { logger } from '../types'

/**
 * Pattern matching utilities for Redis channels
 */

/**
 * Convert Redis glob pattern to JavaScript regex
 * Redis patterns use: * (any characters), ? (single character)
 */
export function patternToRegex(pattern: string): RegExp {
  // Escape special regex characters except * and ?
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*') // * matches any characters
    .replace(/\?/g, '.') // ? matches single character

  return new RegExp(`^${escaped}$`)
}

/**
 * Check if a channel matches a pattern
 */
export function matchesPattern(channel: string, pattern: string): boolean {
  try {
    const regex = patternToRegex(pattern)
    return regex.test(channel)
  } catch (error) {
    logger.error('Error matching pattern', { channel, pattern, error: (error as Error).message })
    return false
  }
}

/**
 * Find all patterns that match a given channel
 */
export function findMatchingPatterns(channel: string, patterns: string[]): string[] {
  return patterns.filter((pattern) => matchesPattern(channel, pattern))
}

/**
 * Convert Redis pattern to key pattern for Upstash polling
 * For example: 'workflow:run:*' -> 'events:workflow:run:*'
 */
export function patternToKeyPattern(pattern: string): string {
  return `events:${pattern}`
}

/**
 * Extract channel from Upstash key
 * For example: 'events:workflow:run:123' -> 'workflow:run:123'
 */
export function keyToChannel(key: string): string {
  if (key.startsWith('events:')) {
    return key.substring(7) // Remove 'events:' prefix
  }
  return key
}

/**
 * Validate Redis pattern syntax
 */
export function isValidPattern(pattern: string): boolean {
  if (!pattern || typeof pattern !== 'string') {
    return false
  }

  // Check for basic pattern validity
  // Redis patterns can contain: letters, numbers, :, -, _, *, ?
  const validPatternRegex = /^[a-zA-Z0-9:._*?-]+$/
  return validPatternRegex.test(pattern)
}

/**
 * Normalize pattern for consistent matching
 */
export function normalizePattern(pattern: string): string {
  return pattern.trim().toLowerCase()
}

/**
 * Check if pattern is more specific than another pattern
 * Used for handler priority ordering
 */
export function isMoreSpecific(pattern1: string, pattern2: string): boolean {
  // Count wildcards - fewer wildcards means more specific
  const wildcards1 = (pattern1.match(/\*/g) || []).length + (pattern1.match(/\?/g) || []).length
  const wildcards2 = (pattern2.match(/\*/g) || []).length + (pattern2.match(/\?/g) || []).length

  if (wildcards1 !== wildcards2) {
    return wildcards1 < wildcards2
  }

  // If same number of wildcards, longer pattern is more specific
  return pattern1.length > pattern2.length
}

/**
 * Get pattern specificity score (higher = more specific)
 */
export function getPatternSpecificity(pattern: string): number {
  const baseScore = pattern.length
  const wildcardPenalty =
    (pattern.match(/\*/g) || []).length * 10 + (pattern.match(/\?/g) || []).length * 5
  return Math.max(0, baseScore - wildcardPenalty)
}

/**
 * Sort patterns by specificity (most specific first)
 */
export function sortPatternsBySpecificity(patterns: string[]): string[] {
  return [...patterns].sort((a, b) => getPatternSpecificity(b) - getPatternSpecificity(a))
}
