// apps/web/src/components/workflow/ui/code-editor/code-editor-wrapper.tsx

'use client'

import React, { useRef } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { useCodeEditorContext } from './code-editor-context'
import { CodeLanguage } from './types'
import CodeEditorHeader from './code-editor-header'
import CodeEditorContent from './code-editor-content'
import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'

/**
 * CodeEditor Wrapper Component
 * Supports expand-to-dialog for full-screen editing
 */
const CodeEditorWrapper: React.FC = () => {
  const {
    isExpanded,
    setIsExpanded,
    isFocused,
    gradientBorder,
    noWrapper,
    nodeId,
    enableWorkflowCompletions,
    language,
    title,
  } = useCodeEditorContext()

  const ref = useRef<HTMLDivElement>(null)

  // Check if we should allow overflow for completions
  const shouldAllowOverflow =
    nodeId && enableWorkflowCompletions && language === CodeLanguage.javascript

  // Handle noWrapper case
  if (noWrapper) {
    return <CodeEditorContent />
  }

  return (
    <>
      {/* Inline view */}
      <div
        ref={ref}
        className={cn(
          isFocused
            ? gradientBorder && 'bg-gradient-to-r from-[#0ba5ec] to-[#155aef]'
            : 'bg-transparent',
          '!rounded-[9px] p-0.5 w-full'
        )}>
        <div
          className={cn(
            isFocused ? 'bg-background' : 'bg-primary-100',
            'rounded-lg border',
            shouldAllowOverflow ? 'overflow-visible' : 'overflow-hidden'
          )}>
          <CodeEditorHeader />
          {!isExpanded && <CodeEditorContent />}
        </div>
      </div>

      {/* Expanded dialog view */}
      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent size="3xl" innerClassName="h-[80vh] flex flex-col p-0" showClose={false}>
          <VisuallyHidden>
            <DialogTitle>{title || 'Code Editor'}</DialogTitle>
          </VisuallyHidden>

          <div className="shrink-0 border-b">
            <CodeEditorHeader />
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            <CodeEditorContent />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default React.memo(CodeEditorWrapper)
