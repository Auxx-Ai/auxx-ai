// packages/lib/src/money/fulfillment-posting/derive-log.ts

/**
 * Reconstructing `order_fulfillments` from the sales channel's per-line
 * fulfillment facts.
 *
 * `plans/money/tasks/49-bulk-fulfillment-posting.md` §2.1, §5, §8.1 item 4,
 * §8.4 decision 4.
 *
 * PURE. No database, no clock, no settings - `now` and `timeZone` are handed in,
 * the way `plan.ts` takes its cutoff rather than reading it. That is the whole
 * point of the split: the decision "which lines went out together, and on what
 * day" is the one that has to be testable against the 82 split-shipment orders
 * measured on the dev org without a fixture, a connection or a system clock.
 *
 * Client-safe: types and pure arithmetic only.
 *
 * ## Why this exists at all
 *
 * The one door into the ledger (`money.fulfillOrder`) is a click per order, and
 * it is CLOSED for an imported order: the connector binds Shopify's
 * `fulfillmentStatus` straight onto `order_fulfillment_status`, and the Fulfill
 * button hides once that reads `fulfilled` (49 §1.2). 530 of the dev org's 545
 * orders arrived that way. Every one of them shipped, and the ledger has never
 * heard of it.
 *
 * Shopify already knows what went out when: it projects a per-line fulfilled
 * date, fulfilled quantity and shipment count on every order sync. Entity
 * migration 137 carries those three NATIVELY (`line_item_fulfilled_at`,
 * `line_item_fulfilled_qty`, `line_item_shipment_count`), which is what lets
 * this function know nothing about Shopify at all.
 *
 * ## The reconstruction rule, and why it is sound here
 *
 * A line that carries a fulfilled date and a fulfilled quantity above zero
 * shipped ONCE, on the calendar day of that date in the book time zone. Lines
 * sharing a day are one shipment.
 *
 * ✅ Measured (49 §5), org `abgwpa1l81reht2zmwrcihfu`: 82 of 538 imported orders
 * ship in two shipments, every one of them exactly two, **no line spans two
 * shipments**, every line carries a fulfilled date, and all 82 reconstruct by
 * grouping lines on it. The brief's original plan - hold every split shipment
 * out until per-line data exists - was written before that measurement and is
 * unnecessary (§8.1 item 4).
 *
 * 🛑 The one shape that does NOT reconstruct is a single line that went out in
 * more than one shipment: `shipmentCount > 1` says the line shipped twice and
 * the single `fulfilledAt` cannot say which units went when. Splitting it by
 * guess would date revenue wrongly, and a wrongly dated posting in a closed
 * month cannot be corrected. So the WHOLE order is held out, `heldOut` names
 * the line, and nothing is written.
 */

import { extendRateToAmount } from '../../postings/build-fulfillment-entry'
import { periodKeyForDate } from '../../postings/periods'
import type { OrderFulfillment, OrderFulfillmentLine } from '../orders/client'

/**
 * One order line, with the three channel-supplied fulfillment facts beside the
 * two numbers the shipment's amounts are computed from.
 *
 * `fulfilledAt`, `fulfilledQuantity` and `shipmentCount` are each nullable and
 * null means **not supplied**, never zero and never one (49 §8.2's rule, the
 * same one `line_item_tax_total` carries). A line the channel said nothing about
 * did not ship as far as this function is concerned.
 */
export interface DerivedLineFact {
  /** The `line_item` EntityInstance id. */
  lineId: string
  /** `line_item_qty`. What the tax scale is a fraction OF. */
  orderedQuantity: number
  /** `line_item_unit_price`, minor units per unit. A RATE, so possibly fractional. */
  unitPriceMinor: number
  /** `line_item_tax_total`, integer minor units for the WHOLE line, or null when not supplied. */
  lineTaxMinor: number | null
  /** `line_item_fulfilled_at`, an ISO instant, or null. */
  fulfilledAt: string | null
  /** `line_item_fulfilled_qty`. Null when not supplied; 0 means nothing shipped. */
  fulfilledQuantity: number | null
  /** `line_item_shipment_count`. Above 1 holds the whole order out. */
  shipmentCount: number | null
}

export interface DeriveFulfillmentLogInput {
  /** The order's stored log, as `parseFulfillments` returns it. */
  existing: OrderFulfillment[]
  lines: DerivedLineFact[]
  /** `order_shipping_total`, integer minor units. Recognised in full, once. */
  orderShippingTotalMinor: number
  /** `accounting.bookTimeZone`. The day boundary is cut in it, never in UTC. */
  timeZone: string
  /** ISO instant, for `recordedAt` on the rows this derives. */
  now: string
}

export interface DeriveFulfillmentLogResult {
  /** The log as it should be stored. Equal to `existing` when nothing moved. */
  fulfillments: OrderFulfillment[]
  /** Whether {@link DeriveFulfillmentLogResult.fulfillments} differs from `existing`. */
  changed: boolean
  /** The `lineId` whose `shipmentCount > 1` held the whole order out, or null. */
  heldOut: string | null
}

/** One derived shipment before it is merged against what is already stored. */
interface DerivedShipment {
  /** `YYYY-MM-DD` in the book time zone. */
  shippedAt: string
  lines: OrderFulfillmentLine[]
  subtotalMinor: number
  /** Σ the lines' scaled `lineTaxMinor`. A null line tax contributes zero. */
  taxMinor: number
}

/**
 * Derive the shipment log an order's channel-supplied line facts imply, merged
 * against what the order already stores.
 *
 * ## The merge is append-only, and that is the safety property
 *
 * The stored log is what the ledger was posted from: every entry can carry a
 * `glPostingId`, and lane B's run stamps by `(orderId, sequence)`. So this
 * function may never renumber, reorder or discard a stored entry. Four cases,
 * matched by ship day (49 §2.6 rule 2):
 *
 *  - an existing entry whose day and lines match a derived one is kept
 *    **verbatim**, stamp included - re-deriving must be a no-op, or every sync
 *    would rewrite the log and `changed` would never be false,
 *  - an existing **stamped** entry that differs is kept and the derived one
 *    **dropped**. The ledger and the channel disagree about a shipment that has
 *    already been posted; that is a person's call, not a sync's, and silently
 *    rewriting the row would leave a posted entry describing a shipment nobody
 *    can reconstruct,
 *  - an existing **unstamped** entry that differs is replaced, keeping its
 *    sequence. Nothing was posted from it, so the channel is simply more
 *    current,
 *  - a derived shipment with no existing counterpart is appended.
 *
 * An existing entry on a day the channel no longer reports is kept untouched.
 * A log only ever grows.
 *
 * ## Shipping is recognised once, on the first shipment that has it to recognise
 *
 * `orderShippingTotalMinor` rides the earliest shipment and nothing else. When a
 * surviving stored entry already carries `shippingRecognised`, no derived entry
 * takes it - which is what stops a re-derivation from recognising the same
 * freight revenue twice.
 */
export function deriveFulfillmentLog(input: DeriveFulfillmentLogInput): DeriveFulfillmentLogResult {
  const { existing, lines, orderShippingTotalMinor, timeZone, now } = input

  // 🛑 The hold-out is checked over EVERY line before anything is built, and it
  // holds the whole order out rather than the one line: a shipment log missing
  // one line of an order would post that order's revenue short and read as
  // complete, which is worse than posting nothing.
  const split = lines.find((line) => line.shipmentCount !== null && line.shipmentCount > 1)
  if (split) {
    return { fulfillments: existing, changed: false, heldOut: split.lineId }
  }

  const derived = buildDerivedShipments(lines, timeZone)
  if (derived.length === 0) {
    return { fulfillments: existing, changed: false, heldOut: null }
  }

  // ── Match each derived shipment against a stored entry, by ship day ──
  //
  // Greedy and first-unmatched-wins: two stored entries can share a day (a
  // partial shipment recorded by hand, then the channel's), and pairing each
  // derived shipment with a day at most once is what keeps the merge total.
  const claimed = new Set<number>()
  type Decision =
    | { kind: 'verbatim'; index: number }
    | { kind: 'dropped' }
    | { kind: 'replace'; index: number; shipment: DerivedShipment }
    | { kind: 'append'; shipment: DerivedShipment }

  const decisions: Decision[] = []
  for (const shipment of derived) {
    const index = existing.findIndex(
      (row, i) => !claimed.has(i) && row.shippedAt === shipment.shippedAt
    )
    if (index < 0) {
      decisions.push({ kind: 'append', shipment })
      continue
    }
    claimed.add(index)
    const stored = existing[index]!
    if (linesMatch(stored.lines, shipment.lines)) {
      decisions.push({ kind: 'verbatim', index })
    } else if (stored.glPostingId !== null) {
      decisions.push({ kind: 'dropped' })
    } else {
      decisions.push({ kind: 'replace', index, shipment })
    }
  }

  const replaced = new Set(
    decisions.flatMap((decision) => (decision.kind === 'replace' ? [decision.index] : []))
  )

  // Only the rows that SURVIVE can hold the shipping flag: a replaced row's
  // flag goes with it, and the replacement takes the freight back.
  const shippingOwed = !existing.some((row, i) => !replaced.has(i) && row.shippingRecognised)

  // ── Emit ──
  //
  // Stored rows keep their position and their sequence; derived rows that are
  // new are appended after them. A fresh order (nothing stored) therefore gets
  // sequences 1..n in ship-day order, which is what the contract asks for, and
  // an order that already carries entries never sees one renumbered.
  let nextSequence = existing.reduce((max, row) => Math.max(max, row.sequence), 0) + 1
  const merged: OrderFulfillment[] = [...existing]
  let shippingTaken = !shippingOwed

  for (const decision of decisions) {
    if (decision.kind === 'verbatim' || decision.kind === 'dropped') continue
    const takesShipping = !shippingTaken
    if (takesShipping) shippingTaken = true
    const sequence =
      decision.kind === 'replace' ? existing[decision.index]!.sequence : nextSequence++
    const row = toFulfillment(decision.shipment, {
      sequence,
      shippingMinor: takesShipping ? orderShippingTotalMinor : 0,
      shippingRecognised: takesShipping,
      recordedAt: now,
    })
    if (decision.kind === 'replace') merged[decision.index] = row
    else merged.push(row)
  }

  return { fulfillments: merged, changed: !sameLog(existing, merged), heldOut: null }
}

/**
 * Group the shipped lines into one shipment per calendar day, earliest first.
 *
 * A line is shipped when the channel supplied BOTH a fulfilled date and a
 * fulfilled quantity above zero. Either one missing means the channel said
 * nothing, and a date that does not parse is treated the same way rather than
 * throwing: this function runs inside a finalize pass over a whole sync, and one
 * malformed cell must not cost every other order its log.
 */
function buildDerivedShipments(
  lines: readonly DerivedLineFact[],
  timeZone: string
): DerivedShipment[] {
  const byDay = new Map<string, DerivedShipment>()

  for (const line of lines) {
    const quantity = line.fulfilledQuantity
    if (!line.fulfilledAt || quantity === null || !(quantity > 0)) continue
    const day = calendarDay(line.fulfilledAt, timeZone)
    if (!day) continue

    let shipment = byDay.get(day)
    if (!shipment) {
      shipment = { shippedAt: day, lines: [], subtotalMinor: 0, taxMinor: 0 }
      byDay.set(day, shipment)
    }
    shipment.lines.push({ lineId: line.lineId, quantity })
    // The one rounding boundary: `line_item_unit_price` is a RATE carrying five
    // decimal places, so the extension is where a fraction of a cent stops
    // existing (`extendRateToAmount`'s own doc).
    shipment.subtotalMinor += extendRateToAmount(line.unitPriceMinor, quantity, line.lineId)
    shipment.taxMinor += scaleLineTax(line, quantity)
  }

  return [...byDay.values()].sort((a, b) => (a.shippedAt < b.shippedAt ? -1 : 1))
}

/**
 * This shipment's share of a line's own tax: `round(lineTax * shipped / ordered)`.
 *
 * 🛑 A null `lineTaxMinor` contributes ZERO here and does not mean the order is
 * untaxed - it means the channel supplied no per-line figure, and the batch
 * builder allocates the ORDER's tax across the shipment instead (49 §3.2, the
 * `taxBasis: 'allocated'` fork). This function's number is only ever the
 * `per_line` basis' input.
 *
 * An ordered quantity of zero or less cannot be a denominator. The line still
 * shipped, so it carries its whole line tax rather than none: reading it as zero
 * would leave `sales_tax_payable` short with nothing on any screen saying so.
 */
function scaleLineTax(line: DerivedLineFact, quantity: number): number {
  if (line.lineTaxMinor === null) return 0
  if (!(line.orderedQuantity > 0)) return line.lineTaxMinor
  return Math.round((line.lineTaxMinor * quantity) / line.orderedQuantity)
}

/**
 * The calendar day an instant falls on in the book time zone, or null when the
 * instant does not parse.
 *
 * Reuses `periodKeyForDate` rather than formatting again: a shipment logged at
 * 7pm on July 31 in `America/Los_Angeles` is already August 1 in UTC, and a log
 * that cuts its days differently from the poster that groups them would post a
 * month's last shipments into the next month (`postings/periods.ts` says so at
 * length, and it is the same defect either way).
 */
function calendarDay(instant: string, timeZone: string): string | null {
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return null
  return periodKeyForDate(date, 'day', timeZone)
}

/** A derived shipment as a stored row. `glPostingId`/`docNumber` are always null - nothing is posted yet. */
function toFulfillment(
  shipment: DerivedShipment,
  stamp: {
    sequence: number
    shippingMinor: number
    shippingRecognised: boolean
    recordedAt: string
  }
): OrderFulfillment {
  return {
    sequence: stamp.sequence,
    shippedAt: shipment.shippedAt,
    lines: shipment.lines,
    subtotalMinor: shipment.subtotalMinor,
    totalMinor: shipment.subtotalMinor + shipment.taxMinor + stamp.shippingMinor,
    shippingRecognised: stamp.shippingRecognised,
    glPostingId: null,
    docNumber: null,
    recordedAt: stamp.recordedAt,
  }
}

/** Two line sets are the same shipment when they name the same lines in the same quantities. */
function linesMatch(
  stored: readonly OrderFulfillmentLine[],
  derivedLines: readonly OrderFulfillmentLine[]
): boolean {
  if (stored.length !== derivedLines.length) return false
  const byId = new Map(stored.map((line) => [line.lineId, line.quantity]))
  return derivedLines.every((line) => byId.get(line.lineId) === line.quantity)
}

/**
 * Whether the merge produced exactly what was already stored.
 *
 * Field-by-field rather than a JSON compare: a stored row written before
 * `subtotalMinor` existed omits the key entirely, and `JSON.stringify` would
 * call that different from a derived row carrying the same number.
 */
function sameLog(before: readonly OrderFulfillment[], after: readonly OrderFulfillment[]): boolean {
  if (before.length !== after.length) return false
  return before.every((row, i) => {
    const other = after[i]!
    return (
      row.sequence === other.sequence &&
      row.shippedAt === other.shippedAt &&
      (row.subtotalMinor ?? 0) === (other.subtotalMinor ?? 0) &&
      row.totalMinor === other.totalMinor &&
      row.shippingRecognised === other.shippingRecognised &&
      row.glPostingId === other.glPostingId &&
      row.docNumber === other.docNumber &&
      linesMatch(row.lines, other.lines)
    )
  })
}
