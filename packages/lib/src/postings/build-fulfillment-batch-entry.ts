// packages/lib/src/postings/build-fulfillment-batch-entry.ts

/**
 * ONE fulfillment entry for a whole day, week or month of shipments.
 *
 * PURE. No database, no clock, no chart - the property every builder in this
 * folder has, and here it is what lets a mixed group of card, Affirm, terms and
 * tax-exempt orders be balanced exhaustively in a unit test.
 *
 * ```
 *   Dr accounts_receivable   ONE LINE PER ORDER   that order's terms shipments
 *   Dr clearing_card         summarised           every card shipment's total
 *   Dr clearing_affirm       summarised           every Affirm shipment's total
 *       Cr revenue_dtc       summarised             Σ subtotal, consumer channel
 *       Cr revenue_dealer    summarised             Σ subtotal, dealer channel
 *       Cr sales_tax_payable summarised             Σ tax
 *       Cr revenue_shipping  summarised             Σ shipping
 * ```
 *
 * ## Why this exists beside {@link buildFulfillmentEntry}
 *
 * `buildFulfillmentEntry` posts ONE shipment and keys on `<orderNumber>-F<n>`.
 * That is right for a hand-run order and wrong for an imported backlog: 613
 * shipments on the reference org are 613 `GlPosting` rows, which is the row
 * shape `plans/money/tasks/45-batch-only-builds.md` §0 refused for builds. The
 * batch entry is the shape `design/gap-f-fulfillment-entry.md` §1 designed in
 * the first place - one posting per recognition period - and both builders share
 * one implementation of the arithmetic (`computeShipmentTotals`), so a day's
 * summary and a single order's entry can never disagree about what shipped.
 *
 * `fulfillOrder` still calls the single-shipment builder. Neither replaces the
 * other.
 *
 * ## Three things this file is careful about
 *
 * 1. **The debit is not always a receivable.** A Shopify order was PAID at
 *    checkout, so debiting `accounts_receivable` fills aging with money nobody
 *    owes and leaves `clearing_card` permanently negative when the payout
 *    entry drains it. {@link resolveFulfillmentDebit} is that fork, and it
 *    EXCLUDES rather than guesses when the gateways do not say.
 * 2. **The A/R leg stays per order.** Aging has to name the debtor, so a terms
 *    order gets its own line with `sourceType: 'order'` while everything else
 *    summarises under the period key (49 §2.5).
 * 3. **The list of what was summarised is FROZEN into the entry.** Summarised
 *    lines name a period key, not fifty orders, so `BuiltEntry.sources` carries
 *    `{orderId, orderNumber, sequence, amounts}` per shipment into the posting's
 *    `draft` envelope. A later correction is a compensating entry computed from
 *    that slice - never a repost, and never an edit of a posted entry.
 *
 * @see plans/money/tasks/49-bulk-fulfillment-posting.md §2.3, §2.5, §3.2, §8.4
 * @see plans/money/tasks/49-build-contract.md for the seam this is one half of
 */

import { UnprocessableEntityError } from '../errors'
import type {
  FulfillmentDebitRole,
  FulfillmentPostingExclusionReason,
  FulfillmentPostingGroup,
  ShipmentAmounts,
  UnpostedShipment,
  UnpostedShipmentLine,
} from '../money/fulfillment-posting/types'
import { FULFILLMENT_BATCH_SOURCE_TYPE } from '../money/fulfillment-posting/types'
import { ACCOUNT_ROLES, type AccountRole, buildEntry } from './build-entry'
import {
  CHANNEL_REVENUE_ROLE,
  computeShipmentTotals,
  FULFILLMENT_SOURCE_TYPE,
  toAmountMinor,
  toChannelKey,
} from './build-fulfillment-entry'
import { DOC_NUMBER_MAX_LENGTH, DOC_NUMBER_PREFIX } from './doc-number'
import type { BuiltEntry, GlPostingLineInput } from './types'

// ── The debit fork ──────────────────────────────────────────────────────────

/**
 * The financial statuses that mean **the money has already been taken**.
 *
 * `partially_refunded` and `refunded` are here with `paid` on purpose: both
 * describe an order that WAS paid, and the refund is its own later event (a
 * credit memo, `plans/accounting/tasks/10-credit-memos.md`). Treating a
 * refunded order as unpaid would debit a receivable for money that was
 * collected and then returned, and the memo's settlement leg
 * (`Dr accounts_receivable / Cr clearing_card`) would have nothing to net
 * against.
 *
 * Anything else - `pending`, `authorized`, `partially_paid`, blank - is an
 * order that OWES, which is the terms/dealer case.
 */
const SETTLED_FINANCIAL_STATUSES: ReadonlySet<string> = new Set([
  'paid',
  'partially_refunded',
  'refunded',
])

/**
 * Shopify's test gateway. An order taken through it is not a sale.
 *
 * 🛑 Checked FIRST, before the financial status. See
 * {@link resolveFulfillmentDebit}.
 */
const TEST_GATEWAY = 'bogus'

/**
 * Shopify's "manual payment" gateway: an invoice, a wire, a cheque, a
 * pay-later arrangement. The money has NOT arrived on a rail auxx can see, so
 * the order owes whatever its financial status claims.
 */
const MANUAL_GATEWAY = 'manual'

/**
 * Which clearing account each named gateway settles into. DECLARED.
 *
 * Only gateways whose answer is NOT the card rail need a row: everything else
 * (PayPal, Stripe, Shop Pay, a gateway nobody has seen yet) settles as card
 * money into `clearing_card`, which is the account a payout entry drains.
 *
 * 🛑 `affirm` is the row that matters. An Affirm settlement never lands on the
 * card rail and is invisible to the payouts API, so an Affirm sale debited to
 * `clearing_card` leaves that account with a residual no payout can ever
 * relieve - it balances, and `1200` simply stops reconciling to zero.
 */
export const FULFILLMENT_GATEWAY_DEBIT: Readonly<Record<string, FulfillmentDebitRole>> = {
  shopify_payments: 'clearing_card',
  affirm: 'clearing_affirm',
}

/** The exclusions the debit fork itself can produce. A subset of lane B's closed set. */
export type FulfillmentDebitExclusionReason = Extract<
  FulfillmentPostingExclusionReason,
  'gateway-ambiguous' | 'test-gateway'
>

/** What {@link resolveFulfillmentDebit} answers: an account, or a reason not to post. */
export type FulfillmentDebitResolution =
  | { kind: 'debit'; role: FulfillmentDebitRole }
  | { kind: 'exclude'; reason: FulfillmentDebitExclusionReason; detail: string }

/** Trim, lower-case and de-duplicate a gateway list, preserving first-seen order. */
function normaliseGateways(gateways: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const gateway of gateways) {
    const value = gateway?.trim().toLowerCase()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/**
 * Which account a shipment DEBITS: a clearing account, or the receivable.
 *
 * PURE and total. Gateway names are compared case-insensitively after trim, so
 * `'Affirm'` and `' affirm '` are one gateway.
 *
 * ## The fork, in evaluation order
 *
 * | when | answer |
 * |---|---|
 * | any gateway is `bogus` | exclude, `test-gateway` |
 * | financial status is not `paid`, `partially_refunded` or `refunded` | `accounts_receivable` |
 * | any gateway is `manual` | `accounts_receivable` |
 * | no gateways at all | `accounts_receivable` |
 * | exactly one gateway | {@link FULFILLMENT_GATEWAY_DEBIT}, defaulting to `clearing_card` |
 * | two or more distinct gateways | exclude, `gateway-ambiguous`, detail is the list |
 *
 * ⚠️ **`bogus` is checked before the status, and the build contract listed it
 * second.** A test order is not a sale in any status: the contract's order
 * sends a `bogus` order that is merely `pending` to accounts receivable, which
 * puts Shopify test data into aging. The two orders agree on every real test
 * order, because Shopify marks them `paid`; they differ only where the
 * contract's order is wrong.
 *
 * ## Why an unknown gateway is card money rather than an exclusion
 *
 * A single unrecognised gateway is a rail auxx has not named, not an
 * ambiguity: the order is paid, one processor took it, and `clearing_card` is
 * the account that then fails to reconcile visibly if the guess was wrong.
 * TWO gateways is different in kind - the money split, and no single line can
 * describe it - so that one refuses.
 *
 * @see plans/money/tasks/49-bulk-fulfillment-posting.md §3.2, §8.4 decision 6
 */
export function resolveFulfillmentDebit(input: {
  financialStatus: string | null
  gateways: readonly string[]
}): FulfillmentDebitResolution {
  const gateways = normaliseGateways(input.gateways)
  const listed = gateways.join(', ')

  if (gateways.includes(TEST_GATEWAY)) {
    return { kind: 'exclude', reason: 'test-gateway', detail: listed }
  }

  const status = input.financialStatus?.trim().toLowerCase() ?? ''
  if (!SETTLED_FINANCIAL_STATUSES.has(status)) {
    return { kind: 'debit', role: 'accounts_receivable' }
  }

  // Paid, but not through a rail that settles into a clearing account.
  if (gateways.includes(MANUAL_GATEWAY) || gateways.length === 0) {
    return { kind: 'debit', role: 'accounts_receivable' }
  }

  if (gateways.length === 1) {
    const gateway = gateways[0] as string
    return { kind: 'debit', role: FULFILLMENT_GATEWAY_DEBIT[gateway] ?? 'clearing_card' }
  }

  return { kind: 'exclude', reason: 'gateway-ambiguous', detail: listed }
}

// ── One shipment's amounts ──────────────────────────────────────────────────

/**
 * This shipment's share of a line's tax.
 *
 * `line_item_tax_total` is the tax on the WHOLE line, so a line shipped in two
 * halves must not book it twice: `round(lineTaxMinor x quantity /
 * orderedQuantity)`. A missing ordered quantity cannot scale anything, so the
 * line's tax is taken in full rather than divided by zero - the line shipped,
 * and under-recognising sales tax owed is the worse of the two errors.
 */
function scaleLineTax(line: UnpostedShipmentLine, label: string): number | null {
  if (line.lineTaxMinor == null) return null
  const lineTax = toAmountMinor(line.lineTaxMinor, `Line ${line.lineId} tax on ${label}`)
  const ordered = line.orderedQuantity
  if (!Number.isFinite(ordered) || ordered <= 0) return lineTax
  if (line.quantity >= ordered) return lineTax
  return Math.round((lineTax * line.quantity) / ordered)
}

/**
 * One shipment's amounts, ready to be summed into a group.
 *
 * PURE. Delegates every rule to `computeShipmentTotals` in
 * `build-fulfillment-entry.ts` - subtotal from the lines, tax per line when
 * EVERY line carries one and cumulatively allocated otherwise, shipping in full
 * exactly once - so the batch entry and a single order's entry cannot drift.
 * The only thing added here is {@link scaleLineTax}, because an
 * `UnpostedShipmentLine` carries the whole LINE's tax while
 * `computeShipmentTotals` wants THIS shipment's.
 *
 * @throws {UnprocessableEntityError} on a non-positive quantity or a stored
 *   amount that is not whole minor units.
 */
export function computeShipmentAmounts(
  shipment: UnpostedShipment,
  debitRole: FulfillmentDebitRole
): ShipmentAmounts {
  const label = `order ${shipment.orderNumber}`
  const totals = computeShipmentTotals({
    label,
    lines: shipment.lines.map((line) => ({
      lineId: line.lineId,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      taxMinor: scaleLineTax(line, label),
    })),
    orderSubtotalMinor: shipment.orderSubtotalMinor,
    orderTaxTotalMinor: shipment.orderTaxTotalMinor,
    priorShipmentsSubtotalMinor: shipment.priorShipmentsSubtotalMinor,
    orderShippingTotalMinor: shipment.orderShippingTotalMinor,
    includeShipping: shipment.includeShipping,
    context: { orderId: shipment.orderId, sequence: String(shipment.sequence) },
  })
  return { debitRole, ...totals }
}

// ── The period key ──────────────────────────────────────────────────────────

/** `AUXX-FUL-`, built from the declared prefix rather than typed twice. */
const FULFILLMENT_DOC_PREFIX = `AUXX-${DOC_NUMBER_PREFIX.fulfillment}-`

/**
 * How many characters of compacted period key a fulfillment document number
 * holds, with room for a reversal.
 *
 * `AUXX-FUL-` is 9 and `-R9` is 3, so 9 are left of the 21-character cap. The
 * budget is exactly enough:
 *
 * | grouping | key | compacted | plus an attempt char |
 * |---|---|---|---|
 * | day | `2026-07-06` | 8 | 9 |
 * | week | `2026-W27` | 7 | 8 |
 * | month | `2026-07` | 6 | 7 |
 *
 * 🛑 The `-R9` headroom is the half that is easy to drop and the worst to get
 * wrong: a key that compacts to 12 posts perfectly at revision 0 and REFUSES
 * the day somebody reverses it, leaving an entry in the books with no way to
 * take it out. Same rule every builder in this folder follows.
 */
export const MAX_COMPACT_FULFILLMENT_BATCH_KEY =
  DOC_NUMBER_MAX_LENGTH - FULFILLMENT_DOC_PREFIX.length - '-R9'.length

/** The longest compacted group key the plan can produce: a day, `20260706`. */
const MAX_GROUP_KEY_COMPACT_LENGTH = 8

/**
 * 36 attempts, which is what one base-36 character of key budget holds. The
 * same ceiling, for the same arithmetic, as `MAX_WRITE_OFF_ATTEMPT`.
 */
export const MAX_FULFILLMENT_BATCH_ATTEMPT = 35

/**
 * The period key for one batch posting: the group key, plus an attempt.
 *
 * ## Why the attempt exists
 *
 * `(organizationId, postingType, periodKey, revision)` is the claim's unique
 * index and a duplicate comes back `already_posted` - a SUCCESS status that
 * posts nothing (49 §8.2). A day key claims its day ONCE, so the late order
 * backfilled into an already-posted day would silently recognise nothing while
 * the run reported that it had. That is the exact bug `writeOffPeriodKey`
 * fixed for a partial write-off, and the fix is the same one:
 *
 * - **attempt 0** is the group key verbatim, byte for byte. Load-bearing: the
 *   key is half the uniqueness tuple, so re-keying it would make every posting
 *   already in a ledger invisible to the idempotency check.
 * - **attempt 1..35** appends one base-36 character. `buildDocNumber` strips
 *   hyphens and nothing else, so there is no separator to spend and the
 *   character is simply appended: `2026-07-06` attempt 1 mints `2026-07-061`
 *   and the document number `AUXX-FUL-202607061`.
 *
 * ⚠️ The run allocates the attempt by COUNTING the live postings whose period
 * key is this group's, the way `countWriteOffPostings` does - never by
 * retrying on a conflict, because `already_posted` is not an error to retry.
 *
 * @throws {UnprocessableEntityError} on a blank group key, an attempt outside
 *   `0..35`, or a key that would not survive a reversal inside the cap.
 */
export function fulfillmentBatchPeriodKey(groupKey: string, attempt: number): string {
  const key = groupKey.trim()
  if (!key) {
    throw new UnprocessableEntityError(
      'A batch fulfillment posting needs a group key (a day, an ISO week or a month) to key its ' +
        'document number on.'
    )
  }
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new UnprocessableEntityError(
      `A fulfillment batch attempt must be a whole number from 0, got ${String(attempt)}`,
      { groupKey: key, attempt: String(attempt) }
    )
  }
  if (attempt > MAX_FULFILLMENT_BATCH_ATTEMPT) {
    throw new UnprocessableEntityError(
      `Period ${key} has already produced ${attempt} fulfillment postings, which is more than the ` +
        'document-number keyspace can hold. Post the remainder under a narrower grouping.',
      { groupKey: key, attempt: String(attempt) }
    )
  }

  // 🛑 Asserted rather than assumed: a day key plus one attempt character is
  // exactly the whole budget, so any widening of the prefix or the reversal
  // suffix breaks the late-order case and nothing else would say so.
  if (MAX_COMPACT_FULFILLMENT_BATCH_KEY < MAX_GROUP_KEY_COMPACT_LENGTH + 1) {
    throw new UnprocessableEntityError(
      `The fulfillment document-number budget is ${MAX_COMPACT_FULFILLMENT_BATCH_KEY} compacted ` +
        `characters and a day key plus one attempt character needs ` +
        `${MAX_GROUP_KEY_COMPACT_LENGTH + 1}. A late order backfilled into a posted day could not ` +
        'be keyed at all.',
      { budget: String(MAX_COMPACT_FULFILLMENT_BATCH_KEY) }
    )
  }

  const periodKey = attempt === 0 ? key : `${key}${attempt.toString(36).toUpperCase()}`
  const compact = periodKey.replace(/-/g, '')
  if (compact.length > MAX_COMPACT_FULFILLMENT_BATCH_KEY) {
    throw new UnprocessableEntityError(
      `Period key "${periodKey}" compacts to ${compact.length} characters and a fulfillment ` +
        `document number allows ${MAX_COMPACT_FULFILLMENT_BATCH_KEY} (${DOC_NUMBER_MAX_LENGTH} ` +
        'total, less "AUXX-FUL-" and a reversal suffix).',
      { groupKey: key, periodKey, attempt: String(attempt), length: String(compact.length) }
    )
  }
  return periodKey
}

// ── The entry ───────────────────────────────────────────────────────────────

/** One shipment as the entry froze it. Rides in `BuiltEntry.sources`. */
export interface FulfillmentBatchSource {
  orderId: string
  orderNumber: string
  /** The shipment log entry's `sequence`, so the stamp can be matched back. */
  sequence: number
  amounts: ShipmentAmounts
}

/** Which posting role each debit answer resolves to. DECLARED, one row each. */
export const FULFILLMENT_DEBIT_ACCOUNT_ROLE: Readonly<Record<FulfillmentDebitRole, AccountRole>> = {
  clearing_card: ACCOUNT_ROLES.CLEARING_CARD,
  clearing_affirm: ACCOUNT_ROLES.CLEARING_AFFIRM,
  accounts_receivable: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
}

export interface BuildFulfillmentBatchEntryInput {
  /** The group to post. Its shipments already carry their `amounts`. */
  group: FulfillmentPostingGroup
  /** The one currency the books are kept in. Passed in so this file stays pure. */
  ledgerCurrency: string
  /**
   * 0 on the first claim of this group key; n appends a base-36 attempt
   * character. See {@link fulfillmentBatchPeriodKey}.
   */
  attempt: number
  /** Carried onto every summarised line. The per-order A/R lines keep the order number. */
  memo?: string
}

export interface BuiltFulfillmentBatchEntry {
  entry: BuiltEntry
  /** `fulfillmentBatchPeriodKey(group.groupKey, attempt)`. Also `entry.periodKey`. */
  periodKey: string
  /** Recomputed from the shipments actually posted, not copied off the group. */
  totals: FulfillmentPostingGroup['totals']
}

/** Assert a frozen amount is whole minor units before it decides a ledger line. */
function assertWholeMinor(value: number, label: string, context: Record<string, string>): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new UnprocessableEntityError(
      `${label} is ${String(value)}, which is not a whole number of cents.`,
      context
    )
  }
  return value
}

/**
 * Build ONE entry for a whole group of shipments.
 *
 * ## It balances BY CONSTRUCTION
 *
 * Every debit is a shipment's `totalMinor`; every credit is one component of
 * the same numbers (`subtotal + tax + shipping === total`, which
 * `computeShipmentTotals` guarantees and this function re-asserts on each
 * frozen `amounts`). So `Σ debits === Σ credits` before `buildEntry` is
 * reached, and `buildEntry`'s own gate can only ever confirm it. The
 * re-assertion is the load-bearing half: the debits use `totalMinor` and the
 * credits use its parts, so an `amounts` whose parts do not sum to its total
 * would produce an entry that genuinely does not balance.
 *
 * Zero legs are dropped rather than posted at zero - an org that charges no
 * tax has no reason to have mapped `sales_tax_payable`, and `buildEntry`
 * refuses a zero amount outright.
 *
 * ## The line order, and what each line is sourced on
 *
 * 1. `Dr accounts_receivable`, **one line per order**, `sourceType: 'order'`,
 *    `sourceId: <orderId>`, memo `<orderNumber>`. Aging has to name the debtor,
 *    and `listPostingsForSource` on an order still finds this one.
 * 2. `Dr clearing_card`, `Dr clearing_affirm` - summarised.
 * 3. `Cr revenue_dtc`, `Cr revenue_dealer` - summarised, split on the order's
 *    channel through the fail-open {@link CHANNEL_REVENUE_ROLE} table.
 * 4. `Cr sales_tax_payable` - summarised. 5. `Cr revenue_shipping` - summarised.
 *
 * Every summarised line carries `sourceType: 'fulfillment_batch'` and
 * `sourceId: <periodKey>`, which is what keeps aging free of a branch: an A/R
 * line is always an order's.
 *
 * @throws {UnprocessableEntityError} on an empty group, a shipment in a foreign
 *   currency, a frozen amount that is not whole minor units or does not sum to
 *   its own total, or a period key that would not survive a reversal.
 */
export function buildFulfillmentBatchEntry(
  input: BuildFulfillmentBatchEntryInput
): BuiltFulfillmentBatchEntry {
  const { group, ledgerCurrency, attempt, memo } = input

  if (group.shipments.length === 0) {
    throw new UnprocessableEntityError(
      `Group ${group.groupKey} holds no shipments. A fulfillment posting recognises what left the ` +
        'building, so there is nothing to post and the period must not be claimed.',
      { groupKey: group.groupKey }
    )
  }

  const periodKey = fulfillmentBatchPeriodKey(group.groupKey, attempt)

  // ── Accumulate ───────────────────────────────────────────────────────────
  const receivableByOrder = new Map<string, { orderNumber: string; amountMinor: number }>()
  const byDebitRole: Record<FulfillmentDebitRole, number> = {
    clearing_card: 0,
    clearing_affirm: 0,
    accounts_receivable: 0,
  }
  const revenueByRole = new Map<AccountRole, number>()
  const sources: FulfillmentBatchSource[] = []
  let subtotalMinor = 0
  let taxMinor = 0
  let shippingMinor = 0
  let totalMinor = 0

  for (const shipment of group.shipments) {
    const context = {
      groupKey: group.groupKey,
      orderId: shipment.orderId,
      orderNumber: shipment.orderNumber,
      sequence: String(shipment.sequence),
    }

    // A silent 1.0 rate is unrecoverable: the entry balances, the trial balance
    // ties, and the revenue is the wrong number in the wrong unit. The plan
    // excludes a foreign shipment before it ever gets here; this is the assert.
    const currency = shipment.currency?.trim() || ledgerCurrency
    if (currency !== ledgerCurrency) {
      throw new UnprocessableEntityError(
        `Order ${shipment.orderNumber} is in ${currency} and the ledger is kept in ` +
          `${ledgerCurrency}. Posting it would use an implied 1.0 rate.`,
        { ...context, currency, ledgerCurrency }
      )
    }

    const amounts = shipment.amounts
    assertWholeMinor(amounts.subtotalMinor, `Shipment subtotal on ${shipment.orderNumber}`, context)
    assertWholeMinor(amounts.taxMinor, `Shipment tax on ${shipment.orderNumber}`, context)
    assertWholeMinor(amounts.shippingMinor, `Shipment shipping on ${shipment.orderNumber}`, context)
    assertWholeMinor(amounts.totalMinor, `Shipment total on ${shipment.orderNumber}`, context)
    const parts = amounts.subtotalMinor + amounts.taxMinor + amounts.shippingMinor
    if (parts !== amounts.totalMinor) {
      throw new UnprocessableEntityError(
        `Shipment ${shipment.sequence} of order ${shipment.orderNumber} carries a total of ` +
          `${amounts.totalMinor} and parts summing to ${parts}. The debit is the total and the ` +
          'credits are its parts, so the entry could not balance.',
        { ...context, totalMinor: String(amounts.totalMinor), parts: String(parts) }
      )
    }

    if (amounts.debitRole === 'accounts_receivable') {
      const existing = receivableByOrder.get(shipment.orderId)
      receivableByOrder.set(shipment.orderId, {
        orderNumber: shipment.orderNumber,
        amountMinor: (existing?.amountMinor ?? 0) + amounts.totalMinor,
      })
    }
    byDebitRole[amounts.debitRole] += amounts.totalMinor

    const revenueRole = CHANNEL_REVENUE_ROLE[toChannelKey(shipment.channel)]
    revenueByRole.set(revenueRole, (revenueByRole.get(revenueRole) ?? 0) + amounts.subtotalMinor)

    subtotalMinor += amounts.subtotalMinor
    taxMinor += amounts.taxMinor
    shippingMinor += amounts.shippingMinor
    totalMinor += amounts.totalMinor

    sources.push({
      orderId: shipment.orderId,
      orderNumber: shipment.orderNumber,
      sequence: shipment.sequence,
      amounts,
    })
  }

  // ── The lines, in the order a reader expects them ────────────────────────
  const summarised = { sourceType: FULFILLMENT_BATCH_SOURCE_TYPE, sourceId: periodKey }
  const describe = (what: string): string =>
    memo ? `${memo} - ${what}` : `${group.groupKey} - ${what}`
  const lines: GlPostingLineInput[] = []
  const push = (line: Omit<GlPostingLineInput, 'sortOrder'>): void => {
    lines.push({ ...line, sortOrder: lines.length } as GlPostingLineInput)
  }

  // 1. The receivable, ONE LINE PER ORDER. Aging needs the debtor, so this leg
  //    alone stays at order grain (49 §2.5).
  for (const [orderId, receivable] of receivableByOrder) {
    if (receivable.amountMinor === 0) continue
    push({
      sourceType: FULFILLMENT_SOURCE_TYPE,
      sourceId: orderId,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: 'debit',
      amount: receivable.amountMinor,
      memo: receivable.orderNumber,
    })
  }

  // 2. The clearing accounts, summarised.
  if (byDebitRole.clearing_card !== 0) {
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.CLEARING_CARD,
      direction: 'debit',
      amount: byDebitRole.clearing_card,
      memo: describe('card clearing'),
    })
  }
  if (byDebitRole.clearing_affirm !== 0) {
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.CLEARING_AFFIRM,
      direction: 'debit',
      amount: byDebitRole.clearing_affirm,
      memo: describe('Affirm clearing'),
    })
  }

  // 3. Revenue, summarised per channel.
  const dtcMinor = revenueByRole.get(ACCOUNT_ROLES.REVENUE_DTC) ?? 0
  const dealerMinor = revenueByRole.get(ACCOUNT_ROLES.REVENUE_DEALER) ?? 0
  if (dtcMinor !== 0) {
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.REVENUE_DTC,
      direction: 'credit',
      amount: dtcMinor,
      memo: describe('product revenue, direct to consumer'),
    })
  }
  if (dealerMinor !== 0) {
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.REVENUE_DEALER,
      direction: 'credit',
      amount: dealerMinor,
      memo: describe('product revenue, dealer'),
    })
  }

  // 4 and 5. Tax and shipping, summarised.
  if (taxMinor !== 0) {
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.SALES_TAX_PAYABLE,
      direction: 'credit',
      amount: taxMinor,
      memo: describe('sales tax'),
    })
  }
  if (shippingMinor !== 0) {
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.REVENUE_SHIPPING,
      direction: 'credit',
      amount: shippingMinor,
      memo: describe('shipping revenue'),
    })
  }

  const built = buildEntry({
    postingType: 'fulfillment',
    periodKey,
    txnDate: group.txnDate,
    lines,
  })

  return {
    // The frozen slice rides into `GlPosting.draft` with the entry - see
    // `BuiltEntry.sources` and `buildPostingDraft`.
    entry: { ...built, sources },
    periodKey,
    totals: { subtotalMinor, taxMinor, shippingMinor, totalMinor, byDebitRole },
  }
}
