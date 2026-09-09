// packages/lib/src/seed/entity-seeder/link-relationships.ts

import { type Database, schema } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { eq } from 'drizzle-orm'
import type {
  RegistryRelationshipSeedConfig,
  ResourceField,
} from '../../resources/registry/field-types'
import { SPECIAL_ENTITY_TYPES } from './constants'
import type { EntityDefMap, FieldMap, FieldRecord } from './types'

const logger = createScopedLogger('entity-seeder:link-relationships')

/**
 * Pass 3: Link Relationship Fields
 * Loop through all relationship fields and resolve inverseResourceFieldId
 * from static field references to actual CustomField IDs.
 *
 * A field with `relationship.inverseResourceFieldId` names its inverse as
 * `<entityType>:<field id>`, a direct key into the field map. A seed-only pair
 * (the self-relations, which carry `relationshipConfig` alone) names it by
 * `(relatedEntityType, inverseSystemAttribute)` instead; both resolve to the
 * same stored `inverseResourceFieldId`.
 */
export async function linkRelationships(
  db: Database,
  entityDefMap: EntityDefMap,
  fieldMap: FieldMap
): Promise<void> {
  const now = new Date()

  for (const [fieldKey, fieldRecord] of fieldMap.entries()) {
    const field = fieldRecord._fieldDef as ResourceField

    // Skip non-relationship fields
    if (field.fieldType !== FieldType.RELATIONSHIP) continue

    const resolved = field.relationship?.inverseResourceFieldId
      ? resolveStaticInverse(
          fieldKey,
          field.relationship.inverseResourceFieldId,
          entityDefMap,
          fieldMap
        )
      : field.relationshipConfig
        ? resolveSeedOnlyInverse(fieldKey, field.relationshipConfig, entityDefMap, fieldMap)
        : null
    if (!resolved) continue
    const { staticInverseRef, resolvedInverseResourceFieldId } = resolved

    // Update THIS field's inverseResourceFieldId in options
    const currentOptions = fieldRecord.options
    const currentRelationship = currentOptions.relationship

    await db
      .update(schema.CustomField)
      .set({
        options: {
          ...currentOptions,
          relationship: {
            ...currentRelationship,
            inverseResourceFieldId: resolvedInverseResourceFieldId,
          },
        },
        updatedAt: now,
      })
      .where(eq(schema.CustomField.id, fieldRecord.id))

    logger.debug(
      `Linked: ${fieldKey} → ${staticInverseRef} (resolved: ${resolvedInverseResourceFieldId})`
    )
  }
}

interface ResolvedInverse {
  /** The registry-side name of the inverse, for the log line */
  staticInverseRef: string
  resolvedInverseResourceFieldId: ResourceFieldId
}

/** Resolve a `relationship.inverseResourceFieldId` static ref (e.g. 'contact:tickets'). */
function resolveStaticInverse(
  fieldKey: string,
  staticInverseRef: string,
  entityDefMap: EntityDefMap,
  fieldMap: FieldMap
): ResolvedInverse | null {
  const [inverseEntityType] = staticInverseRef.split(':')
  if (!inverseEntityType) return null

  // Check if this is a special entity relationship (e.g., user)
  if (SPECIAL_ENTITY_TYPES.includes(inverseEntityType as (typeof SPECIAL_ENTITY_TYPES)[number])) {
    logger.debug(`Skipping link for special entity: ${fieldKey} → ${inverseEntityType}`)
    return null
  }

  // Direct lookup - fieldMap is keyed by entityType:field.id
  const inverseFieldRecord = fieldMap.get(staticInverseRef)
  if (!inverseFieldRecord) {
    logger.warn(`Inverse field not found: ${staticInverseRef} for ${fieldKey}`)
    return null
  }

  const inverseEntityDef = entityDefMap.get(inverseEntityType)
  if (!inverseEntityDef) {
    logger.warn(`Entity def not found: ${inverseEntityType}`)
    return null
  }

  return {
    staticInverseRef,
    resolvedInverseResourceFieldId: toResourceFieldId(inverseEntityDef.id, inverseFieldRecord.id),
  }
}

/** Resolve a seed-only pair's inverse by `(relatedEntityType, inverseSystemAttribute)`. */
function resolveSeedOnlyInverse(
  fieldKey: string,
  config: RegistryRelationshipSeedConfig,
  entityDefMap: EntityDefMap,
  fieldMap: FieldMap
): ResolvedInverse | null {
  const staticInverseRef = `${config.relatedEntityType}:${config.inverseSystemAttribute}`

  const inverseEntityDef = entityDefMap.get(config.relatedEntityType)
  if (!inverseEntityDef) {
    logger.warn(`Entity def not found: ${config.relatedEntityType}`)
    return null
  }

  let inverseFieldRecord: FieldRecord | undefined
  for (const record of fieldMap.values()) {
    if (
      record.entityDefinitionId === inverseEntityDef.id &&
      record.systemAttribute === config.inverseSystemAttribute
    ) {
      inverseFieldRecord = record
      break
    }
  }
  if (!inverseFieldRecord) {
    logger.warn(`Inverse field not found: ${staticInverseRef} for ${fieldKey}`)
    return null
  }

  return {
    staticInverseRef,
    resolvedInverseResourceFieldId: toResourceFieldId(inverseEntityDef.id, inverseFieldRecord.id),
  }
}
