// apps/web/src/components/editor/bubble-menu/sections/more-menu.tsx
'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import type { Editor } from '@tiptap/react'
import { Eraser, MoreHorizontal } from 'lucide-react'
import { useBubbleSubPopover } from '../bubble-menu-context'
import { BubbleToggleButton } from '../ui/bubble-toggle-button'

interface MoreMenuSectionProps {
  editor: Editor
}

export function MoreMenuSection({ editor }: MoreMenuSectionProps) {
  const onOpenChange = useBubbleSubPopover()
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <BubbleToggleButton aria-label='More options'>
              <MoreHorizontal />
            </BubbleToggleButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='end' className='w-44'>
        <DropdownMenuItem
          onSelect={() => editor.chain().focus().unsetAllMarks().run()}
          className='flex items-center gap-2'>
          <Eraser className='size-3.5 text-muted-foreground' />
          <span>Clear formatting</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
