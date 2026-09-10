// packages/lib/src/money/orders/reads.ts

/**
 * Reading an order for fulfillment: its totals, its channel, its lines, and how
 * much of each is still to ship.
 *
 * Reads only. The write lives in `fulfill.ts`, because a file that both queries
 * and mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` §5).
 *
 * No permission checks anywhere in this file. The router asserts and hands the
 * narrowed input down (§6).
 *
 * ⚠️ Values are read from `FieldValue`'s own columns rather than through
 * `UnifiedCrudHandler.getFieldValues`, following
 * `postings/journal-entries/reads.ts`. The reason is `order_fulfillments`: it is
 * a JSON column carrying the field-value layer's `{ v, meta }` envelope, and
 * {@link parseFulfillments} has to see that envelope to unwrap it. A typed read
 * that had already unwrapped it once would leave this file guessing which shape
 * it was handed.
 */

import { type Database, schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { readEnvelope } from '@auxx/types/field-value'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { NotFoundError, UnprocessableEntityError } from '../../errors'
import { toRecordId } from '../../resources/resource-id'
import {
  nextFulfillmentSequence,
  type OrderFulfillment,
  type OrderLineRemaining,
  shippedByLine,
  shippingStillOwed,
} from './client'
import { guard } from './guard'

/**
 * Every `order` attribute a fulfillment reads or writes.
 *
 * The last three are read by the BULK poster
 * (`money/fulfillment-posting/reads.ts`) rather than by the single-order path:
 * the debit fork needs the financial status and the gateways
 * (`postings/build-fulfillment-batch-entry.ts`), and the contact is carried for
 * a screen. They live here because {@link OrderFieldContext} is the one place
 * the order def and its field ids are resolved through the org cache, and a
 * second resolver would be a second thing to keep in step.
 */
const ORDER_ATTRIBUTES = [
  'order_number',
  'order_channel',
  'order_currency',
  'order_subtotal',
  'order_tax_total',
  'order_shipping_total',
  'order_total',
  'order_fulfillment_status',
  'order_line_items',
  'order_fulfillments',
  'order_financial_status',
  'order_payment_gateways',
  'order_contact',
] as const

/** Every `line_item` attribute a fulfillment reads. */
const LINE_ATTRIBUTES = [
  'line_item_name',
  'line_item_qty',
  'line_item_unit_price',
  'line_item_tax_total',
  'line_item_sort_order',
] as const

type OrderAttribute = (typeof ORDER_ATTRIBUTES)[number]
type LineAttribute = (typeof LINE_ATTRIBUTES)[number]

/** Every `tax_line` attribute the jurisdiction split reads (brief 13 §5). */
const TAX_LINE_ATTRIBUTES = ['tax_line_title', 'tax_line_price', 'tax_line_order'] as const
type TaxLineAttribute = (typeof TAX_LINE_ATTRIBUTES)[number]

/** One order's jurisdiction, as `splitTaxByJurisdiction` wants it. */
export interface OrderTaxLine {
  title: string
  priceMinor: number
}

/**
 * The resolved def and fields every order read needs.
 *
 * ⚠️ The WHOLE `CustomFieldEntity`, not just its id. `order_payment_gateways`
 * is a TAGS field whose values are stored as opaque option keys, so the bulk
 * poster has to resolve them back to gateway NAMES through the field's own
 * `options` (`resources/registry/option-helpers.ts`). Narrowing this to
 * `{ id }` would force a second read of the same cached row.
 */
export interface OrderFieldContext {
  orderDefId: string
  order: Record<OrderAttribute, CustomFieldEntity | null>
  line: Record<LineAttribute, CustomFieldEntity | null>
}

/**
 * Resolve the `order` def and its fields, or `null` when the org has not run
 * entity migration 125 yet.
 *
 * `null` rather than a throw so a read surface on an unmigrated org renders
 * empty instead of 500ing. The WRITE path calls
 * {@link requireOrderFieldContext} instead: a fulfillment that silently
 * recorded nothing would be worse than a refusal, because the entry would still
 * post and the next shipment would recognise the same revenue again.
 */
export async function loadOrderFieldContext(
  organizationId: string
): Promise<OrderFieldContext | null> {
  const orderDefId = await getCachedEntityDefId(organizationId, 'order')
  if (!orderDefId) return null
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...ORDER_ATTRIBUTES, ...LINE_ATTRIBUTES])
  const order: Record<OrderAttribute, CustomFieldEntity | null> = fields
  const line: Record<LineAttribute, CustomFieldEntity | null> = fields
  // Without the number there is no period key, and without the log there is no
  // "how much is still to ship". Both reduce fulfillment to guessing.
  if (!order.order_number || !order.order_fulfillments) return null
  return { orderDefId, order, line }
}

/** {@link loadOrderFieldContext}, as the refusal a write path needs. */
export async function requireOrderFieldContext(organizationId: string): Promise<OrderFieldContext> {
  const ctx = await loadOrderFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Fulfilling an order is not available until the order shipment log is provisioned ' +
        '(entity migration 125). Without it a second shipment cannot tell what the first one ' +
        'already shipped.'
    )
  }
  return ctx
}

/** One order, everything the fulfillment builder and the dialog need, in one shape. */
export interface OrderForFulfillment {
  orderId: string
  /** What a `UnifiedCrudHandler.update` takes. */
  recordId: ReturnType<typeof toRecordId>
  number: string | null
  /** `order_channel`, verbatim - `manual` and `null` are both refused downstream. */
  channel: string | null
  currency: string | null
  subtotalMinor: number
  taxTotalMinor: number
  shippingTotalMinor: number
  totalMinor: number
  fulfillmentStatus: string | null
  /** The shipment log, oldest first. Empty when nothing has shipped. */
  fulfillments: OrderFulfillment[]
  /** The order's lines with what is still to ship on each, in display order. */
  lines: OrderLineRemaining[]
  /** The sequence the next fulfillment claims. */
  nextSequence: number
  /** Whether the next posting carries the order's shipping revenue. */
  shippingOwed: boolean
  /**
   * `order_contact`'s related `contact` instance id, for the counterparty on
   * the fulfillment entry's `accounts_receivable` line (brief 13 §1.2).
   */
  contactInstanceId: string | null
  /**
   * The order's own `tax_line` rows - one per jurisdiction (brief 13 §5).
   * Empty when the org has none, or predates entity migration 136. Splits the
   * `sales_tax_payable` credit across jurisdictions when they tie to
   * `taxTotalMinor` - see `postings/split-tax-by-jurisdiction.ts`.
   */
  taxLines: OrderTaxLine[]
}

/**
 * Every named order's own tax lines, in ONE bulk read - never one query per
 * order (brief 13 §5).
 *
 * Two statements regardless of how many orders are asked for: the first finds
 * which `tax_line` instances belong to these orders (the `tax_line_order`
 * edge), the second reads `title` and `price` for exactly those instances.
 * Both are empty reads, not refusals, when the org has no `tax_line` def yet
 * (pre-migration-136) - the caller then falls back to the single undimensioned
 * tax line, which is `splitTaxByJurisdiction`'s documented behaviour for "no
 * tax lines at all".
 */
export async function readOrderTaxLines(
  db: Database,
  organizationId: string,
  orderIds: readonly string[]
): Promise<Map<string, OrderTaxLine[]>> {
  const byOrder = new Map<string, OrderTaxLine[]>()
  if (orderIds.length === 0) return byOrder

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...TAX_LINE_ATTRIBUTES])
  const attrs = fields as Record<TaxLineAttribute, CustomFieldEntity | null>
  const titleField = attrs.tax_line_title
  const priceField = attrs.tax_line_price
  const orderField = attrs.tax_line_order
  if (!titleField || !priceField || !orderField) return byOrder

  // Hop 1: which tax_line instances belong to these orders.
  const edgeRows = await db
    .select({
      taxLineId: schema.FieldValue.entityId,
      orderId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, orderField.id),
        inArray(schema.FieldValue.relatedEntityId, [...orderIds])
      )
    )
  if (edgeRows.length === 0) return byOrder

  const orderIdByTaxLine = new Map<string, string>()
  for (const row of edgeRows) {
    if (row.orderId) orderIdByTaxLine.set(row.taxLineId, row.orderId)
  }
  const taxLineIds = [...orderIdByTaxLine.keys()]
  if (taxLineIds.length === 0) return byOrder

  // Hop 2: title and price for exactly those tax lines, in one query.
  const valueRows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, taxLineIds),
        inArray(schema.FieldValue.fieldId, [titleField.id, priceField.id])
      )
    )

  const byTaxLine = new Map<string, { title?: string; priceMinor?: number }>()
  for (const row of valueRows) {
    const entry = byTaxLine.get(row.entityId) ?? {}
    if (row.fieldId === titleField.id) entry.title = row.valueText ?? undefined
    if (row.fieldId === priceField.id) entry.priceMinor = row.valueNumber ?? undefined
    byTaxLine.set(row.entityId, entry)
  }

  for (const [taxLineId, orderId] of orderIdByTaxLine) {
    const values = byTaxLine.get(taxLineId)
    // A tax line missing either value cannot enter the split - it would
    // silently understate the total it has to tie to.
    if (!values?.title?.trim() || values.priceMinor == null) continue
    const line: OrderTaxLine = { title: values.title, priceMinor: values.priceMinor }
    const list = byOrder.get(orderId)
    if (list) list.push(line)
    else byOrder.set(orderId, [line])
  }
  return byOrder
}

/**
 * Read the stored shipment log back, discarding anything that is not a usable
 * entry.
 *
 * 🛑 Tolerant on READ and strict on WRITE, the same posture `parseLines` takes
 * in `postings/journal-entries/reads.ts`. `fulfill.ts` validates before it
 * stores, so a malformed row here means the JSON came from somewhere else - and
 * the honest response is to render what IS readable rather than to make the
 * order unfulfillable. A dropped row cannot become a silent double
 * recognition either: the entry it produced still holds its period key, so a
 * re-shipped line's posting collides on the claim's unique index and comes back
 * `already_posted` rather than posting twice.
 *
 * Two wrappers come off: the field-value layer's `{ v, meta }` envelope, and our
 * own `{ fulfillments }` object, which exists because a top-level ARRAY is read
 * as a MULTI-VALUE write and this field is single-value.
 */
export function parseFulfillments(value: unknown): OrderFulfillment[] {
  const inner = readEnvelope(value).v ?? value
  const array = Array.isArray(inner)
    ? inner
    : typeof inner === 'object' &&
        inner !== null &&
        Array.isArray((inner as { fulfillments?: unknown }).fulfillments)
      ? (inner as { fulfillments: unknown[] }).fulfillments
      : null
  if (!array) return []

  const parsed: OrderFulfillment[] = []
  for (const row of array) {
    if (typeof row !== 'object' || row === null) continue
    const candidate = row as Record<string, unknown>
    const sequence = candidate.sequence
    if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1) continue
    const rawLines = Array.isArray(candidate.lines) ? candidate.lines : []
    parsed.push({
      sequence,
      shippedAt: typeof candidate.shippedAt === 'string' ? candidate.shippedAt : '',
      lines: rawLines.flatMap((line) => {
        if (typeof line !== 'object' || line === null) return []
        const { lineId, quantity } = line as { lineId?: unknown; quantity?: unknown }
        if (typeof lineId !== 'string' || typeof quantity !== 'number') return []
        if (!Number.isFinite(quantity) || quantity <= 0) return []
        return [{ lineId, quantity }]
      }),
      // 🛑 Carried through, not dropped. `shippedSubtotalMinor` sums it to give
      // the builder `priorShipmentsSubtotalMinor`, which is what makes the
      // cumulative tax allocation true itself up on the shipment that completes
      // the order. A parser that dropped it made every read report zero prior
      // subtotal, so the second shipment of a split order allocated as if it
      // were the first and A/R stayed a cent short forever.
      ...(typeof candidate.subtotalMinor === 'number'
        ? { subtotalMinor: candidate.subtotalMinor }
        : {}),
      totalMinor: typeof candidate.totalMinor === 'number' ? candidate.totalMinor : 0,
      shippingRecognised: candidate.shippingRecognised === true,
      glPostingId: typeof candidate.glPostingId === 'string' ? candidate.glPostingId : null,
      docNumber: typeof candidate.docNumber === 'string' ? candidate.docNumber : null,
      recordedAt: typeof candidate.recordedAt === 'string' ? candidate.recordedAt : '',
    })
  }
  return parsed.sort((a, b) => a.sequence - b.sequence)
}

/** One `FieldValue` row, in the columns this module reads. */
interface ValueRow {
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  valueJson: unknown
  optionId: string | null
  relatedEntityId: string | null
}

/**
 * Read one order, its lines, and how much of each is still to ship.
 *
 * 🛑 **`remainingQuantity` is `ordered - Σ shipped`, from the LOG, never from
 * `order_fulfillment_status`.** The status says `partial` and cannot say partial
 * in WHAT; deriving remaining from it would let a second shipment re-ship a line
 * the first already shipped, and the fulfillment entry would recognise its
 * revenue a second time - balanced, and invisible.
 *
 * ⚠️ A line's `unit_price` is a RATE carrying five decimal places, so the value
 * returned here may be a fractional minor unit. `extendRateToAmount` in the
 * builder is where that stops being true, and it is the only rounding boundary.
 */
export async function readOrderForFulfillment(
  db: Database,
  params: { organizationId: string; orderId: string }
): Promise<Result<OrderForFulfillment, Error>> {
  const { organizationId, orderId } = params

  return guard(
    async () => {
      const ctx = await requireOrderFieldContext(organizationId)

      const instance = await db.query.EntityInstance.findFirst({
        where: and(
          eq(schema.EntityInstance.id, orderId),
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, ctx.orderDefId)
        ),
        columns: { id: true },
      })
      if (!instance) {
        throw new NotFoundError('That order does not exist in this organization')
      }

      const orderFieldIds = Object.values(ctx.order)
        .filter((field): field is CustomFieldEntity => field != null)
        .map((field) => field.id)
      const rows = await selectValues(db, organizationId, [orderId], orderFieldIds)
      const bucket = rows.get(orderId)

      const cell = (attribute: OrderAttribute): ValueRow | undefined => {
        const field = ctx.order[attribute]
        return field ? bucket?.get(field.id)?.[0] : undefined
      }
      const cells = (attribute: OrderAttribute): ValueRow[] => {
        const field = ctx.order[attribute]
        return field ? (bucket?.get(field.id) ?? []) : []
      }

      const fulfillments = parseFulfillments(cell('order_fulfillments')?.valueJson)
      const shipped = shippedByLine(fulfillments)

      const lineIds = cells('order_line_items')
        .map((row) => row.relatedEntityId)
        .filter((id): id is string => !!id)
      const lines = await readOrderLines(db, organizationId, ctx, lineIds, shipped)
      const taxLines = (await readOrderTaxLines(db, organizationId, [orderId])).get(orderId) ?? []

      return {
        orderId,
        recordId: toRecordId(ctx.orderDefId, orderId),
        number: cell('order_number')?.valueText ?? null,
        // A SINGLE_SELECT stores its value in `optionId`, not `valueText`.
        channel: cell('order_channel')?.optionId ?? null,
        currency: cell('order_currency')?.valueText ?? null,
        subtotalMinor: cell('order_subtotal')?.valueNumber ?? 0,
        taxTotalMinor: cell('order_tax_total')?.valueNumber ?? 0,
        shippingTotalMinor: cell('order_shipping_total')?.valueNumber ?? 0,
        totalMinor: cell('order_total')?.valueNumber ?? 0,
        fulfillmentStatus: cell('order_fulfillment_status')?.optionId ?? null,
        fulfillments,
        lines,
        nextSequence: nextFulfillmentSequence(fulfillments),
        shippingOwed: shippingStillOwed(fulfillments),
        contactInstanceId: cell('order_contact')?.relatedEntityId ?? null,
        taxLines,
      }
    },
    'Failed to read an order for fulfillment',
    { organizationId, orderId }
  )
}

/**
 * The order's lines, in one query.
 *
 * A join per attribute would multiply the row count; this pivots four
 * attributes in memory instead, the same shape
 * `postings/journal-entries/reads.ts`'s `hydrate` uses.
 */
async function readOrderLines(
  db: Database,
  organizationId: string,
  ctx: OrderFieldContext,
  lineIds: string[],
  shipped: Map<string, number>
): Promise<OrderLineRemaining[]> {
  if (lineIds.length === 0) return []

  const fieldIds = Object.values(ctx.line)
    .filter((field): field is CustomFieldEntity => field != null)
    .map((field) => field.id)
  if (fieldIds.length === 0) return []

  const rows = await selectValues(db, organizationId, lineIds, fieldIds)

  const lines = lineIds.map((lineId, index) => {
    const bucket = rows.get(lineId)
    const cell = (attribute: LineAttribute): ValueRow | undefined => {
      const field = ctx.line[attribute]
      return field ? bucket?.get(field.id)?.[0] : undefined
    }
    const quantity = cell('line_item_qty')?.valueNumber ?? 0
    const shippedQuantity = shipped.get(lineId) ?? 0
    return {
      lineId,
      name: cell('line_item_name')?.valueText ?? 'Line item',
      quantity,
      shippedQuantity,
      remainingQuantity: Math.max(0, quantity - shippedQuantity),
      unitPriceMinor: cell('line_item_unit_price')?.valueNumber ?? 0,
      // 🛑 `?? null`, never `?? 0`. An absent row and a zero row are different
      // facts, and the builder branches on the difference: every line carrying
      // a number switches the entry to per-line tax, one null falls back to
      // allocating the order's total. See `OrderLineRemaining.lineTaxMinor`.
      lineTaxMinor: cell('line_item_tax_total')?.valueNumber ?? null,
      sortOrder: cell('line_item_sort_order')?.valueNumber ?? index,
    }
  })

  return lines.sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * `FieldValue` rows for a set of instances and fields, bucketed
 * `instance -> field -> rows`.
 *
 * The inner value is an ARRAY because a relationship field has one row per
 * related record - `order_line_items` is exactly that, and a `Map<fieldId, row>`
 * would silently keep only the last line.
 */
async function selectValues(
  db: Database,
  organizationId: string,
  entityIds: string[],
  fieldIds: string[]
): Promise<Map<string, Map<string, ValueRow[]>>> {
  const buckets = new Map<string, Map<string, ValueRow[]>>()
  if (entityIds.length === 0 || fieldIds.length === 0) return buckets

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueJson: schema.FieldValue.valueJson,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
      sortKey: schema.FieldValue.sortKey,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, entityIds),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )
    .orderBy(schema.FieldValue.sortKey)

  for (const row of rows) {
    let byField = buckets.get(row.entityId)
    if (!byField) {
      byField = new Map()
      buckets.set(row.entityId, byField)
    }
    const list = byField.get(row.fieldId)
    if (list) list.push(row)
    else byField.set(row.fieldId, [row])
  }
  return buckets
}
