// packages/lib/src/purchasing/expense-bill/reads.ts
//
// Reading one vendor bill and its coded lines, as the expense-bill posting path
// needs them. Reads only: the writer is `writes.ts`
// (`docs/lib-module-guide.md` §5).
//
// Cells come through `readSystemRecords` rather than off `FieldValue`'s own
// columns, so a relationship is read as the record it points at and the
// per-column guessing is gone (plan §3b).
//
// No permission checks anywhere in this file. The router asserts (§6).

import type { Database } from '@auxx/database'
import { toCalendarDay } from '@auxx/utils/calendar-day'
import { NotFoundError } from '../../errors'
import { PURCHASE_ORDER_LINE_FIELDS } from '../../resources/registry/resources/purchase-order-line-fields'
import { VENDOR_BILL_FIELDS } from '../../resources/registry/resources/vendor-bill-fields'
import { VENDOR_BILL_LINE_FIELDS } from '../../resources/registry/resources/vendor-bill-line-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { getInstanceId } from '../../resources/resource-id'
import { readSystemRecords, systemFields } from '../../resources/system-records'

/** Every `vendor_bill` attribute the posting path reads. */
const VENDOR_BILL_ATTRIBUTES = pickSystemAttributes(VENDOR_BILL_FIELDS, [
  'vendor_bill_number',
  'vendor_bill_internal_number',
  'vendor_bill_status',
  'vendor_bill_payment_status',
  'vendor_bill_amount_paid',
  'vendor_bill_amount_credited',
  'vendor_bill_billed_at',
  'vendor_bill_currency',
  'vendor_bill_subtotal',
  'vendor_bill_shipping_total',
  'vendor_bill_tax_total',
  'vendor_bill_discount',
  'vendor_bill_total',
  'vendor_bill_vendor',
  'vendor_bill_purchase_order',
  'vendor_bill_lines',
] as const)

/** Every `vendor_bill_line` attribute the posting path reads. */
const VENDOR_BILL_LINE_ATTRIBUTES = pickSystemAttributes(VENDOR_BILL_LINE_FIELDS, [
  'vendor_bill_line_description',
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_line_total',
  'vendor_bill_line_gl_account',
  'vendor_bill_line_purchase_order_line',
  'vendor_bill_line_sort_order',
] as const)

/** The order-line figures a LINKED bill line is posted against (73 D2). */
const PURCHASE_ORDER_LINE_ATTRIBUTES = pickSystemAttributes(PURCHASE_ORDER_LINE_FIELDS, [
  'purchase_order_line_expected_unit_price',
] as const)

/** One line of a bill, as the builder reads it. */
export interface VendorBillLineRecord {
  id: string
  description: string | null
  /** Integer minor units. `0` when the line carries no total at all. */
  lineTotalMinor: number
  /** Units the vendor is billing for, or `null` when none is typed. */
  quantityBilled: number | null
  /** The `gl_account` instance id, or `null` when the line is uncoded. */
  glAccountId: string | null
  /** The `purchase_order_line` this line matches, or `null` when unlinked. */
  purchaseOrderLineId: string | null
  /** The agreed unit price off that order line, integer minor units. */
  unitPriceExpectedMinor: number | null
  sortOrder: number
}

/** One vendor bill's header, as the expense-bill posting path reads it. */
export interface VendorBillRecord {
  id: string
  /** The VENDOR's own invoice number. For messages, never for the claim key. */
  number: string
  /** OURS - `BILL-0007`. What the entry's period key and document number key on. */
  internalNumber: string
  status: string
  /** The money axis (73 D1): `unpaid`, `partially_paid` or `paid`. */
  paymentStatus: string
  /** Integer minor units, settled in cash. The Save floor (73 D4). */
  amountPaidMinor: number
  /** Integer minor units, settled by vendor credit. The same floor. */
  amountCreditedMinor: number
  /** `YYYY-MM-DD`, or `null` when the bill has not been dated yet. */
  billedAt: string | null
  currency: string | null
  /** Integer minor units. Transcribed from the vendor's document, never derived. */
  totalMinor: number
  subtotalMinor: number
  shippingMinor: number
  taxMinor: number
  discountMinor: number
  /** The `company` instance id this bill is owed to. The A/P counterparty. */
  vendorCompanyInstanceId: string | null
  /** The `purchase_order` the bill was raised from, when it names one. */
  purchaseOrderId: string | null
  lineIds: string[]
}

/**
 * Read one bill's header, or `null` when it does not exist, is archived, or the
 * org has not seeded the `vendor_bill` def.
 */
export async function loadVendorBill(
  db: Database,
  organizationId: string,
  vendorBillId: string
): Promise<VendorBillRecord | null> {
  const ctx = await systemFields(db, organizationId, 'vendor_bill', VENDOR_BILL_ATTRIBUTES)
  if (!ctx?.fields.vendor_bill_status || !ctx.fields.vendor_bill_total) return null

  const [bill] = await readSystemRecords(db, organizationId, ctx, { ids: [vendorBillId] })
  if (!bill) return null

  return {
    id: vendorBillId,
    number: bill.text('vendor_bill_number') ?? '',
    internalNumber: bill.text('vendor_bill_internal_number') ?? '',
    // A bill created before the status field carried a default reads as its own
    // default rather than as a blank the postable-status wall would let through.
    status: bill.option('vendor_bill_status') ?? 'draft',
    paymentStatus: bill.option('vendor_bill_payment_status') ?? 'unpaid',
    amountPaidMinor: bill.number('vendor_bill_amount_paid') ?? 0,
    amountCreditedMinor: bill.number('vendor_bill_amount_credited') ?? 0,
    billedAt: toCalendarDay(bill.date('vendor_bill_billed_at')),
    currency: bill.text('vendor_bill_currency'),
    totalMinor: bill.number('vendor_bill_total') ?? 0,
    subtotalMinor: bill.number('vendor_bill_subtotal') ?? 0,
    shippingMinor: bill.number('vendor_bill_shipping_total') ?? 0,
    taxMinor: bill.number('vendor_bill_tax_total') ?? 0,
    discountMinor: bill.number('vendor_bill_discount') ?? 0,
    vendorCompanyInstanceId: bill.related('vendor_bill_vendor'),
    purchaseOrderId: bill.related('vendor_bill_purchase_order'),
    lineIds: bill
      .cells('vendor_bill_lines')
      .map((value) =>
        value.type === 'relationship' && value.recordId ? getInstanceId(value.recordId) : null
      )
      .filter((id): id is string => !!id),
  }
}

/** {@link loadVendorBill}, as the refusal a writer needs. */
export async function requireVendorBill(
  db: Database,
  organizationId: string,
  vendorBillId: string
): Promise<VendorBillRecord> {
  const bill = await loadVendorBill(db, organizationId, vendorBillId)
  if (!bill) throw new NotFoundError('Vendor bill not found', { vendorBillId })
  return bill
}

/** The bill's lines, in display order. Archived lines are dropped. */
export async function loadVendorBillLines(
  db: Database,
  organizationId: string,
  lineIds: readonly string[]
): Promise<VendorBillLineRecord[]> {
  if (lineIds.length === 0) return []
  const ctx = await systemFields(
    db,
    organizationId,
    'vendor_bill_line',
    VENDOR_BILL_LINE_ATTRIBUTES
  )
  if (!ctx) return []

  const records = await readSystemRecords(db, organizationId, ctx, { ids: lineIds })
  const byId = new Map(records.map((record) => [record.id, record]))

  // Walked in the order the bill named them, not the reader's `createdAt` order:
  // the position is the fallback when a line carries no `sortOrder`.
  const lines = lineIds
    .map((lineId) => byId.get(lineId))
    .filter((line) => line !== undefined)
    .map((line, index) => ({
      id: line.id,
      description: line.text('vendor_bill_line_description'),
      lineTotalMinor: line.number('vendor_bill_line_line_total') ?? 0,
      quantityBilled: line.number('vendor_bill_line_quantity_billed'),
      glAccountId: line.text('vendor_bill_line_gl_account'),
      purchaseOrderLineId: line.related('vendor_bill_line_purchase_order_line'),
      unitPriceExpectedMinor: null as number | null,
      sortOrder: line.number('vendor_bill_line_sort_order') ?? index,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const expected = await loadExpectedUnitPrices(
    db,
    organizationId,
    lines.map((line) => line.purchaseOrderLineId).filter((id): id is string => !!id)
  )
  for (const line of lines) {
    line.unitPriceExpectedMinor = line.purchaseOrderLineId
      ? (expected.get(line.purchaseOrderLineId) ?? null)
      : null
  }
  return lines
}

/** The agreed unit price per order line, integer minor units. */
async function loadExpectedUnitPrices(
  db: Database,
  organizationId: string,
  purchaseOrderLineIds: readonly string[]
): Promise<Map<string, number | null>> {
  if (purchaseOrderLineIds.length === 0) return new Map()
  const ctx = await systemFields(
    db,
    organizationId,
    'purchase_order_line',
    PURCHASE_ORDER_LINE_ATTRIBUTES
  )
  if (!ctx) return new Map()
  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: [...new Set(purchaseOrderLineIds)],
  })
  return new Map(
    records.map((record) => [record.id, record.number('purchase_order_line_expected_unit_price')])
  )
}
