// packages/lib/src/money/invoice-lifecycle.ts

import { database, schema } from '@auxx/database'
import type { RecordId, TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq } from 'drizzle-orm'
import { getEntityDefIdResolver, getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
import { listInvoiceAllocations, releaseInvoiceAllocations } from './billing-allocations'
import { syncInvoiceBillingProjection, syncWorkOrderBillingProjection } from './billing-projection'
import { postInvoiceIssuance, reverseInvoiceIssuance } from './invoices/post-invoice'
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
 * Release allocation-ledger claims for an invoice. Kept under its legacy exported name while
 * callers migrate; source-line stamps are no longer billing truth.
 */
export async function unstampSourceLines(
  organizationId: string,
  userId: string,
  invoiceRecordId: RecordId
): Promise<void> {
  const { entityInstanceId: invoiceId } = parseRecordId(invoiceRecordId)
  await releaseInvoiceAllocations({
    organizationId,
    invoiceId,
  })
}

/**
 * The bypass both invoice lifecycle actions carry
 * (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §4).
 *
 * 🛑 **Two chains guard `invoice_status`, and only ONE of them is cleared structurally.**
 * Writing through `FieldValueService` rather than `UnifiedCrudHandler` clears the system
 * pre-hook (`resources/hooks/invoice-hooks.ts`), which never runs for a `FieldValueService`
 * write. But that is not the chain a drawer edit or a kanban drag takes, so `invoice_status`
 * also carries a FIELD pre-hook (`field-hooks/pre/lifecycle-status-guard.ts`) that DOES see
 * these writes. `fireFieldPreHooks` short-circuits on
 * `ctx.bypassFieldGuards.has(systemAttribute)` before any handler runs, so naming the
 * attribute here is the whole mechanism — without it Send and Void are refused by the wall
 * built to protect them.
 *
 * It names `invoice_status` and nothing else. `markInvoiceSent` also writes
 * `invoice_issued_at`, which is deliberately NOT in here: that field is not in
 * `BILLING_PROJECTION_ATTRS` and carries no guard, and naming a field a bypass does not need
 * is how a projection-owned field quietly becomes writable later.
 *
 * The third sanctioned writer, `syncInvoicePaymentState` (`payments/ledger.ts`), builds the
 * identical one-attribute set — it is the only writer of `paid` / `partially_paid`.
 */
const INVOICE_STATUS_BYPASS = new Set<SystemAttribute>(['invoice_status'])

/**
 * Mark a draft invoice as sent (money MI1 build spec §G.2) — send is issuance, so
 * `invoice_issued_at` is stamped to today if it's still empty. No `markPaid` mutation exists
 * on purpose: "Mark as paid" in the UI records a full-balance payment through
 * `recordManualPayment` (decision 4, one code path). Writes go through `FieldValueService` —
 * the sanctioned-writer path both `invoice_status` guards are built to let through: the
 * system pre-hook (resources/hooks/invoice-hooks.ts) structurally, and the field pre-hook via
 * {@link INVOICE_STATUS_BYPASS}.
 *
 * 🛑 **Send is also the ledger door** (plans/accounting/tasks/08). This is the ONE sanctioned
 * route to `sent`, so the issuance entry hangs off it: `Dr accounts_receivable /
 * Cr revenue_service / Cr sales_tax_payable`, posted AFTER every write above has committed.
 * It never throws - an invoice must not fail to send because its bookkeeping did.
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
  const fieldValueService = new FieldValueService(organizationId, userId, undefined, undefined, {
    bypassFieldGuards: INVOICE_STATUS_BYPASS,
  })
  await fieldValueService.setValuesForEntity({
    recordId: toRecordId(resolveDefId('invoice'), invoiceInstanceId),
    values: writes,
  })
  await database
    .update(schema.WorkOrderBillingInstallment)
    .set({ status: 'invoiced' })
    .where(
      and(
        eq(schema.WorkOrderBillingInstallment.organizationId, organizationId),
        eq(schema.WorkOrderBillingInstallment.invoiceId, invoiceInstanceId),
        eq(schema.WorkOrderBillingInstallment.status, 'drafted')
      )
    )

  // ── The general ledger, after every write above has committed ────────────
  //
  // 🛑 LAST, and outside the writes rather than inside them. The post resolves
  // its source on a different connection and cannot see uncommitted rows - it
  // reads `invoice_issued_at` back, which the block above may have only just
  // stamped. Enqueueing it any earlier reads the invoice as it was.
  //
  // ⚠️ `postInvoiceIssuance` NEVER throws. Every refusal is a `PostResult`,
  // logged there with its status and whether the period was claimed, and
  // surfaced by `listUnpostedPeriods` once a claim exists. An invoice must not
  // fail to send because its bookkeeping did - the customer is waiting on the
  // document and the refusal is recoverable.
  await postInvoiceIssuance(database, {
    organizationId,
    invoiceId: invoiceInstanceId,
    actorUserId: userId,
  })
}

/**
 * Void an invoice (money MI1 build spec §G.4). Blocked while any succeeded payment exists
 * (decision 6 — delete manual payments first; MP1 extends the message to refunds). Unstamps
 * every source line so the job can be re-gathered later (decision 5) — the invoice's own
 * copies stay, so the void document remains readable history. Un-void is the manual `draft`
 * write escape hatch, deliberately unguarded — neither `invoice_status` guard blocks `draft`,
 * only the ledger-derived and send statuses.
 *
 * 🛑 **Since plans/accounting/tasks/08, the general ledger comes out FIRST.** `markInvoiceSent`
 * posts `Dr accounts_receivable / Cr revenue_service / Cr sales_tax_payable`, and a voided
 * invoice whose revenue stayed in the books is the same error that entry exists to close with
 * the sign flipped - undetectable, because both entries balance. A reversal the ledger refuses
 * (a locked period, a chart that moved under the entry) refuses the VOID, naming the reason,
 * and nothing has been written at that point.
 */
export async function voidInvoice(input: InvoiceLifecycleInput): Promise<void> {
  const { organizationId, userId, invoiceInstanceId } = input
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)
  const allocations = await listInvoiceAllocations({ organizationId, invoiceId: invoiceInstanceId })
  const workOrderId =
    allocations.lineAllocations.at(0)?.workOrderId ??
    allocations.visitAllocations.at(0)?.workOrderId ??
    allocations.scheduleAllocations.at(0)?.workOrderId

  if (await hasSucceededCharges(organizationId, invoiceInstanceId)) {
    throw new BadRequestError('Remove recorded payments before voiding this invoice')
  }

  // ── The general ledger, BEFORE the status flips ──────────────────────────
  //
  // 🛑 Order is the whole point. A voided invoice whose revenue stayed in the
  // books is the same class of error as an issued invoice that never raised its
  // receivable, with the sign flipped - and it is undetectable, because both
  // entries balance. So the reversal goes first, and a refused reversal (a
  // locked period, a chart that moved under the entry) refuses the VOID by
  // name. Nothing has been written at that point.
  const reversal = await reverseInvoiceIssuance(database, {
    organizationId,
    invoiceId: invoiceInstanceId,
    actorUserId: userId,
  })
  if (reversal) {
    throw new BadRequestError(
      'This invoice has a general ledger entry that could not be reversed' +
        `${reversal.error ? `: ${reversal.error}` : ` (${reversal.status})`}. ` +
        'Voiding it would leave its revenue and receivable in the books with no document ' +
        'behind them. Reverse the entry from the ledger first, then void the invoice.',
      { invoiceInstanceId, status: reversal.status }
    )
  }

  // Resolve the type-slug to the real `entityDefinitionId` UUID before writing — see the
  // identical note in `markInvoiceSent` above (unresolved `invoice:<id>` RecordId silently
  // no-ops every field-change hook, including this plan's invoice-reminders subject guard).
  const resolveDefId = await getEntityDefIdResolver(organizationId)
  const fieldValueService = new FieldValueService(organizationId, userId, undefined, undefined, {
    bypassFieldGuards: INVOICE_STATUS_BYPASS,
  })
  await fieldValueService.setValuesForEntity({
    recordId: toRecordId(resolveDefId('invoice'), invoiceInstanceId),
    values: [{ fieldId: 'invoice_status', value: 'void' }],
  })

  await unstampSourceLines(organizationId, userId, invoiceRecordId)
  await syncInvoiceBillingProjection({ organizationId, userId, invoiceInstanceId })
  if (workOrderId) {
    await syncWorkOrderBillingProjection({
      organizationId,
      userId,
      workOrderInstanceId: workOrderId,
    })
  }
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
  // Work-order projection sync now rides the `invoices` post-delete hook, which fires for
  // every delete path — no bespoke allocation lookup needed here.
  await handler.delete(toRecordId('invoice', invoiceInstanceId))
}
