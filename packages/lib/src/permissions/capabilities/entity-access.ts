// packages/lib/src/permissions/capabilities/entity-access.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { satisfiesPermission } from '../../resource-access/constants'
import { Area, Level, PermissionKey } from './registry'
import { SEAT_CEILINGS } from './seat-policy'

/**
 * Client-safe core of the leveled record-access model — the most-specific-wins
 * math (v1.5 §5.1) extracted so the SERVER {@link import('./capability-set').CapabilitySet}
 * and the CLIENT capabilities provider resolve def access identically and can
 * never drift. Pure, zero I/O, no server-only deps (only enums + registry +
 * seat-policy constants), so it is exported through `@auxx/lib/permissions/client`.
 *
 * All def-keyed inputs use the canonical `entityDefinitionId` keyspace — the
 * caller normalizes any slug/apiSlug/id form first.
 */

/**
 * Mail/messaging infrastructure def slugs — visibility governed OUTSIDE the
 * records area (the mail visibility system), so record-level view/edit gates
 * pass them through. Keyed by entity slug; the caller resolves the def to its
 * slug before checking. (Moved here from `capability-set.ts` so the client can
 * apply the same carve-out.)
 */
export const NON_RECORD_DEF_SLUGS: ReadonlySet<string> = new Set([
  'inbox',
  'signature',
  'thread',
  'message',
  'snippet',
  'sequence',
])

/**
 * A resolved, normalized view of one member's record-access inputs — the shared
 * argument for every function here. The server builds it from its
 * `CapabilitySet` fields; the client from the dehydrated/refetched snapshot.
 */
export interface ResolvedRecordAccess {
  role: OrganizationRole
  seatType: SeatType
  /** Materialized capability verbs (already seat-clamped). */
  keys: ReadonlySet<PermissionKey>
  /** Highest type-level grant per `entityDefinitionId` (absent = not a grantee). */
  defAccess: Readonly<Record<string, ResourcePermission>>
  /** Defs carrying ≥1 type-level grant for anyone (`entityDefinitionId` keyspace). */
  restrictedEntityDefIds: ReadonlySet<string>
}

/**
 * The member's base records rung (Layer 2) from the seat-clamped key set.
 * `edit` covers create/update/delete (§0.1); `undefined` = No Access.
 * `recordsViewLinked` (field seats) is NOT a base rung — it's a
 * {@link canViewRecord} carve-out.
 */
export function baseRecordsLevel(keys: ReadonlySet<PermissionKey>): ResourcePermission | undefined {
  if (keys.has(PermissionKey.recordsEdit)) return ResourcePermission.edit
  if (keys.has(PermissionKey.recordsView)) return ResourcePermission.view
  return undefined
}

/**
 * Layer 2 × Layer 3, most-specific-wins. The member's effective record
 * permission for a def, or `undefined` (= No Access).
 *  - OWNER/ADMIN → `admin` (bypass — never self-lock).
 *  - restricted def → the member's own grant REPLACES base.
 *  - unrestricted def → base records level fills in.
 *  - worker seat (records ceiling None) → `undefined`.
 */
export function effectiveRecordLevel(
  caps: ResolvedRecordAccess,
  entityDefinitionId: string
): ResourcePermission | undefined {
  if (caps.role === 'OWNER' || caps.role === 'ADMIN') return ResourcePermission.admin
  const chosen = caps.restrictedEntityDefIds.has(entityDefinitionId)
    ? caps.defAccess[entityDefinitionId]
    : baseRecordsLevel(caps.keys)
  if (chosen === undefined) return undefined
  if (SEAT_CEILINGS[caps.seatType][Area.records] === Level.None) return undefined
  return chosen
}

/**
 * Records-area VIEW gate (no mail-infra carve-out — the caller pre-checks that).
 * `effectiveRecordLevel` satisfies `view`, OR the field-seat `recordsViewLinked`
 * carve-out (narrowed rows; a restricted def still needs a grant).
 */
export function canViewRecord(caps: ResolvedRecordAccess, entityDefinitionId: string): boolean {
  const level = effectiveRecordLevel(caps, entityDefinitionId)
  if (level !== undefined && satisfiesPermission(level, ResourcePermission.view)) return true
  if (caps.keys.has(PermissionKey.recordsViewLinked)) {
    if (!caps.restrictedEntityDefIds.has(entityDefinitionId)) return true
    return caps.defAccess[entityDefinitionId] !== undefined
  }
  return false
}

/**
 * Records-area EDIT gate — `effectiveRecordLevel` satisfies the `edit` floor.
 * (Mail-infra and dedicated-write-key defs bypass this in the caller.)
 */
export function canEditRecord(caps: ResolvedRecordAccess, entityDefinitionId: string): boolean {
  const level = effectiveRecordLevel(caps, entityDefinitionId)
  return level !== undefined && satisfiesPermission(level, ResourcePermission.edit)
}

/**
 * Def-ADMINISTRATION gate (§9.1) — whether the member may administer the
 * DEFINITION itself: manage its fields, its access (the Access tab), its
 * metadata (name/icon/description), and delete/archive the def. This is the
 * `admin`/`Full` rung — a scoped delegation of org-admin for one def.
 *
 * Unlike {@link canViewRecord}/{@link canEditRecord}, def administration does
 * NOT flow from the base records level: a base `Full` member edits *records*,
 * never *definitions*. Only an explicit type-level grant of exactly `admin`
 * (or OWNER/ADMIN) confers it — so it reads the RAW `defAccess` grant, not
 * `effectiveRecordLevel`. Worker seats (records ceiling None) never administer.
 */
export function canAdministerRecord(
  caps: ResolvedRecordAccess,
  entityDefinitionId: string
): boolean {
  if (caps.role === 'OWNER' || caps.role === 'ADMIN') return true
  if (SEAT_CEILINGS[caps.seatType][Area.records] === Level.None) return false
  return caps.defAccess[entityDefinitionId] === ResourcePermission.admin
}

/**
 * Whether the member administers AT LEAST ONE def — the "is there any def-admin
 * surface for me at all" gate (e.g. showing the Custom Fields settings nav entry
 * / listing only administered defs). OWNER/ADMIN administer every def; everyone
 * else needs ≥1 explicit `admin` type-grant. Worker seats never administer.
 */
export function administersAnyDef(caps: ResolvedRecordAccess): boolean {
  if (caps.role === 'OWNER' || caps.role === 'ADMIN') return true
  if (SEAT_CEILINGS[caps.seatType][Area.records] === Level.None) return false
  return Object.values(caps.defAccess).some((p) => p === ResourcePermission.admin)
}

/**
 * Serializable snapshot of a member's record-access inputs — the wire shape sent
 * to the client (dehydrated seed + `permissions.myCapabilities`). Arrays instead
 * of Sets so it is JSON-safe; the client rebuilds a {@link ResolvedRecordAccess}.
 */
export interface ClientCapabilities {
  keys: PermissionKey[]
  defAccess: Record<string, ResourcePermission>
  restrictedEntityDefIds: string[]
  role: OrganizationRole
  seatType: SeatType
}

/** Rebuild the Set-backed {@link ResolvedRecordAccess} from a wire snapshot. */
export function toResolvedRecordAccess(caps: ClientCapabilities): ResolvedRecordAccess {
  return {
    role: caps.role,
    seatType: caps.seatType,
    keys: new Set(caps.keys),
    defAccess: caps.defAccess,
    restrictedEntityDefIds: new Set(caps.restrictedEntityDefIds),
  }
}
