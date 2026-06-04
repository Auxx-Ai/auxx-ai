// apps/web/src/components/agents/procedures/nodes/condition-block-node.ts

import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ConditionBlockNodeView } from './condition-block-node-view'

/**
 * `conditionBlock` — a v9 procedure IF / ELSE-IF / ELSE construct. Container
 * whose children are a fixed set of arm nodes; the compiler reads the arm order
 * (first `conditionCase` → IF, subsequent → ELSE IF, `conditionElse` → ELSE) and
 * each case's single `ConditionGroup`. Mirrors `tabs-node.ts` (a container with a
 * fixed child type). The two child node NAMES are listed explicitly in `content`
 * because PM resolves bare tokens to node names before groups.
 *
 * See plans/chat/v9/phase-2-authoring.md §1.1 and phase-0 §3.
 */
export const ConditionBlock = Node.create({
  name: 'conditionBlock',
  group: 'procedureBlock',
  content: '(conditionCase | conditionElse)+',
  defining: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-condition-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-condition-block': '' }, HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ConditionBlockNodeView)
  },
})
