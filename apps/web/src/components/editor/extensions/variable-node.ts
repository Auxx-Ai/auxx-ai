// src/components/editor/extensions/variable-node.ts
// Variable node for rendering workflow variables as styled tags in Tiptap editor

import { mergeAttributes, Node, nodeInputRule } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
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

            const schema = view.state.schema

            // Build inline content for a single line, parsing {{varId}} patterns
            function buildLineContent(line: string) {
              const nodes: any[] = []
              const pattern = /\{\{([^}]+)\}\}/g
              let lastIdx = 0
              let m

              while ((m = pattern.exec(line)) !== null) {
                if (m.index > lastIdx) {
                  nodes.push(schema.text(line.slice(lastIdx, m.index)))
                }
                nodes.push(schema.nodes['variable-node'].create({ variableId: m[1] }))
                lastIdx = m.index + m[0].length
              }
              if (lastIdx < line.length) {
                nodes.push(schema.text(line.slice(lastIdx)))
              }
              return nodes
            }

            // Split on \n\n (ProseMirror paragraph separator) to get paragraphs
            const paragraphs = text
              .split('\n\n')
              .map((para) => schema.nodes.paragraph.create(null, buildLineContent(para)))

            const { tr } = view.state
            const { from, to } = view.state.selection
            const fragment = Fragment.from(paragraphs)
            // openStart/openEnd = 1 so the first/last paragraph merges into surrounding content
            tr.replace(from, to, new Slice(fragment, 1, 1))

            view.dispatch(tr)
            return true
          },
        },
      }),
    ]
  },
})
