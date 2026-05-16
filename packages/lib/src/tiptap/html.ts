// packages/lib/src/tiptap/html.ts

import type { TiptapDoc, TiptapNode } from './types'

/**
 * Strip HTML tags from content. Decodes the common HTML entities and
 * collapses whitespace. Tolerant of malformed HTML — never throws.
 */
export function stripHtml(html: string): string {
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(p|div)>/gi, '\n')
  text = text.replace(/<[^>]+>/g, '')

  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')

  text = text
    .replace(/\n\s*\n+/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()

  return text
}

/**
 * Convert HTML to a minimal Tiptap doc. Handles paragraphs/divs as block
 * boundaries, and a small set of inline marks (bold, italic, underline,
 * links). Anything more exotic falls back to a plain text node. Pairs with
 * `docToHtml` for round-tripping email composer content.
 */
export function htmlToDoc(html: string): TiptapDoc {
  const cleanHtml = sanitizeHtml(html)

  const paragraphs = cleanHtml
    .split(/<\/p>|<\/div>/)
    .map((p) => p.replace(/<p[^>]*>|<div[^>]*>/gi, ''))
    .filter((p) => p.trim())

  return {
    type: 'doc',
    content: paragraphs.map((paragraph) => {
      const content = parseInlineElements(paragraph)
      return {
        type: 'paragraph',
        content: content.length > 0 ? content : [{ type: 'text', text: paragraph }],
      }
    }),
  }
}

function parseInlineElements(text: string): TiptapNode[] {
  const elements: TiptapNode[] = []
  let remaining = text

  const patterns = [
    { regex: /<strong>(.*?)<\/strong>/gi, mark: 'bold' },
    { regex: /<b>(.*?)<\/b>/gi, mark: 'bold' },
    { regex: /<em>(.*?)<\/em>/gi, mark: 'italic' },
    { regex: /<i>(.*?)<\/i>/gi, mark: 'italic' },
    { regex: /<u>(.*?)<\/u>/gi, mark: 'underline' },
  ]

  for (const pattern of patterns) {
    remaining = remaining.replace(pattern.regex, (_match, content) => {
      elements.push({
        type: 'text',
        text: content,
        marks: [{ type: pattern.mark }],
      })
      return `__PROCESSED_${elements.length - 1}__`
    })
  }

  remaining = remaining.replace(
    /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi,
    (_match, href, content) => {
      elements.push({
        type: 'text',
        text: content,
        marks: [{ type: 'link', attrs: { href } }],
      })
      return `__PROCESSED_${elements.length - 1}__`
    }
  )

  const parts = remaining.split(/__PROCESSED_\d+__/)
  const processedParts: TiptapNode[] = []
  let elementIndex = 0

  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) {
      processedParts.push({ type: 'text', text: parts[i] })
    }
    if (i < parts.length - 1 && elementIndex < elements.length) {
      const next = elements[elementIndex++]
      if (next) processedParts.push(next)
    }
  }

  return processedParts.length > 0 ? processedParts : [{ type: 'text', text }]
}

/**
 * Convert a Tiptap doc to a minimal HTML string. Mirrors `htmlToDoc` — only
 * the subset of nodes and marks that round-trips through that function is
 * handled. Anything else falls back to inner text.
 */
export function docToHtml(doc: TiptapDoc | null | undefined): string {
  if (!doc || !doc.content) return ''
  return doc.content
    .map((node) => {
      switch (node.type) {
        case 'paragraph':
          return `<p>${renderContent(node.content)}</p>`
        case 'heading': {
          const level = (node.attrs?.level as number | undefined) ?? 1
          return `<h${level}>${renderContent(node.content)}</h${level}>`
        }
        case 'bulletList':
          return `<ul>${(node.content ?? [])
            .map((item) => `<li>${renderContent(item.content?.[0]?.content)}</li>`)
            .join('')}</ul>`
        case 'orderedList':
          return `<ol>${(node.content ?? [])
            .map((item) => `<li>${renderContent(item.content?.[0]?.content)}</li>`)
            .join('')}</ol>`
        case 'blockquote':
          return `<blockquote>${renderContent(node.content)}</blockquote>`
        case 'codeBlock':
          return `<pre><code>${renderContent(node.content)}</code></pre>`
        case 'horizontalRule':
          return '<hr>'
        default:
          return renderContent(node.content)
      }
    })
    .join('\n')
}

function renderContent(content: TiptapNode[] | undefined): string {
  if (!content) return ''
  return content
    .map((node) => {
      if (node.type === 'text') {
        let text = node.text ?? ''
        if (node.marks) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case 'bold':
                text = `<strong>${text}</strong>`
                break
              case 'italic':
                text = `<em>${text}</em>`
                break
              case 'underline':
                text = `<u>${text}</u>`
                break
              case 'strike':
                text = `<s>${text}</s>`
                break
              case 'code':
                text = `<code>${text}</code>`
                break
              case 'link': {
                const href = (mark.attrs?.href as string | undefined) ?? '#'
                text = `<a href="${href}">${text}</a>`
                break
              }
            }
          }
        }
        return text
      }
      return ''
    })
    .join('')
}

function sanitizeHtml(html: string): string {
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

  clean = clean.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
  clean = clean.replace(/javascript:/gi, '')

  return clean
}
