// packages/lib/src/banking/review/__tests__/reads-payout-candidates.test.ts
//
// `readPayoutCandidates` (brief 18 §1, plans/accounting/tasks/18-two-feeds-one-author.md):
// payouts become match candidates for an inbound bank line, which is the whole
// argument for shipping this half of the duplicate detector alone. Before this,
// `listMatchCandidates` offered a Stripe payout's own bank line NOTHING to
// match, so the reviewer's only door was Code - which credits clearing a
// second time (HANDOFF §0.2).
//
// 🛑 The property that matters most: a payout already matched to a DIFFERENT
// bank line is not offered again, unlike `bank_deposit`/`vendor_payment`
// candidates, which stay visible-but-disabled. A payout confirms exactly one
// bank line; relisting it invites a second line to claim money that only
// arrived once.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const LINE_ID = 'txn_1'
const BT_DEF = 'def_bt'
const PAYOUT_DEF = 'def_payout'
const DEPOSIT_DEF = 'def_deposit'

/** The outer bank_transaction's own fields, read through `getOrgCache` - never the CustomField table. */
const BT_FIELDS: Record<string, { id: string }> = {
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
}

/** The candidate entities' own attributes, read through the `CustomField` table. */
const PAYOUT_FIELD_IDS: Record<string, string> = {
  payout_deposited: 'pf_deposited',
  payout_paid_at: 'pf_paid_at',
  payout_bank_transaction_id: 'pf_bank_txn',
  payout_status: 'pf_status',
}
const DEPOSIT_FIELD_IDS: Record<string, string> = {
  bank_deposit_total: 'df_total',
  bank_deposit_date: 'df_date',
  bank_deposit_bank_transaction_id: 'df_bank_txn',
  bank_deposit_reference: 'df_reference',
}

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: async (_org: string, entityType: string) => {
    if (entityType === 'bank_transaction') return BT_DEF
    if (entityType === 'payout') return PAYOUT_DEF
    if (entityType === 'bank_deposit') return DEPOSIT_DEF
    return null
  },
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((attr) => [attr, BT_FIELDS[attr] ?? null])),
    }),
  }),
}))

vi.mock('../../reads', () => ({
  listBankAccounts: async () => ({ isOk: () => true, isErr: () => false, value: [] }),
  readCoverage: async () => ({ isOk: () => true, isErr: () => false, value: null }),
}))

const { listMatchCandidates } = await import('../reads')

/**
 * One `Database` whose every `select().from(<real schema table>)` resolves to
 * a fixed row set keyed by TABLE IDENTITY, not by the query's own filters -
 * `.where()`/`.innerJoin()` are no-ops that return the same chain.
 *
 * 🛑 Because every query against one table shares its row set regardless of
 * which caller issued it, an entity that does not carry a given attribute
 * reads back `amountMinor: 0` for it and is dropped by the ordinary
 * zero-amount guard - which is what keeps the bank line's own row (and the
 * OTHER candidate type's rows) from leaking into a reader that was never
 * meant to see them.
 */
function stubDb(rows: {
  entityInstance: unknown[]
  fieldValue: unknown[]
  customField: unknown[]
}) {
  const chain = (data: unknown[]): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    for (const method of ['innerJoin', 'leftJoin', 'where', 'limit', 'groupBy', 'orderBy']) {
      c[method] = () => chain(data)
    }
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    c.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(data).then(resolve, reject)
    return c
  }
  return {
    select: () => ({
      from: (target: unknown) => {
        if (target === schema.EntityInstance) return chain(rows.entityInstance)
        if (target === schema.FieldValue) return chain(rows.fieldValue)
        if (target === schema.CustomField) return chain(rows.customField)
        return chain([])
      },
    }),
  } as never
}

/** The bank line under review: money IN, $5,483.00, on 2026-09-09. */
function bankLineFieldValues() {
  return [
    { entityId: LINE_ID, fieldId: 'f_amount', valueNumber: 548_300 },
    { entityId: LINE_ID, fieldId: 'f_posted', valueDate: '2026-09-09T00:00:00.000Z' },
    { entityId: LINE_ID, fieldId: 'f_review', optionId: 'for_review' },
    { entityId: LINE_ID, fieldId: 'f_bank_status', optionId: 'posted' },
  ]
}

function customFieldRows() {
  return [
    ...Object.entries(PAYOUT_FIELD_IDS).map(([attr, id]) => ({ id, attr })),
    ...Object.entries(DEPOSIT_FIELD_IDS).map(([attr, id]) => ({ id, attr })),
  ]
}

function payoutFieldValues(over: Record<string, unknown>[] = []) {
  return [
    { entityId: 'payout_1', fieldId: 'pf_deposited', valueNumber: 548_300 },
    { entityId: 'payout_1', fieldId: 'pf_paid_at', valueDate: '2026-09-09T00:00:00.000Z' },
    { entityId: 'payout_1', fieldId: 'pf_status', optionId: 'paid' },
    ...over,
  ]
}

/** A deposit within the window but NOT an exact amount match, to compare scores against. */
function depositFieldValues() {
  return [
    { entityId: 'deposit_1', fieldId: 'df_total', valueNumber: 547_000 },
    { entityId: 'deposit_1', fieldId: 'df_date', valueDate: '2026-09-08T00:00:00.000Z' },
  ]
}

function entityInstanceRows() {
  // 🛑 The LINE's own row MUST come first: `readBankTransaction` takes the
  // first row back from its own (unfiltered, by this stub) query.
  return [
    { id: LINE_ID, createdAt: new Date('2026-09-10T00:00:00Z') },
    { id: 'payout_1', displayName: 'PAY-0004' },
    { id: 'deposit_1', displayName: 'DEP-0007' },
  ]
}

async function allCandidates(fieldValueRows: unknown[]) {
  const db = stubDb({
    entityInstance: entityInstanceRows(),
    fieldValue: fieldValueRows,
    customField: customFieldRows(),
  })
  const result = await listMatchCandidates(db, { organizationId: ORG, transactionId: LINE_ID })
  if (result.isErr()) throw result.error
  return result.value
}

async function payoutCandidates(fieldValueRows: unknown[]) {
  return (await allCandidates(fieldValueRows)).filter((c) => c.recordType === 'payout')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('readPayoutCandidates', () => {
  it('offers a payout of the same deposited amount and date for an inbound line', async () => {
    const found = await payoutCandidates([...bankLineFieldValues(), ...payoutFieldValues()])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      recordType: 'payout',
      recordId: 'payout_1',
      label: 'PAY-0004',
      amountMinor: 548_300,
      dateKey: '2026-09-09',
    })
  })

  it('scores an exact-amount payout above a deposit of a different amount', async () => {
    const found = await allCandidates([
      ...bankLineFieldValues(),
      ...payoutFieldValues(),
      ...depositFieldValues(),
    ])
    const payout = found.find((c) => c.recordType === 'payout')
    const deposit = found.find((c) => c.recordType === 'bank_deposit')
    expect(payout).toBeDefined()
    expect(deposit).toBeDefined()
    expect(payout?.score).toBeGreaterThan(deposit?.score ?? 0)
  })

  it('excludes a payout that is not paid or in transit', async () => {
    const found = await payoutCandidates([
      ...bankLineFieldValues(),
      ...payoutFieldValues([{ entityId: 'payout_1', fieldId: 'pf_status', optionId: 'failed' }]),
    ])
    expect(found).toHaveLength(0)
  })

  it('🛑 does not offer a payout already matched to a DIFFERENT bank line', async () => {
    const found = await payoutCandidates([
      ...bankLineFieldValues(),
      ...payoutFieldValues([
        { entityId: 'payout_1', fieldId: 'pf_bank_txn', valueText: 'txn_other' },
      ]),
    ])
    expect(found).toHaveLength(0)
  })

  it('still offers a payout already matched to THIS line', async () => {
    const found = await payoutCandidates([
      ...bankLineFieldValues(),
      ...payoutFieldValues([{ entityId: 'payout_1', fieldId: 'pf_bank_txn', valueText: LINE_ID }]),
    ])
    expect(found).toHaveLength(1)
  })
})
