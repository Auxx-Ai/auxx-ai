// packages/lib/src/builds/auto-build-queries.ts

/**
 * Every READ the order-triggered auto-build needs: an order's business date, its
 * cancellation stamp, the parts its lines reach, and what is on the shelf.
 *
 * plans/products/12-order-triggered-build.md section 5.3 steps 1-4.
 *
 * Reads only — the writes live in `auto-build.ts`, because a file that both
 * queries and mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` section 5). No permission checks anywhere: this
 * runs with no human present and the rule engine is not an authorization
 * surface (section 6).
 *
 * 🛑 **AB3 — every read here is on the NATIVE `order` / `line_item`, never
 * `shopify_orders`.** Only a native `line_item` carries `line_item_part`;
 * `shopify_line_items` carries a `variant` reference, which is a different
 * keyspace that reaches a part only through a hop that is 0 of 26 and stays
 * that way (products/08 section 6.3).
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import type { AutoBuildLine } from './auto-build-policy'

/** The order fields the trigger reads. Both optional — migration 109 provisions them. */
const ORDER_ATTRIBUTES = ['order_placed_at', 'order_cancelled_at'] as const

/** The line fields the trigger reads. All three required for a line to be usable. */
const LINE_ATTRIBUTES = ['line_item_order', 'line_item_part', 'line_item_qty'] as const

/** One order, reduced to what section 5.3 actually decides on. */
export interface AutoBuildOrder {
  /** `EntityInstance.id` of the `order`. */
  orderId: string
  /**
   * `order_placed_at`, falling back to the row's `createdAt`.
   *
   * The fallback matters: AB8 compares the order's BUSINESS date against the
   * enablement stamp, and an order typed by hand in auxx may carry no placed
   * date at all. Falling back to when the row was made keeps such an order
   * inside the window rather than silently dropping it.
   */
  placedAt: Date
  /** `order_cancelled_at`. Non-null means the order arrived (or is) cancelled. */
  cancelledAt: Date | null
  /** One entry per line that reaches a part. Lines with no part are already dropped. */
  lines: AutoBuildLine[]
}

/**
 * Load the orders in this batch, with their lines.
 *
 * Returns an entry per order that exists, is this org's, and is not archived —
 * an id that resolves to nothing is simply absent rather than an error, because
 * a lifecycle rule can be dispatched for a record a later write has since
 * removed.
 *
 * Four queries regardless of batch size. An org missing the `order` def, the
 * `line_item` def or any of the three line fields yields an empty list: there
 * is nothing to build from, and refusing loudly would turn every order create
 * in an unmigrated org into a logged failure.
 */
export async function loadAutoBuildOrders(
  db: Database,
  organizationId: string,
  orderIds: string[]
): Promise<AutoBuildOrder[]> {
  if (orderIds.length === 0) return []

  const [orderDefId, lineDefId] = await Promise.all([
    getCachedEntityDefId(organizationId, 'order'),
    getCachedEntityDefId(organizationId, 'line_item'),
  ])
  if (!orderDefId || !lineDefId) return []

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...ORDER_ATTRIBUTES, ...LINE_ATTRIBUTES])

  const lineOrderField = fields.line_item_order
  const linePartField = fields.line_item_part
  const lineQtyField = fields.line_item_qty
  if (!lineOrderField || !linePartField || !lineQtyField) return []

  const orderRows = await db
    .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, orderDefId),
        inArray(schema.EntityInstance.id, orderIds),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  if (orderRows.length === 0) return []

  const liveOrderIds = orderRows.map((row) => row.id)

  const orderDateFieldIds = [fields.order_placed_at?.id, fields.order_cancelled_at?.id].filter(
    (id): id is string => Boolean(id)
  )
  const orderValues = orderDateFieldIds.length
    ? await db
        .select({
          entityId: schema.FieldValue.entityId,
          fieldId: schema.FieldValue.fieldId,
          valueDate: schema.FieldValue.valueDate,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            inArray(schema.FieldValue.entityId, liveOrderIds),
            inArray(schema.FieldValue.fieldId, orderDateFieldIds)
          )
        )
    : []

  // The line -> order edge, with the line's own instance joined so an archived
  // line is dropped at the source rather than contributing a phantom quantity.
  const lineLinks = await db
    .select({
      lineId: schema.FieldValue.entityId,
      orderId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, lineDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, lineOrderField.id),
        inArray(schema.FieldValue.relatedEntityId, liveOrderIds)
      )
    )

  const lineIds = [...new Set(lineLinks.map((row) => row.lineId))]
  const lineValues = lineIds.length
    ? await db
        .select({
          entityId: schema.FieldValue.entityId,
          fieldId: schema.FieldValue.fieldId,
          valueNumber: schema.FieldValue.valueNumber,
          relatedEntityId: schema.FieldValue.relatedEntityId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            inArray(schema.FieldValue.entityId, lineIds),
            inArray(schema.FieldValue.fieldId, [linePartField.id, lineQtyField.id])
          )
        )
    : []

  const partByLine = new Map<string, string>()
  const qtyByLine = new Map<string, number>()
  for (const row of lineValues) {
    if (row.fieldId === linePartField.id && row.relatedEntityId) {
      partByLine.set(row.entityId, row.relatedEntityId)
    } else if (row.fieldId === lineQtyField.id && row.valueNumber != null) {
      qtyByLine.set(row.entityId, Number(row.valueNumber))
    }
  }

  const linesByOrder = new Map<string, AutoBuildLine[]>()
  for (const link of lineLinks) {
    if (!link.orderId) continue
    // Step 2: a line with no `line_item_part` reaches no part and is dropped.
    const partId = partByLine.get(link.lineId)
    if (!partId) continue
    const bucket = linesByOrder.get(link.orderId)
    const line: AutoBuildLine = { partId, quantity: qtyByLine.get(link.lineId) ?? 0 }
    if (bucket) bucket.push(line)
    else linesByOrder.set(link.orderId, [line])
  }

  const placedByOrder = new Map<string, Date>()
  const cancelledByOrder = new Map<string, Date>()
  for (const row of orderValues) {
    const parsed = row.valueDate ? new Date(row.valueDate) : null
    if (!parsed || Number.isNaN(parsed.getTime())) continue
    if (row.fieldId === fields.order_placed_at?.id) placedByOrder.set(row.entityId, parsed)
    else if (row.fieldId === fields.order_cancelled_at?.id) {
      cancelledByOrder.set(row.entityId, parsed)
    }
  }

  return orderRows.map((row) => ({
    orderId: row.id,
    placedAt: placedByOrder.get(row.id) ?? row.createdAt,
    cancelledAt: cancelledByOrder.get(row.id) ?? null,
    lines: linesByOrder.get(row.id) ?? [],
  }))
}

/**
 * `part_quantity_on_hand` for a set of parts.
 *
 * A part with no stored value reads **0**, not "unknown": a part nobody has ever
 * counted has nothing on the shelf, and under `out_of_stock_only` that is the
 * answer that raises the build.
 */
export async function readPartQuantitiesOnHand(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, number>> {
  const quantities = new Map<string, number>()
  if (partIds.length === 0) return quantities

  const unique = [...new Set(partIds)]
  for (const partId of unique) quantities.set(partId, 0)

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['part_quantity_on_hand'] as const)
  const qohField = fields.part_quantity_on_hand
  if (!qohField) return quantities

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      valueNumber: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, qohField.id),
        inArray(schema.FieldValue.entityId, unique)
      )
    )

  for (const row of rows) {
    if (row.valueNumber != null) quantities.set(row.entityId, Number(row.valueNumber))
  }
  return quantities
}
