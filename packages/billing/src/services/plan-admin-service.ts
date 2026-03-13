// packages/billing/src/services/plan-admin-service.ts
/**
 * Admin service for managing billing plans with full CRUD operations.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'

const logger = createScopedLogger('plan-admin-service')

/**
 * Feature limit definition.
 * Supports numeric limits (-1 for unlimited) and boolean gates (true/false).
 */
export interface FeatureLimit {
  key: string
  limit: number | boolean // -1 for unlimited, true/false for boolean gates
}

/**
 * Input for creating a plan
 */
export interface CreatePlanInput {
  name: string
  description: string
  features: string[]
  monthlyPrice: number // in cents
  annualPrice: number // in cents
  isCustomPricing: boolean
  isFree: boolean
  hasTrial: boolean
  trialDays: number
  featureLimits: FeatureLimit[]
  hierarchyLevel: number
  selfServed: boolean
  isMostPopular: boolean
  minSeats?: number
  maxSeats?: number
}

/**
 * Input for updating a plan
 */
export interface UpdatePlanInput {
  name?: string
  description?: string
  features?: string[]
  monthlyPrice?: number
  annualPrice?: number
  isCustomPricing?: boolean
  isFree?: boolean
  hasTrial?: boolean
  trialDays?: number
  featureLimits?: FeatureLimit[]
  hierarchyLevel?: number
  selfServed?: boolean
  isMostPopular?: boolean
  minSeats?: number
  maxSeats?: number
}

/**
 * Input for updating plan pricing
 */
export interface UpdatePricingInput {
  monthlyPrice: number
  annualPrice: number
}

/**
 * Query options for listing plans
 */
export interface ListPlansOptions {
  includeLegacy?: boolean
  search?: string
}

/**
 * Admin service for managing billing plans
 */
export class PlanAdminService {
  constructor(private db: Database) {}

  /**
   * Get all plans with optional filtering
   */
  async getAllPlans(options: ListPlansOptions = {}) {
    const { includeLegacy = false, search } = options

    let query = this.db.query.Plan.findMany({
      orderBy: (plan, { asc }) => [asc(plan.hierarchyLevel), asc(plan.name)],
    })

    // Build where conditions
    if (!includeLegacy) {
      query = this.db.query.Plan.findMany({
        where: (plan, { eq }) => eq(plan.isLegacy, false),
        orderBy: (plan, { asc }) => [asc(plan.hierarchyLevel), asc(plan.name)],
      })
    }

    const plans = await query

    // Filter by search if provided
    if (search) {
      const searchLower = search.toLowerCase()
      return plans.filter(
        (p) =>
          p.name.toLowerCase().includes(searchLower) ||
          p.description?.toLowerCase().includes(searchLower)
      )
    }

    return plans
  }

  /**
   * Get plan by ID
   */
  async getPlanById(id: string) {
    const plan = await this.db.query.Plan.findFirst({
      where: (plans, { eq }) => eq(plans.id, id),
    })

    if (!plan) {
      throw new Error(`Plan with ID ${id} not found`)
    }

    return plan
  }

  /**
   * Create a new plan
   */
  async createPlan(input: CreatePlanInput) {
    const [plan] = await this.db
      .insert(schema.Plan)
      .values({
        name: input.name,
        description: input.description,
        features: input.features,
        monthlyPrice: input.monthlyPrice,
        annualPrice: input.annualPrice,
        isCustomPricing: input.isCustomPricing,
        isFree: input.isFree,
        hasTrial: input.hasTrial,
        trialDays: input.trialDays,
        featureLimits: input.featureLimits,
        hierarchyLevel: input.hierarchyLevel,
        selfServed: input.selfServed,
        isMostPopular: input.isMostPopular,
        minSeats: input.minSeats ?? 1,
        maxSeats: input.maxSeats ?? 10,
        isLegacy: false,
        updatedAt: new Date(),
      })
      .returning()

    logger.info('Plan created', { planId: plan.id, name: plan.name })
    return plan
  }

  /**
   * Update an existing plan
   */
  async updatePlan(id: string, input: UpdatePlanInput) {
    // Verify plan exists
    await this.getPlanById(id)

    const [updated] = await this.db
      .update(schema.Plan)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(schema.Plan.id, id))
      .returning()

    logger.info('Plan updated', { planId: id, changes: Object.keys(input) })
    return updated
  }

  /**
   * Update plan pricing (convenience method)
   */
  async updatePricing(id: string, input: UpdatePricingInput) {
    return this.updatePlan(id, {
      monthlyPrice: input.monthlyPrice,
      annualPrice: input.annualPrice,
    })
  }

  /**
   * Mark plan as legacy (soft delete)
   */
  async markAsLegacy(id: string) {
    // Verify plan exists
    await this.getPlanById(id)

    const [updated] = await this.db
      .update(schema.Plan)
      .set({
        isLegacy: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.Plan.id, id))
      .returning()

    logger.info('Plan marked as legacy', { planId: id, name: updated.name })
    return updated
  }

  /**
   * Restore legacy plan
   */
  async restoreLegacyPlan(id: string) {
    const [updated] = await this.db
      .update(schema.Plan)
      .set({
        isLegacy: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.Plan.id, id))
      .returning()

    logger.info('Legacy plan restored', { planId: id, name: updated.name })
    return updated
  }

  /**
   * Check if plan has active subscriptions
   */
  async hasActiveSubscriptions(planId: string): Promise<boolean> {
    const subscriptions = await this.db.query.PlanSubscription.findMany({
      where: (subs, { eq, and, inArray }) =>
        and(eq(subs.planId, planId), inArray(subs.status, ['active', 'trialing', 'past_due'])),
      limit: 1,
    })

    return subscriptions.length > 0
  }

  /**
   * Get subscription count for a plan
   */
  async getSubscriptionCount(planId: string): Promise<number> {
    const subscriptions = await this.db.query.PlanSubscription.findMany({
      where: (subs, { eq }) => eq(subs.planId, planId),
    })

    return subscriptions.length
  }

  /**
   * Sync plan to Stripe (create/update product and prices)
   */
  async syncToStripe(planId: string): Promise<{
    success: boolean
    stripeProductId: string
    stripePriceIdMonthly: string | null
    stripePriceIdAnnual: string | null
  }> {
    const plan = await this.getPlanById(planId)

    // Validate plan can be synced
    if (plan.isCustomPricing) {
      throw new Error('Cannot sync custom pricing plans to Stripe')
    }

    if (plan.isFree && plan.monthlyPrice === 0 && plan.annualPrice === 0) {
      throw new Error('Cannot sync free plans to Stripe')
    }

    // Get Stripe client
    const stripe = await this.getStripeClient()

    // Create or update Stripe product
    let stripeProductId = plan.stripeProductId

    if (stripeProductId) {
      // Update existing product
      await stripe.products.update(stripeProductId, {
        name: plan.name,
        description: plan.description || undefined,
        metadata: {
          internalPlanId: plan.id,
          planName: plan.name,
        },
      })
      logger.info('Updated Stripe product', { planId, stripeProductId })
    } else {
      // Create new product
      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description || undefined,
        metadata: {
          internalPlanId: plan.id,
          planName: plan.name,
        },
      })
      stripeProductId = product.id
      logger.info('Created Stripe product', { planId, stripeProductId })
    }

    // Create new price objects (Stripe prices are immutable)
    const monthlyPrice = await stripe.prices.create({
      product: stripeProductId,
      unit_amount: plan.monthlyPrice,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: {
        internalPlanId: plan.id,
        billingCycle: 'MONTHLY',
      },
    })

    let annualPriceId: string | null = null
    if (plan.annualPrice > 0) {
      const annualPrice = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: plan.annualPrice,
        currency: 'usd',
        recurring: { interval: 'year' },
        metadata: {
          internalPlanId: plan.id,
          billingCycle: 'ANNUAL',
        },
      })
      annualPriceId = annualPrice.id
    }

    // Mark old prices as inactive if they exist
    if (plan.stripePriceIdMonthly && plan.stripePriceIdMonthly !== monthlyPrice.id) {
      await stripe.prices.update(plan.stripePriceIdMonthly, { active: false })
    }
    if (plan.stripePriceIdAnnual && plan.stripePriceIdAnnual !== annualPriceId) {
      await stripe.prices.update(plan.stripePriceIdAnnual, { active: false })
    }

    // Update plan with new Stripe IDs
    await this.db
      .update(schema.Plan)
      .set({
        stripeProductId,
        stripePriceIdMonthly: monthlyPrice.id,
        stripePriceIdAnnual: annualPriceId,
        updatedAt: new Date(),
      })
      .where(eq(schema.Plan.id, planId))

    logger.info('Plan synced to Stripe', {
      planId,
      stripeProductId,
      stripePriceIdMonthly: monthlyPrice.id,
      stripePriceIdAnnual: annualPriceId,
    })

    return {
      success: true,
      stripeProductId,
      stripePriceIdMonthly: monthlyPrice.id,
      stripePriceIdAnnual: annualPriceId,
    }
  }

  /**
   * Get Stripe client instance
   */
  private async getStripeClient() {
    const { stripeClient } = await import('@auxx/billing')
    return stripeClient.getClient()
  }
}
