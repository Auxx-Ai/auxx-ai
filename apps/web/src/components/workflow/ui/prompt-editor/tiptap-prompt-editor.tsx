// apps/web/src/components/workflow/ui/prompt-editor/tiptap-prompt-editor.tsx

'use client'

import React, { useRef, useCallback, useEffect } from 'react'
import { EditorContent } from '@tiptap/react'
import { cn } from '@auxx/ui/lib/utils'
import { usePromptEditorContext } from './prompt-editor-context'
import { InlinePickerPopover } from '~/components/editor/inline-picker'
import { VariableExplorerEnhanced } from '../variables/variable-explorer-enhanced'
import { useWorkflowVariableEditor } from '../input-editor/hooks/use-workflow-variable-editor'
import './tiptap-prompt-editor.css'

/**
 * Core TiptapPromptEditor component.
 * Uses context instead of props to eliminate prop drilling.
 * Uses the new inline-picker system for React-driven variable picker UI.
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

  const containerRef = useRef<HTMLDivElement>(null)

  // Multi-line editor needs different className (no whitespace-nowrap)
  const editorClassName = cn(
    'prose prose-sm max-w-none focus:outline-none flex-1',
    compact ? 'text-[13px] leading-5' : 'text-sm leading-5',
    'text-primary-500',
    'prose-p:my-0 prose-ul:my-1 prose-li:my-0',
    className,
    inputClassName
  )

  const {
    editor,
    suggestionState,
    insertVariable,
    closePicker,
    isFocused,
    setContent,
    flushPendingChanges,
  } = useWorkflowVariableEditor({
    initialContent: value,
    placeholder,
    className: editorClassName,
    nodeId,
    onContentChange: onChange,
    onBlur,
    editable,
  })

  // Update context focus state when isFocused changes
  useEffect(() => {
    setFocused(isFocused)
  }, [isFocused, setFocused])

  // Store editor reference in context for external access
  useEffect(() => {
    if (editorRef) {
      editorRef.current = editor
    }

    // Initialize character count when editor is ready
    if (editor) {
      const textContent = editor.getText()
      setCharacterCount(textContent.length)
    }
  }, [editor, editorRef, setCharacterCount])

  // Handle component unmount - flush any pending changes
  useEffect(() => {
    return () => {
      flushPendingChanges()
    }
  }, [flushPendingChanges])

  // Sync external value changes to editor (e.g., from Apply button in generate dialog)
  useEffect(() => {
    if (editor && value !== undefined) {
      setContent(value)
    }
  }, [value, editor, setContent])

  /**
   * Handle Escape key - prevent parent dialog close when inside command picker
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && e.target instanceof HTMLElement && e.target.closest('[cmdk-root]')) {
      e.preventDefault()
      e.stopPropagation()
    }
  }, [])

  const showReadOnlyOverlay = !editable

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 flex"
      onKeyDown={handleKeyDown}>
      <EditorContent
        editor={editor}
        className={cn(
          'min-h-[56px] w-full flex-1 flex',
          compact ? 'text-[13px] leading-5' : 'text-sm leading-6',
          'outline-none ring-0 focus-within:outline-none',
          className
        )}
      />

      {/* Variable picker popover */}
      <InlinePickerPopover
        state={suggestionState}
        containerRef={containerRef}
        onClose={closePicker}
        width={400}>
        <VariableExplorerEnhanced
          nodeId={nodeId}
          onVariableSelect={(variable) => insertVariable(variable.id)}
          className="max-h-[400px]"
          placeholder="Type in editor to filter..."
        />
      </InlinePickerPopover>

      {showReadOnlyOverlay && <div className="absolute inset-0 z-10" />}
    </div>
  )
}

export default TiptapPromptEditor
