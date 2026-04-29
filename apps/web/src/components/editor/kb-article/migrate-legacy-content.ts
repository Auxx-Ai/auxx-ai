// apps/web/src/components/editor/kb-article/migrate-legacy-content.ts

import type { JSONContent } from '@tiptap/core'
import type { BlockType } from './block-node'

/**
 * Convert legacy novel/StarterKit-style ProseMirror JSON (paragraph, heading,
 * bulletList, codeBlock, …) to the new block-editor schema (a single `block`
 * node with a `blockType` attribute).
 *
 * Returns the input unchanged when no legacy nodes are detected, so editor
 * round-trips on already-migrated content are zero-cost.
 */
export function migrateLegacyContent(input: JSONContent | null | undefined): JSONContent | null {
  if (!input) return null
  if (input.type !== 'doc') return input
  if (!hasLegacyNodes(input)) return input

  const blocks: JSONContent[] = []
  for (const child of input.content ?? []) {
    appendAsBlocks(child, blocks, 1)
  }

  if (blocks.length === 0) {
    blocks.push(makeBlock('text', [], { level: null }))
  }

  return { type: 'doc', content: blocks }
}

const LEGACY_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'image',
  'columnBlock',
  'column',
])

function hasLegacyNodes(node: JSONContent): boolean {
  if (node.type && LEGACY_NODE_TYPES.has(node.type)) return true
  for (const child of node.content ?? []) {
    if (hasLegacyNodes(child)) return true
  }
  return false
}

function appendAsBlocks(node: JSONContent, out: JSONContent[], level: number): void {
  switch (node.type) {
    case 'block':
    case 'table':
      out.push(node)
      return

    case 'paragraph':
      out.push(makeBlock('text', node.content ?? [], { level: null }))
      return

    case 'heading': {
      const lvl = clampHeading(node.attrs?.level)
      out.push(makeBlock('heading', node.content ?? [], { level: lvl }))
      return
    }

    case 'blockquote': {
      const inline = collectInline(node)
      out.push(makeBlock('quote', inline, { level: null }))
      return
    }

    case 'codeBlock': {
      const inline = collectInline(node)
      out.push(makeBlock('codeBlock', inline, { level: null }))
      return
    }

    case 'horizontalRule':
      out.push(makeBlock('divider', [], { level: null }))
      return

    case 'image': {
      const url = node.attrs?.src ?? null
      out.push({
        type: 'block',
        attrs: { blockType: 'image', imageUrl: url, level: null },
        content: [],
      })
      return
    }

    case 'bulletList':
    case 'orderedList': {
      const blockType: BlockType =
        node.type === 'orderedList' ? 'numberedListItem' : 'bulletListItem'
      for (const item of node.content ?? []) {
        appendListItem(item, blockType, level, out)
      }
      return
    }

    case 'taskList': {
      for (const item of node.content ?? []) {
        appendTaskItem(item, level, out)
      }
      return
    }

    case 'columnBlock':
    case 'column': {
      // Flatten — columns aren't supported by the new editor.
      for (const child of node.content ?? []) {
        appendAsBlocks(child, out, level)
      }
      return
    }

    default: {
      // Unknown / unsupported top-level node — drop into a text block if it has
      // any inline content, otherwise skip.
      const inline = collectInline(node)
      if (inline.length > 0) {
        out.push(makeBlock('text', inline, { level: null }))
      }
    }
  }
}

function appendListItem(
  item: JSONContent,
  blockType: BlockType,
  level: number,
  out: JSONContent[]
): void {
  if (item.type !== 'listItem') return
  let firstParagraph = true
  for (const child of item.content ?? []) {
    if (child.type === 'paragraph') {
      if (firstParagraph) {
        out.push(makeBlock(blockType, child.content ?? [], { level }))
        firstParagraph = false
      } else {
        // Subsequent paragraphs in the same list item — render as plain text
        // blocks at the same level (closest match in the flat schema).
        out.push(makeBlock('text', child.content ?? [], { level: null }))
      }
    } else if (child.type === 'bulletList' || child.type === 'orderedList') {
      const childType: BlockType =
        child.type === 'orderedList' ? 'numberedListItem' : 'bulletListItem'
      for (const sub of child.content ?? []) {
        appendListItem(sub, childType, Math.min(level + 1, 5), out)
      }
    } else {
      appendAsBlocks(child, out, level)
    }
  }
}

function appendTaskItem(item: JSONContent, level: number, out: JSONContent[]): void {
  if (item.type !== 'taskItem') return
  const checked = item.attrs?.checked === true
  let firstParagraph = true
  for (const child of item.content ?? []) {
    if (child.type === 'paragraph') {
      if (firstParagraph) {
        out.push({
          type: 'block',
          attrs: { blockType: 'todoListItem', checked, level },
          content: child.content ?? [],
        })
        firstParagraph = false
      } else {
        out.push(makeBlock('text', child.content ?? [], { level: null }))
      }
    } else if (child.type === 'taskList') {
      for (const sub of child.content ?? []) {
        appendTaskItem(sub, Math.min(level + 1, 5), out)
      }
    } else {
      appendAsBlocks(child, out, level)
    }
  }
}

function collectInline(node: JSONContent): JSONContent[] {
  const out: JSONContent[] = []
  walk(node, out)
  return out
}

function walk(node: JSONContent, out: JSONContent[]): void {
  if (!node.content) {
    if (node.type === 'text' || node.type === 'hardBreak') out.push(node)
    return
  }
  for (const child of node.content) {
    if (child.type === 'text' || child.type === 'hardBreak') {
      out.push(child)
    } else if (child.content) {
      walk(child, out)
    }
  }
}

function makeBlock(
  blockType: BlockType,
  content: JSONContent[],
  attrs: { level: number | null }
): JSONContent {
  return {
    type: 'block',
    attrs: { blockType, level: attrs.level },
    content,
  }
}

function clampHeading(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? '1'), 10)
  if (!Number.isFinite(n)) return 1
  return Math.min(3, Math.max(1, Math.trunc(n)))
}
