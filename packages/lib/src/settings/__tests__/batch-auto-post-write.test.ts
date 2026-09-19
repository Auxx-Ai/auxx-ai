// packages/lib/src/settings/__tests__/batch-auto-post-write.test.ts
//
// The Posting page's save bar writes through `batchUpdateOrganizationSettings`,
// and the vendor bill's Auto-post switch is the one key TWO policies declare
// (`vendor_bill` and `vendor_credit`, 71 U7 decision 2) - so it reached this
// door twice in one batch. What is pinned: the row lands with the value the
// switch sent, a duplicated key is idempotent rather than fatal, and the
// `orgSettings` cache is busted after the write, since `readAutoPostMode` reads
// it through that cache.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { batchUpdateOrganizationSettings } from '../settings-service'

const ORG = 'org_1'
const KEY = 'accounting.autoPost.expenseBill'

const h = vi.hoisted(() => ({
  onCacheEvent: vi.fn(async () => {}),
  /** Every row handed to the upsert, in order. */
  upserts: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../accounting/ledger/post/accounting-commit-lock', () => ({
  withAccountingCommitLock: async () => {},
}))
vi.mock('../../cache/invalidate', () => ({ onCacheEvent: h.onCacheEvent }))

function chain(rows: unknown[]) {
  const promise = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>
  promise.where = () => promise
  promise.limit = () => promise
  return promise
}

const db = {
  execute: async () => [],
  select: () => ({ from: () => chain([]) }),
  insert: () => ({
    values: (row: Record<string, unknown>) => {
      h.upserts.push(row)
      return { onConflictDoUpdate: () => Promise.resolve([]) }
    },
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.upserts = []
})

describe('batchUpdateOrganizationSettings and the vendor bill auto-post switch', () => {
  it('writes the key the poster reads, org-scoped, with the switch value', async () => {
    await batchUpdateOrganizationSettings({
      organizationId: ORG,
      settings: [{ key: KEY, value: true }],
      db,
    })

    expect(h.upserts).toHaveLength(1)
    expect(h.upserts[0]).toMatchObject({ organizationId: ORG, key: KEY, value: true })
  })

  it('takes the same key twice without refusing the batch', async () => {
    await batchUpdateOrganizationSettings({
      organizationId: ORG,
      settings: [
        { key: KEY, value: true },
        { key: KEY, value: true },
      ],
      db,
    })

    expect(h.upserts.map((row) => row.value)).toEqual([true, true])
  })

  it('busts the org settings cache the mode is read through', async () => {
    await batchUpdateOrganizationSettings({
      organizationId: ORG,
      settings: [{ key: KEY, value: true }],
      db,
    })

    expect(h.onCacheEvent).toHaveBeenCalledWith('org.settings.changed', {
      orgId: ORG,
      broadcastUserKeys: true,
    })
  })
})
