// apps/web/src/server/api/routers/payout-evidence.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  entries: vi.fn(),
  rejected: vi.fn(),
  recheck: vi.fn(),
}))

vi.mock('@auxx/lib/accounting/money/payouts', () => ({
  listPayoutEvidence: state.list,
  getPayoutEvidence: state.detail,
  listProcessorBalanceEntries: state.entries,
  listRejectedProcessorEvidence: state.rejected,
  recheckOpenPayoutMatches: state.recheck,
}))
vi.mock('@auxx/lib/permissions', () => ({
  PermissionKey: { ledgerView: 'ledger.view', ledgerPost: 'ledger.post' },
}))

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC, TRPCError } = await import('@trpc/server')
  const t = initTRPC
    .context<{
      db: object
      session: { organizationId: string; user: { id: string } }
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
    session: { organizationId: 'org-session', user: { id: 'user-session' } },
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
    await expect(api.rejected({})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(state.list).not.toHaveBeenCalled()
    expect(state.detail).not.toHaveBeenCalled()
    expect(state.entries).not.toHaveBeenCalled()
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

  it('scopes rejected source payloads to the session organization', async () => {
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

  it('re-checks matches only with ledger post access, scoped to the session organization', async () => {
    state.recheck.mockResolvedValue({
      isErr: () => false,
      value: { payouts: 2, changed: 1, reposted: 0 },
    })
    await expect(caller().recheckMatches()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(state.recheck).not.toHaveBeenCalled()

    await expect(caller(['ledger.post']).recheckMatches()).resolves.toEqual({
      payouts: 2,
      changed: 1,
      reposted: 0,
    })
    expect(state.recheck).toHaveBeenCalledWith(db, {
      organizationId: 'org-session',
      actorUserId: 'user-session',
    })
  })
})
