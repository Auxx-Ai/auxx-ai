// packages/lib/src/jobs/maintenance/accounting-recovery-job.ts
import { type Database, database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sweepExportBatches } from '../../accounting/export'
import { sweepMovementAccounting } from '../../accounting/money/blocked-movements'
import { sweepFinancialRecordBridge } from '../../accounting/money/customer-money/bridge-sweep'
import { sweepImportedCustomerMoney } from '../../accounting/money/customer-money/ingest'
import { sweepStoredPayoutEntries } from '../../accounting/money/payouts/sweep-stored-entries'
import { sweepChannelCreditMemos } from '../../accounting/sales/credit-memos/issue-pass'
import { sweepFulfillmentAccounting } from '../../accounting/sales/fulfillments/accounting-sweep'
import { listOrganizationsForSweep } from '../../accounting/work-items/sweep'
import { sweepFulfillmentRelief } from '../../inventory/relief/relief-sweep'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('accounting-recovery-job')

type PostingSweep = (
  db: Database,
  input: { organizationId: string; limit: number; timeBudgetMs: number }
) => Promise<unknown>

/** Each entry depends only on its own record (91 §4.0), so these run in any order. */
const POSTING_SWEEPS: Array<[label: string, sweep: PostingSweep]> = [
  ['Payment accounting', sweepMovementAccounting],
  ['Shipment accounting', sweepFulfillmentAccounting],
  // Stage `price` (111 Q21). TODO(111 X3): replace with the pricer; relief re-run writes no pending rows.
  ['Pricing', sweepFulfillmentRelief],
  // Issues channel memos and links refunds that posted before their memo arrived.
  ['Credit memo issuing', sweepChannelCreditMemos],
  // Payouts import in draft with no entry, and the nightly sync re-offers only 30 days.
  ['Stored payout entries', sweepStoredPayoutEntries],
]

async function attempt(label: string, organizationId: string, run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    logger.warn(`${label} recovery needs retry`, {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** The safety net under every wake: orgs with due work first, each lane bounded by one deadline. */
export async function accountingRecoveryJob(
  ctx: JobContext<{ organizationId?: string } | undefined>
): Promise<void> {
  // A one-off run from Retry names its org; the schedule pages through all of them.
  const organizations = ctx.data?.organizationId
    ? [ctx.data.organizationId]
    : await listOrganizationsForSweep(database, { limit: 25 })
  const deadline = Date.now() + 45_000
  let processed = 0
  for (const organizationId of organizations) {
    if (Date.now() >= deadline) break
    processed++
    // Before the money sweep that reads them: a record with no evidence row has
    // nothing for the acceptance lane to find (brief 69 §5).
    await attempt('Financial record bridge', organizationId, () =>
      sweepFinancialRecordBridge(database, { organizationId, limit: 500 })
    )
    await attempt('Imported payment', organizationId, () =>
      sweepImportedCustomerMoney(database, organizationId, 100)
    )
    for (const [label, sweep] of POSTING_SWEEPS) {
      if (Date.now() >= deadline) break
      await attempt(label, organizationId, () =>
        sweep(database, { organizationId, limit: 100, timeBudgetMs: deadline - Date.now() })
      )
    }
    // Gate 2's scheduled half: batches whose avenue auto-sends, and failed ones
    // past their backoff. A held batch is never touched here.
    await attempt('Export batch', organizationId, () =>
      sweepExportBatches(database, {
        organizationId,
        limit: 5,
        timeBudgetMs: Math.max(1, deadline - Date.now()),
      })
    )
  }
  logger.info('Accounting recovery page finished', {
    jobId: ctx.jobId,
    organizations: processed,
  })
}
