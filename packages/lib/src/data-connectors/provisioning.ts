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
import { createCustomField } from '@auxx/services/custom-fields'
import { createEntityDefinition } from '@auxx/services/entity-definitions'
import { toResourceFieldId } from '@auxx/types/field'
import { and, eq } from 'drizzle-orm'
import { getCachedCustomFields } from '../cache'
import { onCacheEvent } from '../cache/invalidate'
import { NotFoundError } from '../errors'
import type { DecodedMapping } from './service'

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
    }
    await onCacheEvent('entity-def.created', { orgId: organizationId })
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
    await onCacheEvent('entity-def.updated', { orgId: organizationId })
  }

  logger.info('Provisioned connector target', {
    dataConnectorId,
    entityDefinitionId: defId,
    targetMode: target.targetMode,
    provisioned: provisionedFieldKeys.length,
  })

  return { entityDefinitionId: defId, provisionedFieldKeys, fieldIdByKey }
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
export function provisionSpecsForMapping(mapping: DecodedMapping): ProvisionFieldSpec[] {
  const specs: ProvisionFieldSpec[] = []
  for (const fm of mapping.fieldMappings) {
    if (!fm.provision) continue
    // `targetFieldRef` is null until the post-provision write-back; the stable
    // `appFieldKey` is the provision name.
    specs.push({
      appFieldKey: fm.provision.name,
      name: fm.provision.name,
      type: fm.provision.type,
      icon: fm.provision.icon,
      isHidden: fm.provision.isHidden,
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
      const field = await db.query.CustomField.findFirst({
        where: and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, mapping.entityDefinitionId),
          eq(schema.CustomField.dataConnectorId, dataConnectorId),
          eq(schema.CustomField.appFieldKey, fm.provision.name)
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
