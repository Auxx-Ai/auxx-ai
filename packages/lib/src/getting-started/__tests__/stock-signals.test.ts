// packages/lib/src/getting-started/__tests__/stock-signals.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ get: h.get }),
  getAllCachedCustomFields: vi.fn(),
  getCachedAgents: vi.fn(),
  getCachedEntityDefId: vi.fn(),
  getCachedMembers: vi.fn(),
}))

import { getAutoInferredGoals } from '../signals'

const ctx = { organizationId: 'org_1' }

function status(steps: { kinds: boolean; builds: boolean; count: boolean }) {
  return { hasStockedMovements: true, steps }
}

beforeEach(() => {
  h.get.mockReset()
})

describe('stock checklist signals', () => {
  it('read the cached stock setup status, never the loader', async () => {
    h.get.mockResolvedValue(status({ kinds: true, builds: false, count: true }))
    const goals = await getAutoInferredGoals(ctx, 'stock')
    expect(goals.sort()).toEqual(['check-part-kinds', 'count-and-cost'])
    expect(
      h.get.mock.calls.every(([org, key]) => org === 'org_1' && key === 'stockSetupStatus')
    ).toBe(true)
  })

  it('read nothing as done when the status cannot be computed', async () => {
    h.get.mockRejectedValue(new Error('boom'))
    expect(await getAutoInferredGoals(ctx, 'stock')).toEqual([])
  })
})
