// packages/lib/src/postings/build-fulfillment-entry.ts

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
 *       Cr revenue_dtc | revenue_dealer          this shipment's subtotal
 *       Cr sales_tax_payable                     this shipment's tax
 *       Cr revenue_shipping                      the order's shipping, ONCE
 *
 *   Dr cogs_product_cost      extended cost of what shipped   <- DARK, see below
 *       Cr inventory_finished_goods    same
 * ```
 *
 * ## 🛑 The COGS leg ships DARK, and it is not an oversight
 *
 * Under the L1 regime the month-end entry ASSERTS all three inventory accounts
 * to the value the subledger computes, with COGS as the balancing figure. A
 * per-fulfillment COGS posting would be a SECOND writer of
 * `inventory_finished_goods`, and the two are not additive: the next close moves
 * the account back to the subledger's number and dumps the residual into the
 * COGS plug, where it reads exactly like consumption. Both entries balance.
 * Nothing downstream can detect it. `findWriterConflicts` in `regime.ts` exists
 * to refuse precisely that state.
 *
 * So the leg is written, behind {@link BuildFulfillmentEntryInput.includeCogs},
 * and NOTHING in the tree passes `true`. It turns on with the rest of L3 as ONE
 * change - `ENABLED_POSTING_TYPES` swaps `month_end_inventory` out at the same
 * moment `SINGLE_WRITER_ROLES_BY_POSTING_TYPE.fulfillment` becomes
 * `[ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS]`. Until then that map entry stays
 * `[]`, which is correct: a dark leg drives nothing.
 * See `docs/inventory-costing-architecture-guide.md` §9.3 and
 * `plans/accounting/tasks/01-post-revenue-to-the-ledger.md` §1.1.
 *
 * ## Recognition is on SHIPMENT, never on the invoice
 *
 * `invoice.issuedAt` is the tempting field and it is the wrong one. `invoice`
 * already carries `billingKind`, `servicePeriodStart/End`, `progressPercent`
 * and `installmentName`, which is this product saying out loud that invoice
 * date and delivery date routinely differ. Recognising on the invoice
 * misstates every period boundary.
 *
 * @see plans/accounting/tasks/01-post-revenue-to-the-ledger.md
 */

import { UnprocessableEntityError } from '../errors'
import { ACCOUNT_ROLES, type AccountRole, buildEntry } from './build-entry'
import { DOC_NUMBER_MAX_LENGTH } from './doc-number'
import type { BuiltEntry, GlPostingLineInput } from './types'

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
 * Which revenue role each order channel books to. DECLARED, never derived.
 *
 * 🛑 **It must fail CLOSED, and two of the four rows do.** `4000` and `4010` are
 * two revenue accounts and a default to DTC would put every dealer sale in the
 * consumer line - an entry that balances perfectly and is invisible until
 * somebody reads the P&L by channel. So `manual` and `null` REFUSE, naming the
 * order and the channel (handoff decision 6.2). A manual sale is not a channel;
 * it is a sale whose channel nobody has recorded, and the remedy is to record
 * it on the order.
 *
 * Widening this table is a one-line edit here plus a role in `ACCOUNT_ROLES`.
 * Deriving it from `paymentGateways` or tags was tried and cannot work: a manual
 * sale has neither.
 */
export const CHANNEL_REVENUE_ROLE: Record<OrderChannelKey, AccountRole | 'refuse'> = {
  dtc: ACCOUNT_ROLES.REVENUE_DTC,
  dealer: ACCOUNT_ROLES.REVENUE_DEALER,
  manual: 'refuse',
  null: 'refuse',
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

/** One order line, and how much of it went out in THIS shipment. */
export interface FulfillmentShippedLine {
  /** The `line_item` EntityInstance id. Also what the caller validates remaining against. */
  lineId: string
  /** Units shipped in this fulfillment. > 0 - a zero line is dropped by the caller. */
  quantity: number
  /**
   * The line's unit price in minor units. A RATE, so it may be fractional - see
   * {@link extendRateToAmount}, which is where it stops being one.
   */
  unitPriceMinor: number
  /**
   * This shipment's tax on this line, in whole minor units, when the caller
   * knows it per line. Omitted on every line means the order's `taxTotal` is
   * allocated proportionally instead - see {@link buildFulfillmentEntry}.
   */
  taxMinor?: number
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
  /** `order_channel`, verbatim. `manual` and absent both REFUSE. */
  channel: string | null | undefined
  /** `order_currency`, verbatim. Anything but `ledgerCurrency` REFUSES. */
  currency: string | null | undefined
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
   * 🛑 **DARK. Nothing in the tree sets this to `true`.** See the file header:
   * a per-fulfillment COGS posting is a second writer of an account the L1
   * month-end entry asserts, and turning it on is the same one-shot L3 switch
   * the buy side waits on. It exists as a parameter rather than as a comment so
   * the leg is written, tested and reviewable before the day it matters.
   */
  includeCogs?: boolean
  /** Extended standard cost of what shipped, minor units. Required when `includeCogs`. */
  cogsMinor?: number
  /** The entry memo, carried onto every line with none of its own. */
  memo?: string
}

/** What the builder produced, and the arithmetic a screen wants to show. */
export interface BuiltFulfillmentEntry {
  entry: BuiltEntry
  /** `ORD-0012-F1`. Also `BuiltEntry.periodKey`. */
  periodKey: string
  /** Which revenue account the channel resolved to. */
  revenueRole: AccountRole
  /** This shipment's share of the order, all in integer minor units. */
  subtotalMinor: number
  taxMinor: number
  shippingMinor: number
  /** The A/R debit: subtotal + tax + shipping. */
  totalMinor: number
  /** How the tax number above was arrived at. A screen says which. */
  taxBasis: 'per_line' | 'allocated'
}

/**
 * `AUXX-FUL-` is nine characters and a reversal adds `-R<n>`, so the compacted
 * key has to leave room for both inside the 21-character cap.
 *
 * Checked HERE rather than left to `buildDocNumber`, because `buildDocNumber`
 * only sees revision 0 on the way in: an over-long key would post fine and then
 * refuse the day somebody tried to REVERSE it, which is the worst moment to
 * discover a keyspace problem.
 */
const MAX_COMPACT_PERIOD_KEY = DOC_NUMBER_MAX_LENGTH - 'AUXX-FUL-'.length - '-R9'.length

/**
 * The period key for one shipment: the order number plus its fulfillment
 * sequence.
 *
 * 🛑 **Not a date.** Two shipments of one order can leave on the same day, and
 * `(organizationId, postingType, periodKey, revision)` is the claim's unique
 * index - a date key would make the second shipment come back `already_posted`
 * and silently recognise nothing. Same rule `build` and `bank_deposit` follow.
 * Hyphens are stripped downstream, so `ORD-0012-F1` becomes `ORD0012F1`.
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
  const key = `${number}-F${sequence}`
  const compact = key.replace(/-/g, '')
  if (compact.length > MAX_COMPACT_PERIOD_KEY) {
    throw new UnprocessableEntityError(
      `Order number "${number}" is too long to key a fulfillment posting: "${key}" compacts to ` +
        `${compact.length} characters and the document number allows ${MAX_COMPACT_PERIOD_KEY} ` +
        '(21 characters total, less "AUXX-FUL-" and a reversal suffix). Shorten the order number, ' +
        'or mint a short fulfillment id and key on that instead.',
      { orderNumber: number, periodKey: key, length: String(compact.length) }
    )
  }
  return key
}

/**
 * Build one fulfillment entry from WHAT SHIPPED.
 *
 * ## The proportional rules, stated once
 *
 * - **Subtotal** is `Σ round(quantity x unitPriceMinor)` over the shipped lines.
 *   It is computed from the lines, never sliced off `order_subtotal`, because
 *   the lines are what actually left the building.
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
 * @throws {UnprocessableEntityError} on a refused channel, a foreign currency,
 *   no shipped lines, a non-positive quantity, a fractional stored amount, an
 *   over-long order number, or an entry with no value on either side.
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
    includeCogs = false,
    cogsMinor,
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
  const channelKey = toChannelKey(channel)
  const revenueRole = CHANNEL_REVENUE_ROLE[channelKey]
  if (revenueRole === 'refuse') {
    throw new UnprocessableEntityError(
      `Order ${orderNumber} has channel "${channelKey === 'null' ? 'none' : channelKey}", which ` +
        'has no revenue account. Product revenue is split DTC vs Dealer and defaulting to either ' +
        'would put the sale in the wrong line of the P&L, where it balances and is invisible. ' +
        'Set the order channel to Direct to consumer or Dealer and fulfil again.',
      { orderNumber, channel: channelKey }
    )
  }

  if (shippedLines.length === 0) {
    throw new UnprocessableEntityError(
      `Nothing was shipped on order ${orderNumber}. A fulfillment entry recognises what left the ` +
        'building, so there is no entry to build.',
      { orderNumber }
    )
  }

  // ── This shipment's subtotal, from the lines ─────────────────────────────
  let subtotalMinor = 0
  let perLineTaxMinor = 0
  let linesWithTax = 0
  for (const [index, line] of shippedLines.entries()) {
    const row = index + 1
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new UnprocessableEntityError(
        `Row ${row} of order ${orderNumber} ships ${String(line.quantity)} units. A fulfillment ` +
          'carries what actually shipped, so a quantity is always above zero - drop the line instead.',
        { orderNumber, lineId: line.lineId, row: String(row) }
      )
    }
    subtotalMinor += extendRateToAmount(
      line.unitPriceMinor,
      line.quantity,
      `Row ${row} of order ${orderNumber}`
    )
    if (line.taxMinor != null) {
      perLineTaxMinor += toAmountMinor(line.taxMinor, `Row ${row} tax on order ${orderNumber}`)
      linesWithTax++
    }
  }

  const orderSubtotalMinor = toAmountMinor(
    input.orderSubtotalMinor,
    `Order ${orderNumber} subtotal`
  )
  const orderTaxTotalMinor = toAmountMinor(input.orderTaxTotalMinor, `Order ${orderNumber} tax`)
  const priorSubtotalMinor = toAmountMinor(
    input.priorShipmentsSubtotalMinor,
    `Order ${orderNumber} prior shipment subtotal`
  )
  const orderShippingTotalMinor = toAmountMinor(
    input.orderShippingTotalMinor,
    `Order ${orderNumber} shipping`
  )

  // ── Tax: per line, or allocated pro rata. Never both ─────────────────────
  const taxBasis: 'per_line' | 'allocated' =
    linesWithTax === shippedLines.length ? 'per_line' : 'allocated'
  // 🛑 CUMULATIVE, not per-shipment. `round(tax x thisSubtotal / orderSubtotal)`
  // computed independently per shipment loses the remainder - three equal
  // shipments of a 300 order with 100 of tax allocate 33 each and A/R never
  // clears. Taking the difference of two running allocations gives the same
  // answer for a first (or only) shipment and hands the whole remainder to
  // whichever shipment carries the subtotal over the line, which is exactly the
  // "two entries sum to the order total when the order completes" claim the
  // JSDoc makes. See `priorShipmentsSubtotalMinor`.
  const allocateThrough = (cumulativeSubtotalMinor: number): number =>
    orderSubtotalMinor > 0
      ? Math.round((orderTaxTotalMinor * cumulativeSubtotalMinor) / orderSubtotalMinor)
      : 0
  const taxMinor =
    taxBasis === 'per_line'
      ? perLineTaxMinor
      : allocateThrough(priorSubtotalMinor + subtotalMinor) - allocateThrough(priorSubtotalMinor)

  const shippingMinor = includeShipping ? orderShippingTotalMinor : 0
  const totalMinor = subtotalMinor + taxMinor + shippingMinor

  if (totalMinor <= 0) {
    throw new UnprocessableEntityError(
      `This shipment of order ${orderNumber} is worth ${totalMinor}. A fulfillment entry with no ` +
        'value recognises nothing and would claim the period against an empty posting.',
      { orderNumber, totalMinor: String(totalMinor) }
    )
  }

  const periodKey = fulfillmentPeriodKey(orderNumber, sequence)
  const source = { sourceType: FULFILLMENT_SOURCE_TYPE, sourceId: orderId }
  const shipmentLabel = `${orderNumber} shipment ${sequence}`

  const lines: GlPostingLineInput[] = [
    {
      ...source,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: 'debit',
      amount: totalMinor,
      memo: memo ?? shipmentLabel,
      sortOrder: 0,
    },
    {
      ...source,
      accountRole: revenueRole,
      direction: 'credit',
      amount: subtotalMinor,
      memo: `${shipmentLabel} - ${shippedLines.length} line${shippedLines.length === 1 ? '' : 's'}`,
      sortOrder: 1,
    },
  ]

  // Zero legs are DROPPED rather than posted at zero. An org that charges no
  // tax has no reason to have mapped `sales_tax_payable`, and a zero line
  // against an unmapped role fails the resolver for no information at all -
  // the same rule `materialize` follows in `build-entry.ts`.
  if (taxMinor !== 0) {
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.SALES_TAX_PAYABLE,
      direction: 'credit',
      amount: taxMinor,
      memo: `${shipmentLabel} - sales tax (${taxBasis === 'per_line' ? 'per line' : 'allocated'})`,
      sortOrder: 2,
    })
  }
  if (shippingMinor !== 0) {
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.REVENUE_SHIPPING,
      direction: 'credit',
      amount: shippingMinor,
      memo: `${orderNumber} - shipping, recognised once on the first fulfillment`,
      sortOrder: 3,
    })
  }

  // ── The dark leg ─────────────────────────────────────────────────────────
  if (includeCogs) {
    const cost = toAmountMinor(cogsMinor, `Order ${orderNumber} cost of goods shipped`)
    if (cost <= 0) {
      throw new UnprocessableEntityError(
        `Order ${orderNumber} was asked for a COGS leg with a cost of ${cost}. A cost of zero is ` +
          'a shipment nobody priced, not a free one.',
        { orderNumber, cogsMinor: String(cost) }
      )
    }
    lines.push(
      {
        ...source,
        accountRole: ACCOUNT_ROLES.COGS_PRODUCT_COST,
        direction: 'debit',
        amount: cost,
        memo: `${shipmentLabel} - cost of goods shipped`,
        sortOrder: 4,
      },
      {
        ...source,
        accountRole: ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
        direction: 'credit',
        amount: cost,
        memo: `${shipmentLabel} - relieved from finished goods`,
        sortOrder: 5,
      }
    )
  }

  const entry = buildEntry({ postingType: 'fulfillment', periodKey, txnDate, lines })

  return {
    entry,
    periodKey,
    revenueRole,
    subtotalMinor,
    taxMinor,
    shippingMinor,
    totalMinor,
    taxBasis,
  }
}
