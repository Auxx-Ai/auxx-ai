// packages/lib/src/banking/review/__tests__/writes.test.ts
//
// The treatment contract, which is the part of this slot that can lose money.
//
// 🛑 **The assertion that matters most is a negative one: matching posts
// NOTHING** (decision B5). `buildPaymentEntry` and the bill-payment builder
// already credit cash for the event a bank line corroborates, so a feed that
// also posts it credits cash twice - and both entries balance, so the trial
// balance ties and nothing detects it until a cash account will not reconcile
// months later. Every test below that asserts `postEntry` was NOT called is
// guarding that.
//
// The collaborators are mocked rather than faked: `postEntry`'s own behaviour is
// proved by `postings/__tests__/post-entry.test.ts` against a hand-written
// database, and re-fabricating it here would test that fake rather than these
// four treatments.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BankTransactionRow } from '../client'

const h = vi.hoisted(() => ({
  postEntry: vi.fn(),
  reverseEntry: vi.fn(),
  clearBankDeposit: vi.fn(),
  crudUpdate: vi.fn(),
  pin: vi.fn(),
  unpin: vi.fn(),
  postingCount: 0,
  // What any raw `db.select(...)` resolves to. The only two raw reads these
  // treatments make are "is this document already matched" (a `valueText` this
  // row does not carry, so: no) and "is the posting still live".
  selectRows: [] as Record<string, unknown>[],
  rows: new Map<string, BankTransactionRow>(),
  listRows: [] as BankTransactionRow[],
  /**
   * Every `db.update(...).set(values)` the treatments issued.
   *
   * The only two are the payment-transaction stamp and unstamp, which write
   * COLUMNS since drizzle 0363. Recorded rather than ignored because the whole
   * point of that move is WHICH fields are written - a test that only checks
   * "an update happened" would pass just as happily against the old blob write.
   */
  dbUpdates: [] as Record<string, unknown>[],
}))

vi.mock('../../../postings/post-entry', () => ({ postEntry: h.postEntry }))
vi.mock('../../../postings/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: async () => ({ mode: 'ledger', lockedThroughMonth: null }),
}))
vi.mock('../../../money/bank-deposits', () => ({ clearBankDeposit: h.clearBankDeposit }))
vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = h.crudUpdate
  },
}))
vi.mock('../../feed/pins', () => ({
  pinPostedBankTransaction: h.pin,
  unpinPostedBankTransaction: h.unpin,
}))
vi.mock('../../reads', () => ({
  getBankAccount: async (_db: unknown, params: { bankAccountId: string }) => ({
    isErr: () => false,
    isOk: () => true,
    value: { id: params.bankAccountId, name: 'Counterpart', glAccountId: '1010' },
  }),
  // The write-once posting high-water mark is stamped on the ACCOUNT beside the
  // line's own `gl_posting_id`, so the treatments resolve the bank_account def
  // too. `updateFor('def_ba:acct_1')` is how the tests below read that stamp.
  requireBankAccountFieldContext: async () => ({ bankAccountDefId: 'def_ba', fields: {} }),
}))
vi.mock('../reads', async () => {
  const { NotFoundError } = await import('../../../errors')
  return {
    requireReviewFieldContext: async () => ({
      bankTransactionDefId: 'def_bt',
      fields: {},
      suggestionFields: {},
    }),
    requireBankTransaction: async (_db: unknown, _org: string, id: string) => {
      const row = h.rows.get(id)
      if (!row) throw new NotFoundError(`Bank line ${id} was not found`)
      return row
    },
    listForReview: async () => ({ isErr: () => false, value: h.listRows }),
    countBankTransactionPostings: async () => h.postingCount,
  }
})

import {
  codeTransaction,
  excludeTransaction,
  matchTransaction,
  transferTransaction,
  undoReview,
} from '../writes'

const ORG = 'org_1'
const ACTOR = 'user_1'

/**
 * The narrowest possible database: a chainable builder that answers `[]`.
 *
 * The only raw SQL these treatments issue is `readDocumentLink`'s "is this
 * document already matched to another bank line", and the answer this returns -
 * no, it is not - is the ordinary one. The refusal path is proved by handing
 * the bank line its OWN `matchedRecordId` instead, which needs no query at all.
 */
const db = new Proxy({} as never, {
  get: (_target, key) => {
    if (key === 'then') return undefined
    // A terminal `.limit()`/`.where()` is awaited, so every stage is both
    // chainable and thenable. `h.selectRows` is what any of them resolves to.
    return () => Object.assign(Promise.resolve(h.selectRows), promiseChain())
  },
})

/** Every builder method, each answering the same thenable. */
function promiseChain(): Record<string, () => unknown> {
  const methods = ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'orderBy', 'returning']
  const chain: Record<string, () => unknown> = {}
  for (const method of methods) {
    chain[method] = () => Object.assign(Promise.resolve(h.selectRows), promiseChain())
  }
  // `set` is the one stage worth recording - see `h.dbUpdates`.
  chain.set = (values?: unknown) => {
    h.dbUpdates.push((values ?? {}) as Record<string, unknown>)
    return Object.assign(Promise.resolve(h.selectRows), promiseChain())
  }
  return chain
}

function row(over: Partial<BankTransactionRow> = {}): BankTransactionRow {
  const base: BankTransactionRow = {
    id: 'txn_1',
    recordId: 'def_bt:txn_1',
    externalId: 'bt-0001',
    bankAccountId: 'acct_1',
    bankAccountName: 'BoA ···5381',
    bankAccountGlAccountId: '1000',
    bankAccountConnectorId: null,
    postedAt: '2026-09-10',
    description: 'WIRE FEE',
    amountMinor: -3_500,
    bankStatus: 'posted',
    matchKey: 'wire fee',
    source: 'import',
    importBatchId: null,
    reviewStatus: 'for_review',
    glAccountId: null,
    matchedRecordId: null,
    matchedRecordType: null,
    excludeReason: null,
    reviewedAt: null,
    reviewedByUserId: null,
    glPostingId: null,
    ruleId: null,
    suggestedGlAccountId: null,
    suggestionReason: null,
    createdAt: new Date('2026-09-10T00:00:00Z'),
    ...over,
  }
  h.rows.set(base.id, base)
  return base
}

/** The fields one `crud.update` call wrote, by record id. */
function updateFor(recordId: string): Record<string, unknown> | undefined {
  const call = h.crudUpdate.mock.calls.find(([id]) => id === recordId)
  return call?.[1] as Record<string, unknown> | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  h.rows.clear()
  h.dbUpdates = []
  h.postingCount = 0
  h.selectRows = [{ status: 'posted', docNumber: 'AUXX-BNK-EXISTING' }]
  h.listRows = []
  h.postEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'post_1',
    docNumber: 'AUXX-BNK-BT0001',
  })
  h.reverseEntry.mockResolvedValue({ status: 'posted', glPostingId: 'post_2' })
  h.clearBankDeposit.mockResolvedValue({ isErr: () => false, value: {} })
  h.crudUpdate.mockResolvedValue(undefined)
  h.pin.mockResolvedValue(3)
  h.unpin.mockResolvedValue(3)
})

describe('matchTransaction', () => {
  it('🛑 posts NOTHING - the document already credited cash', async () => {
    row()
    const result = await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'bank_deposit',
      recordId: 'dep_1',
    })
    expect(result.isOk()).toBe(true)
    expect(h.postEntry).not.toHaveBeenCalled()
    if (result.isOk()) expect(result.value.post).toBeNull()
  })

  it('stamps the bank line matched and names the document', async () => {
    row()
    await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'bank_deposit',
      recordId: 'dep_1',
    })
    expect(updateFor('def_bt:txn_1')).toMatchObject({
      bank_transaction_review_status: 'matched',
      bank_transaction_matched_record_id: 'dep_1',
      bank_transaction_matched_record_type: 'bank_deposit',
      bank_transaction_reviewed_by_user_id: ACTOR,
    })
  })

  it('clears a deposit through its OWN writer, never by writing its fields', async () => {
    row()
    await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'bank_deposit',
      recordId: 'dep_1',
    })
    expect(h.clearBankDeposit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ depositId: 'dep_1', bankTransactionId: 'txn_1' })
    )
  })

  it('refuses a void line by name', async () => {
    row({ bankStatus: 'void' })
    const result = await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'bank_deposit',
      recordId: 'dep_1',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toMatch(/void/)
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })

  it('refuses a line already matched to something else, naming it', async () => {
    row({ matchedRecordId: 'dep_other', matchedRecordType: 'bank_deposit' })
    const result = await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'bank_deposit',
      recordId: 'dep_1',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toMatch(/dep_other/)
  })

  it('🛑 refuses a line that already posted - match would leave the entry standing', async () => {
    // A coded line posted Dr 6100 / Cr 1010. Re-labelling it `matched` says
    // "this line posts nothing" while that entry still stands AND the document
    // it now points at already credited the same cash: cash out twice, both
    // entries balancing.
    row({ glPostingId: 'post_0', reviewStatus: 'coded' })
    const result = await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'bank_deposit',
      recordId: 'dep_1',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toMatch(/post_0/)
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })

  it('refuses a vendor bill another bank line already claims, naming that line', async () => {
    // A bill has no pointer field of its own, so the only record of the link is
    // the other bank line's `matchedRecordId`. Answering null here let two lines
    // each claim to have paid one bill.
    row()
    h.selectRows = [{ entityId: 'txn_other' }]
    const result = await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'vendor_bill',
      recordId: 'bill_1',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toMatch(/txn_other/)
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })

  it('refuses bank_transaction as a match target - that is the transfer treatment', async () => {
    row()
    const result = await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'bank_transaction',
      recordId: 'txn_2',
    })
    expect(result.isErr()).toBe(true)
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})

describe('codeTransaction', () => {
  it('posts one entry and stamps the line coded', async () => {
    row()
    const result = await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      glAccountId: '6100',
    })
    expect(result.isOk()).toBe(true)
    expect(h.postEntry).toHaveBeenCalledTimes(1)
    expect(updateFor('def_bt:txn_1')).toMatchObject({
      bank_transaction_review_status: 'coded',
      bank_transaction_gl_account: '6100',
      bank_transaction_gl_posting_id: 'post_1',
    })
  })

  it('posts on the bank line dates, not on today', async () => {
    row({ postedAt: '2026-07-31' })
    await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      glAccountId: '6100',
    })
    const entry = h.postEntry.mock.calls[0]?.[1].entry
    expect(entry.txnDate).toBe('2026-07-31')
    expect(entry.postingType).toBe('bank_transaction')
  })

  it('debits the coded account for money OUT and credits it for money IN', async () => {
    row({ amountMinor: -3_500 })
    await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      glAccountId: '6100',
    })
    const out = h.postEntry.mock.calls[0]?.[1].entry.lines
    expect(out.find((l: { direction: string }) => l.direction === 'debit').glAccountId).toBe('6100')

    vi.clearAllMocks()
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'post_3' })
    row({ id: 'txn_2', recordId: 'def_bt:txn_2', amountMinor: 3_500 })
    await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_2',
      glAccountId: '4000',
    })
    const inbound = h.postEntry.mock.calls[0]?.[1].entry.lines
    expect(inbound.find((l: { direction: string }) => l.direction === 'credit').glAccountId).toBe(
      '4000'
    )
  })

  it('🛑 does NOT stamp the line when the ledger refuses the post', async () => {
    row()
    h.postEntry.mockResolvedValue({ status: 'period_closed', error: 'August is locked.' })
    const result = await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      glAccountId: '6100',
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.post?.status).toBe('period_closed')
    // A line reading `coded` with no posting behind it is the state that makes a
    // locked month look reconciled.
    expect(h.crudUpdate).not.toHaveBeenCalled()
    expect(h.pin).not.toHaveBeenCalled()
  })

  it('pins the raw columns only for a connector-bound row', async () => {
    row({ bankAccountConnectorId: 'conn_1' })
    await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      glAccountId: '6100',
    })
    expect(h.pin).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bankTransactionId: 'txn_1', connectorId: 'conn_1' })
    )

    vi.clearAllMocks()
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'post_9' })
    row({ id: 'txn_manual', recordId: 'def_bt:txn_manual' })
    await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_manual',
      glAccountId: '6100',
    })
    expect(h.pin).not.toHaveBeenCalled()
  })

  it('refuses a void line', async () => {
    row({ bankStatus: 'void' })
    const result = await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      glAccountId: '6100',
    })
    expect(result.isErr()).toBe(true)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('refuses a line that already posted - correct by reversal, never by re-coding', async () => {
    row({ glPostingId: 'post_0', reviewStatus: 'coded' })
    const result = await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      glAccountId: '6100',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toMatch(/post_0/)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('refuses a line with no bank date - there is no period to post into', async () => {
    row({ postedAt: null })
    const result = await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      glAccountId: '6100',
    })
    expect(result.isErr()).toBe(true)
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})

describe('transferTransaction', () => {
  it('posts ONE entry and marks both legs matched when the other leg is found', async () => {
    const outgoing = row({ amountMinor: -250_000 })
    h.listRows = [
      row({
        id: 'txn_in',
        recordId: 'def_bt:txn_in',
        bankAccountId: 'acct_2',
        bankAccountGlAccountId: '1010',
        amountMinor: 250_000,
      }),
    ]
    h.rows.set(outgoing.id, outgoing)

    const result = await transferTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      counterpartBankAccountId: 'acct_2',
    })
    expect(result.isOk()).toBe(true)
    expect(h.postEntry).toHaveBeenCalledTimes(1)
    expect(updateFor('def_bt:txn_1')).toMatchObject({
      bank_transaction_review_status: 'matched',
      bank_transaction_matched_record_id: 'txn_in',
      bank_transaction_matched_record_type: 'bank_transaction',
      bank_transaction_gl_posting_id: 'post_1',
    })
    // The second leg carries NO posting id: one event, one entry.
    expect(updateFor('def_bt:txn_in')).toMatchObject({
      bank_transaction_review_status: 'matched',
      bank_transaction_matched_record_id: 'txn_1',
    })
    expect(updateFor('def_bt:txn_in')).not.toHaveProperty('bank_transaction_gl_posting_id')
  })

  it('debits the destination and credits the source, never an expense account', async () => {
    row({ amountMinor: -250_000 })
    h.listRows = []
    await transferTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      counterpartBankAccountId: 'acct_2',
    })
    const lines = h.postEntry.mock.calls[0]?.[1].entry.lines
    expect(lines.find((l: { direction: string }) => l.direction === 'debit').glAccountId).toBe(
      '1010'
    )
    expect(lines.find((l: { direction: string }) => l.direction === 'credit').glAccountId).toBe(
      '1000'
    )
  })

  it('still posts with a warning when the other leg has not arrived', async () => {
    row({ amountMinor: -250_000 })
    h.listRows = []
    const result = await transferTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      counterpartBankAccountId: 'acct_2',
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.warnings[0]).toMatch(/No matching line/)
    expect(updateFor('def_bt:txn_1')).toMatchObject({
      bank_transaction_review_status: 'coded',
      bank_transaction_matched_record_id: 'acct_2',
    })
  })

  it('🛑 LINKS instead of posting when the other leg already posted this transfer', async () => {
    // The first leg arrived alone, posted, and was stamped `coded` with the
    // counterpart ACCOUNT. `pickOppositeLeg` cannot see it (it is not waiting),
    // `match` refuses `bank_transaction`, and Transfer is the only treatment the
    // late leg is offered - which is how one movement posted twice.
    row({ id: 'txn_late', recordId: 'def_bt:txn_late', amountMinor: 250_000 })
    h.listRows = [
      row({
        id: 'txn_first',
        recordId: 'def_bt:txn_first',
        bankAccountId: 'acct_2',
        bankAccountGlAccountId: '1010',
        amountMinor: -250_000,
        reviewStatus: 'coded',
        matchedRecordId: 'acct_1',
        matchedRecordType: 'bank_account',
        glPostingId: 'post_first',
      }),
    ]

    const result = await transferTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_late',
      counterpartBankAccountId: 'acct_2',
    })

    expect(result.isOk()).toBe(true)
    expect(h.postEntry).not.toHaveBeenCalled()
    if (result.isOk()) {
      expect(result.value.post).toBeNull()
      expect(result.value.warnings[0]).toMatch(/already posted/)
    }
    expect(updateFor('def_bt:txn_late')).toMatchObject({
      bank_transaction_review_status: 'matched',
      bank_transaction_matched_record_id: 'txn_first',
      bank_transaction_matched_record_type: 'bank_transaction',
    })
    // The late leg carries no posting id: one movement, one entry.
    expect(updateFor('def_bt:txn_late')).not.toHaveProperty('bank_transaction_gl_posting_id')
    // The first leg stops pointing at an ACCOUNT and becomes the matched leg it
    // would have been had both arrived together - keeping its posting.
    expect(updateFor('def_bt:txn_first')).toMatchObject({
      bank_transaction_review_status: 'matched',
      bank_transaction_matched_record_id: 'txn_late',
      bank_transaction_matched_record_type: 'bank_transaction',
      bank_transaction_gl_account: null,
    })
  })

  it('does not link to a coded line stamped with a DIFFERENT account', async () => {
    row({ id: 'txn_late', recordId: 'def_bt:txn_late', amountMinor: 250_000 })
    h.listRows = [
      row({
        id: 'txn_other',
        recordId: 'def_bt:txn_other',
        bankAccountId: 'acct_2',
        bankAccountGlAccountId: '1010',
        amountMinor: -250_000,
        reviewStatus: 'coded',
        matchedRecordId: 'acct_9',
        matchedRecordType: 'bank_account',
        glPostingId: 'post_other',
      }),
    ]
    const result = await transferTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_late',
      counterpartBankAccountId: 'acct_2',
    })
    expect(result.isOk()).toBe(true)
    // Nothing to link to, so this really is a first leg: it posts.
    expect(h.postEntry).toHaveBeenCalledTimes(1)
  })

  it('refuses a transfer to the account the line is already on', async () => {
    row()
    const result = await transferTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      counterpartBankAccountId: 'acct_1',
    })
    expect(result.isErr()).toBe(true)
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})

describe('excludeTransaction', () => {
  it('records the reason and posts nothing', async () => {
    row()
    const result = await excludeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      reason: 'Personal charge',
    })
    expect(result.isOk()).toBe(true)
    expect(h.postEntry).not.toHaveBeenCalled()
    expect(updateFor('def_bt:txn_1')).toMatchObject({
      bank_transaction_review_status: 'excluded',
      bank_transaction_exclude_reason: 'Personal charge',
    })
  })

  it('refuses a blank reason', async () => {
    row()
    const result = await excludeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      reason: '   ',
    })
    expect(result.isErr()).toBe(true)
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })

  it('is allowed on a void line - that is exactly what excluding is for', async () => {
    row({ bankStatus: 'void' })
    const result = await excludeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      reason: 'Voided by the bank',
    })
    expect(result.isOk()).toBe(true)
  })
})

describe('undoReview', () => {
  it('reverses a coded line and puts it back in the queue', async () => {
    row({ reviewStatus: 'coded', glAccountId: '6100', glPostingId: 'post_1' })
    const result = await undoReview(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
    })
    expect(result.isOk()).toBe(true)
    expect(h.reverseEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ glPostingId: 'post_1' })
    )
    expect(updateFor('def_bt:txn_1')).toMatchObject({
      bank_transaction_review_status: 'for_review',
      bank_transaction_gl_account: null,
      bank_transaction_gl_posting_id: null,
    })
  })

  it('unlinks without reversing when the posting is ALREADY reversed', async () => {
    // A line can carry the id of an entry that is already backed out. Refusing
    // to reverse it a second time is right; stranding the line as `coded` with
    // no way back into the queue is not.
    row({ reviewStatus: 'coded', glPostingId: 'post_1' })
    h.selectRows = [{ status: 'reversed', docNumber: 'AUXX-BNK-OLD' }]
    const result = await undoReview(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
    })
    expect(result.isOk()).toBe(true)
    expect(h.reverseEntry).not.toHaveBeenCalled()
    if (result.isOk()) expect(result.value.warnings[0]).toMatch(/nothing to reverse/)
    expect(updateFor('def_bt:txn_1')).toMatchObject({
      bank_transaction_review_status: 'for_review',
    })
  })

  it('🛑 unlinks NOTHING when the reversal is refused', async () => {
    row({ reviewStatus: 'coded', glPostingId: 'post_1' })
    h.reverseEntry.mockResolvedValue({ status: 'period_closed', error: 'August is locked.' })
    const result = await undoReview(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
    })
    expect(result.isOk()).toBe(true)
    // A line back in the queue with a live posting behind it gets coded twice.
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })

  it('releases the feed pins so the next sync can heal an amended row', async () => {
    row({ reviewStatus: 'coded', glPostingId: 'post_1', bankAccountConnectorId: 'conn_1' })
    await undoReview(db, { organizationId: ORG, actorUserId: ACTOR, transactionId: 'txn_1' })
    expect(h.unpin).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bankTransactionId: 'txn_1', connectorId: 'conn_1' })
    )
  })

  it('unlinks the other leg of a transfer', async () => {
    row({
      reviewStatus: 'matched',
      matchedRecordId: 'txn_in',
      matchedRecordType: 'bank_transaction',
      glPostingId: 'post_1',
    })
    await undoReview(db, { organizationId: ORG, actorUserId: ACTOR, transactionId: 'txn_1' })
    expect(updateFor('def_bt:txn_in')).toMatchObject({
      bank_transaction_review_status: 'for_review',
      bank_transaction_matched_record_id: null,
    })
  })

  it('🛑 refuses the leg that does NOT hold the posting, naming the one to undo', async () => {
    // Resetting this leg would put the OTHER one back to `for_review` with a
    // live posting behind it, where code and transfer refuse it (it has a
    // posting) and undo refuses it (it is already waiting): stranded.
    row({
      id: 'txn_late',
      recordId: 'def_bt:txn_late',
      reviewStatus: 'matched',
      matchedRecordId: 'txn_first',
      matchedRecordType: 'bank_transaction',
      glPostingId: null,
    })
    row({
      id: 'txn_first',
      recordId: 'def_bt:txn_first',
      reviewStatus: 'matched',
      matchedRecordId: 'txn_late',
      matchedRecordType: 'bank_transaction',
      glPostingId: 'post_first',
    })

    const result = await undoReview(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_late',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toMatch(/txn_first/)
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })

  it('still undoes a legless pair where neither leg carries a posting', async () => {
    row({
      id: 'txn_a',
      recordId: 'def_bt:txn_a',
      reviewStatus: 'matched',
      matchedRecordId: 'txn_b',
      matchedRecordType: 'bank_transaction',
      glPostingId: null,
    })
    row({
      id: 'txn_b',
      recordId: 'def_bt:txn_b',
      reviewStatus: 'matched',
      matchedRecordId: 'txn_a',
      matchedRecordType: 'bank_transaction',
      glPostingId: null,
    })
    const result = await undoReview(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_a',
    })
    expect(result.isOk()).toBe(true)
    expect(updateFor('def_bt:txn_b')).toMatchObject({
      bank_transaction_review_status: 'for_review',
    })
  })

  it('is allowed on a void line, which is the commonest reason to reach for it', async () => {
    row({ bankStatus: 'void', reviewStatus: 'coded', glPostingId: 'post_1' })
    const result = await undoReview(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
    })
    expect(result.isOk()).toBe(true)
    expect(h.reverseEntry).toHaveBeenCalled()
  })

  it('refuses a line that is already waiting for review', async () => {
    row()
    const result = await undoReview(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
    })
    expect(result.isErr()).toBe(true)
  })
})

// ── The customer-payment link is a COLUMN, not a metadata key (drizzle 0363) ──
//
// 🛑 The review queue used to record "which bank line confirmed this payment" as
// three keys inside `PaymentTransaction.metadata`, because the table had no
// typed home for it (`plans/accounting/HANDOFF.md` §5b, departure 2). A JSON key
// cannot be indexed, cannot be constrained, and is invisible to anything that
// does not already know to open the blob - so the pointer that the whole
// matcher turns on was the one link in the book nothing could query.
//
// These tests pin the two halves that a regression would quietly undo: that the
// stamp writes COLUMNS and nothing else, and that the read asks the column.
describe('matching a customer payment', () => {
  it('stamps the two columns and writes no metadata at all', async () => {
    row({ amountMinor: 55_500 })
    const result = await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'payment_transaction',
      recordId: 'pt_1',
    })

    expect(result.isOk()).toBe(true)
    expect(h.dbUpdates).toHaveLength(1)
    const written = h.dbUpdates[0] ?? {}
    expect(written.bankTransactionId).toBe('txn_1')
    expect(written.bankClearedAt).toBeInstanceOf(Date)
    // The blob is not touched. `metadata.date` is the user-picked accounting
    // date every payment reader depends on, and a spread-and-rewrite of the
    // whole object is how it would get lost.
    expect(written).not.toHaveProperty('metadata')
  })

  it('writes no confirmationSource, because the pointer already says it', async () => {
    row({ amountMinor: 55_500 })
    await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'payment_transaction',
      recordId: 'pt_1',
    })
    // `bankTransactionId IS NOT NULL` is the same statement, and a second field
    // saying so is a second field that can disagree with the first.
    expect(h.dbUpdates[0]).not.toHaveProperty('confirmationSource')
  })

  it('🛑 still posts NOTHING - the payment entry already debited the route', async () => {
    row({ amountMinor: 55_500 })
    await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'payment_transaction',
      recordId: 'pt_1',
    })
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('refuses a payment already matched to another bank line, naming it', async () => {
    // The refusal is only reachable because `readDocumentLink` reads the COLUMN.
    // Answering out of `metadata` here would make this test pass against a row
    // that carries the pointer in the blob and fail against one that carries it
    // in the column, which is exactly the direction the data moved.
    row({ amountMinor: 55_500 })
    h.selectRows = [{ bankTransactionId: 'txn_other' }]
    const result = await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'payment_transaction',
      recordId: 'pt_1',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toMatch(/txn_other/)
    expect(h.dbUpdates).toHaveLength(0)
  })

  it('clears BOTH columns on undo, never one of them', async () => {
    // A cleared date left standing on a payment with no bank line reads as
    // "this cleared" with nothing able to say against what.
    row({
      reviewStatus: 'matched',
      matchedRecordId: 'pt_1',
      matchedRecordType: 'payment_transaction',
    })
    const result = await undoReview(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
    })

    expect(result.isOk()).toBe(true)
    expect(h.dbUpdates).toHaveLength(1)
    expect(h.dbUpdates[0]).toEqual({ bankTransactionId: null, bankClearedAt: null })
  })
})

// ── Matching a payout posts nothing (brief 18 §1, prevention half) ──────────
//
// 🛑 Before this, `listMatchCandidates` offered a Stripe payout's own bank line
// NOTHING to match, so the only door was Code - which credits clearing a
// second time (HANDOFF §0.2). Matching a payout has to behave exactly like
// matching a deposit: link, date, post NOTHING, because the payout's own sync
// already posted `Dr bank / Cr clearing`.
describe('matching a payout', () => {
  it('🛑 posts NOTHING and stamps payout_bank_transaction_id', async () => {
    row({ amountMinor: 548_300 })
    h.selectRows = [{ defId: 'def_payout' }]
    const result = await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'payout',
      recordId: 'payout_1',
    })
    expect(result.isOk()).toBe(true)
    expect(h.postEntry).not.toHaveBeenCalled()
    if (result.isOk()) expect(result.value.post).toBeNull()
    expect(updateFor('def_payout:payout_1')).toMatchObject({
      payout_bank_transaction_id: 'txn_1',
    })
  })

  it('refuses a payout already matched to a different bank line, naming it', async () => {
    row({ amountMinor: 548_300 })
    h.selectRows = [{ valueText: 'txn_other' }]
    const result = await matchTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      recordType: 'payout',
      recordId: 'payout_1',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toMatch(/txn_other/)
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })

  it('undo clears payout_bank_transaction_id', async () => {
    row({
      reviewStatus: 'matched',
      matchedRecordId: 'payout_1',
      matchedRecordType: 'payout',
    })
    h.selectRows = [{ defId: 'def_payout' }]
    const result = await undoReview(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
    })
    expect(result.isOk()).toBe(true)
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(updateFor('def_payout:payout_1')).toEqual({ payout_bank_transaction_id: null })
  })
})

describe('🛑 bank_account_has_posted - the write-once removal gate', () => {
  /**
   * §5.1 of plans/bank-connection/08-removing-a-bank-account.md, and the reason
   * the fact is STORED rather than computed.
   *
   * The gate that decides whether removing a bank account deletes it or archives
   * it has one term, and it is written here - at the two sites where a bank line
   * first produces a journal entry. Miss either one and an account whose rows are
   * a posting's source documents becomes hard-deletable.
   *
   * 🛑 The undo tests below are the important half. `undoReview` nulls the line's
   * `gl_posting_id` and REVERSES the entry, and it must still leave the account's
   * flag alone: the original posting and its reversal both stay in the books
   * forever, so the account permanently changed the ledger whatever the queue now
   * looks like.
   */
  it('is stamped on the account when a line is CODED', async () => {
    row()
    const result = await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      glAccountId: '6100',
    })
    expect(result.isOk()).toBe(true)
    expect(updateFor('def_ba:acct_1')).toEqual({ bank_account_has_posted: true })
  })

  it('is stamped on the FILING leg account when a transfer posts', async () => {
    row({ amountMinor: -50_000 })
    h.listRows = []
    const result = await transferTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      counterpartBankAccountId: 'acct_2',
    })
    expect(result.isOk()).toBe(true)
    // The entry is filed on the outgoing leg, which is this line's own account.
    expect(updateFor('def_ba:acct_1')).toEqual({ bank_account_has_posted: true })
  })

  it('is NOT stamped when the ledger refused the post', async () => {
    row()
    // `period_closed` is the real status; this stub said `period_locked` for a
    // long time, which is not a member of `PostResultStatus` at all. It passed
    // either way against a `Set<string>`, and it is what caught `didLedgerAccept`
    // failing OPEN on an unknown status - see `postings/__tests__/ledger-accepted.test.ts`.
    h.postEntry.mockResolvedValue({ status: 'period_closed', error: 'September is closed' })
    await codeTransaction(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
      glAccountId: '6100',
    })
    // Nothing reached the books, so nothing may claim it did.
    expect(updateFor('def_ba:acct_1')).toBeUndefined()
  })

  it('survives undoReview on the only coded row', async () => {
    row({ reviewStatus: 'coded', glAccountId: '6100', glPostingId: 'post_1' })
    const result = await undoReview(db, {
      organizationId: ORG,
      actorUserId: ACTOR,
      transactionId: 'txn_1',
    })
    expect(result.isOk()).toBe(true)
    // The line went back to `for_review` and lost its posting id...
    expect(updateFor('def_bt:txn_1')).toMatchObject({
      bank_transaction_review_status: 'for_review',
      bank_transaction_gl_posting_id: null,
    })
    // ...and the account was not touched at all. Not cleared, not rewritten.
    expect(updateFor('def_ba:acct_1')).toBeUndefined()
    expect(
      h.crudUpdate.mock.calls.some(([, patch]) =>
        Object.hasOwn((patch ?? {}) as object, 'bank_account_has_posted')
      )
    ).toBe(false)
  })

  it('survives the posting reversal undoReview performs', async () => {
    row({ reviewStatus: 'coded', glAccountId: '6100', glPostingId: 'post_1' })
    await undoReview(db, { organizationId: ORG, actorUserId: ACTOR, transactionId: 'txn_1' })
    // The reversal really did run - it is a SECOND GlPosting, so there is more in
    // the books afterwards, not less - and the flag is still untouched.
    expect(h.reverseEntry).toHaveBeenCalledTimes(1)
    expect(updateFor('def_ba:acct_1')).toBeUndefined()
  })

  it('survives undoing a MATCHED line', async () => {
    row({
      reviewStatus: 'matched',
      matchedRecordId: 'dep_1',
      matchedRecordType: 'bank_deposit',
    })
    await undoReview(db, { organizationId: ORG, actorUserId: ACTOR, transactionId: 'txn_1' })
    expect(updateFor('def_ba:acct_1')).toBeUndefined()
  })
})
