// apps/web/src/components/accounting/ui/ledger/sidebar/this-month-group.tsx

'use client'

import { SidebarGroup, SidebarGroupLabel } from '@auxx/ui/components/sidebar'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'
import { thisMonthRows } from './this-month-rows'

interface ThisMonthGroupProps {
  /** `YYYY-MM` - the month on screen. Every sentence here is about it. */
  monthKey: string
}

/**
 * What posted this month, per posting type, as a FACT rather than an alarm
 * (plans/accounting/tasks/28-how-your-books-post.md §6).
 *
 * ```
 * This month
 *   Fulfillment      12 entries, last Sep 13
 *                    2 shipments waiting for the dialog
 *   Payout           9 entries, last Sep 14
 *                    next today 04:30 UTC
 *   Credit memo      1 issued, waiting for the dialog
 * ```
 *
 * 🛑 **No checkmark, no red, no "action required", and no refusal.** This is
 * `rail-fees-group.tsx`'s shape for the same reason it has it: a count and a
 * date are legible on their own, and the person draws the conclusion. What did
 * NOT tie stays in `BooksGroup`; this group replaces nothing.
 *
 * Which rows appear, and every word in them, is `thisMonthRows` - pure, and
 * tested on its own. This file is the read and the markup.
 *
 * ⚠️ A failed read gets a MUTED line, not a destructive one. Nothing here is a
 * claim about whether the books are right, so a red banner over a read that
 * timed out would be the alarm this block exists not to be.
 *
 * ⚠️ The query lives here rather than in `ledger-page.tsx`, unlike the other
 * groups: the month key is the only input, and it is already a sidebar prop.
 *
 * ⚠️ `py-2` + `h-8` is `/app/settings`' group spacing - see
 * `close-month-group.tsx` for why `SidebarGroup` gives none on its own.
 */
export function ThisMonthGroup({ monthKey }: ThisMonthGroupProps) {
  const query = api.ledger.monthActivity.useQuery({ periodKey: monthKey }, { enabled: !!monthKey })
  const now = useNow()

  if (query.isError) {
    return (
      <SidebarGroup className='py-2'>
        <SidebarGroupLabel className='h-8'>This month</SidebarGroupLabel>
        <p className='px-2 pb-1 text-xs text-muted-foreground'>
          The month could not be read, so nothing is said here about what posted.{' '}
          {query.error.message}
        </p>
      </SidebarGroup>
    )
  }

  // In flight. A heading over an empty list would read as "nothing posted",
  // which is a claim nobody checked yet.
  if (!query.data) return null

  const rows = thisMonthRows(query.data, now)
  if (rows.length === 0) return null

  return (
    <SidebarGroup className='py-2'>
      <SidebarGroupLabel className='h-8'>This month</SidebarGroupLabel>
      <div className='flex flex-col gap-2 px-2 pb-1'>
        {rows.map((row) => (
          <div key={row.type} className='flex flex-col gap-0.5'>
            <p className='text-xs font-medium'>{row.label}</p>
            <p className='text-xs text-muted-foreground'>{row.entries}</p>
            {row.next && <p className='text-xs text-muted-foreground'>next {row.next}</p>}
            {row.waiting && <p className='text-xs text-muted-foreground'>{row.waiting}</p>}
          </div>
        ))}
      </div>
    </SidebarGroup>
  )
}

/**
 * The browser clock, read after mount so the server render and the first
 * client render agree. Until then the "next" clause is absent rather than
 * wrong.
 */
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
  }, [])
  return now
}
