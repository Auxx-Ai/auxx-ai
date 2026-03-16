// apps/web/src/components/editor/tiptap-editor.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useMemo } from 'react'
import '~/styles/prosemirror.css'
import { useEditorContext } from './editor-context'
import { FontSize } from './extensions'
import { Indent } from './extensions/indent'
import { InlinePickerPopover } from './inline-picker'
import { useSlashCommand } from './inline-picker/hooks/use-slash-command'
import { SlashCommandPicker } from './slash-command-picker'

type TiptapEditorProps = {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
  editable?: boolean
}

const TiptapEditor = ({
  content,
  onChange,
  placeholder = 'Type your reply here...',
  className = '',
  editable = true,
}: TiptapEditorProps) => {
  const { setEditor } = useEditorContext()
  const slashCommand = useSlashCommand()

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Indent,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      slashCommand.slashCommandExtension,
    ],
    [placeholder, slashCommand.slashCommandExtension]
  )

  const editorInstance = useEditor(
    {
      extensions,
      content: content,
      shouldRerenderOnTransaction: false,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: cn(
            'tiptap-email-editor prose prose-sm prose-headings:my-1 prose-ul:my-1 prose-p:my-0 prose-li:my-0 focus:outline-hidden max-w-none dark:prose-invert flex-1',
            className
          ),
        },
      },
      onCreate: ({ editor }) => {
        setEditor(editor)
        slashCommand.setEditor(editor)
      },
      onDestroy: () => {
        setEditor(null)
        slashCommand.setEditor(null)
      },
      onUpdate: ({ editor }) => {
        onChange(editor.getHTML())
      },
    },
    []
  )

  // Synchronize external content changes
  useEffect(() => {
    if (!editorInstance || editorInstance.isDestroyed) return

    const editorHTML = editorInstance.getHTML()
    if (content !== editorHTML) {
      const { from, to } = editorInstance.state.selection
      editorInstance.commands.setContent(content, false)
      try {
        editorInstance.commands.setTextSelection({ from, to })
      } catch {
        editorInstance.commands.focus('end')
      }
    }
  }, [content, editorInstance])

  // Synchronize editable state
  useEffect(() => {
    if (!editorInstance || editorInstance.isDestroyed) return
    editorInstance.setEditable(editable)
  }, [editable, editorInstance])

  return (
    <>
      <EditorContent
        editor={editorInstance}
        className={cn(
          'w-full h-full flex flex-col bg-transparent px-4 py-3 text-[15px] leading-relaxed text-foreground outline-hidden ring-0 sm:min-h-[120px] *:outline-hidden'
        )}
      />
      <InlinePickerPopover
        state={slashCommand.suggestionState}
        onClose={slashCommand.closePicker}
        width={288}>
        <SlashCommandPicker
          query={slashCommand.suggestionState.query}
          onExecute={slashCommand.executeCommand}
          onClose={slashCommand.closePicker}
        />
      </InlinePickerPopover>
    </>
  )
}

export default TiptapEditor
