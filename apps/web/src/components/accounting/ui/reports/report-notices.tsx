// apps/web/src/components/accounting/ui/reports/report-notices.tsx

'use client'

import { describeProviderSyncCoverage } from '@auxx/lib/accounting/mirror/client'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { CalendarClock, CircleSlash, CloudOff, Info, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { formatPeriodLabel } from '~/components/accounting/ui/ledger/format'
import { api } from '~/trpc/react'

/**
 * A statement's caveats as compact toolbar buttons, the full text in a tooltip and a
 * popover: what the figures leave out, and how far the provider has been read. Each
 * renders nothing when it has nothing to say. Compact so the toolbar fits beside a docked drawer.
 */
export function ReportNotices({ from, through }: { from?: string; through: string }) {
  return (
    <>
      <ChangedSinceReviewNotice from={from} through={through} />
      <CompletenessNotice through={through} />
      <ProviderSyncNotice through={through} />
    </>
  )
}

/** Reviewed months in the range that took entries after their review (104 P1c). */
function ChangedSinceReviewNotice({ from, through }: { from?: string; through: string }) {
  const { data } = api.ledger.postedAfterReview.useQuery(
    { from: from || undefined, to: through },
    { enabled: !!through }
  )
  const months = data ?? []
  if (months.length === 0) return null
  const count = months.reduce((sum, month) => sum + month.entries.length, 0)

  return (
    <Popover>
      <SimpleTooltip content='Changed since review'>
        <PopoverTrigger asChild>
          <Button variant='ghost' size='sm' aria-label='Changed since review'>
            <CalendarClock />
            {count}
          </Button>
        </PopoverTrigger>
      </SimpleTooltip>
      <PopoverContent align='end' className='w-96 p-0'>
        <div className='border-b px-3 py-2 font-medium text-sm'>Changed since review</div>
        <div className='flex flex-col gap-2 p-3'>
          {months.map((month) => (
            <div key={month.periodKey} className='flex items-center gap-2 text-sm'>
              <span className='flex-1'>
                {formatPeriodLabel(month.periodKey)}: {month.entries.length}{' '}
                {month.entries.length === 1 ? 'entry' : 'entries'} posted after review
              </span>
              <Button asChild variant='outline' size='xs'>
                <Link href={`/app/accounting/closeout?month=${month.periodKey}`}>Closeout</Link>
              </Button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * "Report completeness is not report correctness" (`plans/accounting/tasks/04-statements.md` §3).
 * Every item must be genuinely absent from the figures; the export backlog is the Outbox's.
 */
function CompletenessNotice({ through }: { through: string }) {
  const { data } = api.ledgerReports.completeness.useQuery(
    { asOf: through },
    { enabled: !!through }
  )
  const items = data?.items ?? []
  if (items.length === 0) return null

  return (
    <Popover>
      <SimpleTooltip content={`${items.length} not included in this report`}>
        <PopoverTrigger asChild>
          <Button variant='ghost' size='sm' aria-label='Not included in this report'>
            <Info />
            {items.length}
          </Button>
        </PopoverTrigger>
      </SimpleTooltip>
      <PopoverContent align='end' className='w-96 p-0'>
        <div className='border-b px-3 py-2 font-medium text-sm'>Not included in this report</div>
        <div className='flex flex-col gap-2 p-3'>
          {items.map((item) => (
            <div key={item.id} className='flex items-start gap-2 text-sm'>
              <CircleSlash className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
              <span className='flex-1'>{item.label}</span>
              {item.remedy && (
                <Button asChild variant='outline' size='xs'>
                  <Link href={item.remedy.href}>{item.remedy.label}</Link>
                </Button>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The warning readings of the sync marker: `behind` and `never_synced`. `current`
 * is `ProviderSyncStatus`; an org with no provider renders nothing.
 * see plans/accounting/tasks/20-two-authors-one-ledger.md §7.3
 */
function ProviderSyncNotice({ through }: { through: string }) {
  const { data } = api.ledgerReports.providerSyncMarker.useQuery(undefined, {
    // Moves only when a sync runs; shared with `ProviderSyncStatus`.
    staleTime: 60_000,
  })
  if (!data?.connected || !through) return null

  const reading = describeProviderSyncCoverage(data, through)
  if (!reading.headline || reading.coverage === 'current') return null
  const Icon = reading.coverage === 'never_synced' ? CloudOff : TriangleAlert

  return (
    <Popover>
      <SimpleTooltip content={reading.headline}>
        <PopoverTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            aria-label={reading.headline}
            className='text-yellow-700 hover:text-yellow-700 data-[state=open]:text-yellow-700 dark:text-yellow-500 dark:data-[state=open]:text-yellow-500 dark:hover:text-yellow-500'>
            <Icon />
          </Button>
        </PopoverTrigger>
      </SimpleTooltip>
      <PopoverContent align='end' className='w-80 text-sm'>
        <div className='flex items-start gap-2'>
          <Icon className='mt-0.5 size-4 shrink-0 text-yellow-600 dark:text-yellow-500' />
          <div className='flex flex-col gap-1'>
            <span className='font-medium'>{reading.headline}</span>
            {reading.detail && <p className='text-muted-foreground'>{reading.detail}</p>}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
