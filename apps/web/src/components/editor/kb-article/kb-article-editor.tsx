// apps/web/src/components/editor/kb-article/kb-article-editor.tsx
'use client'

import type { JSONContent } from '@tiptap/core'
import { getMarkRange } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReferencePickerContent,
  type ReferencePickerHandle,
} from '~/components/pickers/reference-picker/reference-picker-content'
import {
  AISlotPlaceholder,
  AlignSection,
  ColorPickerSection,
  EditorBubbleMenu,
  InlineMarksSection,
  KBBlockSection,
  LinkButton,
  MoreMenuSection,
  TurnIntoSection,
} from '../bubble-menu'
import { getOpenPickerRange, InlinePickerPopover, useActivePicker } from '../inline-picker'
import type { SlashContentHandle } from '../slash-commands/slash-list'
import {
  type ArticleLinkEditMode,
  type ArticleLinkPick,
  ArticleLinkPopover,
} from './article-link-popover'
import { KBEditorContextProvider } from './editor-context'
import styles from './kb-article-editor.module.css'
import { KBSlashContent } from './kb-slash-content'
import { LinkContextMenu, type LinkContextMenuTarget } from './link-context-menu'
import { useKBArticleEditor } from './use-kb-article-editor'

interface KBArticleEditorProps {
  initialContent: JSONContent[] | null
  /** `html` is a lazy getter — see `UseRichTextEditorOptions.onChange`. */
  onChange: (content: { json: JSONContent; getHTML: () => string }) => void
  /** Knowledge base id — scopes the article-link picker to a single KB by default. */
  knowledgeBaseId?: string
  /** Fired once when the underlying Tiptap editor instance is ready. */
  onReady?: (editor: Editor) => void
  /** When true, switches the editor to read-only — used while Kopilot is in a write turn. */
  readOnly?: boolean
  /**
   * Collapse the left block gutter (numbers + drag handles) and its pull-left
   * margin so the body lines up flush under the title. Set on read-only viewers
   * like the source workspace where the gutter rail is never shown — without it
   * the body sits left of the title.
   */
  hideGutter?: boolean
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
  onReady,
  readOnly,
  hideGutter,
}: KBArticleEditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const referencePickerRef = useRef<ReferencePickerHandle | null>(null)
  const slashRef = useRef<SlashContentHandle | null>(null)
  const onPickerEnter = useCallback(
    () => referencePickerRef.current?.confirmHighlighted() ?? false,
    []
  )
  const onPickerArrowVertical = useCallback(
    (dir: 1 | -1) => referencePickerRef.current?.moveHighlight(dir) ?? false,
    []
  )
  const onSlashEnter = useCallback(() => slashRef.current?.confirmHighlighted() ?? false, [])
  const onSlashArrowVertical = useCallback(
    (dir: 1 | -1) => slashRef.current?.moveHighlight(dir) ?? false,
    []
  )
  const onSlashBackspacePop = useCallback(() => slashRef.current?.popLevel() ?? false, [])

  const { editor, gutterCharWidth } = useKBArticleEditor({
    initialContent,
    onChange,
    onPickerEnter,
    onPickerArrowVertical,
    onSlashEnter,
    onSlashArrowVertical,
    onSlashBackspacePop,
  })
  const activePicker = useActivePicker(editor)
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null)
  const [linkMenu, setLinkMenu] = useState<LinkMenuState | null>(null)

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      onReady?.(editor)
    }
  }, [editor, onReady])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

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

  const handleBubbleLinkRequest = useCallback(() => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return
    const selectedText = editor.state.doc.textBetween(from, to, ' ')
    const linkType = editor.schema.marks.link
    const existing = linkType ? editor.getAttributes('link') : null
    const existingHref = typeof existing?.href === 'string' ? existing.href : ''
    const start = editor.view.coordsAtPos(from)
    const end = editor.view.coordsAtPos(to)
    const rect = new DOMRect(
      Math.min(start.left, end.left),
      Math.min(start.top, end.top),
      Math.max(1, Math.max(start.right, end.right) - Math.min(start.left, end.left)),
      Math.max(1, Math.max(start.bottom, end.bottom) - Math.min(start.top, end.top))
    )
    setLinkPopover({
      rect,
      range: { from, to },
      edit: { kind: 'edit', initialHref: existingHref, initialText: selectedText },
    })
  }, [editor])

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
        ref={wrapperRef}
        className={styles.editorWrapper}
        onMouseDown={handleWrapperMouseDown}
        onContextMenu={handleContextMenu}
        style={
          (hideGutter
            ? { '--editor-gutter-min-width': '0px', '--editor-gutter-pull-left': '0' }
            : { '--editor-gutter-min-width': `calc(${gutterCharWidth}ch + 1rem)` }) as CSSProperties
        }>
        <div className={styles.editorContainer}>
          <EditorContent editor={editor} className={styles.editorContent} />
        </div>
        <EditorBubbleMenu
          editor={editor}
          renderBlockSection={({ editor }) => <KBBlockSection editor={editor} />}
          renderAISlot={() => <AISlotPlaceholder />}
          renderTurnInto={({ editor }) => <TurnIntoSection editor={editor} />}
          renderInlineMarks={({ editor }) => <InlineMarksSection editor={editor} />}
          renderColor={({ editor }) => <ColorPickerSection editor={editor} />}
          renderAlign={({ editor }) => <AlignSection editor={editor} />}
          renderLink={({ editor }) => (
            <LinkButton editor={editor} onRequest={handleBubbleLinkRequest} />
          )}
          renderMore={({ editor }) => <MoreMenuSection editor={editor} />}
        />
        <InlinePickerPopover
          state={{
            isOpen: !!activePicker && activePicker.trigger === '/',
            query: activePicker?.query ?? '',
            range: null,
            clientRect: activePicker?.clientRect ?? null,
          }}
          containerRef={wrapperRef}
          width={288}
          side='bottom'
          align='start'
          autoFocus={false}
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement | null
            if (target?.closest('[data-type="reference-picker"]')) {
              e.preventDefault()
            }
          }}
          onClose={() => editor?.commands.closeReferencePicker({ keepText: true })}>
          <KBSlashContent
            ref={slashRef}
            query={activePicker?.query ?? ''}
            onExecute={(command) => {
              if (!editor) return
              const range = getOpenPickerRange(editor.state)
              if (!range) return
              command(editor, range)
            }}
            onClose={() => editor?.commands.closeReferencePicker({ keepText: true })}
            onScopeChange={(scope) => editor?.commands.setPickerScope(scope, { clearQuery: true })}
            onLinkArticle={handleLinkArticle}
            editor={editor}
          />
        </InlinePickerPopover>
        <InlinePickerPopover
          state={{
            isOpen: !!activePicker && activePicker.trigger === '@',
            query: activePicker?.query ?? '',
            range: null,
            clientRect: activePicker?.clientRect ?? null,
          }}
          containerRef={wrapperRef}
          width={360}
          side='bottom'
          align='start'
          autoFocus={false}
          onInteractOutside={(e) => {
            // Clicking the chip itself must not close the picker — the user
            // is editing the query inline. Without this, Radix sees the click
            // as outside the popover and triggers onClose, collapsing the
            // chip to plain `@<query>` text.
            const target = e.target as HTMLElement | null
            if (target?.closest('[data-type="reference-picker"]')) {
              e.preventDefault()
            }
          }}
          onClose={() => editor?.commands.closeReferencePicker({ keepText: true })}>
          <ReferencePickerContent
            ref={referencePickerRef}
            tab={activePicker?.tab ?? 'people'}
            query={activePicker?.query ?? ''}
            onSelect={(id) => editor?.commands.confirmReferencePicker(id)}
            onTabChange={(tab) => editor?.commands.setReferencePickerTab(tab)}
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
