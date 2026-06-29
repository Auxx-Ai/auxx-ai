// apps/web/src/components/getting-started/ui/getting-started-step.tsx
'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import { SidebarMenuSubButton, SidebarMenuSubItem } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { Check } from 'lucide-react'
import type { GettingStartedGoal } from '../client'

type Props = {
  goal: GettingStartedGoal
  completed: boolean
  onCTA: (goal: GettingStartedGoal) => void
  onHover: (goal: GettingStartedGoal) => void
}

/** One checklist row inside the collapsible group — a compact full-width nav row. */
export function GettingStartedStep({ goal, completed, onCTA, onHover }: Props) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild>
        <button
          type='button'
          onClick={() => onCTA(goal)}
          onMouseEnter={() => onHover(goal)}
          onFocus={() => onHover(goal)}
          className='w-full cursor-pointer'>
          <EntityIcon iconId={goal.iconId} color={goal.color} size='sm' />
          <span
            className={cn('flex-1 text-left', completed && 'text-muted-foreground line-through')}>
            {goal.label}
          </span>
          {completed && (
            <div className='ms-auto flex size-4 items-center justify-center rounded-full border border-blue-800 bg-info'>
              <Check className='size-2.5! text-white' strokeWidth={4} />
            </div>
          )}
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}
