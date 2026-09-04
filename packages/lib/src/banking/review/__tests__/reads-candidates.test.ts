// packages/lib/src/banking/review/__tests__/reads-candidates.test.ts
//
// 🛑 One property carries this file: **a customer payment that is already
// matched to a bank line says so, and it says so from a COLUMN** (drizzle 0363).
//
// `matchedToBankTransactionId` is what the match panel greys a candidate out on.
// Before the column existed the pointer lived in `PaymentTransaction.metadata`,
// and the day it moved, a reader left behind on the blob would answer `null` for
// every payment forever: every already-matched payment would be offered as a
// fresh candidate, and the only thing standing between that and a double-matched
// receipt would be `readDocumentLink`'s refusal at write time - a refusal the
// person only meets after choosing.
//
// The second property is the one that is easy to break by tidying: **the
// accounting date is STILL read out of `metadata.date`**. Only three keys moved
// out of that blob, and `date` was not one of them.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Rows any `select().from(PaymentTransaction)` resolves to. */
  paymentRows: [] as Record<string, unknown>[],
  /** Rows any `select().from(FieldValue)` resolves to - the bank line's own values. */
  fieldValueRows: [] as Record<string, unknown>[],
}))

/** A table stub whose column reads answer `"<Table>.<column>"` and that names itself. */
function tableProxy(name: string) {
  return new Proxy(
    {},
    { get: (_target, key) => (key === '__name' ? name : `${name}.${String(key)}`) }
  )
}

const DEF_ID = 'def_bt'
const LINE_ID = 'txn_1'

const FIELDS = {
  bank_transaction_external_id: { id: 'f_ext' },
  bank_transaction_bank_account: { id: 'f_acct' },
  bank_transaction_posted_at: { id: 'f_posted' },
  bank_transaction_description: { id: 'f_desc' },
  bank_transaction_amount: { id: 'f_amount' },
  bank_transaction_bank_status: { id: 'f_bank_status' },
  bank_transaction_match_key: { id: 'f_key' },
  bank_transaction_source: { id: 'f_source' },
  bank_transaction_import_batch_id: { id: 'f_batch' },
  bank_transaction_review_status: { id: 'f_review' },
  bank_transaction_gl_account: { id: 'f_gl' },
  bank_transaction_matched_record_id: { id: 'f_matched_id' },
  bank_transaction_matched_record_type: { id: 'f_matched_type' },
  bank_transaction_exclude_reason: { id: 'f_exclude' },
  bank_transaction_reviewed_at: { id: 'f_reviewed_at' },
  bank_transaction_reviewed_by_user_id: { id: 'f_reviewed_by' },
  bank_transaction_gl_posting_id: { id: 'f_posting' },
  bank_transaction_rule_id: { id: 'f_rule' },
} as Record<string, { id: string }>

vi.mock('@auxx/database', () => {
  const rowsFor = (name: string) => {
    if (name === 'PaymentTransaction') return h.paymentRows
    if (name === 'FieldValue') return h.fieldValueRows
    if (name === 'EntityInstance') return [{ id: LINE_ID, createdAt: new Date('2026-09-10') }]
    // `CustomField` (3C's suggestion fields) and everything else: nothing.
    return []
  }
  const builder = () => {
    let table = ''
    const chain: Record<string, unknown> = {}
    for (const key of ['innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'groupBy']) {
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

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: async () => DEF_ID,
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((attr) => [attr, FIELDS[attr] ?? null])),
    }),
  }),
}))

vi.mock('../../reads', () => ({
  listBankAccounts: async () => ({ isOk: () => true, isErr: () => false, value: [] }),
  readCoverage: async () => ({ isOk: () => true, isErr: () => false, value: null }),
}))

const { listMatchCandidates } = await import('../reads')
const { database } = await import('@auxx/database')

const ORG = 'org_1'

/** The bank line under review: money IN, 555.00, on 2026-09-10. */
function bankLineValues() {
  return [
    { entityId: LINE_ID, fieldId: 'f_amount', valueNumber: 55_500 },
    { entityId: LINE_ID, fieldId: 'f_posted', valueDate: '2026-09-10T00:00:00.000Z' },
    { entityId: LINE_ID, fieldId: 'f_review', optionId: 'for_review' },
    { entityId: LINE_ID, fieldId: 'f_bank_status', optionId: 'posted' },
  ]
}

function payment(over: Record<string, unknown> = {}) {
  return {
    id: 'pt_1',
    amount: 55_500,
    method: 'check',
    reference: 'CHQ-8811',
    createdAt: new Date('2026-09-10T12:00:00.000Z'),
    bankTransactionId: null,
    metadata: null,
    ...over,
  }
}

async function candidates() {
  const result = await listMatchCandidates(database, {
    organizationId: ORG,
    transactionId: LINE_ID,
  })
  if (result.isErr()) throw result.error
  return result.value.filter((candidate) => candidate.recordType === 'payment_transaction')
}

beforeEach(() => {
  h.fieldValueRows = bankLineValues()
  h.paymentRows = []
})

describe('matchedToBankTransactionId', () => {
  it('is null for a payment nothing has claimed', async () => {
    h.paymentRows = [payment()]
    const found = await candidates()
    expect(found).toHaveLength(1)
    expect(found[0]?.matchedToBankTransactionId).toBeNull()
  })

  it('names the bank line from the COLUMN, not from metadata', async () => {
    h.paymentRows = [payment({ bankTransactionId: 'txn_other' })]
    const found = await candidates()
    expect(found[0]?.matchedToBankTransactionId).toBe('txn_other')
  })

  it('ignores a stale pointer left behind in the blob', async () => {
    // 🛑 The migration strips these keys, so a row still carrying one is a row
    // that predates it or was written by something that should not have. The
    // column is the only authority; reading the blob as a fallback would
    // resurrect exactly the two-places-to-look problem the move removed.
    h.paymentRows = [payment({ metadata: { bankTransactionId: 'txn_stale' } })]
    const found = await candidates()
    expect(found[0]?.matchedToBankTransactionId).toBeNull()
  })
})

describe('the accounting date did NOT move out of metadata', () => {
  it('prefers the user-picked metadata.date over the row createdAt', async () => {
    // `createdAt` is when the row was KEYED. A backdated cheque is entered days
    // late and must still match the bank line on the day it was written, which
    // is the same rule `postPaymentTransaction` applies when it dates the entry.
    h.paymentRows = [
      payment({ metadata: { date: '2026-09-09' }, createdAt: new Date('2026-09-30T12:00:00Z') }),
    ]
    const found = await candidates()
    expect(found[0]?.dateKey).toBe('2026-09-09')
  })

  it('falls back to createdAt when no date was picked', async () => {
    h.paymentRows = [payment({ metadata: null })]
    const found = await candidates()
    expect(found[0]?.dateKey).toBe('2026-09-10')
  })
})
