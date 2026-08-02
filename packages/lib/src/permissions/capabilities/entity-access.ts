// packages/lib/src/permissions/capabilities/entity-access.ts

import { ResourcePermission, type Rung } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { satisfiesPermission } from '@auxx/types/permissions'
import {
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  isInstanceAccessKey,
} from './instance-access'
import { Area, areaLevelFromKeys, Level, PermissionKey } from './registry'
import { permissionToRung, satisfiesRung } from './rung'
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
 *   plan 30 §5).
 * - **`article`** — governed by its KB's instance grants, enforced in
 *   `permissions/capabilities/article-visibility-scope.ts` and applied by the
 *   record lane's system-table dispatch (plan v3/06 §4.3). It stays here because
 *   routing it through the Records area would make KB access depend on a
 *   `records` rung it has nothing to do with: `canViewEntity` would fall through
 *   to `canViewRecord` → `effectiveRecordLevel`, and a member on a profile with
 *   no `records` key would see the whole articles table go dark — no error, just
 *   an empty list — for exactly the members who legitimately hold a KB grant.
 *   That is verbatim the `inbox` / `personal_inbox` argument below.
 *
 * 🔴 **This set is NOT "inert for enforcement".** That claim was here until plan
 * v3/06 and it was false — it has been since `article` gained an
 * `EntityDefinition` row and a system-table search binding. Live callers of
 * `canViewEntity` on these slugs, all of which this membership opens:
 * `unified-handler.ts`'s `search` scoped arm, `routers/record.ts`'s unscoped-union
 * post-filter, `realtime/rooms.ts`'s per-def record-channel ACL,
 * `assertCanViewRows`' fast path, and `hasDefPresence` / `filterViewableDefIds`.
 * The set also keeps the client mirror `NON_RECORD_ENTITY_SLUGS`
 * (`resources/registry/types.ts`) consistent — that one drives
 * `isAccessManageable`, i.e. "hide from the type-level Access grid", which stays
 * correct for `article` because there is no per-article grant to author.
 *
 * **`signature` and `snippet` were REMOVED 2026-07-28 (plan 36 §7.6).** They used
 * to sit in the mail-infrastructure half, and membership here is what made
 * `CapabilitySet.canViewEntity('signature')` return `true` unconditionally via
 * `isMailInfraDef` — every member could see every "private" signature in the org.
 * Their authority now lives in `Area.signatures` / `Area.snippets` plus
 * per-instance `ResourceAccess`, so the def-level pass-through has to go or the
 * short-circuit survives the slice that was meant to close it. `snippet` is not
 * an EntityDefinition at all (it is a first-class table), so its removal is inert
 * either way; `signature` is the one that bites.
 *
 * **`inbox` and `personal_inbox` deliberately DIVERGE from that precedent (plan 40
 * §11 item 2, answered 2026-07-29).** They are the first defs meant to sit in this
 * set *and* in `INSTANCE_ACCESS_RESOURCES`, which the plan-36 convention says are
 * mutually exclusive. `thread` already stands on the same reasoning (plan 40 §5.4),
 * and inboxes reach it through a live caller trace:
 *
 * - The FE's ONLY inbox list is `useAllRecords({ entityDefinitionId: 'inbox' })`
 *   (`components/threads/hooks/use-inbox.ts`, `components/fields/registries/
 *   dynamic-options-registry.ts`) → `record.listAll` → `UnifiedCrudHandler.listAll`,
 *   which gates on `canViewEntity(defKey)` and **returns an empty list on denial
 *   rather than throwing**. The same gate guards `getById` / `getByIds` /
 *   `listFiltered` / `search` on the same handler.
 * - Removing `inbox` here routes that gate through `canViewRecord`, i.e. the
 *   Records area. Inbox `ResourceAccess` rows are SLUG-keyed, so the inbox def is
 *   never in `restrictedEntityDefIds` and the resolved level is just the base
 *   records rung — which is `undefined` for every WORKER seat (`Area.records` is
 *   not in `WORKER_AREAS`, so `SEAT_CEILINGS.worker` clamps it to `None`) and for
 *   any member on a profile at `Records: None`. Those members would silently lose
 *   the mail sidebar, the inbox pickers and the thread inbox column — no error,
 *   just an empty list.
 * - Unlike `signature`, there is no replacement door: plan 36 could remove
 *   `signature` only because `assertNotInstanceAccessDef` had already moved it off
 *   the record path onto `signature.ts`. Plan 40's settled answer for inboxes is
 *   the OPPOSITE — the mail keys stay exempt on the record path's READ arm — so
 *   the unconditional `canViewEntity` pass-through is exactly what keeps that arm
 *   working, and it must survive.
 *
 * This is safe because the pass-through only exposes inbox METADATA (name, colour,
 * status). Mail content is governed by `userInstanceGrants` / the per-thread lens,
 * a separate authority these gates never consult in either direction.
 *
 * Keyed by entity slug; the caller resolves the def to its slug before checking.
 */
export const NON_RECORD_DEF_SLUGS: ReadonlySet<string> = new Set([
  'inbox',
  'personal_inbox',
  'thread',
  'message',
  'sequence',
  'dataset',
  'kb',
  'article',
  'dashboard',
  'workflow',
])

/**
 * Defs whose **def-level write gate is not authoritative for a row**, so every
 * row must be judged on its `_access` stamp even when the def gate says yes
 * (plan v3/06 §7.2).
 *
 * Deliberately declared HERE, immediately below {@link NON_RECORD_DEF_SLUGS},
 * because that membership is the *cause*: being a non-record def routes
 * `canEditEntity` through the coarse `canWriteEntity` verb, and for `article`
 * that verb resolves to `PermissionKey.recordsEdit` (there is no `article` entry
 * in `ENTITY_WRITE_KEYS`). The two sets have to be read together, and sixty
 * lines apart in one file is the only arrangement that makes that visible.
 *
 * ## Why a carve-out and not a better def-level key
 *
 * `record-row-access.ts` is built on "the def gate runs first and
 * short-circuits; rows it allows are never read". That holds whenever the def
 * gate is a sound *upper* bound on row authority. For `article` it is not a
 * bound in either direction, because an article's authority is **non-local** —
 * it lives one hop away, on the article's knowledge base — and no def-level key
 * can express a per-KB answer. Measured (plan v3/06 §7.2, both directions
 * traced against the real `CapabilitySet`):
 *
 * | member | def gate today | correct |
 * |---|---|---|
 * | `knowledgeBase: Edit`, `records: None` | denied every article write | allowed on KBs they hold |
 * | `records: Edit`, `knowledgeBase: None` | allowed on EVERY article in the org | denied |
 *
 * The obvious fix — `ENTITY_WRITE_KEYS['article'] = knowledgeBaseEdit` — was
 * tried and rejected: it simply **swaps** which row is broken, because whichever
 * area you point at becomes a def-level "yes" that skips the row judgement. Row
 * one becomes def-allowed and is then never re-judged, so a `knowledgeBase: Edit`
 * member could write articles in KBs they are explicitly denied. Same for
 * `ENTITY_BASE_AREAS`, which is the read-side twin of the same def axis.
 *
 * ## Cost, and why it stays a set of one
 *
 * A def in here forfeits the zero-I/O fast path: its ids are always stamped. The
 * read is still **one batched `getByIds` for the whole batch**, not one per row,
 * so a multi-article write costs one extra round trip rather than N. That is
 * cheap precisely because the set is tiny; adding a high-write def would make it
 * expensive. `article` is the only def in the tree today whose row authority is
 * non-local. Anything else belongs on the def axis, where it is free.
 *
 * Keyed by entity SLUG. See {@link import('../../resources/crud/record-row-access').defDeniedRecordIds}
 * for how a CUID-form RecordId is resolved before this set is consulted.
 */
export const ALWAYS_PER_ROW_DEF_SLUGS: ReadonlySet<string> = new Set(['article'])

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
   * instance-access resources (datasets etc., §1.4), from **INDIVIDUAL** grantee
   * rows only (`user` / `group` / `profile`). Explicit `'none'` rows are KEPT
   * (the per-instance downward marker). Optional — absent = `{}` (the server
   * `CapabilitySet.resolved()` view omits it; only the client instance resolver
   * reads it, always via {@link toResolvedRecordAccess}).
   *
   * A grant addressed to this member — **never gated by the area level**
   * (plan 43 §0.2a / #1346). See {@link baselineInstanceAccess} for its twin.
   */
  instanceAccess?: Readonly<Record<string, Rung>>
  /**
   * The same map for `role` grantee rows (`role:org_member`) — the workspace
   * default, split out by plan 43 §4.1. **GATED by the member's area level**
   * in {@link effectiveInstanceLevel}. `'none'` kept, max-wins within the lane.
   * Optional — absent = `{}`, which is also what a pre-`v16` cache blob yields
   * (that staleness fails OPEN; see the ledger entry at `user:capabilities:v16`).
   */
  baselineInstanceAccess?: Readonly<Record<string, Rung>>
  /**
   * Org-wide set of instance ids whose access is GOVERNED by rows — a
   * `role:org_member` baseline row at any permission, or any `permission =
   * 'none'` marker. **Not** "carries ≥1 row"; see
   * {@link effectiveInstanceLevel}. Optional (see above).
   */
  governingInstanceIds?: ReadonlySet<string>
  /** See {@link GrantedDefIds}. Optional — absent = `{}` = no front door. */
  grantedDefIds?: GrantedDefIds
}

/**
 * **THE FRONT DOOR** (plan v3/03 §6.1): record defs the member holds ≥ `read`
 * per-record `ResourceAccess` grants on, via ANY grantee kind.
 *
 * Bounded by DEF count, not grant count — never an instance-id set. That is the
 * whole point of §4's locality rule: the record lane is evaluated in the
 * database per query, so the only thing the composed blob may carry about it is
 * the one bit "is there anything here for me at all".
 *
 * Absent / empty ⇒ no front door, which is the fail-closed direction and must
 * stay so.
 *
 * ⚠ **POPULATION IS WIRED SEPARATELY.** This phase declares the field, reads it
 * defensively everywhere (`?? EMPTY_GRANTED_DEFS`), and implements
 * {@link hasDefPresence} on top of it. The compose-time producer — one
 * `SELECT DISTINCT "entityDefinitionId"` over the full grantee union at
 * `rung >= read`, restricted to record-def CUIDs (excluding every
 * `INSTANCE_ACCESS_KEYS` and every `MAIL_SHARING_DEFS` member) — lands in
 * `compose-user-capabilities.ts`, which a concurrent slice owns. Until that
 * lands every read here yields `{}`, so the front door is simply closed and no
 * behaviour is wrong, merely absent.
 */
export type GrantedDefIds = Readonly<Record<string, true>>

const EMPTY_GRANTED_DEFS: GrantedDefIds = {}

/**
 * **A SECOND predicate, never a wider `canViewEntity`** (plan v3/03 §6.1).
 *
 * ```
 * hasDefPresence(def) = canViewEntity(def) || grantedDefIds[def]
 * ```
 *
 * `canViewEntity` keeps meaning **"may see ALL rows"** and keeps guarding the
 * realtime def-channel ACLs, tableView listing, def administration and field
 * config. `hasDefPresence` gates ONLY the nav entry, the route gate, def
 * metadata surfaces and column metadata — the surfaces a member needs open in
 * order to *reach* the rows they were shared, all of which are scoped per row
 * downstream by {@link import('./record-visibility-scope').recordVisibilityScope}.
 *
 * ⚠ Widening `canViewEntity` instead would open whole defs off one grant, and
 * would let records into `instanceDerivedKeys` via `deriveInstanceReadKeys`.
 * Records must stay excluded from that.
 */
export function hasDefPresence(caps: ResolvedRecordAccess, entityDefinitionId: string): boolean {
  if (canViewRecord(caps, entityDefinitionId)) return true
  return Boolean((caps.grantedDefIds ?? EMPTY_GRANTED_DEFS)[entityDefinitionId])
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
 * Map an L2 area {@link Level} to the {@link Rung} vocabulary the instance-access
 * resolver speaks (Read→`read` · Edit→`edit` · Full→`admin` · None→undefined).
 * Used as the absent-instance-row fallback for `baselineAtCreate: false`
 * resources (§1.4).
 *
 * **Renamed from `levelToPermission` in plan v3/03 P3b, along with its return
 * type.** The instance lane stores rungs now; keeping the old name would have
 * left a function called `…Permission` producing values the def axis cannot
 * read. Its record-axis twin, {@link levelToRecordBasePermission}, is
 * deliberately NOT renamed — that one really does still produce a
 * {@link ResourcePermission}, and the two existing side by side is the clearest
 * statement of where the vocabularies part.
 */
export function levelToRung(level: Level): Rung | undefined {
  if (level >= Level.Full) return 'admin'
  if (level >= Level.Edit) return 'edit'
  if (level >= Level.Read) return 'read'
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
 * The `Full`-rung record verbs, made def-aware.
 *
 * `recordsDelete` and `recordsImport` live on the Records area's `Full` rung, so
 * until now they could only ever be granted ORG-WIDE: `record.delete` asserted
 * the bare key beside a per-def `edit` gate, which made per-def access a working
 * DOWNWARD lever (restrict a def below `edit` and delete dies with it) but never
 * an upward one — no per-def grant could hand delete out for a single definition.
 *
 * This closes that asymmetry without extending the `ResourcePermission`
 * vocabulary: the per-def `admin` rung, which already means "a scoped delegation
 * of org-admin for one def", now also carries that def's `Full`-rung verbs. A
 * grantee who may manage the definition itself may certainly delete its rows —
 * that is strictly less power than the deletion of the whole definition
 * {@link canAdministerRecord} already confers.
 *
 * Strictly ADDITIVE: the first branch is today's exact rule (`edit` floor + the
 * org-wide key), so nothing that could delete or import before loses it. What is
 * new is the second branch — an explicit per-def `admin` grant now suffices even
 * at Records `Read`/`None`. Base rungs cap at `edit`
 * ({@link levelToRecordBasePermission}), so `admin` can only come from an
 * explicit Layer-3 grant or OWNER; the Records area alone can never reach it and
 * this cannot silently widen an unrestricted def.
 *
 * The `edit` floor is checked FIRST and applies to both branches, so a def
 * restricted below `edit` still denies — the downward lever is untouched.
 */
function canFullRungRecordVerb(
  caps: ResolvedRecordAccess,
  entityDefinitionId: string,
  key: PermissionKey
): boolean {
  const level = effectiveRecordLevel(caps, entityDefinitionId)
  if (level === undefined || !satisfiesPermission(level, ResourcePermission.edit)) return false
  return caps.keys.has(key) || satisfiesPermission(level, ResourcePermission.admin)
}

/**
 * Record DELETE gate — `recordsDelete` org-wide, or an explicit per-def `admin`
 * grant, both floored by the def's edit gate. See {@link canFullRungRecordVerb}.
 *
 * Backs `record.delete` / `bulkDelete` / `merge`. Merge gates here rather than on
 * {@link canEditRecord} because it permanently REMOVES the source records.
 */
export function canDeleteRecord(caps: ResolvedRecordAccess, entityDefinitionId: string): boolean {
  return canFullRungRecordVerb(caps, entityDefinitionId, PermissionKey.recordsDelete)
}

/**
 * Record IMPORT gate — `recordsImport` org-wide, or an explicit per-def `admin`
 * grant, both floored by the def's edit gate. See {@link canFullRungRecordVerb}.
 *
 * Backs the def-bearing procedures in `data-import.ts`, which previously asserted
 * the coarse verb and NO per-def gate at all — so "import into contacts but not
 * into this restricted def" was inexpressible in either direction, and a member
 * holding `recordsImport` could bulk-write rows into a def they were explicitly
 * restricted out of. The `edit` floor closes that half; the `admin` branch opens
 * the other.
 */
export function canImportRecord(caps: ResolvedRecordAccess, entityDefinitionId: string): boolean {
  return canFullRungRecordVerb(caps, entityDefinitionId, PermissionKey.recordsImport)
}

/**
 * The member's DEF-level record authority, expressed on the {@link Rung} ladder
 * — the def half of the `_access` stamp (plan v3/03 §5.2).
 *
 * Goes through {@link effectiveRecordLevel} rather than reading `defAccess` raw,
 * so every clamp on that path (the worker seat ceiling, the OWNER bypass, the
 * restricted-def replacement) applies to the stamp too. `undefined` — no
 * def-level access at all — folds as `'none'`, which is exactly right: the row
 * is then reachable only through an explicit grant, and its rung is whatever
 * that grant says.
 */
export function recordDefRung(
  caps: ResolvedRecordAccess,
  entityDefinitionId: string
): Rung | undefined {
  const level = effectiveRecordLevel(caps, entityDefinitionId)
  return level === undefined ? undefined : permissionToRung(level)
}

/**
 * **The `Full`-rung record verbs evaluated at a ROW-EFFECTIVE rung** (plan
 * v3/03 §5.3, D6) — the same rule as {@link canFullRungRecordVerb}, reading the
 * `_access` stamp instead of recomputing the def level.
 *
 * **No new vocabulary.** The stamp value *is* the row-effective level, so the
 * shipped gate is reused verbatim: the `edit` floor first, then
 * `(the org-wide key OR rung ≥ admin)`. Evaluated per row this yields exactly
 * the §5.3 table:
 *
 * | Member | Row at | Delete? |
 * |---|---|---|
 * | holds `recordsDelete`, def not viewable | `edit` | yes |
 * | no `recordsDelete` | `edit` | no — collaboration, not destruction |
 * | any | `admin` | yes — may manage the row's sharing ⇒ may delete the row |
 *
 * **The seat ceiling is applied by the caller**, not here: it belongs on the
 * stamp's construction (see `CapabilitySet.recordAccessAt`) so that a worker
 * seat whose `records` area is clamped to `None` can never reach a positive
 * rung in the first place — a clamp applied at some seams only is defeated by
 * the others (§3).
 */
export function canRecordVerbAtRung(
  caps: ResolvedRecordAccess,
  access: Rung,
  key: PermissionKey
): boolean {
  if (!satisfiesRung(access, 'edit')) return false
  return caps.keys.has(key) || satisfiesRung(access, 'admin')
}

/** Row-effective DELETE gate — {@link canRecordVerbAtRung} on `recordsDelete`. */
export function canDeleteRecordAtRung(caps: ResolvedRecordAccess, access: Rung): boolean {
  return canRecordVerbAtRung(caps, access, PermissionKey.recordsDelete)
}

/** Row-effective EDIT gate — the `edit` floor on the stamp, nothing else. */
export function canEditRecordAtRung(access: Rung): boolean {
  return satisfiesRung(access, 'edit')
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
   * resources — datasets etc., §1.4) from INDIVIDUAL grantee rows. Optional:
   * carried in the dehydration seed so the client instance-access resolver and
   * any server-built snapshot have it; absent = treat as `{}`.
   */
  instanceAccess?: Record<string, Rung>
  /**
   * The BASELINE lane (`role:org_member` rows) — plan 43 §4.1. Gated by the area
   * level in {@link effectiveInstanceLevel}; kept separate on the wire for the
   * same reason it is separate in the blob, so a client affordance and the server
   * gate cannot disagree about which lane a row is in. Optional; absent = `{}`.
   */
  baselineInstanceAccess?: Record<string, Rung>
  /**
   * Org-wide set of instance ids whose access is GOVERNED by rows (a
   * `role:org_member` baseline at any permission, or any `none` marker).
   * Optional (see above).
   */
  governingInstanceIds?: string[]
  /**
   * Record defs the member holds ≥ `read` per-record grants on — THE FRONT DOOR
   * (plan v3/03 §6.1). See {@link GrantedDefIds}, including the note that its
   * compose-time population is wired by a separate slice. Optional; absent = no
   * front door, which is the fail-closed direction.
   */
  grantedDefIds?: Record<string, true>
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
    baselineInstanceAccess: caps.baselineInstanceAccess ?? {},
    governingInstanceIds: new Set(caps.governingInstanceIds ?? []),
    grantedDefIds: caps.grantedDefIds ?? EMPTY_GRANTED_DEFS,
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
 *  - OWNER → `admin`, but ONLY for `baselineAtCreate: false` resources.
 *  - the seat ceiling closes the area → `undefined`, rows included.
 *  - an INDIVIDUAL row (`user`/`group`/`profile`, incl. `'none'`) → wins
 *    outright, even when the L2 area gate is closed.
 *  - L2 area gate closed (`None`) and no individual row → `undefined`.
 *  - an explicit workspace-BASELINE row (`role:org_member`) → that row.
 *  - no row of either kind, but the instance is ROW-GOVERNED → `undefined`.
 *  - otherwise fall back to the base L2 area level (`baselineAtCreate: false`).
 *
 * **THE ONE-SENTENCE RULE, and the ORDERING that implements it** (plan 43
 * §0.2a decision C, 2026-07-29): *the area level gates the BASELINE path; an
 * individual grant always overrules it.*
 *
 * Two wants collide here and C is what satisfies both. *"Dashboards: None means
 * this profile sees no dashboards"* is a lever admins asked for and did not have
 * — `dashboardsView` is asserted nowhere, and every dashboard writes a
 * `role:org_member @ view` row at create, so practically every member was
 * derived into the area whatever their profile said. *"An explicit instance
 * grant overrides area None"* is **#1346** (plan 25 §2), shipped, and it is what
 * makes a single-instance share work at all. Splitting `instanceAccess` into
 * an individual lane and a baseline lane (§4.1) is what lets both be true.
 *
 * So the step order in the body is the design, not an accident of writing:
 *  - **Step 1 above step 2** is what makes an individual grant overrule the area
 *    (#1346), and is also why a creator never loses content they made — the
 *    `user @ admin` row every `baselineAtCreate: true` resource writes at create
 *    is an individual grant by construction.
 *  - **Step 2 above step 3** is what makes `Dashboards: None` mean no dashboards.
 * Swap either and one of the two wants breaks silently. Both are pinned by the
 * §8 truth table in `area-baseline-gate.test.ts`, which is commented with this
 * plan number so a "simplify the conditionals" pass has to delete a failing test
 * to happen.
 *
 * **NO `cfg.baselineAtCreate` BRANCH in step 2.** An earlier draft of the plan
 * scoped the gate to `baselineAtCreate: true` and had to spend a section
 * defending the asymmetry that created. C removes it: there is ONE rule for all
 * nine resources, and `baselineAtCreate` now affects only step 3's fall-through,
 * which is all it ever meant (*is there a fall-through when no row exists*). If
 * you find yourself adding `cfg.baselineAtCreate &&` to step 2, re-read §0.2a.
 *
 * **The OWNER bypass is scoped to the org-shared resources** (user decision
 * 2026-07-28, plan 36 §0.6 revised). `baselineAtCreate: true` marks content that
 * is PERSONAL — a member's own signature, snippet, or private dashboard — and
 * §0.10's recovery guarantee does not reach it: an owner locked out of someone
 * else's snippet cannot thereby lose the ability to repair a mis-shaped profile,
 * which is the only thing that bypass exists to protect. Reading a member's
 * private content is a different power, and it is not one org ownership confers.
 *
 * An owner keeps everything they actually hold a row on, which is why this is
 * safe rather than a self-lock: `composeUserCapabilities`'s OWNER branch already
 * returns `instanceAccess` unchanged, and every `baselineAtCreate: true` resource
 * writes its author an `admin` row at create — which the own-row-first branch
 * below returns. So an owner resolves `admin` on their own instances through the
 * normal row path, and `undefined` on a private instance nobody granted them —
 * the same answer any other member gets.
 *
 * **Consequence for dashboards, which are also `baselineAtCreate: true`:** every
 * dashboard writes a `role:org_member @ view` row at create and that row IS in an
 * owner's grantee union (`compute-user-capabilities.ts`), so owners keep `view`
 * on org-shared dashboards but no longer hold `admin` on one they did not create
 * — no rename, delete, or re-share without a grant. A dashboard whose baseline is
 * restricted is invisible to them entirely. That is the intended reading of
 * "personal content", applied consistently rather than carved out per resource.
 *
 * **The seat ceiling now precedes the bypass for these resources**, where it used
 * to sit below it. That matches `composeUserCapabilities`, which already clamps
 * an OWNER's keys by `SEAT_CEILINGS` — so an owner on a worker seat, whose
 * `signatures`/`snippets` areas are `None` by decision 0.5, is denied here too
 * rather than being clamped in one composer and waved through in the other.
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
 * **SHARING IS NOT RESTRICTING** (2026-07-29). The row check used to be gated on
 * `restrictedInstanceIds.has(instanceId)` — a set built grantee-agnostically as
 * "this instance carries ≥1 row for ANYONE" — and then returned that member's own
 * row, `undefined` included. So the FIRST explicit row written on an instance
 * (a share to one colleague, an author's own creator row) silently converted it to
 * grantees-only for the entire org, while every other layer meant "has a
 * RESTRICTION":
 *  - mail's `rowGoverned` (`compute-user-instance-grants.ts`) counts a
 *    `role:org_member` row at any permission, or any `none` row — never a
 *    creator's `user @ admin` row;
 *  - the permissions page's Workspace-defaults tab models exactly three states
 *    (`use-instance-baseline-rows.ts`): **Inherit** = no `role:org_member` row,
 *    **Restricted** = `role:org_member @ none`, else that row's permission — and
 *    it rendered "Inherit → «area level»" for an instance the resolver had already
 *    privatized, i.e. the tab was lying;
 *  - a compensating hack in ONE React hook (`use-instance-share.ts`) materialized
 *    a workspace baseline at Read on the first grant so the org would not lose
 *    access. It is deleted with this change; it was a symptom.
 * The live damage was mail-only, because `inbox` is the only
 * `baselineAtCreate: false` key that writes a create-time row
 * (`InboxService.createInbox`): a default org ADMIN at `inboxes: Full` who did not
 * create an inbox resolved `undefined` and 403'd on its Access section. But the
 * mechanism was fully general — the first grantee row on any dataset / KB /
 * workflow / agent would have done the same.
 *
 * So `governingInstanceIds` now carries mail's predicate exactly (a
 * `role:org_member` row at any permission, or any `none` row), the two layers
 * agree by construction, and **the member's OWN row is consulted BEFORE the set**.
 *
 * That ordering is load-bearing, not cosmetic: narrowing the set alone would break
 * every `baselineAtCreate: true` resource, because a signature/snippet/dashboard/
 * personal inbox carrying only its creator's `user @ admin` row drops OUT of the
 * narrowed set, falls through to {@link instanceFallbackLevel}, which returns
 * `undefined` for those keys — and the creator would lose their own content.
 *
 * The set is still required and is NOT redundant with `instanceAccess`: a
 * restriction row of a grantee kind the resolver cannot expand (a `profile`
 * grantee today) never reaches `instanceAccess`, so only the org-wide signal can
 * make it deny.
 *
 * Fail-closed is preserved: the unshared majority have no row at all, so they
 * fall through to the area gate; an explicit `'none'` row still denies whether it
 * is the member's own (own-row-first returns it, and `none` satisfies nothing) or
 * somebody else's (it puts the instance in the governing set).
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
): Rung | undefined {
  const cfg = INSTANCE_ACCESS_RESOURCES[key]
  if (caps.role === 'OWNER' && !cfg.baselineAtCreate) return 'admin'
  if (SEAT_CEILINGS[caps.seatType][cfg.area] === Level.None) return undefined

  // 1. An individual grant (user / group / profile) ALWAYS wins — #1346, and it is
  //    what keeps a creator's own `user @ admin` row reachable at any area level.
  const own = caps.instanceAccess?.[instanceId]
  if (own !== undefined) return own

  // 2. Everything below here is the BASELINE path, which the area level gates (§0.2a).
  //    One rule for all nine resources — do NOT branch on `cfg.baselineAtCreate`.
  if (areaLevelFromKeys(caps.keys, cfg.area) === Level.None) return undefined

  // 3. An explicit workspace-baseline row, then the governing set, then the fallback.
  const baseline = caps.baselineInstanceAccess?.[instanceId]
  if (baseline !== undefined) return baseline
  if ((caps.governingInstanceIds ?? EMPTY_INSTANCE_SET).has(instanceId)) return undefined
  return instanceFallbackLevel(caps, key)
}

/**
 * What {@link effectiveInstanceLevel} answers for an instance the org holds NO
 * `ResourceAccess` row on — the area fall-through, on its own.
 *
 * Extracted (plan 31 §2.4) so a caller resolving MANY instances at once can ask
 * one question per resource type instead of one per id: `permissions.granteeAccess`
 * returns explicit answers for the instances the org manages a row on, and this
 * value for everything else, so the client's per-row lookup is
 * `instances[id] ?? instanceFallback[key]` — never a re-derivation. The
 * extraction, rather than a second copy, is the point: §2.5 is explicit that a
 * display path which drifts from enforcement is the same class of bug with a
 * quieter failure.
 *
 * Order matters and mirrors its caller exactly: the org-shared OWNER bypass
 * first (§0.10, scoped to `baselineAtCreate: false` — see
 * {@link effectiveInstanceLevel}), then the seat ceiling (a billing invariant
 * that outranks every row), then the area gate.
 *
 * For a `baselineAtCreate: true` resource this now returns `undefined` for an
 * OWNER, as it does for everyone else. That is not merely internal consistency:
 * the client reads this as `effective.instanceFallback[key]` for every row-less
 * instance, so leaving the bypass here would render an owner "Effective · Full"
 * beside content the server denies them.
 */
export function instanceFallbackLevel(
  caps: ResolvedRecordAccess,
  key: InstanceAccessKey
): Rung | undefined {
  const cfg = INSTANCE_ACCESS_RESOURCES[key]
  if (caps.role === 'OWNER' && !cfg.baselineAtCreate) return 'admin'
  if (SEAT_CEILINGS[caps.seatType][cfg.area] === Level.None) return undefined
  const areaLevel = areaLevelFromKeys(caps.keys, cfg.area)
  if (areaLevel === Level.None) return undefined
  return cfg.baselineAtCreate ? undefined : levelToRung(areaLevel)
}

const EMPTY_INSTANCE_SET: ReadonlySet<string> = new Set()
const EMPTY_INSTANCE_ACCESS: Readonly<Record<string, Rung>> = {}

/**
 * Instance-access keys whose absent-row fallback is the member's AREA level
 * (`baselineAtCreate: false` — `dataset`, `kb`, `workflow`). Derived from
 * {@link INSTANCE_ACCESS_RESOURCES} rather than hand-listed, so flipping a
 * resource to `baselineAtCreate: true` removes it here and makes
 * {@link instanceListScope} a COMPILE error at its call sites instead of a
 * silent leak — see that function for why the distinction is load-bearing.
 *
 * The `lane: 'blob'` conjunct is redundant today ({@link InstanceAccessKey} is
 * already blob-only) and stated anyway: a query-lane domain has no
 * `baselineAtCreate`, so it must never satisfy this union by accident if the
 * key type is ever widened.
 */
export type OrgSharedInstanceAccessKey = {
  [K in InstanceAccessKey]: (typeof INSTANCE_ACCESS_RESOURCES)[K] extends {
    lane: 'blob'
    baselineAtCreate: false
  }
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
 * What {@link privateInstanceListScope} can actually return — the `'exclude'`
 * arm removed.
 *
 * A `baselineAtCreate: true` resource is visible ONLY through explicit rows, so
 * its scope is always an allow-list; there is no open-area case to express and,
 * since §0.6 was revised, no OWNER arm either. Typing that narrowing rather than
 * merely documenting it makes a caller's leftover `else if (scope.excludeIds…)`
 * branch a COMPILE ERROR instead of unreachable code with a stale comment above
 * it — which is exactly what it had degraded into in `signature.ts` after the
 * OWNER arm was deleted.
 */
export type PrivateInstanceListScope = Extract<InstanceListScope, { kind: 'none' | 'include' }>

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
 * exactly six outcomes (six since plan 43 §4.1 split the instance map into an
 * INDIVIDUAL lane and a BASELINE lane — outcome 4 is the new one):
 *  1. `role === 'OWNER'` → `admin`. Never denies → `exclude` with nothing.
 *  1b. seat ceiling closes the area → `undefined` for everything, rows included
 *     → `'none'`.
 *  2. the member holds their own INDIVIDUAL row → that row, which denies when it
 *     is below `view`. **Enumerable** — `instanceAccess` is exactly those.
 *  3. no individual row + area level `None` → `undefined`. Denies every row-LESS
 *     instance AND every baseline-only one, which no exclusion list can
 *     enumerate — so this case inverts to `include`, naming the member's
 *     individual ≥`view` rows alone. When none reach `view`, the answer is
 *     `'none'`.
 *  4. no individual row + open area + an explicit BASELINE row → that row, which
 *     denies only at `none`. **Enumerable** — `baselineInstanceAccess`, and every
 *     id in it is also in `governingInstanceIds` (a `role:org_member` row governs
 *     at any permission, see `isGoverningInstanceRow`), so the governed loop
 *     visits all of them and consulting the lane there is exhaustive.
 *  5. no row of either kind + instance in `governingInstanceIds` → `undefined`
 *     (somebody else holds a `none` marker on it). **Enumerable** — the set is
 *     exactly the org's row-governed instances.
 *  6. no row of either kind + not governed + open area → `levelToRung(areaLevel)`,
 *     always ≥ `view`. Never denies.
 * So an instance is denied by the member's own sub-`view` individual row, by a
 * sub-`view` baseline row, by the governing set with no row at all, or by the
 * area floor — there is no fifth denial path. With `baselineAtCreate: true`
 * (dashboards) branch 6 flips to `undefined` and every row-less instance is
 * denied even on an open area, so that resource needs the `include` form
 * unconditionally; the type narrowing makes flipping a resource a COMPILE error
 * at the call sites rather than a silent leak.
 *
 * **The own-row half must be enumerated from `instanceAccess`, not from the
 * governing set.** Before 2026-07-29 the set meant "carries ≥1 row for anyone",
 * so it was a superset of `instanceAccess`'s keys and iterating it covered both
 * halves. It no longer is: an instance shared to this member alone is in
 * `instanceAccess` and NOT in `governingInstanceIds`, and a loop over the set
 * would drop it from the closed-area allow-list — the member would see an empty
 * page for an instance they can demonstrably open, which is the exact divergence
 * this function exists to prevent.
 *
 * Both inputs are org-wide across ALL instance-access resources, so the result
 * may name ids of other types (a restricted dataset while listing workflows).
 * Harmless in both directions: ids are globally-unique cuid2s, so a foreign id
 * can neither drop a row of the type being listed (`exclude`) nor admit one
 * (`include`).
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
  const own = caps.instanceAccess ?? EMPTY_INSTANCE_ACCESS
  const baseline = caps.baselineInstanceAccess ?? EMPTY_INSTANCE_ACCESS
  const governed = caps.governingInstanceIds ?? EMPTY_INSTANCE_SET

  if (areaLevelFromKeys(caps.keys, area) === Level.None) {
    // Area closed: the visible set is exactly the member's own INDIVIDUAL ≥`view`
    // rows (plan 25 §2 / #1346). An allow-list, not a deny-list — every row-less
    // instance is invisible and there is no bound on how many of those there are.
    //
    // `baseline` is deliberately NOT unioned in here (plan 43 §4.3). This arm IS
    // step 2 of `effectiveInstanceLevel` expressed as a list filter: a closed area
    // cuts off the workspace default, so a `role:org_member @ view` row must not
    // put a row into this allow-list. Before the lane split it did, because the
    // two lanes were one map — that is precisely the leak the split closes.
    const includeIds: string[] = []
    for (const [instanceId, level] of Object.entries(own)) {
      if (satisfiesRung(level, 'read')) includeIds.push(instanceId)
    }
    return includeIds.length > 0 ? { kind: 'include', includeIds } : { kind: 'none' }
  }

  // Area open: two disjoint denial sources, so no id can be pushed twice — the
  // first loop only visits instances WITHOUT an individual row, the second only
  // those with one.
  const excludeIds: string[] = []
  for (const instanceId of governed) {
    if (own[instanceId] !== undefined) continue
    // No individual row, so the resolver's step 3 decides: an explicit workspace
    // baseline row is the answer (denying only when it is below `view` — i.e. the
    // `role:org_member @ none` restriction marker); with no baseline row the
    // instance is in this set only because SOMEBODY ELSE holds a `none` marker on
    // it, and that denies. Reading `baseline` here is what plan 43 §4.1's lane
    // split makes necessary: these permissions used to arrive inside `own`.
    const workspace = baseline[instanceId]
    if (workspace === undefined || !satisfiesRung(workspace, 'read')) {
      excludeIds.push(instanceId)
    }
  }
  for (const [instanceId, level] of Object.entries(own)) {
    if (!satisfiesRung(level, 'read')) excludeIds.push(instanceId)
  }
  return { kind: 'exclude', excludeIds }
}

/**
 * The complement of {@link OrgSharedInstanceAccessKey}: instance-access keys
 * whose absent-row fallback is NO ACCESS (`baselineAtCreate: true` —
 * `dashboard`, `signature`, `snippet`). Derived the same way, so flipping a
 * resource's posture moves it between the two unions and turns the wrong
 * list-scope helper into a COMPILE error rather than a silent leak.
 */
export type PrivateInstanceAccessKey = {
  [K in InstanceAccessKey]: (typeof INSTANCE_ACCESS_RESOURCES)[K] extends {
    lane: 'blob'
    baselineAtCreate: true
  }
    ? K
    : never
}[InstanceAccessKey]

/**
 * {@link instanceListScope} for a PRIVATE (`baselineAtCreate: true`) resource —
 * the id filter that reproduces {@link canViewInstance} for `dashboard` /
 * `signature` / `snippet`, computed UP FRONT so a list query applies it BEFORE
 * it paginates (plan 36 §6.1).
 *
 * It is a separate function rather than a branch inside `instanceListScope`
 * because the two resolve to structurally different answers, and the type
 * narrowing on each is what keeps a caller from reaching for the wrong one:
 * `instanceListScope`'s `'exclude'` arm is only sound when a row-LESS instance
 * is visible, which is exactly what `baselineAtCreate: true` denies.
 *
 * The visible set is ALWAYS an allow-list — **there is no OWNER arm** (user
 * decision 2026-07-28, plan 36 §0.6 revised). The bypass is scoped to
 * `baselineAtCreate: false`, and every key this function accepts is
 * `baselineAtCreate: true` BY TYPE ({@link PrivateInstanceAccessKey}), so the
 * owner branch is unreachable here by construction rather than by omission. An
 * owner is filtered exactly like any other member, and still sees everything they
 * hold a row on — including every instance they created, whose `admin` row is
 * written at create:
 *  1. the seat ceiling closes the area → `undefined` for everything, rows
 *     included → `'none'` (decision 0.5: a worker seat is denied even on an
 *     instance it owns).
 *  2. every INDIVIDUAL row (`instanceAccess`) that reaches `view`. The area level
 *     is deliberately not consulted for this half — an individual grant beats the
 *     area floor (#1346), so reading it here would ADD a denial the gate does not
 *     make.
 *  3. **plus, when the area is above `None`, every BASELINE row
 *     (`baselineInstanceAccess`) that reaches `view` and has no individual row
 *     shadowing it** — added by plan 43 §4.3.
 *
 * Item 3 is why this function now reads the area level at all, having previously
 * been documented as deliberately never doing so. Both halves of that change are
 * plan 43's:
 *  - a `role:org_member` row on a private resource is now REACHABLE (§4.2 step 3
 *    returns it), where before the lane split it arrived inside `instanceAccess`
 *    and was covered by item 2. Dev holds **89** such rows on `dashboard` and
 *    **28** on `snippet` — this is the common case, not an edge one.
 *  - and it is reachable ONLY above `None`, because §0.2a gates the baseline path.
 * Dropping either condition breaks the list against the gate in one direction or
 * the other: without item 3 a member loses every org-shared dashboard from their
 * list while still being able to open one by URL; without the area check the
 * `Dashboards: None` lever stops working for lists while still working for
 * point checks.
 *
 * `governingInstanceIds` is still not consulted, and for the original reason: it
 * can only ever DENY, and every instance it would deny already fails the
 * "hold a row ≥ view in the lane that applies" test.
 *
 * **Enumerated from `instanceAccess`, not from the governing set** (changed
 * 2026-07-29 together with `effectiveInstanceLevel`'s own-row-first ordering).
 * The old loop walked the org-wide "carries ≥1 row" set and looked each id up in
 * `instanceAccess`; that was equivalent only because the set was a SUPERSET of
 * this member's rows. Now that it means "row-GOVERNED", a signature or snippet
 * carrying nothing but its author's create-time `user @ admin` row is no longer
 * in it — so the old loop would have dropped every member's own private content
 * out of their own list. That is the list-side face of exactly the bug
 * own-row-first fixes on the point-check side.
 *
 * As with `instanceListScope`, `instanceAccess` is org-wide across all
 * instance-access resources, so the result may name ids of other types. Harmless:
 * ids are globally-unique cuid2s, so a foreign id can neither drop nor admit a
 * row of the type being listed.
 */
export function privateInstanceListScope(
  caps: ResolvedRecordAccess,
  key: PrivateInstanceAccessKey
): PrivateInstanceListScope {
  const area = INSTANCE_ACCESS_RESOURCES[key].area
  if (SEAT_CEILINGS[caps.seatType][area] === Level.None) return { kind: 'none' }

  const own = caps.instanceAccess ?? EMPTY_INSTANCE_ACCESS
  const includeIds: string[] = []
  // Lane 1 — individual grants. Never gated (§4.2 step 1).
  for (const [instanceId, level] of Object.entries(own)) {
    if (satisfiesRung(level, 'read')) includeIds.push(instanceId)
  }
  // Lane 2 — the workspace baseline, admitted only above `None` (§4.2 steps 2-3).
  if (areaLevelFromKeys(caps.keys, area) !== Level.None) {
    for (const [instanceId, level] of Object.entries(
      caps.baselineInstanceAccess ?? EMPTY_INSTANCE_ACCESS
    )) {
      // An individual row on the same instance already decided it at step 1,
      // including when it decided DENY — skip, or a `user @ none` restriction
      // would be undone by the very baseline row it exists to override.
      if (own[instanceId] !== undefined) continue
      if (satisfiesRung(level, 'read')) includeIds.push(instanceId)
    }
  }
  return includeIds.length > 0 ? { kind: 'include', includeIds } : { kind: 'none' }
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
  return level !== undefined && satisfiesRung(level, 'read')
}

/**
 * Instance-access EDIT gate (Write) — mirror of `CapabilitySet.canEditInstance`.
 */
export function canEditInstance(caps: ResolvedRecordAccess, recordId: string): boolean {
  const { key, instanceId } = parseInstanceRecordId(recordId)
  if (!isInstanceAccessKey(key)) return false
  const level = effectiveInstanceLevel(caps, key, instanceId)
  return level !== undefined && satisfiesRung(level, 'edit')
}

/**
 * Instance-access ADMIN gate (Full) — mirror of `CapabilitySet.canAdminInstance`.
 * Governs the Share card's editable affordances (who may re-share the instance).
 */
export function canAdminInstance(caps: ResolvedRecordAccess, recordId: string): boolean {
  const { key, instanceId } = parseInstanceRecordId(recordId)
  if (!isInstanceAccessKey(key)) return false
  const level = effectiveInstanceLevel(caps, key, instanceId)
  return level !== undefined && satisfiesRung(level, 'admin')
}
