// packages/lib/src/postings/reports/__tests__/fiscal-year.test.ts

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../../errors'
import {
  DEFAULT_FISCAL_YEAR_START_MONTH,
  FISCAL_YEAR_START_MONTH_OPTIONS,
  fiscalYearStart,
  normalizeFiscalYearStartMonth,
  previousCalendarDay,
} from '../fiscal-year'

describe('fiscalYearStart', () => {
  it('defaults to the calendar year, which is what every report assumed before the setting', () => {
    expect(fiscalYearStart('2026-09-16')).toBe('2026-01-01')
    expect(fiscalYearStart('2026-01-01')).toBe('2026-01-01')
    expect(fiscalYearStart('2026-12-31')).toBe('2026-01-01')
  })

  it('an explicit January is identical to the default', () => {
    expect(fiscalYearStart('2026-09-16', 1)).toBe(fiscalYearStart('2026-09-16'))
  })

  it('a date on or after the start month opens in the same calendar year', () => {
    expect(fiscalYearStart('2026-07-01', 7)).toBe('2026-07-01')
    expect(fiscalYearStart('2026-09-16', 7)).toBe('2026-07-01')
    expect(fiscalYearStart('2026-12-31', 7)).toBe('2026-07-01')
  })

  it('a date before the start month belongs to the year that opened last calendar year', () => {
    expect(fiscalYearStart('2026-06-30', 7)).toBe('2025-07-01')
    expect(fiscalYearStart('2026-01-01', 7)).toBe('2025-07-01')
  })

  it('handles a December start, where eleven months of the year sit in the NEXT calendar year', () => {
    expect(fiscalYearStart('2026-12-01', 12)).toBe('2026-12-01')
    expect(fiscalYearStart('2026-11-30', 12)).toBe('2025-12-01')
  })

  it('the day before the boundary is the last day of the previous fiscal year', () => {
    expect(previousCalendarDay(fiscalYearStart('2026-09-16', 7))).toBe('2026-06-30')
    expect(previousCalendarDay(fiscalYearStart('2026-09-16'))).toBe('2025-12-31')
  })

  it('refuses a malformed date and a month outside 1-12', () => {
    expect(() => fiscalYearStart('2026-9-16')).toThrow(BadRequestError)
    expect(() => fiscalYearStart('2026-09-16', 0)).toThrow(BadRequestError)
    expect(() => fiscalYearStart('2026-09-16', 13)).toThrow(BadRequestError)
    expect(() => fiscalYearStart('2026-09-16', 1.5)).toThrow(BadRequestError)
  })
})

describe('normalizeFiscalYearStartMonth', () => {
  it('reads the stored string the SINGLE_SELECT writes', () => {
    expect(normalizeFiscalYearStartMonth('7')).toBe(7)
    expect(normalizeFiscalYearStartMonth(' 12 ')).toBe(12)
    expect(normalizeFiscalYearStartMonth(1)).toBe(1)
  })

  it('falls back to January rather than throwing, so one bad row cannot take down the reports', () => {
    for (const bad of [null, undefined, '', 'July', '0', '13', 0, 13, 1.5, {}, []]) {
      expect(normalizeFiscalYearStartMonth(bad)).toBe(DEFAULT_FISCAL_YEAR_START_MONTH)
    }
  })

  it('accepts every value the catalog offers', () => {
    for (const [index, option] of FISCAL_YEAR_START_MONTH_OPTIONS.entries()) {
      expect(normalizeFiscalYearStartMonth(option.value)).toBe(index + 1)
    }
    expect(FISCAL_YEAR_START_MONTH_OPTIONS).toHaveLength(12)
  })
})
