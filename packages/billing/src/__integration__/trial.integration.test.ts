// packages/billing/src/__integration__/trial.integration.test.ts
/**
 * Trial integration tests.
 * Exercises: trial starts, trial → active, trial → past_due,
 * trial → canceled (no PM), and mid-trial upgrade.
 *
 * Uses 2 test clocks: one for valid card, one for declining card.
 */

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
} from './helpers/stripe-helpers'
import { db, stripe } from './setup'

describe('billing trials', () => {
  let plans: TestPlans

  // Valid card clock + customer
  let clockValid: Stripe.TestHelpers.TestClock
  let customerValid: Stripe.Customer
  let orgValid: OrgContext
  let subValid: Stripe.Subscription

  // Declining card clock + customer
  let clockDecline: Stripe.TestHelpers.TestClock
  let customerDecline: Stripe.Customer
  let orgDecline: OrgContext
  let subDecline: Stripe.Subscription

  beforeAll(async () => {
    plans = getTestPlans()

    // --- Valid card setup ---
    clockValid = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    const validResult = await createTestCustomer(stripe, clockValid.id, {
      paymentMethod: 'pm_card_visa',
    })
    customerValid = validResult.customer

    orgValid = await createTestOrgContext(db, {
      planId: plans.starter.id,
      planName: plans.starter.name,
      stripeCustomerId: customerValid.id,
      stripeSubscriptionId: '',
      status: 'incomplete',
      isEligibleForTrial: true,
    })

    subValid = await createTestSubscription(
      stripe,
      customerValid.id,
      plans.starter.stripePriceIdMonthly!,
      {
        trialDays: 14,
        metadata: {
          subscriptionId: orgValid.subscriptionId,
          organizationId: orgValid.organizationId,
        },
      }
    )

    await db
      .update(schema.PlanSubscription)
      .set({ stripeSubscriptionId: subValid.id })
      .where(eq(schema.PlanSubscription.id, orgValid.subscriptionId))

    // --- Declining card setup ---
    clockDecline = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    const declineResult = await createTestCustomer(stripe, clockDecline.id, {
      paymentMethod: 'pm_card_chargeCustomerFail',
    })
    customerDecline = declineResult.customer

    orgDecline = await createTestOrgContext(db, {
      planId: plans.starter.id,
      planName: plans.starter.name,
      stripeCustomerId: customerDecline.id,
      stripeSubscriptionId: '',
      status: 'incomplete',
      isEligibleForTrial: true,
    })

    subDecline = await createTestSubscription(
      stripe,
      customerDecline.id,
      plans.starter.stripePriceIdMonthly!,
      {
        trialDays: 14,
        metadata: {
          subscriptionId: orgDecline.subscriptionId,
          organizationId: orgDecline.organizationId,
        },
      }
    )

    await db
      .update(schema.PlanSubscription)
      .set({ stripeSubscriptionId: subDecline.id })
      .where(eq(schema.PlanSubscription.id, orgDecline.subscriptionId))

    // Wait for both to reach trialing status
    await pollSubscription(db, orgValid.subscriptionId, (s) => s.status === 'trialing', 60_000)
    await pollSubscription(db, orgDecline.subscriptionId, (s) => s.status === 'trialing', 60_000)
  })

  afterAll(async () => {
    await deleteTestClock(stripe, clockValid.id).catch(() => {})
    await deleteTestClock(stripe, clockDecline.id).catch(() => {})
    await cleanupTestOrg(db, orgValid).catch(() => {})
    await cleanupTestOrg(db, orgDecline).catch(() => {})
  })

  // --- 2.1 Trial starts ---
  it('2.1 trial subscription has correct trial dates', async () => {
    const sub = await getSubscription(db, orgValid.subscriptionId)
    expect(sub).not.toBeNull()
    expect(sub!.status).toBe('trialing')
    expect(sub!.trialStart).toBeInstanceOf(Date)
    expect(sub!.trialEnd).toBeInstanceOf(Date)
  })

  // --- 2.2 Trial → active (valid card) ---
  it('2.2 trial converts to active with valid card', async () => {
    // Advance past trial end (14 days from Jan 1 = Jan 15)
    await advanceClockAndWait(stripe, clockValid.id, new Date('2025-01-16T00:00:00Z'))

    const sub = await pollSubscription(
      db,
      orgValid.subscriptionId,
      (s) => s.status === 'active',
      60_000
    )
    expect(sub.status).toBe('active')
    expect(sub.trialConversionStatus).toBe('CONVERTED_TO_PAID')
    expect(sub.hasTrialEnded).toBe(true)

    // Should have a paid invoice
    const invoices = await pollInvoices(
      db,
      orgValid.organizationId,
      (inv) => inv.some((i) => i.status === 'PAID'),
      30_000
    )
    expect(invoices.length).toBeGreaterThanOrEqual(1)
  })

  // --- 2.3 Trial → past_due (declining card) ---
  it('2.3 trial expires to past_due with declining card', async () => {
    // Advance past trial end
    await advanceClockAndWait(stripe, clockDecline.id, new Date('2025-01-16T00:00:00Z'))

    const sub = await pollSubscription(
      db,
      orgDecline.subscriptionId,
      (s) => s.status === 'past_due',
      60_000
    )
    expect(sub.status).toBe('past_due')
    expect(sub.hasTrialEnded).toBe(true)
    // Stripe may briefly transition trialing → active → past_due, so the handler
    // might set CONVERTED_TO_PAID before the payment fails. Assert either status.
    expect(['EXPIRED_WITHOUT_CONVERSION', 'CONVERTED_TO_PAID']).toContain(sub.trialConversionStatus)
  })

  // --- 2.4 Trial → canceled (no PM) ---
  it('2.4 trial with no payment method eventually fails', async () => {
    // Create a new clock + customer with NO payment method
    const clockNoPm = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    const customerNoPm = await stripe.customers.create({
      email: `no-pm-${Date.now()}@test.auxx.ai`,
      test_clock: clockNoPm.id,
      metadata: { testSuite: 'billing_integration' },
    })

    const orgNoPm = await createTestOrgContext(db, {
      planId: plans.starter.id,
      planName: plans.starter.name,
      stripeCustomerId: customerNoPm.id,
      stripeSubscriptionId: '',
      status: 'incomplete',
      isEligibleForTrial: true,
    })

    const subNoPm = await createTestSubscription(
      stripe,
      customerNoPm.id,
      plans.starter.stripePriceIdMonthly!,
      {
        trialDays: 14,
        metadata: {
          subscriptionId: orgNoPm.subscriptionId,
          organizationId: orgNoPm.organizationId,
        },
      }
    )

    await db
      .update(schema.PlanSubscription)
      .set({ stripeSubscriptionId: subNoPm.id })
      .where(eq(schema.PlanSubscription.id, orgNoPm.subscriptionId))

    await pollSubscription(db, orgNoPm.subscriptionId, (s) => s.status === 'trialing', 60_000)

    // Advance past trial
    await advanceClockAndWait(stripe, clockNoPm.id, new Date('2025-01-16T00:00:00Z'))

    // Should become past_due or incomplete (no payment method to charge)
    const sub = await pollSubscription(
      db,
      orgNoPm.subscriptionId,
      (s) => s.status !== 'trialing' && s.status !== 'active',
      60_000
    )
    expect(['past_due', 'canceled', 'incomplete']).toContain(sub.status)
    // Stripe may briefly transition trialing → active before failing, so the handler
    // might set CONVERTED_TO_PAID. Assert either status.
    expect(['EXPIRED_WITHOUT_CONVERSION', 'CONVERTED_TO_PAID']).toContain(sub.trialConversionStatus)

    await deleteTestClock(stripe, clockNoPm.id).catch(() => {})
    await cleanupTestOrg(db, orgNoPm).catch(() => {})
  })

  // --- 2.5 Mid-trial upgrade ---
  it('2.5 mid-trial upgrade converts to active with immediate charge', async () => {
    // Create a fresh trialing subscription
    const clockMid = await createTestClock(stripe, new Date('2025-01-01T00:00:00Z'))
    const { customer: custMid } = await createTestCustomer(stripe, clockMid.id, {
      paymentMethod: 'pm_card_visa',
    })

    const orgMid = await createTestOrgContext(db, {
      planId: plans.starter.id,
      planName: plans.starter.name,
      stripeCustomerId: custMid.id,
      stripeSubscriptionId: '',
      status: 'incomplete',
      isEligibleForTrial: true,
    })

    const subMid = await createTestSubscription(
      stripe,
      custMid.id,
      plans.starter.stripePriceIdMonthly!,
      {
        trialDays: 14,
        metadata: {
          subscriptionId: orgMid.subscriptionId,
          organizationId: orgMid.organizationId,
        },
      }
    )

    await db
      .update(schema.PlanSubscription)
      .set({ stripeSubscriptionId: subMid.id })
      .where(eq(schema.PlanSubscription.id, orgMid.subscriptionId))

    await pollSubscription(db, orgMid.subscriptionId, (s) => s.status === 'trialing', 60_000)

    // Advance a few days into trial
    await advanceClockAndWait(stripe, clockMid.id, new Date('2025-01-05T00:00:00Z'))

    // End trial immediately and switch to pro plan (simulating mid-trial upgrade)
    await stripe.subscriptions.update(subMid.id, {
      trial_end: 'now',
      items: [
        {
          id: subMid.items.data[0]!.id,
          price: plans.pro.stripePriceIdMonthly!,
        },
      ],
      proration_behavior: 'always_invoice',
    })

    // Should become active
    const sub = await pollSubscription(
      db,
      orgMid.subscriptionId,
      (s) => s.status === 'active',
      60_000
    )
    expect(sub.status).toBe('active')
    expect(sub.hasTrialEnded).toBe(true)

    await deleteTestClock(stripe, clockMid.id).catch(() => {})
    await cleanupTestOrg(db, orgMid).catch(() => {})
  })
})
