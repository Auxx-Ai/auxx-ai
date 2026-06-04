// apps/web/src/components/agents/procedures/nodes/condition-else-node.ts

import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { selectAncestorContent } from '~/components/editor/keymap-helpers'
import { ConditionElseNodeView } from './condition-else-node-view'

/**
 * `conditionElse` — the ELSE fallthrough arm of a {@link ConditionBlock}. No
 * predicate; `block+` body, isolating (mirror `panel-node.ts`). At most one per
 * block (enforced author-side; the compiler reads the last `conditionElse`).
 */
export const ConditionElse = Node.create({
  name: 'conditionElse',
  content: 'block+',
  defining: true,
  isolating: true,

  addKeyboardShortcuts() {
    return {
      'Mod-a': ({ editor }) =>
        selectAncestorContent(editor, (n) => n.type.name === 'conditionElse'),
    }
  },

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
    return [{ tag: 'div[data-condition-else]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-condition-else': '' }, HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ConditionElseNodeView)
  },
})
