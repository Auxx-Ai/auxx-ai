// apps/web/src/components/editor/kb-article/markdown-input-rules.ts

import { Extension, InputRule } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { DEFAULT_BLOCKS, type EditorBlock } from '../blocks/allowed-blocks'
import type { BlockType } from './block-node'

interface BlockSpec {
  blockType: BlockType
  level?: number | null
  checked?: boolean
}

export interface MarkdownInputRulesOptions {
  /** Block kinds this editor allows. Rules that produce a disallowed kind are skipped. */
  allowed: EditorBlock[]
}

/**
 * Markdown-style typing shortcuts for the KB editor. Each rule fires when
 * the user types its trigger at the start of an empty (or to-be-converted)
 * `text` block, and switches that block's `blockType` in place.
 *
 * Rules only apply when the block is currently a plain `text` block — we
 * don't auto-convert headings into lists mid-stream. To revert, the user
 * can hit Backspace immediately after typing (Tiptap default).
 *
 * A rule is only registered when its target kind is in `options.allowed`, so
 * a restricted surface (e.g. procedures, `allowed: ['text', 'conditionBlock']`)
 * gets no block-producing shortcuts at all.
 */
export const MarkdownInputRules = Extension.create<MarkdownInputRulesOptions>({
  name: 'markdown-input-rules',

  addOptions() {
    return { allowed: DEFAULT_BLOCKS }
  },

  addInputRules() {
    const allow = new Set(this.options.allowed)
    const rules: InputRule[] = []
    if (allow.has('heading')) {
      rules.push(headingRule(/^#\s$/, 1), headingRule(/^##\s$/, 2), headingRule(/^###\s$/, 3))
    }
    if (allow.has('bulletListItem')) {
      rules.push(blockRule(/^[-*]\s$/, { blockType: 'bulletListItem', level: 1 }))
    }
    if (allow.has('numberedListItem')) {
      rules.push(blockRule(/^1\.\s$/, { blockType: 'numberedListItem', level: 1 }))
    }
    if (allow.has('todoListItem')) {
      rules.push(
        blockRule(/^\[\s?\]\s$/, { blockType: 'todoListItem', checked: false, level: 1 }),
        blockRule(/^\[x\]\s$/i, { blockType: 'todoListItem', checked: true, level: 1 })
      )
    }
    if (allow.has('quote')) rules.push(blockRule(/^>\s$/, { blockType: 'quote' }))
    if (allow.has('codeBlock')) rules.push(blockRule(/^```$/, { blockType: 'codeBlock' }))
    if (allow.has('divider')) rules.push(dividerRule())
    return rules
  },
})

function headingRule(find: RegExp, level: number): InputRule {
  return blockRule(find, { blockType: 'heading', level })
}

function blockRule(find: RegExp, spec: BlockSpec): InputRule {
  return new InputRule({
    find,
    handler: ({ state, range, chain }) => {
      const $from = state.doc.resolve(range.from)
      const block = findEnclosingBlock($from)
      if (!block || block.attrs.blockType !== 'text') return null

      // Only fire at the very start of the block.
      if ($from.parentOffset !== 0) return null

      const attrs: Record<string, unknown> = {
        blockType: spec.blockType,
        level: spec.level ?? null,
      }
      if (spec.blockType === 'todoListItem') attrs.checked = spec.checked ?? false

      chain().deleteRange({ from: range.from, to: range.to }).updateAttributes('block', attrs).run()
      return null
    },
  })
}

/**
 * `---` on its own line converts the current block to a divider and splits
 * a fresh text block below for the user to keep typing.
 */
function dividerRule(): InputRule {
  return new InputRule({
    find: /^---$/,
    handler: ({ state, range, chain }) => {
      const $from = state.doc.resolve(range.from)
      const block = findEnclosingBlock($from)
      if (!block || block.attrs.blockType !== 'text') return null
      if ($from.parentOffset !== 0) return null

      chain()
        .deleteRange({ from: range.from, to: range.to })
        .updateAttributes('block', { blockType: 'divider', level: null, checked: false })
        .splitBlock()
        .updateAttributes('block', { blockType: 'text', level: null, checked: false })
        .run()
      return null
    },
  })
}

function findEnclosingBlock($pos: ResolvedPos): PMNode | null {
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth)
    if (node?.type?.name === 'block') return node
  }
  return null
}
