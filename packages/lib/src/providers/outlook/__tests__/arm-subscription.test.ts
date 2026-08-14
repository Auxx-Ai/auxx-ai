// packages/lib/src/providers/outlook/__tests__/arm-subscription.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted ensures these values are available when vi.mock factories run (hoisted above
// imports). ALL variables referenced inside vi.mock factories MUST be declared here.
const {
  mockIntegrationSchema,
  mockSelect,
  mockSelectFrom,
  mockSelectWhere,
  mockSelectLimit,
  mockUpdate,
  mockUpdateSet,
  mockUpdateWhere,
  syncMessages,
  setupWebhook,
  getProvider,
} = vi.hoisted(() => {
  const mockIntegrationSchema = {
    id: 'Integration.id',
    organizationId: 'Integration.organizationId',
    provider: 'Integration.provider',
    enabled: 'Integration.enabled',
    deletedAt: 'Integration.deletedAt',
    metadata: 'Integration.metadata',
    syncStatus: 'Integration.syncStatus',
    updatedAt: 'Integration.updatedAt',
  }

  const mockSelectLimit = vi.fn()
  const mockSelectWhere = vi.fn()
  const mockSelectFrom = vi.fn()
  const mockSelect = vi.fn()

  const mockUpdateWhere = vi.fn()
  const mockUpdateSet = vi.fn()
  const mockUpdate = vi.fn()

  const syncMessages = vi.fn()
  const setupWebhook = vi.fn()
  const getProvider = vi.fn()

  return {
    mockIntegrationSchema,
    mockSelect,
    mockSelectFrom,
    mockSelectWhere,
    mockSelectLimit,
    mockUpdate,
    mockUpdateSet,
    mockUpdateWhere,
    syncMessages,
    setupWebhook,
    getProvider,
  }
})

vi.mock('@auxx/config/server', () => ({ WEBAPP_URL: 'http://localhost:3000' }))

// Partial mock: `@auxx/database`'s schema proxy is auto-vivifying so any table this file
// doesn't think to list is safe — see `../../../test/database-mock`'s header comment.
vi.mock('@auxx/database', async () => ({
  database: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
  schema: (await import('../../../test/database-mock')).createSchemaMock({
    Integration: mockIntegrationSchema,
  }),
}))

// Partial mock: `and`/`eq` are called for their side effect of building a where-clause the
// mocked chain never inspects; keep the rest of the real module intact for anything reached
// transitively.
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: vi.fn((...args: unknown[]) => ({ __eq: args })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
}))

vi.mock('../../provider-registry-service', () => ({
  ProviderRegistryService: class {
    constructor(public organizationId: string) {}
    getProvider = getProvider
  },
}))

import { armOutlookSubscription } from '../outlook-subscription'

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'int-1',
    provider: 'outlook',
    enabled: true,
    deletedAt: null,
    metadata: null,
    ...overrides,
  }
}

/** Rewires the chainable select/update mocks to their default happy-path shape. */
function resetChains() {
  mockSelect.mockReturnValue({ from: mockSelectFrom })
  mockSelectFrom.mockReturnValue({ where: mockSelectWhere })
  mockSelectWhere.mockReturnValue({ limit: mockSelectLimit })
  mockSelectLimit.mockResolvedValue([makeRow()])

  mockUpdate.mockReturnValue({ set: mockUpdateSet })
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
  mockUpdateWhere.mockResolvedValue(undefined)

  getProvider.mockResolvedValue({ syncMessages, setupWebhook })
  syncMessages.mockResolvedValue(undefined)
  setupWebhook.mockResolvedValue(undefined)
}

describe('armOutlookSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetChains()
  })

  it('seeds the delta cursor from seedSince before arming when none exists', async () => {
    mockSelectLimit.mockResolvedValue([makeRow({ metadata: null })])
    const seedSince = new Date('2026-08-13T00:00:00Z')

    await armOutlookSubscription({ integrationId: 'int-1', organizationId: 'org-1', seedSince })

    expect(syncMessages).toHaveBeenCalledWith(seedSince)
    // Base varies by env (NGROK_URL in dev shells falls through webhook-callback-base) —
    // the contract under test is the route path, not the origin.
    expect(setupWebhook).toHaveBeenCalledWith(expect.stringMatching(/\/api\/outlook\/webhook$/))

    const [seedCallOrder] = syncMessages.mock.invocationCallOrder
    const [armCallOrder] = setupWebhook.mock.invocationCallOrder
    expect(seedCallOrder).toBeDefined()
    expect(armCallOrder).toBeDefined()
    expect(seedCallOrder as number).toBeLessThan(armCallOrder as number)
  })

  it('does not seed when a delta cursor already exists, but still arms', async () => {
    mockSelectLimit.mockResolvedValue([makeRow({ metadata: { graphDeltaLink: 'abc' } })])

    await armOutlookSubscription({ integrationId: 'int-1', organizationId: 'org-1' })

    expect(syncMessages).not.toHaveBeenCalled()
    expect(setupWebhook).toHaveBeenCalledTimes(1)
  })

  it('propagates a setupWebhook rejection without swallowing it', async () => {
    mockSelectLimit.mockResolvedValue([makeRow({ metadata: { graphDeltaLink: 'abc' } })])
    setupWebhook.mockRejectedValue(new Error('graph down'))

    await expect(
      armOutlookSubscription({ integrationId: 'int-1', organizationId: 'org-1' })
    ).rejects.toThrow('graph down')
  })

  it('issues the FAILED -> ACTIVE un-fail update after a successful arm', async () => {
    mockSelectLimit.mockResolvedValue([makeRow({ metadata: { graphDeltaLink: 'abc' } })])

    await armOutlookSubscription({ integrationId: 'int-1', organizationId: 'org-1' })

    expect(mockUpdate).toHaveBeenCalledWith(mockIntegrationSchema)
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ syncStatus: 'ACTIVE', updatedAt: expect.any(Date) })
    )
  })

  it('throws a plain Error when the row is missing, disabled, deleted, or non-outlook', async () => {
    mockSelectLimit.mockResolvedValue([])
    await expect(
      armOutlookSubscription({ integrationId: 'missing', organizationId: 'org-1' })
    ).rejects.toThrow('not an active Outlook channel')

    mockSelectLimit.mockResolvedValue([makeRow({ enabled: false })])
    await expect(
      armOutlookSubscription({ integrationId: 'int-1', organizationId: 'org-1' })
    ).rejects.toThrow('not an active Outlook channel')

    mockSelectLimit.mockResolvedValue([makeRow({ deletedAt: new Date() })])
    await expect(
      armOutlookSubscription({ integrationId: 'int-1', organizationId: 'org-1' })
    ).rejects.toThrow('not an active Outlook channel')

    mockSelectLimit.mockResolvedValue([makeRow({ provider: 'google' })])
    await expect(
      armOutlookSubscription({ integrationId: 'int-1', organizationId: 'org-1' })
    ).rejects.toThrow('not an active Outlook channel')

    // None of the rejected rows should have reached the provider.
    expect(getProvider).not.toHaveBeenCalled()
  })
})
