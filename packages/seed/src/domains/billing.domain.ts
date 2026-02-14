// packages/seed/src/domains/billing.domain.ts
/**
 * Billing domain seeder for creating plans and Stripe resources.
 * Creates plans in database and corresponding Stripe products/prices.
 */

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import type { SeedingContext, SeedingScenario } from '../types'

/** Feature limit definition */
interface FeatureLimit {
  key: string
  limit: number
}

/** Plan definition structure */
interface PlanDefinition {
  name: string
  description: string
  features: string[]
  monthlyPrice: number
  annualPrice: number
  isCustomPricing: boolean
  hasTrial: boolean
  trialDays: number
  featureLimits: FeatureLimit[]
  hierarchyLevel: number
  isFree: boolean
}

/**
 * Plan definitions with feature limits.
 * Prices are in cents (e.g., 2000 = $20.00).
 */
const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    name: 'Free',
    description: 'Basic features for individuals and small teams',
    features: ['Up to 1 team member', '1 connected inbox', 'Basic AI analysis'],
    monthlyPrice: 0,
    annualPrice: 0,
    isCustomPricing: false,
    hasTrial: false,
    trialDays: 0,
    featureLimits: [
      { key: 'TEAMMATES', limit: 1 },
      { key: 'CHANNELS', limit: 1 },
      { key: 'MONTHLY_EMAILS', limit: 100 },
      { key: 'AI_REQUESTS', limit: 10 },
    ],
    hierarchyLevel: 0,
    isFree: true,
  },
  {
    name: 'Starter',
    description: 'Essential features for growing teams',
    features: ['Unlimited team members', 'Up to 5 connected inboxes', 'Advanced AI analysis'],
    monthlyPrice: 2000, // $20.00
    annualPrice: 16800, // $168.00 (30% discount)
    isCustomPricing: false,
    hasTrial: true,
    trialDays: 14,
    featureLimits: [
      { key: 'TEAMMATES', limit: -1 }, // unlimited
      { key: 'CHANNELS', limit: 5 },
      { key: 'MONTHLY_EMAILS', limit: 1000 },
      { key: 'AI_REQUESTS', limit: 100 },
    ],
    hierarchyLevel: 1,
    isFree: false,
  },
  {
    name: 'Growth',
    description: 'Advanced features for scaling businesses',
    features: [
      'Unlimited team members',
      'Unlimited connected inboxes',
      'Priority AI analysis',
      'Advanced reporting',
    ],
    monthlyPrice: 5000, // $50.00
    annualPrice: 42000, // $420.00 (30% discount)
    isCustomPricing: false,
    hasTrial: true,
    trialDays: 14,
    featureLimits: [
      { key: 'TEAMMATES', limit: -1 }, // unlimited
      { key: 'CHANNELS', limit: -1 }, // unlimited
      { key: 'MONTHLY_EMAILS', limit: 10000 },
      { key: 'AI_REQUESTS', limit: 1000 },
    ],
    hierarchyLevel: 2,
    isFree: false,
  },
  {
    name: 'Enterprise',
    description: 'Custom solutions for large organizations',
    features: ['Everything in Growth', 'Custom integrations', 'Dedicated support', 'SLA guarantee'],
    monthlyPrice: 0, // Custom pricing
    annualPrice: 0, // Custom pricing
    isCustomPricing: true,
    hasTrial: false,
    trialDays: 0,
    featureLimits: [
      { key: 'TEAMMATES', limit: -1 },
      { key: 'CHANNELS', limit: -1 },
      { key: 'MONTHLY_EMAILS', limit: -1 },
      { key: 'AI_REQUESTS', limit: -1 },
    ],
    hierarchyLevel: 3,
    isFree: false,
  },
]

/** BillingDomainOptions configures optional behaviors for the billing seeder. */
interface BillingDomainOptions {
  /** plansOnly disables Stripe resource creation when true. Defaults to false (creates Stripe resources). */
  plansOnly?: boolean
}

/**
 * BillingDomain handles plan and Stripe resource seeding.
 */
export class BillingDomain {
  private readonly scenario: SeedingScenario
  /** plansOnly stores whether only plan records should be created. */
  private readonly plansOnly: boolean
  /** stripeClient caches the lazily-instantiated Stripe client. */
  private stripeClient: Stripe | null = null

  constructor(scenario: SeedingScenario, context: SeedingContext, options?: BillingDomainOptions) {
    this.scenario = scenario
    this.plansOnly = options?.plansOnly ?? false
  }

  /**
   * Insert plans directly into database and create Stripe resources.
   */
  async insertDirectly(db: any): Promise<number> {
    console.log('💳 Seeding billing plans...')

    // Clear existing plans
    await db.delete(schema.Plan)

    const shouldCreateStripe = this.shouldCreateStripeResources()
    let stripeClient: Stripe | null = null
    let plansCreated = 0

    for (const planData of PLAN_DEFINITIONS) {
      // 1. Create plan in database
      const [dbPlan] = await db
        .insert(schema.Plan)
        .values({
          name: planData.name,
          description: planData.description,
          features: planData.features,
          monthlyPrice: planData.monthlyPrice,
          annualPrice: planData.annualPrice,
          isCustomPricing: planData.isCustomPricing,
          hasTrial: planData.hasTrial,
          trialDays: planData.trialDays,
          featureLimits: planData.featureLimits,
          hierarchyLevel: planData.hierarchyLevel,
          isFree: planData.isFree,
          updatedAt: new Date(),
        })
        .returning()

      // 2. Create Stripe Product (for all plans except custom pricing)
      if (shouldCreateStripe && !planData.isCustomPricing) {
        stripeClient = stripeClient ?? this.ensureStripeClient()
        const stripeProduct = await stripeClient.products.create({
          name: planData.name,
          description: planData.description,
          metadata: {
            internalPlanId: dbPlan.id,
            planName: dbPlan.name,
          },
        })

        // 3. Create Stripe Prices
        const monthlyPrice = await stripeClient.prices.create({
          product: stripeProduct.id,
          unit_amount: planData.monthlyPrice,
          currency: 'usd',
          recurring: { interval: 'month' },
          metadata: { internalPlanId: dbPlan.id, billingCycle: 'MONTHLY' },
        })

        let annualPriceId = null
        if (planData.annualPrice > 0 || (planData.isFree && planData.annualPrice === 0)) {
          const annualPrice = await stripeClient.prices.create({
            product: stripeProduct.id,
            unit_amount: planData.annualPrice,
            currency: 'usd',
            recurring: { interval: 'year' },
            metadata: { internalPlanId: dbPlan.id, billingCycle: 'ANNUAL' },
          })
          annualPriceId = annualPrice.id
        }

        // 4. Update plan with Stripe IDs
        await db
          .update(schema.Plan)
          .set({
            stripeProductId: stripeProduct.id,
            stripePriceIdMonthly: monthlyPrice.id,
            stripePriceIdAnnual: annualPriceId,
            updatedAt: new Date(),
          })
          .where(eq(schema.Plan.id, dbPlan.id))

        console.log(`  ✓ Created plan: ${planData.name} (${stripeProduct.id})`)
      } else {
        const reason = shouldCreateStripe
          ? 'custom pricing, no Stripe resources'
          : 'plans-only mode, no Stripe resources'
        console.log(`  ✓ Created plan: ${planData.name} (${reason})`)
      }

      plansCreated += 1
    }

    if (!shouldCreateStripe) {
      console.log('  ℹ️ Stripe resource creation skipped (billing plans-only mode)')
    }

    console.log('✅ Billing plans seeded successfully')
    return plansCreated
  }

  /**
   * shouldCreateStripeResources determines if Stripe entities should be created.
   * @returns True when Stripe products/prices should be provisioned.
   */
  private shouldCreateStripeResources(): boolean {
    if (this.plansOnly) {
      return false
    }

    if (this.scenario.features.billingStripeResources === false) {
      return false
    }

    return true
  }

  /**
   * ensureStripeClient lazily instantiates and caches the Stripe client.
   * @returns Configured Stripe client instance.
   */
  private ensureStripeClient(): Stripe {
    if (this.stripeClient) {
      return this.stripeClient
    }

    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is required to seed Stripe resources')
    }

    this.stripeClient = new Stripe(secretKey, {
      apiVersion: '2025-02-24.acacia' as any,
    })

    return this.stripeClient
  }
}
