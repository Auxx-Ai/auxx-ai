// apps/web/src/components/manufacturing/hooks/use-opening-stock.test.ts

// The Set counts checklist's pure half: which rows the run takes, what each row would write,
// and the Q25 signal. These decide what is stamped onto an append-only movement.

import { describe, expect, it } from 'vitest'
import {
  excludeReason,
  exclusionDetail,
  needsBackflushFirst,
  type OpeningStockRow,
  partKindLabel,
  previewDelta,
  rowOutcome,
  setCountsHrefForJob,
  setCountsHrefForParts,
  setKindConfirmTitle,
  toOpeningStockKind,
} from './use-opening-stock'

/** A row the run would take, so each test can negate exactly one thing. */
function row(overrides: Partial<OpeningStockRow> = {}): OpeningStockRow {
  return {
    partId: 'part_1',
    recordId: null,
    title: 'Motor 460# 50Nm',
    sku: 'M-460-50',
    storedKind: 'component',
    kind: 'component',
    kindIsUnconfirmed: false,
    accountLabel: '1310 Raw Materials / Parts',
    accountCode: '1310',
    accountRole: 'inventory_raw_materials',
    isUnclassified: true,
    standardCost: 2050,
    quantity: 4,
    unitCost: null,
    date: '2026-09-25T00:00:00.000Z',
    hasOwnDate: false,
    state: 'new',
    netToday: 0,
    hasBom: false,
    unbuiltSales: 0,
    earliest: null,
    delta: 4,
    ...overrides,
  }
}

describe('excludeReason', () => {
  it('takes a complete row, whatever its anchor state', () => {
    expect(excludeReason(row())).toBeNull()
    expect(excludeReason(row({ state: 'counted' }))).toBeNull()
    expect(excludeReason(row({ state: 'uncounted' }))).toBeNull()
  })

  it('takes a count of zero and an uncosted part', () => {
    expect(excludeReason(row({ quantity: 0 }))).toBeNull()
    expect(excludeReason(row({ standardCost: null, unitCost: null }))).toBeNull()
  })

  it('refuses a row whose kind is still only a suggestion', () => {
    expect(
      excludeReason(
        row({ storedKind: 'component', kind: 'finished_good', kindIsUnconfirmed: true })
      )
    ).toBe('kind-unconfirmed')
  })

  it('refuses a missing or negative count', () => {
    expect(excludeReason(row({ quantity: null }))).toBe('no-quantity')
    expect(excludeReason(row({ quantity: -3 }))).toBe('no-quantity')
  })

  it('reports the kind before the count', () => {
    expect(
      excludeReason(row({ kindIsUnconfirmed: true, kind: 'finished_good', quantity: null }))
    ).toBe('kind-unconfirmed')
  })
})

describe('exclusionDetail', () => {
  it('names the suggestion and the account it would produce', () => {
    const detail = exclusionDetail(
      row({
        storedKind: 'component',
        kind: 'finished_good',
        kindIsUnconfirmed: true,
        accountLabel: '1330 Finished Goods',
      }),
      'kind-unconfirmed'
    )
    expect(detail).toContain('Finished Good')
    expect(detail).toContain('1330 Finished Goods')
    expect(detail).toContain('Component')
  })

  it('carries the count that proves a no-quantity refusal', () => {
    expect(exclusionDetail(row({ quantity: null }), 'no-quantity')).toContain('No count')
    expect(exclusionDetail(row({ quantity: -1 }), 'no-quantity')).toContain('-1')
  })
})

describe('previewDelta / rowOutcome', () => {
  it('is the count less what the ledger reads today', () => {
    expect(previewDelta(42, 872)).toBe(-830)
    expect(previewDelta(5, 2)).toBe(3)
    expect(previewDelta(0, 0)).toBe(0)
  })

  it('is unknown until both sides are', () => {
    expect(previewDelta(null, 2)).toBeNull()
    expect(previewDelta(5, null)).toBeNull()
  })

  it('is a first count unless the part is anchored', () => {
    expect(rowOutcome('new')).toBe('first')
    expect(rowOutcome('uncounted')).toBe('first')
    expect(rowOutcome('counted')).toBe('adjust')
  })
})

describe('needsBackflushFirst (111 Q25)', () => {
  it('flags a BOM part with a negative replay only', () => {
    expect(needsBackflushFirst({ hasBom: true, unbuiltSales: 830 })).toBe(true)
    expect(needsBackflushFirst({ hasBom: true, unbuiltSales: 0 })).toBe(false)
    expect(needsBackflushFirst({ hasBom: false, unbuiltSales: 830 })).toBe(false)
  })
})

describe('set counts links', () => {
  it('prefilters by part ids or by an import job', () => {
    expect(setCountsHrefForParts(['a', 'b'])).toBe(
      '/app/parts/manage/costing?s=opening&parts=a%2Cb'
    )
    expect(setCountsHrefForJob('job_1')).toBe('/app/parts/manage/costing?s=opening&job=job_1')
  })
})

describe('toOpeningStockKind', () => {
  it('accepts the three the write path takes, in either read shape', () => {
    expect(toOpeningStockKind('component')).toBe('component')
    expect(toOpeningStockKind(['finished_good'])).toBe('finished_good')
    expect(toOpeningStockKind('subassembly')).toBe('subassembly')
  })

  it('reads anything else as unset rather than throwing', () => {
    expect(toOpeningStockKind(null)).toBeNull()
    expect(toOpeningStockKind('')).toBeNull()
    expect(toOpeningStockKind([])).toBeNull()
    expect(toOpeningStockKind('widget')).toBeNull()
  })
})

describe('setKindConfirmTitle', () => {
  it('names the count and the kind, with the label the field carries', () => {
    expect(setKindConfirmTitle(34, 'finished_good')).toBe('Set 34 parts to Finished Good?')
    expect(setKindConfirmTitle(1, 'component')).toBe('Set 1 part to Component?')
  })
})

describe('partKindLabel', () => {
  it("reads the label off the field's own option list", () => {
    expect(partKindLabel('finished_good')).toBe('Finished Good')
    expect(partKindLabel(null)).toBe('Unclassified')
  })
})
