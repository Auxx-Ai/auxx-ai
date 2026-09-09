// packages/lib/src/postings/__tests__/build-credit-memo-entry.test.ts
//
// Three of these are worth more than the arithmetic:
//
//  1. **The revenue leg debits 4090, never the original revenue account.** A
//     reversal netted into `4000` leaves a return rate nobody can see.
//  2. **Tax is transcribed, and `total` must tie to `subtotal + tax`.** The
//     entry ties to the stored totals by construction or it refuses.
//  3. **The period key is the memo's own number**, so a second issue of the
//     same memo claims the same tuple and converges to `already_posted`. A
//     cuid would blow the 21-character document-number cap outright.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import {
  type BuildCreditMemoEntryInput,
  buildCreditMemoEntry,
  CREDIT_MEMO_POSTING_TYPE,
  CREDIT_MEMO_SOURCE_TYPE,
} from '../build-credit-memo-entry'
import { ACCOUNT_ROLES } from '../build-entry'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH, DOC_NUMBER_PREFIX } from '../doc-number'
import { SINGLE_WRITER_ROLES_BY_POSTING_TYPE } from '../regime'
import { POSTING_TYPES } from '../types'

const BASE: BuildCreditMemoEntryInput = {
  creditMemoId: 'ei_credit_memo_1',
  number: 'CM-0007',
  issuedAt: '2026-09-08',
  currency: 'USD',
  subtotal: 12_000,
  taxTotal: 990,
  total: 12_990,
  reverseRevenue: true,
}

const SETTLEMENT = { role: 'clearing_card' as const, amount: 12_990 }

function expectRefusal(fn: () => unknown): UnprocessableEntityError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    return error as UnprocessableEntityError
  }
  throw new Error('Expected a refusal, got a built entry')
}

function lines(built: ReturnType<typeof buildCreditMemoEntry>, role: string) {
  return built.entry.lines.filter((row) => row.accountRole === role)
}

describe('a native credit memo (reverseRevenue, no settlement)', () => {
  const built = buildCreditMemoEntry(BASE)

  it('balances by construction', () => {
    expect(built.entry.totalDebit).toBe(12_990)
    expect(built.entry.totalCredit).toBe(12_990)
  })

  it('is the credit_memo posting type', () => {
    expect(built.entry.postingType).toBe(CREDIT_MEMO_POSTING_TYPE)
    expect(CREDIT_MEMO_POSTING_TYPE).toBe('credit_memo')
  })

  it('debits returns and allowances for the subtotal, never the original revenue account', () => {
    const [debit] = lines(built, ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES)
    expect(debit).toMatchObject({ direction: 'debit', amount: 12_000 })
    expect(lines(built, ACCOUNT_ROLES.REVENUE_SERVICE)).toHaveLength(0)
    expect(lines(built, ACCOUNT_ROLES.REVENUE_DTC)).toHaveLength(0)
  })

  it('debits sales tax payable for the transcribed tax', () => {
    const [debit] = lines(built, ACCOUNT_ROLES.SALES_TAX_PAYABLE)
    expect(debit).toMatchObject({ direction: 'debit', amount: 990 })
    expect(debit?.memo).toBe('Credit memo CM-0007 sales tax')
  })

  it('credits the receivable for the whole total', () => {
    const [credit] = lines(built, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)
    expect(credit).toMatchObject({ direction: 'credit', amount: 12_990 })
    expect(built.entry.lines).toHaveLength(3)
  })

  it('touches no clearing account', () => {
    expect(lines(built, ACCOUNT_ROLES.CLEARING_CARD)).toHaveLength(0)
    expect(built.settlementMinor).toBe(0)
  })

  it('carries the memo as sourceType/sourceId on every line, by ROLE', () => {
    for (const row of built.entry.lines) {
      expect(row.sourceType).toBe(CREDIT_MEMO_SOURCE_TYPE)
      expect(row.sourceId).toBe('ei_credit_memo_1')
      expect(row.accountCode).toBeUndefined()
    }
    expect(CREDIT_MEMO_SOURCE_TYPE).toBe('credit_memo')
  })

  it('keys periodKey on the memo number and dates the entry on issuedAt', () => {
    expect(built.periodKey).toBe('CM-0007')
    expect(built.entry.periodKey).toBe('CM-0007')
    expect(built.entry.txnDate).toBe('2026-09-08')
  })

  it('honours a backdated issue date', () => {
    expect(buildCreditMemoEntry({ ...BASE, issuedAt: '2026-07-31' }).entry.txnDate).toBe(
      '2026-07-31'
    )
  })

  it('defaults the memo to naming the document, and honours an override', () => {
    expect(built.entry.lines[0]?.memo).toBe('Credit memo CM-0007')
    const withMemo = buildCreditMemoEntry({ ...BASE, memo: 'Returned bracket' })
    expect(withMemo.entry.lines[0]?.memo).toBe('Returned bracket')
    expect(withMemo.entry.lines[1]?.memo).toBe('Returned bracket sales tax')
  })

  it('reports the amounts it posted', () => {
    expect(built.totalMinor).toBe(12_990)
    expect(built.subtotalMinor).toBe(12_000)
    expect(built.taxTotalMinor).toBe(990)
  })

  it('assigns sortOrder in presentation order with no gaps', () => {
    expect(built.entry.lines.map((row) => row.sortOrder)).toEqual([0, 1, 2])
  })
})

describe('tax', () => {
  it('omits the tax leg when the tax is zero rather than posting a line that moves nothing', () => {
    const built = buildCreditMemoEntry({ ...BASE, taxTotal: 0, total: 12_000 })
    expect(lines(built, ACCOUNT_ROLES.SALES_TAX_PAYABLE)).toHaveLength(0)
    expect(built.entry.lines).toHaveLength(2)
    expect(built.taxTotalMinor).toBe(0)
    expect(built.entry.totalDebit).toBe(12_000)
  })

  it('treats a null tax as no tax leg, not as a refusal', () => {
    const built = buildCreditMemoEntry({ ...BASE, taxTotal: null, total: 12_000 })
    expect(lines(built, ACCOUNT_ROLES.SALES_TAX_PAYABLE)).toHaveLength(0)
    expect(built.taxTotalMinor).toBe(0)
    expect(built.entry.lines.map((row) => row.sortOrder)).toEqual([0, 1])
  })

  it('treats an undefined tax the same way', () => {
    const built = buildCreditMemoEntry({ ...BASE, taxTotal: undefined, total: 12_000 })
    expect(built.entry.lines).toHaveLength(2)
  })

  it('reverses only the tax on a memo that is all tax', () => {
    const built = buildCreditMemoEntry({ ...BASE, subtotal: 0, taxTotal: 990, total: 990 })
    expect(lines(built, ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES)).toHaveLength(0)
    expect(lines(built, ACCOUNT_ROLES.SALES_TAX_PAYABLE)[0]?.amount).toBe(990)
    expect(lines(built, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)[0]?.amount).toBe(990)
  })

  // `FieldValue.valueNumber` is `doublePrecision`, so a stored `12000` can read
  // back as `11999.999999999998`. The builder rounds the noise floor.
  it('absorbs double-precision noise on the stored totals', () => {
    const built = buildCreditMemoEntry({
      ...BASE,
      subtotal: 11_999.999999999998,
      taxTotal: 990.0000000000001,
      total: 12_989.999999999998,
    })
    expect(built.subtotalMinor).toBe(12_000)
    expect(built.taxTotalMinor).toBe(990)
    expect(built.totalMinor).toBe(12_990)
  })
})

describe('a channel credit memo with a settlement', () => {
  it('adds Dr accounts_receivable / Cr clearing_card to the SAME entry as the revenue leg', () => {
    const built = buildCreditMemoEntry({ ...BASE, settlement: SETTLEMENT })

    expect(built.entry.lines).toHaveLength(5)
    const receivable = lines(built, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)
    expect(receivable).toHaveLength(2)
    expect(receivable.find((row) => row.direction === 'credit')?.amount).toBe(12_990)
    expect(receivable.find((row) => row.direction === 'debit')?.amount).toBe(12_990)

    const [clearing] = lines(built, ACCOUNT_ROLES.CLEARING_CARD)
    expect(clearing).toMatchObject({ direction: 'credit', amount: 12_990 })
    expect(clearing?.memo).toBe('Credit memo CM-0007 refunded')

    expect(built.settlementMinor).toBe(12_990)
    expect(built.entry.totalDebit).toBe(25_980)
    expect(built.entry.totalCredit).toBe(25_980)
    expect(built.entry.lines.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3, 4])
  })

  it('posts only the money leg on the pre-fulfillment branch (no revenue was ever posted)', () => {
    const built = buildCreditMemoEntry({ ...BASE, reverseRevenue: false, settlement: SETTLEMENT })

    expect(built.entry.lines).toHaveLength(2)
    expect(lines(built, ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES)).toHaveLength(0)
    expect(lines(built, ACCOUNT_ROLES.SALES_TAX_PAYABLE)).toHaveLength(0)
    expect(lines(built, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)[0]).toMatchObject({
      direction: 'debit',
      amount: 12_990,
    })
    expect(lines(built, ACCOUNT_ROLES.CLEARING_CARD)[0]).toMatchObject({
      direction: 'credit',
      amount: 12_990,
    })
    expect(built.entry.totalDebit).toBe(12_990)
    expect(built.totalMinor).toBe(0)
    expect(built.subtotalMinor).toBe(0)
    expect(built.taxTotalMinor).toBe(0)
    expect(built.settlementMinor).toBe(12_990)
  })

  it('allows a settlement smaller than the total', () => {
    const built = buildCreditMemoEntry({
      ...BASE,
      settlement: { role: 'clearing_card', amount: 5_000 },
    })
    expect(lines(built, ACCOUNT_ROLES.CLEARING_CARD)[0]?.amount).toBe(5_000)
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })
})

describe('refusals', () => {
  it('refuses a memo with neither a revenue leg nor a settlement, naming why', () => {
    const error = expectRefusal(() => buildCreditMemoEntry({ ...BASE, reverseRevenue: false }))
    expect(error.message).toMatch(/reverses no revenue and carries no settlement/)
    expect(error.message).toMatch(/CM-0007/)
  })

  it('refuses a total that does not equal subtotal plus tax', () => {
    const error = expectRefusal(() => buildCreditMemoEntry({ ...BASE, total: 13_000 }))
    expect(error.message).toMatch(/totals 13000 but its subtotal 12000 plus tax 990 is 12990/)
  })

  it('refuses a zero total', () => {
    const error = expectRefusal(() =>
      buildCreditMemoEntry({ ...BASE, subtotal: 0, taxTotal: 0, total: 0 })
    )
    expect(error.message).toMatch(/totals 0/)
  })

  it('refuses a null total as a zero total', () => {
    expectRefusal(() => buildCreditMemoEntry({ ...BASE, subtotal: 0, taxTotal: 0, total: null }))
  })

  it('refuses a negative subtotal', () => {
    const error = expectRefusal(() =>
      buildCreditMemoEntry({ ...BASE, subtotal: -100, taxTotal: 0, total: -100 })
    )
    expect(error.message).toMatch(/Neither is ever negative/)
  })

  it('refuses negative tax', () => {
    const error = expectRefusal(() =>
      buildCreditMemoEntry({ ...BASE, subtotal: 12_000, taxTotal: -10, total: 11_990 })
    )
    expect(error.message).toMatch(/Neither is ever negative/)
  })

  it('refuses a fractional subtotal, tax or total', () => {
    expectRefusal(() => buildCreditMemoEntry({ ...BASE, subtotal: 12_000.5, total: 12_990.5 }))
    expectRefusal(() => buildCreditMemoEntry({ ...BASE, taxTotal: 990.5, total: 12_990.5 }))
    expectRefusal(() => buildCreditMemoEntry({ ...BASE, total: 12_990.5 }))
  })

  it('refuses a non-finite amount', () => {
    expectRefusal(() => buildCreditMemoEntry({ ...BASE, total: Number.NaN }))
  })

  it('refuses a settlement that is zero, negative or fractional', () => {
    for (const amount of [0, -1, 10.5]) {
      const error = expectRefusal(() =>
        buildCreditMemoEntry({ ...BASE, settlement: { role: 'clearing_card', amount } })
      )
      expect(error.message).toMatch(/positive whole number of minor units/)
    }
  })

  it('refuses a settlement larger than the total', () => {
    const error = expectRefusal(() =>
      buildCreditMemoEntry({ ...BASE, settlement: { role: 'clearing_card', amount: 13_000 } })
    )
    expect(error.message).toMatch(/cannot have paid back more than the memo credits/)
  })

  it('refuses a blank memo number', () => {
    const error = expectRefusal(() => buildCreditMemoEntry({ ...BASE, number: '  ' }))
    expect(error.message).toMatch(/Credit memo number is empty/)
  })

  it('refuses a currency that differs from the ledger currency', () => {
    const error = expectRefusal(() =>
      buildCreditMemoEntry({ ...BASE, currency: 'EUR', ledgerCurrency: 'USD' })
    )
    expect(error.message).toMatch(/is in EUR and the ledger is kept in USD/)
  })

  it('accepts a matching ledger currency, and a blank memo currency as the ledger currency', () => {
    expect(() => buildCreditMemoEntry({ ...BASE, ledgerCurrency: 'USD' })).not.toThrow()
    expect(() =>
      buildCreditMemoEntry({ ...BASE, currency: '', ledgerCurrency: 'USD' })
    ).not.toThrow()
  })
})

// The convergence key. `postEntry` claims `(org, credit_memo, periodKey,
// revision)` under a unique index, so the same memo built twice must mint the
// same key and a different memo must not.
describe('the already-posted convergence key', () => {
  it('is deterministic for one memo, whatever the amounts', () => {
    const first = buildCreditMemoEntry(BASE)
    const second = buildCreditMemoEntry({ ...BASE, memo: 'again', taxTotal: 0, total: 12_000 })
    expect(second.periodKey).toBe(first.periodKey)
    expect(buildDocNumber({ postingType: 'credit_memo', periodKey: first.periodKey })).toBe(
      buildDocNumber({ postingType: 'credit_memo', periodKey: second.periodKey })
    )
  })

  it('differs between two memos', () => {
    const other = buildCreditMemoEntry({
      ...BASE,
      creditMemoId: 'ei_credit_memo_2',
      number: 'CM-0008',
    })
    expect(other.periodKey).not.toBe(buildCreditMemoEntry(BASE).periodKey)
  })

  it('trims the memo number so a padded copy of the same number converges', () => {
    expect(buildCreditMemoEntry({ ...BASE, number: ' CM-0007 ' }).periodKey).toBe('CM-0007')
  })
})

describe('the document number', () => {
  it('is CRM, and no other posting type holds CRM', () => {
    expect(DOC_NUMBER_PREFIX.credit_memo).toBe('CRM')
    const holders = POSTING_TYPES.filter((type) => DOC_NUMBER_PREFIX[type] === 'CRM')
    expect(holders).toEqual(['credit_memo'])
  })

  it('composes within the cap with room for the void reversal', () => {
    const built = buildCreditMemoEntry(BASE)
    expect(buildDocNumber({ postingType: 'credit_memo', periodKey: built.periodKey })).toBe(
      'AUXX-CRM-CM0007'
    )
    expect(
      buildDocNumber({ postingType: 'credit_memo', periodKey: built.periodKey, revision: 1 })
    ).toBe('AUXX-CRM-CM0007-R1')
    expect(
      buildDocNumber({ postingType: 'credit_memo', periodKey: built.periodKey, revision: 9 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('refuses at BUILD time a memo number that would only fail at reversal', () => {
    // Twelve compacted characters posts fine at revision 0 (exactly the cap)
    // and refuses at 24 the day the memo is voided. The refusal has to happen
    // before anything is claimed.
    const error = expectRefusal(() => buildCreditMemoEntry({ ...BASE, number: 'CM-202609-0007' }))
    expect(error.message).toMatch(/compacts to 12 characters/)
    expect(error.message).toMatch(/manual journal entry/)
  })
})

describe('the regime', () => {
  it('declares credit_memo as driving no single-writer role', () => {
    expect(SINGLE_WRITER_ROLES_BY_POSTING_TYPE.credit_memo).toEqual([])
  })
})
