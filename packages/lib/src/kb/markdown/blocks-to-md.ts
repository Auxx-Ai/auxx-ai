// packages/lib/src/kb/markdown/blocks-to-md.ts
//
// Serializes a KB DocJSON to markdown in the "Auxx MD" dialect.
// See plans/kb/markdown-support.md for the format spec.

import { escapeLinkUrl, escapeMarkdownText, inlineToMd } from './inline'
import type {
  AccordionJSON,
  ArticleNodeJSON,
  BlockAttrs,
  BlockJSON,
  CalloutVariant,
  CardData,
  DocJSON,
  EmbedAspect,
  EmbedProvider,
  ImageAlign,
  InlineJSON,
  PanelJSON,
  TabsJSON,
} from './types'
import { CALLOUT_VARIANTS } from './types'

export interface BlocksToMdOptions {
  /** How to render placeholder inline nodes. `'literal'` writes `{{id}}`. */
  placeholders?: 'literal' | ((id: string) => string)
}

export function blocksToMd(doc: DocJSON | null | undefined, opts: BlocksToMdOptions = {}): string {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return ''
  const placeholders = opts.placeholders ?? 'literal'
  const ctx = { placeholders }

  const lines = renderNodes(doc.content, ctx)

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

function renderNodes(nodes: ArticleNodeJSON[], ctx: RenderCtx): string[] {
  const lines: string[] = []
  for (const node of nodes) {
    if (!node) continue
    const renderedLines = renderArticleNode(node, ctx)
    if (renderedLines.length === 0) continue
    if (lines.length > 0) lines.push('')
    for (const line of renderedLines) lines.push(line)
  }
  return lines
}

function renderArticleNode(node: ArticleNodeJSON, ctx: RenderCtx): string[] {
  switch (node.type) {
    case 'tabs':
      return renderTabs(node, ctx)
    case 'accordion':
      return renderAccordion(node, ctx)
    case 'block':
      return renderBlock(node, ctx)
    default:
      return []
  }
}

interface RenderCtx {
  placeholders: 'literal' | ((id: string) => string)
}

function renderBlock(block: BlockJSON, ctx: RenderCtx): string[] {
  const attrs = block.attrs ?? ({} as BlockAttrs)
  const inline = inlineToMd(block.content, ctx)

  switch (attrs.blockType) {
    case 'heading': {
      const level = clampLevel(attrs.level, 1, 3)
      return [`${'#'.repeat(level)} ${inline}`.trimEnd()]
    }
    case 'quote': {
      return inline.split('\n').map((line) => `> ${line}`)
    }
    case 'codeBlock': {
      const lang = typeof attrs.codeLanguage === 'string' ? attrs.codeLanguage : ''
      const code = blockText(block.content)
      return ['```' + lang, ...code.split('\n'), '```']
    }
    case 'divider':
      return ['---']
    case 'image':
      return [renderImage(attrs)]
    case 'bulletListItem':
      return [renderListItem('-', attrs.level ?? 1, inline)]
    case 'numberedListItem':
      return [renderListItem('1.', attrs.level ?? 1, inline)]
    case 'todoListItem': {
      const box = attrs.checked ? '[x]' : '[ ]'
      return [renderListItem(`- ${box}`, attrs.level ?? 1, inline)]
    }
    case 'callout':
      return renderCallout(attrs.calloutVariant, inline)
    case 'embed':
      return [renderEmbed(attrs)]
    case 'cards':
      return renderCards(attrs.cards)
    default:
      return inline.length > 0 ? [inline] : []
  }
}

function renderTabs(node: TabsJSON, ctx: RenderCtx): string[] {
  if (!Array.isArray(node.content) || node.content.length === 0) return []
  // remark-directive nests containers by COLON COUNT — outer must have
  // strictly more colons than inner. Use 4 outside / 3 inside so panel
  // bodies can themselves contain `:::callout` blocks unchanged.
  const out: string[] = ['::::tabs']
  for (const panel of node.content) {
    out.push(...renderPanel(panel, 'tab', ctx))
  }
  out.push('::::')
  return out
}

function renderAccordion(node: AccordionJSON, ctx: RenderCtx): string[] {
  if (!Array.isArray(node.content) || node.content.length === 0) return []
  const headerParts: string[] = []
  if (node.attrs?.allowMultiple === false) headerParts.push('multiple=false')
  const header =
    headerParts.length > 0 ? `::::accordion{${headerParts.join(' ')}}` : '::::accordion'
  const out: string[] = [header]
  for (const panel of node.content) {
    out.push(...renderPanel(panel, 'item', ctx))
  }
  out.push('::::')
  return out
}

function renderPanel(panel: PanelJSON, leafName: 'tab' | 'item', ctx: RenderCtx): string[] {
  const attrParts: string[] = [`label="${escapeAttrValue(panel.attrs.label ?? '')}"`]
  if (panel.attrs.iconId) attrParts.push(`icon="${escapeAttrValue(panel.attrs.iconId)}"`)
  const out: string[] = [`:::${leafName}{${attrParts.join(' ')}}`]
  const bodyLines = renderNodes(panel.content ?? [], ctx)
  for (const line of bodyLines) out.push(line)
  out.push(':::')
  return out
}

function renderCards(cards: CardData[] | undefined): string[] {
  if (!Array.isArray(cards) || cards.length === 0) return []
  const out: string[] = [':::cards']
  for (const card of cards) {
    const parts: string[] = [`title="${escapeAttrValue(card.title ?? '')}"`]
    if (card.href) parts.push(`href="${escapeAttrValue(card.href)}"`)
    if (card.iconId) parts.push(`icon="${escapeAttrValue(card.iconId)}"`)
    if (card.description) {
      // Description is markdown-lite; we keep it on the attribute line so
      // each card stays a single leaf directive (`::card{...}`). Newlines
      // inside the description are preserved as `\n` literals.
      parts.push(`description="${escapeAttrValue(card.description)}"`)
    }
    out.push(`::card{${parts.join(' ')}}`)
  }
  out.push(':::')
  return out
}

function clampLevel(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' ? value : 1
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

function renderListItem(marker: string, level: number, content: string): string {
  const indent = '  '.repeat(Math.max(0, clampLevel(level, 1, 5) - 1))
  return `${indent}${marker} ${content}`
}

function renderCallout(variant: CalloutVariant | undefined, body: string): string[] {
  const safe = variant && CALLOUT_VARIANTS.has(variant) ? variant : 'info'
  const lines = body.length > 0 ? body.split('\n') : ['']
  return [`:::${safe}`, ...lines, ':::']
}

function renderImage(attrs: BlockAttrs): string {
  const url = typeof attrs.imageUrl === 'string' ? attrs.imageUrl : ''
  const base = `![](${escapeLinkUrl(url)})`
  const trailerParts: string[] = []
  if (typeof attrs.imageWidth === 'number' && attrs.imageWidth !== 400) {
    trailerParts.push(`width=${attrs.imageWidth}`)
  }
  if (typeof attrs.imageAlign === 'string' && attrs.imageAlign !== 'center') {
    trailerParts.push(`align=${attrs.imageAlign}`)
  }
  if (trailerParts.length === 0) return base
  return `${base}{${trailerParts.join(' ')}}`
}

function renderEmbed(attrs: BlockAttrs): string {
  const url = typeof attrs.embedUrl === 'string' ? attrs.embedUrl : ''
  if (!url) return ''
  const parts = [`url="${escapeAttrValue(url)}"`]
  if (typeof attrs.embedProvider === 'string') {
    parts.push(`provider="${attrs.embedProvider}"`)
  }
  if (typeof attrs.embedAspect === 'string' && attrs.embedAspect !== '16:9') {
    parts.push(`aspect="${attrs.embedAspect}"`)
  }
  return `::embed{${parts.join(' ')}}`
}

function escapeAttrValue(value: string): string {
  return value.replace(/"/g, '&quot;')
}

function blockText(content: InlineJSON[] | undefined): string {
  if (!content) return ''
  return content.map((node) => (typeof node.text === 'string' ? node.text : '')).join('')
}

// Re-export for the inline.ts module to share the same escape rules.
export { escapeMarkdownText, escapeLinkUrl }
export type { ImageAlign, EmbedProvider, EmbedAspect }
