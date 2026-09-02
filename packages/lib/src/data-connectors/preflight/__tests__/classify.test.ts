// packages/lib/src/data-connectors/preflight/__tests__/classify.test.ts
// Every row of the design's §9 test-plan table that concerns classification
// (plans/money/design/duplicate-sku-preflight.md §9), plus the `matched_archived`
// decision this module makes for the one row the design left undecided.

import { describe, expect, it } from 'vitest'
import { classifyVariants, type ExistingPart } from '../classify'
import type { SweptVariant } from '../sweep'

function variant(overrides: Partial<SweptVariant> & { variantId: string }): SweptVariant {
  return { sku: null, title: overrides.variantId, productId: 'product_1', ...overrides }
}

function part(overrides: Partial<ExistingPart> & { id: string; sku: string }): ExistingPart {
  return { archivedAt: null, displayName: overrides.id, ...overrides }
}

describe('classifyVariants', () => {
  it('flags two variants sharing a non-blank SKU as ambiguous and blocking', () => {
    const variants = [
      variant({ variantId: 'v1', sku: 'LIFT-3000' }),
      variant({ variantId: 'v2', sku: 'LIFT-3000' }),
    ]
    const { rows, summary } = classifyVariants(variants, [])

    expect(rows.map((r) => r.class)).toEqual(['ambiguous', 'ambiguous'])
    expect(summary.blocking).toBe(true)
    expect(summary.counts.ambiguous).toBe(2)
    expect(summary.ambiguousSkus).toEqual([{ sku: 'LIFT-3000', variantIds: ['v1', 'v2'] }])
  })

  it('classifies two blank SKUs as both `blank`, never `ambiguous`', () => {
    const variants = [
      variant({ variantId: 'v1', sku: null }),
      variant({ variantId: 'v2', sku: '' }),
    ]
    const { rows, summary } = classifyVariants(variants, [])

    expect(rows.map((r) => r.class)).toEqual(['blank', 'blank'])
    expect(summary.counts.ambiguous).toBe(0)
    expect(summary.counts.blank).toBe(2)
    expect(summary.ambiguousSkus).toEqual([])
    expect(summary.blocking).toBe(false)
  })

  it('classifies a whitespace-only SKU as blank, not a NUMBER-coercion match', () => {
    const variants = [variant({ variantId: 'v1', sku: '   ' })]
    const { rows, summary } = classifyVariants(variants, [])

    expect(rows[0]?.class).toBe('blank')
    expect(summary.counts.blank).toBe(1)
    // Design §3's NUMBER-coercion trap (`Number('') === 0`) cannot fire here:
    // this module normalizes to `null` before any comparison ever happens, so
    // there is no numeric column for a blank to accidentally equal.
    expect(summary.blocking).toBe(false)
  })

  it('matches a SKU that hits exactly one live existing part, naming it', () => {
    const variants = [variant({ variantId: 'v1', sku: 'LIFT-3000' })]
    const parts = [part({ id: 'part_1', sku: 'LIFT-3000', displayName: 'Lift Motor 3000' })]
    const { rows, summary } = classifyVariants(variants, parts)

    expect(rows[0]?.class).toBe('matched')
    expect(rows[0]?.matchedPartId).toBe('part_1')
    expect(rows[0]?.matchedPartName).toBe('Lift Motor 3000')
    expect(summary.blocking).toBe(false)
  })

  it('classifies a SKU that only matches an archived part as `matched_archived` and blocking', () => {
    const variants = [variant({ variantId: 'v1', sku: 'LIFT-3000' })]
    const parts = [
      part({
        id: 'part_1',
        sku: 'LIFT-3000',
        archivedAt: new Date('2026-01-01T00:00:00.000Z'),
        displayName: 'Lift Motor 3000 (archived)',
      }),
    ]
    const { rows, summary } = classifyVariants(variants, parts)

    expect(rows[0]?.class).toBe('matched_archived')
    expect(rows[0]?.matchedPartId).toBe('part_1')
    expect(summary.counts.matched_archived).toBe(1)
    expect(summary.blocking).toBe(true)
  })

  it('classifies a SKU with no existing match as `create`', () => {
    const variants = [variant({ variantId: 'v1', sku: 'NEW-SKU' })]
    const { rows, summary } = classifyVariants(variants, [])

    expect(rows[0]?.class).toBe('create')
    expect(summary.counts.create).toBe(1)
    expect(summary.blocking).toBe(false)
  })

  it('running the same input twice is idempotent', () => {
    const variants = [
      variant({ variantId: 'v1', sku: 'A' }),
      variant({ variantId: 'v2', sku: 'A' }),
      variant({ variantId: 'v3', sku: null }),
    ]
    const parts = [part({ id: 'part_1', sku: 'B' })]

    const first = classifyVariants(variants, parts)
    const second = classifyVariants(variants, parts)

    expect(second).toEqual(first)
  })

  it('trims SKUs (whitespace-padded == unpadded) but never lowercases them', () => {
    const variants = [
      variant({ variantId: 'v1', sku: '  LIFT-3000  ' }),
      variant({ variantId: 'v2', sku: 'LIFT-3000' }),
      variant({ variantId: 'v3', sku: 'lift-3000' }),
    ]
    const { rows } = classifyVariants(variants, [])

    // v1 and v2 differ only by whitespace — trimming makes them collide.
    expect(rows.find((r) => r.variantId === 'v1')?.class).toBe('ambiguous')
    expect(rows.find((r) => r.variantId === 'v2')?.class).toBe('ambiguous')
    // v3 differs in case, which is never folded — it does not join that collision.
    expect(rows.find((r) => r.variantId === 'v3')?.class).toBe('create')
  })
})
