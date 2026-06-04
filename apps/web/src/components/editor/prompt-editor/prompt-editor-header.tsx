// apps/web/src/components/editor/prompt-editor/prompt-editor-header.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ChevronLeft, Clipboard, ClipboardCheck, Maximize2, Minimize2 } from 'lucide-react'
import React from 'react'
import { Tooltip } from '~/components/global/tooltip'

interface PromptEditorHeaderProps {
  title: string
  /**
   * When set, a back `ActionButton` renders before the title (used by the
   * procedure editor's drill-in NavStack to pop a level). Omit for the flat
   * persona / workflow headers.
   */
  onBack?: () => void
  /**
   * Character-count slot — rendered as-is between the title and the
   * action buttons. Passed in by the parent (typically `PromptCharacterCount`)
   * so the count can update via direct DOM mutation without re-rendering
   * this header on every keystroke.
   */
  countSlot?: React.ReactNode
  isExpanded: boolean
  setExpanded: (expanded: boolean) => void
  isCopied: boolean
  onCopy: () => void
  headerClassName?: string
  titleClassName?: string
}

const ActionButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }
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

export const PromptEditorHeader = React.memo(function PromptEditorHeader({
  title,
  onBack,
  countSlot,
  isExpanded,
  setExpanded,
  isCopied,
  onCopy,
  headerClassName,
  titleClassName,
}: PromptEditorHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between pl-3 pr-2 pt-1',
        isExpanded && 'h-10',
        headerClassName
      )}>
      <div className='flex items-center gap-1'>
        {onBack && (
          <Tooltip content='Back'>
            <ActionButton onClick={onBack} aria-label='Back' className='-ml-1.5'>
              <ChevronLeft className='size-4' />
            </ActionButton>
          </Tooltip>
        )}
        <div
          className={cn(
            'text-xs font-semibold uppercase leading-4 text-primary-500',
            titleClassName
          )}>
          {title}
        </div>
      </div>

      <div className='flex items-center'>
        {countSlot}

        <div className='mx-2 h-3 w-px bg-primary-200' />

        <div className='flex items-center space-x-[2px]'>
          <Tooltip content={isCopied ? 'Copied!' : 'Copy'}>
            <ActionButton onClick={onCopy}>
              {isCopied ? <ClipboardCheck className='size-4' /> : <Clipboard className='size-4' />}
            </ActionButton>
          </Tooltip>

          <Tooltip content={isExpanded ? 'Close' : 'Expand'}>
            <ActionButton onClick={() => setExpanded(!isExpanded)}>
              {isExpanded ? <Minimize2 className='size-4' /> : <Maximize2 className='size-4' />}
            </ActionButton>
          </Tooltip>
        </div>
      </div>
    </div>
  )
})
