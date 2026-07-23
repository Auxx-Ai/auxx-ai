// packages/lib/src/permissions/capabilities/capability-set.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { ForbiddenError } from '../../errors'
import { PERMISSION_REGISTRY_MAP, PermissionKey } from './registry'
import { ENTITY_WRITE_KEYS } from './seat-policy'

/**
 * Resolves the definition part of a RecordId (a system slug like `work_order`,
 * an apiSlug, or a custom-entity id) to the entity SLUG that keys
 * {@link ENTITY_WRITE_KEYS}. Built once from already-cached data in
 * {@link getCapabilities} — the closure captured here does an in-memory map
 * lookup only, NEVER a DB/Redis query. Unknown keys pass through unchanged so
 * the {@link PermissionKey.recordsEdit} default applies.
 */
export type DefIdToSlug = (entityDefId: string) => string

/**
 * Defs whose visibility is governed OUTSIDE the records area — mail and
 * messaging infrastructure. `canViewEntity` passes these through unconditionally:
 * the `records.view` verb must not hide them (a member with a lowered records
 * area still composes mail with signatures and inboxes), and their
 * `ResourceAccess` rows carry SHARING semantics (mail visibility, sequence/
 * snippet sharing), never def restriction. Keyed by entityType slug; membership
 * is checked on both the raw def-part and its resolved slug.
 */
const NON_RECORD_DEF_SLUGS: ReadonlySet<string> = new Set([
  'inbox',
  'signature',
  'thread',
  'message',
  'snippet',
  'sequence',
])

/**
 * A resolved, request-scoped view of one member's Layer-2 capabilities (§6.1).
 *
 * Constructed ONCE per request from a single cached read (see
 * {@link getCapabilities}); every check after that is an in-memory `Set`
 * lookup — no guard issues its own fetch. This is a plain value object, not a
 * DB model, so it may carry behavior.
 */
export class CapabilitySet {
  /**
   * @param keys       Materialized capability verbs the member holds (already seat-clamped).
   * @param defAccess  Highest type-level ResourceAccess permission per entity definition
   *                   (Layer-3 data scoping, §9.0). Defs without a type-level grant are ABSENT.
   * @param role       The member's org role (metadata; admins hold every key by default).
   * @param seatType   The member's seat packaging (`full` | `worker`).
   * @param defIdToSlug In-memory RecordId-def → entity-slug resolver (zero I/O, see {@link DefIdToSlug}).
   * @param restrictedDefIds Org-wide set of entity defs carrying ≥1 type-level
   *                   ResourceAccess grant for *anyone* (§0). A def NOT in this
   *                   set is unrestricted (visible to all). Empty by default —
   *                   nothing is restricted, so `canViewEntity` degrades to the
   *                   coarse `records.view` verb (pre-v2 behavior).
   * @param defIdToDefinitionId In-memory RecordId-def → canonical
   *                   `entityDefinitionId` resolver (the keyspace of `defAccess`
   *                   / `restrictedDefIds`). Distinct from {@link defIdToSlug},
   *                   which resolves to the write-key slug.
   */
  constructor(
    private readonly keys: ReadonlySet<PermissionKey>,
    private readonly defAccess: Readonly<Record<string, ResourcePermission>>,
    readonly role: OrganizationRole,
    readonly seatType: SeatType,
    private readonly defIdToSlug: DefIdToSlug = (id) => id,
    private readonly restrictedDefIds: ReadonlySet<string> = new Set(),
    private readonly defIdToDefinitionId: DefIdToSlug = (id) => id
  ) {}

  /** O(1) Set lookup — whether the member holds `key`. */
  can(key: PermissionKey): boolean {
    return this.keys.has(key)
  }

  /** Alias for {@link can} — reads better at some call sites. */
  has(key: PermissionKey): boolean {
    return this.keys.has(key)
  }

  /**
   * Throw {@link ForbiddenError} (403) with the registry label when the member
   * lacks `key`. The single enforcement primitive every guard funnels through.
   */
  assert(key: PermissionKey): void {
    if (this.keys.has(key)) return
    const label = PERMISSION_REGISTRY_MAP.get(key)?.label ?? key
    throw new ForbiddenError(`You don't have permission to ${label}.`)
  }

  /**
   * Whether the member may WRITE records of the given definition. Maps the
   * RecordId-def part → entity slug (in memory) → the required key via
   * {@link ENTITY_WRITE_KEYS} (default {@link PermissionKey.recordsEdit}), then
   * a Set lookup. Zero I/O.
   */
  canWriteEntity(entityDefId: string): boolean {
    return this.keys.has(this.writeKeyFor(entityDefId))
  }

  /** {@link canWriteEntity} as a throwing guard (403 with the required key's label). */
  assertWriteEntity(entityDefId: string): void {
    this.assert(this.writeKeyFor(entityDefId))
  }

  /**
   * Whether the member may VIEW records of the given definition (v2 §0). Two
   * layers combined by `min`:
   * - **Layer 2 (the verb):** must hold {@link PermissionKey.recordsView} — or
   *   {@link PermissionKey.recordsViewLinked} (field seats), whose reads are
   *   narrowed to their linked rows by the row-scoped read path, not per def.
   * - **Layer 3 (the noun):** if the def carries a type-level grant for *anyone*
   *   (it's in `restrictedDefIds`), the member must be a grantee (present in
   *   their `defAccess`). A def with NO type-level grant is unrestricted —
   *   **absent = visible to all**. OWNER/ADMIN bypass this layer: restricting a
   *   def scopes members, never the admins who administer it.
   *
   * Mail/messaging infrastructure defs ({@link NON_RECORD_DEF_SLUGS}) bypass
   * both layers — their visibility is governed by the mail visibility system.
   *
   * The argument may be any RecordId-def form (slug, apiSlug, id); it is
   * normalized to the canonical `entityDefinitionId` keyspace first. Zero I/O.
   */
  canViewEntity(entityDefId: string): boolean {
    if (
      NON_RECORD_DEF_SLUGS.has(entityDefId) ||
      NON_RECORD_DEF_SLUGS.has(this.defIdToSlug(entityDefId))
    ) {
      return true
    }
    if (
      !this.keys.has(PermissionKey.recordsView) &&
      !this.keys.has(PermissionKey.recordsViewLinked)
    ) {
      return false
    }
    if (this.role === 'OWNER' || this.role === 'ADMIN') return true
    const defId = this.defIdToDefinitionId(entityDefId)
    if (!this.restrictedDefIds.has(defId)) return true
    return this.defAccess[defId] !== undefined
  }

  /** {@link canViewEntity} as a throwing guard (403). */
  assertViewEntity(entityDefId: string): void {
    if (this.canViewEntity(entityDefId)) return
    throw new ForbiddenError("You don't have permission to view these records.")
  }

  /**
   * Filter a set of RecordId-def forms down to the viewable ones (§0). Pure
   * in-memory — the multi-def enforcement primitive; NEVER a per-row query.
   */
  filterViewableDefIds(entityDefIds: string[]): string[] {
    return entityDefIds.filter((id) => this.canViewEntity(id))
  }

  /**
   * The member's highest type-level ResourceAccess permission for a definition,
   * or `undefined` when the def carries no type-level grant for them (§9.0).
   * Normalizes its argument to the canonical `entityDefinitionId` keyspace.
   */
  viewAccessFor(entityDefId: string): ResourcePermission | undefined {
    return this.defAccess[this.defIdToDefinitionId(entityDefId)]
  }

  /** The capability key required to write the given RecordId-def part. */
  private writeKeyFor(entityDefId: string): PermissionKey {
    const slug = this.defIdToSlug(entityDefId)
    return ENTITY_WRITE_KEYS[slug] ?? PermissionKey.recordsEdit
  }
}
