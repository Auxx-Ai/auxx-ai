// apps/web/src/components/accounting/ui/ledger/close-month-panel.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { Lock, LockOpen, Undo2 } from 'lucide-react'
import { formatPeriodLabel } from './format'

interface CloseMonthPanelProps {
  periodLabel: string
  isLocked: boolean
  /** Why Lock is refused, or `null` when it is offered. */
  lockBlockedReason: string | null
  /** The THROUGH marker: everything up to and including this month is shut. */
  lockedThrough: string | null
  canControlLedger: boolean
  onToggleLock: () => void
  /** The month has a posting to reverse. False on an open or never-posted month. */
  canReverse: boolean
  /** Opens the posting drawer, which is where the reversal is actually written. */
  onReverse: () => void
}

/**
 * The month's lifecycle: reverse what was posted, and declare the month shut.
 *
 * 🛑 Reverse is HERE rather than beside the entry, unlike Post. Post is a
 * decision taken against the totals somebody has just read, so it belongs under
 * them; Reverse acts on a month that is already posted and there is nothing on
 * the screen to read first. It is the same kind of act as the lock - something
 * you do TO a closed month - and the two being in one place is what lets the
 * entry's action row disappear entirely once a month is posted, instead of
 * showing a disabled Post button beside a sentence explaining why it is
 * disabled.
 *
 * ⚠️ Gated on `canReverse`, not on the month being posted. A LOCKED month that
 * was never posted carries no `glPostingId`, and offering "Reverse or re-enter"
 * there - or worse, the copy that says the month is posted - would be a claim
 * about an entry that does not exist.
 *
 * 🛑 In the Closeout COLUMN, under the entry it closes over. It spent a wave in
 * the module rail beside four groups of live figures; with those figures gone
 * (they are Kopilot's to answer now) the rail is two nav items and has no body
 * to hold a button. Under the entry is also where the lock's refusal can be
 * read without opening anything, which is what `lockRefusalReason` is for.
 *
 * 🛑 The `span` around the disabled button is load-bearing. `SimpleTooltip`
 * clones its child with pointer handlers and a DISABLED button fires no pointer
 * events, so without a wrapper the refusal is unreachable. The reason is
 * rendered as visible copy underneath as well - a refusal you have to hover to
 * discover is not a refusal anybody reads.
 */
export function CloseMonthPanel({
  periodLabel,
  isLocked,
  lockBlockedReason,
  lockedThrough,
  canControlLedger,
  onToggleLock,
  canReverse,
  onReverse,
}: CloseMonthPanelProps) {
  return (
    <div className='flex max-w-xl flex-col gap-2'>
      {canReverse && (
        <>
          <Button variant='outline' size='sm' className='w-full justify-start' onClick={onReverse}>
            <Undo2 />
            Reverse or re-enter
          </Button>
          <p className='text-muted-foreground text-xs'>
            This month is posted. A mistake is corrected by reversing and re-entering, never by
            editing.
          </p>
        </>
      )}

      {canControlLedger ? (
        <>
          {lockBlockedReason ? (
            <SimpleTooltip content={lockBlockedReason}>
              <span className='inline-flex'>
                <Button variant='outline' size='sm' className='w-full justify-start' disabled>
                  <Lock />
                  {`Lock ${periodLabel}`}
                </Button>
              </span>
            </SimpleTooltip>
          ) : (
            <Button
              variant='outline'
              size='sm'
              className='w-full justify-start'
              onClick={onToggleLock}>
              {isLocked ? <LockOpen /> : <Lock />}
              {isLocked ? `Unlock ${periodLabel}` : `Lock ${periodLabel}`}
            </Button>
          )}
          <p className='text-muted-foreground text-xs'>
            {isLocked
              ? 'Locked. Nothing can post into this month until it is unlocked, and unlocking asks first.'
              : (lockBlockedReason ?? 'Open. The entry can still be reversed and re-entered.')}
          </p>
        </>
      ) : (
        <p className='text-muted-foreground text-xs'>{isLocked ? 'Locked' : 'Not locked'}</p>
      )}

      <p className='text-muted-foreground text-xs'>
        {lockedThrough
          ? `The books are closed through ${formatPeriodLabel(lockedThrough)}.`
          : 'Nothing is closed yet.'}
      </p>
    </div>
  )
}
