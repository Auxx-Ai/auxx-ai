// packages/lib/src/accounting/sales/fulfillments/stamp-totals.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { requireCachedEntityDefId } from '../../../cache'
import { createFieldValueContext } from '../../../field-values/field-value-helpers'
import { setValueWithType } from '../../../field-values/field-value-mutations'
import { toFieldType } from '../../../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../../../realtime'
import { toRecordId } from '../../../resources/resource-id'
import { systemFieldMap } from '../../../resources/system-records'
import { computeShipmentTotals, shippedLineAmount } from '../../ledger/builders/fulfillment'
import { readOrderForFulfillment } from '../orders/reads'
import { isLiveFulfillment } from './client'
import { type ShipmentLine, shapeShipmentLine } from './shipment-lines'

const logger = createScopedLogger('sales:fulfillment-totals')

const TOTALS_ATTRS = [
  'fulfillment_subtotal',
  'fulfillment_total',
  'fulfillment_shipping_recognised',
] as const

/**
 * Stamp every fulfillment's totals on one order, walking them in sequence so the
 * cumulative tax prior is right (plan 78 §4.1). A cancelled one keeps its subtotal
 * with tax and shipping at 0 (§7.1a); a posted one that disagrees is skipped.
 */
export async function stampOrderShipmentTotals(
  db: Database,
  organizationId: string,
  orderInstanceId: string
): Promise<{ fulfillmentsWritten: number; skippedPosted: number }> {
  const read = await readOrderForFulfillment(db, { organizationId, orderId: orderInstanceId })
  if (read.isErr()) throw read.error
  const order = read.value

  const fields = await systemFieldMap<SystemAttribute>(db, organizationId, [...TOTALS_ATTRS])
  const subtotalField = fields.fulfillment_subtotal
  const totalField = fields.fulfillment_total
  const shippingField = fields.fulfillment_shipping_recognised
  if (!subtotalField || !totalField || !shippingField) {
    logger.warn('Missing fulfillment total fields', {
      organizationId,
      orderInstanceId,
      subtotal: !!subtotalField,
      total: !!totalField,
      shippingRecognised: !!shippingField,
    })
    return { fulfillmentsWritten: 0, skippedPosted: 0 }
  }

  const fulfillmentDefId = await requireCachedEntityDefId(organizationId, 'fulfillment')
  const orderLinesById = new Map(order.lines.map((line) => [line.lineId, line]))
  // The tax prior is cumulative, so the walk must follow sequence, not read order.
  const fulfillments = [...order.fulfillments].sort((a, b) => a.sequence - b.sequence)

  let priorSubtotalMinor = 0
  let shippingTaken = false
  const priorShippedByLine = new Map<string, number>()
  const context = createFieldValueContext(organizationId, undefined, db)
  const entries: FieldValueUpdateEntry[] = []
  let fulfillmentsWritten = 0
  let skippedPosted = 0

  for (const fulfillment of fulfillments) {
    const shipmentLines: ShipmentLine[] = []
    for (const line of fulfillment.lines) {
      const orderLine = orderLinesById.get(line.lineItemId)
      if (!orderLine) {
        logger.warn('Fulfillment line has no matching order line', {
          organizationId,
          orderInstanceId,
          fulfillmentId: fulfillment.id,
          lineItemId: line.lineItemId,
        })
        continue
      }
      shipmentLines.push(
        shapeShipmentLine(orderLine, line.quantity, priorShippedByLine.get(orderLine.lineId) ?? 0)
      )
    }

    let subtotalMinor: number
    let taxMinor: number
    let shippingMinor: number
    const label = `order ${order.number ?? orderInstanceId} shipment ${fulfillment.sequence}`

    if (!isLiveFulfillment(fulfillment)) {
      subtotalMinor = shipmentLines.reduce((sum, line) => sum + shippedLineAmount(line, label), 0)
      taxMinor = 0
      shippingMinor = 0
    } else {
      const includeShipping = order.shippingOwed && !shippingTaken
      const amounts = computeShipmentTotals({
        label,
        lines: shipmentLines,
        orderSubtotalMinor: order.subtotalMinor,
        orderTaxTotalMinor: order.taxTotalMinor,
        priorShipmentsSubtotalMinor: priorSubtotalMinor,
        orderShippingTotalMinor: order.shippingTotalMinor,
        includeShipping,
        context: { orderId: orderInstanceId, fulfillmentId: fulfillment.id },
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

    const totalMinor = subtotalMinor + taxMinor + shippingMinor
    const shippingRecognised = shippingMinor > 0

    if (
      fulfillment.subtotalMinor === subtotalMinor &&
      fulfillment.totalMinor === totalMinor &&
      fulfillment.shippingRecognised === shippingRecognised
    ) {
      continue
    }

    if (fulfillment.glPosting !== null) {
      skippedPosted++
      logger.warn('Fulfillment totals disagree with a live posting - left alone', {
        organizationId,
        orderInstanceId,
        fulfillmentId: fulfillment.id,
        storedSubtotalMinor: fulfillment.subtotalMinor,
        computedSubtotalMinor: subtotalMinor,
        storedTotalMinor: fulfillment.totalMinor,
        computedTotalMinor: totalMinor,
      })
      continue
    }

    const recordId = toRecordId(fulfillmentDefId, fulfillment.id)
    // No `userId` on the context: the hook chain does not fire, so a derived write
    // cannot re-enter the reconciler that produced it. Realtime is published below.
    await setValueWithType(context, {
      recordId,
      fieldId: subtotalField.id,
      fieldType: toFieldType(subtotalField.type),
      value: { type: 'number', value: subtotalMinor },
    })
    await setValueWithType(context, {
      recordId,
      fieldId: totalField.id,
      fieldType: toFieldType(totalField.type),
      value: { type: 'number', value: totalMinor },
    })
    await setValueWithType(context, {
      recordId,
      fieldId: shippingField.id,
      fieldType: toFieldType(shippingField.type),
      value: { type: 'boolean', value: shippingRecognised },
    })
    entries.push(
      {
        key: buildFieldValueKey(recordId, subtotalField.id as FieldId),
        value: { type: 'number', value: subtotalMinor },
      },
      {
        key: buildFieldValueKey(recordId, totalField.id as FieldId),
        value: { type: 'number', value: totalMinor },
      },
      {
        key: buildFieldValueKey(recordId, shippingField.id as FieldId),
        value: { type: 'boolean', value: shippingRecognised },
      }
    )
    fulfillmentsWritten++
    logger.info('Fulfillment totals stamped', {
      organizationId,
      orderInstanceId,
      fulfillmentId: fulfillment.id,
      subtotalMinor,
      taxMinor,
      shippingMinor,
      totalMinor,
    })
  }

  if (entries.length > 0) {
    publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch((err) => {
      logger.error('Failed to publish fulfillment totals', {
        organizationId,
        orderInstanceId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  return { fulfillmentsWritten, skippedPosted }
}
