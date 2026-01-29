// packages/lib/src/seed/entity-seeder/create-fields.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { EntityDefMap, FieldMap, FieldRecord } from './types'
import type { FieldOptions } from '../../custom-fields'
import { ENTITY_INSTANCE_COLUMNS } from './constants'
import { buildFieldOptions, mapCapabilities, shouldCreateField } from './utils'
import { CONTACT_FIELDS } from '../../resources/registry/resources/contact-fields'
import { TICKET_FIELDS } from '../../resources/registry/resources/ticket-fields'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { INBOX_FIELDS } from '../../resources/registry/resources/inbox-fields'
import { TAG_FIELDS } from '../../resources/registry/resources/tag-fields'
import { THREAD_FIELDS } from '../../resources/registry/resources/thread-fields'
import type { ResourceField } from '../../resources/registry/field-types'

const logger = createScopedLogger('entity-seeder:create-fields')

/**
 * Field registry mapping entity types to their field definitions
 */
const FIELD_REGISTRY: Record<string, Record<string, ResourceField>> = {
  contact: CONTACT_FIELDS,
  ticket: TICKET_FIELDS,
  part: PART_FIELDS,
  inbox: INBOX_FIELDS,
  tag: TAG_FIELDS,
  thread: THREAD_FIELDS,
}

/**
 * Pass 2: Create ALL CustomFields
 * Creates ALL CustomFields including relationships.
 * Relationship fields are created with inverseResourceFieldId=null (linked in Pass 3).
 */
export async function createAllFields(
  db: Database,
  organizationId: string,
  entityDefMap: EntityDefMap
): Promise<FieldMap> {
  const fieldMap: FieldMap = new Map()
  const now = new Date()

  for (const [entityType, fields] of Object.entries(FIELD_REGISTRY)) {
    const entityDef = entityDefMap.get(entityType)
    if (!entityDef) {
      logger.warn(`EntityDefinition not found for ${entityType}, skipping fields`)
      continue
    }

    // Get all fields that should be created as CustomFields
    const fieldsToCreate = Object.values(fields).filter((f) =>
      shouldCreateField(f, ENTITY_INSTANCE_COLUMNS)
    )

    for (const field of fieldsToCreate) {
      // Map capabilities to CustomField columns
      const capabilities = mapCapabilities(field.capabilities)

      const [created] = await db
        .insert(schema.CustomField)
        .values({
          organizationId,
          entityDefinitionId: entityDef.id,
          modelType: entityType,
          name: field.label,
          type: field.fieldType!,
          description: field.description,
          systemAttribute: field.systemAttribute,
          sortOrder: field.systemSortOrder ?? 'a0',
          options: buildFieldOptions(field),
          isCustom: false, // System fields
          updatedAt: now,
          // Capability columns
          ...capabilities,
        })
        .returning()

      if (!created) {
        throw new Error(`Failed to create CustomField for ${entityType}:${field.id}`)
      }

      // Key: entityType:field.id (NOT systemAttribute!)
      // This allows direct lookup via relationship.inverseResourceFieldId
      const key = `${entityType}:${field.id}`
      const fieldRecord: FieldRecord = {
        id: created.id,
        entityDefinitionId: entityDef.id,
        systemAttribute: field.systemAttribute!,
        name: field.label,
        type: field.fieldType!,
        options: created.options as FieldOptions,
        _fieldDef: field,
      }
      fieldMap.set(key, fieldRecord)

      logger.debug(`Created CustomField: ${key}`, {
        id: created.id,
        type: field.fieldType,
      })
    }
  }

  return fieldMap
}
