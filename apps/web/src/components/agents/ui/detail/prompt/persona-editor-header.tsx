// apps/web/src/components/agents/ui/detail/prompt/persona-editor-header.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Clipboard, ClipboardCheck, Maximize2, Minimize2 } from 'lucide-react'
import React from 'react'
import { Tooltip } from '~/components/global/tooltip'

interface PersonaEditorHeaderProps {
  title: string
  characterCount: number
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

export function PersonaEditorHeader({
  title,
  characterCount,
  isExpanded,
  setExpanded,
  isCopied,
  onCopy,
  headerClassName,
  titleClassName,
}: PersonaEditorHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between pl-3 pr-2 pt-1',
        isExpanded && 'h-10',
        headerClassName
      )}>
      <div className='flex gap-2'>
        <div
          className={cn(
            'text-xs font-semibold uppercase leading-4 text-primary-500',
            titleClassName
          )}>
          {title}
        </div>
      </div>

      <div className='flex items-center'>
        <div className='text-xs font-medium leading-[18px] text-primary-500'>{characterCount}</div>

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
}
