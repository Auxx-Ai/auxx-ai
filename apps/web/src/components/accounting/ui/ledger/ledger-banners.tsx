// apps/web/src/components/accounting/ui/ledger/ledger-banners.tsx

'use client'

import type { ExportBatchRow } from '@auxx/lib/accounting/export'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { CalendarCheck2, CircleSlash, Lock } from 'lucide-react'
import { useState } from 'react'
import { DESTRUCTIVE_RING, DESTRUCTIVE_ROW } from '../tone-rows'
import { FailedExportsRow } from './books-health'
import { EntryBlockers, type FixableBlockerItemKey, type LedgerBlocker } from './entry-blockers'

interface LedgerBannersProps {
  /** False when no month resolved at all - an org whose cutoff is still ahead. */
  hasPeriod: boolean
  /** False once every month from the cutoff forward is posted or locked. */
  hasOpenPeriod: boolean
  periodLabel: string
  /** The whole queue, all periods. This component takes only the refusals out of it. */
  exports: ExportBatchRow[]
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  onOpenOutbox: () => void
  /** Why this month cannot be closed. Empty on a month with nothing in its way. */
  blockers: LedgerBlocker[]
  /** Every blocker is an ordinary outcome rather than a fault. */
  isSoftRefusal: boolean
  onFix: (key: FixableBlockerItemKey) => void
  onReviewLock: () => void
  /** Absent on the newest month. */
  onNextPeriod?: () => void
}

/**
 * What the ledger says ABOVE its sections: the two period notices, and the pair
 * of standing conditions on the month.
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
  onOpenOutbox,
  blockers,
  isSoftRefusal,
  onFix,
  onReviewLock,
  onNextPeriod,
}: LedgerBannersProps) {
  // 🛑 REFUSALS only. With the hold on, every batch rests `ready`, so a banner
  // keyed on the whole queue would be open on every visit forever - and a banner
  // that is always there is one nobody reads by the time something has actually
  // gone wrong. What is merely HELD is the outbox's.
  const refused = exports.filter((row) => row.state === 'failed')
  const nothingToSay = hasPeriod && hasOpenPeriod && refused.length === 0 && blockers.length === 0
  // 🛑 `null`, not an empty padded div. The column this sits in has no padding
  // of its own (every `Section` under it pads itself), so a wrapper that always
  // rendered would leave 24px of dead space above the first section on the
  // ordinary screen where none of these apply.
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

      {/* 🛑 `gap-0.5`, like `StatementNotices`. These two are one list of
          standing conditions on the month and have to sit tight against each
          other; at the column's own `gap-2` they read as two unrelated notices. */}
      <div className='flex flex-col gap-0.5'>
        <FailedExportsRow
          exports={refused}
          providerLabel={providerLabel}
          onOpenOutbox={onOpenOutbox}
        />
        <CloseBlockersRow
          periodLabel={periodLabel}
          blockers={blockers}
          isSoftRefusal={isSoftRefusal}
          onFix={onFix}
          onReviewLock={onReviewLock}
          onNextPeriod={onNextPeriod}
        />
      </div>

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

/**
 * Why this month cannot be closed, as one collapsed row carrying the count.
 *
 * 🛑 The row names the refusal and the `EntryBlockers` under it name the work,
 * so this must not repeat what they say. What it adds is the MONTH: a reader
 * scanning the ledger has to be able to tell "this month is blocked" from "the
 * provider refused a copy" without opening either.
 */
function CloseBlockersRow({
  periodLabel,
  blockers,
  isSoftRefusal,
  onFix,
  onReviewLock,
  onNextPeriod,
}: {
  periodLabel: string
  blockers: LedgerBlocker[]
  isSoftRefusal: boolean
  onFix: (key: FixableBlockerItemKey) => void
  onReviewLock: () => void
  onNextPeriod?: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)

  if (blockers.length === 0) return null

  const Icon = isSoftRefusal ? CircleSlash : Lock

  return (
    <TreeRow
      expandable
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((open) => !open)}
      rowClassName={isSoftRefusal ? 'border' : cn(DESTRUCTIVE_ROW, DESTRUCTIVE_RING)}
      icon={
        <Icon
          className={cn('size-4', isSoftRefusal ? 'text-muted-foreground' : 'text-destructive')}
        />
      }
      title={
        <span className={cn('truncate', isSoftRefusal ? 'text-foreground' : 'text-destructive')}>
          {isSoftRefusal
            ? `There is nothing to post for ${periodLabel}`
            : `${periodLabel} cannot be closed yet`}
        </span>
      }
      secondary={<span className='text-muted-foreground text-xs'>{blockers.length}</span>}>
      <EntryBlockers
        variant='bare'
        depth={1}
        blockers={blockers}
        onFix={(item) => onFix(item.key as FixableBlockerItemKey)}
        onReviewLock={onReviewLock}
        onNextPeriod={onNextPeriod}
      />
    </TreeRow>
  )
}
