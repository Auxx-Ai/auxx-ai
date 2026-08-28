// packages/lib/src/jobs/maintenance/vendor-bill-aging-job.ts

import { createScopedLogger } from '@auxx/logger'
import { sweepAgingVendorBills } from '../../purchasing/aging-sweep'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('vendor-bill-aging-job')

/**
 * Daily aging sweep for prepaid vendor bills (money P24).
 *
 * `awaiting_receipt` is not an exception — prepayment is the normal state of a
 * correct bill here for weeks — and the only thing that makes that safe is that it
 * AGES into one once the purchase order's `expectedAt` plus the seven-day grace has
 * passed. Every other trigger for that transition is event-driven (a bill line
 * edit, a receipt landing), so without this job a bill whose goods never arrive
 * stays amber forever, which is the exact vendor-took-the-money-and-never-shipped
 * case P24 exists to catch.
 *
 * Scheduled nightly via `upsertJobScheduler` — see `apps/worker/src/workers/index.ts`.
 * Idempotent: `sweepAgingVendorBills` selects only bills already past their grace,
 * and `rematchBill` skips the write when the verdict it computes is the one already
 * stored, so a re-run after a failure is free.
 */
export async function vendorBillAgingJob(ctx: JobContext): Promise<void> {
  logger.info('Running vendor bill aging sweep', { jobId: ctx.jobId })
  const summary = await sweepAgingVendorBills()
  logger.info('Vendor bill aging sweep finished', { jobId: ctx.jobId, ...summary })
}
