// apps/web/src/components/global/comments/parsed-comment-content.tsx

'use client'

import type { ActorId } from '@auxx/types/actor'
import { type ReactNode, useMemo } from 'react'
import { ActorBadge } from '~/components/resources/ui/actor-badge'

/** Regex to match @[id] patterns in plain text (fallback for unserialized mentions) */
const MENTION_REGEX = /@\[([^\]]+)\]/g

/**
 * Parse plain text for @[id] mention patterns and return React nodes.
 */
function parseTextForMentions(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null = null
  let key = 0

  // Reset regex state
  MENTION_REGEX.lastIndex = 0

  while ((match = MENTION_REGEX.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const actorId = match[1]!
    parts.push(
      <span key={`mention-${key}`} className='inline-flex items-baseline'>
        <span className='text-info'>@</span>
        <ActorBadge
          variant='text'
          showIcon={false}
          className='inline-flex text-info'
          actorId={actorId as ActorId}
        />
      </span>
    )
    key++
    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

/**
 * Convert a DOM node tree into React elements, replacing mention spans with ActorBadge.
 */
function domToReact(node: ChildNode, key: number): ReactNode {
  // Text node — parse for any @[id] patterns
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || ''
    if (!text) return null

    const parsed = parseTextForMentions(text)
    return parsed.length === 1 ? parsed[0] : <span key={`text-${key}`}>{parsed}</span>
  }

  // Element node
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement

    // Mention span — render ActorBadge
    if (el.tagName === 'SPAN' && el.getAttribute('data-type') === 'mention') {
      const actorId = el.getAttribute('data-id')
      if (actorId) {
        return (
          <span key={`mention-el-${key}`} className='inline-flex items-baseline'>
            <span className='text-info'>@</span>
            <ActorBadge
              variant='text'
              showIcon={false}
              className='inline-flex text-info'
              actorId={actorId as ActorId}
            />
          </span>
        )
      }
    }

    // <p> tags — render children inline (TipTap wraps content in <p>)
    if (el.tagName === 'P') {
      const children = Array.from(el.childNodes).map((child, i) => domToReact(child, i))
      return <span key={`p-${key}`}>{children}</span>
    }

    // <br> tags
    if (el.tagName === 'BR') {
      return <br key={`br-${key}`} />
    }

    // Other elements — render children
    const children = Array.from(el.childNodes).map((child, i) => domToReact(child, i))
    return <span key={`el-${key}`}>{children}</span>
  }

  return null
}

interface ParsedCommentContentProps {
  /** HTML content from TipTap editor */
  children: string
}

/**
 * Parses TipTap HTML comment content and renders mention spans as ActorBadge components.
 * Handles both `<span data-type="mention" data-id="...">` elements and plain text `@[id]` patterns.
 */
export function ParsedCommentContent({ children }: ParsedCommentContentProps) {
  const parsed = useMemo(() => {
    if (!children) return null

    // Parse HTML using DOMParser
    if (typeof window === 'undefined') {
      // SSR fallback — strip HTML tags and parse text patterns
      const text = children.replace(/<[^>]*>/g, ' ')
      return parseTextForMentions(text)
    }

    const doc = new DOMParser().parseFromString(children, 'text/html')
    const nodes = Array.from(doc.body.childNodes)
    return nodes.map((node, i) => domToReact(node, i))
  }, [children])

  return <>{parsed}</>
}
