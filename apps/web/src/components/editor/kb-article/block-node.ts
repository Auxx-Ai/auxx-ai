// apps/web/src/components/editor/kb-article/block-node.ts

import { mergeAttributes, Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { blockDragPlugin } from './block-drag-plugin'
import { BlockNodeView } from './block-node-view'

export type BlockType =
  | 'text'
  | 'heading'
  | 'bulletListItem'
  | 'numberedListItem'
  | 'todoListItem'
  | 'quote'
  | 'image'
  | 'divider'
  | 'codeBlock'
  | 'callout'
  | 'embed'
  | 'cards'

const LIST_TYPES: BlockType[] = ['bulletListItem', 'numberedListItem', 'todoListItem']

export const Block = Node.create({
  name: 'block',
  content: 'inline*',
  marks: '_',
  group: 'block',
  defining: true,

  addAttributes() {
    return {
      id: { default: null },
      blockType: {
        default: 'text',
        parseHTML: (el) => el.getAttribute('data-block-type') || 'text',
        renderHTML: (attrs) =>
          attrs.blockType && attrs.blockType !== 'text'
            ? { 'data-block-type': attrs.blockType }
            : {},
      },
      level: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-level')
          return v ? Number.parseInt(v, 10) : null
        },
        renderHTML: (attrs) => (attrs.level ? { 'data-level': attrs.level } : {}),
      },
      checked: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-checked') === 'true',
        renderHTML: (attrs) =>
          attrs.blockType === 'todoListItem'
            ? { 'data-checked': attrs.checked ? 'true' : 'false' }
            : {},
      },
      imageUrl: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-image-url'),
        renderHTML: (attrs) =>
          attrs.blockType === 'image' && attrs.imageUrl ? { 'data-image-url': attrs.imageUrl } : {},
      },
      imageWidth: {
        default: 400,
        parseHTML: (el) => {
          const v = el.getAttribute('data-image-width')
          return v ? Number.parseInt(v, 10) : 400
        },
        renderHTML: (attrs) =>
          attrs.blockType === 'image' && attrs.imageWidth
            ? { 'data-image-width': attrs.imageWidth }
            : {},
      },
      imageAlign: {
        default: 'center',
        parseHTML: (el) => el.getAttribute('data-image-align'),
        renderHTML: (attrs) =>
          attrs.blockType === 'image' && attrs.imageAlign
            ? { 'data-image-align': attrs.imageAlign }
            : {},
      },
      calloutVariant: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-callout-variant') || 'info',
        renderHTML: (attrs) =>
          attrs.blockType === 'callout' && attrs.calloutVariant
            ? { 'data-callout-variant': attrs.calloutVariant }
            : {},
      },
      codeLanguage: {
        default: 'plaintext',
        parseHTML: (el) => el.getAttribute('data-code-language') || 'plaintext',
        renderHTML: (attrs) =>
          attrs.blockType === 'codeBlock' && attrs.codeLanguage
            ? { 'data-code-language': attrs.codeLanguage }
            : {},
      },
      embedUrl: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-embed-url'),
        renderHTML: (attrs) =>
          attrs.blockType === 'embed' && attrs.embedUrl ? { 'data-embed-url': attrs.embedUrl } : {},
      },
      embedProvider: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-embed-provider'),
        renderHTML: (attrs) =>
          attrs.blockType === 'embed' && attrs.embedProvider
            ? { 'data-embed-provider': attrs.embedProvider }
            : {},
      },
      embedAspect: {
        default: '16:9',
        parseHTML: (el) => el.getAttribute('data-embed-aspect') || '16:9',
        renderHTML: (attrs) =>
          attrs.blockType === 'embed' && attrs.embedAspect
            ? { 'data-embed-aspect': attrs.embedAspect }
            : {},
      },
      cards: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-cards')
          if (!raw) return null
          try {
            const parsed = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed : null
          } catch {
            return null
          }
        },
        renderHTML: (attrs) =>
          attrs.blockType === 'cards' && Array.isArray(attrs.cards)
            ? { 'data-cards': JSON.stringify(attrs.cards) }
            : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-block': '' }, HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockNodeView)
  },

  addProseMirrorPlugins() {
    return [blockDragPlugin()]
  },

  addKeyboardShortcuts() {
    const isList = (type: unknown): boolean =>
      typeof type === 'string' && LIST_TYPES.includes(type as BlockType)

    return {
      // Mod-A inside a code block selects only the code's content (mirrors
      // the same shortcut on `panel`). Default Mod-A would select the whole
      // doc, which is rarely what you want when you're typing code.
      'Mod-a': ({ editor }) => {
        const { $from } = editor.state.selection
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth)
          if (node.type.name !== 'block') continue
          if (node.attrs.blockType !== 'codeBlock') return false
          const blockStart = $from.before(depth) + 1
          const blockEnd = blockStart + node.content.size
          editor.view.dispatch(
            editor.state.tr.setSelection(
              TextSelection.create(editor.state.doc, blockStart, blockEnd)
            )
          )
          return true
        }
        return false
      },
      Tab: ({ editor }) => {
        const { $from } = editor.state.selection
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth)
          if (node.type.name === 'block' && isList(node.attrs.blockType)) {
            const current = node.attrs.level ?? 1
            if (current >= 5) return true
            return editor
              .chain()
              .updateAttributes('block', { level: current + 1 })
              .run()
          }
        }
        return false
      },
      'Shift-Tab': ({ editor }) => {
        const { $from } = editor.state.selection
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth)
          if (node.type.name === 'block' && isList(node.attrs.blockType)) {
            const current = node.attrs.level ?? 1
            if (current <= 1) {
              return editor
                .chain()
                .updateAttributes('block', { blockType: 'text', level: null, checked: false })
                .run()
            }
            return editor
              .chain()
              .updateAttributes('block', { level: current - 1 })
              .run()
          }
        }
        return false
      },
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty) return false

        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth)
          if (node.type.name !== 'block') continue

          const blockType = node.attrs.blockType as string
          const isEmpty = node.content.size === 0

          // Code block: Enter inserts a literal newline; Mod-Enter exits below.
          if (blockType === 'codeBlock') {
            return editor.chain().insertContent('\n').run()
          }

          // Divider stays as divider — split and convert the new sibling to text.
          if (blockType === 'divider') {
            return editor
              .chain()
              .splitBlock()
              .updateAttributes('block', { blockType: 'text', level: null, checked: false })
              .run()
          }

          // Filled embed (URL set): split off a new text block below instead of
          // converting the embed back to text.
          if (blockType === 'embed' && node.attrs.embedUrl) {
            return editor
              .chain()
              .splitBlock()
              .updateAttributes('block', { blockType: 'text', level: null, checked: false })
              .run()
          }

          if (isEmpty && blockType !== 'text') {
            return editor
              .chain()
              .updateAttributes('block', { blockType: 'text', level: null, checked: false })
              .run()
          }

          if (blockType === 'heading' && $from.parentOffset === node.content.size) {
            return editor
              .chain()
              .splitBlock()
              .updateAttributes('block', { blockType: 'text', level: null })
              .run()
          }

          return false
        }
        return false
      },
      'Mod-Enter': ({ editor }) => {
        const { $from } = editor.state.selection
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth)
          if (node.type.name !== 'block') continue
          if (node.attrs.blockType !== 'codeBlock') return false
          const blockEnd = $from.before(depth) + node.nodeSize
          return editor
            .chain()
            .insertContentAt(blockEnd, { type: 'block' })
            .focus(blockEnd + 1)
            .run()
        }
        return false
      },
      // Inside a code block, code lines are inline text separated by literal
      // `\n`, so PM's default ArrowDown can't escape the inline range and the
      // caret gets stuck on the last line. If there are no more newlines
      // after the cursor (i.e. we're already on the visual last line), step
      // out to the next block — creating one if this is the last block in
      // the doc. Returning `false` otherwise lets default Down move down a
      // visual line within the code body.
      ArrowDown: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty) return false
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth)
          if (node.type.name !== 'block') continue
          if (node.attrs.blockType !== 'codeBlock') return false
          const remaining = node.textContent.slice($from.parentOffset)
          if (remaining.includes('\n')) return false
          const blockEnd = $from.before(depth) + node.nodeSize
          const doc = editor.state.doc
          if (blockEnd >= doc.content.size) {
            return editor
              .chain()
              .insertContentAt(blockEnd, { type: 'block' })
              .focus(blockEnd + 1)
              .run()
          }
          return editor
            .chain()
            .focus(blockEnd + 1)
            .run()
        }
        return false
      },
    }
  },
})
