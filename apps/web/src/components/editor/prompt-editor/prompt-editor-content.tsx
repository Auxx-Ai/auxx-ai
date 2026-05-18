// apps/web/src/components/editor/prompt-editor/prompt-editor-content.tsx
'use client'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Popover, PopoverAnchor, PopoverContentDialogAware } from '@auxx/ui/components/popover'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import { Link as LinkIcon } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  EditorBubbleMenu,
  InlineMarksSection,
  KBBlockSection,
  LinkButton,
  TurnIntoSection,
} from '~/components/editor/bubble-menu'
import {
  InlinePickerPopover,
  useActivePicker,
  useSlashCommand,
} from '~/components/editor/inline-picker'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import { useRichTextEditor } from '~/components/editor/rich-text/use-rich-text-editor'
import { BasicSlashCommandPicker } from '~/components/editor/slash-commands/basic-slash-command-picker'
import type { ReferencePickerHandle } from '~/components/pickers/reference-picker/reference-picker-content'
import { ReferencePickerContent } from '~/components/pickers/reference-picker/reference-picker-content'
import styles from './prompt-editor.module.css'

interface PromptEditorContentProps {
  /** Snapshot read on mount. Subsequent `agent.prompt` changes don't re-init the editor. */
  initialContent: JSONContent[] | null
  onChange: (content: { json: JSONContent; html: string }) => void
  /**
   * Fired with the new editor on mount and `null` on unmount. The parent
   * uses this to drive header widgets (character count, copy) and to keep
   * focus state in sync with whichever editor is currently active.
   */
  onEditorReady: (editor: Editor | null) => void
  onFocusChange: (focused: boolean) => void
  /** Called on focus — parent uses this to expand the collapsed card. */
  onUserActivity?: () => void
  /** Shared across instances so the same picker handle can drive arrow keys. */
  referencePickerRef: React.RefObject<ReferencePickerHandle | null>
  referenceTabs?: ReferenceTab[]
  /**
   * When `false`, mounts the editor in read-only mode — same TipTap
   * instance, same reference badge rendering, but typing / paste / slash /
   * `@`-picker are inert. Used by the template gallery preview.
   */
  editable?: boolean
}

interface LinkPopoverState {
  rect: DOMRect
  range: { from: number; to: number }
  initialHref: string
  selectedText: string
}

/**
 * Owns a single TipTap editor instance. The parent (`PersonaEditor`)
 * mounts one of these in the card and a separate one in the expanded
 * dialog — never both at once. Each mount creates a fresh editor from
 * `initialContent`; the parent keeps the latest doc in state so the
 * next mount picks up where the previous left off.
 *
 * This mirrors the workflow `PromptEditor` pattern. Trying to share one
 * editor instance across two render locations breaks TipTap (its
 * `EditorContent` calls `flushSync` from `componentDidMount`, which
 * fires again when React reparents the subtree).
 */
export const PromptEditorContent = memo(function PromptEditorContent({
  initialContent,
  onChange,
  onEditorReady,
  onFocusChange,
  onUserActivity,
  referencePickerRef,
  referenceTabs,
  editable = true,
}: PromptEditorContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null)

  const slashCommand = useSlashCommand()

  const onPickerEnter = useCallback(
    () => referencePickerRef.current?.confirmHighlighted() ?? false,
    [referencePickerRef]
  )
  const onPickerArrowVertical = useCallback(
    (dir: 1 | -1) => referencePickerRef.current?.moveHighlight(dir) ?? false,
    [referencePickerRef]
  )

  const { editor } = useRichTextEditor({
    initialContent,
    onChange,
    slashCommand,
    enableReferencePicker: true,
    onPickerEnter,
    onPickerArrowVertical,
    referenceTabs,
    editable,
  })

  const activePicker = useActivePicker(editor)

  // Surface the editor instance to the parent so header widgets (character
  // count, copy button) track whichever instance is currently mounted.
  useEffect(() => {
    onEditorReady(editor)
    return () => onEditorReady(null)
  }, [editor, onEditorReady])

  useEffect(() => {
    if (!editor) return
    const onFocusEvt = () => {
      onFocusChange(true)
      onUserActivity?.()
    }
    const onBlurEvt = () => onFocusChange(false)
    editor.on('focus', onFocusEvt)
    editor.on('blur', onBlurEvt)
    return () => {
      editor.off('focus', onFocusEvt)
      editor.off('blur', onBlurEvt)
    }
  }, [editor, onFocusChange, onUserActivity])

  const handleLinkRequest = useCallback(() => {
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
      initialHref: existingHref,
      selectedText,
    })
  }, [editor])

  const handleApplyLink = useCallback(
    (href: string) => {
      if (!editor || !linkPopover) return
      const trimmed = href.trim()
      if (!trimmed) return
      const mark = { type: 'link', attrs: { href: trimmed, target: '_blank' } }
      const text = linkPopover.selectedText || trimmed
      const node = { type: 'text', text, marks: [mark] }
      editor
        .chain()
        .focus()
        .insertContentAt(linkPopover.range, node)
        // Strip the stored link mark so the next typed character isn't linked.
        .command(({ tr }) => {
          tr.removeStoredMark(editor.schema.marks.link)
          return true
        })
        .run()
      setLinkPopover(null)
    },
    [editor, linkPopover]
  )

  return (
    <div ref={containerRef} className={`${styles.editor} relative flex-1 min-h-0 flex w-full`}>
      <EditorContent
        editor={editor}
        className='prose prose-sm max-w-none dark:prose-invert w-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:focus:outline-none [&_.ProseMirror-focused]:outline-none focus:outline-none'
      />
      <EditorBubbleMenu
        editor={editor}
        renderBlockSection={({ editor }) => <KBBlockSection editor={editor} />}
        renderTurnInto={({ editor }) => <TurnIntoSection editor={editor} />}
        renderInlineMarks={({ editor }) => <InlineMarksSection editor={editor} />}
        renderLink={({ editor }) => <LinkButton editor={editor} onRequest={handleLinkRequest} />}
      />
      <InlinePickerPopover
        state={slashCommand.suggestionState}
        onClose={slashCommand.closePicker}
        width={288}>
        <BasicSlashCommandPicker
          query={slashCommand.suggestionState.query}
          onExecute={slashCommand.executeCommand}
          onClose={slashCommand.closePicker}
        />
      </InlinePickerPopover>
      <InlinePickerPopover
        state={{
          isOpen: !!activePicker,
          query: activePicker?.query ?? '',
          range: null,
          clientRect: activePicker?.clientRect ?? null,
        }}
        containerRef={containerRef}
        width={360}
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
        <ReferencePickerContent
          ref={referencePickerRef}
          tab={activePicker?.tab ?? 'people'}
          query={activePicker?.query ?? ''}
          onSelect={(id) => editor?.commands.confirmReferencePicker(id)}
          onTabChange={(tab) => editor?.commands.setReferencePickerTab(tab)}
          tabs={referenceTabs}
        />
      </InlinePickerPopover>
      <PromptLinkPopover
        open={linkPopover !== null}
        anchorRect={linkPopover?.rect ?? null}
        initialHref={linkPopover?.initialHref ?? ''}
        onApply={handleApplyLink}
        onClose={() => setLinkPopover(null)}
      />
    </div>
  )
})

// Minimal URL-only link popover — no internal article search, admins
// either paste a URL or cancel. Modeled on `ArticleLinkPopover` for the
// virtual-anchor + dialog-aware portal behavior.
function PromptLinkPopover({
  open,
  anchorRect,
  initialHref,
  onApply,
  onClose,
}: {
  open: boolean
  anchorRect: DOMRect | null
  initialHref: string
  onApply: (href: string) => void
  onClose: () => void
}) {
  const virtualRef = useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect: () => anchorRect ?? new DOMRect(),
  })
  virtualRef.current.getBoundingClientRect = () => anchorRect ?? new DOMRect()

  const [draft, setDraft] = useState(initialHref)

  useEffect(() => {
    if (open) setDraft(initialHref)
  }, [open, initialHref])

  return (
    <Popover open={open} onOpenChange={(o) => !o && onClose()}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContentDialogAware side='bottom' align='start' sideOffset={6} className='w-80 p-2'>
        <InputGroup>
          <InputGroupAddon align='inline-start'>
            <LinkIcon />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            placeholder='https://example.com'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onApply(draft)
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
          />
          <InputGroupAddon align='inline-end'>
            <InputGroupButton size='xs' onClick={() => onApply(draft)} disabled={!draft.trim()}>
              Apply
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </PopoverContentDialogAware>
    </Popover>
  )
}
