// packages/lib/src/data-connectors/provisioning.ts
// Schema provisioning for owned + contributing connector mappings (01 §5).
// Reuses the app-field path: connector-managed fields are created through the
// same idempotent `createCustomField` surface app fields use (appInstallationId +
// appFieldKey + capability flags), then stamped with `dataConnectorId` so the
// provisioned schema is attributable + idempotent per (dataConnectorId, appFieldKey).
//
// Owned mode   → provision the full declared def (if absent) + every mapped field.
// Contributing → provision ONLY mapped target fields the def is missing; never a
//                new def, never the dataConnectorId FK on the def, never existing fields.
//
// Functional (Drizzle + neverthrow underneath the service calls); no model classes.

import { type Database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { createCustomField, resolveEntityDefinitionIdByKind } from '@auxx/services/custom-fields'
import { createEntityDefinition } from '@auxx/services/entity-definitions'
import type { RelationshipType, SelectOption } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { and, eq } from 'drizzle-orm'
import { getCachedCustomFields } from '../cache'
import { onCacheEvent } from '../cache/invalidate'
import { notifyEntityDefChanged } from '../entity-definitions/notify'
import { NotFoundError } from '../errors'
import {
  type DataConnectorMappingRow,
  type DecodedMapping,
  decodeMapping,
  listStreams,
} from './service'
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
  /** Predefined select options (SINGLE_SELECT / MULTI_SELECT / TAGS). */
  options?: Array<{ value: string; label?: string; color?: string }>
  /** Sub-field set for an ADDRESS_STRUCT field. */
  addressComponents?: string[]
}

/** One owned/contributing target the connector provisions schema for. */
export interface ProvisionTarget {
  /** Owned → may CREATE the def; Contributing → def must already exist. */
  targetMode: 'owned' | 'contributing'
  /** Existing def id, or the owned-def declaration to create if absent. */
  entityDefinitionId?: string | null
  /** Owned-def declaration (used only when entityDefinitionId is absent + owned). */
  ownedDef?: {
    apiSlug: string
    singular: string
    plural: string
    icon?: string
    color?: string
    /** `appFieldKey` of the field to wire as the def's primary display field. */
    primaryDisplayFieldKey?: string
    /** `appFieldKey` of the field to wire as the def's avatar/display image. */
    avatarFieldKey?: string
  }
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
 * Provision schema for one target of a connector. Idempotent: re-running reconciles
 * additively (keyed by `(dataConnectorId, appFieldKey)`), never overwriting a field
 * a user remapped. Returns the resolved def id + the field keys it created.
 */
export async function provisionTarget(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  target: ProvisionTarget
): Promise<ProvisionResult> {
  let entityDefinitionId = target.entityDefinitionId ?? null
  // A caller-provided def is ADOPTED, not authored — never seize ownership of it.
  // Only a def this call creates (owned-def path below) gets the dataConnectorId FK.
  const creatingOwnedDef = entityDefinitionId == null
  // Did THIS call genuinely author a new def? `true` only on the create branch —
  // an adopted existing def stays `false` so the terminal notify fires `updated`,
  // never a phantom `resource:created`.
  let createdNewDef = false

  // ── 1. Resolve / create the def ──────────────────────────────────────────────
  if (!entityDefinitionId) {
    if (target.targetMode !== 'owned' || !target.ownedDef) {
      throw new NotFoundError(
        'Contributing targets require an existing entityDefinitionId; only owned targets create a def'
      )
    }
    const created = await createEntityDefinition({
      organizationId,
      apiSlug: target.ownedDef.apiSlug,
      singular: target.ownedDef.singular,
      plural: target.ownedDef.plural,
      // Icon is a lowercase lucide iconId (e.g. 'box'), never the PascalCase
      // component name — match what the UI's create path stores.
      icon: target.ownedDef.icon ?? 'box',
      color: target.ownedDef.color ?? 'blue',
      // A connector-owned def is a CUSTOM entity, exactly like one a user creates
      // in the UI: entityType/standardType stay null. Setting 'standard'/'custom'
      // here misclassifies it (e.g. escapes the custom-entity quota, which counts
      // `isNull(entityType)`) and diverges from every user-created entity.
    })
    if (created.isErr()) {
      // SLUG_ALREADY_EXISTS → the user (or a prior run) already owns this slug; adopt it.
      const existing = await db.query.EntityDefinition.findFirst({
        where: and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.apiSlug, target.ownedDef.apiSlug)
        ),
        columns: { id: true },
      })
      if (!existing) throw new Error(created.error.message)
      entityDefinitionId = existing.id
    } else {
      entityDefinitionId = created.value.id
      createdNewDef = true
    }
  }

  const defId = entityDefinitionId
  if (!defId) throw new Error('Failed to resolve entity definition for provisioning')

  // The dataConnectorId FK marks a def the connector AUTHORED — stamped only on the
  // owned def this call just created. Adopting a pre-existing def (a manual owned
  // mapping onto the system `contact` def, or any contributing target) must NOT
  // claim it; owned runtime behavior keys off mapping.targetMode, not this FK.
  if (creatingOwnedDef) {
    await db
      .update(schema.EntityDefinition)
      .set({ dataConnectorId, updatedAt: new Date() })
      .where(eq(schema.EntityDefinition.id, defId))
  }

  // ── 2. Provision each mapped field idempotently ──────────────────────────────
  const provisionedFieldKeys: string[] = []
  const fieldIdByKey: Record<string, string> = {}
  for (const field of target.fields) {
    const result = await provisionField(db, organizationId, dataConnectorId, defId, field)
    if (!result) continue
    fieldIdByKey[field.appFieldKey] = result.id
    if (result.created) provisionedFieldKeys.push(field.appFieldKey)
  }

  if (provisionedFieldKeys.length > 0) {
    await onCacheEvent('custom-field.created', { orgId: organizationId })
  }

  // Wire the declared primary display field once its column exists (the UI sets this
  // for user-created entities; owned defs were landing with null display pointers).
  // The def is fresh with no records, so a direct pointer write is enough — no
  // display-value recalculation needed.
  const primaryDisplayFieldId =
    target.targetMode === 'owned' && target.ownedDef?.primaryDisplayFieldKey
      ? fieldIdByKey[target.ownedDef.primaryDisplayFieldKey]
      : undefined
  if (primaryDisplayFieldId) {
    await db
      .update(schema.EntityDefinition)
      .set({ primaryDisplayFieldId, updatedAt: new Date() })
      .where(eq(schema.EntityDefinition.id, defId))
  }

  // Wire the declared avatar/display-image field — same direct-pointer write as the
  // primary display field above. Rendering the URL field as an image is the field's
  // own `urlDisplay` option (set by the connector's field provision), not forced here.
  const avatarFieldId =
    target.targetMode === 'owned' && target.ownedDef?.avatarFieldKey
      ? fieldIdByKey[target.ownedDef.avatarFieldKey]
      : undefined
  if (avatarFieldId) {
    await db
      .update(schema.EntityDefinition)
      .set({ avatarFieldId, updatedAt: new Date() })
      .where(eq(schema.EntityDefinition.id, defId))
  }

  // Fire ONCE per provision (not per internal pointer write): one cache recompute +
  // one coarse `resource:*` realtime nudge so open clients refetch the resource list.
  // `created` only on a genuine new owned def; adopt + field/pointer-only runs emit
  // `updated`. The orthogonal `custom-field.created` bust above stays separate.
  await notifyEntityDefChanged(organizationId, defId, createdNewDef ? 'created' : 'updated')

  logger.info('Provisioned connector target', {
    dataConnectorId,
    entityDefinitionId: defId,
    targetMode: target.targetMode,
    provisioned: provisionedFieldKeys.length,
  })

  return { entityDefinitionId: defId, provisionedFieldKeys, fieldIdByKey }
}

/** Where a relationship edge points. `undefined` ⇒ an owned child (the mapping's own def). */
export type RelationshipTargetRef = { ownedApiSlug: string } | { entityKind: string }

/** The parent↔child edge a mapping declares for provisioning (mirrors the catalog decl). */
export interface ProvisionRelationshipSpec {
  /** Stable key of the forward edge on the PARENT def (== `relationshipFieldKey`). */
  appFieldKey: string
  /** Display name for the forward edge. */
  name: string
  /** Forward cardinality from PARENT → target. */
  cardinality: RelationshipType
  /** Display name for the auto-created inverse edge on the target def. */
  inverseName: string
}

/**
 * Resolve a relationship edge's target `EntityDefinition.id`. For an owned child the
 * target IS the mapping's own provisioned def (`ownTargetDefId`); a `targetRef` names a
 * cross-stream owned def (by `apiSlug`, resolved from the connector-wide pass-1 map) or
 * a contributing/system def (by `entityKind`). Returns null when the target can't be
 * resolved (e.g. a disabled stream) so the caller skips the edge rather than pointing it
 * at a non-existent def.
 */
export async function resolveRelationshipTargetDefId(
  db: Database,
  organizationId: string,
  targetRef: RelationshipTargetRef | undefined,
  ownTargetDefId: string,
  defIdByApiSlug: Record<string, string>
): Promise<string | null> {
  if (!targetRef) return ownTargetDefId
  if ('ownedApiSlug' in targetRef) return defIdByApiSlug[targetRef.ownedApiSlug] ?? null
  return resolveEntityDefinitionIdByKind({ kind: targetRef.entityKind, organizationId }, db)
}

/**
 * Provision the parent↔child relationship edge (+ auto-created inverse) on the PARENT
 * def. Idempotent per `(dataConnectorId, appFieldKey)` exactly like a scalar field
 * (mirrors {@link provisionField}): looks up an existing forward edge by `appFieldKey` on
 * the parent def, re-stamping ownership if the FK was nulled on a prior delete; creates
 * via `createCustomField({ type: 'RELATIONSHIP' })` otherwise — the relationship-capable
 * service that also auto-wires the inverse (NOT the app-field provisioner that bans
 * relationships). The forward field is the idempotency anchor, so a re-run short-circuits
 * here before re-entering the creator and never duplicates the inverse.
 *
 * `relatedResourceId` is the resolved target def id (see {@link resolveRelationshipTargetDefId});
 * pass a non-null value — a null target must be skipped by the caller.
 */
export async function provisionRelationshipField(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  parentDefId: string,
  relatedResourceId: string,
  spec: ProvisionRelationshipSpec
): Promise<{ id: string; created: boolean } | null> {
  // Idempotent adoption: match by appFieldKey WITHOUT a dataConnectorId filter so a
  // delete+reconnect re-adopts the orphaned edge instead of colliding (see provisionField).
  const existingFields = await getCachedCustomFields(organizationId, parentDefId)
  const existing = existingFields.find((f) => f.appFieldKey === spec.appFieldKey)
  if (existing) {
    if (existing.dataConnectorId !== dataConnectorId) {
      await db
        .update(schema.CustomField)
        .set({ dataConnectorId, updatedAt: new Date() })
        .where(eq(schema.CustomField.id, existing.id))
    }
    return { id: existing.id, created: false }
  }

  const result = await createCustomField({
    organizationId,
    entityDefinitionId: parentDefId,
    name: spec.name,
    type: 'RELATIONSHIP' as FieldType,
    appFieldKey: spec.appFieldKey,
    dataConnectorId,
    // Connector-owned edges are user-read-only, like every other provisioned field.
    isUpdatable: false,
    isCreatable: false,
    relationship: {
      relatedResourceId,
      relationshipType: spec.cardinality,
      inverseName: spec.inverseName,
    },
  })
  if (result.isErr()) {
    // A user/system field already owns the FORWARD name → benign no-op (mirrors provisionField).
    if (result.error.code === 'DUPLICATE_FIELD_NAME') return null
    // Surface the underlying DB cause — `fromDatabase` hides it behind a generic
    // "Database operation ... failed", so without this the connector error reads as an
    // opaque wrapper. The common case is the auto-created INVERSE edge colliding with a
    // field of the same name already on the target def (e.g. an orphaned inverse left by
    // a previously deleted connector → unique violation on CustomField_name_org_model_entity_key).
    const cause = (result.error as { cause?: unknown }).cause
    throw new Error(
      `Failed to provision relationship "${spec.name}" (inverse "${spec.inverseName}"): ${
        cause instanceof Error ? cause.message : result.error.message
      }`,
      cause instanceof Error ? { cause } : undefined
    )
  }

  await onCacheEvent('custom-field.created', { orgId: organizationId })
  return { id: result.value.id, created: true }
}

/**
 * Provision one field if absent. Idempotent per `(appFieldKey, entityDefinitionId)`
 * and additionally guarded against an existing display-name collision (a field the
 * user already owns). Returns the field's concrete id + whether it was created this
 * call, or `null` when a name collision left it unresolvable (contributing mode
 * never touches an existing user field).
 */
async function provisionField(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  entityDefinitionId: string,
  field: ProvisionFieldSpec
): Promise<{ id: string; created: boolean } | null> {
  // Already provisioned on this def? Look up by `appFieldKey` in the org cache —
  // matched WITHOUT a dataConnectorId filter so a delete+reconnect ADOPTS the
  // orphaned field (the FK is `set null` on connector delete) instead of colliding
  // on its name and dropping it from the mapping. `appFieldKey` is set only by
  // app/connector provisioning — never on a user-authored column — so adoption is
  // safe. (The cache can't under-report: createCustomField invalidates on create.)
  const existingFields = await getCachedCustomFields(organizationId, entityDefinitionId)
  const existing = existingFields.find((f) => f.appFieldKey === field.appFieldKey)
  if (existing) {
    // Re-stamp ownership if a prior connector's delete nulled (or never set) the FK.
    // The cached value may be stale here (the FK-null cascade doesn't invalidate),
    // so the write is idempotent and harmless when already ours.
    if (existing.dataConnectorId !== dataConnectorId) {
      await db
        .update(schema.CustomField)
        .set({ dataConnectorId, updatedAt: new Date() })
        .where(eq(schema.CustomField.id, existing.id))
    }
    return { id: existing.id, created: false }
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

  return { id: result.value.id, created: true }
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
      options: fm.provision.options,
      addressComponents: fm.provision.addressComponents,
      isUpdatable: false,
      isCreatable: false,
    })
  }
  return specs
}

/**
 * Provision schema for every owned/contributing mapping of a connector. Derives the
 * field specs from each mapping's `fieldMappings`. `reference` mappings write
 * nothing, so they need no provisioning. A mapping carrying an `entityDefinitionId`
 * provisions onto it directly.
 *
 * Field creation is driven EXCLUSIVELY by the `FieldMapping.provision` hint (set by
 * the template/app installer), which declares the field's name + type. A mapping
 * with no hint carries a concrete `targetFieldRef` to an EXISTING field (or is a null
 * draft) — owned and contributing alike — so provisioning never creates it. (Owned is
 * a per-mapping behavior flag — archive-on-orphan + the owned write handler, keyed off
 * `mapping.targetMode`; it does NOT mean the connector authored the def's schema.)
 */
export async function provisionConnectorMappings(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  mappings: DecodedMapping[]
): Promise<ProvisionResult[]> {
  const results: ProvisionResult[] = []
  for (const mapping of mappings) {
    if (mapping.linkMode === 'reference') continue

    const fields = provisionSpecsForMapping(mapping)
    // Nothing to create AND the def already exists ⇒ nothing to do (no fields to
    // provision, no def to create or stamp). The only no-fields case that must still
    // call through is creating a fresh owned def (entityDefinitionId null).
    if (fields.length === 0 && mapping.entityDefinitionId != null) continue

    const result = await provisionTarget(db, organizationId, dataConnectorId, {
      targetMode: mapping.targetMode,
      entityDefinitionId: mapping.entityDefinitionId,
      fields,
    })
    results.push(result)
  }
  return results
}

/**
 * Fill the concrete `ResourceFieldId` on each provisioned field mapping after its
 * field has been created (the generic-rest provision case — app connectors resolve
 * their `@app:` refs live in the sink, no write-back). Resolves the field by
 * `(dataConnectorId, entityDefinitionId, appFieldKey = provision.name)`, stamps
 * `fm.targetFieldRef`, and persists the mutated `fieldMappings`. Mutates the
 * decoded mappings in place so the current run's sink sees the resolved refs.
 */
export async function backfillProvisionedFieldRefs(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  mappings: DecodedMapping[]
): Promise<void> {
  for (const mapping of mappings) {
    let changed = false
    for (const fm of mapping.fieldMappings) {
      if (!fm.provision || fm.targetFieldRef != null) continue
      const appFieldKey = fm.provision.appFieldKey ?? fm.provision.name
      const field = await db.query.CustomField.findFirst({
        where: and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, mapping.entityDefinitionId),
          eq(schema.CustomField.dataConnectorId, dataConnectorId),
          eq(schema.CustomField.appFieldKey, appFieldKey)
        ),
        columns: { id: true },
      })
      if (!field) continue
      fm.targetFieldRef = toResourceFieldId(mapping.entityDefinitionId, field.id)
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
 * Materialize a connector's LAZY owned targets (05e — connector-target-resources-splice).
 * The home for what the eager `provisionStreamOwnedDefs` + pass-2 edge loop did, but
 * driven by the PERSISTED mapping rows (`targetSpec` + `provision` specs), not the live
 * app catalog — so it's catalog-independent and runs at finalize/first-sync.
 *
 * CRITICAL: operates on RAW rows. A lazy owned mapping has `entityDefinitionId: null`,
 * which `decodeMapping` throws on and `loadConnector` filters out — so this MUST run on
 * the raw `listStreams` rows BEFORE any decode, and BEFORE `loadConnector` in the sync
 * path. Materializes ENABLED streams only.
 *
 * Idempotent: `provisionTarget` adopts a def by `apiSlug` and provisions fields keyed by
 * `(dataConnectorId, appFieldKey)`, `backfillProvisionedFieldRefs` only fills null refs,
 * and `provisionRelationshipField` adopts an existing edge by `appFieldKey` — so a
 * re-run (finalize-then-sync, or an already-materialized eager connector) never dupes.
 *
 * Flow: (1) provision/adopt each owned def + its columns and write the resolved def id
 * back onto the null-def row; (2) backfill the concrete `targetFieldRef`s; (3) provision
 * each declared relationship edge now that every def exists.
 */
export async function materializeConnectorTargets(
  db: Database,
  organizationId: string,
  dataConnectorId: string
): Promise<void> {
  // RAW rows for ENABLED streams. `listStreams` does NOT filter null-def mappings, so
  // lazy owned rows are visible here (unlike `loadConnector`, which drops them).
  const streams = (await listStreams(db, organizationId, dataConnectorId)).filter((s) => s.enabled)
  const mappingRows = streams.flatMap((s) => s.mappings)
  if (mappingRows.length === 0) return

  const defIdByApiSlug: Record<string, string> = {}

  // ── Pass 1 — defs + fields ────────────────────────────────────────────────────
  // Owned (lazy, null def) creates/adopts its def from the persisted `targetSpec`;
  // contributing provisions any declared `provision` fields onto its existing def.
  // `reference` link-only mappings own no columns — they're handled in the edge pass.
  for (const row of mappingRows) {
    if (row.linkMode === 'reference') continue
    const ownedDef = row.targetSpec?.ownedDef
    // Raw-row `fieldMappings` are the DB mirror shape (plain-string refs); cast to the
    // engine `FieldMapping` — `provisionSpecsForMapping` only reads `.provision`.
    const fields = provisionSpecsForMapping({
      fieldMappings: row.fieldMappings as unknown as FieldMapping[],
    })
    // Nothing to create: an already-targeted mapping (contributing, or an
    // already-materialized owned) with no provisionable fields is a no-op.
    if (!ownedDef && (row.entityDefinitionId == null || fields.length === 0)) continue

    const result = await provisionTarget(db, organizationId, dataConnectorId, {
      targetMode: row.targetMode as 'owned' | 'contributing',
      entityDefinitionId: row.entityDefinitionId,
      ownedDef,
      fields,
    })

    // Write the resolved def id back onto a lazily-created owned row (was null), and
    // mutate the in-memory row so the backfill + edge pass see it.
    if (row.entityDefinitionId == null) {
      await db
        .update(schema.DataConnectorMapping)
        .set({ entityDefinitionId: result.entityDefinitionId, updatedAt: new Date() })
        .where(eq(schema.DataConnectorMapping.id, row.id))
      row.entityDefinitionId = result.entityDefinitionId
    }
    if (ownedDef) defIdByApiSlug[ownedDef.apiSlug] = result.entityDefinitionId
  }

  // ── Backfill concrete refs ───────────────────────────────────────────────────
  // Every owned def + column now exists; decode the rows that gained a def and carry
  // unresolved provisioned fields, and stamp their concrete `targetFieldRef`s.
  const decodedForBackfill = mappingRows
    .filter(
      (r) =>
        r.linkMode !== 'reference' &&
        r.entityDefinitionId != null &&
        r.fieldMappings.some((fm) => fm.provision && fm.targetFieldRef == null)
    )
    .map((r) => decodeMapping(r))
  if (decodedForBackfill.length > 0) {
    await backfillProvisionedFieldRefs(db, organizationId, dataConnectorId, decodedForBackfill)
  }

  // ── Pass 2 — relationship edges ──────────────────────────────────────────────
  // The forward edge lives on the PARENT def; resolve the target (cross-stream by
  // apiSlug, owned-child by its own def). A target in a disabled stream resolves null
  // → skip-with-log; enabling that stream + re-sync forms the edge later (idempotent).
  const rowById = new Map<string, DataConnectorMappingRow>(mappingRows.map((r) => [r.id, r]))
  for (const row of mappingRows) {
    const rel = row.targetSpec?.relationship
    if (!rel || !row.parentMappingId) continue
    const parentDefId = rowById.get(row.parentMappingId)?.entityDefinitionId ?? null
    if (!parentDefId) {
      logger.warn('Skipping connector relationship edge — parent def unresolved', {
        dataConnectorId,
        mappingId: row.id,
        fieldKey: rel.fieldKey,
      })
      continue
    }
    const relatedResourceId = await resolveRelationshipTargetDefId(
      db,
      organizationId,
      rel.targetRef,
      row.entityDefinitionId ?? '',
      defIdByApiSlug
    )
    if (!relatedResourceId) {
      logger.warn('Skipping connector relationship edge — target def unresolved', {
        dataConnectorId,
        fieldKey: rel.fieldKey,
        targetRef: rel.targetRef,
      })
      continue
    }
    await provisionRelationshipField(
      db,
      organizationId,
      dataConnectorId,
      parentDefId,
      relatedResourceId,
      {
        appFieldKey: rel.fieldKey,
        name: rel.name,
        cardinality: rel.cardinality,
        inverseName: rel.inverseName ?? rel.name,
      }
    )
  }
}
