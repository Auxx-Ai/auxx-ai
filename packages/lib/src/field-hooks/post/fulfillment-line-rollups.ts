// packages/lib/src/field-hooks/post/fulfillment-line-rollups.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
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
import { StockMovementType } from '../../resources/registry/enum-values'

const logger = createScopedLogger('field-hooks:fulfillment-line-rollups')

/**
 * `fulfillment_line_quantity_relieved` (plans/money/tasks/50-batch-inventory-relief.md §1), the
 * sell-side mirror of `purchase_order_line_quantity_received`. This module is its ONLY writer, and
 * it re-SUMs whole rather than incrementing.
 *
 * 🛑 Scoped to `type = 'sale'`: a reversed sale is `return_in` (as is a customer return) and must
 * never read as un-relief, or the next sync relieves the same units again. The sign is flipped: a
 * `sale` quantity is negative and `quantity_relieved` is a positive count.
 *
 * POST-COMMIT only: the SUM reads the module-level `database` connection, so the movement seam
 * calls it from `settleStockMovements` after commit.
 */
const TARGET_ATTR = 'fulfillment_line_quantity_relieved' as SystemAttribute

/** The target field, or `undefined` when the org lacks it. */
interface RollupFields {
  targetFieldId: string
  targetFieldType: StoredFieldType
}

async function resolveRollupFields(organizationId: string): Promise<RollupFields | undefined> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([TARGET_ATTR])
  const targetField = fields[TARGET_ATTR]
  if (!targetField) {
    logger.warn('Missing custom fields for fulfillment line relief roll-up', { targetField: false })
    return undefined
  }
  return { targetFieldId: targetField.id, targetFieldType: targetField.type }
}

/** `sale` movements of these lines. */
function saleRowsOf(organizationId: string, lineIds: string[]) {
  const t = schema.StockMovement
  return and(
    eq(t.organizationId, organizationId),
    inArray(t.fulfillmentLineId, lineIds),
    eq(t.type, StockMovementType.SALE)
  )
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

  const t = schema.StockMovement
  const [sumRow] = await database
    .select({
      total: sql<string>`COALESCE(SUM(${t.quantity}), 0)`,
      current: storedTotalSql(organizationId, fulfillmentLineInstanceId, fields.targetFieldId),
    })
    .from(t)
    .where(saleRowsOf(organizationId, [fulfillmentLineInstanceId]))

  // `|| 0` normalizes the `-0` a net-zero SUM negates to, which would never compare equal again.
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
  db: Database | Transaction,
  organizationId: string,
  lineIds: string[]
): Promise<Map<string, number>> {
  const t = schema.StockMovement
  const rows = await db
    .select({ lineId: t.fulfillmentLineId, total: sql<string>`COALESCE(SUM(${t.quantity}), 0)` })
    .from(t)
    .where(saleRowsOf(organizationId, lineIds))
    .groupBy(t.fulfillmentLineId)
  return new Map(rows.map((row) => [row.lineId as string, -Number(row.total ?? 0) || 0]))
}

/**
 * What the `sale` movements say each line has relieved, on the caller's connection - so a
 * transaction sees its own and every committed run's rows. A line with none reads as absent.
 */
export async function readRelievedQuantities(
  db: Database | Transaction,
  organizationId: string,
  lineIds: string[]
): Promise<Map<string, number>> {
  const ids = [...new Set(lineIds)].filter(Boolean)
  if (ids.length === 0) return new Map()
  return readTotalsByLine(db, organizationId, ids)
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
    readTotalsByLine(database, organizationId, lineIds),
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
