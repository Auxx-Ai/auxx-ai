// apps/web/src/components/workflow/nodes/core/note/editor/note-editor.tsx

import { cn } from '@auxx/ui/lib/utils'
import { EditorContent, useEditor } from '@tiptap/react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { getNoteEditorExtensions } from './extensions'

interface NoteEditorProps {
  content: string
  onChange: (content: string) => void
  placeholder?: string
  fontSize?: number
  editable?: boolean
  theme?: { bg: string; border: string; title: string; text: string }
  onEditorReady?: (editor: any) => void
  onFocus?: () => void
  onBlur?: () => void
}

export const NoteEditor: React.FC<NoteEditorProps> = ({
  content,
  onChange,
  placeholder = 'Write your note...',
  fontSize = 14,
  editable = true,
  theme,
  onEditorReady,
  onFocus,
  onBlur,
}) => {
  const [isFocused, setIsFocused] = useState(false)

  const editor = useEditor({
    shouldRerenderOnTransaction: false,
    immediatelyRender: false,
    extensions: getNoteEditorExtensions(placeholder),
    content: content || '<p></p>',
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    onFocus: () => {
      setIsFocused(true)
      onFocus?.()
    },
    onBlur: () => {
      setIsFocused(false)
      onBlur?.()
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm max-w-none focus:outline-none',
          theme?.text || 'text-muted',
          'prose-p:my-1 prose-ul:my-1 prose-li:my-0',
          'prose-strong:text-primary-500',
          'prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline',
          'min-h-full'
        ),
        style: `font-size: ${fontSize}px`,
      },
    },
  })

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor)
    }
  }, [editor, onEditorReady])

  // Update editor content when it changes externally
  useEffect(() => {
    if (editor && content !== editor.getHTML() && !editor.isFocused) {
      editor.commands.setContent(content, false)
    }
  }, [editor, content])

  // Update font size
  useEffect(() => {
    if (editor) {
      editor.chain().setFontSize(`${fontSize}px`).run()
    }
  }, [editor, fontSize])

  // Cleanup
  useEffect(() => {
    return () => {
      editor?.destroy()
    }
  }, [editor])

  return (
    <EditorContent
      editor={editor}
      className={cn('h-full w-full overflow-y-auto', !isFocused && 'hide-placeholder')}
    />
  )
}
