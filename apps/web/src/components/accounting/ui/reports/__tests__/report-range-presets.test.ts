// apps/web/src/components/accounting/ui/reports/__tests__/report-range-presets.test.ts

import { describe, expect, it } from 'vitest'
import { generalLedgerRangePresets, reportRangePresets } from '../report-range-presets'

const TODAY = '2026-09-16'

function labelled(presets: { label: string; from: string; to: string }[], label: string) {
  const found = presets.find((preset) => preset.label === label)
  if (!found) throw new Error(`no preset "${label}"`)
  return { from: found.from, to: found.to }
}

describe('reportRangePresets', () => {
  const presets = reportRangePresets(TODAY, null)

  it('ends every "to date" range on today, not on the period end', () => {
    expect(labelled(presets, 'Month to date')).toEqual({ from: '2026-09-01', to: TODAY })
    expect(labelled(presets, 'Quarter to date')).toEqual({ from: '2026-07-01', to: TODAY })
    expect(labelled(presets, 'Year to date')).toEqual({ from: '2026-01-01', to: TODAY })
  })

  it('closes every completed period on its own last day', () => {
    expect(labelled(presets, 'Last month')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(labelled(presets, 'Last quarter')).toEqual({ from: '2026-04-01', to: '2026-06-30' })
    expect(labelled(presets, 'Last year')).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('offers no "All time" when there is no cutoff to name', () => {
    expect(presets.some((preset) => preset.label === 'All time')).toBe(false)
  })

  it('floors "All time" on the cutoff rather than an invented start date', () => {
    const floored = reportRangePresets(TODAY, '2026-03-01')
    expect(labelled(floored, 'All time')).toEqual({ from: '2026-03-01', to: TODAY })
  })

  // A statement that opens before the books do reports figures from nowhere.
  it('pulls any preset that starts before the cutoff forward to it', () => {
    const floored = reportRangePresets(TODAY, '2026-03-01')
    expect(labelled(floored, 'Year to date').from).toBe('2026-03-01')
    expect(labelled(floored, 'Last year').from).toBe('2026-03-01')
    // One that already starts after the cutoff is untouched.
    expect(labelled(floored, 'Last month').from).toBe('2026-08-01')
  })

  it('finds the right quarter from inside each of its three months', () => {
    for (const day of ['2026-07-01', '2026-08-15', '2026-09-30']) {
      expect(labelled(reportRangePresets(day, null), 'Quarter to date').from).toBe('2026-07-01')
    }
  })

  it('crosses a year boundary backwards for the first quarter', () => {
    expect(labelled(reportRangePresets('2026-02-10', null), 'Last quarter')).toEqual({
      from: '2025-10-01',
      to: '2025-12-31',
    })
  })
})

describe('generalLedgerRangePresets', () => {
  const presets = generalLedgerRangePresets(TODAY)

  // 🛑 The ledger truncates on volume, so its list must not offer a wide range.
  it('offers nothing wider than 30 days beyond the current month', () => {
    expect(presets.map((preset) => preset.label)).toEqual([
      'Month to date',
      'Last month',
      'Last 7 days',
      'Last 30 days',
    ])
  })

  it('counts a "last N days" window inclusively of today', () => {
    expect(labelled(presets, 'Last 7 days')).toEqual({ from: '2026-09-10', to: TODAY })
    expect(labelled(presets, 'Last 30 days')).toEqual({ from: '2026-08-18', to: TODAY })
  })
})
