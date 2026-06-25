// packages/lib/src/jobs/billing/shopify-billing-sync-job.ts

import { ShopifyBillingProvider } from '@auxx/billing'
import { database as db, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { onCacheEvent } from '../../cache'
import { createScopedLogger } from '../../logger'
import type { JobContext } from '../types'

const logger = createScopedLogger('shopify-billing-sync-job')

const payloadSchema = z.object({
  batchSize: z.number().int().positive().default(100),
})

export type ShopifyBillingSyncJobData = z.infer<typeof payloadSchema>

export interface ShopifyBillingSyncResult {
  total: number
  synced: number
  skipped: number
  errors: number
}

/** Per-org cooldown so a worker tick doesn't hammer the Admin API right after a
 *  redirect-landing sync for the same org. */
const COOLDOWN_PREFIX = 'shopify-billing-sync:cooldown:'
const COOLDOWN_SECONDS = 30

/**
 * Reconciles every Shopify-billed org against the Admin API
 * (`currentAppInstallation.activeSubscriptions`). App Pricing delivers no
 * subscription-update webhooks (see plans/billing/v2/01-shopify-app-pricing-reference.md
 * §6), so this 15-minute poll is the backstop for off-redirect changes — cancellations
 * and freezes done from Shopify Admin, billing-period rollovers. Per-org failures are
 * logged and skipped so one Admin API hiccup doesn't stall the tick.
 */
export async function shopifyBillingSyncJob(
  ctx: JobContext<ShopifyBillingSyncJobData>
): Promise<ShopifyBillingSyncResult> {
  const job = ctx.job
  const input = payloadSchema.parse(job.data ?? {})
  const result: ShopifyBillingSyncResult = { total: 0, synced: 0, skipped: 0, errors: 0 }

  const rows = await db.query.PlanSubscription.findMany({
    where: and(
      eq(schema.PlanSubscription.billingProvider, 'shopify'),
      ne(schema.PlanSubscription.status, 'canceled'),
      isNotNull(schema.PlanSubscription.shopifyShopDomain)
    ),
    columns: { id: true, organizationId: true, shopifyShopDomain: true },
    limit: input.batchSize,
  })

  result.total = rows.length
  logger.info('Shopify billing sync tick', { rowCount: rows.length })
  if (rows.length === 0) return result

  const redis = await getRedisClient()
  const provider = new ShopifyBillingProvider(db)

  for (const row of rows) {
    try {
      if (redis) {
        const cooldownKey = `${COOLDOWN_PREFIX}${row.organizationId}`
        if (await redis.get(cooldownKey)) {
          result.skipped++
          continue
        }
      }

      await provider.syncFromAdminApi(row.organizationId)
      await onCacheEvent('plan.changed', { orgId: row.organizationId })
      result.synced++

      if (redis) {
        await redis.setex(`${COOLDOWN_PREFIX}${row.organizationId}`, COOLDOWN_SECONDS, '1')
      }
    } catch (err) {
      result.errors++
      logger.error('syncFromAdminApi failed for org', {
        orgId: row.organizationId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info('Shopify billing sync tick completed', { ...result })
  return result
}
