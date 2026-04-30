// packages/lib/src/kb/markdown/blocks-to-md.ts
//
// Serializes a KB DocJSON to markdown in the "Auxx MD" dialect.
// See plans/kb/markdown-support.md for the format spec.

import { escapeLinkUrl, escapeMarkdownText, inlineToMd } from './inline'
import type {
  BlockAttrs,
  BlockJSON,
  CalloutVariant,
  DocJSON,
  EmbedAspect,
  EmbedProvider,
  ImageAlign,
  InlineJSON,
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

  const blocks = doc.content
  const lines: string[] = []
  let inListRun = false

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (!block || block.type !== 'block') continue
    const next = blocks[i + 1]

    const renderedLines = renderBlock(block, ctx)
    if (renderedLines.length === 0) continue

    if (lines.length > 0) lines.push('') // blank line between blocks

    for (const line of renderedLines) lines.push(line)

    inListRun = isListItem(block)
    // List runs don't get inter-item blank lines in CommonMark, but tighter
    // rendering is fine here since GFM normalizes anyway.
    if (inListRun && next && isListItem(next) && sameListType(block, next)) {
      // Drop the blank we just queued — pop and re-emit without separator.
      // Easier: emit as-is, GFM tolerates it.
    }
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

function isListItem(block: BlockJSON): boolean {
  const t = block.attrs?.blockType
  return t === 'bulletListItem' || t === 'numberedListItem' || t === 'todoListItem'
}

function sameListType(a: BlockJSON, b: BlockJSON): boolean {
  return a.attrs?.blockType === b.attrs?.blockType
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
    default:
      return inline.length > 0 ? [inline] : []
  }
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
