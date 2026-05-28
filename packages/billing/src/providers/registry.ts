// packages/billing/src/providers/registry.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { type Database, database } from '@auxx/database'
import { ShopifyBillingProvider } from './shopify'
import { StripeBillingProvider } from './stripe'
import type { BillingProvider, BillingProviderId } from './types'

const cache = new Map<BillingProviderId, BillingProvider>()

export function getProvider(id: BillingProviderId): BillingProvider {
  const cached = cache.get(id)
  if (cached) return cached

  let provider: BillingProvider
  switch (id) {
    case 'stripe':
      provider = new StripeBillingProvider(database, WEBAPP_URL)
      break
    case 'shopify':
      provider = new ShopifyBillingProvider(database)
      break
    default: {
      const _exhaustive: never = id
      throw new Error(`Unknown billing provider: ${_exhaustive as string}`)
    }
  }

  cache.set(id, provider)
  return provider
}

export async function resolveBillingProvider(
  db: Database,
  organizationId: string
): Promise<BillingProvider> {
  const sub = await db.query.PlanSubscription.findFirst({
    where: (s, { eq }) => eq(s.organizationId, organizationId),
    columns: { billingProvider: true },
  })
  const id = (sub?.billingProvider as BillingProviderId | undefined) ?? 'stripe'
  return getProvider(id)
}
