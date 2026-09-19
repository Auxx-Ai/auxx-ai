// packages/lib/src/field-hooks/pre/vendor-bill-lock.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray } from 'drizzle-orm'
import { readBillEditOpen } from '../../accounting/purchasing/bill-edit-flag'
import { getOrgCache } from '../../cache'
import { ConflictError } from '../../errors'
import { unwrapRelationId } from '../../resources/events/captured-values'
import { VendorBillStatus } from '../../resources/registry/enum-values'
import type { EntityPreCreateHandler, EntityPreDeleteHandler, FieldPreHookHandler } from '../types'

/**
 * The `vendor_bill` fields a posted bill freezes: what it asks for, when, and
 * from whom. Everything the entry is built from (73 D4).
 */
export const VENDOR_BILL_LOCKED_ATTRS = [
  'vendor_bill_total',
  'vendor_bill_subtotal',
  'vendor_bill_shipping_total',
  'vendor_bill_tax_total',
  'vendor_bill_discount',
  'vendor_bill_billed_at',
  'vendor_bill_vendor',
  'vendor_bill_purchase_order',
] as const satisfies readonly SystemAttribute[]

/** The `vendor_bill_line` fields a posted bill's lines freeze. */
export const VENDOR_BILL_LINE_LOCKED_ATTRS = [
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_unit_price',
  'vendor_bill_line_line_total',
  'vendor_bill_line_gl_account',
  'vendor_bill_line_purchase_order_line',
] as const satisfies readonly SystemAttribute[]

/** The line's link to its parent, resolved on every path this file guards. */
const LINE_PARENT_ATTR: SystemAttribute = 'vendor_bill_line_vendor_bill'

/**
 * A posted vendor bill is READ-ONLY until somebody presses Edit (73 D4).
 *
 * ```
 * draft ──[Post]──▶ posted ──[Edit]──▶ editing ──[Save]──▶ posted
 *  editable          locked            editable            reverse + repost if changed
 *                    └──[Void]──▶ void
 * ```
 *
 * 🛑 **The predicate is `posted` AND no `editOpen` flag, on the BILL — never the
 * line's own state.** A bill line has no lifecycle of its own; the document it
 * belongs to has one, and it is the document that is in the books. So every
 * guard below resolves the parent bill first and asks it the same two questions.
 *
 * ⚠️ **What is deliberately NOT locked.** The three-way match keeps reading and
 * writing its own fields on a posted bill (`vendor_bill_match_status`,
 * `_match_variance`, `_match_notes`) — the verdict is a status calculation with
 * no ledger effect and it is the exception queue, so freezing it would freeze
 * the queue. The money axis is not locked either: `syncVendorBillPaymentState`
 * is the only writer of `amount_paid`, `paid_at`, `payment_status` and
 * `amount_credited`, and a payment against a posted bill is the ordinary case.
 * `vendor_bill_status` itself stays open, because Void writes it.
 *
 * ✅ A write that does not change the value is still refused here, unlike
 * `purchase-order-line-evidence-lock.ts`. That lock had to let a re-import
 * restate an unchanged row; this one guards a surface — the line builder and the
 * drawer — that only ever sends what a person typed, and reading the stored
 * value to compare would cost a query per field on the hot autosave path.
 *
 * ✅ **Sanctioned writers use `bypassFieldGuards`.** `fireFieldPreHooks`
 * short-circuits on `ctx.bypassFieldGuards.has(systemAttribute)` before this
 * handler runs. `postVendorBill` needs no bypass: it stamps
 * `vendor_bill_billed_at` in the same write that flips the status, while the
 * STORED status is still `draft`.
 */
export const guardPostedVendorBillFields: FieldPreHookHandler = async (event) => {
  const billInstanceId = parseRecordId(event.recordId).entityInstanceId
  await refuseWhenLocked(
    event.organizationId,
    billInstanceId,
    describeBillField(event.systemAttribute)
  )
  return event.newValue
}

/** The same lock, reached through a line's parent. */
export const guardPostedVendorBillLineFields: FieldPreHookHandler = async (event) => {
  const lineInstanceId = parseRecordId(event.recordId).entityInstanceId
  const billInstanceId = await readLineParent(event.organizationId, lineInstanceId)
  // A line with no parent yet is a draft row the builder has not attached; it
  // belongs to no bill and no bill's lock can speak for it.
  if (!billInstanceId) return event.newValue
  await refuseWhenLocked(
    event.organizationId,
    billInstanceId,
    describeLineField(event.systemAttribute)
  )
  return event.newValue
}

/** A posted bill gains no lines. */
export const guardPostedVendorBillLineCreate: EntityPreCreateHandler = async (event) => {
  const billInstanceId = unwrapRelationId(
    event.values[LINE_PARENT_ATTR] ?? event.values.vendor_bill_line_vendor_bill
  )
  if (!billInstanceId) return
  await refuseWhenLocked(event.organizationId, billInstanceId, 'add a line')
}

/** And loses none. */
export const guardPostedVendorBillLineDelete: EntityPreDeleteHandler = async (event) => {
  const billInstanceId = unwrapRelationId(event.values[LINE_PARENT_ATTR])
  if (!billInstanceId) return
  await refuseWhenLocked(event.organizationId, billInstanceId, 'remove a line')
}

/** The one refusal, named for the bill it is protecting. */
async function refuseWhenLocked(
  organizationId: string,
  billInstanceId: string,
  what: string
): Promise<void> {
  const bill = await readBillLockState(organizationId, billInstanceId)
  if (!bill || bill.status !== VendorBillStatus.POSTED) return
  if (await readBillEditOpen(database, organizationId, billInstanceId)) return

  throw new ConflictError(
    `Bill ${bill.label} is posted and in the books, so you cannot ${what}. Press Edit to ` +
      'unlock it, then Save to bring its entry up to date — or void it and raise a new one.',
    { vendorBillInstanceId: billInstanceId, status: bill.status }
  )
}

/** The bill's stored lifecycle value and the reference a refusal names it by. */
async function readBillLockState(
  organizationId: string,
  billInstanceId: string
): Promise<{ status: string; label: string } | null> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([
      'vendor_bill_status',
      'vendor_bill_internal_number',
      'vendor_bill_number',
    ])

  const statusField = fields.vendor_bill_status
  if (!statusField) return null

  const fieldIds = [
    statusField.id,
    fields.vendor_bill_internal_number?.id,
    fields.vendor_bill_number?.id,
  ].filter((id): id is string => !!id)

  const rows = await database
    .select({
      fieldId: schema.FieldValue.fieldId,
      optionId: schema.FieldValue.optionId,
      valueText: schema.FieldValue.valueText,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, billInstanceId),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  const byField = new Map(rows.map((row) => [row.fieldId, row]))
  const status = byField.get(statusField.id)?.optionId
  if (!status) return null

  const label =
    (fields.vendor_bill_internal_number &&
      byField.get(fields.vendor_bill_internal_number.id)?.valueText) ||
    (fields.vendor_bill_number && byField.get(fields.vendor_bill_number.id)?.valueText) ||
    'this bill'

  return { status, label }
}

/** The bill one line belongs to, or `undefined` while it belongs to none. */
async function readLineParent(
  organizationId: string,
  lineInstanceId: string
): Promise<string | undefined> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([LINE_PARENT_ATTR])
  const parentField = fields[LINE_PARENT_ATTR]
  if (!parentField) return undefined

  const [row] = await database
    .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, lineInstanceId),
        eq(schema.FieldValue.fieldId, parentField.id)
      )
    )
    .limit(1)
  return row?.relatedEntityId ?? undefined
}

/** What the person was trying to change, in the words on the screen. */
function describeBillField(attribute: SystemAttribute): string {
  switch (attribute) {
    case 'vendor_bill_total':
      return 'change its total'
    case 'vendor_bill_subtotal':
      return 'change its subtotal'
    case 'vendor_bill_shipping_total':
      return 'change its shipping'
    case 'vendor_bill_tax_total':
      return 'change its tax'
    case 'vendor_bill_discount':
      return 'change its discount'
    case 'vendor_bill_billed_at':
      return 'change its date'
    case 'vendor_bill_vendor':
      return 'change its vendor'
    default:
      return 'change its purchase order'
  }
}

function describeLineField(attribute: SystemAttribute): string {
  switch (attribute) {
    case 'vendor_bill_line_quantity_billed':
      return "change a line's quantity"
    case 'vendor_bill_line_unit_price':
      return "change a line's unit price"
    case 'vendor_bill_line_line_total':
      return "change a line's amount"
    case 'vendor_bill_line_gl_account':
      return "change a line's account"
    default:
      return "change a line's purchase order link"
  }
}
