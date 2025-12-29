// packages/billing/src/services/stripe-client.ts
/**
 * Stripe client singleton wrapper.
 */

import Stripe from 'stripe'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('stripe-client')

/** Stripe client singleton */
class StripeClientService {
  private client: Stripe | null = null

  initialize(apiKey: string) {
    if (!this.client) {
      this.client = new Stripe(apiKey, {
        apiVersion: '2025-09-30.clover',
        typescript: true,
      })
      logger.info('Stripe client initialized')
    }
    return this.client
  }

  getClient(): Stripe {
    if (!this.client) {
      throw new Error('Stripe client not initialized')
    }
    return this.client
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
