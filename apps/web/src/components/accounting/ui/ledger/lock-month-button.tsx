// apps/web/src/components/accounting/ui/ledger/lock-month-button.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Lock, LockOpen } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { formatPeriodLabel } from './format'

interface LockMonthButtonProps {
  periodLabel: string
  isLocked: boolean
  /** Why Lock is refused, or `null` when it is offered. */
  lockBlockedReason: string | null
  /** The THROUGH marker: everything up to and including this month is shut. */
  lockedThrough: string | null
  onToggleLock: () => void
}

/** Closeout toolbar's Lock / Unlock, beside the month's state pill. Locking is a THROUGH marker. */
export function LockMonthButton({
  periodLabel,
  isLocked,
  lockBlockedReason,
  lockedThrough,
  onToggleLock,
}: LockMonthButtonProps) {
  const closedThrough = lockedThrough
    ? `The books are closed through ${formatPeriodLabel(lockedThrough)}.`
    : 'Nothing is closed yet.'

  // Unlocking a month is never refused; only locking is.
  if (lockBlockedReason && !isLocked) {
    return (
      <Tooltip content={lockBlockedReason}>
        {/* A disabled button fires no pointer events, so the span carries the tooltip. */}
        <span className='inline-flex'>
          <Button variant='ghost' size='sm' disabled>
            <Lock />
            Lock month
          </Button>
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip
      content={
        isLocked
          ? `${closedThrough} Unlocking reopens ${periodLabel} and every month after it.`
          : `Locks ${periodLabel} and every month before it. ${closedThrough}`
      }>
      <Button variant='ghost' size='sm' onClick={onToggleLock}>
        {isLocked ? <LockOpen /> : <Lock />}
        {isLocked ? 'Unlock month' : 'Lock month'}
      </Button>
    </Tooltip>
  )
}
