// packages/lib/src/accounting/ledger/builders/__tests__/credit-memo.test.ts
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
import { UnprocessableEntityError } from '../../../../errors'
import { SINGLE_WRITER_ROLES_BY_POSTING_TYPE } from '../../roles/regime'
import { POSTING_TYPES } from '../../types'
import {
  type BuildCreditMemoEntryInput,
  buildCreditMemoEntry,
  CREDIT_MEMO_POSTING_TYPE,
  CREDIT_MEMO_SOURCE_TYPE,
} from '../credit-memo'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH, DOC_NUMBER_PREFIX } from '../doc-number'
import { ACCOUNT_ROLES } from '../entry'

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
    expect(lines(built, ACCOUNT_ROLES.REVENUE_PRODUCT)).toHaveLength(0)
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

  it('touches no clearing account — the refund is its own entry (71 D6)', () => {
    expect(lines(built, ACCOUNT_ROLES.CLEARING)).toHaveLength(0)
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

describe('a channel credit memo on an order that never shipped (71 D14, 88 D7)', () => {
  // Nothing was recognised, so there is no revenue to reverse - but the
  // pre-fulfillment receipt credited the net to `customer_deposits` and the tax
  // to `sales_tax_payable`, so the memo mirrors that split onto the control
  // account, and the refund then draws it down like any other memo's.
  const built = buildCreditMemoEntry({ ...BASE, reverseRevenue: false })

  it('mirrors the receipt: Dr customer_deposits (net) · Dr sales_tax_payable (tax) / Cr A/R (total)', () => {
    expect(built.entry.lines).toHaveLength(3)
    expect(lines(built, ACCOUNT_ROLES.CUSTOMER_DEPOSITS)[0]).toMatchObject({
      direction: 'debit',
      amount: 12_000,
    })
    expect(lines(built, ACCOUNT_ROLES.SALES_TAX_PAYABLE)[0]).toMatchObject({
      direction: 'debit',
      amount: 990,
    })
    expect(lines(built, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)[0]).toMatchObject({
      direction: 'credit',
      amount: 12_990,
    })
    expect(built.entry.totalDebit).toBe(12_990)
    expect(built.entry.totalCredit).toBe(12_990)
  })

  it('reverses no revenue, and reports the tax it gave back', () => {
    expect(lines(built, ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES)).toHaveLength(0)
    expect(built.subtotalMinor).toBe(0)
    expect(built.taxTotalMinor).toBe(990)
  })

  it('drops the tax leg on a memo with no tax, and the deposit leg on one that is all tax', () => {
    const noTax = buildCreditMemoEntry({
      ...BASE,
      reverseRevenue: false,
      taxTotal: 0,
      total: 12_000,
    })
    expect(noTax.entry.lines).toHaveLength(2)
    expect(lines(noTax, ACCOUNT_ROLES.SALES_TAX_PAYABLE)).toHaveLength(0)
    const allTax = buildCreditMemoEntry({
      ...BASE,
      reverseRevenue: false,
      subtotal: 0,
      taxTotal: 990,
      total: 990,
    })
    expect(allTax.entry.lines).toHaveLength(2)
    expect(lines(allTax, ACCOUNT_ROLES.CUSTOMER_DEPOSITS)).toHaveLength(0)
  })

  it('still reports the memo total, because that is what it credits', () => {
    expect(built.totalMinor).toBe(12_990)
  })

  it('touches no clearing account — the refund posts its own entry', () => {
    expect(lines(built, ACCOUNT_ROLES.CLEARING)).toHaveLength(0)
  })

  it('carries the contact on the receivable leg, never on the deposit leg', () => {
    const withContact = buildCreditMemoEntry({
      ...BASE,
      reverseRevenue: false,
      contactInstanceId: 'ei_contact_1',
    })
    expect(lines(withContact, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)[0]).toMatchObject({
      counterpartyType: 'customer',
      counterpartyId: 'ei_contact_1',
    })
    expect(lines(withContact, ACCOUNT_ROLES.CUSTOMER_DEPOSITS)[0]?.counterpartyId).toBeUndefined()
  })
})

describe('the counterparty (brief 13 §1.2)', () => {
  it('carries the contact on every accounts_receivable line, never on revenue, tax or clearing', () => {
    const built = buildCreditMemoEntry({ ...BASE, contactInstanceId: 'ei_contact_1' })
    for (const receivable of lines(built, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)) {
      expect(receivable).toMatchObject({
        counterpartyType: 'customer',
        counterpartyId: 'ei_contact_1',
      })
    }
    expect(
      lines(built, ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES)[0]?.counterpartyId
    ).toBeUndefined()
    expect(lines(built, ACCOUNT_ROLES.SALES_TAX_PAYABLE)[0]?.counterpartyId).toBeUndefined()
    expect(lines(built, ACCOUNT_ROLES.CLEARING)[0]?.counterpartyId).toBeUndefined()
  })

  it('posts fine with no contact - the export refuses, not the ledger', () => {
    const built = buildCreditMemoEntry(BASE)
    expect(lines(built, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)[0]?.counterpartyId).toBeUndefined()
  })
})

describe('refusals', () => {
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
      'CM-0007'
    )
    expect(
      buildDocNumber({ postingType: 'credit_memo', periodKey: built.periodKey, revision: 1 })
    ).toBe('CM-0007-R1')
    expect(
      buildDocNumber({ postingType: 'credit_memo', periodKey: built.periodKey, revision: 9 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('refuses at BUILD time a memo number that would only fail at reversal', () => {
    // Sixteen characters fits the 21-character cap at revision 0 and refuses
    // once a repost and a reversal suffix are on it. The refusal has to happen
    // before anything is claimed.
    const error = expectRefusal(() => buildCreditMemoEntry({ ...BASE, number: 'CM-202609-000007' }))
    expect(error.message).toMatch(/is 16 characters/)
    expect(error.message).toMatch(/manual journal entry/)
  })
})

describe('the regime', () => {
  it('declares credit_memo as driving no single-writer role', () => {
    expect(SINGLE_WRITER_ROLES_BY_POSTING_TYPE.credit_memo).toEqual([])
  })
})
