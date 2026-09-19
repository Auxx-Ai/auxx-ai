// packages/lib/src/accounting/sales/fulfillments/reads.ts

/**
 * Reading `fulfillment` / `fulfillment_line` records: two bulk reads that never
 * cost more than a handful of queries regardless of how many orders are asked
 * for. The def and field resolution lives in `fields.ts`.
 *
 * Reads only; the writes live in `writes.ts` (`docs/lib-module-guide.md` §5).
 * No permission checks anywhere in this file - the router asserts and hands
 * the narrowed input down (§6).
 *
 * ## Why a child read, never one query per order
 *
 * `fulfillment_order` (on `fulfillment`) and `fulfillment_line_fulfillment`
 * (on `fulfillment_line`) are the owning, `belongs_to` sides of their
 * relationships, so `readSystemRecords`' `by:` filter resolves "every
 * fulfillment of these orders" from one `relatedEntityId IN (...)` rather than
 * a walk per order.
 *
 * `order_fulfillments` (the has_many INVERSE on `order`) is never queried
 * directly: the inverse side of a relationship carries no `FieldValue` rows of
 * its own to read.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { toRecordId } from '../../../resources/resource-id'
import { readSystemRecords, type SystemRecord } from '../../../resources/system-records'
import { loadFulfillmentFieldContext } from './fields'
import type { Fulfillment, FulfillmentLine, FulfillmentStatusValue } from './types'

/**
 * Every fulfillment for a set of orders, ONE round of queries regardless of
 * how many orders are asked for.
 *
 * The shape the bulk fulfillment poster, the credit-memo readers and any
 * multi-order screen all need - none of them may read this one order at a
 * time (brief §6's whole point). `readFulfillmentsForOrder` is this function
 * called with a single id.
 *
 * Seven statements total: the fulfillments of these orders and their cells,
 * the lines of those fulfillments and theirs, and the live subject claims.
 * Empty at any hop short-circuits the rest.
 */
export async function readFulfillmentsForOrders(
  db: Database | Transaction,
  params: { organizationId: string; orderIds: readonly string[] }
): Promise<Map<string, Fulfillment[]>> {
  const { organizationId, orderIds } = params
  const byOrder = new Map<string, Fulfillment[]>()
  if (orderIds.length === 0) return byOrder

  const ctx = await loadFulfillmentFieldContext(db, organizationId)
  if (!ctx) return byOrder

  // 🛑 Archived rows included, as the edge selects this replaced did. An
  // archived fulfillment keeps its live `GlPostingSource` claim, so hiding it
  // would un-ship its quantity and leave the posting with no source event.
  const fulfillments = await readSystemRecords(db, organizationId, ctx.fulfillment, {
    by: { attribute: 'fulfillment_order', in: orderIds },
    includeArchived: true,
  })
  if (fulfillments.length === 0) return byOrder
  const fulfillmentIds = fulfillments.map((record) => record.id)

  const lines = await readSystemRecords(db, organizationId, ctx.line, {
    by: { attribute: 'fulfillment_line_fulfillment', in: fulfillmentIds },
    includeArchived: true,
  })
  const linesByFulfillment = new Map<string, FulfillmentLine[]>()
  for (const record of lines) {
    const fulfillmentId = record.related('fulfillment_line_fulfillment')
    const lineItemId = record.related('fulfillment_line_line_item')
    // A line with no line_item edge is unusable, not a crash.
    if (!fulfillmentId || !lineItemId) continue
    const line: FulfillmentLine = {
      id: record.id,
      recordId: toRecordId('fulfillment_line', record.id),
      lineItemId,
      quantity: record.number('fulfillment_line_quantity') ?? 0,
      quantityRelieved: record.number('fulfillment_line_quantity_relieved') ?? null,
    }
    const list = linesByFulfillment.get(fulfillmentId)
    if (list) list.push(line)
    else linesByFulfillment.set(fulfillmentId, [line])
  }

  // "Posted" is "holds a live subject claim" (TARGET §1) - never a stamp field.
  // One bulk read of `GlPostingSource` joined to `GlPosting`, the same two
  // tables `listPostingsForSource` reads, shaped for many fulfillments at once
  // rather than one call per id.
  const subjects = await db
    .select({
      fulfillmentId: schema.GlPostingSource.sourceId,
      glPostingId: schema.GlPosting.id,
      docNumber: schema.GlPosting.docNumber,
    })
    .from(schema.GlPostingSource)
    .innerJoin(
      schema.GlPosting,
      and(
        eq(schema.GlPosting.id, schema.GlPostingSource.glPostingId),
        eq(schema.GlPosting.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.sourceKind, 'fulfillment'),
        eq(schema.GlPostingSource.linkRole, 'subject'),
        inArray(schema.GlPostingSource.sourceId, fulfillmentIds)
      )
    )
  const postedById = new Map(subjects.map((row) => [row.fulfillmentId, row]))

  for (const record of fulfillments) {
    const orderId = record.related('fulfillment_order')
    if (!orderId) continue

    const fulfillment: Fulfillment = {
      id: record.id,
      recordId: toRecordId('fulfillment', record.id),
      orderId,
      sequence: record.number('fulfillment_sequence') ?? 0,
      shippedAt: record.date('fulfillment_shipped_at') ?? '',
      status: (record.option('fulfillment_status') as FulfillmentStatusValue | null) ?? 'pending',
      cancelledAt: record.date('fulfillment_cancelled_at'),
      name: record.text('fulfillment_name'),
      trackingNumber: record.text('fulfillment_tracking_number'),
      trackingCompany: record.text('fulfillment_tracking_company'),
      trackingUrl: record.text('fulfillment_tracking_url'),
      subtotalMinor: record.number('fulfillment_subtotal') ?? 0,
      totalMinor: record.number('fulfillment_total') ?? 0,
      shippingRecognised: record.boolean('fulfillment_shipping_recognised') ?? false,
      // "Posted" is "holds a live subject claim" - never a stamp field on the
      // record (TARGET §1). `null` on both means no subject `GlPostingSource`
      // row exists, whether because nothing was posted yet or because a
      // reversal freed the claim and nothing has reposted.
      glPosting: postedById.get(record.id)?.glPostingId ?? null,
      docNumber: postedById.get(record.id)?.docNumber ?? null,
      recordedAt: record.date('fulfillment_recorded_at') ?? '',
      lines: (linesByFulfillment.get(record.id) ?? []).sort((a, b) => a.id.localeCompare(b.id)),
    }

    const list = byOrder.get(orderId)
    if (list) list.push(fulfillment)
    else byOrder.set(orderId, [fulfillment])
  }

  // Oldest first, per order - the same order the JSON log guaranteed.
  for (const list of byOrder.values()) {
    list.sort((a, b) => a.sequence - b.sequence)
  }
  return byOrder
}

/**
 * Every fulfillment of ONE order, oldest first. Used by the native
 * fulfillment door (`sales/orders/reads.ts`) and by any single-order screen.
 *
 * A thin call into {@link readFulfillmentsForOrders} rather than a second
 * query shape - a reader that special-cased "one order" would have two
 * assembly paths that could disagree about a row.
 */
export async function readFulfillmentsForOrder(
  db: Database | Transaction,
  params: { organizationId: string; orderId: string }
): Promise<Fulfillment[]> {
  const byOrder = await readFulfillmentsForOrders(db, {
    organizationId: params.organizationId,
    orderIds: [params.orderId],
  })
  return byOrder.get(params.orderId) ?? []
}
