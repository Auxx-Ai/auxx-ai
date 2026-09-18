// packages/lib/src/accounting/banking/review/__tests__/reads-money-candidates.test.ts
//
// 🛑 A customer payment is matched from `MoneyTransaction`, never from an entity mirror: the
// money model mints none, so a reader looking for one could match nothing in either direction
// — and a refund, which is what an outflow line needs, least of all.
//
// The second property: a movement carries its date in ONE of two columns. `occurredOn` for a
// day somebody recorded, `occurredAt` for an instant a gateway observed. A reader that knows
// only one of them silently drops half the candidates.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fieldTypeOf } from '../../__tests__/support/field-stubs'

const h = vi.hoisted(() => ({
  moneyRows: [] as Record<string, unknown>[],
  fieldValueRows: [] as Record<string, unknown>[],
}))

function tableProxy(name: string) {
  return new Proxy(
    {},
    { get: (_target, key) => (key === '__name' ? name : `${name}.${String(key)}`) }
  )
}

const DEF_ID = 'def_bt'
const LINE_ID = 'txn_1'

const FIELDS: Record<string, { id: string; type: string }> = {
  bank_transaction_external_id: { id: 'f_ext', type: fieldTypeOf('bank_transaction_external_id') },
  bank_transaction_bank_account: {
    id: 'f_acct',
    type: fieldTypeOf('bank_transaction_bank_account'),
  },
  bank_transaction_posted_at: { id: 'f_posted', type: fieldTypeOf('bank_transaction_posted_at') },
  bank_transaction_description: { id: 'f_desc', type: fieldTypeOf('bank_transaction_description') },
  bank_transaction_amount: { id: 'f_amount', type: fieldTypeOf('bank_transaction_amount') },
  bank_transaction_bank_status: {
    id: 'f_bank_status',
    type: fieldTypeOf('bank_transaction_bank_status'),
  },
  bank_transaction_match_key: { id: 'f_key', type: fieldTypeOf('bank_transaction_match_key') },
  bank_transaction_source: { id: 'f_source', type: fieldTypeOf('bank_transaction_source') },
  bank_transaction_import_batch_id: {
    id: 'f_batch',
    type: fieldTypeOf('bank_transaction_import_batch_id'),
  },
  bank_transaction_review_status: {
    id: 'f_review',
    type: fieldTypeOf('bank_transaction_review_status'),
  },
  bank_transaction_gl_account: { id: 'f_gl', type: fieldTypeOf('bank_transaction_gl_account') },
  bank_transaction_matched_record_id: {
    id: 'f_matched_id',
    type: fieldTypeOf('bank_transaction_matched_record_id'),
  },
  bank_transaction_matched_record_type: {
    id: 'f_matched_type',
    type: fieldTypeOf('bank_transaction_matched_record_type'),
  },
  bank_transaction_exclude_reason: {
    id: 'f_exclude',
    type: fieldTypeOf('bank_transaction_exclude_reason'),
  },
  bank_transaction_reviewed_at: {
    id: 'f_reviewed_at',
    type: fieldTypeOf('bank_transaction_reviewed_at'),
  },
  bank_transaction_reviewed_by_user_id: {
    id: 'f_reviewed_by',
    type: fieldTypeOf('bank_transaction_reviewed_by_user_id'),
  },
  bank_transaction_rule_id: { id: 'f_rule', type: fieldTypeOf('bank_transaction_rule_id') },
}

vi.mock('@auxx/database', () => {
  const rowsFor = (name: string) => {
    if (name === 'MoneyTransaction') return h.moneyRows
    if (name === 'FieldValue') return h.fieldValueRows
    if (name === 'EntityInstance') return [{ id: LINE_ID, createdAt: new Date('2026-09-10') }]
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

vi.mock('../../../../cache', () => ({
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

/** The bank line under review: money IN, 555.00, on 2026-09-10. */
function bankLineValues(amountMinor = 55_500) {
  return [
    { entityId: LINE_ID, fieldId: 'f_amount', valueNumber: amountMinor },
    { entityId: LINE_ID, fieldId: 'f_posted', valueDate: '2026-09-10T00:00:00.000Z' },
    { entityId: LINE_ID, fieldId: 'f_review', optionId: 'for_review' },
    { entityId: LINE_ID, fieldId: 'f_bank_status', optionId: 'posted' },
  ]
}

function movement(over: Record<string, unknown> = {}) {
  return {
    id: 'mt_1',
    amountMinor: 55_500n,
    method: 'card',
    reference: 'pi_abc',
    occurredAt: null,
    occurredOn: '2026-09-10',
    ...over,
  }
}

async function candidates() {
  const result = await listMatchCandidates(database, {
    organizationId: 'org_1',
    transactionId: LINE_ID,
  })
  if (result.isErr()) throw result.error
  return result.value.filter((candidate) => candidate.recordType === 'money_transaction')
}

beforeEach(() => {
  h.fieldValueRows = bankLineValues()
  h.moneyRows = []
})

describe('a customer payment as a match candidate', () => {
  it('offers the movement and labels it by its reference', async () => {
    h.moneyRows = [movement()]
    const found = await candidates()
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      recordId: 'mt_1',
      amountMinor: 55_500,
      dateKey: '2026-09-10',
      secondary: 'card',
      matchedToBankTransactionId: null,
    })
    expect(found[0]?.label).toContain('pi_abc')
  })

  it('reads the date off `occurredAt` when the movement carries an instant', async () => {
    h.moneyRows = [movement({ occurredOn: null, occurredAt: new Date('2026-09-11T18:00:00.000Z') })]
    expect((await candidates())[0]?.dateKey).toBe('2026-09-11')
  })

  it('drops a movement outside the amount tolerance', async () => {
    h.moneyRows = [movement({ amountMinor: 999_00n })]
    expect(await candidates()).toHaveLength(0)
  })

  // The only half of the link that exists: `MoneyTransaction` has no bank-line column, so
  // "already matched" has to be read off the bank lines themselves.
  it('names the bank line already claiming the movement', async () => {
    h.moneyRows = [movement()]
    h.fieldValueRows = [
      ...bankLineValues(),
      { entityId: 'txn_other', fieldId: 'f_matched_id', valueText: 'mt_1' },
    ]
    expect((await candidates())[0]?.matchedToBankTransactionId).toBe('txn_other')
  })
})
