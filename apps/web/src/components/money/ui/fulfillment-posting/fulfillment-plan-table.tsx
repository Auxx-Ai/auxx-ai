// apps/web/src/components/money/ui/fulfillment-posting/fulfillment-plan-table.tsx
'use client'

// The preview table (§2.3 item 3 of plans/money/tasks/49-bulk-fulfillment-posting.md).
//
// Rows are GROUP-first, which is the opposite axis to
// `manufacturing/builds/backfill-plan-table.tsx` and for a mechanical reason:
// the backfill's On hand column is a per-part quantity consumed across periods,
// so a period-first row had nowhere honest to put it. Nothing here is per order
// across groups, a shipment belongs to exactly one group, and the group IS the
// posting that will be written. One row, one entry.
//
// 🛑 **The debit split is on the row, not in a footnote.** A day's revenue is one
// number; where the money is expected FROM is three, and they are what tells
// somebody the run is sane before it is irreversible. Card clearing drains on the
// next payout, Affirm clearing on its own settlement, and A/R is somebody who
// still owes (§3.2). Folding them into one Total hides the only part of this
// screen that can be wrong in a way the total cannot show.
//
// Expanding a group shows the shipments behind it, because the first question
// anyone asks a summarised entry is *which orders are in this?*, and after the
// entry is posted the ledger will never be able to answer it at this grain
// (§2.5: the frozen list rides in the posting's draft envelope, not in a line).

import type {
  FulfillmentDebitRole,
  FulfillmentPostingGroup,
  FulfillmentPostingPlan,
  PlannedShipment,
} from '@auxx/lib/money/client'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { formatMinor } from '~/components/accounting/ui/ledger/format'

/**
 * The account each debit role names, spelled out where there is room for it.
 *
 * `gateway` (brief 13 §5.3) is the generic fallback for an id-based debit -
 * one shipment can route to a different `payment_gateway` record than the
 * next one under the same role, so there is no single name to put here. Use
 * {@link debitLabel} for a shipment ROW, which prefers the actual gateway's
 * name when the caller supplies {@link FulfillmentPlanTableProps.gatewayNames}.
 */
export const DEBIT_ROLE_LABEL: Record<FulfillmentDebitRole, string> = {
  clearing_card: 'Card clearing',
  accounts_receivable: 'Accounts receivable',
  gateway: 'Gateway clearing',
}

/** The same, short enough for a column head. */
const DEBIT_ROLE_COLUMN: Record<FulfillmentDebitRole, string> = {
  clearing_card: 'Card',
  accounts_receivable: 'A/R',
  gateway: 'Gateway',
}

/** The order the debit columns are read in. Card first: it is the common case. */
const DEBIT_ROLE_ORDER: readonly FulfillmentDebitRole[] = [
  'clearing_card',
  'gateway',
  'accounts_receivable',
]

/**
 * The label one shipment ROW shows for its debit.
 *
 * `role === 'gateway'` means the debit is a `payment_gateway` record's own
 * clearing account id (`amounts.debitGlAccountId`), not one of the two
 * declared roles - `DEBIT_ROLE_LABEL.gateway` alone cannot say WHICH gateway,
 * so this prefers the name from `gatewayNames` (keyed by that same id) and
 * falls back to the generic label when the caller has not supplied one.
 */
function debitLabel(
  role: FulfillmentDebitRole,
  debitGlAccountId: string | undefined,
  gatewayNames: Readonly<Record<string, string>>
): string {
  if (role !== 'gateway') return DEBIT_ROLE_LABEL[role]
  return (debitGlAccountId && gatewayNames[debitGlAccountId]) || DEBIT_ROLE_LABEL.gateway
}

/**
 * How a shipment's tax was arrived at.
 *
 * ⚠️ Shown per shipment rather than per group because it can differ INSIDE one
 * group: an order whose every line carries `line_item_tax_total` uses those
 * numbers, and one that is missing any of them has the order's tax allocated
 * across its lines instead (48 §8.2). A day can hold both, and the two are not
 * equally trustworthy.
 */
const TAX_BASIS_LABEL: Record<PlannedShipment['amounts']['taxBasis'], string> = {
  per_line: 'tax per line',
  allocated: 'tax allocated',
}

interface FulfillmentPlanTableProps {
  plan: FulfillmentPostingPlan
  currencyCode: string
  /**
   * `payment_gateway.clearingAccount` id -> the gateway's name, so a shipment
   * routed there by `resolveFulfillmentDebit` (brief 13 §5.3) shows which
   * gateway rather than the generic "Gateway clearing" fallback. Optional -
   * a caller that has not wired `paymentGateway.list` gets the fallback
   * everywhere, which is still correct, just less specific.
   */
  gatewayNames?: Readonly<Record<string, string>>
}

const EMPTY_GATEWAY_NAMES: Readonly<Record<string, string>> = {}

export function FulfillmentPlanTable({
  plan,
  currencyCode,
  gatewayNames = EMPTY_GATEWAY_NAMES,
}: FulfillmentPlanTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())

  if (plan.groups.length === 0) {
    return (
      <p className='rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-sm'>
        Nothing to post in this range. Every shipment in it either already carries a live posting or
        is listed below with the reason it does not.
      </p>
    )
  }

  const toggle = (groupKey: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(groupKey)) next.add(groupKey)
      return next
    })

  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='min-w-[150px]'>Period</TableHead>
            <TableHead className='min-w-[110px]'>Ship date</TableHead>
            <TableHead className='text-right'>Orders</TableHead>
            <TableHead className='text-right'>Shipments</TableHead>
            <TableHead className='text-right'>Subtotal</TableHead>
            <TableHead className='text-right'>Tax</TableHead>
            <TableHead className='text-right'>Shipping</TableHead>
            <TableHead className='text-right'>Total</TableHead>
            {DEBIT_ROLE_ORDER.map((role) => (
              <TableHead key={role} className='text-right' title={DEBIT_ROLE_LABEL[role]}>
                {DEBIT_ROLE_COLUMN[role]}
              </TableHead>
            ))}
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
  )
}

/** The posting row, and the shipments it summarises underneath it. */
function GroupRows({
  group,
  currencyCode,
  gatewayNames,
  open,
  onToggle,
}: {
  group: FulfillmentPostingGroup
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
        <TableCell className='text-right tabular-nums'>{group.orderCount}</TableCell>
        <TableCell className='text-right tabular-nums'>{group.shipments.length}</TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatMinor(group.totals.subtotalMinor, currencyCode)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatMinor(group.totals.taxMinor, currencyCode)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatMinor(group.totals.shippingMinor, currencyCode)}
        </TableCell>
        <TableCell className='text-right font-medium tabular-nums'>
          {formatMinor(group.totals.totalMinor, currencyCode)}
        </TableCell>
        {DEBIT_ROLE_ORDER.map((role) => (
          <TableCell key={role} className='text-right text-muted-foreground tabular-nums'>
            {formatSplit(group.totals.byDebitRole[role], currencyCode)}
          </TableCell>
        ))}
      </TableRow>

      {open &&
        group.shipments.map((shipment) => (
          // 🛑 Keyed on `(orderId, sequence)`, never on `orderId`. One order can
          // ship twice on the same day under a week or month grouping, and a
          // list keyed on the order alone silently drops the second shipment
          // out of a table whose whole job is proving what is in the entry.
          <TableRow
            key={`${shipment.orderId}-${shipment.sequence}`}
            className='bg-muted/30 hover:bg-muted/40'>
            <TableCell className='text-xs'>
              <span className='block ps-4 truncate'>{shipment.orderNumber}</span>
              <span className='block ps-4 text-[11px] text-muted-foreground'>
                Shipment {shipment.sequence} ·{' '}
                {debitLabel(
                  shipment.amounts.debitRole,
                  shipment.amounts.debitGlAccountId,
                  gatewayNames
                )}{' '}
                · {TAX_BASIS_LABEL[shipment.amounts.taxBasis]}
              </span>
            </TableCell>
            <TableCell className='text-muted-foreground text-xs'>
              {formatDayKey(shipment.shippedAt)}
            </TableCell>
            <TableCell />
            <TableCell />
            <TableCell className='text-right text-muted-foreground tabular-nums'>
              {formatMinor(shipment.amounts.subtotalMinor, currencyCode)}
            </TableCell>
            <TableCell className='text-right text-muted-foreground tabular-nums'>
              {formatMinor(shipment.amounts.taxMinor, currencyCode)}
            </TableCell>
            <TableCell className='text-right text-muted-foreground tabular-nums'>
              {formatMinor(shipment.amounts.shippingMinor, currencyCode)}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {formatMinor(shipment.amounts.totalMinor, currencyCode)}
            </TableCell>
            {DEBIT_ROLE_ORDER.map((role) => (
              <TableCell key={role} className='text-right text-muted-foreground tabular-nums'>
                {shipment.amounts.debitRole === role
                  ? formatMinor(shipment.amounts.totalMinor, currencyCode)
                  : ''}
              </TableCell>
            ))}
          </TableRow>
        ))}
    </>
  )
}

/** A zero in a split column is noise; the three that are non-zero are the answer. */
function formatSplit(minorUnits: number | undefined, currencyCode: string): string {
  if (!minorUnits) return ''
  return formatMinor(minorUnits, currencyCode)
}

/**
 * Render a `YYYY-MM-DD` group or shipment key.
 *
 * 🛑 Formatted in UTC and NOT through `formatAccountingDate`. These keys were
 * already cut in the org's book time zone server-side, so re-projecting them
 * into that zone shifts a July 1 shipment to June 30 on any org west of UTC:
 * the day the posting is filed under and the day the table shows would then
 * disagree, on the one screen whose job is to be believed.
 */
export function formatDayKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return dayKey
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}
