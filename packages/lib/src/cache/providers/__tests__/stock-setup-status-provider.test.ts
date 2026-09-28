// packages/lib/src/cache/providers/__tests__/stock-setup-status-provider.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  readStockSetupStatus: vi.fn(),
  orgInvalidations: [] as Array<{ orgId: string; keys: string[] }>,
}))

vi.mock('../../../inventory/receiving/stock-setup-status', () => ({
  readStockSetupStatus: h.readStockSetupStatus,
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
import { ORG_CACHE_KEY_CONFIG } from '../../org-cache-keys'
import { stockSetupStatusProvider } from '../stock-setup-status-provider'

const ORG = 'org_1'
const db = { tag: 'provider-db' } as unknown as Database

beforeEach(() => {
  h.readStockSetupStatus.mockReset()
  h.orgInvalidations.length = 0
})

describe('stockSetupStatusProvider', () => {
  it('loads the status through the provider db', async () => {
    const status = { kindConflictCount: 0 }
    h.readStockSetupStatus.mockResolvedValue(ok(status))
    expect(await stockSetupStatusProvider.compute(ORG, db)).toEqual(status)
    expect(h.readStockSetupStatus).toHaveBeenCalledWith(db, ORG)
  })

  it('throws on a failed read so nothing is cached', async () => {
    h.readStockSetupStatus.mockResolvedValue(err(new Error('boom')))
    await expect(stockSetupStatusProvider.compute(ORG, db)).rejects.toThrow('boom')
  })

  it('is lazy with a short TTL', () => {
    expect(ORG_CACHE_KEY_CONFIG.stockSetupStatus.lazy).toBe(true)
    expect(ORG_CACHE_KEY_CONFIG.stockSetupStatus.ttlSeconds).toBeLessThanOrEqual(600)
  })
})

describe('stock-setup.changed', () => {
  it('invalidates exactly the stockSetupStatus key for the org', async () => {
    await onCacheEvent('stock-setup.changed', { orgId: ORG })
    expect(h.orgInvalidations).toEqual([{ orgId: ORG, keys: ['stockSetupStatus'] }])
  })
})
