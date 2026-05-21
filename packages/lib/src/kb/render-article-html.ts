// packages/lib/src/kb/render-article-html.ts

import type {
  ArticleNodeJSON,
  BlockJSON,
  CalloutVariant,
  InlineJSON,
  MarkJSON,
} from './markdown/types'

export interface RenderArticleOptions {
  /** Cover image URL rendered above the title. */
  coverImageUrl?: string | null
  /** Article title rendered as `<h1>` in the header block. */
  title?: string | null
  /** Article emoji rendered next to the title. */
  emoji?: string | null
  /**
   * Absolute URL of the article on the public KB site, used by container
   * blocks (tabs/accordion/table) that can't be rendered inline in v1.
   * When omitted those blocks degrade to flat content without the link.
   */
  publicArticleUrl?: string | null
}

type DocInput = ArticleNodeJSON[] | { type: 'doc'; content: ArticleNodeJSON[] }

const AUXX_KB_PREFIX = 'auxx://kb/article/'
const SAFE_URL_SCHEMES = /^(https?:|mailto:|tel:)/i

/**
 * Render an article's `contentJson` to a sanitized HTML string suitable for
 * the chat widget's inline reader. Every output tag is hand-emitted, every
 * text value escaped, and every URL whitelisted — there is no raw-HTML
 * passthrough, so we don't need an external sanitizer.
 *
 * Output uses semantic tags with `data-auxx-*` attributes so the widget CSS
 * can target only what the renderer emits.
 */
export function renderArticleHtml(contentJson: DocInput, opts: RenderArticleOptions = {}): string {
  const nodes = Array.isArray(contentJson) ? contentJson : (contentJson?.content ?? [])
  const header = renderHeader(opts)
  const body = nodes.map((node) => renderTopLevelNode(node, opts.publicArticleUrl ?? null)).join('')
  return `${header}${body}`
}

function renderHeader(opts: RenderArticleOptions): string {
  const hasCover = !!opts.coverImageUrl
  const hasTitle = !!(opts.title && opts.title.trim())
  const hasEmoji = !!(opts.emoji && opts.emoji.trim())
  if (!hasCover && !hasTitle && !hasEmoji) return ''

  const parts: string[] = ['<header data-auxx-article-head>']
  if (hasCover) {
    parts.push(
      `<img data-auxx-article-cover src="${escapeAttr(safeUrl(opts.coverImageUrl!) ?? '')}" alt="" />`
    )
  }
  if (hasTitle || hasEmoji) {
    parts.push('<h1 data-auxx-article-title>')
    if (hasEmoji) {
      parts.push(
        `<span data-auxx-article-emoji aria-hidden="true">${escapeText(opts.emoji!)}</span>`
      )
    }
    if (hasTitle) {
      parts.push(`<span data-auxx-article-titletext>${escapeText(opts.title!)}</span>`)
    }
    parts.push('</h1>')
  }
  parts.push('</header>')
  return parts.join('')
}

function renderTopLevelNode(node: ArticleNodeJSON, publicArticleUrl: string | null): string {
  if (node.type === 'block') return renderBlock(node)
  // Tabs / accordion / table: flatten the inner text content and append a
  // "view full article" link. Keeps the renderer narrow; the public KB site
  // is the source of truth for the interactive rendering.
  const flat = flattenContainerToBlocks(node).map(renderBlock).join('')
  const link = publicArticleUrl
    ? `<p data-auxx-article-fallback><a href="${escapeAttr(
        safeUrl(publicArticleUrl) ?? '#'
      )}" target="_blank" rel="noopener noreferrer">View full article</a></p>`
    : ''
  return flat + link
}

function flattenContainerToBlocks(node: ArticleNodeJSON): BlockJSON[] {
  if (node.type === 'block') return [node]
  if (node.type === 'tabs' || node.type === 'accordion') {
    return node.content.flatMap((panel) => panel.content)
  }
  // table
  return node.content.flatMap((row) => row.content.flatMap((cell) => cell.content))
}

function renderBlock(node: BlockJSON): string {
  const blockType = node.attrs?.blockType ?? 'text'
  const inline = renderInline(node.content)

  switch (blockType) {
    case 'heading': {
      const level = clampHeading(node.attrs?.level ?? 1)
      const tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4'
      return `<${tag} data-auxx-block="heading" data-level="${level}">${inline}</${tag}>`
    }
    case 'bulletListItem': {
      const indent = clampIndent(node.attrs?.level ?? 1)
      return `<ul data-auxx-block="bullet-list" data-indent="${indent}"><li>${inline}</li></ul>`
    }
    case 'numberedListItem': {
      const indent = clampIndent(node.attrs?.level ?? 1)
      return `<ol data-auxx-block="numbered-list" data-indent="${indent}"><li>${inline}</li></ol>`
    }
    case 'todoListItem': {
      const checked = !!node.attrs?.checked
      return `<div data-auxx-block="todo" data-checked="${checked}"><span data-auxx-todo-box aria-hidden="true">${
        checked ? '&#10003;' : ''
      }</span><span>${inline}</span></div>`
    }
    case 'quote':
      return `<blockquote data-auxx-block="quote">${inline}</blockquote>`
    case 'callout': {
      const variant: CalloutVariant = node.attrs?.calloutVariant ?? 'info'
      return `<aside data-auxx-block="callout" data-variant="${escapeAttr(
        variant
      )}" role="note">${inline}</aside>`
    }
    case 'codeBlock': {
      const language = node.attrs?.codeLanguage ?? 'plaintext'
      const text = collectInlineText(node.content)
      return `<pre data-auxx-block="code" data-language="${escapeAttr(
        language
      )}"><code>${escapeText(text)}</code></pre>`
    }
    case 'image': {
      const url = safeUrl(node.attrs?.imageUrl)
      if (!url) return ''
      const align = node.attrs?.imageAlign ?? 'center'
      return `<figure data-auxx-block="image" data-align="${escapeAttr(
        align
      )}"><img src="${escapeAttr(url)}" alt="" /></figure>`
    }
    case 'divider':
      return '<hr data-auxx-block="divider" />'
    case 'embed':
    case 'cards':
      // Out of scope for v1: render the inner text as a paragraph if any.
      return inline ? `<p data-auxx-block="text">${inline}</p>` : ''
    case 'text':
    default:
      return `<p data-auxx-block="text">${inline}</p>`
  }
}

function renderInline(content: InlineJSON[] | undefined): string {
  if (!content || content.length === 0) return ''
  return content.map(renderInlineNode).join('')
}

function renderInlineNode(node: InlineJSON): string {
  if (node.type === 'hardBreak') return '<br />'
  if (node.type === 'placeholder') {
    const label = typeof node.attrs?.label === 'string' ? node.attrs.label : ''
    return `<span data-auxx-placeholder>${escapeText(label ? `{${label}}` : '')}</span>`
  }
  if (node.type !== 'text') return ''
  const text = node.text ?? ''
  if (!text) return ''
  return applyMarks(escapeText(text), node.marks ?? [])
}

function applyMarks(escaped: string, marks: MarkJSON[]): string {
  let html = escaped
  for (const mark of marks) {
    html = wrapMark(html, mark)
  }
  return html
}

function wrapMark(html: string, mark: MarkJSON): string {
  switch (mark.type) {
    case 'bold':
      return `<strong>${html}</strong>`
    case 'italic':
      return `<em>${html}</em>`
    case 'underline':
      return `<u>${html}</u>`
    case 'strike':
      return `<s>${html}</s>`
    case 'code':
      return `<code data-auxx-inline-code>${html}</code>`
    case 'highlight':
      return `<mark>${html}</mark>`
    case 'link': {
      const rawHref = typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''
      if (rawHref.startsWith(AUXX_KB_PREFIX)) {
        const articleId = rawHref.slice(AUXX_KB_PREFIX.length)
        // Widget intercepts clicks via data attribute and pushes another
        // kb-article frame instead of navigating.
        return `<a data-auxx-article-link="${escapeAttr(articleId)}" href="#">${html}</a>`
      }
      const safe = safeUrl(rawHref)
      if (!safe) return html
      return `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer">${html}</a>`
    }
    default:
      return html
  }
}

function collectInlineText(content: InlineJSON[] | undefined): string {
  if (!content) return ''
  let out = ''
  for (const node of content) {
    if (node.type === 'text' && node.text) out += node.text
    else if (node.type === 'hardBreak') out += '\n'
  }
  return out
}

function safeUrl(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  // Allow protocol-relative and root-relative URLs implicitly.
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed
  if (SAFE_URL_SCHEMES.test(trimmed)) return trimmed
  return null
}

function clampHeading(level: number): 1 | 2 | 3 {
  if (level <= 1) return 1
  if (level === 2) return 2
  return 3
}

function clampIndent(level: number): number {
  if (level < 1) return 1
  if (level > 5) return 5
  return level
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
