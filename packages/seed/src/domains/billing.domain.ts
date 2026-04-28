// packages/seed/src/domains/billing.domain.ts
/**
 * Billing domain seeder for creating plans and Stripe resources.
 * Creates plans in database and corresponding Stripe products/prices.
 */

import { configService } from '@auxx/credentials'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import type { SeedingContext, SeedingScenario } from '../types'

/** Feature limit definition */
interface FeatureLimit {
  key: string
  limit: number | boolean
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
  trialFeatureLimits: FeatureLimit[] | null
  hierarchyLevel: number
  isFree: boolean
  selfServed?: boolean
  isMostPopular?: boolean
}

// ── Shared feature building blocks ──

/** Static limits (count of things) keyed by plan tier */
const STATIC_LIMITS = {
  demo: {
    teammates: 1,
    channels: 1,
    workflowsLimit: 3,
    savedViews: 10,
    knowledgeBases: 1,
    kbPublishedArticles: 5,
    datasetsLimit: 1,
    entities: 5,
    importRowsLimit: 50,
  },
  free: {
    teammates: 1,
    channels: 1,
    workflowsLimit: 3,
    savedViews: 10,
    knowledgeBases: 0,
    kbPublishedArticles: 0,
    datasetsLimit: 0,
    entities: 3,
    importRowsLimit: 50,
  },
  starter: {
    teammates: -1,
    channels: 3,
    workflowsLimit: 15,
    savedViews: 20,
    knowledgeBases: 1,
    kbPublishedArticles: 50,
    datasetsLimit: 5,
    entities: 10,
    importRowsLimit: 500,
  },
  growth: {
    teammates: -1,
    channels: -1,
    workflowsLimit: -1,
    savedViews: -1,
    knowledgeBases: -1,
    kbPublishedArticles: -1,
    datasetsLimit: -1,
    entities: -1,
    importRowsLimit: 1000,
  },
  enterprise: {
    teammates: -1,
    channels: -1,
    workflowsLimit: -1,
    savedViews: -1,
    knowledgeBases: -1,
    kbPublishedArticles: -1,
    datasetsLimit: -1,
    entities: -1,
    importRowsLimit: -1,
  },
} as const

/** Boolean gates (on/off) keyed by plan tier */
const BOOLEAN_GATES = {
  demo: {
    knowledgeBase: false,
    apiAccess: false,
    workflows: true,
    aiAgent: true,
    sso: false,
    datasets: true,
    files: true,
    webhooks: false,
    shopify: false,
    devTools: false,
    unverifiedApps: false,
    kopilot: false,
    realtimeSync: true,
    callRecordings: false,
  },
  free: {
    knowledgeBase: false,
    apiAccess: false,
    workflows: true,
    aiAgent: false,
    sso: false,
    datasets: true,
    files: true,
    webhooks: false,
    shopify: false,
    devTools: false,
    unverifiedApps: true,
    kopilot: false,
    realtimeSync: true,
    callRecordings: false,
  },
  starter: {
    knowledgeBase: false,
    apiAccess: false,
    workflows: true,
    aiAgent: false,
    sso: false,
    datasets: true,
    files: true,
    webhooks: false,
    shopify: false,
    devTools: false,
    unverifiedApps: true,
    kopilot: false,
    realtimeSync: true,
    callRecordings: false,
  },
  growth: {
    knowledgeBase: false,
    apiAccess: true,
    workflows: true,
    aiAgent: false,
    sso: false,
    datasets: true,
    files: true,
    webhooks: true,
    shopify: false,
    devTools: false,
    unverifiedApps: true,
    kopilot: false,
    realtimeSync: true,
    callRecordings: false,
  },
  enterprise: {
    knowledgeBase: false,
    apiAccess: true,
    workflows: true,
    aiAgent: true,
    sso: true,
    datasets: true,
    files: true,
    webhooks: true,
    shopify: false,
    devTools: false,
    unverifiedApps: true,
    kopilot: false,
    realtimeSync: true,
    callRecordings: false,
  },
} as const

/**
 * Usage limits (per billing cycle) keyed by plan tier.
 *
 * `monthlyAiCredits` is the primary AI credit pool — LLM calls decrement it
 * by the model's credit multiplier (1/3/8 for small/medium/large tiers).
 *
 * `aiCompletionsPerMonthHard` is an abuse-prevention ceiling on raw call count
 * (sized at ~10× the credit pool). Hitting it is an exceptional event.
 */
const USAGE_LIMITS = {
  demo: {
    callRecordingsHoursPerMonthHard: 0,
    callRecordingsHoursPerMonthSoft: 0,
    outboundEmailsPerMonthHard: 0,
    outboundEmailsPerMonthSoft: 0,
    workflowRunsPerMonthHard: 10,
    workflowRunsPerMonthSoft: 8,
    monthlyAiCredits: 20,
    aiCompletionsPerMonthHard: 200,
    aiCompletionsPerMonthSoft: 160,
    aiTranscriptionsPerMonthHard: 50,
    aiTranscriptionsPerMonthSoft: 40,
    apiCallsPerMonthHard: 0,
    apiCallsPerMonthSoft: 0,
    storageGbHard: 0.1,
    storageGbSoft: 0.08,
    appMutationsPerMinuteHard: 10,
    appMutationsPerMinuteSoft: 8,
  },
  free: {
    callRecordingsHoursPerMonthHard: 0,
    callRecordingsHoursPerMonthSoft: 0,
    outboundEmailsPerMonthHard: 100,
    outboundEmailsPerMonthSoft: 80,
    workflowRunsPerMonthHard: 100,
    workflowRunsPerMonthSoft: 80,
    monthlyAiCredits: 50,
    aiCompletionsPerMonthHard: 500,
    aiCompletionsPerMonthSoft: 400,
    aiTranscriptionsPerMonthHard: 100,
    aiTranscriptionsPerMonthSoft: 80,
    apiCallsPerMonthHard: 0,
    apiCallsPerMonthSoft: 0,
    storageGbHard: 1,
    storageGbSoft: 0.8,
    appMutationsPerMinuteHard: 30,
    appMutationsPerMinuteSoft: 25,
  },
  starter: {
    callRecordingsHoursPerMonthHard: 0,
    callRecordingsHoursPerMonthSoft: 0,
    outboundEmailsPerMonthHard: 1000,
    outboundEmailsPerMonthSoft: 800,
    workflowRunsPerMonthHard: 5000,
    workflowRunsPerMonthSoft: 4000,
    monthlyAiCredits: 600,
    aiCompletionsPerMonthHard: 6000,
    aiCompletionsPerMonthSoft: 4800,
    aiTranscriptionsPerMonthHard: 1500,
    aiTranscriptionsPerMonthSoft: 1200,
    apiCallsPerMonthHard: 0,
    apiCallsPerMonthSoft: 0,
    storageGbHard: 10,
    storageGbSoft: 8,
    appMutationsPerMinuteHard: 60,
    appMutationsPerMinuteSoft: 50,
  },
  growth: {
    callRecordingsHoursPerMonthHard: 10,
    callRecordingsHoursPerMonthSoft: 8,
    outboundEmailsPerMonthHard: 10000,
    outboundEmailsPerMonthSoft: 8000,
    workflowRunsPerMonthHard: 15000,
    workflowRunsPerMonthSoft: 12000,
    monthlyAiCredits: 1500,
    aiCompletionsPerMonthHard: 15000,
    aiCompletionsPerMonthSoft: 12000,
    aiTranscriptionsPerMonthHard: 5000,
    aiTranscriptionsPerMonthSoft: 4000,
    apiCallsPerMonthHard: 10000,
    apiCallsPerMonthSoft: 8000,
    storageGbHard: 50,
    storageGbSoft: 40,
    appMutationsPerMinuteHard: 120,
    appMutationsPerMinuteSoft: 100,
  },
  enterprise: {
    callRecordingsHoursPerMonthHard: -1,
    callRecordingsHoursPerMonthSoft: -1,
    outboundEmailsPerMonthHard: -1,
    outboundEmailsPerMonthSoft: -1,
    workflowRunsPerMonthHard: -1,
    workflowRunsPerMonthSoft: -1,
    monthlyAiCredits: -1,
    aiCompletionsPerMonthHard: -1,
    aiCompletionsPerMonthSoft: -1,
    aiTranscriptionsPerMonthHard: -1,
    aiTranscriptionsPerMonthSoft: -1,
    apiCallsPerMonthHard: -1,
    apiCallsPerMonthSoft: -1,
    storageGbHard: -1,
    storageGbSoft: -1,
    appMutationsPerMinuteHard: -1,
    appMutationsPerMinuteSoft: -1,
  },
} as const

/**
 * Trial credit override: trial users get 200 credits regardless of which plan
 * they are trialing. This is read in the quota-service when a trial starts.
 */
export const TRIAL_MONTHLY_AI_CREDITS = 200
export const TRIAL_AI_COMPLETIONS_HARD = 2000

/**
 * Compose a FeatureLimit[] from building blocks.
 * Guarantees every plan has the same keys in the same order.
 */
function composeFeatureLimits(
  staticLimits: Record<string, number>,
  booleanGates: Record<string, boolean>,
  usageLimits: Record<string, number>
): FeatureLimit[] {
  return [
    ...Object.entries(staticLimits).map(([key, limit]) => ({ key, limit })),
    ...Object.entries(booleanGates).map(([key, limit]) => ({ key, limit })),
    ...Object.entries(usageLimits).map(([key, limit]) => ({ key, limit })),
  ]
}

/**
 * Plan definitions with feature limits.
 * Prices are in cents (e.g., 2000 = $20.00).
 */
const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    name: 'Demo',
    description: 'Temporary demo environment for prospective users',
    features: ['Full product preview', 'Pre-loaded demo data', '1 hour session'],
    monthlyPrice: 0,
    annualPrice: 0,
    isCustomPricing: false,
    hasTrial: false,
    trialDays: 0,
    featureLimits: composeFeatureLimits(STATIC_LIMITS.demo, BOOLEAN_GATES.demo, USAGE_LIMITS.demo),
    trialFeatureLimits: null,
    hierarchyLevel: -1,
    isFree: true,
    selfServed: false,
    isMostPopular: false,
  },
  {
    name: 'Free',
    description: 'Basic features for individuals and small teams',
    features: ['Up to 1 team member', '1 connected inbox', 'Basic AI analysis'],
    monthlyPrice: 0,
    annualPrice: 0,
    isCustomPricing: false,
    hasTrial: false,
    trialDays: 0,
    featureLimits: composeFeatureLimits(STATIC_LIMITS.free, BOOLEAN_GATES.free, USAGE_LIMITS.free),
    trialFeatureLimits: null,
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
    featureLimits: composeFeatureLimits(
      STATIC_LIMITS.starter,
      BOOLEAN_GATES.starter,
      USAGE_LIMITS.starter
    ),
    trialFeatureLimits: composeFeatureLimits(
      STATIC_LIMITS.starter,
      BOOLEAN_GATES.starter,
      USAGE_LIMITS.free
    ),
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
    featureLimits: composeFeatureLimits(
      STATIC_LIMITS.growth,
      BOOLEAN_GATES.growth,
      USAGE_LIMITS.growth
    ),
    trialFeatureLimits: composeFeatureLimits(
      STATIC_LIMITS.growth,
      BOOLEAN_GATES.growth,
      USAGE_LIMITS.free
    ),
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
    featureLimits: composeFeatureLimits(
      STATIC_LIMITS.enterprise,
      BOOLEAN_GATES.enterprise,
      USAGE_LIMITS.enterprise
    ),
    trialFeatureLimits: null,
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
          trialFeatureLimits: planData.trialFeatureLimits,
          hierarchyLevel: planData.hierarchyLevel,
          isFree: planData.isFree,
          selfServed: planData.selfServed ?? true,
          isMostPopular: planData.isMostPopular ?? false,
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
   * Update only the featureLimits columns on existing plans, matched by name.
   * Safe to run on a live database — does not delete plans or affect subscriptions.
   */
  async updateFeatureLimitsOnly(db: any): Promise<number> {
    console.log('💳 Updating plan feature limits...')

    let plansUpdated = 0

    for (const planData of PLAN_DEFINITIONS) {
      const result = await db
        .update(schema.Plan)
        .set({
          featureLimits: planData.featureLimits,
          trialFeatureLimits: planData.trialFeatureLimits,
          updatedAt: new Date(),
        })
        .where(eq(schema.Plan.name, planData.name))
        .returning({ id: schema.Plan.id })

      if (result.length > 0) {
        console.log(`  ✓ Updated feature limits: ${planData.name}`)
        plansUpdated += 1
      } else {
        // Plan doesn't exist yet — create it
        console.log(`  + Creating missing plan: ${planData.name}`)
        await db.insert(schema.Plan).values({
          name: planData.name,
          description: planData.description,
          features: planData.features,
          monthlyPrice: planData.monthlyPrice,
          annualPrice: planData.annualPrice,
          isCustomPricing: planData.isCustomPricing,
          hasTrial: planData.hasTrial,
          trialDays: planData.trialDays,
          featureLimits: planData.featureLimits,
          trialFeatureLimits: planData.trialFeatureLimits,
          hierarchyLevel: planData.hierarchyLevel,
          isFree: planData.isFree,
          selfServed: planData.selfServed ?? true,
          isMostPopular: planData.isMostPopular ?? false,
          updatedAt: new Date(),
        })
        console.log(`  ✓ Created plan: ${planData.name}`)
        plansUpdated += 1
      }
    }

    console.log(`✅ Feature limits updated for ${plansUpdated} plans`)
    return plansUpdated
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

    const secretKey = configService.get<string>('STRIPE_SECRET_KEY')
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is required to seed Stripe resources')
    }

    this.stripeClient = new Stripe(secretKey, {
      apiVersion: '2025-02-24.acacia' as any,
    })

    return this.stripeClient
  }
}
