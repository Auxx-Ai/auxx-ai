// packages/lib/src/accounting/sales/fulfillments/shipment-lines.ts

import type { OrderLineForFulfillment } from '../orders/reads'

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
    name: line.name,
  }
}
