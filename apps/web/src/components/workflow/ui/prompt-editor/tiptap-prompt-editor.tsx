// apps/web/src/components/workflow/prompt-editor/tiptap-prompt-editor.tsx

'use client'

import React, { useEffect } from 'react'
import { EditorContent } from '@tiptap/react'
import { cn } from '@auxx/ui/lib/utils'
import { usePromptEditorContext } from './prompt-editor-context'
import { PluginKey } from '@tiptap/pm/state'
import './tiptap-prompt-editor.css'
import { useTiptapTags } from '../input-editor/use-tiptap-tags'

// Plugin key for the workflow variable picker suggestion
const suggestionPluginKey = new PluginKey('workflow-variable-picker-suggestion')

/**
 * Core TiptapPromptEditor component
 * Uses context instead of props to eliminate prop drilling
 */
const TiptapPromptEditor: React.FC = () => {
  const {
    value,
    onChange,
    placeholder,
    setFocused,
    editable,
    compact,
    className,
    inputClassName,
    onBlur,
    editorRef,
    setCharacterCount,
    nodeId,
  } = usePromptEditorContext()

  // Helper to determine if content is JSON
  const isJsonContent = (content: string): boolean => {
    if (!content || typeof content !== 'string') return false
    try {
      const parsed = JSON.parse(content)
      return parsed && typeof parsed === 'object' && parsed.type
    } catch {
      return false
    }
  }

  // Ref to track the latest content for blur handler
  // Initialize with the current value
  const latestContentRef = React.useRef<string>(value || '')

  const { editor, isFocused, setContent } = useTiptapTags({
    editorOptions: {
      className: cn(
        'prose prose-sm max-w-none focus:outline-none flex-1',
        // Compact mode styling
        compact ? 'text-[13px] leading-5' : 'text-sm leading-5',
        // Text color
        'text-primary-500',
        // Remove default prose margins for workflow context
        'prose-p:my-0 prose-ul:my-1 prose-li:my-0',
        className,
        inputClassName
      ),
      placeholder,
    },
    initialContent: value,
    onContentChange: onChange,
    onBlur,
    nodeId,
  })

  useEffect(() => {
    // Update the editor's focus state when isFocused changes
    setFocused(isFocused)
  }, [isFocused])

  // Store editor reference in context for external access
  useEffect(() => {
    if (editorRef) {
      editorRef.current = editor
    }

    // Initialize character count when editor is ready
    if (editor) {
      const textContent = editor.getText()
      setCharacterCount(textContent.length)

      // If initial value was HTML, convert to JSON format for future saves
      if (value && !isJsonContent(value)) {
        const jsonContent = JSON.stringify(editor.getJSON())
        latestContentRef.current = jsonContent
      }
    }
  }, [editor, editorRef, setCharacterCount, value])

  // Clean up editor on unmount
  useEffect(() => {
    return () => {
      editor?.destroy()
    }
  }, [editor])

  // Update nodeId in editor storage when it changes
  useEffect(() => {
    if (editor && nodeId !== undefined) {
      editor.storage.nodeId = nodeId
    }
  }, [editor, nodeId])

  // Sync external value changes to editor (e.g., from Apply button in generate dialog)
  useEffect(() => {
    if (editor && value !== undefined) {
      // Only update if the value is different from what the editor has
      // This prevents resetting the editor when the user is typing
      setContent(value)
    }
  }, [value, editor, setContent])

  const showReadOnlyOverlay = !editable

  return (
    <div className="relative flex-1 min-h-0 flex">
      <EditorContent
        editor={editor}
        className={cn(
          // Base container styling
          'min-h-[56px] w-full flex-1 flex',
          // Match existing editor styling
          compact ? 'text-[13px] leading-5' : 'text-sm leading-6',
          // Focus and interaction states
          'outline-none ring-0 focus-within:outline-none',
          className
        )}
      />

      {showReadOnlyOverlay && <div className="absolute inset-0 z-10" />}
    </div>
  )
}

export default TiptapPromptEditor
