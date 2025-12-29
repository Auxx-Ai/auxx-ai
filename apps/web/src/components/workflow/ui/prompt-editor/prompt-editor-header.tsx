// apps/web/src/components/workflow/prompt-editor/prompt-editor-header.tsx

'use client'

import React, { memo, useState } from 'react'
import { Variable, Clipboard, ClipboardCheck, Trash, Maximize2, Minimize2, Sparkles } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { usePromptEditorContext } from './prompt-editor-context'
import { Tooltip } from '~/components/global/tooltip'
import { GenerateContentDialog } from '~/components/workflow/dialogs/generate-content-dialog'
import { useWorkflowStore } from '~/components/workflow/store'

/**
 * Action button component for header operations
 * Uses forwardRef for compatibility with Radix UI Tooltip
 */
const ActionButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: React.ReactNode
  }
>(({ onClick, children, className, ...props }, ref) => (
  <button
    ref={ref}
    onClick={(e) => {
      e.stopPropagation()
      onClick?.(e)
    }}
    className={cn(
      'flex size-6 rounded-lg items-center justify-center hover:bg-primary-200',
      className
    )}
    {...props}>
    {children}
  </button>
))
ActionButton.displayName = 'ActionButton'

/**
 * Toggle expand button component
 */
const ToggleExpandBtn: React.FC<{
  isExpand: boolean
  onExpandChange: (expanded: boolean) => void
}> = ({ isExpand, onExpandChange }) => (
  <ActionButton onClick={() => onExpandChange(!isExpand)}>
    {isExpand ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
  </ActionButton>
)

/**
 * PromptEditor Header Component
 * Contains title, character count, and operation buttons
 * Uses context to eliminate prop drilling
 */
const PromptEditorHeader: React.FC = () => {
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
      <div className="flex gap-2">
        <div
          className={cn(
            'text-xs font-semibold uppercase leading-4 text-primary-500',
            titleClassName
          )}>
          {title}
          {required && <span className="text-destructive">*</span>}
        </div>
        {titleTooltip && (
          <Tooltip content={titleTooltip}>
            <div className="size-4 rounded-full bg-muted flex items-center justify-center">
              <span className="text-xs">?</span>
            </div>
          </Tooltip>
        )}
      </div>

      {/* Operations section */}
      <div className="flex items-center">
        {/* Character count */}
        <div className="text-xs font-medium leading-[18px] text-primary-500">{characterCount}</div>

        {/* Divider */}
        <div className="mx-2 h-3 w-px bg-primary-200"></div>

        {/* Operation buttons */}
        <div className="flex items-center space-x-[2px]">
          {/* Insert variable button */}
          {editable && (
            <Tooltip content="Insert variable">
              <ActionButton onClick={handleInsertVariable}>
                <Variable className="size-4" />
              </ActionButton>
            </Tooltip>
          )}

          {/* Generate prompt button */}
          {editable && showAIGenerate && workflowId && nodeId && (
            <Tooltip content="Generate Prompt">
              <ActionButton onClick={() => setIsGenerateDialogOpen(true)}>
                <Sparkles className="size-4" />
              </ActionButton>
            </Tooltip>
          )}

          {/* Remove button */}
          {showRemove && (
            <Tooltip content="Remove">
              <ActionButton onClick={onRemove}>
                <Trash className="size-4" />
              </ActionButton>
            </Tooltip>
          )}

          {/* Copy button */}
          <Tooltip content={isCopied ? 'Copied!' : 'Copy'}>
            <ActionButton onClick={handleCopy}>
              {isCopied ? <ClipboardCheck className="size-4" /> : <Clipboard className="size-4" />}
            </ActionButton>
          </Tooltip>

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
          generationType="prompt"
          currentContentValue={value}
          onApply={handleApplyGenerated}
        />
      )}
    </div>
  )
}

export default memo(PromptEditorHeader)
