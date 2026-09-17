// packages/lib/src/settings/__tests__/update-setting-invalidation.test.ts
//
// `updateOrganizationSetting` owns its own `orgSettings` bust — one door, so no
// caller has to remember. The two facts worth pinning:
//
// 🛑 The event must fire AFTER the write commits. Fired inside an open
// transaction, a concurrent reader repopulates the cache from the pre-commit
// state and the commit then lands with no further event coming — strictly worse
// than not firing at all. Hence: the accounting keys, which re-enter through
// `db.transaction(...)`, invalidate in the OUTER frame, and a caller-supplied
// `PgTransaction` (whose commit we cannot observe) invalidates not at all.
//
// 🛑 `broadcastUserKeys: true` by default. The browser's settings store hydrates
// from the per-user `userSettings` cache, which the `org.settings.changed` edge
// reaches only when the event broadcasts to user keys.

import { PgTransaction } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateOrganizationSetting } from '../settings-service'

const ORG = 'org_1'
const PLAIN_KEY = 'inventory.autoBuildStockRule'
const ACCOUNTING_KEY = 'accounting.providerSyncedThrough'

const h = vi.hoisted(() => ({
  onCacheEvent: vi.fn(async () => {}),
  /** Interleaving of transaction commits and cache events, in order. */
  log: [] as string[],
}))

vi.mock('../../postings/accounting-commit-lock', () => ({
  withAccountingCommitLock: async () => {},
}))

vi.mock('../../cache/invalidate', () => ({
  onCacheEvent: (...args: unknown[]) => {
    h.log.push('invalidate')
    return h.onCacheEvent(...(args as []))
  },
}))

function chain(rows: unknown[]) {
  const promise = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>
  promise.where = () => promise
  promise.limit = () => promise
  return promise
}

const writes = {
  execute: async () => [],
  select: () => ({ from: () => chain([]) }),
  insert: () => ({
    values: () => ({ onConflictDoUpdate: () => Promise.resolve([]) }),
  }),
}

const db = {
  ...writes,
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const result = await fn(db)
    h.log.push('commit')
    return result
  },
} as never

/** A real `PgTransaction` instance — `instanceof` is the discriminator under test. */
const callerTx = Object.assign(Object.create(PgTransaction.prototype), writes) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.log = []
})

describe('updateOrganizationSetting — cache invalidation', () => {
  it('fires exactly one event, broadcasting to user keys, on a plain write', async () => {
    await updateOrganizationSetting({
      organizationId: ORG,
      key: PLAIN_KEY,
      value: 'all_stock_levels',
      db,
    })

    expect(h.onCacheEvent).toHaveBeenCalledTimes(1)
    expect(h.onCacheEvent).toHaveBeenCalledWith('org.settings.changed', {
      orgId: ORG,
      broadcastUserKeys: true,
    })
  })

  it('🛑 fires ONCE for an accounting key, and only after the transaction resolved', async () => {
    await updateOrganizationSetting({
      organizationId: ORG,
      key: ACCOUNTING_KEY,
      value: '2026-11-30',
      db,
    })

    // The inner (transactional) frame must not fire; the outer one must, after commit.
    expect(h.onCacheEvent).toHaveBeenCalledTimes(1)
    expect(h.log).toEqual(['commit', 'invalidate'])
  })

  it('🛑 fires NOTHING when the caller supplied its own transaction', async () => {
    await updateOrganizationSetting({
      organizationId: ORG,
      key: PLAIN_KEY,
      value: 'all_stock_levels',
      db: callerTx,
    })

    expect(h.onCacheEvent).not.toHaveBeenCalled()
  })

  it('fires nothing for an accounting key inside a caller-supplied transaction either', async () => {
    await updateOrganizationSetting({
      organizationId: ORG,
      key: ACCOUNTING_KEY,
      value: '2026-11-30',
      db: callerTx,
    })

    expect(h.onCacheEvent).not.toHaveBeenCalled()
  })

  it('fires nothing when the caller opted out', async () => {
    await updateOrganizationSetting({
      organizationId: ORG,
      key: PLAIN_KEY,
      value: 'all_stock_levels',
      db,
      skipCacheInvalidation: true,
    })

    expect(h.onCacheEvent).not.toHaveBeenCalled()
    expect(h.log).toEqual([])
  })
})
