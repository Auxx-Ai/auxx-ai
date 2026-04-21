// apps/web/src/app/(protected)/app/settings/snippets/_components/snippet-editor.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { SquareSlash } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  createPlaceholderNode,
  InlinePickerPopover,
  PlaceholderBadge,
  useSlashCommand,
} from '~/components/editor/inline-picker'
import { PlaceholderPickerContent } from '~/components/editor/placeholders/placeholder-picker-content'

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
  placeholder = 'Type / to insert a placeholder...',
  wrapperClassName,
  className,
}: SnippetEditorProps) {
  const slashCommand = useSlashCommand()
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
            'tiptap-snippet-editor prose prose-sm prose-p:my-0 focus:outline-hidden max-w-none dark:prose-invert min-h-[160px] px-3 py-2',
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

  const handleInsertSlash = useCallback(() => {
    if (!editor) return
    editor.chain().focus('end').insertContent('/').run()
  }, [editor])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative rounded-md border focus-within:ring-2 focus-within:ring-info',
        wrapperClassName
      )}>
      <EditorContent editor={editor} />
      <div className='absolute bottom-1 right-1'>
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          onClick={handleInsertSlash}
          title='Insert placeholder'>
          <SquareSlash />
        </Button>
      </div>
      <InlinePickerPopover
        state={slashCommand.suggestionState}
        width={288}
        onClose={slashCommand.closePicker}>
        <PlaceholderPickerContent
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
