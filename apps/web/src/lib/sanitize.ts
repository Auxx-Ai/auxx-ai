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
