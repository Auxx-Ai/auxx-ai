// apps/web/src/app/(protected)/app/settings/plans/_components/plan-view-tracker.tsx
'use client'

import { useEffect, useRef } from 'react'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'

/** Tracks plan_viewed event once per page visit */
export function PlanViewTracker() {
  const posthog = useAnalytics()
  const trackedRef = useRef(false)
  const { data: subscription } = api.billing.getCurrentSubscription.useQuery()

  useEffect(() => {
    if (!trackedRef.current && subscription) {
      trackedRef.current = true
      posthog?.capture('plan_viewed', {
        current_plan: subscription.plan?.name ?? 'none',
      })
    }
  }, [subscription, posthog])

  return null
}
