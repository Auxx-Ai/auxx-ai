// apps/web/src/components/accounting/ui/checklist/accounting-checklist-panel.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Progress } from '@auxx/ui/components/progress'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { Rocket, Wand2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { ACCOUNTING_GETTING_STARTED_GOALS } from '~/components/accounting/getting-started'
import type { GettingStartedGoal } from '~/components/getting-started/client'
import { useGettingStarted } from '~/components/getting-started/hooks/use-getting-started'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { AccountingChecklistStep } from './accounting-checklist-step'

interface AccountingChecklistPanelProps {
  className?: string
}

/**
 * The accounting getting-started checklist, as PAGE BODY content.
 *
 * This is what `/app/accounting` renders while setup is not finalized
 * (13-accounting-ui.md section 5.5), so it has to read as a finished landing state rather than a
 * leftover widget: a progress indicator, one row per goal with its description and CTA, and a
 * button back into the wizard.
 *
 * ⚠️ Deliberately NOT `GettingStartedGroup`. That component is `SidebarGroupCollapse`-based and
 * built for a sidebar footer - it hides itself once every goal is done, tucks descriptions into a
 * side hovercard, and auto-collapses. All three are wrong for a page body. What is reused is the
 * part worth reusing: `useGettingStarted`, which folds `gettingStarted.getStatus` into a display
 * catalog, and the catalog itself.
 *
 * 🛑 The checklist is NOT the readiness predicate and NOT the Post gate. It says "set up costing";
 * `resolveSetupReadiness` says which setting is missing; only the server's `blockedBy` knows which
 * PART has no standard cost, and only that may refuse a posting.
 */
export function AccountingChecklistPanel({ className }: AccountingChecklistPanelProps) {
  const router = useRouter()
  const { docsUrl } = useEnv()
  const [, setSetupParam] = useQueryState('setup')
  const { isLoading, goals, completed, done, total } = useGettingStarted(
    'accounting',
    ACCOUNTING_GETTING_STARTED_GOALS
  )

  const handleCTA = (goal: GettingStartedGoal) => {
    if (goal.external) {
      window.open(goal.href, '_blank', 'noopener,noreferrer')
      return
    }
    router.push(goal.href)
  }

  const allDone = total > 0 && done === total

  return (
    <div className={cn('mx-auto flex w-full max-w-3xl flex-col gap-5 p-6', className)}>
      <div className='flex flex-col gap-1'>
        <div className='flex items-center gap-2'>
          <Rocket className='size-4 text-muted-foreground' />
          <h1 className='font-medium text-base text-foreground'>Set up accounting</h1>
        </div>
        <p className='text-muted-foreground text-sm'>
          {allDone
            ? 'Everything is configured. The ledger is ready to close a month.'
            : 'Auxx values your inventory activity and posts one journal entry a month. These are the things that have to be true before it can.'}
        </p>
      </div>

      <div className='flex flex-col gap-2'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-muted-foreground text-xs'>
            {isLoading ? 'Loading...' : `${done} of ${total} done`}
          </span>
          <Button variant='outline' size='sm' onClick={() => setSetupParam('wizard')}>
            <Wand2 />
            Set up accounting
          </Button>
        </div>
        <Progress
          value={total > 0 ? (done / total) * 100 : 0}
          indicatorClassName={allDone ? 'bg-good-500' : 'bg-info'}
        />
      </div>

      <div className='overflow-hidden rounded-xl border'>
        {isLoading ? (
          <div className='flex flex-col gap-3 p-4'>
            {ACCOUNTING_GETTING_STARTED_GOALS.map((goal) => (
              <Skeleton key={goal.key} className='h-12 w-full rounded-lg' />
            ))}
          </div>
        ) : (
          <ul className='flex flex-col'>
            {goals.map((goal) => (
              <AccountingChecklistStep
                key={goal.key}
                goal={goal}
                completed={completed.has(goal.key)}
                docsUrl={docsUrl}
                onCTA={handleCTA}
              />
            ))}
          </ul>
        )}
      </div>

      <p className='text-muted-foreground text-xs'>
        Every step above is derived from what is actually configured, not from a stored flag - so it
        stays honest the moment somebody changes a rate.
      </p>
    </div>
  )
}
