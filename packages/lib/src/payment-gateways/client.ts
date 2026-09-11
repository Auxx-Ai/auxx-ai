// packages/lib/src/payment-gateways/client.ts

/**
 * The client-safe half of `payment-gateways/`: the vocabularies, the read
 * model and the pure handle/route arithmetic (`docs/lib-module-guide.md` §7).
 *
 * `plans/accounting/tasks/13-cash-accounts-and-the-qbo-seam.md` §5.3: a
 * gateway is a RECORD carrying its own clearing account, never a role.
 * §5.1's census is why: `authorize_net`/`authorize.net` and `Affirm`/`affirm`
 * are each one rail arriving under two spellings, a rail is not permanent
 * (Authorize.Net closed May 2026 mid-book), and role-per-gateway costs a role,
 * an account and a chart migration per rail.
 *
 * Imports nothing server-only, and carries no `'use client'` directive -
 * server code (the fulfillment planner, the chart seeder) imports this file
 * too, and the directive would turn every export into a client-reference
 * proxy there.
 *
 * ⚠️ Browser code must import `@auxx/lib/payment-gateways/client`, never
 * `@auxx/lib/payment-gateways`. The barrel reaches Drizzle and the org cache.
 */

/** How a gateway drains. Mirrors `PaymentGatewaySettlementSource` (enum-values.ts). */
export const PAYMENT_GATEWAY_SETTLEMENT_SOURCES = ['stripe', 'shopify_payments', 'manual'] as const
export type PaymentGatewaySettlementSourceValue =
  (typeof PAYMENT_GATEWAY_SETTLEMENT_SOURCES)[number]

/** Whether a rail is still taking charges. Mirrors `PaymentGatewayStatus` (enum-values.ts). */
export const PAYMENT_GATEWAY_STATUSES = ['active', 'closed'] as const
export type PaymentGatewayStatusValue = (typeof PAYMENT_GATEWAY_STATUSES)[number]

/** Human labels, so the picker and the badge agree without a second table. */
export const PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS: Record<
  PaymentGatewaySettlementSourceValue,
  string
> = {
  stripe: 'Stripe',
  shopify_payments: 'Shopify Payments',
  manual: 'By hand',
}

export const PAYMENT_GATEWAY_STATUS_LABELS: Record<PaymentGatewayStatusValue, string> = {
  active: 'Active',
  closed: 'Closed',
}

/** Narrow an unknown option value to a {@link PaymentGatewaySettlementSourceValue}. */
export function resolvePaymentGatewaySettlementSource(
  value: string | null | undefined
): PaymentGatewaySettlementSourceValue {
  return value === 'stripe' || value === 'shopify_payments' ? value : 'manual'
}

/** Narrow an unknown option value to a {@link PaymentGatewayStatusValue}. */
export function resolvePaymentGatewayStatus(
  value: string | null | undefined
): PaymentGatewayStatusValue {
  return value === 'closed' ? 'closed' : 'active'
}

/**
 * Trim and lower-case one gateway handle, so `'Affirm'` and `' affirm '`
 * compare equal.
 *
 * Mirrors `normaliseGateways` in `postings/build-fulfillment-batch-entry.ts`
 * exactly - two normalisers that disagreed by a stripped character would let
 * a `payment_gateway` record silently stop matching the handle posting
 * actually sees.
 */
export function normaliseGatewayHandle(handle: string): string {
  return handle.trim().toLowerCase()
}

/**
 * The two handles that never belong to a `payment_gateway` record.
 *
 * `resolveFulfillmentDebit` (`postings/build-fulfillment-batch-entry.ts`)
 * answers both from its own fork, before any route is consulted: `manual` is
 * money that did not come through a rail at all and debits
 * `accounts_receivable`, and `bogus` is Shopify's test gateway and excludes the
 * shipment outright. Neither can ever be "claimed", so the census
 * ({@link listObservedGatewayHandles}) drops them rather than reporting two
 * permanently unroutable handles at every org forever.
 *
 * 🛑 A deliberate mirror of that file's private `MANUAL_GATEWAY` /
 * `TEST_GATEWAY`, not an import - `build-fulfillment-batch-entry.ts` imports
 * THIS file for `GatewayRoute`, and an import back would be a cycle. Same call
 * {@link normaliseGatewayHandle} makes about `normaliseGateways`.
 */
export const RESERVED_GATEWAY_HANDLES: readonly string[] = ['manual', 'bogus']

/**
 * One gateway handle seen on the org's own orders, and whether a
 * `payment_gateway` record already claims it.
 *
 * Deliberately carries NO order count. The question this answers is "is this
 * handle routed", which is a yes or a no; a count invites reading the list as
 * a revenue report, and the number would be stale the moment an order syncs.
 */
export interface ObservedGatewayHandle {
  /** As stored on the order, not normalised - what a person should type. */
  handle: string
  /** The `payment_gateway` id claiming it, or `null` when nothing routes it. */
  claimedBy: string | null
}

/**
 * One `payment_gateway` record, as the settings screen and the fulfillment
 * planner both read it.
 */
export interface PaymentGatewayRow {
  id: string
  recordId: string
  name: string
  /** Every stored `order_payment_gateways` value this rail answers to. Raw, not normalised. */
  handles: string[]
  /** The `gl_account` id this gateway settles into (task 15 §4 shape). No foreign key. */
  clearingGlAccountId: string
  /** The `gl_account` id the processor withholds its fee into, or null (`6100` is the fallback). */
  feeGlAccountId: string | null
  settlementSource: PaymentGatewaySettlementSourceValue
  status: PaymentGatewayStatusValue
  /** `YYYY-MM-DD`, or null. Informational only - nothing in posting reads it. */
  lastSettlementAt: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

/**
 * What `resolveFulfillmentDebit` reads to answer a gateway with an id instead
 * of a role (HANDOFF step 5 / task 13 §5.3's replacement for
 * `FULFILLMENT_GATEWAY_DEBIT`).
 *
 * `handles` are RAW (not normalised) - the caller normalises both sides at
 * match time with {@link normaliseGatewayHandle}, the same way
 * `normaliseGateways` already does for the order's own gateway list.
 */
export interface GatewayRoute {
  handles: readonly string[]
  clearingGlAccountId: string
  /** False for a closed rail. A closed rail still routes its OWN history - see below. */
  active: boolean
}

/**
 * Every route `resolveFulfillmentDebit` can match a normalised gateway
 * against, from ACTIVE and CLOSED rows alike.
 *
 * 🛑 **Closed rows are included on purpose.** Authorize.Net is closed as of
 * May 2026 but its orders are still in the ledger; excluding a closed
 * gateway's route would silently fall the fulfillment debit fork back to its
 * `clearing_card` default the moment somebody marks the rail closed, which is
 * a posting change disguised as a settings edit. `active` rides along on the
 * route so a caller that wants to treat closed differently (a report, a
 * warning) can, without a second query.
 */
export function toGatewayRoutes(rows: readonly PaymentGatewayRow[]): GatewayRoute[] {
  return rows.map((row) => ({
    handles: row.handles,
    clearingGlAccountId: row.clearingGlAccountId,
    active: row.status === 'active',
  }))
}

/**
 * Which route's clearing account one gateway names, when EXACTLY ONE claims it.
 *
 * 🛑 **The single matcher.** Every posting path that turns a gateway into an
 * account goes through this one function, because two copies that disagree put
 * a sale and its refund in different accounts - which balances, and is
 * therefore undetectable downstream. `build-fulfillment-batch-entry.ts`
 * (the sale) and `money/credit-memos/writes.ts` (the refund) are the two
 * callers; they used to be a private copy and a hardcoded `clearing_card`
 * respectively.
 *
 * Both sides are normalised with {@link normaliseGatewayHandle}, so `'Affirm'`,
 * `' affirm '` and `'AFFIRM'` are one gateway.
 *
 * Returns undefined - meaning *fall back to the role default* - on:
 *
 * - **zero matches.** The record has nothing to say about this gateway yet.
 * - **more than one match.** Two routes claiming one handle is a state the
 *   record's own write path should never allow, and guessing which is right
 *   would put real money in one of two accounts. Refusing to choose leaves it
 *   in `clearing_card`, where a wrong answer fails to reconcile visibly.
 *
 * ⚠️ A CLOSED route still matches. Its past orders are still in the ledger and
 * must keep reconciling; treating `active: false` as absent would silently move
 * a rail's money the moment somebody marked it closed, which is a posting
 * change disguised as a settings edit.
 */
export function matchGatewayRoute(
  gateway: string,
  routes: readonly GatewayRoute[] = []
): string | undefined {
  const wanted = normaliseGatewayHandle(gateway)
  if (!wanted) return undefined
  const matches = routes.filter((route) =>
    route.handles.some((handle) => normaliseGatewayHandle(handle) === wanted)
  )
  return matches.length === 1 ? matches[0]?.clearingGlAccountId : undefined
}
