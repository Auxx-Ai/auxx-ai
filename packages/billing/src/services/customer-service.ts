// packages/billing/src/services/customer-service.ts
/**
 * Customer management service for Stripe billing.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { stripeClient } from './stripe-client'
import { createScopedLogger } from '@auxx/logger'

/**
 * Scoped logger leveraged for recording lifecycle events while resolving Stripe customers.
 */
const logger = createScopedLogger('customer-service')

/**
 * Facade over Stripe customer operations that keeps the local database in sync with remote entities.
 *
 * Provides helper methods for resolving customer identifiers on-demand so that downstream billing flows
 * can rely on a single source of truth, regardless of whether the customer already exists in Stripe or
 * needs to be provisioned during the current request lifecycle.
 */
export class CustomerService {
  /**
   * Builds a new customer service using the provided database connection for organization lookups.
   *
   * @param db Drizzle database instance used to query plan subscriptions when deduplicating customers
   */
  constructor(private db: Database) {}

  /**
   * Resolves the Stripe customer ID associated with the supplied organization, creating a remote customer if needed.
   *
   * The lookup first checks the local `PlanSubscription` table for an existing customer reference. Failing that, it
   * searches Stripe by email and provisions a new customer when no match is found, ensuring metadata is populated with
   * organization context prior to returning the resulting Stripe customer identifier.
   *
   * @param params Query payload containing organization, contact, and optional metadata fields
   * @param params.organizationId Unique identifier for the organization initiating a billing operation
   * @param params.email Primary billing email used to search for existing Stripe customers
   * @param params.name Optional friendly name persisted on the Stripe customer record
   * @param params.metadata Optional key-value metadata to merge into the Stripe customer object on creation
   * @returns Promise that resolves with the Stripe customer ID tied to the organization
   */
  async getOrCreateCustomer(params: {
    organizationId: string
    email: string
    name?: string
    metadata?: Record<string, string>
  }): Promise<string> {
    const { organizationId, email, name, metadata } = params

    // Check if organization already has a customer
    const [subscription] = await this.db
      .select({ stripeCustomerId: schema.PlanSubscription.stripeCustomerId })
      .from(schema.PlanSubscription)
      .where(eq(schema.PlanSubscription.organizationId, organizationId))
      .limit(1)

    if (subscription?.stripeCustomerId) {
      return subscription.stripeCustomerId
    }

    // Check if customer exists by email
    const existingCustomers = await stripeClient.getClient().customers.list({
      email,
      limit: 1,
    })

    let stripeCustomerId: string

    if (existingCustomers.data[0]) {
      stripeCustomerId = existingCustomers.data[0].id
      logger.info('Found existing Stripe customer', { email, stripeCustomerId })
    } else {
      // Create new customer
      const customer = await stripeClient.getClient().customers.create({
        email,
        name,
        metadata: {
          organizationId,
          ...metadata,
        },
      })
      stripeCustomerId = customer.id
      logger.info('Created new Stripe customer', { email, stripeCustomerId })
    }

    return stripeCustomerId
  }
}
