// packages/lib/src/money/bank-deposits/__tests__/writes.test.ts
//
// Everything this file asserts is a REFUSAL or the exact shape of the one entry
// a deposit posts, because both are things that go wrong without anything
// downstream noticing:
//
//  - a cheque in two deposits makes "which deposit was this in" unanswerable,
//    and the second deposit still balances;
//  - a mixed-currency deposit posts the sum at an implied 1.0 rate;
//  - a card grouped into a deposit asserts a gross the bank never credited;
//  - a deposit whose entry the ledger refused would otherwise sit there having
//    consumed its payments while moving no money.
//
// The collaborators are mocked rather than faked: `reads.ts` is exercised
// against the real database by the driven pass, and what is worth pinning here
// is the DECISION ladder in front of them.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  payments: [] as Array<Record<string, unknown>>,
  deposit: null as Record<string, unknown> | null,
  postResult: { status: 'posted', glPostingId: 'glp_1', docNumber: 'AUXX-DEP-DEP0001' } as {
    status: string
    glPostingId?: string
    docNumber?: string
    error?: string
  },
  created: [] as Array<{ defId: string; values: Record<string, unknown> }>,
  updated: [] as Array<{ recordId: string; values: Record<string, unknown> }>,
  archived: [] as string[],
  postedEntries: [] as Array<Record<string, unknown>>,
  /** Every step, in order, so "read under the lock, inside the transaction" is assertable. */
  calls: [] as string[],
  /** The `db` handle `readPaymentsByIds` was called with - the tx one, or the outer one. */
  readWith: [] as unknown[],
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ get: async () => h.settings }),
  getCachedEntityDefId: async () => 'def_bank_deposit',
}))

vi.mock('../reads', () => ({
  requireBankDepositFieldContext: async () => ({ depositDefId: 'def_bank_deposit', fields: {} }),
  requirePaymentFieldContext: async () => ({
    paymentDefId: 'def_payment',
    fields: { payment_bank_deposit: { id: 'fld_link' } },
  }),
  loadBankDepositFieldContext: async () => ({ depositDefId: 'def_bank_deposit', fields: {} }),
  readPaymentsByIds: async (db: unknown) => {
    h.calls.push('read-payments')
    h.readWith.push(db)
    return h.payments
  },
  readBankDepositDetail: async () => h.deposit,
  readDepositPayments: async () => [],
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(defId: string, values: Record<string, unknown>) {
      h.created.push({ defId, values })
      return { instance: { id: 'dep_1' } }
    }
    async update(recordId: string, values: Record<string, unknown>) {
      h.updated.push({ recordId, values })
    }
    async archive(recordId: string) {
      h.archived.push(recordId)
    }
  },
}))

vi.mock('../../../postings/post-entry', async () => {
  const actual = await vi.importActual<typeof import('../../../postings/post-entry')>(
    '../../../postings/post-entry'
  )
  return {
    LEDGER_CURRENCY: actual.LEDGER_CURRENCY,
    postEntry: async (_db: unknown, options: Record<string, unknown>) => {
      h.postedEntries.push(options.entry as Record<string, unknown>)
      return h.postResult
    },
  }
})

vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))

import type { Database } from '@auxx/database'
import { ACCOUNT_ROLES } from '../../../postings/build-entry'
import {
  clearBankDeposit,
  createBankDeposit,
  unlinkPaymentsFromDeposit,
  updateBankDeposit,
} from '../writes'

const ORG = 'org_1'
const USER = 'user_1'

/**
 * The transaction handle `createBankDeposit` is given. Its `select` chain stands
 * in for `lockPayments`' `SELECT ... FOR UPDATE`, and it records that the lock
 * was taken so the ordering assertions below have something to read.
 */
const tx = {
  select: () => {
    const chain: Record<string, unknown> = {}
    for (const key of ['from', 'where', 'orderBy']) chain[key] = () => chain
    chain.for = (mode: string) => {
      h.calls.push(`lock:${mode}`)
      return Promise.resolve([])
    }
    return chain
  },
}
const db = {
  transaction: async (fn: (handle: unknown) => unknown) => {
    h.calls.push('begin')
    const result = await fn(tx)
    h.calls.push('commit')
    return result
  },
} as unknown as Database

function payment(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: 'pay_1',
    recordId: 'def_payment:pay_1',
    amountMinor: 100_00,
    date: '2026-09-01',
    method: 'check',
    reference: '1041',
    invoiceInstanceId: null,
    invoiceName: 'INV-0001',
    currency: 'USD',
    bankDepositId: null,
    ...overrides,
  }
}

function deposit(overrides: Record<string, unknown> = {}) {
  return {
    depositId: 'dep_1',
    recordId: 'def_bank_deposit:dep_1',
    number: 'DEP-0001',
    depositDate: '2026-09-03',
    bankAccountCode: '1000',
    reference: null,
    status: 'pending',
    totalMinor: 100_00,
    bankTransactionId: null,
    clearedAt: null,
    reconciledAt: null,
    glPostingId: null,
    createdAt: new Date('2026-09-03T00:00:00Z'),
    payments: [payment()],
    ...overrides,
  }
}

const input = {
  organizationId: ORG,
  actorUserId: USER,
  paymentIds: ['pay_1'],
  depositDate: '2026-09-03',
  bankAccountCode: '1000',
}

beforeEach(() => {
  h.settings = {}
  h.payments = [payment()]
  h.deposit = deposit()
  h.postResult = { status: 'posted', glPostingId: 'glp_1' }
  h.created = []
  h.updated = []
  h.archived = []
  h.postedEntries = []
  h.calls = []
  h.readWith = []
})

describe('createBankDeposit refusals', () => {
  it('refuses an empty selection', async () => {
    const result = await createBankDeposit(db, { ...input, paymentIds: [] })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/at least one payment/i)
  })

  it('refuses a date that is not YYYY-MM-DD', async () => {
    const result = await createBankDeposit(db, { ...input, depositDate: '3 September' })
    expect(result._unsafeUnwrapErr().message).toMatch(/YYYY-MM-DD/)
  })

  it('refuses a blank bank account', async () => {
    const result = await createBankDeposit(db, { ...input, bankAccountCode: '  ' })
    expect(result._unsafeUnwrapErr().message).toMatch(/bank account/i)
  })

  it('refuses a payment that is already in a deposit, and writes nothing', async () => {
    h.payments = [payment({ bankDepositId: 'dep_0' })]
    const result = await createBankDeposit(db, input)
    expect(result._unsafeUnwrapErr().message).toMatch(/already in a bank deposit/i)
    expect(h.created).toHaveLength(0)
    expect(h.postedEntries).toHaveLength(0)
  })

  it('refuses a payment id that does not resolve', async () => {
    h.payments = []
    const result = await createBankDeposit(db, input)
    expect(result._unsafeUnwrapErr().message).toMatch(/no longer exist/i)
  })

  it('refuses a rail that does not route through undeposited funds, naming the method', async () => {
    h.payments = [payment({ method: 'card' })]
    const result = await createBankDeposit(db, input)
    const message = result._unsafeUnwrapErr().message
    expect(message).toMatch(/do not route through undeposited funds/i)
    expect(message).toContain('card')
    expect(h.created).toHaveLength(0)
  })

  it('refuses mixed currencies explicitly rather than posting at an implied 1.0 rate', async () => {
    h.payments = [payment(), payment({ paymentId: 'pay_2', currency: 'CAD' })]
    const result = await createBankDeposit(db, { ...input, paymentIds: ['pay_1', 'pay_2'] })
    const message = result._unsafeUnwrapErr().message
    expect(message).toMatch(/cannot mix currencies/i)
    expect(message).toContain('implied 1.0 rate')
  })

  it('refuses a single currency that is not the ledger currency', async () => {
    h.payments = [payment({ currency: 'CAD' })]
    const result = await createBankDeposit(db, input)
    expect(result._unsafeUnwrapErr().message).toMatch(/ledger is kept in USD/i)
  })

  it('refuses a total that is not a positive whole number of minor units', async () => {
    h.payments = [payment({ amountMinor: 0 })]
    const result = await createBankDeposit(db, input)
    expect(result._unsafeUnwrapErr().message).toMatch(/positive whole number/i)
  })
})

describe('createBankDeposit posts one cash line', () => {
  it('posts Dr <the chosen bank account, by code> Cr undeposited_funds for the summed total', async () => {
    h.payments = [
      payment({ paymentId: 'pay_1', amountMinor: 100_00 }),
      payment({ paymentId: 'pay_2', recordId: 'def_payment:pay_2', amountMinor: 250_00 }),
    ]
    h.deposit = deposit({ totalMinor: 350_00, payments: h.payments })

    const result = await createBankDeposit(db, { ...input, paymentIds: ['pay_1', 'pay_2'] })
    expect(result.isOk()).toBe(true)

    const entry = h.postedEntries[0] as {
      postingType: string
      periodKey: string
      txnDate: string
      lines: Array<{ accountRole: string; direction: string; amount: number; sourceId: string }>
    }
    expect(entry.postingType).toBe('bank_deposit')
    // Keys on the deposit's own NUMBER, never a date: two deposits can be banked
    // in one day, and a cuid is over the 21-character document-number cap.
    expect(entry.periodKey).toBe('DEP-0001')
    expect(entry.txnDate).toBe('2026-09-03')
    expect(entry.lines).toHaveLength(2)
    // 🛑 A CODE line, not the `cash` role. The role resolves to exactly one
    // account, so an org with `1000 Checking` and `1020 Savings` would post
    // every deposit into whichever one the role names and never move the other,
    // with the entry balancing either way and the field the operator filled in
    // surviving only in the memo.
    expect(entry.lines[0]).toMatchObject({
      accountCode: '1000',
      direction: 'debit',
      amount: 350_00,
      sourceId: 'dep_1',
    })
    expect(entry.lines[0]?.accountRole).toBeUndefined()
    expect(entry.lines[1]).toMatchObject({
      accountRole: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
      direction: 'credit',
      amount: 350_00,
    })
  })

  it('banks into the SECOND bank account when that is the one named', async () => {
    await createBankDeposit(db, { ...input, bankAccountCode: ' 1020 ' })

    const entry = h.postedEntries[0] as {
      lines: Array<{ accountCode?: string; accountRole?: string; memo?: string }>
    }
    expect(entry.lines[0]?.accountCode).toBe('1020')
    expect(entry.lines[0]?.memo).toContain('1020')
    expect(h.created[0]?.values.bank_deposit_bank_account).toBe('1020')
  })

  it('stamps the total on the record and links every payment to it', async () => {
    h.payments = [
      payment({ paymentId: 'pay_1', amountMinor: 100_00 }),
      payment({ paymentId: 'pay_2', recordId: 'def_payment:pay_2', amountMinor: 250_00 }),
    ]
    await createBankDeposit(db, { ...input, paymentIds: ['pay_1', 'pay_2'] })

    expect(h.created[0]?.values).toMatchObject({
      bank_deposit_date: '2026-09-03',
      bank_deposit_bank_account: '1000',
      bank_deposit_status: 'pending',
      bank_deposit_total: 350_00,
    })
    const links = h.updated.filter((u) => 'payment_bank_deposit' in u.values)
    expect(links.map((u) => u.recordId)).toEqual(['def_payment:pay_1', 'def_payment:pay_2'])
    expect(h.updated.some((u) => u.values.bank_deposit_gl_posting_id === 'glp_1')).toBe(true)
  })

  it('deduplicates a payment id sent twice rather than double counting it', async () => {
    await createBankDeposit(db, { ...input, paymentIds: ['pay_1', 'pay_1'] })
    expect(h.created[0]?.values.bank_deposit_total).toBe(100_00)
  })

  it('treats a not_connected ledger as a success, not a failure', async () => {
    // An org with no accounting system connected is a first-class case: the
    // entry is built, balanced and persisted, and simply never pushed.
    h.postResult = { status: 'not_connected' }
    const result = await createBankDeposit(db, input)
    expect(result.isOk()).toBe(true)
    expect(h.archived).toHaveLength(0)
  })

  it('rolls the deposit back when the ledger refuses the entry', async () => {
    h.postResult = { status: 'period_closed', error: 'That month is closed' }
    const result = await createBankDeposit(db, input)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().post.status).toBe('period_closed')
    // Nothing was posted, so there is nothing to reverse - and leaving the
    // payments consumed by a deposit that moved no money would make them
    // ungroupable forever.
    expect(h.archived).toEqual(['def_bank_deposit:dep_1'])
    expect(h.updated.some((u) => u.values.payment_bank_deposit === null)).toBe(true)
  })
})

describe('createBankDeposit reads its payments under the lock, inside the transaction', () => {
  // 🛑 `payment_bank_deposit` is a `FieldValue` row and no unique index can
  // express "at most one deposit per payment" over it. So the already-banked
  // refusal IS the constraint, and a refusal read outside the transaction is a
  // read-modify-write race: two operators banking overlapping selections both
  // see `bankDepositId: null`, both pass, and both post a cash line for the same
  // cheque. Cash is then overstated by that cheque and both entries balance.
  it('takes SELECT ... FOR UPDATE before it reads the payments', async () => {
    await createBankDeposit(db, input)
    expect(h.calls.indexOf('lock:update')).toBeGreaterThan(h.calls.indexOf('begin'))
    expect(h.calls.indexOf('read-payments')).toBeGreaterThan(h.calls.indexOf('lock:update'))
  })

  it('reads the payments with the TRANSACTION handle, never the outer one', async () => {
    await createBankDeposit(db, input)
    expect(h.readWith).toEqual([tx])
  })

  it('reads them before the commit, not after', async () => {
    await createBankDeposit(db, input)
    expect(h.calls.indexOf('read-payments')).toBeLessThan(h.calls.indexOf('commit'))
  })

  it('rolls the whole transaction back when a payment turns out to be banked', async () => {
    h.payments = [payment({ bankDepositId: 'dep_0' })]
    const result = await createBankDeposit(db, input)
    expect(result._unsafeUnwrapErr().message).toMatch(/already in a bank deposit/i)
    // The refusal is raised from inside `db.transaction`, so postgres rolls the
    // create and every link back rather than leaving a half-built deposit.
    expect(h.calls).toContain('begin')
    expect(h.calls).not.toContain('commit')
    expect(h.created).toHaveLength(0)
  })
})

describe('unlinkPaymentsFromDeposit', () => {
  // The raw `DELETE FROM "FieldValue"` this replaced skipped hooks, events and
  // the org cache: the payment read as un-banked in the database and as banked
  // in every cache and subscriber that had already seen it.
  it('releases each payment through the crud handler, not a raw delete', async () => {
    h.deposit = deposit({
      glPostingId: null,
      payments: [payment(), payment({ paymentId: 'pay_2', recordId: 'def_payment:pay_2' })],
    })

    const result = await unlinkPaymentsFromDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
    })

    expect(result._unsafeUnwrap()).toBe(2)
    expect(h.updated).toEqual([
      { recordId: 'def_payment:pay_1', values: { payment_bank_deposit: null } },
      { recordId: 'def_payment:pay_2', values: { payment_bank_deposit: null } },
    ])
  })

  // Releasing the payments of a POSTED deposit leaves `Dr <bank> Cr
  // undeposited_funds` in the books with nothing behind it, and lets the same
  // cheques be banked a second time - cash counted twice, both entries balanced.
  it('refuses once the deposit has posted, naming the entry to reverse', async () => {
    h.deposit = deposit({ glPostingId: 'glp_1' })
    const result = await unlinkPaymentsFromDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
    })
    expect(result._unsafeUnwrapErr().message).toContain('glp_1')
    expect(h.updated).toHaveLength(0)
  })

  it('refuses once the deposit is matched to a bank line', async () => {
    h.deposit = deposit({ status: 'cleared', bankTransactionId: 'bt_9' })
    const result = await unlinkPaymentsFromDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
    })
    expect(result._unsafeUnwrapErr().message).toContain('bt_9')
    expect(h.updated).toHaveLength(0)
  })
})

describe('clearBankDeposit', () => {
  it('sets status, clearedAt and the bank line in one write', async () => {
    const result = await clearBankDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
      bankTransactionId: 'bt_9',
      clearedAt: new Date('2026-09-05T00:00:00Z'),
    })
    expect(result.isOk()).toBe(true)
    expect(h.updated[0]?.values).toEqual({
      bank_deposit_status: 'cleared',
      bank_deposit_cleared_at: '2026-09-05T00:00:00.000Z',
      bank_deposit_bank_transaction_id: 'bt_9',
    })
  })

  it('refuses a second clear, naming the line it already matched', async () => {
    h.deposit = deposit({ status: 'cleared', bankTransactionId: 'bt_9' })
    const result = await clearBankDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
      bankTransactionId: 'bt_10',
    })
    expect(result._unsafeUnwrapErr().message).toContain('bt_9')
  })

  it('refuses a blank bank line', async () => {
    const result = await clearBankDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
      bankTransactionId: '  ',
    })
    expect(result._unsafeUnwrapErr().message).toMatch(/name the bank line/i)
  })
})

describe('updateBankDeposit', () => {
  it('edits reference and account while the deposit is still pending', async () => {
    const result = await updateBankDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
      reference: ' slip-77 ',
      bankAccountCode: '1010',
    })
    expect(result.isOk()).toBe(true)
    expect(h.updated[0]?.values).toEqual({
      bank_deposit_bank_account: '1010',
      bank_deposit_reference: 'slip-77',
    })
  })

  it('refuses once the deposit is matched, naming the bank line', async () => {
    h.deposit = deposit({ status: 'cleared', bankTransactionId: 'bt_9' })
    const result = await updateBankDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
      reference: 'nope',
    })
    const message = result._unsafeUnwrapErr().message
    expect(message).toContain('bt_9')
    expect(message).toMatch(/reverse its posting/i)
    expect(h.updated).toHaveLength(0)
  })

  it('freezes the date once the entry has posted, even while pending', async () => {
    // The deposit date IS the posting's txnDate, and a posted entry is
    // immutable. Editing it here would leave the record claiming one accounting
    // date and the ledger holding another.
    h.deposit = deposit({ glPostingId: 'glp_1' })
    const result = await updateBankDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
      depositDate: '2026-09-04',
    })
    expect(result._unsafeUnwrapErr().message).toMatch(/already posted/i)
    expect(h.updated).toHaveLength(0)
  })

  it('lets an unposted pending deposit move its date', async () => {
    const result = await updateBankDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
      depositDate: '2026-09-04',
    })
    expect(result.isOk()).toBe(true)
    expect(h.updated[0]?.values).toEqual({ bank_deposit_date: '2026-09-04' })
  })

  // 🛑 The bank account is now the DEBIT LEG of the entry, not a memo string.
  // Editing it after the post would leave the slip saying the money is in
  // savings while the balance sheet keeps it in checking, and the bank
  // reconciliation of BOTH accounts would be wrong.
  it('freezes the bank account once the entry has posted, even while pending', async () => {
    h.deposit = deposit({ glPostingId: 'glp_1' })
    const result = await updateBankDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
      bankAccountCode: '1020',
    })
    expect(result._unsafeUnwrapErr().message).toMatch(/already posted/i)
    expect(h.updated).toHaveLength(0)
  })

  // The date has always behaved this way; re-sending the SAME account must not
  // become a refusal just because the deposit has posted.
  it('lets a posted deposit re-send the account it already has', async () => {
    h.deposit = deposit({ glPostingId: 'glp_1', bankAccountCode: '1000' })
    const result = await updateBankDeposit(db, {
      organizationId: ORG,
      actorUserId: USER,
      depositId: 'dep_1',
      bankAccountCode: '1000',
      reference: 'slip-88',
    })
    expect(result.isOk()).toBe(true)
    expect(h.updated[0]?.values).toEqual({ bank_deposit_reference: 'slip-88' })
  })
})
