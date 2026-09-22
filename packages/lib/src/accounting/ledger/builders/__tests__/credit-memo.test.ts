// packages/lib/src/accounting/ledger/builders/__tests__/credit-memo.test.ts
//
// Three of these are worth more than the arithmetic:
//
//  1. **The revenue leg debits 4090, never the original revenue account.** A
//     reversal netted into `4000` leaves a return rate nobody can see.
//  2. **Tax is transcribed, and `total` must tie to the lines.** The entry ties
//     to the stored totals by construction or it refuses.
//  3. **Only the shipped lines post** (91 D4): an unshipped line reverses no revenue.
//  4. **The period key is the memo's own number**, so a second issue of the
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
  computeCreditMemoAmounts,
} from '../credit-memo'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH, DOC_NUMBER_PREFIX } from '../doc-number'
import { ACCOUNT_ROLES } from '../entry'

const BASE: BuildCreditMemoEntryInput = {
  creditMemoId: 'ei_credit_memo_1',
  number: 'CM-0007',
  issuedAt: '2026-09-08',
  currency: 'USD',
  lines: [{ subtotal: 12_000, taxTotal: 990, shipped: true }],
  total: 12_990,
}

/** One shipped line carrying these amounts. */
function one(
  subtotal: number | null | undefined,
  taxTotal: number | null | undefined,
  total: number | null | undefined
): BuildCreditMemoEntryInput {
  return { ...BASE, lines: [{ subtotal, taxTotal, shipped: true }], total }
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

describe('a memo whose one line shipped', () => {
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
    const built = buildCreditMemoEntry(one(12_000, 0, 12_000))
    expect(lines(built, ACCOUNT_ROLES.SALES_TAX_PAYABLE)).toHaveLength(0)
    expect(built.entry.lines).toHaveLength(2)
    expect(built.taxTotalMinor).toBe(0)
    expect(built.entry.totalDebit).toBe(12_000)
  })

  it('treats a null tax as no tax leg, not as a refusal', () => {
    const built = buildCreditMemoEntry(one(12_000, null, 12_000))
    expect(lines(built, ACCOUNT_ROLES.SALES_TAX_PAYABLE)).toHaveLength(0)
    expect(built.taxTotalMinor).toBe(0)
    expect(built.entry.lines.map((row) => row.sortOrder)).toEqual([0, 1])
  })

  it('treats an undefined tax the same way', () => {
    const built = buildCreditMemoEntry(one(12_000, undefined, 12_000))
    expect(built.entry.lines).toHaveLength(2)
  })

  it('reverses only the tax on a memo that is all tax', () => {
    const built = buildCreditMemoEntry(one(0, 990, 990))
    expect(lines(built, ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES)).toHaveLength(0)
    expect(lines(built, ACCOUNT_ROLES.SALES_TAX_PAYABLE)[0]?.amount).toBe(990)
    expect(lines(built, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)[0]?.amount).toBe(990)
  })

  // `FieldValue.valueNumber` is `doublePrecision`, so a stored `12000` can read
  // back as `11999.999999999998`. The builder rounds the noise floor.
  it('absorbs double-precision noise on the stored totals', () => {
    const built = buildCreditMemoEntry(
      one(11_999.999999999998, 990.0000000000001, 12_989.999999999998)
    )
    expect(built.subtotalMinor).toBe(12_000)
    expect(built.taxTotalMinor).toBe(990)
    expect(built.totalMinor).toBe(12_990)
  })
})

describe('per line: only what had shipped reverses (91 D4)', () => {
  const shipped = { subtotal: 5_000, taxTotal: 400, shipped: true }
  const unshipped = { subtotal: 7_000, taxTotal: 590, shipped: false }

  it('a shipped line posts returns and its tax against A/R', () => {
    const built = buildCreditMemoEntry({ ...BASE, lines: [shipped], total: 5_400 })
    expect(built.entry.lines.map((row) => [row.accountRole, row.direction, row.amount])).toEqual([
      [ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES, 'debit', 5_000],
      [ACCOUNT_ROLES.SALES_TAX_PAYABLE, 'debit', 400],
      [ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE, 'credit', 5_400],
    ])
  })

  it('an unshipped line posts nothing, so a memo of only those refuses to build', () => {
    const error = expectRefusal(() =>
      buildCreditMemoEntry({ ...BASE, lines: [unshipped], total: 7_590 })
    )
    expect(error.message).toMatch(/no line that had shipped/)
    expect(
      computeCreditMemoAmounts({
        creditMemoId: BASE.creditMemoId,
        number: BASE.number,
        lines: [unshipped],
        total: 7_590,
      })
    ).toEqual({ subtotalMinor: 0, shippingMinor: 0, taxTotalMinor: 0, totalMinor: 0 })
  })

  it('a mixed memo posts only the shipped line, tax included, and still ties the whole memo', () => {
    const built = buildCreditMemoEntry({ ...BASE, lines: [shipped, unshipped], total: 12_990 })
    expect(built.subtotalMinor).toBe(5_000)
    expect(built.taxTotalMinor).toBe(400)
    expect(built.totalMinor).toBe(5_400)
    expect(lines(built, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)[0]?.amount).toBe(5_400)
    expect(built.entry.totalDebit).toBe(5_400)
    expectRefusal(() =>
      buildCreditMemoEntry({ ...BASE, lines: [shipped, unshipped], total: 5_400 })
    )
  })

  it('never touches customer_deposits', () => {
    const built = buildCreditMemoEntry({ ...BASE, lines: [shipped, unshipped], total: 12_990 })
    expect(built.entry.lines.some((row) => row.accountRole === 'customer_deposits')).toBe(false)
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
    const error = expectRefusal(() => buildCreditMemoEntry(one(12_000, 990, 13_000)))
    expect(error.message).toMatch(/totals 13000 but its subtotal 12000 plus tax 990 is 12990/)
  })

  it('refuses a zero total', () => {
    const error = expectRefusal(() => buildCreditMemoEntry(one(0, 0, 0)))
    expect(error.message).toMatch(/totals 0/)
  })

  it('refuses a null total as a zero total', () => {
    expectRefusal(() => buildCreditMemoEntry(one(0, 0, null)))
  })

  it('refuses a negative subtotal', () => {
    const error = expectRefusal(() => buildCreditMemoEntry(one(-100, 0, -100)))
    expect(error.message).toMatch(/Neither is ever negative/)
  })

  it('refuses negative tax', () => {
    const error = expectRefusal(() => buildCreditMemoEntry(one(12_000, -10, 11_990)))
    expect(error.message).toMatch(/Neither is ever negative/)
  })

  it('refuses a fractional subtotal, tax or total', () => {
    expectRefusal(() => buildCreditMemoEntry(one(12_000.5, 990, 12_990.5)))
    expectRefusal(() => buildCreditMemoEntry(one(12_000, 990.5, 12_990.5)))
    expectRefusal(() => buildCreditMemoEntry(one(12_000, 990, 12_990.5)))
  })

  it('refuses a non-finite amount', () => {
    expectRefusal(() => buildCreditMemoEntry(one(12_000, 990, Number.NaN)))
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
    const second = buildCreditMemoEntry({ ...one(12_000, 0, 12_000), memo: 'again' })
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

describe('a shipping-only refund (91 D8)', () => {
  const shippingLine = {
    subtotal: 1_500,
    taxTotal: 120,
    shipped: true,
    component: 'shipping' as const,
  }

  it('debits revenue_shipping and its tax against A/R, never returns', () => {
    const built = buildCreditMemoEntry({ ...BASE, lines: [shippingLine], total: 1_620 })
    expect(lines(built, ACCOUNT_ROLES.REVENUE_SHIPPING)).toMatchObject([
      { direction: 'debit', amount: 1_500 },
    ])
    expect(lines(built, ACCOUNT_ROLES.SALES_TAX_PAYABLE)).toMatchObject([
      { direction: 'debit', amount: 120 },
    ])
    expect(lines(built, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)).toMatchObject([
      { direction: 'credit', amount: 1_620 },
    ])
    expect(lines(built, ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES)).toEqual([])
    expect(built.shippingMinor).toBe(1_500)
    expect(built.subtotalMinor).toBe(0)
  })

  it('splits goods and shipping on one memo', () => {
    const built = buildCreditMemoEntry({
      ...BASE,
      lines: [{ subtotal: 12_000, taxTotal: 990, shipped: true }, shippingLine],
      total: 14_610,
    })
    expect(lines(built, ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES)[0]?.amount).toBe(12_000)
    expect(lines(built, ACCOUNT_ROLES.REVENUE_SHIPPING)[0]?.amount).toBe(1_500)
    expect(lines(built, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)[0]?.amount).toBe(14_610)
  })

  it('posts nothing for shipping that was never recognised', () => {
    expect(
      computeCreditMemoAmounts({
        creditMemoId: BASE.creditMemoId,
        number: BASE.number,
        lines: [{ ...shippingLine, shipped: false }],
        total: 1_620,
      }).totalMinor
    ).toBe(0)
  })
})
