// apps/web/src/components/money/ui/credit-memo-posting/credit-memo-plan-table.tsx
'use client'

// The preview table for the bulk credit memo posting
// (plans/accounting/tasks/25-batch-posting-and-credit-memos.md §3, §5.5, §8).
//
// GROUP-first, the same axis as `fulfillment-plan-table.tsx` and for the same
// mechanical reason: a memo belongs to exactly one group, and the group IS the
// entry that will be written. One row, one posting. Expanding it shows the memos
// behind it, because the first question anyone asks a summarised entry is *which
// memos are in this?*, and once the entry is posted the ledger can never answer
// that at this grain again.
//
// 🛑 **Settled and A/R are separate columns, never one Total.** §3's line shape
// credits the money that already moved to a clearing account and the remainder
// to `accounts_receivable` per contact. Those are two different claims about
// where the credit lands, and folding them together hides the only half of this
// screen that can be wrong in a way a total cannot show.
//
// The memo rows also name the RESOLVED settlement account per memo, because
// §3.1 item 1 is the bug this table exists to make visible: an Affirm memo and a
// card memo inside one group must stay two credit lines, and an entry that
// collapsed them would still balance.

import type {
  CreditMemoPostingGroup,
  CreditMemoPostingPlan,
  PlannedCreditMemo,
} from '@auxx/lib/money/client'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { formatMinor } from '~/components/accounting/ui/ledger/format'
import { formatDayKey } from '~/components/money/ui/batch-posting'

/** What a memo with no resolved gateway account credits: the card clearing role. */
const CLEARING_CARD_LABEL = 'Card clearing'

/** The fallback when a memo routes to a gateway account nothing has named. */
const GATEWAY_LABEL = 'Gateway clearing'

interface CreditMemoPlanTableProps {
  plan: CreditMemoPostingPlan
  currencyCode: string
  /**
   * `payment_gateway.clearingAccount` id -> the gateway's name, so a memo whose
   * refund was resolved to that account reads as "Affirm" rather than the generic
   * fallback. Shared with the fulfillment poster (§6.5); both render a routed
   * clearing account.
   */
  gatewayNames?: Readonly<Record<string, string>>
}

const EMPTY_GATEWAY_NAMES: Readonly<Record<string, string>> = {}

export function CreditMemoPlanTable({
  plan,
  currencyCode,
  gatewayNames = EMPTY_GATEWAY_NAMES,
}: CreditMemoPlanTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())

  const toggle = (groupKey: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(groupKey)) next.add(groupKey)
      return next
    })

  return (
    <div className='flex flex-col gap-3'>
      <UnpostedShipmentWarning warning={plan.unpostedShipmentWarning} />

      <div className='overflow-x-auto rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='min-w-[150px]'>Period</TableHead>
              <TableHead className='min-w-[110px]'>Issued</TableHead>
              <TableHead className='text-right'>Memos</TableHead>
              <TableHead className='text-right'>Contacts</TableHead>
              <TableHead
                className='text-right'
                title='Contra revenue, debited to returns and allowances'>
                Contra revenue
              </TableHead>
              <TableHead className='text-right'>Tax</TableHead>
              <TableHead className='text-right' title='Refunded to a clearing account'>
                Settled
              </TableHead>
              <TableHead className='text-right' title='Unsettled, credited to accounts receivable'>
                A/R
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.groups.map((group) => (
              <GroupRows
                key={group.groupKey}
                group={group}
                currencyCode={currencyCode}
                gatewayNames={gatewayNames}
                open={expanded.has(group.groupKey)}
                onToggle={() => toggle(group.groupKey)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/**
 * §8's ordering note.
 *
 * 🛑 **A warning, never a refusal, and it never disables the run.** Contra
 * revenue booked before the revenue it reverses nets out within the month, so
 * both entries balance and the month closes correctly either way. Refusing would
 * be stronger than the problem. What it costs is a period where returns are in
 * the books and the sales they came from are not, which is worth a sentence and
 * an address to go fix it.
 */
function UnpostedShipmentWarning({
  warning,
}: {
  warning: CreditMemoPostingPlan['unpostedShipmentWarning']
}) {
  if (!warning) return null

  const { shipments } = warning
  return (
    <p className='flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30'>
      <TriangleAlert className='mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500' />
      <span>
        <strong className='font-medium'>{shipments}</strong>{' '}
        {shipments === 1 ? 'shipment has' : 'shipments have'} no revenue posted yet at or before the
        end of this range. Posting these credit memos first reverses revenue that is not in the
        books, which nets out within the month but leaves the period looking wrong until it does.{' '}
        <Link href='/app/orders' className='font-medium underline underline-offset-2'>
          Post fulfillments first
        </Link>
        .
      </span>
    </p>
  )
}

/** The posting row, and the memos it summarises underneath it. */
function GroupRows({
  group,
  currencyCode,
  gatewayNames,
  open,
  onToggle,
}: {
  group: CreditMemoPostingGroup
  currencyCode: string
  gatewayNames: Readonly<Record<string, string>>
  open: boolean
  onToggle: () => void
}) {
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <>
      <TableRow className='cursor-pointer' onClick={onToggle}>
        <TableCell className='font-medium'>
          <span className='flex items-center gap-1'>
            <Chevron className='size-3.5 shrink-0 text-muted-foreground' />
            <span className='truncate font-mono text-xs'>{group.groupKey}</span>
          </span>
        </TableCell>
        <TableCell className='text-muted-foreground text-xs'>
          {formatDayKey(group.txnDate)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>{group.memos.length}</TableCell>
        <TableCell className='text-right tabular-nums'>{group.contactCount}</TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatMinor(group.totals.subtotalMinor, currencyCode)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatMinor(group.totals.taxTotalMinor, currencyCode)}
        </TableCell>
        <TableCell className='text-right font-medium tabular-nums'>
          {formatMinor(group.totals.settlementMinor, currencyCode)}
        </TableCell>
        <TableCell className='text-right font-medium tabular-nums'>
          {formatMinor(group.totals.receivableMinor, currencyCode)}
        </TableCell>
      </TableRow>

      {open &&
        group.memos.map((memo) => (
          <TableRow key={memo.creditMemoId} className='bg-muted/30 hover:bg-muted/40'>
            <TableCell className='text-xs'>
              <span className='block ps-4 truncate'>{memo.number}</span>
              <span className='block ps-4 text-[11px] text-muted-foreground'>
                {memoNote(memo, gatewayNames)}
              </span>
            </TableCell>
            <TableCell className='text-muted-foreground text-xs'>
              {formatDayKey(memo.issuedAt)}
            </TableCell>
            <TableCell />
            <TableCell />
            <TableCell className='text-right text-muted-foreground tabular-nums'>
              {formatSplit(memo.amounts.subtotalMinor, currencyCode)}
            </TableCell>
            <TableCell className='text-right text-muted-foreground tabular-nums'>
              {formatSplit(memo.amounts.taxTotalMinor, currencyCode)}
            </TableCell>
            <TableCell className='text-right text-muted-foreground tabular-nums'>
              {formatSplit(memo.amounts.settlementMinor, currencyCode)}
            </TableCell>
            <TableCell className='text-right text-muted-foreground tabular-nums'>
              {formatSplit(memo.amounts.totalMinor - memo.amounts.settlementMinor, currencyCode)}
            </TableCell>
          </TableRow>
        ))}
    </>
  )
}

/**
 * The line under a memo's number: where its refund landed, and whether it
 * reverses revenue at all.
 *
 * ⚠️ `reverseRevenue: false` is not an error and not an exclusion (§3.1 item 3):
 * a channel memo whose order never shipped before it was issued would otherwise
 * reverse revenue that was never recognised, so it contributes a money leg only.
 * It is said out loud because a memo showing no contra revenue beside memos that
 * do reads as a missing number otherwise.
 */
function memoNote(memo: PlannedCreditMemo, gatewayNames: Readonly<Record<string, string>>): string {
  const parts: string[] = []
  if (memo.amounts.settlementMinor > 0) {
    parts.push(settlementLabel(memo.amounts.settlementGlAccountId, gatewayNames))
  }
  if (!memo.amounts.reverseRevenue) parts.push('no revenue to reverse')
  return parts.join(' · ')
}

/** Absent means the `clearing_card` role rather than a resolved gateway account. */
function settlementLabel(
  settlementGlAccountId: string | undefined,
  gatewayNames: Readonly<Record<string, string>>
): string {
  if (!settlementGlAccountId) return CLEARING_CARD_LABEL
  return gatewayNames[settlementGlAccountId] ?? GATEWAY_LABEL
}

/** A zero in a split column is noise; the ones that are non-zero are the answer. */
function formatSplit(minorUnits: number, currencyCode: string): string {
  if (!minorUnits) return ''
  return formatMinor(minorUnits, currencyCode)
}
