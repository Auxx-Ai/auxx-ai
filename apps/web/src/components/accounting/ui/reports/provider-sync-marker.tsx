// apps/web/src/components/accounting/ui/reports/provider-sync-marker.tsx

'use client'

import { describeProviderSyncCoverage } from '@auxx/lib/postings/client'
import { cn } from '@auxx/ui/lib/utils'
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { api } from '~/trpc/react'

export interface ProviderSyncMarkerProps {
  /**
   * The LAST date this statement covers - `asOf` for a balance sheet, an aging
   * or a trial balance, `to` for a P&L or a general ledger. Empty while the
   * page has not resolved a period yet, which renders nothing.
   */
  through: string
}

/**
 * "Synced through <date>", on every statement of an org with a connected
 * accounting provider (`plans/accounting/tasks/20-two-authors-one-ledger.md`
 * §7.3).
 *
 * The accounting firm posts December's depreciation in February. auxx's
 * December balance sheet is incomplete until the sync runs and restates it, and
 * then it changes. A statement that changes two months after the reader last
 * looked at it, with nothing on the page saying so, is a trust problem rather
 * than a correctness one - and the only thing that fixes it is the statement
 * saying so on its own face.
 *
 * 🛑 **An org with NO provider connected renders nothing at all** - not "synced
 * through: never", not an empty strip. The marker is meaningless there and it
 * would imply a connection exists. Same for a transport error and for a
 * statement that has not resolved its own range yet: a missing line is a much
 * smaller problem than a wrong one, which is `CompletenessBanner`'s rule and
 * this follows it.
 *
 * Three visible readings, and the middle one is the reason the feature exists:
 *
 *   * **behind** - the statement's range ends after the marker. Named as
 *     "incomplete after <date>", with what is missing and that the figures will
 *     change, because a date on its own leaves the reader to do the comparison
 *     the page has already done.
 *   * **never synced** - connected, nothing read yet. Same shape, different
 *     sentence: everything the accountant authored is missing.
 *   * **current** - one quiet muted line. Deliberately not a card: a books-
 *     complete statement should not carry a box telling it so, the same
 *     argument `CompletenessBanner` makes by rendering nothing at all when
 *     there is nothing to say.
 */
export function ProviderSyncMarker({ through }: ProviderSyncMarkerProps) {
  const { data } = api.ledgerReports.providerSyncMarker.useQuery(undefined, {
    // The marker moves only when a sync runs, and every statement page mounts
    // this. One shared, long-lived entry rather than a request per page.
    staleTime: 60_000,
  })

  if (!data?.connected || !through) return null

  const reading = describeProviderSyncCoverage(data, through)
  if (!reading.headline) return null

  if (reading.coverage === 'current') {
    return (
      <div className='flex items-center gap-2 px-1 text-xs text-muted-foreground'>
        <RefreshCw className='size-3.5' />
        <span>{reading.headline}</span>
      </div>
    )
  }

  const Icon = reading.coverage === 'never_synced' ? CloudOff : TriangleAlert

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4',
        'text-amber-700 dark:text-amber-400'
      )}>
      <div className='flex items-center gap-2'>
        <Icon className='size-4' />
        <span className='text-sm font-medium'>{reading.headline}</span>
      </div>
      {reading.detail && <p className='pl-6 text-sm text-muted-foreground'>{reading.detail}</p>}
    </div>
  )
}
