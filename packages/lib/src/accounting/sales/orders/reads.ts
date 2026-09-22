// packages/lib/src/accounting/sales/orders/reads.ts

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
 * 🔑 As of entity migration 153 the shipment history itself is no longer read
 * here at all: `order_fulfillments` is a has_many RELATIONSHIP to real
 * `fulfillment` records, and the has_many (inverse) side of a relationship
 * carries no `FieldValue` row of its own to read. `readFulfillmentsForOrder`
 * (`sales/fulfillments`) resolves it from the `fulfillment` side instead
 * (`plans/money/tasks/55-shipment-lines.md` §6).
 */

import type { Database, Transaction } from '@auxx/database'
import type { Result } from 'neverthrow'
import { NotFoundError, UnprocessableEntityError } from '../../../errors'
import {
  LINE_ITEM_FIELDS,
  LINE_ITEM_GIFT_CARD_CATEGORY,
} from '../../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { TAX_LINE_FIELDS } from '../../../resources/registry/resources/tax-line-fields'
import {
  type DeclaredSystemAttributes,
  pickSystemAttributes,
} from '../../../resources/registry/system-attributes'
import type { RecordId } from '../../../resources/resource-id'
import {
  readSystemRecords,
  type SystemRecord,
  systemFields,
} from '../../../resources/system-records'
// Leaf submodules, not the `../fulfillments` barrel - that barrel re-exports
// `stamp-totals.ts`, which reads an order through THIS file, so importing the
// barrel here would cycle back to it.
import { requireFulfillmentFieldContext } from '../fulfillments/fields'
import { readFulfillmentsForOrder } from '../fulfillments/reads'
import type { Fulfillment } from '../fulfillments/types'
import {
  netLineTotalMinor,
  netUnitPriceMinor,
  nextFulfillmentSequence,
  type OrderLineRemaining,
  shippedByLine,
  shippingStillOwed,
} from './client'
import { guard } from './guard'

/**
 * Every `order` attribute a fulfillment reads.
 *
 * `order_line_items` is deliberately absent: it is the has_many INVERSE of
 * `line_item.order` and carries no `FieldValue` row of its own, so the lines
 * come from the child side through {@link readOrderLines}.
 */
const ORDER_PICK = pickSystemAttributes(ORDER_FIELDS, [
  'order_number',
  'order_channel',
  'order_currency',
  'order_subtotal',
  'order_tax_total',
  'order_shipping_total',
  'order_total',
  'order_fulfillment_status',
  'order_contact',
] as const)

/**
 * Every `line_item` attribute a fulfillment reads — `line_item_order` is added
 * by {@link readOrderLines}, which filters on it.
 *
 * `line_item_net_total` is the line NET and the basis of the rate a
 * shipment recognises at; `line_item_line_total` is the GROSS total and its
 * fallback for a line with no net yet, and `line_item_unit_price` is the gross
 * price and the last resort (`netUnitPriceMinor`, 29 §1.7, §2.3). Dropping
 * either total from this list would not fail anything: every line would
 * silently fall back a rung and the discount would be recognised as revenue
 * again.
 */
const FULFILLMENT_LINE_PICK = pickSystemAttributes(LINE_ITEM_FIELDS, [
  'line_item_name',
  'line_item_qty',
  'line_item_unit_price',
  'line_item_line_total',
  'line_item_net_total',
  'line_item_tax_total',
  'line_item_sort_order',
  'line_item_category',
] as const)

/** Every `tax_line` attribute the jurisdiction split reads (brief 13 §5). */
const TAX_LINE_PICK = pickSystemAttributes(TAX_LINE_FIELDS, [
  'tax_line_title',
  'tax_line_price',
] as const)

/** The relationship every `line_item` hangs off, and the filter {@link readOrderLines} applies. */
const LINE_ITEM_PARENT = 'line_item_order'

/** Any `line_item` attribute the registry declares as a stored value. */
export type LineItemAttribute = DeclaredSystemAttributes<typeof LINE_ITEM_FIELDS>

/** One order's jurisdiction, as `splitTaxByJurisdiction` wants it. */
export interface OrderTaxLine {
  title: string
  priceMinor: number
}

/**
 * The live `line_item` records of one or more orders, with `attributes` typed
 * by name — the one reader for "lines of an order".
 *
 * `line_item_order` is always fetched, so the caller can group a multi-order
 * read by `record.related('line_item_order')`. Empty, never a refusal, when the
 * org has no `line_item` def or no `line_item.order` field yet.
 */
export async function readOrderLines<const A extends readonly LineItemAttribute[]>(
  db: Database | Transaction,
  organizationId: string,
  orderIds: readonly string[],
  attributes: A
): Promise<SystemRecord<A[number] | typeof LINE_ITEM_PARENT>[]> {
  if (orderIds.length === 0) return []
  const ctx = await systemFields(db, organizationId, 'line_item', [LINE_ITEM_PARENT, ...attributes])
  if (!ctx?.fields[LINE_ITEM_PARENT]) return []
  return readSystemRecords(db, organizationId, ctx, {
    by: { attribute: LINE_ITEM_PARENT, in: orderIds },
  })
}

/**
 * {@link OrderLineRemaining} plus the whole-line NET amount, which the builder
 * allocates by units across a split line (29 §12 item 6) - the derived
 * `unitPriceMinor` alone cannot do that, because 181 over 2 units is a 90.5
 * rate and two shipments of one unit each extend to 182.
 */
export interface OrderLineForFulfillment extends OrderLineRemaining {
  /**
   * The line NET for the WHOLE line, minor units: `line_item_net_total` when
   * the line has one, else `line_item_line_total`, else null
   * (`netLineTotalMinor`, 29 §2.3). The same column `unitPriceMinor` was
   * derived from, so the split allocation and the rate agree.
   */
  lineTotalMinor: number | null
  /**
   * `line_item_line_total` (the list total) when the net came from `line_item_net_total`, else
   * null: list minus net is the discount the shipment debits (91 D8).
   */
  listLineTotalMinor: number | null
  /** `line_item_category` is `gift_card`: the line sells a liability, never revenue. */
  giftCard: boolean
}

/** One order, everything the fulfillment builder and the dialog need, in one shape. */
export interface OrderForFulfillment {
  orderId: string
  /** What a `UnifiedCrudHandler.update` takes. */
  recordId: RecordId
  number: string | null
  /** `order_channel`, verbatim - `manual` and `null` are both refused downstream. */
  channel: string | null
  currency: string | null
  subtotalMinor: number
  taxTotalMinor: number
  shippingTotalMinor: number
  totalMinor: number
  fulfillmentStatus: string | null
  /** Every `fulfillment` record, oldest first. Empty when nothing has shipped. */
  fulfillments: Fulfillment[]
  /** The order's lines with what is still to ship on each, in display order. */
  lines: OrderLineForFulfillment[]
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
   * `taxTotalMinor` - see `accounting/ledger/builders/split-tax-by-jurisdiction.ts`.
   */
  taxLines: OrderTaxLine[]
}

/**
 * Every named order's own tax lines, in ONE bulk read - never one query per
 * order (brief 13 §5).
 *
 * An empty map, not a refusal, when the org has no `tax_line` def yet
 * (pre-migration-136) - the caller then falls back to the single undimensioned
 * tax line, which is `splitTaxByJurisdiction`'s documented behaviour for "no
 * tax lines at all".
 */
export async function readOrderTaxLines(
  db: Database | Transaction,
  organizationId: string,
  orderIds: readonly string[]
): Promise<Map<string, OrderTaxLine[]>> {
  const byOrder = new Map<string, OrderTaxLine[]>()
  if (orderIds.length === 0) return byOrder

  const ctx = await systemFields(db, organizationId, 'tax_line', [
    'tax_line_order',
    ...TAX_LINE_PICK,
  ])
  if (!ctx?.fields.tax_line_order) return byOrder

  // `includeArchived`: the read this replaces never joined `EntityInstance` at
  // all, and a dropped jurisdiction would not fail - it would silently stop
  // tying to `order_tax_total` and fall back to one undimensioned line.
  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'tax_line_order', in: orderIds },
    includeArchived: true,
  })

  for (const record of records) {
    const orderId = record.related('tax_line_order')
    const title = record.text('tax_line_title')?.trim()
    const priceMinor = record.number('tax_line_price')
    // A tax line missing either value cannot enter the split - it would
    // silently understate the total it has to tie to.
    if (!orderId || !title || priceMinor == null) continue
    const list = byOrder.get(orderId)
    if (list) list.push({ title, priceMinor })
    else byOrder.set(orderId, [{ title, priceMinor }])
  }
  return byOrder
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
  db: Database | Transaction,
  params: { organizationId: string; orderId: string }
): Promise<Result<OrderForFulfillment, Error>> {
  const { organizationId, orderId } = params

  return guard(
    async () => {
      const ctx = await systemFields(db, organizationId, 'order', ORDER_PICK)
      // Without the number there is no period key to post against, and a
      // fulfillment that silently recorded nothing would be worse than a
      // refusal: the entry would still post and the next shipment would
      // recognise the same revenue again.
      if (!ctx?.fields.order_number) {
        throw new UnprocessableEntityError(
          'Fulfilling an order is not available until the order entity is provisioned ' +
            '(entity migration 125). Without order_number there is no period key to post against.'
        )
      }
      // Provisioning of the fulfillment entities is a separate concern from
      // the order's own fields (sales/fulfillments/reads.ts owns it) - both
      // are required for a fulfillment to have anywhere to be recorded.
      await requireFulfillmentFieldContext(db, organizationId)

      const [order] = await readSystemRecords(db, organizationId, ctx, { ids: [orderId] })
      if (!order) {
        throw new NotFoundError('That order does not exist in this organization')
      }

      const fulfillments = await readFulfillmentsForOrder(db, { organizationId, orderId })
      const shipped = shippedByLine(fulfillments)
      const lineRecords = await readOrderLines(db, organizationId, [orderId], FULFILLMENT_LINE_PICK)
      const taxLines = (await readOrderTaxLines(db, organizationId, [orderId])).get(orderId) ?? []

      return {
        orderId,
        recordId: order.recordId,
        number: order.text('order_number'),
        channel: order.option('order_channel'),
        currency: order.text('order_currency'),
        subtotalMinor: order.number('order_subtotal') ?? 0,
        taxTotalMinor: order.number('order_tax_total') ?? 0,
        shippingTotalMinor: order.number('order_shipping_total') ?? 0,
        totalMinor: order.number('order_total') ?? 0,
        fulfillmentStatus: order.option('order_fulfillment_status'),
        fulfillments,
        lines: shapeLines(lineRecords, shipped),
        nextSequence: nextFulfillmentSequence(fulfillments),
        shippingOwed: shippingStillOwed(fulfillments),
        contactInstanceId: order.related('order_contact'),
        taxLines,
      }
    },
    'Failed to read an order for fulfillment',
    { organizationId, orderId }
  )
}

/** The order's line records, with what is still to ship on each, in display order. */
function shapeLines(
  records: SystemRecord<(typeof FULFILLMENT_LINE_PICK)[number] | typeof LINE_ITEM_PARENT>[],
  shipped: Map<string, number>
): OrderLineForFulfillment[] {
  const lines = records.map((record, index) => {
    const quantity = record.number('line_item_qty') ?? 0
    const shippedQuantity = shipped.get(record.id) ?? 0
    const totals = {
      netTotalMinor: record.number('line_item_net_total'),
      lineTotalMinor: record.number('line_item_line_total'),
    }
    return {
      lineId: record.id,
      name: record.text('line_item_name') ?? 'Line item',
      quantity,
      shippedQuantity,
      remainingQuantity: Math.max(0, quantity - shippedQuantity),
      // The line NET per unit, never the gross price on its own (29 §1.7).
      unitPriceMinor: netUnitPriceMinor({
        ...totals,
        unitPriceMinor: record.number('line_item_unit_price'),
        orderedQuantity: quantity,
      }),
      // The whole line's NET (net_total, else line_total), so `fulfill.ts` can
      // hand the builder the allocation basis rather than only the derived
      // rate (29 §12 item 6) - and the same column the rate came from.
      lineTotalMinor: netLineTotalMinor(totals),
      // 🛑 `?? null`, never `?? 0`. An absent row and a zero row are different
      // facts, and the builder branches on the difference: every line carrying
      // a number switches the entry to per-line tax, one null falls back to
      // allocating the order's total. See `OrderLineRemaining.lineTaxMinor`.
      lineTaxMinor: record.number('line_item_tax_total'),
      listLineTotalMinor:
        totals.netTotalMinor != null && Number.isFinite(totals.netTotalMinor)
          ? (totals.lineTotalMinor ?? null)
          : null,
      giftCard: record.option('line_item_category') === LINE_ITEM_GIFT_CARD_CATEGORY,
      sortOrder: record.number('line_item_sort_order') ?? index,
    }
  })

  return lines.sort((a, b) => a.sortOrder - b.sortOrder)
}
