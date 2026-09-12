// apps/web/src/components/accounting/ui/ledger/ledger-banners.tsx

'use client'

import type { FailedExport } from '@auxx/lib/postings/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { CalendarCheck2 } from 'lucide-react'
import { FailedExportsBanner } from './books-health'

interface LedgerBannersProps {
  /** False when no month resolved at all - an org whose cutoff is still ahead. */
  hasPeriod: boolean
  /** False once every month from the cutoff forward is posted or locked. */
  hasOpenPeriod: boolean
  periodLabel: string
  exports: FailedExport[]
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
}: LedgerBannersProps) {
  const nothingToSay = hasPeriod && hasOpenPeriod && exports.length === 0
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

      {exports.length > 0 && <FailedExportsBanner exports={exports} />}

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
