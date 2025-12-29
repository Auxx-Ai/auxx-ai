// apps/web/src/components/workflow/ui/prompt-editor/prompt-editor-content.tsx

'use client'

import React from 'react'
import { usePromptEditorContext } from './prompt-editor-context'
import TiptapPromptEditor from './tiptap-prompt-editor'
import EditorHeightResizeWrap from '../editor-height-resize-wrap'

/** Header height offset for content area calculation */
const HEADER_HEIGHT_OFFSET = 28

/**
 * PromptEditor Content Component
 * Contains the main editor area with proper styling and layout
 * Adapts sizing based on expanded state
 */
const PromptEditorContent: React.FC = () => {
  const { isExpanded, contentHeight, setContentHeight, minHeight } = usePromptEditorContext()

  // Account for header height (similar to code editor)
  const editorContentMinHeight = minHeight - HEADER_HEIGHT_OFFSET

  // When expanded, use full height layout without resize wrapper
  if (isExpanded) {
    return (
      <div className="h-full pb-0">
        <div className="relative h-full min-h-0 overflow-y-auto px-3 flex-1 flex">
          <TiptapPromptEditor />
        </div>
      </div>
    )
  }

  // Inline view with resize wrapper
  return (
    <EditorHeightResizeWrap
      height={contentHeight}
      minHeight={editorContentMinHeight}
      onHeightChange={setContentHeight}
      hideResize={false}>
      <div className="relative px-3 pb-2 flex min-h-0 flex-1">
        <TiptapPromptEditor />
      </div>
    </EditorHeightResizeWrap>
  )
}

export default PromptEditorContent
