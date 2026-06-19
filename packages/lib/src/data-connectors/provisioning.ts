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
import { and, eq } from 'drizzle-orm'
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
  ownedDef?: { apiSlug: string; singular: string; plural: string; icon?: string; color?: string }
  fields: ProvisionFieldSpec[]
}

export interface ProvisionResult {
  entityDefinitionId: string
  provisionedFieldKeys: string[]
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
      icon: target.ownedDef.icon ?? 'Box',
      color: target.ownedDef.color ?? 'blue',
      entityType: 'standard',
      standardType: 'custom',
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

  // Owned defs carry the dataConnectorId FK; contributing defs never do (01 §5).
  if (target.targetMode === 'owned') {
    await db
      .update(schema.EntityDefinition)
      .set({ dataConnectorId, updatedAt: new Date() })
      .where(eq(schema.EntityDefinition.id, defId))
  }

  // ── 2. Provision each mapped field idempotently ──────────────────────────────
  const provisionedFieldKeys: string[] = []
  for (const field of target.fields) {
    const created = await provisionField(db, organizationId, dataConnectorId, defId, field)
    if (created) provisionedFieldKeys.push(field.appFieldKey)
  }

  if (provisionedFieldKeys.length > 0) {
    await onCacheEvent('custom-field.created', { orgId: organizationId })
  }

  logger.info('Provisioned connector target', {
    dataConnectorId,
    entityDefinitionId: defId,
    targetMode: target.targetMode,
    provisioned: provisionedFieldKeys.length,
  })

  return { entityDefinitionId: defId, provisionedFieldKeys }
}

/**
 * Provision one field if absent. Idempotent per `(dataConnectorId, appFieldKey,
 * entityDefinitionId)` and additionally guarded against an existing display-name
 * collision (a field the user already owns). Returns true if it created the field.
 */
async function provisionField(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  entityDefinitionId: string,
  field: ProvisionFieldSpec
): Promise<boolean> {
  // Already provisioned by this connector?
  const existing = await db.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.entityDefinitionId, entityDefinitionId),
      eq(schema.CustomField.dataConnectorId, dataConnectorId),
      eq(schema.CustomField.appFieldKey, field.appFieldKey)
    ),
    columns: { id: true },
  })
  if (existing) return false

  // Create via the app-field path. DUPLICATE_FIELD_NAME (a user/system field of the
  // same name already exists) is a benign no-op — contributing mode never touches
  // an existing field.
  const result = await createCustomField({
    organizationId,
    entityDefinitionId,
    name: field.name,
    type: field.type,
    icon: field.icon,
    appFieldKey: field.appFieldKey,
    isUpdatable: field.isUpdatable ?? false,
    isCreatable: field.isCreatable ?? false,
    isHidden: field.isHidden ?? false,
  })
  if (result.isErr()) {
    if (result.error.code === 'DUPLICATE_FIELD_NAME') return false
    throw new Error(result.error.message)
  }

  // Stamp the dataConnectorId FK (the service insert doesn't set it).
  await db
    .update(schema.CustomField)
    .set({ dataConnectorId, updatedAt: new Date() })
    .where(eq(schema.CustomField.id, result.value.id))

  return true
}

/**
 * Provision schema for every owned/contributing mapping of a connector. Derives the
 * field specs from each mapping's `fieldMappings`. `reference` mappings write
 * nothing, so they need no provisioning. A mapping carrying an `entityDefinitionId`
 * provisions onto it directly.
 *
 * Field-type resolution (05d): a `FieldMapping.provision` hint (set by the template
 * installer) declares the field's type/name, so connector-introduced fields land
 * with the right type instead of defaulting to TEXT. Without a hint:
 *   - owned mode   → create the field with the `fieldTypeFor` type (the def is
 *                    fresh; manual owned mappings declare no hint). Backward-compat.
 *   - contributing → SKIP. A no-hint contributing field is one reused from the
 *                    existing def (email/name) — never re-created (the UI only
 *                    allows new fields in owned mode), so provisioning leaves it be.
 */
export async function provisionConnectorMappings(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  mappings: DecodedMapping[],
  fieldTypeFor: (mappingId: string, fieldKey: string) => FieldType = () => 'TEXT' as FieldType
): Promise<ProvisionResult[]> {
  const results: ProvisionResult[] = []
  for (const mapping of mappings) {
    if (mapping.linkMode === 'reference') continue

    const fields: ProvisionFieldSpec[] = []
    for (const fm of mapping.fieldMappings) {
      // Unassigned draft (no target yet) — nothing to provision, skip.
      const key = fm.targetFieldKey
      if (!key) continue
      if (fm.provision) {
        fields.push({
          appFieldKey: key,
          name: fm.provision.name,
          type: fm.provision.type,
          icon: fm.provision.icon,
          isHidden: fm.provision.isHidden,
          isUpdatable: false,
          isCreatable: false,
        })
      } else if (mapping.targetMode === 'owned') {
        fields.push({
          appFieldKey: key,
          name: key,
          type: fieldTypeFor(mapping.row.id, key),
          isUpdatable: false,
          isCreatable: false,
        })
      }
      // contributing + no hint → reused existing field; skip.
    }
    // Contributing needs at least one field to do; owned still creates the def.
    if (fields.length === 0 && mapping.targetMode === 'contributing') continue

    const result = await provisionTarget(db, organizationId, dataConnectorId, {
      targetMode: mapping.targetMode,
      entityDefinitionId: mapping.entityDefinitionId,
      fields,
    })
    results.push(result)
  }
  return results
}
