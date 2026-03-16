// packages/lib/src/providers/__tests__/channel-service-mapping.test.ts

import { describe, expect, it, vi } from 'vitest'

// Mock the logger
vi.mock('../../logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock dependencies that channel-service imports
vi.mock('../../email/errors-handlers', () => ({
  withAuthErrorHandling: vi.fn(),
}))

vi.mock('../../email/message-service', () => ({
  MessageService: {
    registerWebhooks: vi.fn(),
    unregisterWebhooks: vi.fn(),
    getAllChannels: vi.fn(),
  },
}))

vi.mock('../../messages/sync-messages', () => ({
  SyncMessages: vi.fn(),
}))

vi.mock('../google/google-oauth', () => ({
  GoogleOAuthService: { getInstance: vi.fn() },
}))

vi.mock('../outlook/outlook-oauth', () => ({
  OutlookOAuthService: { getInstance: vi.fn() },
}))

vi.mock('../facebook/facebook-oauth', () => ({
  FacebookOAuthService: { getInstance: vi.fn() },
}))

vi.mock('../instagram/instagram-oauth', () => ({
  InstagramOAuthService: { getInstance: vi.fn() },
}))

vi.mock('../openphone/openphone-service', () => ({
  OpenPhoneService: vi.fn(),
}))

vi.mock('../query-helpers', () => ({
  getEmailProviders: vi.fn(() => ['google', 'outlook']),
  whereThreadMessageType: vi.fn(),
}))

// Create a proxy-based schema mock that returns column references for any property access
const schemaHandler: ProxyHandler<any> = {
  get(_target, tableProp) {
    // Return a proxy table that returns column references for any field
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

// Recursive chainable mock for transitive module-level prepared statements (system-user-service.ts)
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

/**
 * Tests that getAllChannels() returns the expected shape with direct column fields.
 * We mock the Drizzle query chain to return a known row and verify the mapping.
 */
describe('ChannelService.getAllChannels mapping', () => {
  const mockRow = {
    id: 'int_1',
    provider: 'google',
    name: 'My Gmail',
    enabled: true,
    updatedAt: new Date('2025-01-01'),
    lastSyncedAt: new Date('2025-01-01'),
    email: 'test@example.com',
    metadata: null,
    authStatus: 'AUTHENTICATED',
    lastSuccessfulSync: new Date('2025-01-01'),
    // Direct auth columns
    requiresReauth: true,
    lastAuthError: 'invalid_grant',
    lastAuthErrorAt: new Date('2025-01-02'),
    // Sync columns
    syncStatus: 'SYNCING',
    syncStage: 'MESSAGES_IMPORT',
    syncStageStartedAt: new Date('2025-01-03'),
    // Throttle columns
    throttleFailureCount: 3,
    throttleRetryAfter: new Date('2025-01-04'),
    // Joined fields
    chatWidget: null,
    inboxId: 'inbox_1',
  }

  function buildMockDb(rows: any[]) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    }
    return chain as any
  }

  it('returns syncStatus, syncStage, syncStageStartedAt from database columns', async () => {
    const { ChannelService } = await import('../channel-service')
    const db = buildMockDb([mockRow])
    const svc = new ChannelService(db, 'org_1')
    const result = await svc.getAllChannels()
    const int = result.channels[0]

    expect(int.syncStatus).toBe('SYNCING')
    expect(int.syncStage).toBe('MESSAGES_IMPORT')
    expect(int.syncStageStartedAt).toEqual(new Date('2025-01-03'))
  })

  it('returns requiresReauth from direct column, not metadata', async () => {
    const { ChannelService } = await import('../channel-service')
    const db = buildMockDb([mockRow])
    const svc = new ChannelService(db, 'org_1')
    const result = await svc.getAllChannels()
    const int = result.channels[0]

    expect(int.requiresReauth).toBe(true)
  })

  it('returns lastAuthError from direct column, not metadata', async () => {
    const { ChannelService } = await import('../channel-service')
    const db = buildMockDb([mockRow])
    const svc = new ChannelService(db, 'org_1')
    const result = await svc.getAllChannels()
    const int = result.channels[0]

    expect(int.lastAuthError).toBe('invalid_grant')
    expect(int.lastAuthErrorAt).toEqual(new Date('2025-01-02'))
  })

  it('returns throttleRetryAfter from database column', async () => {
    const { ChannelService } = await import('../channel-service')
    const db = buildMockDb([mockRow])
    const svc = new ChannelService(db, 'org_1')
    const result = await svc.getAllChannels()
    const int = result.channels[0]

    expect(int.throttleFailureCount).toBe(3)
    expect(int.throttleRetryAfter).toEqual(new Date('2025-01-04'))
  })
})
