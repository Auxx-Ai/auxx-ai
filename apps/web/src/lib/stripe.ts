// apps/web/src/lib/stripe.ts
/**
 * Stripe client initialization for server-side usage.
 */

import { stripeClient } from '@auxx/billing'

/** Initialize Stripe client with secret key */
export function initializeStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is not set')
  }
  return stripeClient.initialize(secretKey)
}

/** Get initialized Stripe client */
export function getStripe() {
  return stripeClient.getClient()
}

// Initialize on module load (server-side only)
if (typeof window === 'undefined') {
  initializeStripe()
}
