// packages/lib/src/money/fulfillment-posting/plan.ts

/**
 * What the bulk fulfillment run would post, decided with nothing but the
 * shipments and four settings.
 *
 * `plans/money/tasks/49-bulk-fulfillment-posting.md` §2.3 and §2.5.
 *
 * 🛑 **PURE, and that is the whole point.** No database, no clock, no settings
 * read, no writer. It is handed every unposted shipment in a range, the cutoff,
 * the lock, the ledger currency and the book time zone, and it returns the
 * postings it would make and the shipments it would not. The split is the one
 * `builds/backfill-policy.ts` / `backfill-builds.ts` already make, for the same
 * reason 44 §11.1 gives: the painful cases here are an order carrying two
 * gateways and a shipment dated inside a closed period. Every one of those is a
 * unit test only while the decision needs nothing to run.
 *
 * ## The exclusion order is a priority order, not a filter chain
 *
 * A shipment is excluded ONCE, for the FIRST reason that applies, and the
 * reasons are ordered by which remedy the person has to reach for:
 *
 * 1. `before-cutoff` - covered by the opening balance; nothing to do, ever.
 * 2. `locked-period` - reopen the month, or leave it.
 * 3. `foreign-currency` - the books are kept in one currency (§3.2).
 * 4. `gateway-ambiguous` / `test-gateway` - fix the order's gateways.
 * 5. `zero-value` - a shipment that recognises nothing.
 *
 * Reporting a shipment as `zero-value` when it is really in a closed period
 * sends somebody to look at the order instead of at the period, so the order of
 * these `if`s IS the contract. Every row carries the value that proves its
 * reason in `detail`, which is 44 §7.2b's rule.
 *
 * ## Grouping is calendar arithmetic on a string, and needs no time zone
 *
 * `shippedAt` is already a calendar date IN THE BOOK ZONE - the log records the
 * day the goods went out, not an instant (`money/orders/client.ts`). So the day
 * bucket is the string itself and the month bucket is its first seven
 * characters. {@link FulfillmentPostingPlanInput.timeZone} is therefore carried
 * but never applied here: re-zoning a date that is already local is how a
 * shipment moves a day and lands in the wrong month.
 */

import type { Database } from '@auxx/database'
import { listPaymentGateways, toGatewayRoutes } from '../../payment-gateways'
import type { GatewayRoute } from '../../payment-gateways/client'
import {
  computeShipmentAmounts,
  resolveFulfillmentDebit,
} from '../../postings/build-fulfillment-batch-entry'
import type {
  FulfillmentDebit,
  FulfillmentDebitRole,
  FulfillmentPostingExclusion,
  FulfillmentPostingGroup,
  FulfillmentPostingGrouping,
  FulfillmentPostingPlan,
  FulfillmentPostingPlanInput,
  PlannedShipment,
  UnpostedShipment,
} from './types'

/**
 * Load the org's `payment_gateway` routing table, for
 * {@link planFulfillmentPosting}'s `gatewayRoutes` input (brief 13 §5.3).
 *
 * 🛑 **Not part of the pure planner.** `planFulfillmentPosting` stays PURE -
 * no db, no clock, no settings read (this file's own header) - so the ONE
 * database read this contract needs lives here, in a function a caller awaits
 * ONCE PER PLAN and passes the result into the pure call, never inside a loop
 * over shipments. `reads.ts`'s `previewFulfillmentPosting` and `run.ts`'s
 * runner are the two callers; both already load `readFulfillmentPostingSettings`
 * the same way beside this.
 *
 * Empty on any read failure or on an org that has not provisioned
 * `payment_gateway` yet (entity migration 146) - `resolveFulfillmentDebit`'s
 * `gatewayRoutes` is optional and an empty table falls every gateway back to
 * its role default, which is exactly today's behaviour.
 */
export async function loadGatewayRoutesForPlan(
  db: Database,
  organizationId: string
): Promise<readonly GatewayRoute[]> {
  const result = await listPaymentGateways(db, organizationId)
  return result.isOk() ? toGatewayRoutes(result.value) : []
}

/**
 * Decide what the run would post.
 *
 * The output is deterministic - groups ascending by key, shipments within a
 * group by ship date then order number then sequence, exclusions in the same
 * order - which is what lets a test assert on the whole structure and what
 * keeps a preview stable between two runs against unchanged data.
 *
 * Never throws. Total on every input, including a shipment with a `NaN` price
 * or an unparseable date: an amount the builder refuses to compute is reported
 * as an exclusion rather than taken out on the rest of the range. That matters
 * more here than in the single-order door, where one refusal costs one order.
 *
 * `gatewayRoutes` (brief 13 §5.3) is optional and not part of
 * `FulfillmentPostingPlanInput` itself - it is threaded straight through to
 * {@link resolveFulfillmentDebit} unchanged, so a caller that omits it (or
 * whose `payment_gateway` def is not provisioned yet) gets exactly today's
 * role-only behaviour. Load it once per plan with {@link loadGatewayRoutesForPlan}.
 */
export function planFulfillmentPosting(
  input: FulfillmentPostingPlanInput & { gatewayRoutes?: readonly GatewayRoute[] }
): FulfillmentPostingPlan {
  const { grouping, cutoffPeriod, lockedThroughMonth, ledgerCurrency, gatewayRoutes } = input

  const exclusions: FulfillmentPostingExclusion[] = []
  const byGroupKey = new Map<string, PlannedShipment[]>()

  for (const shipment of [...input.shipments].sort(compareShipments)) {
    const month = monthOf(shipment.shippedAt)

    if (cutoffPeriod && month <= cutoffPeriod) {
      exclusions.push(exclude(shipment, 'before-cutoff', cutoffPeriod))
      continue
    }
    if (lockedThroughMonth && month <= lockedThroughMonth) {
      exclusions.push(exclude(shipment, 'locked-period', lockedThroughMonth))
      continue
    }
    // Blank reads as the ledger currency: an order the channel sent no currency
    // for is not a foreign order, it is an order with an unfilled cell.
    const currency = shipment.currency?.trim() || ledgerCurrency
    if (currency !== ledgerCurrency) {
      exclusions.push(exclude(shipment, 'foreign-currency', currency))
      continue
    }

    const debit = resolveFulfillmentDebit({
      financialStatus: shipment.financialStatus,
      gateways: shipment.gateways,
      gatewayRoutes,
    })
    if (debit.kind === 'exclude') {
      exclusions.push(exclude(shipment, debit.reason, debit.detail))
      continue
    }

    // Strip the `kind` discriminant `resolveFulfillmentDebit` adds -
    // `computeShipmentAmounts` takes the bare `FulfillmentDebit` union.
    const debitInput: FulfillmentDebit =
      'glAccountId' in debit ? { glAccountId: debit.glAccountId } : { role: debit.role }
    const computed = computeAmounts(shipment, debitInput)
    if (!computed.ok) {
      // 🛑 Classified as `zero-value` on purpose. The reason set is CLOSED
      // (types.ts), and a shipment whose amounts cannot be computed contributes
      // exactly nothing to a posting, which is what `zero-value` means to the
      // run. `detail` carries the refusal verbatim, so the screen still names
      // the actual problem instead of claiming the order is worth nothing.
      exclusions.push(exclude(shipment, 'zero-value', computed.reason))
      continue
    }
    const { amounts } = computed
    if (amounts.totalMinor <= 0) {
      exclusions.push(exclude(shipment, 'zero-value', String(amounts.totalMinor)))
      continue
    }

    const key = groupKeyFor(shipment.shippedAt, grouping)
    const bucket = byGroupKey.get(key)
    if (bucket) bucket.push({ ...shipment, amounts })
    else byGroupKey.set(key, [{ ...shipment, amounts }])
  }

  const groups = [...byGroupKey.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([groupKey, shipments]) => toGroup(groupKey, shipments))

  const orders = new Set<string>()
  for (const group of groups) {
    for (const shipment of group.shipments) orders.add(shipment.orderId)
  }

  return {
    grouping,
    groups,
    exclusions,
    footer: {
      postings: groups.length,
      shipments: groups.reduce((total, group) => total + group.shipments.length, 0),
      orders: orders.size,
      excluded: exclusions.length,
      totalMinor: groups.reduce((total, group) => total + group.totals.totalMinor, 0),
    },
  }
}

/**
 * The identity of the posting one shipment falls into, and its period key
 * before any attempt suffix.
 *
 * Exported because the preview, the run and lane E's dialog all have to agree
 * about which posting a shipment belongs to, and a second copy of this
 * three-line function is a second thing that can drift.
 */
export function groupKeyFor(shippedAt: string, grouping: FulfillmentPostingGrouping): string {
  if (grouping === 'month') return monthOf(shippedAt)
  return shippedAt
}

/** Collapse one bucket of shipments into the posting it becomes. */
function toGroup(groupKey: string, shipments: PlannedShipment[]): FulfillmentPostingGroup {
  const byDebitRole: Record<FulfillmentDebitRole, number> = {
    clearing_card: 0,
    accounts_receivable: 0,
    // Every id-based (`payment_gateway` route) debit lands here, whichever
    // account it named - the account id itself rides on the shipment's own
    // `amounts.debitGlAccountId` (brief 13 §5.3, types.ts's header).
    gateway: 0,
  }
  let subtotalMinor = 0
  let taxMinor = 0
  let shippingMinor = 0
  let totalMinor = 0
  let txnDate = ''
  const orders = new Set<string>()

  for (const shipment of shipments) {
    subtotalMinor += shipment.amounts.subtotalMinor
    taxMinor += shipment.amounts.taxMinor
    shippingMinor += shipment.amounts.shippingMinor
    totalMinor += shipment.amounts.totalMinor
    byDebitRole[shipment.amounts.debitRole] += shipment.amounts.totalMinor
    orders.add(shipment.orderId)
    // 🛑 The LATEST ship date in the group, never the group key's own start. A
    // month bucket posted on the first would date the whole month's revenue
    // into the day the period opened, before some of the goods left the
    // building. The latest date is inside the period by construction and is
    // never in the future, because a shipment cannot be recorded before it
    // ships.
    if (shipment.shippedAt > txnDate) txnDate = shipment.shippedAt
  }

  return {
    groupKey,
    txnDate,
    shipments,
    orderCount: orders.size,
    totals: { subtotalMinor, taxMinor, shippingMinor, totalMinor, byDebitRole },
  }
}

/**
 * `computeShipmentAmounts`, made total.
 *
 * The builder throws an `UnprocessableEntityError` on a fractional stored
 * amount or a non-finite rate, which is the right answer for one order a person
 * is fulfilling and the wrong one for a run over five hundred. Catching it here
 * is what keeps `planFulfillmentPosting` total, and the refusal sentence is
 * kept so the exclusion can carry it verbatim.
 */
function computeAmounts(
  shipment: UnpostedShipment,
  debit: FulfillmentDebit
): { ok: true; amounts: PlannedShipment['amounts'] } | { ok: false; reason: string } {
  try {
    return { ok: true, amounts: computeShipmentAmounts(shipment, debit) }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

function exclude(
  shipment: UnpostedShipment,
  reason: FulfillmentPostingExclusion['reason'],
  detail: string
): FulfillmentPostingExclusion {
  return {
    orderId: shipment.orderId,
    orderNumber: shipment.orderNumber,
    sequence: shipment.sequence,
    shippedAt: shipment.shippedAt,
    reason,
    detail,
  }
}

/** `YYYY-MM` of a `YYYY-MM-DD`. Month keys compare as strings, chronologically. */
function monthOf(shippedAt: string): string {
  return shippedAt.slice(0, 7)
}

function compareShipments(a: UnpostedShipment, b: UnpostedShipment): number {
  return (
    compareStrings(a.shippedAt, b.shippedAt) ||
    compareStrings(a.orderNumber, b.orderNumber) ||
    a.sequence - b.sequence
  )
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
