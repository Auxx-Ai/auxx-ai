// packages/billing/src/services/__tests__/admin-billing-service.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { PlanChangeHandler } from '../../types'
import { AdminBillingService } from '../admin-billing-service'

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
}

const PLANS = [
  { id: 'plan_free', name: 'Free', isLegacy: false },
  { id: 'plan_growth', name: 'Growth', isLegacy: false },
]

/** Captures the `.set()` payload of the single subscription UPDATE the service issues. */
function createMockDb() {
  const setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  return {
    db: {
      query: {
        PlanSubscription: { findFirst: vi.fn().mockResolvedValue(TRIAL_SUBSCRIPTION) },
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
})
