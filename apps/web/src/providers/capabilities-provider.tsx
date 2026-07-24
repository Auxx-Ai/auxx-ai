// apps/web/src/providers/capabilities-provider.tsx
'use client'

import {
  administersAnyDef,
  type ClientCapabilities,
  canAdminInstance,
  canAdministerRecord,
  canEditInstance,
  canEditRecord,
  canViewInstance,
  canViewRecord,
  PERMISSION_REGISTRY_MAP,
  type PermissionKey,
  toResolvedRecordAccess,
} from '@auxx/lib/permissions/client'
import type { SubscribeHandlers } from '@auxx/lib/realtime/client'
import { rooms } from '@auxx/lib/realtime/client'
import type { RecordId } from '@auxx/types/resource'
import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useRealtimeRoom } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import { useDehydratedOrganization, useDehydratedUser } from './dehydrated-state-provider'
import { useFeatureFlags, useOrganizationIdContext } from './feature-flag-provider'

/** Why a capability check failed — drives UX (§7.3). */
export type DeniedReason = 'plan' | 'permission' | null

/** Fail-closed default when no org is seeded — base None, so every gate denies. */
const EMPTY_CAPS: ClientCapabilities = {
  keys: [],
  defAccess: {},
  restrictedEntityDefIds: [],
  role: 'USER',
  seatType: 'full',
}

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
  /**
   * Per-def READ gate (Layer 2 × Layer 3, most-specific-wins) — mirrors the
   * server `canViewEntity`. Pass the canonical `entityDefinitionId` (e.g.
   * `resource.entityDefinitionId`), NOT the slug/apiSlug.
   */
  canViewEntity: (entityDefinitionId: string) => boolean
  /**
   * Per-def WRITE gate — mirrors the server `canEditEntity`, including
   * server-computed base overrides for feature-backed definitions such as work
   * orders. Mail-infrastructure defs remain governed by their own feature UI.
   */
  canEditEntity: (entityDefinitionId: string) => boolean
  /**
   * Per-def ADMINISTRATION gate — mirrors the server `canAdministerDef` (the
   * `Full`/`admin` rung). Governs def-administration affordances: managing a
   * def's fields, its Access tab, its structural table-view configs (org default
   * view + panel/dialog field layouts). Unlike `canEditEntity` this does NOT flow
   * from the base records level — only an explicit `admin` grant (or OWNER/ADMIN)
   * confers it. Pass the canonical `entityDefinitionId`. Server enforces; this is
   * degrade-only to avoid click-then-403.
   */
  canAdministerDef: (entityDefinitionId: string) => boolean
  /**
   * Whether the member administers ANY def — the "is there a def-admin surface
   * for me at all" gate (e.g. showing the Custom Fields settings nav entry). True
   * for OWNER/ADMIN or a member holding ≥1 `admin` type-grant. Server enforces
   * the per-def actions; this only decides discoverability of the entry point.
   */
  administersAnyDef: boolean
  /**
   * Per-instance READ gate for instance-access resources (datasets etc.) —
   * mirrors the server `CapabilitySet.canViewInstance`. Pass a whole `RecordId`
   * (`toRecordId('dataset', id)`); returns `false` for any non-instance-access
   * def part. Degrade-only; the server remains the source of truth.
   */
  canViewInstance: (recordId: RecordId) => boolean
  /** Per-instance WRITE gate — mirrors the server `canEditInstance`. */
  canEditInstance: (recordId: RecordId) => boolean
  /**
   * Per-instance ADMIN gate (`Full`) — mirrors the server `canAdminInstance`.
   * Governs who may re-share an instance (the Share card's editable affordances).
   */
  canAdminInstance: (recordId: RecordId) => boolean
  /**
   * Whether an instance carries ≥1 explicit instance-access row (the org-wide
   * `restrictedInstanceIds` signal, §1.3) — drives the "Shared"/🔒 badge. Pass
   * the bare `entityInstanceId` (CUID), NOT a `RecordId`.
   */
  isRestrictedInstance: (instanceId: string) => boolean
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
 * AND the plan layer via `useFeatureFlags().hasAccess`. Seeds the snapshot from
 * the active org's dehydrated `capabilities`; on a `capabilities:changed` event
 * (user room or org events room) it refetches `permissions.myCapabilities` (a
 * cheap user-cache read) and swaps it — menus/gates re-render automatically.
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
    () => (dehydratedCaps ? JSON.stringify(dehydratedCaps) : ''),
    [dehydratedCaps]
  )

  const [snapshot, setSnapshot] = useState<ClientCapabilities>(() => dehydratedCaps ?? EMPTY_CAPS)

  // Re-seed from dehydrated state when the active org changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seedKey encodes dehydratedCaps
  useEffect(() => {
    setSnapshot(dehydratedCaps ?? EMPTY_CAPS)
  }, [organizationId, seedKey])

  // Disabled by default — the dehydrated snapshot is the initial source; the
  // realtime event triggers a manual refetch, and the result swaps into state.
  const myCapabilities = api.permissions.myCapabilities.useQuery(undefined, {
    enabled: false,
  })

  useEffect(() => {
    if (myCapabilities.data) setSnapshot(myCapabilities.data)
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
    const capKeys = new Set<string>(snapshot.keys)
    const resolved = toResolvedRecordAccess(snapshot)
    const restrictedInstances = new Set<string>(snapshot.restrictedInstanceIds ?? [])

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
      canViewEntity: (entityDefinitionId: string) => canViewRecord(resolved, entityDefinitionId),
      canEditEntity: (entityDefinitionId: string) => canEditRecord(resolved, entityDefinitionId),
      canAdministerDef: (entityDefinitionId: string) =>
        canAdministerRecord(resolved, entityDefinitionId),
      administersAnyDef: administersAnyDef(resolved),
      canViewInstance: (recordId: RecordId) => canViewInstance(resolved, recordId),
      canEditInstance: (recordId: RecordId) => canEditInstance(resolved, recordId),
      canAdminInstance: (recordId: RecordId) => canAdminInstance(resolved, recordId),
      isRestrictedInstance: (instanceId: string) => restrictedInstances.has(instanceId),
      capabilities: snapshot.keys,
      isLoading: false,
    }
  }, [snapshot, hasAccess])

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>
}

/**
 * Consume the capability context. Combines the plan (Layer 1) and member
 * capability (Layer 2) layers into one `can()` / `deniedBy()` surface, plus the
 * per-def `canViewEntity` / `canEditEntity` gates (Layer 3).
 */
export function useAccess(): CapabilitiesContextType {
  const context = useContext(CapabilitiesContext)
  if (context === undefined) {
    throw new Error('useAccess must be used within a CapabilitiesProvider')
  }
  return context
}

/**
 * Whether the current member may administer (re-share) an instance-access
 * resource — OWNER/ADMIN or an explicit `Full` instance grant. Thin wrapper over
 * {@link useAccess} for the Share card's affordance gate (§4). Server enforces;
 * this only decides editability of the sharing UI.
 */
export function useCanAdminInstance(recordId: RecordId): boolean {
  return useAccess().canAdminInstance(recordId)
}
