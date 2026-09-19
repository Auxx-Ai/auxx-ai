// packages/lib/src/field-hooks/pre/invoice-lock.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { readEditStamp } from '../../entity-instances/edit-snapshot'
import { ConflictError } from '../../errors'
import { unwrapRelationId } from '../../resources/events/captured-values'
import type { EntityPreCreateHandler, EntityPreDeleteHandler, FieldPreHookHandler } from '../types'

/**
 * The `invoice` header fields an issued invoice freezes (74 §1.3).
 *
 * 🛑 `invoice_total`, `_subtotal` and `_tax_total` are deliberately absent: the
 * totals engine is their only writer and it recomputes them from the lines, so
 * locking them here would freeze the recompute rather than the person. What a
 * person can type is the discount, the rate, the date and the customer.
 */
export const INVOICE_LOCKED_ATTRS = [
  'invoice_discount_type',
  'invoice_discount_value',
  'invoice_tax_rate',
  'invoice_issued_at',
  'invoice_contact',
] as const satisfies readonly SystemAttribute[]

/** The `line_item` fields an issued invoice's lines freeze. */
export const INVOICE_LINE_LOCKED_ATTRS = [
  'line_item_qty',
  'line_item_unit_price',
  'line_item_taxable',
  'line_item_discount',
  'line_item_invoice',
] as const satisfies readonly SystemAttribute[]

/** The line's link to its parent invoice, resolved on every path this file guards. */
const LINE_PARENT_ATTR: SystemAttribute = 'line_item_invoice'

/** Statuses that are not in the books, so nothing is locked. */
const UNLOCKED_INVOICE_STATUSES: ReadonlySet<string> = new Set(['draft'])

/**
 * An issued invoice is READ-ONLY until somebody presses Edit (74 §1.3).
 *
 * ```
 * draft ──[Send]──▶ sent ──[Edit]──▶ editing ──[Save]──▶ sent
 *  editable         locked           editable            reverse + repost if changed
 *                   └──[Void / Write off]──▶ terminal, and Edit is refused there
 * ```
 *
 * 🛑 **The predicate is "not `draft`" AND no edit-snapshot row, on the INVOICE
 * — never the line's own state.** The row's existence IS the edit flag (74 D1).
 * `void` and `written_off` therefore stay frozen for good, because the lane
 * refuses to open an edit on them and no row can ever exist.
 *
 * ⚠️ **What is deliberately NOT locked.** The money axis:
 * `invoice-payments/payment-state.ts` is the only writer of `amount_paid`,
 * `amount_credited`, `balance` and the `partially_paid`/`paid` flips, and a
 * payment against an issued invoice is the ordinary case. `invoice_status`
 * itself stays open, because Void and the write-off write it — it has its own
 * guard in `lifecycle-status-guard.ts`.
 *
 * ✅ A `line_item` may belong to a quote, an order or a work order instead, so
 * every guard below resolves the parent INVOICE first and returns when there is
 * none: that line is not this lock's business.
 */
export const guardIssuedInvoiceFields: FieldPreHookHandler = async (event) => {
  const invoiceInstanceId = parseRecordId(event.recordId).entityInstanceId
  await refuseWhenLocked(
    event.organizationId,
    invoiceInstanceId,
    describeInvoiceField(event.systemAttribute)
  )
  return event.newValue
}

/** The same lock, reached through a line's parent. */
export const guardIssuedInvoiceLineFields: FieldPreHookHandler = async (event) => {
  const lineInstanceId = parseRecordId(event.recordId).entityInstanceId
  const invoiceInstanceId = await readLineParent(event.organizationId, lineInstanceId)
  if (!invoiceInstanceId) return event.newValue
  await refuseWhenLocked(
    event.organizationId,
    invoiceInstanceId,
    describeLineField(event.systemAttribute)
  )
  return event.newValue
}

/** An issued invoice gains no lines. */
export const guardIssuedInvoiceLineCreate: EntityPreCreateHandler = async (event) => {
  const invoiceInstanceId = unwrapRelationId(event.values[LINE_PARENT_ATTR])
  if (!invoiceInstanceId) return
  await refuseWhenLocked(event.organizationId, invoiceInstanceId, 'add a line')
}

/** And loses none. */
export const guardIssuedInvoiceLineDelete: EntityPreDeleteHandler = async (event) => {
  const invoiceInstanceId = unwrapRelationId(event.values[LINE_PARENT_ATTR])
  if (!invoiceInstanceId) return
  await refuseWhenLocked(event.organizationId, invoiceInstanceId, 'remove a line')
}

/** The one refusal, named for the invoice it is protecting. */
async function refuseWhenLocked(
  organizationId: string,
  invoiceInstanceId: string,
  what: string
): Promise<void> {
  const invoice = await readInvoiceLockState(organizationId, invoiceInstanceId)
  if (!invoice || UNLOCKED_INVOICE_STATUSES.has(invoice.status)) return
  if (await readEditStamp(database, organizationId, invoiceInstanceId)) return

  throw new ConflictError(
    `Invoice ${invoice.label} has been issued, so you cannot ${what}. Press Edit to unlock it, ` +
      'then Save to bring its ledger entry up to date — or void it and raise a new one.',
    { invoiceInstanceId, status: invoice.status }
  )
}

/** The invoice's stored lifecycle value and the reference a refusal names it by. */
async function readInvoiceLockState(
  organizationId: string,
  invoiceInstanceId: string
): Promise<{ status: string; label: string } | null> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>(['invoice_status', 'invoice_number'])

  const statusField = fields.invoice_status
  if (!statusField) return null

  const fieldIds = [statusField.id, fields.invoice_number?.id].filter((id): id is string => !!id)

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
        eq(schema.FieldValue.entityId, invoiceInstanceId),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  const byField = new Map(rows.map((row) => [row.fieldId, row]))
  const status = byField.get(statusField.id)?.optionId
  if (!status) return null

  const label =
    (fields.invoice_number && byField.get(fields.invoice_number.id)?.valueText) || 'this invoice'
  return { status, label }
}

/** The invoice one line belongs to, or `undefined` when it belongs to none. */
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
function describeInvoiceField(attribute: SystemAttribute): string {
  switch (attribute) {
    case 'invoice_discount_type':
    case 'invoice_discount_value':
      return 'change its discount'
    case 'invoice_tax_rate':
      return 'change its tax rate'
    case 'invoice_issued_at':
      return 'change its date'
    default:
      return 'change its customer'
  }
}

function describeLineField(attribute: SystemAttribute): string {
  switch (attribute) {
    case 'line_item_qty':
      return "change a line's quantity"
    case 'line_item_unit_price':
      return "change a line's unit price"
    case 'line_item_taxable':
      return 'change whether a line is taxable'
    case 'line_item_discount':
      return "change a line's discount"
    default:
      return 'move a line to another invoice'
  }
}
