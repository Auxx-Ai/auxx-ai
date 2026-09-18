// packages/lib/src/accounting/money/payouts/sources.ts

import { createScopedLogger } from '@auxx/logger'
import { registerPayoutSource } from './source-registry'
import { SHOPIFY_PAYMENTS_PAYOUT_SOURCE } from './sources/shopify-payments'
import { STRIPE_CONNECT_PAYOUT_SOURCE } from './sources/stripe-connect'

const logger = createScopedLogger('payout-sources')

/**
 * Fill the {@link registerPayoutSource} registry with every settlement feed
 * this build ships
 * (`plans/accounting/tasks/27-a-settlement-from-anywhere.md` §4, §7).
 *
 * 🛑 **Every process that runs the payout sync must call this at boot** - web
 * (the "Sync now" button) AND the worker (the nightly `payoutSyncJob`, which is
 * the only other door: there is no payout webhook), beside
 * `registerAccountingProviders()`, which the
 * same two boot sequences already call for the same reason. The pipeline
 * (`payouts/sync.ts`) knows only the `PayoutSource` interface; with an empty
 * registry `syncPayouts` finds no context for any org, lists nothing, and the
 * clearing account keeps filling with nothing to say so.
 *
 * Lives in lib rather than the app layer so there is ONE registration and two
 * callers, not two copies that drift - the same call
 * `money/accounting-providers.ts` made. Stripe Connect is the one source whose
 * HTTP lives in lib (27 §5); Shopify Payments reaches the installed Shopify
 * app's tools and still registers HERE, resolving its handle inside the call.
 *
 * Idempotent: registration replaces, so a hot reload converges.
 */
export function registerPayoutSources(): void {
  registerPayoutSource(STRIPE_CONNECT_PAYOUT_SOURCE)
  registerPayoutSource(SHOPIFY_PAYMENTS_PAYOUT_SOURCE)
  logger.debug('Payout sources registered', {
    sources: [STRIPE_CONNECT_PAYOUT_SOURCE.id, SHOPIFY_PAYMENTS_PAYOUT_SOURCE.id],
  })
}
