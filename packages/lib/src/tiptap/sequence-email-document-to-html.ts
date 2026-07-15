// packages/lib/src/tiptap/sequence-email-document-to-html.ts

import type { TiptapDoc, TiptapMark, TiptapNode } from './types'

/** Render a concrete sequence email document to safe outbound HTML. */
export function sequenceEmailDocumentToHtml(document: TiptapDoc): string {
  return (document.content ?? []).map(renderBlock).join('')
}

/** Add the sequence-owned unsubscribe footer before the document reaches the HTML boundary. */
export function appendSequenceUnsubscribeFooter(document: TiptapDoc, url: string): TiptapDoc {
  return {
    ...document,
    content: [
      ...(document.content ?? []),
      {
        type: 'paragraph',
        attrs: { textAlign: 'left' },
        content: [
          {
            type: 'text',
            text: 'Unsubscribe',
            marks: [{ type: 'link', attrs: { href: url } }],
          },
        ],
      },
    ],
  }
}

function renderBlock(node: TiptapNode): string {
  const content = renderInline(node.content)
  const attrs = blockStyle(node)
  switch (node.type) {
    case 'paragraph':
      return `<p${attrs}>${content}</p>`
    case 'heading': {
      const level = Number(node.attrs?.level)
      if (!Number.isInteger(level) || level < 1 || level > 3)
        throw new Error('Unsupported heading level')
      return `<h${level}${attrs}>${content}</h${level}>`
    }
    case 'bulletList':
      return `<ul${attrs}>${(node.content ?? []).map(renderListItem).join('')}</ul>`
    case 'orderedList':
      return `<ol${attrs}>${(node.content ?? []).map(renderListItem).join('')}</ol>`
    case 'blockquote':
      return `<blockquote${attrs}>${(node.content ?? []).map(renderBlock).join('')}</blockquote>`
    case 'codeBlock':
      return `<pre${attrs}><code>${content}</code></pre>`
    case 'horizontalRule':
      return '<hr>'
    default:
      throw new Error(`Unsupported sequence email node: ${node.type ?? 'unknown'}`)
  }
}

function renderListItem(node: TiptapNode): string {
  if (node.type !== 'listItem') throw new Error(`Unsupported list child: ${node.type ?? 'unknown'}`)
  return `<li${blockStyle(node)}>${(node.content ?? []).map(renderBlock).join('')}</li>`
}

function renderInline(nodes: TiptapNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === 'text') return applyMarks(escapeHtml(node.text ?? ''), node.marks ?? [])
      if (node.type === 'hardBreak') return '<br>'
      if (node.type === 'placeholder')
        throw new Error('Unresolved placeholder reached sequence email renderer')
      throw new Error(`Unsupported sequence email inline node: ${node.type ?? 'unknown'}`)
    })
    .join('')
}

function applyMarks(html: string, marks: TiptapMark[]): string {
  return marks.reduce((value, mark) => {
    switch (mark.type) {
      case 'bold':
        return `<strong>${value}</strong>`
      case 'italic':
        return `<em>${value}</em>`
      case 'underline':
        return `<u>${value}</u>`
      case 'strike':
        return `<s>${value}</s>`
      case 'code':
        return `<code>${value}</code>`
      case 'link': {
        const href = mark.attrs?.href
        if (typeof href !== 'string' || !isSafeHref(href)) throw new Error('Unsafe email link')
        return `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${value}</a>`
      }
      case 'textStyle': {
        const style = textStyle(mark.attrs)
        return style ? `<span style="${style}">${value}</span>` : value
      }
      default:
        throw new Error(`Unsupported sequence email mark: ${mark.type}`)
    }
  }, html)
}

function blockStyle(node: TiptapNode): string {
  const styles: string[] = []
  const align = node.attrs?.textAlign
  if (align === 'center' || align === 'right' || align === 'justify')
    styles.push(`text-align:${align}`)
  const indent = node.attrs?.indent
  if (typeof indent === 'number' && Number.isInteger(indent) && indent > 0 && indent <= 8)
    styles.push(`margin-left:${indent * 2}em`)
  return styles.length ? ` style="${styles.join(';')}"` : ''
}

function textStyle(attrs: Record<string, unknown> | undefined): string {
  if (!attrs) return ''
  const styles: string[] = []
  if (typeof attrs.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(attrs.color))
    styles.push(`color:${attrs.color}`)
  if (typeof attrs.fontFamily === 'string' && /^[a-z0-9 ,'-]{1,80}$/i.test(attrs.fontFamily))
    styles.push(`font-family:${attrs.fontFamily}`)
  if (typeof attrs.fontSize === 'string' && /^\d{1,2}(px|pt|em|rem|%)$/.test(attrs.fontSize))
    styles.push(`font-size:${attrs.fontSize}`)
  return styles.join(';')
}

function isSafeHref(href: string): boolean {
  try {
    const url = new URL(href, 'https://auxx.invalid')
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  )
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}
