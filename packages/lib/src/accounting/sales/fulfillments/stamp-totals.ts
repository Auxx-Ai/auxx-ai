// packages/lib/src/accounting/sales/fulfillments/stamp-totals.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId, toResourceFieldId } from '@auxx/types/field'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { requireCachedEntityDefId } from '../../../cache'
import { createFieldValueContext } from '../../../field-values/field-value-helpers'
import { setValueWithType } from '../../../field-values/field-value-mutations'
import { toFieldType } from '../../../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
  publishRecordsChanged,
} from '../../../realtime'
import { toRecordId } from '../../../resources/resource-id'
import { systemFieldMap } from '../../../resources/system-records'
import { wakeTotalsNotStamped } from '../../work-items/wake'
import { readOrderForFulfillment } from '../orders/reads'
import { resolveOrderShipments } from './shipment-lines'

const logger = createScopedLogger('sales:fulfillment-totals')

const TOTALS_ATTRS = [
  'fulfillment_subtotal',
  'fulfillment_total',
  'fulfillment_shipping_recognised',
] as const

/** Fulfillments a batch of stamps wrote, announced once by {@link publishStampBatch}. */
export interface StampBatch {
  fulfillmentDefId?: string
  /** Client fieldRefKeys (`${defId}:${fieldId}`) of the stamped totals fields. */
  fieldRefKeys: Set<string>
  fulfillmentIds: Set<string>
}

export function createStampBatch(): StampBatch {
  return { fieldRefKeys: new Set(), fulfillmentIds: new Set() }
}

/** One `records:changed` for everything the batch stamped. Fire-and-forget. */
export function publishStampBatch(organizationId: string, batch: StampBatch): void {
  const { fulfillmentDefId, fieldRefKeys, fulfillmentIds } = batch
  if (!fulfillmentDefId || fulfillmentIds.size === 0) return
  const fieldIds = [...fieldRefKeys]
  try {
    publishRecordsChanged(getRealtimeService(), organizationId, {
      entityDefinitionId: fulfillmentDefId,
      entries: [...fulfillmentIds].map((recordId) => ({ recordId, fieldIds })),
    }).catch((err) => {
      logger.error('Failed to publish fulfillment totals batch', {
        organizationId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  } catch {
    // `getRealtimeService()` throws synchronously without transport config; best effort.
  }
}

/**
 * Stamp every fulfillment's totals on one order, walking them in sequence so the
 * cumulative tax prior is right (plan 78 §4.1). A cancelled one keeps its subtotal
 * with tax and shipping at 0 (§7.1a); a posted one that disagrees is skipped.
 * With `batch`, the stamp records into it instead of publishing per order.
 */
export async function stampOrderShipmentTotals(
  db: Database,
  organizationId: string,
  orderInstanceId: string,
  opts: { batch?: StampBatch } = {}
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
  const context = createFieldValueContext(organizationId, undefined, db)
  const entries: FieldValueUpdateEntry[] = []
  let fulfillmentsWritten = 0
  let skippedPosted = 0
  const stampedIds: string[] = []

  // The tax prior is cumulative, so the walk must follow sequence, not read order.
  for (const shipment of resolveOrderShipments(order)) {
    const { fulfillment, subtotalMinor, taxMinor, shippingMinor, totalMinor, shippingRecognised } =
      shipment
    for (const lineItemId of shipment.unmatchedLineItemIds) {
      logger.warn('Fulfillment line has no matching order line', {
        organizationId,
        orderInstanceId,
        fulfillmentId: fulfillment.id,
        lineItemId,
      })
    }

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
    stampedIds.push(fulfillment.id)
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

  // The shipments parked on these totals are due now; the reconciler path lands here too.
  await wakeTotalsNotStamped(db, organizationId, { fulfillmentIds: stampedIds })

  if (opts.batch && stampedIds.length > 0) {
    opts.batch.fulfillmentDefId = fulfillmentDefId
    for (const field of [subtotalField, totalField, shippingField]) {
      opts.batch.fieldRefKeys.add(toResourceFieldId(fulfillmentDefId, field.id))
    }
    for (const id of stampedIds) opts.batch.fulfillmentIds.add(id)
  } else if (entries.length > 0) {
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
