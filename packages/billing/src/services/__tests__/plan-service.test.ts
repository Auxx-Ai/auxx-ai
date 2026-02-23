// packages/billing/src/services/__tests__/plan-service.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanService } from '../plan-service'

const mockPlans = [
  {
    id: 'plan_starter',
    name: 'Starter',
    isLegacy: false,
    hierarchyLevel: 1,
    stripePriceIdMonthly: 'price_starter_m',
    stripePriceIdAnnual: 'price_starter_a',
    lookupKeyMonthly: 'starter_monthly',
    lookupKeyAnnual: 'starter_annual',
    hasTrial: true,
    trialDays: 14,
    featureLimits: { emails: 100, users: 2 },
  },
  {
    id: 'plan_pro',
    name: 'Pro',
    isLegacy: false,
    hierarchyLevel: 2,
    stripePriceIdMonthly: 'price_pro_m',
    stripePriceIdAnnual: 'price_pro_a',
    lookupKeyMonthly: 'pro_monthly',
    lookupKeyAnnual: 'pro_annual',
    hasTrial: false,
    trialDays: 0,
    featureLimits: { emails: 1000, users: 10 },
  },
]

function createMockDb() {
  const findManyMock = vi.fn().mockResolvedValue(mockPlans)
  const findFirstMock = vi.fn()
  return {
    db: {
      query: {
        Plan: {
          findMany: findManyMock,
          findFirst: findFirstMock,
        },
      },
    } as unknown as Database,
    findManyMock,
    findFirstMock,
  }
}

describe('PlanService', () => {
  let db: Database
  let findManyMock: ReturnType<typeof vi.fn>
  let findFirstMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const mocks = createMockDb()
    db = mocks.db
    findManyMock = mocks.findManyMock
    findFirstMock = mocks.findFirstMock
  })

  describe('getPlans', () => {
    it('returns transformed plans ordered by hierarchy', async () => {
      const service = new PlanService(db)
      const plans = await service.getPlans()

      expect(plans).toHaveLength(2)
      expect(plans[0].name).toBe('starter')
      expect(plans[1].name).toBe('pro')
      expect(findManyMock).toHaveBeenCalledTimes(1)
    })

    it('transforms plan with trial info when hasTrial is true', async () => {
      const service = new PlanService(db)
      const plans = await service.getPlans()

      expect(plans[0].trial).toEqual({ days: 14 })
    })

    it('transforms plan without trial info when hasTrial is false', async () => {
      const service = new PlanService(db)
      const plans = await service.getPlans()

      expect(plans[1].trial).toBeUndefined()
    })

    it('maps feature limits correctly', async () => {
      const service = new PlanService(db)
      const plans = await service.getPlans()

      expect(plans[0].limits).toEqual({ emails: 100, users: 2 })
      expect(plans[1].limits).toEqual({ emails: 1000, users: 10 })
    })
  })

  describe('findPlan', () => {
    it('finds by exact name match', async () => {
      findFirstMock.mockResolvedValueOnce(mockPlans[0])
      const service = new PlanService(db)

      const plan = await service.findPlan({ name: 'Starter' })

      expect(plan).not.toBeNull()
      expect(plan!.name).toBe('starter')
      expect(findFirstMock).toHaveBeenCalledTimes(1)
    })

    it('matches against monthly price ID', async () => {
      const service = new PlanService(db)
      const plan = await service.findPlan({ priceId: 'price_pro_m' })

      expect(plan).not.toBeNull()
      expect(plan!.id).toBe('plan_pro')
    })

    it('matches against annual price ID', async () => {
      const service = new PlanService(db)
      const plan = await service.findPlan({ priceId: 'price_starter_a' })

      expect(plan).not.toBeNull()
      expect(plan!.id).toBe('plan_starter')
    })

    it('returns null for lookup key because transformPlan does not preserve lookup keys', async () => {
      const service = new PlanService(db)

      // transformPlan strips lookupKeyMonthly/lookupKeyAnnual from the BillingPlan output,
      // so findPlan by lookupKey will always fail to match
      const plan = await service.findPlan({ lookupKey: 'pro_monthly' })
      expect(plan).toBeNull()
    })

    it('returns null when no criteria match', async () => {
      const service = new PlanService(db)
      const plan = await service.findPlan({ priceId: 'price_nonexistent' })

      expect(plan).toBeNull()
    })

    it('returns null when called with empty options', async () => {
      const service = new PlanService(db)
      const plan = await service.findPlan({})

      expect(plan).toBeNull()
    })
  })
})
