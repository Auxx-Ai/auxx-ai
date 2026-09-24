// apps/web/src/components/accounting/ui/ledger/lock-month-button.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { CalendarCheck2, CalendarX2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { formatPeriodLabel } from './format'

interface LockMonthButtonProps {
  periodLabel: string
  /** The month is at or before Reviewed through. */
  isLocked: boolean
  /** Why Mark reviewed is refused, or `null` when it is offered. */
  lockBlockedReason: string | null
  /** Reviewed through (`ledger.lockedThroughMonth`): this month and every one before it. */
  lockedThrough: string | null
  onToggleLock: () => void
}

/** Closeout toolbar's Mark reviewed / Unmark reviewed. A suggestion: posting is never refused. */
export function LockMonthButton({
  periodLabel,
  isLocked,
  lockBlockedReason,
  lockedThrough,
  onToggleLock,
}: LockMonthButtonProps) {
  const reviewedThrough = lockedThrough
    ? `Reviewed through ${formatPeriodLabel(lockedThrough)}.`
    : 'Nothing is reviewed yet.'

  // Unmarking is never refused; only marking is.
  if (lockBlockedReason && !isLocked) {
    return (
      <Tooltip content={lockBlockedReason}>
        {/* A disabled button fires no pointer events, so the span carries the tooltip. */}
        <span className='inline-flex'>
          <Button variant='ghost' size='sm' disabled>
            <CalendarCheck2 />
            Mark reviewed
          </Button>
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip
      content={
        isLocked
          ? `${reviewedThrough} Unmarking returns ${periodLabel} and every month after it to not reviewed.`
          : `Marks ${periodLabel} and every month before it reviewed. Entries can still post into them and are listed under Posted after review. ${reviewedThrough}`
      }>
      <Button variant='ghost' size='sm' onClick={onToggleLock}>
        {isLocked ? <CalendarX2 /> : <CalendarCheck2 />}
        {isLocked ? 'Unmark reviewed' : 'Mark reviewed'}
      </Button>
    </Tooltip>
  )
}
