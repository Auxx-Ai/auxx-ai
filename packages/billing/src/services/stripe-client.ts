// packages/billing/src/services/stripe-client.ts
/**
 * Stripe client singleton wrapper.
 */

import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import Stripe from 'stripe'

/** Logger used by Stripe client singleton operations. */
const logger = createScopedLogger('stripe-client')

/** Stripe client singleton */
class StripeClientService {
  private client: Stripe | null = null

  /** Get Stripe client, lazily creating it on first use. */
  getClient(): Stripe {
    if (!this.client) {
      const apiKey = configService.get<string>('STRIPE_SECRET_KEY')
      if (!apiKey) {
        throw new Error('STRIPE_SECRET_KEY not configured')
      }

      this.client = new Stripe(apiKey, {
        apiVersion: '2025-09-30.clover',
        typescript: true,
      })
      logger.info('Stripe client initialized')
    }

    return this.client
  }

  /** Warm the singleton during app boot for fail-fast startup checks. */
  warmClient(): Stripe {
    return this.getClient()
  }

  /** Resolve price ID from lookup key */
  async resolvePriceId(lookupKey: string): Promise<string | undefined> {
    const prices = await this.getClient().prices.list({
      lookup_keys: [lookupKey],
      active: true,
      limit: 1,
    })
    return prices.data[0]?.id
  }
}

export const stripeClient = new StripeClientService()
