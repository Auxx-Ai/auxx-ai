// apps/web/src/components/chat-widget/ui/settings/greeting-editor.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, type JSONContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Braces } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  createPlaceholderNode,
  InlinePickerPopover,
  PlaceholderBadge,
  useSlashCommand,
} from '~/components/editor/inline-picker'
import { Tooltip } from '~/components/global/tooltip'
import { VisitorClaimPickerContent } from './visitor-claim-picker-content'

interface GreetingEditorProps {
  /** Tiptap JSON doc, or null for an empty editor. */
  value: JSONContent | null
  /** Fires on every change with the latest Tiptap JSON document. */
  onChange: (doc: JSONContent | null) => void
  placeholder?: string
  /** Applied to the outer wrapper (border, focus ring). */
  wrapperClassName?: string
  /** Applied to the prose content area. */
  className?: string
}

/**
 * Tiptap-based greeting editor for the chat widget Home tab. Same shell as
 * `SnippetEditor` (placeholder node + `{`-triggered picker + fallback editor)
 * but the picker is restricted to the three visitor identify claims and the
 * output is Tiptap JSON instead of HTML.
 */
export function GreetingEditor({
  value,
  onChange,
  placeholder = 'Type { to insert a visitor field...',
  wrapperClassName,
  className,
}: GreetingEditorProps) {
  const slashCommand = useSlashCommand({ trigger: '{', allowedPrefixes: null })
  const containerRef = useRef<HTMLDivElement>(null)

  const placeholderNodeExtension = useMemo(
    () => createPlaceholderNode((badgeProps) => <PlaceholderBadge {...badgeProps} />),
    []
  )

  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: false }),
      Placeholder.configure({ placeholder }),
      slashCommand.slashCommandExtension,
      placeholderNodeExtension,
    ],
    [placeholder, slashCommand.slashCommandExtension, placeholderNodeExtension]
  )

  const editor = useEditor(
    {
      extensions,
      content: value ?? '',
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: cn(
            'tiptap-snippet-editor prose prose-sm prose-headings:my-1 prose-ul:my-1 prose-p:my-0 prose-li:my-0 focus:outline-hidden max-w-none dark:prose-invert flex-1',
            className
          ),
        },
      },
      onCreate: ({ editor }) => {
        slashCommand.setEditor(editor)
      },
      onDestroy: () => {
        slashCommand.setEditor(null)
      },
      onUpdate: ({ editor }) => {
        if (slashCommand.isOpenRef.current) return
        const doc = editor.getJSON()
        onChange(isEmptyDoc(doc) ? null : doc)
      },
    },
    []
  )

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const current = editor.getJSON()
    if (!docsEqual(current, value)) {
      editor.commands.setContent(value ?? '', false)
    }
  }, [editor, value])

  const handleInsertTrigger = useCallback(() => {
    if (!editor) return
    if (!editor.isFocused) editor.commands.focus('end')
    editor.commands.insertContent('{')
  }, [editor])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative rounded-md border focus-within:ring-2 focus-within:ring-info',
        wrapperClassName
      )}>
      <EditorContent
        editor={editor}
        className='w-full h-full flex flex-col bg-transparent px-3 py-2 text-[15px] leading-relaxed text-foreground outline-hidden ring-0 min-h-[80px] *:outline-hidden'
      />
      <div className='absolute bottom-1 right-1'>
        <Tooltip content='Insert visitor field' shortcut='{' allowInteraction>
          <Button
            type='button'
            size='icon-sm'
            variant='ghost'
            onMouseDown={(e) => {
              e.preventDefault()
              handleInsertTrigger()
            }}>
            <Braces />
          </Button>
        </Tooltip>
      </div>
      <InlinePickerPopover
        state={slashCommand.suggestionState}
        width={240}
        className='z-[200]'
        onClose={slashCommand.closePicker}>
        <VisitorClaimPickerContent
          onClose={slashCommand.closePicker}
          onSelect={(id) => {
            slashCommand.executeCommand((editor, range) => {
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
    </div>
  )
}

/**
 * Tiptap's default empty doc is `{ type: 'doc', content: [{ type: 'paragraph' }] }`.
 * Persist `null` for that case so the widget falls back to the default greeting.
 */
function isEmptyDoc(doc: JSONContent): boolean {
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return true
  if (doc.content.length === 0) return true
  if (doc.content.length === 1) {
    const only = doc.content[0]
    if (only?.type === 'paragraph' && (!only.content || only.content.length === 0)) return true
  }
  return false
}

function docsEqual(a: JSONContent | null, b: JSONContent | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
