// apps/web/src/components/workflow/ui/prompt-editor/prompt-editor-wrapper.tsx

'use client'

import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'
import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { useRef } from 'react'
import PromptEditorContent from './prompt-editor-content'
import { usePromptEditorContext } from './prompt-editor-context'
import PromptEditorHeader from './prompt-editor-header'

/**
 * PromptEditor Wrapper Component
 * Supports expand-to-dialog for full-screen editing
 */
const PromptEditorWrapper: React.FC = () => {
  const { isExpanded, setExpanded, isFocused, gradientBorder, title } = usePromptEditorContext()

  const ref = useRef<HTMLDivElement>(null)

  return (
    <>
      {/* Inline view - always rendered, content hidden when expanded */}
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
            isFocused ? 'bg-background' : 'bg-primary-200/30',
            'pb-2 rounded-lg border'
          )}>
          <PromptEditorHeader />
          {!isExpanded && <PromptEditorContent />}
        </div>
      </div>

      {/* Expanded dialog view */}
      <Dialog open={isExpanded} onOpenChange={setExpanded}>
        <DialogContent size='3xl' innerClassName='h-[80vh] flex flex-col p-0' showClose={false}>
          <VisuallyHidden>
            <DialogTitle>{title || 'Prompt Editor'}</DialogTitle>
          </VisuallyHidden>

          {/* Re-render header in dialog for context */}
          <div className='shrink-0 border-b'>
            <PromptEditorHeader />
          </div>

          {/* Content fills remaining space */}
          <div className='flex-1 min-h-0 overflow-hidden'>
            <PromptEditorContent />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default PromptEditorWrapper
