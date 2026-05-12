// apps/web/src/components/editor/kb-article/use-kb-article-editor.ts
'use client'

import type { JSONContent } from '@tiptap/core'
import { Extension, Node } from '@tiptap/core'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Table, TableCell, TableHeader, TableRow } from '../extensions/table'
import {
  createPlaceholderNode,
  PlaceholderBadge,
  stableStringify,
  useExternalContentSync,
  useSlashCommand,
} from '../inline-picker'
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
  // PM resolves a bare `block` token to the NODE named `block` (which we have),
  // not the group. So we have to list `table` explicitly even though it's in
  // `group: 'block'` — node-name resolution takes precedence over group.
  content: '(block | containerBlock | table)+',
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

const emptyBody: JSONContent[] = [{ type: 'block', attrs: { blockType: 'text' }, content: [] }]

interface UseKBArticleEditorOptions {
  initialContent: JSONContent[] | null
  onChange: (content: { json: JSONContent; html: string }) => void
}

export function useKBArticleEditor({ initialContent, onChange }: UseKBArticleEditorOptions) {
  const slashCommand = useSlashCommand()

  const normalizedInitialContent = useMemo<JSONContent>(() => {
    const migrated = migrateLegacyContent(initialContent)
    const content = migrated && migrated.length > 0 ? migrated : emptyBody
    return { type: 'doc', content }
  }, [initialContent])

  const placeholderNodeExtension = useMemo(
    () => createPlaceholderNode((p) => <PlaceholderBadge {...p} />),
    []
  )

  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const externalSyncRef = useRef<{ markLocalEdit: (key: string) => void }>({
    markLocalEdit: () => {},
  })

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
        // Column resizing is disabled in the KB editor — the React NodeView
        // (TableNodeView) owns the table chrome and column resize is a
        // follow-up. Reorder + add/remove are handled via table-helpers.ts.
        Table,
        TableRow,
        TableHeader,
        TableCell,
        Underline,
        TextStyle,
        Color,
        TextAlign.configure({ types: ['block'] }),
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
          if (slashCommand.isOpenRef.current) return
          externalSyncRef.current.markLocalEdit(stableStringify(json))
          onChangeRef.current({ json, html })
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

  const applyContent = useCallback((instance: NonNullable<typeof editor>, content: JSONContent) => {
    // Skip when the editor is already at the incoming doc — happens on
    // mount because `useEditor` initialized it with the same content, and
    // a redundant `setContent` here triggers TipTap's React node views to
    // flushSync mid-commit ("flushSync was called from inside a lifecycle
    // method" warning). Uses stableStringify so server-side JSONB key
    // reordering doesn't make a same-content doc look different.
    if (stableStringify(instance.getJSON()) === stableStringify(content)) return
    const { from, to } = instance.state.selection
    instance.commands.setContent(content, false)
    try {
      instance.commands.setTextSelection({ from, to })
    } catch {
      instance.commands.focus('end')
    }
  }, [])

  const canonicalKey = useCallback((content: JSONContent) => stableStringify(content), [])

  const syncHandle = useExternalContentSync<JSONContent>({
    editor,
    incoming: normalizedInitialContent,
    isPickerOpen: slashCommand.suggestionState.isOpen,
    applyContent,
    canonicalKey,
  })

  // Wire the imperative handle into the editor's onUpdate closure.
  externalSyncRef.current = syncHandle.current

  // Flush deferred onChange when slash picker closes — the hook handles
  // the *inbound* flush; this handles the *outbound* one.
  const prevOpen = useRef(false)
  useEffect(() => {
    if (prevOpen.current && !slashCommand.suggestionState.isOpen && editor) {
      onChangeRef.current({ json: editor.getJSON(), html: editor.getHTML() })
    }
    prevOpen.current = slashCommand.suggestionState.isOpen
  }, [slashCommand.suggestionState.isOpen, editor])

  return { editor, gutterCharWidth: gutterCharWidth ?? 2, slashCommand }
}
