// packages/lib/src/providers/outlook/__tests__/setup-webhook.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutlookProvider } from '../outlook-provider'

const mocks = vi.hoisted(() => {
  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
  const update = vi.fn().mockReturnValue({ set: updateSet })
  return { update, updateSet, updateWhere }
})

// Partial mock: the chainable proxy still backs every builder the rest of the module
// graph touches at import time (see `src/test/database-mock.ts`'s doc comment), and
// the schema proxy auto-vivifies every table. Only `update` is pinned to a spy so
// this suite can assert on the jsonb-merge writes `setupWebhook`/`removeWebhook`
// make, without the rest of the import graph dying at collection.
vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import(
    '../../../test/database-mock'
  )
  const database = new Proxy(createChainableDatabaseMock(), {
    get: (target: any, prop: string) => {
      if (prop === 'update') return mocks.update
      return target[prop]
    },
  })
  return {
    database,
    schema: createSchemaMock({
      Integration: {
        id: 'Integration.id',
        metadata: 'Integration.metadata',
        webhookRouteKey: 'Integration.webhookRouteKey',
      },
    }),
  }
})

// Partial mock: silence log output without replacing the rest of the barrel.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const CALLBACK_URL = 'https://app.test/api/outlook/webhook'
const OUTLOOK_RESOURCE = "/me/mailFolders('inbox')/messages"
/** Matches `OUTLOOK_SUBSCRIPTION_TTL_MS` in outlook-provider.ts: 6d20h. */
const EXPECTED_TTL_MINUTES = (6 * 24 + 20) * 60

interface GraphHandlers {
  onCreate?: (body: any) => any
  onList?: () => any
  onPatch?: (id: string, body: any) => any
  onDelete?: (id: string) => any
  onGet?: (id: string) => any
}

/** Minimal fake Graph client covering the `/subscriptions` surface `setupWebhook`,
 * `removeWebhook` and `checkSubscription` drive. Unhandled paths/methods throw, so a
 * test only wires the calls it expects to happen. */
function makeGraphClient(handlers: GraphHandlers) {
  const idFromPath = (path: string) => path.split('/subscriptions/')[1] ?? ''
  return {
    api: (path: string) => ({
      get: async () => {
        if (path === '/subscriptions') {
          if (!handlers.onList) throw new Error(`Unexpected GET ${path}`)
          return handlers.onList()
        }
        if (!handlers.onGet) throw new Error(`Unexpected GET ${path}`)
        return handlers.onGet(idFromPath(path))
      },
      post: async (body: any) => {
        if (path !== '/subscriptions') throw new Error(`Unexpected POST ${path}`)
        if (!handlers.onCreate) throw new Error('Unexpected subscription create')
        return handlers.onCreate(body)
      },
      patch: async (body: any) => {
        if (!handlers.onPatch) throw new Error(`Unexpected PATCH ${path}`)
        return handlers.onPatch(idFromPath(path), body)
      },
      delete: async () => {
        if (!handlers.onDelete) throw new Error(`Unexpected DELETE ${path}`)
        return handlers.onDelete(idFromPath(path))
      },
    }),
  }
}

/** Graph client errors carry `statusCode`, not an HTTP-ish `status` — mirrors the
 * shape `@microsoft/microsoft-graph-client` actually throws. */
function graphError(statusCode: number, message = 'Graph error'): Error {
  const error: any = new Error(message)
  error.statusCode = statusCode
  return error
}

function makeProvider(integrationOverrides: Record<string, unknown> = {}) {
  const provider = new OutlookProvider('org_1')
  provider.integrationId = 'int_1'
  ;(provider as any).integration = {
    id: 'int_1',
    metadata: {},
    webhookRouteKey: null,
    lastSyncedAt: null,
    ...integrationOverrides,
  }
  return provider
}

/** Walks a drizzle `sql\`...\`` template's chunks looking for a raw/interpolated
 * value — robust to the exact merge shape without pinning the full SQL string. */
function sqlContains(sqlChunk: any, value: string): boolean {
  if (!sqlChunk || typeof sqlChunk !== 'object' || !Array.isArray(sqlChunk.queryChunks)) {
    return false
  }
  return sqlChunk.queryChunks.some((chunk: any) => {
    if (typeof chunk === 'string') return chunk.includes(value)
    if (chunk && typeof chunk === 'object' && Array.isArray(chunk.value)) {
      return chunk.value.some((v: unknown) => typeof v === 'string' && v.includes(value))
    }
    return false
  })
}

describe('OutlookProvider.setupWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a subscription with lifecycleNotificationUrl when nothing is stored', async () => {
    const provider = makeProvider()
    let createdBody: any
    ;(provider as any).client = makeGraphClient({
      onCreate: (body) => {
        createdBody = body
        return {
          id: 'sub_new',
          expirationDateTime: body.expirationDateTime,
          clientState: body.clientState,
        }
      },
    })

    await provider.setupWebhook(CALLBACK_URL)

    expect(createdBody.changeType).toBe('created,updated')
    expect(createdBody.notificationUrl).toBe(CALLBACK_URL)
    expect(createdBody.lifecycleNotificationUrl).toBe(`${CALLBACK_URL}/lifecycle`)
    expect(createdBody.resource).toBe(OUTLOOK_RESOURCE)
    expect(typeof createdBody.clientState).toBe('string')
    expect(createdBody.clientState.length).toBeGreaterThan(0)

    const minutesUntilExpiry =
      (new Date(createdBody.expirationDateTime).getTime() - Date.now()) / 60_000
    expect(minutesUntilExpiry).toBeLessThanOrEqual(10_080) // Graph's hard cap
    expect(minutesUntilExpiry).toBeGreaterThan(EXPECTED_TTL_MINUTES - 2)
    expect(minutesUntilExpiry).toBeLessThan(EXPECTED_TTL_MINUTES + 2)

    expect(mocks.update).toHaveBeenCalledTimes(1)
    const setArg = mocks.updateSet.mock.calls[0]![0]
    expect(setArg.webhookRouteKey).toBe('sub_new')
    expect(sqlContains(setArg.metadata, 'sub_new')).toBe(true)
    expect(sqlContains(setArg.metadata, createdBody.clientState)).toBe(true)
    expect(sqlContains(setArg.metadata, OUTLOOK_RESOURCE)).toBe(true)
  })

  it('renews via PATCH when a stored id with a matching resource exists', async () => {
    const provider = makeProvider({
      webhookRouteKey: 'sub_existing',
      metadata: {
        outlookSubscription: {
          clientState: 'existing-secret',
          resource: OUTLOOK_RESOURCE,
          expiresAt: '2026-08-01T00:00:00.000Z',
          armedAt: '2026-07-25T00:00:00.000Z',
        },
      },
    })
    let patchedId: string | undefined
    let patchedBody: any
    let createCalled = false
    ;(provider as any).client = makeGraphClient({
      onPatch: (id, body) => {
        patchedId = id
        patchedBody = body
        return { id, expirationDateTime: body.expirationDateTime, clientState: 'existing-secret' }
      },
      onCreate: () => {
        createCalled = true
        throw new Error('should not have created a new subscription')
      },
    })

    await provider.setupWebhook(CALLBACK_URL)

    expect(patchedId).toBe('sub_existing')
    expect(Object.keys(patchedBody)).toEqual(['expirationDateTime'])
    expect(createCalled).toBe(false)

    expect(mocks.update).toHaveBeenCalledTimes(1)
    const setArg = mocks.updateSet.mock.calls[0]![0]
    expect(setArg.webhookRouteKey).toBe('sub_existing')
    expect(sqlContains(setArg.metadata, 'existing-secret')).toBe(true)
  })

  it('falls through to POST when the stored subscription is gone (404)', async () => {
    const provider = makeProvider({
      webhookRouteKey: 'sub_gone',
      metadata: {
        outlookSubscription: { clientState: 'old-secret', resource: OUTLOOK_RESOURCE },
      },
    })
    let createdBody: any
    ;(provider as any).client = makeGraphClient({
      onPatch: () => {
        throw graphError(404)
      },
      onCreate: (body) => {
        createdBody = body
        return {
          id: 'sub_recreated',
          expirationDateTime: body.expirationDateTime,
          clientState: body.clientState,
        }
      },
    })

    await provider.setupWebhook(CALLBACK_URL)

    expect(createdBody).toBeDefined()
    // Reuses the stored secret rather than minting a new one.
    expect(createdBody.clientState).toBe('old-secret')
    expect(createdBody.lifecycleNotificationUrl).toBe(`${CALLBACK_URL}/lifecycle`)

    expect(mocks.update).toHaveBeenCalledTimes(1)
    const setArg = mocks.updateSet.mock.calls[0]![0]
    expect(setArg.webhookRouteKey).toBe('sub_recreated')
    expect(sqlContains(setArg.metadata, 'sub_recreated')).toBe(true)
  })

  it('falls through to POST when a 410 is returned on renewal', async () => {
    const provider = makeProvider({
      webhookRouteKey: 'sub_expired',
      metadata: { outlookSubscription: { clientState: 'old-secret', resource: OUTLOOK_RESOURCE } },
    })
    let createCalled = false
    ;(provider as any).client = makeGraphClient({
      onPatch: () => {
        throw graphError(410)
      },
      onCreate: (body) => {
        createCalled = true
        return { id: 'sub_recreated_410', expirationDateTime: body.expirationDateTime }
      },
    })

    await provider.setupWebhook(CALLBACK_URL)

    expect(createCalled).toBe(true)
    const setArg = mocks.updateSet.mock.calls[0]![0]
    expect(setArg.webhookRouteKey).toBe('sub_recreated_410')
  })

  it('adopts the matching subscription on a 409 conflict', async () => {
    const provider = makeProvider()
    let patchedId: string | undefined
    let patchedBody: any
    ;(provider as any).client = makeGraphClient({
      onCreate: () => {
        throw graphError(409, 'Subscription already exists')
      },
      onList: () => ({
        value: [
          {
            id: 'sub_live',
            resource: OUTLOOK_RESOURCE,
            notificationUrl: CALLBACK_URL,
            clientState: 'live-secret',
          },
        ],
      }),
      onPatch: (id, body) => {
        patchedId = id
        patchedBody = body
        return { id, expirationDateTime: body.expirationDateTime }
      },
    })

    await provider.setupWebhook(CALLBACK_URL)

    expect(patchedId).toBe('sub_live')
    expect(patchedBody.expirationDateTime).toBeDefined()

    expect(mocks.update).toHaveBeenCalledTimes(1)
    const setArg = mocks.updateSet.mock.calls[0]![0]
    expect(setArg.webhookRouteKey).toBe('sub_live')
    expect(sqlContains(setArg.metadata, 'live-secret')).toBe(true)
  })

  it('recreates when the 409 match has no adoptable clientState', async () => {
    const provider = makeProvider()
    let createCount = 0
    let deletedId: string | undefined
    ;(provider as any).client = makeGraphClient({
      onCreate: (body) => {
        createCount++
        if (createCount === 1) throw graphError(409, 'Subscription already exists')
        return { id: 'sub_fresh', expirationDateTime: body.expirationDateTime }
      },
      onList: () => ({
        value: [{ id: 'sub_no_secret', resource: OUTLOOK_RESOURCE, notificationUrl: CALLBACK_URL }],
      }),
      onDelete: (id) => {
        deletedId = id
      },
    })

    await provider.setupWebhook(CALLBACK_URL)

    expect(deletedId).toBe('sub_no_secret')
    expect(createCount).toBe(2)
    const setArg = mocks.updateSet.mock.calls[0]![0]
    expect(setArg.webhookRouteKey).toBe('sub_fresh')
  })
})

describe('OutlookProvider.removeWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears stored state even when the Graph subscription is already gone (404)', async () => {
    const provider = makeProvider({
      webhookRouteKey: 'sub_1',
      metadata: {
        outlookSubscription: { clientState: 'secret', resource: OUTLOOK_RESOURCE },
        graphSubscriptionId: 'sub_1',
        webhookSecret: 'secret',
        subscriptionExpiration: '2026-08-01T00:00:00.000Z',
        graphDeltaLink: 'https://graph.microsoft.com/delta-token',
      },
    })
    let deleteAttempted: string | undefined
    ;(provider as any).client = makeGraphClient({
      onDelete: (id) => {
        deleteAttempted = id
        throw graphError(404)
      },
    })

    await provider.removeWebhook()

    expect(deleteAttempted).toBe('sub_1')
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const setArg = mocks.updateSet.mock.calls[0]![0]
    expect(setArg.webhookRouteKey).toBeNull()
    expect(sqlContains(setArg.metadata, "'outlookSubscription'")).toBe(true)
    expect(sqlContains(setArg.metadata, "'graphSubscriptionId'")).toBe(true)
    expect(sqlContains(setArg.metadata, "'webhookSecret'")).toBe(true)
    expect(sqlContains(setArg.metadata, "'subscriptionExpiration'")).toBe(true)
  })

  it('clears stored state on a clean delete', async () => {
    const provider = makeProvider({
      webhookRouteKey: 'sub_2',
      metadata: { outlookSubscription: { clientState: 'secret', resource: OUTLOOK_RESOURCE } },
    })
    let deleteAttempted: string | undefined
    ;(provider as any).client = makeGraphClient({
      onDelete: (id) => {
        deleteAttempted = id
      },
    })

    await provider.removeWebhook()

    expect(deleteAttempted).toBe('sub_2')
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.updateSet.mock.calls[0]![0].webhookRouteKey).toBeNull()
  })

  it('leaves stored state intact when deletion fails for a non-404 reason', async () => {
    const provider = makeProvider({
      webhookRouteKey: 'sub_3',
      metadata: { outlookSubscription: { clientState: 'secret', resource: OUTLOOK_RESOURCE } },
    })
    ;(provider as any).client = makeGraphClient({
      onDelete: () => {
        throw graphError(500, 'Graph is down')
      },
    })

    await provider.removeWebhook()

    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('clears state (no-op write) even when nothing was stored', async () => {
    const provider = makeProvider()
    ;(provider as any).client = makeGraphClient({})

    await provider.removeWebhook()

    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.updateSet.mock.calls[0]![0].webhookRouteKey).toBeNull()
  })
})

describe('OutlookProvider.checkSubscription', () => {
  it("returns 'none' when nothing is stored", async () => {
    const provider = makeProvider()
    ;(provider as any).client = makeGraphClient({})

    await expect(provider.checkSubscription()).resolves.toBe('none')
  })

  it("returns 'active' when the Graph subscription still exists", async () => {
    const provider = makeProvider({ webhookRouteKey: 'sub_1' })
    let checkedId: string | undefined
    ;(provider as any).client = makeGraphClient({
      onGet: (id) => {
        checkedId = id
        return { id, expirationDateTime: '2026-09-01T00:00:00.000Z' }
      },
    })

    await expect(provider.checkSubscription()).resolves.toBe('active')
    expect(checkedId).toBe('sub_1')
  })

  it("returns 'missing' when the Graph subscription is gone (404)", async () => {
    const provider = makeProvider({ webhookRouteKey: 'sub_1' })
    ;(provider as any).client = makeGraphClient({
      onGet: () => {
        throw graphError(404)
      },
    })

    await expect(provider.checkSubscription()).resolves.toBe('missing')
  })

  it('rethrows non-404 errors', async () => {
    const provider = makeProvider({ webhookRouteKey: 'sub_1' })
    ;(provider as any).client = makeGraphClient({
      onGet: () => {
        throw graphError(500, 'Graph is down')
      },
    })

    await expect(provider.checkSubscription()).rejects.toThrow('Graph is down')
  })

  it('falls back to the legacy graphSubscriptionId metadata key when webhookRouteKey is unset', async () => {
    const provider = makeProvider({
      webhookRouteKey: null,
      metadata: { graphSubscriptionId: 'legacy_sub' },
    })
    let checkedId: string | undefined
    ;(provider as any).client = makeGraphClient({
      onGet: (id) => {
        checkedId = id
        return { id }
      },
    })

    await expect(provider.checkSubscription()).resolves.toBe('active')
    expect(checkedId).toBe('legacy_sub')
  })
})
