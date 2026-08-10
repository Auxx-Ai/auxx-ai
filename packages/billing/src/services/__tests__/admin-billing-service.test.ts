// packages/billing/src/services/__tests__/admin-billing-service.test.ts

import type { Database } from '@auxx/database'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { PlanChangeHandler } from '../../types'
import { AdminBillingService } from '../admin-billing-service'
import { stripeClient } from '../stripe-client'

vi.mock('@auxx/database', () => ({
  schema: { PlanSubscription: { id: 'id' } },
  AuditLog: 'AuditLog',
  toAuditRow: (row: unknown) => row,
}))

vi.mock('drizzle-orm', () => ({ eq: (a: unknown, b: unknown) => ({ a, b }) }))

const TRIAL_SUBSCRIPTION = {
  id: 'sub_1',
  status: 'trialing',
  plan: 'Free',
  planId: 'plan_free',
  trialConversionStatus: null,
  billingProvider: 'stripe',
  stripeSubscriptionId: null as string | null,
  trialEnd: null as Date | null,
  hasTrialEnded: false,
  adminOverrideAt: null as Date | null,
  adminOverrideReason: null as string | null,
}

const PLANS = [
  { id: 'plan_free', name: 'Free', isLegacy: false },
  { id: 'plan_growth', name: 'Growth', isLegacy: false },
]

const DAY_MS = 24 * 60 * 60 * 1000

/** Captures the `.set()` payload of the single subscription UPDATE the service issues. */
function createMockDb(subscriptionOverrides: Partial<typeof TRIAL_SUBSCRIPTION> = {}) {
  const setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  return {
    db: {
      query: {
        PlanSubscription: {
          findFirst: vi.fn().mockResolvedValue({ ...TRIAL_SUBSCRIPTION, ...subscriptionOverrides }),
        },
        Plan: { findMany: vi.fn().mockResolvedValue(PLANS) },
      },
      update: vi.fn().mockReturnValue({ set: setSpy }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    } as unknown as Database,
    setSpy,
  }
}

describe('AdminBillingService.convertTrialToPaid', () => {
  let onPlanChange: Mock<PlanChangeHandler>

  beforeEach(() => {
    onPlanChange = vi.fn<PlanChangeHandler>().mockResolvedValue(undefined)
  })

  it('keeps the current plan when no planName is given', async () => {
    const { db, setSpy } = createMockDb()
    const service = new AdminBillingService(db, 'https://app.test', onPlanChange)

    await service.convertTrialToPaid({
      organizationId: 'org_1',
      skipPayment: true,
      adminUserId: 'admin_1',
    })

    const update = setSpy.mock.calls[0]![0]
    expect(update.status).toBe('active')
    expect(update.trialConversionStatus).toBe('CONVERTED_TO_PAID')
    expect(update).not.toHaveProperty('planId')
    expect(update).not.toHaveProperty('plan')
    expect(onPlanChange).not.toHaveBeenCalled()
  })

  it('moves the org onto the requested plan in the same write', async () => {
    const { db, setSpy } = createMockDb()
    const service = new AdminBillingService(db, 'https://app.test', onPlanChange)

    await service.convertTrialToPaid({
      organizationId: 'org_1',
      planName: 'Growth',
      skipPayment: true,
      adminUserId: 'admin_1',
    })

    const update = setSpy.mock.calls[0]![0]
    expect(update.status).toBe('active')
    expect(update.planId).toBe('plan_growth')
    expect(update.plan).toBe('Growth')
    expect(onPlanChange).toHaveBeenCalledWith(expect.anything(), 'org_1', 'plan_growth')
  })

  it('matches plan names case-insensitively — `getPlans()` lowercases them', async () => {
    const { db, setSpy } = createMockDb()
    const service = new AdminBillingService(db, 'https://app.test', onPlanChange)

    await service.convertTrialToPaid({
      organizationId: 'org_1',
      planName: 'growth',
      skipPayment: true,
      adminUserId: 'admin_1',
    })

    expect(setSpy.mock.calls[0]![0].planId).toBe('plan_growth')
  })

  it('throws before writing anything when the plan name is unknown', async () => {
    const { db, setSpy } = createMockDb()
    const service = new AdminBillingService(db, 'https://app.test', onPlanChange)

    await expect(
      service.convertTrialToPaid({
        organizationId: 'org_1',
        planName: 'Platinum',
        skipPayment: true,
        adminUserId: 'admin_1',
      })
    ).rejects.toThrow('Plan Platinum not found')

    expect(setSpy).not.toHaveBeenCalled()
  })

  it('claims the admin override so the Stripe webhook cannot revert the comp', async () => {
    const { db, setSpy } = createMockDb()
    const service = new AdminBillingService(db, 'https://app.test', onPlanChange)

    await service.convertTrialToPaid({
      organizationId: 'org_1',
      skipPayment: true,
      adminUserId: 'admin_1',
    })

    expect(setSpy.mock.calls[0]![0].adminOverrideAt).toBeInstanceOf(Date)
  })
})

describe('AdminBillingService.extendTrial', () => {
  const subscriptionsUpdate = vi.fn().mockResolvedValue({})

  beforeEach(() => {
    subscriptionsUpdate.mockClear()
    vi.mocked(stripeClient.getClient).mockReturnValue({
      subscriptions: { update: subscriptionsUpdate },
    } as unknown as Stripe)
  })

  it('rejects an extension under 48 hours WITHOUT writing to the database', async () => {
    const { db, setSpy } = createMockDb({ stripeSubscriptionId: 'sub_stripe_1' })
    const service = new AdminBillingService(db, 'https://app.test')

    await expect(
      service.extendTrial({
        organizationId: 'org_1',
        newEndDate: new Date(Date.now() + DAY_MS),
        adminUserId: 'admin_1',
      })
    ).rejects.toThrow(/48 hours/)

    // The whole point of the reorder: a Stripe rejection must not leave the local row extended.
    expect(setSpy).not.toHaveBeenCalled()
    expect(subscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('calls Stripe BEFORE writing the database', async () => {
    const { db, setSpy } = createMockDb({ stripeSubscriptionId: 'sub_stripe_1' })
    const service = new AdminBillingService(db, 'https://app.test')

    await service.extendTrial({
      organizationId: 'org_1',
      newEndDate: new Date(Date.now() + 7 * DAY_MS),
      adminUserId: 'admin_1',
    })

    expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_stripe_1', {
      trial_end: expect.any(Number),
    })
    expect(subscriptionsUpdate.mock.invocationCallOrder[0]!).toBeLessThan(
      setSpy.mock.invocationCallOrder[0]!
    )
  })

  it('skips Stripe entirely for a local-only subscription', async () => {
    const { db, setSpy } = createMockDb({ stripeSubscriptionId: null })
    const service = new AdminBillingService(db, 'https://app.test')

    // Under 48h is fine here — nothing reconciles a row with no Stripe subscription.
    await service.extendTrial({
      organizationId: 'org_1',
      newEndDate: new Date(Date.now() + DAY_MS),
      adminUserId: 'admin_1',
    })

    expect(subscriptionsUpdate).not.toHaveBeenCalled()
    expect(setSpy.mock.calls[0]![0].hasTrialEnded).toBe(false)
  })
})

describe('AdminBillingService — Shopify guard', () => {
  const shopify = { billingProvider: 'shopify' as const }

  it('refuses to extend a Shopify trial', async () => {
    const { db, setSpy } = createMockDb(shopify)
    const service = new AdminBillingService(db, 'https://app.test')

    await expect(
      service.extendTrial({
        organizationId: 'org_1',
        newEndDate: new Date(Date.now() + 7 * DAY_MS),
        adminUserId: 'admin_1',
      })
    ).rejects.toThrow(/Shopify owns the trial/)
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('refuses to end a Shopify trial', async () => {
    const { db, setSpy } = createMockDb(shopify)
    const service = new AdminBillingService(db, 'https://app.test')

    await expect(
      service.endTrialImmediately({ organizationId: 'org_1', adminUserId: 'admin_1' })
    ).rejects.toThrow(/Shopify owns the trial/)
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('refuses to convert a Shopify trial', async () => {
    const { db, setSpy } = createMockDb(shopify)
    const service = new AdminBillingService(db, 'https://app.test')

    await expect(
      service.convertTrialToPaid({
        organizationId: 'org_1',
        skipPayment: true,
        adminUserId: 'admin_1',
      })
    ).rejects.toThrow(/Shopify owns the trial/)
    expect(setSpy).not.toHaveBeenCalled()
  })
})

describe('AdminBillingService — admin override lifecycle', () => {
  it('endTrialImmediately claims the override so Stripe cannot restore access', async () => {
    const { db, setSpy } = createMockDb()
    const service = new AdminBillingService(db, 'https://app.test')

    await service.endTrialImmediately({
      organizationId: 'org_1',
      adminUserId: 'admin_1',
      reason: 'Abuse investigation',
    })

    const update = setSpy.mock.calls[0]![0]
    expect(update.hasTrialEnded).toBe(true)
    expect(update.adminOverrideAt).toBeInstanceOf(Date)
    expect(update.adminOverrideReason).toBe('Abuse investigation')
  })

  it('forceStatusChange claims the override', async () => {
    const { db, setSpy } = createMockDb()
    const service = new AdminBillingService(db, 'https://app.test')

    await service.forceStatusChange({
      organizationId: 'org_1',
      newStatus: 'active',
      reason: 'Manual recovery after a failed webhook',
      adminUserId: 'admin_1',
    })

    const update = setSpy.mock.calls[0]![0]
    expect(update.status).toBe('active')
    expect(update.adminOverrideAt).toBeInstanceOf(Date)
  })

  it('clearAdminOverride hands control back to the provider', async () => {
    const { db, setSpy } = createMockDb({ adminOverrideAt: new Date() })
    const service = new AdminBillingService(db, 'https://app.test')

    await service.clearAdminOverride({ organizationId: 'org_1', adminUserId: 'admin_1' })

    const update = setSpy.mock.calls[0]![0]
    expect(update.adminOverrideAt).toBeNull()
    expect(update.adminOverrideReason).toBeNull()
  })
})
