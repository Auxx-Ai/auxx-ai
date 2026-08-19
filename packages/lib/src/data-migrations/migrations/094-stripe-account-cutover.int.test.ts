// packages/lib/src/data-migrations/migrations/094-stripe-account-cutover.int.test.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migration094StripeAccountCutover as migration } from './094-stripe-account-cutover'

/**
 * The cutover against a real Postgres. Everything load-bearing about this migration is a
 * *row selection* decision — which subscriptions are in scope, which of those get closed
 * out — and three of the four carve-outs (`isFree` via LEFT JOIN, the `planId IS NULL`
 * name fallback, `billingProvider IS NULL` meaning "stripe") are only expressible against
 * real SQL. A mocked `db` would pin the shape of the calls, not the outcome.
 *
 * `getOrgCache` is the one thing stubbed: it wants Redis, and the assertion we actually
 * care about is *which orgs* get invalidated with *which keys*.
 */

const { invalidateAndRecompute } = vi.hoisted(() => ({ invalidateAndRecompute: vi.fn() }))

vi.mock('../../cache', async (importOriginal) => {
  // Partial mock — replacing the barrel wholesale breaks collection for anything else
  // that reaches into it.
  const actual = await importOriginal<typeof import('../../cache')>()
  return { ...actual, getOrgCache: () => ({ invalidateAndRecompute }) }
})

/** The legacy account's id shape, so a surviving pointer is obvious in a failure diff. */
const LEGACY = {
  product: 'prod_legacy_T8Cu1',
  priceMonthly: 'price_legacy_monthly',
  priceAnnual: 'price_legacy_annual',
  customer: 'cus_legacy_T8Cu1',
  subscription: 'sub_legacy_T8Cu1',
}

type PlanRow = typeof schema.Plan.$inferSelect
type SubRow = typeof schema.PlanSubscription.$inferSelect

describe('migration 094 — Stripe account cutover', () => {
  let db: Database

  beforeEach(() => {
    db = getTestDb() as unknown as Database
    invalidateAndRecompute.mockReset().mockResolvedValue(undefined)
  })

  /** A plan carrying legacy Stripe pointers unless the caller says otherwise. */
  const createPlan = async (
    overrides: Partial<typeof schema.Plan.$inferInsert> = {}
  ): Promise<PlanRow> => {
    const [plan] = await db
      .insert(schema.Plan)
      .values({
        name: 'Starter',
        monthlyPrice: 2900,
        annualPrice: 29000,
        isFree: false,
        stripeProductId: LEGACY.product,
        stripePriceIdMonthly: LEGACY.priceMonthly,
        stripePriceIdAnnual: LEGACY.priceAnnual,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
      })
      .returning()
    return plan as PlanRow
  }

  /**
   * One subscription per org — `PlanSubscription_organizationId_key` is unique — so every
   * fixture row mints its own organization and hands the id back for the cache assertions.
   */
  const createSub = async (
    overrides: Partial<typeof schema.PlanSubscription.$inferInsert> = {}
  ): Promise<SubRow> => {
    const organizationId = (await createTestOrganization()).id
    const [sub] = await db
      .insert(schema.PlanSubscription)
      .values({
        organizationId,
        plan: 'starter',
        billingProvider: 'stripe',
        status: 'trialing',
        seats: 3,
        creditsBalance: 4_200,
        stripeCustomerId: LEGACY.customer,
        stripeSubscriptionId: LEGACY.subscription,
        trialStart: new Date('2026-02-01T00:00:00.000Z'),
        trialEnd: new Date('2026-02-15T00:00:00.000Z'),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        ...overrides,
      })
      .returning()
    return sub as SubRow
  }

  const readSub = async (id: string): Promise<SubRow> => {
    const [row] = await db
      .select()
      .from(schema.PlanSubscription)
      .where(eq(schema.PlanSubscription.id, id))
    return row as SubRow
  }

  const readPlan = async (id: string): Promise<PlanRow> => {
    const [row] = await db.select().from(schema.Plan).where(eq(schema.Plan.id, id))
    return row as PlanRow
  }

  /** The org ids handed to the cache, deduped, in no particular order. */
  const invalidatedOrgs = (): string[] =>
    invalidateAndRecompute.mock.calls.map((call) => call[0] as string).sort()

  // ── Plan pointers ───────────────────────────────────────────────────────────

  describe('Plan pointers', () => {
    it('nulls product and price ids on every plan, free and paid alike', async () => {
      const paid = await createPlan({ name: 'Growth' })
      const free = await createPlan({ name: 'Free', isFree: true, monthlyPrice: 0, annualPrice: 0 })

      await migration.run(db)

      for (const id of [paid.id, free.id]) {
        const row = await readPlan(id)
        expect(row.stripeProductId).toBeNull()
        expect(row.stripePriceIdMonthly).toBeNull()
        expect(row.stripePriceIdAnnual).toBeNull()
      }
    })

    it('preserves everything about a plan except its Stripe pointers', async () => {
      const plan = await createPlan({ name: 'Growth', monthlyPrice: 9900, hierarchyLevel: 3 })

      await migration.run(db)

      const row = await readPlan(plan.id)
      expect(row.name).toBe('Growth')
      expect(row.monthlyPrice).toBe(9900)
      expect(row.hierarchyLevel).toBe(3)
      expect(row.isFree).toBe(false)
    })

    it('leaves a plan that never carried Stripe ids untouched', async () => {
      // Enterprise/custom-pricing plans are never synced, so the WHERE must not
      // rewrite (and re-stamp `updatedAt` on) rows with nothing to clear.
      const clean = await createPlan({
        name: 'Enterprise',
        isCustomPricing: true,
        stripeProductId: null,
        stripePriceIdMonthly: null,
        stripePriceIdAnnual: null,
      })

      await migration.run(db)

      expect(await readPlan(clean.id)).toEqual(clean)
    })
  })

  // ── Scope: which subscriptions are in play at all ───────────────────────────

  describe('scope', () => {
    it('unlinks a stripe row while preserving its entitlement', async () => {
      const plan = await createPlan()
      const sub = await createSub({ planId: plan.id, status: 'active' })

      await migration.run(db)

      const row = await readSub(sub.id)
      expect(row.stripeCustomerId).toBeNull()
      expect(row.stripeSubscriptionId).toBeNull()
      // Entitlement is ours, not Stripe's — none of this may move.
      expect(row.planId).toBe(plan.id)
      expect(row.plan).toBe('starter')
      expect(row.seats).toBe(3)
      expect(row.creditsBalance).toBe(4_200)
      expect(row.billingCycle).toBe(sub.billingCycle)
      expect(row.trialStart).toEqual(sub.trialStart)
      expect(row.trialEnd).toEqual(sub.trialEnd)
    })

    it('treats a NULL billingProvider as stripe', async () => {
      // null means "unlinked"; the provider registry resolves it to Stripe, so the
      // pointers it carries are legacy-account pointers like any other.
      const plan = await createPlan()
      const sub = await createSub({ planId: plan.id, billingProvider: null })

      await migration.run(db)

      const row = await readSub(sub.id)
      expect(row.stripeCustomerId).toBeNull()
      expect(row.stripeSubscriptionId).toBeNull()
      expect(row.status).toBe('canceled')
    })

    it('never touches a shopify row, even one carrying stray stripe ids', async () => {
      // The seeder can leave `stripe*` ids on Shopify rows, which is exactly why the
      // scope is `billingProvider`-explicit instead of inferred from populated columns.
      const plan = await createPlan()
      const sub = await createSub({
        planId: plan.id,
        billingProvider: 'shopify',
        shopifyShopDomain: 'acme.myshopify.com',
        status: 'trialing',
      })

      await migration.run(db)

      expect(await readSub(sub.id)).toEqual(sub)
      expect(invalidatedOrgs()).not.toContain(sub.organizationId)
    })

    it('ignores a stripe row that carries no pointers at all', async () => {
      const plan = await createPlan()
      const sub = await createSub({
        planId: plan.id,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      })

      await migration.run(db)

      expect(await readSub(sub.id)).toEqual(sub)
      expect(invalidatedOrgs()).not.toContain(sub.organizationId)
    })

    it('is in scope when only one of the two pointers is set', async () => {
      const plan = await createPlan()
      const customerOnly = await createSub({ planId: plan.id, stripeSubscriptionId: null })
      const subscriptionOnly = await createSub({ planId: plan.id, stripeCustomerId: null })

      await migration.run(db)

      expect((await readSub(customerOnly.id)).stripeCustomerId).toBeNull()
      expect((await readSub(subscriptionOnly.id)).stripeSubscriptionId).toBeNull()
      expect((await readSub(customerOnly.id)).status).toBe('canceled')
      expect((await readSub(subscriptionOnly.id)).status).toBe('canceled')
    })
  })

  // ── Termination: which of the in-scope rows get closed out ──────────────────

  describe('termination', () => {
    it.each([
      'trialing',
      'past_due',
      'incomplete',
    ] as const)('closes out a paid %s row', async (status) => {
      const plan = await createPlan()
      const sub = await createSub({ planId: plan.id, status, cancelAtPeriodEnd: true })

      await migration.run(db)

      const row = await readSub(sub.id)
      expect(row.status).toBe('canceled')
      expect(row.canceledAt).toBeInstanceOf(Date)
      expect(row.endDate).toBeInstanceOf(Date)
      expect(row.cancelAtPeriodEnd).toBe(false)
      // The three trial/cleanup jobs use `stripeSubscriptionId IS NULL` as their
      // "no subscription" proxy; both email jobs additionally gate on
      // `hasTrialEnded = false`, so this flag is what actually silences them.
      expect(row.hasTrialEnded).toBe(true)
    })

    it('nulls every scheduled* field on a row it closes out', async () => {
      const plan = await createPlan()
      const scheduledPlan = await createPlan({ name: 'Growth' })
      const sub = await createSub({
        planId: plan.id,
        status: 'past_due',
        scheduledPlanId: scheduledPlan.id,
        scheduledPlan: 'growth',
        scheduledBillingCycle: 'ANNUAL',
        scheduledSeats: 12,
        scheduledChangeAt: new Date('2026-03-01T00:00:00.000Z'),
      })

      await migration.run(db)

      const row = await readSub(sub.id)
      expect(row.scheduledPlanId).toBeNull()
      expect(row.scheduledPlan).toBeNull()
      expect(row.scheduledBillingCycle).toBeNull()
      expect(row.scheduledSeats).toBeNull()
      expect(row.scheduledChangeAt).toBeNull()
    })

    it('leaves trialConversionStatus alone rather than arming the deletion pipeline', async () => {
      // `expired-trial-account-cleanup-job` deletes the org 14 days after it sees
      // EXPIRED_WITHOUT_CONVERSION / CANCELED_DURING_TRIAL. A pointer cleanup must not
      // schedule org deletions.
      const plan = await createPlan()
      const untouched = await createSub({ planId: plan.id, status: 'trialing' })
      const preexisting = await createSub({
        planId: plan.id,
        status: 'trialing',
        trialConversionStatus: 'CONVERTED_TO_PAID',
      })

      await migration.run(db)

      expect((await readSub(untouched.id)).trialConversionStatus).toBeNull()
      expect((await readSub(preexisting.id)).trialConversionStatus).toBe('CONVERTED_TO_PAID')
    })

    it('leaves an active paid row unlinked but NOT canceled', async () => {
      // There should be none — the legacy account never took a payment — but silently
      // downgrading a payer is worse than leaving a row for a human.
      const plan = await createPlan()
      const sub = await createSub({ planId: plan.id, status: 'active' })

      await migration.run(db)

      const row = await readSub(sub.id)
      expect(row.status).toBe('active')
      expect(row.canceledAt).toBeNull()
      expect(row.endDate).toBeNull()
      expect(row.hasTrialEnded).toBe(false)
      expect(row.stripeSubscriptionId).toBeNull()
    })

    it.each([
      'unpaid',
      'incomplete_expired',
      'canceled',
    ] as const)('leaves a %s row unlinked but NOT canceled — only three statuses terminate', async (status) => {
      const plan = await createPlan()
      const sub = await createSub({ planId: plan.id, status })

      await migration.run(db)

      const row = await readSub(sub.id)
      expect(row.status).toBe(status)
      expect(row.canceledAt).toBeNull()
      expect(row.stripeCustomerId).toBeNull()
    })

    it('leaves a free-plan row unlinked but NOT canceled — read through the LEFT JOIN', async () => {
      const free = await createPlan({ name: 'Free', isFree: true, monthlyPrice: 0, annualPrice: 0 })
      // Deliberately named something the FREE_PLAN_NAMES fallback would NOT catch, so
      // this can only pass by reading `Plan.isFree` off the join.
      const sub = await createSub({ planId: free.id, plan: 'starter', status: 'trialing' })

      await migration.run(db)

      const row = await readSub(sub.id)
      expect(row.status).toBe('trialing')
      expect(row.canceledAt).toBeNull()
      expect(row.hasTrialEnded).toBe(false)
      expect(row.stripeCustomerId).toBeNull()
      expect(row.stripeSubscriptionId).toBeNull()
    })

    it.each([
      'free',
      'FREE',
      'demo',
    ])('falls back to the plan name %s when planId is null', async (planName) => {
      const sub = await createSub({ planId: null, plan: planName, status: 'trialing' })

      await migration.run(db)

      const row = await readSub(sub.id)
      expect(row.status).toBe('trialing')
      expect(row.canceledAt).toBeNull()
      expect(row.stripeCustomerId).toBeNull()
    })

    it('still closes out a planId-less row whose name is not a free-plan name', async () => {
      // The fallback must not swallow every orphaned row — only free/demo.
      const sub = await createSub({ planId: null, plan: 'starter', status: 'trialing' })

      await migration.run(db)

      expect((await readSub(sub.id)).status).toBe('canceled')
    })

    it('leaves an adminOverrideAt row unlinked but NOT canceled', async () => {
      // A super admin owns this row's lifecycle; no reconciler may write status.
      const plan = await createPlan()
      const sub = await createSub({
        planId: plan.id,
        status: 'trialing',
        adminOverrideAt: new Date('2026-01-15T00:00:00.000Z'),
        adminOverrideReason: 'comped',
      })

      await migration.run(db)

      const row = await readSub(sub.id)
      expect(row.status).toBe('trialing')
      expect(row.canceledAt).toBeNull()
      expect(row.hasTrialEnded).toBe(false)
      expect(row.adminOverrideAt).toEqual(sub.adminOverrideAt)
      expect(row.stripeCustomerId).toBeNull()
      expect(row.stripeSubscriptionId).toBeNull()
    })
  })

  // ── Cache ───────────────────────────────────────────────────────────────────

  describe('org cache', () => {
    it('invalidates subscription+features once per affected org', async () => {
      const plan = await createPlan()
      const free = await createPlan({ name: 'Free', isFree: true, monthlyPrice: 0, annualPrice: 0 })
      const terminated = await createSub({ planId: plan.id, status: 'trialing' })
      const untouched = await createSub({ planId: free.id, status: 'trialing' })
      const shopify = await createSub({ planId: plan.id, billingProvider: 'shopify' })
      const unlinkedAlready = await createSub({
        planId: plan.id,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      })

      await migration.run(db)

      // Every org whose pointers moved — including the free row that was only
      // unlinked — and nobody else.
      expect(invalidatedOrgs()).toEqual(
        [terminated.organizationId, untouched.organizationId].sort()
      )
      expect(invalidatedOrgs()).not.toContain(shopify.organizationId)
      expect(invalidatedOrgs()).not.toContain(unlinkedAlready.organizationId)
      for (const call of invalidateAndRecompute.mock.calls) {
        expect(call[1]).toEqual(['subscription', 'features'])
      }
    })

    it('invalidates nothing when there is no Stripe-linked subscription', async () => {
      await createPlan()

      await migration.run(db)

      expect(invalidateAndRecompute).not.toHaveBeenCalled()
    })
  })

  // ── Idempotency ─────────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('is a clean no-op on a second run', async () => {
      // The linked set is snapshotted BEFORE the nulling, so after one pass the
      // predicate matches nothing — no writes, no cache churn.
      const plan = await createPlan()
      const free = await createPlan({ name: 'Free', isFree: true, monthlyPrice: 0, annualPrice: 0 })
      const terminated = await createSub({ planId: plan.id, status: 'trialing' })
      const unlinkedOnly = await createSub({ planId: free.id, status: 'trialing' })
      const shopify = await createSub({ planId: plan.id, billingProvider: 'shopify' })

      await migration.run(db)
      const after = {
        plan: await readPlan(plan.id),
        terminated: await readSub(terminated.id),
        unlinkedOnly: await readSub(unlinkedOnly.id),
        shopify: await readSub(shopify.id),
      }
      const callsAfterFirst = invalidateAndRecompute.mock.calls.length
      expect(callsAfterFirst).toBe(2)

      await migration.run(db)

      // `updatedAt` carries `$onUpdate` on PlanSubscription, so an unchanged row here
      // is proof no UPDATE was issued — not merely that the values matched.
      expect(await readPlan(plan.id)).toEqual(after.plan)
      expect(await readSub(terminated.id)).toEqual(after.terminated)
      expect(await readSub(unlinkedOnly.id)).toEqual(after.unlinkedOnly)
      expect(await readSub(shopify.id)).toEqual(after.shopify)
      expect(invalidateAndRecompute.mock.calls).toHaveLength(callsAfterFirst)
    })
  })
})
