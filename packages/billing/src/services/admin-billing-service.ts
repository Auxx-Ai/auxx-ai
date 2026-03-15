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
import { stripeClient } from './stripe-client'

const logger = createScopedLogger('admin-billing-service')

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
   * End trial immediately, forcing organization to upgrade or lose access
   */
  async endTrialImmediately(input: {
    organizationId: string
    adminUserId: string
    reason?: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)

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

    const previousState = {
      trialEnd: subscription.trialEnd,
      hasTrialEnded: subscription.hasTrialEnded,
    }

    // Update subscription
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

    // Update Stripe if subscription exists
    if (subscription.stripeSubscriptionId) {
      const trialEndTimestamp = Math.floor(input.newEndDate.getTime() / 1000)
      await stripeClient.getClient().subscriptions.update(subscription.stripeSubscriptionId, {
        trial_end: trialEndTimestamp,
      })
    }

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
   * Convert trial to paid without payment (admin override)
   */
  async convertTrialToPaid(input: {
    organizationId: string
    planName?: string
    skipPayment: boolean
    adminUserId: string
  }): Promise<void> {
    const subscription = await this.getSubscription(input.organizationId)

    const previousState = {
      status: subscription.status,
      trialConversionStatus: subscription.trialConversionStatus,
    }

    // Update subscription to active
    await this.db
      .update(schema.PlanSubscription)
      .set({
        status: 'active',
        trialConversionStatus: 'CONVERTED_TO_PAID',
        hasTrialEnded: true,
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
      newState: { status: 'active', trialConversionStatus: 'CONVERTED_TO_PAID' },
    })

    logger.info('Trial converted to paid', { organizationId: input.organizationId })
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

    await this.db
      .update(schema.PlanSubscription)
      .set({
        status: input.newStatus,
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
