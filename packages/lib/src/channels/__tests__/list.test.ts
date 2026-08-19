// packages/lib/src/channels/__tests__/list.test.ts

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../email/polling-import-cache', () => ({
  getImportCacheSize: vi.fn().mockResolvedValue(0),
}))

const schemaHandler: ProxyHandler<any> = {
  get(_target, _tableProp) {
    return new Proxy(
      {},
      {
        get(_t, colProp) {
          return colProp
        },
      }
    )
  },
}
const mockSchema = new Proxy({}, schemaHandler)

function createChain(): any {
  const fn = (..._args: any[]) => createChain()
  return new Proxy(fn, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined
      return createChain()
    },
  })
}

vi.mock('@auxx/database', () => ({
  database: createChain(),
  schema: mockSchema,
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  count: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  sql: vi.fn(),
}))

const cachedChannel = {
  id: 'int_1',
  provider: 'google',
  displayName: 'My Gmail',
  name: 'My Gmail',
  email: 'test@example.com',
  metadata: null,
  settings: {},
  enabled: true,
  updatedAt: new Date('2025-01-01'),
  lastSyncedAt: new Date('2025-01-01'),
  lastSuccessfulSync: new Date('2025-01-01'),
  requiresReauth: true,
  lastAuthError: 'invalid_grant',
  lastAuthErrorAt: new Date('2025-01-02'),
  inboxId: 'inbox_1',
  chatWidget: null,
  isExample: false,
}

const liveRow = {
  id: 'int_1',
  syncStatus: 'SYNCING',
  syncStage: 'MESSAGES_IMPORT',
  syncStageStartedAt: new Date('2025-01-03'),
  throttleFailureCount: 3,
  throttleRetryAfter: new Date('2025-01-04'),
}

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    get: vi.fn().mockResolvedValue([cachedChannel]),
  }),
}))

/**
 * Tests that `list()` merges cached metadata with live sync state from the DB.
 */
describe('channels.list cache + live merge', () => {
  function buildMockDb(rows: any[]) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(rows),
    }
    return chain as any
  }

  it('merges live syncStatus, syncStage, syncStageStartedAt onto cached metadata', async () => {
    const { list } = await import('../list')
    const db = buildMockDb([liveRow])
    const result = await list({ db, organizationId: 'org_1' })
    const int = result.channels[0]

    expect(int!.syncStatus).toBe('SYNCING')
    expect(int!.syncStage).toBe('MESSAGES_IMPORT')
    expect(int!.syncStageStartedAt).toEqual(new Date('2025-01-03'))
  })

  it('returns requiresReauth + lastAuthError from cached metadata', async () => {
    const { list } = await import('../list')
    const db = buildMockDb([liveRow])
    const result = await list({ db, organizationId: 'org_1' })
    const int = result.channels[0]

    expect(int!.requiresReauth).toBe(true)
    expect(int!.lastAuthError).toBe('invalid_grant')
    expect(int!.lastAuthErrorAt).toEqual(new Date('2025-01-02'))
  })

  it('returns throttle counters from live row', async () => {
    const { list } = await import('../list')
    const db = buildMockDb([liveRow])
    const result = await list({ db, organizationId: 'org_1' })
    const int = result.channels[0]

    expect(int!.throttleFailureCount).toBe(3)
    expect(int!.throttleRetryAfter).toEqual(new Date('2025-01-04'))
  })

  /**
   * The database — not the cache — decides which channels exist.
   *
   * The row set starts as the org cache's `channels` entry, so before this rule a channel stayed
   * listed for exactly as long as the cache said it existed: a disconnect whose invalidation
   * failed, or lost a race with a concurrent recompute, kept rendering a channel that was gone.
   * The live query already asks for these ids with `deletedAt IS NULL`, so the answer was there
   * the whole time and was only being used for sync columns.
   *
   * This used to assert the opposite — that a cached channel with no live row is still returned,
   * with nullish sync state. That was a test of the `??` defaults rather than a decision about
   * deleted channels, and the defaults are covered below on a row that does exist.
   */
  it('drops a cached channel the database no longer confirms — a disconnect cannot linger', async () => {
    const { list } = await import('../list')
    const db = buildMockDb([])
    const result = await list({ db, organizationId: 'org_1' })

    expect(result.channels).toHaveLength(0)
  })

  it('still defaults nullish sync columns on a channel that has never synced', async () => {
    const { list } = await import('../list')
    const db = buildMockDb([
      {
        id: 'int_1',
        syncStatus: null,
        syncStage: null,
        syncStageStartedAt: null,
        throttleFailureCount: null,
        throttleRetryAfter: null,
      },
    ])
    const result = await list({ db, organizationId: 'org_1' })
    const int = result.channels[0]

    expect(int!.syncStatus).toBeNull()
    expect(int!.throttleFailureCount).toBe(0)
  })
})
