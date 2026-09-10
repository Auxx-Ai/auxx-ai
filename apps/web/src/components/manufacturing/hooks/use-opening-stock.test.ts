// apps/web/src/components/manufacturing/hooks/use-opening-stock.test.ts

// The opening-stock checklist's pure half: which rows the run takes, and the
// evidence each refusal carries.
//
// These are the rules that decide what gets stamped onto an `updatable: false`
// movement, so they are tested rather than read: a row whose displayed kind is
// only a suggestion must NOT reach the run (it would name 1330 while the write
// resolved 1310 off the stored value), and a row that already has movements
// must be refused before anything else is even considered.

import { describe, expect, it } from 'vitest'
import {
  excludeReason,
  exclusionDetail,
  type OpeningStockRow,
  partKindLabel,
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
    isUnclassified: true,
    standardCost: 2050,
    quantity: 4,
    unitCost: 2050,
    extended: 8200,
    isCostOverride: false,
    state: 'not-opened',
    ...overrides,
  }
}

describe('excludeReason', () => {
  it('takes a complete, not-opened row', () => {
    expect(excludeReason(row())).toBeNull()
  })

  it('takes an unclassified row - a stored component lands in 1310 honestly', () => {
    // Unclassified is a chip, never a gate. `component` and unset both resolve
    // to Raw Materials, so the account the row names IS the account the write
    // resolves; there is nothing for a confirm to correct.
    expect(excludeReason(row({ storedKind: null, kind: '', isUnclassified: true }))).toBeNull()
  })

  it('refuses a row that is already opened', () => {
    expect(excludeReason(row({ state: 'opened' }))).toBe('opened')
  })

  it('refuses a row with other movements', () => {
    expect(excludeReason(row({ state: 'blocked' }))).toBe('blocked')
  })

  it('refuses a row whose kind is still only a suggestion', () => {
    // 🛑 The whole point. `shouldSuggestFinishedGood` OFFERS `finished_good`;
    // until somebody stores it the part is still `component`, so running would
    // stamp 1310 onto a movement the screen said was 1330 - and the stamp is
    // append-only.
    expect(
      excludeReason(
        row({
          storedKind: 'component',
          kind: 'finished_good',
          kindIsUnconfirmed: true,
          accountLabel: '1330 Finished Goods',
        })
      )
    ).toBe('kind-unconfirmed')
  })

  it('refuses a missing or non-positive quantity', () => {
    expect(excludeReason(row({ quantity: null }))).toBe('no-quantity')
    expect(excludeReason(row({ quantity: 0 }))).toBe('no-quantity')
    expect(excludeReason(row({ quantity: -3 }))).toBe('no-quantity')
  })

  it('refuses a missing or non-positive unit cost', () => {
    expect(excludeReason(row({ unitCost: null }))).toBe('no-cost')
    expect(excludeReason(row({ unitCost: 0 }))).toBe('no-cost')
  })

  it('reports the most disqualifying reason first', () => {
    // A part that already has an opening is refused whatever else is true of
    // it. Reporting "no quantity" here would suggest typing one would help.
    expect(excludeReason(row({ state: 'opened', quantity: null, unitCost: null }))).toBe('opened')
    expect(
      excludeReason(row({ kindIsUnconfirmed: true, kind: 'finished_good', quantity: null }))
    ).toBe('kind-unconfirmed')
  })

  it('takes a deliberate cost override - the badge warns, it does not block', () => {
    expect(excludeReason(row({ unitCost: 1900, isCostOverride: true }))).toBeNull()
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

  it('says the part has no standard to default from when it has none', () => {
    expect(exclusionDetail(row({ unitCost: null, standardCost: null }), 'no-cost')).toContain(
      'no standard cost'
    )
    expect(exclusionDetail(row({ unitCost: null }), 'no-cost')).not.toContain('no standard cost')
  })

  it('carries the quantity that proves a no-quantity refusal', () => {
    expect(exclusionDetail(row({ quantity: null }), 'no-quantity')).toContain('No quantity')
    expect(exclusionDetail(row({ quantity: 0 }), 'no-quantity')).toContain('0')
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
    // The ActionBar's selection is the only thing that says how far the write
    // reaches, so the count is in the title rather than only in the bar.
    expect(setKindConfirmTitle(34, 'finished_good')).toBe('Set 34 parts to Finished Good?')
    expect(setKindConfirmTitle(2, 'subassembly')).toBe('Set 2 parts to Subassembly?')
  })

  it('reads singular for one part', () => {
    expect(setKindConfirmTitle(1, 'component')).toBe('Set 1 part to Component?')
  })
})

describe('partKindLabel', () => {
  it("reads the label off the field's own option list", () => {
    expect(partKindLabel('finished_good')).toBe('Finished Good')
    expect(partKindLabel('component')).toBe('Component')
  })

  it('calls an absent kind Unclassified', () => {
    expect(partKindLabel(null)).toBe('Unclassified')
    expect(partKindLabel('')).toBe('Unclassified')
  })
})
