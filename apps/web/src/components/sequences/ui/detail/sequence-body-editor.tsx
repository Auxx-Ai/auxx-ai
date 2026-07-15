// apps/web/src/components/sequences/ui/detail/sequence-body-editor.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { generateHTML, type JSONContent } from '@tiptap/core'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { type Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Braces, Calendar } from 'lucide-react'
import { useCallback, useMemo, useRef } from 'react'
import '~/styles/prosemirror.css'
import { EditorToolbar } from '~/components/editor/editor-button'
import { EditorProvider } from '~/components/editor/editor-context'
import { FontSize } from '~/components/editor/extensions'
import { Indent } from '~/components/editor/extensions/indent'
import {
  createPlaceholderNode,
  getOpenPickerRange,
  InlinePickerPopover,
  PlaceholderBadge,
  ReferencePickerNode,
  stripOpenChips,
  useActivePicker,
} from '~/components/editor/inline-picker'
import type { RootChoice } from '~/components/editor/placeholders/placeholder-picker-content'
import { PlaceholderSlashContent } from '~/components/editor/slash-commands/placeholder-slash-content'
import type { SlashContentHandle } from '~/components/editor/slash-commands/slash-list'
import { Tooltip } from '~/components/global/tooltip'

interface SequenceBodyEditorProps {
  /** Persisted TipTap JSON body (preferred). */
  bodyJson: Record<string, unknown> | null
  /** Persisted HTML body — seed fallback when no JSON exists yet. */
  bodyHtml: string | null
  /** Null for manual sequences — offers Visit fields only on visit-subject sequences. */
  subjectKind?: 'visit' | 'work_order' | 'invoice' | null
  /** Fires with the stripped JSON + generated HTML on every doc change. */
  onChange: (bodyJson: JSONContent, bodyHtml: string) => void
  /** Fires when focus leaves the editor — flush pending autosave. */
  onBlur?: () => void
  placeholder?: string
}

/** The one extra placeholder-picker root this editor ever offers — reused so `extraRoots`
 * always gets the same array identity when `subjectKind === 'visit'`. */
const VISIT_ROOTS: RootChoice[] = [{ id: 'visit', label: 'Visit', icon: Calendar }]

/**
 * Email body editor for a sequence step. Composed the snippet-editor way (own
 * `useEditor` + `{`-triggered placeholder-chip picker) but with the mail
 * composer's rich extension set + `EditorToolbar` formatting row — the
 * ComposerBody/`LazyTiptapEditor` stack couldn't be reused cleanly because its
 * chip picker is hardwired to the mail `/`+`@` menus (snippets, signatures,
 * quick actions) and its frame drags in dropzone/active-state chrome.
 *
 * Placeholders resolve at send time against the recipient contact (plan §18),
 * so the persisted HTML keeps the `{{token}}` spans produced by the
 * placeholder node.
 */
export function SequenceBodyEditor(props: SequenceBodyEditorProps) {
  // EditorToolbar (and its buttons) read the editor context unconditionally —
  // give this editor instance its own provider scope.
  return (
    <EditorProvider>
      <SequenceBodyEditorInner {...props} />
    </EditorProvider>
  )
}

function SequenceBodyEditorInner({
  bodyJson,
  bodyHtml,
  subjectKind,
  onChange,
  onBlur,
  placeholder = 'Write the email… Type { to insert a placeholder',
}: SequenceBodyEditorProps) {
  const extraRoots = subjectKind === 'visit' ? VISIT_ROOTS : undefined

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
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Indent,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      // `{` fires mid-word (allowedPrefixes: null) — cadence authors type prose
      // like "Hi {first_name}," where `{` directly follows non-space text.
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

  // For the HTML projection — `generateHTML` from the STRIPPED json instead of
  // `editor.getHTML()`, which would serialize an open chip's markup (+ ZWSP
  // seed) into the saved step HTML.
  const extensionsRef = useRef(extensions)
  extensionsRef.current = extensions

  const editor = useEditor(
    {
      extensions,
      // Seed-once: JSON is canonical; fall back to the HTML projection, then empty.
      content: (bodyJson as JSONContent | null) ?? bodyHtml ?? '',
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class:
            'tiptap-email-editor prose prose-sm prose-headings:my-1 prose-ul:my-1 prose-p:my-0 prose-li:my-0 focus:outline-hidden max-w-none dark:prose-invert flex-1',
        },
      },
      onUpdate: ({ editor, transaction }) => {
        if (!transaction.docChanged) return
        const json = stripOpenChips(editor.getJSON())
        onChange(json, generateHTML(json, extensionsRef.current))
      },
    },
    []
  )

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
        'relative flex flex-col rounded-md border bg-white dark:bg-background',
        'focus-within:ring-2 focus-within:ring-info'
      )}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onBlur?.()
      }}>
      <EditorContent
        editor={editor}
        className='w-full flex flex-col bg-transparent px-3 py-2 text-[15px] leading-relaxed text-foreground outline-hidden ring-0 min-h-[140px] *:outline-hidden'
      />

      {/* Toolbar row: formatting group + placeholder-chip trigger. */}
      <div className='flex items-center gap-1 border-t px-2 py-1'>
        <EditorToolbar editor={editor} showSend={false} />
        <Tooltip content='Insert placeholder' shortcut='{' allowInteraction>
          <Button
            type='button'
            size='icon-sm'
            variant='ghost'
            className='rounded-full shrink-0'
            onMouseDown={(e) => {
              // Prevent editor blur — keeps the caret in place so the `{` chip
              // opens where the user was typing.
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
          className='z-[100]'
          onClose={closePicker}>
          <PlaceholderSlashContent
            ref={slashRef}
            onClose={closePicker}
            extraRoots={extraRoots}
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
