// packages/lib/src/permissions/capabilities/capability-set.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { ForbiddenError } from '../../errors'
import { satisfiesPermission } from '../../resource-access/constants'
import type { CapabilityView } from './capability-view'
import {
  type ClientCapabilities,
  canAdministerRecord,
  canEditRecord,
  canViewRecord,
  type InstanceListScope,
  instanceListScope,
  levelToPermission,
  NON_RECORD_DEF_SLUGS,
  type OrgSharedInstanceAccessKey,
  type ResolvedRecordAccess,
} from './entity-access'
import { INSTANCE_ACCESS_RESOURCES, type InstanceAccessKey } from './instance-access'
import {
  type Area,
  areaLevelFromKeys,
  Level,
  PERMISSION_REGISTRY_MAP,
  PermissionKey,
} from './registry'
import { ENTITY_WRITE_KEYS, SEAT_CEILINGS } from './seat-policy'

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
export class CapabilitySet implements CapabilityView {
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
   * @param instanceAccess Highest instance-level ResourceAccess permission per
   *                   `entityInstanceId` (CUID) for the instance-access resources
   *                   (datasets etc., §1.4). Explicit `'none'` rows are kept.
   * @param restrictedInstanceIds Org-wide set of instance ids carrying ≥1
   *                   instance-access row for *anyone*. An instance NOT in this
   *                   set has no explicit row → falls back to its area's base L2
   *                   level (for `baselineAtCreate: false` resources).
   * @param defBaseOverrides Per-def record base for defs whose base comes from
   *                   another Layer-2 area. Canonical `entityDefinitionId`
   *                   keys; `null` means that area is closed.
   */
  constructor(
    private readonly keys: ReadonlySet<PermissionKey>,
    private readonly defAccess: Readonly<Record<string, ResourcePermission>>,
    readonly role: OrganizationRole,
    readonly seatType: SeatType,
    private readonly defIdToSlug: DefIdToSlug = (id) => id,
    private readonly restrictedDefIds: ReadonlySet<string> = new Set(),
    private readonly defIdToDefinitionId: DefIdToSlug = (id) => id,
    private readonly instanceAccess: Readonly<Record<string, ResourcePermission>> = {},
    private readonly restrictedInstanceIds: ReadonlySet<string> = new Set(),
    private readonly defBaseOverrides: Readonly<Record<string, ResourcePermission | null>> = {}
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
   * The member's effective {@link Level} for one {@link Area}, recovered from the
   * already-composed (seat-clamped) key set via {@link areaLevelFromKeys}. Zero
   * I/O, and by construction identical to what every `can()` gate sees.
   */
  areaLevel(area: Area): Level {
    return areaLevelFromKeys(this.keys, area)
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
      defBaseOverrides: this.defBaseOverrides,
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
      defBaseOverrides: { ...this.defBaseOverrides },
      role: this.role,
      seatType: this.seatType,
      instanceAccess: { ...this.instanceAccess },
      restrictedInstanceIds: [...this.restrictedInstanceIds],
    }
  }

  /**
   * Whether the member may create/update/delete/merge records of the given def —
   * the `edit` floor (§0.1). Two carve-outs bypass most-specific-wins and keep
   * the existing verb gate ({@link canWriteEntity}) for mail-infrastructure defs
   * (signatures/snippets/etc. — governed by mail keys). Feature-backed record
   * defs use `defBaseOverrides`, so server and client apply the same derived base
   * and the same per-def override semantics.
   * Zero I/O.
   */
  canEditEntity(entityDefId: string): boolean {
    if (this.isMailInfraDef(entityDefId)) return this.canWriteEntity(entityDefId)
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
   *   a grant even for a field seat. Scoped to `seatType === 'worker'` — a full
   *   seat holds the same key by role default, where it would defeat a base
   *   records level of `None`.
   *
   * OWNER bypasses the noun layer (`effectiveRecordLevel` → `admin`) — the §0.10
   * recovery guarantee. ADMIN does not (doc 19 step 10): restricting a def now
   * scopes admins too, and the `admin` profile is where that is authored.
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

  /**
   * Whether the member may ADMINISTER the definition itself (§9.1) — manage its
   * fields, its access (the Access tab), its metadata, and delete/archive the
   * def. The `Full`/`admin` rung: a scoped delegation of org-admin for one def.
   *
   * Unlike {@link canEditEntity}, this does NOT flow from the base records level
   * — only an explicit `admin` type-grant (or OWNER/ADMIN) confers it. Worker
   * seats never administer. Scoped to the exact def, so a def-admin grantee can
   * only administer the def(s) they were granted (self-escalation guard). Zero I/O.
   *
   * ADMIN is the one bypass doc 19 step 10 deliberately left in place — see
   * {@link import('./entity-access').canAdministerRecord} for why.
   */
  canAdministerDef(entityDefId: string): boolean {
    return canAdministerRecord(this.resolved(), this.defIdToDefinitionId(entityDefId))
  }

  /** {@link canAdministerDef} as a throwing guard (403). */
  assertAdministerDef(entityDefId: string): void {
    if (this.canAdministerDef(entityDefId)) return
    throw new ForbiddenError("You don't have permission to administer this definition.")
  }

  /**
   * Effective per-instance permission for an instance-access resource
   * (most-specific-wins), or `undefined` = no access (§1.4). OWNER bypasses to
   * `admin` (§0.10); an explicit instance row (incl. the workspace baseline /
   * `'none'`) wins outright; with no row, the coarse L2 area gate must be open
   * and supplies the fallback level (for `baselineAtCreate: false` resources).
   * The SEAT ceiling is checked before any of that — it is a billing invariant
   * and outranks even an explicit row. Zero I/O.
   *
   * **An explicit row beats the area floor** (plan 25 §2) and **ADMIN no longer
   * bypasses** (doc 19 §5.3 piece 2, step 10) — kept byte-for-byte in sync with
   * the client mirror
   * {@link import('./entity-access').effectiveInstanceLevel}, which carries the
   * full rationale for both.
   */
  private effectiveInstanceLevel(
    key: InstanceAccessKey,
    instanceId: string
  ): ResourcePermission | undefined {
    if (this.role === 'OWNER') return ResourcePermission.admin
    const cfg = INSTANCE_ACCESS_RESOURCES[key]
    if (SEAT_CEILINGS[this.seatType][cfg.area] === Level.None) return undefined
    if (this.restrictedInstanceIds.has(instanceId)) return this.instanceAccess[instanceId]
    const areaLevel = areaLevelFromKeys(this.keys, cfg.area)
    if (areaLevel === Level.None) return undefined
    return cfg.baselineAtCreate ? undefined : levelToPermission(areaLevel)
  }

  /**
   * Whether this member holds ANY instance grant reaching `view`, across ALL
   * instance-access resources. Deliberately TYPE-BLIND: `instanceAccess` keys on
   * the bare instance CUID with no resource type, so the composed blob cannot
   * answer "does this member hold a *workflow* grant?" without a shape change
   * (and therefore a `user:capabilities:vN` bump). Zero I/O.
   *
   * Used ONLY as the coarse front-door waiver in `permissionProcedure` (plan
   * 25 §2): a member composing an instance-access area to `None` still has to
   * reach the procedure whose per-instance assert will judge them. It is safe
   * because it is scoped to `INSTANCE_ACCESS_VIEW_KEYS` and every
   * procedure behind those keys asserts on a specific instance immediately
   * after — it is NOT an authorization answer and must never be used as one.
   */
  hasAnyInstanceGrant(): boolean {
    return Object.values(this.instanceAccess).some((permission) =>
      satisfiesPermission(permission, ResourcePermission.view)
    )
  }

  /**
   * The id filter a paginated LIST query needs so `limit`/`offset`/`total` run
   * over the rows this member may actually see — the list-side twin of
   * {@link canViewInstance}, computed up front instead of filtering a page after
   * the fact. Delegates to the shared client-safe
   * {@link import('./entity-access').instanceListScope}, which carries the proof
   * that its two id lists reproduce the gate exactly. Zero I/O.
   *
   * ```ts
   * const scope = ctx.capabilities.instanceListScope('workflow')
   * if (scope.kind === 'none') return { workflows: [], total: 0, hasMore: false }
   * return service.getAll(orgId, {
   *   ...input,
   *   excludeIds: scope.excludeIds,
   *   includeIds: scope.includeIds,
   * })
   * ```
   */
  instanceListScope(key: OrgSharedInstanceAccessKey): InstanceListScope {
    return instanceListScope(
      {
        ...this.resolved(),
        instanceAccess: this.instanceAccess,
        restrictedInstanceIds: this.restrictedInstanceIds,
      },
      key
    )
  }

  /** Whether the member may VIEW the instance (Read). Zero I/O. */
  canViewInstance(key: InstanceAccessKey, instanceId: string): boolean {
    const level = this.effectiveInstanceLevel(key, instanceId)
    return level !== undefined && satisfiesPermission(level, ResourcePermission.view)
  }

  /** Whether the member may EDIT the instance's contents (Write). Zero I/O. */
  canEditInstance(key: InstanceAccessKey, instanceId: string): boolean {
    const level = this.effectiveInstanceLevel(key, instanceId)
    return level !== undefined && satisfiesPermission(level, ResourcePermission.edit)
  }

  /** Whether the member may ADMINISTER the instance + its settings (Full). Zero I/O. */
  canAdminInstance(key: InstanceAccessKey, instanceId: string): boolean {
    const level = this.effectiveInstanceLevel(key, instanceId)
    return level !== undefined && satisfiesPermission(level, ResourcePermission.admin)
  }

  /** {@link canViewInstance} as a throwing guard (403). */
  assertViewInstance(key: InstanceAccessKey, instanceId: string): void {
    if (this.canViewInstance(key, instanceId)) return
    throw new ForbiddenError("You don't have permission to view this.")
  }

  /** {@link canEditInstance} as a throwing guard (403). */
  assertEditInstance(key: InstanceAccessKey, instanceId: string): void {
    if (this.canEditInstance(key, instanceId)) return
    throw new ForbiddenError("You don't have permission to edit this.")
  }

  /** {@link canAdminInstance} as a throwing guard (403). */
  assertAdminInstance(key: InstanceAccessKey, instanceId: string): void {
    if (this.canAdminInstance(key, instanceId)) return
    throw new ForbiddenError("You don't have permission to manage this.")
  }

  /** The capability key required to write the given RecordId-def part. */
  private writeKeyFor(entityDefId: string): PermissionKey {
    const slug = this.defIdToSlug(entityDefId)
    return ENTITY_WRITE_KEYS[slug] ?? PermissionKey.recordsEdit
  }
}
