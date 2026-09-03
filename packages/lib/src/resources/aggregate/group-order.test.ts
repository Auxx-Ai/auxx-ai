// packages/lib/src/resources/aggregate/group-order.test.ts
//
// Ordering of a grouped aggregate: the default sort a group-by falls back to,
// and which groups survive the limit. A date axis ranked by count renders as
// "Sep 3, Aug 15, May 27, Apr 7…" — the bug this pair of rules exists to stop.

import { describe, expect, it } from 'vitest'
import type { DateGranularity, GroupSort } from '../../dashboards/client'
import { defaultGroupSort } from '../../dashboards/client'
import { capGroups } from './run-aggregate'
import type { AggregateGroup, ResolvedGroupBy } from './types'

const group = (key: string, value: number): AggregateGroup => ({ key, label: key, value })

const groupBy = (
  dateGranularity?: DateGranularity,
  sort?: GroupSort
): Pick<ResolvedGroupBy, 'dateGranularity' | 'sort'> => ({
  dateGranularity,
  sort: sort ?? defaultGroupSort(dateGranularity),
})

describe('defaultGroupSort', () => {
  it('orders date buckets chronologically', () => {
    expect(defaultGroupSort('day')).toBe('labelAsc')
    expect(defaultGroupSort('month')).toBe('labelAsc')
    expect(defaultGroupSort('monthOfYear')).toBe('labelAsc')
  })

  it('keeps biggest-first for categorical dimensions', () => {
    expect(defaultGroupSort(undefined)).toBe('valueDesc')
  })
})

describe('capGroups', () => {
  const days = ['2026-04-07', '2026-05-27', '2026-08-15', '2026-09-03'].map((k, i) =>
    group(k, i + 1)
  )

  it('keeps the most RECENT calendar buckets, still in order', () => {
    expect(capGroups(days, groupBy('day'), 2).map((g) => g.key)).toEqual([
      '2026-08-15',
      '2026-09-03',
    ])
  })

  it('keeps the head for a categorical dimension', () => {
    const cats = [group('a', 9), group('b', 5), group('c', 1)]
    expect(capGroups(cats, groupBy(undefined), 2).map((g) => g.key)).toEqual(['a', 'b'])
  })

  it('keeps the head when the date axis is explicitly ranked by value', () => {
    const ranked = [...days].sort((a, b) => b.value - a.value)
    const byValue = groupBy('day', 'valueDesc')
    expect(capGroups(ranked, byValue, 2).map((g) => g.key)).toEqual(['2026-09-03', '2026-08-15'])
  })

  it('leaves a short list untouched', () => {
    expect(capGroups(days, groupBy('day'), 50)).toHaveLength(4)
  })
})
