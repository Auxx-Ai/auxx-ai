// apps/web/src/components/editor/inline-picker/core/inline-node.ts

import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { InlineNodeConfig, InlineNodeBadgeProps } from '../types'
import { createInlineNodeView } from './inline-node-view'

/**
 * Creates a TipTap node definition for inline picker items.
 *
 * Simplified design:
 * - Only stores `id` attribute
 * - Uses `data-type` and `data-id` for HTML serialization
 * - Badge component handles display lookup
 *
 * Includes:
 * - React node view with selection handling
 * - Backspace/Delete keyboard shortcuts
 * - Optional paste handler for pattern-based parsing
 * - Optional input rules for auto-conversion
 *
 * @param config - Node configuration
 * @param renderBadge - Function to render the badge content
 * @returns Configured TipTap node
 */
export function createInlineNode(
  config: InlineNodeConfig,
  renderBadge: (props: InlineNodeBadgeProps) => React.ReactNode
) {
  const { type, serialize, pastePattern, inputRules } = config

  return Node.create({
    name: type,
    group: 'inline',
    inline: true,
    selectable: true,
    atom: true,
    draggable: false,

    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute('data-id'),
          renderHTML: (attributes: Record<string, unknown>) => {
            if (!attributes.id) return {}
            return { 'data-id': attributes.id }
          },
        },
      }
    },

    parseHTML() {
      return [{ tag: `span[data-type="${type}"]` }]
    },

    renderHTML({ node, HTMLAttributes }) {
      const id = node.attrs.id as string
      return [
        'span',
        mergeAttributes(
          {
            'data-type': type,
            'data-id': id,
          },
          HTMLAttributes
        ),
        serialize(id),
      ]
    },

    renderText({ node }) {
      return serialize(node.attrs.id as string)
    },

    addNodeView() {
      return ReactNodeViewRenderer(createInlineNodeView(renderBadge))
    },

    // Add input rules if configured
    addInputRules() {
      if (!inputRules || inputRules.length === 0) return []

      return inputRules.map(({ find, getId }) =>
        nodeInputRule({
          find,
          type: this.type,
          getAttributes: (match) => ({ id: getId(match) }),
        })
      )
    },

    addKeyboardShortcuts() {
      return {
        // Delete node when backspace is pressed with cursor after node
        Backspace: () =>
          this.editor.commands.command(({ state, dispatch }) => {
            const { selection } = state
            const { empty, anchor } = selection

            if (!empty) return false

            const pos = anchor - 1
            if (pos < 0) return false

            const nodeBefore = state.doc.nodeAt(pos)
            if (nodeBefore?.type.name !== type) return false

            if (dispatch) {
              const tr = state.tr.delete(pos, anchor)
              dispatch(tr)
            }
            return true
          }),

        // Delete node when it's selected and Delete is pressed
        Delete: () => {
          const { selection } = this.editor.state
          if ('node' in selection && selection.node?.type.name === type) {
            return this.editor.commands.deleteSelection()
          }
          return false
        },
      }
    },

    addProseMirrorPlugins() {
      // Only add paste handler if pattern is configured
      if (!pastePattern) return []

      const { pattern, getId } = pastePattern
      const nodeType = type

      return [
        new Plugin({
          key: new PluginKey(`${type}-paste`),
          props: {
            handlePaste(view, event) {
              const text = event.clipboardData?.getData('text/plain')
              if (!text) return false

              // Test if pattern exists in text
              const testPattern = new RegExp(pattern.source, pattern.flags)
              if (!testPattern.test(text)) return false

              event.preventDefault()

              const { tr } = view.state
              const { from } = view.state.selection

              let currentPos = from
              let lastIndex = 0
              let match

              // Reset pattern for exec loop
              const execPattern = new RegExp(pattern.source, 'g')

              while ((match = execPattern.exec(text)) !== null) {
                // Insert text before match
                if (match.index > lastIndex) {
                  const textBefore = text.slice(lastIndex, match.index)
                  if (textBefore) {
                    tr.insertText(textBefore, currentPos)
                    currentPos += textBefore.length
                  }
                }

                // Insert node
                const id = getId(match)
                const schemaNode = view.state.schema.nodes[nodeType]
                if (schemaNode) {
                  const node = schemaNode.create({ id })
                  tr.insert(currentPos, node)
                  currentPos += 1
                }

                lastIndex = match.index + match[0].length
              }

              // Insert remaining text after last match
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
}
