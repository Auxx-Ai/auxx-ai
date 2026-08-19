// packages/lib/src/data-deletion/__tests__/execute-deletion-request.test.ts
//
// plans/channels/meta-data-deletion-callback.md §2.2 / §4.2 / §7.
//
// The load-bearing assertion in this file is the NEGATIVE one: `Thread` and
// `Message` are never touched. The obvious implementation of "delete the
// channel" — calling `channels/disconnect.ts`'s `disconnect()` — hard-deletes
// every thread and message for the channel, so one admin removing the app from
// their personal Facebook settings would wipe the business's entire
// Messenger/IG history. The conversations belong to the business, not to the
// admin exercising their own deletion right.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  request: null as Record<string, any> | null,
  channels: [] as Array<{
    integrationId: string
    organizationId: string
    provider: 'facebook' | 'instagram'
    name: string | null
  }>,
  revoked: [] as Array<{ integrationId: string; provider: string }>,
  notified: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ table: string; values: Record<string, any>; where: unknown }>,
  deletes: [] as string[],
  revokeThrows: false,
}))

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock({
      Integration: { __table: 'Integration', id: 'id' },
      DataDeletionRequest: { __table: 'DataDeletionRequest', id: 'id' },
      Thread: { __table: 'Thread', id: 'id' },
      Message: { __table: 'Message', id: 'id' },
    }),
  }
})

// Partial mock, never a full replacement: a full one dies at COLLECTION the
// moment anything in the graph reaches another drizzle export.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  const passthrough = (...args: unknown[]) => args as never
  return { ...actual, eq: passthrough }
})

vi.mock('../read', () => ({
  getDeletionRequestById: vi.fn(async () => {
    const { ok } = await import('neverthrow')
    return ok(h.request)
  }),
  getDeletionRequestByCode: vi.fn(),
}))

vi.mock('../resolve', () => ({
  resolveMetaChannels: vi.fn(async () => {
    const { ok } = await import('neverthrow')
    return ok(h.channels)
  }),
}))

vi.mock('../notify', () => ({
  notifyOrgOfMetaTeardown: vi.fn(async (_db: unknown, params: Record<string, unknown>) => {
    h.notified.push(params)
  }),
}))

vi.mock('../../providers/facebook/facebook-oauth', () => ({
  FacebookOAuthService: {
    getInstance: () => ({
      revokeAccess: vi.fn(async (integrationId: string) => {
        if (h.revokeThrows) throw new Error('(#190) This authorization code has expired')
        h.revoked.push({ integrationId, provider: 'facebook' })
        return true
      }),
    }),
  },
}))

vi.mock('../../providers/instagram/instagram-oauth', () => ({
  InstagramOAuthService: {
    getInstance: () => ({
      revokeAccess: vi.fn(async (integrationId: string) => {
        if (h.revokeThrows) throw new Error('(#190) This authorization code has expired')
        h.revoked.push({ integrationId, provider: 'instagram' })
        return true
      }),
    }),
  },
}))

import { executeDeletionRequest } from '../execute'

const db = {
  update: (table: { __table: string }) => ({
    set: (values: Record<string, any>) => ({
      where: (where: unknown) => {
        h.updates.push({ table: table.__table, values, where })
        return Promise.resolve([])
      },
    }),
  }),
  delete: (table: { __table: string }) => {
    h.deletes.push(table.__table)
    return { where: () => Promise.resolve([]) }
  },
} as any

function makeRequest(overrides: Record<string, any> = {}) {
  return {
    id: 'ddr_1',
    confirmationCode: 'abc',
    provider: 'facebook',
    externalId: '10175030062710640',
    kind: 'data_deletion',
    status: 'received',
    organizationIds: [],
    integrationIds: [],
    error: null,
    completedAt: null,
    ...overrides,
  }
}

const fbChannel = {
  integrationId: 'int_fb',
  organizationId: 'org_1',
  provider: 'facebook' as const,
  name: 'Auxx Lift',
}
const igChannel = {
  integrationId: 'int_ig',
  organizationId: 'org_1',
  provider: 'instagram' as const,
  name: 'auxxlift',
}

/** Every `Integration` update, keyed by the id passed to `eq()` (passthrough args). */
function integrationUpdates() {
  return h.updates.filter((u) => u.table === 'Integration')
}
function requestUpdates() {
  return h.updates.filter((u) => u.table === 'DataDeletionRequest')
}

beforeEach(() => {
  h.request = makeRequest()
  h.channels = [fbChannel, igChannel]
  h.revoked = []
  h.notified = []
  h.updates = []
  h.deletes = []
  h.revokeThrows = false
})

describe('executeDeletionRequest — data_deletion', () => {
  it('revokes then SOFT-deletes every resolved channel, and never touches Thread/Message', async () => {
    const result = await executeDeletionRequest(db, 'ddr_1')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'completed',
      organizationIds: ['org_1'],
      integrationIds: ['int_fb', 'int_ig'],
    })

    expect(h.revoked).toEqual([
      { integrationId: 'int_fb', provider: 'facebook' },
      { integrationId: 'int_ig', provider: 'instagram' },
    ])

    const updates = integrationUpdates()
    expect(updates).toHaveLength(2)
    for (const update of updates) {
      expect(update.values.deletedAt).toBeInstanceOf(Date)
      expect(update.values.enabled).toBe(false)
    }

    // THE assertion: history belongs to the business, not to the admin who
    // clicked "remove app". Nothing may delete, and nothing may write, Thread
    // or Message.
    expect(h.deletes).toEqual([])
    expect(h.updates.map((u) => u.table)).not.toContain('Thread')
    expect(h.updates.map((u) => u.table)).not.toContain('Message')
  })

  it('stamps the audit row: processing -> completed with the resolved ids', async () => {
    await executeDeletionRequest(db, 'ddr_1')

    const [processing, completed] = requestUpdates()
    expect(processing?.values.status).toBe('processing')
    expect(completed?.values).toMatchObject({
      status: 'completed',
      organizationIds: ['org_1'],
      integrationIds: ['int_fb', 'int_ig'],
    })
    expect(completed?.values.completedAt).toBeInstanceOf(Date)
  })

  it('notifies each affected org once per channel', async () => {
    await executeDeletionRequest(db, 'ddr_1')

    expect(h.notified).toEqual([
      {
        organizationId: 'org_1',
        channelName: 'Auxx Lift',
        platform: 'facebook',
        kind: 'data_deletion',
      },
      {
        organizationId: 'org_1',
        channelName: 'auxxlift',
        platform: 'instagram',
        kind: 'data_deletion',
      },
    ])
  })

  it('still soft-deletes when the Graph revoke fails — the callback often arrives after the app was removed', async () => {
    h.revokeThrows = true

    const result = await executeDeletionRequest(db, 'ddr_1')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('completed')
    expect(integrationUpdates()).toHaveLength(2)
    expect(integrationUpdates().every((u) => u.values.deletedAt instanceof Date)).toBe(true)
  })
})

describe('executeDeletionRequest — deauthorize', () => {
  beforeEach(() => {
    h.request = makeRequest({ kind: 'deauthorize' })
  })

  it('only DISABLES the channel: no revoke, no deletedAt, credentials kept', async () => {
    const result = await executeDeletionRequest(db, 'ddr_1')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('completed')

    expect(h.revoked).toEqual([])

    const updates = integrationUpdates()
    expect(updates).toHaveLength(2)
    for (const update of updates) {
      expect(update.values.enabled).toBe(false)
      expect(update.values).not.toHaveProperty('deletedAt')
    }

    expect(h.deletes).toEqual([])
    expect(h.updates.map((u) => u.table)).not.toContain('Thread')
    expect(h.updates.map((u) => u.table)).not.toContain('Message')
  })

  it('notifies with the app-removed kind so the email reads "paused"', async () => {
    await executeDeletionRequest(db, 'ddr_1')
    expect(h.notified.every((n) => n.kind === 'deauthorize')).toBe(true)
  })
})

describe('executeDeletionRequest — edge cases', () => {
  it('completes cleanly when ZERO channels resolve (retry / already gone / never connected)', async () => {
    h.channels = []

    const result = await executeDeletionRequest(db, 'ddr_1')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'completed',
      organizationIds: [],
      integrationIds: [],
    })
    expect(integrationUpdates()).toEqual([])
    expect(h.notified).toEqual([])
    expect(requestUpdates().at(-1)?.values.status).toBe('completed')
  })

  it('is a no-op for an already-completed request', async () => {
    h.request = makeRequest({ status: 'completed', integrationIds: ['int_fb'] })

    const result = await executeDeletionRequest(db, 'ddr_1')

    expect(result._unsafeUnwrap().status).toBe('completed')
    expect(h.updates).toEqual([])
    expect(h.revoked).toEqual([])
  })

  it('returns NotFoundError for an unknown request id', async () => {
    h.request = null

    const result = await executeDeletionRequest(db, 'ddr_missing')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().name).toBe('NotFoundError')
  })

  it('parks Shopify kinds in `processing` rather than falsely claiming completion', async () => {
    h.request = makeRequest({
      provider: 'shopify',
      kind: 'shop_redact',
      externalId: 'shop.myshopify.com',
    })

    const result = await executeDeletionRequest(db, 'ddr_1')

    expect(result._unsafeUnwrap().status).toBe('processing')
    expect(requestUpdates().map((u) => u.values.status)).toEqual(['processing'])
    expect(integrationUpdates()).toEqual([])
    expect(h.revoked).toEqual([])
  })

  it('marks the request failed when the teardown throws', async () => {
    const { resolveMetaChannels } = await import('../resolve')
    vi.mocked(resolveMetaChannels).mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    const result = await executeDeletionRequest(db, 'ddr_1')

    expect(result.isErr()).toBe(true)
    expect(requestUpdates().at(-1)?.values).toMatchObject({ status: 'failed', error: 'boom' })
  })
})
