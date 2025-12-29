// ~/components/global/editor/tiptap-editor.tsx
import React, { useEffect, useMemo } from 'react'
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import { useEditorContext } from './editor-context'

// --- Tiptap Extensions ---
import StarterKit from '@tiptap/starter-kit'
import TextStyle from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
// import FontSize from '@tiptap/extension-font-size'
import Color from '@tiptap/extension-color'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { SlashCommand } from './slash-command' // Adjust path if needed
import { cn } from '@auxx/ui/lib/utils'
import { Indent } from './extensions/indent'
import { FontSize } from './extensions'
// --- End Tiptap Extensions ---

type TiptapEditorProps = {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string // Optional class specifically for EditorContent container
  editable?: boolean
}

const TiptapEditor = ({
  content,
  onChange,
  placeholder = 'Type your reply here...',
  className = '', // Default to empty string
  editable = true,
}: TiptapEditorProps) => {
  // Get the setter function from the context
  const { setEditor } = useEditorContext()

  // Memoize extensions to avoid new instances across renders
  const extensions = useMemo(
    () => [
      // StarterKit,
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
      SlashCommand,
    ],
    [placeholder]
  )

  // Initialize the editor instance using the useEditor hook (instantiate once)
  const editorInstance = useEditor(
    {
      // --- Extension Configuration ---
      extensions,
      // --- End Extension Configuration ---

      // Set initial content
      content: content,
      shouldRerenderOnTransaction: false,
      immediatelyRender: false,
      // Define editor properties (styling, attributes)
      editorProps: {
        attributes: {
          // Apply core styling (padding, min-height, focus outline removal) directly to the editable area
          // class: `prose prose-headings:my-1 prose-ul:my-1 prose-p:my-0 prose-li:my-0  prose-sm sm:prose lg:prose-lg xl:prose-2xl focus:outline-hidden w-full max-w-none p-4 min-h-[150px]`,
          class: cn(
            'prose prose-sm prose-headings:my-1 prose-ul:my-1 prose-p:my-0 prose-li:my-0 focus:outline-hidden max-w-none dark:prose-invert flex-1',
            className
          ), //min-h-[300px]
        },
      },

      // --- Lifecycle Callbacks ---
      // Update the shared context when the editor is created
      onCreate: ({ editor }) => {
        setEditor(editor)
      },

      // Clear the shared context when the editor is destroyed
      onDestroy: () => {
        setEditor(null)
      },

      // Handle content updates and notify the parent component
      onUpdate: ({ editor }) => {
        onChange(editor.getHTML())
      },
      // --- End Lifecycle Callbacks ---
    },
    []
  )

  // --- Effect to Synchronize External Content Changes ---
  // Handles cases where the `content` prop changes from outside (e.g., clearing the editor)
  useEffect(() => {
    if (!editorInstance || editorInstance.isDestroyed) return

    const editorHTML = editorInstance.getHTML()

    // Only update if the external content is truly different
    if (content !== editorHTML) {
      console.log('External content change detected, updating editor.')
      // Keep track of selection to potentially restore it
      const { from, to } = editorInstance.state.selection
      // Set content without triggering another onUpdate
      editorInstance.commands.setContent(content, false)
      // Attempt to restore selection to prevent cursor jump
      // This might need adjustments based on the nature of content changes
      try {
        editorInstance.commands.setTextSelection({ from, to })
      } catch (e) {
        // console.warn("Could not restore selection after content update:", e);
        // Fallback: move cursor to the end
        editorInstance.commands.focus('end')
      }
    }
  }, [content, editorInstance]) // Rerun when external content or editor instance changes
  // --- End Effect ---

  // Synchronize editable state without re-instantiating the editor
  useEffect(() => {
    if (!editorInstance || editorInstance.isDestroyed) return
    editorInstance.setEditable(editable)
  }, [editable, editorInstance])

  // Render only the EditorContent area, controlled by the hook
  return (
    <EditorContent
      editor={editorInstance}
      className={cn(
        'w-full h-full flex flex-col bg-transparent px-4 py-3 text-[15px] leading-relaxed text-foreground outline-hidden ring-0 sm:min-h-[120px] *:outline-hidden'
      )}
    />
  )
}

export default TiptapEditor
