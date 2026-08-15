// packages/lib/src/permissions/capabilities/capability-view.ts

import type { ResourcePermission, Rung } from '@auxx/database/enums'
import { PERMISSION_RANK } from './compose-user-capabilities'
import type { InstanceListScope, OrgSharedInstanceAccessKey } from './entity-access'
import type { InstanceAccessKey } from './instance-access'
import type { Area, Level, PermissionKey } from './registry'
import { RUNG_ORDER } from './rung'

/**
 * The public **gate surface** of a resolved capability set (capability layer
 * v2 §2) — every read/write/instance check an enforcement point may call,
 * with none of the construction or serialization detail.
 *
 * Extracted so a gate can be satisfied by something other than a single member's
 * {@link import('./capability-set').CapabilitySet} — specifically
 * {@link MinCapabilitySet}, the intersection used for human-triggered agent runs.
 * Everything downstream of a gate (tool deps, the CRUD handler, the record
 * picker) is typed to this interface; only callers that *serialize* a capability
 * set to the client (`toClientCapabilities`) or branch on the member's `role`
 * keep a concrete `CapabilitySet`.
 *
 * Every member is **zero I/O** — in-memory Set/map lookups only.
 */
export interface CapabilityView {
  /** O(1) — whether the principal holds `key`. */
  can(key: PermissionKey): boolean
  /** Alias for {@link CapabilityView.can}. */
  has(key: PermissionKey): boolean
  /** Throwing form of {@link CapabilityView.can} (403). */
  assert(key: PermissionKey): void

  /**
   * The principal's effective {@link Level} for one coarse capability {@link Area}.
   *
   * The inverse of the area→keys expansion, so it is derived from the SAME
   * composed key set every `can()` gate reads — never a second computation. Added
   * for the publish-time author clamp (plan 19 §2.4a), which must bound an agent
   * policy by *the publisher's own authority* using the composer that governs the
   * publisher, not a reimplementation of it.
   */
  areaLevel(area: Area): Level

  /** Coarse Layer-2 write verb for a def (mail-infra + dedicated write keys). */
  canWriteEntity(entityDefId: string): boolean
  /** Throwing form of {@link CapabilityView.canWriteEntity} (403). */
  assertWriteEntity(entityDefId: string): void

  /** Whether the principal may create/update/delete records of the def. */
  canEditEntity(entityDefId: string): boolean
  /** Throwing form of {@link CapabilityView.canEditEntity} (403). */
  assertEditEntity(entityDefId: string): void
  /** Filter RecordId-def forms down to the editable ones. */
  filterEditableDefIds(entityDefIds: string[]): string[]

  /** Whether the principal may read records of the def. */
  canViewEntity(entityDefId: string): boolean

  /**
   * **The front door** (plan v3/03 §6.1) — `canViewEntity(def) ||
   * grantedDefIds[def]`. A SECOND predicate, deliberately not a wider
   * `canViewEntity`.
   *
   * Gates ONLY: the sidebar/nav entry, the route gate, def metadata surfaces and
   * column metadata. `canViewEntity` keeps meaning "may see ALL rows" and keeps
   * guarding realtime def-channel ACLs, tableView listing, def admin and field
   * config — widening THAT would open whole defs off one grant and let records
   * into `instanceDerivedKeys`.
   */
  hasDefPresence(entityDefId: string): boolean

  /**
   * Whether the principal holds ≥1 per-record `ResourceAccess` grant on the def
   * — the raw {@link import('./entity-access').GrantedDefIds} lookup.
   *
   * Distinct from {@link hasDefPresence} on purpose: arm 3 of
   * {@link import('./record-visibility-scope').recordScopeArm} needs
   * `!defViewable && grantedDef`, and the OR'd front door cannot express that.
   */
  hasRecordGrantsOn(entityDefId: string): boolean

  /**
   * The principal's DEF-level record authority on the {@link Rung} ladder — the
   * def half of the `_access` stamp (§5.2). `undefined` = no def-level access.
   */
  recordDefRung(entityDefId: string): Rung | undefined

  /**
   * The **row-effective** rung: the def level folded with a row's aggregated
   * grant rank (§5.2).
   *
   * ```
   * _access = max(effectiveRecordLevel(def), max rung across matching grant rows)
   * ```
   *
   * `grantRank` comes from
   * {@link import('./record-visibility-scope').recordAccessRankSql} — resolved
   * in the SAME query as the row, never a second roundtrip and never a cached id
   * set. The seat ceiling is applied here so a clamped seat can never reach a
   * positive rung through a row grant.
   */
  recordAccessAt(entityDefId: string, grantRank: number | null): Rung

  /**
   * Row-effective DELETE gate (§5.3) — the shipped `canDeleteRecord` rule
   * evaluated at the `_access` stamp. No new `deleteAt` vocabulary: this IS the
   * existing gate, reading a row-effective level instead of a def-level one.
   */
  canDeleteRecordAt(access: Rung): boolean

  /**
   * Row-effective EDIT gate (§5.3) — the `edit` floor read at the `_access`
   * stamp instead of at the def level.
   *
   * The twin of {@link CapabilityView.canDeleteRecordAt}, and it exists for the
   * same reason: once a row of a def is reachable by two routes ("mine because I
   * see the whole def" and "mine because this row was shared with me"), the
   * def-level `canEditEntity` has no right answer for it. Without this the
   * per-record `edit` grant is readable and inert — the member opens the row and
   * cannot change it.
   *
   * No new vocabulary: the stamp value IS the row-effective level, so this is
   * `satisfiesRung(access, 'edit')` — exactly what `canEditRecord` asks of the
   * def level.
   */
  canEditRecordAt(access: Rung): boolean
  /** Throwing form of {@link CapabilityView.canViewEntity} (403). */
  assertViewEntity(entityDefId: string): void
  /** Filter RecordId-def forms down to the viewable ones. */
  filterViewableDefIds(entityDefIds: string[]): string[]

  /** Highest type-level ResourceAccess permission for the def, or `undefined`. */
  viewAccessFor(entityDefId: string): ResourcePermission | undefined

  /** Whether the principal may administer the definition itself (Full rung). */
  canAdministerDef(entityDefId: string): boolean
  /** Throwing form of {@link CapabilityView.canAdministerDef} (403). */
  assertAdministerDef(entityDefId: string): void

  /** Whether the principal may VIEW an instance-access resource instance. */
  canViewInstance(key: InstanceAccessKey, instanceId: string): boolean
  /** Whether the principal may EDIT an instance-access resource instance. */
  canEditInstance(key: InstanceAccessKey, instanceId: string): boolean
  /** Whether the principal may ADMINISTER an instance-access resource instance. */
  canAdminInstance(key: InstanceAccessKey, instanceId: string): boolean
  /** Throwing form of {@link CapabilityView.canViewInstance} (403). */
  assertViewInstance(key: InstanceAccessKey, instanceId: string): void
  /** Throwing form of {@link CapabilityView.canEditInstance} (403). */
  assertEditInstance(key: InstanceAccessKey, instanceId: string): void
  /** Throwing form of {@link CapabilityView.canAdminInstance} (403). */
  assertAdminInstance(key: InstanceAccessKey, instanceId: string): void

  /**
   * The id filter a paginated LIST query needs so `limit` / `cursor` / `total`
   * run over the rows this principal may actually see — the list-side twin of
   * {@link CapabilityView.canViewInstance}, computed up front instead of
   * filtering a page after the fact.
   *
   * On the interface rather than on `CapabilitySet` alone because the system-
   * table read lane needs it from a plain {@link CapabilityView}: `kb` and
   * `dataset` rows carry no `ResourceAccess` grant rows to correlate against in
   * SQL, so their list predicate can only come from the composed blob. Leaving
   * it off the interface is what forced that lane to choose between refusing
   * these keys outright and reading org-wide.
   *
   * 🔴 **If this and `canViewInstance` ever disagree, a member sees an empty
   * page for an instance they can demonstrably open.** Every implementation must
   * therefore derive both from one rule — see
   * {@link import('./entity-access').instanceListScope} for the enumeration
   * proof, and {@link MinCapabilitySet.instanceListScope} for why the
   * intersection is set algebra rather than a second resolution.
   *
   * Zero I/O, like every other member.
   */
  instanceListScope(key: OrgSharedInstanceAccessKey): InstanceListScope
}

/**
 * The pointwise **intersection** of two capability views (capability layer v2 §2):
 * every boolean gate is `a && b`, every level is the lower of the two, every
 * filter is the intersection of both filters.
 *
 * Used for human-triggered agent runs (mention / assignment / interactive DM):
 * effective capabilities = `min(agentProfile, invoker)`, so a mention can never
 * read data through an agent that the mentioner couldn't read themselves
 * (confused-deputy closed, §0.5).
 *
 * Two properties worth stating explicitly:
 *
 * - **The privileged-invoker case composes for free.** `CapabilitySet`
 *   short-circuits OWNER to `true`/`admin` internally (and an ADMIN on the seeded
 *   all-`Full` profile answers `true` on every gate the same way, now by
 *   composition rather than by bypass — doc 19 step 10), so a privileged invoker
 *   contributes `true`, which by `&&` cannot override a restricted agent's
 *   `false`. The converse holds too: an all-Full agent profile cannot lift a
 *   restricted human. Neither side needs to know the other's role.
 * - **`assert*` calls BOTH sides**, in `a`-then-`b` order, so the first failing
 *   side throws its own `ForbiddenError` with its own message. There is no merged
 *   error type, and no side is silently skipped once the other passes.
 *
 * Blob merging is deliberately NOT how this is computed: effective levels depend
 * on each set's own base + restricted-def/instance context, so only the resolved
 * gates can be safely intersected.
 */
export class MinCapabilitySet implements CapabilityView {
  /**
   * @param a First view (asserts fire from this side first).
   * @param b Second view.
   */
  constructor(
    private readonly a: CapabilityView,
    private readonly b: CapabilityView
  ) {}

  can(key: PermissionKey): boolean {
    return this.a.can(key) && this.b.can(key)
  }

  has(key: PermissionKey): boolean {
    return this.a.has(key) && this.b.has(key)
  }

  assert(key: PermissionKey): void {
    this.a.assert(key)
    this.b.assert(key)
  }

  /** The LOWER of the two area rungs — `min`, matching every other member. */
  areaLevel(area: Area): Level {
    return Math.min(this.a.areaLevel(area), this.b.areaLevel(area)) as Level
  }

  canWriteEntity(entityDefId: string): boolean {
    return this.a.canWriteEntity(entityDefId) && this.b.canWriteEntity(entityDefId)
  }

  assertWriteEntity(entityDefId: string): void {
    this.a.assertWriteEntity(entityDefId)
    this.b.assertWriteEntity(entityDefId)
  }

  canEditEntity(entityDefId: string): boolean {
    return this.a.canEditEntity(entityDefId) && this.b.canEditEntity(entityDefId)
  }

  assertEditEntity(entityDefId: string): void {
    this.a.assertEditEntity(entityDefId)
    this.b.assertEditEntity(entityDefId)
  }

  filterEditableDefIds(entityDefIds: string[]): string[] {
    return entityDefIds.filter((id) => this.canEditEntity(id))
  }

  canViewEntity(entityDefId: string): boolean {
    return this.a.canViewEntity(entityDefId) && this.b.canViewEntity(entityDefId)
  }

  assertViewEntity(entityDefId: string): void {
    this.a.assertViewEntity(entityDefId)
    this.b.assertViewEntity(entityDefId)
  }

  filterViewableDefIds(entityDefIds: string[]): string[] {
    return entityDefIds.filter((id) => this.canViewEntity(id))
  }

  hasDefPresence(entityDefId: string): boolean {
    return this.a.hasDefPresence(entityDefId) && this.b.hasDefPresence(entityDefId)
  }

  hasRecordGrantsOn(entityDefId: string): boolean {
    return this.a.hasRecordGrantsOn(entityDefId) && this.b.hasRecordGrantsOn(entityDefId)
  }

  /**
   * The LOWER of the two def rungs. `undefined` (no def-level access at all) is
   * the absorbing value, matching {@link viewAccessFor}: if either side has
   * none, the intersection has none.
   */
  recordDefRung(entityDefId: string): Rung | undefined {
    const left = this.a.recordDefRung(entityDefId)
    if (left === undefined) return undefined
    const right = this.b.recordDefRung(entityDefId)
    if (right === undefined) return undefined
    return RUNG_ORDER[left] <= RUNG_ORDER[right] ? left : right
  }

  /** The LOWER of the two row-effective stamps — `min`, like every other member. */
  recordAccessAt(entityDefId: string, grantRank: number | null): Rung {
    const left = this.a.recordAccessAt(entityDefId, grantRank)
    const right = this.b.recordAccessAt(entityDefId, grantRank)
    return RUNG_ORDER[left] <= RUNG_ORDER[right] ? left : right
  }

  canDeleteRecordAt(access: Rung): boolean {
    return this.a.canDeleteRecordAt(access) && this.b.canDeleteRecordAt(access)
  }

  canEditRecordAt(access: Rung): boolean {
    return this.a.canEditRecordAt(access) && this.b.canEditRecordAt(access)
  }

  /**
   * The LOWER of the two type-level permissions by {@link PERMISSION_RANK}.
   * `undefined` (no type-level grant at all) is the absorbing value: if either
   * side has no grant, the intersection has none.
   */
  viewAccessFor(entityDefId: string): ResourcePermission | undefined {
    const left = this.a.viewAccessFor(entityDefId)
    if (left === undefined) return undefined
    const right = this.b.viewAccessFor(entityDefId)
    if (right === undefined) return undefined
    return PERMISSION_RANK[left] <= PERMISSION_RANK[right] ? left : right
  }

  canAdministerDef(entityDefId: string): boolean {
    return this.a.canAdministerDef(entityDefId) && this.b.canAdministerDef(entityDefId)
  }

  assertAdministerDef(entityDefId: string): void {
    this.a.assertAdministerDef(entityDefId)
    this.b.assertAdministerDef(entityDefId)
  }

  canViewInstance(key: InstanceAccessKey, instanceId: string): boolean {
    return this.a.canViewInstance(key, instanceId) && this.b.canViewInstance(key, instanceId)
  }

  canEditInstance(key: InstanceAccessKey, instanceId: string): boolean {
    return this.a.canEditInstance(key, instanceId) && this.b.canEditInstance(key, instanceId)
  }

  canAdminInstance(key: InstanceAccessKey, instanceId: string): boolean {
    return this.a.canAdminInstance(key, instanceId) && this.b.canAdminInstance(key, instanceId)
  }

  assertViewInstance(key: InstanceAccessKey, instanceId: string): void {
    this.a.assertViewInstance(key, instanceId)
    this.b.assertViewInstance(key, instanceId)
  }

  assertEditInstance(key: InstanceAccessKey, instanceId: string): void {
    this.a.assertEditInstance(key, instanceId)
    this.b.assertEditInstance(key, instanceId)
  }

  assertAdminInstance(key: InstanceAccessKey, instanceId: string): void {
    this.a.assertAdminInstance(key, instanceId)
    this.b.assertAdminInstance(key, instanceId)
  }

  /**
   * Set algebra over the two sides' scopes — the list-side expression of the
   * `a && b` every gate above performs pointwise.
   *
   * Each arm is `canViewInstance` restated as a filter, so intersecting the
   * filters and intersecting the gates must agree for every id. They do, arm by
   * arm, because `include` means "exactly these" and `exclude` means "everything
   * but these":
   *
   * | a | b | a ∩ b | why |
   * |---|---|---|---|
   * | `none` | anything | `none` | one side sees nothing, so neither does the pair |
   * | `include(A)` | `include(B)` | `include(A ∩ B)` | both must name the id |
   * | `include(A)` | `exclude(B)` | `include(A \ B)` | `a` bounds the universe; `b` only removes |
   * | `exclude(A)` | `exclude(B)` | `exclude(A ∪ B)` | either side's denial is enough |
   *
   * An `include` arm that empties out collapses to `none` rather than to an
   * `include` of nothing, matching what `instanceListScope` itself returns for
   * that case so callers only ever branch on one spelling of "sees nothing".
   *
   * 🔴 **Never resolve the intersection by re-running the enumeration against a
   * merged blob.** Each side's arms depend on its OWN area levels, seat ceiling
   * and governing set (see `instanceListScope`'s six outcomes), and a merged blob
   * loses exactly the context that decides which arm each side is in — the same
   * reason this class intersects resolved gates rather than merging blobs.
   */
  instanceListScope(key: OrgSharedInstanceAccessKey): InstanceListScope {
    const a = this.a.instanceListScope(key)
    const b = this.b.instanceListScope(key)
    if (a.kind === 'none' || b.kind === 'none') return { kind: 'none' }

    if (a.kind === 'include' && b.kind === 'include') {
      const other = new Set(b.includeIds)
      return narrowInclude(a.includeIds.filter((id) => other.has(id)))
    }
    if (a.kind === 'include' || b.kind === 'include') {
      const [included, excluded] =
        a.kind === 'include' ? [a.includeIds, b.excludeIds!] : [b.includeIds!, a.excludeIds!]
      const denied = new Set(excluded)
      return narrowInclude(included.filter((id) => !denied.has(id)))
    }
    return { kind: 'exclude', excludeIds: [...new Set([...a.excludeIds!, ...b.excludeIds!])] }
  }
}

/** An allow-list that emptied out sees nothing — one spelling, not two. */
function narrowInclude(includeIds: string[]): InstanceListScope {
  return includeIds.length > 0 ? { kind: 'include', includeIds } : { kind: 'none' }
}

/**
 * Compose two capability views into their intersection (capability layer v2 §2).
 *
 * Returns `a` unchanged when both sides are the same object — the common case
 * for an agent whose run-as user IS the invoker, and for any path that resolves
 * one set and passes it twice. Otherwise wraps in a {@link MinCapabilitySet}.
 */
export function intersectCapabilities(a: CapabilityView, b: CapabilityView): CapabilityView {
  return a === b ? a : new MinCapabilitySet(a, b)
}
