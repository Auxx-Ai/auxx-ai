// apps/web/src/components/editor/kb-article/accordion-node.ts

import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { AccordionNodeView } from './accordion-node-view'

export const Accordion = Node.create({
  name: 'accordion',
  group: 'containerBlock',
  content: 'panel+',
  defining: true,

  addAttributes() {
    return {
      allowMultiple: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-allow-multiple') !== 'false',
        renderHTML: (attrs) => ({
          'data-allow-multiple': attrs.allowMultiple === false ? 'false' : 'true',
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-accordion]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-accordion': '' }, HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AccordionNodeView)
  },
})
