// packages/lib/src/permissions/capabilities/capability-set.ts

import type { ResourcePermission, Rung } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { ForbiddenError } from '../../errors'
import type { CapabilityView } from './capability-view'
import {
  type ClientCapabilities,
  canAdministerRecord,
  canDeleteRecord,
  canDeleteRecordAtRung,
  canEditRecord,
  canEditRecordAtRung,
  canImportRecord,
  canViewRecord,
  type GrantedDefIds,
  type InstanceListScope,
  instanceFallbackLevel,
  instanceListScope,
  levelToRung,
  NON_RECORD_DEF_SLUGS,
  type OrgSharedInstanceAccessKey,
  type ResolvedRecordAccess,
  recordDefRung,
} from './entity-access'
import { INSTANCE_ACCESS_RESOURCES, type InstanceAccessKey } from './instance-access'
import { Area, areaLevelFromKeys, Level, PERMISSION_REGISTRY_MAP, PermissionKey } from './registry'
import { foldRecordAccess, satisfiesRung } from './rung'
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
   *                   (datasets etc., §1.4), from INDIVIDUAL grantee rows only
   *                   (`user` / `group` / `profile`). Explicit `'none'` rows are
   *                   kept. Never gated by the area level (#1346, plan 43 §0.2a).
   * @param baselineInstanceAccess The same map for `role:org_member` rows — the
   *                   workspace default, split out by plan 43 §4.1 and GATED by
   *                   the member's area level in {@link effectiveInstanceLevel}.
   *                   Defaults to `{}`; that default is also what a pre-`v16`
   *                   cache blob produces, which fails OPEN — see the ledger
   *                   entry at `user:capabilities:v16`.
   * @param governingInstanceIds Org-wide set of instance ids whose access is
   *                   GOVERNED by rows — a `role:org_member` baseline at any
   *                   permission, or any `permission = 'none'` marker. **Not**
   *                   "carries ≥1 row": sharing an instance does not restrict it
   *                   (see {@link import('./entity-access').effectiveInstanceLevel}).
   *                   An instance NOT in this set falls back to its area's base
   *                   L2 level (for `baselineAtCreate: false` resources) unless
   *                   the member holds a row of their own.
   * @param defBaseOverrides Per-def record base for defs whose base comes from
   *                   another Layer-2 area. Canonical `entityDefinitionId`
   *                   keys; `null` means that area is closed.
   * @param instanceDerivedKeys Coarse Read-rung keys SYNTHESIZED at composition
   *                   time from the member's instance grants (see
   *                   {@link import('./compose-user-capabilities').UserCapabilities.instanceDerivedKeys}).
   *                   Read by {@link can}/{@link has}/{@link assert} ONLY —
   *                   {@link areaLevel} and {@link resolved} deliberately ignore
   *                   them, because `keys` is the area-level source of truth
   *                   that `effectiveInstanceLevel` reads its absent-row
   *                   fallback from.
   */
  constructor(
    private readonly keys: ReadonlySet<PermissionKey>,
    private readonly defAccess: Readonly<Record<string, ResourcePermission>>,
    readonly role: OrganizationRole,
    readonly seatType: SeatType,
    private readonly defIdToSlug: DefIdToSlug = (id) => id,
    private readonly restrictedDefIds: ReadonlySet<string> = new Set(),
    private readonly defIdToDefinitionId: DefIdToSlug = (id) => id,
    private readonly instanceAccess: Readonly<Record<string, Rung>> = {},
    private readonly governingInstanceIds: ReadonlySet<string> = new Set(),
    private readonly defBaseOverrides: Readonly<Record<string, ResourcePermission | null>> = {},
    private readonly instanceDerivedKeys: ReadonlySet<PermissionKey> = new Set(),
    // Appended rather than slotted beside `instanceAccess` (plan 43 §4.1): these
    // are positional parameters with ~15 construction sites, and re-ordering them
    // would silently re-bind every one that passes the tail arguments.
    private readonly baselineInstanceAccess: Readonly<Record<string, Rung>> = {},
    // Appended for the same reason (plan v3/03 P5). See
    // {@link import('./entity-access').GrantedDefIds} — including the note that
    // its compose-time population is wired by a separate slice, so the default
    // `{}` is what every construction site produces today: a CLOSED front door.
    private readonly grantedDefIds: GrantedDefIds = {}
  ) {}

  /**
   * O(1) Set lookup — whether the member holds `key`, either from their resolved
   * area levels or as a Read rung derived from an instance grant.
   *
   * The derived half is a FRONT DOOR, not an authorization answer: it says only
   * that the member has *some* access inside that feature, so the coarse gate
   * (nav, cmd+K, a landing-page guard, `permissionProcedure`) must not deny them
   * outright. Anything that reads org-wide data behind such a key must scope
   * itself per instance — see `dataset.getOrganizationStats` for the pattern.
   */
  can(key: PermissionKey): boolean {
    return this.keys.has(key) || this.instanceDerivedKeys.has(key)
  }

  /** Alias for {@link can} — reads better at some call sites. */
  has(key: PermissionKey): boolean {
    return this.can(key)
  }

  /**
   * The member's effective {@link Level} for one {@link Area}, recovered from the
   * already-composed (seat-clamped) key set via {@link areaLevelFromKeys}. Zero
   * I/O.
   *
   * Reads `keys` ONLY — never the instance-derived keys. This is the area-level
   * source of truth `effectiveInstanceLevel` / `instanceListScope` take their
   * absent-row fallback from, so a member whose only workflow access is one
   * explicit grant must still report `workflows: None` here. `can()` and this
   * method therefore disagree for exactly those members, on purpose.
   */
  areaLevel(area: Area): Level {
    return areaLevelFromKeys(this.keys, area)
  }

  /**
   * Throw {@link ForbiddenError} (403) with the registry label when the member
   * lacks `key`. The single enforcement primitive every guard funnels through.
   */
  assert(key: PermissionKey): void {
    if (this.can(key)) return
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
      grantedDefIds: this.grantedDefIds,
    }
  }

  /**
   * Serialize to the wire snapshot the client needs to run the SAME
   * most-specific-wins math (dehydrated seed + `permissions.myCapabilities`).
   */
  toClientCapabilities(): ClientCapabilities {
    return {
      keys: [...this.keys],
      instanceDerivedKeys: [...this.instanceDerivedKeys],
      defAccess: { ...this.defAccess },
      restrictedEntityDefIds: [...this.restrictedDefIds],
      defBaseOverrides: { ...this.defBaseOverrides },
      role: this.role,
      seatType: this.seatType,
      instanceAccess: { ...this.instanceAccess },
      baselineInstanceAccess: { ...this.baselineInstanceAccess },
      governingInstanceIds: [...this.governingInstanceIds],
      // The front door rides the wire (contract §1) so the client's nav filter,
      // route gate and column metadata resolve it identically to the server.
      grantedDefIds: { ...this.grantedDefIds },
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
   * Whether the member may DELETE (or merge away) records of the given def —
   * the `Full` rung, made def-aware. See {@link canDeleteRecord}: the org-wide
   * `recordsDelete` verb OR an explicit per-def `admin` grant, both floored by
   * the def's edit gate.
   *
   * Replaces the `assert(recordsDelete)` + `assertEditEntity` pair that
   * `record.delete` / `bulkDelete` / `merge` used to spell out by hand. That pair
   * is exactly this method's first branch, so the swap takes nothing away.
   *
   * Mail-infra defs keep the coarse verb gate, as {@link canEditEntity} does.
   * Zero I/O.
   */
  canDeleteEntity(entityDefId: string): boolean {
    if (this.isMailInfraDef(entityDefId)) {
      return this.canWriteEntity(entityDefId) && this.keys.has(PermissionKey.recordsDelete)
    }
    return canDeleteRecord(this.resolved(), this.defIdToDefinitionId(entityDefId))
  }

  /** {@link canDeleteEntity} as a throwing guard (403). */
  assertDeleteEntity(entityDefId: string): void {
    if (this.canDeleteEntity(entityDefId)) return
    throw new ForbiddenError("You don't have permission to delete these records.")
  }

  /**
   * Whether the member may IMPORT records into the given def — the `Full` rung,
   * made def-aware. See {@link canImportRecord}.
   *
   * Unlike delete, this is not purely additive: `data-import.ts` asserted the
   * coarse `recordsImport` verb and NO per-def gate, so a member restricted out
   * of a def could still bulk-write rows into it. Adding the `edit` floor is a
   * deliberate TIGHTENING of that path.
   *
   * Zero I/O.
   */
  canImportEntity(entityDefId: string): boolean {
    if (this.isMailInfraDef(entityDefId)) {
      return this.canWriteEntity(entityDefId) && this.keys.has(PermissionKey.recordsImport)
    }
    return canImportRecord(this.resolved(), this.defIdToDefinitionId(entityDefId))
  }

  /** {@link canImportEntity} as a throwing guard (403). */
  assertImportEntity(entityDefId: string): void {
    if (this.canImportEntity(entityDefId)) return
    throw new ForbiddenError("You don't have permission to import into these records.")
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
   * **The front door** (plan v3/03 §6.1) — `canViewEntity(def) ||
   * grantedDefIds[def]`. See {@link CapabilityView.hasDefPresence}. Zero I/O.
   */
  hasDefPresence(entityDefId: string): boolean {
    if (this.canViewEntity(entityDefId)) return true
    return this.hasRecordGrantsOn(entityDefId)
  }

  /**
   * Whether the member holds ≥1 per-record grant on the def — the raw
   * {@link GrantedDefIds} lookup, in the canonical `entityDefinitionId`
   * keyspace. Zero I/O.
   */
  hasRecordGrantsOn(entityDefId: string): boolean {
    return Boolean(this.grantedDefIds[this.defIdToDefinitionId(entityDefId)])
  }

  /**
   * The member's DEF-level record authority on the {@link Rung} ladder — the def
   * half of the `_access` stamp (plan v3/03 §5.2). Zero I/O.
   */
  recordDefRung(entityDefId: string): Rung | undefined {
    if (this.isMailInfraDef(entityDefId)) return undefined
    return recordDefRung(this.resolved(), this.defIdToDefinitionId(entityDefId))
  }

  /**
   * The **row-effective** rung: the def level folded with a row's aggregated
   * grant rank (§5.2). Zero I/O — `grantRank` was resolved in the row's own
   * query by `recordAccessRankSql`.
   *
   * The SEAT ceiling is applied HERE, on the fold, and that placement is
   * load-bearing: `recordDefRung` goes through `effectiveRecordLevel` and is
   * already clamped, but the grant half comes straight off `ResourceAccess` rows
   * that know nothing about seats. Without this a worker seat — whose
   * `Area.records` is not in `WORKER_AREAS` and is therefore clamped to `None` —
   * would be handed `edit` or `admin` on any row somebody shared with it, i.e. a
   * billing invariant defeated by a share. Same shape as
   * {@link import('./entity-access').effectiveRecordLevel}'s own ceiling check.
   */
  recordAccessAt(entityDefId: string, grantRank: number | null): Rung {
    if (SEAT_CEILINGS[this.seatType][Area.records] === Level.None) return 'none'
    return foldRecordAccess(this.recordDefRung(entityDefId), grantRank)
  }

  /**
   * Row-effective DELETE gate (§5.3) — the shipped delete rule read at the
   * `_access` stamp rather than at the def level. Zero I/O.
   */
  canDeleteRecordAt(access: Rung): boolean {
    return canDeleteRecordAtRung(this.resolved(), access)
  }

  /** {@link canDeleteRecordAt} as a throwing guard (403). */
  assertDeleteRecordAt(access: Rung): void {
    if (this.canDeleteRecordAt(access)) return
    throw new ForbiddenError("You don't have permission to delete these records.")
  }

  /**
   * Row-effective EDIT gate (§5.3) — the `edit` floor read at the `_access`
   * stamp. Zero I/O. See {@link CapabilityView.canEditRecordAt} for why the
   * def-level {@link canEditEntity} cannot answer this question for a row.
   */
  canEditRecordAt(access: Rung): boolean {
    return canEditRecordAtRung(access)
  }

  /** {@link canEditRecordAt} as a throwing guard (403). */
  assertEditRecordAt(access: Rung): void {
    if (this.canEditRecordAt(access)) return
    throw new ForbiddenError("You don't have permission to edit these records.")
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
   * `admin` for the ORG-SHARED resources only (§0.10); the member's own
   * INDIVIDUAL row (incl. `'none'`) wins outright; failing that the coarse L2
   * area gate must be open, and then an explicit workspace-BASELINE row is the
   * answer, a ROW-GOVERNED instance denies, and everything else takes the area
   * fallback (for `baselineAtCreate: false` resources). The SEAT ceiling is
   * checked before any of that — it is a billing invariant and outranks even an
   * explicit row, and for the private resources it precedes the OWNER branch too.
   * Zero I/O.
   *
   * **THE RULE, in one sentence** (plan 43 §0.2a decision C): *the area level
   * gates the BASELINE path; an individual grant always overrules it.* Step 1
   * above step 2 is #1346; step 2 above step 3 is what makes `Dashboards: None`
   * mean no dashboards. **The ordering is the design** — swap either and one of
   * those two breaks silently.
   *
   * **An explicit individual row beats the area floor** (plan 25 §2 / #1346),
   * **ADMIN no longer bypasses** (doc 19 §5.3 piece 2, step 10), **OWNER no
   * longer bypasses on `baselineAtCreate: true` resources** (user decision
   * 2026-07-28, plan 36 §0.6 revised), **sharing an instance no longer restricts
   * it** (2026-07-29: own-row-first + `governingInstanceIds`), and **the
   * workspace default is gated while an individual grant is not** (2026-07-29,
   * plan 43) — kept byte-for-byte in sync with the client mirror
   * {@link import('./entity-access').effectiveInstanceLevel}, which carries the
   * full rationale for all five. Change one, change the other in the same edit;
   * `capability-set-instance.test.ts` and `area-baseline-gate.test.ts` assert
   * both on every case.
   */
  private effectiveInstanceLevel(key: InstanceAccessKey, instanceId: string): Rung | undefined {
    const cfg = INSTANCE_ACCESS_RESOURCES[key]
    if (this.role === 'OWNER' && !cfg.baselineAtCreate) return 'admin'
    if (SEAT_CEILINGS[this.seatType][cfg.area] === Level.None) return undefined

    // 1. An individual grant (user / group / profile) ALWAYS wins — #1346, and it is
    //    what keeps a creator's own `user @ admin` row reachable at any area level.
    const own = this.instanceAccess[instanceId]
    if (own !== undefined) return own

    // 2. Everything below here is the BASELINE path, which the area level gates (§0.2a).
    //    One rule for all nine resources — do NOT branch on `cfg.baselineAtCreate`.
    const areaLevel = areaLevelFromKeys(this.keys, cfg.area)
    if (areaLevel === Level.None) return undefined

    // 3. An explicit workspace-baseline row, then the governing set, then the fallback.
    const baseline = this.baselineInstanceAccess[instanceId]
    if (baseline !== undefined) return baseline
    if (this.governingInstanceIds.has(instanceId)) return undefined
    return cfg.baselineAtCreate ? undefined : levelToRung(areaLevel)
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
        baselineInstanceAccess: this.baselineInstanceAccess,
        governingInstanceIds: this.governingInstanceIds,
      },
      key
    )
  }

  /**
   * {@link effectiveInstanceLevel} as a public read — the composed level itself
   * rather than a yes/no gate.
   *
   * For DISPLAY, and only where the display must agree with enforcement: the
   * grantee Access grids render "what can this member actually open" beside the
   * grantee's own grant, and plan 31 finding 4 is what happens when they don't
   * agree (a user-level `none` LOSES to any group's `view`, so the admin sets
   * No access, the select changes, and nothing happens). Reading the enforcement
   * predicate is the whole point — never re-derive this from `instanceAccess`.
   *
   * Not a substitute for {@link assertViewInstance} on a request path. Zero I/O.
   */
  instanceLevel(key: InstanceAccessKey, instanceId: string): Rung | undefined {
    return this.effectiveInstanceLevel(key, instanceId)
  }

  /**
   * What {@link instanceLevel} answers for an instance with no `ResourceAccess`
   * row anywhere in the org — see
   * {@link import('./entity-access').instanceFallbackLevel}. Lets a bulk read
   * cover "every other instance of this type" with one value. Zero I/O.
   */
  instanceFallbackLevel(key: InstanceAccessKey): Rung | undefined {
    return instanceFallbackLevel(this.resolved(), key)
  }

  /** Whether the member may VIEW the instance (Read). Zero I/O. */
  canViewInstance(key: InstanceAccessKey, instanceId: string): boolean {
    const level = this.effectiveInstanceLevel(key, instanceId)
    return level !== undefined && satisfiesRung(level, 'read')
  }

  /** Whether the member may EDIT the instance's contents (Write). Zero I/O. */
  canEditInstance(key: InstanceAccessKey, instanceId: string): boolean {
    const level = this.effectiveInstanceLevel(key, instanceId)
    return level !== undefined && satisfiesRung(level, 'edit')
  }

  /** Whether the member may ADMINISTER the instance + its settings (Full). Zero I/O. */
  canAdminInstance(key: InstanceAccessKey, instanceId: string): boolean {
    const level = this.effectiveInstanceLevel(key, instanceId)
    return level !== undefined && satisfiesRung(level, 'admin')
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
