// packages/lib/src/jobs/maintenance/bank-feed-maintenance-job.ts

/**
 * The bank feed's nightly sweep (HANDOFF slot 3A, open question **S4**).
 *
 * Two duties, both of which fail SILENTLY if nobody runs them, which is why they are on
 * a schedule rather than hanging off a user action:
 *
 * 1. 🛑 **The billing reaper.** Stripe charges 30c per institution per account holder
 *    PER MONTH for transactions, and the only thing that stops the charge is calling
 *    `disconnect` on the Financial Connections account. A churned customer, a
 *    disconnected feed, or a deleted connector otherwise keeps costing money every
 *    month, invisibly, until someone reads an invoice. The immediate doors
 *    (`banking.disconnect`, connector delete) cover the ordinary cases; this covers
 *    everything they missed — a feed a Stripe event killed that nobody acted on, and an
 *    organization that was offboarded out from under its connectors.
 *
 * 2. **The coverage floor.** `bank_account.coverageFrom` is what the setup wizard's gap
 *    number and a future reconciliation refusal read. `readCoverage` derives it live for
 *    the UI, so nothing on screen is ever stale; this is what STORES it, so the answer
 *    does not require walking every transaction in the org.
 *    Without a coverage floor a balance sheet spanning a hole renders happily and is
 *    wrong — arithmetically right, financially meaningless, and silent
 *    (plans/bank-connection/01 §4.1 (4c)).
 *
 * ⚠️ Per-org failures are caught and counted, never rethrown. One organization whose
 * entity migration has not run must not stop the reaper reaching the next org's
 * billable dead connection.
 */

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { refreshBankAccountCoverage } from '../../banking/feed/coverage'
import { reapDisconnectedBankFeeds } from '../../banking/feed/reaper'
import { runSuggestionsForAccount } from '../../banking/rules/writes'
import { SystemUserService } from '../../users/system-user-service'
import type { JobContext } from '../types'

const logger = createScopedLogger('bank-feed-maintenance')

interface BankFeedMaintenanceJobData {
  /** Cap orgs whose coverage is refreshed per run (runaway defence); default all. */
  batchSize?: number
  /** Skip the reaper — for a run that only wants the coverage half. */
  skipReaper?: boolean
}

export interface BankFeedMaintenanceStats {
  /** Accounts the reaper decided to release at Stripe. */
  reapCandidates: number
  /** Accounts Stripe confirmed released, so billing stops. */
  reaped: number
  /** Releases Stripe refused or errored; retried on the next run. */
  reapFailed: number
  organizations: number
  /** Bank accounts whose stored coverage floor moved earlier. */
  coverageMoved: number
  errors: number
}

export async function bankFeedMaintenanceJob(
  ctx: JobContext<BankFeedMaintenanceJobData>
): Promise<BankFeedMaintenanceStats> {
  const { batchSize, skipReaper } = ctx.job.data ?? {}

  const stats: BankFeedMaintenanceStats = {
    reapCandidates: 0,
    reaped: 0,
    reapFailed: 0,
    organizations: 0,
    coverageMoved: 0,
    errors: 0,
  }

  if (!skipReaper) {
    try {
      // Cross-org by design: a dead connection costs money whoever owns it, and the
      // selection query already scopes itself to Financial Connections connectors.
      const reap = await reapDisconnectedBankFeeds(database)
      stats.reapCandidates = reap.candidates
      stats.reaped = reap.disconnected
      stats.reapFailed = reap.failed
    } catch (error) {
      stats.errors += 1
      logger.error('The bank feed reaper failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const orgs = await database
    .select({ id: schema.Organization.id })
    .from(schema.Organization)
    .limit(batchSize ?? 100_000)
  stats.organizations = orgs.length

  for (const org of orgs) {
    try {
      stats.coverageMoved += await refreshBankAccountCoverage(database, {
        organizationId: org.id,
      })
      // Suggest-from-history and rules over every line still `for_review`, so
      // a feed that landed overnight is pre-coded by morning (bank plan §2.4).
      // Best effort; a refusal leaves the line where the queue already shows it.
      const actorUserId = await SystemUserService.getSystemUserForActions(org.id)
      const suggested = await runSuggestionsForAccount(database, {
        organizationId: org.id,
        actorUserId,
      })
      if (suggested.isErr()) {
        logger.warn('Could not run bank suggestions', {
          organizationId: org.id,
          error: suggested.error.message,
        })
      }
    } catch (error) {
      stats.errors += 1
      logger.warn('Could not refresh bank account coverage', {
        organizationId: org.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.info('Bank feed maintenance finished', stats)
  return stats
}
