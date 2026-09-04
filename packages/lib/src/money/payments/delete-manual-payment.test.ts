// packages/lib/src/money/payments/delete-manual-payment.test.ts
//
// 🛑 One property carries this file: **deleting a manual payment must back its
// general ledger entry out of the books first** (HANDOFF §2 ground rule 6,
// "correct by reversal, never by edit").
//
// `syncTransaction` posts `Dr undeposited_funds Cr accounts_receivable` for
// every succeeded charge. Deleting the `PaymentTransaction` row without
// reversing that leaves the entry standing forever against a `sourceId` that no
// longer resolves: accounts receivable stays reduced by a cheque that does not
// exist, and undeposited funds carries a balance no bank deposit can ever clear,
// because the cheque it names is gone. Both halves balance and the trial balance
// still ties, so nothing downstream can detect it.
//
// The second property is the refusal: when the ledger will not TAKE the reversal
// (a closed period, a chart that moved under the entry), the delete is refused
// and nothing at all is written. A half-done delete here is worse than no
// delete, because the row that explains the entry is the thing being removed.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  transaction: null as Record<string, unknown> | null,
  allocations: [] as Array<Record<string, unknown>>,
  postings: [] as Array<{
    glPostingId: string
    docNumber: string
    status: string
    postingType: string
  }>,
  reverseResults: [] as Array<{ status: string; error?: string }>,
  /** Every call, in order, so "reversed BEFORE deleted" is assertable. */
  calls: [] as string[],
  reversedIds: [] as string[],
  deletedMirrors: [] as string[],
}))

vi.mock('@auxx/database', () => {
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'innerJoin', 'where', 'limit', 'groupBy', 'set']) {
    chain[key] = () => chain
  }
  // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve)
  return {
    database: {
      query: {
        PaymentTransaction: { findFirst: async () => h.transaction },
        PaymentAllocation: { findMany: async () => h.allocations },
      },
      select: () => chain,
      update: () => chain,
      delete: () => ({
        where: () => {
          h.calls.push('delete-transaction')
          return Promise.resolve([])
        },
      }),
    },
    schema: new Proxy(
      {},
      { get: (_t, table) => new Proxy({}, { get: (_c, col) => `${String(table)}.${String(col)}` }) }
    ),
  }
})

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: async () => ({}) }) }),
}))
vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    async getFieldValues() {
      return new Map()
    }
    async delete(recordId: string) {
      h.calls.push('delete-mirror')
      h.deletedMirrors.push(recordId)
    }
  },
}))
vi.mock('../../field-values/field-value-service', () => ({
  FieldValueService: class {
    async setValuesForEntity() {}
  },
}))
vi.mock('../../settings/settings-service', () => ({ getOrganizationSetting: async () => 'USD' }))
vi.mock('../../postings/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))
vi.mock('../../postings/reverse-entry', () => ({
  reverseEntry: async (_db: unknown, options: { glPostingId: string }) => {
    h.calls.push('reverse')
    h.reversedIds.push(options.glPostingId)
    return h.reverseResults.shift() ?? { status: 'posted' }
  },
}))
vi.mock('./post-transaction', () => ({
  postPaymentTransaction: async () => ({ status: 'posted' }),
  listPaymentPostings: async () => h.postings,
}))
vi.mock('./post-deposit-application', () => ({ postDepositApplications: async () => [] }))

const { deleteManualPayment } = await import('./ledger')
const { ConflictError, ForbiddenError } = await import('../../errors')

const ORG = 'org-1'
const USER = 'user-1'
const TXN = 'txn-1'

function manualCharge(overrides: Record<string, unknown> = {}) {
  return { id: TXN, organizationId: ORG, provider: 'manual', kind: 'charge', ...overrides }
}

const input = { organizationId: ORG, userId: USER, transactionId: TXN }

beforeEach(() => {
  h.transaction = manualCharge()
  h.allocations = [{ id: 'alloc-1', invoiceInstanceId: 'inv-1', paymentInstanceId: 'pay-1' }]
  h.postings = []
  h.reverseResults = []
  h.calls = []
  h.reversedIds = []
  h.deletedMirrors = []
})

describe('deleteManualPayment - the ledger comes out first', () => {
  it('reverses the payment entry BEFORE deleting the row it explains', async () => {
    h.postings = [
      {
        glPostingId: 'glp-1',
        docNumber: 'AUXX-PMT-ABC123',
        status: 'posted',
        postingType: 'payment',
      },
    ]

    await deleteManualPayment(input)

    expect(h.reversedIds).toEqual(['glp-1'])
    // Order matters: a refused reversal must leave the row intact, which is only
    // true while the reversal is attempted first.
    expect(h.calls.indexOf('reverse')).toBeLessThan(h.calls.indexOf('delete-mirror'))
    expect(h.calls.indexOf('reverse')).toBeLessThan(h.calls.indexOf('delete-transaction'))
    expect(h.calls).toContain('delete-transaction')
  })

  it('reverses every entry the transaction produced, not just the first', async () => {
    h.postings = [
      {
        glPostingId: 'glp-1',
        docNumber: 'AUXX-PMT-AAA111',
        status: 'posted',
        postingType: 'payment',
      },
      {
        glPostingId: 'glp-2',
        docNumber: 'AUXX-PMT-BBB222',
        status: 'posted',
        postingType: 'payment',
      },
    ]
    await deleteManualPayment(input)
    expect(h.reversedIds).toEqual(['glp-1', 'glp-2'])
  })

  // 🛑 The reclass debits `customer_deposits` against a liability the receipt
  // raised, so backing the receipt out first leaves the reclass standing on a
  // liability that no longer exists: `2350` ends negative by the applied amount
  // and the receivable ends over-relieved, both with balanced entries. Undoing a
  // pair of entries is undoing them in the opposite order they were made.
  it('reverses a deposit application BEFORE the receipt entry it reclassed', async () => {
    h.postings = [
      {
        glPostingId: 'glp-receipt',
        docNumber: 'AUXX-PMT-AAA111',
        status: 'posted',
        postingType: 'payment',
      },
      {
        glPostingId: 'glp-reclass',
        docNumber: 'AUXX-DPA-BBB222',
        status: 'posted',
        postingType: 'deposit_application',
      },
    ]
    await deleteManualPayment(input)
    expect(h.reversedIds).toEqual(['glp-reclass', 'glp-receipt'])
  })

  it('deletes cleanly when the payment never reached the ledger', async () => {
    h.postings = []
    await deleteManualPayment(input)
    expect(h.reversedIds).toEqual([])
    expect(h.calls).toContain('delete-transaction')
  })

  // A `reversed` entry has been backed out already and reversing it again would
  // double the correction; a `failed` one never reached the ledger at all.
  it('skips entries that are already reversed or never posted', async () => {
    h.postings = [
      {
        glPostingId: 'glp-1',
        docNumber: 'AUXX-PMT-AAA111',
        status: 'reversed',
        postingType: 'payment',
      },
      {
        glPostingId: 'glp-2',
        docNumber: 'AUXX-PMT-BBB222',
        status: 'failed',
        postingType: 'payment',
      },
    ]
    await deleteManualPayment(input)
    expect(h.reversedIds).toEqual([])
    expect(h.calls).toContain('delete-transaction')
  })
})

describe('deleteManualPayment - a reversal the ledger refuses refuses the delete', () => {
  it('throws naming the document number and writes nothing', async () => {
    h.postings = [
      {
        glPostingId: 'glp-1',
        docNumber: 'AUXX-PMT-ABC123',
        status: 'posted',
        postingType: 'payment',
      },
    ]
    h.reverseResults = [{ status: 'period_closed', error: 'August is closed.' }]

    await expect(deleteManualPayment(input)).rejects.toBeInstanceOf(ConflictError)
    expect(h.calls).not.toContain('delete-transaction')
    expect(h.calls).not.toContain('delete-mirror')
  })

  it('names the entry and the reversal path in the message', async () => {
    h.postings = [
      {
        glPostingId: 'glp-1',
        docNumber: 'AUXX-PMT-ABC123',
        status: 'posted',
        postingType: 'payment',
      },
    ]
    h.reverseResults = [{ status: 'period_closed', error: 'August is closed.' }]

    await expect(deleteManualPayment(input)).rejects.toThrow(/AUXX-PMT-ABC123/)
  })

  // `not_connected` is a first-class success everywhere else in this subsystem:
  // an org with no accounting provider still builds, balances and persists the
  // reversal. Treating it as a refusal would make the delete impossible there.
  it('treats an unconnected ledger as a taken reversal', async () => {
    h.postings = [
      {
        glPostingId: 'glp-1',
        docNumber: 'AUXX-PMT-ABC123',
        status: 'posted',
        postingType: 'payment',
      },
    ]
    h.reverseResults = [{ status: 'not_connected' }]

    await deleteManualPayment(input)
    expect(h.calls).toContain('delete-transaction')
  })

  it('still refuses a Stripe row before it ever looks at the ledger', async () => {
    h.transaction = manualCharge({ provider: 'stripe' })
    h.postings = [
      {
        glPostingId: 'glp-1',
        docNumber: 'AUXX-PMT-ABC123',
        status: 'posted',
        postingType: 'payment',
      },
    ]

    await expect(deleteManualPayment(input)).rejects.toBeInstanceOf(ForbiddenError)
    expect(h.reversedIds).toEqual([])
  })
})
