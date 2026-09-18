// packages/lib/src/accounting/money/payouts/sweep.ts

/**
 * The clock behind the payout entry.
 *
 * `postPayoutEntry` shipped in #2054 with no caller at all, so `1200` was
 * debited gross at every card sale and never credited: the clearing account grew
 * without bound and the processing fee was never expensed (HANDOFF §11.5 item
 * 1). This module is the trigger, run nightly by
 * `jobs/maintenance/payout-sync-job.ts`; the other door is the "Sync now"
 * button, which calls `syncPayouts` for one org (`money.ts` router).
 *
 * ## Why a sweep and not a webhook
 *
 * There is no payout webhook any more: the `payout.paid` door went with the
 * legacy Stripe event handler, and the only `applyStripeEvent` left is
 * `banking/feed`'s. A poll is what both remaining doors do, and both run the
 * same idempotent `syncPayouts`, which keys on the (rail, gateway id) pair, so
 * a payout reached twice is a no-op the second time.
 *
 * ## Which orgs it walks (brief 27 §7)
 *
 * Every org some registered `api` {@link PayoutSource} says it can poll,
 * de-duplicated across sources. Discovery is the source's to answer: Stripe
 * Connect names the orgs holding a connected, non-disconnected `PaymentAccount`
 * (a few hundred rows), and Shopify Payments names the orgs with the app
 * installed. Neither reads a `payment_gateway` field to get there - which orgs
 * actually POST is `resolveContexts`' question, one context per live feed a
 * person has linked to a rail (task 58 §5.5), not this file's. Within an org,
 * `syncPayouts` builds one context per rail and runs each, so one rail's
 * failure stops neither the next rail nor the next org.
 *
 * 🛑 **The sweep runs in the worker, which must register the accounting
 * providers before it** (27 §1.5). `apps/worker/src/server.ts` calls
 * `registerAccountingProviders()` and `registerPayoutSources()` before
 * `startWorkers()`; without the first every entry lands as `not_required`,
 * without the second there is nothing to poll.
 */

import { type Database, database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { listPayoutSources } from './source-registry'
import { syncPayouts } from './sync'

const logger = createScopedLogger('payouts:sweep')

export interface PayoutSweepSummary {
  organizations: number
  seen: number
  created: number
  posted: number
  refused: number
  failures: number
}

/**
 * Run the payout sync for every org a registered source can poll.
 *
 * **One org's failure never stops the walk.** A 401 from a revoked key, an org
 * short of entity migration 133, a payout whose arithmetic the builder refuses -
 * each is logged against its org and the sweep moves on, because the twelve orgs
 * behind it have books to keep too. A source whose org discovery itself fails
 * is one failure and the other sources still walk.
 */
export async function sweepPayouts(db: Database = database): Promise<PayoutSweepSummary> {
  const summary: PayoutSweepSummary = {
    organizations: 0,
    seen: 0,
    created: 0,
    posted: 0,
    refused: 0,
    failures: 0,
  }

  const organizations = new Set<string>()
  for (const source of listPayoutSources()) {
    if (source.kind !== 'api' || !source.listOrganizations) continue
    try {
      for (const organizationId of await source.listOrganizations(db)) {
        organizations.add(organizationId)
      }
    } catch (error) {
      summary.failures += 1
      logger.error('A payout source could not list its organizations', {
        sourceId: source.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  summary.organizations = organizations.size

  for (const organizationId of organizations) {
    try {
      const result = await syncPayouts(db, { organizationId })
      if (result.isErr()) {
        summary.failures += 1
        logger.error('Payout sync failed for organization', {
          organizationId,
          error: result.error.message,
        })
        continue
      }
      summary.seen += result.value.seen
      summary.created += result.value.created
      summary.posted += result.value.posted
      summary.refused += result.value.refused.length
      summary.failures += result.value.failed.length
      for (const refusal of result.value.refused) {
        // 🛑 Logged at ERROR, not info. A payout auxx could not post leaves
        // clearing overstated by that payout for as long as nobody looks, and
        // the sweep is the only thing that will ever notice.
        logger.error('A payout could not be posted', {
          organizationId,
          payoutId: refusal.payoutId,
          reason: refusal.reason,
        })
      }
      for (const failure of result.value.failed) {
        logger.error('A payout source failed for organization', {
          organizationId,
          sourceId: failure.sourceId,
          paymentGatewayId: failure.paymentGatewayId,
          reason: failure.reason,
        })
      }
    } catch (error) {
      summary.failures += 1
      logger.error('Payout sweep failed for organization', {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.info('Payout sweep finished', { ...summary })
  return summary
}
