// src/components/editor/extensions/mention-extension.tsx
// This file implements the TipTap mention node for Auxx.ai editor.
// It provides @mention functionality as a custom inline node.

import { Node, mergeAttributes } from '@tiptap/core'

/**
 * Mention node for TipTap editor
 * Allows inline @mention with custom attributes and rendering
 */
export const MentionNode = Node.create({
  name: 'mention-node',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-id'),
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.id) return {}
          return { 'data-id': attributes.id }
        },
      },
      label: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-label'),
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.label) return {}
          return { 'data-label': attributes.label }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ 'data-type': 'mention', class: 'text-blue-500' }, HTMLAttributes),
      `@${node.attrs.label}`,
    ]
  },
})
