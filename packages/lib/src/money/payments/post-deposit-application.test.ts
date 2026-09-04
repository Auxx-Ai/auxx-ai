// packages/lib/src/money/payments/post-deposit-application.test.ts
//
// 🛑 One property carries this file: **the held balance is read back out of the
// LEDGER, never stored on a column.**
//
// The receipt entry credits `accounts_receivable` for whatever was allocated
// when the money arrived, and every posted `deposit_application` credits it for
// what has been reclassed since. What is left is what is still sitting in
// `2350`. Reading it rather than storing it is what makes the ordinary invoice
// payment a no-op with no special case - its allocation was already in place
// when the receipt posted, so nothing is held and nothing is reclassed - and it
// is what makes a second `syncTransaction` idempotent without a lock.
//
// The second property is the ordering: a refusal STOPS the loop. The held
// balance is shared across the allocations, so carrying on after a refusal
// would reclass a later allocation out of a balance the refused one still
// holds, and a retry would then over-reclass.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** `accounts_receivable` lines already in the books for this transaction. */
  receivableLines: [] as Array<{ direction: string; amountMinor: number }>,
  /** `deposit_application` period keys this org has already claimed. */
  claimedKeys: [] as Array<{ periodKey: string }>,
  allocations: [] as Array<{
    id: string
    amount: number
    appliedAt: string
    invoiceInstanceId: string
  }>,
  postResults: [] as Array<{ status: string; error?: string }>,
  posted: [] as Array<{ periodKey: string; txnDate: string; totalMinor: number }>,
}))

function tableProxy(name: string) {
  return new Proxy(
    {},
    { get: (_target, key) => (key === '__name' ? name : `${name}.${String(key)}`) }
  )
}

vi.mock('@auxx/database', () => {
  const rowsFor = (name: string) => {
    if (name === 'GlPostingLine') return h.receivableLines
    if (name === 'GlPosting') return h.claimedKeys
    if (name === 'PaymentAllocation') return h.allocations
    return []
  }
  const builder = () => {
    let table = ''
    const chain: Record<string, unknown> = {}
    for (const key of ['innerJoin', 'where', 'orderBy', 'limit']) {
      chain[key] = () => chain
    }
    chain.from = (target: { __name: string }) => {
      table = target.__name
      return chain
    }
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(rowsFor(table)).then(resolve)
    return chain
  }
  return {
    database: { select: () => builder() },
    schema: new Proxy({}, { get: (_target, table) => tableProxy(String(table)) }),
  }
})

vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: async () => 'America/New_York',
}))
vi.mock('../../postings/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))
vi.mock('../../postings/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntry: async (
    _db: unknown,
    options: { entry: { periodKey: string; txnDate: string; totalDebit: number } }
  ) => {
    h.posted.push({
      periodKey: options.entry.periodKey,
      txnDate: options.entry.txnDate,
      totalMinor: options.entry.totalDebit,
    })
    return h.postResults.shift() ?? { status: 'posted' }
  },
}))

const { postDepositApplications } = await import('./post-deposit-application')
const { depositApplicationPeriodKey } = await import(
  '../../postings/build-deposit-application-entry'
)

const ORG = 'org-1'

function charge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-1',
    organizationId: ORG,
    kind: 'charge',
    status: 'succeeded',
    amount: 1_000_000,
    ...overrides,
  } as never
}

beforeEach(() => {
  h.receivableLines = []
  h.claimedKeys = []
  h.allocations = []
  h.postResults = []
  h.posted = []
})

describe('a held deposit later applied to an invoice', () => {
  beforeEach(async () => {
    // The receipt entry credited nothing to accounts receivable: on the day the
    // money arrived, none of it was owed.
    h.receivableLines = []
    h.allocations = [
      {
        id: 'alloc-1',
        amount: 300_000,
        appliedAt: '2026-09-04T15:00:00.000Z',
        invoiceInstanceId: 'inv-1',
      },
    ]
  })

  it('posts one reclass keyed on the allocation, for the allocated amount', async () => {
    const { database } = await import('@auxx/database')
    const results = await postDepositApplications(database, {
      organizationId: ORG,
      transaction: charge(),
    })

    expect(results).toHaveLength(1)
    expect(h.posted).toHaveLength(1)
    expect(h.posted[0]?.periodKey).toBe(depositApplicationPeriodKey('alloc-1'))
    expect(h.posted[0]?.totalMinor).toBe(300_000)
  })

  it("dates the entry on the allocation's own day in the book time zone", async () => {
    const { database } = await import('@auxx/database')
    await postDepositApplications(database, { organizationId: ORG, transaction: charge() })
    // 15:00Z on the 4th is still the 4th in New York; the point is that the
    // date comes from the ALLOCATION, not from the deposit's receipt date.
    expect(h.posted[0]?.txnDate).toBe('2026-09-04')
  })

  it('posts nothing on a second run, because the key is already claimed', async () => {
    const { database } = await import('@auxx/database')
    h.claimedKeys = [{ periodKey: depositApplicationPeriodKey('alloc-1') }]

    const results = await postDepositApplications(database, {
      organizationId: ORG,
      transaction: charge(),
    })
    expect(results).toEqual([])
    expect(h.posted).toEqual([])
  })
})

describe('an ordinary invoice payment', () => {
  it('reclasses nothing, because the receipt already credited the receivable', async () => {
    const { database } = await import('@auxx/database')
    // The allocation was in place before the receipt posted, so the whole
    // amount relieved a receivable and nothing was ever held.
    h.receivableLines = [{ direction: 'credit', amountMinor: 1_000_000 }]
    h.allocations = [
      {
        id: 'alloc-1',
        amount: 1_000_000,
        appliedAt: '2026-09-04T12:00:00.000Z',
        invoiceInstanceId: 'inv-1',
      },
    ]

    const results = await postDepositApplications(database, {
      organizationId: ORG,
      transaction: charge(),
    })
    expect(results).toEqual([])
    expect(h.posted).toEqual([])
  })
})

describe('a partly applied deposit', () => {
  it('reclasses only what is left held, and stops at zero', async () => {
    const { database } = await import('@auxx/database')
    // 400,000 of the 1,000,000 has already been reclassed by an earlier entry.
    h.receivableLines = [{ direction: 'credit', amountMinor: 400_000 }]
    h.allocations = [
      {
        id: 'alloc-2',
        amount: 400_000,
        appliedAt: '2026-09-05T12:00:00.000Z',
        invoiceInstanceId: 'inv-2',
      },
      {
        id: 'alloc-3',
        amount: 900_000,
        appliedAt: '2026-09-06T12:00:00.000Z',
        invoiceInstanceId: 'inv-3',
      },
    ]

    await postDepositApplications(database, { organizationId: ORG, transaction: charge() })

    // 600,000 was held. The first allocation takes 400,000; the second is
    // capped at the 200,000 that is left rather than its own 900,000.
    expect(h.posted.map((entry) => entry.totalMinor)).toEqual([400_000, 200_000])
  })

  it('nets a reversal out rather than reporting more held than was received', async () => {
    const { database } = await import('@auxx/database')
    // A receipt that credited 250,000 and was then reversed: the pair cancels,
    // so the whole amount is held again. Counting only the reversal's debit
    // would report 1,250,000 held on a 1,000,000 payment.
    h.receivableLines = [
      { direction: 'credit', amountMinor: 250_000 },
      { direction: 'debit', amountMinor: 250_000 },
    ]
    h.allocations = [
      {
        id: 'alloc-4',
        amount: 1_000_000,
        appliedAt: '2026-09-07T12:00:00.000Z',
        invoiceInstanceId: 'inv-4',
      },
    ]

    await postDepositApplications(database, { organizationId: ORG, transaction: charge() })
    expect(h.posted.map((entry) => entry.totalMinor)).toEqual([1_000_000])
  })
})

describe('what it refuses to touch', () => {
  it('posts nothing for a refund, whose receipt already debited the right account', async () => {
    const { database } = await import('@auxx/database')
    h.allocations = [
      {
        id: 'alloc-5',
        amount: 100_000,
        appliedAt: '2026-09-08T12:00:00.000Z',
        invoiceInstanceId: 'inv-5',
      },
    ]
    const results = await postDepositApplications(database, {
      organizationId: ORG,
      transaction: charge({ kind: 'refund' }),
    })
    expect(results).toEqual([])
    expect(h.posted).toEqual([])
  })

  it('posts nothing for a transaction that moved no money', async () => {
    const { database } = await import('@auxx/database')
    h.allocations = [
      {
        id: 'alloc-6',
        amount: 100_000,
        appliedAt: '2026-09-08T12:00:00.000Z',
        invoiceInstanceId: 'inv-6',
      },
    ]
    const results = await postDepositApplications(database, {
      organizationId: ORG,
      transaction: charge({ status: 'failed' }),
    })
    expect(results).toEqual([])
  })
})

describe('a refusal', () => {
  it('stops the loop rather than reclassing the next allocation out of a held balance the refused one still holds', async () => {
    const { database } = await import('@auxx/database')
    h.allocations = [
      {
        id: 'alloc-7',
        amount: 300_000,
        appliedAt: '2026-09-09T12:00:00.000Z',
        invoiceInstanceId: 'inv-7',
      },
      {
        id: 'alloc-8',
        amount: 300_000,
        appliedAt: '2026-09-10T12:00:00.000Z',
        invoiceInstanceId: 'inv-8',
      },
    ]
    h.postResults = [{ status: 'period_closed', error: 'September is closed.' }]

    const results = await postDepositApplications(database, {
      organizationId: ORG,
      transaction: charge(),
    })

    expect(h.posted).toHaveLength(1)
    expect(results.map((result) => result.status)).toEqual(['period_closed'])
  })

  it('never throws, so a deposit application cannot fail because its bookkeeping did', async () => {
    const { database } = await import('@auxx/database')
    h.allocations = [
      // A zero-amount allocation makes the builder throw. The writer has to
      // absorb it and answer with a result.
      {
        id: 'alloc-9',
        amount: 0,
        appliedAt: '2026-09-11T12:00:00.000Z',
        invoiceInstanceId: 'inv-9',
      },
    ]
    const results = await postDepositApplications(database, {
      organizationId: ORG,
      transaction: charge(),
    })
    expect(results).toEqual([])
  })
})
