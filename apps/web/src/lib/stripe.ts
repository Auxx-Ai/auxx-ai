// apps/web/src/lib/stripe.ts
/**
 * Stripe client initialization for server-side usage.
 * Lazy-initializes the singleton on first call to getStripe().
 */

import { stripeClient } from '@auxx/billing'
import { configService } from '@auxx/credentials'

/** Get Stripe client, lazy-initializing on first call */
export function getStripe() {
  const secretKey = configService.get<string>('STRIPE_SECRET_KEY')
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY not set')
  }
  return stripeClient.initialize(secretKey)
}
