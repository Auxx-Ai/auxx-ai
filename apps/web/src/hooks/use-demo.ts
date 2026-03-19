// apps/web/src/hooks/use-demo.ts
'use client'

import { useCallback, useSyncExternalStore } from 'react'
import {
  useDehydratedOrganization,
  useDehydratedOrganizationId,
} from '~/providers/dehydrated-state-provider'

/** Module-level external store for banner dismissed state */
let bannerDismissed = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return bannerDismissed
}

/** Returns demo state for the current organization */
export function useDemo() {
  const orgId = useDehydratedOrganizationId()
  const org = useDehydratedOrganization(orgId)
  const demoExpiresAt = org?.demoExpiresAt

  const isDismissed = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const dismissBanner = useCallback(() => {
    bannerDismissed = true
    for (const fn of listeners) fn()
  }, [])

  return {
    isDemo: !!demoExpiresAt,
    expiresAt: demoExpiresAt ? new Date(demoExpiresAt) : null,
    isBannerDismissed: isDismissed,
    dismissBanner,
  }
}
