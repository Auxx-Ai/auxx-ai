// packages/lib/src/money/orders/client.ts

/**
 * The pure functions over an order's shipment history.
 *
 * The shipment records themselves (`Fulfillment` / `FulfillmentLine`) moved to
 * `money/fulfillments/client.ts` in entity migration 153 - `order_fulfillments`
 * is a has_many relationship to real `fulfillment` records now, not a JSON
 * cell on the order, so there is nothing left of the old shape to keep here
 * (`plans/money/tasks/55-shipment-lines.md` §6). This file re-bases the three
 * functions the brief names on that new shape; the arithmetic is unchanged.
 *
 * Client-safe: no database, no logger, no io, and NO `'use client'` directive -
 * server code imports this file too and the directive would turn every export
 * into a client-reference proxy there (`docs/lib-module-guide.md` §7).
 */

import type { Fulfillment } from '../fulfillments/client'

/** The `sourceType` a fulfillment posting's lines carry - the `order` record. */
export const ORDER_FULFILLMENT_SOURCE_TYPE = 'order'

/** One order line, and how much of it is still to ship. */
export interface OrderLineRemaining {
  lineId: string
  name: string
  /** The line's ordered quantity. */
  quantity: number
  /** Units already shipped across every recorded fulfillment. */
  shippedQuantity: number
  /** `quantity - shippedQuantity`, floored at zero. What the dialog prefills. */
  remainingQuantity: number
  /**
   * Minor units per unit at the line NET - see {@link netUnitPriceMinor}. A
   * RATE, so it may be fractional.
   */
  unitPriceMinor: number
  /**
   * This line's own tax for the WHOLE line (`line_item_tax_total`), integer
   * minor units, when the provider supplied it.
   *
   * 🛑 **Null is not zero** (48 §8.2). Null means the sales channel said
   * nothing about this line's tax, and the fulfillment builder then allocates
   * the ORDER's tax pro rata instead. Reading null as zero would recognise a
   * taxed order as untaxed and leave `sales_tax_payable` permanently short.
   */
  lineTaxMinor: number | null
  sortOrder: number
}

/** The line cells {@link netUnitPriceMinor} and {@link netLineTotalMinor} are decided from. */
export interface NetUnitPriceInput {
  /**
   * `line_item_net_total`, minor units: the line total after every allocated
   * discount. Null when the line has never been given one (an org before
   * entity migration 157, a connector org before its remap, a quote line).
   * Optional so an older caller that only knows the total keeps compiling.
   */
  netTotalMinor?: number | null | undefined
  /** `line_item_line_total`, the GROSS `qty x unit price`, minor units. Null when the line carries no total at all. */
  lineTotalMinor: number | null | undefined
  /** `line_item_unit_price`, the GROSS per-unit rate, minor units. */
  unitPriceMinor: number | null | undefined
  /** `line_item_qty`, the ordered quantity. */
  orderedQuantity: number | null | undefined
}

/**
 * The whole-line amount the ledger recognises a line at, minor units: the NET
 * (`line_item_net_total`) when the line has one, else the gross total
 * (`line_item_line_total`), else null when the line carries no total at all.
 *
 * The preference order is the decision in 29 §2.3 (MK, 2026-09-14): `unit_price`
 * and `line_total` stay GROSS so a line matches what Shopify's admin shows, and
 * the allocated net lives in its own column. A connector org that has not run
 * its remap still holds the net in `line_total` (the connector used to write it
 * there) and no `net_total` at all, so the fallback keeps it posting the number
 * it already stored. A native org whose order was recomputed since migration
 * 157 has a `net_total` on every line (equal to the gross where there is no
 * discount) and the fallback is never consulted.
 *
 * 🛑 **Only null falls through, never zero.** A zero net is a fully discounted
 * line, and recognising it at the gross would book revenue nobody was charged.
 * This is the one place the preference is decided; `netUnitPriceMinor` and the
 * readers that hand `shippedLineAmount` its allocation basis both go through it,
 * so the rate and the split allocation cannot disagree about which column a
 * line is recognised from.
 */
export function netLineTotalMinor(
  line: Pick<NetUnitPriceInput, 'netTotalMinor' | 'lineTotalMinor'>
): number | null {
  if (line.netTotalMinor != null && Number.isFinite(line.netTotalMinor)) return line.netTotalMinor
  if (line.lineTotalMinor != null && Number.isFinite(line.lineTotalMinor))
    return line.lineTotalMinor
  return null
}

/**
 * The rate a fulfillment recognises one unit of a line at: the line NET per
 * unit, in minor units.
 *
 * `line_item_unit_price` is the PRE-discount price, `line_item_line_total` is
 * the GROSS `qty x price`, and `line_item_net_total` is `line_total - every
 * discount allocated to the line` - the totals engine writes it for a native
 * order and the connector for a synced one (29 §2.3). On the reference org the
 * nets sum to `order_subtotal` on every one of 6,500 orders and `price x qty`
 * does not on 3,073 of them, so the net is the basis, the gross total is the
 * fallback for a line that has no net yet (see {@link netLineTotalMinor}), and
 * the price is the fallback for a line with no total of either kind
 * (`plans/accounting/tasks/29-clearing-at-the-payment-date.md` §1.7, §2.3).
 *
 * 🛑 **The fallback is for an ABSENT total (null), never a zero one.** A zero
 * total is a fully discounted line; recognising it at the gross price books
 * revenue nobody was charged, and the entry balances.
 *
 * A RATE, left unrounded: `180 / 3` is `60` and `181 / 2` is `90.5`, and
 * `extendRateToAmount` in the builder is the one boundary that turns it into an
 * amount. A total with no positive ordered quantity has nothing to divide by
 * and falls back to the gross price, which is exactly what such a line
 * recognised before the net basis existed.
 */
export function netUnitPriceMinor(line: NetUnitPriceInput): number {
  const { unitPriceMinor, orderedQuantity } = line
  const totalMinor = netLineTotalMinor(line)
  if (
    totalMinor != null &&
    orderedQuantity != null &&
    Number.isFinite(orderedQuantity) &&
    orderedQuantity > 0
  ) {
    return totalMinor / orderedQuantity
  }
  return unitPriceMinor ?? 0
}

/**
 * Total units shipped per line across every fulfillment of an order.
 *
 * Pure and total: an unknown line id simply does not appear, which is the right
 * answer for a line somebody deleted after it shipped.
 *
 * ⚠️ Sums over EVERY fulfillment handed to it, `cancelled` included - the same
 * behaviour the JSON log had (it had no cancellation concept at all). Whether a
 * cancelled fulfillment should free its units back up is brief §9 item 2, an
 * open decision left to task 50; this function does not decide it.
 */
export function shippedByLine(fulfillments: readonly Fulfillment[]): Map<string, number> {
  const shipped = new Map<string, number>()
  for (const fulfillment of fulfillments) {
    for (const line of fulfillment.lines) {
      shipped.set(line.lineItemId, (shipped.get(line.lineItemId) ?? 0) + line.quantity)
    }
  }
  return shipped
}

/**
 * The subtotal shipped so far across an order's fulfillments, integer minor
 * units.
 *
 * Feeds `buildFulfillmentEntry`'s `priorShipmentsSubtotalMinor`, which is what
 * makes the pro-rata tax allocation true itself up on the last shipment. Pure
 * and total.
 */
export function shippedSubtotalMinor(fulfillments: readonly Fulfillment[]): number {
  return fulfillments.reduce((sum, row) => sum + row.subtotalMinor, 0)
}

/**
 * The sequence the NEXT fulfillment claims.
 *
 * `max + 1` rather than `length + 1`: a reversal story that ever removes a
 * fulfillment must not hand a later shipment a sequence that is already in the
 * ledger - the claim's unique index would converge it to `already_posted` and
 * recognise nothing. Matches the rule the connector uses for its own sequence
 * (brief §5's last bullet): stable and 1-based, cancelled fulfillments
 * included.
 */
export function nextFulfillmentSequence(fulfillments: readonly Fulfillment[]): number {
  return fulfillments.reduce((max, row) => Math.max(max, row.sequence), 0) + 1
}

/**
 * Whether this order's shipping revenue is still to be recognised.
 *
 * Shipping is recognised in FULL on the first fulfillment that posts. A
 * shipment whose posting was refused is deleted outright (brief §6.1's
 * rollback) rather than kept with `glPosting: null`, but a row that was
 * SUBSEQUENTLY reversed still carries `shippingRecognised: true` with no live
 * posting - so this reads both the flag and `glPosting` on the row, never
 * just counts rows.
 */
export function shippingStillOwed(fulfillments: readonly Fulfillment[]): boolean {
  return !fulfillments.some((row) => row.shippingRecognised && row.glPosting !== null)
}

/**
 * Derive `order_fulfillment_status` from what is left to ship.
 *
 * `restocked` is never produced here: it is a human's statement about a return,
 * not an arithmetic consequence of shipping, and overwriting it would erase it.
 */
export function fulfillmentStatusFor(
  lines: readonly OrderLineRemaining[]
): 'partial' | 'fulfilled' {
  return lines.every((line) => line.remainingQuantity <= 0) ? 'fulfilled' : 'partial'
}
