// apps/web/src/server/api/routers/payout-evidence.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  entries: vi.fn(),
  history: vi.fn(),
  rejected: vi.fn(),
}))

vi.mock('@auxx/lib/money/payouts', () => ({
  listPayoutEvidence: state.list,
  getPayoutEvidence: state.detail,
  listProcessorBalanceEntries: state.entries,
  listPayoutEvidenceHistory: state.history,
  listRejectedProcessorEvidence: state.rejected,
}))
vi.mock('@auxx/lib/permissions', () => ({ PermissionKey: { ledgerView: 'ledger.view' } }))

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC, TRPCError } = await import('@trpc/server')
  const t = initTRPC
    .context<{
      db: object
      session: { organizationId: string }
      permissions: Set<string>
    }>()
    .create()
  return {
    createTRPCRouter: t.router,
    permissionProcedure: (permission: string) =>
      t.procedure.use(({ ctx, next }) => {
        if (!ctx.permissions.has(permission)) throw new TRPCError({ code: 'FORBIDDEN' })
        return next()
      }),
  }
})

import { payoutEvidenceRouter } from './payout-evidence'

const db = {}
function caller(permissions = ['ledger.view']) {
  return payoutEvidenceRouter.createCaller({
    db,
    session: { organizationId: 'org-session' },
    permissions: new Set(permissions),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.list.mockResolvedValue({ items: [], nextCursor: null })
  state.entries.mockResolvedValue({ items: [], nextCursor: null })
  state.detail.mockResolvedValue(null)
})

describe('payout evidence financial read boundary', () => {
  it('denies every evidence read without ledger view access', async () => {
    const api = caller([])
    await expect(api.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api.detail({ id: 'payout-1' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api.entries({})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api.history({ transferId: 'payout-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(api.rejected({})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(state.list).not.toHaveBeenCalled()
    expect(state.detail).not.toHaveBeenCalled()
    expect(state.entries).not.toHaveBeenCalled()
    expect(state.history).not.toHaveBeenCalled()
    expect(state.rejected).not.toHaveBeenCalled()
  })

  it('scopes pagination and pending activity to the session organization', async () => {
    await caller().list({ cursor: 'after-1', limit: 25 })
    expect(state.list).toHaveBeenCalledWith(db, {
      organizationId: 'org-session',
      cursor: 'after-1',
      limit: 25,
    })
    await caller().entries({ transferId: 'payout-1', unassignedOnly: true })
    expect(state.entries).toHaveBeenCalledWith(db, {
      organizationId: 'org-session',
      cursor: undefined,
      limit: 50,
      transferId: 'payout-1',
      unassignedOnly: true,
    })
  })

  it('scopes history and rejected source payloads to the session organization', async () => {
    await caller().history({ transferId: 'payout-1', limit: 20, cursor: 'page-2' })
    expect(state.history).toHaveBeenCalledWith(db, {
      organizationId: 'org-session',
      transferId: 'payout-1',
      limit: 20,
      cursor: 'page-2',
    })
    await caller().rejected({ limit: 25 })
    expect(state.rejected).toHaveBeenCalledWith(db, {
      organizationId: 'org-session',
      limit: 25,
      cursor: undefined,
    })
  })

  it('does not expose a missing or foreign-organization payout', async () => {
    await expect(caller().detail({ id: 'foreign-payout' })).rejects.toThrow('Payout not found')
    expect(state.detail).toHaveBeenCalledWith(db, {
      organizationId: 'org-session',
      id: 'foreign-payout',
    })
  })

  it('bounds read page sizes before querying financial data', async () => {
    await expect(caller().entries({ limit: 101 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().list({ limit: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(state.entries).not.toHaveBeenCalled()
    expect(state.list).not.toHaveBeenCalled()
  })
})
