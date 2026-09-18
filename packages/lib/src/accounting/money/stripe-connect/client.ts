// packages/lib/src/accounting/money/stripe-connect/client.ts
// Lazy Stripe client for Connect calls — account onboarding (`stripe-onboarding.ts`), the
// payouts rail (`sources/stripe-connect.ts`) and the Financial Connections bank feed
// (`banking/feed/fc-client.ts`, `data-connectors/connectors/stripe-financial-connections.ts`).
// Physically separate from `@auxx/billing`'s Stripe singleton (subscription-shaped, wrong
// webhook/secret) — this module is the ONLY place Connect calls construct a `Stripe` instance,
// though it reuses `STRIPE_SECRET_KEY` (the same platform account) since connected-account calls
// are scoped per request via `{ stripeAccount }`, not a second client/key. Moved out of the
// legacy `payments/` lane (accounting migration step 0) — nothing here is charge-collection
// specific.

import { configService } from '@auxx/credentials'
import Stripe from 'stripe'

let client: Stripe | null = null

/**
 * Lazily construct (and cache) the platform-level Stripe client used for all Connect calls.
 * Every connected-account operation passes `{ stripeAccount: acctId }` as a per-request option
 * on this SAME client — Stripe's SDK does not need (and this module never creates) a second
 * client keyed to the connected account.
 */
export function getStripeConnectClient(): Stripe {
  if (!client) {
    const apiKey = configService.get<string>('STRIPE_SECRET_KEY')
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY not configured — cannot create the Stripe Connect client')
    }
    client = new Stripe(apiKey, {
      apiVersion: '2025-10-29.clover',
      typescript: true,
    })
  }
  return client
}
