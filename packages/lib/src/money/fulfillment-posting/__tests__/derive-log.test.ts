// packages/lib/src/money/fulfillment-posting/__tests__/derive-log.test.ts

import { describe, expect, it } from 'vitest'
import type { OrderFulfillment } from '../../orders/client'
import { type DerivedLineFact, deriveFulfillmentLog } from '../derive-log'

/** `accounting.bookTimeZone` on the org this was measured against (49 §5). */
const ZONE = 'America/Los_Angeles'
const NOW = '2026-09-09T12:00:00.000Z'

function line(overrides: Partial<DerivedLineFact> & { lineId: string }): DerivedLineFact {
  return {
    orderedQuantity: 1,
    unitPriceMinor: 10_000,
    lineTaxMinor: null,
    fulfilledAt: null,
    fulfilledQuantity: null,
    shipmentCount: null,
    ...overrides,
  }
}

function derive(input: {
  existing?: OrderFulfillment[]
  lines: DerivedLineFact[]
  shipping?: number
}) {
  return deriveFulfillmentLog({
    existing: input.existing ?? [],
    lines: input.lines,
    orderShippingTotalMinor: input.shipping ?? 0,
    timeZone: ZONE,
    now: NOW,
  })
}

describe('deriveFulfillmentLog', () => {
  describe('a single shipment', () => {
    it('makes one entry from the lines that share a fulfilled day', () => {
      const result = derive({
        lines: [
          line({
            lineId: 'l1',
            orderedQuantity: 2,
            unitPriceMinor: 5_000,
            fulfilledAt: '2026-07-06T16:00:00.000Z',
            fulfilledQuantity: 2,
            shipmentCount: 1,
          }),
          line({
            lineId: 'l2',
            orderedQuantity: 1,
            unitPriceMinor: 2_500,
            fulfilledAt: '2026-07-06T18:30:00.000Z',
            fulfilledQuantity: 1,
            shipmentCount: 1,
          }),
        ],
        shipping: 1_200,
      })

      expect(result.heldOut).toBeNull()
      expect(result.changed).toBe(true)
      expect(result.fulfillments).toHaveLength(1)
      const entry = result.fulfillments[0]!
      expect(entry.sequence).toBe(1)
      expect(entry.shippedAt).toBe('2026-07-06')
      expect(entry.lines).toEqual([
        { lineId: 'l1', quantity: 2 },
        { lineId: 'l2', quantity: 1 },
      ])
      expect(entry.subtotalMinor).toBe(12_500)
      expect(entry.totalMinor).toBe(13_700)
      expect(entry.shippingRecognised).toBe(true)
      expect(entry.glPostingId).toBeNull()
      expect(entry.docNumber).toBeNull()
      expect(entry.recordedAt).toBe(NOW)
    })

    it('cuts the day in the BOOK time zone, not UTC', () => {
      // 02:00Z on July 6 is 19:00 on July 5 in Los Angeles. Cutting in UTC would
      // post this shipment a day late, and across a month boundary, a month late.
      const result = derive({
        lines: [
          line({
            lineId: 'l1',
            fulfilledAt: '2026-07-06T02:00:00.000Z',
            fulfilledQuantity: 1,
            shipmentCount: 1,
          }),
        ],
      })
      expect(result.fulfillments[0]!.shippedAt).toBe('2026-07-05')
    })

    it('ignores a line the channel said nothing about', () => {
      const result = derive({
        lines: [
          line({ lineId: 'unshipped' }),
          line({ lineId: 'no-date', fulfilledQuantity: 3 }),
          line({
            lineId: 'zero-qty',
            fulfilledAt: '2026-07-06T16:00:00.000Z',
            fulfilledQuantity: 0,
          }),
        ],
      })
      expect(result.fulfillments).toEqual([])
      expect(result.changed).toBe(false)
      expect(result.heldOut).toBeNull()
    })

    it('skips a line whose fulfilled date does not parse rather than throwing', () => {
      const result = derive({
        lines: [
          line({ lineId: 'bad', fulfilledAt: 'not a date', fulfilledQuantity: 1 }),
          line({
            lineId: 'good',
            fulfilledAt: '2026-07-06T16:00:00.000Z',
            fulfilledQuantity: 1,
          }),
        ],
      })
      expect(result.fulfillments).toHaveLength(1)
      expect(result.fulfillments[0]!.lines).toEqual([{ lineId: 'good', quantity: 1 }])
    })
  })

  describe('the measured split shipment (49 §5)', () => {
    // 82 of 538 imported orders: exactly two shipments, no line spanning both,
    // every line carrying its own fulfilled date.
    const lines = [
      line({
        lineId: 'first-day',
        orderedQuantity: 1,
        unitPriceMinor: 30_000,
        fulfilledAt: '2026-07-06T16:00:00.000Z',
        fulfilledQuantity: 1,
        shipmentCount: 1,
      }),
      line({
        lineId: 'second-day',
        orderedQuantity: 2,
        unitPriceMinor: 10_000,
        fulfilledAt: '2026-07-09T16:00:00.000Z',
        fulfilledQuantity: 2,
        shipmentCount: 1,
      }),
    ]

    it('makes two entries, sequenced by ship day', () => {
      const result = derive({ lines, shipping: 2_000 })
      expect(result.fulfillments.map((row) => [row.sequence, row.shippedAt])).toEqual([
        [1, '2026-07-06'],
        [2, '2026-07-09'],
      ])
      expect(result.fulfillments[0]!.lines).toEqual([{ lineId: 'first-day', quantity: 1 }])
      expect(result.fulfillments[1]!.lines).toEqual([{ lineId: 'second-day', quantity: 2 }])
    })

    it('recognises the order shipping on the FIRST shipment only', () => {
      const result = derive({ lines, shipping: 2_000 })
      expect(result.fulfillments.map((row) => row.shippingRecognised)).toEqual([true, false])
      expect(result.fulfillments[0]!.totalMinor).toBe(32_000)
      expect(result.fulfillments[1]!.totalMinor).toBe(20_000)
    })

    it('sequences by ship day even when the lines arrive out of order', () => {
      const result = derive({ lines: [...lines].reverse(), shipping: 2_000 })
      expect(result.fulfillments.map((row) => row.shippedAt)).toEqual(['2026-07-06', '2026-07-09'])
      expect(result.fulfillments[0]!.shippingRecognised).toBe(true)
    })
  })

  describe('totals', () => {
    it('extends a fractional rate once, at the line', () => {
      const result = derive({
        lines: [
          line({
            lineId: 'screws',
            orderedQuantity: 1_500,
            unitPriceMinor: 1.594,
            fulfilledAt: '2026-07-06T16:00:00.000Z',
            fulfilledQuantity: 1_500,
            shipmentCount: 1,
          }),
        ],
      })
      expect(result.fulfillments[0]!.subtotalMinor).toBe(2_391)
      expect(result.fulfillments[0]!.totalMinor).toBe(2_391)
    })

    it('adds a supplied per-line tax in full when the whole line shipped', () => {
      const result = derive({
        lines: [
          line({
            lineId: 'l1',
            orderedQuantity: 4,
            unitPriceMinor: 2_500,
            lineTaxMinor: 875,
            fulfilledAt: '2026-07-06T16:00:00.000Z',
            fulfilledQuantity: 4,
            shipmentCount: 1,
          }),
        ],
        shipping: 500,
      })
      expect(result.fulfillments[0]!.subtotalMinor).toBe(10_000)
      expect(result.fulfillments[0]!.totalMinor).toBe(11_375)
    })

    it('contributes ZERO tax for a line the channel gave no figure for', () => {
      // Null is not zero (48 §8.2) - the batch builder allocates the order's tax
      // instead, and this function only ever feeds the per-line basis.
      const result = derive({
        lines: [
          line({
            lineId: 'l1',
            orderedQuantity: 1,
            unitPriceMinor: 10_000,
            lineTaxMinor: null,
            fulfilledAt: '2026-07-06T16:00:00.000Z',
            fulfilledQuantity: 1,
            shipmentCount: 1,
          }),
        ],
      })
      expect(result.fulfillments[0]!.totalMinor).toBe(10_000)
    })
  })

  describe('a partial-line quantity', () => {
    it('scales the line tax by the fraction shipped', () => {
      const result = derive({
        lines: [
          line({
            lineId: 'l1',
            orderedQuantity: 3,
            unitPriceMinor: 1_000,
            lineTaxMinor: 100,
            fulfilledAt: '2026-07-06T16:00:00.000Z',
            fulfilledQuantity: 2,
            shipmentCount: 1,
          }),
        ],
      })
      const entry = result.fulfillments[0]!
      expect(entry.lines).toEqual([{ lineId: 'l1', quantity: 2 }])
      expect(entry.subtotalMinor).toBe(2_000)
      // round(100 * 2 / 3) = 67
      expect(entry.totalMinor).toBe(2_067)
    })

    it('carries the whole line tax when the ordered quantity cannot be a denominator', () => {
      const result = derive({
        lines: [
          line({
            lineId: 'l1',
            orderedQuantity: 0,
            unitPriceMinor: 1_000,
            lineTaxMinor: 100,
            fulfilledAt: '2026-07-06T16:00:00.000Z',
            fulfilledQuantity: 1,
            shipmentCount: 1,
          }),
        ],
      })
      expect(result.fulfillments[0]!.totalMinor).toBe(1_100)
    })
  })

  describe('the split-shipment hold-out', () => {
    it('holds the WHOLE order out and writes nothing when a line shipped twice', () => {
      const existing: OrderFulfillment[] = []
      const result = derive({
        existing,
        lines: [
          line({
            lineId: 'ok',
            fulfilledAt: '2026-07-06T16:00:00.000Z',
            fulfilledQuantity: 1,
            shipmentCount: 1,
          }),
          line({
            lineId: 'split-line',
            fulfilledAt: '2026-07-06T16:00:00.000Z',
            fulfilledQuantity: 2,
            shipmentCount: 2,
          }),
        ],
      })
      expect(result.heldOut).toBe('split-line')
      expect(result.changed).toBe(false)
      expect(result.fulfillments).toBe(existing)
    })

    it('does not hold out on a null shipment count - null is not "more than one"', () => {
      const result = derive({
        lines: [
          line({
            lineId: 'l1',
            fulfilledAt: '2026-07-06T16:00:00.000Z',
            fulfilledQuantity: 1,
            shipmentCount: null,
          }),
        ],
      })
      expect(result.heldOut).toBeNull()
      expect(result.fulfillments).toHaveLength(1)
    })
  })

  describe('merging against what is already stored', () => {
    const stored = (overrides: Partial<OrderFulfillment>): OrderFulfillment => ({
      sequence: 1,
      shippedAt: '2026-07-06',
      lines: [{ lineId: 'l1', quantity: 1 }],
      subtotalMinor: 10_000,
      totalMinor: 10_000,
      shippingRecognised: true,
      glPostingId: null,
      docNumber: null,
      recordedAt: '2026-07-07T00:00:00.000Z',
      ...overrides,
    })

    const shippedLine = line({
      lineId: 'l1',
      orderedQuantity: 1,
      unitPriceMinor: 10_000,
      fulfilledAt: '2026-07-06T16:00:00.000Z',
      fulfilledQuantity: 1,
      shipmentCount: 1,
    })

    it('keeps a matching STAMPED entry verbatim, stamp included', () => {
      const existing = [stored({ glPostingId: 'post_1', docNumber: 'AUXX-FUL-ORD0012F1' })]
      const result = derive({ existing, lines: [shippedLine] })
      expect(result.changed).toBe(false)
      expect(result.fulfillments).toEqual(existing)
      expect(result.fulfillments[0]!.glPostingId).toBe('post_1')
      expect(result.fulfillments[0]!.docNumber).toBe('AUXX-FUL-ORD0012F1')
      expect(result.fulfillments[0]!.recordedAt).toBe('2026-07-07T00:00:00.000Z')
    })

    it('keeps a DIFFERING stamped entry and drops the derived one', () => {
      // Drift on a posted shipment is a person's call (49 §2.6 rule 2).
      const existing = [
        stored({
          glPostingId: 'post_1',
          docNumber: 'AUXX-FUL-ORD0012F1',
          lines: [{ lineId: 'l1', quantity: 5 }],
        }),
      ]
      const result = derive({ existing, lines: [shippedLine] })
      expect(result.changed).toBe(false)
      expect(result.fulfillments).toEqual(existing)
      expect(result.fulfillments[0]!.lines).toEqual([{ lineId: 'l1', quantity: 5 }])
    })

    it('replaces a DIFFERING unstamped entry, keeping its sequence', () => {
      const existing = [stored({ sequence: 3, lines: [{ lineId: 'l1', quantity: 5 }] })]
      const result = derive({ existing, lines: [shippedLine], shipping: 400 })
      expect(result.changed).toBe(true)
      expect(result.fulfillments).toHaveLength(1)
      const entry = result.fulfillments[0]!
      expect(entry.sequence).toBe(3)
      expect(entry.lines).toEqual([{ lineId: 'l1', quantity: 1 }])
      expect(entry.subtotalMinor).toBe(10_000)
      // The replaced row's shipping flag went with it, so the replacement takes it back.
      expect(entry.shippingRecognised).toBe(true)
      expect(entry.totalMinor).toBe(10_400)
      expect(entry.recordedAt).toBe(NOW)
    })

    it('is a no-op on a re-derivation of an unstamped log it wrote itself', () => {
      const first = derive({ lines: [shippedLine], shipping: 400 })
      const second = derive({ existing: first.fulfillments, lines: [shippedLine], shipping: 400 })
      expect(second.changed).toBe(false)
      expect(second.fulfillments).toEqual(first.fulfillments)
    })

    it('appends a new day after the stored entries without renumbering them', () => {
      const existing = [
        stored({ sequence: 7, glPostingId: 'post_1', docNumber: 'AUXX-FUL-ORD0012F7' }),
      ]
      const later = line({
        lineId: 'l2',
        orderedQuantity: 1,
        unitPriceMinor: 3_000,
        fulfilledAt: '2026-07-09T16:00:00.000Z',
        fulfilledQuantity: 1,
        shipmentCount: 1,
      })
      const result = derive({ existing, lines: [shippedLine, later], shipping: 400 })
      expect(result.changed).toBe(true)
      expect(result.fulfillments.map((row) => [row.sequence, row.shippedAt])).toEqual([
        [7, '2026-07-06'],
        [8, '2026-07-09'],
      ])
      // The stored entry already recognised the freight; the appended one must not.
      expect(result.fulfillments[1]!.shippingRecognised).toBe(false)
      expect(result.fulfillments[1]!.totalMinor).toBe(3_000)
    })

    it('leaves a stored entry the channel no longer reports alone', () => {
      const existing = [
        stored({ sequence: 1, shippedAt: '2026-06-01', glPostingId: 'post_0' }),
        stored({ sequence: 2, shippingRecognised: false }),
      ]
      const result = derive({ existing, lines: [shippedLine] })
      expect(result.changed).toBe(false)
      expect(result.fulfillments).toEqual(existing)
    })

    it('does not recognise the shipping twice when a stored entry already holds it', () => {
      const existing = [stored({ sequence: 1, shippedAt: '2026-06-01', glPostingId: 'post_0' })]
      const result = derive({ existing, lines: [shippedLine], shipping: 400 })
      expect(result.fulfillments).toHaveLength(2)
      expect(result.fulfillments[1]!.shippingRecognised).toBe(false)
      expect(result.fulfillments[1]!.totalMinor).toBe(10_000)
    })

    it('pairs each derived day with at most one stored entry on that day', () => {
      const existing = [
        stored({ sequence: 1, lines: [{ lineId: 'l1', quantity: 1 }], glPostingId: 'post_1' }),
        stored({
          sequence: 2,
          lines: [{ lineId: 'l9', quantity: 9 }],
          shippingRecognised: false,
        }),
      ]
      const result = derive({ existing, lines: [shippedLine] })
      // The first stored row matches verbatim; the second stays untouched
      // because the derived shipment already claimed the day.
      expect(result.changed).toBe(false)
      expect(result.fulfillments).toEqual(existing)
    })
  })
})
