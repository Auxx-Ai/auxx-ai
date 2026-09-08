// packages/lib/src/banking/import/__tests__/reverse-keeps-has-posted.test.ts

/**
 * 🛑 `reverseImport` never clears `bank_account_has_posted`
 * (plans/bank-connection/08-removing-a-bank-account.md §5.1, §8).
 *
 * The third of the three undo paths the removal gate has to survive - the other
 * two, `undoReview` and the posting reversal it performs, are pinned in
 * `review/__tests__/writes.test.ts`.
 *
 * Reversing an import can take an account down to zero rows. What it cannot do is
 * take a journal entry out of the ledger: `refusalReason` refuses every row that
 * carries a posting or a match precisely because they are the source documents of
 * entries that stay in the books. So an account that has ever posted must still
 * archive rather than delete after a reverse, and the only way that holds is if
 * nothing on this path writes the flag.
 *
 * ⚠️ This path DOES write to the bank account - `recomputeAfterDelete` pulls
 * `coverageFrom` back to the earliest surviving row - so "it never touches the
 * account" would be the wrong assertion and would pass for the wrong reason. The
 * assertion is about the FIELD.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BankTransactionRow } from '../fields'

const h = vi.hoisted(() => ({
  crudUpdate: vi.fn(),
  crudDelete: vi.fn(),
  rows: [] as BankTransactionRow[],
  remaining: [] as BankTransactionRow[],
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = h.crudUpdate
    delete = h.crudDelete
  },
}))
vi.mock('../fields', () => ({
  requireBankTransactionImportContext: async () => ({
    bankTransactionDefId: 'def_bt',
    fields: {},
  }),
  readTransactionsByBatch: async () => h.rows,
  readTransactionsByAccount: async () => h.remaining,
}))
vi.mock('../../reads', () => ({
  requireBankAccountFieldContext: async () => ({ bankAccountDefId: 'def_ba', fields: {} }),
  getBankAccount: async () => ({
    isErr: () => false,
    isOk: () => true,
    // A coverage claim that no longer matches the surviving rows, so the
    // pull-back write really fires and the assertion below is not vacuous.
    value: { id: 'acct_1', name: 'Chequing', coverageFrom: '2026-01-01' },
  }),
  readCoverage: async () => ({
    isErr: () => false,
    isOk: () => true,
    value: { coverageFrom: null, gaps: [] },
  }),
}))

const { reverseImport } = await import('../reverse')

function row(over: Partial<BankTransactionRow> = {}): BankTransactionRow {
  return {
    id: 'txn_1',
    createdAt: null,
    externalId: 'bt-0001',
    bankAccountId: 'acct_1',
    postedAt: '2026-02-01',
    description: 'ACME SUPPLY CO',
    amountMinor: -12_450,
    matchKey: 'acme supply co',
    importBatchId: 'batch_1',
    source: 'import',
    reviewStatus: 'for_review',
    excludeReason: null,
    glPostingId: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.rows = []
  h.remaining = []
  h.crudUpdate.mockResolvedValue(undefined)
  h.crudDelete.mockResolvedValue(undefined)
})

describe('reverseImport and the removal gate', () => {
  it('writes no bank_account_has_posted, even while it rewrites coverageFrom', async () => {
    h.rows = [row({ id: 'txn_1' }), row({ id: 'txn_2', postedAt: '2026-02-02' })]

    const result = await reverseImport({} as never, {
      organizationId: 'org_1',
      actorUserId: 'user_1',
      importBatchId: 'batch_1',
    })

    expect(result.isOk()).toBe(true)
    // The account WAS written - this is the coverage pull-back, and it proves the
    // assertion below is looking at a path that really reaches the record.
    const accountWrites = h.crudUpdate.mock.calls.filter(([id]) => String(id).startsWith('def_ba:'))
    expect(accountWrites.length).toBeGreaterThan(0)
    for (const [, patch] of accountWrites) {
      expect(Object.keys((patch ?? {}) as object)).toEqual(['bank_account_coverage_from'])
    }
  })

  it('leaves the flag alone on a batch whose posted row it refuses', async () => {
    // The realistic shape: one line posted an entry, the rest did not. The posted
    // one is refused by name and the entry stays in the books, which is exactly
    // why the account may never become deletable again.
    h.rows = [
      row({ id: 'txn_1', glPostingId: 'post_1', reviewStatus: 'coded' }),
      row({ id: 'txn_2' }),
    ]
    h.remaining = [row({ id: 'txn_1', glPostingId: 'post_1', reviewStatus: 'coded' })]

    const result = await reverseImport({} as never, {
      organizationId: 'org_1',
      actorUserId: 'user_1',
      importBatchId: 'batch_1',
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.deleted).toBe(1)
      expect(result.value.refused).toHaveLength(1)
    }
    expect(
      h.crudUpdate.mock.calls.some(([, patch]) =>
        Object.hasOwn((patch ?? {}) as object, 'bank_account_has_posted')
      )
    ).toBe(false)
  })
})
