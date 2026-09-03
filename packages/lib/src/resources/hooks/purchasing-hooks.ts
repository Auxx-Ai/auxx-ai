// packages/lib/src/resources/hooks/purchasing-hooks.ts

import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import { getOrgCache } from '../../cache'
import { FieldValueService } from '../../field-values/field-value-service'
import { recordNumbering } from '../../records/record-numbering'
import { isRecordId, type RecordId } from '../resource-id'
import {
  createLifecycleStatusGuard,
  PURCHASE_ORDER_ACTION_STATUS_MESSAGE,
  PURCHASE_ORDER_ACTION_STATUSES,
} from './lifecycle-status-guard'
import { keepOrAllocateRecordNumber } from './record-number-hook'
import type { SystemHook, SystemHookRegistry } from './types'

const logger = createScopedLogger('resources:purchasing-hooks')

/**
 * Number the purchase order on create. Mirrors autoGenerateOrderNumber.
 * `purchase_order_number` has creatable:false/updatable:false, so this hook is the only
 * writer when nothing is supplied (plans/purchasing/01-build-plan.md §4.1); a data
 * connector that brings the source's own PO number keeps it and no `PO-` number is
 * allocated ("theirs if they bring one, otherwise ours",
 * plans/money/tasks/39-shopify-first-sync-followups.md section 6.5).
 */
const autoGeneratePurchaseOrderNumber: SystemHook = (context) =>
  keepOrAllocateRecordNumber(context, 'purchase_order')

/**
 * Auto-generate OUR reference for a vendor bill on create — RecordSequence scope
 * `vendor_bill`, prefix `BILL`.
 *
 * ⚠️ This is `vendor_bill_internal_number`, NOT `vendor_bill_number`. The latter is the
 * VENDOR's own invoice number keyed from their document: it is human-entered, required,
 * and deliberately has no hook (plans/purchasing/01-build-plan.md §5.1). Two different
 * documents, two different numbers.
 */
const autoGenerateVendorBillInternalNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  const { recordNumber } = await recordNumbering.create(organizationId, 'vendor_bill')
  return { ...values, [field.id]: recordNumber }
}

/**
 * Unwrap a write-time value that may be scalar or a single-element array, then read a
 * `RecordId` out of it. Relationship values reach a pre-hook as the `"<defId>:<instanceId>"`
 * string, but some writers wrap the value in an array or in a `{ recordId }` object.
 */
function readRecordId(raw: unknown): RecordId | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value === 'string') return isRecordId(value) ? value : null
  if (value && typeof value === 'object' && 'recordId' in value) {
    const inner = (value as { recordId?: unknown }).recordId
    return typeof inner === 'string' && isRecordId(inner) ? inner : null
  }
  return null
}

/**
 * Read `company_primary_contact` off a company.
 *
 * Three-state on purpose, mirroring `resolveCatalogItemPart`:
 * - a `RecordId` — the company names that person as its primary contact
 * - `null` — the company resolved and names NOBODY
 * - `undefined` — the primary contact could not be resolved at all (the org has no
 *   `company_primary_contact` field, or the read failed). The caller must leave any
 *   existing value alone in that case; collapsing it into `null` would clear a good
 *   contact on a transient failure.
 *
 * ⚠️ A contact reaches a company through TWO different edges and this is only one of
 * them: `company_primary_contact` inverts to `contact:company`, while
 * `company_employees` inverts to `contact:employer`. A primary contact is not
 * automatically an employee, and vice versa.
 */
export async function resolveCompanyPrimaryContact(params: {
  organizationId: string
  userId: string
  companyRecordId: RecordId
}): Promise<RecordId | null | undefined> {
  const { organizationId, userId, companyRecordId } = params

  try {
    const cf = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['company_primary_contact'] as const)
    if (!cf.company_primary_contact) return undefined

    const values = await new FieldValueService(organizationId, userId).getValues({
      recordId: companyRecordId,
      fieldIds: [cf.company_primary_contact.id],
    })
    const entry = values.get(cf.company_primary_contact.id)
    const typed: TypedFieldValue | undefined = Array.isArray(entry) ? entry[0] : entry
    if (typed?.type === 'relationship' && typed.recordId) return typed.recordId
    return null
  } catch (error) {
    logger.warn('could not resolve company_primary_contact', {
      organizationId,
      companyRecordId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/**
 * Default `purchase_order_contact` from the vendor's primary contact on CREATE
 * (purchasing plan 07). `purchase_order_vendor` targets a `company`, and a company
 * carries no email of its own, so without a contact a drafted order has nobody to
 * send it to — the field was declared with this intent and shipped without a writer.
 *
 * ⚠️ **Registered under `purchase_order_vendor`, not `purchase_order_contact`.**
 * `runPreHooks` skips a hook on UPDATE unless its own registered systemAttribute is
 * present in `values`; keyed on the contact this would never see a vendor at all.
 *
 * ⚠️ **Create only.** This is the CRUD door — `record.create`, the importer, the SDK.
 * Every interactive vendor change goes through `fieldValue.set`, which never reads
 * this registry, and is handled by the field-change twin in
 * `field-hooks/post/purchase-order-contact-prefill.ts`. That twin owns the re-point
 * case because it is the only one of the two given `oldValue`, which is what tells
 * this hook's own prefill apart from a human's pick.
 *
 * An explicit contact in the SAME write always wins — a caller that named a person
 * is not asking for a default.
 */
const prefillContactFromVendor: SystemHook = async ({
  operation,
  values,
  organizationId,
  userId,
  allFields,
}) => {
  if (operation !== 'create') return values

  const contactField = allFields.find((f) => f.systemAttribute === 'purchase_order_contact')
  if (!contactField) return values
  // `values` is accepted keyed by field id OR by systemAttribute, so an explicit
  // contact can arrive under either.
  if (values[contactField.id] != null || values.purchase_order_contact != null) return values

  const vendorField = allFields.find((f) => f.systemAttribute === 'purchase_order_vendor')
  const vendor = readRecordId(
    (vendorField ? values[vendorField.id] : undefined) ?? values.purchase_order_vendor
  )
  if (!vendor) return values

  const contact = await resolveCompanyPrimaryContact({
    organizationId,
    userId,
    companyRecordId: vendor,
  })
  if (!contact) return values

  return { ...values, [contactField.id]: contact }
}

/**
 * Guard: `issued` may only be set by the Send action (`markPurchaseOrderSent`,
 * plans/purchasing/07-purchase-order-send-and-status.md §3.4/§6.4).
 *
 * ⚠️ This field used to be documented here as *"a plain human-set field with no sanctioned
 * action"*, and that was accurate only by accident: nothing could write it, so calling it
 * the human axis cost nothing. Send changes that. For a purchase order, **issued IS sent to
 * the vendor** — one event, and the accounting word is the better one, so there is no
 * separate `sent` value — which makes `issued` a thing an action produces rather than a
 * value somebody picks. Typing it by hand claims an order went out that never did, and the
 * expediting list, the `expected_at` default and (per §6.1) the receipt pull-forward all
 * read it.
 *
 * `draft`, `closed` and `canceled` stay freely editable. They are genuine human decisions:
 * §3.6 deliberately does NOT derive `closed`, because an order where the vendor short-shipped
 * and the remainder has been forgiven must still be closeable and no derived rule could ever
 * close it.
 *
 * ⚠️ **This guard covers the CRUD chain only, and is NOT the main enforcement point.**
 * `UnifiedCrudHandler.runPreHooks` runs for `record.create`/`record.update`, bulk record
 * writes, the CSV importer and the SDK — worth having, and removing it would narrow
 * coverage. But every *interactive* edit goes through `fieldValue.set` ->
 * `FieldValueService`, which never reads this registry, so a drawer edit or a kanban drag
 * reaches only the field pre-hook twin in
 * `field-hooks/pre/purchase-order-status-guard.ts`. That one is what actually stops a human
 * typing `issued`. The two share their guarded set and message via
 * `PURCHASE_ORDER_ACTION_STATUSES` / `PURCHASE_ORDER_ACTION_STATUS_MESSAGE` so they cannot
 * drift, and `pre/quote-deposit-guard.ts` records the same finding for `quote_status`.
 *
 * The sanctioned writer reaches the field through `FieldValueService`, which bypasses this
 * chain entirely, so this guard never sees it. On the field chain it clears the twin by
 * naming `purchase_order_status` in `bypassFieldGuards`.
 */
const rejectManualLifecycleStatus: SystemHook = createLifecycleStatusGuard({
  guardedValues: PURCHASE_ORDER_ACTION_STATUSES,
  message: PURCHASE_ORDER_ACTION_STATUS_MESSAGE,
})

/**
 * `purchase_order` system hooks: the RecordSequence number on create, the lifecycle guard
 * that keeps `issued` an action rather than a dropdown value, and the contact default
 * derived from the vendor.
 */
export const PURCHASE_ORDER_HOOKS: SystemHookRegistry = {
  purchase_order_number: [autoGeneratePurchaseOrderNumber],
  purchase_order_status: [rejectManualLifecycleStatus],
  purchase_order_vendor: [prefillContactFromVendor],
}

/**
 * `vendor_bill_status` is written by the match hook rather than guarded here — the match
 * recomputes it from the lines on every create/update, so a manual write is overwritten
 * rather than rejected.
 */
export const VENDOR_BILL_HOOKS: SystemHookRegistry = {
  vendor_bill_internal_number: [autoGenerateVendorBillInternalNumber],
}
