// apps/web/src/components/accounting/ui/reports/completeness-banner.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Info } from 'lucide-react'
import Link from 'next/link'
import { api } from '~/trpc/react'

export interface CompletenessBannerProps {
  /** `YYYY-MM-DD`. */
  asOf: string
}

/**
 * "Report completeness is not report correctness" (`plans/accounting/tasks/
 * 04-statements.md` §3), rendered on every statement page: unposted periods,
 * disabled posting types in words, and the two bank-feed placeholders
 * (`ledgerReports.completeness` already flattens all four buckets into
 * `items`, hidden here whenever the underlying list is empty - there is
 * nothing to render a UI for). One neutral-tone card in the
 * `entry-blockers.tsx` style (its `neutral` tone), each item with its own
 * remedy link.
 *
 * Renders nothing while `items` is empty - a books-complete org gets no
 * banner at all, not an empty "all clear" card - and nothing on a transport
 * error, since a missing banner is a much smaller problem than a toast
 * fighting the page's own `ReportErrorCard` for attention.
 */
export function CompletenessBanner({ asOf }: CompletenessBannerProps) {
  const { data } = api.ledgerReports.completeness.useQuery({ asOf }, { enabled: !!asOf })
  const items = data?.items ?? []

  if (items.length === 0) return null

  return (
    <div className='flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4'>
      <div className='flex items-center gap-2'>
        <Info className='size-4 text-muted-foreground' />
        <span className='text-sm font-medium'>Not included in this report</span>
      </div>
      <ul className='flex flex-col gap-1.5'>
        {items.map((item) => (
          <li key={item.id} className='flex flex-wrap items-center justify-between gap-3 text-sm'>
            <span className='text-muted-foreground'>{item.label}</span>
            <Button asChild variant='outline' size='sm' className='shrink-0'>
              <Link href={item.remedy.href}>{item.remedy.label}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
