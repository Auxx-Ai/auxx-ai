// apps/web/src/components/workflow/ui/prompt-editor/prompt-editor-content.tsx

'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import type React from 'react'
import EditorHeightResizeWrap from '../editor-height-resize-wrap'
import { usePromptEditorContext } from './prompt-editor-context'
import TiptapPromptEditor from './tiptap-prompt-editor'

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
      <div className='h-full pb-0'>
        <ScrollArea
          className='relative h-full min-h-0 px-3 flex-1 flex'
          fadeClassName=''
          allowScrollChaining
          scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'>
          <TiptapPromptEditor />
        </ScrollArea>
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
      <div className='relative px-3 pb-2 flex min-h-0 flex-1'>
        <TiptapPromptEditor />
      </div>
    </EditorHeightResizeWrap>
  )
}

export default PromptEditorContent
