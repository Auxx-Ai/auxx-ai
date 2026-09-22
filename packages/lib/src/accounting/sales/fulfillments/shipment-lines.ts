// packages/lib/src/accounting/sales/fulfillments/shipment-lines.ts

import { computeShipmentTotals, shippedLineAmount } from '../../ledger/builders/fulfillment'
import type { OrderForFulfillment, OrderLineForFulfillment } from '../orders/reads'
import { isLiveFulfillment } from './client'
import type { Fulfillment } from './types'

/** One shipped line in `computeShipmentTotals`'s input shape, shared by the hand lane and the stamp. */
export interface ShipmentLine {
  lineId: string
  quantity: number
  unitPriceMinor: number
  lineTotalMinor: number | null
  orderedQuantity: number
  priorShippedQuantity: number
  /** Present only when the line carries `line_item_tax_total`. */
  taxMinor?: number
  /** `line_item_line_total`, only when `lineTotalMinor` is the stamped net: the discount basis. */
  listLineTotalMinor: number | null
  giftCard: boolean
  name: string
}

// `undefined`, not 0, when the line carries no tax: 0 would flip the shipment onto
// the per-line basis and under-credit sales tax payable.
function shippedLineTaxMinor(
  line: Pick<OrderLineForFulfillment, 'lineTaxMinor' | 'quantity'>,
  quantity: number
): number | undefined {
  if (line.lineTaxMinor == null) return undefined
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) return undefined
  if (quantity >= line.quantity) return line.lineTaxMinor
  return Math.round((line.lineTaxMinor * quantity) / line.quantity)
}

/**
 * `priorShippedQuantity` is the caller's: `line.shippedQuantity` sums every fulfillment
 * of the order, so the stamp's sequence walk keeps its own running tally instead.
 */
export function shapeShipmentLine(
  line: OrderLineForFulfillment,
  quantity: number,
  priorShippedQuantity: number
): ShipmentLine {
  const taxMinor = shippedLineTaxMinor(line, quantity)
  return {
    lineId: line.lineId,
    quantity,
    unitPriceMinor: line.unitPriceMinor,
    lineTotalMinor: line.lineTotalMinor ?? null,
    orderedQuantity: line.quantity,
    priorShippedQuantity,
    ...(taxMinor === undefined ? {} : { taxMinor }),
    listLineTotalMinor: line.listLineTotalMinor,
    giftCard: line.giftCard,
    name: line.name,
  }
}

/** One shipment of an order as the sequence walk sees it: its lines and its share. */
export interface OrderShipment {
  fulfillment: Fulfillment
  lines: ShipmentLine[]
  /** `fulfillment_line` rows whose `line_item` is not on the order; dropped from the walk. */
  unmatchedLineItemIds: string[]
  /** The subtotal of every earlier LIVE shipment - the builder's cumulative tax prior. */
  priorSubtotalMinor: number
  includeShipping: boolean
  subtotalMinor: number
  taxMinor: number
  shippingMinor: number
  totalMinor: number
  shippingRecognised: boolean
}

/**
 * Walk one order's shipments in sequence, so the cumulative tax prior and the
 * shipping-once flag are right (plan 78 §4.1).
 *
 * The one arithmetic the stamp (`stamp-totals.ts`) and the poster
 * (`accounting.ts`) share: two walks could disagree about a shipment's share,
 * and the builder's tie check would then refuse the entry it computed.
 * A cancelled shipment keeps its subtotal with tax and shipping at 0 and does
 * not advance the priors (§7.1a).
 */
export function resolveOrderShipments(order: OrderForFulfillment): OrderShipment[] {
  const orderLinesById = new Map(order.lines.map((line) => [line.lineId, line]))
  const fulfillments = [...order.fulfillments].sort((a, b) => a.sequence - b.sequence)

  let priorSubtotalMinor = 0
  let shippingTaken = false
  const priorShippedByLine = new Map<string, number>()
  const shipments: OrderShipment[] = []

  for (const fulfillment of fulfillments) {
    const lines: ShipmentLine[] = []
    const unmatchedLineItemIds: string[] = []
    for (const line of fulfillment.lines) {
      const orderLine = orderLinesById.get(line.lineItemId)
      if (!orderLine) {
        unmatchedLineItemIds.push(line.lineItemId)
        continue
      }
      lines.push(
        shapeShipmentLine(orderLine, line.quantity, priorShippedByLine.get(orderLine.lineId) ?? 0)
      )
    }

    const label = `order ${order.number ?? order.orderId} shipment ${fulfillment.sequence}`
    const priorForThis = priorSubtotalMinor
    let subtotalMinor: number
    let taxMinor: number
    let shippingMinor: number
    let includeShipping = false

    if (!isLiveFulfillment(fulfillment)) {
      subtotalMinor = lines.reduce((sum, line) => sum + shippedLineAmount(line, label), 0)
      taxMinor = 0
      shippingMinor = 0
    } else {
      includeShipping = order.shippingOwed && !shippingTaken
      const amounts = computeShipmentTotals({
        label,
        lines,
        orderSubtotalMinor: order.subtotalMinor,
        orderTaxTotalMinor: order.taxTotalMinor,
        priorShipmentsSubtotalMinor: priorSubtotalMinor,
        orderShippingTotalMinor: order.shippingTotalMinor,
        includeShipping,
        context: { orderId: order.orderId, fulfillmentId: fulfillment.id },
      })
      subtotalMinor = amounts.subtotalMinor
      taxMinor = amounts.taxMinor
      shippingMinor = amounts.shippingMinor
      priorSubtotalMinor += subtotalMinor
      shippingTaken ||= shippingMinor > 0
      for (const line of fulfillment.lines) {
        priorShippedByLine.set(
          line.lineItemId,
          (priorShippedByLine.get(line.lineItemId) ?? 0) + line.quantity
        )
      }
    }

    shipments.push({
      fulfillment,
      lines,
      unmatchedLineItemIds,
      priorSubtotalMinor: priorForThis,
      includeShipping,
      subtotalMinor,
      taxMinor,
      shippingMinor,
      totalMinor: subtotalMinor + taxMinor + shippingMinor,
      shippingRecognised: shippingMinor > 0,
    })
  }
  return shipments
}
