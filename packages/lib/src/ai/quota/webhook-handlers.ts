// packages/lib/src/ai/quota/webhook-handlers.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { createScopedLogger } from '../../logger'
import { getNumericFeatureLimit } from '../../permissions/types'
import { DEFAULT_QUOTA_LIMITS, ProviderQuotaType } from '../providers/types'
import { QuotaService } from './quota-service'

const logger = createScopedLogger('quota-webhook-handlers')

/**
 * Pull the `monthlyAiCredits` limit off the plan record. Falls back to the
 * `DEFAULT_QUOTA_LIMITS` when the plan doesn't declare the feature.
 */
function resolveMonthlyCreditsFromPlan(
  plan: { featureLimits: unknown } | null | undefined,
  fallbackType: ProviderQuotaType = ProviderQuotaType.FREE
): number {
  if (!plan) return DEFAULT_QUOTA_LIMITS[fallbackType]
  const limit = getNumericFeatureLimit(plan.featureLimits, 'monthlyAiCredits')
  return limit ?? DEFAULT_QUOTA_LIMITS[fallbackType]
}

/**
 * Handle `invoice.paid`: reset the org's monthly AI credit pool when the
 * payment is a renewal or first charge. Keeps the `quotaLimit` that was
 * previously set by `subscription.updated` or the org seeder.
 *
 * Designed to be plugged into `WebhookService` custom handlers:
 *
 *     new WebhookService(db, secret, {
 *       onInvoicePaid: (event, ctx) => onInvoicePaidRefreshQuota(db, event, ctx),
 *       ...
 *     })
 */
export async function onInvoicePaidRefreshQuota(
  db: Database,
  event: Stripe.Event,
  ctx: { organizationId: string | null }
): Promise<void> {
  if (!ctx.organizationId) return
  const invoice = event.data.object as Stripe.Invoice
  const reason = invoice.billing_reason

  if (reason !== 'subscription_cycle' && reason !== 'subscription_create') {
    logger.debug('Skipping quota refresh for non-cycle invoice', {
      organizationId: ctx.organizationId,
      billingReason: reason,
    })
    return
  }

  try {
    const quota = new QuotaService(db, ctx.organizationId)
    await quota.resetQuota()
    logger.info('Refreshed AI credit pool on invoice.paid', {
      organizationId: ctx.organizationId,
      billingReason: reason,
    })
  } catch (err) {
    logger.error('Failed to refresh quota on invoice.paid', {
      organizationId: ctx.organizationId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Handle `customer.subscription.updated`: realign the org's `quotaLimit` to
 * the active plan's `monthlyAiCredits` and pro-rate mid-cycle `quotaUsed`
 * based on the old/new ratio.
 *
 * Designed to be plugged into `WebhookService` custom handlers alongside the
 * existing `handlePlanDowngrade` side-effect.
 */
export async function onSubscriptionUpdatedSyncQuota(
  db: Database,
  _event: Stripe.Event,
  ctx: { organizationId: string | null }
): Promise<void> {
  if (!ctx.organizationId) return

  try {
    const sub = await db.query.PlanSubscription.findFirst({
      where: eq(schema.PlanSubscription.organizationId, ctx.organizationId),
    })
    if (!sub?.planId) return

    const plan = await db.query.Plan.findFirst({
      where: eq(schema.Plan.id, sub.planId),
    })
    if (!plan) return

    const existing = await db.query.OrganizationAiQuota.findFirst({
      where: eq(schema.OrganizationAiQuota.organizationId, ctx.organizationId),
    })

    const newLimit = resolveMonthlyCreditsFromPlan(plan)
    const oldLimit = existing?.quotaLimit ?? newLimit

    const quota = new QuotaService(db, ctx.organizationId)
    if (!existing) {
      // First time we see this org post-migration: initialize as PAID with the plan limit.
      await quota.upgradeToPaid(newLimit)
      return
    }

    if (oldLimit !== newLimit) {
      await quota.proRateQuotaOnPlanChange(oldLimit, newLimit)
    }

    logger.info('Synced AI credit pool on subscription.updated', {
      organizationId: ctx.organizationId,
      planId: plan.id,
      oldLimit,
      newLimit,
    })
  } catch (err) {
    logger.error('Failed to sync quota on subscription.updated', {
      organizationId: ctx.organizationId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
