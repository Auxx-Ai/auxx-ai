// src/components/editor/extensions/variable-node.ts
// Variable node for rendering workflow variables as styled tags in Tiptap editor

import { mergeAttributes, Node, nodeInputRule } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ReactNodeViewRenderer } from '@tiptap/react'
import VariableNodeView from './variable-node-view'

/**
 * Variable node for TipTap editor
 * Renders workflow variables as styled tags with only a variable ID reference
 * All variable data is fetched from the UnifiedVariable store
 */
export const VariableNode = Node.create({
  name: 'variable-node',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false, // Prevent accidental dragging

  addAttributes() {
    return {
      // Variable ID - the only attribute stored
      variableId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-variable-id'),
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.variableId) return {}
          return { 'data-variable-id': attributes.variableId }
        },
      },
    }
  },
  addInputRules() {
    return [
      nodeInputRule({
        // 1️⃣ group 1  = "{{variable}}"
        // 2️⃣ group 2  =  variable
        find: /(\{\{([\w-]+)\}\})$/, // ← braces now inside group 1
        type: this.type,
        getAttributes: (match) => ({
          variableId: match[2], // use group 2 for the ID
        }),
      }),
    ]
  },

  parseHTML() {
    return [{ tag: 'span[data-type="variable"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { variableId } = node.attrs

    return [
      'span',
      mergeAttributes(
        {
          'data-type': 'variable',
          'data-variable-id': variableId,
          class: 'variable-node-placeholder',
        },
        HTMLAttributes
      ),
      `{{${variableId}}}`, // uses variableId with underscores
    ]
  },
  renderText({ node }) {
    // Render the variable ID as text
    return `{{${node.attrs.variableId}}}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(VariableNodeView)
  },

  addKeyboardShortcuts() {
    return {
      // Delete selected variable with Delete or Backspace
      Delete: () => {
        const { selection } = this.editor.state
        if (selection.node && selection.node.type.name === this.name) {
          return this.editor.commands.deleteSelection()
        }
        return false
      },
      Backspace: () => {
        const { selection } = this.editor.state
        if (selection.node && selection.node.type.name === this.name) {
          return this.editor.commands.deleteSelection()
        }
        return false
      },
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tag-paste'),
        props: {
          handlePaste(view, event, slice) {
            const text = event.clipboardData?.getData('text/plain')
            if (!text) return false

            // Check if pasted text contains tag patterns
            const tagPattern = /\{\{([^}]+)\}\}/g
            if (!tagPattern.test(text)) return false

            // Prevent default paste and handle custom parsing
            event.preventDefault()

            // Parse the text and create appropriate nodes
            const { tr } = view.state
            const { from } = view.state.selection

            let currentPos = from
            let lastIndex = 0
            let match

            tagPattern.lastIndex = 0 // Reset regex

            while ((match = tagPattern.exec(text)) !== null) {
              // Insert text before the tag
              if (match.index > lastIndex) {
                const textBefore = text.slice(lastIndex, match.index)
                if (textBefore) {
                  tr.insertText(textBefore, currentPos)
                  currentPos += textBefore.length
                }
              }

              // Insert the tag node
              const tagNode = view.state.schema.nodes['variable-node'].create({
                variableId: match[1],
              })
              tr.insert(currentPos, tagNode)
              currentPos += 1

              lastIndex = match.index + match[0].length
            }

            // Insert remaining text after last tag
            if (lastIndex < text.length) {
              const textAfter = text.slice(lastIndex)
              if (textAfter) {
                tr.insertText(textAfter, currentPos)
              }
            }

            view.dispatch(tr)
            return true
          },
        },
      }),
    ]
  },
})
