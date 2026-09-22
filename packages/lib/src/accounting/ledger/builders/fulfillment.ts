// packages/lib/src/accounting/ledger/builders/fulfillment.ts

/**
 * The fulfillment entry: revenue and receivables recognised when goods SHIP.
 *
 * PURE. No database, no clock, no chart - same input in, same `BuiltEntry` out,
 * forever. That is what lets the proportional-allocation rules below be tested
 * exhaustively without a fixture, and it is why the channel table is DECLARED
 * here rather than derived from anything.
 *
 * ```
 *   Dr accounts_receivable                     this shipment's total
 *   Dr discounts_given   (channel dimension)  list minus net on the shipped lines
 *       Cr revenue_product   (channel dimension)  this shipment's subtotal at LIST
 *       Cr gift_card_liability                    the shipped gift card lines, at net
 *       Cr sales_tax_payable (jurisdiction dimension, when it ties)
 *                                                  this shipment's tax
 *       Cr revenue_shipping                      the order's shipping, ONCE
 * ```
 *
 * ## 🛑 This entry emits NO COGS leg
 *
 * Under L1 the month-end entry asserts all three inventory accounts to the
 * subledger's value with COGS as the balancing figure, so a per-fulfillment COGS
 * posting would be a second writer of `inventory_finished_goods` that nothing
 * downstream could detect. COGS moves onto the inventory entry with the rest of
 * the regime switch (`plans/accounting/tasks/61-inventory-posts-like-everything-else.md`
 * I2), not behind a flag here.
 *
 * ## Recognition is on SHIPMENT for GOODS, never on the invoice
 *
 * `invoice.issuedAt` is the tempting field and it is the wrong one FOR AN
 * ORDER. `invoice` already carries `billingKind`, `servicePeriodStart/End`,
 * `progressPercent` and `installmentName`, which is this product saying out
 * loud that invoice date and delivery date routinely differ. Recognising a
 * shipped product on paper misstates every period boundary.
 *
 * ⚠️ **That rule is about goods, and `build-invoice-entry.ts` is not a
 * contradiction of it.** A service invoice has no shipment, so issuance is the
 * only event there is: the work is billed and the customer owes it. The two
 * builders are one policy read on two document families, and they cannot
 * double-count, because `invoice` and `order` are disjoint - no order field on
 * an invoice, no invoice field on an order, in either direction. Product
 * revenue lands on `4000` from here; service revenue lands on `4030`
 * from there.
 *
 * @see plans/accounting/tasks/done/01-post-revenue-to-the-ledger.md
 */

import { UnprocessableEntityError } from '../../../errors'
import { assertDocumentKey } from '../periods/period-key'
import type { BuiltEntry, GlPostingLineInput } from '../types'
import { ACCOUNT_ROLES, type AccountRole, buildEntry } from './entry'
import { sourceFactsMemo } from './source-facts-memo'
import type { JurisdictionTaxLine } from './split-tax-by-jurisdiction'
import { splitTaxByJurisdiction } from './split-tax-by-jurisdiction'

/** The `sourceType` every fulfillment line carries: the `order` record. */
export const FULFILLMENT_SOURCE_TYPE = 'order'

/**
 * The channel keyspace this table is total over.
 *
 * `order_channel` is `dtc | dealer | manual` AND NULLABLE
 * (`resources/registry/enum-values.ts`), so there are FOUR cases, not two. A
 * missing value is its own case with its own answer and gets the literal key
 * `'null'` - an object cannot be keyed on `null` itself, and collapsing it into
 * `manual` would make "nobody has said" and "somebody said manual" the same
 * fact.
 */
export type OrderChannelKey = 'dtc' | 'dealer' | 'manual' | 'null'

/**
 * Which `dimensions.channel` value each order channel writes onto the
 * `revenue_product` line. DECLARED, never derived.
 *
 * 🛑 **This used to be a role map** (`revenue_dtc` | `revenue_dealer`) and it
 * is a keyspace now (brief 13 §5): channel is a reporting DIMENSION on one
 * `revenue_product` account, never a second account. The P&L still splits
 * revenue by channel - now by grouping on `dimensions.channel` instead of by
 * account - which is exactly the acceptance this table exists to keep true.
 *
 * ## ⤵️ It fails OPEN, and it used to fail closed
 *
 * `manual` and `null` used to REFUSE, on the argument that `4000` and `4010`
 * (now retired) were two revenue accounts and a default to `dtc` puts a dealer
 * sale in the consumer line, where it balances and is invisible until somebody
 * reads the P&L by channel. The argument is sound and the answer was still
 * wrong, for a reason the data settled (49 §4.6, §8.1 item 6, §8.4 decision 5):
 *
 * - `order_channel` is **human-set, never derived**, and no connector binds it.
 *   535 of 545 orders on the reference org carry the registry DEFAULT, `manual`.
 * - So the refusal did not protect a split; it refused **every imported order**,
 *   and the P&L by channel it was defending held nothing at all.
 * - Neither dealer signal (`contact_customer_type`, B2B terms) reaches the
 *   database yet, so nothing can set the value correctly in bulk either.
 *
 * A default that recognises consumer revenue is the honest reading of *"nobody
 * has said"* for a business whose unmarked orders are Shopify checkouts. It is
 * also **correctable**: an order booked to the wrong dimension is fixed by
 * setting the channel and posting a compensating entry, whereas revenue that
 * was never recognised at all is invisible. When the dealer signal lands, the
 * `dealer` row is already here and the default stops being reached.
 *
 * Widening this table is a one-line edit here - no role, no chart migration,
 * no builder change beyond the value written. Deriving it from
 * `paymentGateways` or tags was tried and cannot work: a manual sale has
 * neither.
 */
export const CHANNEL_KEYS: Record<OrderChannelKey, string> = {
  dtc: 'dtc',
  dealer: 'dealer',
  // "Somebody typed manual" and "nobody has said" are still two different facts
  // - see `OrderChannelKey` - and they simply have the same answer today.
  manual: 'dtc',
  null: 'dtc',
}

/** Normalise a stored `order_channel` value - anything unrecognised is `'null'`. */
export function toChannelKey(channel: string | null | undefined): OrderChannelKey {
  const trimmed = channel?.trim()
  if (trimmed === 'dtc' || trimmed === 'dealer' || trimmed === 'manual') return trimmed
  return 'null'
}

/**
 * A stored money AMOUNT, asserted to be whole minor units.
 *
 * The sibling of `toMinorUnits` in `build-manual-entry.ts`, and NOT a
 * substitute for it: that one converts DOLLARS a person typed; this one takes a
 * value that is already in minor units and only has to survive the fact that
 * `FieldValue.valueNumber` is a `doublePrecision` column. `order_subtotal`,
 * `order_tax_total`, `order_shipping_total` and `order_total` are all declared
 * "integer minor units" and all live in that double, so `26400` can read back
 * as `26399.999999999996`.
 *
 * Rounds only the double's own noise floor and REFUSES a genuinely fractional
 * value: half a cent on an amount is a bug that has already happened upstream,
 * and silently absorbing it makes the entry not tie to the document it came
 * from.
 *
 * @throws {UnprocessableEntityError} on a non-finite or fractional value.
 */
export function toAmountMinor(value: number | null | undefined, label: string): number {
  if (value == null) return 0
  if (!Number.isFinite(value)) {
    throw new UnprocessableEntityError(`${label} is ${String(value)}, which is not a number`, {
      label,
      value: String(value),
    })
  }
  const rounded = Math.round(value)
  if (Math.abs(value - rounded) > 1e-6) {
    throw new UnprocessableEntityError(
      `${label} is ${value}, which is not a whole number of cents. A ledger line is whole cents.`,
      { label, value: String(value) }
    )
  }
  return rounded
}

/**
 * `rate x quantity -> amount`. **The one boundary in this file that rounds.**
 *
 * `line_item_unit_price` is a RATE carrying `RATE_DECIMALS` (5) major-unit
 * places, so its `valueNumber` may legitimately hold a FRACTIONAL minor unit -
 * `1.594` cents for a $15.94-per-1,000 screw. An amount may not. The costing
 * guide's rate/amount rule says the multiplication is the only place a fraction
 * of a cent is created or destroyed, so it is done here, once, and named.
 *
 * @throws {UnprocessableEntityError} on a non-finite rate or quantity.
 */
export function extendRateToAmount(rateMinor: number, quantity: number, label: string): number {
  if (!Number.isFinite(rateMinor) || !Number.isFinite(quantity)) {
    throw new UnprocessableEntityError(
      `${label} cannot be extended: rate ${String(rateMinor)} x quantity ${String(quantity)}`,
      { label }
    )
  }
  return Math.round(rateMinor * quantity)
}

/** One shipped line as {@link computeShipmentTotals} reads it. */
export interface ShipmentTotalsLine {
  /** For the refusal message only. Never a lookup key here. */
  lineId: string
  /** Units shipped in THIS shipment. */
  quantity: number
  /**
   * Minor units per unit at the line NET - `line_item_net_total / line_item_qty`
   * (falling back to `line_item_line_total`), not `line_item_unit_price` (see
   * {@link computeShipmentTotals}). A RATE, so it may be fractional - see
   * {@link extendRateToAmount}.
   *
   * The FALLBACK basis: read only when {@link lineTotalMinor} and
   * {@link orderedQuantity} are not both supplied.
   */
  unitPriceMinor: number
  /**
   * The line NET for the WHOLE line, whole minor units, not this shipment's
   * share of it. Despite the name this carries `line_item_net_total`, with
   * `line_item_line_total` (the GROSS since 29 §2.3) only as the readers'
   * fallback for a line that has no net yet - `money/orders/client.ts`'s
   * `netLineTotalMinor` decides, once, for both this and `unitPriceMinor`, so
   * the allocation and the rate never disagree about the column. Together with
   * {@link orderedQuantity} it switches the subtotal to the cumulative
   * allocation ({@link shippedLineAmount}), which is what makes the shipments
   * of a line sum to its total exactly. `null` and `undefined` both mean NOT
   * SUPPLIED, and the rate above is extended instead.
   */
  lineTotalMinor?: number | null
  /** `line_item_qty`, the ordered quantity. The denominator of the allocation. */
  orderedQuantity?: number | null
  /**
   * Units of this line shipped by EARLIER shipments of the order. `0` (or
   * absent) on the first, which makes the allocation collapse to
   * `round(lineTotal x quantity / orderedQuantity)` - the same number the rate
   * path produces.
   */
  priorShippedQuantity?: number | null
  /**
   * This shipment's tax on this line, whole minor units, when it is known per
   * line. `null` and `undefined` both mean NOT SUPPLIED, which is not zero.
   *
   * 🛑 Already SCALED to what shipped. A caller holding the whole line's tax
   * against a partial shipment scales it first - `computeShipmentAmounts` in
   * `build-fulfillment-batch-entry.ts` is the one that does.
   */
  taxMinor?: number | null
  /**
   * `line_item_line_total`, the whole line at LIST, supplied only when {@link lineTotalMinor}
   * is the stamped `line_item_net_total`. List minus net is the discount allocated to the line.
   */
  listLineTotalMinor?: number | null
  /** A gift card line: what it recognises is owed to the cardholder, never revenue (91 D8). */
  giftCard?: boolean
}

/** What one shipment contributes, all whole minor units. */
export interface ShipmentTotals {
  /** At the line NET: the A/R basis and the tax allocation's basis. Includes gift card lines. */
  subtotalMinor: number
  /** List minus net on the shipped non-gift-card lines; revenue is `subtotal - giftCard + discount`. */
  discountMinor: number
  /** The net of the shipped gift card lines, credited to the liability. */
  giftCardMinor: number
  taxMinor: number
  shippingMinor: number
  /** `subtotal + tax + shipping`. The debit. */
  totalMinor: number
  /** How `taxMinor` was arrived at. A screen says which. */
  taxBasis: 'per_line' | 'allocated'
}

/**
 * What THIS shipment recognises of one line, whole minor units.
 *
 * Two bases, and the caller decides which by what it supplies:
 *
 * - **The line total, allocated cumulatively** when `lineTotalMinor` and a
 *   positive `orderedQuantity` are both present:
 *   `alloc(prior + this) - alloc(prior)`, with
 *   `alloc(q) = round(lineTotalMinor x q / orderedQuantity)`. This is the tax
 *   allocation's own trick (see {@link computeShipmentTotals}) applied to the
 *   line: a total that does not divide by its quantity - 181 over 2 units is a
 *   90.5 rate - extends per shipment to 91 + 91 = 182 under `Math.round`, one
 *   cent over what the customer paid, and the payout can never bring clearing
 *   back to zero by that cent (29 §12 item 6). The difference of two running
 *   allocations hands the odd cent to exactly one shipment - 91 then 90 - with
 *   no "is this the last one" flag to get wrong. A first shipment (`prior` 0)
 *   gets `round(lineTotal x quantity / orderedQuantity)`, which is the number
 *   the rate path produces, so a single-shipment order is unchanged.
 * - **The rate, extended** ({@link extendRateToAmount}) otherwise - bit for bit
 *   what every caller got before the line total travelled with the line.
 *
 * @throws {UnprocessableEntityError} on a non-finite rate or quantity, or a
 *   line total that is not whole minor units.
 */
export function shippedLineAmount(line: ShipmentTotalsLine, label: string): number {
  const ordered = line.orderedQuantity
  if (
    line.lineTotalMinor != null &&
    ordered != null &&
    Number.isFinite(ordered) &&
    ordered > 0 &&
    Number.isFinite(line.quantity)
  ) {
    const lineTotalMinor = toAmountMinor(line.lineTotalMinor, `${label} line total`)
    const prior = line.priorShippedQuantity ?? 0
    if (!Number.isFinite(prior) || prior < 0) {
      throw new UnprocessableEntityError(
        `${label} has ${String(prior)} units shipped before this shipment, which cannot be.`,
        { label, priorShippedQuantity: String(prior) }
      )
    }
    const allocateThrough = (units: number): number =>
      Math.round((lineTotalMinor * units) / ordered)
    return allocateThrough(prior + line.quantity) - allocateThrough(prior)
  }
  return extendRateToAmount(line.unitPriceMinor, line.quantity, label)
}

export interface ShipmentTotalsInput {
  /** What the shipment belongs to, for a refusal: `'order ORD-0012'`. */
  label: string
  lines: readonly ShipmentTotalsLine[]
  /** `order_subtotal`, integer minor units. The denominator of the allocation. */
  orderSubtotalMinor: number
  /** `order_tax_total`, integer minor units. */
  orderTaxTotalMinor: number
  /** Sum of every EARLIER shipment's subtotal. `0` on the first. */
  priorShipmentsSubtotalMinor?: number
  /** `order_shipping_total`, integer minor units. */
  orderShippingTotalMinor: number
  /** Whether THIS shipment carries the order's shipping revenue. */
  includeShipping: boolean
  /** Extra keys on any refusal thrown from here. */
  context?: Record<string, string>
}

/**
 * One shipment's share of its order. **The single implementation of the
 * proportional rules**, called by both fulfillment builders.
 *
 * It was inlined in {@link buildFulfillmentEntry} until the batch builder
 * needed the same numbers (49 §2.3). Two copies of this arithmetic would be two
 * keyspaces free to drift, and a drift is undetectable from the outside: the
 * per-order entry and the summarised one would both balance and disagree about
 * what a day recognised.
 *
 * - **Subtotal** is Σ {@link shippedLineAmount} over the lines: the line total
 *   allocated cumulatively by units when the caller supplies it, and
 *   `round(quantity x unitPriceMinor)` otherwise. From the LINES, never sliced
 *   off `order_subtotal`, because the lines are what actually left the building.
 *
 *   🛑 **`unitPriceMinor` is the line NET per unit, not the list price.** The
 *   subtotal is what the customer owes (29 §1.7, §2.3): the nets sum to
 *   `order_subtotal` and `price x qty` does not. The DISCOUNT is the same
 *   cumulative allocation run over `listLineTotalMinor` minus the net share, so
 *   the boxes of a line sum to its discount exactly; revenue is credited at list
 *   and the discount debited beside it (91 D8).
 * - **Tax** is per line when EVERY line carries `taxMinor`, and otherwise
 *   allocated pro rata CUMULATIVELY:
 *   `alloc(prior + this) - alloc(prior)`, where
 *   `alloc(x) = round(orderTaxTotal x x / orderSubtotal)`. Allocating each
 *   shipment on its own drops the rounding remainder and leaves the receivable
 *   permanently short - three equal shipments of a 300 order carrying 100 of
 *   tax get 33 each and the missing cent can never be cleared. The difference
 *   of two running allocations hands the remainder to whichever shipment
 *   carries the subtotal over the line, with no "is this the last one" flag to
 *   get wrong. An order with a zero subtotal allocates zero rather than
 *   dividing by it.
 *
 *   The all-or-nothing per-line rule is deliberate: mixing a known per-line tax
 *   with an allocated remainder double-counts the lines that carried one.
 * - **Shipping** is the order's shipping in FULL when `includeShipping`, and
 *   zero otherwise. Prorating invents a split the carrier never charged, and
 *   holding it to the LAST shipment means an order that is never completed
 *   never books the shipping it collected.
 *
 * Does NOT refuse a shipment worth nothing: zero is a REFUSAL for the
 * single-order builder and an EXCLUSION for the batch plan, and only the caller
 * knows which.
 *
 * @throws {UnprocessableEntityError} on a non-positive or non-finite quantity,
 *   a stored amount that is not whole minor units, or a line whose net exceeds its list.
 */
export function computeShipmentTotals(input: ShipmentTotalsInput): ShipmentTotals {
  const { label, lines, includeShipping, context } = input

  let subtotalMinor = 0
  let discountMinor = 0
  let giftCardMinor = 0
  let perLineTaxMinor = 0
  let linesWithTax = 0
  for (const [index, line] of lines.entries()) {
    const row = index + 1
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new UnprocessableEntityError(
        `Row ${row} of ${label} ships ${String(line.quantity)} units. A fulfillment carries what ` +
          'actually shipped, so a quantity is always above zero - drop the line instead.',
        { ...context, lineId: line.lineId, row: String(row) }
      )
    }
    const rowLabel = `Row ${row} of ${label}`
    const netMinor = shippedLineAmount(line, rowLabel)
    subtotalMinor += netMinor
    if (line.giftCard) {
      giftCardMinor += netMinor
    } else if (line.listLineTotalMinor != null && line.lineTotalMinor != null) {
      const listMinor = shippedLineAmount(
        { ...line, lineTotalMinor: line.listLineTotalMinor },
        `${rowLabel} list`
      )
      if (listMinor < netMinor)
        throw new UnprocessableEntityError(
          `${rowLabel} recognises ${netMinor} after discount but only ${listMinor} at list. A ` +
            'discount never raises a price, so the line total and its net disagree.',
          { ...context, lineId: line.lineId, row: String(row) }
        )
      discountMinor += listMinor - netMinor
    }
    if (line.taxMinor != null) {
      perLineTaxMinor += toAmountMinor(line.taxMinor, `Row ${row} tax on ${label}`)
      linesWithTax++
    }
  }

  const orderSubtotalMinor = toAmountMinor(input.orderSubtotalMinor, `Subtotal of ${label}`)
  const orderTaxTotalMinor = toAmountMinor(input.orderTaxTotalMinor, `Tax total of ${label}`)
  const priorSubtotalMinor = toAmountMinor(
    input.priorShipmentsSubtotalMinor,
    `Prior shipment subtotal of ${label}`
  )
  const orderShippingTotalMinor = toAmountMinor(
    input.orderShippingTotalMinor,
    `Shipping total of ${label}`
  )

  const taxBasis: 'per_line' | 'allocated' =
    lines.length > 0 && linesWithTax === lines.length ? 'per_line' : 'allocated'
  const allocateThrough = (cumulativeSubtotalMinor: number): number =>
    orderSubtotalMinor > 0
      ? Math.round((orderTaxTotalMinor * cumulativeSubtotalMinor) / orderSubtotalMinor)
      : 0
  const taxMinor =
    taxBasis === 'per_line'
      ? perLineTaxMinor
      : allocateThrough(priorSubtotalMinor + subtotalMinor) - allocateThrough(priorSubtotalMinor)

  const shippingMinor = includeShipping ? orderShippingTotalMinor : 0

  return {
    subtotalMinor,
    discountMinor,
    giftCardMinor,
    taxMinor,
    shippingMinor,
    totalMinor: subtotalMinor + taxMinor + shippingMinor,
    taxBasis,
  }
}

/** One order line, and how much of it went out in THIS shipment. */
export interface FulfillmentShippedLine {
  /** The `line_item` EntityInstance id. Also what the caller validates remaining against. */
  lineId: string
  /** Units shipped in this fulfillment. > 0 - a zero line is dropped by the caller. */
  quantity: number
  /**
   * The line NET per unit in minor units (`line_item_net_total / line_item_qty`,
   * see {@link computeShipmentTotals}), not the list price. A RATE, so it may
   * be fractional - see {@link extendRateToAmount}, which is where it stops
   * being one. The fallback basis when the three fields below are not supplied.
   */
  unitPriceMinor: number
  /**
   * The line NET for the WHOLE line, whole minor units - `line_item_net_total`,
   * or `line_item_line_total` for a line with no net yet (see
   * {@link ShipmentTotalsLine.lineTotalMinor}). With `orderedQuantity`, the
   * subtotal is allocated cumulatively by units so a split line's shipments
   * sum to its total exactly - see {@link shippedLineAmount}.
   */
  lineTotalMinor?: number | null
  /** `line_item_qty`. */
  orderedQuantity?: number | null
  /** Units of this line shipped by EARLIER fulfillments. `0` on the first. */
  priorShippedQuantity?: number | null
  /**
   * This shipment's tax on this line, in whole minor units, when the caller
   * knows it per line. Omitted on every line means the order's `taxTotal` is
   * allocated proportionally instead - see {@link buildFulfillmentEntry}.
   */
  taxMinor?: number
  /** See {@link ShipmentTotalsLine.listLineTotalMinor}. */
  listLineTotalMinor?: number | null
  /** See {@link ShipmentTotalsLine.giftCard}. */
  giftCard?: boolean
  /** For the line memo. Never a lookup key. */
  name?: string
}

export interface BuildFulfillmentEntryInput {
  /** The `order` EntityInstance id. Every line's `sourceId`. */
  orderId: string
  /** The order's own number - `'ORD-0012'`, or a connector's `'#13919'`. */
  orderNumber: string
  /** 1-based. The first shipment of an order is `1`, and keys `ORD-0012-F1`. */
  sequence: number
  /**
   * `order_channel`, verbatim. `manual` and absent both recognise as CONSUMER
   * revenue - the table fails open. See {@link CHANNEL_KEYS}.
   */
  channel: string | null | undefined
  /** `order_currency`, verbatim. Anything but `ledgerCurrency` REFUSES. */
  currency: string | null | undefined
  /**
   * The `FinancialSourceAccount` the sale came from, stamped on the revenue lines (task 47 §5):
   * an id is the storefront, `null` the manual bucket, omitted the org default. The poster
   * passes the entry-level scope instead, which A/R reads too; tax and COGS stay pooled.
   */
  sourceStoreId?: string | null
  /**
   * The one currency the books are kept in.
   *
   * Passed in rather than imported so this file stays pure and client-safe:
   * `LEDGER_CURRENCY` lives in `post-entry.ts`, which imports `@auxx/database`.
   * `money/orders/fulfill.ts` passes that constant, so there is still exactly
   * one authority and no second copy of the string.
   */
  ledgerCurrency: string
  /** `YYYY-MM-DD`. The date the goods went out, which is the accounting date. */
  txnDate: string
  /** What shipped. Empty refuses. */
  shippedLines: FulfillmentShippedLine[]
  /** `order_subtotal`, integer minor units. The denominator of the tax allocation. */
  orderSubtotalMinor: number
  /** `order_tax_total`, integer minor units. Allocated pro rata unless lines carry tax. */
  orderTaxTotalMinor: number
  /**
   * The subtotal of every EARLIER shipment of this order, integer minor units.
   * `0` on the first shipment, and `0` is the default.
   *
   * 🛑 **This is what makes the pro-rata tax allocation add up to the order's
   * tax.** Allocating each shipment independently with `Math.round` loses the
   * remainder: three equal shipments of a 300 order carrying 100 of tax each get
   * `round(100 x 100 / 300) = 33`, the three sum to 99, and A/R is left one cent
   * short forever with no way to clear it. Allocating CUMULATIVELY - this
   * shipment's tax is the running allocation through the end of this shipment
   * minus the running allocation through the end of the last one - trues the
   * remainder up on whichever shipment completes the order, with no
   * "is this the final shipment" flag to get wrong.
   *
   * Left at `0`, this file behaves exactly as it did before the parameter
   * existed, which is correct for a single-shipment order and wrong for the
   * second shipment of a split one. The caller (`money/orders/fulfill.ts`) is
   * the one that knows what already shipped.
   */
  priorShipmentsSubtotalMinor?: number
  /** `order_shipping_total`, integer minor units. Recognised in full, once. */
  orderShippingTotalMinor: number
  /**
   * Whether this entry carries the order's shipping revenue.
   *
   * 🛑 **Shipping ships in FULL on the FIRST fulfillment and never again.** The
   * alternatives were both worse: prorating it across shipments invents a
   * split the carrier never charged, and holding it to the LAST shipment means
   * an order that is never completed never books the shipping it collected. So
   * the caller passes `true` exactly when no prior fulfillment entry exists for
   * this order, and the second entry must not re-recognise it.
   */
  includeShipping: boolean
  /**
   * The order's own contact, for the counterparty on the `accounts_receivable`
   * line (brief 13 §1.2) - never on revenue, tax or shipping. Null or absent
   * still posts; the export is what refuses a receivable line with none.
   */
  contactInstanceId?: string | null
  /**
   * The order's own tax lines - one row per jurisdiction (brief 13 §5,
   * `tax_line` EntityInstances). When present and they SUM to
   * `orderTaxTotalMinor`, the `sales_tax_payable` credit is split pro rata
   * across them with a `jurisdiction` dimension per line - see
   * {@link splitTaxByJurisdiction}. Absent, empty, or not tying to the order's
   * own tax total falls back to today's single undimensioned line: a partial
   * breakdown would read as a complete one.
   */
  taxLines?: readonly JurisdictionTaxLine[]
  /** The entry memo, carried onto every line with none of its own. */
  memo?: string
}

/** What the builder produced, and the arithmetic a screen wants to show. */
export interface BuiltFulfillmentEntry {
  entry: BuiltEntry
  /** `ORD-0012-F1`. Also `BuiltEntry.periodKey`. */
  periodKey: string
  /**
   * `ACCOUNT_ROLES.REVENUE_PRODUCT`, always, now that channel is a dimension
   * rather than a second role (brief 13 §5). Kept as a field, rather than
   * removed, so `money/orders/fulfill.ts` keeps a stable shape to log; the
   * channel itself is on {@link channelDimension}.
   */
  revenueRole: AccountRole
  /** The `dimensions.channel` value the revenue line carries - see {@link CHANNEL_KEYS}. */
  channelDimension: string
  /** This shipment's share of the order, all in integer minor units. */
  subtotalMinor: number
  /** The `discounts_given` debit. */
  discountMinor: number
  /** The `gift_card_liability` credit. */
  giftCardMinor: number
  taxMinor: number
  shippingMinor: number
  /** The A/R debit: subtotal + tax + shipping. */
  totalMinor: number
  /** How the tax number above was arrived at. A screen says which. */
  taxBasis: 'per_line' | 'allocated'
}

/**
 * The period key for one shipment: the order number plus its fulfillment
 * sequence.
 *
 * 🛑 **Not a date.** Two shipments of one order can leave on the same day, and
 * `(organizationId, postingType, periodKey, revision)` is the claim's unique
 * index - a date key would make the second shipment come back `already_posted`
 * and silently recognise nothing. The key is the document number, verbatim.
 */
export function fulfillmentPeriodKey(orderNumber: string, sequence: number): string {
  const number = orderNumber.trim()
  if (!number) {
    throw new UnprocessableEntityError(
      'An order must have a number before it can be fulfilled - the fulfillment entry keys on it, ' +
        'never on the order id, which is a 24-character cuid.'
    )
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new UnprocessableEntityError(
      `Fulfillment sequence must be a whole number from 1, got ${String(sequence)}`,
      { sequence: String(sequence) }
    )
  }
  return assertDocumentKey({
    value: `${number}-F${sequence}`,
    label: 'Fulfillment entry key',
    remedy: 'Shorten the order number, or mint a short fulfillment id and key on that instead.',
    context: { orderNumber: number },
  })
}

/**
 * Build one fulfillment entry from WHAT SHIPPED.
 *
 * ## The proportional rules, stated once
 *
 * - **Subtotal** is Σ {@link shippedLineAmount} over the shipped lines: the
 *   line's NET total allocated cumulatively by units when the caller supplies
 *   `lineTotalMinor` / `orderedQuantity` / `priorShippedQuantity`, and
 *   `round(quantity x unitPriceMinor)` at the NET rate otherwise (29 §1.7 -
 *   see {@link computeShipmentTotals}). It is computed from the lines, never
 *   sliced off `order_subtotal`, because the lines are what actually left the
 *   building.
 * - **Tax** is per-line when EVERY shipped line carries `taxMinor`, and
 *   otherwise allocated pro rata CUMULATIVELY: this shipment's tax is
 *   `round(orderTaxTotal x (prior + this) / orderSubtotal)` minus
 *   `round(orderTaxTotal x prior / orderSubtotal)`, where `prior` is
 *   {@link BuildFulfillmentEntryInput.priorShipmentsSubtotalMinor}. Allocating
 *   each shipment on its own instead drops the rounding remainder and leaves
 *   A/R permanently short - see that field. The all-or-nothing per-line rule is
 *   deliberate: mixing a known per-line tax with an allocated remainder
 *   double-counts the lines that carried one. An order with a zero subtotal
 *   allocates zero rather than dividing by it.
 * - **Shipping** is recognised in FULL on the first fulfillment and zero after
 *   - see {@link BuildFulfillmentEntryInput.includeShipping}.
 *
 * The consequence a reader should hold on to: **two entries for one order sum
 * to less than the order total whenever the last shipment is still outstanding,
 * and exactly to it when the order completes** - provided the caller never
 * ships more than remains, which is `fulfillOrder`'s job, not this function's.
 *
 * Throws rather than returning a `Result` for ground rule 3's reason: a builder
 * that cannot compute its own arithmetic is a bug, and `postEntry` above it
 * converts the throw into a status.
 *
 * @throws {UnprocessableEntityError} on a foreign currency, no shipped lines, a
 *   non-positive quantity, a fractional stored amount, an over-long order
 *   number, or an entry with no value on either side. NOT on an unset channel:
 *   see {@link CHANNEL_KEYS}.
 */
export function buildFulfillmentEntry(input: BuildFulfillmentEntryInput): BuiltFulfillmentEntry {
  const {
    orderId,
    orderNumber,
    sequence,
    channel,
    currency,
    ledgerCurrency,
    txnDate,
    shippedLines,
    includeShipping,
    contactInstanceId,
    taxLines,
    memo,
  } = input

  // ── The currency, before any arithmetic ──────────────────────────────────
  // A silent 1.0 rate is unrecoverable: the entry balances, the trial balance
  // ties, and the revenue is simply the wrong number in the wrong unit.
  const orderCurrency = currency?.trim() || ledgerCurrency
  if (orderCurrency !== ledgerCurrency) {
    throw new UnprocessableEntityError(
      `Order ${orderNumber} is in ${orderCurrency} and the ledger is kept in ${ledgerCurrency}. ` +
        'Posting it would use an implied 1.0 rate, so the fulfillment is refused rather than ' +
        'mis-stated.',
      { orderNumber, currency: orderCurrency, ledgerCurrency }
    )
  }

  // ── The channel, from the DECLARED table ─────────────────────────────────
  // Fails OPEN: an unset channel recognises as consumer revenue rather than
  // refusing the shipment. See CHANNEL_KEYS for why that changed.
  const channelKey = toChannelKey(channel)
  const channelDimension = CHANNEL_KEYS[channelKey]

  if (shippedLines.length === 0) {
    throw new UnprocessableEntityError(
      `Nothing was shipped on order ${orderNumber}. A fulfillment entry recognises what left the ` +
        'building, so there is no entry to build.',
      { orderNumber }
    )
  }

  // ── This shipment's share of the order ───────────────────────────────────
  // The arithmetic itself lives in `computeShipmentTotals`, which the BATCH
  // builder calls with the same numbers. One implementation, two callers.
  const sourceTotals = computeShipmentTotals({
    label: `order ${orderNumber}`,
    lines: shippedLines,
    orderSubtotalMinor: input.orderSubtotalMinor,
    orderTaxTotalMinor: input.orderTaxTotalMinor,
    priorShipmentsSubtotalMinor: input.priorShipmentsSubtotalMinor,
    orderShippingTotalMinor: input.orderShippingTotalMinor,
    includeShipping,
    context: { orderNumber },
  })
  const { subtotalMinor, discountMinor, giftCardMinor, shippingMinor, taxBasis } = sourceTotals
  const taxMinor = sourceTotals.taxMinor
  const totalMinor = subtotalMinor + taxMinor + shippingMinor
  const revenueMinor = subtotalMinor - giftCardMinor + discountMinor

  if (totalMinor <= 0) {
    throw new UnprocessableEntityError(
      `This shipment of order ${orderNumber} is worth ${totalMinor}. A fulfillment entry with no ` +
        'value recognises nothing and would claim the period against an empty posting.',
      { orderNumber, totalMinor: String(totalMinor) }
    )
  }

  const periodKey = fulfillmentPeriodKey(orderNumber, sequence)
  const source = { sourceType: FULFILLMENT_SOURCE_TYPE, sourceId: orderId }
  const facts = { order: orderNumber, channel }
  const shipmentLabel = sourceFactsMemo(facts, `shipment ${sequence}`)

  const lines: GlPostingLineInput[] = []
  let sortOrder = 0
  const push = (line: Omit<GlPostingLineInput, 'sortOrder'>): void => {
    lines.push({ ...line, sortOrder: sortOrder++ } as GlPostingLineInput)
  }

  // Spread onto the store-scoped lines (A/R and revenue); empty when the caller named no store.
  const storeScope =
    input.sourceStoreId === undefined ? {} : { sourceScope: { store: input.sourceStoreId } }

  push({
    ...source,
    accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
    direction: 'debit',
    amount: totalMinor,
    memo: memo ?? shipmentLabel,
    ...storeScope,
    ...(contactInstanceId
      ? { counterpartyType: 'customer' as const, counterpartyId: contactInstanceId }
      : {}),
  })
  if (discountMinor !== 0) {
    push({
      ...source,
      accountRole: ACCOUNT_ROLES.DISCOUNTS_GIVEN,
      direction: 'debit',
      amount: discountMinor,
      memo: sourceFactsMemo(facts, `shipment ${sequence} - discounts`),
      dimensions: { channel: channelDimension },
      ...storeScope,
    })
  }
  // Zero when every shipped line is a gift card.
  if (revenueMinor !== 0) {
    push({
      ...source,
      accountRole: ACCOUNT_ROLES.REVENUE_PRODUCT,
      direction: 'credit',
      amount: revenueMinor,
      memo: sourceFactsMemo(
        facts,
        `shipment ${sequence} - ${shippedLines.length} line${shippedLines.length === 1 ? '' : 's'}`
      ),
      // Both axes on one line, and they are not the same question. `channel`
      // (DTC vs dealer) is an ATTRIBUTE of this sale and stays a dimension on one
      // account; the store is a different BUSINESS and may have an account of its
      // own. Decision D10 keeps them separate rather than collapsing either into
      // the other.
      dimensions: { channel: channelDimension },
      ...storeScope,
    })
  }
  if (giftCardMinor !== 0) {
    push({
      ...source,
      accountRole: ACCOUNT_ROLES.GIFT_CARD_LIABILITY,
      direction: 'credit',
      amount: giftCardMinor,
      memo: sourceFactsMemo(facts, `shipment ${sequence} - gift cards sold`),
    })
  }

  // Zero legs are DROPPED rather than posted at zero. An org that charges no
  // tax has no reason to have mapped `sales_tax_payable`, and a zero line
  // against an unmapped role fails the resolver for no information at all -
  // the same rule `materialize` follows in `build-entry.ts`.
  if (taxMinor !== 0) {
    const taxLabel = taxBasis === 'per_line' ? 'per line' : 'allocated'
    // Split by jurisdiction when the order's own tax lines tie to its total
    // (brief 13 §5) - otherwise the single undimensioned line, unchanged.
    const split = splitTaxByJurisdiction({
      taxMinor,
      taxLines: taxLines ?? [],
      orderTaxTotalMinor: input.orderTaxTotalMinor,
    })
    if (split) {
      for (const { jurisdiction, amountMinor } of split) {
        push({
          ...source,
          accountRole: ACCOUNT_ROLES.SALES_TAX_PAYABLE,
          direction: 'credit',
          amount: amountMinor,
          memo: sourceFactsMemo(
            facts,
            `shipment ${sequence} - sales tax, ${jurisdiction} (${taxLabel})`
          ),
          dimensions: { jurisdiction },
        })
      }
    } else {
      push({
        ...source,
        accountRole: ACCOUNT_ROLES.SALES_TAX_PAYABLE,
        direction: 'credit',
        amount: taxMinor,
        memo: sourceFactsMemo(facts, `shipment ${sequence} - sales tax (${taxLabel})`),
      })
    }
  }
  if (shippingMinor !== 0) {
    push({
      ...source,
      accountRole: ACCOUNT_ROLES.REVENUE_SHIPPING,
      direction: 'credit',
      amount: shippingMinor,
      memo: sourceFactsMemo(facts, 'shipping, recognised once on the first fulfillment'),
      ...storeScope,
    })
  }

  const entry = buildEntry({ postingType: 'fulfillment', periodKey, txnDate, lines })

  return {
    entry,
    periodKey,
    revenueRole: ACCOUNT_ROLES.REVENUE_PRODUCT,
    channelDimension,
    subtotalMinor,
    discountMinor,
    giftCardMinor,
    taxMinor,
    shippingMinor,
    totalMinor,
    taxBasis,
  }
}
