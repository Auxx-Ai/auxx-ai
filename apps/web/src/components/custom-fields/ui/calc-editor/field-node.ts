// apps/web/src/components/custom-fields/ui/calc-editor/field-node.ts
// Field node for rendering field references as styled tags in formula editor

import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import FieldNodeView from './field-node-view'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * Field node for formula TipTap editor.
 * Renders field references as styled tags with only a field key reference.
 * Format: {fieldKey} in serialized form.
 */
export const FieldNode = Node.create({
  name: 'field-node',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      // Field key - the identifier for the referenced field
      fieldKey: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-field-key'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.fieldKey) return {}
          return { 'data-field-key': attributes.fieldKey }
        },
      },
    }
  },

  addInputRules() {
    return [
      nodeInputRule({
        // Match {fieldKey} pattern
        find: /(\{([\w-]+)\})$/,
        type: this.type,
        getAttributes: (match) => ({
          fieldKey: match[2],
        }),
      }),
    ]
  },

  parseHTML() {
    return [{ tag: 'span[data-type="field"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { fieldKey } = node.attrs

    return [
      'span',
      mergeAttributes(
        {
          'data-type': 'field',
          'data-field-key': fieldKey,
          class: 'field-node-placeholder',
        },
        HTMLAttributes
      ),
      `{${fieldKey}}`,
    ]
  },

  renderText({ node }) {
    return `{${node.attrs.fieldKey}}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(FieldNodeView)
  },

  addKeyboardShortcuts() {
    return {
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
        key: new PluginKey('field-paste'),
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData('text/plain')
            if (!text) return false

            const fieldPattern = /\{([^{}]+)\}/g
            if (!fieldPattern.test(text)) return false

            event.preventDefault()

            const { tr } = view.state
            const { from } = view.state.selection

            let currentPos = from
            let lastIndex = 0
            let match

            fieldPattern.lastIndex = 0

            while ((match = fieldPattern.exec(text)) !== null) {
              if (match.index > lastIndex) {
                const textBefore = text.slice(lastIndex, match.index)
                if (textBefore) {
                  tr.insertText(textBefore, currentPos)
                  currentPos += textBefore.length
                }
              }

              const fieldNode = view.state.schema.nodes['field-node'].create({
                fieldKey: match[1],
              })
              tr.insert(currentPos, fieldNode)
              currentPos += 1

              lastIndex = match.index + match[0].length
            }

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
