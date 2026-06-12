// apps/web/src/components/editor/blocks/allowed-blocks.ts

import type { JSONContent } from '@tiptap/core'
import type { BlockType } from '../kb-article/block-node'

/**
 * The single source of truth for "which block kinds an editor instance
 * exposes". A flat, context-free union covering every block the schema can
 * hold, in two physical shapes:
 *
 * - **`block`-node attr variants** (`BlockType`: text / heading / lists / quote
 *   / image / divider / codeBlock / callout / embed / cards) — one `block`
 *   node carrying a `blockType` attribute. The `block` node is always mounted;
 *   these are gated at the entry points that *set* the attribute.
 * - **Separate node types** (`table`, `panel`, `tabs`, `accordion`,
 *   `conditionBlock`) — distinct ProseMirror nodes. These are gated at the
 *   schema level: not in the list → not mounted → unreachable from paste,
 *   drag, or programmatic insert.
 *
 * Surfaces state the set they want **positively**, by spreading presets. There
 * is no include/exclude profile — `allowedBlocks={KB_BLOCKS}` etc.
 *
 * Nesting constraints (e.g. no table-in-table) are NOT expressed here — they
 * live in each node's own `content:` expression, where ProseMirror enforces
 * them. This list is deliberately flat: "which kinds exist at all", top-level.
 */
export type EditorBlock =
  | BlockType // text | heading | bulletListItem | … | callout | embed | cards
  | 'table'
  | 'panel'
  | 'tabs'
  | 'accordion'
  | 'conditionBlock'

/** Kinds that are distinct PM nodes (not `block`-node `blockType` attrs). */
const SEPARATE_NODE_KINDS = new Set<EditorBlock>([
  'table',
  'panel',
  'tabs',
  'accordion',
  'conditionBlock',
])

/** True when `kind` is a `block`-node `blockType` attribute variant. */
function isBlockAttrKind(kind: EditorBlock): boolean {
  return !SEPARATE_NODE_KINDS.has(kind)
}

// --- Presets --------------------------------------------------------------

/** Prose-only set — text + headings + lists + quote + divider + code. */
export const PLAIN_PROSE: EditorBlock[] = [
  'text',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'todoListItem',
  'quote',
  'divider',
  'codeBlock',
]

/** Full KB article set — prose plus rich/structural blocks. */
export const KB_BLOCKS: EditorBlock[] = [
  ...PLAIN_PROSE,
  'callout',
  'image',
  'embed',
  'cards',
  'table',
  'panel',
  'tabs',
  'accordion',
]

/** Persona prompt editor — prose only (matches its slash affordances). */
export const PERSONA_BLOCKS: EditorBlock[] = PLAIN_PROSE

/**
 * Procedure canvas — `text` lines, light prose structure (headings, lists)
 * plus the `conditionBlock` IF/ELSE construct. Step "nodes" (tool / code /
 * routing / sub-procedure) are inline badges inserted via `/` (see
 * `ProcedureSlashContent`); references via `@` (`referenceTabs`).
 */
export const PROCEDURE_BLOCKS: EditorBlock[] = [
  'text',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'conditionBlock',
]

/**
 * Default when a surface doesn't restrict — the full KB set (the historical
 * behavior before `allowedBlocks` existed). `conditionBlock` is opt-in only.
 */
export const DEFAULT_BLOCKS: EditorBlock[] = KB_BLOCKS

// --- Helpers --------------------------------------------------------------

const has = (allowed: EditorBlock[], kind: EditorBlock) => allowed.includes(kind)

/** A container node (Tabs/Accordion → `containerBlock` group) is in the set. */
export function allowsContainers(allowed: EditorBlock[]): boolean {
  return has(allowed, 'tabs') || has(allowed, 'accordion') || has(allowed, 'panel')
}
export const allowsTable = (allowed: EditorBlock[]) => has(allowed, 'table')
export const allowsConditions = (allowed: EditorBlock[]) => has(allowed, 'conditionBlock')

/**
 * Build the top-level `doc` content expression from the allowed set. `block`
 * is always present (it carries `text` + every attr variant). `table` is a
 * `group: 'block'` node but PM resolves the bare `block` token to the NODE
 * named `block`, so it must be listed explicitly. `containerBlock` /
 * `procedureBlock` are groups, valid only when ≥1 member node is mounted.
 */
export function docContentExpr(allowed: EditorBlock[]): string {
  const tokens = ['block']
  if (allowsContainers(allowed)) tokens.push('containerBlock')
  if (allowsTable(allowed)) tokens.push('table')
  if (allowsConditions(allowed)) tokens.push('procedureBlock')
  return `(${tokens.join(' | ')})+`
}

/**
 * Coerce a list of pasted block-JSON nodes to fit the allowed set:
 * - `block` nodes whose `blockType` ∉ allowed → reset to plain `text`
 *   (stripping `level`/`checked`/variant attrs), content preserved.
 * - separate-node types (`table`/`tabs`/`accordion`) ∉ allowed → dropped
 *   (they aren't in the restricted schema; PM would reject them anyway).
 * Used by the markdown-paste path so paste follows the same list.
 */
export function coerceBlocks(nodes: JSONContent[], allowed: EditorBlock[]): JSONContent[] {
  const allow = new Set(allowed)
  const out: JSONContent[] = []
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') continue
    const type = node.type as EditorBlock | 'block'
    if (type === 'block') {
      const bt = (node.attrs?.blockType as EditorBlock | undefined) ?? 'text'
      if (isBlockAttrKind(bt) && !allow.has(bt)) {
        out.push({
          ...node,
          attrs: { ...node.attrs, blockType: 'text', level: null, checked: false },
        })
      } else {
        out.push(node)
      }
    } else if (SEPARATE_NODE_KINDS.has(type as EditorBlock)) {
      if (allow.has(type as EditorBlock)) out.push(node)
      // else drop — not in the restricted schema
    } else {
      out.push(node) // unknown / inline content — leave untouched
    }
  }
  return out
}
