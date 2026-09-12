// packages/lib/src/field-hooks/post/fulfillment-line-rollups.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { type StoredFieldType, toFieldType } from '../../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../../realtime'
import { unwrapRelationId } from '../../resources/events/captured-values'
import { StockMovementType } from '../../resources/registry/enum-values'
import type { EntityTriggerHandler } from '../types'

const logger = createScopedLogger('field-hooks:fulfillment-line-rollups')

/**
 * `fulfillment_line_quantity_relieved` (plans/money/tasks/50-batch-inventory-relief.md
 * §1) - the sell-side mirror of `purchase_order_line_quantity_received`:
 *
 * ```
 * buy    purchase_order_line -> receive movement -> purchase_order_line_quantity_received
 * sell   fulfillment_line    -> sale movement    -> fulfillment_line_quantity_relieved
 * ```
 *
 * `creatable: false, updatable: false, computed: true` on the registry - this
 * module is its ONLY writer, and it is re-SUMMED whole rather than incremented,
 * for the exact reason `purchase-order-line-rollups.ts`'s header states:
 * *"the subledger is the truth and a hand-maintained copy of it diverges
 * silently."*
 *
 * Two things this roll-up does that the buy side's does not, both load-bearing:
 *
 * 1. 🛑 **Scoped to `stock_movement_type = 'sale'`, never every movement
 *    pointing at the line.** `reverse-movement.ts`'s `REVERSAL_TYPE_BY_ORIGINAL`
 *    maps a reversed `sale` to `return_in` - the label brief 54 (returns) will
 *    also use for an actual customer return. Both kinds of row can carry this
 *    same `stock_movement_fulfillment_line` link. If a `return_in` row were
 *    counted here, a customer return would read as UN-relief and the next sync
 *    would relieve the same units a second time. The buy side has no equivalent
 *    hazard: nothing else points a `stock_movement` at a `purchase_order_line`.
 * 2. **The sign is flipped.** A `sale` movement's `stock_movement_quantity` is
 *    NEGATIVE - units leaving the shelf, the same sign `part_quantity_on_hand`
 *    sums. `quantity_relieved` is a POSITIVE count of units relieved, so the
 *    raw SUM (itself negative, or less negative once a correction nets against
 *    it) is negated before it is written or compared to the stored total.
 *
 * ⚠️ Like the buy side, this runs POST-COMMIT off the lifecycle record rules -
 * never inside the caller's transaction. The SUM reads the module-level
 * `database` connection and cannot see uncommitted rows, so a writer that
 * needs the roll-up to reflect its own transaction must use `skipEvents: true`
 * (or the quiet lane - see the brief §1.7) and call
 * {@link recalculateFulfillmentLineQuantityRelieved} / the batch form
 * explicitly after `COMMIT`.
 *
 * ⚠️ No edit door, deliberately, for the same reason the RECEIVED roll-up has
 * none: `stock_movement` declares every field `updatable: false`, and the only
 * legitimate correction is a new row (a reversal), which is a create the
 * lifecycle trigger already sees.
 *
 * Nothing writes a `sale` movement yet (`relieveFulfillmentLines` is a later
 * wave of this brief), so this hook is correct and dormant until that lands.
 */
const RELIEF_ATTRS = {
  /** The child entity whose rows are summed. */
  quantity: 'stock_movement_quantity' as SystemAttribute,
  /** What scopes the SUM to the relief lane's own rows. */
  type: 'stock_movement_type' as SystemAttribute,
  /** The movement's relationship field pointing at the fulfillment line. */
  lineRel: 'stock_movement_fulfillment_line' as SystemAttribute,
  /** The fulfillment line field the SUM is written to. */
  target: 'fulfillment_line_quantity_relieved' as SystemAttribute,
} as const

/** Test/caller convenience - the attribute names this module is built on. */
export const FULFILLMENT_LINE_RELIEF_ATTRS = RELIEF_ATTRS

/** The four fields this roll-up needs, or `undefined` when the org lacks one. */
interface RollupFields {
  quantityFieldId: string
  typeFieldId: string
  lineRelFieldId: string
  targetFieldId: string
  targetFieldType: StoredFieldType
}

async function resolveRollupFields(organizationId: string): Promise<RollupFields | undefined> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([
      RELIEF_ATTRS.quantity,
      RELIEF_ATTRS.type,
      RELIEF_ATTRS.lineRel,
      RELIEF_ATTRS.target,
    ])

  const quantityField = fields[RELIEF_ATTRS.quantity]
  const typeField = fields[RELIEF_ATTRS.type]
  const lineRelField = fields[RELIEF_ATTRS.lineRel]
  const targetField = fields[RELIEF_ATTRS.target]

  if (!quantityField || !typeField || !lineRelField || !targetField) {
    logger.warn('Missing custom fields for fulfillment line relief roll-up', {
      quantityField: !!quantityField,
      typeField: !!typeField,
      lineRelField: !!lineRelField,
      targetField: !!targetField,
    })
    return undefined
  }

  return {
    quantityFieldId: quantityField.id,
    typeFieldId: typeField.id,
    lineRelFieldId: lineRelField.id,
    targetFieldId: targetField.id,
    targetFieldType: targetField.type,
  }
}

/** The line's stored roll-up total, as an uncorrelated scalar subquery. */
function storedTotalSql(
  organizationId: string,
  fulfillmentLineInstanceId: string,
  targetFieldId: string
) {
  return sql<number | null>`(SELECT fv_target."valueNumber" FROM "FieldValue" fv_target
    WHERE fv_target."entityId" = ${fulfillmentLineInstanceId}
      AND fv_target."fieldId" = ${targetFieldId}
      AND fv_target."organizationId" = ${organizationId}
    LIMIT 1)`
}

/** One realtime publish for however many roll-up values just landed. */
function publishRollupValues(
  organizationId: string,
  values: Array<{ recordId: RecordId; fieldId: string; total: number }>
): Promise<unknown> {
  const entries: FieldValueUpdateEntry[] = values.map((value) => ({
    key: buildFieldValueKey(value.recordId, value.fieldId as FieldId),
    value: { type: 'number', value: value.total },
  }))
  return publishFieldValueUpdates(getRealtimeService(), organizationId, entries)
}

/**
 * Re-SUM `fulfillment_line_quantity_relieved` for one fulfillment line and
 * write the result.
 *
 * Exported so a writer that needs the roll-up to reflect its own transaction
 * (the future `relieveFulfillmentLines`) can call it explicitly after `COMMIT`
 * rather than waiting for the lifecycle rule.
 *
 * ⚡ Reads the stored total in the same statement as the SUM and returns early
 * when they agree, exactly as the buy side does - a no-op write here still
 * fires the field-hook chain and a realtime publish, so short-circuiting it is
 * what makes a batched sync cheap.
 */
export async function recalculateFulfillmentLineQuantityRelieved(
  organizationId: string,
  fulfillmentLineInstanceId: string
): Promise<void> {
  const fields = await resolveRollupFields(organizationId)
  if (!fields) return

  // Three-way join, the buy side's shape plus the type scope: SUM the
  // movement's quantity where its fulfillment-line relationship points at
  // this line AND its type is 'sale'. `return_in` (a reversal of a sale, or a
  // future customer return) is excluded by the INNER JOIN condition itself,
  // not filtered after the fact - a movement of any other type never even
  // reaches the SUM.
  const [sumRow] = await database
    .select({
      total: sql<string>`COALESCE(SUM(${schema.FieldValue.valueNumber}), 0)`,
      current: storedTotalSql(organizationId, fulfillmentLineInstanceId, fields.targetFieldId),
    })
    .from(schema.FieldValue)
    .innerJoin(
      sql`"FieldValue" fv_line`,
      sql`${schema.FieldValue.entityId} = fv_line."entityId"
        AND fv_line."fieldId" = ${fields.lineRelFieldId}
        AND fv_line."relatedEntityId" = ${fulfillmentLineInstanceId}
        AND fv_line."organizationId" = ${organizationId}`
    )
    .innerJoin(
      sql`"FieldValue" fv_type`,
      sql`${schema.FieldValue.entityId} = fv_type."entityId"
        AND fv_type."fieldId" = ${fields.typeFieldId}
        AND fv_type."organizationId" = ${organizationId}
        AND fv_type."optionId" = ${StockMovementType.SALE}`
    )
    .where(
      and(
        eq(schema.FieldValue.fieldId, fields.quantityFieldId),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )

  // The raw SUM is negative (or less negative, once a correction nets against
  // it) because a `sale` movement's quantity is negative. `quantity_relieved`
  // is a positive count of units relieved, so it is the NEGATION of the sum.
  // 🛑 `|| 0` normalizes `-0` (a net-zero SUM negates to `-0` in JS) back to a
  // plain `0` - `-0 === 0` arithmetically but not under `Object.is`/deep-equal,
  // and a `-0` stored value would compare unequal to itself on every future run.
  const relieved = -Number(sumRow?.total ?? 0) || 0
  const stored = sumRow?.current

  // 🛑 Fail SAFE, same as the buy side: only a value we actually read and that
  // actually matches skips the write. An absent or unreadable stored total
  // falls through and writes.
  if (stored != null && Number(stored) === relieved) {
    logger.debug('Fulfillment line relief roll-up unchanged - nothing written', {
      fulfillmentLineInstanceId,
      relieved,
    })
    return
  }

  const lineDefId = await requireCachedEntityDefId(organizationId, 'fulfillment_line')
  const recordId = toRecordId(lineDefId, fulfillmentLineInstanceId) as RecordId

  await setValueWithType(createFieldValueContext(organizationId), {
    recordId,
    fieldId: fields.targetFieldId,
    fieldType: toFieldType(fields.targetFieldType),
    value: { type: 'number', value: relieved },
  })

  publishRollupValues(organizationId, [
    { recordId, fieldId: fields.targetFieldId, total: relieved },
  ]).catch((err) => {
    logger.error('Failed to publish fulfillment line relief roll-up', {
      fulfillmentLineInstanceId,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  logger.info('Fulfillment line relief roll-up recalculated', {
    fulfillmentLineInstanceId,
    relieved,
  })
}

/**
 * SUM the SALE-type movement quantities for every fulfillment line in the set,
 * grouped by line. One statement for the whole set - a line with no `sale`
 * movements is simply absent from the result and reads as zero at the call
 * site, exactly as `purchase-order-line-rollups.ts`'s `readTotalsByLine` does.
 */
async function readTotalsByLine(
  organizationId: string,
  lineIds: string[],
  fields: RollupFields
): Promise<Map<string, number>> {
  const idList = sql.join(
    lineIds.map((id) => sql`${id}`),
    sql`, `
  )

  const rows = await database
    .select({
      lineId: sql<string>`fv_line."relatedEntityId"`,
      total: sql<string>`COALESCE(SUM(${schema.FieldValue.valueNumber}), 0)`,
    })
    .from(schema.FieldValue)
    .innerJoin(
      sql`"FieldValue" fv_line`,
      sql`${schema.FieldValue.entityId} = fv_line."entityId"
        AND fv_line."fieldId" = ${fields.lineRelFieldId}
        AND fv_line."relatedEntityId" IN (${idList})
        AND fv_line."organizationId" = ${organizationId}`
    )
    .innerJoin(
      sql`"FieldValue" fv_type`,
      sql`${schema.FieldValue.entityId} = fv_type."entityId"
        AND fv_type."fieldId" = ${fields.typeFieldId}
        AND fv_type."organizationId" = ${organizationId}
        AND fv_type."optionId" = ${StockMovementType.SALE}`
    )
    .where(
      and(
        eq(schema.FieldValue.fieldId, fields.quantityFieldId),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )
    .groupBy(sql`fv_line."relatedEntityId"`)

  // Negated per line here, once, rather than at every call site below. `|| 0`
  // normalizes `-0` the same way the single-line function does.
  return new Map(rows.map((row) => [row.lineId, -Number(row.total ?? 0) || 0]))
}

/** The stored roll-up total of every line in the set, keyed by line. */
async function readStoredTotals(
  organizationId: string,
  lineIds: string[],
  targetFieldId: string
): Promise<Map<string, number>> {
  const rows = await database
    .select({
      entityId: schema.FieldValue.entityId,
      valueNumber: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.entityId, lineIds),
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, targetFieldId)
      )
    )

  const stored = new Map<string, number>()
  for (const row of rows) {
    if (row.valueNumber != null) stored.set(row.entityId, Number(row.valueNumber))
  }
  return stored
}

/**
 * The same roll-up for a SET of fulfillment lines, in two queries - the
 * `recalculatePurchaseOrderLineRollups` shape. Exists for the same reason:
 * the future `relieveFulfillmentLines` will write dozens of `sale` movements
 * in one sync, and firing the per-line function once per movement would run
 * dozens of full re-SUMs where one grouped query and one grouped read suffice.
 *
 * ⚠️ It does not suppress anything. The per-movement lifecycle rule still
 * fires afterwards for each movement it fanned out to; it simply finds each
 * line's total already correct and returns before writing (see
 * {@link recalculateFulfillmentLineQuantityRelieved}). A batch call that never
 * runs just leaves the slower per-movement path to produce the same answer.
 *
 * ⚠️ POST-COMMIT only, like the single-line form: the SUM runs on the
 * module-level `database` connection and cannot see a caller's open
 * transaction.
 */
export async function recalculateFulfillmentLineQuantityRelievedBatch(
  organizationId: string,
  fulfillmentLineInstanceIds: string[]
): Promise<void> {
  const lineIds = [...new Set(fulfillmentLineInstanceIds)].filter(Boolean)
  if (lineIds.length === 0) return
  if (lineIds.length === 1) {
    await recalculateFulfillmentLineQuantityRelieved(organizationId, lineIds[0]!)
    return
  }

  const fields = await resolveRollupFields(organizationId)
  if (!fields) return

  const [relievedByLine, stored] = await Promise.all([
    readTotalsByLine(organizationId, lineIds, fields),
    readStoredTotals(organizationId, lineIds, fields.targetFieldId),
  ])

  const lineDefId = await requireCachedEntityDefId(organizationId, 'fulfillment_line')
  const ctx = createFieldValueContext(organizationId)
  const published: Array<{ recordId: RecordId; fieldId: string; total: number }> = []

  for (const lineId of lineIds) {
    // A line with no `sale` movements sums to zero, exactly as the per-line
    // SUM does.
    const relieved = relievedByLine.get(lineId) ?? 0
    const current = stored.get(lineId)
    if (current != null && current === relieved) continue

    const recordId = toRecordId(lineDefId, lineId) as RecordId
    await setValueWithType(ctx, {
      recordId,
      fieldId: fields.targetFieldId,
      fieldType: toFieldType(fields.targetFieldType),
      value: { type: 'number', value: relieved },
    })
    published.push({ recordId, fieldId: fields.targetFieldId, total: relieved })
  }

  if (published.length === 0) return

  publishRollupValues(organizationId, published).catch((err) => {
    logger.error('Failed to publish batched fulfillment line relief roll-up', {
      error: err instanceof Error ? err.message : String(err),
    })
  })

  logger.info('Fulfillment line relief roll-ups recalculated in batch', {
    lineCount: lineIds.length,
    changedCount: published.length,
  })
}

/**
 * Re-SUM `fulfillment_line_quantity_relieved` after a stock movement
 * create/delete. Registered as a native handler off the `mfg-stock-movements-
 * created` / `mfg-stock-movements-deleted` system rules, beside the RECEIVED
 * roll-up - see `system-entity-rules.ts`.
 *
 * Resolves the affected fulfillment line from the threaded event values
 * first, falling back to the movement's own field value - the create path has
 * the row, the delete path only has the values (the same fallback
 * `purchase-order-line-rollups.ts`'s trigger uses, for the same reason).
 *
 * A movement with no fulfillment line is the common case (a receipt, an
 * adjustment, a build movement) and is a silent no-op, not a warning.
 */
export const recalculateFulfillmentLineRelieved: EntityTriggerHandler = async (event) => {
  const { organizationId, entityInstanceId, values } = event

  let lineInstanceId = unwrapRelationId(values[RELIEF_ATTRS.lineRel])

  if (!lineInstanceId) {
    const [row] = await database
      .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, RELIEF_ATTRS.lineRel)
        )
      )
      .limit(1)
    lineInstanceId = row?.relatedEntityId ?? undefined
  }

  if (!lineInstanceId) return

  await recalculateFulfillmentLineQuantityRelieved(organizationId, lineInstanceId)
}
