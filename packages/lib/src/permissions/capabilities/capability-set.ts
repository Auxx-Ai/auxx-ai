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
   */
  constructor(
    private readonly keys: ReadonlySet<PermissionKey>,
    private readonly defAccess: Readonly<Record<string, ResourcePermission>>,
    readonly role: OrganizationRole,
    readonly seatType: SeatType,
    private readonly defIdToSlug: DefIdToSlug = (id) => id
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
   * Whether the member may VIEW records of the given definition. Checks the
   * coarse {@link PermissionKey.recordsView} verb only. Type-level def-scope
   * read enforcement (the `defAccess` map + "absent = unrestricted" semantics)
   * lands with the v2 read-path wave (§9.0) — exposed via {@link viewAccessFor}.
   */
  canViewEntity(_entityDefId: string): boolean {
    return this.keys.has(PermissionKey.recordsView)
  }

  /**
   * The member's highest type-level ResourceAccess permission for a definition,
   * or `undefined` when the def carries no type-level grant for them (§9.0).
   */
  viewAccessFor(entityDefId: string): ResourcePermission | undefined {
    return this.defAccess[entityDefId]
  }

  /** The capability key required to write the given RecordId-def part. */
  private writeKeyFor(entityDefId: string): PermissionKey {
    const slug = this.defIdToSlug(entityDefId)
    return ENTITY_WRITE_KEYS[slug] ?? PermissionKey.recordsEdit
  }
}
