// apps/web/src/components/editor/kb-article/panel-node.ts

import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { selectAncestorContent } from '../keymap-helpers'
import { PanelNodeView } from './panel-node-view'

export const Panel = Node.create({
  name: 'panel',
  group: 'panel',
  content: 'block+',
  defining: true,
  isolating: true,

  addKeyboardShortcuts() {
    return {
      // Mod-A inside a panel selects only the panel's body (Cmd+A would
      // otherwise select the entire doc, including sibling tabs and the
      // surrounding article content).
      'Mod-a': ({ editor }) => selectAncestorContent(editor, (n) => n.type.name === 'panel'),
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-panel-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-panel-id': attrs.id } : {}),
      },
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-panel-label') ?? '',
        renderHTML: (attrs) => ({ 'data-panel-label': attrs.label ?? '' }),
      },
      iconId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-panel-icon'),
        renderHTML: (attrs) => (attrs.iconId ? { 'data-panel-icon': attrs.iconId } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-panel]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-panel': '' }, HTMLAttributes), 0]
  },

  addNodeView() {
    // Mirror `id` onto the outer `.react-renderer.node-panel` wrapper so a
    // scoped CSS rule on the parent tabs container can hide the wrapper of
    // non-active panels declaratively (see `tabs-node-view.tsx`). Without
    // this, only the inner NodeViewWrapper carries `data-panel-id` and the
    // outer wrapper still claims box space when its content is hidden.
    return ReactNodeViewRenderer(PanelNodeView, {
      attrs: ({ node }): Record<string, string> => {
        const id = node.attrs.id
        return typeof id === 'string' && id ? { 'data-panel-id': id } : {}
      },
    })
  },
})
