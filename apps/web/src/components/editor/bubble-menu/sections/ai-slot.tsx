// apps/web/src/components/editor/bubble-menu/sections/ai-slot.tsx
'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { Sparkles } from 'lucide-react'
import { BubbleSection } from '../bubble-menu'
import { BubbleToggleButton } from '../ui/bubble-toggle-button'

interface AISlotPlaceholderProps {
  onClick?: () => void
}

/** Placeholder AI button — real behavior wired in a follow-up. */
export function AISlotPlaceholder({ onClick }: AISlotPlaceholderProps) {
  return (
    <BubbleSection>
      <Tooltip>
        <TooltipTrigger asChild>
          <BubbleToggleButton
            aria-label='Ask AI'
            className='gap-1 px-2 text-primary'
            onClick={onClick}>
            <Sparkles />
            <span className='text-xs font-medium'>AI</span>
          </BubbleToggleButton>
        </TooltipTrigger>
        <TooltipContent>Ask AI (coming soon)</TooltipContent>
      </Tooltip>
    </BubbleSection>
  )
}
