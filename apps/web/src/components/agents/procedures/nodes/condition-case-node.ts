// apps/web/src/components/agents/procedures/nodes/condition-case-node.ts

import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { selectAncestorContent } from '~/components/editor/keymap-helpers'
import { ConditionCaseNodeView } from './condition-case-node-view'

/**
 * `conditionCase` — one IF / ELSE-IF arm of a {@link ConditionBlock}. The
 * predicate is **dual-mode** (plan §4 / decision #9):
 *
 * - `mode: 'text'` (default) — a leading `conditionPredicate` prose node holds a
 *   natural-language predicate (`@` inserts attribute badges); the model reads it.
 * - `mode: 'structured'` — the `group: ConditionGroup` attr holds the structured
 *   builder state (`evaluateConditions()`-compatible), serialized as JSON on
 *   `data-group` like `block-node.ts`'s `cards` attr.
 *
 * Content is `conditionPredicate block+` (the predicate writer + the arm body).
 * `isolating` so Cmd-A scopes to this arm (mirror `panel-node.ts`). Arm order =
 * IF/ELSE-IF precedence; there is no `kind` attr.
 */
export const ConditionCase = Node.create({
  name: 'conditionCase',
  content: 'conditionPredicate block+',
  defining: true,
  isolating: true,

  addKeyboardShortcuts() {
    return {
      'Mod-a': ({ editor }) =>
        selectAncestorContent(editor, (n) => n.type.name === 'conditionCase'),
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id } : {}),
      },
      mode: {
        default: 'text',
        parseHTML: (el) => el.getAttribute('data-mode') ?? 'text',
        renderHTML: (attrs) => ({ 'data-mode': attrs.mode ?? 'text' }),
      },
      group: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-group')
          if (!raw) return null
          try {
            return JSON.parse(raw)
          } catch {
            return null
          }
        },
        renderHTML: (attrs) => (attrs.group ? { 'data-group': JSON.stringify(attrs.group) } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-condition-case]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-condition-case': '' }, HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ConditionCaseNodeView)
  },
})
