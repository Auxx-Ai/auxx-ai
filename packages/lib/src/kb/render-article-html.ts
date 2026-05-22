// packages/lib/src/kb/render-article-html.ts

import { parseEmbedUrl } from './markdown/embed'
import { sanitizeShikiHtml } from './markdown/sanitize-shiki'
import type {
  AccordionJSON,
  ArticleNodeJSON,
  BlockJSON,
  CalloutVariant,
  CardData,
  EmbedAspect,
  InlineJSON,
  MarkJSON,
  TableCellJSON,
  TableJSON,
  TabsJSON,
} from './markdown/types'

export interface RenderArticleOptions {
  /** Cover image URL rendered above the title. */
  coverImageUrl?: string | null
  /** Article title rendered as `<h1>` in the header block. */
  title?: string | null
  /**
   * Icon id (from `ICON_DATA` in `@auxx/ui`) rendered next to the title. The
   * widget hydrates `<span data-auxx-icon="…">` placeholders into Lucide SVGs
   * client-side; pure emoji characters can also be passed and are still
   * rendered (treated as a single-character icon id that won't resolve to a
   * Lucide component and falls through to the emoji text via CSS content).
   */
  emoji?: string | null
  /**
   * Absolute URL of the article on the public KB site. Not used for inline
   * rendering anymore (v3 renders all block types directly), but kept for
   * downstream consumers that want to deep-link out.
   */
  publicArticleUrl?: string | null
}

type DocInput = ArticleNodeJSON[] | { type: 'doc'; content: ArticleNodeJSON[] }

const AUXX_KB_PREFIX = 'auxx://kb/article/'
const SAFE_URL_SCHEMES = /^(https?:|mailto:|tel:)/i
const ALLOWED_ASPECTS: ReadonlySet<EmbedAspect> = new Set(['16:9', '4:3', '1:1'])

/**
 * Render an article's `contentJson` to a sanitized HTML string suitable for
 * the chat widget's inline reader. Every output tag is hand-emitted, every
 * text value escaped, and every URL whitelisted — there is no raw-HTML
 * passthrough except for shiki-tokenized code blocks, which pass through
 * `sanitizeShikiHtml`'s tag allowlist.
 */
export function renderArticleHtml(contentJson: DocInput, opts: RenderArticleOptions = {}): string {
  const nodes = Array.isArray(contentJson) ? contentJson : (contentJson?.content ?? [])
  const header = renderHeader(opts)
  const body = nodes.map(renderTopLevelNode).join('')
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
      parts.push(renderIconPlaceholder(opts.emoji!, 'data-auxx-article-emoji'))
    }
    if (hasTitle) {
      parts.push(`<span data-auxx-article-titletext>${escapeText(opts.title!)}</span>`)
    }
    parts.push('</h1>')
  }
  parts.push('</header>')
  return parts.join('')
}

function renderTopLevelNode(node: ArticleNodeJSON): string {
  switch (node.type) {
    case 'block':
      return renderBlock(node)
    case 'tabs':
      return renderTabs(node)
    case 'accordion':
      return renderAccordion(node)
    case 'table':
      return renderTable(node)
    default:
      return ''
  }
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
    case 'codeBlock':
      return renderCodeBlock(node)
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
      return renderEmbed(node)
    case 'cards':
      return renderCards(node)
    case 'text':
    default:
      return `<p data-auxx-block="text">${inline}</p>`
  }
}

function renderCodeBlock(node: BlockJSON): string {
  const language = node.attrs?.codeLanguage ?? 'plaintext'
  const highlighted = node.attrs?.codeHighlightedHtml
  if (typeof highlighted === 'string' && highlighted.length > 0) {
    const safe = sanitizeShikiHtml(highlighted)
    if (safe) {
      return `<div data-auxx-block="code" data-language="${escapeAttr(language)}">${safe}</div>`
    }
  }
  const text = collectInlineText(node.content)
  return `<pre data-auxx-block="code" data-language="${escapeAttr(
    language
  )}"><code>${escapeText(text)}</code></pre>`
}

function renderEmbed(node: BlockJSON): string {
  const raw = typeof node.attrs?.embedUrl === 'string' ? node.attrs.embedUrl : ''
  if (!raw) return ''
  const parsed = parseEmbedUrl(raw)
  const aspect = (node.attrs?.embedAspect ?? '16:9') as EmbedAspect
  const safeAspect = ALLOWED_ASPECTS.has(aspect) ? aspect : '16:9'
  if (!parsed) {
    const fallback = safeUrl(raw)
    if (!fallback) return ''
    return `<p data-auxx-block="text"><a href="${escapeAttr(
      fallback
    )}" target="_blank" rel="noopener noreferrer">${escapeText(raw)}</a></p>`
  }
  const src = safeUrl(parsed.embedSrc)
  if (!src) return ''
  return `<div data-auxx-block="embed" data-aspect="${escapeAttr(
    safeAspect
  )}" data-provider="${escapeAttr(parsed.provider)}"><iframe src="${escapeAttr(
    src
  )}" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen loading="lazy" title="${escapeAttr(
    parsed.provider
  )} embed"></iframe></div>`
}

function renderCards(node: BlockJSON): string {
  const cards = (node.attrs?.cards ?? []) as CardData[]
  if (!Array.isArray(cards) || cards.length === 0) return ''
  const items = cards.map(renderCardItem).filter(Boolean).join('')
  if (!items) return ''
  return `<div data-auxx-block="cards" role="list">${items}</div>`
}

function renderCardItem(card: CardData): string {
  const title = card.title ? escapeText(card.title) : ''
  const desc = card.description ? escapeText(card.description) : ''
  const icon = card.iconId ? renderIconPlaceholder(card.iconId, 'data-auxx-card-icon') : ''
  const inner = `${icon}<span data-auxx-card-body><span data-auxx-card-title>${title}</span>${
    desc ? `<span data-auxx-card-desc>${desc}</span>` : ''
  }</span>`
  const href = typeof card.href === 'string' ? card.href : ''
  if (href.startsWith(AUXX_KB_PREFIX)) {
    const articleId = href.slice(AUXX_KB_PREFIX.length)
    return `<a data-auxx-card data-auxx-article-link="${escapeAttr(
      articleId
    )}" href="#" role="listitem">${inner}</a>`
  }
  const safe = safeUrl(href)
  if (safe) {
    return `<a data-auxx-card href="${escapeAttr(
      safe
    )}" target="_blank" rel="noopener noreferrer" role="listitem">${inner}</a>`
  }
  return `<div data-auxx-card role="listitem">${inner}</div>`
}

function renderTabs(node: TabsJSON): string {
  if (!Array.isArray(node.content) || node.content.length === 0) return ''
  const parts: string[] = ['<div data-auxx-block="tabs">']
  parts.push('<div data-auxx-tabs-list role="tablist">')
  node.content.forEach((panel, i) => {
    const isActive = i === 0
    const id = typeof panel.attrs?.id === 'string' && panel.attrs.id ? panel.attrs.id : `t${i}`
    const label = panel.attrs?.label ? escapeText(panel.attrs.label) : 'Untitled'
    const icon = panel.attrs?.iconId ? renderIconPlaceholder(panel.attrs.iconId) : ''
    parts.push(
      `<button type="button" data-auxx-tab data-target="${escapeAttr(
        id
      )}" role="tab" aria-selected="${isActive}" tabindex="${
        isActive ? 0 : -1
      }" data-active="${isActive}">${icon}<span>${label}</span></button>`
    )
  })
  parts.push('</div>')
  parts.push('<div data-auxx-tabs-panels>')
  node.content.forEach((panel, i) => {
    const isActive = i === 0
    const id = typeof panel.attrs?.id === 'string' && panel.attrs.id ? panel.attrs.id : `t${i}`
    const body = panel.content.map(renderBlock).join('')
    parts.push(
      `<div data-auxx-tab-panel data-id="${escapeAttr(
        id
      )}" role="tabpanel" data-active="${isActive}"${isActive ? '' : ' hidden'}>${body}</div>`
    )
  })
  parts.push('</div></div>')
  return parts.join('')
}

function renderAccordion(node: AccordionJSON): string {
  if (!Array.isArray(node.content) || node.content.length === 0) return ''
  const allowMultiple = node.attrs?.allowMultiple !== false
  const parts: string[] = [
    `<div data-auxx-block="accordion" data-allow-multiple="${allowMultiple}">`,
  ]
  node.content.forEach((panel, i) => {
    const id = typeof panel.attrs?.id === 'string' && panel.attrs.id ? panel.attrs.id : `a${i}`
    const label = panel.attrs?.label ? escapeText(panel.attrs.label) : 'Untitled'
    const body = panel.content.map(renderBlock).join('')
    parts.push(
      `<details data-auxx-accordion-item data-id="${escapeAttr(
        id
      )}"><summary data-auxx-accordion-summary>${renderIconPlaceholder(
        'chevron-down',
        'data-auxx-accordion-chevron'
      )}<span data-auxx-accordion-label>${label}</span></summary><div data-auxx-accordion-panel>${body}</div></details>`
    )
  })
  parts.push('</div>')
  return parts.join('')
}

function renderTable(node: TableJSON): string {
  if (!Array.isArray(node.content) || node.content.length === 0) return ''
  const [firstRow, ...restRows] = node.content
  const firstRowIsHeader =
    firstRow &&
    firstRow.content.length > 0 &&
    firstRow.content.every((c) => c.type === 'tableHeader')
  const parts: string[] = ['<div data-auxx-block="table"><div data-auxx-table-scroll><table>']
  if (firstRow && firstRowIsHeader) {
    parts.push('<thead><tr>')
    for (const cell of firstRow.content) parts.push(renderTableCell(cell, 'col'))
    parts.push('</tr></thead>')
  }
  parts.push('<tbody>')
  const bodyRows = firstRowIsHeader ? restRows : node.content
  for (const row of bodyRows) {
    parts.push('<tr>')
    for (const cell of row.content) parts.push(renderTableCell(cell, 'row'))
    parts.push('</tr>')
  }
  parts.push('</tbody></table></div></div>')
  return parts.join('')
}

function renderTableCell(cell: TableCellJSON, scope: 'col' | 'row'): string {
  const tag = cell.type === 'tableHeader' ? 'th' : 'td'
  const attrs: string[] = []
  const colspan = cell.attrs?.colspan
  if (typeof colspan === 'number' && colspan > 1) attrs.push(`colspan="${colspan}"`)
  const rowspan = cell.attrs?.rowspan
  if (typeof rowspan === 'number' && rowspan > 1) attrs.push(`rowspan="${rowspan}"`)
  if (tag === 'th') attrs.push(`scope="${scope}"`)
  const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
  const body = cell.content.map(renderBlock).join('')
  return `<${tag}${attrStr}>${body}</${tag}>`
}

function renderIconPlaceholder(iconId: string, extraAttr?: string): string {
  if (!iconId) return ''
  const id = iconId.trim()
  if (!id) return ''
  const extra = extraAttr ? ` ${extraAttr}` : ''
  return `<span data-auxx-icon="${escapeAttr(id)}" aria-hidden="true"${extra}></span>`
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
