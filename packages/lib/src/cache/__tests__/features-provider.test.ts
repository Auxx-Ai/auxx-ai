// packages/lib/src/cache/__tests__/features-provider.test.ts
// The features map is derived from PlanSubscription.status. A status the provider does
// not recognize yields an EMPTY map, which every caller reads as "feature disabled" —
// so status matching must not be case-sensitive (admin overrides have written uppercase
// rows), and an ended trial must resolve to no features.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isSelfHosted: vi.fn(() => false),
  appGetOrRecompute: vi.fn(),
  orgGetOrRecompute: vi.fn(),
}))

vi.mock('@auxx/deployment', () => ({ isSelfHosted: h.isSelfHosted }))
vi.mock('../singletons', () => ({
  getAppCache: () => ({ getOrRecompute: h.appGetOrRecompute }),
  getOrgCache: () => ({ getOrRecompute: h.orgGetOrRecompute }),
}))

import { featuresProvider } from '../providers/features-provider'

const PLAN = {
  id: 'plan_growth',
  name: 'Growth',
  isFree: false,
  featureLimits: [
    { key: 'mail', limit: '+' },
    { key: 'workflows', limit: 5 },
  ],
  trialFeatureLimits: [{ key: 'mail', limit: 1 }],
}

function fakeDb(subscription: Record<string, unknown> | undefined) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(subscription ? [subscription] : []) }),
      }),
    }),
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isSelfHosted.mockReturnValue(false)
  h.appGetOrRecompute.mockResolvedValue({ planMap: { plan_growth: PLAN } })
  h.orgGetOrRecompute.mockResolvedValue({ orgProfile: { demoExpiresAt: null } })
})

describe('featuresProvider.compute — status resolution', () => {
  it('resolves full plan limits for an active subscription', async () => {
    const features = await featuresProvider.compute(
      'org_1',
      fakeDb({
        status: 'active',
        hasTrialEnded: true,
        planId: 'plan_growth',
        customFeatureLimits: null,
      })
    )
    expect(features).toMatchObject({ mail: '+', workflows: 5 })
  })

  // Regression: the admin "Force Status Change" select used to offer an uppercase
  // ACTIVE row. Storing it cleared the expired screen but matched neither branch here,
  // leaving the org silently featureless.
  it('resolves the same limits for a legacy uppercase status', async () => {
    const features = await featuresProvider.compute(
      'org_1',
      fakeDb({
        status: 'ACTIVE',
        hasTrialEnded: true,
        planId: 'plan_growth',
        customFeatureLimits: null,
      })
    )
    expect(features).toMatchObject({ mail: '+', workflows: 5 })
  })

  it('resolves trial limits while the trial is running', async () => {
    const features = await featuresProvider.compute(
      'org_1',
      fakeDb({
        status: 'TRIALING',
        hasTrialEnded: false,
        planId: 'plan_growth',
        customFeatureLimits: null,
      })
    )
    // Exact, not toMatchObject: the point of the trial branch is that `workflows` is
    // ABSENT, and a partial match cannot assert absence. `FeatureMapObject` is nullable,
    // so dereferencing `features.workflows` to check that does not typecheck either.
    expect(features).toEqual({ mail: 1 })
  })

  it('resolves no features for an ended trial that never left trialing', async () => {
    const features = await featuresProvider.compute(
      'org_1',
      fakeDb({
        status: 'trialing',
        hasTrialEnded: true,
        planId: 'plan_growth',
        customFeatureLimits: null,
      })
    )
    expect(features).toEqual({})
  })
})
