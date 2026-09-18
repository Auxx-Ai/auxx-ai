// packages/lib/src/accounting/money/customer-money/__tests__/recognition.test.ts
import { describe, expect, it } from 'vitest'
import {
  allocateOrderRecognition,
  allocateRecognitionTaxComponents,
  type OrderRecognitionEvent,
} from '../recognition'

const receipt = (id: string, day: string, amountMinor: string): OrderRecognitionEvent => ({
  id,
  kind: 'receipt',
  effectiveDate: day,
  occurredAt: `${day}T12:00:00Z`,
  amountMinor,
})
const shipment = (
  id: string,
  day: string,
  netMinor: string,
  taxMinor: string
): OrderRecognitionEvent => ({
  id,
  kind: 'fulfillment',
  effectiveDate: day,
  occurredAt: `${day}T12:00:00Z`,
  netMinor,
  taxMinor,
})
const run = (events: OrderRecognitionEvent[]) =>
  allocateOrderRecognition({ orderNetMinor: '11000', orderTaxMinor: '1000', events })
const portions = (events: ReturnType<typeof run>) =>
  events.map(({ depositMinor, receivableMinor, taxMinor }) => [
    depositMinor,
    receivableMinor,
    taxMinor,
  ])

describe('payment and shipment component ownership', () => {
  it('collects tax once and releases deposits on two later shipment dates', () => {
    const result = run([
      receipt('p1', '2026-08-31', '12000'),
      shipment('s1', '2026-09-01', '7000', '600'),
      shipment('s2', '2026-10-01', '4000', '400'),
    ])
    expect(portions(result)).toEqual([
      ['11000', '0', '1000'],
      ['7000', '0', '0'],
      ['4000', '0', '0'],
    ])
    expect(result.map((row) => row.effectiveDate)).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-10-01',
    ])
  })

  it('settles a prior shipment receivable before allocating remaining tax and deposits', () => {
    expect(
      portions(
        run([
          shipment('s1', '2026-08-31', '7000', '600'),
          receipt('p1', '2026-09-01', '12000'),
          shipment('s2', '2026-09-02', '4000', '400'),
        ])
      )
    ).toEqual([
      ['0', '7600', '600'],
      ['4000', '7600', '400'],
      ['4000', '0', '0'],
    ])
  })

  it('splits a partially funded shipment between deposits and AR, then settles that AR', () => {
    expect(
      portions(
        run([
          receipt('p1', '2026-08-30', '6000'),
          shipment('s1', '2026-08-31', '7000', '600'),
          receipt('p2', '2026-09-01', '6000'),
          shipment('s2', '2026-09-02', '4000', '400'),
        ])
      )
    ).toEqual([
      ['5500', '0', '500'],
      ['5500', '1600', '100'],
      ['4000', '1600', '400'],
      ['4000', '0', '0'],
    ])
  })

  it('keeps later partial payments entirely in AR until the shipped balance is settled', () => {
    expect(
      portions(
        run([
          shipment('s1', '2026-08-31', '7000', '600'),
          receipt('p1', '2026-09-01', '6000'),
          receipt('p2', '2026-09-02', '6000'),
        ])
      )
    ).toEqual([
      ['0', '7600', '600'],
      ['0', '6000', '0'],
      ['4000', '1600', '400'],
    ])
  })

  it('allocates odd tax cents cumulatively across captures and preserves a discounted split', () => {
    const result = allocateOrderRecognition({
      orderNetMinor: '181',
      orderTaxMinor: '19',
      events: [
        receipt('p1', '2026-09-01', '29'),
        receipt('p2', '2026-09-02', '29'),
        receipt('p3', '2026-09-03', '142'),
        shipment('s1', '2026-09-04', '91', '10'),
        shipment('s2', '2026-09-05', '90', '9'),
      ],
    })
    expect(portions(result)).toEqual([
      ['26', '0', '3'],
      ['26', '0', '3'],
      ['129', '0', '13'],
      ['91', '0', '0'],
      ['90', '0', '0'],
    ])
  })

  it('uses the original funding phase for cumulative tax instead of rerounding each remainder', () => {
    const result = allocateOrderRecognition({
      orderNetMinor: '90',
      orderTaxMinor: '10',
      events: [
        receipt('p1', '2026-09-01', '14'),
        receipt('p2', '2026-09-02', '14'),
        receipt('p3', '2026-09-03', '72'),
      ],
    })
    expect(result.map((row) => row.taxMinor)).toEqual(['1', '2', '7'])
  })

  it('keeps earlier fingerprints stable when a later event arrives, but changes them for late evidence', () => {
    const first = receipt('p1', '2026-09-02', '6000')
    const original = run([first])[0]!
    expect(run([first, shipment('s1', '2026-09-03', '7000', '600')])[0]!.historyHash).toBe(
      original.historyHash
    )
    expect(run([first, shipment('s0', '2026-09-01', '7000', '600')])[1]!.historyHash).not.toBe(
      original.historyHash
    )
  })

  it('refuses overpayment and over-shipment instead of clipping amounts', () => {
    expect(() => run([receipt('p1', '2026-09-01', '12001')])).toThrow('capacity')
    expect(() => run([shipment('s1', '2026-09-01', '11001', '1000')])).toThrow('components')
  })
})

describe('tax component conservation', () => {
  it('preserves every jurisdiction cent over multiple advance receipts and shipments', () => {
    const allocations = allocateOrderRecognition({
      orderNetMinor: '181',
      orderTaxMinor: '19',
      events: [
        receipt('p1', '2026-09-01', '28'),
        shipment('s1', '2026-09-02', '91', '10'),
        receipt('p2', '2026-09-03', '29'),
        receipt('p3', '2026-09-04', '143'),
        shipment('s2', '2026-09-05', '90', '9'),
      ],
    })
    const shares = allocateRecognitionTaxComponents(allocations, [
      { componentKey: 'state', amountMinor: '13' },
      { componentKey: 'county', amountMinor: '6' },
    ])
    for (const allocation of allocations) {
      expect(shares.get(allocation.id)!.reduce((sum, c) => sum + BigInt(c.amountMinor), 0n)).toBe(
        BigInt(allocation.taxMinor)
      )
    }
    for (const [key, amount] of [
      ['state', 13n],
      ['county', 6n],
    ] as const) {
      expect(
        [...shares.values()]
          .flat()
          .filter((c) => c.componentKey === key)
          .reduce((sum, c) => sum + BigInt(c.amountMinor), 0n)
      ).toBe(amount)
    }
  })
  it('preserves earlier allocations when a later receipt arrives', () => {
    const events = [receipt('p1', '2026-09-01', '14'), receipt('p2', '2026-09-02', '86')]
    const components = [
      { componentKey: 'a', amountMinor: '6' },
      { componentKey: 'b', amountMinor: '4' },
    ]
    const allocate = (events: OrderRecognitionEvent[]) =>
      allocateRecognitionTaxComponents(
        allocateOrderRecognition({ orderNetMinor: '90', orderTaxMinor: '10', events }),
        components
      )
    expect(allocate(events).get('p1')).toEqual(allocate(events.slice(0, 1)).get('p1'))
  })
})
