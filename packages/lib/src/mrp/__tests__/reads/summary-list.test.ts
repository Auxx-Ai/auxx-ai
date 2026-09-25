// packages/lib/src/mrp/__tests__/reads/summary-list.test.ts

import { describe, expect, it } from 'vitest'
import { likePattern, toListItem } from '../../reads/list'
import { orderByHorizons, shapeSummary } from '../../reads/summary'
import { item } from '../support/plan-item'

describe('orderByHorizons', () => {
  it('counts 7 and 30 days from the run day, across a month end', () => {
    expect(orderByHorizons('2026-09-28')).toEqual({ week: '2026-10-05', month: '2026-10-28' })
  })
})

describe('shapeSummary', () => {
  it('folds the prefixed counts and derives unbuffered', () => {
    const counts = shapeSummary({
      total: 10,
      overdue: 2,
      thisWeek: 3,
      within30Days: 5,
      later: 4,
      flagged: 1,
      fine: 3,
      buffered: 6,
      'kind:purchase': 7,
      'kind:build': 2,
      'supply:bought': 8,
      'supply:made': 2,
      'mode:scheduled': 4,
      'flag:no_lead_time': 1,
    })
    expect(counts.unbuffered).toBe(4)
    expect(counts.bySuggestionKind).toEqual({ build: 2, purchase: 7 })
    expect(counts.bySupplyType).toEqual({ bought: 8, made: 2, unclassified: 0 })
    expect(counts.byOrderMode).toEqual({ when_needed: 0, scheduled: 4 })
    expect(counts.byFlag.no_lead_time).toBe(1)
    expect(counts.byFlag.mirror_drift).toBe(0)
  })

  it('reads an empty run as zeros', () => {
    const counts = shapeSummary({})
    expect(counts.total).toBe(0)
    expect(counts.unbuffered).toBe(0)
  })
})

describe('list shaping', () => {
  it('escapes LIKE metacharacters in the search term', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%')
  })

  it('derives days of cover from the stored stockout date and the run day', () => {
    const row = toListItem(
      {
        item: item({ partId: 'p1', stockoutDate: '2026-10-04' }),
        partName: 'Motor',
        partSku: 'M-1',
        stockStatus: 'low_stock',
        supplierName: 'Acme',
      },
      '2026-09-24'
    )
    expect(row.daysOfCover).toBe(10)
    expect(row.partName).toBe('Motor')
    const bare = toListItem(
      {
        item: item({ partId: 'p2' }),
        partName: null,
        partSku: null,
        stockStatus: null,
        supplierName: null,
      },
      '2026-09-24'
    )
    expect(bare.daysOfCover).toBeNull()
  })
})
