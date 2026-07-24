// packages/lib/src/permissions/capabilities/entity-access.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { satisfiesPermission } from '../../resource-access/constants'
import {
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  isInstanceAccessKey,
} from './instance-access'
import { Area, areaLevelFromKeys, Level, PermissionKey } from './registry'
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
 * Def slugs whose visibility is governed OUTSIDE the records area, so record-level
 * view/edit gates pass them through:
 * - **Mail/messaging infrastructure** (`inbox`…`sequence`) — the mail visibility
 *   system.
 * - **Instance-access resources** (`dataset`, `kb`, `dashboard`) — their own L2
 *   area + per-instance `ResourceAccess` grants, disjoint from type-level def
 *   enforcement (plan 11 §0.6 / plan 12 §0.11 / plan 13 §0.6). `article`
 *   inherits its KB's grants (no per-article grants), so it is a non-record def
 *   too. Nothing calls `canViewEntity('dataset'|'kb'|'article'|'dashboard')`, so
 *   this is inert for enforcement; it keeps the client mirror
 *   `NON_RECORD_ENTITY_SLUGS` in `resources/registry/types.ts` consistent (that
 *   set hides datasets / KBs / articles / dashboards from the entity-def Access
 *   grid).
 *
 * Keyed by entity slug; the caller resolves the def to its slug before checking.
 */
export const NON_RECORD_DEF_SLUGS: ReadonlySet<string> = new Set([
  'inbox',
  'signature',
  'thread',
  'message',
  'snippet',
  'sequence',
  'dataset',
  'kb',
  'article',
  'dashboard',
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
  /**
   * Highest instance-level grant per `entityInstanceId` (CUID) for the
   * instance-access resources (datasets etc., §1.4). Explicit `'none'` rows are
   * KEPT (the per-instance downward marker). Optional — absent = `{}` (the
   * server `CapabilitySet.resolved()` view omits it; only the client instance
   * resolver reads it, always via {@link toResolvedRecordAccess}).
   */
  instanceAccess?: Readonly<Record<string, ResourcePermission>>
  /** Org-wide set of instance ids carrying ≥1 instance-access row. Optional (see above). */
  restrictedInstanceIds?: ReadonlySet<string>
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
 * Map an L2 area {@link Level} to the {@link ResourcePermission} vocabulary the
 * instance-access resolver speaks (Read→view · Edit→edit · Full→admin ·
 * None→undefined). Used as the absent-instance-row fallback for
 * `baselineAtCreate: false` resources (§1.4).
 */
export function levelToPermission(level: Level): ResourcePermission | undefined {
  if (level >= Level.Full) return ResourcePermission.admin
  if (level >= Level.Edit) return ResourcePermission.edit
  if (level >= Level.Read) return ResourcePermission.view
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
 *
 * The carve-out is **worker-seat only**. `recordsLinked` is not in
 * `USER_ADMIN_NONE_AREAS`, so `ROLE_DEFAULTS.USER` hands it out at `Full` and a
 * full seat holds `recordsViewLinked` too — without the seat check, that branch
 * would grant view of every unrestricted def to a member whose base records
 * level is `None`, silently defeating the Layer-2 lever (restricted defs stayed
 * correct; they require a grant either way). The row narrowing that is supposed
 * to make the verb safe (`resolveLinkedRecordIds`) is still unwired, so the
 * carve-out is only sound where the seat ceiling already confines it.
 */
export function canViewRecord(caps: ResolvedRecordAccess, entityDefinitionId: string): boolean {
  const level = effectiveRecordLevel(caps, entityDefinitionId)
  if (level !== undefined && satisfiesPermission(level, ResourcePermission.view)) return true
  if (caps.seatType === 'worker' && caps.keys.has(PermissionKey.recordsViewLinked)) {
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
  /**
   * Highest instance-level permission per `entityInstanceId` (instance-access
   * resources — datasets etc., §1.4). Optional: carried in the dehydration seed
   * so the client instance-access resolver (a later slice) and any server-built
   * snapshot have it; absent = treat as `{}`.
   */
  instanceAccess?: Record<string, ResourcePermission>
  /** Org-wide set of instance ids carrying ≥1 instance-access row. Optional (see above). */
  restrictedInstanceIds?: string[]
}

/** Rebuild the Set-backed {@link ResolvedRecordAccess} from a wire snapshot. */
export function toResolvedRecordAccess(caps: ClientCapabilities): ResolvedRecordAccess {
  return {
    role: caps.role,
    seatType: caps.seatType,
    keys: new Set(caps.keys),
    defAccess: caps.defAccess,
    restrictedEntityDefIds: new Set(caps.restrictedEntityDefIds),
    instanceAccess: caps.instanceAccess ?? {},
    restrictedInstanceIds: new Set(caps.restrictedInstanceIds ?? []),
  }
}

/**
 * Parse a `RecordId` (`entityDefinitionId:entityInstanceId`) into its parts.
 * Local, dependency-free split (first colon) so this pure module stays
 * client-safe without importing `@auxx/types`.
 */
function parseInstanceRecordId(recordId: string): { key: string; instanceId: string } {
  const i = recordId.indexOf(':')
  if (i === -1) return { key: recordId, instanceId: '' }
  return { key: recordId.slice(0, i), instanceId: recordId.slice(i + 1) }
}

/**
 * The member's effective per-instance permission for an instance-access resource
 * (most-specific-wins) — the CLIENT mirror of
 * {@link import('./capability-set').CapabilitySet}'s private
 * `effectiveInstanceLevel`, kept byte-for-byte in sync so client affordances and
 * server enforcement never drift (§1.4):
 *  - OWNER/ADMIN → `admin` (bypass — never self-lock).
 *  - L2 area gate closed (`None`) → `undefined`.
 *  - explicit instance row (incl. workspace baseline / `'none'`) → wins.
 *  - otherwise fall back to the base L2 area level (`baselineAtCreate: false`).
 */
function effectiveInstanceLevel(
  caps: ResolvedRecordAccess,
  key: InstanceAccessKey,
  instanceId: string
): ResourcePermission | undefined {
  if (caps.role === 'OWNER' || caps.role === 'ADMIN') return ResourcePermission.admin
  const cfg = INSTANCE_ACCESS_RESOURCES[key]
  const areaLevel = areaLevelFromKeys(caps.keys, cfg.area)
  if (areaLevel === Level.None) return undefined
  if ((caps.restrictedInstanceIds ?? EMPTY_INSTANCE_SET).has(instanceId)) {
    return caps.instanceAccess?.[instanceId]
  }
  return cfg.baselineAtCreate ? undefined : levelToPermission(areaLevel)
}

const EMPTY_INSTANCE_SET: ReadonlySet<string> = new Set()

/**
 * Instance-access VIEW gate (Read) — the client mirror of
 * `CapabilitySet.canViewInstance`. Takes a whole `RecordId`; returns `false` for
 * any def part that is not a registered instance-access resource. Zero I/O.
 */
export function canViewInstance(caps: ResolvedRecordAccess, recordId: string): boolean {
  const { key, instanceId } = parseInstanceRecordId(recordId)
  if (!isInstanceAccessKey(key)) return false
  const level = effectiveInstanceLevel(caps, key, instanceId)
  return level !== undefined && satisfiesPermission(level, ResourcePermission.view)
}

/**
 * Instance-access EDIT gate (Write) — mirror of `CapabilitySet.canEditInstance`.
 */
export function canEditInstance(caps: ResolvedRecordAccess, recordId: string): boolean {
  const { key, instanceId } = parseInstanceRecordId(recordId)
  if (!isInstanceAccessKey(key)) return false
  const level = effectiveInstanceLevel(caps, key, instanceId)
  return level !== undefined && satisfiesPermission(level, ResourcePermission.edit)
}

/**
 * Instance-access ADMIN gate (Full) — mirror of `CapabilitySet.canAdminInstance`.
 * Governs the Share card's editable affordances (who may re-share the instance).
 */
export function canAdminInstance(caps: ResolvedRecordAccess, recordId: string): boolean {
  const { key, instanceId } = parseInstanceRecordId(recordId)
  if (!isInstanceAccessKey(key)) return false
  const level = effectiveInstanceLevel(caps, key, instanceId)
  return level !== undefined && satisfiesPermission(level, ResourcePermission.admin)
}
