// packages/billing/src/hooks/__tests__/subscription-updated.test.ts

import type { Database } from '@auxx/database'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleSubscriptionCreated, handleSubscriptionUpdated } from '../subscription-updated'

vi.mock('@auxx/database', () => ({
  schema: {
    PlanSubscription: { id: 'id' },
    Plan: {},
  },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
}))

function makeStripeSubscription(overrides: Record<string, any> = {}): Stripe.Subscription {
  return {
    id: 'sub_stripe_1',
    status: 'active',
    items: {
      data: [
        {
          price: { id: 'price_pro_m', lookup_key: 'pro_monthly' },
          quantity: 1,
          current_period_start: 1_700_000_000,
          current_period_end: 1_700_086_400,
        },
      ],
    },
    metadata: {
      subscriptionId: 'local_sub_1',
      organizationId: 'org_1',
    },
    customer: 'cus_1',
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    ...overrides,
  } as unknown as Stripe.Subscription
}

function makeEvent(subscription: Stripe.Subscription, type = 'customer.subscription.updated') {
  return { type, data: { object: subscription } } as unknown as Stripe.Event
}

function createMockDb(
  opts: {
    plan?: any
    localSub?: any
    findFirstSub?: any
    findManySub?: any[]
    findManyOrgSub?: any[]
  } = {}
) {
  const setMock = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })
  const updateMock = vi.fn(() => ({ set: setMock }))

  // findFirst for PlanSubscription: first call returns findFirstSub (by metadata id),
  // second call returns localSub (by stripe id)
  const planSubFindFirstMock = vi.fn()
  if (opts.localSub !== undefined) {
    // If localSub is explicitly provided, first call returns it (metadata lookup)
    planSubFindFirstMock.mockResolvedValue(opts.localSub)
  } else if (opts.findFirstSub !== undefined) {
    planSubFindFirstMock.mockResolvedValue(opts.findFirstSub)
  } else {
    planSubFindFirstMock.mockResolvedValue(null)
  }

  const planSubFindManyMock = vi.fn()
  if (opts.findManySub) {
    planSubFindManyMock.mockResolvedValueOnce(opts.findManySub)
  } else {
    planSubFindManyMock.mockResolvedValueOnce([])
  }
  if (opts.findManyOrgSub) {
    planSubFindManyMock.mockResolvedValueOnce(opts.findManyOrgSub)
  } else {
    planSubFindManyMock.mockResolvedValueOnce([])
  }

  return {
    db: {
      query: {
        Plan: { findFirst: vi.fn().mockResolvedValue(opts.plan ?? null) },
        PlanSubscription: {
          findFirst: planSubFindFirstMock,
          findMany: planSubFindManyMock,
        },
      },
      update: updateMock,
    } as unknown as Database,
    setMock,
    updateMock,
    planSubFindFirstMock,
    planSubFindManyMock,
  }
}

describe('handleSubscriptionUpdated', () => {
  it('finds local subscription by metadata subscriptionId', async () => {
    const localSub = { id: 'local_sub_1', status: 'active', organizationId: 'org_1' }
    const { db, setMock } = createMockDb({ localSub, plan: null })

    await handleSubscriptionUpdated(db, makeEvent(makeStripeSubscription()))

    expect(setMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to Stripe subscription ID lookup when metadata subscriptionId is absent', async () => {
    const localSub = { id: 'local_sub_stripe', status: 'active', organizationId: 'org_1' }
    const { db, planSubFindFirstMock, setMock } = createMockDb()

    // When metadata.subscriptionId is missing, the ternary skips the first findFirst
    // and goes straight to findFirst by stripeSubscriptionId
    planSubFindFirstMock.mockReset()
    planSubFindFirstMock.mockResolvedValueOnce(localSub)

    const sub = makeStripeSubscription({ metadata: {} })
    await handleSubscriptionUpdated(db, makeEvent(sub))

    // Only 1 findFirst call (by stripe subscription ID) since metadata subscriptionId is null
    expect(planSubFindFirstMock).toHaveBeenCalledTimes(1)
    expect(setMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to customer ID lookup', async () => {
    const localSub = { id: 'local_cus', status: 'active', organizationId: 'org_1' }
    const { db, planSubFindFirstMock, setMock, planSubFindManyMock } = createMockDb()

    planSubFindFirstMock.mockReset()
    planSubFindFirstMock.mockResolvedValue(null)
    planSubFindManyMock.mockReset()
    planSubFindManyMock.mockResolvedValueOnce([localSub])

    const sub = makeStripeSubscription({ metadata: {} })
    await handleSubscriptionUpdated(db, makeEvent(sub))

    expect(setMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to organization ID lookup', async () => {
    const localSub = { id: 'local_org', status: 'incomplete', organizationId: 'org_1' }
    const { db, planSubFindFirstMock, setMock, planSubFindManyMock } = createMockDb()

    planSubFindFirstMock.mockReset()
    planSubFindFirstMock.mockResolvedValue(null)
    planSubFindManyMock.mockReset()
    // customer ID lookup returns empty
    planSubFindManyMock.mockResolvedValueOnce([])
    // org ID lookup returns localSub
    planSubFindManyMock.mockResolvedValueOnce([localSub])

    const sub = makeStripeSubscription({
      metadata: { organizationId: 'org_1' },
    })
    await handleSubscriptionUpdated(db, makeEvent(sub))

    expect(setMock).toHaveBeenCalledTimes(1)
  })

  it('handles multiple subscriptions for same customer (prefers active/trialing)', async () => {
    const activeSub = { id: 'active_sub', status: 'active', organizationId: 'org_1' }
    const canceledSub = { id: 'canceled_sub', status: 'canceled', organizationId: 'org_1' }
    const { db, planSubFindFirstMock, setMock, planSubFindManyMock } = createMockDb()

    planSubFindFirstMock.mockReset()
    planSubFindFirstMock.mockResolvedValue(null)
    planSubFindManyMock.mockReset()
    planSubFindManyMock.mockResolvedValueOnce([canceledSub, activeSub])

    const sub = makeStripeSubscription({ metadata: {} })
    await handleSubscriptionUpdated(db, makeEvent(sub))

    expect(setMock).toHaveBeenCalledTimes(1)
  })

  it('guards against wrong org when customer ID is shared and org metadata available', async () => {
    const sub1 = { id: 'sub_org_a', status: 'active', organizationId: 'org_a' }
    const sub2 = { id: 'sub_org_b', status: 'active', organizationId: 'org_b' }
    const { db, planSubFindFirstMock, setMock, planSubFindManyMock } = createMockDb()

    planSubFindFirstMock.mockReset()
    planSubFindFirstMock.mockResolvedValue(null)
    planSubFindManyMock.mockReset()
    // Multiple subs for same customer, org metadata says org_c (no match)
    planSubFindManyMock.mockResolvedValueOnce([sub1, sub2])

    const stripeSub = makeStripeSubscription({
      metadata: { organizationId: 'org_c' },
    })
    await handleSubscriptionUpdated(db, makeEvent(stripeSub))

    // Should return early without updating
    expect(setMock).not.toHaveBeenCalled()
  })

  it('returns early when no local subscription found', async () => {
    const { db, planSubFindFirstMock, setMock, planSubFindManyMock } = createMockDb()

    planSubFindFirstMock.mockReset()
    planSubFindFirstMock.mockResolvedValue(null)
    planSubFindManyMock.mockReset()
    planSubFindManyMock.mockResolvedValue([])

    const sub = makeStripeSubscription({ metadata: {} })
    await handleSubscriptionUpdated(db, makeEvent(sub))

    expect(setMock).not.toHaveBeenCalled()
  })

  it('detects trial → active transition (sets trialConversionStatus: CONVERTED_TO_PAID)', async () => {
    const localSub = { id: 'local_trial', status: 'trialing', organizationId: 'org_1' }
    const { db, setMock } = createMockDb({ localSub })

    const stripeSub = makeStripeSubscription({ status: 'active' })
    await handleSubscriptionUpdated(db, makeEvent(stripeSub))

    const payload = setMock.mock.calls[0][0]
    expect(payload.trialConversionStatus).toBe('CONVERTED_TO_PAID')
    expect(payload.hasTrialEnded).toBe(true)
    expect(payload.isEligibleForTrial).toBe(false)
  })

  it('detects trial → canceled transition (sets EXPIRED_WITHOUT_CONVERSION)', async () => {
    const localSub = { id: 'local_trial', status: 'trialing', organizationId: 'org_1' }
    const { db, setMock } = createMockDb({ localSub })

    const stripeSub = makeStripeSubscription({ status: 'canceled' })
    await handleSubscriptionUpdated(db, makeEvent(stripeSub))

    const payload = setMock.mock.calls[0][0]
    expect(payload.trialConversionStatus).toBe('EXPIRED_WITHOUT_CONVERSION')
    expect(payload.hasTrialEnded).toBe(true)
  })

  it('detects trial → past_due transition', async () => {
    const localSub = { id: 'local_trial', status: 'trialing', organizationId: 'org_1' }
    const { db, setMock } = createMockDb({ localSub })

    const stripeSub = makeStripeSubscription({ status: 'past_due' })
    await handleSubscriptionUpdated(db, makeEvent(stripeSub))

    const payload = setMock.mock.calls[0][0]
    expect(payload.trialConversionStatus).toBe('EXPIRED_WITHOUT_CONVERSION')
    expect(payload.trialEligibilityReason).toBe('Trial ended with payment failure')
  })

  it('applies scheduled plan change when due', async () => {
    const localSub = {
      id: 'local_scheduled',
      status: 'active',
      organizationId: 'org_1',
      scheduledPlanId: 'plan_enterprise',
      scheduledPlan: 'enterprise',
      scheduledBillingCycle: 'ANNUAL',
      scheduledSeats: 5,
      scheduledChangeAt: new Date(Date.now() - 1000), // in the past
    }
    const { db, setMock } = createMockDb({ localSub })

    await handleSubscriptionUpdated(db, makeEvent(makeStripeSubscription()))

    const payload = setMock.mock.calls[0][0]
    expect(payload.plan).toBe('enterprise')
    expect(payload.planId).toBe('plan_enterprise')
    expect(payload.billingCycle).toBe('ANNUAL')
    expect(payload.seats).toBe(5)
  })

  it('clears scheduled change fields after applying', async () => {
    const localSub = {
      id: 'local_scheduled',
      status: 'active',
      organizationId: 'org_1',
      scheduledPlanId: 'plan_enterprise',
      scheduledPlan: 'enterprise',
      scheduledBillingCycle: 'ANNUAL',
      scheduledSeats: 5,
      scheduledChangeAt: new Date(Date.now() - 1000),
    }
    const { db, setMock } = createMockDb({ localSub })

    await handleSubscriptionUpdated(db, makeEvent(makeStripeSubscription()))

    const payload = setMock.mock.calls[0][0]
    expect(payload.scheduledPlanId).toBeNull()
    expect(payload.scheduledPlan).toBeNull()
    expect(payload.scheduledBillingCycle).toBeNull()
    expect(payload.scheduledSeats).toBeNull()
    expect(payload.scheduledChangeAt).toBeNull()
  })

  it('updates period dates, customer ID, trial dates', async () => {
    const localSub = { id: 'local_sub_1', status: 'active', organizationId: 'org_1' }
    const { db, setMock } = createMockDb({ localSub })

    const stripeSub = makeStripeSubscription({
      trial_start: 1_700_000_000,
      trial_end: 1_700_100_000,
    })
    await handleSubscriptionUpdated(db, makeEvent(stripeSub))

    const payload = setMock.mock.calls[0][0]
    expect(payload.stripeCustomerId).toBe('cus_1')
    expect(payload.periodStart).toBeInstanceOf(Date)
    expect(payload.periodEnd).toBeInstanceOf(Date)
    expect(payload.trialStart).toBeInstanceOf(Date)
    expect(payload.trialEnd).toBeInstanceOf(Date)
  })

  it('updates plan and planId when plan is found', async () => {
    const localSub = { id: 'local_sub_1', status: 'active', organizationId: 'org_1' }
    const plan = { id: 'plan_pro', name: 'Pro' }
    const { db, setMock } = createMockDb({ localSub, plan })

    await handleSubscriptionUpdated(db, makeEvent(makeStripeSubscription()))

    const payload = setMock.mock.calls[0][0]
    expect(payload.plan).toBe('pro')
    expect(payload.planId).toBe('plan_pro')
  })
})

describe('handleSubscriptionCreated', () => {
  it('delegates to the same sync logic as updated', async () => {
    const localSub = { id: 'local_sub_1', status: 'incomplete', organizationId: 'org_1' }
    const { db, setMock } = createMockDb({ localSub })

    const stripeSub = makeStripeSubscription({ status: 'active' })
    await handleSubscriptionCreated(db, makeEvent(stripeSub, 'customer.subscription.created'))

    expect(setMock).toHaveBeenCalledTimes(1)
  })
})
