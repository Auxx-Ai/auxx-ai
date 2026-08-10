// packages/billing/src/services/admin-billing-service.ts
/**
 * Admin billing service for super admin operations
 * Handles trial management, organization access, subscription management,
 * enterprise plan configuration, and financial actions with full audit logging
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import type { PlanChangeHandler } from '../types'
import { auditLog } from '../utils/audit-logger'
import { BillingError, ErrorCode } from '../utils/error-codes'
import { stripeClient } from './stripe-client'

const logger = createScopedLogger('admin-billing-service')

/**
 * Stripe rejects a `trial_end` less than 48 hours in the future. We validate against it
 * before touching the database so a rejected extension can't leave the local row extended
 * while Stripe still holds the old date.
 */
const STRIPE_MIN_TRIAL_END_MS = 48 * 60 * 60 * 1000

/** Custom feature limits for Enterprise customers (camelCase keys match FeatureKey enum) */
export interface CustomFeatureLimits {
  teammates?: number // -1 for unlimited
  channels?: number
  outboundEmailsPerMonthHard?: number
  outboundEmailsPerMonthSoft?: number
  workflowRunsPerMonthHard?: number
  workflowRunsPerMonthSoft?: number
  aiCompletionsPerMonthHard?: number
  aiCompletionsPerMonthSoft?: number
  apiCallsPerMonthHard?: number
  apiCallsPerMonthSoft?: number
  storageGbHard?: number
  storageGbSoft?: number
  [key: string]: number | boolean | undefined // Extensible for future features
}

/**
 * Admin Billing Service
 * Provides administrative operations for managing subscriptions, trials, and billing
 */
export class AdminBillingService {
  constructor(
    private db: Database,
    private baseUrl: string,
    private onPlanChange?: PlanChangeHandler
  ) {}

  // ============ Trial Management ============

  /**
   * End trial immediately, forcing organization to upgrade or lose access.
   *
   * Claims the admin override: without it, Stripe's own trial keeps running on its
   * original schedule and the `customer.subscription.updated` webhook that fires when it
   * expires would flip the local status back to `active` — silently restoring access to an
   * org an admin had just locked out, and billing them for it.
   */
  async endTrialImmediately(input: {
    organizationId: string
    adminUserId: string
    reason?: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)
    this.assertTrialEditable(subscription)

    const previousState = {
      trialEnd: subscription.trialEnd,
      hasTrialEnded: subscription.hasTrialEnded,
      status: subscription.status,
    }

    // Update subscription
    await this.db
      .update(schema.PlanSubscription)
      .set({
        hasTrialEnded: true,
        trialEnd: new Date(),
        adminOverrideAt: new Date(),
        adminOverrideReason: input.reason ?? 'Trial ended early by admin',
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    // Audit log
    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'END_TRIAL',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      reason: input.reason,
      previousState,
      newState: { hasTrialEnded: true, trialEnd: new Date() },
    })

    logger.info('Trial ended immediately', { organizationId: input.organizationId })
  }

  /**
   * Extend trial period to new date
   */
  async extendTrial(input: {
    organizationId: string
    newEndDate: Date
    adminUserId: string
    reason?: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)
    this.assertTrialEditable(subscription)

    const previousState = {
      trialEnd: subscription.trialEnd,
      hasTrialEnded: subscription.hasTrialEnded,
    }

    // Stripe FIRST, database second. The Stripe call is the fallible half — it rejects a
    // `trial_end` under 48 hours, and a rejection used to land after the local write, so the
    // row read as extended while Stripe still held the old date and the admin saw only
    // "Failed to extend trial". A subscription with no `stripeSubscriptionId` is local-only
    // (admin-created or unlinked); nothing reconciles it, so the local write alone is correct.
    if (subscription.stripeSubscriptionId) {
      if (input.newEndDate.getTime() - Date.now() < STRIPE_MIN_TRIAL_END_MS) {
        throw new BillingError(
          ErrorCode.STRIPE_ERROR,
          'Stripe requires the new trial end to be at least 48 hours in the future. Extend by 3 days or more.'
        )
      }

      const trialEndTimestamp = Math.floor(input.newEndDate.getTime() / 1000)
      await stripeClient.getClient().subscriptions.update(subscription.stripeSubscriptionId, {
        trial_end: trialEndTimestamp,
      })
    }

    await this.db
      .update(schema.PlanSubscription)
      .set({
        trialEnd: input.newEndDate,
        hasTrialEnded: false,
        deletionScheduledDate: null, // Clear any scheduled deletion
        lastDeletionNotificationSent: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'EXTEND_TRIAL',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      reason: input.reason,
      previousState,
      newState: { trialEnd: input.newEndDate, hasTrialEnded: false },
    })

    logger.info('Trial extended', {
      organizationId: input.organizationId,
      newEndDate: input.newEndDate,
    })
  }

  /**
   * Convert trial to paid without payment (admin override).
   *
   * When `planName` is omitted the org stays on the plan it trialed on; when it is
   * given, the conversion lands them on that plan in the same write (which is what
   * an admin converting a Free trial into a paid Growth workspace needs).
   */
  async convertTrialToPaid(input: {
    organizationId: string
    planName?: string
    skipPayment: boolean
    adminUserId: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)
    this.assertTrialEditable(subscription)

    // Resolve the target plan up front so an unknown name fails before any write.
    const targetPlan = input.planName ? await this.findPlanByName(input.planName) : null
    if (input.planName && !targetPlan) {
      throw new Error(`Plan ${input.planName} not found`)
    }

    const previousState = {
      status: subscription.status,
      trialConversionStatus: subscription.trialConversionStatus,
      planId: subscription.planId,
      plan: subscription.plan,
    }

    // Update subscription to active, and claim the admin override. This conversion is a
    // comp (`skipPayment`), so it deliberately does NOT touch the provider — which means
    // without the override the next Stripe webhook would overwrite `active` with whatever
    // Stripe says. With no payment method that is `incomplete`/`past_due`, both of which
    // are in BLOCKED_SUBSCRIPTION_STATUSES, so the comp would expire into a lockout.
    await this.db
      .update(schema.PlanSubscription)
      .set({
        status: 'active',
        trialConversionStatus: 'CONVERTED_TO_PAID',
        hasTrialEnded: true,
        adminOverrideAt: new Date(),
        adminOverrideReason: 'Trial converted to paid by admin without payment',
        ...(targetPlan ? { planId: targetPlan.id, plan: targetPlan.name } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'CONVERT_TRIAL_TO_PAID',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      details: { skipPayment: input.skipPayment },
      previousState,
      newState: {
        status: 'active',
        trialConversionStatus: 'CONVERTED_TO_PAID',
        planId: targetPlan?.id ?? subscription.planId,
        plan: targetPlan?.name ?? subscription.plan,
      },
    })

    logger.info('Trial converted to paid', {
      organizationId: input.organizationId,
      plan: targetPlan?.name ?? subscription.plan,
    })

    // A plan change has to run the same overage check every other plan write does.
    if (targetPlan && targetPlan.id !== subscription.planId) {
      await this.onPlanChange?.(this.db, input.organizationId, targetPlan.id)
    }
  }

  /**
   * Rejects trial edits on Shopify-billed organizations.
   *
   * Shopify owns the trial outright: trial days are configured per plan in the Partner
   * Dashboard, and {@link ShopifyBillingProvider} is read-only by design — it never issues a
   * billing GraphQL mutation. A local trial edit therefore changes nothing on Shopify's side
   * and is reverted within 15 minutes by `syncFromAdminApi`, which overwrites both `status`
   * and `trialEnd` from the Admin API. Failing loudly beats writing something that silently
   * disappears.
   */
  private assertTrialEditable(subscription: { billingProvider: string | null }): void {
    if (subscription.billingProvider === 'shopify') {
      throw new BillingError(
        ErrorCode.OPERATION_NOT_SUPPORTED,
        'Shopify owns the trial for this organization. Change the trial on the plan in the ' +
          'Shopify Partner Dashboard — a local edit is reverted by the billing sync.'
      )
    }
  }

  /**
   * Hand billing control back to the provider by clearing the admin override.
   *
   * After this the Stripe webhook and the Shopify Admin poll resume writing status, plan,
   * and trial dates for this subscription — so whatever the provider currently believes
   * becomes the truth on the next sync.
   */
  async clearAdminOverride(input: {
    organizationId: string
    adminUserId: string
    reason?: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)

    const previousState = {
      adminOverrideAt: subscription.adminOverrideAt,
      adminOverrideReason: subscription.adminOverrideReason,
    }

    await this.db
      .update(schema.PlanSubscription)
      .set({
        adminOverrideAt: null,
        adminOverrideReason: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'CLEAR_BILLING_OVERRIDE',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      reason: input.reason,
      previousState,
      newState: { adminOverrideAt: null, adminOverrideReason: null },
    })

    logger.info('Admin billing override cleared', { organizationId: input.organizationId })
  }

  /**
   * Resolve a non-legacy plan by name, case-insensitively.
   *
   * Callers hand us names from two different vocabularies — `Plan.name` is stored
   * TitleCase ('Growth'), while `PlanService.getPlans()` lowercases it for its
   * consumers — so matching exactly on either one silently misses the other.
   */
  private async findPlanByName(name: string) {
    const plans = await this.db.query.Plan.findMany({
      where: (plan, { eq }) => eq(plan.isLegacy, false),
    })
    const wanted = name.trim().toLowerCase()
    return plans.find((plan) => plan.name.toLowerCase() === wanted) ?? null
  }

  // ============ Organization Access Management ============

  /**
   * Disable organization access
   */
  async disableOrganization(input: {
    organizationId: string
    reason: string
    adminUserId: string
  }): Promise<void> {
    await this.db
      .update(schema.Organization)
      .set({
        disabledAt: new Date(),
        disabledReason: input.reason,
        disabledBy: input.adminUserId,
      })
      .where(eq(schema.Organization.id, input.organizationId))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'DISABLE_ORGANIZATION',
      targetType: 'ORGANIZATION',
      targetId: input.organizationId,
      organizationId: input.organizationId,
      reason: input.reason,
      previousState: { disabledAt: null },
      newState: { disabledAt: new Date(), reason: input.reason },
    })

    logger.info('Organization disabled', { organizationId: input.organizationId })
  }

  /**
   * Enable organization access
   */
  async enableOrganization(input: { organizationId: string; adminUserId: string }): Promise<void> {
    const org = await this.db.query.Organization.findFirst({
      where: (orgs, { eq }) => eq(orgs.id, input.organizationId),
    })

    await this.db
      .update(schema.Organization)
      .set({
        disabledAt: null,
        disabledReason: null,
        disabledBy: null,
      })
      .where(eq(schema.Organization.id, input.organizationId))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'ENABLE_ORGANIZATION',
      targetType: 'ORGANIZATION',
      targetId: input.organizationId,
      organizationId: input.organizationId,
      previousState: { disabledAt: org?.disabledAt },
      newState: { disabledAt: null },
    })

    logger.info('Organization enabled', { organizationId: input.organizationId })
  }

  /**
   * Cancel scheduled deletion
   */
  async cancelScheduledDeletion(input: {
    organizationId: string
    adminUserId: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)

    const previousState = {
      deletionScheduledDate: subscription.deletionScheduledDate,
      lastDeletionNotificationSent: subscription.lastDeletionNotificationSent,
    }

    await this.db
      .update(schema.PlanSubscription)
      .set({
        deletionScheduledDate: null,
        lastDeletionNotificationSent: null,
        lastDeletionNotificationDate: null,
        deletionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'CANCEL_SCHEDULED_DELETION',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      previousState,
      newState: { deletionScheduledDate: null },
    })

    logger.info('Scheduled deletion canceled', { organizationId: input.organizationId })
  }

  // ============ Subscription Management ============

  /**
   * Cancel subscription immediately (not at period end)
   */
  async cancelSubscriptionImmediately(input: {
    organizationId: string
    reason?: string
    adminUserId: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)

    if (subscription.stripeSubscriptionId) {
      await stripeClient.getClient().subscriptions.cancel(subscription.stripeSubscriptionId)
    }

    const previousState = {
      status: subscription.status,
      canceledAt: subscription.canceledAt,
    }

    await this.db
      .update(schema.PlanSubscription)
      .set({
        status: 'canceled',
        canceledAt: new Date(),
        endDate: new Date(),
        scheduledPlanId: null,
        scheduledPlan: null,
        scheduledBillingCycle: null,
        scheduledSeats: null,
        scheduledChangeAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'CANCEL_SUBSCRIPTION_IMMEDIATELY',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      reason: input.reason,
      previousState,
      newState: { status: 'canceled', canceledAt: new Date() },
    })

    logger.info('Subscription canceled immediately', { organizationId: input.organizationId })
  }

  /**
   * Reactivate canceled subscription
   */
  async reactivateCanceledSubscription(input: {
    organizationId: string
    adminUserId: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)

    const previousState = {
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    }

    await this.db
      .update(schema.PlanSubscription)
      .set({
        cancelAtPeriodEnd: false,
        canceledAt: null,
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'REACTIVATE_SUBSCRIPTION',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      previousState,
      newState: { status: 'active', cancelAtPeriodEnd: false },
    })

    logger.info('Subscription reactivated', { organizationId: input.organizationId })
  }

  /**
   * Force subscription status change
   */
  async forceStatusChange(input: {
    organizationId: string
    newStatus: string
    reason: string
    adminUserId: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)

    const previousState = { status: subscription.status }

    // Claims the override — a manually forced status is only meaningful if the provider
    // reconcilers stop overwriting it on the next webhook or Admin API poll.
    await this.db
      .update(schema.PlanSubscription)
      .set({
        status: input.newStatus,
        adminOverrideAt: new Date(),
        adminOverrideReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'FORCE_STATUS_CHANGE',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      reason: input.reason,
      previousState,
      newState: { status: input.newStatus },
    })

    logger.warn('Subscription status force-changed', {
      organizationId: input.organizationId,
      newStatus: input.newStatus,
    })
  }

  // ============ Enterprise Plan Management ============

  /**
   * Set organization to Enterprise plan
   */
  async setEnterprisePlan(input: {
    organizationId: string
    copyCurrentLimits: boolean
    adminUserId: string
  }): Promise<void> {
    // Get Enterprise plan
    const enterprisePlan = await this.db.query.Plan.findFirst({
      where: (plans, { eq }) => eq(plans.name, 'Enterprise'),
    })

    if (!enterprisePlan) {
      throw new Error('Enterprise plan not found')
    }

    const subscription = await this.getSubscription(input.organizationId)

    const previousState = {
      planId: subscription.planId,
      plan: subscription.plan,
      customFeatureLimits: subscription.customFeatureLimits,
    }

    // Optionally copy current limits as custom overrides
    const customLimits =
      input.copyCurrentLimits && subscription.planId
        ? await this.getCurrentFeatureLimits(input.organizationId)
        : null

    await this.db
      .update(schema.PlanSubscription)
      .set({
        planId: enterprisePlan.id,
        plan: enterprisePlan.name,
        status: 'active',
        customFeatureLimits: customLimits,
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'SET_ENTERPRISE_PLAN',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      details: { copyCurrentLimits: input.copyCurrentLimits },
      previousState,
      newState: {
        planId: enterprisePlan.id,
        plan: enterprisePlan.name,
        customFeatureLimits: customLimits,
      },
    })

    logger.info('Organization set to Enterprise plan', { organizationId: input.organizationId })

    // Check for overages against the new enterprise plan
    await this.onPlanChange?.(this.db, input.organizationId, enterprisePlan.id)
  }

  /**
   * Configure custom feature limits for Enterprise
   */
  async configureCustomFeatureLimits(input: {
    organizationId: string
    limits: CustomFeatureLimits
    adminUserId: string
    reason?: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)

    const previousState = {
      customFeatureLimits: subscription.customFeatureLimits,
    }

    await this.db
      .update(schema.PlanSubscription)
      .set({
        customFeatureLimits: input.limits,
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'CONFIGURE_CUSTOM_LIMITS',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      reason: input.reason,
      previousState,
      newState: { customFeatureLimits: input.limits },
    })

    logger.info('Custom feature limits configured', {
      organizationId: input.organizationId,
      limits: input.limits,
    })

    // Check for overages with the updated custom limits
    if (subscription.planId) {
      await this.onPlanChange?.(this.db, input.organizationId, subscription.planId)
    }
  }

  /**
   * Clear custom feature overrides
   */
  async clearCustomFeatureLimits(input: {
    organizationId: string
    adminUserId: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)

    const previousState = {
      customFeatureLimits: subscription.customFeatureLimits,
    }

    await this.db
      .update(schema.PlanSubscription)
      .set({
        customFeatureLimits: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'CLEAR_CUSTOM_LIMITS',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      previousState,
      newState: { customFeatureLimits: null },
    })

    logger.info('Custom feature limits cleared', { organizationId: input.organizationId })

    // Check for overages now that custom limits are removed
    if (subscription.planId) {
      await this.onPlanChange?.(this.db, input.organizationId, subscription.planId)
    }
  }

  // ============ Financial Actions ============

  /**
   * Apply credit adjustment
   */
  async applyCreditAdjustment(input: {
    organizationId: string
    amount: number
    reason: string
    adminUserId: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)

    const previousBalance = subscription.creditsBalance
    const newBalance = previousBalance + input.amount

    await this.db
      .update(schema.PlanSubscription)
      .set({
        creditsBalance: newBalance,
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    await auditLog(this.db, {
      adminUserId: input.adminUserId,
      actionType: 'CREDIT_ADJUSTMENT',
      targetType: 'SUBSCRIPTION',
      targetId: subscription.id,
      organizationId: input.organizationId,
      reason: input.reason,
      previousState: { creditsBalance: previousBalance },
      newState: { creditsBalance: newBalance },
      details: { adjustment: input.amount },
    })

    logger.info('Credit adjustment applied', {
      organizationId: input.organizationId,
      amount: input.amount,
    })
  }

  // ============ Helper Methods ============

  /**
   * Get subscription for organization
   */
  private async getSubscription(organizationId: string) {
    const subscription = await this.db.query.PlanSubscription.findFirst({
      where: (subs, { eq }) => eq(subs.organizationId, organizationId),
    })

    if (!subscription) {
      throw new Error(`No subscription found for organization ${organizationId}`)
    }

    return subscription
  }

  /**
   * Get current feature limits from plan
   */
  private async getCurrentFeatureLimits(
    organizationId: string
  ): Promise<CustomFeatureLimits | null> {
    const subscription = await this.getSubscription(organizationId)

    if (!subscription.planId) {
      return null
    }

    // Fetch the plan with its feature limits
    const [plan] = await this.db
      .select({ featureLimits: schema.Plan.featureLimits })
      .from(schema.Plan)
      .where(eq(schema.Plan.id, subscription.planId))
      .limit(1)

    if (!plan?.featureLimits) {
      return null
    }

    // Convert plan's feature limits to custom format
    const limits = plan.featureLimits as Array<{ key: string; limit: number }>
    const customLimits: CustomFeatureLimits = {}

    for (const { key, limit } of limits) {
      customLimits[key] = limit
    }

    return customLimits
  }
}
