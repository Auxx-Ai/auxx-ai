// packages/lib/src/money/fulfillments/reads.ts

/**
 * Reading `fulfillment` / `fulfillment_line` records: the field context, and
 * two bulk reads that never cost more than a handful of queries regardless of
 * how many orders are asked for.
 *
 * Reads only; the writes live in `writes.ts` (`docs/lib-module-guide.md` §5).
 * No permission checks anywhere in this file - the router asserts and hands
 * the narrowed input down (§6).
 *
 * ## Why two hops per read, never one query per order
 *
 * `fulfillment_order` (on `fulfillment`) and `fulfillment_line_fulfillment`
 * (on `fulfillment_line`) are the owning, `belongs_to` sides of their
 * relationships - a `RELATIONSHIP` value's `relatedEntityId` column IS the
 * join key, so "every fulfillment of these orders" is one `WHERE fieldId = ...
 * AND relatedEntityId IN (...)` against `FieldValue`, not a walk per order.
 * `money/orders/reads.ts`'s `readOrderTaxLines` is the precedent this copies.
 *
 * `order_fulfillments` (the has_many INVERSE on `order`) is never queried
 * directly: the inverse side of a relationship carries no `FieldValue` rows of
 * its own to read.
 */

import { type Database, schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { toRecordId } from '../../resources/resource-id'
import type { Fulfillment, FulfillmentLine, FulfillmentStatusValue } from './types'

/** Every `fulfillment` attribute this module reads or writes. */
const FULFILLMENT_ATTRIBUTES = [
  'fulfillment_order',
  'fulfillment_sequence',
  'fulfillment_shipped_at',
  'fulfillment_status',
  'fulfillment_cancelled_at',
  'fulfillment_name',
  'fulfillment_tracking_number',
  'fulfillment_tracking_company',
  'fulfillment_tracking_url',
  'fulfillment_subtotal',
  'fulfillment_total',
  'fulfillment_shipping_recognised',
  'fulfillment_gl_posting',
  'fulfillment_doc_number',
  'fulfillment_recorded_at',
] as const

/** Every `fulfillment_line` attribute this module reads or writes. */
const FULFILLMENT_LINE_ATTRIBUTES = [
  'fulfillment_line_fulfillment',
  'fulfillment_line_line_item',
  'fulfillment_line_quantity',
  'fulfillment_line_quantity_relieved',
] as const

type FulfillmentAttribute = (typeof FULFILLMENT_ATTRIBUTES)[number]
type FulfillmentLineAttribute = (typeof FULFILLMENT_LINE_ATTRIBUTES)[number]

/** The resolved defs and fields every fulfillment read or write needs. */
export interface FulfillmentFieldContext {
  fulfillmentDefId: string
  fulfillmentLineDefId: string
  fulfillment: Record<FulfillmentAttribute, CustomFieldEntity | null>
  line: Record<FulfillmentLineAttribute, CustomFieldEntity | null>
}

/**
 * Resolve the `fulfillment` / `fulfillment_line` defs and their fields, or
 * `null` when the org has not run entity migration 153 yet.
 *
 * `null` rather than a throw so a read surface on an unmigrated org degrades
 * to "nothing shipped" instead of 500ing - the same posture
 * `money/orders/reads.ts`'s `loadOrderFieldContext` takes. The WRITE path
 * calls {@link requireFulfillmentFieldContext} instead.
 */
export async function loadFulfillmentFieldContext(
  organizationId: string
): Promise<FulfillmentFieldContext | null> {
  const [fulfillmentDefId, fulfillmentLineDefId] = await Promise.all([
    getCachedEntityDefId(organizationId, 'fulfillment'),
    getCachedEntityDefId(organizationId, 'fulfillment_line'),
  ])
  if (!fulfillmentDefId || !fulfillmentLineDefId) return null

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...FULFILLMENT_ATTRIBUTES, ...FULFILLMENT_LINE_ATTRIBUTES])
  const fulfillment: Record<FulfillmentAttribute, CustomFieldEntity | null> = fields
  const line: Record<FulfillmentLineAttribute, CustomFieldEntity | null> = fields
  // Without the order edge or the line edge there is nothing to join on -
  // both reduce every read here to guessing.
  if (!fulfillment.fulfillment_order || !line.fulfillment_line_fulfillment) return null
  return { fulfillmentDefId, fulfillmentLineDefId, fulfillment, line }
}

/** {@link loadFulfillmentFieldContext}, as the refusal a write path needs. */
export async function requireFulfillmentFieldContext(
  organizationId: string
): Promise<FulfillmentFieldContext> {
  const ctx = await loadFulfillmentFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Fulfilling an order is not available until the fulfillment entities are provisioned ' +
        '(entity migration 153). Without them a shipment has nowhere to be recorded.'
    )
  }
  return ctx
}

/** One `FieldValue` row, in the columns this module reads. */
interface ValueRow {
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  valueBoolean: boolean | null
  /** ISO instant, for DATE/DATETIME/TIME fields (`fulfillment_shipped_at` and friends). */
  valueDate: string | null
  optionId: string | null
  relatedEntityId: string | null
}

/**
 * `FieldValue` rows for a set of instances and fields, bucketed
 * `instance -> field -> row`.
 *
 * Every attribute here is single-valued on its owning record (a fulfillment
 * has exactly one `fulfillment_status`, a line exactly one `fulfillment_line_quantity`),
 * unlike `money/orders/reads.ts`'s `selectValues` which buckets to an ARRAY
 * because `order_line_items` is a has_many read from the parent. Nothing here
 * is read from a has_many side, so the last row wins and there is only ever one.
 */
async function selectValues(
  db: Database,
  organizationId: string,
  entityIds: string[],
  fieldIds: string[]
): Promise<Map<string, Map<string, ValueRow>>> {
  const buckets = new Map<string, Map<string, ValueRow>>()
  if (entityIds.length === 0 || fieldIds.length === 0) return buckets

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueBoolean: schema.FieldValue.valueBoolean,
      valueDate: schema.FieldValue.valueDate,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, entityIds),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  for (const row of rows) {
    let byField = buckets.get(row.entityId)
    if (!byField) {
      byField = new Map()
      buckets.set(row.entityId, byField)
    }
    byField.set(row.fieldId, row)
  }
  return buckets
}

/**
 * Every fulfillment for a set of orders, ONE round of queries regardless of
 * how many orders are asked for.
 *
 * The shape the bulk fulfillment poster, the credit-memo readers and any
 * multi-order screen all need - none of them may read this one order at a
 * time (brief §6's whole point). `readFulfillmentsForOrder` is this function
 * called with a single id.
 *
 * Four statements total: which fulfillments belong to these orders, their own
 * fields, which lines belong to those fulfillments, and the lines' fields.
 * Empty at any hop short-circuits the rest.
 */
export async function readFulfillmentsForOrders(
  db: Database,
  params: { organizationId: string; orderIds: readonly string[] }
): Promise<Map<string, Fulfillment[]>> {
  const { organizationId, orderIds } = params
  const byOrder = new Map<string, Fulfillment[]>()
  if (orderIds.length === 0) return byOrder

  const ctx = await loadFulfillmentFieldContext(organizationId)
  if (!ctx) return byOrder

  // Hop 1: which fulfillment instances belong to these orders.
  const fulfillmentEdges = await db
    .select({
      fulfillmentId: schema.FieldValue.entityId,
      orderId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, ctx.fulfillment.fulfillment_order!.id),
        inArray(schema.FieldValue.relatedEntityId, [...orderIds])
      )
    )
  if (fulfillmentEdges.length === 0) return byOrder

  const orderIdByFulfillment = new Map<string, string>()
  for (const row of fulfillmentEdges) {
    if (row.orderId) orderIdByFulfillment.set(row.fulfillmentId, row.orderId)
  }
  const fulfillmentIds = [...orderIdByFulfillment.keys()]
  if (fulfillmentIds.length === 0) return byOrder

  // Hop 2: every fulfillment's own fields.
  const fulfillmentFieldIds = Object.values(ctx.fulfillment)
    .filter((field): field is CustomFieldEntity => field != null)
    .map((field) => field.id)
  const fulfillmentRows = await selectValues(
    db,
    organizationId,
    fulfillmentIds,
    fulfillmentFieldIds
  )

  // Hop 3: which fulfillment_line instances belong to those fulfillments.
  const lineEdges = await db
    .select({
      lineId: schema.FieldValue.entityId,
      fulfillmentId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, ctx.line.fulfillment_line_fulfillment!.id),
        inArray(schema.FieldValue.relatedEntityId, fulfillmentIds)
      )
    )
  const lineIdsByFulfillment = new Map<string, string[]>()
  for (const row of lineEdges) {
    if (!row.fulfillmentId) continue
    const list = lineIdsByFulfillment.get(row.fulfillmentId)
    if (list) list.push(row.lineId)
    else lineIdsByFulfillment.set(row.fulfillmentId, [row.lineId])
  }

  // Hop 4: every line's own fields.
  const lineFieldIds = Object.values(ctx.line)
    .filter((field): field is CustomFieldEntity => field != null)
    .map((field) => field.id)
  const allLineIds = lineEdges.map((row) => row.lineId)
  const lineRows = await selectValues(db, organizationId, allLineIds, lineFieldIds)

  const buildLine = (lineId: string): FulfillmentLine | null => {
    const bucket = lineRows.get(lineId)
    const cell = (attribute: FulfillmentLineAttribute): ValueRow | undefined => {
      const field = ctx.line[attribute]
      return field ? bucket?.get(field.id) : undefined
    }
    const lineItemId = cell('fulfillment_line_line_item')?.relatedEntityId
    if (!lineItemId) return null
    return {
      id: lineId,
      recordId: toRecordId('fulfillment_line', lineId),
      lineItemId,
      quantity: cell('fulfillment_line_quantity')?.valueNumber ?? 0,
      quantityRelieved: cell('fulfillment_line_quantity_relieved')?.valueNumber ?? null,
    }
  }

  for (const fulfillmentId of fulfillmentIds) {
    const bucket = fulfillmentRows.get(fulfillmentId)
    const cell = (attribute: FulfillmentAttribute): ValueRow | undefined => {
      const field = ctx.fulfillment[attribute]
      return field ? bucket?.get(field.id) : undefined
    }
    const orderId = orderIdByFulfillment.get(fulfillmentId)
    if (!orderId) continue

    const lines = (lineIdsByFulfillment.get(fulfillmentId) ?? [])
      .map(buildLine)
      .filter((line): line is FulfillmentLine => line !== null)

    const fulfillment: Fulfillment = {
      id: fulfillmentId,
      recordId: toRecordId('fulfillment', fulfillmentId),
      orderId,
      sequence: cell('fulfillment_sequence')?.valueNumber ?? 0,
      shippedAt: cell('fulfillment_shipped_at')?.valueDate ?? '',
      status:
        (cell('fulfillment_status')?.optionId as FulfillmentStatusValue | undefined) ?? 'pending',
      cancelledAt: cell('fulfillment_cancelled_at')?.valueDate ?? null,
      name: cell('fulfillment_name')?.valueText ?? null,
      trackingNumber: cell('fulfillment_tracking_number')?.valueText ?? null,
      trackingCompany: cell('fulfillment_tracking_company')?.valueText ?? null,
      trackingUrl: cell('fulfillment_tracking_url')?.valueText ?? null,
      subtotalMinor: cell('fulfillment_subtotal')?.valueNumber ?? 0,
      totalMinor: cell('fulfillment_total')?.valueNumber ?? 0,
      shippingRecognised: cell('fulfillment_shipping_recognised')?.valueBoolean ?? false,
      glPosting: cell('fulfillment_gl_posting')?.valueText ?? null,
      docNumber: cell('fulfillment_doc_number')?.valueText ?? null,
      recordedAt: cell('fulfillment_recorded_at')?.valueDate ?? '',
      lines,
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
 * fulfillment door (`money/orders/reads.ts`) and by any single-order screen.
 *
 * A thin call into {@link readFulfillmentsForOrders} rather than a second
 * query shape - a reader that special-cased "one order" would have two
 * assembly paths that could disagree about a row.
 */
export async function readFulfillmentsForOrder(
  db: Database,
  params: { organizationId: string; orderId: string }
): Promise<Fulfillment[]> {
  const byOrder = await readFulfillmentsForOrders(db, {
    organizationId: params.organizationId,
    orderIds: [params.orderId],
  })
  return byOrder.get(params.orderId) ?? []
}
