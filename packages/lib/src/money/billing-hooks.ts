// packages/lib/src/money/billing-hooks.ts

import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import type {
  EntityFieldChangeHandler,
  EntityPostDeleteHandler,
  EntityPreDeleteHandler,
  FieldPreHookHandler,
} from '../field-hooks'
import { UnifiedCrudHandler } from '../resources/crud'
import { assertBillingConfigurationCompatible } from './billing-config'
// Only the (never-registered) `syncBillingOnContactChange` still calls a projector
// directly; every live hook marks instead, and the drain imports them lazily.
import { syncContactBillingProjection } from './billing-projection'
import {
  markOrSyncContact,
  markOrSyncInvoice,
  markOrSyncLine,
  markOrSyncWorkOrder,
} from './billing-reconciler'
import { recomputeTotals } from './totals-hooks'
import type { WorkOrderBillingBasis, WorkOrderInvoiceTiming } from './types'

/** Fields exclusively owned by billing projection writers. */
export const BILLING_PROJECTION_ATTRS = [
  'work_order_billing_state',
  'work_order_billing_amount',
  'work_order_amount_drafted',
  'work_order_amount_invoiced',
  'work_order_uninvoiced_amount',
  'work_order_balance_due',
  'work_order_invoice_count',
  'work_order_next_invoice_date',
  'work_order_billing_revision',
  'invoice_billing_kind',
  'invoice_service_period_start',
  'invoice_service_period_end',
  'invoice_visit_count',
  'invoice_progress_percent',
  'invoice_installment_name',
  'contact_balance_due',
  'contact_uninvoiced_amount',
  'contact_billing_revision',
] as const

/** Narrow bypass set granted only to the billing projector. */
export const BILLING_PROJECTION_BYPASS = new Set(BILLING_PROJECTION_ATTRS)

/**
 * Positive trigger-attribute allowlists (plan §4.6) — the three `syncBillingOn*` handlers below
 * otherwise fire a full billing-projection recompute on EVERY field write of their entity. Only
 * a write to one of these attributes can move a billing projection value.
 */
const LINE_ITEM_BILLING_TRIGGER_ATTRS = new Set([
  'line_item_qty',
  'line_item_unit_price',
  'line_item_discount',
  'line_item_taxable',
  'line_item_work_order',
  'line_item_invoice',
  'line_item_visit_id',
])

const WORK_ORDER_BILLING_TRIGGER_ATTRS = new Set([
  'work_order_number', // first-write init (plan §4.6) — projection seeds on the create path
  'work_order_pricing_model',
  'work_order_invoice_timing',
  'work_order_status',
  'work_order_contact', // billing-command contact resolution + contact-projection cascade
  'work_order_quote', // billing inheritance (discount/tax) source at invoice-creation time
])

// Deliberately excludes `invoice_amount_paid` (plan §4.6) — `syncInvoicePaymentState` writes
// `invoice_balance` right after, so gating on balance/total already covers the settled state.
const INVOICE_BILLING_TRIGGER_ATTRS = new Set([
  'invoice_work_order',
  'invoice_status',
  'invoice_balance',
  'invoice_total',
])

function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  return Array.isArray(entry) ? entry[0] : entry
}

function scalar(value: unknown): unknown {
  if (Array.isArray(value)) return scalar(value[0])
  if (value && typeof value === 'object') {
    // SELECT writes arrive as `{ type: 'option', optionId }` — the selection lives in
    // `optionId`, not `value` (mirrors `extractValue`'s option branch).
    if ('optionId' in value && (value as { optionId: unknown }).optionId != null) {
      return (value as { optionId: unknown }).optionId
    }
    if ('value' in value) {
      return (value as { value: unknown }).value
    }
  }
  return value
}

/** Drop direct writes to a projection-owned field unless the narrow projector bypass is present. */
export const guardBillingProjectionWrite: FieldPreHookHandler = async (event) => {
  return event.bypass.has(event.systemAttribute) ? event.newValue : undefined
}

/**
 * Validate basis/timing together before either configuration field is changed, and reject a
 * basis change once billing history exists (plan 24 §4.5): active allocations mean invoices
 * were generated under the current basis, and a live payment schedule is basis-specific. No
 * conversion flow exists yet, so the user must void/delete linked invoices or clear the
 * schedule first — silently reinterpreting billed history would corrupt the projection.
 */
export const guardBillingConfiguration: FieldPreHookHandler = async (event) => {
  const cache = getOrgCache()
  const fields = await cache
    .from(event.organizationId, 'customFields')
    .bySystemAttributes(['work_order_pricing_model', 'work_order_invoice_timing'] as const)
  const handler = new UnifiedCrudHandler(event.organizationId, event.userId ?? '')
  const fieldIds = [fields.work_order_pricing_model, fields.work_order_invoice_timing]
    .filter(Boolean)
    .map((field) => field!.id)
  const values = await handler.getFieldValues(event.recordId, fieldIds)

  const read = (field?: { id: string } | null) => {
    const typed = field ? firstTyped(values.get(field.id)) : undefined
    return typed ? extractValue(typed) : undefined
  }
  const currentBasis = read(fields.work_order_pricing_model)
  const basis =
    event.systemAttribute === 'work_order_pricing_model' ? scalar(event.newValue) : currentBasis
  const timing =
    event.systemAttribute === 'work_order_invoice_timing'
      ? scalar(event.newValue)
      : read(fields.work_order_invoice_timing)

  if (basis && timing) {
    assertBillingConfigurationCompatible(
      basis as WorkOrderBillingBasis,
      timing as WorkOrderInvoiceTiming
    )
  }

  if (
    event.systemAttribute === 'work_order_pricing_model' &&
    currentBasis &&
    basis &&
    basis !== currentBasis
  ) {
    const workOrderId = parseRecordId(event.recordId).entityInstanceId
    const [lineAllocation, visitAllocation, scheduleAllocation, installment] = await Promise.all([
      database.query.InvoiceLineAllocation.findFirst({
        where: and(
          eq(schema.InvoiceLineAllocation.organizationId, event.organizationId),
          eq(schema.InvoiceLineAllocation.workOrderId, workOrderId),
          eq(schema.InvoiceLineAllocation.status, 'active')
        ),
        columns: { id: true },
      }),
      database.query.InvoiceVisitAllocation.findFirst({
        where: and(
          eq(schema.InvoiceVisitAllocation.organizationId, event.organizationId),
          eq(schema.InvoiceVisitAllocation.workOrderId, workOrderId),
          eq(schema.InvoiceVisitAllocation.status, 'active')
        ),
        columns: { id: true },
      }),
      database.query.InvoiceScheduleAllocation.findFirst({
        where: and(
          eq(schema.InvoiceScheduleAllocation.organizationId, event.organizationId),
          eq(schema.InvoiceScheduleAllocation.workOrderId, workOrderId),
          eq(schema.InvoiceScheduleAllocation.status, 'active')
        ),
        columns: { id: true },
      }),
      database.query.WorkOrderBillingInstallment.findFirst({
        where: and(
          eq(schema.WorkOrderBillingInstallment.organizationId, event.organizationId),
          eq(schema.WorkOrderBillingInstallment.workOrderId, workOrderId),
          inArray(schema.WorkOrderBillingInstallment.status, ['pending', 'drafted', 'invoiced'])
        ),
        columns: { id: true },
      }),
    ])
    if (lineAllocation || visitAllocation || scheduleAllocation) {
      throw new BadRequestError(
        'This work order already has invoices billed under its current pricing model — void or delete them before changing it'
      )
    }
    if (installment) {
      throw new BadRequestError('Clear the payment schedule before changing the pricing model')
    }
  }
  return event.newValue
}

function inputScalar(value: unknown): unknown {
  if (Array.isArray(value)) return inputScalar(value[0])
  if (value && typeof value === 'object') {
    if ('value' in value) return (value as { value: unknown }).value
    if ('recordId' in value) return (value as { recordId: unknown }).recordId
  }
  return value
}

/** Prevent generic source edits from invalidating active allocation claims. */
export const guardAllocatedSourceLineChange: FieldPreHookHandler = async (event) => {
  const lineItemId = parseRecordId(event.recordId).entityInstanceId
  const allocations = await database.query.InvoiceLineAllocation.findMany({
    where: and(
      eq(schema.InvoiceLineAllocation.organizationId, event.organizationId),
      eq(schema.InvoiceLineAllocation.sourceLineItemId, lineItemId),
      eq(schema.InvoiceLineAllocation.status, 'active')
    ),
    columns: { amount: true, kind: true },
  })
  if (allocations.length === 0) return event.newValue

  if (
    event.systemAttribute === 'line_item_work_order' ||
    event.systemAttribute === 'line_item_visit_id'
  ) {
    const parentField = await getOrgCache()
      .from(event.organizationId, 'customFields')
      .bySystemAttribute(event.systemAttribute)
    if (parentField) {
      const handler = new UnifiedCrudHandler(event.organizationId, event.userId ?? '')
      const current = firstTyped(
        (await handler.getFieldValues(event.recordId, [parentField.id])).get(parentField.id)
      )
      if (String(inputScalar(current) ?? '') === String(inputScalar(event.newValue) ?? '')) {
        return event.newValue
      }
    }
    throw new BadRequestError('Remove this line from its draft invoice before moving it')
  }

  const contractAllocated = allocations
    .filter((allocation) => allocation.kind === 'contract')
    .reduce((total, allocation) => total + allocation.amount, 0)
  if (contractAllocated === 0) return event.newValue

  const fields = await getOrgCache()
    .from(event.organizationId, 'customFields')
    .bySystemAttributes(['line_item_qty', 'line_item_unit_price'] as const)
  const qtyField = fields.line_item_qty
  const unitPriceField = fields.line_item_unit_price
  if (!qtyField || !unitPriceField) return event.newValue

  const handler = new UnifiedCrudHandler(event.organizationId, event.userId ?? '')
  const current = await handler.getFieldValues(event.recordId, [qtyField.id, unitPriceField.id])
  const currentQty = firstTyped(current.get(qtyField.id))
  const currentPrice = firstTyped(current.get(unitPriceField.id))
  const requestedQty = event.allValues?.has(qtyField.id)
    ? event.allValues.get(qtyField.id)
    : event.systemAttribute === 'line_item_qty'
      ? event.newValue
      : currentQty
  const requestedPrice = event.allValues?.has(unitPriceField.id)
    ? event.allValues.get(unitPriceField.id)
    : event.systemAttribute === 'line_item_unit_price'
      ? event.newValue
      : currentPrice
  const qty = Number(inputScalar(requestedQty) ?? 0)
  const price = Number(inputScalar(requestedPrice) ?? 0)
  const nextTotal = Math.round(qty * price + Number.EPSILON)
  if (!Number.isFinite(nextTotal) || nextTotal < contractAllocated) {
    throw new BadRequestError(
      `This contract line already has ${contractAllocated} cents allocated to invoices`
    )
  }
  return event.newValue
}

/**
 * Source lines with active claims are removed only through draft/void billing lifecycle
 * commands. Invoice-owned line copies are also guarded here: their allocation FK cascades on
 * delete, so an unguarded generic delete would silently hard-delete an active allocation —
 * on an issued invoice that means destroying accounting history, so it is rejected; on a
 * draft the allocation is released first so billing state is already correct when the row
 * cascades away. Lifecycle commands (`deleteInvoiceLine`, invoice delete/void) release the
 * allocation before deleting, so they pass the active-only checks untouched.
 */
export const guardAllocatedLineDelete: EntityPreDeleteHandler = async (event) => {
  const lineItemId = parseRecordId(event.recordId).entityInstanceId
  const [sourceAllocation, invoiceAllocation] = await Promise.all([
    database.query.InvoiceLineAllocation.findFirst({
      where: and(
        eq(schema.InvoiceLineAllocation.organizationId, event.organizationId),
        eq(schema.InvoiceLineAllocation.sourceLineItemId, lineItemId),
        eq(schema.InvoiceLineAllocation.status, 'active')
      ),
      columns: { id: true },
    }),
    database.query.InvoiceLineAllocation.findFirst({
      where: and(
        eq(schema.InvoiceLineAllocation.organizationId, event.organizationId),
        eq(schema.InvoiceLineAllocation.invoiceLineItemId, lineItemId),
        eq(schema.InvoiceLineAllocation.status, 'active')
      ),
      columns: { id: true, invoiceId: true },
    }),
  ])
  if (sourceAllocation) {
    throw new BadRequestError('Remove this line from its draft invoice before deleting it')
  }
  if (invoiceAllocation) {
    const cache = getOrgCache()
    const cf = await cache
      .from(event.organizationId, 'customFields')
      .bySystemAttributes(['invoice_status'] as const)
    let status: unknown
    if (cf.invoice_status) {
      const handler = new UnifiedCrudHandler(event.organizationId, event.userId)
      const values = await handler.getFieldValues(
        toRecordId('invoice', invoiceAllocation.invoiceId),
        [cf.invoice_status.id]
      )
      const typed = firstTyped(values.get(cf.invoice_status.id))
      status = typed ? extractValue(typed) : undefined
    }
    if (status !== 'draft') {
      throw new BadRequestError(
        'Lines on an issued invoice cannot be deleted — void and reissue the invoice instead'
      )
    }
    await database
      .update(schema.InvoiceLineAllocation)
      .set({ status: 'released', releasedAt: new Date() })
      .where(eq(schema.InvoiceLineAllocation.id, invoiceAllocation.id))
  }
}

/** Recompute billing after a source line changes. */
export const syncBillingOnLineChange: EntityFieldChangeHandler = async (event) => {
  const attribute = event.field.systemAttribute ?? ''
  if ((BILLING_PROJECTION_ATTRS as readonly string[]).includes(attribute)) return
  if (!LINE_ITEM_BILLING_TRIGGER_ATTRS.has(attribute)) return
  // The work order is resolved in the DRAIN, not here: this used to be a
  // `getFieldValues` on every one of the trigger attributes, asking the same
  // question of the same line several times per write (plan 08 phase 2c).
  const { entityInstanceId } = parseRecordId(event.recordId)
  await markOrSyncLine(event.organizationId, event.userId, entityInstanceId)
}

/** Recompute work-order billing after relevant work-order fields change. */
export const syncBillingOnWorkOrderChange: EntityFieldChangeHandler = async (event) => {
  const attribute = event.field.systemAttribute ?? ''
  if ((BILLING_PROJECTION_ATTRS as readonly string[]).includes(attribute)) return
  if (!WORK_ORDER_BILLING_TRIGGER_ATTRS.has(attribute)) return
  await markOrSyncWorkOrder(event.organizationId, event.userId, event.recordId.split(':').at(-1)!)
}

/** Recompute invoice context and its linked work order after lifecycle/payment changes. */
export const syncBillingOnInvoiceChange: EntityFieldChangeHandler = async (event) => {
  const attribute = event.field.systemAttribute ?? ''
  if ((BILLING_PROJECTION_ATTRS as readonly string[]).includes(attribute)) return
  if (!INVOICE_BILLING_TRIGGER_ATTRS.has(attribute)) return
  await markOrSyncInvoice(event.organizationId, event.userId, event.recordId.split(':').at(-1)!)
}

/** Recompute a contact aggregate when its billing relationships change. */
export const syncBillingOnContactChange: EntityFieldChangeHandler = async (event) => {
  if ((BILLING_PROJECTION_ATTRS as readonly string[]).includes(event.field.systemAttribute ?? '')) {
    return
  }
  await syncContactBillingProjection({
    organizationId: event.organizationId,
    userId: event.userId,
    contactInstanceId: event.recordId.split(':').at(-1)!,
  })
}

/** Pull the entity-instance id out of a captured relationship raw value (RecordId or array). */
function capturedRelationInstanceId(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || !raw.includes(':')) return null
  return raw.split(':').at(-1) ?? null
}

/**
 * After an invoice is deleted (any path — generic `record.delete`, bulk, Kopilot), refresh its
 * work order's billing projection. The pre-delete guard already released the allocations; this
 * closes the gap that draft counts/amounts are computed from linked invoice entities, so they
 * only become correct once the row is actually gone. Contact sync cascades from the work-order
 * projector.
 */
export const syncBillingAfterInvoiceDelete: EntityPostDeleteHandler = async (event) => {
  const workOrderInstanceId = capturedRelationInstanceId(event.values.invoice_work_order)
  if (!workOrderInstanceId) return
  await markOrSyncWorkOrder(event.organizationId, event.userId, workOrderInstanceId)
}

/**
 * After a line item is deleted: a work-order source line refreshes the work order's billing
 * projection (generic deletes fire no field-change hooks, so contract value would
 * otherwise go stale); an invoice-owned copy refreshes the invoice's totals and context the
 * same way `deleteInvoiceLine` does, covering deletes that bypass that command. Parent-level
 * cleanup flows suppress this hook (`suppressPostDeleteHooks`) and sync once themselves.
 */
export const syncBillingAfterLineDelete: EntityPostDeleteHandler = async (event) => {
  const workOrderInstanceId = capturedRelationInstanceId(event.values.line_item_work_order)
  if (workOrderInstanceId) {
    // Work orders have no document-totals record — the billing projector reads source lines
    // directly, so the projection sync alone restores contract/uninvoiced amounts.
    await markOrSyncWorkOrder(event.organizationId, event.userId, workOrderInstanceId)
    return
  }
  const invoiceInstanceId = capturedRelationInstanceId(event.values.line_item_invoice)
  if (invoiceInstanceId) {
    // 🛑 `recomputeTotals` stays INLINE and stays first. The invoice projector
    // cascades to the work order, whose projection reads `invoice_total` — so the
    // totals have to be on the row before the projection runs. Marking both would
    // put that dependency at the mercy of key insertion order in the drain.
    await recomputeTotals({
      organizationId: event.organizationId,
      userId: event.userId,
      documentType: 'invoice',
      documentInstanceId: invoiceInstanceId,
    })
    await markOrSyncInvoice(event.organizationId, event.userId, invoiceInstanceId)
  }
}

/**
 * After a work order is deleted, refresh its contact's billing aggregate — the deleted work
 * order's uninvoiced amount was part of `contact_uninvoiced_amount`.
 */
export const syncContactAfterWorkOrderDelete: EntityPostDeleteHandler = async (event) => {
  const contactInstanceId = capturedRelationInstanceId(event.values.work_order_contact)
  if (!contactInstanceId) return
  await markOrSyncContact(event.organizationId, event.userId, contactInstanceId)
}
