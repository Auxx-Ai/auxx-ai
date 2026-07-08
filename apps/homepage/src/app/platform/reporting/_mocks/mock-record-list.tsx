// apps/homepage/src/app/platform/reporting/_mocks/mock-record-list.tsx

import { cn } from '~/lib/utils'
import type { RecordRow } from './sample-data'

const statusClasses: Record<string, string> = {
  Open: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  Resolved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  Escalated: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  Customer: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  Lead: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  VIP: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
}

/** Compact record table, mirroring the product's record-list widget. */
export function MockRecordList({
  tickets,
  className,
}: {
  tickets: RecordRow[]
  className?: string
}) {
  return (
    <div className={cn('divide-border/70 divide-y', className)}>
      {tickets.map((ticket) => (
        <div key={ticket.id} className='grid grid-cols-[auto_1fr_auto] items-center gap-2 py-1.5'>
          <span className='text-muted-foreground w-11 font-mono text-[10px]'>{ticket.id}</span>
          <div className='min-w-0'>
            <div className='text-foreground truncate text-xs font-medium'>{ticket.subject}</div>
            <div className='text-muted-foreground truncate text-[10px]'>{ticket.contact}</div>
          </div>
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              statusClasses[ticket.status] ?? 'bg-muted text-muted-foreground'
            )}>
            {ticket.status}
          </span>
        </div>
      ))}
    </div>
  )
}
