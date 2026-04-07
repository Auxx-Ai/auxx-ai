// apps/web/src/components/kopilot/ui/messages/message-actions.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Copy, Pencil, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useCallback, useState } from 'react'

interface MessageActionsProps {
  role: 'user' | 'assistant'
  content: string
  feedback?: { isPositive: boolean }
  onEdit?: () => void
  onRetry?: () => void
  onThumbsUp?: () => void
  onThumbsDown?: () => void
}

function ActionButton({
  icon: Icon,
  tooltip,
  onClick,
  active,
  activeColor,
}: {
  icon: React.ComponentType<{ className?: string }>
  tooltip: string
  onClick: () => void
  active?: boolean
  activeColor?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className={cn('h-6 w-6', active && activeColor)}
          onClick={onClick}>
          <Icon className={cn('size-3', active && 'fill-current')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side='bottom' className='text-xs'>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

export function MessageActions({
  role,
  content,
  feedback,
  onEdit,
  onRetry,
  onThumbsUp,
  onThumbsDown,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    // Strip HTML tags for plain text copy
    const text = content.replace(/<[^>]*>/g, '')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [content])

  const hasFeedback = feedback != null

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 transition-opacity',
        hasFeedback ? 'opacity-100' : 'opacity-0 group-hover/message:opacity-100'
      )}>
      <ActionButton
        icon={copied ? Check : Copy}
        tooltip={copied ? 'Copied' : 'Copy'}
        onClick={handleCopy}
      />

      {role === 'user' && (
        <>
          {onEdit && <ActionButton icon={Pencil} tooltip='Edit' onClick={onEdit} />}
          {onRetry && <ActionButton icon={RotateCcw} tooltip='Retry' onClick={onRetry} />}
        </>
      )}

      {role === 'assistant' && (
        <>
          {onThumbsUp && (
            <ActionButton
              icon={ThumbsUp}
              tooltip='Good response'
              onClick={onThumbsUp}
              active={feedback?.isPositive === true}
              activeColor='text-green-500'
            />
          )}
          {onThumbsDown && (
            <ActionButton
              icon={ThumbsDown}
              tooltip='Bad response'
              onClick={onThumbsDown}
              active={feedback?.isPositive === false}
              activeColor='text-red-500'
            />
          )}
        </>
      )}
    </div>
  )
}
