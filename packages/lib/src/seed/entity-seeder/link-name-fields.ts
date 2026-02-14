// packages/lib/src/seed/entity-seeder/link-name-fields.ts

import { type Database, schema } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import type { ResourceField } from '../../resources/registry/field-types'
import type { FieldMap } from './types'

const logger = createScopedLogger('entity-seeder:link-name-fields')

/**
 * Link NAME fields to their source fields.
 * NAME fields reference two TEXT fields (firstName, lastName) via sourceFields.
 * This pass resolves those references to actual CustomField IDs.
 */
export async function linkNameFields(db: Database, fieldMap: FieldMap): Promise<void> {
  const now = new Date()

  for (const [fieldKey, fieldRecord] of fieldMap.entries()) {
    const field = fieldRecord._fieldDef as ResourceField

    // Skip non-NAME fields
    if (field.fieldType !== FieldType.NAME) continue
    if (!field.sourceFields || field.sourceFields.length !== 2) continue

    // Extract entityType from fieldKey (format: 'entityType:fieldId')
    const [entityType] = fieldKey.split(':')

    // Resolve sourceFields to actual CustomField IDs
    // sourceFields = ['firstName', 'lastName'] -> lookup 'contact:firstName', 'contact:lastName'
    const [firstNameKey, lastNameKey] = field.sourceFields
    const firstNameFieldKey = `${entityType}:${firstNameKey}`
    const lastNameFieldKey = `${entityType}:${lastNameKey}`

    const firstNameField = fieldMap.get(firstNameFieldKey)
    const lastNameField = fieldMap.get(lastNameFieldKey)

    if (!firstNameField || !lastNameField) {
      logger.warn(`Source fields not found for NAME field: ${fieldKey}`, {
        firstNameKey: firstNameFieldKey,
        lastNameKey: lastNameFieldKey,
        found: { firstName: !!firstNameField, lastName: !!lastNameField },
      })
      continue
    }

    // Update the NAME field's options with resolved IDs
    const currentOptions = fieldRecord.options

    await db
      .update(schema.CustomField)
      .set({
        options: {
          ...currentOptions,
          name: {
            firstNameFieldId: firstNameField.id,
            lastNameFieldId: lastNameField.id,
          },
        },
        updatedAt: now,
      })
      .where(eq(schema.CustomField.id, fieldRecord.id))

    // Update local fieldMap options for downstream use
    fieldRecord.options = {
      ...currentOptions,
      name: {
        firstNameFieldId: firstNameField.id,
        lastNameFieldId: lastNameField.id,
      },
    }

    logger.debug(`Linked NAME field: ${fieldKey}`, {
      firstNameFieldId: firstNameField.id,
      lastNameFieldId: lastNameField.id,
    })
  }
}
