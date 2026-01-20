import { InputRule } from '@tiptap/core'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import TiptapImage from '@tiptap/extension-image'
import TiptapLink from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextStyle from '@tiptap/extension-text-style'
import TiptapUnderline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import CustomKeymap from './custom-keymap'
import { ImageResizer } from './image-resizer'
import UpdatedImage from './updated-image'
import { TaskItem } from './task-item'
import { TaskList } from './task-list'
import { CharacterCount } from './character-count'
import GlobalDragHandle from './global-drag-handle'

import { Table, TableCell, TableHeader, TableRow, TableView } from './table'
import { FontSize } from './font-size'

const PlaceholderExtension = Placeholder.configure({
  placeholder: ({ node }) => {
    if (node.type.name === 'heading') {
      return `Heading ${node.attrs.level}`
    }
    if (['table', 'tableRow', 'tableCell', 'tableHeader'].includes(node.type.name)) {
      return ''
    }
    return "Press '/' for commands"
  },
  includeChildren: true,
})

const HighlightExtension = Highlight.configure({ multicolor: true })

const MarkdownExtension = Markdown.configure({ html: false, transformCopiedText: true })

const Horizontal = HorizontalRule.extend({
  addInputRules() {
    // typing '---', '___' will create a horizontal rule
    return [
      new InputRule({
        find: /^(?:---|—-|___\s|\*\*\*\s)$/u,
        handler: ({ state, range }) => {
          const attributes = {}

          const { tr } = state
          const start = range.from
          const end = range.to

          tr.insert(start - 1, this.type.create(attributes)).delete(
            tr.mapping.map(start),
            tr.mapping.map(end)
          )
        },
      }),
    ]
  },
})

export * from './ai-highlight'
export * from './slash-command'
export * from './mention-extension'
// export * from './variable-picker-extension'
export * from './variable-node'
export {
  Horizontal as HorizontalRule,
  ImageResizer,
  InputRule,
  PlaceholderExtension as Placeholder,
  StarterKit,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  TableView,
  TaskItem,
  TaskList,
  TiptapImage,
  TiptapUnderline,
  MarkdownExtension,
  TextStyle,
  Color,
  HighlightExtension,
  CustomKeymap,
  TiptapLink,
  UpdatedImage,
  CharacterCount,
  GlobalDragHandle,
  FontSize,
}
