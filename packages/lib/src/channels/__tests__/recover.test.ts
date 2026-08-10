// packages/lib/src/channels/__tests__/recover.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `recoverChannel` — what a successful reconnect has to undo.
 *
 * The bug this pins: `AuthErrorHandler` flips `Integration.enabled` to false
 * after `DISABLE_THRESHOLD` reauth-class failures, and the counter behind that
 * flip (`metadata.auth.consecutiveFailures`) is only ever cleared by a
 * SUCCESSFUL SYNC — which a disabled channel can never run. Reconnecting used
 * to reset the sync breaker only, so the user was told the reconnect worked and
 * every sync still returned "Cannot sync messages for disabled channel".
 *
 * So the two assertions that matter are (1) a disabled channel comes back on,
 * through `toggle` rather than a bare column write, because that is what
 * re-arms the provider webhook a long-dark channel has certainly lost, and
 * (2) the auth block is gone from the metadata write — leaving it would let the
 * next single auth blip disable the channel again on its first strike.
 */

const { fixture, toggle, clearCredentialReauth, clearImportCache, onCacheEvent } = vi.hoisted(
  () => ({
    fixture: {
      channel: {} as Record<string, unknown>,
      update: null as Record<string, unknown> | null,
    },
    toggle: vi.fn(async () => ({ ok: true, value: { success: true, message: 'ok' } })),
    clearCredentialReauth: vi.fn(async () => {}),
    clearImportCache: vi.fn(async () => {}),
    onCacheEvent: vi.fn(async () => {}),
  })
)

vi.mock('../../logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../../cache', () => ({ onCacheEvent }))
vi.mock('../../email/polling-import-cache', () => ({ clearImportCache }))
vi.mock('../../providers/credential-auth-state', () => ({ clearCredentialReauth }))
vi.mock('../toggle', () => ({ toggle }))
vi.mock('../internal/validate', () => ({
  validateChannelOwnership: async () => ({ ok: true, value: fixture.channel }),
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@auxx/database', async () => ({
  schema: (await import('../../test/database-mock')).createSchemaMock(),
}))

const { recoverChannel } = await import('../recover')

const ORG = 'org_cuid000000000000000000000'
const CHANNEL = 'int_cuid00000000000000000000'

const db = {
  update: () => ({
    set: (values: Record<string, unknown>) => {
      fixture.update = values
      return { where: async () => undefined }
    },
  }),
} as never

const ctx = { db, organizationId: ORG }

beforeEach(() => {
  vi.clearAllMocks()
  fixture.update = null
  fixture.channel = {
    id: CHANNEL,
    provider: 'google',
    enabled: false,
    metadata: {
      email: 'support@example.com',
      settings: { bidirectionalSyncEnabled: false },
      auth: { consecutiveFailures: 4, requiresReauth: true, type: 'invalid_grant' },
    },
  }
})

describe('recoverChannel', () => {
  it('re-enables an auto-disabled channel through toggle', async () => {
    const result = await recoverChannel(ctx, CHANNEL)

    expect(result.ok).toBe(true)
    expect(result.ok && result.value.reEnabled).toBe(true)
    expect(toggle).toHaveBeenCalledWith(ctx, CHANNEL, true)
  })

  it('leaves an already-enabled channel alone', async () => {
    fixture.channel.enabled = true

    const result = await recoverChannel(ctx, CHANNEL)

    expect(result.ok && result.value.reEnabled).toBe(false)
    expect(toggle).not.toHaveBeenCalled()
  })

  it('drops the auth-failure block while keeping the rest of the metadata', async () => {
    await recoverChannel(ctx, CHANNEL)

    expect(fixture.update?.metadata).toEqual({
      email: 'support@example.com',
      settings: { bidirectionalSyncEnabled: false },
    })
  })

  it('resets the sync breaker and clears the credential reauth flag', async () => {
    await recoverChannel(ctx, CHANNEL)

    expect(fixture.update).toMatchObject({
      syncStatus: 'ACTIVE',
      syncStage: 'IDLE',
      syncStageStartedAt: null,
      throttleFailureCount: 0,
      throttleRetryAfter: null,
    })
    expect(fixture.update).not.toHaveProperty('lastHistoryId')
    expect(clearCredentialReauth).toHaveBeenCalledWith(CHANNEL)
    expect(clearImportCache).toHaveBeenCalledWith(CHANNEL)
  })

  it('clears the history cursor only on a full resync', async () => {
    await recoverChannel(ctx, CHANNEL, { fullResync: true })

    expect(fixture.update?.lastHistoryId).toBeNull()
  })

  it('invalidates the channel cache after the metadata write, not before', async () => {
    const order: string[] = []
    onCacheEvent.mockImplementation(async () => {
      order.push(`cache:${fixture.update ? 'after-write' : 'before-write'}`)
    })

    await recoverChannel(ctx, CHANNEL)

    expect(order).toEqual(['cache:after-write'])
  })

  it('propagates a failed ownership check without writing', async () => {
    const { NotFoundError } = await import('../../errors')
    vi.doMock('../internal/validate', () => ({
      validateChannelOwnership: async () => ({ ok: false, error: new NotFoundError('nope') }),
    }))
    vi.resetModules()
    const { recoverChannel: fresh } = await import('../recover')

    const result = await fresh(ctx, CHANNEL)

    expect(result.ok).toBe(false)
    expect(fixture.update).toBeNull()
    vi.doUnmock('../internal/validate')
    vi.resetModules()
  })
})
