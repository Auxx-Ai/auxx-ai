// apps/web/src/server/api/routers/provider-matches.test.ts

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  list: vi.fn(),
  counts: vi.fn(),
  forInvoice: vi.fn(),
  forVendorBill: vi.fn(),
  forPayout: vi.fn(),
  accept: vi.fn(),
  dismiss: vi.fn(),
  activeBookId: 'book-active' as string | null,
}))

vi.mock('@auxx/lib/accounting/provider-matches', () => ({
  MATCH_STATES: ['pending', 'suggested', 'matched', 'unmatchable'],
  PROVIDER_MATCH_REASONS: ['adopted', 'ours_unsent', 'duplicate_sent', 'no_payout', 'ambiguous'],
  listProviderMatches: state.list,
  countProviderMatches: state.counts,
  listProviderMatchesForInvoice: state.forInvoice,
  listProviderMatchesForVendorBill: state.forVendorBill,
  readPayoutProviderSide: state.forPayout,
  acceptProviderMatch: state.accept,
  dismissProviderMatch: state.dismiss,
}))
vi.mock('@auxx/lib/accounting/providers', () => ({
  readActiveBookConnection: async () =>
    state.activeBookId ? { bookId: state.activeBookId } : null,
  resolveAccountingProvider: async () => ({
    objectUrl: ({ objectType, externalId }: { objectType: string; externalId: string }) =>
      `https://provider.test/${objectType}/${externalId}`,
  }),
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

import { providerMatchRouter } from './provider-matches'

const db = {}
function caller(permissions = ['ledger.view', 'ledger.post']) {
  return providerMatchRouter.createCaller({
    db,
    session: { organizationId: 'org-session', user: { id: 'user-1' } },
    permissions: new Set(permissions),
  } as never)
}

function row(id: string, bookId = 'book-active') {
  return { id, bookId, providerTxnType: 'Payment', providerTxnId: `txn-${id}` }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.activeBookId = 'book-active'
  state.list.mockResolvedValue(ok({ rows: [], nextCursor: null }))
  state.counts.mockResolvedValue(ok({ suggested: 0, pending: 0, unmatchable: 0 }))
  state.forInvoice.mockResolvedValue(ok([]))
  state.forVendorBill.mockResolvedValue(ok([]))
  state.forPayout.mockResolvedValue(ok({ deposit: null, duplicates: [] }))
  state.accept.mockResolvedValue(ok(undefined))
  state.dismiss.mockResolvedValue(ok(undefined))
})

describe('providerMatch permissions', () => {
  it('refuses every read without ledger view', async () => {
    const api = caller([])
    await expect(api.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api.counts()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api.forInvoice({ invoiceInstanceId: 'inv' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(api.forVendorBill({ vendorBillInstanceId: 'bill' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(api.forPayout({ payoutId: 'po' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(state.list).not.toHaveBeenCalled()
    expect(state.forVendorBill).not.toHaveBeenCalled()
  })

  it('refuses accept and dismiss to a viewer who may not post', async () => {
    const api = caller(['ledger.view'])
    await expect(api.accept({ entryId: 'e' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api.dismiss({ entryId: 'e' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(state.accept).not.toHaveBeenCalled()
    expect(state.dismiss).not.toHaveBeenCalled()
  })
})

describe('providerMatch reads', () => {
  it('scopes the list to the session organization and passes its filters through', async () => {
    await caller().list({ states: ['suggested'], reasons: ['ambiguous'], limit: 10, cursor: 'c' })
    expect(state.list).toHaveBeenCalledWith(db, 'org-session', {
      states: ['suggested'],
      reasons: ['ambiguous'],
      limit: 10,
      cursor: 'c',
    })
  })

  it('links only rows in the connected book', async () => {
    state.list.mockResolvedValue(ok({ rows: [row('a'), row('b', 'book-old')], nextCursor: 'next' }))
    const page = await caller().list({})
    expect(page.nextCursor).toBe('next')
    expect(page.rows.map((r) => r.providerObjectUrl)).toEqual([
      'https://provider.test/Payment/txn-a',
      null,
    ])
  })

  it('reads the vendor bill in the session organization and links rows in the connected book', async () => {
    state.forVendorBill.mockResolvedValue(
      ok([
        { ...row('bp'), providerTxnType: 'Bill Payment (Check)' },
        { ...row('x', 'book-old'), providerTxnType: 'Expense' },
      ])
    )
    const rows = await caller().forVendorBill({ vendorBillInstanceId: 'bill-1' })
    expect(state.forVendorBill).toHaveBeenCalledWith(db, 'org-session', 'bill-1')
    expect(rows.map((r) => r.providerObjectUrl)).toEqual([
      'https://provider.test/Bill Payment (Check)/txn-bp',
      null,
    ])
  })

  it('links our sent Deposit and each duplicate on the payout', async () => {
    state.forPayout.mockResolvedValue(
      ok({
        deposit: {
          batchState: 'sent',
          providerObjectId: '555',
          objectType: 'deposit',
          bookId: 'book-active',
          sentAt: null,
          cleared: 'R',
        },
        duplicates: [row('d')],
      })
    )
    const side = await caller().forPayout({ payoutId: 'payout-record' })
    expect(state.forPayout).toHaveBeenCalledWith(db, 'org-session', 'payout-record')
    expect(side.connected).toBe(true)
    expect(side.deposit?.providerObjectUrl).toBe('https://provider.test/deposit/555')
    expect(side.duplicates[0]?.providerObjectUrl).toBe('https://provider.test/Payment/txn-d')
  })

  it('does not link a Deposit that has not been sent', async () => {
    state.forPayout.mockResolvedValue(
      ok({
        deposit: {
          batchState: 'ready',
          providerObjectId: null,
          objectType: 'deposit',
          bookId: 'book-active',
          sentAt: null,
          cleared: null,
        },
        duplicates: [],
      })
    )
    const side = await caller().forPayout({ payoutId: 'payout-record' })
    expect(side.deposit?.providerObjectUrl).toBeNull()
  })

  it('says when no book is connected', async () => {
    state.activeBookId = null
    const side = await caller().forPayout({ payoutId: 'payout-record' })
    expect(side.connected).toBe(false)
  })
})

describe('providerMatch writes', () => {
  it('accepts and dismisses as the session user in the session organization', async () => {
    await caller().accept({ entryId: 'entry-1' })
    expect(state.accept).toHaveBeenCalledWith(db, {
      organizationId: 'org-session',
      entryId: 'entry-1',
      actorUserId: 'user-1',
    })
    await caller().dismiss({ entryId: 'entry-2' })
    expect(state.dismiss).toHaveBeenCalledWith(db, {
      organizationId: 'org-session',
      entryId: 'entry-2',
      actorUserId: 'user-1',
    })
  })
})
