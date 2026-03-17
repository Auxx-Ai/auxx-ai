// packages/billing/src/__integration__/helpers/db-helpers.ts
/**
 * Database seeding and query helpers for integration tests.
 * Creates real DB records mirroring production FK chains.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { randomUUID } from 'crypto'
import { eq, like } from 'drizzle-orm'
import type { StripePlanIds } from './stripe-helpers'

export const TEST_PREFIX = 'billing_test_'

export interface TestPlans {
  starter: PlanRecord
  pro: PlanRecord
  enterprise: PlanRecord
}

export interface PlanRecord {
  id: string
  name: string
  stripePriceIdMonthly: string | null
  stripePriceIdAnnual: string | null
  stripeProductId: string | null
  hierarchyLevel: number
}

export interface OrgContext {
  userId: string
  organizationId: string
  memberId: string
  subscriptionId: string
}

let cachedTestPlans: TestPlans | null = null

/** Get cached test plans (populated by seedTestPlans). */
export function getTestPlans(): TestPlans {
  if (!cachedTestPlans) {
    throw new Error('Test plans not seeded. Run seedTestPlans() first.')
  }
  return cachedTestPlans
}

/**
 * Seed test plans into DB (idempotent — upserts by name).
 * Receives Stripe product/price IDs created by stripe-helpers.
 */
export async function seedTestPlans(db: Database, stripePlans: StripePlanIds): Promise<TestPlans> {
  const planDefs = [
    {
      key: 'starter' as const,
      name: 'billing_test_starter',
      monthlyPrice: 2900,
      annualPrice: 29000,
      hierarchyLevel: 1,
      stripe: stripePlans.starter,
    },
    {
      key: 'pro' as const,
      name: 'billing_test_pro',
      monthlyPrice: 7900,
      annualPrice: 79000,
      hierarchyLevel: 2,
      stripe: stripePlans.pro,
    },
    {
      key: 'enterprise' as const,
      name: 'billing_test_enterprise',
      monthlyPrice: 19900,
      annualPrice: 199000,
      hierarchyLevel: 3,
      stripe: stripePlans.enterprise,
    },
  ]

  const result: Record<string, PlanRecord> = {}

  for (const def of planDefs) {
    // Check if plan exists
    const existing = await db
      .select()
      .from(schema.Plan)
      .where(eq(schema.Plan.name, def.name))
      .limit(1)

    let planId: string

    if (existing[0]) {
      planId = existing[0].id
      // Update with latest Stripe IDs
      await db
        .update(schema.Plan)
        .set({
          stripeProductId: def.stripe.productId,
          stripePriceIdMonthly: def.stripe.monthlyPriceId,
          stripePriceIdAnnual: def.stripe.annualPriceId,
          monthlyPrice: def.monthlyPrice,
          annualPrice: def.annualPrice,
          hierarchyLevel: def.hierarchyLevel,
          hasTrial: true,
          trialDays: 14,
          updatedAt: new Date(),
        })
        .where(eq(schema.Plan.id, planId))
    } else {
      planId = `${TEST_PREFIX}plan_${randomUUID().replace(/-/g, '').slice(0, 24)}`
      await db.insert(schema.Plan).values({
        id: planId,
        name: def.name,
        monthlyPrice: def.monthlyPrice,
        annualPrice: def.annualPrice,
        stripeProductId: def.stripe.productId,
        stripePriceIdMonthly: def.stripe.monthlyPriceId,
        stripePriceIdAnnual: def.stripe.annualPriceId,
        hierarchyLevel: def.hierarchyLevel,
        hasTrial: true,
        trialDays: 14,
        selfServed: true,
        updatedAt: new Date(),
      })
    }

    result[def.key] = {
      id: planId,
      name: def.name,
      stripePriceIdMonthly: def.stripe.monthlyPriceId,
      stripePriceIdAnnual: def.stripe.annualPriceId,
      stripeProductId: def.stripe.productId,
      hierarchyLevel: def.hierarchyLevel,
    }
  }

  cachedTestPlans = result as TestPlans
  return cachedTestPlans
}

/**
 * Create a full org context: User + Organization + OrganizationMember (OWNER) + PlanSubscription.
 *
 * Minimum required records (FK chain):
 *   User (createdById for Org)
 *     → Organization (FK: createdById → User.id)
 *       → OrganizationMember (FK: userId → User.id, organizationId → Org.id, role: OWNER)
 *         → PlanSubscription (FK: organizationId → Org.id, planId → Plan.id)
 */
export async function createTestOrgContext(
  db: Database,
  opts: {
    planId: string
    planName: string
    stripeCustomerId: string
    stripeSubscriptionId: string
    status?: string
    billingCycle?: 'MONTHLY' | 'ANNUAL'
    seats?: number
    trialStart?: Date
    trialEnd?: Date
    hasTrialEnded?: boolean
    isEligibleForTrial?: boolean
  }
): Promise<OrgContext> {
  const now = new Date()
  const userId = `${TEST_PREFIX}user_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const organizationId = `${TEST_PREFIX}org_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const memberId = `${TEST_PREFIX}member_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const subscriptionId = `${TEST_PREFIX}sub_${randomUUID().replace(/-/g, '').slice(0, 24)}`

  // 1. User
  await db.insert(schema.User).values({
    id: userId,
    email: `billing-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.auxx.ai`,
    name: 'Billing Test User',
    updatedAt: now,
    emailVerified: true,
  })

  // 2. Organization
  await db.insert(schema.Organization).values({
    id: organizationId,
    createdById: userId,
    name: 'Billing Test Org',
    type: 'TEAM',
    updatedAt: now,
  })

  // 3. OrganizationMember (OWNER)
  await db.insert(schema.OrganizationMember).values({
    id: memberId,
    userId,
    organizationId,
    role: 'OWNER',
    status: 'ACTIVE',
    updatedAt: now,
  })

  // 4. PlanSubscription
  await db.insert(schema.PlanSubscription).values({
    id: subscriptionId,
    organizationId,
    planId: opts.planId,
    plan: opts.planName,
    status: opts.status ?? 'incomplete',
    seats: opts.seats ?? 1,
    billingCycle: opts.billingCycle ?? 'MONTHLY',
    stripeCustomerId: opts.stripeCustomerId,
    stripeSubscriptionId: opts.stripeSubscriptionId,
    periodStart: now,
    trialStart: opts.trialStart,
    trialEnd: opts.trialEnd,
    hasTrialEnded: opts.hasTrialEnded ?? false,
    isEligibleForTrial: opts.isEligibleForTrial ?? true,
    updatedAt: now,
  })

  return { userId, organizationId, memberId, subscriptionId }
}

/** Query current subscription state by ID. */
export async function getSubscription(
  db: Database,
  subscriptionId: string
): Promise<typeof schema.PlanSubscription.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.PlanSubscription)
    .where(eq(schema.PlanSubscription.id, subscriptionId))
    .limit(1)
  return rows[0] ?? null
}

/** Query invoices for an organization, ordered by invoiceDate desc. */
export async function getInvoices(
  db: Database,
  organizationId: string
): Promise<(typeof schema.Invoice.$inferSelect)[]> {
  return db.select().from(schema.Invoice).where(eq(schema.Invoice.organizationId, organizationId))
}

/**
 * Clean up test data for a specific org context.
 * Deleting Organization cascades to Member, PlanSubscription, Invoice.
 * Then deletes the User.
 */
export async function cleanupTestOrg(
  db: Database,
  orgContext: { userId: string; organizationId: string }
): Promise<void> {
  // Delete org (cascades to member, subscription, invoice)
  await db.delete(schema.Organization).where(eq(schema.Organization.id, orgContext.organizationId))
  // Delete user
  await db.delete(schema.User).where(eq(schema.User.id, orgContext.userId))
}

/** Safety net: clean up ALL records with TEST_PREFIX IDs. */
export async function cleanupAllTestData(db: Database): Promise<void> {
  // Delete subscriptions first (FK to org)
  await db
    .delete(schema.PlanSubscription)
    .where(like(schema.PlanSubscription.id, `${TEST_PREFIX}%`))

  // Delete members
  await db
    .delete(schema.OrganizationMember)
    .where(like(schema.OrganizationMember.id, `${TEST_PREFIX}%`))

  // Delete orgs
  await db.delete(schema.Organization).where(like(schema.Organization.id, `${TEST_PREFIX}%`))

  // Delete users
  await db.delete(schema.User).where(like(schema.User.id, `${TEST_PREFIX}%`))

  // Note: Plans are NOT deleted — they're reused across test runs
}
