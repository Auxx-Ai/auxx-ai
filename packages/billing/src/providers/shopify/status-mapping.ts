// packages/billing/src/providers/shopify/status-mapping.ts

import type { ActiveSubscription } from './active-subscription'

export type LocalStatus = 'active' | 'trialing' | 'canceled' | 'incomplete' | 'past_due' | 'paused'

/**
 * Maps an Admin API `AppSubscription` to our local `PlanSubscription.status`. The Admin
 * API gives `status` directly — including `FROZEN` for failed payments — so no events
 * query is needed to detect billing failures. Absence of a contract (`null`) = canceled.
 *
 * See plans/billing/v2/04-partner-api-client.md §2.2.
 */
export function mapActiveSubscriptionToStatus(sub: ActiveSubscription | null): LocalStatus {
  if (!sub) return 'canceled'
  switch (sub.status) {
    case 'FROZEN':
      return 'past_due' // Shopify froze the sub on payment failure
    case 'CANCELLED':
    case 'EXPIRED':
    case 'DECLINED':
      return 'canceled'
    case 'PENDING':
    case 'ACCEPTED':
      return 'incomplete' // approved but not yet active, or awaiting first charge
    case 'ACTIVE':
      if (sub.trialEndsAt && new Date(sub.trialEndsAt) > new Date()) return 'trialing'
      return 'active'
  }
}
