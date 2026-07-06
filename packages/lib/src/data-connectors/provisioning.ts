// packages/lib/src/data-connectors/provisioning.ts
// Field provisioning for connector mappings driven by `FieldMapping.provision` hints
// (the generic-rest template path — e.g. stripe). Reuses the app-field surface:
// connector-managed fields are created through the same idempotent `createCustomField`
// call app fields use (appInstallationId + appFieldKey + capability flags), then
// stamped with `dataConnectorId` so the provisioned schema is attributable + idempotent
// per (dataConnectorId, appFieldKey). NEVER creates a def — the target def must already
// exist (system def for contributing templates; app-owned defs are installed via the
// entity-template flow, v6).
//
// Functional (Drizzle + neverthrow underneath the service calls); no model classes.

import { type Database, schema } from '@auxx/database'
import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { createCustomField } from '@auxx/services/custom-fields'
import type { SelectOption } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { and, eq } from 'drizzle-orm'
import { getCachedCustomFields } from '../cache'
import { onCacheEvent } from '../cache/invalidate'
import { notifyEntityDefChanged } from '../entity-definitions/notify'
import { NotFoundError } from '../errors'
import { type DecodedMapping, decodeMapping, listStreams } from './service'
import type { FieldMapping } from './types'

const logger = createScopedLogger('data-connector-provisioning')

/** A field the connector wants provisioned on the target def. */
export interface ProvisionFieldSpec {
  /** App-stable key for idempotent provisioning (e.g. 'total_price'). */
  appFieldKey: string
  /** Display name. */
  name: string
  type: FieldType
  icon?: string
  /** Owned-mode connector-managed fields are user-read-only (02 §4). */
  isUpdatable?: boolean
  isCreatable?: boolean
  /** External-id / raw-payload bookkeeping fields are hidden from the grid. */
  isHidden?: boolean
  /**
   * Marks an owned external-id field as an identity cell (from the mapping's
   * `identityRole: externalId`). Stamped onto `CustomField.isIdentity` so the
   * `reconcileRecordIdentities` backstop rebuilds its `RecordIdentity` mirror —
   * without it, an owned identity relies solely on the sink, which never re-runs
   * for a content-hash-unchanged record (see the reconcile design note).
   */
  isIdentity?: boolean
  /** Predefined select options (SINGLE_SELECT / MULTI_SELECT / TAGS). */
  options?: Array<{ value: string; label?: string; color?: string }>
  /** Sub-field set for an ADDRESS_STRUCT field. */
  addressComponents?: string[]
}

/** One contributing target the connector provisions `provision`-hint fields onto. */
export interface ProvisionTarget {
  /** Per-mapping write behavior flag (owned archives-on-orphan); never authors a def. */
  targetMode: 'owned' | 'contributing'
  /** The existing def to provision onto — required (this never creates a def). */
  entityDefinitionId: string | null
  /**
   * The connector's app slug (`app:<slug>` → `<slug>`), stamped onto every
   * provisioned `CustomField.appSlug`. The identity sink-mirror reads it as the
   * `RecordIdentity.source`, so an owned external-id field can't mirror without
   * it. Null for builtin/generic-rest connectors (no app origin).
   */
  appSlug?: string | null
  fields: ProvisionFieldSpec[]
}

export interface ProvisionResult {
  entityDefinitionId: string
  provisionedFieldKeys: string[]
  /**
   * `appFieldKey` → concrete `CustomField` id for every resolved field (created
   * OR pre-existing). Lets the caller build concrete `targetFieldRef`s without a
   * follow-up query — used by the app-catalog owned materializer (step-11 gap 2).
   */
  fieldIdByKey: Record<string, string>
}

/**
 * Provision `provision`-hint fields onto an EXISTING target def. Idempotent: re-running
 * reconciles additively (keyed by `(dataConnectorId, appFieldKey)`), never overwriting a
 * field a user remapped. Never creates a def — the target def must already exist (owned
 * app defs are installed via the entity-template flow, v6). Returns the def id + the
 * field keys it created.
 */
export async function provisionTarget(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  target: ProvisionTarget
): Promise<ProvisionResult> {
  const defId = target.entityDefinitionId
  if (!defId) {
    throw new NotFoundError(
      'provisionTarget requires an existing entityDefinitionId — connector provisioning never authors a def'
    )
  }

  // ── Provision each mapped field idempotently ─────────────────────────────────
  // ONE cache read per target (not per field) — safe because `appFieldKey`s are
  // distinct within a target, so a field created mid-loop can never be the lookup
  // target of a later iteration.
  const cachedFields = await getCachedCustomFields(organizationId, defId)
  const existingByKey = new Map<string, CustomFieldEntity>()
  for (const f of cachedFields) {
    if (f.appFieldKey) existingByKey.set(f.appFieldKey, f)
  }

  const provisionedFieldKeys: string[] = []
  const fieldIdByKey: Record<string, string> = {}
  let adoptedCount = 0
  for (const field of target.fields) {
    const result = await provisionField(
      db,
      organizationId,
      dataConnectorId,
      defId,
      field,
      target.appSlug ?? null,
      existingByKey
    )
    if (!result) continue
    fieldIdByKey[field.appFieldKey] = result.id
    if (result.created) provisionedFieldKeys.push(field.appFieldKey)
    if (result.adopted) adoptedCount++
  }

  if (provisionedFieldKeys.length > 0) {
    await onCacheEvent('custom-field.created', { orgId: organizationId })
  }

  // Fire ONCE per provision — one cache recompute + one coarse `resource:*` realtime
  // nudge so open clients refetch the resource list — and ONLY when something actually
  // changed (created or adopted): this runs at the start of EVERY sync run, so an
  // unconditional notify would recompute + broadcast on every steady-state tick. The
  // def is adopted (never authored here), so this is always an `updated` notify; the
  // orthogonal `custom-field.created` bust above stays separate.
  if (provisionedFieldKeys.length > 0 || adoptedCount > 0) {
    await notifyEntityDefChanged(organizationId, defId, 'updated')

    logger.info('Provisioned connector target', {
      dataConnectorId,
      entityDefinitionId: defId,
      targetMode: target.targetMode,
      provisioned: provisionedFieldKeys.length,
      adopted: adoptedCount,
    })
  }

  return { entityDefinitionId: defId, provisionedFieldKeys, fieldIdByKey }
}

/**
 * Provision one field if absent. Idempotent per `(appFieldKey, entityDefinitionId)`
 * and additionally guarded against an existing display-name collision (a field the
 * user already owns). Returns the field's concrete id + whether it was created (this
 * call inserted it) or adopted (an existing field got a re-stamp write), or `null`
 * when a name collision left it unresolvable (contributing mode never touches an
 * existing user field).
 */
async function provisionField(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  entityDefinitionId: string,
  field: ProvisionFieldSpec,
  appSlug: string | null,
  existingByKey: Map<string, CustomFieldEntity>
): Promise<{ id: string; created: boolean; adopted: boolean } | null> {
  // Already provisioned on this def? Look up by `appFieldKey` in the org-cache
  // snapshot the caller fetched — matched WITHOUT a dataConnectorId filter so a
  // delete+reconnect ADOPTS the orphaned field (the FK is `set null` on connector
  // delete) instead of colliding on its name and dropping it from the mapping.
  // `appFieldKey` is set only by app/connector provisioning — never on a
  // user-authored column — so adoption is safe. (The cache can't under-report a
  // prior provision: `provisionTarget` fires `custom-field.created` after creating.)
  const existing = existingByKey.get(field.appFieldKey)
  if (existing) {
    // Re-stamp ownership if a prior connector's delete nulled (or never set) the FK,
    // and back-fill `appSlug` on a field provisioned before this column was written
    // (owned identity fields can't mirror into RecordIdentity without it). The cached
    // value may be stale here (the FK-null cascade doesn't invalidate), so the write
    // is idempotent and harmless when already ours.
    const patch: Partial<typeof schema.CustomField.$inferInsert> = {}
    if (existing.dataConnectorId !== dataConnectorId) patch.dataConnectorId = dataConnectorId
    if (appSlug && existing.appSlug !== appSlug) patch.appSlug = appSlug
    if (field.isIdentity && !existing.isIdentity) patch.isIdentity = true
    const adopted = Object.keys(patch).length > 0
    if (adopted) {
      await db
        .update(schema.CustomField)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.CustomField.id, existing.id))
    }
    return { id: existing.id, created: false, adopted }
  }

  // Create via the app-field path, stamping `dataConnectorId` on the insert.
  // DUPLICATE_FIELD_NAME (a user/system field of the same name already exists) is a
  // benign no-op — contributing mode never touches an existing field.
  const result = await createCustomField({
    organizationId,
    entityDefinitionId,
    name: field.name,
    type: field.type,
    icon: field.icon,
    appFieldKey: field.appFieldKey,
    dataConnectorId,
    // App origin — lets the identity sink-mirror resolve RecordIdentity.source for
    // owned external-id fields. Null/undefined for builtin/generic-rest connectors.
    appSlug: appSlug ?? undefined,
    // Owned external-id → identity cell, so reconcile backstops its mirror.
    isIdentity: field.isIdentity ?? false,
    // Predefined enum options / address sub-fields, when the connector declared
    // them. Options are normalized to `SelectOption` (label defaults to value, color
    // is the constrained palette) the same way the app-field provisioner does.
    options: field.options?.length
      ? field.options.map((o) => ({
          value: o.value,
          label: o.label ?? o.value,
          color: o.color as SelectOption['color'],
        }))
      : undefined,
    addressComponents: field.addressComponents,
    isUpdatable: field.isUpdatable ?? false,
    isCreatable: field.isCreatable ?? false,
    isHidden: field.isHidden ?? false,
  })
  if (result.isErr()) {
    if (result.error.code === 'DUPLICATE_FIELD_NAME') return null
    throw new Error(result.error.message)
  }

  return { id: result.value.id, created: true, adopted: false }
}

/**
 * The fields a mapping declares for provisioning — exactly its `provision`-hint
 * entries. A field with no hint carries a concrete `targetFieldRef` to an EXISTING
 * field (reused, never re-created) or a null draft, so it yields no spec. Pure +
 * exported so the create-vs-reuse invariant is unit-testable without a DB.
 */
export function provisionSpecsForMapping(mapping: {
  fieldMappings: FieldMapping[]
}): ProvisionFieldSpec[] {
  const specs: ProvisionFieldSpec[] = []
  for (const fm of mapping.fieldMappings) {
    if (!fm.provision) continue
    // `targetFieldRef` is null until the post-provision write-back. The stable
    // idempotency key is `provision.appFieldKey` when set (owned fields whose key
    // differs from the display name, e.g. `name` vs "Order Name"), else `name`
    // (templates, where the two coincide).
    specs.push({
      appFieldKey: fm.provision.appFieldKey ?? fm.provision.name,
      name: fm.provision.name,
      type: fm.provision.type,
      icon: fm.provision.icon,
      isHidden: fm.provision.isHidden,
      // Owned external-id field → identity cell, so reconcile backstops its mirror.
      isIdentity: fm.identityRole?.kind === 'externalId',
      options: fm.provision.options,
      addressComponents: fm.provision.addressComponents,
      isUpdatable: false,
      isCreatable: false,
    })
  }
  return specs
}

/**
 * Derive a connector's app slug from its `DataConnector.type` (`app:<slug>` →
 * `<slug>`). Null for builtin/generic-rest connectors. Stamped onto every
 * provisioned field's `appSlug` so the identity sink-mirror can resolve a
 * `RecordIdentity.source`. Pure + exported for unit tests.
 */
export function appSlugFromConnectorType(type: string | null | undefined): string | null {
  if (!type) return null
  return type.startsWith('app:') ? type.slice('app:'.length) : null
}

/**
 * True when the raw mapping row carries a `provision` hint whose concrete
 * `targetFieldRef` hasn't been backfilled yet — i.e. the row still needs a
 * provisioning pass. Pure + exported for unit tests; the steady-state sync
 * fast path in `materializeConnectorTargets` keys off it.
 */
export function mappingNeedsProvisioning(
  fieldMappings: Array<{ provision?: unknown; targetFieldRef?: unknown }>
): boolean {
  return fieldMappings.some((fm) => fm.provision && fm.targetFieldRef == null)
}

/**
 * Fill the concrete `ResourceFieldId` on each provisioned field mapping after its
 * field has been created (the generic-rest provision case — app connectors resolve
 * their `@app:` refs live in the sink, no write-back). Resolves the field id from
 * `fieldIdsByDef` (the `fieldIdByKey` maps `provisionTarget` just returned — write-path
 * ids, so no staleness) and only falls back to a single batched DB lookup over the
 * connector's fields for keys not in the map (the standalone e2e-script caller passes
 * no map). The fallback must stay a DB query, NOT
 * `getCachedCustomFields`: it filters on `dataConnectorId`, which the org cache can
 * report stale (the adoption re-stamp write doesn't invalidate). Stamps
 * `fm.targetFieldRef` and persists the mutated `fieldMappings`. Mutates the decoded
 * mappings in place so the current run's sink sees the resolved refs.
 */
export async function backfillProvisionedFieldRefs(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  mappings: DecodedMapping[],
  fieldIdsByDef?: Map<string, Record<string, string>>
): Promise<void> {
  // Resolve every key the write-path map can't cover with ONE query over the
  // connector's fields (instead of a findFirst per field mapping).
  const needsFallback = mappings.some((mapping) =>
    mapping.fieldMappings.some(
      (fm) =>
        fm.provision &&
        fm.targetFieldRef == null &&
        !fieldIdsByDef?.get(mapping.entityDefinitionId)?.[
          fm.provision.appFieldKey ?? fm.provision.name
        ]
    )
  )
  const fallbackIdByDefKey = new Map<string, string>()
  if (needsFallback) {
    const fields = await db.query.CustomField.findMany({
      where: and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.dataConnectorId, dataConnectorId)
      ),
      columns: { id: true, entityDefinitionId: true, appFieldKey: true },
    })
    for (const field of fields) {
      if (field.appFieldKey == null) continue
      fallbackIdByDefKey.set(`${field.entityDefinitionId} ${field.appFieldKey}`, field.id)
    }
  }

  for (const mapping of mappings) {
    let changed = false
    for (const fm of mapping.fieldMappings) {
      if (!fm.provision || fm.targetFieldRef != null) continue
      const appFieldKey = fm.provision.appFieldKey ?? fm.provision.name
      const fieldId =
        fieldIdsByDef?.get(mapping.entityDefinitionId)?.[appFieldKey] ??
        fallbackIdByDefKey.get(`${mapping.entityDefinitionId} ${appFieldKey}`)
      if (!fieldId) continue
      fm.targetFieldRef = toResourceFieldId(mapping.entityDefinitionId, fieldId)
      changed = true
    }
    if (changed) {
      await db
        .update(schema.DataConnectorMapping)
        .set({ fieldMappings: mapping.fieldMappings, updatedAt: new Date() })
        .where(eq(schema.DataConnectorMapping.id, mapping.row.id))
    }
  }
}

/**
 * Provision a connector's declared `provision`-hint fields at finalize/first-sync (the
 * generic-rest template path — e.g. stripe). Driven by the PERSISTED mapping rows, not
 * the live app catalog, so it's catalog-independent. Owned app defs are NOT created here
 * — they're installed via the entity-template flow (v6); an unbound owned row (null def)
 * is simply skipped until its def is installed.
 *
 * Operates on RAW rows so it can run BEFORE `loadConnector`/`decodeMapping` in the sync
 * path (those filter/throw on null-def rows). Materializes ENABLED streams only.
 *
 * Runs at the START of every sync run, so the steady state (every provision hint
 * already backfilled to a concrete ref) is the hot path: it returns right after
 * `listStreams` — no connector/appSlug query, no cache reads, no notify. Only rows
 * with an unresolved provisioned field pay the full provision+backfill pass. (Trade-off:
 * the adoption re-stamp in `provisionField` no longer re-runs every sync — fine, since
 * delete+reconnect creates fresh null-ref rows that still take the full path.)
 *
 * Idempotent: `provisionTarget` provisions fields keyed by `(dataConnectorId, appFieldKey)`
 * and `backfillProvisionedFieldRefs` only fills null refs — so a re-run (finalize then
 * sync) never dupes.
 *
 * Flow: (1) provision each mapping's `provision` columns onto its existing def; (2)
 * backfill the concrete `targetFieldRef`s from the ids step 1 returned.
 *
 * @param connectorType Pass `DataConnector.type` when the caller already holds the row
 *   (both call sites do) to skip the fallback lookup query.
 */
export async function materializeConnectorTargets(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  connectorType?: string | null
): Promise<void> {
  // RAW rows for ENABLED streams. `listStreams` does NOT filter null-def mappings, so
  // unbound owned rows are visible here (unlike `loadConnector`, which drops them) and
  // skipped below.
  const streams = (await listStreams(db, organizationId, dataConnectorId)).filter((s) => s.enabled)

  // ── Steady-state fast path ────────────────────────────────────────────────────
  // Only bound, writing rows with an unresolved provisioned field need work.
  const pendingRows = streams
    .flatMap((s) => s.mappings)
    .filter(
      (r) =>
        r.linkMode !== 'reference' &&
        r.entityDefinitionId != null &&
        mappingNeedsProvisioning(r.fieldMappings)
    )
  if (pendingRows.length === 0) return

  const appSlug =
    connectorType !== undefined
      ? appSlugFromConnectorType(connectorType)
      : appSlugFromConnectorType(
          (
            await db.query.DataConnector.findFirst({
              where: eq(schema.DataConnector.id, dataConnectorId),
              columns: { type: true },
            })
          )?.type
        )

  // ── Provision `provision`-hint fields onto each mapping's existing def ─────────
  const fieldIdsByDef = new Map<string, Record<string, string>>()
  for (const row of pendingRows) {
    // Raw-row `fieldMappings` are the DB mirror shape (plain-string refs); cast to the
    // engine `FieldMapping` — `provisionSpecsForMapping` only reads `.provision`.
    const fields = provisionSpecsForMapping({
      fieldMappings: row.fieldMappings as unknown as FieldMapping[],
    })
    if (fields.length === 0) continue

    const result = await provisionTarget(db, organizationId, dataConnectorId, {
      targetMode: row.targetMode as 'owned' | 'contributing',
      entityDefinitionId: row.entityDefinitionId,
      appSlug,
      fields,
    })
    fieldIdsByDef.set(result.entityDefinitionId, {
      ...fieldIdsByDef.get(result.entityDefinitionId),
      ...result.fieldIdByKey,
    })
  }

  // ── Backfill concrete refs ───────────────────────────────────────────────────
  // Every provisioned column now exists; stamp the pending rows' concrete
  // `targetFieldRef`s from the ids `provisionTarget` just returned (no re-query).
  await backfillProvisionedFieldRefs(
    db,
    organizationId,
    dataConnectorId,
    pendingRows.map((r) => decodeMapping(r)),
    fieldIdsByDef
  )
}
