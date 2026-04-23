// apps/web/src/components/fields/ai-overlay/empty-placeholder.tsx

'use client'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@auxx/ui/components/tooltip'
import { Sparkles } from 'lucide-react'

interface EmptyPlaceholderProps {
  onClick: () => void
}

/**
 * Hover-visible sparkle button on the right side of an empty AI-enabled cell.
 * Stops pointerdown/click propagation so selecting the cell doesn't trigger
 * generation — only an explicit click on the button fires stage-1.
 */
export function EmptyPlaceholder({ onClick }: EmptyPlaceholderProps) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            type='button'
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onClick()
            }}
            className='absolute top-1 right-1 z-16 size-6 flex items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-purple-500 hover:bg-purple-50/30 dark:hover:bg-purple-500/10 pointer-events-auto'>
            <Sparkles className='w-3.5 h-3.5' />
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>
          <span className='text-xs'>Autofill with AI</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
