// apps/web/src/components/editor/kb-article/block-node.ts

import { type Editor, mergeAttributes, Node } from '@tiptap/core'
import type { ResolvedPos } from '@tiptap/pm/model'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { selectAncestorContent } from '../keymap-helpers'
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

const findBlockDepth = ($from: ResolvedPos): number => {
  for (let depth = $from.depth; depth >= 0; depth--) {
    if ($from.node(depth).type.name === 'block') return depth
  }
  return -1
}

// Step out the bottom of the `block` at `depth`: focus the next block,
// or append a new empty text block first if this is the last in doc.
const escapeBlockDownward = (editor: Editor, depth: number): boolean => {
  const { $from } = editor.state.selection
  const node = $from.node(depth)
  const blockEnd = $from.before(depth) + node.nodeSize
  const isLastInDoc = blockEnd >= editor.state.doc.content.size
  if (isLastInDoc) {
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
      // Mod-A inside a code block or callout selects only that block's
      // content. Default Mod-A would select the whole doc, which is rarely
      // what you want when you're typing inside a contained block.
      'Mod-a': ({ editor }) =>
        selectAncestorContent(
          editor,
          (n) =>
            n.type.name === 'block' &&
            (n.attrs.blockType === 'codeBlock' || n.attrs.blockType === 'callout')
        ),
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
        const depth = findBlockDepth($from)
        if (depth < 0) return false
        if ($from.node(depth).attrs.blockType !== 'codeBlock') return false
        return escapeBlockDownward(editor, depth)
      },
      // codeBlock holds multi-line code as a single inline range with literal
      // `\n`s, so PM's default Down can't escape it. Other block types only
      // escape at end of doc to avoid inserting stray blocks mid-doc.
      ArrowDown: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty) return false

        const depth = findBlockDepth($from)
        if (depth < 0) return false

        const node = $from.node(depth)

        if (node.attrs.blockType === 'codeBlock') {
          const remaining = node.textContent.slice($from.parentOffset)
          if (remaining.includes('\n')) return false
          return escapeBlockDownward(editor, depth)
        }

        const blockEnd = $from.before(depth) + node.nodeSize
        const isLastInDoc = blockEnd >= editor.state.doc.content.size
        if (!isLastInDoc) return false
        const isEmpty = node.content.size === 0
        const atTextEnd = $from.parentOffset === node.content.size
        if (!isEmpty && !atTextEnd) return false
        return escapeBlockDownward(editor, depth)
      },
    }
  },
})
