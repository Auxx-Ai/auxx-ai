// apps/web/src/components/workflow/prompt-editor/prompt-editor-header.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import {
  Clipboard,
  ClipboardCheck,
  Maximize2,
  Minimize2,
  Sparkles,
  Trash,
  Variable,
} from 'lucide-react'
import { memo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { GenerateContentDialog } from '~/components/workflow/dialogs/generate-content-dialog'
import { useWorkflowStore } from '~/components/workflow/store'
import { usePromptEditorContext } from './prompt-editor-context'

type ActionButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode
  ref?: React.Ref<HTMLButtonElement>
}

function ActionButton({ onClick, children, className, ref, ...props }: ActionButtonProps) {
  return (
    <button
      ref={ref}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(e)
      }}
      className={cn(
        'flex size-6 rounded-lg items-center justify-center hover:bg-primary-200 [&_svg]:size-4',
        className
      )}
      {...props}>
      {children}
    </button>
  )
}

function ToggleExpandBtn({
  isExpand,
  onExpandChange,
}: {
  isExpand: boolean
  onExpandChange: (expanded: boolean) => void
}) {
  return (
    <ActionButton onClick={() => onExpandChange(!isExpand)}>
      {isExpand ? <Minimize2 /> : <Maximize2 />}
    </ActionButton>
  )
}

function PromptEditorHeader() {
  const {
    title,
    required,
    value,
    onChange,
    characterCount,
    showRemove,
    showAIGenerate,
    onRemove,
    isExpanded,
    setExpanded,
    handleInsertVariable,
    handleCopy,
    isCopied,
    editable,
    titleClassName,
    headerClassName,
    titleTooltip,
    nodeId,
  } = usePromptEditorContext()

  // Get workflowId from store
  const workflowId = useWorkflowStore((state) => state.workflow?.id)

  // Generate dialog state
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false)

  /**
   * Handle applying generated content
   */
  const handleApplyGenerated = (generatedContent: string) => {
    onChange(generatedContent)
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between pl-3 pr-2 pt-1',
        isExpanded && 'h-10',
        headerClassName
      )}>
      {/* Title section */}
      <div className='flex gap-2'>
        <div
          className={cn(
            'text-xs font-semibold uppercase leading-4 text-primary-500',
            titleClassName
          )}>
          {title}
          {required && <span className='text-destructive'>*</span>}
        </div>
        {titleTooltip && (
          <Tooltip content={titleTooltip}>
            <div className='size-4 rounded-full bg-muted flex items-center justify-center'>
              <span className='text-xs'>?</span>
            </div>
          </Tooltip>
        )}
      </div>

      {/* Operations section */}
      <div className='flex items-center'>
        {/* Character count */}
        <div className='text-xs font-medium leading-[18px] text-primary-500'>{characterCount}</div>

        {/* Divider */}
        <div className='mx-2 h-3 w-px bg-primary-200'></div>

        {/* Operation buttons */}
        <div className='flex items-center space-x-[2px]'>
          {/* Insert variable button */}
          {editable && (
            <Tooltip content='Insert variable'>
              <ActionButton onClick={handleInsertVariable}>
                <Variable />
              </ActionButton>
            </Tooltip>
          )}

          {/* Generate prompt button */}
          {editable && showAIGenerate && workflowId && nodeId && (
            <Tooltip content='Generate Prompt'>
              <ActionButton onClick={() => setIsGenerateDialogOpen(true)}>
                <Sparkles />
              </ActionButton>
            </Tooltip>
          )}

          {/* Copy button */}
          <Tooltip content={isCopied ? 'Copied!' : 'Copy'}>
            <ActionButton onClick={handleCopy}>
              {isCopied ? <ClipboardCheck /> : <Clipboard />}
            </ActionButton>
          </Tooltip>

          {/* Remove button */}
          {showRemove && (
            <Tooltip content='Remove'>
              <ActionButton
                onClick={onRemove}
                className='text-destructive hover:bg-destructive/10 hover:text-destructive'>
                <Trash />
              </ActionButton>
            </Tooltip>
          )}
          <Tooltip content={isExpanded ? 'Close' : 'Expand'}>
            <ToggleExpandBtn isExpand={isExpanded} onExpandChange={setExpanded} />
          </Tooltip>
        </div>
      </div>

      {/* Generate Content Dialog */}
      {workflowId && nodeId && (
        <GenerateContentDialog
          open={isGenerateDialogOpen}
          onOpenChange={setIsGenerateDialogOpen}
          nodeId={nodeId}
          workflowId={workflowId}
          generationType='prompt'
          currentContentValue={value}
          onApply={handleApplyGenerated}
        />
      )}
    </div>
  )
}

export default memo(PromptEditorHeader)
