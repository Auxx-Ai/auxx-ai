// packages/lib/src/accounting/rails/rail-groups.ts

// Pure grouping of the gateway handle census by rail, shared by the setup wizard and
// `autoRouteRails`. Client-safe. See plans/accounting/tasks/26-a-clearing-account-per-rail.md §8.
// Nothing here routes: `suggestRail` only suggests, and a movement's rail resolves its clearing.

import {
  type GatewayHandleCensusRow,
  normaliseGatewayHandle,
  type PaymentGatewayRow,
} from './client'
import { type RailSuggestion, suggestRail } from './rail-catalogue'

/** How long a rail can go without an order before setup defaults it to `closed` (§9). A display threshold, never a posting rule. */
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

/** `split` is one rail whose second spelling is silently falling back to `clearing`. */
export type RailGroupState = 'routed' | 'split' | 'unrouted'

/** Every observed spelling of one rail, and what to offer for it. */
export interface RailGroup {
  /** Stable key: the normalised suggested name. */
  key: string
  name: string
  suggestion: RailSuggestion
  /** Busiest spelling first. */
  handles: RailHandle[]
  orderCount: number
  lastSeenAt: string | null
  /** Distinct `payment_gateway` ids claiming any spelling, in first-seen order. */
  claimedBy: string[]
  state: RailGroupState
  /** Offered only when exactly one gateway claims part of the group; two is a person's call. */
  mergeInto: string | null
  /** The spellings a merge would add. Empty unless {@link mergeInto} is set. */
  mergeHandles: string[]
}

/**
 * The census as one row per rail: handles group when they suggest the same rail name, so
 * `authorize_net`/`authorize.net` and every Shopify handle (one deposit stream) are one row.
 * An unknown handle groups alone, which is the discovery the census exists to make.
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

  // Busiest first: the rail carrying the history is the one whose account matters most.
  return [...groups.values()].sort(
    (a, b) => b.orderCount - a.orderCount || a.name.localeCompare(b.name)
  )
}

/** §5's default: a billed rail gets its own fee account, a netted rail uses the shared one. */
export function defaultMintFeeAccount(feeTreatment: RailSuggestion['feeTreatment']): boolean {
  return feeTreatment === 'billed'
}

/** Whether a rail has gone quiet past {@link STALE_RAIL_DAYS}. An undated rail is not stale. */
export function isStaleRail(lastSeenAt: string | null, today: Date = new Date()): boolean {
  if (!lastSeenAt) return false
  const seen = Date.parse(`${lastSeenAt}T00:00:00.000Z`)
  if (Number.isNaN(seen)) return false
  return today.getTime() - seen > STALE_RAIL_DAYS * 24 * 60 * 60 * 1000
}

/** Clearing account id -> the gateways sharing it, for accounts held by more than one gateway. Legal, but unreconcilable. */
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
 * Whether netted rails, existing or about to be created, would book fees into an unmapped
 * `payment_processing_fees`. A warning to render, never a block.
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
