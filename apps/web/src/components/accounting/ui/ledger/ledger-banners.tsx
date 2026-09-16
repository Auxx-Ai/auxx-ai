// apps/web/src/components/accounting/ui/ledger/ledger-banners.tsx

'use client'

import type { SyncQueueRow } from '@auxx/lib/postings/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { CalendarCheck2 } from 'lucide-react'
import { FailedExportsBanner } from './books-health'

interface LedgerBannersProps {
  /** False when no month resolved at all - an org whose cutoff is still ahead. */
  hasPeriod: boolean
  /** False once every month from the cutoff forward is posted or locked. */
  hasOpenPeriod: boolean
  periodLabel: string
  /** The whole queue, all periods. This component takes only the refusals out of it. */
  exports: SyncQueueRow[]
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  onOpenSyncQueue: () => void
}

/**
 * The three things the ledger says ABOVE its sections, in priority order.
 *
 * 🛑 BANNERS, never a replacement for the body. As an early return the
 * no-month card took the Entries list and the New journal entry button down
 * with it - and that button is the only door to a manual entry anywhere in the
 * module - so an org whose cutoff is still ahead of the wall clock, or one
 * whose period read failed, could not raise an entry at all.
 */
export function LedgerBanners({
  hasPeriod,
  hasOpenPeriod,
  periodLabel,
  exports,
  providerLabel,
  onOpenSyncQueue,
}: LedgerBannersProps) {
  /**
   * 🛑 REFUSALS only (53 §7.2.2). With the hold on, every posted entry rests at
   * `exportStatus: 'pending'`, so a banner keyed on the whole queue would be
   * open on every visit forever - and a banner that is always there is one
   * nobody reads by the time something has actually gone wrong. What is merely
   * HELD is the sync queue's, and the rail is the door to it.
   */
  const refused = exports.filter((row) => row.exportStatus === 'failed')
  const nothingToSay = hasPeriod && hasOpenPeriod && refused.length === 0
  // 🛑 `null`, not an empty padded div. The column this sits in has no padding
  // of its own (every `Section` under it pads itself), so a wrapper that always
  // rendered would leave 24px of dead space above the first section on the
  // ordinary screen where none of these three apply.
  if (nothingToSay) return null

  return (
    <div className='flex flex-col gap-2 p-3'>
      {!hasPeriod && (
        <Alert variant='neutral'>
          <CalendarCheck2 />
          <AlertTitle>No month is open for closing yet</AlertTitle>
          <AlertDescription>
            The first closable month is the one after the accounting cutoff. Nothing on or before
            the cutoff belongs to this system. A journal entry can still be raised below; it posts
            into whichever month its own date falls in.
          </AlertDescription>
        </Alert>
      )}

      {refused.length > 0 && (
        <FailedExportsBanner
          exports={refused}
          providerLabel={providerLabel}
          onOpenSyncQueue={onOpenSyncQueue}
        />
      )}

      {hasPeriod && !hasOpenPeriod && (
        <Alert variant='neutral'>
          <CalendarCheck2 />
          <AlertTitle>Nothing to close</AlertTitle>
          <AlertDescription>
            Every month from the cutoff forward has been posted. {periodLabel} is the most recent,
            and it is shown below.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
