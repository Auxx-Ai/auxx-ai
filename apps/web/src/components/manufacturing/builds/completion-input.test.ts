// apps/web/src/components/manufacturing/builds/completion-input.test.ts
//
// The completion form's pure half. Three things can go silently wrong here and
// each has a test:
//
//  - a line overridden to ZERO is dropped by the server, so rebuilding the row
//    list from the plan alone would take the row (and the input that produced
//    it) off screen mid-edit with no way back;
//  - an untouched line must send NOTHING, so it keeps tracking the bill of
//    materials as the produced/scrapped quantities move;
//  - an off-BOM row must stay distinguishable from a BOM row, because
//    `qtyPerUnit: null` is what makes a floor substitution findable later.

import type { BuildComponentLine } from '@auxx/lib/builds/client'
import { describe, expect, it } from 'vitest'
import { buildComponentOverrides, mergeComponentRows, rememberComponents } from './completion-input'

function line(overrides: Partial<BuildComponentLine> & { partId: string }): BuildComponentLine {
  return {
    partName: `Part ${overrides.partId}`,
    qtyPerUnit: 2,
    quantityConsumed: 20,
    unitCost: 500,
    extendedCost: 10_000,
    glAccount: '1310',
    offBom: false,
    ...overrides,
  }
}

describe('rememberComponents', () => {
  it('accumulates rather than replaces, so a zeroed line stays known', () => {
    const first = rememberComponents([], [line({ partId: 'motor' }), line({ partId: 'tube' })])
    // The next plan drops `tube` because it was overridden to zero.
    const second = rememberComponents(first, [line({ partId: 'motor' })])

    expect(second.map((entry) => entry.partId).sort()).toEqual(['motor', 'tube'])
  })

  it('refreshes what it already knows rather than duplicating it', () => {
    const first = rememberComponents([], [line({ partId: 'motor', partName: 'Old name' })])
    const second = rememberComponents(first, [line({ partId: 'motor', partName: 'Motor' })])

    expect(second).toHaveLength(1)
    expect(second[0]?.partName).toBe('Motor')
  })
})

describe('mergeComponentRows', () => {
  const known = rememberComponents(
    [],
    [
      line({ partId: 'motor' }),
      line({ partId: 'tube' }),
      line({ partId: 'glue', offBom: true, qtyPerUnit: null }),
    ]
  )

  it('keeps a dropped line visible, marked, and at the quantity that dropped it', () => {
    const rows = mergeComponentRows(known, [line({ partId: 'motor' })], { tube: 0 })
    const tube = rows.find((row) => row.partId === 'tube')

    expect(tube?.dropped).toBe(true)
    expect(tube?.quantityConsumed).toBe(0)
    expect(tube?.extendedCost).toBeNull()
    // Still overridden — the reset affordance has to stay reachable.
    expect(tube?.overridden).toBe(true)
  })

  it('marks a typed line as overridden and an untouched one as not', () => {
    const rows = mergeComponentRows(
      known,
      [line({ partId: 'motor', quantityConsumed: 17 }), line({ partId: 'tube' })],
      { motor: 17 }
    )

    expect(rows.find((row) => row.partId === 'motor')?.overridden).toBe(true)
    expect(rows.find((row) => row.partId === 'tube')?.overridden).toBe(false)
  })

  it('sorts bill-of-materials lines before off-BOM substitutions', () => {
    const rows = mergeComponentRows(
      known,
      [
        line({ partId: 'glue', offBom: true, qtyPerUnit: null }),
        line({ partId: 'motor' }),
        line({ partId: 'tube' }),
      ],
      {}
    )

    expect(rows.at(-1)?.partId).toBe('glue')
    // 🛑 `qtyPerUnit: null` is the off-BOM marker, not missing data.
    expect(rows.at(-1)?.qtyPerUnit).toBeNull()
    expect(rows.at(-1)?.offBom).toBe(true)
  })
})

describe('buildComponentOverrides', () => {
  it('sends nothing at all when nothing was typed', () => {
    // The server then derives every line from the bill of materials at the
    // current quantities, which is what keeps the lines moving with "produced".
    expect(buildComponentOverrides({})).toEqual([])
  })

  it('keeps a zero — it is how somebody says the part was not used', () => {
    expect(buildComponentOverrides({ tube: 0 })).toEqual([{ partId: 'tube', quantityConsumed: 0 }])
  })

  it('drops a negative, which would silently reduce consumption below the BOM', () => {
    expect(buildComponentOverrides({ tube: -4 })).toEqual([])
  })

  it('drops a non-finite quantity rather than sending NaN to the pricer', () => {
    expect(buildComponentOverrides({ tube: Number.NaN })).toEqual([])
  })
})
