// packages/lib/src/kb/markdown/md-to-blocks.ts
//
// Parses markdown (Auxx MD dialect — GFM + remark-directive) into the KB
// editor's BlockJSON shape. See plans/kb/markdown-support.md for the spec.

import { generateId } from '@auxx/utils'
import remarkDirective from 'remark-directive'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type {
  AccordionJSON,
  ArticleNodeJSON,
  BlockAttrs,
  BlockJSON,
  BlockType,
  CalloutVariant,
  CardData,
  DocJSON,
  EmbedAspect,
  EmbedProvider,
  ImageAlign,
  InlineJSON,
  MarkJSON,
  PanelJSON,
  TabsJSON,
} from './types'
import { CALLOUT_VARIANTS, EMBED_ASPECTS, EMBED_PROVIDERS, IMAGE_ALIGNS } from './types'

const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_.-]+)\}\}/g
const IMAGE_ATTR_TRAILER_RE = /^\{([^{}\n]*)\}/
const HEADING_MAX_LEVEL = 3

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective)

export function mdToBlocks(markdown: string): DocJSON {
  const cleaned = stripFrontmatter(markdown ?? '')
  if (!cleaned.trim()) return emptyDoc()

  const tree = parser.parse(cleaned) as MdastRoot
  const ctx: ParseCtx = { nodes: [] }
  // Buffer for consecutive `<details>` HTML siblings so we can merge them
  // into a single accordion block (Q6d).
  let detailsBuffer: PanelJSON[] | null = null
  const flushDetails = () => {
    if (!detailsBuffer || detailsBuffer.length === 0) return
    const accordion: AccordionJSON = {
      type: 'accordion',
      attrs: { allowMultiple: true },
      content: detailsBuffer,
    }
    ctx.nodes.push(accordion)
    detailsBuffer = null
  }
  for (const child of tree.children ?? []) {
    if (child.type === 'html' && typeof child.value === 'string') {
      const panel = tryParseDetailsHtml(child.value)
      if (panel) {
        if (!detailsBuffer) detailsBuffer = []
        detailsBuffer.push(panel)
        continue
      }
    }
    flushDetails()
    walkBlock(child, ctx, 1)
  }
  flushDetails()
  if (ctx.nodes.length === 0) return emptyDoc()
  return { type: 'doc', content: ctx.nodes }
}

interface ParseCtx {
  nodes: ArticleNodeJSON[]
}

function emptyDoc(): DocJSON {
  return {
    type: 'doc',
    content: [{ type: 'block', attrs: { blockType: 'text' }, content: [] }],
  }
}

// ─── frontmatter ─────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export interface FrontmatterFields {
  title?: string
  slug?: string
  description?: string
}

export function parseFrontmatter(markdown: string): {
  body: string
  fields: FrontmatterFields
} {
  const m = (markdown ?? '').match(FRONTMATTER_RE)
  if (!m) return { body: markdown ?? '', fields: {} }
  const body = (markdown ?? '').slice(m[0].length)
  const fields: FrontmatterFields = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.*)$/)
    if (!kv) continue
    const key = kv[1].toLowerCase()
    const value = trimYamlValue(kv[2])
    if (key === 'title') fields.title = value
    else if (key === 'slug') fields.slug = value
    else if (key === 'description') fields.description = value
  }
  return { body, fields }
}

function stripFrontmatter(markdown: string): string {
  return parseFrontmatter(markdown).body
}

function trimYamlValue(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

// ─── block walker ────────────────────────────────────────────────────

interface MdastNode {
  type: string
  children?: MdastNode[]
  value?: string
  url?: string
  alt?: string
  depth?: number
  ordered?: boolean
  checked?: boolean | null
  lang?: string | null
  name?: string
  attributes?: Record<string, string | null | undefined>
}

interface MdastRoot extends MdastNode {
  children: MdastNode[]
}

function walkBlock(node: MdastNode, ctx: ParseCtx, level: number): void {
  switch (node.type) {
    case 'heading': {
      const depth = clamp(node.depth ?? 1, 1, HEADING_MAX_LEVEL)
      pushBlock(ctx, 'heading', inlineFrom(node.children), { level: depth })
      return
    }
    case 'paragraph': {
      const inline = inlineFrom(node.children)
      // A paragraph that's only an embed-y URL becomes an embed block.
      const embed = paragraphAsEmbed(node.children)
      if (embed) {
        pushBlock(ctx, 'embed', [], embed)
        return
      }
      // A paragraph that's only an image (or image + attr trailer) becomes
      // an image block.
      const image = paragraphAsImage(node.children)
      if (image) {
        pushBlock(ctx, 'image', [], image)
        return
      }
      pushBlock(ctx, 'text', inline, {})
      return
    }
    case 'blockquote': {
      // Render each child block as a quote — for multi-paragraph quotes
      // we end up with multiple sibling quote blocks (closest match in the
      // flat schema, mirrors migrate-legacy-content behavior).
      for (const child of node.children ?? []) {
        if (child.type === 'paragraph') {
          pushBlock(ctx, 'quote', inlineFrom(child.children), {})
        } else {
          walkBlock(child, ctx, level)
        }
      }
      return
    }
    case 'code': {
      const lang = typeof node.lang === 'string' ? node.lang : 'plaintext'
      const text = node.value ?? ''
      pushBlock(ctx, 'codeBlock', [{ type: 'text', text }], { codeLanguage: lang })
      return
    }
    case 'thematicBreak':
      pushBlock(ctx, 'divider', [], {})
      return
    case 'list':
      walkList(node, ctx, level)
      return
    case 'table':
      walkTable(node, ctx)
      return
    case 'containerDirective': {
      const variant = pickCalloutVariant(node.name)
      if (variant) {
        // Concatenate child paragraphs into a single callout block (we
        // don't model multi-paragraph callouts).
        const inline: InlineJSON[] = []
        for (const child of node.children ?? []) {
          if (child.type === 'paragraph') {
            if (inline.length > 0) inline.push({ type: 'hardBreak' })
            inline.push(...inlineFrom(child.children))
          }
        }
        pushBlock(ctx, 'callout', inline, { calloutVariant: variant })
        return
      }
      if (node.name === 'cards') {
        const cards = parseCardsContainer(node)
        if (cards.length > 0) pushBlock(ctx, 'cards', [], { cards })
        return
      }
      if (node.name === 'tabs') {
        const tabs = parseTabsContainer(node)
        if (tabs) ctx.nodes.push(tabs)
        return
      }
      if (node.name === 'accordion') {
        const accordion = parseAccordionContainer(node)
        if (accordion) ctx.nodes.push(accordion)
        return
      }
      // Unknown container — flatten its children.
      for (const child of node.children ?? []) walkBlock(child, ctx, level)
      return
    }
    case 'leafDirective': {
      if (node.name === 'embed') {
        const attrs = directiveEmbedAttrs(node.attributes)
        if (attrs?.embedUrl) {
          pushBlock(ctx, 'embed', [], attrs)
          return
        }
      }
      // Fall through: drop unknown leaf directives.
      return
    }
    case 'html': {
      // Best-effort: surface raw HTML as plain text. We don't run an HTML
      // parser here; the editor's clipboard-text path is for markdown.
      const text = (node.value ?? '').replace(/<[^>]+>/g, '').trim()
      if (text) pushBlock(ctx, 'text', [{ type: 'text', text }], {})
      return
    }
    default:
      // Unknown block — try to extract inline text.
      if (node.children?.length) {
        const inline = inlineFrom(node.children)
        if (inline.length > 0) pushBlock(ctx, 'text', inline, {})
      }
  }
}

function walkList(node: MdastNode, ctx: ParseCtx, level: number): void {
  const items = (node.children ?? []).filter((c) => c.type === 'listItem')
  const ordered = node.ordered === true

  for (const item of items) {
    const isTask = item.checked === true || item.checked === false
    const checked = item.checked === true
    let firstParagraph = true

    for (const child of item.children ?? []) {
      if (child.type === 'paragraph') {
        if (firstParagraph) {
          if (isTask) {
            pushBlock(ctx, 'todoListItem', inlineFrom(child.children), {
              checked,
              level,
            })
          } else {
            const blockType: BlockType = ordered ? 'numberedListItem' : 'bulletListItem'
            pushBlock(ctx, blockType, inlineFrom(child.children), { level })
          }
          firstParagraph = false
        } else {
          // Continuation paragraph — flatten as a text block.
          pushBlock(ctx, 'text', inlineFrom(child.children), {})
        }
      } else if (child.type === 'list') {
        walkList(child, ctx, Math.min(level + 1, 5))
      } else {
        walkBlock(child, ctx, level)
      }
    }
  }
}

function walkTable(node: MdastNode, ctx: ParseCtx): void {
  // Tables are deferred from the renderer (Tier 1 plan). Capture the
  // markdown source as a fenced plaintext block so authors don't lose
  // content silently.
  const lines = renderTableAsMd(node)
  if (lines.length === 0) return
  pushBlock(ctx, 'codeBlock', [{ type: 'text', text: lines.join('\n') }], {
    codeLanguage: 'plaintext',
  })
}

function renderTableAsMd(table: MdastNode): string[] {
  const rows = (table.children ?? []).filter((c) => c.type === 'tableRow')
  if (rows.length === 0) return []
  const renderedRows = rows.map((row) =>
    (row.children ?? [])
      .filter((c) => c.type === 'tableCell')
      .map((cell) => textOnly(cell.children).trim() || ' ')
  )
  if (renderedRows.length === 0) return []
  const widths = renderedRows[0].map((_, i) =>
    Math.max(...renderedRows.map((r) => (r[i]?.length ?? 0) || 1))
  )
  const out: string[] = []
  out.push('| ' + renderedRows[0].map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |')
  out.push('| ' + widths.map((w) => '-'.repeat(Math.max(3, w))).join(' | ') + ' |')
  for (let i = 1; i < renderedRows.length; i++) {
    out.push('| ' + renderedRows[i].map((c, j) => c.padEnd(widths[j])).join(' | ') + ' |')
  }
  return out
}

// ─── inline walker ───────────────────────────────────────────────────

function inlineFrom(children: MdastNode[] | undefined): InlineJSON[] {
  if (!children || children.length === 0) return []
  const out: InlineJSON[] = []
  // Stateful HTML-tag stack so we can fold <u>...</u> across sibling
  // mdast nodes (remark-parse emits the open and close tags as separate
  // `html` nodes around the inner text).
  const htmlMarks: MarkJSON[] = []
  for (const child of children) {
    if (child.type === 'html' && typeof child.value === 'string') {
      const value = child.value.trim()
      if (/^<u>$/i.test(value)) {
        htmlMarks.push({ type: 'underline' })
        continue
      }
      if (/^<\/u>$/i.test(value)) {
        const idx = htmlMarks.findLastIndex((m) => m.type === 'underline')
        if (idx >= 0) htmlMarks.splice(idx, 1)
        continue
      }
    }
    walkInline(child, htmlMarks, out)
  }
  return mergeInline(out)
}

function walkInline(node: MdastNode, marks: MarkJSON[], out: InlineJSON[]): void {
  switch (node.type) {
    case 'text': {
      pushTextSplit(node.value ?? '', marks, out)
      return
    }
    case 'inlineCode': {
      // The `code` mark is exclusive in the standard PM schema — combining
      // it with bold/italic/etc. throws "Invalid collection of marks". Emit
      // code as a solo mark, dropping any inherited formatting.
      out.push(makeText(node.value ?? '', [{ type: 'code' }]))
      return
    }
    case 'strong': {
      for (const c of node.children ?? []) walkInline(c, addMark(marks, { type: 'bold' }), out)
      return
    }
    case 'emphasis': {
      for (const c of node.children ?? []) walkInline(c, addMark(marks, { type: 'italic' }), out)
      return
    }
    case 'delete': {
      for (const c of node.children ?? []) walkInline(c, addMark(marks, { type: 'strike' }), out)
      return
    }
    case 'link': {
      const linkMark: MarkJSON = { type: 'link', attrs: { href: node.url ?? '' } }
      for (const c of node.children ?? []) walkInline(c, addMark(marks, linkMark), out)
      return
    }
    case 'image': {
      // Inline image inside text — surface as a link to keep the data.
      const text = (node.alt ?? '').trim() || node.url || ''
      const linkMark: MarkJSON = { type: 'link', attrs: { href: node.url ?? '' } }
      out.push(makeText(text, addMark(marks, linkMark)))
      return
    }
    case 'break':
      out.push({ type: 'hardBreak' })
      return
    case 'html': {
      // Recognize <u>...</u> as an underline mark.
      const value = node.value ?? ''
      const m = value.match(/^<u>(.*)<\/u>$/i)
      if (m) {
        out.push(makeText(m[1], addMark(marks, { type: 'underline' })))
        return
      }
      // Otherwise drop tags, keep text.
      const stripped = value.replace(/<[^>]+>/g, '')
      if (stripped) pushTextSplit(stripped, marks, out)
      return
    }
    case 'textDirective':
    case 'leafDirective': {
      // Inline directives — surface as plain text fallback.
      const inner = textOnly(node.children)
      if (inner) pushTextSplit(inner, marks, out)
      return
    }
    default: {
      const inner = textOnly(node.children)
      if (inner) pushTextSplit(inner, marks, out)
    }
  }
}

function pushTextSplit(text: string, marks: MarkJSON[], out: InlineJSON[]): void {
  if (!text) return
  // Split out {{placeholder}} segments.
  let lastIndex = 0
  const re = new RegExp(PLACEHOLDER_RE.source, 'g')
  let match: RegExpExecArray | null = re.exec(text)
  while (match) {
    if (match.index > lastIndex) {
      out.push(makeText(text.slice(lastIndex, match.index), marks))
    }
    out.push({ type: 'placeholder', attrs: { id: match[1] } })
    lastIndex = match.index + match[0].length
    match = re.exec(text)
  }
  if (lastIndex < text.length) {
    out.push(makeText(text.slice(lastIndex), marks))
  }
}

function makeText(text: string, marks: MarkJSON[]): InlineJSON {
  const node: InlineJSON = { type: 'text', text }
  const sanitized = sanitizeMarks(marks)
  if (sanitized.length > 0) node.marks = sanitized
  return node
}

/**
 * Enforce the editor schema's mark exclusivity rules. The `code` mark in
 * the standard PM schema excludes every other mark — combining it throws
 * "Invalid collection of marks for node text" in `insertContent`. Strip
 * other marks when code is present, no matter how they accumulated.
 */
function sanitizeMarks(marks: MarkJSON[]): MarkJSON[] {
  if (marks.length === 0) return marks
  if (marks.some((m) => m.type === 'code')) return [{ type: 'code' }]
  return marks.slice()
}

function addMark(marks: MarkJSON[], mark: MarkJSON): MarkJSON[] {
  if (marks.some((m) => m.type === mark.type && sameAttrs(m.attrs, mark.attrs))) return marks
  return [...marks, mark]
}

function sameAttrs(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined) {
  if (!a && !b) return true
  if (!a || !b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}

function mergeInline(nodes: InlineJSON[]): InlineJSON[] {
  const out: InlineJSON[] = []
  for (const node of nodes) {
    const last = out[out.length - 1]
    if (
      last &&
      last.type === 'text' &&
      node.type === 'text' &&
      sameMarks(last.marks, node.marks) &&
      typeof last.text === 'string' &&
      typeof node.text === 'string'
    ) {
      last.text += node.text
      continue
    }
    out.push(node)
  }
  return out
}

function sameMarks(a: MarkJSON[] | undefined, b: MarkJSON[] | undefined) {
  if (!a && !b) return true
  if (!a || !b) return a?.length === 0 && b == null ? true : (a == null && b?.length === 0) || false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type) return false
    if (!sameAttrs(a[i].attrs, b[i].attrs)) return false
  }
  return true
}

function textOnly(children: MdastNode[] | undefined): string {
  if (!children) return ''
  return children
    .map((c) => {
      if (typeof c.value === 'string') return c.value
      return textOnly(c.children)
    })
    .join('')
}

// ─── special-paragraph helpers ───────────────────────────────────────

function paragraphAsEmbed(children: MdastNode[] | undefined): Partial<BlockAttrs> | null {
  if (!children || children.length === 0) return null
  if (children.length !== 1) return null
  const only = children[0]
  // Bare URL on its own line (autolink → link node, plain link → also link).
  if (only.type === 'link' && typeof only.url === 'string') {
    const provider = sniffProvider(only.url)
    if (provider) return { embedUrl: only.url, embedProvider: provider }
  }
  if (only.type === 'text' && typeof only.value === 'string') {
    const url = only.value.trim()
    const provider = sniffProvider(url)
    if (provider) return { embedUrl: url, embedProvider: provider }
  }
  return null
}

function paragraphAsImage(children: MdastNode[] | undefined): Partial<BlockAttrs> | null {
  if (!children || children.length === 0) return null
  const first = children[0]
  if (first?.type !== 'image') return null
  if (typeof first.url !== 'string' || first.url.length === 0) return null

  const result: Partial<BlockAttrs> = { imageUrl: first.url }
  // Look for an attribute trailer in the next text child.
  const next = children[1]
  if (next?.type === 'text' && typeof next.value === 'string') {
    const m = next.value.match(IMAGE_ATTR_TRAILER_RE)
    if (m) {
      Object.assign(result, parseImageTrailer(m[1]))
      const remainder = next.value.slice(m[0].length).trim()
      if (remainder.length > 0) return null // image + extra text → not just an image
    }
  }
  // Reject if there's any non-trailer content.
  for (let i = 1; i < children.length; i++) {
    const c = children[i]
    if (i === 1 && c.type === 'text' && typeof c.value === 'string') {
      const stripped = c.value.replace(IMAGE_ATTR_TRAILER_RE, '').trim()
      if (stripped.length > 0) return null
      continue
    }
    return null
  }
  return result
}

function parseImageTrailer(body: string): Partial<BlockAttrs> {
  const out: Partial<BlockAttrs> = {}
  for (const part of body.split(/\s+/)) {
    const kv = part.match(/^([a-z]+)=(.+)$/i)
    if (!kv) continue
    const key = kv[1].toLowerCase()
    const value = stripQuotes(kv[2])
    if (key === 'width') {
      const n = Number.parseInt(value, 10)
      if (Number.isFinite(n) && n > 0) out.imageWidth = n
    } else if (key === 'align') {
      if (IMAGE_ALIGNS.has(value as ImageAlign)) out.imageAlign = value as ImageAlign
    }
  }
  return out
}

// ─── directive helpers ───────────────────────────────────────────────

function parseCardsContainer(container: MdastNode): CardData[] {
  const out: CardData[] = []
  // Each child can come through as a leafDirective (single-line `::card{...}`)
  // or — if remark-directive wrapped the line into a paragraph — a paragraph
  // whose only child is a textDirective. Walk both.
  const walk = (nodes: MdastNode[] | undefined) => {
    if (!nodes) return
    for (const child of nodes) {
      if (
        (child.type === 'leafDirective' || child.type === 'containerDirective') &&
        child.name === 'card'
      ) {
        out.push(buildCardFromDirective(child))
        continue
      }
      if (child.type === 'paragraph' && Array.isArray(child.children)) {
        walk(child.children)
      }
    }
  }
  walk(container.children)
  return out
}

function buildCardFromDirective(node: MdastNode): CardData {
  const attrs = node.attributes ?? {}
  return {
    id: generateId(),
    title: typeof attrs.title === 'string' ? attrs.title : '',
    href: typeof attrs.href === 'string' && attrs.href ? attrs.href : undefined,
    iconId: typeof attrs.icon === 'string' && attrs.icon ? attrs.icon : undefined,
    description:
      typeof attrs.description === 'string' && attrs.description ? attrs.description : undefined,
  }
}

function pickCalloutVariant(name: string | undefined): CalloutVariant | null {
  if (!name) return null
  const lower = name.toLowerCase()
  if (CALLOUT_VARIANTS.has(lower as CalloutVariant)) return lower as CalloutVariant
  // Common GFM-alert aliases.
  if (lower === 'note' || lower === 'important') return 'info'
  if (lower === 'warning' || lower === 'caution') return 'warn'
  if (lower === 'danger') return 'error'
  return null
}

function directiveEmbedAttrs(
  attributes: Record<string, string | null | undefined> | undefined
): Partial<BlockAttrs> | null {
  if (!attributes) return null
  const url = typeof attributes.url === 'string' ? attributes.url : null
  if (!url) return null
  const out: Partial<BlockAttrs> = { embedUrl: url }
  const provider =
    typeof attributes.provider === 'string' ? attributes.provider.toLowerCase() : sniffProvider(url)
  if (provider && EMBED_PROVIDERS.has(provider as EmbedProvider)) {
    out.embedProvider = provider as EmbedProvider
  }
  const aspect = typeof attributes.aspect === 'string' ? attributes.aspect : ''
  if (EMBED_ASPECTS.has(aspect as EmbedAspect)) out.embedAspect = aspect as EmbedAspect
  return out
}

function sniffProvider(rawUrl: string): EmbedProvider | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') return 'youtube'
  if (host === 'loom.com') return 'loom'
  if (host === 'vimeo.com' || host === 'player.vimeo.com') return 'vimeo'
  return null
}

// ─── helpers ─────────────────────────────────────────────────────────

function pushBlock(
  ctx: ParseCtx,
  blockType: BlockType,
  content: InlineJSON[],
  attrs: Partial<BlockAttrs>
): void {
  const merged: BlockAttrs = { blockType, ...attrs }
  ctx.nodes.push({ type: 'block', attrs: merged, content })
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

// ─── tabs / accordion containers ─────────────────────────────────────

function parseTabsContainer(node: MdastNode): TabsJSON | null {
  const panels = parsePanelChildren(node, 'tab')
  if (panels.length === 0) return null
  return { type: 'tabs', attrs: { activeTab: null }, content: panels }
}

function parseAccordionContainer(node: MdastNode): AccordionJSON | null {
  const panels = parsePanelChildren(node, 'item')
  if (panels.length === 0) return null
  const attrs = node.attributes ?? {}
  const allowMultiple =
    typeof attrs.multiple === 'string' ? attrs.multiple.toLowerCase() !== 'false' : true
  return { type: 'accordion', attrs: { allowMultiple }, content: panels }
}

function parsePanelChildren(container: MdastNode, leafName: 'tab' | 'item'): PanelJSON[] {
  const out: PanelJSON[] = []
  for (const child of container.children ?? []) {
    if (
      (child.type === 'containerDirective' || child.type === 'leafDirective') &&
      child.name === leafName
    ) {
      out.push(buildPanelFromDirective(child))
    }
  }
  return out
}

function buildPanelFromDirective(node: MdastNode): PanelJSON {
  const attrs = node.attributes ?? {}
  const label = typeof attrs.label === 'string' ? attrs.label : ''
  const iconId = typeof attrs.icon === 'string' && attrs.icon ? attrs.icon : undefined
  // Re-walk the panel body using a fresh ctx; only flat blocks are valid
  // here (Q1c — containers can't nest in panels). Any container nodes
  // emitted by walkBlock would violate the schema; we drop them.
  const subCtx: ParseCtx = { nodes: [] }
  for (const child of node.children ?? []) {
    walkBlock(child, subCtx, 1)
  }
  const content: BlockJSON[] = subCtx.nodes.filter((n): n is BlockJSON => n.type === 'block')
  if (content.length === 0) {
    content.push({ type: 'block', attrs: { blockType: 'text' }, content: [] })
  }
  return {
    type: 'panel',
    attrs: { id: generateId(), label, iconId },
    content,
  }
}

// ─── <details> import alias (Q6d) ────────────────────────────────────

const DETAILS_OPEN_RE = /<details(?:\s[^>]*)?>/i
const DETAILS_CLOSE_RE = /<\/details>/i
const SUMMARY_RE = /<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>/i

function tryParseDetailsHtml(raw: string): PanelJSON | null {
  const value = (raw ?? '').trim()
  if (!DETAILS_OPEN_RE.test(value)) return null
  if (!DETAILS_CLOSE_RE.test(value)) return null
  // Strip outer <details>...</details>.
  const inner = value.replace(DETAILS_OPEN_RE, '').replace(DETAILS_CLOSE_RE, '').trim()
  const summaryMatch = inner.match(SUMMARY_RE)
  const label = summaryMatch ? summaryMatch[1].replace(/<[^>]+>/g, '').trim() : 'Details'
  const body = inner.replace(SUMMARY_RE, '').trim()
  // Re-parse the body as markdown so embedded markdown lists / paragraphs
  // produce real blocks.
  let panelContent: BlockJSON[] = []
  if (body) {
    const sub = mdToBlocks(body)
    panelContent = sub.content.filter((n): n is BlockJSON => n.type === 'block')
  }
  if (panelContent.length === 0) {
    panelContent = [{ type: 'block', attrs: { blockType: 'text' }, content: [] }]
  }
  return {
    type: 'panel',
    attrs: { id: generateId(), label },
    content: panelContent,
  }
}
