// packages/lib/src/money/orders/client.ts

/**
 * The shipment log's shape, and the pure functions over it.
 *
 * Client-safe: no database, no logger, no io, and NO `'use client'` directive -
 * server code imports this file too and the directive would turn every export
 * into a client-reference proxy there (`docs/lib-module-guide.md` §7).
 */

/** One line's share of one shipment. */
export interface OrderFulfillmentLine {
  /** The `line_item` EntityInstance id. */
  lineId: string
  /** Units shipped in this fulfillment. Always > 0 - a zero line is not recorded. */
  quantity: number
}

/**
 * One shipment, as it is stored on the order.
 *
 * Append-only by construction: `fulfillOrder` pushes and never rewrites, for the
 * same reason `stock_movement` has no update path. A shipment that went out
 * wrongly is corrected by reversing its posting, not by editing the log into
 * agreeing with the ledger.
 */
export interface OrderFulfillment {
  /** 1-based, and the fulfillment's identity: `ORD-0012-F<sequence>` keys its entry. */
  sequence: number
  /** `YYYY-MM-DD`. The date the goods went out, which is the accounting date. */
  shippedAt: string
  lines: OrderFulfillmentLine[]
  /**
   * This shipment's SUBTOTAL, integer minor units, before tax and shipping.
   *
   * 🛑 Not a convenience. It is what the NEXT shipment's tax allocation is
   * computed against: `buildFulfillmentEntry` allocates tax cumulatively
   * (`allocateThrough(prior + this) - allocateThrough(prior)`) so the rounding
   * remainder lands on whichever shipment completes the order instead of being
   * dropped on every one. Without a stored subtotal the caller cannot tell the
   * builder what `prior` is, and three equal shipments of a 300 order with 100
   * tax allocate 99, leaving A/R a cent short forever.
   *
   * Optional only for shipment rows written before this field existed. They
   * contribute zero, which reproduces the old per-shipment behaviour for those
   * orders rather than inventing a number for them.
   */
  subtotalMinor?: number
  /** This shipment's recognised total, integer minor units. */
  totalMinor: number
  /** Whether this shipment carried the order's shipping revenue. Exactly one does. */
  shippingRecognised: boolean
  /** The `GlPosting` this shipment produced. Null when the ledger refused it. */
  glPostingId: string | null
  /** `AUXX-FUL-ORD0012F1`, for a screen that wants to name the entry. */
  docNumber: string | null
  /** ISO instant the row was appended. Audit only. */
  recordedAt: string
}

/**
 * What the `order_fulfillments` JSON column actually holds.
 *
 * 🛑 **An OBJECT wrapping the array, never the bare array.** A `FieldValue`
 * write treats a top-level array as a MULTI-VALUE write - one row per element -
 * and `order_fulfillments` is single-value, so handing it `[a, b]` fails with
 * "single-value; received 2 values", which `UnifiedCrudHandler.setFieldValues`
 * LOGS and SWALLOWS: the update reports success over an order whose shipment log
 * is silently empty, and the next fulfillment then re-ships everything. This is
 * `journal_entry_lines`'s lesson (`postings/journal-entries/client.ts`), taken
 * rather than re-learned.
 *
 * ⚠️ This is the INNER shape. The field-value layer wraps every stored JSON in
 * its own `{ v, meta }` envelope, so the column holds
 * `{ v: { fulfillments: [...] } }`. {@link parseFulfillments} unwraps both.
 */
export interface OrderFulfillmentsEnvelope {
  fulfillments: OrderFulfillment[]
}

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
  /** Minor units per unit. A RATE - it may be fractional. */
  unitPriceMinor: number
  sortOrder: number
}

/**
 * Total units shipped per line across a shipment log.
 *
 * Pure and total: an unknown line id simply does not appear, which is the right
 * answer for a line somebody deleted after it shipped.
 */
export function shippedByLine(fulfillments: readonly OrderFulfillment[]): Map<string, number> {
  const shipped = new Map<string, number>()
  for (const fulfillment of fulfillments) {
    for (const line of fulfillment.lines) {
      shipped.set(line.lineId, (shipped.get(line.lineId) ?? 0) + line.quantity)
    }
  }
  return shipped
}

/**
 * The subtotal shipped so far across a shipment log, integer minor units.
 *
 * Feeds `buildFulfillmentEntry`'s `priorShipmentsSubtotalMinor`, which is what
 * makes the pro-rata tax allocation true itself up on the last shipment. Pure
 * and total: a row written before `subtotalMinor` existed contributes zero.
 */
export function shippedSubtotalMinor(fulfillments: readonly OrderFulfillment[]): number {
  return fulfillments.reduce((sum, row) => sum + (row.subtotalMinor ?? 0), 0)
}

/**
 * The sequence the NEXT fulfillment claims.
 *
 * `max + 1` rather than `length + 1`: the log is append-only, but a reversal
 * story that ever removes an entry must not hand a later shipment a sequence
 * that is already in the ledger - the claim's unique index would converge it to
 * `already_posted` and recognise nothing.
 */
export function nextFulfillmentSequence(fulfillments: readonly OrderFulfillment[]): number {
  return fulfillments.reduce((max, row) => Math.max(max, row.sequence), 0) + 1
}

/**
 * Whether this order's shipping revenue is still to be recognised.
 *
 * Shipping is recognised in FULL on the first fulfillment that posts. A
 * shipment whose posting was refused carries `glPostingId: null` and therefore
 * did NOT recognise it, so the next one must - which is why this reads the flag
 * on the row rather than counting rows.
 */
export function shippingStillOwed(fulfillments: readonly OrderFulfillment[]): boolean {
  return !fulfillments.some((row) => row.shippingRecognised && row.glPostingId !== null)
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
