// packages/lib/src/cache/providers/__tests__/subpart-edges-provider.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadOrgSubpartEdges: vi.fn(),
  orgInvalidations: [] as Array<{ orgId: string; keys: string[] }>,
}))

vi.mock('../../../inventory/costing/cost-calculator', () => ({
  loadOrgSubpartEdges: h.loadOrgSubpartEdges,
}))

vi.mock('../../singletons', () => ({
  getOrgCache: () => ({
    invalidateAndRecompute: async (orgId: string, keys: string[]) => {
      h.orgInvalidations.push({ orgId, keys: [...keys] })
    },
  }),
  getUserCache: () => ({}),
  getBuildUserCache: () => ({}),
  getAppCache: () => ({}),
}))

import type { Database } from '@auxx/database'
import { onCacheEvent } from '../../invalidate'
import { subpartEdgesProvider } from '../subpart-edges-provider'

const ORG = 'org_1'

beforeEach(() => {
  h.loadOrgSubpartEdges.mockReset()
  h.orgInvalidations.length = 0
})

describe('subpartEdgesProvider', () => {
  it("loads the org's edges through the provider's own db", async () => {
    const edges = [{ parentPartId: 'p1', childPartId: 'c1', quantity: 2 }]
    h.loadOrgSubpartEdges.mockResolvedValue(edges)
    const db = { tag: 'provider-db' } as unknown as Database

    expect(await subpartEdgesProvider.compute(ORG, db)).toEqual(edges)
    expect(h.loadOrgSubpartEdges).toHaveBeenCalledWith(db, ORG)
  })
})

describe('subpart.changed', () => {
  it('invalidates exactly the subpartEdges key for the org', async () => {
    await onCacheEvent('subpart.changed', { orgId: ORG })
    expect(h.orgInvalidations).toEqual([{ orgId: ORG, keys: ['subpartEdges'] }])
  })
})
