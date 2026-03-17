// packages/billing/src/__integration__/lifecycle.integration.test.ts
/**
 * Subscription lifecycle integration tests.
 * Exercises: new subscription → active, renewal, cancel at period end,
 * restore, cancel takes effect, and immediate cancellation.
 *
 * Uses 1 test clock, 1 customer, 1 org context (scenarios 1.1–1.5).
 * Scenario 1.6 uses a separate org + subscription for immediate cancel.
 */

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupTestOrg,
  createTestOrgContext,
  getInvoices,
  getSubscription,
  getTestPlans,
  type OrgContext,
  type TestPlans,
} from './helpers/db-helpers'
import { pollInvoices, pollSubscription } from './helpers/poll-helpers'
import {
  advanceClockAndWait,
  createTestClock,
  createTestCustomer,
  createTestSubscription,
  deleteTestClock,
} from './helpers/stripe-helpers'
import { db, stripe } from './setup'

describe('billing lifecycle', () => {
  let clock: Stripe.TestHelpers.TestClock
  let stripeCustomer: Stripe.Customer
  let paymentMethodId: string
  let orgContext: OrgContext
  let stripeSubscription: Stripe.Subscription
  let plans: TestPlans

  beforeAll(async () => {
    plans = getTestPlans()

    // 1. Create Stripe test clock
    clock = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))

    // 2. Create Stripe customer with test payment method
    const result = await createTestCustomer(stripe, clock.id, { paymentMethod: 'pm_card_visa' })
    stripeCustomer = result.customer
    paymentMethodId = result.paymentMethodId

    // 3. Seed DB: User → Organization → Member → PlanSubscription
    orgContext = await createTestOrgContext(db, {
      planId: plans.starter.id,
      planName: plans.starter.name,
      stripeCustomerId: stripeCustomer.id,
      stripeSubscriptionId: '', // set after Stripe sub creation
      status: 'incomplete',
    })

    // 4. Create Stripe subscription with metadata linking to DB records
    stripeSubscription = await createTestSubscription(
      stripe,
      stripeCustomer.id,
      plans.starter.stripePriceIdMonthly!,
      {
        metadata: {
          subscriptionId: orgContext.subscriptionId,
          organizationId: orgContext.organizationId,
        },
      }
    )

    // 5. Update DB with Stripe subscription ID
    await db
      .update(schema.PlanSubscription)
      .set({ stripeSubscriptionId: stripeSubscription.id })
      .where(eq(schema.PlanSubscription.id, orgContext.subscriptionId))

    // 6. Wait for webhook to activate subscription
    await pollSubscription(db, orgContext.subscriptionId, (s) => s.status === 'active', 60_000)
  })

  afterAll(async () => {
    await deleteTestClock(stripe, clock.id).catch(() => {})
    await cleanupTestOrg(db, orgContext).catch(() => {})
  })

  // --- 1.1 New subscription → active ---
  it('1.1 subscription is active with correct Stripe IDs', async () => {
    const sub = await getSubscription(db, orgContext.subscriptionId)
    expect(sub).not.toBeNull()
    expect(sub!.status).toBe('active')
    expect(sub!.stripeSubscriptionId).toBe(stripeSubscription.id)
    expect(sub!.stripeCustomerId).toBe(stripeCustomer.id)
    expect(sub!.periodStart).toBeInstanceOf(Date)
    expect(sub!.periodEnd).toBeInstanceOf(Date)
  })

  // --- 1.2 Renewal ---
  it('1.2 renews after 1 month', async () => {
    const periodEndBefore = (await getSubscription(db, orgContext.subscriptionId))!.periodEnd!

    await advanceClockAndWait(stripe, clock.id, new Date('2025-02-01T00:00:00Z'))

    // Wait for invoice to appear
    const invoices = await pollInvoices(
      db,
      orgContext.organizationId,
      (inv) => inv.some((i) => i.status === 'PAID'),
      60_000
    )
    expect(invoices.length).toBeGreaterThanOrEqual(1)

    // Verify period advanced
    const sub = await pollSubscription(
      db,
      orgContext.subscriptionId,
      (s) => s.periodEnd !== null && s.periodEnd > periodEndBefore,
      30_000
    )
    expect(sub.periodEnd!.getTime()).toBeGreaterThan(periodEndBefore.getTime())
  })

  // --- 1.3 Cancel at period end ---
  it('1.3 cancel at period end marks cancelAtPeriodEnd but stays active', async () => {
    await stripe.subscriptions.update(stripeSubscription.id, {
      cancel_at_period_end: true,
    })

    const sub = await pollSubscription(
      db,
      orgContext.subscriptionId,
      (s) => s.cancelAtPeriodEnd === true,
      30_000
    )
    expect(sub.status).toBe('active')
    expect(sub.cancelAtPeriodEnd).toBe(true)
  })

  // --- 1.4 Restore before period end ---
  it('1.4 restore removes cancelAtPeriodEnd', async () => {
    await stripe.subscriptions.update(stripeSubscription.id, {
      cancel_at_period_end: false,
    })

    const sub = await pollSubscription(
      db,
      orgContext.subscriptionId,
      (s) => s.cancelAtPeriodEnd === false,
      30_000
    )
    expect(sub.status).toBe('active')
    expect(sub.cancelAtPeriodEnd).toBe(false)
  })

  // --- 1.5 Cancel takes effect after period end ---
  it('1.5 cancel takes effect after advancing past period end', async () => {
    // Re-cancel
    await stripe.subscriptions.update(stripeSubscription.id, {
      cancel_at_period_end: true,
    })

    await pollSubscription(
      db,
      orgContext.subscriptionId,
      (s) => s.cancelAtPeriodEnd === true,
      30_000
    )

    // Advance past period end (already at Feb 1, advance to Mar 2)
    await advanceClockAndWait(stripe, clock.id, new Date('2025-03-02T00:00:00Z'))

    const sub = await pollSubscription(
      db,
      orgContext.subscriptionId,
      (s) => s.status === 'canceled',
      60_000
    )
    expect(sub.status).toBe('canceled')
  })

  // --- 1.6 Immediate cancellation ---
  it('1.6 immediate cancellation sets status to canceled', async () => {
    // Create a separate org + subscription for this test
    const clock2 = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    const { customer: cust2 } = await createTestCustomer(stripe, clock2.id)
    const orgCtx2 = await createTestOrgContext(db, {
      planId: plans.starter.id,
      planName: plans.starter.name,
      stripeCustomerId: cust2.id,
      stripeSubscriptionId: '',
      status: 'incomplete',
    })

    const sub2 = await createTestSubscription(
      stripe,
      cust2.id,
      plans.starter.stripePriceIdMonthly!,
      {
        metadata: {
          subscriptionId: orgCtx2.subscriptionId,
          organizationId: orgCtx2.organizationId,
        },
      }
    )

    await db
      .update(schema.PlanSubscription)
      .set({ stripeSubscriptionId: sub2.id })
      .where(eq(schema.PlanSubscription.id, orgCtx2.subscriptionId))

    // Wait for active
    await pollSubscription(db, orgCtx2.subscriptionId, (s) => s.status === 'active', 60_000)

    // Immediately cancel
    await stripe.subscriptions.cancel(sub2.id)

    const canceled = await pollSubscription(
      db,
      orgCtx2.subscriptionId,
      (s) => s.status === 'canceled',
      30_000
    )
    expect(canceled.status).toBe('canceled')

    // Cleanup
    await deleteTestClock(stripe, clock2.id).catch(() => {})
    await cleanupTestOrg(db, orgCtx2).catch(() => {})
  })
})
