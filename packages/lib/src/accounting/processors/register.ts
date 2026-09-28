// packages/lib/src/accounting/processors/register.ts

import { createScopedLogger } from '@auxx/logger'
import { registerEntryReferenceResolver } from '../money/payouts/reference-resolvers'
import { registerPayoutSource } from '../money/payouts/source-registry'
import { AFFIRM_ENTRY_REFERENCE_RESOLVER } from './affirm/resolver'
import { AUTHORIZE_NET_ENTRY_REFERENCE_RESOLVER } from './authorize-net/resolver'
import { SHOPIFY_PAYMENTS_PAYOUT_SOURCE } from './shopify-payments/source'
import { STRIPE_CONNECT_PAYOUT_SOURCE } from './stripe-connect/source'

const logger = createScopedLogger('payout-sources')

/** Every processor folder's `source.ts`, in registration order. */
export const PROCESSOR_PAYOUT_SOURCES = [
  STRIPE_CONNECT_PAYOUT_SOURCE,
  SHOPIFY_PAYMENTS_PAYOUT_SOURCE,
] as const

/** Every processor folder's `resolver.ts`. */
export const PROCESSOR_ENTRY_REFERENCE_RESOLVERS = [
  AUTHORIZE_NET_ENTRY_REFERENCE_RESOLVER,
  AFFIRM_ENTRY_REFERENCE_RESOLVER,
] as const

/**
 * Fill the `PayoutSource` and `EntryReferenceResolver` registries from the processor folders
 * (`plans/accounting/tasks/27-a-settlement-from-anywhere.md` §4, §7; `payout-links.md` §12 T3).
 *
 * 🛑 **Every process that runs the payout sync must call this at boot** - web
 * (the "Sync now" button) AND the worker (the nightly `payoutSyncJob`, which is
 * the only other door: there is no payout webhook), beside
 * `registerAccountingProviders()`. The pipeline knows only the two interfaces;
 * with an empty source registry `syncPayouts` finds no context for any org, and
 * a `providerKey` with no resolver leaves every one of its items `no_reference`.
 *
 * Lives in lib so there is ONE registration and two callers. Idempotent:
 * registration replaces, so a hot reload converges.
 */
export function registerProcessors(): void {
  for (const source of PROCESSOR_PAYOUT_SOURCES) registerPayoutSource(source)
  for (const resolver of PROCESSOR_ENTRY_REFERENCE_RESOLVERS) {
    registerEntryReferenceResolver(resolver)
  }
  logger.debug('Payout sources registered', {
    sources: PROCESSOR_PAYOUT_SOURCES.map((source) => source.id),
  })
}
