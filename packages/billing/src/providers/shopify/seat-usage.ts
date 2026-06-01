// packages/billing/src/providers/shopify/seat-usage.ts

import { configService } from '@auxx/credentials'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getAppConnection } from '@auxx/services/app-connections'
import { eq } from 'drizzle-orm'
import { postSeatDayEvent } from './app-events-client'
import { createShopifyAdminClient } from './client'

const logger = createScopedLogger('billing/shopify/seat-usage')

/** Outcome of a single (org, day) seat drip — fed into the daily job's structured log. */
export interface SeatDayReport {
  orgId: string
  /** `YYYY-MM-DD` (UTC). */
  date: string
  seats: number
  status: 'accepted' | 'duplicate' | 'skipped'
  /** Set when `status === 'skipped'`. */
  reason?: string
}

/** `Date` → `YYYY-MM-DD` in UTC, the granularity of the per-day idempotency key. */
function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Reports **one** idempotent `seat_days` usage event for an org on a given day, with
 * `value = PlanSubscription.seats - 1`. Per-org-per-day (not per-member) — idempotency is keyed
 * on `(org, day)`, so cron retries / worker restarts / lookback re-sends never double-bill.
 *
 * The `-1` reflects the hybrid pricing shape (plan 14 §3.4, Option B): the recurring base price
 * covers the first seat, so only seats 2..N are metered. A 1-seat org meters nothing (we skip the
 * POST rather than send `value: 0`).
 *
 * Reads the seat count and Shop GID off the local row; lazily fetches+caches the GID from
 * the Admin API (`query { shop { id } }`) the first time. No-ops (returns `skipped`) for
 * non-Shopify or canceled orgs and rows missing a shop domain.
 *
 * See plans/billing/v2/14-shopify-per-seat-usage-meter-hack.md §3.2, §5.2.
 */
export async function reportOrgSeatDay(
  db: Database,
  input: { organizationId: string; date: Date }
): Promise<SeatDayReport> {
  const date = toDayKey(input.date)
  const row = await db.query.PlanSubscription.findFirst({
    where: (sub, { eq: e }) => e(sub.organizationId, input.organizationId),
    columns: {
      id: true,
      seats: true,
      status: true,
      billingProvider: true,
      shopifyShopDomain: true,
      shopifyShopGid: true,
    },
  })

  const skip = (reason: string): SeatDayReport => ({
    orgId: input.organizationId,
    date,
    seats: row?.seats ?? 0,
    status: 'skipped',
    reason,
  })

  if (!row || row.billingProvider !== 'shopify') return skip('not_shopify')
  if (!row.shopifyShopDomain) return skip('no_shop_domain')
  if (row.status === 'canceled') return skip('canceled')

  // Hybrid pricing (plan 14 §3.4, Option B): the recurring base covers seat 1, so the meter only
  // bills the incremental seats 2..N. A solo org meters nothing — skip rather than POST `value: 0`.
  const billableSeats = Math.max(0, row.seats - 1)
  if (billableSeats === 0) return skip('no_billable_seats')

  const shopGid = await resolveShopGid(db, {
    subscriptionId: row.id,
    organizationId: input.organizationId,
    shopDomain: row.shopifyShopDomain,
    cachedGid: row.shopifyShopGid,
  })

  const status = await postSeatDayEvent({
    shopGid,
    // Noon UTC keeps the timestamp comfortably inside the billing day regardless of tz.
    timestamp: `${date}T12:00:00.000Z`,
    idempotencyKey: `seat_day:${input.organizationId}:${date}`,
    value: billableSeats,
  })

  return { orgId: input.organizationId, date, seats: row.seats, status }
}

/**
 * Returns the shop's `gid://shopify/Shop/<id>`, reading the cached value off the row when
 * present, otherwise querying the Admin API once and persisting it. The GID is immutable, so
 * a single fetch per shop suffices for the lifetime of the install.
 */
async function resolveShopGid(
  db: Database,
  input: {
    subscriptionId: string
    organizationId: string
    shopDomain: string
    cachedGid: string | null
  }
): Promise<string> {
  if (input.cachedGid) return input.cachedGid

  const appId = configService.get<string>('SHOPIFY_APP_ID')
  if (!appId) throw new Error('SHOPIFY_APP_ID must be configured')

  // Org-scoped Shopify connection (written at install). Empty userId falls through to the
  // org-scoped row — same pattern as active-subscription.ts.
  const conn = await getAppConnection(appId, input.organizationId, '')
  if (conn.isErr()) throw conn.error
  const accessToken = conn.value.accessToken
  if (!accessToken) throw new Error('Shopify connection has no access token')

  const client = createShopifyAdminClient({ shopDomain: input.shopDomain, accessToken })
  const res = (await client.request('#graphql\n query ShopGid { shop { id } }')) as {
    data?: { shop?: { id?: string } }
    errors?: unknown
  }
  if (res.errors || !res.data?.shop?.id) {
    throw new Error(
      `Admin API shop GID query failed: ${JSON.stringify(res.errors ?? 'no shop id')}`
    )
  }
  const gid = res.data.shop.id

  await db
    .update(schema.PlanSubscription)
    .set({ shopifyShopGid: gid, updatedAt: new Date() })
    .where(eq(schema.PlanSubscription.id, input.subscriptionId))
  logger.info('Cached Shopify shop GID', { organizationId: input.organizationId, gid })

  return gid
}
