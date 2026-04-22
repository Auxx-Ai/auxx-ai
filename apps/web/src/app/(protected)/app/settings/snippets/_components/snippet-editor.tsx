// apps/web/src/app/(protected)/app/settings/snippets/_components/snippet-editor.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Braces } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  createPlaceholderNode,
  InlinePickerPopover,
  PlaceholderBadge,
  useSlashCommand,
} from '~/components/editor/inline-picker'
import { PlaceholderPickerContent } from '~/components/editor/placeholders/placeholder-picker-content'
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
}

/**
 * Tiptap-based snippet body editor. Supports the placeholder inline node +
 * a `/`-triggered placeholder picker (no heading / list / snippet commands —
 * those belong to the reply composer's broader slash menu).
 */
export function SnippetEditor({
  contentHtml,
  onChange,
  placeholder = 'Type { to insert a placeholder...',
  wrapperClassName,
  className,
}: SnippetEditorProps) {
  // `{` triggers the placeholder picker. allowedPrefixes: null means the
  // trigger fires mid-word too — snippet authors often type prose like
  // "Hi {first_name}," where the `{` directly follows non-space text.
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
      onCreate: ({ editor }) => {
        slashCommand.setEditor(editor)
      },
      onDestroy: () => {
        slashCommand.setEditor(null)
      },
      onUpdate: ({ editor }) => {
        if (slashCommand.isOpenRef.current) return
        onChange(editor.getHTML(), editor.getText())
      },
    },
    []
  )

  // Sync external contentHtml changes (e.g. loading an existing snippet)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (editor.getHTML() !== contentHtml) {
      editor.commands.setContent(contentHtml, false)
    }
  }, [editor, contentHtml])

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
        className='w-full h-full flex flex-col bg-transparent px-3 py-2 text-[15px] leading-relaxed text-foreground outline-hidden ring-0 min-h-[160px] *:outline-hidden'
      />
      <div className='absolute bottom-1 right-1'>
        <Tooltip content='Insert placeholder' shortcut='{' allowInteraction>
          <Button
            type='button'
            size='icon-sm'
            variant='ghost'
            onMouseDown={(e) => {
              // Prevent editor blur when clicking — keeps the Suggestion plugin
              // state alive so inserting "{" opens the picker.
              e.preventDefault()
              handleInsertTrigger()
            }}>
            <Braces />
          </Button>
        </Tooltip>
      </div>
      <InlinePickerPopover
        state={slashCommand.suggestionState}
        width={288}
        className='z-[200]'
        onClose={slashCommand.closePicker}>
        <PlaceholderPickerContent
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
