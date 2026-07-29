// apps/web/src/components/snippets/ui/snippet-editor.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { generateHTML } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Braces } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  createPlaceholderNode,
  getOpenPickerRange,
  InlinePickerPopover,
  PlaceholderBadge,
  ReferencePickerNode,
  stripOpenChips,
  useActivePicker,
} from '~/components/editor/inline-picker'
import { PlaceholderSlashContent } from '~/components/editor/slash-commands/placeholder-slash-content'
import type { SlashContentHandle } from '~/components/editor/slash-commands/slash-list'
import { Tooltip } from '~/components/global/tooltip'

interface SnippetEditorProps {
  /** Initial HTML content (from snippet.contentHtml). */
  contentHtml: string
  /** Fires on every change with the HTML and plain-text projections. */
  onChange: (html: string, text: string) => void
  placeholder?: string
  /** Applied to the outer wrapper (border, focus ring, error state). */
  wrapperClassName?: string
  /** Applied to the prose content area. */
  className?: string
  /**
   * `false` renders the body read-only — the member holds `view` on this
   * snippet but not `edit` (plan 36 §8). Also hides the placeholder-insert
   * trigger, which would otherwise mutate a document the caller cannot save.
   */
  editable?: boolean
}

/**
 * Tiptap-based snippet body editor. Supports the placeholder inline node +
 * a `{`-triggered placeholder picker chip (no heading / list / snippet
 * commands — those belong to the reply composer's broader slash menu).
 */
export function SnippetEditor({
  contentHtml,
  onChange,
  placeholder = 'Type { to insert a placeholder...',
  wrapperClassName,
  className,
  editable = true,
}: SnippetEditorProps) {
  // Keyboard forwarded from the open `{` chip to the placeholder picker
  // (focus stays in the editor until the picker's own input takes over).
  const slashRef = useRef<SlashContentHandle | null>(null)
  const onSlashEnter = useCallback(() => slashRef.current?.confirmHighlighted() ?? false, [])
  const onSlashArrowVertical = useCallback(
    (dir: 1 | -1) => slashRef.current?.moveHighlight(dir) ?? false,
    []
  )
  const onSlashBackspacePop = useCallback(() => slashRef.current?.popLevel() ?? false, [])
  const onSlashArrowRight = useCallback(() => slashRef.current?.drillHighlighted() ?? false, [])

  const placeholderNodeExtension = useMemo(
    () => createPlaceholderNode((badgeProps) => <PlaceholderBadge {...badgeProps} />),
    []
  )

  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: false }),
      Placeholder.configure({ placeholder }),
      // `{` fires mid-word (allowedPrefixes: null) — snippet authors type prose
      // like "Hi {first_name}," where the `{` directly follows non-space text.
      ReferencePickerNode.configure({
        triggers: [{ char: '{', kind: 'command', allowedPrefixes: null }],
        onSlashEnter,
        onSlashArrowVertical,
        onSlashBackspacePop,
        onSlashArrowRight,
      }),
      placeholderNodeExtension,
    ],
    [
      placeholder,
      placeholderNodeExtension,
      onSlashEnter,
      onSlashArrowVertical,
      onSlashBackspacePop,
      onSlashArrowRight,
    ]
  )

  // For the lazy HTML projection — `generateHTML` from the STRIPPED json
  // instead of `editor.getHTML()`, which would serialize an open chip's
  // markup (+ ZWSP seed) into saved snippet HTML.
  const extensionsRef = useRef(extensions)
  extensionsRef.current = extensions

  const editor = useEditor(
    {
      extensions,
      content: contentHtml,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: cn(
            'tiptap-email-editor tiptap-snippet-editor prose prose-sm prose-headings:my-1 prose-ul:my-1 prose-p:my-0 prose-li:my-0 focus:outline-hidden max-w-none dark:prose-invert flex-1',
            className
          ),
        },
      },
      onUpdate: ({ editor, transaction }) => {
        if (!transaction.docChanged) return
        // Any open `{` chip is emitted as its literal text — saved HTML never
        // contains the transient node, so no open/closed gating is needed.
        const json = stripOpenChips(editor.getJSON())
        onChange(generateHTML(json, extensionsRef.current), editor.getText())
      },
    },
    []
  )

  // `useEditor` is created once (deps `[]`), so `editable` has to be pushed in.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(editable)
  }, [editor, editable])

  // Sync external contentHtml changes (e.g. loading an existing snippet).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (editor.getHTML() !== contentHtml) {
      editor.commands.setContent(contentHtml, false)
    }
  }, [editor, contentHtml])

  const handleInsertTrigger = useCallback(() => {
    if (!editor) return
    if (!editor.isFocused) editor.commands.focus('end')
    editor.commands.openReferencePicker('{')
  }, [editor])

  const activePicker = useActivePicker(editor)
  const pickerOpen = !!activePicker && activePicker.trigger === '{'

  const runWithChipRange = useCallback(
    (cmd: (editor: Editor, range: { from: number; to: number }) => void) => {
      if (!editor) return
      const range = getOpenPickerRange(editor.state)
      if (!range) return
      cmd(editor, range)
    },
    [editor]
  )
  const closePicker = useCallback(() => {
    editor?.commands.closeReferencePicker({ keepText: true })
  }, [editor])

  return (
    <div
      className={cn(
        'relative rounded-md border focus-within:ring-2 focus-within:ring-info',
        wrapperClassName
      )}>
      <EditorContent
        editor={editor}
        className='w-full h-full flex flex-col bg-transparent px-3 py-2 text-[15px] leading-relaxed text-foreground outline-hidden ring-0 min-h-[160px] *:outline-hidden'
      />
      <div className={cn('absolute bottom-1 right-1', !editable && 'hidden')}>
        <Tooltip content='Insert placeholder' shortcut='{' allowInteraction>
          <Button
            type='button'
            size='icon-sm'
            variant='ghost'
            onMouseDown={(e) => {
              // Prevent editor blur when clicking — keeps the cursor in place
              // so opening the `{` chip lands at the caret.
              e.preventDefault()
              handleInsertTrigger()
            }}>
            <Braces />
          </Button>
        </Tooltip>
      </div>
      {editor && (
        <InlinePickerPopover
          state={{
            isOpen: pickerOpen,
            query: activePicker?.query ?? '',
            range: null,
            clientRect: activePicker?.clientRect ?? null,
          }}
          width={288}
          className='z-[200]'
          onClose={closePicker}>
          <PlaceholderSlashContent
            ref={slashRef}
            onClose={closePicker}
            onSelect={(id) => {
              runWithChipRange((editor, range) => {
                editor
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .insertContent({ type: 'placeholder', attrs: { id } })
                  .insertContent(' ')
                  .run()
              })
            }}
          />
        </InlinePickerPopover>
      )}
    </div>
  )
}
