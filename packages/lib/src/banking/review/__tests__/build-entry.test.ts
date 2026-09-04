// packages/lib/src/banking/review/__tests__/build-entry.test.ts
//
// 🛑 **The direction rule is the whole correctness of the coded entry, and it is
// the one error nothing downstream can catch.** Money out that credits the
// expense and debits the bank balances perfectly and states the opposite of what
// happened; the trial balance ties, the balance sheet renders, and the only
// symptom is a P&L that is wrong by twice the amount. So every direction is
// asserted explicitly, in both flows, for both shapes.
//
// Pure - no database, no doubles.

import { describe, expect, it } from 'vitest'
import { buildCodedBankEntry, buildTransferEntry } from '../build-entry'

const BASE = {
  transactionId: 'txn_1',
  periodKey: 'BNK-00A1B2',
  txnDate: '2026-09-10',
  glAccountCode: '6100',
  bankAccountCode: '1000',
}

function side(entry: ReturnType<typeof buildCodedBankEntry>, direction: 'debit' | 'credit') {
  const line = entry.lines.find((candidate) => candidate.direction === direction)
  if (!line) throw new Error(`no ${direction} line`)
  return line as { accountCode: string; amount: number; memo?: string; sortOrder: number }
}

describe('buildCodedBankEntry', () => {
  describe('money OUT', () => {
    const entry = buildCodedBankEntry({ ...BASE, amountMinor: -12_345 })

    it('debits the coded account and credits the bank account', () => {
      expect(side(entry, 'debit').accountCode).toBe('6100')
      expect(side(entry, 'credit').accountCode).toBe('1000')
    })

    it('discards the sign - the amount is positive and direction carries it', () => {
      expect(side(entry, 'debit').amount).toBe(12_345)
      expect(side(entry, 'credit').amount).toBe(12_345)
      expect(entry.lines.every((line) => line.amount > 0)).toBe(true)
    })

    it('balances', () => {
      expect(entry.totalDebit).toBe(entry.totalCredit)
      expect(entry.totalDebit).toBe(12_345)
    })
  })

  describe('money IN', () => {
    const entry = buildCodedBankEntry({ ...BASE, glAccountCode: '4000', amountMinor: 12_345 })

    it('debits the bank account and credits the coded account', () => {
      expect(side(entry, 'debit').accountCode).toBe('1000')
      expect(side(entry, 'credit').accountCode).toBe('4000')
    })

    it('is the exact mirror of the outbound entry', () => {
      const outbound = buildCodedBankEntry({ ...BASE, glAccountCode: '4000', amountMinor: -12_345 })
      expect(side(entry, 'debit').accountCode).toBe(side(outbound, 'credit').accountCode)
      expect(side(entry, 'credit').accountCode).toBe(side(outbound, 'debit').accountCode)
    })
  })

  it('claims the bank_transaction posting type and the caller-minted period key', () => {
    const entry = buildCodedBankEntry({ ...BASE, amountMinor: -100 })
    expect(entry.postingType).toBe('bank_transaction')
    expect(entry.periodKey).toBe('BNK-00A1B2')
    // 🛑 The bank's own date, never today. It is what the period lock reads and
    // what ties the entry to the statement line beside it.
    expect(entry.txnDate).toBe('2026-09-10')
  })

  it('carries the source pair onto every line, so the entry is explainable later', () => {
    const entry = buildCodedBankEntry({ ...BASE, amountMinor: -100 })
    expect(entry.lines.every((line) => line.sourceType === 'bank_transaction')).toBe(true)
    expect(entry.lines.every((line) => line.sourceId === 'txn_1')).toBe(true)
    expect(entry.lines.map((line) => line.sortOrder)).toEqual([0, 1])
  })

  it('carries the memo onto both lines', () => {
    const entry = buildCodedBankEntry({ ...BASE, amountMinor: -100, memo: 'Wire fee' })
    expect(entry.lines.every((line) => line.memo === 'Wire fee')).toBe(true)
  })

  it('refuses a zero amount rather than posting a balanced pair of zeroes', () => {
    expect(() => buildCodedBankEntry({ ...BASE, amountMinor: 0 })).toThrow(/moved no money/)
  })

  it('refuses a fractional or non-finite amount', () => {
    expect(() => buildCodedBankEntry({ ...BASE, amountMinor: 12.5 })).toThrow(/whole number/)
    expect(() => buildCodedBankEntry({ ...BASE, amountMinor: Number.NaN })).toThrow(/whole number/)
  })

  it('refuses an unmapped bank account, naming the remedy', () => {
    expect(() => buildCodedBankEntry({ ...BASE, bankAccountCode: '', amountMinor: -100 })).toThrow(
      /not mapped to a GL account/
    )
  })

  it('refuses a blank coded account', () => {
    expect(() => buildCodedBankEntry({ ...BASE, glAccountCode: '  ', amountMinor: -100 })).toThrow(
      /name the account/
    )
  })

  it('refuses coding a line to its own bank account', () => {
    // Debiting and crediting one account nets to nothing and hides which side
    // was meant to be different.
    expect(() =>
      buildCodedBankEntry({ ...BASE, glAccountCode: '1000', amountMinor: -100 })
    ).toThrow(/nets to nothing/)
  })

  it('trims the codes it is handed', () => {
    const entry = buildCodedBankEntry({
      ...BASE,
      glAccountCode: ' 6100 ',
      bankAccountCode: ' 1000 ',
      amountMinor: -100,
    })
    expect(side(entry, 'debit').accountCode).toBe('6100')
    expect(side(entry, 'credit').accountCode).toBe('1000')
  })
})

describe('buildTransferEntry', () => {
  const TRANSFER = {
    transactionId: 'txn_out',
    periodKey: 'BNK-00C3D4',
    txnDate: '2026-09-10',
    amountMinor: -250_000,
    fromAccountCode: '1000',
    toAccountCode: '1010',
  }

  it('debits the destination and credits the source', () => {
    const entry = buildTransferEntry(TRANSFER)
    expect(side(entry, 'debit').accountCode).toBe('1010')
    expect(side(entry, 'credit').accountCode).toBe('1000')
  })

  it('never touches a revenue or expense account - only the two named codes appear', () => {
    const entry = buildTransferEntry(TRANSFER)
    expect(entry.lines.map((line) => (line as { accountCode: string }).accountCode).sort()).toEqual(
      ['1000', '1010']
    )
  })

  it('produces exactly two lines, so one pair of legs is one entry', () => {
    expect(buildTransferEntry(TRANSFER).lines).toHaveLength(2)
  })

  it('takes the absolute amount whichever leg it is filed on', () => {
    const fromOutgoing = buildTransferEntry(TRANSFER)
    const fromIncoming = buildTransferEntry({ ...TRANSFER, amountMinor: 250_000 })
    expect(fromOutgoing.totalDebit).toBe(250_000)
    expect(fromIncoming.totalDebit).toBe(250_000)
    expect(side(fromIncoming, 'debit').accountCode).toBe('1010')
  })

  it('refuses two accounts mapped to one GL code', () => {
    expect(() => buildTransferEntry({ ...TRANSFER, toAccountCode: '1000' })).toThrow(
      /cannot be reconciled apart/
    )
  })

  it('refuses when either account is unmapped', () => {
    expect(() => buildTransferEntry({ ...TRANSFER, fromAccountCode: '' })).toThrow(/both accounts/)
    expect(() => buildTransferEntry({ ...TRANSFER, toAccountCode: '' })).toThrow(/both accounts/)
  })

  it('refuses a zero transfer', () => {
    expect(() => buildTransferEntry({ ...TRANSFER, amountMinor: 0 })).toThrow(/moved no money/)
  })
})
