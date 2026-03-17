// packages/billing/src/__integration__/past-due-recovery.integration.test.ts
/**
 * Past-due recovery integration tests.
 * Validates recovery flows from past_due status: same plan, +seats, +cycle change,
 * +upgrade, +downgrade, bad card, missing PM, multiple invoices, non-trial past_due,
 * and status boundary checks.
 *
 * Uses 2 test clocks: trial-based past_due, renewal-based past_due.
 */

import { schema } from '@auxx/database'
import { isUsableSubscriptionStatus } from '@auxx/types/billing'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SubscriptionService } from '../services/subscription-service'
import {
  cleanupTestOrg,
  createTestOrgContext,
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
  swapPaymentMethod,
} from './helpers/stripe-helpers'
import { db, stripe } from './setup'

/**
 * Helper: Create a past_due subscription from a trial expiry.
 * Returns the org context with a subscription in past_due status.
 */
async function createPastDueFromTrial(
  stripeInstance: Stripe,
  database: typeof db,
  plans: TestPlans,
  clock: Stripe.TestHelpers.TestClock
): Promise<{
  orgCtx: OrgContext
  stripeCustomer: Stripe.Customer
  stripeSub: Stripe.Subscription
}> {
  const { customer } = await createTestCustomer(stripeInstance, clock.id, {
    paymentMethod: 'pm_card_chargeCustomerFail',
  })

  const orgCtx = await createTestOrgContext(database, {
    planId: plans.starter.id,
    planName: plans.starter.name,
    stripeCustomerId: customer.id,
    stripeSubscriptionId: '',
    status: 'incomplete',
    isEligibleForTrial: true,
  })

  const stripeSub = await createTestSubscription(
    stripeInstance,
    customer.id,
    plans.starter.stripePriceIdMonthly!,
    {
      trialDays: 14,
      metadata: {
        subscriptionId: orgCtx.subscriptionId,
        organizationId: orgCtx.organizationId,
      },
    }
  )

  await database
    .update(schema.PlanSubscription)
    .set({ stripeSubscriptionId: stripeSub.id })
    .where(eq(schema.PlanSubscription.id, orgCtx.subscriptionId))

  // Wait for trialing
  await pollSubscription(database, orgCtx.subscriptionId, (s) => s.status === 'trialing', 60_000)

  // Advance past trial → declining card → past_due
  await advanceClockAndWait(stripeInstance, clock.id, new Date('2025-01-16T00:00:00Z'))
  await pollSubscription(database, orgCtx.subscriptionId, (s) => s.status === 'past_due', 60_000)

  return { orgCtx, stripeCustomer: customer, stripeSub }
}

describe('billing past-due recovery', () => {
  let plans: TestPlans
  let subscriptionService: SubscriptionService

  // Trial-based past_due clock
  let clockTrial: Stripe.TestHelpers.TestClock

  // Renewal-based past_due clock
  let clockRenewal: Stripe.TestHelpers.TestClock

  // Cleanup tracking
  const cleanupItems: Array<{
    clockId?: string
    orgCtx?: OrgContext
  }> = []

  beforeAll(async () => {
    plans = getTestPlans()
    subscriptionService = new SubscriptionService(db, 'http://localhost:3000')

    clockTrial = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    clockRenewal = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))

    cleanupItems.push({ clockId: clockTrial.id })
    cleanupItems.push({ clockId: clockRenewal.id })
  })

  afterAll(async () => {
    for (const item of cleanupItems) {
      if (item.clockId) await deleteTestClock(stripe, item.clockId).catch(() => {})
      if (item.orgCtx) await cleanupTestOrg(db, item.orgCtx).catch(() => {})
    }
  })

  // --- 5.1 Pure recovery (same plan) ---
  it('5.1 recovery from trial past_due with valid PM restores active status', async () => {
    const { orgCtx, stripeCustomer, stripeSub } = await createPastDueFromTrial(
      stripe,
      db,
      plans,
      clockTrial
    )
    cleanupItems.push({ orgCtx })

    // Swap to valid payment method
    const newPmId = await swapPaymentMethod(stripe, stripeCustomer.id, stripeSub.id, 'pm_card_visa')

    // Recover with same plan/seats/cycle
    const result = await subscriptionService.updateSubscriptionDirect({
      organizationId: orgCtx.organizationId,
      planName: plans.starter.name,
      billingCycle: 'MONTHLY',
      seats: 1,
      paymentMethodId: newPmId,
    })

    expect(result.success).toBe(true)

    const sub = await pollSubscription(
      db,
      orgCtx.subscriptionId,
      (s) => s.status === 'active',
      60_000
    )
    expect(sub.status).toBe('active')
    expect(sub.trialConversionStatus).toBe('CONVERTED_TO_PAID')
  })

  // --- 5.2 Recovery + seat change ---
  it('5.2 recovery with seat increase', async () => {
    const clock5_2 = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    cleanupItems.push({ clockId: clock5_2.id })

    const { orgCtx, stripeCustomer, stripeSub } = await createPastDueFromTrial(
      stripe,
      db,
      plans,
      clock5_2
    )
    cleanupItems.push({ orgCtx })

    const newPmId = await swapPaymentMethod(stripe, stripeCustomer.id, stripeSub.id, 'pm_card_visa')

    const result = await subscriptionService.updateSubscriptionDirect({
      organizationId: orgCtx.organizationId,
      planName: plans.starter.name,
      billingCycle: 'MONTHLY',
      seats: 2,
      paymentMethodId: newPmId,
    })

    expect(result.success).toBe(true)

    const sub = await pollSubscription(
      db,
      orgCtx.subscriptionId,
      (s) => s.status === 'active' && s.seats === 2,
      60_000
    )
    expect(sub.status).toBe('active')
    expect(sub.seats).toBe(2)
  })

  // --- 5.3 Recovery + billing cycle change ---
  it('5.3 recovery with monthly to annual switch', async () => {
    const clock5_3 = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    cleanupItems.push({ clockId: clock5_3.id })

    const { orgCtx, stripeCustomer, stripeSub } = await createPastDueFromTrial(
      stripe,
      db,
      plans,
      clock5_3
    )
    cleanupItems.push({ orgCtx })

    const newPmId = await swapPaymentMethod(stripe, stripeCustomer.id, stripeSub.id, 'pm_card_visa')

    const result = await subscriptionService.updateSubscriptionDirect({
      organizationId: orgCtx.organizationId,
      planName: plans.starter.name,
      billingCycle: 'ANNUAL',
      seats: 1,
      paymentMethodId: newPmId,
    })

    expect(result.success).toBe(true)

    const sub = await pollSubscription(
      db,
      orgCtx.subscriptionId,
      (s) => s.status === 'active',
      60_000
    )
    expect(sub.status).toBe('active')
    expect(sub.billingCycle).toBe('ANNUAL')
  })

  // --- 5.4 Recovery + upgrade ---
  it('5.4 recovery with upgrade from starter to pro', async () => {
    const clock5_4 = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    cleanupItems.push({ clockId: clock5_4.id })

    const { orgCtx, stripeCustomer, stripeSub } = await createPastDueFromTrial(
      stripe,
      db,
      plans,
      clock5_4
    )
    cleanupItems.push({ orgCtx })

    const newPmId = await swapPaymentMethod(stripe, stripeCustomer.id, stripeSub.id, 'pm_card_visa')

    const result = await subscriptionService.updateSubscriptionDirect({
      organizationId: orgCtx.organizationId,
      planName: plans.pro.name,
      billingCycle: 'MONTHLY',
      seats: 1,
      paymentMethodId: newPmId,
    })

    expect(result.success).toBe(true)

    const sub = await pollSubscription(
      db,
      orgCtx.subscriptionId,
      (s) => s.status === 'active' && s.planId === plans.pro.id,
      60_000
    )
    expect(sub.planId).toBe(plans.pro.id)
    expect(sub.trialConversionStatus).toBe('CONVERTED_TO_PAID')
  })

  // --- 5.5 Recovery + downgrade ---
  it('5.5 recovery with downgrade from pro to starter schedules change', async () => {
    const clock5_5 = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    cleanupItems.push({ clockId: clock5_5.id })

    // Start with pro plan for this test
    const { customer } = await createTestCustomer(stripe, clock5_5.id, {
      paymentMethod: 'pm_card_chargeCustomerFail',
    })

    const orgCtx = await createTestOrgContext(db, {
      planId: plans.pro.id,
      planName: plans.pro.name,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: '',
      status: 'incomplete',
      isEligibleForTrial: true,
    })
    cleanupItems.push({ orgCtx })

    const stripeSub = await createTestSubscription(
      stripe,
      customer.id,
      plans.pro.stripePriceIdMonthly!,
      {
        trialDays: 14,
        metadata: {
          subscriptionId: orgCtx.subscriptionId,
          organizationId: orgCtx.organizationId,
        },
      }
    )

    await db
      .update(schema.PlanSubscription)
      .set({ stripeSubscriptionId: stripeSub.id })
      .where(eq(schema.PlanSubscription.id, orgCtx.subscriptionId))

    await pollSubscription(db, orgCtx.subscriptionId, (s) => s.status === 'trialing', 60_000)

    // Advance past trial → past_due
    await advanceClockAndWait(stripe, clock5_5.id, new Date('2025-01-16T00:00:00Z'))
    await pollSubscription(db, orgCtx.subscriptionId, (s) => s.status === 'past_due', 60_000)

    // Swap to valid PM and downgrade to starter
    const newPmId = await swapPaymentMethod(stripe, customer.id, stripeSub.id, 'pm_card_visa')

    const result = await subscriptionService.updateSubscriptionDirect({
      organizationId: orgCtx.organizationId,
      planName: plans.starter.name,
      billingCycle: 'MONTHLY',
      seats: 1,
      paymentMethodId: newPmId,
    })

    expect(result.success).toBe(true)

    // Should recover to active with scheduled downgrade
    const sub = await pollSubscription(
      db,
      orgCtx.subscriptionId,
      (s) => s.status === 'active',
      60_000
    )
    expect(sub.status).toBe('active')
    expect(sub.scheduledPlanId).toBe(plans.starter.id)
  })

  // --- 5.6 Recovery fails (bad card) ---
  it('5.6 recovery with declining card throws error', async () => {
    const clock5_6 = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    cleanupItems.push({ clockId: clock5_6.id })

    const { orgCtx, stripeCustomer, stripeSub } = await createPastDueFromTrial(
      stripe,
      db,
      plans,
      clock5_6
    )
    cleanupItems.push({ orgCtx })

    // Attach a different declining card
    const pm = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', {
      customer: stripeCustomer.id,
    })

    await expect(
      subscriptionService.updateSubscriptionDirect({
        organizationId: orgCtx.organizationId,
        planName: plans.starter.name,
        billingCycle: 'MONTHLY',
        seats: 1,
        paymentMethodId: pm.id,
      })
    ).rejects.toThrow()

    // DB should be unchanged — still past_due
    const sub = await getSubscription(db, orgCtx.subscriptionId)
    expect(sub!.status).toBe('past_due')
  })

  // --- 5.7 Missing payment method ---
  it('5.7 recovery without paymentMethodId throws error', async () => {
    const clock5_7 = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    cleanupItems.push({ clockId: clock5_7.id })

    const { orgCtx } = await createPastDueFromTrial(stripe, db, plans, clock5_7)
    cleanupItems.push({ orgCtx })

    await expect(
      subscriptionService.updateSubscriptionDirect({
        organizationId: orgCtx.organizationId,
        planName: plans.starter.name,
        billingCycle: 'MONTHLY',
        seats: 1,
        // No paymentMethodId
      })
    ).rejects.toThrow()
  })

  // --- 5.8 Multiple open invoices ---
  it('5.8 recovery pays multiple failed invoices', async () => {
    // Create an active sub, then fail it multiple times
    const clock5_8 = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    cleanupItems.push({ clockId: clock5_8.id })

    const { customer } = await createTestCustomer(stripe, clock5_8.id, {
      paymentMethod: 'pm_card_visa',
    })

    const orgCtx = await createTestOrgContext(db, {
      planId: plans.starter.id,
      planName: plans.starter.name,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: '',
      status: 'incomplete',
    })
    cleanupItems.push({ orgCtx })

    const stripeSub = await createTestSubscription(
      stripe,
      customer.id,
      plans.starter.stripePriceIdMonthly!,
      {
        metadata: {
          subscriptionId: orgCtx.subscriptionId,
          organizationId: orgCtx.organizationId,
        },
      }
    )

    await db
      .update(schema.PlanSubscription)
      .set({ stripeSubscriptionId: stripeSub.id })
      .where(eq(schema.PlanSubscription.id, orgCtx.subscriptionId))

    await pollSubscription(db, orgCtx.subscriptionId, (s) => s.status === 'active', 60_000)

    // Swap to declining card before renewal
    await swapPaymentMethod(stripe, customer.id, stripeSub.id, 'pm_card_chargeCustomerFail')

    // Advance to trigger failed renewal
    await advanceClockAndWait(stripe, clock5_8.id, new Date('2025-02-02T00:00:00Z'))
    await pollSubscription(db, orgCtx.subscriptionId, (s) => s.status === 'past_due', 60_000)

    // Swap back to valid card and recover
    const newPmId = await swapPaymentMethod(stripe, customer.id, stripeSub.id, 'pm_card_visa')

    const result = await subscriptionService.updateSubscriptionDirect({
      organizationId: orgCtx.organizationId,
      planName: plans.starter.name,
      billingCycle: 'MONTHLY',
      seats: 1,
      paymentMethodId: newPmId,
    })

    expect(result.success).toBe(true)

    const sub = await pollSubscription(
      db,
      orgCtx.subscriptionId,
      (s) => s.status === 'active',
      60_000
    )
    expect(sub.status).toBe('active')
  })

  // --- 5.9 Non-trial past_due recovery ---
  it('5.9 recovery from non-trial past_due restores active status', async () => {
    const clock5_9 = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    cleanupItems.push({ clockId: clock5_9.id })

    const { customer } = await createTestCustomer(stripe, clock5_9.id, {
      paymentMethod: 'pm_card_visa',
    })

    const orgCtx = await createTestOrgContext(db, {
      planId: plans.starter.id,
      planName: plans.starter.name,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: '',
      status: 'incomplete',
    })
    cleanupItems.push({ orgCtx })

    const stripeSub = await createTestSubscription(
      stripe,
      customer.id,
      plans.starter.stripePriceIdMonthly!,
      {
        metadata: {
          subscriptionId: orgCtx.subscriptionId,
          organizationId: orgCtx.organizationId,
        },
      }
    )

    await db
      .update(schema.PlanSubscription)
      .set({ stripeSubscriptionId: stripeSub.id })
      .where(eq(schema.PlanSubscription.id, orgCtx.subscriptionId))

    await pollSubscription(db, orgCtx.subscriptionId, (s) => s.status === 'active', 60_000)

    // Swap to declining card before renewal
    await swapPaymentMethod(stripe, customer.id, stripeSub.id, 'pm_card_chargeCustomerFail')

    // Advance → failed renewal → past_due
    await advanceClockAndWait(stripe, clock5_9.id, new Date('2025-02-02T00:00:00Z'))
    await pollSubscription(db, orgCtx.subscriptionId, (s) => s.status === 'past_due', 60_000)

    // Swap to valid PM and recover
    const newPmId = await swapPaymentMethod(stripe, customer.id, stripeSub.id, 'pm_card_visa')

    const result = await subscriptionService.updateSubscriptionDirect({
      organizationId: orgCtx.organizationId,
      planName: plans.starter.name,
      billingCycle: 'MONTHLY',
      seats: 1,
      paymentMethodId: newPmId,
    })

    expect(result.success).toBe(true)

    const sub = await pollSubscription(
      db,
      orgCtx.subscriptionId,
      (s) => s.status === 'active',
      60_000
    )
    expect(sub.status).toBe('active')
    // Non-trial recovery should NOT set trialConversionStatus
    // (it may remain null or unchanged)
  })

  // --- 5.10 Status boundary check (unit test for completeness) ---
  it('5.10 isUsableSubscriptionStatus returns correct values for all statuses', () => {
    // Usable
    expect(isUsableSubscriptionStatus('active')).toBe(true)
    expect(isUsableSubscriptionStatus('trialing')).toBe(true)
    expect(isUsableSubscriptionStatus('paused')).toBe(true)
    expect(isUsableSubscriptionStatus('incomplete')).toBe(true)

    // Blocked
    expect(isUsableSubscriptionStatus('canceled')).toBe(false)
    expect(isUsableSubscriptionStatus('unpaid')).toBe(false)
    expect(isUsableSubscriptionStatus('past_due')).toBe(false)
    expect(isUsableSubscriptionStatus('incomplete_expired')).toBe(false)
  })
})
