// apps/web/src/components/editor/kb-article/tabs-node.ts

import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { TabsNodeView } from './tabs-node-view'

export const Tabs = Node.create({
  name: 'tabs',
  group: 'containerBlock',
  content: 'panel+',
  defining: true,

  addAttributes() {
    return {
      activeTab: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-active-tab'),
        renderHTML: (attrs) => (attrs.activeTab ? { 'data-active-tab': attrs.activeTab } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-tabs]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-tabs': '' }, HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TabsNodeView)
  },
})
