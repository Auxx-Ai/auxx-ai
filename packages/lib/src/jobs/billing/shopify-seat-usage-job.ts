// packages/lib/src/jobs/billing/shopify-seat-usage-job.ts

import { reportOrgSeatDay, type SeatDayReport } from '@auxx/billing'
import { database as db, schema } from '@auxx/database'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { createScopedLogger } from '../../logger'
import type { JobContext } from '../types'

const logger = createScopedLogger('shopify-seat-usage-job')

const payloadSchema = z.object({
  batchSize: z.number().int().positive().default(200),
  /** How many prior days to re-send (idempotent) to self-heal a missed run. */
  lookbackDays: z.number().int().min(0).max(7).default(1),
})

export type ShopifySeatUsageJobData = z.infer<typeof payloadSchema>

export interface ShopifySeatUsageResult {
  total: number
  accepted: number
  duplicate: number
  skipped: number
  errors: number
}

/** Midnight-UTC `Date` for `today - offsetDays`. */
function utcDayMinus(offsetDays: number): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offsetDays))
}

/**
 * Drips the admin-managed seat count to Shopify's App Events meter, once per Shopify-billed
 * org per day, with `value = PlanSubscription.seats`. Over a 30-day cycle this accrues
 * `seats × 30 × (price/30) = seats × price`, matching Stripe's per-seat charge.
 *
 * Reports today plus a short lookback (default: yesterday too). Already-landed days dedupe
 * on Shopify's **permanent** billing idempotency, so a skipped/crashed run self-heals on the
 * next tick with no local ledger. Trialing orgs are skipped so we never bill mid-trial
 * (§6 Q5); canceled/frozen rows are skipped via the query + per-row status guard.
 *
 * Out-of-cycle events reject, so the lookback only heals gaps inside the current cycle: a
 * lookback day before `periodStart` is not sent.
 *
 * See plans/billing/v2/14-shopify-per-seat-usage-meter-hack.md §5.3.
 */
export async function shopifySeatUsageJob(
  ctx: JobContext<ShopifySeatUsageJobData>
): Promise<ShopifySeatUsageResult> {
  const job = ctx.job
  const input = payloadSchema.parse(job.data ?? {})
  const result: ShopifySeatUsageResult = {
    total: 0,
    accepted: 0,
    duplicate: 0,
    skipped: 0,
    errors: 0,
  }

  const rows = await db.query.PlanSubscription.findMany({
    where: and(
      eq(schema.PlanSubscription.billingProvider, 'shopify'),
      ne(schema.PlanSubscription.status, 'canceled'),
      isNotNull(schema.PlanSubscription.shopifyShopDomain)
    ),
    columns: { organizationId: true, status: true, periodStart: true },
    limit: input.batchSize,
  })

  result.total = rows.length
  logger.info('Shopify seat-usage tick', { rowCount: rows.length })
  if (rows.length === 0) return result

  // today, then the lookback days (yesterday, …) — all at midnight UTC.
  const dates = Array.from({ length: input.lookbackDays + 1 }, (_, i) => utcDayMinus(i))

  const tally = (report: SeatDayReport) => {
    if (report.status === 'accepted') result.accepted++
    else if (report.status === 'duplicate') result.duplicate++
    else result.skipped++
  }

  for (const row of rows) {
    // Never bill during the free-trial window (§6 Q5 — a money bug if wrong).
    if (row.status === 'trialing') {
      result.skipped++
      continue
    }

    for (const date of dates) {
      // Out-of-cycle events reject — only send a lookback day that's within the current cycle.
      if (row.periodStart && date < startOfUtcDay(row.periodStart)) {
        result.skipped++
        continue
      }
      try {
        const report = await reportOrgSeatDay(db, { organizationId: row.organizationId, date })
        tally(report)
      } catch (err) {
        result.errors++
        logger.error('reportOrgSeatDay failed for org', {
          orgId: row.organizationId,
          date: date.toISOString().slice(0, 10),
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  logger.info('Shopify seat-usage tick completed', { ...result })
  return result
}

/** Midnight-UTC of the given timestamp, for same-granularity comparison with the drip dates. */
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
