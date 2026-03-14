// apps/web/src/lib/sanitize.ts
'use client'

import DOMPurify from 'dompurify'

/**
 * Escapes special HTML characters to prevent XSS and malformed HTML.
 * Use for inserting untrusted text into HTML attributes or content.
 */
export function escapeHtml(str: string): string {
  if (typeof document === 'undefined') {
    // SSR fallback - escape manually
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/**
 * DOMPurify configuration for general HTML content
 * Allows basic formatting while stripping dangerous elements
 */
const DEFAULT_CONFIG: DOMPurify.Config = {
  USE_PROFILES: { html: true },
  ALLOWED_TAGS: [
    'p',
    'br',
    'b',
    'i',
    'em',
    'strong',
    'u',
    's',
    'strike',
    'ul',
    'ol',
    'li',
    'a',
    'span',
    'div',
    'blockquote',
    'pre',
    'code',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'img',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'src', 'alt', 'title'],
  ALLOW_DATA_ATTR: false,
}

/**
 * Sanitize HTML content for safe rendering
 * Must only be called on client-side (browser environment)
 */
export function sanitizeHtml(html: string, config?: DOMPurify.Config): string {
  if (typeof window === 'undefined') {
    // Return stripped content for SSR
    return html.replace(/<[^>]*>/g, '')
  }
  return DOMPurify.sanitize(html, config ?? DEFAULT_CONFIG)
}

/**
 * Simple sanitization using DOMPurify's html profile
 * Good for email snippets and simple content
 */
export function sanitizeSimple(html: string): string {
  if (typeof window === 'undefined') {
    return html.replace(/<[^>]*>/g, '')
  }
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

/** Type for comment mentions */
export type CommentMention = {
  id: string
  userId: string
  user: { id: string; name: string | null }
}

/**
 * Format comment content with styled mentions
 * Sanitizes both the input content and the generated HTML
 */
export function formatCommentContent(content: string, mentions: CommentMention[]): string {
  // First sanitize the raw content to prevent injection
  let formattedContent = sanitizeSimple(content)

  // Create a mapping of user IDs to names
  const userMap = mentions.reduce(
    (acc, mention) => {
      acc[mention.userId] = mention.user.name || 'Unknown User'
      return acc
    },
    {} as Record<string, string>
  )

  // Replace @username with styled mentions
  // The replacement is safe because userMap values are sanitized names from our DB
  const mentionRegex = /@(\w+)/g
  formattedContent = formattedContent.replace(mentionRegex, (match, username) => {
    const mentionedUserId = Object.entries(userMap).find(
      ([_, name]) => name.toLowerCase() === username.toLowerCase()
    )?.[0]

    if (mentionedUserId) {
      // Escape the username to prevent XSS via mention names
      const safeName = userMap[mentionedUserId]!.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<span class="text-blue-500 font-semibold">@${safeName}</span>`
    }
    return match
  })

  return formattedContent
}
