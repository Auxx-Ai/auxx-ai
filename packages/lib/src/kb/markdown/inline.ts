// packages/lib/src/kb/markdown/inline.ts
//
// Helpers for serializing inline content (text + marks + placeholders) to
// markdown. Parsing is handled by the unified pipeline in md-to-blocks.ts.

import type { InlineJSON, MarkJSON } from './types'

const MARK_ORDER: MarkJSON['type'][] = [
  'link',
  'highlight',
  'underline',
  'bold',
  'italic',
  'strike',
  'code',
]

interface SerializeOpts {
  placeholders: 'literal' | ((id: string) => string)
}

export function inlineToMd(content: InlineJSON[] | undefined, opts: SerializeOpts): string {
  if (!content || content.length === 0) return ''
  let out = ''
  for (const node of content) {
    if (node.type === 'placeholder') {
      const id = typeof node.attrs?.id === 'string' ? (node.attrs.id as string) : ''
      out += renderPlaceholder(id, opts)
      continue
    }
    if (node.type === 'hardBreak') {
      out += '  \n'
      continue
    }
    out += renderTextNode(node)
  }
  return out
}

function renderPlaceholder(id: string, opts: SerializeOpts): string {
  if (typeof opts.placeholders === 'function') return opts.placeholders(id)
  return `{{${id}}}`
}

function renderTextNode(node: InlineJSON): string {
  const raw = node.text ?? ''
  if (raw.length === 0) return ''
  const marks = orderMarks(node.marks)

  // `code` mark wraps verbatim — escape only the surrounding backticks.
  if (marks.some((m) => m.type === 'code')) {
    return wrapCode(raw)
  }

  let body = escapeMarkdownText(raw)
  for (const mark of marks) {
    body = applyMark(body, mark)
  }
  return body
}

function orderMarks(marks: MarkJSON[] | undefined): MarkJSON[] {
  if (!marks || marks.length === 0) return []
  return [...marks].sort(
    (a, b) =>
      MARK_ORDER.indexOf(a.type as MarkJSON['type']) -
      MARK_ORDER.indexOf(b.type as MarkJSON['type'])
  )
}

function applyMark(body: string, mark: MarkJSON): string {
  switch (mark.type) {
    case 'bold':
      return `**${body}**`
    case 'italic':
      return `*${body}*`
    case 'strike':
      return `~~${body}~~`
    case 'underline':
      return `<u>${body}</u>`
    case 'highlight':
      // No native MD equivalent — drops to plain text. Documented as lossy.
      return body
    case 'link': {
      const href = typeof mark.attrs?.href === 'string' ? (mark.attrs.href as string) : ''
      return `[${body}](${escapeLinkUrl(href)})`
    }
    default:
      return body
  }
}

function wrapCode(text: string): string {
  // Pick a backtick fence longer than any run of backticks inside the text.
  const longestRun = (text.match(/`+/g) ?? []).reduce((max, r) => Math.max(max, r.length), 0)
  const fence = '`'.repeat(longestRun + 1)
  // Pad with a space when the text starts/ends with a backtick.
  const needsPad = text.startsWith('`') || text.endsWith('`')
  return needsPad ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`
}

const MARKDOWN_SPECIALS = /([\\`*_{}[\]()#+\-.!~<>|])/g

export function escapeMarkdownText(text: string): string {
  return text.replace(MARKDOWN_SPECIALS, '\\$1')
}

export function escapeLinkUrl(url: string): string {
  return url.replace(/[()\s]/g, encodeURIComponent)
}
