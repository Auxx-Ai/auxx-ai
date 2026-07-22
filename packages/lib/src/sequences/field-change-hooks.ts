// packages/lib/src/sequences/field-change-hooks.ts
// `EntityFieldChangeHandler` implementations that enroll/re-anchor sequences off record field
// writes (client-notifications plan §4.3) — the `generateDraftOnCompletion` precedent
// (`money/auto-invoice.ts`). Registered in `field-hooks/register-hooks.ts`.

import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId } from '@auxx/types/resource'
import type { EntityFieldChangeHandler } from '../field-hooks/types'
import { getQueue, Queues } from '../jobs/queues'
import { getOrganizationSetting } from '../settings/settings-service'
import { enrollInvoiceSentSequences, enrollWorkOrderCompletedSequences } from './hooks'
import { reanchorSequenceRuns } from './reanchor'

const logger = createScopedLogger('sequences-field-change-hooks')

function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  return Array.isArray(entry) ? entry[0] : entry
}

function extractStringValue(value: unknown): string | undefined {
  const typed = firstTyped(value as TypedFieldValue | TypedFieldValue[] | undefined)
  return typed ? (extractValue(typed) as string) : undefined
}

/**
 * `work_order:completed` — lands on `'completed'` OR `'ended'` (the `generateDraftOnCompletion`
 * completion-door precedent: the visit roll-up, M2c's `endEngagement`/exhaustion sweep, kanban
 * drags, and manual drawer edits all fire this same hook). Subject = work order.
 */
export const enrollJobFollowUpOnCompletion: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'work_order_status') return
  const newStatus = extractStringValue(event.newValue)
  if (newStatus !== 'completed' && newStatus !== 'ended') return

  const { entityInstanceId } = parseRecordId(event.recordId)
  try {
    await enrollWorkOrderCompletedSequences(event.organizationId, entityInstanceId)
  } catch (error) {
    logger.error('Failed to enroll work_order:completed sequences', {
      organizationId: event.organizationId,
      workOrderInstanceId: entityInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * `invoice:sent` — the draft→sent transition ONLY. Checks the PREVIOUS value: a payment
 * deletion/refund flips `paid`→`sent` (`syncInvoicePaymentState`) and must NOT re-enroll
 * (decision #12) — that reversal has `oldValue !== 'draft'`, so it's naturally excluded here
 * without any extra state tracking. Subject = invoice EntityInstance id.
 */
export const enrollInvoiceReminderOnSent: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'invoice_status') return
  const oldStatus = extractStringValue(event.oldValue)
  const newStatus = extractStringValue(event.newValue)
  if (oldStatus !== 'draft' || newStatus !== 'sent') return

  const { entityInstanceId } = parseRecordId(event.recordId)
  try {
    await enrollInvoiceSentSequences(event.organizationId, entityInstanceId)
  } catch (error) {
    logger.error('Failed to enroll invoice:sent sequences', {
      organizationId: event.organizationId,
      invoiceInstanceId: entityInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * `invoice:sent` — QuickBooks mirror (plans/dispatch/37e-quickbooks-invoice-sync.md §3, P3).
 * Same draft→sent door as {@link enrollInvoiceReminderOnSent}, enqueued rather than run inline
 * (D8 — the queue route also covers the actor-less Stripe `paid` path elsewhere, and keeps this
 * hook from blocking the field write on an outbound QBO API call). Gated by
 * `quickbooks.syncInvoices` up front so the queue sees no churn when the org has the feature
 * off. Deterministic `jobId` de-dupes rapid re-sends of the same invoice.
 */
export const enqueueQuickbooksInvoiceSyncOnSent: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'invoice_status') return
  const oldStatus = extractStringValue(event.oldValue)
  const newStatus = extractStringValue(event.newValue)
  if (oldStatus !== 'draft' || newStatus !== 'sent') return

  const { entityInstanceId } = parseRecordId(event.recordId)
  try {
    const syncEnabled = await getOrganizationSetting({
      organizationId: event.organizationId,
      key: 'quickbooks.syncInvoices',
    })
    if (!syncEnabled) return

    await getQueue(Queues.quickbooksInvoiceSyncQueue).add(
      'syncQuickbooksInvoice',
      {
        organizationId: event.organizationId,
        invoiceInstanceId: entityInstanceId,
        actorUserId: event.userId,
      },
      { jobId: `qb-invoice-sync:${entityInstanceId}` }
    )
  } catch (error) {
    logger.error('Failed to enqueue QuickBooks invoice sync on invoice:sent', {
      organizationId: event.organizationId,
      invoiceInstanceId: entityInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * `invoice_due_date` change — re-anchors any active anchored wait for this invoice's runs
 * immediately. Required (not just an accelerator): the engine's send-node guard recomputes the
 * anchor but can't re-sleep once a wait node has already started running — this hook is the
 * only path that actually moves an already-parked invoice reminder. Non-null new value only —
 * a due-date CLEAR has no target to move to (the live-anchor guard's own NULL-anchor-skip
 * covers that lazily at the next send attempt). `invoice_due_date` is a `FieldType.DATE`
 * field — stored/read as a bare `YYYY-MM-DD` string, parsed as UTC midnight.
 */
export const reanchorInvoiceOnDueDateChange: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'invoice_due_date') return
  const raw = extractStringValue(event.newValue)
  if (!raw) return

  const { entityInstanceId } = parseRecordId(event.recordId)
  try {
    await reanchorSequenceRuns(event.organizationId, 'invoice', entityInstanceId, new Date(raw))
  } catch (error) {
    logger.error('Failed to re-anchor invoice sequence runs on due-date change', {
      organizationId: event.organizationId,
      invoiceInstanceId: entityInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
