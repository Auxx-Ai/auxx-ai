// packages/lib/src/resources/crud/unified-handler.ts

import type { Database } from '@auxx/database'
import { database as defaultDatabase, schema } from '@auxx/database'
import type { Rung } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { checkUniqueValue } from '@auxx/services/custom-fields'
import { getEntityInstance, listEntityInstances } from '@auxx/services/entity-instances'
import { ModelTypes } from '@auxx/types/custom-field'
import type { FieldId } from '@auxx/types/field'
import { createTypedValueInput } from '@auxx/types/field-value'
import { isEntityDefinitionType } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { type AnyColumn, and, eq, type SQL } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { findCachedResource, getCachedCustomFields, getCachedFieldMap } from '../../cache'
import { type ConditionGroup, resolveConditionContext } from '../../conditions'
import { BadRequestError, ForbiddenError } from '../../errors'
import { publisher } from '../../events/publisher'
import { FieldValueService } from '../../field-values'
import { normalizeForLookup } from '../../field-values/normalize-for-lookup'
import { typedColumnMatch } from '../../field-values/typed-column-match'
import { upsertRecordIdentity } from '../../identity'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import {
  assertRequestScoped,
  type RecordVisibilityScope,
  recordAccessRankSql,
  recordScopeArmFor,
  resolveRecordVisibilityScope,
} from '../../permissions/capabilities/record-visibility-scope'
import { resolveResourceAccessGrantees } from '../../resource-access/grantee-resolution'
import { getCommonHooks, getSystemHooks } from '../hooks'
import { RecordPickerService } from '../picker'
import { isMailLensTableId, MAIL_LENS_REFUSAL } from '../picker/mail-lens-tables'
import type { RecordPickerItem } from '../picker/types'
import { isSystemResourceId } from '../registry'
import type { TableId } from '../registry/field-registry'
import { parseRecordId, type RecordId, toRecordId } from '../resource-id'
import { assertRecordRowsEditable } from './record-row-access'
import type { ResolvedEntityDefinition } from './types'
import {
  archiveEntity,
  bulkArchiveEntities,
  bulkCreateEntities,
  bulkDeleteEntities,
  bulkSetFieldValue,
  bulkUpdateEntities,
  type CreateEntityResult,
  type CrudOptions,
  createEntity,
  createWithValues as createWithValuesImpl,
  deleteEntity,
  type MutationContext,
  mergeEntities,
  restoreEntity,
  updateEntity,
  updateValues as updateValuesImpl,
} from './unified-handler-mutations'
import {
  isSystemResource,
  type ListAllInput,
  type ListAllResult,
  type ListFilteredResult,
  listAll as listAllQuery,
  queryEntityInstanceIdsPaged,
  querySystemResourceIdsPaged,
  resolveEntityIdFromCache,
} from './unified-handler-queries'

/** Inferred type for CustomField select (not exported from schema) */
type CustomFieldEntity = typeof schema.CustomField.$inferSelect
type EntityInstanceEntity = typeof schema.EntityInstance.$inferSelect

const lookupLogger = createScopedLogger('unified-handler-lookup')

/**
 * Parse an `external_id` value (`"<source>:<value>"`, e.g. `"gmail:jane@x.com"`,
 * `"website:acme.com"`) into a `RecordIdentity` `(source, externalId)`. The
 * `external_id` array attribute is retired; app-less external ids now live in
 * the identity index, so both the extension dedupe lookup and its create-write
 * route through this. Returns `null` for unprefixed / malformed values.
 */
function parseExternalIdentity(raw: unknown): { source: string; externalId: string } | null {
  if (typeof raw !== 'string') return null
  const idx = raw.indexOf(':')
  if (idx <= 0 || idx >= raw.length - 1) return null
  return { source: raw.slice(0, idx), externalId: raw.slice(idx + 1) }
}

/**
 * Candidate for `lookupByField` — one field reference + value to try. Two shapes,
 * resolved through the same `customFields` org-cache:
 *  - `{ systemAttribute }` → matched by `CustomField.systemAttribute` (system
 *    fields / legacy callers: extension, `record.lookupByField`, `findByField`).
 *  - `{ fieldId }` → matched by `CustomField.id` directly — the only path that
 *    resolves connector-provisioned custom fields, whose `systemAttribute` is null.
 */
export type LookupCandidate =
  | { systemAttribute: string; value: unknown }
  | { fieldId: FieldId; value: unknown }

/**
 * Single match returned by `lookupByField`. `matchedBy` echoes the candidate that
 * hit this record (its `systemAttribute` or `fieldId`), useful when callers want
 * to know whether dedup succeeded via externalId vs. primary_email. The
 * denormalized display columns from EntityInstance ride along so list-style
 * consumers (e.g. the extension's "N similar found" view) can render an avatar +
 * name + subtitle without a second round-trip.
 */
export type LookupMatch = {
  recordId: RecordId
  matchedBy: { systemAttribute?: string; fieldId?: FieldId; value: unknown }
  displayName: string | null
  secondaryDisplayValue: string | null
  avatarUrl: string | null
}

/**
 * Result envelope for `lookupByField`. `hasMore` is set when the server
 * found more than `limit` distinct records across the candidate list.
 */
export type LookupByFieldResult = {
  items: LookupMatch[]
  hasMore: boolean
}

/**
 * Helper to unwrap neverthrow Result and throw on error.
 *
 * Typed against `Result`, not structurally: an `Err` carries no `value` and an
 * `Ok` carries no `error`, so a `{ isErr, error, value }` parameter matches
 * neither arm and silently degraded `T` to `unknown`.
 */
function unwrapResult<T, E extends { message: string }>(result: Result<T, E>): T {
  if (result.isErr()) {
    throw new Error(result.error.message)
  }
  return result.value
}

// Re-export CrudOptions for backwards compatibility
export type { CrudOptions } from './unified-handler-mutations'

/**
 * Unified CRUD handler for ALL entity types.
 * Replaces EntityInstanceService, ContactService, TicketService.
 *
 * Features:
 * - Works with both system entities (contact, ticket) and custom entities
 * - Integrates system hooks for validation and normalization
 * - Provides findByField and findOrCreate methods
 * - Handles bulk operations efficiently
 * - Manages events and field values consistently
 *
 * @example
 * ```typescript
 * const handler = new UnifiedCrudHandler(organizationId, userId, db)
 *
 * // Create a contact
 * const contact = await handler.create('contact', {
 *   primary_email: 'john@example.com',
 *   first_name: 'John',
 *   last_name: 'Doe'
 * })
 *
 * // Update a contact
 * const recordId = toRecordId('contact', contact.id)
 * await handler.update(recordId, {
 *   first_name: 'Jane'
 * })
 *
 * // Find or create
 * const { instance, created } = await handler.findOrCreate(
 *   'contact',
 *   { primary_email: 'jane@example.com' },
 *   { first_name: 'Jane', last_name: 'Smith' }
 * )
 * ```
 */
/** Optional construction options for `UnifiedCrudHandler`. */
export interface UnifiedCrudHandlerOptions {
  /**
   * SystemAttributes the caller is authorized to write even when a
   * registered field pre-hook would normally drop or reject them. Forwarded
   * to the internal `FieldValueService`.
   */
  bypassFieldGuards?: ReadonlySet<SystemAttribute>
  /**
   * Request-scoped {@link CapabilityView} for entity-def enforcement. Present ⇒
   * read methods gate each def through `canViewEntity` (v2 §2) AND mutation
   * methods gate through `assertEditEntity` (v2 phase 4 §2). **Absent ⇒ no
   * enforcement** — so internal/system callers (seeders, workers, record-rules)
   * stay unrestricted with no change. Request paths must thread `ctx.capabilities`
   * (resolved once via `capabilityProcedure`).
   */
  capabilities?: CapabilityView
  /**
   * Marks a REQUEST-path construction (plan v3/03 §5.1).
   *
   * `capabilities: undefined` legitimately means "internal caller, no
   * enforcement" — workers, seeders and record-rules depend on it. The hazard is
   * that the same absence on a request path is indistinguishable at runtime and
   * reads the whole org silently. Request paths therefore say so, and
   * {@link assertRequestScoped} turns the silent read into a loud 403.
   */
  requestPath?: boolean
}

export class UnifiedCrudHandler {
  fieldValueService: FieldValueService
  private db: Database
  private bypassFieldGuards: ReadonlySet<SystemAttribute>
  /** Request-scoped read enforcement; undefined for internal/system callers. */
  private capabilities?: CapabilityView
  /** Per-handler memo of {@link recordScope}, keyed by canonical def id. */
  private scopeCache = new Map<string, Promise<RecordVisibilityScope>>()

  constructor(
    private organizationId: string,
    private userId: string,
    db?: Database,
    private socketId?: string,
    options: UnifiedCrudHandlerOptions = {}
  ) {
    this.db = db ?? defaultDatabase
    this.bypassFieldGuards = options.bypassFieldGuards ?? new Set()
    // §5.1: a request-path construction that forgot to thread `ctx.capabilities`
    // would read the whole org unscoped. Fail loudly instead.
    if (options.requestPath) assertRequestScoped(options.capabilities, 'UnifiedCrudHandler')
    this.capabilities = options.capabilities
    this.fieldValueService = new FieldValueService(organizationId, userId, this.db, socketId, {
      bypassFieldGuards: this.bypassFieldGuards,
      // Forwarded since plan v3/03 §5.4. Without it this handler enforced
      // `canViewEntity` on its OWN reads while the FieldValueService it owns ran
      // unenforced — so `batchGetValues`' def/path filter and the relationship
      // REDACTION (`redactedCount`, and the `RestrictedRelationshipChip` it
      // feeds) were dead on every record read in the app. `RecordPickerService`
      // below already got them; that asymmetry was the bug.
      capabilities: this.capabilities,
    })
  }

  /**
   * Create mutation context for delegating to mutation functions
   */
  private getMutationContext(): MutationContext {
    return {
      db: this.db,
      organizationId: this.organizationId,
      userId: this.userId,
      socketId: this.socketId,
      fieldValueService: this.fieldValueService,
      resolveEntityDefinition: this.resolveEntityDefinition.bind(this),
      getFields: this.getCustomFieldsCached.bind(this),
      runPreHooks: this.runPreHooks.bind(this),
      validateUniqueFields: this.validateUniqueFields.bind(this),
      setFieldValues: this.setFieldValues.bind(this),
    }
  }

  /**
   * Pre-warm caches for bulk operations.
   * Now backed by org cache — triggers cache population if not already loaded.
   *
   * @param entityDefinitionId - Entity definition ID to cache
   */
  async warmCache(entityDefinitionId: string): Promise<void> {
    await this.resolveEntityDefinition(entityDefinitionId)
  }

  /**
   * The §5.1 per-record visibility scope for one def, memoized per handler so a
   * request that lists and then stamps pays the (cache-only) grantee resolution
   * once.
   *
   * Keyed by the CANONICAL `EntityDefinition.id` — that is the
   * `ResourceAccess.entityDefinitionId` keyspace, and passing a slug would
   * correlate the subquery against rows that do not exist, i.e. hide everything.
   */
  private async recordScope(entityDefinitionId: string): Promise<RecordVisibilityScope> {
    // System-table resources (`user`, `inbox`, `dataset`, …) have no
    // `EntityInstance` rows, so there is nothing for this predicate to correlate
    // against and they short-circuit to arm 1 — the same answer
    // `canViewEntity`'s mail-infra pass-through already gives them.
    //
    // ⚠ Arm 1 here is "the record lane has no per-row policy for this table",
    // NOT "the caller may read every row". For `thread` / `message` that
    // distinction is the whole bug: their policy is the mail lens, which lives
    // in `mail-query/` and cannot be expressed as a record-grant predicate. The
    // read entry points refuse them outright instead of relying on this answer —
    // see `listFiltered` above and `assertNotMailLensTable` in
    // `unified-handler-queries.ts`.
    if (isSystemResource(entityDefinitionId)) return { arm: 'all' }

    // ARMS 1 AND 4 COST NOTHING, and that ordering is the point (§5.1): the arm
    // is decided from the in-memory capability view on the RAW def key, so a
    // member who can see the whole def — and a member who can see none of it —
    // pays no def normalization, no org-cache read and no grantee resolution.
    // Only the two SQL-bearing arms below reach for either.
    const arm = recordScopeArmFor(this.capabilities, entityDefinitionId)
    if (arm === 'all' || arm === 'none') return { arm }

    const defId = await this.canonicalDefId(entityDefinitionId)
    const cached = this.scopeCache.get(defId)
    if (cached) return cached
    const pending = resolveRecordVisibilityScope({
      organizationId: this.organizationId,
      userId: this.userId,
      entityDefinitionId: defId,
      capabilities: this.capabilities,
    })
    this.scopeCache.set(defId, pending)
    return pending
  }

  /**
   * Any def form (slug, apiSlug, entity type, id) → the canonical
   * `EntityDefinition.id`, i.e. the `ResourceAccess.entityDefinitionId`
   * keyspace. Falls back to the input when nothing resolves, so an unknown key
   * yields a predicate that simply matches no grant rows (fail-closed) rather
   * than throwing on a read path.
   */
  private async canonicalDefId(entityDefinitionId: string): Promise<string> {
    const resource = await findCachedResource(this.organizationId, entityDefinitionId)
    return resource?.entityDefinitionId ?? resource?.id ?? entityDefinitionId
  }

  /**
   * The grantee-union `max(rung)` subquery for the current member on one def —
   * the grant half of the `_access` stamp (§5.2), resolved in the SAME query as
   * the row it describes.
   */
  private async recordAccessRank(entityDefinitionId: string) {
    const defId = await this.canonicalDefId(entityDefinitionId)
    const grantees = await resolveResourceAccessGrantees(this.organizationId, this.userId)
    return recordAccessRankSql({
      organizationId: this.organizationId,
      entityDefinitionId: defId,
      grantees,
    })
  }

  /**
   * **The PER-ROW write gate** (plan v3/03 §5.3) — every row-addressed mutation
   * on this handler goes through it, single and bulk alike.
   *
   * Replaces the old `assertEditDistinctDefs`, which asserted `assertEditEntity`
   * once per DISTINCT def. That gate made a per-record `edit` grant **inert**:
   * the member could read the row through §5.1's arm 3 and then be refused every
   * write on it by a def-level question the row is not governed by.
   *
   * The def gate still runs FIRST and short-circuits, so the ordinary
   * all-def-editable batch pays exactly what it paid before — zero I/O. Only the
   * ids the def gate refuses are stamped and re-judged. See
   * {@link assertRecordRowsEditable} for the missing-row/missing-stamp rule.
   *
   * A no-op when `capabilities` is absent (internal/system callers).
   */
  private async assertEditRows(recordIds: readonly RecordId[]): Promise<void> {
    return assertRecordRowsEditable(this.capabilities, recordIds, (ids) => this.getByIds(ids))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE RECORD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create entity instance with field values and system hooks.
   * Returns the created instance, recordId, and all processed values
   * (including auto-generated values like ticket_number).
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param values - Field values to set (map of fieldId -> value)
   * @param options - Optional CRUD options (skipEvents)
   * @returns CreateEntityResult with instance, recordId, and all field values
   */
  async create(
    entityDefinitionId: string,
    values: Record<string, unknown>,
    options: CrudOptions = {}
  ): Promise<CreateEntityResult> {
    // Write enforcement (§2): absent capabilities ⇒ internal caller ⇒ unrestricted.
    this.capabilities?.assertEditEntity(entityDefinitionId)
    await this.warmCache(entityDefinitionId)
    // The `external_id` ARRAY attribute is retired (contact/company). Its writers
    // (browser extension) still send it under `values` as an array; peel it off
    // and mirror each entry into the `RecordIdentity` index (app-less link)
    // instead of a FieldValue. Gated on Array to leave `thread`'s scalar
    // `external_id` dbColumn — a plain string — on the normal write path.
    const isRetiredArray = Array.isArray(values.external_id)
    const { external_id, ...rest } = values
    const result = await createEntity(
      this.getMutationContext(),
      entityDefinitionId,
      isRetiredArray ? rest : values,
      options
    )
    if (isRetiredArray) {
      await this.mirrorExternalIdentities(result.instance, external_id)
    }
    return result
  }

  /**
   * Mirror one or more retired-`external_id` values into `RecordIdentity` as
   * app-less links (`source=<prefix>`, no app/connection/field). Best-effort:
   * a malformed value or unique-key clash is skipped, never fails the create.
   */
  private async mirrorExternalIdentities(
    instance: EntityInstanceEntity,
    external_id: unknown
  ): Promise<void> {
    const raws = Array.isArray(external_id) ? external_id : [external_id]
    for (const raw of raws) {
      const parsed = parseExternalIdentity(raw)
      if (!parsed) continue
      const result = await upsertRecordIdentity(
        {
          organizationId: this.organizationId,
          entityInstanceId: instance.id,
          entityDefinitionId: instance.entityDefinitionId,
          source: parsed.source,
          externalId: parsed.externalId,
          appInstallationId: null,
          connectionId: null,
          appFieldKey: null,
          fieldId: null,
        },
        this.db
      )
      if (!result.ok) {
        lookupLogger.warn('Failed to mirror external_id into RecordIdentity', {
          organizationId: this.organizationId,
          entityInstanceId: instance.id,
          source: parsed.source,
        })
      }
    }
  }

  /**
   * Update entity instance field values
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param values - Field values to update (map of fieldId -> value)
   * @param options - Optional CRUD options (skipEvents)
   */
  async update(
    recordId: RecordId,
    values: Record<string, unknown>,
    modes?: Record<string, 'set' | 'add' | 'remove'>,
    options: CrudOptions = {}
  ) {
    const { entityDefinitionId } = parseRecordId(recordId)
    await this.assertEditRows([recordId])
    await this.warmCache(entityDefinitionId)
    return updateEntity(this.getMutationContext(), recordId, values, modes, options)
  }

  /**
   * Get entity instance by ID, carrying the `_access` stamp (plan v3/03 §5.2).
   *
   * On an enforced read this is ONE query: the §5.1 visibility predicate in the
   * `WHERE`, the grantee-union `max(rung)` aggregate in the projection. No cache
   * read, no post-filter, no second roundtrip.
   *
   * An unauthorized id returns `null` → the router's 404, matching the existing
   * non-enumeration behaviour: the member cannot tell "does not exist" from
   * "exists and is not mine".
   *
   * Unenforced callers (`capabilities: undefined` — workers, seeders,
   * record-rules) keep the original `getEntityInstance` path verbatim and get no
   * stamp, because `_access` is a member-relative value and there is no member.
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   */
  async getById(recordId: RecordId): Promise<(EntityInstanceEntity & { _access?: Rung }) | null> {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    const caps = this.capabilities
    if (!caps) {
      const result = await getEntityInstance({
        id: entityInstanceId,
        organizationId: this.organizationId,
      })
      return result.isOk() ? result.value : null
    }

    const scope = await this.recordScope(entityDefinitionId)
    // Arm 4 — nothing is reachable. Return without querying at all.
    if (scope.arm === 'none') return null

    const rows = await this.db
      .select({
        instance: schema.EntityInstance,
        grantRank: await this.recordAccessRank(entityDefinitionId),
      })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.id, entityInstanceId),
          eq(schema.EntityInstance.organizationId, this.organizationId),
          scope.where
        )
      )
      .limit(1)

    const row = rows[0]
    if (!row) return null
    return { ...row.instance, _access: caps.recordAccessAt(entityDefinitionId, row.grantRank) }
  }

  /**
   * Find entity by field value (e.g., find contact by email).
   * Back-compat wrapper around `lookupByField` — routes through the same
   * column-aware + normalization pipeline so callers (findOrCreate, etc.)
   * pick up EMAIL lowercasing, URL protocol normalization, etc. for free.
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param fieldSystemAttribute - System attribute like 'primary_email'
   * @param value - Value to search for
   */
  async findByField(entityDefinitionId: string, fieldSystemAttribute: string, value: unknown) {
    const { items } = await this.lookupByField({
      entityDefinitionId,
      candidates: [{ systemAttribute: fieldSystemAttribute, value }],
      limit: 1,
    })
    if (items.length === 0) return null
    return this.getById(items[0]!.recordId)
  }

  /**
   * Build a typed equality condition on the right FieldValue column for a
   * given field + raw value. Returns `null` when the value can't be
   * coerced / normalized (uncoercible inputs like `Number('foo')` leak
   * through `createTypedValueInput` as NaN and would silently match zero
   * rows — gate explicitly instead).
   */
  private buildLookupCondition(field: CustomFieldEntity, rawValue: unknown): SQL | null {
    const normalized = normalizeForLookup(field.type as FieldType, rawValue)
    if (normalized === null || normalized === undefined) return null

    const typedInput = createTypedValueInput(field.type, normalized)
    if (typedInput === null) return null

    // `createTypedValueInput` does `Number(raw)` / `new Date(raw)` without
    // validating the result — gate explicitly.
    if (typedInput.type === 'number' && !Number.isFinite(typedInput.value)) return null
    if (typedInput.type === 'date' && Number.isNaN(new Date(typedInput.value).getTime())) {
      return null
    }

    const { column, value } = typedColumnMatch(typedInput)
    return eq(schema.FieldValue[column] as AnyColumn, value as string | number | boolean)
  }

  /**
   * Lookup record IDs by one or more `(systemAttribute, value)` candidates,
   * tried in priority order. Column-aware (routes through `typedColumnMatch`)
   * and value-normalizing (mirrors write-path formatting). Deduplicates hits
   * across candidates by recordId; the earliest-priority candidate wins
   * attribution.
   *
   * Candidate failure handling: a candidate whose field doesn't exist OR
   * whose value can't be coerced / normalized is **skipped with a warning
   * log**, not thrown. Only throws `BadRequestError` when ALL candidates
   * fail — otherwise one garbage input would take down a best-effort
   * fallback chain (e.g. externalId → email).
   *
   * Does not filter on archived records: re-capture of an archived contact
   * should link to the same row rather than create a duplicate. Callers
   * needing only-active records should post-filter via `record.getById`.
   *
   * Does not filter on `capabilities.hidden`: the extension is a system
   * integration and is allowed to address hidden fields (externalId).
   */
  async lookupByField(params: {
    entityDefinitionId: string
    candidates: LookupCandidate[]
    limit: number
  }): Promise<LookupByFieldResult> {
    // Read enforcement (§5.1): arm 4 yields no matches without a query; the two
    // middle arms narrow both lookup queries below (both inner-join
    // EntityInstance, so the predicate correlates directly).
    const lookupScope = await this.recordScope(params.entityDefinitionId)
    if (lookupScope.arm === 'none') return { items: [], hasMore: false }
    const entityDef = await this.resolveEntityDefinition(params.entityDefinitionId)
    const seen = new Set<RecordId>()
    const items: LookupMatch[] = []
    let hasMore = false
    let anyValid = false
    const skipped: Array<{ candidate: LookupCandidate; reason: string }> = []

    // `{ fieldId }` candidates resolve through the same `customFields` cache
    // `getFieldBySystemAttribute` reads — fetched once here, not per candidate.
    // Keyed by `CustomField.id` (every DB-backed field, incl. system fields whose
    // ResourceFieldId carries the UUID); a systemAttribute fallback covers the
    // pure-static-field edge so a `{ fieldId }` candidate never silently misses.
    const hasFieldIdCandidate = params.candidates.some((c) => 'fieldId' in c)
    const fieldMap = hasFieldIdCandidate
      ? await getCachedFieldMap(this.organizationId, entityDef.id)
      : null
    const resolveByFieldId = (fieldId: FieldId): CustomFieldEntity | null => {
      const byId = fieldMap!.get(fieldId)
      if (byId) return byId
      for (const f of fieldMap!.values()) if (f.systemAttribute === fieldId) return f
      return null
    }

    for (const candidate of params.candidates) {
      if (items.length >= params.limit) break

      // `external_id` is retired as a FieldValue attribute — resolve it against
      // the `RecordIdentity` index instead (app-less link, source-scoped).
      if ('systemAttribute' in candidate && candidate.systemAttribute === 'external_id') {
        const parsed = parseExternalIdentity(candidate.value)
        if (!parsed) {
          skipped.push({ candidate, reason: 'unparseable external_id' })
          continue
        }
        anyValid = true
        const remaining = params.limit - items.length
        const rows = await this.db
          .select({
            entityId: schema.RecordIdentity.entityInstanceId,
            displayName: schema.EntityInstance.displayName,
            secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
            avatarUrl: schema.EntityInstance.avatarUrl,
          })
          .from(schema.RecordIdentity)
          .innerJoin(
            schema.EntityInstance,
            eq(schema.EntityInstance.id, schema.RecordIdentity.entityInstanceId)
          )
          .where(
            and(
              eq(schema.RecordIdentity.organizationId, this.organizationId),
              eq(schema.RecordIdentity.entityDefinitionId, entityDef.id),
              eq(schema.RecordIdentity.source, parsed.source),
              eq(schema.RecordIdentity.externalId, parsed.externalId),
              lookupScope.where
            )
          )
          .limit(remaining + 1)
        for (const row of rows) {
          const recordId = toRecordId(entityDef.id, row.entityId)
          if (seen.has(recordId)) continue
          if (items.length >= params.limit) {
            hasMore = true
            break
          }
          seen.add(recordId)
          items.push({
            recordId,
            matchedBy: { systemAttribute: candidate.systemAttribute, value: candidate.value },
            displayName: row.displayName,
            secondaryDisplayValue: row.secondaryDisplayValue,
            avatarUrl: row.avatarUrl,
          })
        }
        continue
      }

      const field =
        'fieldId' in candidate
          ? resolveByFieldId(candidate.fieldId)
          : await this.getFieldBySystemAttribute(entityDef.id, candidate.systemAttribute)
      if (!field) {
        skipped.push({ candidate, reason: 'field not found' })
        continue
      }

      const condition = this.buildLookupCondition(field, candidate.value)
      if (condition === null) {
        skipped.push({ candidate, reason: 'uncoercible value' })
        continue
      }
      anyValid = true

      // Fetch `remaining + 1` to detect hasMore. DISTINCT ON collapses
      // duplicate FieldValue rows on the same entity (e.g. belt-and-braces
      // against two rows with the same externalId after mode:'add' dedup).
      // Inner-join EntityInstance so each match carries the denormalized
      // displayName / secondaryDisplayValue / avatarUrl columns that the
      // FieldValueService write path keeps in sync.
      const remaining = params.limit - items.length
      const rows = await this.db
        .selectDistinctOn([schema.FieldValue.entityId], {
          entityId: schema.FieldValue.entityId,
          displayName: schema.EntityInstance.displayName,
          secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
          avatarUrl: schema.EntityInstance.avatarUrl,
        })
        .from(schema.FieldValue)
        .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
        .where(
          and(
            eq(schema.FieldValue.fieldId, field.id),
            eq(schema.FieldValue.organizationId, this.organizationId),
            condition,
            lookupScope.where
          )
        )
        .limit(remaining + 1)

      for (const row of rows) {
        const recordId = toRecordId(entityDef.id, row.entityId)
        if (seen.has(recordId)) continue
        if (items.length >= params.limit) {
          hasMore = true
          break
        }
        seen.add(recordId)
        items.push({
          recordId,
          matchedBy:
            'fieldId' in candidate
              ? { fieldId: candidate.fieldId, value: candidate.value }
              : { systemAttribute: candidate.systemAttribute, value: candidate.value },
          displayName: row.displayName,
          secondaryDisplayValue: row.secondaryDisplayValue,
          avatarUrl: row.avatarUrl,
        })
      }
    }

    if (!anyValid && params.candidates.length > 0) {
      throw new BadRequestError(
        `lookupByField: no candidate was valid. Skipped: ${JSON.stringify(skipped)}`
      )
    }
    if (skipped.length > 0) {
      lookupLogger.warn('lookupByField: skipped candidates', {
        entityDef: entityDef.id,
        skipped,
      })
    }

    return { items, hasMore }
  }

  /**
   * Find or create entity
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param findBy - Fields to search by (e.g., { primary_email: 'test@example.com' })
   * @param createValues - Additional values to set if creating
   */
  async findOrCreate(
    entityDefinitionId: string,
    findBy: Record<string, unknown>,
    createValues: Record<string, unknown> = {}
  ): Promise<{ instance: EntityInstanceEntity; created: boolean }> {
    // Try to find by the findBy fields first
    const [fieldKey, fieldValue] = Object.entries(findBy)[0]!
    const existing = await this.findByField(entityDefinitionId, fieldKey, fieldValue)

    if (existing) {
      return { instance: existing, created: false }
    }

    const result = await this.create(entityDefinitionId, { ...findBy, ...createValues })
    return { instance: result.instance, created: true }
  }

  /**
   * Archive entity instance (soft delete)
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param options - Optional CRUD options (skipEvents)
   */
  async archive(recordId: RecordId, options: CrudOptions = {}) {
    const { entityDefinitionId } = parseRecordId(recordId)
    // Soft delete is an edit (§0.1) — judged at the row, not the def (§5.3).
    await this.assertEditRows([recordId])
    await this.warmCache(entityDefinitionId)
    return archiveEntity(this.getMutationContext(), recordId, options)
  }

  /**
   * Restore archived entity instance
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param options - Optional CRUD options (skipEvents)
   */
  async restore(recordId: RecordId, options: CrudOptions = {}) {
    const { entityDefinitionId } = parseRecordId(recordId)
    await this.assertEditRows([recordId])
    await this.warmCache(entityDefinitionId)
    return restoreEntity(this.getMutationContext(), recordId, options)
  }

  /**
   * Permanently delete entity instance
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param options - Optional CRUD options (skipEvents)
   */
  async delete(recordId: RecordId, options: CrudOptions = {}): Promise<void> {
    const { entityDefinitionId } = parseRecordId(recordId)
    // Record delete is a write (§0.1); the router additionally asserts the
    // per-row DELETE rule (`assertCanDeleteRows`) before it gets here. The edit
    // floor must be read at the ROW too, or a row the router's stamp just
    // cleared for deletion would be refused here by the def gate.
    await this.assertEditRows([recordId])
    await this.warmCache(entityDefinitionId)
    return deleteEntity(this.getMutationContext(), recordId, options)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BULK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Bulk create entities
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param items - Array of field value maps to create
   * @param options - Optional CRUD options (skipEvents)
   */
  async bulkCreate(
    entityDefinitionId: string,
    items: Record<string, unknown>[],
    options: CrudOptions = {}
  ): Promise<{ created: EntityInstanceEntity[]; errors: Array<{ index: number; error: string }> }> {
    if (items.length === 0) return { created: [], errors: [] }
    this.capabilities?.assertEditEntity(entityDefinitionId)
    await this.warmCache(entityDefinitionId)
    return bulkCreateEntities(this.getMutationContext(), entityDefinitionId, items, options)
  }

  /**
   * Bulk update entities
   *
   * @param updates - Array of { recordId, values } to update
   * @param options - Optional CRUD options (skipEvents)
   */
  async bulkUpdate(
    updates: Array<{ recordId: RecordId; values: Record<string, unknown> }>,
    options: CrudOptions = {}
  ): Promise<{ updated: number; errors: Array<{ recordId: RecordId; error: string }> }> {
    if (updates.length === 0) return { updated: 0, errors: [] }
    await this.assertEditRows(updates.map((u) => u.recordId))
    const { entityDefinitionId } = parseRecordId(updates[0]!.recordId)
    await this.warmCache(entityDefinitionId)
    return bulkUpdateEntities(this.getMutationContext(), updates, options)
  }

  /**
   * Bulk archive entities (soft delete)
   *
   * @param recordIds - Array of RecordIds to archive
   * @param options - Optional CRUD options (skipEvents)
   */
  async bulkArchive(recordIds: RecordId[], options: CrudOptions = {}): Promise<{ count: number }> {
    if (recordIds.length === 0) return { count: 0 }
    await this.assertEditRows(recordIds)
    const { entityDefinitionId } = parseRecordId(recordIds[0]!)
    await this.warmCache(entityDefinitionId)
    return bulkArchiveEntities(this.getMutationContext(), recordIds, options)
  }

  /**
   * Bulk delete entities (hard delete)
   *
   * @param recordIds - Array of RecordIds to delete
   * @param options - Optional CRUD options (skipEvents)
   */
  async bulkDelete(
    recordIds: RecordId[],
    options: CrudOptions = {}
  ): Promise<{ count: number; errors: Array<{ recordId: RecordId; message: string }> }> {
    if (recordIds.length === 0) return { count: 0, errors: [] }
    await this.assertEditRows(recordIds)
    const { entityDefinitionId } = parseRecordId(recordIds[0]!)
    await this.warmCache(entityDefinitionId)
    return bulkDeleteEntities(this.getMutationContext(), recordIds, options)
  }

  /**
   * Bulk set field value across multiple entities
   *
   * @param recordIds - Array of RecordIds to update
   * @param fieldId - Field ID to set
   * @param value - Value to set
   */
  async bulkSetFieldValue(
    recordIds: RecordId[],
    fieldId: string,
    value: unknown
  ): Promise<{ count: number }> {
    if (recordIds.length === 0) return { count: 0 }
    await this.assertEditRows(recordIds)
    return bulkSetFieldValue(this.getMutationContext(), recordIds, fieldId, value)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List entities with pagination
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param options - List options (filters, sorting, pagination)
   */
  async list(
    entityDefinitionId: string,
    options?: {
      includeArchived?: boolean
      limit?: number
      cursor?: string
    }
  ): Promise<{ items: EntityInstanceEntity[]; nextCursor?: string }> {
    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    const result = await listEntityInstances({
      organizationId: this.organizationId,
      entityDefinitionId: entityDef.id,
      includeArchived: options?.includeArchived,
      limit: options?.limit,
      cursor: options?.cursor,
    })

    return unwrapResult(result)
  }

  /**
   * Resolve entityDefinitionId or apiSlug to actual entityDefinitionId UUID.
   * Delegates to standalone function for reusability.
   *
   * @param params - Must provide either entityDefinitionId or apiSlug
   */
  async resolveEntityId(params: {
    entityDefinitionId?: string
    apiSlug?: string
  }): Promise<string> {
    return resolveEntityIdFromCache(this.organizationId, params)
  }

  /**
   * List all entities with field values for small datasets (no pagination).
   * Suitable for tags, inboxes, and other small entity collections.
   * Delegates to standalone function.
   *
   * @param params - List all parameters (entityDefinitionId or apiSlug required)
   */
  async listAll(params: ListAllInput): Promise<ListAllResult> {
    // Read enforcement (§5.1): arm 4 yields an empty list without a query; the
    // two middle arms narrow the `findMany` in `listAllQuery`.
    const defKey = params.entityDefinitionId ?? params.apiSlug
    const scope = defKey ? await this.recordScope(defKey) : { arm: 'all' as const }
    if (scope.arm === 'none') {
      return { items: [], entityDefinitionId: params.entityDefinitionId ?? '', fields: {} }
    }
    return listAllQuery(
      {
        db: this.db,
        organizationId: this.organizationId,
        userId: this.userId,
        capabilities: this.capabilities,
        visibilityWhere: scope.where,
      },
      params
    )
  }

  /**
   * List record IDs with server-side filtering, paged straight from SQL.
   *
   * One page = one `SELECT id ... LIMIT n + 1 OFFSET m`; `hasMore` is the probe row.
   * `COUNT(*)` runs on the first page only (or when `includeTotal` is forced), so an
   * infinite scroll doesn't pay a count per tick — see plan v3/02 §2.2.
   *
   * **This lane fails open on a filter it cannot compile** — the condition is
   * dropped and the query runs wider — because saved views, the mail list, unread
   * counts and the workflow Find node all depend on `baseScope` for the genuine
   * empty-filter case. That is deliberate, but it used to be *invisible*. Both
   * branches below now return {@link ListFilteredResult.droppedConditions}, so a
   * caller can say "1 filter was ignored" instead of quietly showing more rows.
   * Ignoring the field leaves behaviour byte-identical.
   *
   * @param params - Filter parameters
   */
  async listFiltered(params: {
    entityDefinitionId: string
    filters?: ConditionGroup[]
    /**
     * Free-text search — a separate axis from `filters` (plan decision 0.3):
     * conditions narrow, the typed text IS the search. Ranked and typo-tolerant
     * on the EntityInstance path.
     *
     * **On the system-resource path it is honoured only for tables that have a
     * ranked binding** in `resources/search/system-search-bindings.ts` — today
     * `article`, and nothing else. For every other `TableId` (`user`, `inbox`,
     * `dataset`, …) it is silently ignored: the filters still apply and the
     * ordering is unchanged, so a table can be adopted by adding a corpus
     * column, two GIN indexes and one registry entry, without a flag day.
     *
     * `thread` / `message` are excluded on purpose rather than pending — mail
     * content is governed by the member lens and is blocked from this path
     * entirely (`resources/picker/mail-lens-tables.ts`); it binds the same
     * builder under its own scopes in `mail-query/thread-search-sql.ts`.
     */
    search?: string
    sorting?: Array<{ id: string; desc: boolean }>
    limit?: number
    /** Pagination offset. `cursor.offset` wins when both are given. */
    offset?: number
    cursor?: { offset: number }
    /** Force the `COUNT(*)`. Defaults to `offset === 0`. */
    includeTotal?: boolean
  }): Promise<ListFilteredResult> {
    const { entityDefinitionId, sorting = [], limit = 100, cursor } = params

    // 🔴 Step 0.1 — the mail-content tables are refused BEFORE anything else on
    // this path. `recordScope` answers `{ arm: 'all' }` for every system table
    // and `querySystemResourceIdsPaged` scopes on `organizationId` alone, so a
    // `thread` list here returned every thread id in the org — and a `total`
    // counting the whole org's mailbox — to anyone who could reach the caller
    // (a dashboard `recordList` widget with `source: {kind:'system',
    // tableId:'thread'}` is exactly that). The lens lives in `mail-query/` and
    // nowhere else, so this lane refuses rather than growing a second copy of
    // it; `assertNotMailLensTable` carries the full reasoning.
    if (isMailLensTableId(entityDefinitionId)) throw new ForbiddenError(MAIL_LENS_REFUSAL)

    // Read enforcement (§5.1). Arm 4 returns an empty page WITHOUT querying;
    // arms 2/3 join their predicate into `baseWhere`, which the page query and
    // the `COUNT(*)` share — so `total` describes the visible set.
    //
    // Other system resources (`user`, `inbox`, `dataset`, …) are not
    // EntityInstance-backed, so the record scope does not apply to them; that
    // branch is taken below, before `visibilityWhere` is used.
    const scope = await this.recordScope(entityDefinitionId)
    if (scope.arm === 'none') {
      return { ids: [], total: 0, hasMore: false }
    }

    // Resolve valueSource placeholders (e.g. currentUser) into the filters before
    // they reach the WHERE clause.
    const filters = resolveConditionContext(params.filters ?? [], {
      currentUserId: this.userId,
    })

    const offset = Math.max(cursor?.offset ?? params.offset ?? 0, 0)
    const includeTotal = params.includeTotal ?? offset === 0

    if (isSystemResource(entityDefinitionId)) {
      return querySystemResourceIdsPaged({
        db: this.db,
        tableId: entityDefinitionId as TableId,
        organizationId: this.organizationId,
        filters: filters as ConditionGroup[],
        search: params.search,
        sorting,
        limit,
        offset,
        includeTotal,
      })
    }

    return queryEntityInstanceIdsPaged({
      db: this.db,
      entityDefinitionId: isEntityDefinitionType(entityDefinitionId)
        ? (await this.resolveEntityDefinition(entityDefinitionId)).id
        : entityDefinitionId,
      organizationId: this.organizationId,
      filters: filters as ConditionGroup[],
      search: params.search,
      sorting,
      limit,
      offset,
      includeTotal,
      visibilityWhere: scope.where,
    })
  }

  /**
   * Get multiple records by RecordIds (batch)
   *
   * @param recordIds - Array of RecordIds to fetch
   */
  async getByIds(recordIds: RecordId[]): Promise<Record<RecordId, RecordPickerItem>> {
    if (recordIds.length === 0) return {}

    const service = new RecordPickerService(
      this.organizationId,
      this.userId,
      this.db,
      this.capabilities
    )
    return service.getResourcesByIds(recordIds)
  }

  /**
   * Search records with optional global search support.
   * Handles resolution of apiSlug and system entity names to actual entityDefinitionIds.
   *
   * @param params - Search parameters
   */
  async search(params: {
    query?: string
    apiSlug?: string
    entityDefinitionId?: string
    entityDefinitionIds?: string[]
    limit?: number
    cursor?: string
  }) {
    const { query, apiSlug, limit, cursor, entityDefinitionIds } = params
    let { entityDefinitionId } = params

    // Resolve apiSlug or entityDefinitionId to actual UUID via cache
    const key = apiSlug ?? entityDefinitionId
    if (key && !entityDefinitionId) {
      const resource = await findCachedResource(this.organizationId, key)
      entityDefinitionId = resource?.entityDefinitionId ?? resource?.id
    } else if (entityDefinitionId) {
      const resource = await findCachedResource(this.organizationId, entityDefinitionId)
      entityDefinitionId = resource?.entityDefinitionId ?? resource?.id ?? entityDefinitionId
    }

    // Also resolve entityDefinitionIds if provided
    let resolvedEntityDefinitionIds = entityDefinitionIds
    if (entityDefinitionIds && entityDefinitionIds.length > 0) {
      resolvedEntityDefinitionIds = await Promise.all(
        entityDefinitionIds.map(async (id) => {
          const resource = await findCachedResource(this.organizationId, id)
          return resource?.entityDefinitionId ?? resource?.id ?? id
        })
      )
    }

    // Read enforcement (§2.2): a scoped def the member can't view yields nothing.
    if (
      this.capabilities &&
      entityDefinitionId &&
      !this.capabilities.canViewEntity(entityDefinitionId)
    ) {
      return {
        items: [],
        nextCursor: null,
        hasMore: false,
        processingTimeMs: 0,
        query: query ?? '',
      }
    }

    const service = new RecordPickerService(
      this.organizationId,
      this.userId,
      this.db,
      this.capabilities
    )

    // System table types (thread, message, etc.) don't have EntityInstance rows.
    // Route to getResources() which queries the actual table via RESOURCE_TABLE_MAP.
    if (entityDefinitionId && isSystemResourceId(entityDefinitionId)) {
      const result = await service.getResources({
        entityDefinitionId,
        limit: limit ?? 25,
        cursor,
        search: query,
      })
      return {
        ...result,
        hasMore: !!result.nextCursor,
        processingTimeMs: 0,
        query: query ?? '',
      }
    }

    return service.search({
      query: query ?? '',
      entityDefinitionId,
      entityDefinitionIds: resolvedEntityDefinitionIds,
      limit,
      cursor,
    })
  }

  /**
   * Invalidate cache for a resource type or specific record
   *
   * @param entityDefinitionId - Resource type to invalidate
   * @param id - Optional specific record ID
   */
  async invalidateCache(entityDefinitionId: string, id?: string): Promise<void> {
    const service = new RecordPickerService(this.organizationId, this.userId, this.db)

    if (id) {
      await service.invalidateCacheById(entityDefinitionId, id)
    } else {
      await service.invalidateCacheByTable(entityDefinitionId)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MERGE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Merge multiple entity instances into a single target
   * Delegates to EntityMergeService for actual merge logic
   *
   * @param targetRecordId - RecordId of the target instance
   * @param sourceRecordIds - RecordIds of instances to merge into target
   */
  async merge(targetRecordId: RecordId, sourceRecordIds: RecordId[]) {
    // Merge writes the survivor and removes the sources — the edit floor is
    // asserted per ROW (§5.3) on the target and every source; the router's
    // `assertCanDeleteRows` carries the destruction half.
    await this.assertEditRows([targetRecordId, ...sourceRecordIds])
    return mergeEntities(this.getMutationContext(), targetRecordId, sourceRecordIds)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKFLOW-COMPATIBLE WRAPPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create entity instance with field values (workflow-compatible)
   * Wraps create() to match EntityInstanceService.createWithValues() signature
   *
   * @param entityDefinitionId - Entity definition ID
   * @param values - Field values (fieldId -> value)
   */
  async createWithValues(entityDefinitionId: string, values: Record<string, unknown>) {
    this.capabilities?.assertEditEntity(entityDefinitionId)
    await this.warmCache(entityDefinitionId)
    return createWithValuesImpl(this.getMutationContext(), entityDefinitionId, values)
  }

  /**
   * Update entity instance field values (workflow-compatible)
   * Wraps update() to match EntityInstanceService.updateValues() signature
   *
   * @param instanceId - Entity instance ID (not RecordId)
   * @param values - Field values to update (fieldId -> value)
   */
  async updateValues(instanceId: string, values: Record<string, unknown>) {
    // Only the instanceId is known here, so resolve its def to enforce — but
    // solely when a request-scoped CapabilityView is present (internal callers
    // skip the extra lookup entirely).
    if (this.capabilities) {
      const instance = await getEntityInstance({
        id: instanceId,
        organizationId: this.organizationId,
      })
      // Per row (§5.3), not per def — the RecordId is reconstructible once the
      // def is known, so this lane gets the same gate as `update`.
      if (instance.isOk()) {
        await this.assertEditRows([toRecordId(instance.value.entityDefinitionId, instanceId)])
      }
    }
    return updateValuesImpl(this.getMutationContext(), instanceId, values)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIELD VALUE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set single field value
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param fieldId - Field ID to set
   * @param value - Value to set
   */
  async setFieldValue(recordId: RecordId, fieldId: string, value: unknown): Promise<void> {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    // Use FieldValueService with RecordId (no modelType needed)
    await this.fieldValueService.setValueWithBuiltIn({
      recordId,
      fieldId,
      value,
    })

    await this.publishEvent('updated', entityDef, entityInstanceId, { [fieldId]: value })
  }

  /**
   * Get field values for entity
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param fieldIds - Optional array of field IDs to fetch
   */
  async getFieldValues(recordId: RecordId, fieldIds?: string[]) {
    // Use FieldValueService with RecordId
    return this.fieldValueService.getValues({ recordId, fieldIds })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve entity definition by ID, entityType, or apiSlug.
   * Reads from the org `resources` cache — no DB fetch. Cache is invalidated
   * by the `entity-def.*` events in the invalidation graph.
   *
   * @param entityDefinitionId - 'contact', 'ticket', 'tag', apiSlug, or UUID
   * @returns Narrow `{ id, entityType, apiSlug }` — the only fields mutations and hooks consume
   */
  async resolveEntityDefinition(entityDefinitionId: string): Promise<ResolvedEntityDefinition> {
    const resource = await findCachedResource(this.organizationId, entityDefinitionId)
    if (!resource) {
      throw new Error(`Entity definition not found: ${entityDefinitionId}`)
    }
    return {
      id: resource.entityDefinitionId ?? resource.id,
      entityType: resource.entityType ?? null,
      apiSlug: resource.apiSlug,
    }
  }

  /**
   * Get custom fields for an entity definition from org cache
   *
   * @param entityDefinitionId - Entity definition UUID
   */
  private async getCustomFieldsCached(entityDefinitionId: string) {
    return getCachedCustomFields(this.organizationId, entityDefinitionId)
  }

  /**
   * Set field values for an entity using RecordId.
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param values - Map of fieldId -> value
   * @param modes - Optional per-field write mode. Fields not listed default
   *   to `'set'`. `'add'` / `'remove'` route to the multi-value primitives;
   *   they throw `BadRequestError` on single-value fields.
   */
  private async setFieldValues(
    recordId: RecordId,
    values: Record<string, unknown>,
    modes?: Record<string, 'set' | 'add' | 'remove'>,
    opts?: { publishEvents?: boolean }
  ): Promise<void> {
    const { entityDefinitionId } = parseRecordId(recordId)

    // Get cached fields and build key → id map for all entity types
    // Uses systemAttribute (e.g., 'title', 'tag_parent') as key, falls back to name for custom fields
    const fields = await this.getCustomFieldsCached(entityDefinitionId)
    const keyToIdMap = new Map(fields.map((f) => [f.systemAttribute ?? f.name, f.id]))

    // Resolve each entry to (fieldId, value, mode) so we can bucket below.
    // Any key that doesn't match a known systemAttribute/name is passed
    // through as-is — callers sometimes address fields by UUID directly.
    type Entry = { key: string; fieldId: string; value: unknown; mode: 'set' | 'add' | 'remove' }
    const entries: Entry[] = []
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue
      const fieldId = keyToIdMap.get(key) ?? key
      // modes map is keyed the same way the caller keyed `values` — accept
      // either systemAttribute or UUID. Prefer an explicit UUID match so
      // callers mixing keys in one call still work.
      const mode = modes?.[key] ?? modes?.[fieldId] ?? 'set'
      entries.push({ key, fieldId, value, mode })
    }

    const setEntries = entries.filter((e) => e.mode === 'set')
    const addEntries = entries.filter((e) => e.mode === 'add')
    const removeEntries = entries.filter((e) => e.mode === 'remove')

    // Bulk writes (connector sync, importer, seeder) pass publishEvents:false
    // so this whole path stays silent — no fieldValues:updated realtime and no
    // per-record field triggers. Default true preserves interactive-edit behavior.
    const publishEvents = opts?.publishEvents ?? true

    if (setEntries.length > 0) {
      await this.fieldValueService.setValuesForEntity({
        recordId,
        values: setEntries.map((e) => ({ fieldId: e.fieldId, value: e.value })),
        publishEvents,
      })
    }

    for (const e of addEntries) {
      await this.fieldValueService.addValues({
        recordId,
        fieldId: e.fieldId,
        values: Array.isArray(e.value) ? e.value : [e.value],
        skipPublishEvents: !publishEvents,
      })
    }

    for (const e of removeEntries) {
      await this.fieldValueService.removeValues({
        recordId,
        fieldId: e.fieldId,
        values: Array.isArray(e.value) ? e.value : [e.value],
        skipPublishEvents: !publishEvents,
      })
    }
  }

  /**
   * Emit an `entity:*` bus event for a single-field write.
   *
   * The payload has to match `EntityInstance*Event['data']` exactly: every downstream handler
   * (`createTimelineEvent`, `triggerResourceDispatch`, `handleRecordRules`) keys off `recordId`
   * and reads the changed values out of `eventData`.
   */
  private async publishEvent(
    action: 'created' | 'updated' | 'deleted',
    entityDef: ResolvedEntityDefinition,
    instanceId: string,
    values: Record<string, unknown>
  ): Promise<void> {
    publisher.publishLater({
      type: `entity:${action}`,
      data: {
        recordId: toRecordId(entityDef.id, instanceId),
        entityDefinitionId: entityDef.id,
        entitySlug: entityDef.apiSlug,
        organizationId: this.organizationId,
        userId: this.userId,
        eventData: values,
      },
    })
  }

  private async runPreHooks(
    operation: 'create' | 'update',
    entityDef: ResolvedEntityDefinition,
    values: Record<string, unknown>,
    existingInstance?: EntityInstanceEntity
  ): Promise<Record<string, unknown>> {
    // Get entity-specific hooks and common hooks (run for ALL entities)
    const entityHooks = getSystemHooks(entityDef.entityType)
    const commonHooks = getCommonHooks()

    // Merge hooks: common hooks first, then entity-specific hooks
    // Entity-specific hooks can override common behavior if needed
    const mergedHooks: Record<string, (typeof entityHooks)[string]> = { ...commonHooks }
    for (const [attr, fns] of Object.entries(entityHooks)) {
      mergedHooks[attr] = [...(mergedHooks[attr] ?? []), ...fns]
    }

    let processedValues = { ...values }

    // Get all fields for the entity (needed for looking up related fields in hooks)
    const allFields = await this.getCustomFieldsCached(entityDef.id)

    for (const [systemAttribute, hookFns] of Object.entries(mergedHooks)) {
      // Find field with this systemAttribute
      const field = await this.getFieldBySystemAttribute(entityDef.id, systemAttribute)
      if (!field) continue

      // For create operations, always run hooks (allows auto-generation like ticket_number)
      // For update operations, only run hooks if the field is being updated. Values may be
      // keyed by fieldId OR systemAttribute (setFieldValues resolves both) — check both, or a
      // systemAttribute-keyed update would silently bypass update hooks (e.g. status guards).
      if (
        operation === 'update' &&
        !(field.id in processedValues) &&
        !(systemAttribute in processedValues)
      )
        continue

      for (const hook of hookFns) {
        processedValues = await hook({
          operation,
          entityDef,
          field,
          values: processedValues,
          existingInstance,
          organizationId: this.organizationId,
          userId: this.userId,
          allFields,
        })
      }
    }

    return processedValues
  }

  private async validateUniqueFields(
    entityDefinitionId: string,
    values: Record<string, unknown>,
    excludeEntityId?: string
  ): Promise<void> {
    const fields = await this.getCustomFieldsCached(entityDefinitionId)
    const uniqueFields = fields.filter((f) => f.isUnique)

    for (const field of uniqueFields) {
      const value = values[field.id]
      if (value === undefined || value === null || value === '') continue

      const result = await checkUniqueValue({
        fieldId: field.id,
        value,
        organizationId: this.organizationId,
        modelType: ModelTypes.ENTITY,
        entityDefinitionId,
        excludeEntityId,
      })

      if (result.isErr()) {
        throw new Error(`${field.name} must be unique: value already exists`)
      }
    }
  }

  private async getFieldBySystemAttribute(entityDefinitionId: string, systemAttribute: string) {
    const fields = await this.getCustomFieldsCached(entityDefinitionId)
    return fields.find((f) => f.systemAttribute === systemAttribute) ?? null
  }
}
