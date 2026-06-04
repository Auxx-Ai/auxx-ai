// apps/web/src/components/agents/procedures/nodes/condition-predicate-node.ts

import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ConditionPredicateNodeView } from './condition-predicate-node-view'

/**
 * `conditionPredicate` — the natural-language predicate writer for a
 * {@link ConditionCase} in `text` mode (plan §4). `inline*` content so it holds
 * text + inline reference badges (`@` inserts attribute badges). One per arm, the
 * leading child of `conditionCase`. In `structured` mode it stays empty and the
 * arm's `group` attr is the source of truth instead.
 */
export const ConditionPredicate = Node.create({
  name: 'conditionPredicate',
  content: 'inline*',
  defining: true,
  isolating: true,
  marks: '',

  parseHTML() {
    return [{ tag: 'div[data-condition-predicate]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-condition-predicate': '' }, HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ConditionPredicateNodeView)
  },
})
