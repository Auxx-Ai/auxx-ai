// apps/web/src/app/(protected)/app/settings/plans/_components/shopify-sync-on-mount.tsx
'use client'

import { useEffect, useRef } from 'react'
import { useIsShopifyBilling } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

/**
 * Self-heal for Shopify-billed orgs: plan changes approved on Shopify's hosted pricing
 * page reach us via webhook/redirect, but if either is delayed the plans page would show
 * a stale plan (App Store review rejection 1.2.2). On mount, reconcile the subscription
 * against the Admin API and refresh the cached queries when anything changed. The server
 * enforces a per-org 30s cooldown, so reloads are cheap no-ops.
 */
export function ShopifySyncOnMount() {
  const isShopifyBilling = useIsShopifyBilling()
  const firedRef = useRef(false)
  const utils = api.useUtils()
  const syncStatus = api.billing.syncShopifyStatus.useMutation({
    onSuccess: (result) => {
      if (result.synced) {
        void utils.billing.getCurrentSubscription.invalidate()
      }
    },
  })

  useEffect(() => {
    if (isShopifyBilling && !firedRef.current) {
      firedRef.current = true
      syncStatus.mutate()
    }
  }, [isShopifyBilling, syncStatus])

  return null
}
