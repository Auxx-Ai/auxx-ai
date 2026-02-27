// apps/web/src/lib/stripe.ts
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { getEnv } from '~/providers/dehydrated-state-provider'

/** Memoized Stripe loader promise to avoid repeated SDK initialization. */
let stripePromise: Promise<Stripe | null> | null = null

/**
 * Returns a safe Stripe promise.
 * Falls back to null when Stripe publishable key is not configured.
 */
export function getStripePromise(): Promise<Stripe | null> {
  if (stripePromise) {
    return stripePromise
  }

  /** Publishable key from dehydrated env (browser-only). */
  const publishableKey = getEnv()?.stripe.publishableKey

  if (!publishableKey) {
    stripePromise = Promise.resolve(null)
    return stripePromise
  }

  stripePromise = loadStripe(publishableKey)
  return stripePromise
}
