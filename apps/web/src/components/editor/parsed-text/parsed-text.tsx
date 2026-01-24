// apps/web/src/components/editor/parsed-text/parsed-text.tsx

'use client'

import { useMemo, type ReactNode } from 'react'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import type { ActorId } from '@auxx/types/actor'

/** Pattern configuration for parsing */
interface PatternConfig {
  /** Regex pattern to match (must have capture group for ID) */
  pattern: RegExp
  /** Extract ID from match */
  getId: (match: RegExpMatchArray) => string
  /** Render the matched element */
  render: (id: string, key: string) => ReactNode
}

/** Default pattern for @[user:ID] mentions */
const MENTION_PATTERN: PatternConfig = {
  pattern: /@\[([^\]]+)\]/g,
  getId: (match) => match[1]!,
  render: (id, key) => (
    <>
      <span className="text-info">@</span>
      <ActorBadge
        key={key}
        variant="text"
        showIcon={false}
        className="inline-flex text-info"
        actorId={id as ActorId}
      />
    </>
  ),
}

/** Props for ParsedText component */
interface ParsedTextProps {
  /** Text content to parse */
  children: string
  /** Pattern configurations (defaults to mentions) */
  patterns?: PatternConfig[]
  /** Additional class for wrapper span */
  className?: string
}

/**
 * Parse text and return array of strings and React elements.
 */
function parseTextWithPatterns(text: string, patterns: PatternConfig[]): ReactNode[] {
  const result: ReactNode[] = []
  let remaining = text
  let keyCounter = 0

  while (remaining.length > 0) {
    // Find earliest match across all patterns
    let earliestMatch: {
      match: RegExpMatchArray
      config: PatternConfig
      index: number
    } | null = null

    for (const config of patterns) {
      // Reset lastIndex for global patterns
      const pattern = new RegExp(config.pattern.source, 'g')
      const match = pattern.exec(remaining)

      if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
        earliestMatch = { match, config, index: match.index }
      }
    }

    if (!earliestMatch) {
      // No more matches, add remaining text
      if (remaining) result.push(remaining)
      break
    }

    // Add text before match
    if (earliestMatch.index > 0) {
      result.push(remaining.slice(0, earliestMatch.index))
    }

    // Add rendered element
    const id = earliestMatch.config.getId(earliestMatch.match)
    result.push(earliestMatch.config.render(id, `parsed-${keyCounter++}`))

    // Continue with text after match
    remaining = remaining.slice(earliestMatch.index + earliestMatch.match[0].length)
  }

  return result
}

/**
 * Parses text content and renders patterns as React components.
 * Default behavior parses @[user:ID] patterns into ActorBadge components.
 *
 * @example
 * // Basic usage - parses mentions
 * <ParsedText>Call @[user:abc123] about order</ParsedText>
 *
 * @example
 * // Custom patterns
 * <ParsedText patterns={[MENTION_PATTERN, RECORD_LINK_PATTERN]}>
 *   {content}
 * </ParsedText>
 */
export function ParsedText({ children, patterns = [MENTION_PATTERN], className }: ParsedTextProps) {
  const parsed = useMemo(() => {
    if (!children || patterns.length === 0) {
      return [children]
    }

    return parseTextWithPatterns(children, patterns)
  }, [children, patterns])

  return <span className={className}>{parsed}</span>
}

export { MENTION_PATTERN }
export type { PatternConfig }
