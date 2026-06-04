// apps/web/src/components/agents/procedures/nodes/condition-helpers.ts

import { generateId } from '@auxx/utils'
import type { Editor } from '@tiptap/core'
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
    content: [{ type: 'conditionPredicate', content: [] }, emptyBlock()],
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
    attrs: { id: generateId() },
    content: [newConditionCase()],
  }
}
