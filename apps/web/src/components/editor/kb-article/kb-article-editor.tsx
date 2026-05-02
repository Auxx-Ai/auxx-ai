// apps/web/src/components/editor/kb-article/kb-article-editor.tsx
'use client'

import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import type { CSSProperties } from 'react'
import { useCallback, useState } from 'react'
import { InlinePickerPopover } from '../inline-picker'
import { type ArticleLinkPick, ArticleLinkPopover } from './article-link-popover'
import { KBEditorContextProvider } from './editor-context'
import styles from './kb-article-editor.module.css'
import { KBSlashCommandPicker } from './kb-slash-command-picker'
import { useKBArticleEditor } from './use-kb-article-editor'

interface KBArticleEditorProps {
  initialContent: JSONContent | null
  onChange: (content: { json: JSONContent; html: string }) => void
  /** Knowledge base id — scopes the article-link picker to a single KB by default. */
  knowledgeBaseId?: string
}

interface PendingLink {
  editor: Editor
  insertPos: number
  rect: DOMRect
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
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null)

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

  const handleLinkArticle = useCallback((editorInstance: Editor, insertPos: number) => {
    const coords = editorInstance.view.coordsAtPos(insertPos)
    const rect = new DOMRect(
      coords.left,
      coords.top,
      Math.max(1, coords.right - coords.left),
      Math.max(1, coords.bottom - coords.top)
    )
    setPendingLink({ editor: editorInstance, insertPos, rect })
  }, [])

  const handlePick = useCallback(
    (pick: ArticleLinkPick) => {
      if (!pendingLink) return
      const isInternal = pick.href.startsWith('auxx://')
      const endPos = pendingLink.insertPos + pick.text.length
      pendingLink.editor
        .chain()
        .focus()
        .insertContentAt(pendingLink.insertPos, {
          type: 'text',
          text: pick.text,
          marks: [
            {
              type: 'link',
              attrs: {
                href: pick.href,
                target: isInternal ? null : '_blank',
              },
            },
          ],
        })
        .setTextSelection(endPos)
        .unsetMark('link')
        .run()
      setPendingLink(null)
    },
    [pendingLink]
  )

  return (
    <KBEditorContextProvider knowledgeBaseId={knowledgeBaseId}>
      <div
        className={styles.editorWrapper}
        onMouseDown={handleWrapperMouseDown}
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
          open={pendingLink !== null}
          onOpenChange={(open) => {
            if (!open) setPendingLink(null)
          }}
          knowledgeBaseId={knowledgeBaseId}
          anchorRect={pendingLink?.rect ?? null}
          onPick={handlePick}
        />
      </div>
    </KBEditorContextProvider>
  )
}
