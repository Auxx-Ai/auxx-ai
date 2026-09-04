// packages/lib/src/postings/__tests__/build-opening-balance-entry.test.ts
//
// The builder is PURE, so everything it can get wrong is reachable from here
// with no fixture: the date arithmetic (which decides what month the entry
// lands in, and is uncorrectable once a period locks), the four refusals, and
// the delegation to `buildManualEntry` for the balance.
//
// 🛑 The date tests are the load-bearing ones. An opening entry dated one day
// late lands INSIDE the first month auxx.ai values, where everything that
// measures activity from the cutover counts it twice - and it still balances,
// so nothing downstream can detect it.

import { describe, expect, it } from 'vitest'
import {
  buildOpeningBalanceEntry,
  cutoverDateFor,
  OPENING_ENTRY_SOURCE_TYPE,
} from '../build-opening-balance-entry'

const ZONE = 'America/New_York'
const SOURCE = 'je_opening_1'

function line(accountCode: string, direction: 'debit' | 'credit', amountMinor: number) {
  return { accountCode, direction, amountMinor }
}

/** A minimal balanced trial balance: cash against opening balance equity. */
const BALANCED = [line('1000', 'debit', 500_00), line('3900', 'credit', 500_00)]

function build(overrides: Partial<Parameters<typeof buildOpeningBalanceEntry>[0]> = {}) {
  return buildOpeningBalanceEntry({
    cutoffPeriod: '2026-12',
    bookTimeZone: ZONE,
    lines: BALANCED,
    sourceId: SOURCE,
    ...overrides,
  })
}

describe('cutoverDateFor', () => {
  it('is the LAST day of the cutoff month, which is the day before the first open one', () => {
    expect(cutoverDateFor('2026-12')).toBe('2026-12-31')
    expect(cutoverDateFor('2026-01')).toBe('2026-01-31')
  })

  it('handles the short months and both leap-year rules without a table', () => {
    expect(cutoverDateFor('2026-02')).toBe('2026-02-28')
    // Divisible by 4: a leap year.
    expect(cutoverDateFor('2024-02')).toBe('2024-02-29')
    // Divisible by 100 but not 400: NOT a leap year, the rule a hand-rolled
    // `% 4` check gets wrong.
    expect(cutoverDateFor('1900-02')).toBe('1900-02-28')
    // Divisible by 400: a leap year.
    expect(cutoverDateFor('2000-02')).toBe('2000-02-29')
    expect(cutoverDateFor('2026-04')).toBe('2026-04-30')
  })

  it('zero-pads, so the string is always a legal YYYY-MM-DD key', () => {
    expect(cutoverDateFor('2026-09')).toBe('2026-09-30')
    expect(cutoverDateFor('0999-03')).toBe('0999-03-31')
  })

  it('refuses a DAY key - the entry is dated the last day of a MONTH', () => {
    expect(() => cutoverDateFor('2026-12-15')).toThrow(/YYYY-MM month/)
  })

  it('refuses a malformed or impossible month', () => {
    expect(() => cutoverDateFor('2026-13')).toThrow()
    expect(() => cutoverDateFor('2026-1')).toThrow()
    expect(() => cutoverDateFor('')).toThrow()
  })
})

describe('buildOpeningBalanceEntry', () => {
  it('dates the entry, and keys it, on the cutover date', () => {
    const { entry, cutoverDate } = build()
    expect(cutoverDate).toBe('2026-12-31')
    expect(entry.txnDate).toBe('2026-12-31')
    // 🛑 `periodKey` is the DATE, not the record number. `doc-number.ts`: an org
    // has exactly one opening entry, so keying on the date makes a double post
    // unrepresentable at the claim's unique index.
    expect(entry.periodKey).toBe('2026-12-31')
    expect(entry.postingType).toBe('opening_balance')
  })

  it('carries the account CODES straight through, never a role', () => {
    const { entry } = build()
    expect(entry.lines.map((l) => ('accountCode' in l ? l.accountCode : null))).toEqual([
      '1000',
      '3900',
    ])
    expect(entry.lines.every((l) => !('accountRole' in l && l.accountRole))).toBe(true)
  })

  it('stamps every line with the journal_entry source pair', () => {
    const { entry } = build()
    for (const [index, l] of entry.lines.entries()) {
      expect(l.sourceType).toBe(OPENING_ENTRY_SOURCE_TYPE)
      expect(l.sourceType).toBe('journal_entry')
      expect(l.sourceId).toBe(SOURCE)
      expect(l.sortOrder).toBe(index)
    }
  })

  it('balances, and reports both totals', () => {
    const { entry } = build()
    expect(entry.totalDebit).toBe(500_00)
    expect(entry.totalCredit).toBe(500_00)
  })

  it('defaults the memo to something that says what the entry is', () => {
    expect(build().entry.lines[0]?.memo).toBe('Opening balances as of 2026-12-31')
  })

  it('carries a supplied memo onto every line that has none of its own', () => {
    const { entry } = build({
      memo: 'Cutover from QuickBooks',
      lines: [line('1000', 'debit', 100), { ...line('3900', 'credit', 100), memo: 'Equity leg' }],
    })
    expect(entry.lines[0]?.memo).toBe('Cutover from QuickBooks')
    expect(entry.lines[1]?.memo).toBe('Equity leg')
  })

  // ── The three inventory accounts ──────────────────────────────────────────

  it('accepts the three inventory accounts by code', () => {
    // The whole point of the entry: without these three the ledger's inventory
    // opens at zero and the first close reports the opening stock as a
    // movement. `post-entry.ts` scopes its by-name refusal to `manual_journal`
    // for exactly this reason.
    const { entry } = build({
      lines: [
        line('1310', 'debit', 100_00),
        line('1320', 'debit', 50_00),
        line('1330', 'debit', 250_00),
        line('3900', 'credit', 400_00),
      ],
    })
    expect(entry.lines).toHaveLength(4)
    expect(entry.totalDebit).toBe(400_00)
  })

  // ── Zero rows ─────────────────────────────────────────────────────────────

  it('drops zero rows - the grid is the whole chart, and most of it is zero', () => {
    const { entry } = build({
      lines: [
        line('1000', 'debit', 500_00),
        line('1050', 'debit', 0),
        line('2000', 'credit', 0),
        line('3900', 'credit', 500_00),
      ],
    })
    expect(entry.lines).toHaveLength(2)
    expect(entry.lines.map((l) => ('accountCode' in l ? l.accountCode : null))).toEqual([
      '1000',
      '3900',
    ])
  })

  it('renumbers sortOrder over the surviving rows, with no gap where a zero was', () => {
    const { entry } = build({
      lines: [
        line('1000', 'debit', 500_00),
        line('1050', 'debit', 0),
        line('3900', 'credit', 500_00),
      ],
    })
    expect(entry.lines.map((l) => l.sortOrder)).toEqual([0, 1])
  })

  // ── The refusals ──────────────────────────────────────────────────────────

  it('refuses an empty trial balance, naming the date and the evidence rule', () => {
    expect(() => build({ lines: [] })).toThrow(/opening trial balance is empty/i)
    expect(() => build({ lines: [] })).toThrow(/not the tax return/i)
  })

  it('refuses an all-zero trial balance separately from an empty one', () => {
    // Different mistake, different repair: "you typed nothing" vs "you typed
    // zeroes". Both would otherwise arrive as `buildEntry`'s "at least one line".
    expect(() => build({ lines: [line('1000', 'debit', 0), line('3900', 'credit', 0)] })).toThrow(
      /Every row of the opening trial balance is zero/
    )
  })

  it('refuses a one-sided trial balance through the two-line minimum', () => {
    expect(() => build({ lines: [line('1000', 'debit', 500_00)] })).toThrow(/at least two lines/)
  })

  it('refuses an imbalance and names the difference in cents', () => {
    expect(() =>
      build({ lines: [line('1000', 'debit', 500_00), line('3900', 'credit', 400_00)] })
    ).toThrow(/off by 10000/)
  })

  it('names the row of a negative amount rather than flipping its direction', () => {
    expect(() =>
      build({ lines: [line('1000', 'debit', -500_00), line('3900', 'credit', 500_00)] })
    ).toThrow(/Row 1 \(1000\)/)
  })

  it('names the row of a fractional amount - a ledger line is whole cents', () => {
    expect(() =>
      build({ lines: [line('1000', 'debit', 500.5), line('3900', 'credit', 500.5)] })
    ).toThrow(/not a whole number of cents/)
  })

  it('refuses an unset or bogus book timezone - there is no UTC fallback', () => {
    expect(() => build({ bookTimeZone: '' })).toThrow(/not a valid IANA timezone/)
    expect(() => build({ bookTimeZone: 'Mars/Olympus' })).toThrow(/not a valid IANA timezone/)
  })

  it('refuses a cutoff that is a day rather than a month', () => {
    expect(() => build({ cutoffPeriod: '2026-12-31' })).toThrow(/YYYY-MM month/)
  })

  it('checks the date BEFORE the lines, so a broken cutoff is reported first', () => {
    // A person whose cutoff is wrong has an unusable grid; telling them the
    // trial balance is empty would send them to fix the wrong screen.
    expect(() => build({ cutoffPeriod: 'nonsense', lines: [] })).toThrow(/Invalid period key/)
  })

  // ── Warnings ──────────────────────────────────────────────────────────────

  it('passes buildManualEntry warnings through without blocking', () => {
    const { entry, warnings } = build({
      lines: [
        line('1000', 'debit', 500_00),
        line('1000', 'credit', 100_00),
        line('3900', 'credit', 400_00),
      ],
    })
    expect(entry.lines).toHaveLength(3)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/1000 appears on both sides/)
  })

  it('is quiet on an ordinary trial balance', () => {
    expect(build().warnings).toEqual([])
  })

  // ── Purity ────────────────────────────────────────────────────────────────

  it('does not mutate the lines it was handed', () => {
    const lines = [
      line('1000', 'debit', 500_00),
      line('1050', 'debit', 0),
      line('3900', 'credit', 500_00),
    ]
    const snapshot = JSON.parse(JSON.stringify(lines))
    build({ lines })
    expect(lines).toEqual(snapshot)
  })

  it('is a total function of its arguments', () => {
    expect(build().entry).toEqual(build().entry)
  })
})
