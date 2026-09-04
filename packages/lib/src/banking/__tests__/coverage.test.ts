// packages/lib/src/banking/__tests__/coverage.test.ts
//
// The coverage arithmetic is the whole reason `bank_account` carries two extra
// date columns, and plans/bank-connection/01 §4.1 calls it "the one most likely
// to be skipped and most expensive to add later" - because without it a balance
// sheet spanning a hole renders happily and is wrong: arithmetically right,
// financially meaningless, and silent.
//
// So it is tested exhaustively and with no database. Everything here is pure.

import { describe, expect, it } from 'vitest'
import {
  COVERAGE_GAP_DAYS,
  computeCoverageGaps,
  daysBetween,
  mergeCoverageGaps,
  shiftDateKey,
  toDateKey,
} from '../client'

describe('date-key arithmetic', () => {
  it('is UTC, never local - a 7pm 31 January in New York is still 31 January', () => {
    // The §9.5 trap from the costing guide: a naive local conversion rolls this
    // into February and misstates the period.
    expect(toDateKey('2026-01-31T19:00:00.000-05:00')).toBe('2026-01-31')
    expect(toDateKey(new Date('2026-01-31T23:59:59.999Z'))).toBe('2026-01-31')
  })

  it('shifts across month and year boundaries', () => {
    expect(shiftDateKey('2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDateKey('2024-03-01', -1)).toBe('2024-02-29') // leap
    expect(shiftDateKey('2025-12-31', 1)).toBe('2026-01-01')
  })

  it('counts whole days, signed', () => {
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0)
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7)
    expect(daysBetween('2026-01-08', '2026-01-01')).toBe(-7)
    // A DST boundary must not produce 6.958 days rounded to 6.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
  })
})

describe('computeCoverageGaps', () => {
  const today = '2026-03-31'

  it('answers nothing when coverageFrom is unknown', () => {
    // Nothing is known, so nothing can be missing. Reporting "the whole of time
    // is a gap" on an account nobody has set up yet would be noise on every row.
    expect(computeCoverageGaps({ dateKeys: [], coverageFrom: null, today })).toEqual([])
  })

  it('reports the whole window when there are no transactions at all', () => {
    expect(computeCoverageGaps({ dateKeys: [], coverageFrom: '2026-01-01', today })).toEqual([
      { from: '2026-01-01', to: '2026-03-31' },
    ])
  })

  it('reports a leading gap at ANY width', () => {
    // This is the cutover-to-first-feed-row hole the file importer exists to
    // fill. coverageFrom is a CLAIM that the record starts there, so even two
    // days of nothing after it is the range somebody imports statements for -
    // not noise to be thresholded away.
    expect(
      computeCoverageGaps({
        dateKeys: ['2026-01-03'],
        coverageFrom: '2026-01-01',
        today: '2026-01-05',
      })
    ).toEqual([{ from: '2026-01-01', to: '2026-01-02' }])
  })

  it('has no leading gap when the first transaction is on coverageFrom', () => {
    expect(
      computeCoverageGaps({
        dateKeys: ['2026-01-01'],
        coverageFrom: '2026-01-01',
        today: '2026-01-05',
      })
    ).toEqual([])
  })

  it('is exclusive at the threshold: exactly 7 days apart is not a gap', () => {
    // The heuristic is "MORE than COVERAGE_GAP_DAYS", so a weekly payroll debit
    // with nothing between must not light up every row in the list.
    const from = '2026-01-01'
    const seven = shiftDateKey(from, COVERAGE_GAP_DAYS)
    expect(
      computeCoverageGaps({ dateKeys: [from, seven], coverageFrom: from, today: seven })
    ).toEqual([])
  })

  it('is a gap at one day past the threshold', () => {
    const from = '2026-01-01'
    const eight = shiftDateKey(from, COVERAGE_GAP_DAYS + 1)
    expect(
      computeCoverageGaps({ dateKeys: [from, eight], coverageFrom: from, today: eight })
    ).toEqual([{ from: '2026-01-02', to: '2026-01-08' }])
  })

  it('finds several interior gaps and bounds each one exclusively', () => {
    const gaps = computeCoverageGaps({
      dateKeys: ['2026-01-01', '2026-01-20', '2026-01-21', '2026-02-15'],
      coverageFrom: '2026-01-01',
      today: '2026-02-16',
    })
    expect(gaps).toEqual([
      { from: '2026-01-02', to: '2026-01-19' },
      { from: '2026-01-22', to: '2026-02-14' },
    ])
  })

  it('reports a trailing gap - what a silently dead feed looks like from here', () => {
    // The most expensive bug in this subsystem is a feed that stops and says
    // nothing. From the ledger's side it is indistinguishable from a quiet
    // account, which is exactly why it is surfaced rather than assumed benign.
    expect(
      computeCoverageGaps({
        dateKeys: ['2026-01-01'],
        coverageFrom: '2026-01-01',
        today: '2026-02-01',
      })
    ).toEqual([{ from: '2026-01-02', to: '2026-02-01' }])
  })

  it('does not report a trailing gap while the account is still fresh', () => {
    expect(
      computeCoverageGaps({
        dateKeys: ['2026-01-01'],
        coverageFrom: '2026-01-01',
        today: '2026-01-06',
      })
    ).toEqual([])
  })

  it('needs neither sorted nor unique input', () => {
    // The read hands over whatever the FieldValue rows said, and several
    // transactions land on one day constantly.
    const unsorted = ['2026-02-15', '2026-01-01', '2026-01-01', '2026-01-20', '2026-01-20']
    expect(
      computeCoverageGaps({ dateKeys: unsorted, coverageFrom: '2026-01-01', today: '2026-02-16' })
    ).toEqual([
      { from: '2026-01-02', to: '2026-01-19' },
      { from: '2026-01-21', to: '2026-02-14' },
    ])
  })

  it('ignores transactions outside the window entirely', () => {
    // A feed can deliver rows before the cutover that nobody has agreed to book.
    // Letting one close a leading gap would claim coverage for a period the
    // opening balance already accounts for.
    expect(
      computeCoverageGaps({
        dateKeys: ['2025-06-01', '2026-01-10', '2027-01-01'],
        coverageFrom: '2026-01-01',
        today: '2026-01-11',
      })
    ).toEqual([{ from: '2026-01-01', to: '2026-01-09' }])
  })

  it('answers nothing when today precedes coverageFrom', () => {
    // A future-dated feedStartDate copied onto coverageFrom would otherwise
    // produce a negative range and render as a gap ending before it starts.
    expect(
      computeCoverageGaps({ dateKeys: [], coverageFrom: '2026-06-01', today: '2026-01-01' })
    ).toEqual([])
  })

  it('honours an overridden threshold', () => {
    expect(
      computeCoverageGaps({
        dateKeys: ['2026-01-01', '2026-01-04'],
        coverageFrom: '2026-01-01',
        today: '2026-01-04',
        maxGapDays: 2,
      })
    ).toEqual([{ from: '2026-01-02', to: '2026-01-03' }])
  })

  it('spans a year boundary', () => {
    expect(
      computeCoverageGaps({
        dateKeys: ['2025-12-20', '2026-01-15'],
        coverageFrom: '2025-12-20',
        today: '2026-01-16',
      })
    ).toEqual([{ from: '2025-12-21', to: '2026-01-14' }])
  })
})

describe('mergeCoverageGaps', () => {
  it('keeps both when they do not overlap', () => {
    expect(
      mergeCoverageGaps(
        [{ from: '2026-01-01', to: '2026-01-10' }],
        [{ from: '2026-02-01', to: '2026-02-10' }]
      )
    ).toEqual([
      { from: '2026-01-01', to: '2026-01-10' },
      { from: '2026-02-01', to: '2026-02-10' },
    ])
  })

  it('drops a derived gap fully inside a stored one', () => {
    // The stored list is TESTIMONY ("we imported January and it really was
    // empty"); the derived list is inference. Rendering both would show the same
    // hole twice with different edges.
    expect(
      mergeCoverageGaps(
        [{ from: '2026-01-01', to: '2026-01-31' }],
        [{ from: '2026-01-05', to: '2026-01-20' }]
      )
    ).toEqual([{ from: '2026-01-01', to: '2026-01-31' }])
  })

  it('drops an exact duplicate', () => {
    const gap = { from: '2026-01-01', to: '2026-01-10' }
    expect(mergeCoverageGaps([gap], [{ ...gap }])).toEqual([gap])
  })

  it('keeps a partial overlap - neither contains the other', () => {
    expect(
      mergeCoverageGaps(
        [{ from: '2026-01-01', to: '2026-01-15' }],
        [{ from: '2026-01-10', to: '2026-01-25' }]
      )
    ).toEqual([
      { from: '2026-01-01', to: '2026-01-15' },
      { from: '2026-01-10', to: '2026-01-25' },
    ])
  })

  it('drops a malformed or inverted range rather than rendering it', () => {
    // The stored column is written by an importer and a future connector. One
    // bad entry must not make the whole settings row unreadable.
    expect(
      mergeCoverageGaps(
        [
          { from: '2026-02-01', to: '2026-01-01' },
          { from: '', to: '2026-01-01' },
        ],
        [{ from: '2026-03-01', to: '2026-03-05' }]
      )
    ).toEqual([{ from: '2026-03-01', to: '2026-03-05' }])
  })

  it('orders by start date so the UI never has to sort', () => {
    expect(
      mergeCoverageGaps(
        [{ from: '2026-03-01', to: '2026-03-05' }],
        [{ from: '2026-01-01', to: '2026-01-05' }]
      )
    ).toEqual([
      { from: '2026-01-01', to: '2026-01-05' },
      { from: '2026-03-01', to: '2026-03-05' },
    ])
  })
})
