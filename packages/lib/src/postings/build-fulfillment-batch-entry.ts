// packages/lib/src/postings/build-fulfillment-batch-entry.ts

/**
 * ONE fulfillment entry for a whole day or month of shipments.
 *
 * PURE. No database, no clock, no chart - the property every builder in this
 * folder has, and here it is what lets a mixed group of card, rail-routed,
 * cash, terms and tax-exempt orders be balanced exhaustively in a unit test.
 *
 * ```
 *   Dr accounts_receivable   ONE LINE PER ORDER    that order's terms shipments
 *   Dr clearing              summarised, per rail   every card shipment's total (task 58 §5.2)
 *   Dr undeposited_funds     summarised             every cash shipment's total (D12)
 *       Cr revenue_product   summarised, per channel dimension  Σ subtotal
 *       Cr sales_tax_payable summarised, per jurisdiction dimension (when it ties)  Σ tax
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
 *    owes and leaves `clearing` permanently negative when the payout
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
  FulfillmentDebit,
  FulfillmentDebitRole,
  FulfillmentPostingExclusionReason,
  FulfillmentPostingGroup,
  ShipmentAmounts,
  UnpostedShipment,
  UnpostedShipmentLine,
} from '../money/fulfillment-posting/types'
import { FULFILLMENT_BATCH_SOURCE_TYPE } from '../money/fulfillment-posting/types'
import { normaliseGatewayHandle } from '../payment-gateways/client'
import { ACCOUNT_ROLES, type AccountRole, buildEntry } from './build-entry'
import {
  CHANNEL_KEYS,
  computeShipmentTotals,
  FULFILLMENT_SOURCE_TYPE,
  toAmountMinor,
  toChannelKey,
} from './build-fulfillment-entry'
import { DOC_NUMBER_MAX_LENGTH, DOC_NUMBER_PREFIX } from './doc-number'
import { splitTaxByJurisdiction } from './split-tax-by-jurisdiction'
import type { BuiltEntry, GlPostingLineInput, PostingReason } from './types'

// ── The debit fork ──────────────────────────────────────────────────────────

/**
 * The financial statuses that mean **the money has already been taken**.
 *
 * `partially_refunded` and `refunded` are here with `paid` on purpose: both
 * describe an order that WAS paid, and the refund is its own later event (a
 * credit memo, `plans/accounting/tasks/done/10-credit-memos.md`). Treating a
 * refunded order as unpaid would debit a receivable for money that was
 * collected and then returned, and the memo's settlement leg
 * (`Dr accounts_receivable / Cr clearing`) would have nothing to net
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
 * A `payment_gateway` record, as far as this pure builder needs to see it
 * (task 58 §5.2 - was brief 13 §5.3's `GatewayRoute`, before the rail scope
 * replaced routing a debit onto the record's OWN account).
 *
 * `handles` is a SET, never one string - the census that motivated this found
 * two rails arriving under two spellings each (`authorize_net` /
 * `authorize.net`, `Affirm` / `affirm`), so the record's key has to be a set to
 * describe one rail. `active` rides along but is NOT read here: a closed
 * gateway's past shipments still post to its own clearing account so it keeps
 * reconciling, and "should this route still be offered" is lane 4's plan.ts
 * concern, not this match's.
 *
 * 🛑 **Carries `id`, never `clearingGlAccountId`.** Every rail's clearing debit
 * is the `clearing` ROLE now, scoped to this record's id (`sourceScope.rail`,
 * `postings/resolve-roles.ts`); the account itself is resolved later, the same
 * way for every rail, matched or not (§3 rule 2).
 */
export interface FulfillmentGatewayRoute {
  /** The `payment_gateway` EntityInstance id - the rail scope a debit resolves through. */
  id: string
  handles: readonly string[]
  active: boolean
  /**
   * The record's display name, for the reason sentence a routed debit carries
   * (brief 28 §5: *"routed by the Affirm gateway record"*). Optional: nothing
   * about the ROUTING reads it, and a caller that has only the handle set gets
   * the handle named instead.
   */
  name?: string
}

/**
 * Which route (if exactly one) claims a normalised gateway handle.
 *
 * Mirrors `matchGatewayRoute` (`payment-gateways/client.ts`) exactly - same
 * zero-or-one-match rule, same case/whitespace normalisation - but answers
 * with the RECORD, not an account id: task 58 moved the fulfillment debit off
 * the record's own account and onto the `clearing` role scoped to the
 * record's id, so there is no account for this match to name any more.
 */
function matchFulfillmentGatewayRoute(
  gateway: string,
  routes: readonly FulfillmentGatewayRoute[] = []
): FulfillmentGatewayRoute | undefined {
  const wanted = normaliseGatewayHandle(gateway)
  if (!wanted) return undefined
  const matches = routes.filter((route) =>
    route.handles.some((handle) => normaliseGatewayHandle(handle) === wanted)
  )
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Shopify's cash tender (D12, task 58 §5.2). Never a rail: nothing settles it
 * through a processor, so it must not land in `clearing` beside money that
 * genuinely will. It is undeposited, exactly like a cheque, until a bank
 * deposit run groups it (§9 item 14).
 */
const CASH_GATEWAY = 'cash'

/** The exclusions the debit fork itself can produce. A subset of lane B's closed set. */
export type FulfillmentDebitExclusionReason = Extract<
  FulfillmentPostingExclusionReason,
  'gateway-ambiguous' | 'test-gateway'
>

/**
 * What {@link resolveFulfillmentDebit} answers: an account, or a reason not to
 * post.
 *
 * The `debit` branch is {@link FulfillmentDebit} widened with the `kind`
 * discriminant every posting-plan answer in this file carries - a role for the
 * three declared accounts, or a `payment_gateway` record's own id when exactly
 * one route named the gateway (brief 13 §5.3) - and it ALWAYS carries a
 * `reason`: which branch of the fork chose the account, in words (brief 28 §5).
 * The exclude branch's `reason` is the closed enum; the debit branch's is a
 * sentence. Same field name, two meanings, told apart by `kind`.
 */
export type FulfillmentDebitResolution =
  | ({ kind: 'debit'; reason: string } & FulfillmentDebit)
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
 * Which account a shipment DEBITS: `clearing` scoped to a rail, undeposited
 * funds, or the receivable.
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
 * | exactly one gateway, and it is `cash` | `undeposited_funds` (D12) |
 * | exactly one gateway, and exactly one `gatewayRoutes` entry names it | `clearing`, rail = that record's id |
 * | exactly one gateway, otherwise | `clearing`, rail = `null` (§3 rule 2 resolves it to the org default) |
 * | two or more distinct gateways | exclude, `gateway-ambiguous`, detail is the list |
 *
 * ⚠️ **`bogus` is checked before the status, and the build contract listed it
 * second.** A test order is not a sale in any status: the contract's order
 * sends a `bogus` order that is merely `pending` to accounts receivable, which
 * puts Shopify test data into aging. The two orders agree on every real test
 * order, because Shopify marks them `paid`; they differ only where the
 * contract's order is wrong.
 *
 * ## Why an unrouted gateway is card money rather than an exclusion
 *
 * A single unrecognised gateway is a rail auxx has not named, not an
 * ambiguity: the order is paid, one processor took it, and the org's default
 * `clearing` account is where a wrong guess fails to reconcile visibly. TWO
 * gateways is different in kind - the money split, and no single line can
 * describe it - so that one refuses.
 *
 * ## 🛑 This is a bridge, not the design (D11, task 58 §5.2)
 *
 * A split tender has no answer at this grain - the order's gateway LIST does
 * not say how much went to which rail. Once the receipt lane (§5.6) posts per
 * transaction, a fulfillment whose order already has a posted receipt must
 * skip this fork entirely and debit deposits or receivables instead, never a
 * rail - see `money/fulfillment-posting/work.ts`'s header for what exists
 * today and what does not.
 *
 * ## `gatewayRoutes` (task 58 §5.2, was brief 13 §5.3's id-routed contract)
 *
 * Optional and empty by default, so every existing caller (and every test in
 * this file) is unaffected. `money/fulfillment-posting/plan.ts` reads the
 * org's `payment_gateway` records and passes them in; this function stays
 * pure and does not read them itself.
 *
 * @see plans/money/tasks/49-bulk-fulfillment-posting.md §3.2, §8.4 decision 6
 * @see plans/accounting/tasks/58-one-mapping-table.md §5.2
 */
export function resolveFulfillmentDebit(input: {
  financialStatus: string | null
  gateways: readonly string[]
  gatewayRoutes?: readonly FulfillmentGatewayRoute[]
}): FulfillmentDebitResolution {
  const gateways = normaliseGateways(input.gateways)
  const listed = gateways.join(', ')

  if (gateways.includes(TEST_GATEWAY)) {
    return { kind: 'exclude', reason: 'test-gateway', detail: listed }
  }

  // Each `reason` below is a predicate on the order(s) it describes, so the
  // builder can prefix `Order #2003 ` or `41 orders ` and read it as a sentence
  // (brief 28 §5). Captured HERE, the one place the branch is known, and frozen
  // into the entry: the gateway records this fork reads move later.
  const status = input.financialStatus?.trim().toLowerCase() ?? ''
  if (!SETTLED_FINANCIAL_STATUSES.has(status)) {
    return {
      kind: 'debit',
      role: 'accounts_receivable',
      reason: `not yet paid (financial status ${status || 'blank'}), so accounts receivable`,
    }
  }

  // Paid, but not through a rail that settles into a clearing account.
  if (gateways.includes(MANUAL_GATEWAY)) {
    return {
      kind: 'debit',
      role: 'accounts_receivable',
      reason: 'paid through the manual gateway, off any rail auxx can see, so accounts receivable',
    }
  }
  if (gateways.length === 0) {
    return {
      kind: 'debit',
      role: 'accounts_receivable',
      reason: 'paid with no gateway recorded, so accounts receivable',
    }
  }

  if (gateways.length === 1) {
    const gateway = gateways[0] as string
    // D12: cash never lands in clearing - nothing settles it through a
    // processor, so it waits in undeposited funds like a cheque.
    if (gateway === CASH_GATEWAY) {
      return {
        kind: 'debit',
        role: 'undeposited_funds',
        reason:
          'paid in cash, banked in a run, so undeposited funds until a bank deposit groups it',
      }
    }
    const matched = matchFulfillmentGatewayRoute(gateway, input.gatewayRoutes)
    return matched
      ? {
          kind: 'debit',
          role: 'clearing',
          rail: matched.id,
          reason: `routed by the ${matched.name?.trim() || gateway} gateway record`,
        }
      : {
          kind: 'debit',
          role: 'clearing',
          rail: null,
          reason: `paid through ${gateway}, which no gateway record claims, so the card clearing fallback`,
        }
  }

  return { kind: 'exclude', reason: 'gateway-ambiguous', detail: listed }
}

// ── One shipment's amounts ──────────────────────────────────────────────────

/**
 * This shipment's share of a line's tax.
 *
 * `line_item_tax_total` is the tax on the WHOLE line, so a line shipped in
 * multiple parts must allocate it cumulatively: `round(lineTaxMinor x
 * (priorQuantity + quantity) / orderedQuantity) - round(lineTaxMinor x
 * priorQuantity / orderedQuantity)`. A missing ordered quantity cannot scale
 * anything, so the line's tax is taken in full rather than divided by zero -
 * the line shipped, and under-recognising sales tax owed is the worse of the
 * two errors.
 */
export function scaleLineTax(
  line: Pick<
    UnpostedShipmentLine,
    'lineId' | 'lineTaxMinor' | 'quantity' | 'orderedQuantity' | 'priorShippedQuantity'
  >,
  label: string
): number | null {
  if (line.lineTaxMinor == null) return null
  const lineTax = toAmountMinor(line.lineTaxMinor, `Line ${line.lineId} tax on ${label}`)
  const ordered = line.orderedQuantity
  if (!Number.isFinite(ordered) || ordered <= 0) return lineTax
  const prior = line.priorShippedQuantity ?? 0
  if (!Number.isFinite(prior) || prior < 0) {
    throw new UnprocessableEntityError(
      `${label} line ${line.lineId} has ${String(prior)} units shipped before this shipment, which cannot be.`,
      { label, priorShippedQuantity: String(prior) }
    )
  }
  const allocateThrough = (units: number): number =>
    Math.round((lineTax * Math.min(ordered, units)) / ordered)
  return allocateThrough(prior + line.quantity) - allocateThrough(prior)
}

/**
 * One shipment's amounts, ready to be summed into a group.
 *
 * PURE. Delegates every rule to `computeShipmentTotals` in
 * `build-fulfillment-entry.ts` - subtotal from the lines, tax per line when
 * EVERY line carries one and cumulatively allocated otherwise, shipping in full
 * exactly once - so the batch entry and a single order's entry cannot drift.
 * Two things are added here:
 *
 * - {@link scaleLineTax}, because an `UnpostedShipmentLine` carries the whole
 *   LINE's tax while `computeShipmentTotals` wants THIS shipment's.
 * - The jurisdiction split (brief 13 §5), from `shipment.taxLines` - see
 *   `splitTaxByJurisdiction`.
 *
 * `debit` is {@link FulfillmentDebit} (a role, `clearing` carrying its rail) -
 * or a bare {@link FulfillmentDebitRole} string, which every test in this file
 * that does not care about the rail or the reason still passes.
 *
 * @throws {UnprocessableEntityError} on a non-positive quantity or a stored
 *   amount that is not whole minor units.
 */
export function computeShipmentAmounts(
  shipment: UnpostedShipment,
  debit: FulfillmentDebit | FulfillmentDebitRole
): ShipmentAmounts {
  const label = `order ${shipment.orderNumber}`
  const totals = computeShipmentTotals({
    label,
    lines: shipment.lines.map((line) => ({
      lineId: line.lineId,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      // The line's whole NET total and how much of it earlier shipments took,
      // so a split line's shipments sum to its total exactly (29 §12 item 6).
      // Absent on a line the reader could not reach, and the rate is extended.
      lineTotalMinor: line.lineTotalMinor,
      orderedQuantity: line.orderedQuantity,
      priorShippedQuantity: line.priorShippedQuantity,
      taxMinor: scaleLineTax(line, label),
    })),
    orderSubtotalMinor: shipment.orderSubtotalMinor,
    orderTaxTotalMinor: shipment.orderTaxTotalMinor,
    priorShipmentsSubtotalMinor: shipment.priorShipmentsSubtotalMinor,
    orderShippingTotalMinor: shipment.orderShippingTotalMinor,
    includeShipping: shipment.includeShipping,
    context: { orderId: shipment.orderId, sequence: String(shipment.sequence) },
  })
  const taxByJurisdiction =
    totals.taxMinor !== 0
      ? (splitTaxByJurisdiction({
          taxMinor: totals.taxMinor,
          taxLines: shipment.taxLines ?? [],
          orderTaxTotalMinor: shipment.orderTaxTotalMinor,
        }) ?? undefined)
      : undefined

  // A bare ROLE STRING skips the rail entirely - every caller that does not
  // have a `resolveFulfillmentDebit` answer to hand (most of this file's own
  // fixtures) still gets a plain `clearing` line, scoped to the org default.
  const debitFields: Pick<ShipmentAmounts, 'debitRole' | 'debitRail' | 'debitReason'> =
    typeof debit === 'string'
      ? { debitRole: debit }
      : debit.role === 'clearing'
        ? { debitRole: 'clearing', debitRail: debit.rail, debitReason: debit.reason }
        : { debitRole: debit.role, debitReason: debit.reason }

  const allocation = shipment.recognitionAllocation
  if (!allocation) return { ...debitFields, ...totals, taxByJurisdiction }

  const allocationAmounts = [
    allocation.amountMinor,
    allocation.depositMinor,
    allocation.receivableMinor,
    allocation.taxMinor,
  ]
  if (
    !allocation.historyHash ||
    allocationAmounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0) ||
    allocation.taxMinor > totals.taxMinor ||
    allocation.amountMinor !== totals.subtotalMinor + totals.shippingMinor + allocation.taxMinor
  ) {
    throw new UnprocessableEntityError(
      `Recognition allocation for shipment ${shipment.sequence} of order ${shipment.orderNumber} ` +
        'is incomplete, exceeds the shipment source components, or has a stale event amount.',
      { orderId: shipment.orderId, sequence: String(shipment.sequence) }
    )
  }

  // Keep source tax in the frozen calculation while the journal credits only
  // tax newly recognized by this shipment. Canonical recognition also ignores
  // the legacy gateway debit fork entirely.
  const recognizedTotal = totals.subtotalMinor + allocation.taxMinor + totals.shippingMinor
  const conservedTaxByJurisdiction = shipment.recognitionTaxComponents?.length
    ? (() => {
        const shares = new Map<string, number>()
        for (const component of shipment.recognitionTaxComponents!) {
          if (!component.jurisdiction) return undefined
          shares.set(
            component.jurisdiction,
            (shares.get(component.jurisdiction) ?? 0) + component.amountMinor
          )
        }
        const total = [...shares.values()].reduce((sum, value) => sum + value, 0)
        return total === allocation.taxMinor
          ? [...shares.entries()].map(([jurisdiction, amountMinor]) => ({
              jurisdiction,
              amountMinor,
            }))
          : undefined
      })()
    : undefined
  return {
    debitRole: 'accounts_receivable',
    ...totals,
    taxMinor: allocation.taxMinor,
    totalMinor: recognizedTotal,
    taxByJurisdiction:
      conservedTaxByJurisdiction ??
      (allocation.taxMinor !== 0
        ? (splitTaxByJurisdiction({
            taxMinor: allocation.taxMinor,
            taxLines: shipment.taxLines ?? [],
            orderTaxTotalMinor: shipment.orderTaxTotalMinor,
          }) ?? undefined)
        : undefined),
    depositDebitMinor: allocation.depositMinor,
    receivableDebitMinor: allocation.receivableMinor,
    newlyRecognizedTaxMinor: allocation.taxMinor,
    sourceTaxMinor: totals.taxMinor,
    recognitionHistoryHash: allocation.historyHash,
  }
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
      'A batch fulfillment posting needs a group key (a day or a month) to key its document ' +
        'number on.'
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
  clearing: ACCOUNT_ROLES.CLEARING,
  accounts_receivable: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
  undeposited_funds: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
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
 * 2. `Dr clearing` and `Dr <gateway route's account>` - summarised, the
 *    second one per distinct account id (brief 13 §5.3).
 * 3. `Cr revenue_product` - summarised PER CHANNEL, one line per
 *    `dimensions.channel` value, through the fail-open {@link CHANNEL_KEYS}
 *    table (brief 13 §5).
 * 4. `Cr sales_tax_payable` - summarised PER JURISDICTION when a shipment's
 *    tax lines tie to its order's total, plus one undimensioned line for
 *    whatever does not (brief 13 §5, `splitTaxByJurisdiction`).
 * 5. `Cr revenue_shipping` - summarised.
 *
 * Every summarised line carries `sourceType: 'fulfillment_batch'` and
 * `sourceId: <periodKey>`, which is what keeps aging free of a branch: an A/R
 * line is always an order's.
 *
 * @throws {UnprocessableEntityError} on an empty group, a shipment in a foreign
 *   currency, a frozen amount that is not whole minor units or does not sum to
 *   its own total, or a period key that would not survive a reversal.
 */
/**
 * A stable bucket key for a shipment's source store, keeping the three states
 * apart: an id, `null` (no connected source - the manual bucket) and `undefined`
 * (the caller named no store at all, so the org default applies).
 */
function storeScopeKey(store: string | null | undefined): string {
  return store === undefined ? '-' : store === null ? 'manual' : store
}

/**
 * A stable bucket key for a clearing debit's rail. `null` and `undefined` are
 * ONE bucket here, unlike {@link storeScopeKey} - `RoleSourceScope`'s rail axis
 * has no manual counterpart (task 58 §5.1: "a manual order has no rail, so a
 * `null` there reads the same as an absent key"), so a matched rail and the
 * org-default fallback are the only two cases a clearing debit ever has.
 */
function railScopeKey(rail: string | null | undefined): string {
  return rail ?? 'default'
}

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
  const receivableByOrder = new Map<
    string,
    { orderNumber: string; amountMinor: number; contactId: string | null; reason?: string }
  >()
  const depositByOrder = new Map<
    string,
    { orderNumber: string; amountMinor: number; contactId: string | null }
  >()
  const byDebitRole: Record<FulfillmentDebitRole, number> = {
    clearing: 0,
    accounts_receivable: 0,
    undeposited_funds: 0,
  }
  /** {@link railScopeKey} -> the clearing debit summarised under that rail (task 58 §5.2). */
  const byRail = new Map<string, { rail: string | null; amountMinor: number }>()
  /**
   * Why each SUMMARISED debit line holds what it holds (brief 28 §5): per
   * debit account, per distinct reason sentence, the orders it applies to. A
   * day's clearing line summarises many orders, so the sentence is per account
   * with an order count, not per order - the per-order answer is in `sources`.
   * Keyed `rail:<railScopeKey>` for clearing, `role:<role>` otherwise.
   */
  const debitReasons = new Map<string, Map<string, Set<string>>>()
  const noteDebitReason = (accountKey: string, reason: string, orderId: string): void => {
    const byReason = debitReasons.get(accountKey) ?? new Map<string, Set<string>>()
    const orders = byReason.get(reason) ?? new Set<string>()
    orders.add(orderId)
    byReason.set(reason, orders)
    debitReasons.set(accountKey, byReason)
  }
  /**
   * `(source store, dimensions.channel)` -> summarised revenue_product credit.
   *
   * 🛑 The STORE is in the key and it is not the same question as the channel
   * (task 47 decision D10). A channel is an ATTRIBUTE of one sale - DTC or
   * dealer - and stays a dimension on one account. A store is a different
   * BUSINESS and may have a revenue account of its own, so two storefronts in
   * one day's group have to stay two lines: `prepareEntry` resolves each line
   * through its own `sourceScope`, and `assertExactContributions` compares the
   * result against each member's own resolution account by account.
   *
   * Keyed on {@link storeScopeKey} so `undefined` (the caller named no store)
   * and `null` (there was no connected source) stay distinguishable.
   */
  const revenueByStoreChannel = new Map<
    string,
    { store: string | null | undefined; channel: string; amountMinor: number }
  >()
  /** `dimensions.jurisdiction` value -> summarised sales_tax_payable credit. */
  const taxByJurisdiction = new Map<string, number>()
  /** Tax that could not be tied to a jurisdiction - one undimensioned line. */
  let taxWithoutJurisdictionMinor = 0
  /** Source store -> summarised revenue_shipping credit. Same split as revenue. */
  const shippingByStore = new Map<
    string,
    { store: string | null | undefined; amountMinor: number }
  >()
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

    const switchedRecognition = amounts.depositDebitMinor != null
    if (switchedRecognition) {
      const deposit = amounts.depositDebitMinor!
      const receivable = amounts.receivableDebitMinor!
      const expectedNet = deposit + receivable - amounts.taxMinor
      if (
        !Number.isSafeInteger(deposit) ||
        !Number.isSafeInteger(receivable) ||
        deposit < 0 ||
        receivable < 0 ||
        expectedNet !== amounts.subtotalMinor + amounts.shippingMinor
      ) {
        throw new UnprocessableEntityError(
          `Recognition debit components for shipment ${shipment.sequence} of order ` +
            `${shipment.orderNumber} do not tie to its shipped net.`,
          {
            ...context,
            expectedNet: String(expectedNet),
            netAndShippingMinor: String(amounts.subtotalMinor + amounts.shippingMinor),
          }
        )
      }
      if (deposit !== 0) {
        const existing = depositByOrder.get(shipment.orderId)
        depositByOrder.set(shipment.orderId, {
          orderNumber: shipment.orderNumber,
          amountMinor: (existing?.amountMinor ?? 0) + deposit,
          contactId: existing?.contactId ?? shipment.contactId,
        })
      }
      if (receivable !== 0) {
        const existing = receivableByOrder.get(shipment.orderId)
        receivableByOrder.set(shipment.orderId, {
          orderNumber: shipment.orderNumber,
          amountMinor: (existing?.amountMinor ?? 0) + receivable,
          contactId: existing?.contactId ?? shipment.contactId,
          reason: existing?.reason,
        })
      }
    } else if (amounts.debitRole === 'accounts_receivable') {
      const existing = receivableByOrder.get(shipment.orderId)
      receivableByOrder.set(shipment.orderId, {
        orderNumber: shipment.orderNumber,
        amountMinor: (existing?.amountMinor ?? 0) + amounts.totalMinor,
        // One order, one contact - every shipment of it carries the same id.
        contactId: existing?.contactId ?? shipment.contactId,
        // And one reason: the fork reads the order's status and gateways, which
        // every shipment of the order shares.
        reason: existing?.reason ?? amounts.debitReason,
      })
    } else if (amounts.debitReason) {
      noteDebitReason(
        amounts.debitRole === 'clearing'
          ? `rail:${railScopeKey(amounts.debitRail)}`
          : `role:${amounts.debitRole}`,
        amounts.debitReason,
        shipment.orderId
      )
    }
    if (!switchedRecognition) byDebitRole[amounts.debitRole] += amounts.totalMinor
    if (!switchedRecognition && amounts.debitRole === 'clearing') {
      const key = railScopeKey(amounts.debitRail)
      const bucket = byRail.get(key)
      if (bucket) bucket.amountMinor += amounts.totalMinor
      else byRail.set(key, { rail: amounts.debitRail ?? null, amountMinor: amounts.totalMinor })
    }

    const channelDimension = CHANNEL_KEYS[toChannelKey(shipment.channel)]
    const store = shipment.sourceStoreId
    const revenueKey = `${storeScopeKey(store)}|${channelDimension}`
    const revenueBucket = revenueByStoreChannel.get(revenueKey)
    if (revenueBucket) revenueBucket.amountMinor += amounts.subtotalMinor
    else
      revenueByStoreChannel.set(revenueKey, {
        store,
        channel: channelDimension,
        amountMinor: amounts.subtotalMinor,
      })

    if (amounts.taxByJurisdiction && amounts.taxByJurisdiction.length > 0) {
      for (const { jurisdiction, amountMinor } of amounts.taxByJurisdiction) {
        taxByJurisdiction.set(
          jurisdiction,
          (taxByJurisdiction.get(jurisdiction) ?? 0) + amountMinor
        )
      }
    } else {
      taxWithoutJurisdictionMinor += amounts.taxMinor
    }

    if (amounts.shippingMinor !== 0) {
      const shippingBucket = shippingByStore.get(storeScopeKey(store))
      if (shippingBucket) shippingBucket.amountMinor += amounts.shippingMinor
      else shippingByStore.set(storeScopeKey(store), { store, amountMinor: amounts.shippingMinor })
    }

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
  /** Append a line and answer its 1-based line number - `sortOrder + 1`, since `sortOrder` is the index. */
  const push = (line: Omit<GlPostingLineInput, 'sortOrder'>): number => {
    lines.push({ ...line, sortOrder: lines.length } as GlPostingLineInput)
    return lines.length
  }
  /**
   * The per-line "why" (brief 28 §5), for the DEBIT lines only - every credit
   * is a plain role and carries none. Line numbers are the ones `postEntry`
   * stores, because `sortOrder` here is the index.
   */
  const reasons: PostingReason[] = []
  const explainSummarised = (line: number, accountKey: string): void => {
    for (const [reason, orders] of debitReasons.get(accountKey) ?? []) {
      const count = orders.size
      reasons.push({ line, sentence: `${count} ${count === 1 ? 'order' : 'orders'} ${reason}.` })
    }
  }

  // 1. The receivable, ONE LINE PER ORDER. Aging needs the debtor, so this leg
  //    alone stays at order grain (49 §2.5).
  // Canonical recognition releases a receipt funded deposit before raising any
  // unpaid balance. Keep this per order so the counterparty remains visible.
  for (const [orderId, deposit] of depositByOrder) {
    if (deposit.amountMinor === 0) continue
    push({
      sourceType: FULFILLMENT_SOURCE_TYPE,
      sourceId: orderId,
      accountRole: ACCOUNT_ROLES.CUSTOMER_DEPOSITS,
      direction: 'debit',
      amount: deposit.amountMinor,
      memo: deposit.orderNumber,
      ...(deposit.contactId
        ? { counterpartyType: 'customer' as const, counterpartyId: deposit.contactId }
        : {}),
    })
  }
  for (const [orderId, receivable] of receivableByOrder) {
    if (receivable.amountMinor === 0) continue
    const line = push({
      sourceType: FULFILLMENT_SOURCE_TYPE,
      sourceId: orderId,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: 'debit',
      amount: receivable.amountMinor,
      memo: receivable.orderNumber,
      ...(receivable.contactId
        ? { counterpartyType: 'customer' as const, counterpartyId: receivable.contactId }
        : {}),
    })
    if (receivable.reason) {
      reasons.push({ line, sentence: `Order ${receivable.orderNumber} ${receivable.reason}.` })
    }
  }

  // 2. The clearing accounts, summarised PER RAIL (task 58 §5.2): one role,
  //    `clearing`, scoped by `sourceScope.rail` - a matched record's id, or
  //    `null` for the org default, exactly what the role-only fallback always
  //    posted. Cash is its own line, never clearing (D12).
  for (const bucket of byRail.values()) {
    if (bucket.amountMinor === 0) continue
    const line = push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.CLEARING,
      direction: 'debit',
      amount: bucket.amountMinor,
      memo: describe('card clearing'),
      sourceScope: { rail: bucket.rail },
    })
    explainSummarised(line, `rail:${railScopeKey(bucket.rail)}`)
  }
  if (byDebitRole.undeposited_funds !== 0) {
    const line = push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
      direction: 'debit',
      amount: byDebitRole.undeposited_funds,
      memo: describe('cash, undeposited'),
    })
    explainSummarised(line, 'role:undeposited_funds')
  }

  // 3. Revenue, summarised PER CHANNEL and PER SOURCE STORE. The channel stays
  //    a dimension on ONE account (brief 13 §5); the store may resolve that
  //    account differently (task 47 §4). Two axes, two mechanisms, decision D10.
  for (const { store, channel, amountMinor } of revenueByStoreChannel.values()) {
    if (amountMinor === 0) continue
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.REVENUE_PRODUCT,
      direction: 'credit',
      amount: amountMinor,
      memo: describe(`product revenue, ${channel === 'dealer' ? 'dealer' : 'direct to consumer'}`),
      dimensions: { channel },
      ...(store === undefined ? {} : { sourceScope: { store } }),
    })
  }

  // 4. Tax, summarised PER JURISDICTION when it ties, plus one undimensioned
  //    line for whatever does not (brief 13 §5 - a partial breakdown would
  //    read as a complete one).
  for (const [jurisdiction, amount] of taxByJurisdiction) {
    if (amount === 0) continue
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.SALES_TAX_PAYABLE,
      direction: 'credit',
      amount,
      memo: describe(`sales tax, ${jurisdiction}`),
      dimensions: { jurisdiction },
    })
  }
  if (taxWithoutJurisdictionMinor !== 0) {
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.SALES_TAX_PAYABLE,
      direction: 'credit',
      amount: taxWithoutJurisdictionMinor,
      memo: describe('sales tax'),
    })
  }

  // 5. Shipping, summarised - per source store, for revenue's own reason.
  for (const { store, amountMinor } of shippingByStore.values()) {
    if (amountMinor === 0) continue
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.REVENUE_SHIPPING,
      direction: 'credit',
      amount: amountMinor,
      memo: describe('shipping revenue'),
      ...(store === undefined ? {} : { sourceScope: { store } }),
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
    // `BuiltEntry.sources` and `buildPostingDraft`. So does the per-line "why"
    // (brief 28 §5), when any debit carried one.
    entry: { ...built, sources, ...(reasons.length > 0 ? { reasons } : {}) },
    periodKey,
    totals: { subtotalMinor, taxMinor, shippingMinor, totalMinor, byDebitRole },
  }
}
