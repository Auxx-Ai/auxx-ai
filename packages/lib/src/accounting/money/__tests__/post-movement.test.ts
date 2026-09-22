// packages/lib/src/accounting/money/__tests__/post-movement.test.ts
//
// The shared frame: one result shape, the five refusals every poster used to
// spell four ways, and the endpoint resolved after any post-time rail stamp.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(),
  findLiveSubjectPosting: vi.fn(),
  resolvePeriodLock: vi.fn(),
  readAutoPostMode: vi.fn(),
  postEntry: vi.fn(),
  resolveCashEndpoint: vi.fn(),
  settings: {} as Record<string, unknown>,
  money: null as unknown,
  /** The id `findLiveDraft` answers with, or null. */
  draft: null as string | null,
  updates: [] as unknown[],
  marks: [] as unknown[],
}))

vi.mock('../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../ledger/setup/setup-readiness', () => ({ FINALIZED_SETUP_STATE: 'finalized' }))
vi.mock('../../ledger/reads/list-postings', () => ({
  findLiveSubjectPosting: h.findLiveSubjectPosting,
}))
vi.mock('../../ledger/periods/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../../ledger/post/auto-post', () => ({ readAutoPostMode: h.readAutoPostMode }))
vi.mock('../../ledger/post/post-entry', () => ({ postEntry: h.postEntry }))
vi.mock('../cash-endpoint', async () => {
  const actual = await vi.importActual<typeof import('../cash-endpoint')>('../cash-endpoint')
  return { ...actual, resolveCashEndpoint: h.resolveCashEndpoint }
})
vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async (_org: string, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, h.settings[key] ?? null])),
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import type { Database } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { movementPeriodKey } from '../../ledger/builders/movement-key'
import { postMovementEntry } from '../post-movement'

const ORG = 'org_1'
const MOVEMENT = 'mt_1'

function db(): Database {
  const base = {
    query: {
      MoneyTransaction: {
        findFirst: async () => h.money,
        findMany: async () => {
          const row = await h.money
          return row ? [row] : []
        },
      },
    },
    update: () => ({ set: (values: unknown) => ({ where: async () => h.updates.push(values) }) }),
  }
  // `findLiveDraft`'s select chain, answering `h.draft`.
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'innerJoin', 'where', 'limit']) self[method] = () => self
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(h.draft ? [{ id: h.draft }] : []).then(resolve)
    return self
  }
  return {
    ...base,
    select: () => chain(),
    // The posting-block mark is written on `db`, never the prepare transaction.
    update: () => ({ set: (values: unknown) => ({ where: async () => h.marks.push(values) }) }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(base),
  } as unknown as Database
}

function post(prepare = defaultPrepare) {
  return postMovementEntry(db(), {
    organizationId: ORG,
    moneyTransactionId: MOVEMENT,
    purpose: 'customer_receipt',
    label: 'Invoice receipt',
    prepare,
  })
}

const defaultPrepare = async (_tx: unknown, loaded: { endpoint: () => Promise<unknown> }) => {
  const endpoint = (await loaded.endpoint()) as { glAccountId: string }
  return {
    lines: [
      {
        sourceType: 'money_transaction',
        sourceId: MOVEMENT,
        glAccountId: endpoint.glAccountId,
        direction: 'debit' as const,
        amount: 5000,
        sortOrder: 0,
      },
      {
        sourceType: 'money_transaction',
        sourceId: MOVEMENT,
        accountRole: 'accounts_receivable',
        direction: 'credit' as const,
        amount: 5000,
        sortOrder: 1,
      },
    ],
    parent: { sourceKind: 'invoice', sourceId: 'inv_1' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.updates = []
  h.marks = []
  h.draft = null
  h.isAccountingEnabled.mockResolvedValue(true)
  h.findLiveSubjectPosting.mockResolvedValue(ok(null))
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.readAutoPostMode.mockResolvedValue('post')
  h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gl_1' })
  h.resolveCashEndpoint.mockResolvedValue({
    glAccountId: 'gl_undep',
    kind: 'undeposited_funds',
    railId: null,
  })
  h.settings = {
    'accounting.setupState': 'finalized',
    'accounting.bookTimeZone': 'America/Los_Angeles',
    'accounting.cutoffPeriod': null,
  }
  h.money = {
    id: MOVEMENT,
    organizationId: ORG,
    purpose: 'customer_receipt',
    amountMinor: 5000n,
    currency: 'USD',
    currencyExponent: 2,
    datePrecision: 'date',
    occurredOn: '2026-09-10',
    occurredAt: null,
    partyInstanceId: 'ct_1',
    cashAccountInstanceId: null,
    paymentGatewayId: null,
    method: 'cash',
  }
})

describe('postMovementEntry', () => {
  it('posts and returns the accepted posting id', async () => {
    await expect(post()).resolves.toEqual({ status: 'accepted', glPostingId: 'gl_1' })
    const options = h.postEntry.mock.calls[0]![1]
    expect(options.entry.postingType).toBe('payment')
    expect(options.entry.periodKey).toBe(movementPeriodKey('payment', MOVEMENT))
    expect(options.railId).toBeNull()
    expect(options.sources).toEqual([
      { sourceKind: 'money_transaction', sourceId: MOVEMENT, linkRole: 'subject' },
      { sourceKind: 'invoice', sourceId: 'inv_1', linkRole: 'parent' },
      { sourceKind: 'contact', sourceId: 'ct_1', linkRole: 'counterparty' },
    ])
  })

  // What Retry on the Outbox's Blocked tab relies on: mapping the role and
  // posting again is the whole of clearing the mark (75-D1).
  it('clears the posting block once the ledger accepts', async () => {
    await expect(post()).resolves.toEqual({ status: 'accepted', glPostingId: 'gl_1' })
    expect(h.marks).toEqual([{ postingBlockedReason: null, postingBlockedAt: null }])
  })

  it('answers accepted when the movement already holds a live posting', async () => {
    h.findLiveSubjectPosting.mockResolvedValue(ok({ id: 'gl_old', txnDate: '2026-09-01' }))
    await expect(post()).resolves.toEqual({ status: 'accepted', glPostingId: 'gl_old' })
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('answers drafted and clears the block when the avenue posts with autoPost off', async () => {
    h.postEntry.mockResolvedValue({ status: 'drafted', glPostingId: 'gl_draft' })
    await expect(post()).resolves.toEqual({ status: 'drafted', glPostingId: 'gl_draft' })
    // A draft is not a refusal: the block clears, and the draft's own `pending`
    // link is what the next sweep finds.
    expect(h.marks).toEqual([{ postingBlockedReason: null, postingBlockedAt: null }])
  })

  it('answers drafted without building again while the movement waits on a live draft', async () => {
    h.draft = 'gl_draft'
    await expect(post()).resolves.toEqual({ status: 'drafted', glPostingId: 'gl_draft' })
    expect(h.postEntry).not.toHaveBeenCalled()
    expect(h.marks).toEqual([])
  })

  it('skips when accounting is not enabled', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)
    await expect(post()).resolves.toEqual({
      status: 'skipped',
      reason: 'Accounting is not enabled',
    })
  })

  it('blocks when setup is not finalized', async () => {
    h.settings['accounting.setupState'] = 'draft'
    const result = await post()
    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toMatch(/Finalize accounting setup/)
  })

  it('blocks when the entry falls on or before the opening cutoff', async () => {
    h.settings['accounting.cutoffPeriod'] = '2026-09'
    const result = await post()
    expect(result).toEqual({
      status: 'blocked',
      reason: 'Invoice receipt is before the accounting opening cutoff 2026-09',
    })
  })

  it('blocks a non-USD movement', async () => {
    ;(h.money as { currency: string }).currency = 'EUR'
    await expect(post()).resolves.toEqual({
      status: 'blocked',
      reason: 'Invoice receipt requires a confirmed USD amount',
    })
  })

  it('blocks when the ledger refuses', async () => {
    h.postEntry.mockResolvedValue({ status: 'period_closed', error: 'September is closed' })
    await expect(post()).resolves.toEqual({ status: 'blocked', reason: 'September is closed' })
  })

  it('blocks when the live-posting read fails', async () => {
    h.findLiveSubjectPosting.mockResolvedValue(err(new Error('boom')))
    await expect(post()).resolves.toEqual({ status: 'blocked', reason: 'boom' })
  })

  it('stamps the rail inside the transaction and resolves the endpoint from it', async () => {
    h.resolveCashEndpoint.mockResolvedValue({
      glAccountId: 'gl_clearing',
      kind: 'clearing',
      railId: 'pg_1',
    })
    await post(async (_tx, loaded) => {
      await (loaded as unknown as { stampGateway: (id: string) => Promise<void> }).stampGateway(
        'pg_1'
      )
      return defaultPrepare(_tx, loaded)
    })
    expect(h.updates).toEqual([{ paymentGatewayId: 'pg_1' }])
    expect(h.resolveCashEndpoint.mock.calls[0]![2]).toEqual({
      paymentGatewayId: 'pg_1',
      cashAccountInstanceId: null,
      currency: 'USD',
    })
    const options = h.postEntry.mock.calls[0]![1]
    expect(options.railId).toBe('pg_1')
    expect(options.scope).toEqual({ rail: 'pg_1' })
  })

  it('keys a refund on its own movement and posts the refund type', async () => {
    ;(h.money as { purpose: string }).purpose = 'customer_refund'
    await postMovementEntry(db(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
      purpose: 'customer_refund',
      label: 'Customer refund',
      prepare: defaultPrepare,
    })
    const options = h.postEntry.mock.calls[0]![1]
    expect(options.entry.postingType).toBe('refund')
    expect(options.entry.periodKey).toBe(movementPeriodKey('refund', MOVEMENT))
    expect(h.readAutoPostMode).toHaveBeenCalledWith(ORG, 'refund')
  })

  it('rethrows a non-AuxxError', async () => {
    h.resolveCashEndpoint.mockRejectedValue(new TypeError('programmer error'))
    await expect(post()).rejects.toThrow('programmer error')
  })

  it('marks the movement blocked with the reason, and clears it on a later accept', async () => {
    h.postEntry.mockResolvedValue({ status: 'period_closed', error: 'September is closed' })
    await post()
    expect(h.marks).toEqual([
      { postingBlockedReason: 'September is closed', postingBlockedAt: expect.any(Date) },
    ])

    h.marks = []
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gl_1' })
    await post()
    expect(h.marks).toEqual([{ postingBlockedReason: null, postingBlockedAt: null }])
  })

  it('marks a refusal raised by prepare too', async () => {
    await post(async () => {
      throw new UnprocessableEntityError('no applications')
    })
    expect(h.marks).toEqual([
      { postingBlockedReason: 'no applications', postingBlockedAt: expect.any(Date) },
    ])
  })

  it('blocks on an AuxxError raised by prepare', async () => {
    await expect(
      post(async () => {
        throw new UnprocessableEntityError('no applications')
      })
    ).resolves.toEqual({ status: 'blocked', reason: 'no applications' })
  })
})
