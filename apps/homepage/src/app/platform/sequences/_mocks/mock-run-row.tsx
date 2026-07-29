// apps/homepage/src/app/platform/sequences/_mocks/mock-run-row.tsx

import { UserRound, UserRoundX } from 'lucide-react'
import { cn } from '~/lib/utils'
import { type MockRun, RUN_STATUS_CLASS, RUN_STATUS_LABEL, TOTAL_STEPS } from './runs'

/**
 * One enrollment row. Mirrors the `TreeRow` in `sequence-recipients.tsx`:
 * avatar, name + email, status badge, exit reason, `Step n/total`, enrolled-at,
 * and the destructive remove action that only active runs get.
 *
 * Deliberately a flat single-column list — the real Recipients tab has no
 * master-detail pane, so neither does the mock.
 */
export function MockRunRow({ run, className }: { run: MockRun; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg px-2.5 py-2 text-mock-window-foreground',
        className
      )}>
      <span className='flex size-6 shrink-0 items-center justify-center rounded-full bg-mock-bubble'>
        <UserRound className='size-3.5 text-mock-window-muted' />
      </span>

      <div className='min-w-0 flex-1'>
        <div className='truncate text-xs font-medium'>{run.name}</div>
        <div className='truncate text-[11px] text-mock-window-muted'>{run.email}</div>
      </div>

      <div className='flex shrink-0 items-center gap-2 text-[11px] text-mock-window-muted'>
        <span className={cn('rounded-md px-1.5 py-0.5 font-medium', RUN_STATUS_CLASS[run.status])}>
          {RUN_STATUS_LABEL[run.status]}
        </span>
        {run.exitReason ? <span className='hidden lg:inline'>{run.exitReason}</span> : null}
        <span className='hidden sm:inline'>
          Step {run.step}/{TOTAL_STEPS}
        </span>
        <span className='hidden w-20 text-right md:inline'>{run.enrolledAt}</span>
        <span className='flex size-5 items-center justify-center'>
          {run.status === 'active' ? <UserRoundX className='size-3.5 text-red-500/70' /> : null}
        </span>
      </div>
    </div>
  )
}
