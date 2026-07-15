// apps/web/src/components/dispatch/ui/job-schedule/visit-date-block.tsx
'use client'

import { format } from 'date-fns'
import { CalendarClock } from 'lucide-react'

/**
 * Calendar-style visit date tile shared by the work-order Schedule card and
 * the drilled visit detail. An unscheduled visit falls back to its clock icon.
 */
export function VisitDateBlock({ startTime }: { startTime: Date | string | null | undefined }) {
  const start = startTime ? new Date(startTime) : null

  return (
    <div className='flex size-11 shrink-0 flex-col items-center justify-center rounded-lg border bg-background'>
      {start ? (
        <>
          <span className='text-[10px] font-semibold uppercase leading-none text-muted-foreground'>
            {format(start, 'MMM')}
          </span>
          <span className='text-base font-semibold leading-tight'>{format(start, 'd')}</span>
        </>
      ) : (
        <CalendarClock className='size-5 text-muted-foreground' />
      )}
    </div>
  )
}
