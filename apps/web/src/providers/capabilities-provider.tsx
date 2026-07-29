// apps/web/src/providers/capabilities-provider.tsx
'use client'

import {
  administersAnyDef,
  type ClientCapabilities,
  canAdminInstance,
  canAdministerRecord,
  canDeleteRecord,
  canEditInstance,
  canEditRecord,
  canImportRecord,
  canViewInstance,
  canViewRecord,
  PERMISSION_REGISTRY_MAP,
  type PermissionKey,
  toResolvedRecordAccess,
} from '@auxx/lib/permissions/client'
import type { SubscribeHandlers } from '@auxx/lib/realtime/client'
import { rooms } from '@auxx/lib/realtime/client'
import type { RecordId } from '@auxx/types/resource'
import { usePathname, useRouter } from 'next/navigation'
import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
   * Per-def DELETE gate — mirrors the server `canDeleteEntity`, which backs
   * `record.delete` / `bulkDelete` / `merge`. Satisfied by the org-wide
   * `records.delete` verb OR an explicit per-def `admin` grant, both floored by
   * the def's edit gate.
   *
   * Use this instead of spelling out `canEditEntity(def) && can(recordsDelete)`
   * at a call site: that conjunction is only the FIRST branch of the server
   * predicate, so hand-written copies now under-report for a per-def `admin`
   * grantee and hide a delete the server would allow.
   */
  canDeleteEntity: (entityDefinitionId: string) => boolean
  /**
   * Per-def IMPORT gate — mirrors the server `canImportEntity`, which backs every
   * procedure in `data-import.ts`. Same two branches as {@link canDeleteEntity},
   * on the `records.import` verb.
   */
  canImportEntity: (entityDefinitionId: string) => boolean
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
   * Whether an instance's access is GOVERNED by rows — a `role:org_member`
   * baseline at any permission, or any `permission = 'none'` marker (the org-wide
   * `governingInstanceIds` signal, §1.3). Pass the bare `entityInstanceId`
   * (CUID), NOT a `RecordId`.
   *
   * **Narrowed 2026-07-29** together with `effectiveInstanceLevel`: it used to
   * mean "carries ≥1 row for anyone", which conflated sharing with restricting.
   * Consumers are the "Shared"/🔒 badge on the dataset/KB cards and the
   * "People with access" section on the workflow settings panel, and both shift
   * accordingly — an instance shared to one grantee with no authored baseline no
   * longer lights them up, because it is no longer restricted for anybody. The
   * badge now marks instances whose access really has been shaped, which is what
   * its "Shared with specific access" copy claims.
   */
  isRestrictedInstance: (instanceId: string) => boolean
  /**
   * The current member's composed capability keys, from resolved AREA levels
   * only — instance-derived Read rungs are excluded, because the consumers of
   * this field recover area levels from it. Use `can()` for gating.
   */
  capabilities: PermissionKey[]
  /**
   * True while NO capability snapshot has been seeded (no active org, or the org
   * is missing from dehydrated state). `can()` fails closed throughout, so
   * hide/disable gates need not check this — but anything that REDIRECTS or
   * renders a denial surface MUST, or it acts on "unknown" as if it were "denied".
   */
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
  // Stable signature of the dehydrated seed (the blob is static for a page load).
  const seedKey = useMemo(
    () => (dehydratedCaps ? JSON.stringify(dehydratedCaps) : ''),
    [dehydratedCaps]
  )
  // Identity of the active seed. An org switch changes it, which discards the
  // realtime refetch below rather than letting the previous org's keys survive.
  const seedId = `${organizationId ?? ''}:${seedKey}`
  const seedIdRef = useRef(seedId)
  seedIdRef.current = seedId

  // Disabled by default — the dehydrated blob is the source; the realtime event
  // triggers a manual refetch and the result refines it.
  const myCapabilities = api.permissions.myCapabilities.useQuery(undefined, {
    enabled: false,
  })

  // Refetch result, tagged with the seed it refines. Read during render (not
  // swapped in by an effect) so an org switch takes effect on the SAME render
  // the new blob arrives — no frame composes gates from the old org's keys.
  const [live, setLive] = useState<{ seedId: string; caps: ClientCapabilities } | null>(null)

  useEffect(() => {
    if (myCapabilities.data) setLive({ seedId: seedIdRef.current, caps: myCapabilities.data })
  }, [myCapabilities.data])

  /**
   * `null` means NOT SEEDED — no active org, or the org is absent from
   * dehydrated state — which is NOT the same as "seeded and denied". `can()`
   * still fails closed (via `EMPTY_CAPS`) so nothing renders that shouldn't, but
   * anything that REDIRECTS must wait for `isLoading` to clear or it ejects a
   * legitimate admin mid-org-switch.
   */
  const liveCaps = live && live.seedId === seedId ? live.caps : null
  const seededCaps: ClientCapabilities | null = liveCaps ?? dehydratedCaps ?? null

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
    const snapshot = seededCaps ?? EMPTY_CAPS
    // The `can()` gate reads the UNION of resolved-area keys and the Read rungs
    // derived from instance grants, so a member whose only access to a feature is
    // one shared instance still passes the coarse nav / cmd+K / landing-page
    // gates. `toResolvedRecordAccess` below deliberately gets `snapshot` with its
    // pure `keys` — that view is the AREA-level source of truth for
    // `canViewInstance`, and merging the derived key there would hand them every
    // row-less instance in the org.
    const capKeys = new Set<string>([...snapshot.keys, ...(snapshot.instanceDerivedKeys ?? [])])
    const resolved = toResolvedRecordAccess(snapshot)
    const governedInstances = new Set<string>(snapshot.governingInstanceIds ?? [])

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
      canDeleteEntity: (entityDefinitionId: string) =>
        canDeleteRecord(resolved, entityDefinitionId),
      canImportEntity: (entityDefinitionId: string) =>
        canImportRecord(resolved, entityDefinitionId),
      canAdministerDef: (entityDefinitionId: string) =>
        canAdministerRecord(resolved, entityDefinitionId),
      administersAnyDef: administersAnyDef(resolved),
      canViewInstance: (recordId: RecordId) => canViewInstance(resolved, recordId),
      canEditInstance: (recordId: RecordId) => canEditInstance(resolved, recordId),
      canAdminInstance: (recordId: RecordId) => canAdminInstance(resolved, recordId),
      isRestrictedInstance: (instanceId: string) => governedInstances.has(instanceId),
      // Pure area-derived keys, NOT the `can()` union: the only consumers feed
      // this straight into `areaLevelFromKeys` (the agent-policy / author clamp
      // previews), which must read a true area rung.
      capabilities: snapshot.keys,
      isLoading: seededCaps === null,
    }
  }, [seededCaps, hasAccess])

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
 * Redirect to `/access-denied` unless the viewer holds `key`.
 *
 * The capability replacement for `useUser({ requireRoles })` (plan 39 §3.1) —
 * page-level authorization belongs beside {@link useAccess}, not on the
 * identity hook. OWNER/ADMIN hold every key via `ROLE_DEFAULTS`, so swapping a
 * role gate for this widens the surface to key-holders and changes nothing for
 * anyone who passes today.
 *
 * Two properties this MUST keep:
 * - It does not act while capabilities are unseeded (`isLoading`). With no
 *   active org `can()` is fail-closed by design, and redirecting there would
 *   bounce a legitimate admin on an org switch or a refresh.
 * - {@link useAccess} THROWS outside `CapabilitiesProvider`, so any surface not
 *   mounted under it (the public workflow viewer) cannot use this hook.
 *
 * A client redirect renders first and then navigates — it is a UX affordance,
 * never a boundary. The server gates independently.
 *
 * @param enabled Pass `false` to hold the redirect (a caller that renders its
 *   own denial surface instead). Keeps the hook unconditional.
 */
export function useRequireCapability(key: PermissionKey | string, enabled = true): void {
  const { can, isLoading } = useAccess()
  useRedirectUnless(isLoading ? null : can(key), enabled)
}

/**
 * Redirect to `/access-denied` unless the viewer may EDIT `entityDefinitionId` —
 * the per-def (Layer 2 × Layer 3) sibling of {@link useRequireCapability}.
 *
 * For surfaces that manage records rather than settings. `UnifiedCrudHandler`
 * asserts `assertEditEntity(defId)` on every write path, so this is the client
 * mirror of what the server will actually do — a flat area key would be a
 * different question than the one being enforced.
 *
 * An unresolved `entityDefinitionId` is treated as NOT KNOWN, not as denied:
 * the resource/def stores hydrate asynchronously, and redirecting on the
 * pre-hydration render is the same class of bug as ignoring `isLoading`.
 */
export function useRequireEntityEdit(
  entityDefinitionId: string | null | undefined,
  enabled = true
): void {
  const { canEditEntity, isLoading } = useAccess()
  useRedirectUnless(
    isLoading || !entityDefinitionId ? null : canEditEntity(entityDefinitionId),
    enabled
  )
}

/**
 * Shared body for the redirect hooks. `allowed === null` means "not known yet"
 * and must never navigate — the whole point of the `isLoading` bail-out is that
 * a capability gate cannot tell "denied" from "unseeded" without it.
 */
function useRedirectUnless(allowed: boolean | null, enabled: boolean): void {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!enabled || allowed === null) return
    // Auth pages render outside the app shell (mirrors useUser's bail-out).
    if (pathname === '/login' || pathname === '/register' || pathname === '/forgot-password') return
    if (!allowed) router.push('/access-denied')
  }, [allowed, enabled, pathname, router])
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
