// apps/web/src/components/editor/kb-article/use-kb-article-editor.ts
'use client'

import type { JSONContent } from '@tiptap/core'
import { Extension, Node } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useMemo, useRef } from 'react'
import { Table, TableCell, TableHeader, TableRow } from '../extensions/table'
import { createPlaceholderNode, PlaceholderBadge, useSlashCommand } from '../inline-picker'
import { Accordion } from './accordion-node'
import { Block } from './block-node'
import { MarkdownInputRules } from './markdown-input-rules'
import { MarkdownPaste } from './markdown-paste'
import { migrateLegacyContent } from './migrate-legacy-content'
import { Panel } from './panel-node'
import { Tabs } from './tabs-node'

const Doc = Node.create({
  name: 'doc',
  topNode: true,
  content: '(block | containerBlock)+',
})

const FocusClasses = Extension.create({
  name: 'focus-classes',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('focus-classes'),
        props: {
          decorations: ({ doc, selection }) => {
            const decorations: Decoration[] = []
            doc.descendants((node, pos) => {
              if (node.isBlock && pos <= selection.from && pos + node.nodeSize >= selection.to) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'has-focus' }))
              }
              return true
            })
            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})

const emptyDoc: JSONContent = {
  type: 'doc',
  content: [{ type: 'block', attrs: { blockType: 'text' }, content: [] }],
}

interface UseKBArticleEditorOptions {
  initialContent: JSONContent | null
  onChange: (content: { json: JSONContent; html: string }) => void
}

export function useKBArticleEditor({ initialContent, onChange }: UseKBArticleEditorOptions) {
  const slashCommand = useSlashCommand()

  const normalizedInitialContent = useMemo(
    () => migrateLegacyContent(initialContent) ?? emptyDoc,
    [initialContent]
  )

  const placeholderNodeExtension = useMemo(
    () => createPlaceholderNode((p) => <PlaceholderBadge {...p} />),
    []
  )

  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        Doc,
        StarterKit.configure({
          document: false,
          heading: false,
          paragraph: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
          history: undefined,
          // Marks stay enabled (bold, italic, strike, code).
        }),
        Block,
        Panel,
        Tabs,
        Accordion,
        MarkdownInputRules,
        MarkdownPaste,
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Underline,
        Highlight.configure({ multicolor: true }),
        Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
        FocusClasses,
        // Placeholder is rendered as a real DOM sibling inside BlockNodeView,
        // not via the Placeholder extension's CSS pseudo-element (which would
        // overlap the line gutter). See block-node-view.tsx `showPlaceholder`.
        slashCommand.slashCommandExtension,
        placeholderNodeExtension,
      ],
      content: normalizedInitialContent,
      shouldRerenderOnTransaction: false,
      onCreate: ({ editor }) => slashCommand.setEditor(editor),
      onDestroy: () => slashCommand.setEditor(null),
      onUpdate: ({ editor, transaction }) => {
        if (!transaction.docChanged) return
        if (slashCommand.isOpenRef.current) return
        const json = editor.getJSON()
        const html = editor.getHTML()
        // Defer one tick so Suggestion plugin's onStart can mark isOpenRef
        // before we propagate the change.
        setTimeout(() => {
          if (!slashCommand.isOpenRef.current) onChangeRef.current({ json, html })
        }, 0)
      },
    },
    []
  )

  const gutterCharWidth = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor ? Math.max(2, String(editor.state.doc.content.childCount).length) : 2,
  })

  // Sync external content changes (e.g. autosave response landing while user is idle).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const incomingContent = normalizedInitialContent
    const current = JSON.stringify(editor.getJSON())
    const incoming = JSON.stringify(incomingContent)
    if (current === incoming) return
    const { from, to } = editor.state.selection
    editor.commands.setContent(incomingContent, false)
    try {
      editor.commands.setTextSelection({ from, to })
    } catch {
      editor.commands.focus('end')
    }
  }, [normalizedInitialContent, editor])

  // Flush deferred onChange when slash picker closes.
  const prevOpen = useRef(false)
  useEffect(() => {
    if (prevOpen.current && !slashCommand.suggestionState.isOpen && editor) {
      onChangeRef.current({ json: editor.getJSON(), html: editor.getHTML() })
    }
    prevOpen.current = slashCommand.suggestionState.isOpen
  }, [slashCommand.suggestionState.isOpen, editor])

  return { editor, gutterCharWidth: gutterCharWidth ?? 2, slashCommand }
}
