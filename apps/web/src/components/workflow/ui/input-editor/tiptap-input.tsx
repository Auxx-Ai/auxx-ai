// apps/web/src/components/workflow/ui/input-editor/tiptap-input.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { EditorContent } from '@tiptap/react'
import React, { useCallback, useEffect, useRef } from 'react'
import { InlinePickerPopover } from '~/components/editor/inline-picker'
import { VariableExplorerEnhanced } from '../variables/variable-explorer-enhanced'
import { useWorkflowVariableEditor } from './hooks/use-workflow-variable-editor'
import type { InputEditorProps } from './types'

/**
 * TiptapInput component for workflow variable editing.
 * Uses the new inline-picker system for cleaner React-driven UI.
 */
const TiptapInput: React.FC<InputEditorProps> = React.memo(
  ({
    value,
    onChange,
    onBlur,
    disabled = false,
    readOnly = false,
    nodeId,
    onFocus,
    className,
    placeholder = 'Start typing...',
    tabIndex,
    expectedTypes,
  }) => {
    const containerRef = useRef<HTMLDivElement>(null)

    const { editor, suggestionState, insertVariable, closePicker, flushPendingChanges, isFocused } =
      useWorkflowVariableEditor({
        initialContent: value,
        onContentChange: onChange,
        onBlur,
        onFocus,
        nodeId,
        placeholder,
        tabIndex,
        expectedTypes,
        editable: !disabled && !readOnly,
      })

    // Handle component unmount - flush any pending changes
    useEffect(() => {
      return () => {
        flushPendingChanges()
      }
    }, [flushPendingChanges])

    /**
     * Handle Escape key - prevent parent dialog close when inside command picker
     * (Same pattern as task-dialog.tsx)
     */
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        e.target instanceof HTMLElement &&
        e.target.closest('[cmdk-root]')
      ) {
        e.preventDefault()
        e.stopPropagation()
      }
    }, [])

    const showReadOnlyOverlay = disabled || readOnly

    return (
      <div
        ref={containerRef}
        className={cn(
          'input-editor-wrapper relative',
          showReadOnlyOverlay && 'opacity-50 cursor-not-allowed',
          className
        )}
        data-focused={isFocused}
        data-readonly={readOnly}
        onKeyDown={handleKeyDown}>
        <EditorContent
          editor={editor}
          className='input-editor-field focus:outline-none focus:ring-0 h-full [&>*:first-child]:focus:outline-none'
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
            allowedTypes={expectedTypes}
            className='max-h-[400px]'
            placeholder='Type in editor to filter...'
            onClose={closePicker}
          />
        </InlinePickerPopover>

        {/* Read-only overlay to prevent interaction */}
        {showReadOnlyOverlay && <div className='absolute inset-0 z-10' />}
      </div>
    )
  }
)

TiptapInput.displayName = 'TiptapInput'

export default TiptapInput
