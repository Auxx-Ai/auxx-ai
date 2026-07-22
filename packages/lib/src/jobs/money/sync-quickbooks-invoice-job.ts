// packages/lib/src/jobs/money/sync-quickbooks-invoice-job.ts

import { syncInvoiceToQuickbooks } from '../../money/quickbooks/sync-invoice'
import type { JobContext } from '../types'

/** Payload for {@link syncQuickbooksInvoiceJob}. */
export interface SyncQuickbooksInvoiceJobData {
  organizationId: string
  invoiceInstanceId: string
  actorUserId?: string
}

/**
 * Worker job — mirrors an Auxx invoice into QuickBooks Online (plans/dispatch/
 * 37e-quickbooks-invoice-sync.md §3, P3). Thin wrapper around
 * {@link syncInvoiceToQuickbooks}; enqueued from the `invoice_status` draft→sent field-change
 * hook (`sequences/field-change-hooks.ts`) and available for the manual "Sync to QuickBooks"
 * retry action.
 */
export const syncQuickbooksInvoiceJob = async (ctx: JobContext<SyncQuickbooksInvoiceJobData>) => {
  return syncInvoiceToQuickbooks(ctx.data)
}
