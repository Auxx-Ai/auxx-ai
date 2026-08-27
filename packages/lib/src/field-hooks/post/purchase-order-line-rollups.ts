// packages/lib/src/field-hooks/post/purchase-order-line-rollups.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, sql } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import { getRealtimeService, publishFieldValueUpdates } from '../../realtime'
import type { EntityTriggerHandler } from '../types'

const logger = createScopedLogger('field-hooks:purchase-order-line-rollups')

/**
 * The two subledger roll-ups a purchase order line carries
 * (plans/purchasing/01-build-plan.md §4.2). Both are `creatable: false`,
 * `updatable: false`, `computed: true` — this module is their ONLY writer.
 *
 * They are re-SUMMED whole rather than incremented, for the same reason
 * `part_quantity_on_hand` is: the subledger is the truth and a hand-maintained
 * copy of it diverges silently.
 *
 * ⚠️ Both run POST-COMMIT, off the lifecycle record rules — never inside the
 * caller's transaction. Like `recalculatePartQoH`, the SUM below runs against the
 * module-level `database` connection and cannot see uncommitted rows, so a
 * writer must use `skipEvents: true` and call the recalculation explicitly after
 * `COMMIT` if it needs the roll-up to include its own write.
 */
interface RollupSpec {
  /** The child entity whose rows are summed. */
  childEntityType: string
  /** The child's numeric field that is summed. */
  quantityAttr: SystemAttribute
  /** The child's relationship field pointing at the purchase order line. */
  lineRelAttr: SystemAttribute
  /** The purchase order line field the SUM is written to. */
  targetAttr: SystemAttribute
}

/** Receipts: SUM(`stock_movement_quantity`) over the movements pointing at the line. */
const RECEIVED_ROLLUP: RollupSpec = {
  childEntityType: 'stock_movement',
  quantityAttr: 'stock_movement_quantity',
  lineRelAttr: 'stock_movement_purchase_order_line',
  targetAttr: 'purchase_order_line_quantity_received',
}

/** Bills: SUM(`vendor_bill_line_quantity_billed`) over the bill lines pointing at the line. */
const BILLED_ROLLUP: RollupSpec = {
  childEntityType: 'vendor_bill_line',
  quantityAttr: 'vendor_bill_line_quantity_billed',
  lineRelAttr: 'vendor_bill_line_purchase_order_line',
  targetAttr: 'purchase_order_line_quantity_billed',
}

/**
 * Re-SUM one roll-up for one purchase order line and write the result.
 *
 * Exported so a writer that needs the roll-up to reflect its own transaction can
 * call it explicitly after `COMMIT` rather than waiting for the lifecycle rule.
 */
export async function recalculatePurchaseOrderLineRollup(
  organizationId: string,
  purchaseOrderLineInstanceId: string,
  spec: RollupSpec
): Promise<void> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([spec.quantityAttr, spec.lineRelAttr, spec.targetAttr])

  const quantityField = fields[spec.quantityAttr]
  const lineRelField = fields[spec.lineRelAttr]
  const targetField = fields[spec.targetAttr]

  if (!quantityField || !lineRelField || !targetField) {
    logger.warn('Missing custom fields for purchase order line roll-up', {
      target: spec.targetAttr,
      quantityField: !!quantityField,
      lineRelField: !!lineRelField,
      targetField: !!targetField,
    })
    return
  }

  // Single self-join, the `recalculateQoHForPart` shape: SUM the child's quantity
  // where the child's line relationship points at this line.
  const [sumRow] = await database
    .select({ total: sql<string>`COALESCE(SUM(${schema.FieldValue.valueNumber}), 0)` })
    .from(schema.FieldValue)
    .innerJoin(
      sql`"FieldValue" fv_line`,
      sql`${schema.FieldValue.entityId} = fv_line."entityId"
        AND fv_line."fieldId" = ${lineRelField.id}
        AND fv_line."relatedEntityId" = ${purchaseOrderLineInstanceId}
        AND fv_line."organizationId" = ${organizationId}`
    )
    .where(
      and(
        eq(schema.FieldValue.fieldId, quantityField.id),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )

  const total = Number(sumRow?.total ?? 0)

  const lineDefId = await requireCachedEntityDefId(organizationId, 'purchase_order_line')
  const recordId = toRecordId(lineDefId, purchaseOrderLineInstanceId) as RecordId

  await setValueWithType(createFieldValueContext(organizationId), {
    recordId,
    fieldId: targetField.id,
    fieldType: toFieldType(targetField.type),
    value: { type: 'number', value: total },
  })

  publishFieldValueUpdates(getRealtimeService(), organizationId, [
    {
      key: buildFieldValueKey(recordId, targetField.id as FieldId),
      value: { type: 'number', value: total },
    },
  ]).catch((err) => {
    logger.error('Failed to publish purchase order line roll-up', {
      purchaseOrderLineInstanceId,
      target: spec.targetAttr,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  logger.info('Purchase order line roll-up recalculated', {
    purchaseOrderLineInstanceId,
    target: spec.targetAttr,
    total,
  })
}

/**
 * Build the create/delete trigger for one roll-up. Resolves the affected purchase
 * order line from the threaded event values first, falling back to the child's own
 * field values — the create path has the row, the delete path only has the values.
 *
 * A child with no purchase order line is the common case (a manual stock adjustment,
 * a freight-only bill line) and is a silent no-op, not a warning.
 */
function buildRollupTrigger(spec: RollupSpec): EntityTriggerHandler {
  return async (event) => {
    const { organizationId, entityInstanceId, values } = event

    let lineInstanceId = extractRelatedEntityId(values, spec.lineRelAttr)

    if (!lineInstanceId) {
      const [row] = await database
        .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
        .from(schema.FieldValue)
        .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
        .where(
          and(
            eq(schema.FieldValue.entityId, entityInstanceId),
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.CustomField.systemAttribute, spec.lineRelAttr)
          )
        )
        .limit(1)
      lineInstanceId = row?.relatedEntityId ?? undefined
    }

    if (!lineInstanceId) return

    await recalculatePurchaseOrderLineRollup(organizationId, lineInstanceId, spec)
  }
}

/** Re-SUM `purchase_order_line_quantity_received` after a stock movement create/delete. */
export const recalculatePurchaseOrderLineReceived: EntityTriggerHandler =
  buildRollupTrigger(RECEIVED_ROLLUP)

/** Re-SUM `purchase_order_line_quantity_billed` after a vendor bill line create/delete. */
export const recalculatePurchaseOrderLineBilled: EntityTriggerHandler =
  buildRollupTrigger(BILLED_ROLLUP)

/** Test/caller convenience: the two specs, so an explicit post-commit call can name one. */
export const PURCHASE_ORDER_LINE_ROLLUPS = {
  received: RECEIVED_ROLLUP,
  billed: BILLED_ROLLUP,
} as const

/**
 * Extract a related entity id from threaded event values. Values may be keyed by
 * systemAttribute or by field id, and a relationship value may be a bare instance id
 * or a `defId:instanceId` RecordId.
 */
function extractRelatedEntityId(
  values: Record<string, unknown>,
  systemAttribute: string
): string | undefined {
  const value = values[systemAttribute]
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value.includes(':') ? parseRecordId(value as RecordId).entityInstanceId : value
}
