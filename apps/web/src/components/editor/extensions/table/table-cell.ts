import { mergeAttributes, Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

export interface TableCellOptions {
  /**
   * The HTML attributes for a table cell node.
   * @default {}
   * @example { class: 'foo' }
   */
  HTMLAttributes: Record<string, any>
}

/**
 * This extension allows you to create table cells.
 * @see https://www.tiptap.dev/api/nodes/table-cell
 */
export const TableCell = Node.create<TableCellOptions>({
  name: 'tableCell',

  addOptions() {
    return { HTMLAttributes: {} }
  },

  content: 'block+',

  addAttributes() {
    return {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      colwidth: {
        default: null,
        parseHTML: (element) => {
          const colwidth = element.getAttribute('colwidth')
          const value = colwidth ? colwidth.split(',').map((width) => parseInt(width, 10)) : null

          return value
        },
      },
    }
  },

  tableRole: 'cell',

  isolating: true,

  parseHTML() {
    return [{ tag: 'td' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'td',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-table-cell': '' }),
      0,
    ]
  },

  // Mod-A inside a cell selects the cell's content range, not the entire doc.
  // Mirrors the same fix on `panel-node.ts`.
  addKeyboardShortcuts() {
    return {
      'Mod-a': ({ editor }) => {
        const { $from } = editor.state.selection
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth)
          if (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader') continue
          const cellStart = $from.before(depth) + 1
          const cellEnd = cellStart + node.content.size
          editor.view.dispatch(
            editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cellStart, cellEnd))
          )
          return true
        }
        return false
      },
    }
  },
})
