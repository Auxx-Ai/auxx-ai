// apps/web/src/components/editor/kb-article/kb-article-editor.tsx
'use client'

import type { JSONContent } from '@tiptap/core'
import { getMarkRange } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import type { CSSProperties } from 'react'
import { useCallback, useState } from 'react'
import { InlinePickerPopover } from '../inline-picker'
import {
  type ArticleLinkEditMode,
  type ArticleLinkPick,
  ArticleLinkPopover,
} from './article-link-popover'
import { KBEditorContextProvider } from './editor-context'
import styles from './kb-article-editor.module.css'
import { KBSlashCommandPicker } from './kb-slash-command-picker'
import { LinkContextMenu, type LinkContextMenuTarget } from './link-context-menu'
import { useKBArticleEditor } from './use-kb-article-editor'

interface KBArticleEditorProps {
  initialContent: JSONContent | null
  onChange: (content: { json: JSONContent; html: string }) => void
  /** Knowledge base id — scopes the article-link picker to a single KB by default. */
  knowledgeBaseId?: string
}

interface LinkPopoverState {
  rect: DOMRect
  /** When set, replaces this range; otherwise inserts at the cursor. */
  range?: { from: number; to: number }
  /** Prefill values when editing an existing link. */
  edit?: ArticleLinkEditMode
}

interface LinkMenuState extends LinkContextMenuTarget {
  range: { from: number; to: number }
  text: string
}

export function KBArticleEditor({
  initialContent,
  onChange,
  knowledgeBaseId,
}: KBArticleEditorProps) {
  const { editor, gutterCharWidth, slashCommand } = useKBArticleEditor({
    initialContent,
    onChange,
  })
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null)
  const [linkMenu, setLinkMenu] = useState<LinkMenuState | null>(null)

  // Clicks on chrome around the contenteditable (padding, empty area below
  // the last block) should still focus the editor at end — matches the
  // behavior people expect from doc editors.
  const handleWrapperMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || editor.isDestroyed) return
    const target = e.target as HTMLElement
    // React synthetic events bubble through the React tree, including from
    // portaled descendants (popovers, dialogs). Ignore events whose target
    // isn't actually a DOM descendant of this wrapper.
    if (!e.currentTarget.contains(target)) return
    if (target.closest('.ProseMirror')) return
    if (target.closest('[data-block-drag-handle]')) return
    e.preventDefault()
    editor.commands.focus('end')
  }

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || editor.isDestroyed) return
    const target = e.target as HTMLElement
    if (!target.closest('.ProseMirror')) return
    const linkType = editor.schema.marks.link
    if (!linkType) return
    const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos
    if (pos == null) return
    const $pos = editor.state.doc.resolve(pos)
    const range = getMarkRange($pos, linkType)
    if (!range) return // native context menu fires
    const mark = $pos.marks().find((m) => m.type === linkType)
    const href = typeof mark?.attrs.href === 'string' ? mark.attrs.href : ''
    if (!href) return
    e.preventDefault()
    setLinkMenu({
      range,
      href,
      rect: new DOMRect(e.clientX, e.clientY, 1, 1),
      text: editor.state.doc.textBetween(range.from, range.to, ' '),
    })
  }

  const handleLinkArticle = useCallback((editorInstance: Editor, insertPos: number) => {
    const coords = editorInstance.view.coordsAtPos(insertPos)
    const rect = new DOMRect(
      coords.left,
      coords.top,
      Math.max(1, coords.right - coords.left),
      Math.max(1, coords.bottom - coords.top)
    )
    setLinkPopover({ rect })
  }, [])

  const handlePick = useCallback(
    (pick: ArticleLinkPick) => {
      if (!editor || !linkPopover) return
      const isInternal = pick.href.startsWith('auxx://')
      const mark = {
        type: 'link',
        attrs: { href: pick.href, target: isInternal ? null : '_blank' },
      }
      const node = { type: 'text', text: pick.text, marks: [mark] }
      const chain = editor.chain().focus()
      if (linkPopover.range) {
        chain.insertContentAt(linkPopover.range, node)
      } else {
        chain.insertContent(node)
      }
      // Strip the stored link mark so the next typed character isn't linked.
      chain
        .command(({ tr }) => {
          tr.removeStoredMark(editor.schema.marks.link)
          return true
        })
        .run()
      setLinkPopover(null)
    },
    [editor, linkPopover]
  )

  const buildInternalEditorHref = useCallback(
    (articleId: string) => {
      if (!knowledgeBaseId) return null
      return `/app/kb/${knowledgeBaseId}/editor/${articleId}`
    },
    [knowledgeBaseId]
  )

  const handleEditLink = () => {
    if (!linkMenu) return
    setLinkPopover({
      rect: linkMenu.rect,
      range: linkMenu.range,
      edit: { kind: 'edit', initialHref: linkMenu.href, initialText: linkMenu.text },
    })
    setLinkMenu(null)
  }

  const handleRemoveLink = () => {
    if (!editor || !linkMenu) return
    const { from, to } = linkMenu.range
    editor.chain().focus().setTextSelection({ from, to }).unsetMark('link').run()
    setLinkMenu(null)
  }

  return (
    <KBEditorContextProvider knowledgeBaseId={knowledgeBaseId}>
      <div
        className={styles.editorWrapper}
        onMouseDown={handleWrapperMouseDown}
        onContextMenu={handleContextMenu}
        style={{ '--gutter-min-width': `calc(${gutterCharWidth}ch + 1rem)` } as CSSProperties}>
        <div className={styles.editorContainer}>
          <EditorContent editor={editor} className={styles.editorContent} />
        </div>
        <InlinePickerPopover
          state={slashCommand.suggestionState}
          onClose={slashCommand.closePicker}
          width={288}>
          <KBSlashCommandPicker
            query={slashCommand.suggestionState.query}
            onExecute={slashCommand.executeCommand}
            onClose={slashCommand.closePicker}
            onLinkArticle={handleLinkArticle}
          />
        </InlinePickerPopover>
        <ArticleLinkPopover
          open={linkPopover !== null}
          onOpenChange={(open) => {
            if (!open) setLinkPopover(null)
          }}
          knowledgeBaseId={knowledgeBaseId}
          anchorRect={linkPopover?.rect ?? null}
          onPick={handlePick}
          mode={linkPopover?.edit}
        />
        <LinkContextMenu
          target={linkMenu}
          onOpenChange={(open) => {
            if (!open) setLinkMenu(null)
          }}
          onEdit={handleEditLink}
          onRemove={handleRemoveLink}
          buildInternalEditorHref={buildInternalEditorHref}
        />
      </div>
    </KBEditorContextProvider>
  )
}
