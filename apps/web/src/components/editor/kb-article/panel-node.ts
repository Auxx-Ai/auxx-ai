// apps/web/src/components/editor/kb-article/panel-node.ts

import { mergeAttributes, Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'
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
      'Mod-a': ({ editor }) => {
        const { $from } = editor.state.selection
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth)
          if (node.type.name !== 'panel') continue
          const panelStart = $from.before(depth) + 1
          const panelEnd = panelStart + node.content.size
          editor.view.dispatch(
            editor.state.tr.setSelection(
              TextSelection.create(editor.state.doc, panelStart, panelEnd)
            )
          )
          return true
        }
        return false
      },
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
    return ReactNodeViewRenderer(PanelNodeView)
  },
})
