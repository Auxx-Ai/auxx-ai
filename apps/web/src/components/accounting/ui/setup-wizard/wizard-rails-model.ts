// apps/web/src/components/accounting/ui/setup-wizard/wizard-rails-model.ts

/**
 * The pure arithmetic behind the wizard's payment-rails page
 * (`plans/accounting/tasks/26-a-clearing-account-per-rail.md` §8).
 *
 * Grouping the census by RAIL, deciding which rows offer a merge, finding two
 * rails sharing one clearing account, and §5's asymmetric fee-account default.
 * No React, no query - the page assembles these answers, and the tests read
 * them directly the way `pack-picker.test.ts` reads the pack cascade.
 *
 * 🛑 **Nothing here routes.** `suggestRail` is a suggestion catalogue and this
 * file only groups by what it suggests; `matchGatewayRoute` is the single
 * matcher from a handle to an account and it reads the org's own records. A
 * second thing that answered "which account" would put a sale and its refund in
 * different accounts, which balances and is therefore undetectable downstream.
 */

import type { GatewayHandleCensusRow, PaymentGatewayRow } from '@auxx/lib/accounting/rails/client'
import { normaliseGatewayHandle } from '@auxx/lib/accounting/rails/client'
import { type RailSuggestion, suggestRail } from '@auxx/lib/accounting/rails/rail-catalogue'

/**
 * How long a rail can go without an order before the page offers to create its
 * account AND mark it closed in one action (§9).
 *
 * ⚠️ A display threshold, never a posting rule. A closed rail still routes its
 * own history (`toGatewayRoutes` reads active AND closed rows), so getting this
 * number wrong costs a pre-ticked checkbox somebody unticks, not a misposted
 * entry. Six months is long enough that a seasonal rail is not called dead and
 * short enough that a rail switched away from last quarter is.
 */
export const STALE_RAIL_DAYS = 180

/** One observed handle inside a rail group. */
export interface RailHandle {
  /** As stored on the order, not normalised. */
  handle: string
  orderCount: number
  /** `YYYY-MM-DD`, or null when no order carrying it has a placed date. */
  lastSeenAt: string | null
  /** The `payment_gateway` id claiming it, or null. */
  claimedBy: string | null
}

/**
 * Whether the group's handles are all routed, partly routed, or not at all.
 *
 * `split` is the interesting one and it is what §8 item 2's merge exists for:
 * `authorize_net` claimed by a record while `authorize.net` is not is ONE rail
 * whose second spelling is silently falling back to `clearing`.
 */
export type RailGroupState = 'routed' | 'split' | 'unrouted'

/** Every observed spelling of one rail, and what to offer for it. */
export interface RailGroup {
  /** Stable React key. The normalised suggested name. */
  key: string
  /** The rail's display name, from the suggestion catalogue. */
  name: string
  /** Every default this rail proposes. All of them are editable. */
  suggestion: RailSuggestion
  /** Busiest spelling first. */
  handles: RailHandle[]
  /** Summed across the spellings. */
  orderCount: number
  /** The latest of the spellings' dates, or null. */
  lastSeenAt: string | null
  /** Distinct `payment_gateway` ids claiming any spelling, in first-seen order. */
  claimedBy: string[]
  state: RailGroupState
  /**
   * The gateway a merge would add the unclaimed spellings to, or null.
   *
   * Only offered when EXACTLY ONE gateway claims part of the group: two
   * gateways splitting one rail is a state a person has to resolve, and
   * guessing which of them should swallow the loose spelling would move money.
   */
  mergeInto: string | null
  /** The spellings a merge would add. Empty unless {@link mergeInto} is set. */
  mergeHandles: string[]
}

/**
 * Turn the flat census into one row per rail.
 *
 * Two handles group together when they suggest the same rail NAME - which is
 * how `authorize_net` and `authorize.net` become one row (§8 item 2) and how
 * `shopify_payments`, `shop_pay_installments` and `shop_cash` become one
 * account, since §2 settles the grain as the settlement stream: they arrive in
 * the same Shopify deposit and splitting them makes that deposit unsplittable.
 *
 * ⚠️ An UNKNOWN handle groups alone, because `suggestRail` titles it to its own
 * name. That is the wanted behaviour: a handle auxx has never seen is exactly
 * the discovery the census exists to make, and folding it into somebody else's
 * rail would hide it.
 */
export function buildRailGroups(census: readonly GatewayHandleCensusRow[]): RailGroup[] {
  const groups = new Map<string, RailGroup>()

  for (const row of census) {
    const suggestion = suggestRail(row.handle)
    const key = normaliseGatewayHandle(suggestion.name)
    const entry: RailHandle = {
      handle: row.handle,
      orderCount: row.orderCount,
      lastSeenAt: row.lastSeenAt,
      claimedBy: row.claimedBy,
    }

    const group = groups.get(key)
    if (!group) {
      groups.set(key, {
        key,
        name: suggestion.name,
        suggestion,
        handles: [entry],
        orderCount: entry.orderCount,
        lastSeenAt: entry.lastSeenAt,
        claimedBy: entry.claimedBy ? [entry.claimedBy] : [],
        state: 'unrouted',
        mergeInto: null,
        mergeHandles: [],
      })
      continue
    }

    group.handles.push(entry)
    group.orderCount += entry.orderCount
    if (entry.lastSeenAt && (!group.lastSeenAt || entry.lastSeenAt > group.lastSeenAt)) {
      group.lastSeenAt = entry.lastSeenAt
    }
    if (entry.claimedBy && !group.claimedBy.includes(entry.claimedBy)) {
      group.claimedBy.push(entry.claimedBy)
    }
  }

  for (const group of groups.values()) {
    group.handles.sort((a, b) => b.orderCount - a.orderCount || a.handle.localeCompare(b.handle))
    const unclaimed = group.handles.filter((handle) => !handle.claimedBy)
    group.state =
      group.claimedBy.length === 0 ? 'unrouted' : unclaimed.length === 0 ? 'routed' : 'split'
    if (group.claimedBy.length === 1 && unclaimed.length > 0) {
      group.mergeInto = group.claimedBy[0] ?? null
      group.mergeHandles = unclaimed.map((handle) => handle.handle)
    }
  }

  // Busiest rail first: the rail carrying the history is the one whose account
  // matters most, and alphabetical buries it.
  return [...groups.values()].sort(
    (a, b) => b.orderCount - a.orderCount || a.name.localeCompare(b.name)
  )
}

/**
 * §5's checkbox default, and the asymmetry is the whole point.
 *
 * - `netted`: OFF. The fee is booked automatically inside every payout entry,
 *   so it cannot be forgotten and it cannot be missing, and per-rail margin is
 *   answerable from the dimension on the posting line. A dedicated account buys
 *   only chart bloat.
 * - `billed`: ON. If a billed rail's fees land in the shared
 *   `payment_processing_fees` account alongside every netted rail's fallback,
 *   *"has this rail billed us this month"* is unanswerable. Its own account
 *   makes it a one-line query, which is the whole of §6.
 *
 * Both are offered either way. This is a default, not a law.
 */
export function defaultMintFeeAccount(feeTreatment: RailSuggestion['feeTreatment']): boolean {
  return feeTreatment === 'billed'
}

/**
 * Whether a rail has gone quiet long enough to offer "create its account and
 * mark it closed" as one action (§9).
 *
 * A rail with no date at all is NOT stale: unknown is not the same as old, and
 * pre-ticking `closed` on a rail nobody can date would quietly stop offering it
 * for new orders.
 */
export function isStaleRail(lastSeenAt: string | null, today: Date = new Date()): boolean {
  if (!lastSeenAt) return false
  const seen = Date.parse(`${lastSeenAt}T00:00:00.000Z`)
  if (Number.isNaN(seen)) return false
  return today.getTime() - seen > STALE_RAIL_DAYS * 24 * 60 * 60 * 1000
}

/**
 * Clearing account id -> the gateways sharing it, for accounts held by more
 * than one gateway (§8 item 3).
 *
 * ⚠️ **Legal, and worth saying out loud anyway.** `1200` already is a shared
 * account for every handle nothing routes, and two rails on one account is a
 * supported configuration. It is also the thing that makes reconciliation
 * impossible later, because the account can no longer be squared against one
 * external document (§2). Say it at the moment of choosing, not in a doc.
 */
export function sharedClearingAccounts(
  gateways: readonly PaymentGatewayRow[]
): Map<string, PaymentGatewayRow[]> {
  const byAccount = new Map<string, PaymentGatewayRow[]>()
  for (const gateway of gateways) {
    if (!gateway.clearingGlAccountId) continue
    const bucket = byAccount.get(gateway.clearingGlAccountId) ?? []
    bucket.push(gateway)
    byAccount.set(gateway.clearingGlAccountId, bucket)
  }
  for (const [accountId, bucket] of byAccount) {
    if (bucket.length < 2) byAccount.delete(accountId)
  }
  return byAccount
}

/**
 * Whether to warn that netted rails are about to book fees into a role no
 * account holds (§13 decision 1, §8 item 5).
 *
 * A netted rail with no fee account of its own books to
 * `payment_processing_fees`. An org that never mapped that role gets a refusal
 * at close - correct, but a month late and far from the cause. The page is
 * already reading the role map, so the check is free here.
 *
 * 🛑 **A warning, never a block.** `P1` makes "nothing configured" a supported
 * state and no wizard page may refuse Continue; this function answers a
 * question about what to RENDER and nothing consults it before navigating.
 *
 * Both halves count: a record that already exists and relies on the fallback,
 * and a rail this page is about to create that would.
 */
export function warnsAboutFeeFallback(params: {
  /** True when some account holds `payment_processing_fees`. */
  fallbackMapped: boolean
  gateways: readonly PaymentGatewayRow[]
  groups: readonly RailGroup[]
}): boolean {
  if (params.fallbackMapped) return false
  const existingRelies = params.gateways.some(
    (gateway) => gateway.feeTreatment === 'netted' && !gateway.feeGlAccountId
  )
  const pendingRelies = params.groups.some(
    (group) => group.state !== 'routed' && group.suggestion.feeTreatment === 'netted'
  )
  return existingRelies || pendingRelies
}
