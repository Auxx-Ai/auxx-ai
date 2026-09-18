// packages/lib/src/accounting/banking/feed/__tests__/coverage.test.ts
//
// The stored coverage floor.
//
// 🛑 `refreshBankAccountCoverage` only ever moves the floor EARLIER, so a wrong
// floor is STICKY: nothing later can take it back, and the account then claims
// coverage over a hole a balance sheet will render across happily and silently.
// The one way to get a wrong floor is to count a line that is not there any more
// - an archived row from a reversed import, or a duplicate the feed converged
// away - which leaves its `FieldValue` cells behind.

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  crudUpdate: vi.fn(),
  /** One entry per `db.select(...)`, in order: the chain methods it used. */
  paths: [] as string[][],
  /** What each successive select resolves to. */
  results: [] as unknown[][],
}))

vi.mock('../../../../cache', () => ({ getOrgCache: () => ({ get: async () => 'system_user' }) }))
vi.mock('../../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = h.crudUpdate
  },
}))
vi.mock('../../fields', () => ({
  loadBankAccountFieldContext: async () => ({
    defId: 'def_ba',
    fields: {
      bank_account_connector_id: { id: 'f_connector', type: 'TEXT' },
      bank_account_coverage_from: { id: 'f_coverage', type: 'DATE' },
    },
  }),
  loadBankTransactionFieldContext: async () => ({
    defId: 'def_bt',
    fields: {
      bank_transaction_bank_account: { id: 'f_link', type: 'RELATIONSHIP' },
      bank_transaction_posted_at: { id: 'f_date', type: 'DATE' },
    },
  }),
}))

const { refreshBankAccountCoverage } = await import('../coverage')

const predicates: unknown[] = []

/** Records the chain each select used and hands back the queued result. */
function fakeDb() {
  return {
    select: () => {
      const path: string[] = []
      h.paths.push(path)
      const rows = h.results[h.paths.length - 1] ?? []
      const stage = (): Record<string, unknown> => ({
        from: () => {
          path.push('from')
          return stage()
        },
        innerJoin: () => {
          path.push('innerJoin')
          return stage()
        },
        where: (predicate: unknown) => {
          path.push('where')
          predicates.push(predicate)
          // The values read chains `.orderBy(sortKey)`; the others await here.
          return Object.assign(Promise.resolve(rows), { orderBy: () => Promise.resolve(rows) })
        },
      })
      return stage()
    },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.paths = []
  predicates.length = 0
  h.results = [
    // 1: the accounts this connector feeds
    [{ entityId: 'acct_1' }],
    // 2: those account instances
    [{ id: 'acct_1', createdAt: null, updatedAt: null, archivedAt: null }],
    // 3: their cells, carrying the stored coverage floor
    [
      {
        entityId: 'acct_1',
        fieldId: 'f_coverage',
        sortKey: 'a',
        valueDate: '2026-03-01T00:00:00.000Z',
      },
    ],
    // 4: the LINKED transaction cells
    [{ entityId: 'txn_1' }],
    // 5: the live transaction instances - the query this test is about
    [{ id: 'txn_1', createdAt: null, updatedAt: null, archivedAt: null }],
    // 6: their cells
    [
      {
        entityId: 'txn_1',
        fieldId: 'f_date',
        sortKey: 'a',
        valueDate: '2026-01-04T00:00:00.000Z',
      },
    ],
  ]
})

describe('refreshBankAccountCoverage', () => {
  it('🛑 excludes ARCHIVED lines when finding the earliest date', async () => {
    // Without the filter, a reversed import's leftover cells drag the floor back
    // to a date the account no longer holds - and the floor never comes forward.
    await refreshBankAccountCoverage(fakeDb(), {
      organizationId: 'org_1',
      connectorId: 'conn_1',
    })
    // Query 5 is the transaction instances behind the linked cells.
    expect(new PgDialect().sqlToQuery(predicates[4] as never).sql).toContain('is null')
  })

  it('moves the floor earlier and says so', async () => {
    const moved = await refreshBankAccountCoverage(fakeDb(), {
      organizationId: 'org_1',
      connectorId: 'conn_1',
    })
    expect(moved).toBe(1)
    expect(h.crudUpdate).toHaveBeenCalledWith('def_ba:acct_1', {
      bank_account_coverage_from: '2026-01-04',
    })
  })

  it('never moves the floor LATER, however little the last sync saw', async () => {
    // Stripe reaches back up to 180 days and the window accumulates from there,
    // so a sync that only sees this week must not claim coverage begins now.
    h.results[2] = [
      {
        entityId: 'acct_1',
        fieldId: 'f_coverage',
        sortKey: 'a',
        valueDate: '2025-06-01T00:00:00.000Z',
      },
    ]
    const moved = await refreshBankAccountCoverage(fakeDb(), {
      organizationId: 'org_1',
      connectorId: 'conn_1',
    })
    expect(moved).toBe(0)
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })

  it('writes nothing when the account holds no dated line at all', async () => {
    h.results[5] = []
    expect(
      await refreshBankAccountCoverage(fakeDb(), { organizationId: 'org_1', connectorId: 'conn_1' })
    ).toBe(0)
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })
})
