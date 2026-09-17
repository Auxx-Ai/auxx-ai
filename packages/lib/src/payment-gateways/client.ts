// packages/lib/src/payment-gateways/client.ts

/**
 * The client-safe half of `payment-gateways/`: the vocabularies, the read
 * model and the pure handle/route arithmetic (`docs/lib-module-guide.md` §7).
 *
 * `plans/accounting/tasks/done/13-cash-accounts-and-the-qbo-seam.md` §5.3: a
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

/**
 * How a gateway drains. Mirrors `PaymentGatewaySettlementSource` (enum-values.ts).
 *
 * `manual` is deliberately LAST: it is the fallback every other value is
 * measured against, and `resolvePaymentGatewaySettlementSource` coerces an
 * unrecognised option to it.
 *
 * 🛑 Adding a value here widens `PayoutSourceId`
 * (`money/payouts/source.ts` - `Exclude<…, 'manual'>`), which is the key type of
 * the `PayoutSource` registry. A value may sit in this vocabulary with no source
 * registered against it: `getPayoutSource` answers a `NotFoundError` naming the
 * id, and the sweep only polls sources that registered themselves. `affirm` is
 * permanently in that state on purpose - it is read by the financial connector,
 * which is mutually exclusive with the `PayoutSource` registry
 * (`plans/apps/affirm/affirm-build-plan.md` §5.3).
 */
export const PAYMENT_GATEWAY_SETTLEMENT_SOURCES = [
  'stripe',
  'shopify_payments',
  'affirm',
  'manual',
] as const
export type PaymentGatewaySettlementSourceValue =
  (typeof PAYMENT_GATEWAY_SETTLEMENT_SOURCES)[number]

/** Whether a rail is still taking charges. Mirrors `PaymentGatewayStatus` (enum-values.ts). */
export const PAYMENT_GATEWAY_STATUSES = ['active', 'closed'] as const
export type PaymentGatewayStatusValue = (typeof PAYMENT_GATEWAY_STATUSES)[number]

/**
 * How a rail charges for itself. Mirrors `PaymentGatewayFeeTreatment`
 * (enum-values.ts). `plans/accounting/tasks/26-a-clearing-account-per-rail.md`
 * §4.
 *
 * 🛑 **This decides the SHAPE of the payout entry, not a label.** A `netted`
 * rail withholds its cut from the deposit, so the fee leg belongs inside the
 * settlement entry and `gross = net + fees`. A `billed` rail deposits GROSS and
 * invoices for the fees weeks later, so the payout entry has no fee leg at all
 * and `gross === net` is the expected arithmetic rather than a mis-read payout.
 */
export const PAYMENT_GATEWAY_FEE_TREATMENTS = ['netted', 'billed'] as const
export type PaymentGatewayFeeTreatmentValue = (typeof PAYMENT_GATEWAY_FEE_TREATMENTS)[number]

/** Human labels, so the picker and the badge agree without a second table. */
export const PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS: Record<
  PaymentGatewaySettlementSourceValue,
  string
> = {
  stripe: 'Stripe',
  shopify_payments: 'Shopify Payments',
  affirm: 'Affirm',
  manual: 'By hand',
}

export const PAYMENT_GATEWAY_STATUS_LABELS: Record<PaymentGatewayStatusValue, string> = {
  active: 'Active',
  closed: 'Closed',
}

export const PAYMENT_GATEWAY_FEE_TREATMENT_LABELS: Record<PaymentGatewayFeeTreatmentValue, string> =
  {
    netted: 'Netted from the deposit',
    billed: 'Billed separately',
  }

/**
 * Narrow an unknown option value to a {@link PaymentGatewaySettlementSourceValue}.
 *
 * 🛑 Driven off {@link PAYMENT_GATEWAY_SETTLEMENT_SOURCES} rather than a chain of
 * literals, because the failure mode of forgetting one is SILENT: a record
 * storing the new option would read back as `manual`, and a rail that reads a
 * feed would present itself as worked by hand. The list is the vocabulary; this
 * function must not hold a second, shorter copy of it.
 */
export function resolvePaymentGatewaySettlementSource(
  value: string | null | undefined
): PaymentGatewaySettlementSourceValue {
  const found = PAYMENT_GATEWAY_SETTLEMENT_SOURCES.find((source) => source === value)
  return found ?? 'manual'
}

/** Narrow an unknown option value to a {@link PaymentGatewayStatusValue}. */
export function resolvePaymentGatewayStatus(
  value: string | null | undefined
): PaymentGatewayStatusValue {
  return value === 'closed' ? 'closed' : 'active'
}

/**
 * Narrow an unknown option value to a {@link PaymentGatewayFeeTreatmentValue}.
 *
 * 🛑 **Unset reads as `netted`, and that is the safe direction.** A record
 * written before migration 156 carries no option row at all, and `netted` is
 * exactly what the payout builder has always done - so a stale record keeps
 * producing the entry it produced yesterday. Defaulting the other way would
 * silently drop the fee leg off every rail nobody has answered for.
 */
export function resolvePaymentGatewayFeeTreatment(
  value: string | null | undefined
): PaymentGatewayFeeTreatmentValue {
  return value === 'billed' ? 'billed' : 'netted'
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
 * {@link ObservedGatewayHandle} plus the two numbers a SETUP screen needs
 * (`plans/accounting/tasks/26-a-clearing-account-per-rail.md` §8 item 1).
 *
 * 🔑 **The counts belong here and nowhere else.** The settings list's argument
 * against them still stands - a count there invites reading the list as a
 * revenue report, and it is stale the moment an order syncs. On a setup screen
 * the question inverts: a handle with 5,000 orders and none in the last year is
 * a RETIRED rail that wants an account and a `closed` status, and a handle with
 * orders last week and no record is the actual alarm. Nothing else on the page
 * separates those two, which is why `listGatewayHandleCensus` pays for a second
 * join and `listObservedGatewayHandles` deliberately does not.
 */
export interface GatewayHandleCensusRow extends ObservedGatewayHandle {
  /** Distinct orders carrying this handle. A tally, never a revenue figure. */
  orderCount: number
  /**
   * `YYYY-MM-DD` of the most recent order carrying it, or null when no order
   * carrying it has a `placedAt`.
   *
   * ⚠️ Derived in UTC, not the book time zone. It is a "how long ago" reading
   * on a setup screen, and a day boundary either way changes nothing it is used
   * for - unlike a period key, which must never be drawn in a viewer's zone.
   */
  lastSeenAt: string | null
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
  /**
   * The `gl_account` id this rail's `clearing` role resolves to (task 58 §3), preferring the
   * rail's no-currency row. `''` when unmapped - this is no longer a field on the record itself.
   */
  clearingGlAccountId: string
  /** Like {@link clearingGlAccountId}, for the rail's `payment_processing_fees` role. */
  feeGlAccountId: string | null
  /** Derived from the rail's linked live feed's `providerKey` (58 §5.5) - there is no stored enum. */
  settlementSource: PaymentGatewaySettlementSourceValue
  /** The linked feed's `externalAccountId`, or null when no feed is linked. */
  processorAccountId: string | null
  /** A currency named by one of the rail's own role rows, or null - there is no longer one answer. */
  settlementCurrency: string | null
  /**
   * Always null. `bank` now resolves to a `gl_account` directly (58 §3), not to a `bank_account`
   * record, so there is no single id to answer with here - see `payment-gateways/feeds.ts`.
   */
  bankAccountId: string | null
  /**
   * Whether the processor withholds its cut from the deposit or bills for it
   * later. Read by `buildPayoutEntry` through `postPayoutEntry`: a `billed`
   * rail's payout has NO fee leg. See {@link PAYMENT_GATEWAY_FEE_TREATMENTS}.
   */
  feeTreatment: PaymentGatewayFeeTreatmentValue
  status: PaymentGatewayStatusValue
  /**
   * `YYYY-MM-DD`, or null. Informational only - nothing in posting reads it.
   * Since brief 27 §6.5 the payout sync ADVANCES it after each entry it posts
   * (`stampPaymentGatewayLastSettlement`), so it is a watermark per rail and no
   * longer only hand-entered.
   */
  lastSettlementAt: string | null
  /**
   * `YYYY-MM-DD`, or null. Informational only, exactly like
   * {@link lastSettlementAt} - nothing derives it yet. The close console's
   * billed-rail line is what will read it (26 §6).
   */
  lastFeeBookedAt: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

/**
 * What `resolveFulfillmentDebit` reads to answer which RAIL a handle belongs to
 * (task 58 §5.2; before it, this answered with the rail's clearing account id).
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
 * `clearing` default the moment somebody marks the rail closed, which is
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
 * callers; they used to be a private copy and a hardcoded `clearing`
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
 *   in `clearing`, where a wrong answer fails to reconcile visibly.
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
