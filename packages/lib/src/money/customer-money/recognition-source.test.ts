// packages/lib/src/money/customer-money/recognition-source.test.ts

import { describe, expect, it } from 'vitest'
import { shipmentEconomicAmounts, sourceOccurrence } from './recognition-source'

type ShipmentCalculation = Parameters<typeof shipmentEconomicAmounts>[0]

function calculation(overrides: Partial<ShipmentCalculation> = {}): ShipmentCalculation {
  return {
    fulfillmentInstanceId: 'fulfillment_1',
    orderInstanceId: 'order_1',
    orderSubtotalMinor: '1000',
    orderTaxMinor: '100',
    orderShippingMinor: '100',
    priorShipmentSubtotalMinor: '0',
    includeShipping: true,
    lines: [
      {
        orderLineId: 'line_1',
        quantity: '1',
        orderedQuantity: '1',
        priorShippedQuantity: '0',
        netUnitMinor: '1000',
        netLineMinor: '1000',
        lineTaxMinor: null,
      },
    ],
    ...overrides,
  }
}

describe('shipmentEconomicAmounts', () => {
  it('uses frozen net line evidence and includes shipping only when the basis says so', () => {
    expect(shipmentEconomicAmounts(calculation())).toEqual({ netMinor: 1100n, taxMinor: 100n })
    expect(shipmentEconomicAmounts(calculation({ includeShipping: false }))).toEqual({
      netMinor: 1000n,
      taxMinor: 100n,
    })
  })

  it('blocks a shipment without line_item_net_total evidence', () => {
    expect(() =>
      shipmentEconomicAmounts(
        calculation({ lines: [{ ...calculation().lines![0], netLineMinor: null }] })
      )
    ).toThrow('line_item_net_total')
  })

  it('blocks minor amounts outside the safe numeric boundary used by the source calculator', () => {
    expect(() =>
      shipmentEconomicAmounts(calculation({ orderSubtotalMinor: '9007199254740992' }))
    ).toThrow('numeric boundary')
  })

  it('scales whole-line tax to the shipped quantity', () => {
    expect(
      shipmentEconomicAmounts(
        calculation({
          lines: [
            {
              ...calculation().lines![0],
              quantity: '1',
              orderedQuantity: '2',
              netLineMinor: '1000',
              lineTaxMinor: '100',
            },
          ],
          includeShipping: false,
        })
      )
    ).toEqual({ netMinor: 500n, taxMinor: 50n })
  })

  it('conserves odd line tax cents across three shipment reconstructions', () => {
    const shipments = [0, 1, 2].map((prior) =>
      shipmentEconomicAmounts(
        calculation({
          orderSubtotalMinor: '300',
          orderTaxMinor: '100',
          orderShippingMinor: '0',
          priorShipmentSubtotalMinor: String(prior * 100),
          includeShipping: false,
          lines: [
            {
              ...calculation().lines![0],
              quantity: '1',
              orderedQuantity: '3',
              priorShippedQuantity: String(prior),
              netUnitMinor: '100',
              netLineMinor: '300',
              lineTaxMinor: '100',
            },
          ],
        })
      )
    )

    expect(shipments.map((item) => item.taxMinor)).toEqual([33n, 34n, 33n])
    expect(shipments.reduce((sum, item) => sum + item.taxMinor, 0n)).toBe(100n)
    expect(shipments.reduce((sum, item) => sum + item.netMinor, 0n)).toBe(300n)
  })
})

it('normalizes PostgreSQL shipment timestamp text while refusing date-only evidence', () => {
  expect(sourceOccurrence('2026-07-05 19:49:02+00', 'shipment')).toBe('2026-07-05T19:49:02.000Z')
  expect(sourceOccurrence('2026-07-05T12:49:02-07:00', 'shipment')).toBe('2026-07-05T19:49:02.000Z')
  expect(() => sourceOccurrence('2026-07-05', 'shipment')).toThrow('occurrence instant')
})
