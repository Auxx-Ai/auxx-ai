// packages/billing/src/services/billing-portal-service.ts
/**
 * Billing portal session management service.
 */

import type { Database } from '@auxx/database'
import { stripeClient } from './stripe-client'
import type { BillingPortalInput } from '../types'
import { BillingError, ErrorCode } from '../utils/error-codes'
import { buildUrl } from '../utils/url-helpers'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('billing-portal-service')

export class BillingPortalService {
  constructor(
    private db: Database,
    private baseUrl: string
  ) {}

  async createSession(input: BillingPortalInput): Promise<{ url: string; redirect: boolean }> {
    // Find active subscription
    const subscription = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq, and, or }) =>
        and(
          eq(sub.organizationId, input.organizationId),
          or(eq(sub.status, 'active'), eq(sub.status, 'trialing'))
        ),
    })

    if (!subscription?.stripeCustomerId) {
      throw new BillingError(ErrorCode.NO_CUSTOMER_FOUND)
    }

    const { url } = await stripeClient.getClient().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: buildUrl(this.baseUrl, input.returnUrl),
      locale: input.locale as any,
    })

    return { url, redirect: true }
  }
}
