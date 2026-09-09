// apps/web/src/components/money/ui/fulfillment-posting/fulfillment-exclusions.tsx
'use client'

// The shipments in the range that produce no posting, with the reason
// (§2.3 item 4 of plans/money/tasks/49-bulk-fulfillment-posting.md, following
// 44 §7.2b and `manufacturing/builds/backfill-exclusions.tsx`).
//
// 🛑 **The first question anyone asks this screen is "where is order 1042?"** If
// an excluded shipment is simply absent, that question has no answer, and a
// preview whose omissions cannot be explained is a preview nobody trusts,
// which on this screen means somebody posts the day twice looking for it.
//
// `FulfillmentPostingExclusionReason` is closed on purpose, so `EXCLUSION_COPY`
// is a total `Record` over it: a seventh reason stops this file compiling rather
// than rendering as a raw slug.
//
// ⚠️ **The `detail` column is not decoration.** Every exclusion carries the
// number or the value that PROVES its reason: the cutoff month, the currency
// code, the gateway list. A reason without its evidence is an assertion.
// `gateway-ambiguous` in particular is unbelievable without the two gateways
// that caused it.

import type {
  FulfillmentPostingExclusion,
  FulfillmentPostingExclusionReason,
} from '@auxx/lib/money/client'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { formatDayKey } from './fulfillment-plan-table'

/**
 * What each reason says on the row.
 *
 * The `detail` here is the RULE; the exclusion's own `detail` beside it is the
 * evidence. Both are needed: "before the accounting cutoff" explains nothing
 * without the cutoff, and `2026-06` explains nothing on its own.
 */
const EXCLUSION_COPY: Record<FulfillmentPostingExclusionReason, { label: string; detail: string }> =
  {
    'before-cutoff': {
      label: 'Before the accounting cutoff',
      detail: 'It shipped in a period the books were opened after.',
    },
    'locked-period': {
      label: 'Locked period',
      detail: 'Its month is closed, and a closed month does not take new entries.',
    },
    'foreign-currency': {
      label: 'Foreign currency',
      detail: 'The order is not in the currency the books are kept in.',
    },
    'gateway-ambiguous': {
      label: 'Two payment gateways',
      detail: 'Which account this debits cannot be decided from the order alone.',
    },
    'test-gateway': {
      label: 'Test gateway',
      detail: 'A test checkout, which is not a sale.',
    },
    'zero-value': {
      label: 'Nothing to recognise',
      detail: 'The shipment totals zero, so there is no entry to make.',
    },
  }

interface FulfillmentExclusionsProps {
  exclusions: readonly FulfillmentPostingExclusion[]
}

export function FulfillmentExclusions({ exclusions }: FulfillmentExclusionsProps) {
  if (exclusions.length === 0) return null

  return (
    <div className='flex flex-col gap-1.5'>
      <p className='font-medium text-muted-foreground text-xs'>
        Not being posted ({exclusions.length})
      </p>

      <div className='overflow-x-auto rounded-md border border-dashed bg-muted/40'>
        <Table>
          <TableHeader>
            <TableRow className='hover:bg-transparent'>
              <TableHead className='min-w-[140px] text-muted-foreground'>Order</TableHead>
              <TableHead className='min-w-[110px] text-muted-foreground'>Ship date</TableHead>
              <TableHead className='min-w-[200px] text-muted-foreground'>Reason</TableHead>
              <TableHead className='min-w-[160px] text-muted-foreground'>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exclusions.map((exclusion) => {
              const copy = EXCLUSION_COPY[exclusion.reason]
              return (
                <TableRow
                  // `(orderId, sequence)`: an order can have two shipments
                  // excluded for two different reasons.
                  key={`${exclusion.orderId}-${exclusion.sequence}`}
                  className='text-muted-foreground'>
                  <TableCell>
                    <span className='block truncate text-xs'>{exclusion.orderNumber}</span>
                    <span className='block text-[11px]'>Shipment {exclusion.sequence}</span>
                  </TableCell>
                  <TableCell className='text-xs'>{formatDayKey(exclusion.shippedAt)}</TableCell>
                  <TableCell>
                    <span className='block text-xs'>{copy.label}</span>
                    <span className='block text-[11px]'>{copy.detail}</span>
                  </TableCell>
                  <TableCell className='text-[11px] break-words'>{exclusion.detail}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
