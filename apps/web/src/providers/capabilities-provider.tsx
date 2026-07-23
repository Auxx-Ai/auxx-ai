// apps/web/src/providers/capabilities-provider.tsx
'use client'

import type { PermissionKey } from '@auxx/lib/permissions/client'
import { PERMISSION_REGISTRY_MAP } from '@auxx/lib/permissions/client'
import type { SubscribeHandlers } from '@auxx/lib/realtime/client'
import { rooms } from '@auxx/lib/realtime/client'
import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useRealtimeRoom } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import { useDehydratedOrganization, useDehydratedUser } from './dehydrated-state-provider'
import { useFeatureFlags, useOrganizationIdContext } from './feature-flag-provider'

/** Why a capability check failed — drives UX (§7.3). */
export type DeniedReason = 'plan' | 'permission' | null

/** Shape of the capabilities context value. */
interface CapabilitiesContextType {
  /**
   * Plan-AND-capability boolean — the same formula as the server, so they
   * cannot disagree: `hasAccess(meta.featureKey) && capabilities.has(key)`.
   */
  can: (key: PermissionKey | string) => boolean
  /**
   * Why `can(key)` is false. `'plan'` (checked first) → the org could buy it,
   * render an upgrade surface; `'permission'` → the member has nothing to buy,
   * hide the entry point or render read-only; `null` → access is allowed.
   */
  deniedBy: (key: PermissionKey | string) => DeniedReason
  /** The current member's composed capability keys. */
  capabilities: PermissionKey[]
  isLoading: boolean
}

const CapabilitiesContext = createContext<CapabilitiesContextType | undefined>(undefined)

/**
 * Provides the current member's Layer-2 capability set, seeded from dehydrated
 * state and live-merged over realtime.
 *
 * Sibling of {@link FeatureFlagProvider} — MUST mount INSIDE it so `can()` can
 * AND the plan layer via `useFeatureFlags().hasAccess`. Seeds the key set from
 * the active org's dehydrated `capabilities`; on a `capabilities:changed` event
 * (user room or org events room) it refetches `permissions.myCapabilities` (a
 * cheap user-cache read) and swaps the set — menus/gates re-render automatically.
 * Server enforcement never trusts this copy, so the realtime path is UX-only.
 */
export function CapabilitiesProvider({ children }: { children: React.ReactNode }) {
  const { organizationId } = useOrganizationIdContext()
  const user = useDehydratedUser()
  const org = useDehydratedOrganization(organizationId)
  const { hasAccess } = useFeatureFlags()

  const dehydratedCaps = org?.capabilities
  // Stable signature of the dehydrated seed so the re-seed effect only fires on
  // an actual org switch (the dehydrated blob is static for a page load).
  const seedKey = useMemo(
    () => (dehydratedCaps ? [...dehydratedCaps].join(',') : ''),
    [dehydratedCaps]
  )

  const [capKeys, setCapKeys] = useState<ReadonlySet<string>>(() => new Set(dehydratedCaps ?? []))

  // Re-seed from dehydrated state when the active org changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seedKey encodes dehydratedCaps
  useEffect(() => {
    setCapKeys(new Set(dehydratedCaps ?? []))
  }, [organizationId, seedKey])

  // Disabled by default — the dehydrated set is the initial source; the realtime
  // event triggers a manual refetch, and the result swaps into local state.
  const myCapabilities = api.permissions.myCapabilities.useQuery(undefined, {
    enabled: false,
  })

  useEffect(() => {
    if (myCapabilities.data) setCapKeys(new Set(myCapabilities.data.keys))
  }, [myCapabilities.data])

  const refetch = myCapabilities.refetch
  const handlers = useMemo<SubscribeHandlers>(
    () => ({
      onEvent: (event) => {
        if (event === 'capabilities:changed') void refetch()
      },
    }),
    [refetch]
  )

  // Live merge — subscribe to both the current user's room (user grants,
  // role/seat changes) and the org events room (role/group grants fan-out).
  useRealtimeRoom(user ? rooms.user(user.id) : null, handlers)
  useRealtimeRoom(organizationId ? rooms.orgEvents(organizationId) : null, handlers)

  const value = useMemo<CapabilitiesContextType>(() => {
    const can = (key: PermissionKey | string): boolean => {
      const meta = PERMISSION_REGISTRY_MAP.get(key as PermissionKey)
      const planOk = meta?.featureKey ? hasAccess(meta.featureKey) : true
      return planOk && capKeys.has(key)
    }

    const deniedBy = (key: PermissionKey | string): DeniedReason => {
      const meta = PERMISSION_REGISTRY_MAP.get(key as PermissionKey)
      const planOk = meta?.featureKey ? hasAccess(meta.featureKey) : true
      const hasCap = capKeys.has(key)
      if (hasCap && planOk) return null
      // Plan first — an upgrade surface — then permission (hide / read-only).
      if (!planOk) return 'plan'
      return 'permission'
    }

    return {
      can,
      deniedBy,
      capabilities: [...capKeys] as PermissionKey[],
      isLoading: false,
    }
  }, [capKeys, hasAccess])

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>
}

/**
 * Consume the capability context. Combines the plan (Layer 1) and member
 * capability (Layer 2) layers into one `can()` / `deniedBy()` surface.
 */
export function useAccess(): CapabilitiesContextType {
  const context = useContext(CapabilitiesContext)
  if (context === undefined) {
    throw new Error('useAccess must be used within a CapabilitiesProvider')
  }
  return context
}
