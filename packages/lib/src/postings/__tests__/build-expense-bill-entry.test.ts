// packages/lib/src/postings/__tests__/build-expense-bill-entry.test.ts
//
// Four of these are worth more than the arithmetic:
//
//  1. **Every payable line carries `counterpartyType: 'vendor'` and the company
//     id.** The QuickBooks provider REFUSES a line on an `accounts_payable`
//     account with no counterparty, so getting this wrong makes the EXPORT fail
//     rather than the post - a failure that surfaces days later, in a screen
//     nobody was looking at.
//  2. **An uncoded line REFUSES, naming the line.** There is no default expense
//     account, and there must never be one: a bill silently coded to
//     "miscellaneous" balances perfectly and is invisible on the P&L.
//  3. **The entry ties to the bill's stored total or it does not post.** A
//     bill's totals are transcribed from the vendor's document; plugging the
//     difference would be a guess about which account header tax belongs in.
//  4. **`expense_bill` drives NO single-writer role**, so it cannot conflict
//     with `month_end_inventory` and this ships with the L3 switch untouched.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import {
  buildExpenseBillEntry,
  EXPENSE_BILL_POSTING_TYPE,
  EXPENSE_BILL_SOURCE_TYPE,
} from '../build-expense-bill-entry'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH, DOC_NUMBER_PREFIX } from '../doc-number'
import {
  ENABLED_POSTING_TYPES,
  findWriterConflicts,
  SINGLE_WRITER_ROLES_BY_POSTING_TYPE,
} from '../regime'

const VENDOR = 'ei_company_landlord'

const BASE = {
  vendorBillId: 'ei_bill_1',
  internalNumber: 'BILL-0007',
  billedAt: '2026-09-01',
  currency: 'USD',
  ledgerCurrency: 'USD',
  total: 250_000,
  vendorCompanyInstanceId: VENDOR,
  lines: [
    {
      lineId: 'ei_line_1',
      glAccountId: 'ei_acct_rent',
      amount: 250_000,
      description: 'September rent',
    },
  ],
}

function payable(entry: ReturnType<typeof buildExpenseBillEntry>['entry']) {
  return entry.lines.find((row) => row.accountRole === ACCOUNT_ROLES.ACCOUNTS_PAYABLE)
}

function expenseLines(entry: ReturnType<typeof buildExpenseBillEntry>['entry']) {
  return entry.lines.filter((row) => !!row.glAccountId)
}

describe('a rent bill', () => {
  it('debits the coded expense account and credits accounts payable for the total', () => {
    const built = buildExpenseBillEntry(BASE)

    expect(built.entry.lines).toHaveLength(2)
    const debit = expenseLines(built.entry)[0]
    expect(debit?.glAccountId).toBe('ei_acct_rent')
    expect(debit?.direction).toBe('debit')
    expect(debit?.amount).toBe(250_000)
    expect(payable(built.entry)?.direction).toBe('credit')
    expect(payable(built.entry)?.amount).toBe(250_000)
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
    expect(built.totalMinor).toBe(250_000)
  })

  it('touches no inventory role, no GRNI and no purchase price variance', () => {
    const built = buildExpenseBillEntry(BASE)
    const roles = built.entry.lines.map((row) => row.accountRole).filter(Boolean)
    expect(roles).toEqual([ACCOUNT_ROLES.ACCOUNTS_PAYABLE])
  })

  it('names the expense account by ID and never beside a role or a code', () => {
    const built = buildExpenseBillEntry(BASE)
    const debit = expenseLines(built.entry)[0]
    // `buildEntry` refuses a line that names an account two ways, so the debit
    // must carry the id ALONE.
    expect(debit?.accountRole).toBeUndefined()
    expect(debit?.accountCode).toBeUndefined()
  })

  it('sources every line on the vendor bill, which is what A/P aging groups by', () => {
    const built = buildExpenseBillEntry(BASE)
    for (const row of built.entry.lines) {
      expect(row.sourceType).toBe(EXPENSE_BILL_SOURCE_TYPE)
      expect(row.sourceId).toBe(BASE.vendorBillId)
    }
    // 🛑 `vendor_bill`, not `expense_bill`: `reports/aging.ts` resolves the
    // number, the due date, the vendor and the badge off this string.
    expect(EXPENSE_BILL_SOURCE_TYPE).toBe('vendor_bill')
  })

  it('dates the entry on the bill, never on today', () => {
    const built = buildExpenseBillEntry({ ...BASE, billedAt: '2026-08-31' })
    expect(built.entry.txnDate).toBe('2026-08-31')
  })
})

describe('the counterparty', () => {
  it('carries the vendor company on the payable line', () => {
    const built = buildExpenseBillEntry(BASE)
    expect(payable(built.entry)?.counterpartyType).toBe('vendor')
    expect(payable(built.entry)?.counterpartyId).toBe(VENDOR)
  })

  it('carries it on NO expense line - only the payable is attributable', () => {
    const built = buildExpenseBillEntry({
      ...BASE,
      total: 300_000,
      lines: [
        { lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 250_000, description: 'Rent' },
        { lineId: 'l2', glAccountId: 'ei_acct_ins', amount: 50_000, description: 'Insurance' },
      ],
    })
    for (const row of expenseLines(built.entry)) {
      expect(row.counterpartyType).toBeUndefined()
      expect(row.counterpartyId).toBeUndefined()
    }
  })

  it('still posts without one - the ledger is not the door that refuses', () => {
    const built = buildExpenseBillEntry({ ...BASE, vendorCompanyInstanceId: null })
    expect(payable(built.entry)?.counterpartyId).toBeUndefined()
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })
})

describe('several coded lines', () => {
  const MULTI = {
    ...BASE,
    total: 310_000,
    lines: [
      { lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 250_000, description: 'Rent' },
      { lineId: 'l2', glAccountId: 'ei_acct_ins', amount: 50_000, description: 'Insurance' },
      { lineId: 'l3', glAccountId: 'ei_acct_soft', amount: 10_000, description: 'Software' },
    ],
  }

  it('produces one debit per line and exactly ONE payable credit', () => {
    const built = buildExpenseBillEntry(MULTI)

    expect(expenseLines(built.entry)).toHaveLength(3)
    const payables = built.entry.lines.filter(
      (row) => row.accountRole === ACCOUNT_ROLES.ACCOUNTS_PAYABLE
    )
    expect(payables).toHaveLength(1)
    expect(payables[0]?.amount).toBe(310_000)
    expect(built.entry.totalDebit).toBe(310_000)
    expect(built.entry.totalCredit).toBe(310_000)
  })

  it('keeps two lines coded to the SAME account apart rather than merging them', () => {
    const built = buildExpenseBillEntry({
      ...BASE,
      total: 300_000,
      lines: [
        { lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 250_000, description: 'Unit A' },
        { lineId: 'l2', glAccountId: 'ei_acct_rent', amount: 50_000, description: 'Unit B' },
      ],
    })
    expect(expenseLines(built.entry)).toHaveLength(2)
    expect(built.expenseLines.map((row) => row.lineId)).toEqual(['l1', 'l2'])
  })

  it('orders the debits by the bill, with the payable last', () => {
    const built = buildExpenseBillEntry(MULTI)
    expect(built.entry.lines.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3])
    expect(built.entry.lines.at(-1)?.accountRole).toBe(ACCOUNT_ROLES.ACCOUNTS_PAYABLE)
  })

  it('posts a negative line as a credit to its own account, not as a negative debit', () => {
    const built = buildExpenseBillEntry({
      ...BASE,
      total: 240_000,
      lines: [
        { lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 250_000, description: 'Rent' },
        { lineId: 'l2', glAccountId: 'ei_acct_rent', amount: -10_000, description: 'Goodwill' },
      ],
    })
    const credit = expenseLines(built.entry).find((row) => row.direction === 'credit')
    expect(credit?.amount).toBe(10_000)
    expect(built.entry.totalDebit).toBe(250_000)
    expect(built.entry.totalCredit).toBe(250_000)
  })

  it('drops a zero line rather than refusing it - a no-charge line is ordinary', () => {
    const built = buildExpenseBillEntry({
      ...BASE,
      lines: [
        { lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 250_000, description: 'Rent' },
        { lineId: 'l2', glAccountId: null, amount: 0, description: 'Included: cleaning' },
      ],
    })
    expect(expenseLines(built.entry)).toHaveLength(1)
  })
})

describe('refusals', () => {
  it('refuses an uncoded line, naming it', () => {
    expect(() =>
      buildExpenseBillEntry({
        ...BASE,
        total: 300_000,
        lines: [
          { lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 250_000, description: 'Rent' },
          { lineId: 'l2', glAccountId: null, amount: 50_000, description: 'Insurance' },
        ],
      })
    ).toThrow(/Insurance/)
  })

  it('names EVERY uncoded line, so they are coded in one pass', () => {
    let message = ''
    try {
      buildExpenseBillEntry({
        ...BASE,
        total: 300_000,
        lines: [
          { lineId: 'l1', glAccountId: '', amount: 250_000, description: 'Rent' },
          { lineId: 'l2', glAccountId: undefined, amount: 50_000, description: 'Insurance' },
        ],
      })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('Rent')
    expect(message).toContain('Insurance')
  })

  it('falls back to the line position when the line has no description', () => {
    expect(() =>
      buildExpenseBillEntry({
        ...BASE,
        lines: [{ lineId: 'l1', glAccountId: null, amount: 250_000 }],
      })
    ).toThrow(/Line 1/)
  })

  it('refuses when the coded lines do not sum to the stored total, naming the difference', () => {
    let message = ''
    try {
      buildExpenseBillEntry({
        ...BASE,
        // The vendor's header carries $200 of tax that no line accounts for.
        total: 270_000,
      })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('270000')
    expect(message).toContain('250000')
    expect(message).toContain('20000')
  })

  it('refuses a bill that totals nothing', () => {
    expect(() =>
      buildExpenseBillEntry({ ...BASE, total: 0, lines: [{ ...BASE.lines[0]!, amount: 0 }] })
    ).toThrow(UnprocessableEntityError)
  })

  it('refuses a negative total - a vendor credit is its own document', () => {
    expect(() =>
      buildExpenseBillEntry({
        ...BASE,
        total: -250_000,
        lines: [{ ...BASE.lines[0]!, amount: -250_000 }],
      })
    ).toThrow(/vendor credit is its own document/)
  })

  it('refuses a bill in a currency the ledger is not kept in', () => {
    expect(() => buildExpenseBillEntry({ ...BASE, currency: 'EUR' })).toThrow(/implied 1.0 rate/)
  })

  it('refuses a blank internal number - the claim has nothing to key on', () => {
    expect(() => buildExpenseBillEntry({ ...BASE, internalNumber: '  ' })).toThrow(
      UnprocessableEntityError
    )
  })

  it('refuses an internal number that would not survive a reversal', () => {
    expect(() => buildExpenseBillEntry({ ...BASE, internalNumber: 'BILL-2026-000123' })).toThrow(
      /document number/
    )
  })

  it('refuses a fractional line amount - a ledger line is whole cents', () => {
    expect(() =>
      buildExpenseBillEntry({
        ...BASE,
        total: 250_000,
        lines: [{ lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 250_000.5 }],
      })
    ).toThrow(UnprocessableEntityError)
  })

  it('absorbs the double noise floor `FieldValue.valueNumber` introduces', () => {
    const built = buildExpenseBillEntry({
      ...BASE,
      total: 249_999.99999999997,
      lines: [{ lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 250_000.00000000003 }],
    })
    expect(built.totalMinor).toBe(250_000)
  })
})

describe('the document number and the claim index', () => {
  it('keys on the bill INTERNAL number, so one entry per bill falls out of the claim', () => {
    const built = buildExpenseBillEntry(BASE)
    expect(built.periodKey).toBe('BILL-0007')
    expect(built.entry.periodKey).toBe('BILL-0007')
    expect(built.entry.postingType).toBe(EXPENSE_BILL_POSTING_TYPE)
  })

  it('mints AUXX-EXB-<key>, and a void reverses it at -R1 inside the cap', () => {
    const original = buildDocNumber({
      postingType: EXPENSE_BILL_POSTING_TYPE,
      periodKey: 'BILL-0007',
    })
    const reversal = buildDocNumber({
      postingType: EXPENSE_BILL_POSTING_TYPE,
      periodKey: 'BILL-0007',
      revision: 1,
    })
    expect(original).toBe('AUXX-EXB-BILL0007')
    expect(reversal).toBe('AUXX-EXB-BILL0007-R1')
    expect(reversal.length).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('does not reuse BIL, which is the L3 purchasing bill entry', () => {
    expect(DOC_NUMBER_PREFIX.expense_bill).toBe('EXB')
    expect(DOC_NUMBER_PREFIX.vendor_bill).toBe('BIL')
  })
})

describe('the regime', () => {
  it('drives NO single-writer role, so it cannot conflict with month_end_inventory', () => {
    expect(SINGLE_WRITER_ROLES_BY_POSTING_TYPE.expense_bill).toEqual([])
    // The real assertion: enabling it beside the L1 monthly assertion produces
    // no conflict at all. An expense bill names its debits by `gl_account` id,
    // and its only role is `accounts_payable`.
    expect(findWriterConflicts(['month_end_inventory', 'expense_bill'])).toEqual([])
    expect(findWriterConflicts([...ENABLED_POSTING_TYPES, 'expense_bill'])).toEqual([])
  })
})
