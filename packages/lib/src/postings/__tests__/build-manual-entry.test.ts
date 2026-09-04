// packages/lib/src/postings/__tests__/build-manual-entry.test.ts
//
// The manual builder is the escape hatch that makes every other mistake in this
// subsystem survivable: without it a wrong posting can only be corrected by
// writing and deploying code. So the tests here are almost all refusals, and
// each one is about the MESSAGE as much as the outcome - a bookkeeper reads
// these at 11pm on the 3rd and has to be told which row to fix.
//
// Two properties carry the file:
//
//  1. **It is PURE.** No database, no clock, no chart. That is what lets the
//     whole surface be tested without a fixture, and it is also why the
//     inventory refusal is NOT here: this function cannot know which code
//     carries `inventory_wip` in a given org, because the whole point of `G8`
//     is that the number differs per org.
//  2. **Same-account-both-sides is a WARNING.** It is legal and occasionally
//     correct, and refusing it would be this module deciding it knows the org's
//     books better than the person keeping them.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import {
  buildManualEntry,
  MANUAL_ENTRY_SOURCE_TYPE,
  type ManualEntryLine,
  toMinorUnits,
} from '../build-manual-entry'

const BASE = {
  postingType: 'manual_journal' as const,
  number: 'JNL-0007',
  txnDate: '2026-08-31',
  sourceId: 'je_abc',
}

function lines(...rows: Array<Partial<ManualEntryLine>>): ManualEntryLine[] {
  return rows.map((row, index) => ({
    accountCode: row.accountCode ?? `600${index}`,
    direction: row.direction ?? (index === 0 ? 'debit' : 'credit'),
    amountMinor: row.amountMinor ?? 5000,
    ...(row.memo ? { memo: row.memo } : {}),
  }))
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

describe('buildManualEntry - the happy path', () => {
  const built = buildManualEntry({ ...BASE, memo: 'Accrue August rent', lines: lines({}, {}) })

  it('balances by construction and carries both totals', () => {
    expect(built.entry.totalDebit).toBe(5000)
    expect(built.entry.totalCredit).toBe(5000)
  })

  // 🛑 The number, not a date. `doc-number.ts` keys `manual_journal` on the
  // record number because many entries can post in one day, and a date key
  // would make the second collide with the first on the claim's unique index -
  // where it would silently come back `already_posted` having written nothing.
  it('keys periodKey on the ENTRY NUMBER, and txnDate on the accounting date', () => {
    expect(built.entry.periodKey).toBe('JNL-0007')
    expect(built.entry.txnDate).toBe('2026-08-31')
  })

  it('emits CODE lines, never roles', () => {
    for (const line of built.entry.lines) {
      expect(line.accountCode).toBeTruthy()
      expect(line.accountRole).toBeUndefined()
    }
  })

  // The audit pair, so "what did this entry post" and "what posted this line"
  // are both answerable without joining a provider.
  it('stamps every line with the journal_entry record as its source', () => {
    for (const line of built.entry.lines) {
      expect(line.sourceType).toBe(MANUAL_ENTRY_SOURCE_TYPE)
      expect(line.sourceId).toBe('je_abc')
    }
  })

  it('numbers lines in the order they were typed', () => {
    expect(built.entry.lines.map((line) => line.sortOrder)).toEqual([0, 1])
  })

  it("falls the entry's memo through to a line that has none of its own", () => {
    expect(built.entry.lines[0]?.memo).toBe('Accrue August rent')
  })

  it("keeps a line's own memo in preference to the entry's", () => {
    const withLineMemo = buildManualEntry({
      ...BASE,
      memo: 'Entry memo',
      lines: lines({ memo: 'Line memo' }, {}),
    })
    expect(withLineMemo.entry.lines[0]?.memo).toBe('Line memo')
    expect(withLineMemo.entry.lines[1]?.memo).toBe('Entry memo')
  })

  it('builds an opening balance the same way, keyed on the cutover date', () => {
    const opening = buildManualEntry({
      ...BASE,
      postingType: 'opening_balance',
      number: '2025-12-31',
      txnDate: '2025-12-31',
      lines: lines({}, {}),
    })
    expect(opening.entry.postingType).toBe('opening_balance')
    expect(opening.entry.periodKey).toBe('2025-12-31')
  })

  it('reports no warnings on an ordinary entry', () => {
    expect(built.warnings).toEqual([])
  })
})

describe('buildManualEntry - the refusals', () => {
  it('refuses fewer than two lines, saying how many there are', () => {
    const error = expectRefusal(() => buildManualEntry({ ...BASE, lines: lines({}) }))
    expect(error.message).toMatch(/at least two lines/i)
    expect(error.message).toMatch(/has 1/)
  })

  it('refuses no lines at all', () => {
    const error = expectRefusal(() => buildManualEntry({ ...BASE, lines: [] }))
    expect(error.message).toMatch(/at least two lines/i)
  })

  // The DIFFERENCE, not just the two totals: it is the number the person has to
  // type to fix it.
  it('refuses an imbalance, naming the difference and the side to add to', () => {
    const error = expectRefusal(() =>
      buildManualEntry({
        ...BASE,
        lines: lines({ amountMinor: 5000 }, { amountMinor: 4000 }),
      })
    )
    expect(error.message).toMatch(/off by 1000/)
    expect(error.message).toMatch(/to the credit side/)
  })

  it('names the debit side when the credits are the larger half', () => {
    const error = expectRefusal(() =>
      buildManualEntry({
        ...BASE,
        lines: lines({ amountMinor: 4000 }, { amountMinor: 5000 }),
      })
    )
    expect(error.message).toMatch(/to the debit side/)
  })

  it('refuses a zero amount, naming the row and the account', () => {
    const error = expectRefusal(() =>
      buildManualEntry({ ...BASE, lines: lines({}, { amountMinor: 0 }) })
    )
    expect(error.message).toMatch(/Row 2/)
    expect(error.message).toMatch(/6001/)
  })

  it('refuses a negative amount, saying where the sign lives', () => {
    const error = expectRefusal(() =>
      buildManualEntry({ ...BASE, lines: lines({}, { amountMinor: -5000 }) })
    )
    expect(error.message).toMatch(/Row 2/)
    expect(error.message).toMatch(/debit\/credit column carries the sign/i)
  })

  it('refuses a fraction of a cent', () => {
    const error = expectRefusal(() =>
      buildManualEntry({ ...BASE, lines: lines({ amountMinor: 5000.5 }, {}) })
    )
    expect(error.message).toMatch(/Row 1/)
    expect(error.message).toMatch(/not a whole number of cents/i)
  })

  it('refuses NaN rather than letting it pass every comparison', () => {
    const error = expectRefusal(() =>
      buildManualEntry({ ...BASE, lines: lines({ amountMinor: Number.NaN }, {}) })
    )
    expect(error.message).toMatch(/not a whole number of cents/i)
  })

  it('refuses a row with no account', () => {
    const error = expectRefusal(() =>
      buildManualEntry({ ...BASE, lines: lines({ accountCode: '  ' }, {}) })
    )
    expect(error.message).toMatch(/Row 1 has no account/i)
  })
})

describe('buildManualEntry - the same-account warning', () => {
  // ⚠️ A WARNING, never a refusal. Reclassifying between two sub-uses of one
  // account is legal and occasionally right; refusing it would be this module
  // overruling the person keeping the books.
  it('warns, and still builds, when one account is on both sides', () => {
    const built = buildManualEntry({
      ...BASE,
      lines: lines({ accountCode: '6000' }, { accountCode: '6000' }),
    })
    expect(built.entry.lines).toHaveLength(2)
    expect(built.warnings).toHaveLength(1)
    expect(built.warnings[0]).toMatch(/6000/)
    expect(built.warnings[0]).toMatch(/both sides/i)
  })

  it('names every offending account once, however many lines carry it', () => {
    const built = buildManualEntry({
      ...BASE,
      lines: [
        { accountCode: '6000', direction: 'debit', amountMinor: 1000 },
        { accountCode: '6000', direction: 'credit', amountMinor: 400 },
        { accountCode: '6000', direction: 'credit', amountMinor: 600 },
      ],
    })
    expect(built.warnings).toHaveLength(1)
    expect(built.warnings[0]?.match(/6000/g)).toHaveLength(1)
  })

  it('does not warn when an account appears twice on the SAME side', () => {
    const built = buildManualEntry({
      ...BASE,
      lines: [
        { accountCode: '6000', direction: 'debit', amountMinor: 1000 },
        { accountCode: '6000', direction: 'debit', amountMinor: 500 },
        { accountCode: '2000', direction: 'credit', amountMinor: 1500 },
      ],
    })
    expect(built.warnings).toEqual([])
  })
})

// 🛑 The ONE conversion in this subsystem. `FieldValue.valueNumber` is a double
// and every currency input hands one back, so these are the values that
// actually arrive - not hypotheticals.
describe('toMinorUnits', () => {
  it('converts whole dollars and ordinary cents', () => {
    expect(toMinorUnits(0)).toBe(0)
    expect(toMinorUnits(1)).toBe(100)
    expect(toMinorUnits(12.34)).toBe(1234)
    expect(toMinorUnits(1_234_567.89)).toBe(123_456_789)
  })

  it('survives the doubles that break a naive truncation', () => {
    // 12.3 * 100 === 1229.9999999999998, so Math.trunc gives 1229.
    expect(toMinorUnits(12.3)).toBe(1230)
    // 8.29 * 100 === 828.9999999999999.
    expect(toMinorUnits(8.29)).toBe(829)
    // 0.07 * 100 === 7.000000000000001, the other direction.
    expect(toMinorUnits(0.07)).toBe(7)
    expect(toMinorUnits(1.13)).toBe(113)
  })

  it('keeps the sign, so a caller that means negative gets negative', () => {
    // The BUILDER refuses a negative amount; this function does not, because it
    // is a unit conversion and a caller computing a difference has a legitimate
    // negative. The refusal belongs where the meaning is.
    expect(toMinorUnits(-12.34)).toBe(-1234)
  })

  it('refuses sub-cent precision rather than silently rounding it away', () => {
    // A person typing 12.345 means a number this ledger cannot hold. Booking
    // 12.35 makes their entry not tie to the document it came from.
    expect(() => toMinorUnits(12.345)).toThrow(UnprocessableEntityError)
    expect(() => toMinorUnits(0.001)).toThrow(/sub-cent precision/i)
    // 1.005 is half a cent, and 1.005 * 100 === 100.49999999999999 - so a
    // rounding implementation would book 1.00 and the entry would not tie to
    // the document it came from. Refused, and the person rounds deliberately.
    expect(() => toMinorUnits(1.005)).toThrow(/sub-cent precision/i)
  })

  it('refuses NaN and Infinity rather than returning NaN', () => {
    expect(() => toMinorUnits(Number.NaN)).toThrow(/not a finite number/i)
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow(/not a finite number/i)
  })
})
