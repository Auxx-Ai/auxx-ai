// packages/lib/src/money/invoice-lifecycle.ts

import type { RecordId, TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { getEntityDefIdResolver, getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
import { hasSucceededCharges } from './payments/ledger'
import type { InvoiceLifecycleInput } from './types'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/** Read an invoice's current `invoice_status`. */
async function getInvoiceStatus(
  handler: UnifiedCrudHandler,
  organizationId: string,
  invoiceRecordId: RecordId
): Promise<string | undefined> {
  const cache = getOrgCache()
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['invoice_status'] as const)
  if (!cf.invoice_status) return undefined
  const values = await handler.getFieldValues(invoiceRecordId, [cf.invoice_status.id])
  const typed = firstTyped(values.get(cf.invoice_status.id))
  return typed ? (extractValue(typed) as string) : undefined
}

/**
 * Clear `line_item_invoice` on every SOURCE line for an invoice — lines where
 * `invoice = X AND workOrder is not empty` (the §B.3 invariant). The invoice's own copies
 * (`workOrder` empty) are never touched here. Shared by `voidInvoice` (decision 5) and the
 * `guardInvoiceDelete` pre-delete hook (`field-hooks/pre/invoice-delete-guard.ts`,
 * plans/dispatch/money/12-delete-safety.md §A).
 */
export async function unstampSourceLines(
  organizationId: string,
  userId: string,
  invoiceRecordId: RecordId
): Promise<void> {
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const { ids } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'invoice-source-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'invoice-source-lines-invoice',
            fieldId: 'line_item:invoice',
            operator: 'is',
            value: invoiceRecordId,
          },
          {
            id: 'invoice-source-lines-workorder',
            fieldId: 'line_item:workOrder',
            operator: 'not empty',
            value: null,
          },
        ],
      },
    ],
    limit: 1000,
    mode: 'oneshot',
  })
  if (ids.length === 0) return

  const fieldValueService = new FieldValueService(organizationId, userId)
  await fieldValueService.setBulkValues({
    recordIds: ids.map((id) => toRecordId('line_item', id)),
    values: [{ fieldId: 'line_item_invoice', value: null }],
  })
}

/**
 * Mark a draft invoice as sent (money MI1 build spec §G.2) — send is issuance, so
 * `invoice_issued_at` is stamped to today if it's still empty. No `markPaid` mutation exists
 * on purpose: "Mark as paid" in the UI records a full-balance payment through
 * `recordManualPayment` (decision 4, one code path). Writes go through `FieldValueService` —
 * the sanctioned-writer path the `rejectManualLifecycleStatus` system pre-hook
 * (resources/hooks/invoice-hooks.ts) is built to let through.
 */
export async function markInvoiceSent(input: InvoiceLifecycleInput): Promise<void> {
  const { organizationId, userId, invoiceInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)

  const status = await getInvoiceStatus(handler, organizationId, invoiceRecordId)
  if (status !== 'draft') {
    throw new BadRequestError(
      `Cannot mark as sent — invoice must be 'draft' (currently '${status ?? 'unknown'}')`
    )
  }

  const writes: Array<{ fieldId: string; value: unknown }> = [
    { fieldId: 'invoice_status', value: 'sent' },
  ]

  const cache = getOrgCache()
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['invoice_issued_at'] as const)
  if (cf.invoice_issued_at) {
    const values = await handler.getFieldValues(invoiceRecordId, [cf.invoice_issued_at.id])
    const issuedTyped = firstTyped(values.get(cf.invoice_issued_at.id))
    const issuedAt = issuedTyped ? extractValue(issuedTyped) : undefined
    if (!issuedAt) {
      writes.push({ fieldId: 'invoice_issued_at', value: new Date().toISOString().split('T')[0] })
    }
  }

  // Resolve the type-slug to the real `entityDefinitionId` UUID before writing — an
  // unresolved `invoice:<id>` RecordId makes `setValuesForEntity`'s field-change hook dispatch
  // resolve to no cached resource (`getCachedResource` is an exact `id` match, no type-slug
  // fallback), so `entitySlug` comes back `''` and every field-change hook (including this
  // plan's `enrollInvoiceReminderOnSent`/`reanchorInvoiceOnDueDateChange`) silently no-ops even
  // though the write itself succeeds — the `recurring/materialize.ts`/`engagement-actions.ts`
  // precedent for the identical gap. Mirrors `UnifiedCrudHandler.update`'s own
  // recordId-resolution step (unified-handler-mutations.ts:452).
  const resolveDefId = await getEntityDefIdResolver(organizationId)
  const fieldValueService = new FieldValueService(organizationId, userId)
  await fieldValueService.setValuesForEntity({
    recordId: toRecordId(resolveDefId('invoice'), invoiceInstanceId),
    values: writes,
  })
}

/**
 * Void an invoice (money MI1 build spec §G.4). Blocked while any succeeded payment exists
 * (decision 6 — delete manual payments first; MP1 extends the message to refunds). Unstamps
 * every source line so the job can be re-gathered later (decision 5) — the invoice's own
 * copies stay, so the void document remains readable history. Un-void is the manual `draft`
 * write escape hatch, deliberately unguarded (`rejectManualLifecycleStatus` only blocks the
 * ledger-derived/send statuses).
 */
export async function voidInvoice(input: InvoiceLifecycleInput): Promise<void> {
  const { organizationId, userId, invoiceInstanceId } = input
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)

  if (await hasSucceededCharges(organizationId, invoiceInstanceId)) {
    throw new BadRequestError('Remove recorded payments before voiding this invoice')
  }

  // Resolve the type-slug to the real `entityDefinitionId` UUID before writing — see the
  // identical note in `markInvoiceSent` above (unresolved `invoice:<id>` RecordId silently
  // no-ops every field-change hook, including this plan's invoice-reminders subject guard).
  const resolveDefId = await getEntityDefIdResolver(organizationId)
  const fieldValueService = new FieldValueService(organizationId, userId)
  await fieldValueService.setValuesForEntity({
    recordId: toRecordId(resolveDefId('invoice'), invoiceInstanceId),
    values: [{ fieldId: 'invoice_status', value: 'void' }],
  })

  await unstampSourceLines(organizationId, userId, invoiceRecordId)
}

/**
 * Delete an invoice (money MI1 build spec §G.5). The actual guard + cleanup work — admin gate,
 * succeeded-charges guard, ledger purge, source-line unstamp, own-line cleanup — now lives in
 * the `guardInvoiceDelete` pre-delete hook (`field-hooks/pre/invoice-delete-guard.ts`,
 * plans/dispatch/money/12-delete-safety.md §A), which fires for every delete path (generic
 * `record.delete`, bulk delete, this endpoint). This stays a thin wrapper so the
 * `money.deleteInvoice` endpoint keeps its shape.
 */
export async function deleteInvoice(input: InvoiceLifecycleInput): Promise<void> {
  const { organizationId, userId, invoiceInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)
  await handler.delete(invoiceRecordId)
}
