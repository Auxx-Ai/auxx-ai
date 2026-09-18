// packages/lib/src/accounting/providers/quickbooks/__tests__/invoke-quickbooks-tool.test.ts
//
// `resolveQuickbooksContext` is a wrapper over the slug-parameterised resolver
// (brief 27 §5). Pins what it pins: the `quickbooks` slug, the label every
// error carries, the entities scope its customer/item tools need, and the
// `QuickbooksToolContext` shape its callers were written against.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolveAppToolContext: vi.fn(async (_input: unknown): Promise<unknown> => ({ connected: false })),
}))

vi.mock('../../../../apps/invoke-app-tool', () => ({
  resolveAppToolContext: h.resolveAppToolContext,
}))

import { resolveQuickbooksContext } from '../invoke-quickbooks-tool'

const callTool = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveQuickbooksContext', () => {
  it('pins the quickbooks slug, its label and the entities scope', async () => {
    await resolveQuickbooksContext({ organizationId: 'org_1', actorUserId: 'user_1' })

    expect(h.resolveAppToolContext).toHaveBeenCalledWith({
      organizationId: 'org_1',
      appSlug: 'quickbooks',
      appLabel: 'QuickBooks',
      actorUserId: 'user_1',
      includeEntitiesScope: true,
    })
  })

  it('passes connected: false through untouched', async () => {
    await expect(resolveQuickbooksContext({ organizationId: 'org_1' })).resolves.toEqual({
      connected: false,
    })
  })

  it('returns the QuickBooks shape, with realmId lifted off the connection metadata', async () => {
    h.resolveAppToolContext.mockResolvedValue({
      connected: true,
      context: {
        organizationId: 'org_1',
        appSlug: 'quickbooks',
        installationId: 'inst_1',
        connectionId: 'cred_1',
        userId: 'user_system',
        connectionMetadata: { realmId: 'realm_9', other: true },
        callTool,
      },
    })

    const result = await resolveQuickbooksContext({ organizationId: 'org_1' })

    expect(result).toEqual({
      connected: true,
      context: {
        organizationId: 'org_1',
        installationId: 'inst_1',
        connectionId: 'cred_1',
        userId: 'user_system',
        realmId: 'realm_9',
        callTool,
      },
    })
  })

  it('leaves realmId ABSENT when the connection metadata carries none', async () => {
    h.resolveAppToolContext.mockResolvedValue({
      connected: true,
      context: {
        organizationId: 'org_1',
        appSlug: 'quickbooks',
        installationId: 'inst_1',
        connectionId: 'cred_1',
        userId: 'user_system',
        connectionMetadata: undefined,
        callTool,
      },
    })

    const result = await resolveQuickbooksContext({ organizationId: 'org_1' })

    expect(result.connected).toBe(true)
    if (result.connected) expect('realmId' in result.context).toBe(false)
  })
})
