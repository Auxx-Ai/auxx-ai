import React, { useEffect } from 'react'

import { cn } from '@auxx/ui/lib/utils'

import { EditorContent } from '@tiptap/react'
import { type InputEditorProps } from './types'
import { useTiptapTags } from './use-tiptap-tags'

const TiptapEditor: React.FC<InputEditorProps> = React.memo(
  ({
    value,
    onChange,
    onBlur,
    // placeholder,
    disabled = false,
    readOnly = false,
    nodeId,
    onFocus,
    className,
    // initialContent = '',
    // onContentChange,
    // onBlur,
    // availableTags = [],
    placeholder = 'Start typing...',
    tabIndex,
  }) => {
    const { editor, updateStringContent, flushPendingChanges, isFocused } = useTiptapTags({
      initialContent: value,
      onContentChange: onChange,
      onBlur,
      // variables,
      // groups,
      // allVariables,
      editorOptions: { placeholder },
      nodeId,
      tabIndex,
    })

    useEffect(() => {
      if (editor && nodeId !== undefined) {
        editor.storage.nodeId = nodeId
      }
    }, [editor, nodeId])

    // Handle component unmount - flush any pending changes
    React.useEffect(() => {
      return () => {
        flushPendingChanges()
      }
    }, [flushPendingChanges])

    const showReadOnlyOverlay = disabled || readOnly

    return (
      <div
        className={cn(
          'input-editor-wrapper',
          showReadOnlyOverlay && 'opacity-50 cursor-not-allowed',
          className
        )}
        data-focused={isFocused}
        data-readonly={readOnly}>
        <EditorContent
          editor={editor}
          className="input-editor-field focus:outline-none focus:ring-0 h-full [&>*:first-child]:focus:outline-none"
        />

        {/* Read-only overlay to prevent interaction */}
        {showReadOnlyOverlay && <div className="absolute inset-0 z-10" />}
      </div>
    )
  }
)

export default TiptapEditor
