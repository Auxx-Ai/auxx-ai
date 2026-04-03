// apps/web/src/components/kopilot/ui/messages/message-actions.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { Check, Copy, Pencil, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useCallback, useState } from 'react'

interface MessageActionsProps {
  role: 'user' | 'assistant'
  content: string
  onEdit?: () => void
  onRetry?: () => void
  onThumbsUp?: () => void
  onThumbsDown?: () => void
}

function ActionButton({
  icon: Icon,
  tooltip,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  tooltip: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant='ghost' size='icon' className='h-6 w-6' onClick={onClick}>
          <Icon className='size-3' />
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

  return (
    <div className='opacity-0 group-hover/message:opacity-100 transition-opacity flex items-center gap-0.5'>
      <ActionButton
        icon={copied ? Check : Copy}
        tooltip={copied ? 'Copied' : 'Copy'}
        onClick={handleCopy}
      />

      {role === 'user' && onEdit && <ActionButton icon={Pencil} tooltip='Edit' onClick={onEdit} />}

      {role === 'assistant' && (
        <>
          {onThumbsUp && (
            <ActionButton icon={ThumbsUp} tooltip='Good response' onClick={onThumbsUp} />
          )}
          {onThumbsDown && (
            <ActionButton icon={ThumbsDown} tooltip='Bad response' onClick={onThumbsDown} />
          )}
          {onRetry && <ActionButton icon={RotateCcw} tooltip='Retry' onClick={onRetry} />}
        </>
      )}
    </div>
  )
}
