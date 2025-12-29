import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import FileNodeView from './file-node-view'
// FileNodeView
export const FileNode = Node.create({
  name: 'file',
  group: 'block',
  inline: false,
  atom: true, // Treated as an indivisible unit

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      filename: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-file]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-file': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileNodeView)
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('fileHandler'),
        props: {
          handlePaste: (view: EditorView, event: ClipboardEvent) => {
            const items = Array.from(event.clipboardData?.items || [])
            items.forEach((item) => {
              if (item.kind === 'file') {
                const file = item.getAsFile()
                if (file) this.options.handleFileUpload(file, view)
              }
            })
            return false
          },
          handleDrop: (view: EditorView, event: DragEvent) => {
            const files = Array.from(event.dataTransfer?.files || [])
            files.forEach((file) => this.options.handleFileUpload(file, view))
            return false
          },
        },
      }),
    ]
  },

  addOptions() {
    return {
      handleFileUpload: async (file: File, view: EditorView) => {
        if (!file) return

        // Convert to Base64 for preview
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = reader.result as string

          // Insert node into editor
          const transaction = view.state.tr.replaceSelectionWith(
            view.state.schema.nodes.file.create({
              src: base64,
              filename: file.name,
            })
          )
          view.dispatch(transaction)
        }
        reader.readAsDataURL(file)
      },
    }
  },
})
