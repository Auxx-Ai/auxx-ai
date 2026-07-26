// packages/lib/src/permissions/capabilities/capability-view.ts

import type { ResourcePermission } from '@auxx/database/enums'
import { PERMISSION_RANK } from './compose-user-capabilities'
import type { InstanceAccessKey } from './instance-access'
import type { Area, Level, PermissionKey } from './registry'

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
