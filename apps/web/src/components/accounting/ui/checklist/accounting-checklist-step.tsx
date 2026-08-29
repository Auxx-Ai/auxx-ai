// apps/web/src/components/accounting/ui/checklist/accounting-checklist-step.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowUpRight, Check, ExternalLink } from 'lucide-react'
import type { GettingStartedGoal } from '~/components/getting-started/client'

interface AccountingChecklistStepProps {
  goal: GettingStartedGoal
  completed: boolean
  /** Docs base URL from `useEnv()`, joined with the goal's `docsPath`. */
  docsUrl: string
  onCTA: (goal: GettingStartedGoal) => void
}

/**
 * One goal, rendered as PAGE BODY content: icon, label, description, completion state and a CTA.
 *
 * 🛑 Not `GettingStartedStep`. That one is a `SidebarMenuSubButton` built for the sidebar footer
 * checklist, where the description lives in a hovercard and a row is a compact nav item. This is
 * the module home's whole body until setup is finalized, so the description is on the page and
 * every goal carries its own button.
 */
export function AccountingChecklistStep({
  goal,
  completed,
  docsUrl,
  onCTA,
}: AccountingChecklistStepProps) {
  return (
    <li className='flex items-start gap-3 border-b px-4 py-3 last:border-b-0'>
      <div className='relative shrink-0 pt-0.5'>
        <EntityIcon iconId={goal.iconId} color={goal.color} size='default' />
        {completed && (
          <span className='-end-1 -top-1 absolute flex size-4 items-center justify-center rounded-full border border-blue-800 bg-info'>
            <Check className='size-2.5! text-white' strokeWidth={4} />
          </span>
        )}
      </div>

      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span
          className={cn(
            'font-medium text-foreground text-sm',
            completed && 'text-muted-foreground line-through'
          )}>
          {goal.label}
        </span>
        <p className='text-muted-foreground text-sm'>{goal.description}</p>
        <a
          href={`${docsUrl}${goal.docsPath}`}
          target='_blank'
          rel='noopener noreferrer'
          className='mt-0.5 inline-flex w-fit items-center gap-1 text-muted-foreground text-xs hover:text-foreground'>
          Learn more
          <ExternalLink className='size-3' />
        </a>
      </div>

      <Button
        variant={completed ? 'ghost' : 'outline'}
        size='sm'
        className='shrink-0'
        onClick={() => onCTA(goal)}>
        {completed ? 'Review' : goal.ctaText}
        <ArrowUpRight />
      </Button>
    </li>
  )
}
