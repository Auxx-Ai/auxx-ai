// packages/lib/src/seed/entity-seeder/link-relationships.ts

import { type Database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { FieldType } from '@auxx/database/enums'
import { toResourceFieldId } from '@auxx/types/field'
import type { EntityDefMap, FieldMap } from './types'
import type { ResourceField } from '../../resources/registry/field-types'
import { SPECIAL_ENTITY_TYPES } from './constants'

const logger = createScopedLogger('entity-seeder:link-relationships')

/**
 * Pass 3: Link Relationship Fields
 * Loop through all relationship fields and resolve inverseResourceFieldId
 * from static field references to actual CustomField IDs.
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
    if (!field.relationship?.inverseResourceFieldId) continue

    // Parse the static inverseResourceFieldId (e.g., 'contact:tickets')
    const staticInverseRef = field.relationship.inverseResourceFieldId as string
    const [inverseEntityType] = staticInverseRef.split(':')

    // Check if this is a special entity relationship (e.g., user)
    if (SPECIAL_ENTITY_TYPES.includes(inverseEntityType as (typeof SPECIAL_ENTITY_TYPES)[number])) {
      logger.debug(`Skipping link for special entity: ${fieldKey} → ${inverseEntityType}`)
      continue
    }

    // Direct lookup - fieldMap is keyed by entityType:field.id
    const inverseFieldRecord = fieldMap.get(staticInverseRef)
    if (!inverseFieldRecord) {
      logger.warn(`Inverse field not found: ${staticInverseRef} for ${fieldKey}`)
      continue
    }

    const inverseEntityDef = entityDefMap.get(inverseEntityType)
    if (!inverseEntityDef) {
      logger.warn(`Entity def not found: ${inverseEntityType}`)
      continue
    }

    // Resolve to actual ResourceFieldId
    const resolvedInverseResourceFieldId = toResourceFieldId(
      inverseEntityDef.id,
      inverseFieldRecord.id
    )

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
