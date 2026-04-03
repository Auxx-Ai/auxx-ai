// apps/web/src/components/kopilot/ui/messages/branch-navigator.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface BranchNavigatorProps {
  currentChildId: string
  siblings: string[]
  onNavigate: (childId: string) => void
}

export function BranchNavigator({ currentChildId, siblings, onNavigate }: BranchNavigatorProps) {
  const currentIndex = siblings.indexOf(currentChildId)
  const total = siblings.length

  if (total <= 1) return null

  return (
    <div className='flex items-center gap-0.5 text-xs text-muted-foreground'>
      <Button
        variant='ghost'
        size='icon'
        className='h-5 w-5'
        disabled={currentIndex === 0}
        onClick={() => onNavigate(siblings[currentIndex - 1]!)}>
        <ChevronLeft className='size-3' />
      </Button>
      <span className='tabular-nums'>
        {currentIndex + 1}/{total}
      </span>
      <Button
        variant='ghost'
        size='icon'
        className='h-5 w-5'
        disabled={currentIndex === total - 1}
        onClick={() => onNavigate(siblings[currentIndex + 1]!)}>
        <ChevronRight className='size-3' />
      </Button>
    </div>
  )
}
