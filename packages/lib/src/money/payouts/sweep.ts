// packages/lib/src/money/payouts/sweep.ts

/**
 * The clock behind the payout entry.
 *
 * `postPayoutEntry` shipped in #2054 with no caller at all, so `1200` was
 * debited gross at every card sale and never credited: the clearing account grew
 * without bound and the processing fee was never expensed (HANDOFF §11.5 item
 * 1). This module is the trigger, and `payout.paid` in `applyStripeEvent` is the
 * other one.
 *
 * ## Why BOTH a webhook and a sweep
 *
 * The webhook is a prompt and the sweep is the guarantee. A webhook can be
 * unsubscribed in the Stripe dashboard, dropped, or arrive while the worker is
 * down, and a payout that is never ingested leaves clearing overstated with
 * nothing to say so. Both doors run the same idempotent `syncPayouts`, which
 * keys on the gateway id, so a payout reached twice is a no-op the second time.
 *
 * ## Which orgs it walks
 *
 * Every org holding a connected, non-disconnected `PaymentAccount`. That is a
 * small set - one row per org that ever ran Stripe Connect - so this is a table
 * scan of a few hundred rows rather than a sweep over documents.
 *
 * 🛑 A DISCONNECTED account is skipped, and that is a deliberate difference from
 * `applyStripeEvent`'s `payout.paid` case, which does not skip. A payout event
 * that arrives for a disconnected account is real money that settled and needs
 * booking; polling an account whose authorization auxx no longer holds would
 * just 401 on every run forever.
 */

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
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
 * Run the payout sync for every org with a live Stripe connection.
 *
 * **One org's failure never stops the walk.** A 401 from a revoked key, an org
 * short of entity migration 133, a payout whose arithmetic the builder refuses -
 * each is logged against its org and the sweep moves on, because the twelve orgs
 * behind it have books to keep too.
 */
export async function sweepPayouts(): Promise<PayoutSweepSummary> {
  const summary: PayoutSweepSummary = {
    organizations: 0,
    seen: 0,
    created: 0,
    posted: 0,
    refused: 0,
    failures: 0,
  }

  const accounts = await database
    .select({
      organizationId: schema.PaymentAccount.organizationId,
      stripeAccountId: schema.PaymentAccount.stripeAccountId,
    })
    .from(schema.PaymentAccount)
    .where(
      and(
        eq(schema.PaymentAccount.provider, 'stripe'),
        isNull(schema.PaymentAccount.disconnectedAt)
      )
    )

  summary.organizations = accounts.length

  for (const account of accounts) {
    if (!account.stripeAccountId) continue
    try {
      const result = await syncPayouts(database, { organizationId: account.organizationId })
      if (result.isErr()) {
        summary.failures += 1
        logger.error('Payout sync failed for organization', {
          organizationId: account.organizationId,
          error: result.error.message,
        })
        continue
      }
      summary.seen += result.value.seen
      summary.created += result.value.created
      summary.posted += result.value.posted
      summary.refused += result.value.refused.length
      for (const refusal of result.value.refused) {
        // 🛑 Logged at ERROR, not info. A payout auxx could not post leaves
        // clearing overstated by that payout for as long as nobody looks, and
        // the sweep is the only thing that will ever notice.
        logger.error('A payout could not be posted', {
          organizationId: account.organizationId,
          payoutId: refusal.payoutId,
          reason: refusal.reason,
        })
      }
    } catch (error) {
      summary.failures += 1
      logger.error('Payout sweep failed for organization', {
        organizationId: account.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.info('Payout sweep finished', { ...summary })
  return summary
}
