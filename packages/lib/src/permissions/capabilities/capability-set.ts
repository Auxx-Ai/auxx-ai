// packages/lib/src/permissions/capabilities/capability-set.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { ForbiddenError } from '../../errors'
import {
  type ClientCapabilities,
  canEditRecord,
  canViewRecord,
  NON_RECORD_DEF_SLUGS,
  type ResolvedRecordAccess,
} from './entity-access'
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
   *
   * This is the coarse Layer-2 verb gate. Def-aware write enforcement (Layer 2 ×
   * Layer 3) is {@link canEditEntity}; mail-infra defs fall back to this verb.
   */
  canWriteEntity(entityDefId: string): boolean {
    return this.keys.has(this.writeKeyFor(entityDefId))
  }

  /** {@link canWriteEntity} as a throwing guard (403 with the required key's label). */
  assertWriteEntity(entityDefId: string): void {
    this.assert(this.writeKeyFor(entityDefId))
  }

  /**
   * The normalized {@link ResolvedRecordAccess} view fed to the shared
   * client-safe resolver ({@link canViewRecord} / {@link canEditRecord}). The
   * `defAccess` / `restrictedDefIds` fields are already in the canonical
   * `entityDefinitionId` keyspace (normalized in {@link getCapabilities}).
   */
  private resolved(): ResolvedRecordAccess {
    return {
      role: this.role,
      seatType: this.seatType,
      keys: this.keys,
      defAccess: this.defAccess,
      restrictedEntityDefIds: this.restrictedDefIds,
    }
  }

  /**
   * Serialize to the wire snapshot the client needs to run the SAME
   * most-specific-wins math (dehydrated seed + `permissions.myCapabilities`).
   */
  toClientCapabilities(): ClientCapabilities {
    return {
      keys: [...this.keys],
      defAccess: { ...this.defAccess },
      restrictedEntityDefIds: [...this.restrictedDefIds],
      role: this.role,
      seatType: this.seatType,
    }
  }

  /**
   * Whether the member may create/update/delete/merge records of the given def —
   * the `edit` floor (§0.1). Two carve-outs bypass most-specific-wins and keep
   * the existing verb gate ({@link canWriteEntity}), because their write
   * authority lives OUTSIDE the records area:
   *  - **mail-infra defs** (signatures/snippets/etc. — governed by mail keys),
   *  - **defs with a dedicated write key** ({@link ENTITY_WRITE_KEYS}, e.g.
   *    `work_order` → `dispatch.board.manage`). Gating these on the records level
   *    would wrongly block a dispatch manager (who holds `board.manage` but may be
   *    Read-only on records) or wrongly admit a records-editor lacking the
   *    dispatch key (open item #4 — dispatch authority kept as-is).
   * Zero I/O.
   */
  canEditEntity(entityDefId: string): boolean {
    if (this.isMailInfraDef(entityDefId) || this.hasDedicatedWriteKey(entityDefId)) {
      return this.canWriteEntity(entityDefId)
    }
    return canEditRecord(this.resolved(), this.defIdToDefinitionId(entityDefId))
  }

  /** {@link canEditEntity} as a throwing guard (403). */
  assertEditEntity(entityDefId: string): void {
    if (this.canEditEntity(entityDefId)) return
    throw new ForbiddenError("You don't have permission to edit these records.")
  }

  /**
   * Filter a set of RecordId-def forms down to the editable ones (§1). Pure
   * in-memory — the multi-def write enforcement primitive; NEVER a per-row query.
   */
  filterEditableDefIds(entityDefIds: string[]): string[] {
    return entityDefIds.filter((id) => this.canEditEntity(id))
  }

  /**
   * Whether the member may VIEW records of the given definition (v2 §0/§1),
   * re-expressed to most-specific-wins so read and write agree (§0.2):
   * `effectiveRecordLevel(def)` must satisfy `view`. This means an explicit
   * per-def grant REPLACES the base records verb — a member with base None but a
   * def grant of Read/Edit/Full *can* view that def (v1.5 §5.1, revised).
   *
   * Two carve-outs survive the re-expression:
   * - **Mail/messaging infrastructure defs** ({@link NON_RECORD_DEF_SLUGS})
   *   bypass entirely — visibility governed by the mail visibility system.
   * - **Field seats** ({@link PermissionKey.recordsViewLinked}) grant view of
   *   their LINKED rows (narrowed by the row-scoped read path, not per def); this
   *   verb is not a base rung, so it's applied here. A restricted def still needs
   *   a grant even for a field seat.
   *
   * OWNER/ADMIN bypass the noun layer (`effectiveRecordLevel` → `admin`):
   * restricting a def scopes members, never the admins who administer it.
   *
   * The argument may be any RecordId-def form (slug, apiSlug, id); it is
   * normalized to the canonical `entityDefinitionId` keyspace first. Zero I/O.
   */
  canViewEntity(entityDefId: string): boolean {
    if (this.isMailInfraDef(entityDefId)) return true
    return canViewRecord(this.resolved(), this.defIdToDefinitionId(entityDefId))
  }

  /**
   * Mail/messaging infrastructure def check ({@link NON_RECORD_DEF_SLUGS}),
   * matched on both the raw def-part and its resolved entity slug.
   */
  private isMailInfraDef(entityDefId: string): boolean {
    return (
      NON_RECORD_DEF_SLUGS.has(entityDefId) ||
      NON_RECORD_DEF_SLUGS.has(this.defIdToSlug(entityDefId))
    )
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

  /**
   * Whether the def has a dedicated write key ({@link ENTITY_WRITE_KEYS}) rather
   * than the default {@link PermissionKey.recordsEdit} — i.e. its write authority
   * belongs to another area (e.g. dispatch), so it bypasses the records-level
   * edit gate in {@link canEditEntity}.
   */
  private hasDedicatedWriteKey(entityDefId: string): boolean {
    return this.writeKeyFor(entityDefId) !== PermissionKey.recordsEdit
  }
}
