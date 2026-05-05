import { mergeAttributes, Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

export interface TableHeaderOptions {
  /**
   * The HTML attributes for a table header node.
   * @default {}
   * @example { class: 'foo' }
   */
  HTMLAttributes: Record<string, any>
}

/**
 * This extension allows you to create table headers.
 * @see https://www.tiptap.dev/api/nodes/table-header
 */
export const TableHeader = Node.create<TableHeaderOptions>({
  name: 'tableHeader',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  content: 'block+',

  addAttributes() {
    return {
      colspan: {
        default: 1,
      },
      rowspan: {
        default: 1,
      },
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

  tableRole: 'header_cell',

  isolating: true,

  parseHTML() {
    return [{ tag: 'th' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'th',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-table-cell': '' }),
      0,
    ]
  },

  // Mod-A inside a header cell selects the cell's content range, mirrors TableCell.
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
