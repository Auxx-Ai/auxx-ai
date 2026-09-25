// apps/web/src/components/mrp/ui/plan/plan-tabs.test.ts
import { describe, expect, it } from 'vitest'
import { isMrpFiltered, type MrpFilters, mrpListInput } from '../../hooks/use-mrp-filters'
import { formatOrderBy, stockStatusDisplay, warningFlags } from '../rows/format'
import { refusalsByName } from '../rows/mrp-bulk-bar'
import {
  groupByFinishedGood,
  groupBySupplier,
  planTabCount,
  suggestionTotal,
  toActionListTab,
} from './plan-tabs'

const base: MrpFilters = {
  tab: 'overdue',
  search: '',
  supplyType: [],
  suggestionKind: [],
  supplierIds: [],
  buffered: null,
  groupBy: 'none',
  sort: 'priority',
  direction: 'asc',
}

describe('plan tabs', () => {
  it('keeps every strip tab, all included', () => {
    expect(toActionListTab('all')).toBe('all')
    expect(toActionListTab('fine')).toBe('fine')
  })

  it('counts each tab off the summary', () => {
    const counts = { overdue: 4, thisWeek: 11, later: 23, flagged: 6, fine: 2 }
    expect(planTabCount('this_week', counts as never)).toBe(11)
    expect(planTabCount('later', counts as never)).toBe(23)
    expect(planTabCount('overdue', null)).toBe(0)
  })

  it('groups by supplier in server order with no supplier last', () => {
    const rows = [
      { id: 1, suggestedSupplierId: null, supplierName: null },
      { id: 2, suggestedSupplierId: 's2', supplierName: 'SteelCo' },
      { id: 3, suggestedSupplierId: 's1', supplierName: 'Acme' },
      { id: 4, suggestedSupplierId: 's2', supplierName: 'SteelCo' },
    ]
    const groups = groupBySupplier(rows)
    expect(groups.map((g) => g.label)).toEqual(['SteelCo', 'Acme', 'No supplier'])
    expect(groups[0]?.items.map((r) => r.id)).toEqual([2, 4])
  })

  it('groups by finished good, a shared part under each product, none last', () => {
    const rows = [
      { id: 1, productIds: [], productNames: [] },
      { id: 2, productIds: ['bike', 'trike'], productNames: ['Bike', 'Trike'] },
      { id: 3, productIds: ['trike'], productNames: ['Trike'] },
      { id: 4, productIds: ['bike'], productNames: ['Bike'] },
    ]
    const groups = groupByFinishedGood(rows)
    expect(groups.map((g) => g.label)).toEqual(['Bike', 'Trike', 'No finished good'])
    expect(groups[0]?.items.map((r) => r.id)).toEqual([2, 4])
    expect(groups[1]?.items.map((r) => r.id)).toEqual([2, 3])
    expect(groups[2]?.items.map((r) => r.id)).toEqual([1])
  })

  it('sums suggestions and says nothing when none are suggested', () => {
    expect(
      suggestionTotal([{ suggestedQty: 60 }, { suggestedQty: null }, { suggestedQty: 40 }])
    ).toBe('100')
    expect(suggestionTotal([{ suggestedQty: null }])).toBeUndefined()
  })
})

describe('mrp filters', () => {
  it('treats only narrowing filters as dirty', () => {
    expect(isMrpFiltered({ ...base, groupBy: 'supplier', direction: 'desc' })).toBe(false)
    expect(isMrpFiltered({ ...base, buffered: false })).toBe(true)
    expect(isMrpFiltered({ ...base, search: '  ' })).toBe(false)
  })

  it('drops empty filters from the list input', () => {
    expect(
      mrpListInput({ ...base, supplierIds: ['s1'] }, { runId: 'r1', search: ' bolt ' })
    ).toEqual({
      runId: 'r1',
      tab: 'overdue',
      search: 'bolt',
      supplyType: undefined,
      suggestionKind: undefined,
      supplierIds: ['s1'],
      buffered: undefined,
      sort: 'priority',
      direction: 'asc',
      limit: undefined,
    })
  })
})

describe('row format', () => {
  it('shows the year only outside the current one', () => {
    const today = new Date(2026, 8, 24)
    expect(formatOrderBy('2026-09-26', today)).toBe('Sep 26')
    expect(formatOrderBy('2027-01-03', today)).toBe("Jan 3 '27")
  })

  it('keeps draft pending out of the warning count', () => {
    expect(warningFlags(['draft_po_pending', 'no_lead_time'])).toEqual(['no_lead_time'])
  })

  it('reads the stock status off the field options', () => {
    expect(stockStatusDisplay('low_stock')).toEqual({ dot: 'bg-amber-500', label: 'low stock' })
    expect(stockStatusDisplay(null)).toBeNull()
  })

  it('names refused parts, grouped by reason', () => {
    const names: Record<string, string> = { a: 'Motor', b: 'Bracket', c: 'Frame' }
    expect(
      refusalsByName(
        [
          { partId: 'a', reason: 'No vendor part to order from' },
          { partId: 'b', reason: 'No vendor part to order from' },
          { partId: 'c', reason: 'No quantity to order' },
        ],
        (id) => names[id] ?? id
      )
    ).toEqual([
      {
        reason: 'No vendor part to order from',
        count: 2,
        label: 'refused (No vendor part to order from): Motor, Bracket',
      },
      { reason: 'No quantity to order', count: 1, label: 'refused (No quantity to order): Frame' },
    ])
  })
})
