// packages/lib/src/money/orders/__tests__/reads.test.ts
//
// `parseFulfillments`, the tolerant reader every path into the shipment log
// goes through: the fulfill dialog, the bulk poster's netting read, the stamp
// write-back and the delete guard.
//
// 🛑 The property that carries this file is that the parser is LOSSLESS for the
// fields the ledger depends on. It is tolerant on purpose - a row it cannot
// understand is dropped rather than making the order unfulfillable - and the
// failure mode of tolerance is dropping a field silently. `subtotalMinor` is
// the one that bites: `shippedSubtotalMinor` sums it into the builder's
// `priorShipmentsSubtotalMinor`, so a parser that dropped it made every read
// report zero prior subtotal, and the second shipment of a split order
// allocated tax as if it were the first.

import { describe, expect, it } from 'vitest'
import { parseFulfillments } from '../reads'

/** The column's real shape: the field-value envelope around our own wrapper. */
function stored(fulfillments: unknown[]) {
  return { v: { fulfillments } }
}

const ROW = {
  sequence: 2,
  shippedAt: '2026-07-06',
  lines: [{ lineId: 'li_1', quantity: 3 }],
  subtotalMinor: 12_500,
  totalMinor: 13_300,
  shippingRecognised: true,
  glPostingId: 'gl_1',
  docNumber: 'AUXX-FUL-20260706',
  recordedAt: '2026-07-06T00:00:00.000Z',
}

describe('parseFulfillments', () => {
  it('reads back every field it was given', () => {
    expect(parseFulfillments(stored([ROW]))).toEqual([ROW])
  })

  // 🛑 The bug this test exists for.
  it('carries subtotalMinor through, because the next shipment allocates tax against it', () => {
    expect(parseFulfillments(stored([ROW]))[0]?.subtotalMinor).toBe(12_500)
  })

  // Optional, not defaulted to zero: rows written before the field existed
  // contribute nothing, which reproduces the old per-shipment behaviour for
  // those orders rather than inventing a number for them.
  it('leaves subtotalMinor absent on a row written before it existed', () => {
    const { subtotalMinor: _dropped, ...legacy } = ROW
    expect(parseFulfillments(stored([legacy]))[0]).not.toHaveProperty('subtotalMinor')
  })

  it('unwraps a bare wrapper with no field-value envelope', () => {
    expect(parseFulfillments({ fulfillments: [ROW] })).toEqual([ROW])
  })

  it('reads a top-level array, which is what a pre-envelope row holds', () => {
    expect(parseFulfillments([ROW])).toEqual([ROW])
  })

  it('sorts by sequence rather than by stored order', () => {
    expect(
      parseFulfillments(stored([{ ...ROW, sequence: 3 }, ROW])).map((row) => row.sequence)
    ).toEqual([2, 3])
  })

  it('drops a row with no usable sequence rather than refusing the whole log', () => {
    expect(parseFulfillments(stored([{ ...ROW, sequence: 'first' }, ROW]))).toEqual([ROW])
  })

  it('drops a line with no id or a non-positive quantity', () => {
    const rows = parseFulfillments(
      stored([
        {
          ...ROW,
          lines: [
            { lineId: 'li_1', quantity: 3 },
            { quantity: 1 },
            { lineId: 'li_2', quantity: 0 },
          ],
        },
      ])
    )

    expect(rows[0]?.lines).toEqual([{ lineId: 'li_1', quantity: 3 }])
  })

  it('reads nothing at all as an empty log', () => {
    expect(parseFulfillments(null)).toEqual([])
    expect(parseFulfillments(undefined)).toEqual([])
    expect(parseFulfillments({ v: null })).toEqual([])
    expect(parseFulfillments('not json')).toEqual([])
  })
})
