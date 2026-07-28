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
 * - **Instance-access resources** (`dataset`, `kb`, `dashboard`, `workflow`) —
 *   their own L2 area + per-instance `ResourceAccess` grants, disjoint from
 *   type-level def enforcement (plan 11 §0.6 / plan 12 §0.11 / plan 13 §0.6 /
 *   plan 30 §5). `article` inherits its KB's grants (no per-article grants), so
 *   it is a non-record def too. Nothing calls
 *   `canViewEntity('dataset'|'kb'|'article'|'dashboard'|'workflow')`, so this is
 *   inert for enforcement; it keeps the client mirror `NON_RECORD_ENTITY_SLUGS`
 *   in `resources/registry/types.ts` consistent (that set hides datasets / KBs /
 *   articles / dashboards / workflows from the entity-def Access grid).
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
  'workflow',
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
   * Per-def record base for definitions whose base comes from another Layer-2
   * area, keyed by canonical `entityDefinitionId`. `null` means that area's
   * level is None; an absent key falls back to the Records area.
   */
  defBaseOverrides?: Readonly<Record<string, ResourcePermission | null>>
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
  return levelToRecordBasePermission(areaLevelFromKeys(keys, Area.records))
}

/**
 * Map a Layer-2 area rung to the record-base vocabulary. `Full` deliberately
 * maps to `edit`, not `admin`: managing a feature's records does not confer
 * administration of their entity definition.
 */
export function levelToRecordBasePermission(level: Level): ResourcePermission | undefined {
  if (level >= Level.Edit) return ResourcePermission.edit
  if (level >= Level.Read) return ResourcePermission.view
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
 *  - OWNER → `admin` (the §0.10 recovery bypass — never self-lock).
 *  - restricted def → the member's own grant REPLACES base.
 *  - unrestricted def → base records level fills in.
 *  - worker seat (records ceiling None) → `undefined`.
 *
 * **ADMIN no longer bypasses** (doc 19 §3 / §5.3 piece 2, step 10): an admin's
 * record level now flows from the `admin` profile like anyone else's, so an
 * area/definition restriction authored on that profile actually bites. The
 * seeded `admin` profile is all-`Full`, which resolves to the `edit` base rung
 * ({@link levelToRecordBasePermission} caps base at `edit` by design), so on an
 * org with no restricted defs an admin's view/edit gates are unchanged.
 * Definition *administration* is deliberately NOT taken away here — see
 * {@link canAdministerRecord}.
 */
export function effectiveRecordLevel(
  caps: ResolvedRecordAccess,
  entityDefinitionId: string
): ResourcePermission | undefined {
  if (caps.role === 'OWNER') return ResourcePermission.admin
  const hasBaseOverride = Object.hasOwn(caps.defBaseOverrides ?? {}, entityDefinitionId)
  const unrestrictedBase = hasBaseOverride
    ? (caps.defBaseOverrides?.[entityDefinitionId] ?? undefined)
    : baseRecordsLevel(caps.keys)
  const chosen = caps.restrictedEntityDefIds.has(entityDefinitionId)
    ? caps.defAccess[entityDefinitionId]
    : unrestrictedBase
  if (chosen === undefined) return undefined
  if (SEAT_CEILINGS[caps.seatType][Area.records] === Level.None) return undefined
  return chosen
}

/**
 * Records-area VIEW gate (no mail-infra carve-out — the caller pre-checks that).
 * `effectiveRecordLevel` satisfies `view`, OR the field-seat `recordsViewLinked`
 * carve-out (narrowed rows; a restricted def still needs a grant).
 *
 * The carve-out is **worker-seat only**. `recordsLinked` is not omitted from
 * `MEMBER_BASELINE_LEVELS` (seat-policy.ts) — the Member profile's seeded
 * grant hands it out at `Full` — so a full seat holds `recordsViewLinked` too;
 * without the seat check, that branch would grant view of every unrestricted
 * def to a member whose base records level is `None`, silently defeating the
 * Layer-2 lever (restricted defs stayed correct; they require a grant either
 * way). The row narrowing that is supposed to make the verb safe
 * (`resolveLinkedRecordIds`) is still unwired, so the carve-out is only sound
 * where the seat ceiling already confines it.
 */
export function canViewRecord(caps: ResolvedRecordAccess, entityDefinitionId: string): boolean {
  const level = effectiveRecordLevel(caps, entityDefinitionId)
  if (level !== undefined && satisfiesPermission(level, ResourcePermission.view)) return true
  if (caps.seatType === 'worker' && caps.keys.has(PermissionKey.recordsViewLinked)) {
    // The carve-out skips `effectiveRecordLevel`, so it is sound ONLY because the
    // `seatType === 'worker'` guard above keeps it confined to the seat ceiling
    // that already governs this verb (§3 — a clamp applied at some seams only is
    // defeated by the others).
    if (!caps.restrictedEntityDefIds.has(entityDefinitionId)) return true
    return caps.defAccess[entityDefinitionId] !== undefined
  }
  return false
}

/**
 * Record EDIT gate — `effectiveRecordLevel` satisfies the `edit` floor.
 * Mail-infrastructure defs bypass this in the server caller.
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
 * never *definitions*. That stays true through {@link effectiveRecordLevel},
 * because the base rungs top out at `edit` ({@link levelToRecordBasePermission}
 * maps `Level.Full` → `edit`, never `admin`) — only an explicit `admin`
 * type-grant on a restricted def, or OWNER/ADMIN, reaches this rung.
 *
 * It goes through {@link effectiveRecordLevel} rather than reading `defAccess`
 * raw so that every clamp on that path — today the worker seat ceiling, plus
 * whatever lands there next — applies here too (§3: a clamp added at one seam
 * only is defeated by the others). That repoint is doc 19 step 4's own
 * correctness fix and is independent of the deleted definition ceiling; do not
 * revert it back to raw `defAccess`.
 *
 * **ADMIN deliberately KEEPS its bypass here** (doc 19 step 10). Step 10 narrowed
 * ADMIN out of `effectiveRecordLevel`, `effectiveInstanceLevel` and
 * `resource-access-service`, but not out of this gate, because the profile model
 * has **no rung that expresses definition administration**: base records levels
 * top out at `edit` ({@link levelToRecordBasePermission}), so an ADMIN on the
 * all-`Full` seeded profile would resolve to `edit` and lose *every* def —
 * custom fields, entity-definition edits, table-view management — with nothing on
 * the profile able to give it back short of an explicit per-def `admin`
 * `ResourceAccess` row for each definition in the org. That is capability loss
 * with no lever, not shapeability. Making it shapeable needs a decision doc 19
 * does not make (most likely: derive it from `Area.settings` at `Full`, which is
 * `adminOnly` and therefore already `Full` for ADMIN and `None` for USER —
 * parity-preserving). Tracked as a §11 open item; do not narrow this in isolation.
 */
export function canAdministerRecord(
  caps: ResolvedRecordAccess,
  entityDefinitionId: string
): boolean {
  if (caps.role === 'OWNER' || caps.role === 'ADMIN') return true
  const level = effectiveRecordLevel(caps, entityDefinitionId)
  return level !== undefined && satisfiesPermission(level, ResourcePermission.admin)
}

/**
 * Whether the member administers AT LEAST ONE def — the "is there any def-admin
 * surface for me at all" gate (e.g. showing the Custom Fields settings nav entry
 * / listing only administered defs). OWNER/ADMIN administer every def; everyone
 * else needs ≥1 explicit `admin` type-grant. Worker seats never administer.
 *
 * The ADMIN half of this early return is kept in lockstep with
 * {@link canAdministerRecord} — narrowing one without the other would leave the
 * settings nav hidden from admins who can still use every procedure behind it.
 * See that function for why neither is narrowed yet.
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
  /**
   * Coarse keys synthesized from the member's instance grants — the mirror of
   * {@link import('./compose-user-capabilities').UserCapabilities.instanceDerivedKeys}.
   * The client `can()` gate reads `keys ∪ instanceDerivedKeys`; every AREA-level
   * computation ({@link toResolvedRecordAccess} → `areaLevelFromKeys` →
   * `effectiveInstanceLevel` / `instanceListScope`, and the agent-policy clamp
   * previews) reads `keys` alone. Optional — absent = `[]`.
   *
   * Mixing them would be a leak, not a nicety: a derived `workflows.view` inside
   * `keys` makes `areaLevelFromKeys` report `Level.Read` for the area, and every
   * workflow with no explicit row would then fall back to `view`.
   */
  instanceDerivedKeys?: PermissionKey[]
  defAccess: Record<string, ResourcePermission>
  restrictedEntityDefIds: string[]
  /**
   * Per-def record base for definitions backed by another Layer-2 area.
   * `null` means no access; absent definitions use the Records base.
   */
  defBaseOverrides?: Record<string, ResourcePermission | null>
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

/**
 * Rebuild the Set-backed {@link ResolvedRecordAccess} from a wire snapshot.
 *
 * `instanceDerivedKeys` is deliberately NOT merged into `keys` here: this view's
 * `keys` is the AREA-level source of truth for `effectiveInstanceLevel` /
 * `instanceListScope`, and folding a derived Read key into it would re-open the
 * area's absent-row fallback for every instance in the org. The front-door union
 * lives in the `can()` gate (`capabilities-provider`), not in this view.
 */
export function toResolvedRecordAccess(caps: ClientCapabilities): ResolvedRecordAccess {
  return {
    role: caps.role,
    seatType: caps.seatType,
    keys: new Set(caps.keys),
    defAccess: caps.defAccess,
    restrictedEntityDefIds: new Set(caps.restrictedEntityDefIds),
    defBaseOverrides: caps.defBaseOverrides ?? {},
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
 *  - OWNER → `admin` (the §0.10 recovery bypass — never self-lock).
 *  - explicit instance row (incl. workspace baseline / `'none'`) → wins, even
 *    when the L2 area gate is closed.
 *  - L2 area gate closed (`None`) and NO row → `undefined`.
 *  - otherwise fall back to the base L2 area level (`baselineAtCreate: false`).
 *
 * **An explicit instance row beats the area floor** (plan 25 §2, decided
 * 2026-07-27). The row check used to sit BELOW the `areaLevel === Level.None`
 * return, which made every share to a sparse-profile member inert: the only way
 * to make "you may see this ONE workflow" work was to raise their profile to
 * `workflows: Read`, and because `workflow` is `baselineAtCreate: false` that
 * granted read on EVERY workflow — the exact opposite of a single-instance
 * share. Most-specific-wins now runs all the way down, matching
 * {@link effectiveRecordLevel}, where an explicit per-def grant has always
 * REPLACED the base rather than being clamped by it.
 *
 * Fail-closed is preserved by `restrictedInstanceIds`: the unshared majority
 * have no row at all, so they fall through to the area gate and are denied. Only
 * an instance someone deliberately authored a row for can escape the floor, and
 * an explicit `'none'` row still denies (it is the per-instance downward marker).
 *
 * **The SEAT ceiling still dominates, and is now checked explicitly.** It used
 * to be enforced implicitly: `areaLevelFromKeys` reads an already seat-clamped
 * key set, so a closed seat area meant `areaLevel === Level.None` and the
 * short-circuit denied before any row was read. Now that a row outranks the
 * floor, that implicit path is gone and the clamp has to be stated — otherwise
 * one `admin` grant would hand a worker seat a workflow its billing packaging
 * excludes. Same shape as {@link effectiveRecordLevel}'s records-ceiling check
 * (§3: a clamp applied at some seams only is defeated by the others).
 *
 * **ADMIN no longer bypasses** (doc 19 §5.3 piece 2, step 10). On the seeded
 * all-`Full` `admin` profile the fallback branch returns `admin` anyway for the
 * org-shared resources (`dataset`, `kb`), so an unshared instance is unchanged;
 * an instance that IS explicitly shared now resolves through the admin's own
 * grants, which is the whole point of removing the bypass.
 *
 * Exported so the doc-19 §6.1 escalation guard measures a holder's per-instance
 * authority through the SAME predicate the read path enforces (§6.1.4) — the
 * guard must never re-derive its own instance rules.
 */
export function effectiveInstanceLevel(
  caps: ResolvedRecordAccess,
  key: InstanceAccessKey,
  instanceId: string
): ResourcePermission | undefined {
  if (caps.role === 'OWNER') return ResourcePermission.admin
  const cfg = INSTANCE_ACCESS_RESOURCES[key]
  if (SEAT_CEILINGS[caps.seatType][cfg.area] === Level.None) return undefined
  if ((caps.restrictedInstanceIds ?? EMPTY_INSTANCE_SET).has(instanceId)) {
    return caps.instanceAccess?.[instanceId]
  }
  const areaLevel = areaLevelFromKeys(caps.keys, cfg.area)
  if (areaLevel === Level.None) return undefined
  return cfg.baselineAtCreate ? undefined : levelToPermission(areaLevel)
}

const EMPTY_INSTANCE_SET: ReadonlySet<string> = new Set()

/**
 * Instance-access keys whose absent-row fallback is the member's AREA level
 * (`baselineAtCreate: false` — `dataset`, `kb`, `workflow`). Derived from
 * {@link INSTANCE_ACCESS_RESOURCES} rather than hand-listed, so flipping a
 * resource to `baselineAtCreate: true` removes it here and makes
 * {@link instanceListScope} a COMPILE error at its call sites instead of a
 * silent leak — see that function for why the distinction is load-bearing.
 */
export type OrgSharedInstanceAccessKey = {
  [K in InstanceAccessKey]: (typeof INSTANCE_ACCESS_RESOURCES)[K]['baselineAtCreate'] extends false
    ? K
    : never
}[InstanceAccessKey]

/**
 * The id filter a paginated LIST query needs so that `limit`/`offset`/`total`
 * run over the set the member may actually see.
 *
 * Post-pagination filtering (fetch a page, then drop the rows the member can't
 * view) makes `total`/`hasMore` describe the UNFILTERED page, returns short
 * pages, and — with enough restrictions — an EMPTY page alongside
 * `hasMore: true`, which breaks any client that stops on an empty page.
 *
 * Three outcomes, because plan 25 §2 made the member's visible set either a
 * near-total set with holes or a tiny explicit allow-list, and no single id list
 * can express both:
 *  - `'none'` — view nothing; return an empty list WITHOUT querying.
 *  - `'exclude'` — everything except {@link excludeIds} (the open-area case; the
 *    array is usually empty).
 *  - `'include'` — ONLY {@link includeIds} (the closed-area case: the member
 *    composes the area to `None` but holds explicit instance grants).
 *
 * The unused arm is typed `undefined` on each variant so a caller that has
 * already excluded `'none'` can spread both fields into a filter object without
 * branching.
 */
export type InstanceListScope =
  | { kind: 'none'; excludeIds?: undefined; includeIds?: undefined }
  | { kind: 'exclude'; excludeIds: string[]; includeIds?: undefined }
  | { kind: 'include'; includeIds: string[]; excludeIds?: undefined }

/**
 * The id filter that reproduces {@link canViewInstance} for an org-shared
 * instance-access resource, computed UP FRONT so a list query can apply it
 * BEFORE it paginates. The list-side twin of `canViewInstance` — if these two
 * disagree, a member sees an empty page for an instance they can demonstrably
 * open.
 *
 * Enumerating either side is only sound for `baselineAtCreate: false` resources,
 * which is why the `key` parameter is narrowed to
 * {@link OrgSharedInstanceAccessKey}. There, {@link effectiveInstanceLevel} has
 * exactly four outcomes:
 *  1. `role === 'OWNER'` → `admin`. Never denies → `exclude` with nothing.
 *  1b. seat ceiling closes the area → `undefined` for everything, rows included
 *     → `'none'`.
 *  2. instance in `restrictedInstanceIds` → that member's own row, which denies
 *     when it is absent or below `view`. **Enumerable both ways** — the set is
 *     exactly the org's explicitly-managed instances.
 *  3. no row + area level `None` → `undefined`. Denies every row-LESS instance,
 *     which no exclusion list can enumerate — so this case inverts to `include`,
 *     naming the explicitly-granted instances instead. When none of the member's
 *     rows reach `view`, the answer is `'none'`.
 *  4. no row + open area → `levelToPermission(areaLevel)`, always ≥ `view`.
 *     Never denies.
 * So an instance is denied either by an explicit `ResourceAccess` row or by the
 * area floor with no row — there is no third denial path. With
 * `baselineAtCreate: true` (dashboards) branch 4 flips to `undefined` and every
 * row-less instance is denied even on an open area, so that resource would need
 * the `include` form unconditionally; the type narrowing makes flipping a
 * resource a COMPILE error at the call sites rather than a silent leak.
 *
 * `restrictedInstanceIds` is org-wide across ALL instance-access resources, so
 * the result may name ids of other types (a restricted dataset while listing
 * workflows). Harmless in both directions: ids are globally-unique cuid2s, so a
 * foreign id can neither drop a row of the type being listed (`exclude`) nor
 * admit one (`include`).
 */
export function instanceListScope(
  caps: ResolvedRecordAccess,
  key: OrgSharedInstanceAccessKey
): InstanceListScope {
  if (caps.role === 'OWNER') return { kind: 'exclude', excludeIds: [] }
  const area = INSTANCE_ACCESS_RESOURCES[key].area
  // The seat ceiling dominates every row (see `effectiveInstanceLevel`), so a
  // seat that excludes the area sees nothing regardless of grants.
  if (SEAT_CEILINGS[caps.seatType][area] === Level.None) return { kind: 'none' }
  const managed = caps.restrictedInstanceIds ?? EMPTY_INSTANCE_SET

  if (areaLevelFromKeys(caps.keys, area) === Level.None) {
    // Area closed: the visible set is exactly the member's own ≥`view` rows
    // (plan 25 §2). An allow-list, not a deny-list — every row-less instance is
    // invisible and there is no bound on how many of those there are.
    const includeIds: string[] = []
    for (const instanceId of managed) {
      const level = caps.instanceAccess?.[instanceId]
      if (level !== undefined && satisfiesPermission(level, ResourcePermission.view)) {
        includeIds.push(instanceId)
      }
    }
    return includeIds.length > 0 ? { kind: 'include', includeIds } : { kind: 'none' }
  }

  const excludeIds: string[] = []
  for (const instanceId of managed) {
    const level = caps.instanceAccess?.[instanceId]
    if (level === undefined || !satisfiesPermission(level, ResourcePermission.view)) {
      excludeIds.push(instanceId)
    }
  }
  return { kind: 'exclude', excludeIds }
}

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
