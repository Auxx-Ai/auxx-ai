// packages/lib/src/money/payouts/source-registry.ts

/**
 * The registry of {@link PayoutSource}s, in the house provider-manager shape
 * (`postings/provider.ts`): a map keyed on the source id, filled from the app
 * boot (`money/payout-sources.ts`, called beside `registerAccountingProviders()`
 * by web and the worker), refused for an id nobody registered.
 *
 * No lazy factory. The accounting-provider registry has one because its
 * QuickBooks adapter reaches an app-runtime Lambda chain that an org which
 * never connected QuickBooks must not pay for at boot; the Stripe source's
 * graph is the same `money/payments` client the payout webhook already loads.
 * A factory would be ceremony for a module that is imported anyway.
 */

import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import type { PayoutSource, PayoutSourceId } from './source'

const sources = new Map<PayoutSourceId, PayoutSource>()

/**
 * Register a source. Idempotent: registering the same id twice REPLACES the
 * first, so a hot reload converges on the newest module rather than throwing.
 */
export function registerPayoutSource(source: PayoutSource): void {
  sources.set(source.id, source)
}

/** The source registered under `id`, or a `NotFoundError` naming the id. */
export function getPayoutSource(id: string): Result<PayoutSource, Error> {
  const source = sources.get(id as PayoutSourceId)
  if (!source) return err(new NotFoundError(`No payout source registered as "${id}"`))
  return ok(source)
}

/** Ids of every registered source, in registration order. */
export function listPayoutSourceIds(): PayoutSourceId[] {
  return [...sources.keys()]
}

/** Every registered source, in registration order. */
export function listPayoutSources(): PayoutSource[] {
  return [...sources.values()]
}

/** Test-only. Empties the registry. */
export function __resetPayoutSourcesForTests(): void {
  sources.clear()
}
