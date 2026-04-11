// packages/lib/src/seed/entity-seeder/link-display-fields.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { DISPLAY_FIELD_CONFIG } from './constants'
import type { EntityDefMap, FieldMap } from './types'

const logger = createScopedLogger('entity-seeder:link-display-fields')

/**
 * Pass 4: Link Display Fields
 * Update EntityDefinitions with primaryDisplayFieldId, secondaryDisplayFieldId, and avatarFieldId.
 */
export async function linkDisplayFields(
  db: Database,
  entityDefMap: EntityDefMap,
  fieldMap: FieldMap
): Promise<void> {
  const now = new Date()

  for (const [entityType, config] of Object.entries(DISPLAY_FIELD_CONFIG)) {
    const entityDef = entityDefMap.get(entityType)
    if (!entityDef) {
      logger.warn(`EntityDefinition not found for ${entityType}, skipping display field linking`)
      continue
    }

    // fieldMap is keyed by entityType:field.id
    const primaryField = fieldMap.get(`${entityType}:${config.primaryDisplayField}`)
    const secondaryField = fieldMap.get(`${entityType}:${config.secondaryDisplayField}`)
    const avatarField = config.avatarField
      ? fieldMap.get(`${entityType}:${config.avatarField}`)
      : undefined

    const updates: Record<string, string> = {}
    if (primaryField) updates.primaryDisplayFieldId = primaryField.id
    if (secondaryField) updates.secondaryDisplayFieldId = secondaryField.id
    if (avatarField) updates.avatarFieldId = avatarField.id

    if (Object.keys(updates).length > 0) {
      await db
        .update(schema.EntityDefinition)
        .set({ ...updates, updatedAt: now })
        .where(eq(schema.EntityDefinition.id, entityDef.id))

      logger.debug(`Linked display fields for ${entityType}`, updates)
    } else {
      logger.warn(`No display fields found for ${entityType}`, {
        primaryField: config.primaryDisplayField,
        secondaryField: config.secondaryDisplayField,
        avatarField: config.avatarField,
      })
    }
  }
}
