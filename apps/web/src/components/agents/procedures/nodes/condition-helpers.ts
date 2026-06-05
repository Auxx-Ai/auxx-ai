// apps/web/src/components/agents/procedures/nodes/condition-helpers.ts

import { generateId } from '@auxx/utils'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { NodeViewProps } from '@tiptap/react'

/** An empty text `block` — the shared body child the arm containers require. */
export function emptyBlock() {
  return { type: 'block', attrs: { blockType: 'text' }, content: [] }
}

/** Resolve the document position of the node this NodeView renders, or null. */
export function nodePos(getPos: NodeViewProps['getPos']): number | null {
  if (typeof getPos !== 'function') return null
  const pos = getPos()
  return typeof pos === 'number' ? pos : null
}

/** Append a child node at the end of the container node at `containerPos`. */
export function appendChild(
  editor: Editor,
  containerPos: number,
  child: Record<string, unknown>
): void {
  const node = editor.state.doc.nodeAt(containerPos)
  if (!node) return
  const insertAt = containerPos + node.nodeSize - 1
  editor.chain().focus().insertContentAt(insertAt, child).run()
}

/** A fresh `conditionCase` arm: empty text predicate (text mode) + one empty body block. */
export function newConditionCase() {
  return {
    type: 'conditionCase',
    attrs: {
      id: generateId(),
      mode: 'text',
      group: { id: generateId(), conditions: [], logicalOperator: 'AND' },
    },
    content: [{ type: 'conditionPredicate', attrs: { mode: 'text' }, content: [] }, emptyBlock()],
  }
}

/** A fresh `conditionElse` arm with one empty body block. */
export function newConditionElse() {
  return { type: 'conditionElse', attrs: { id: generateId() }, content: [emptyBlock()] }
}

/** A fresh `conditionBlock` with a single IF arm — what the `@` Condition picker inserts. */
export function newConditionBlock() {
  return {
    type: 'conditionBlock',
    attrs: { id: generateId(), mode: 'text' },
    content: [newConditionCase()],
  }
}

/** Find the enclosing `conditionBlock` for a `conditionCase` NodeView, or null. */
export function findParentBlock(
  editor: Editor,
  getPos: NodeViewProps['getPos']
): { pos: number; node: ProseMirrorNode } | null {
  const pos = nodePos(getPos)
  if (pos == null) return null
  const $pos = editor.state.doc.resolve(pos)
  for (let d = $pos.depth; d >= 0; d--) {
    const n = $pos.node(d)
    if (n.type.name === 'conditionBlock') return { pos: $pos.before(d), node: n }
  }
  return null
}

/**
 * Set the block-level `mode` on the `conditionBlock` at `blockPos` AND mirror it
 * onto every `conditionCase` child in one transaction (decision D1 — flip one arm
 * → all flip; the block is the compiler's source of truth). `setNodeMarkup`
 * preserves node sizes, so child positions computed off the original node stay
 * valid within the same transaction.
 */
export function applyBlockMode(editor: Editor, blockPos: number, mode: 'text' | 'structured') {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const block = tr.doc.nodeAt(blockPos)
      if (!block) return false
      tr.setNodeMarkup(blockPos, undefined, { ...block.attrs, mode })
      let childPos = blockPos + 1
      block.forEach((child) => {
        if (child.type.name === 'conditionCase') {
          tr.setNodeMarkup(childPos, undefined, { ...child.attrs, mode })
          // Mirror onto the leading predicate child so its node-view re-renders
          // (and hides/shows) on toggle. setNodeMarkup preserves sizes, so these
          // positions stay valid within this transaction.
          let grandPos = childPos + 1
          child.forEach((grandchild) => {
            if (grandchild.type.name === 'conditionPredicate') {
              tr.setNodeMarkup(grandPos, undefined, { ...grandchild.attrs, mode })
            }
            grandPos += grandchild.nodeSize
          })
        }
        childPos += child.nodeSize
      })
      return true
    })
    .run()
}

/**
 * Whether switching the block to `targetMode` would leave authored data unused —
 * the populated representation of the CURRENT mode (text predicates when leaving
 * text; group conditions when leaving structured). Drives the confirm-on-switch.
 */
export function switchLosesData(
  block: ProseMirrorNode,
  targetMode: 'text' | 'structured'
): boolean {
  let lose = false
  block.forEach((child) => {
    if (child.type.name !== 'conditionCase') return
    if (targetMode === 'structured') {
      // leaving text → check whether any predicate writer has content.
      child.forEach((c) => {
        if (c.type.name === 'conditionPredicate' && c.content.size > 0) lose = true
      })
    } else {
      const group = child.attrs.group as { conditions?: unknown[] } | null
      if (group?.conditions && group.conditions.length > 0) lose = true
    }
  })
  return lose
}
