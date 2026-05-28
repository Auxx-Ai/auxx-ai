// packages/billing/src/providers/shopify/active-subscription.ts

import { configService } from '@auxx/credentials'
import { getAppConnection } from '@auxx/services/app-connections'
import { createShopifyAdminClient } from './client'

/** Shopify Admin billing interval, as exposed on `AppRecurringPricing.interval`. */
export type AppPricingInterval = 'EVERY_30_DAYS' | 'ANNUAL'

/** Shopify Admin `AppSubscriptionStatus` enum. */
export type AppSubscriptionStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'DECLINED'
  | 'EXPIRED'
  | 'FROZEN'
  | 'CANCELLED'
  | 'ACCEPTED'

export interface ActiveSubscriptionLineItem {
  /**
   * The Partner-Dashboard plan handle. The Admin API does NOT expose this, so it is
   * always null here — plan resolution falls back to the redirect `?plan_handle=` hint
   * or a name/interval match (see provider `resolvePlan`).
   */
  planHandle: string | null
  interval: AppPricingInterval | null
}

export interface ActiveSubscription {
  id: string
  name: string
  status: AppSubscriptionStatus
  test: boolean
  createdAt: string
  currentPeriodEnd: string | null
  trialDays: number
  /** Derived: createdAt + trialDays. null when trialDays === 0. */
  trialEndsAt: string | null
  /** From the first recurring line item's pricing details. */
  interval: AppPricingInterval | null
  lineItems: ActiveSubscriptionLineItem[]
}

const QUERY = `#graphql
  query ActiveAppSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        createdAt
        currentPeriodEnd
        trialDays
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                interval
                price { amount currencyCode }
              }
            }
          }
        }
      }
    }
  }
`

interface RawSub {
  id: string
  name: string
  status: AppSubscriptionStatus
  test: boolean
  createdAt: string
  currentPeriodEnd: string | null
  trialDays: number
  lineItems?: Array<{
    plan?: { pricingDetails?: { __typename: string; interval?: AppPricingInterval } }
  }>
}

/**
 * Reads the merchant's current Shopify App Pricing subscription via the **Admin API**
 * (`currentAppInstallation.activeSubscriptions`), run against the merchant shop with the
 * org-scoped app access token we already store. Returns `null` when the shop has no active
 * subscription (canceled / never subscribed). Under App Pricing, `activeSubscriptions`
 * returns at most one active entry.
 *
 * No Partner API token and no Shop GID are required — the read is shop-token-scoped.
 * See plans/billing/v2/04-partner-api-client.md.
 */
export async function getActiveSubscription(input: {
  shopDomain: string
  organizationId: string
}): Promise<ActiveSubscription | null> {
  const appId = configService.get<string>('SHOPIFY_APP_ID')
  if (!appId) throw new Error('SHOPIFY_APP_ID must be configured')

  // The Shopify billing connection is org-scoped (written by saveAppConnection at
  // install). Passing an empty userId falls through getAppConnection's user-scoped
  // lookup to the org-scoped row.
  const conn = await getAppConnection(appId, input.organizationId, '')
  if (conn.isErr()) throw conn.error
  const accessToken = conn.value.accessToken
  if (!accessToken) throw new Error('Shopify connection has no access token')

  const client = createShopifyAdminClient({ shopDomain: input.shopDomain, accessToken })
  const res = (await client.request(QUERY)) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: RawSub[] } }
    errors?: unknown
  }
  // Distinguish a genuine "no subscription" from a failed query — otherwise a schema
  // error would silently read as canceled and downgrade the merchant.
  if (res.errors) {
    throw new Error(`Admin API activeSubscriptions query failed: ${JSON.stringify(res.errors)}`)
  }
  const raw = res.data?.currentAppInstallation?.activeSubscriptions?.[0]
  if (!raw) return null

  const trialEndsAt =
    raw.trialDays > 0
      ? new Date(new Date(raw.createdAt).getTime() + raw.trialDays * 86_400_000).toISOString()
      : null

  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    test: raw.test,
    createdAt: raw.createdAt,
    currentPeriodEnd: raw.currentPeriodEnd ?? null,
    trialDays: raw.trialDays,
    trialEndsAt,
    interval: firstRecurringInterval(raw),
    lineItems: (raw.lineItems ?? []).map((li) => ({
      // Admin API exposes no plan handle — resolved by hint or name match downstream.
      planHandle: null,
      interval:
        li.plan?.pricingDetails?.__typename === 'AppRecurringPricing'
          ? (li.plan.pricingDetails.interval ?? null)
          : null,
    })),
  }
}

function firstRecurringInterval(raw: RawSub): AppPricingInterval | null {
  for (const li of raw.lineItems ?? []) {
    const pd = li.plan?.pricingDetails
    if (pd?.__typename === 'AppRecurringPricing' && pd.interval) return pd.interval
  }
  return null
}
