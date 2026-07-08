// apps/web/src/components/dashboard/lib/chart-transform.test.ts

import { describe, expect, it } from 'vitest'
import {
  type ChartAggregateResult,
  remapGroupLabels,
  SINGLE_SERIES_KEY,
  toChartConfig,
  toChartRows,
  toPieRows,
} from './chart-transform'

const result = (groups: ChartAggregateResult['groups']): ChartAggregateResult => ({
  groups,
  totalValue: groups.reduce((s, g) => s + g.value, 0),
  hasMoreGroups: false,
})

describe('remapGroupLabels', () => {
  it('relabels non-null keys, preserves keys + null-key server label', () => {
    const remapped = remapGroupLabels(
      result([
        { key: '2026-07-01', label: '2026-07', value: 3 },
        { key: null, label: '(empty)', value: 1 },
      ]),
      (key) => `bucket:${key}`
    )
    expect(remapped.groups).toEqual([
      { key: '2026-07-01', label: 'bucket:2026-07-01', value: 3 },
      { key: null, label: '(empty)', value: 1 },
    ])
  })

  it('leaves secondary series untouched', () => {
    const remapped = remapGroupLabels(
      result([
        {
          key: '2026-07-01',
          label: '2026-07',
          value: 3,
          series: [{ key: 's1', label: 'Series 1', value: 3 }],
        },
      ]),
      () => 'X'
    )
    expect(remapped.groups[0].series).toEqual([{ key: 's1', label: 'Series 1', value: 3 }])
  })
})

describe('toChartRows — single series', () => {
  it('emits one row per group keyed by SINGLE_SERIES_KEY, preserving raw group keys', () => {
    const { rows, series } = toChartRows(
      result([
        { key: 'opt_a', label: 'Open', value: 3 },
        { key: 'opt_b', label: 'Closed', value: 5 },
      ])
    )
    expect(series).toEqual([{ id: SINGLE_SERIES_KEY, rawKey: null, label: 'Value' }])
    expect(rows).toEqual([
      { groupKey: 'opt_a', label: 'Open', value: 3 },
      { groupKey: 'opt_b', label: 'Closed', value: 5 },
    ])
  })

  it('running-totals the value column when cumulative', () => {
    const { rows } = toChartRows(
      result([
        { key: '2024-01', label: 'Jan', value: 2 },
        { key: '2024-02', label: 'Feb', value: 3 },
        { key: '2024-03', label: 'Mar', value: 5 },
      ]),
      { cumulative: true }
    )
    expect(rows.map((r) => r.value)).toEqual([2, 5, 10])
  })

  it('keeps the null group key (empty bucket) intact', () => {
    const { rows } = toChartRows(result([{ key: null, label: '(empty)', value: 7 }]))
    expect(rows[0]).toEqual({ groupKey: null, label: '(empty)', value: 7 })
  })
})

describe('toChartRows — secondary series pivot', () => {
  const grouped = result([
    {
      key: 'r1',
      label: 'Region 1',
      value: 30,
      series: [
        { key: 'p_a', label: 'Product A', value: 10 },
        { key: 'p_b', label: 'Product B', value: 20 },
      ],
    },
    {
      key: 'r2',
      label: 'Region 2',
      value: 5,
      // Only Product A here — Product B must zero-fill.
      series: [{ key: 'p_a', label: 'Product A', value: 5 }],
    },
  ])

  it('unions series in first-appearance order into stable ids and zero-fills gaps', () => {
    const { rows, series } = toChartRows(grouped)
    expect(series).toEqual([
      { id: 's0', rawKey: 'p_a', label: 'Product A' },
      { id: 's1', rawKey: 'p_b', label: 'Product B' },
    ])
    expect(rows).toEqual([
      { groupKey: 'r1', label: 'Region 1', s0: 10, s1: 20 },
      { groupKey: 'r2', label: 'Region 2', s0: 5, s1: 0 },
    ])
  })

  it('running-totals each series independently when cumulative', () => {
    const { rows } = toChartRows(grouped, { cumulative: true })
    // s0: 10 → 15 ; s1: 20 → 20 (zero added)
    expect(rows.map((r) => [r.s0, r.s1])).toEqual([
      [10, 20],
      [15, 20],
    ])
  })

  it('distinguishes a null series bucket from a keyed one', () => {
    const { series } = toChartRows(
      result([
        {
          key: 'g',
          label: 'G',
          value: 3,
          series: [
            { key: null, label: '(empty)', value: 1 },
            { key: 'x', label: 'X', value: 2 },
          ],
        },
      ])
    )
    expect(series.map((s) => s.rawKey)).toEqual([null, 'x'])
  })
})

describe('toChartConfig', () => {
  it('cycles the --chart palette across series', () => {
    const series = [
      { id: 's0', rawKey: 'a', label: 'A' },
      { id: 's1', rawKey: 'b', label: 'B' },
    ]
    const config = toChartConfig(series)
    expect(config.s0).toEqual({ label: 'A', color: 'var(--chart-1)' })
    expect(config.s1).toEqual({ label: 'B', color: 'var(--chart-2)' })
  })

  it('honors an explicit color for a single series but ignores it for multi-series', () => {
    const single = toChartConfig([{ id: 'value', rawKey: null, label: 'V' }], 'var(--chart-4)')
    expect(single.value.color).toBe('var(--chart-4)')

    const multi = toChartConfig(
      [
        { id: 's0', rawKey: 'a', label: 'A' },
        { id: 's1', rawKey: 'b', label: 'B' },
      ],
      'var(--chart-4)'
    )
    expect(multi.s0.color).toBe('var(--chart-1)')
  })

  it("treats 'auto' as no explicit color", () => {
    const config = toChartConfig([{ id: 'value', rawKey: null, label: 'V' }], 'auto')
    expect(config.value.color).toBe('var(--chart-1)')
  })
})

describe('toPieRows', () => {
  it('assigns a cycled fill per slice and keeps raw keys', () => {
    const rows = toPieRows(
      result([
        { key: 'a', label: 'A', value: 1 },
        { key: 'b', label: 'B', value: 2 },
      ])
    )
    expect(rows).toEqual([
      { groupKey: 'a', label: 'A', value: 1, fill: 'var(--chart-1)' },
      { groupKey: 'b', label: 'B', value: 2, fill: 'var(--chart-2)' },
    ])
  })
})
