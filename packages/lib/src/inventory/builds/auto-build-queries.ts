// packages/lib/src/inventory/builds/auto-build-queries.ts

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
import { and, eq, inArray } from 'drizzle-orm'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { readSystemRecords, systemFieldMap, systemFields } from '../../resources/system-records'
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
 * Five queries regardless of batch size. An org missing the `order` def, the
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

  const [orderCtx, lineCtx] = await Promise.all([
    systemFields(db, organizationId, 'order', ORDER_ATTRIBUTES),
    systemFields(db, organizationId, 'line_item', LINE_ATTRIBUTES),
  ])
  if (!orderCtx || !lineCtx) return []
  // All three, or a line reaches no part and carries no quantity: the whole
  // batch reads as nothing to build from rather than as half a demand set.
  const { line_item_order, line_item_part, line_item_qty } = lineCtx.fields
  if (!line_item_order || !line_item_part || !line_item_qty) return []

  const orders = await readSystemRecords(db, organizationId, orderCtx, { ids: orderIds })
  if (orders.length === 0) return []

  const lines = await readSystemRecords(db, organizationId, lineCtx, {
    by: { attribute: 'line_item_order', in: orders.map((order) => order.id) },
  })

  const linesByOrder = new Map<string, AutoBuildLine[]>()
  for (const line of lines) {
    const orderId = line.related('line_item_order')
    // Step 2: a line with no `line_item_part` reaches no part and is dropped.
    const partId = line.related('line_item_part')
    if (!orderId || !partId) continue
    const bucket = linesByOrder.get(orderId)
    const entry: AutoBuildLine = { partId, quantity: line.number('line_item_qty') ?? 0 }
    if (bucket) bucket.push(entry)
    else linesByOrder.set(orderId, [entry])
  }

  return orders.map((order) => ({
    orderId: order.id,
    placedAt: parseDate(order.date('order_placed_at')) ?? order.createdAt ?? new Date(0),
    cancelledAt: parseDate(order.date('order_cancelled_at')),
    lines: linesByOrder.get(order.id) ?? [],
  }))
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * `part_quantity_on_hand` for a set of parts.
 *
 * A part with no stored value reads **0**, not "unknown": a part nobody has ever
 * counted has nothing on the shelf, and under `out_of_stock_only` that is the
 * answer that raises the build.
 *
 * Deliberately not on `readSystemRecords`: the ids come off BOM edges and demand
 * lines, and an ARCHIVED part still has stock on the shelf — the reader scopes to
 * live instances of the def and would cost a second query to do it.
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

  const fields = await systemFieldMap(
    db,
    organizationId,
    pickSystemAttributes(PART_FIELDS, ['part_quantity_on_hand'] as const)
  )
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
