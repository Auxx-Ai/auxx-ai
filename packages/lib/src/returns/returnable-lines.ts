// packages/lib/src/returns/returnable-lines.ts

/**
 * The read behind "Add from order" (plans/money/tasks/56-return-lines-on-the-line-grid.md
 * section 4.6): every `line_item` sold on an order, with the same ceiling and
 * claim total the over-return guard itself is built from, so the sheet offers
 * exactly what a create would accept - never a looser or a stricter number
 * derived a second way.
 *
 * Reads only, same as `reads.ts` and for the same reason (`docs/lib-module-guide.md`
 * section 5). No permission checks: the router asserts.
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { type RecordId, toRecordId } from '../resources/resource-id'
import { guard } from './guard'
import { readReturnCeiling, readReturnedQuantityClaims } from './reads'

/** The `line_item` attributes this read needs, resolved once per call. */
interface LineItemFields {
  orderFieldId: string
  nameFieldId: string | null
  partFieldId: string | null
  qtyFieldId: string | null
  sortOrderFieldId: string | null
}

/** One sold line on an order, with what it may still return. */
export interface ReturnableLine {
  lineItemId: string
  recordId: RecordId
  /** The sold line's display name, or null. */
  name: string | null
  partId: string | null
  partName: string | null
  quantitySold: number | null
  /** Same semantics as `ReturnableQuantity`: null when nothing records what left. */
  ceiling: number | null
  alreadyReturned: number
  remaining: number | null
  ceilingSource: 'shipped' | 'sold' | 'unknown'
}

/**
 * Every `line_item` on one order, in the order's own line sort
 * (`line_item_sort_order` when the field is provisioned, else `createdAt`
 * ascending), each carrying the same ceiling {@link readReturnCeiling} computes
 * and the same claim total {@link readReturnedQuantityClaims} sums.
 *
 * 🛑 `ceilingSource: 'unknown'` carries `ceiling: null, remaining: null`. Never
 * zero, never blocking (plan section 4.6, the de-dup regression 54 already
 * fixed): a line with neither shipped nor sold data recorded is not the same
 * as a line that shipped nothing, and the sheet must still offer it.
 *
 * One query loads the order's lines and one batched query loads their parts'
 * display names. {@link readReturnCeiling} and {@link readReturnedQuantityClaims}
 * then run per line - both ARE the over-return guard's own logic, reused
 * rather than re-derived, and an order carries a handful of lines - so this is
 * up to `2 + 3N` queries for `N` lines, not one.
 *
 * Returns an empty list rather than refusing when the order has no line
 * items, or when the org has no `line_item.order` field or `line_item`
 * definition yet: both are "nothing to offer", not failures.
 */
export async function readReturnableLinesForOrder(
  db: Database,
  organizationId: string,
  orderId: string
): Promise<Result<ReturnableLine[], Error>> {
  return guard(
    async () => {
      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([
          'line_item_order',
          'line_item_name',
          'line_item_part',
          'line_item_qty',
          'line_item_sort_order',
        ] as const)

      const orderField = fields.line_item_order
      const lineItemDefId = await getCachedEntityDefId(organizationId, 'line_item')
      if (!orderField || !lineItemDefId) return []

      const lineFields: LineItemFields = {
        orderFieldId: orderField.id,
        nameFieldId: fields.line_item_name?.id ?? null,
        partFieldId: fields.line_item_part?.id ?? null,
        qtyFieldId: fields.line_item_qty?.id ?? null,
        sortOrderFieldId: fields.line_item_sort_order?.id ?? null,
      }

      // A plain instance query, exactly the `readReturnLinesByReturn` shape:
      // no alias columns in the `select`, so no join has to exist before this
      // line typechecks. The lines' own attributes are hydrated afterward, one
      // batched value read, the same reason `hydrateReturns` does it that way.
      const orderValue = alias(schema.FieldValue, 'rl_li_order_v')
      const rows = await db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .innerJoin(
          orderValue,
          and(
            valueJoin(orderValue, lineFields.orderFieldId),
            eq(orderValue.relatedEntityId, orderId)
          )
        )
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, lineItemDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .orderBy(asc(schema.EntityInstance.createdAt))

      if (rows.length === 0) return []

      const values = await readLineItemValues(
        db,
        organizationId,
        rows.map((row) => row.id),
        lineFields
      )

      // Sort by `line_item_sort_order` when the org has it; otherwise the
      // `createdAt` order the query already produced stands. A row with no
      // sort value of its own sorts after every row that has one, so a
      // half-migrated order still reads in a sensible order rather than
      // scrambled by `undefined` comparisons.
      const ordered = lineFields.sortOrderFieldId
        ? [...rows].sort((a, b) => {
            const sortA = values.get(a.id)?.sortOrder
            const sortB = values.get(b.id)?.sortOrder
            if (sortA == null && sortB == null) return 0
            if (sortA == null) return 1
            if (sortB == null) return -1
            return sortA - sortB
          })
        : rows

      const partIds = ordered
        .map((row) => values.get(row.id)?.partId ?? null)
        .filter((id): id is string => id != null)
      const partNames = await readPartNames(db, organizationId, partIds)

      const lines: ReturnableLine[] = []
      for (const row of ordered) {
        const value = values.get(row.id)
        const { ceiling, ceilingSource } = await readReturnCeiling(db, organizationId, row.id)
        const claims = await readReturnedQuantityClaims(db, organizationId, row.id)
        const alreadyReturned = claims.reduce((total, claim) => total + claim.quantity, 0)
        const partId = value?.partId ?? null

        lines.push({
          lineItemId: row.id,
          recordId: toRecordId(lineItemDefId, row.id),
          name: value?.name ?? null,
          partId,
          partName: partId ? (partNames.get(partId) ?? null) : null,
          quantitySold: value?.quantitySold ?? null,
          ceiling,
          alreadyReturned,
          remaining: ceiling === null ? null : Math.max(0, ceiling - alreadyReturned),
          ceilingSource,
        })
      }
      return lines
    },
    'Failed to read returnable lines for order',
    { organizationId, orderId }
  )
}

/** One line item's hydrated attributes, keyed by field id lookups already resolved. */
interface LineItemValue {
  name: string | null
  partId: string | null
  quantitySold: number | null
  sortOrder: number | null
}

/**
 * `line_item.id -> its name / part / quantity / sort-order values`, in one
 * query, the same reasoning as `readValues` in `reads.ts`: a join per
 * attribute on the paging query multiplies the row count, and this module has
 * no `readValues` of its own to reuse since `line_item` is not a `return*`
 * definition.
 */
async function readLineItemValues(
  db: Database,
  organizationId: string,
  lineItemIds: string[],
  fields: LineItemFields
): Promise<Map<string, LineItemValue>> {
  const index = new Map<string, LineItemValue>()
  if (lineItemIds.length === 0) return index

  const fieldIds = [
    fields.nameFieldId,
    fields.partFieldId,
    fields.qtyFieldId,
    fields.sortOrderFieldId,
  ].filter((id): id is string => id != null)
  if (fieldIds.length === 0) return index

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, lineItemIds),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  for (const lineItemId of lineItemIds) {
    index.set(lineItemId, { name: null, partId: null, quantitySold: null, sortOrder: null })
  }
  for (const row of rows) {
    const value = index.get(row.entityId)
    if (!value) continue
    if (row.fieldId === fields.nameFieldId) value.name = row.valueText
    if (row.fieldId === fields.partFieldId) value.partId = row.relatedEntityId
    if (row.fieldId === fields.qtyFieldId) value.quantitySold = row.valueNumber
    if (row.fieldId === fields.sortOrderFieldId) value.sortOrder = row.valueNumber
  }
  return index
}

/** `partId -> part_title`, for every part in the list, in one query. */
async function readPartNames(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (partIds.length === 0) return names

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['part_title'] as const)
  const titleField = fields.part_title
  if (!titleField) return names

  const rows = await db
    .select({ partId: schema.FieldValue.entityId, title: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, titleField.id),
        inArray(schema.FieldValue.entityId, [...new Set(partIds)])
      )
    )

  for (const row of rows) {
    if (row.title != null) names.set(row.partId, row.title)
  }
  return names
}

/** An aliased `FieldValue` table, as `alias()` returns it. */
type FieldValueAlias = ReturnType<typeof alias<typeof schema.FieldValue, string>>

/**
 * Join predicate for "this instance's value of <field>".
 *
 * Copied from `reads.ts` rather than imported: it is not exported there, and
 * duplicating three lines is cheaper than widening that module's surface for
 * one caller.
 */
function valueJoin(table: FieldValueAlias, fieldId: string): SQL | undefined {
  return and(
    eq(table.entityId, schema.EntityInstance.id),
    eq(table.organizationId, schema.EntityInstance.organizationId),
    eq(table.fieldId, fieldId)
  )
}
