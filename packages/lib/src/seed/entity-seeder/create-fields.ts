// packages/lib/src/seed/entity-seeder/create-fields.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldOptions } from '../../custom-fields'
import type { ResourceField } from '../../resources/registry/field-types'
import { ARTICLE_FIELDS } from '../../resources/registry/resources/article-fields'
import { CATALOG_GROUP_FIELDS } from '../../resources/registry/resources/catalog-group-fields'
import { CATALOG_ITEM_FIELDS } from '../../resources/registry/resources/catalog-item-fields'
import { COMPANY_FIELDS } from '../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../resources/registry/resources/contact-fields'
import { GL_POSTING_FIELDS } from '../../resources/registry/resources/gl-posting-fields'
import { INBOX_FIELDS } from '../../resources/registry/resources/inbox-fields'
import { INVOICE_FIELDS } from '../../resources/registry/resources/invoice-fields'
import { LINE_ITEM_FIELDS } from '../../resources/registry/resources/line-item-fields'
import { MEETING_FIELDS } from '../../resources/registry/resources/meeting-fields'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { PAYMENT_FIELDS } from '../../resources/registry/resources/payment-fields'
import { PERSONAL_INBOX_FIELDS } from '../../resources/registry/resources/personal-inbox-fields'
import { PRODUCT_FIELDS } from '../../resources/registry/resources/product-fields'
import { QUOTE_FIELDS } from '../../resources/registry/resources/quote-fields'
import { SERVICE_REQUEST_FIELDS } from '../../resources/registry/resources/service-request-fields'
import { SIGNATURE_FIELDS } from '../../resources/registry/resources/signature-fields'
import { STOCK_MOVEMENT_FIELDS } from '../../resources/registry/resources/stock-movement-fields'
import { SUBPART_FIELDS } from '../../resources/registry/resources/subpart-fields'
import { TAG_FIELDS } from '../../resources/registry/resources/tag-fields'
import { THREAD_FIELDS } from '../../resources/registry/resources/thread-fields'
import { TICKET_FIELDS } from '../../resources/registry/resources/ticket-fields'
import { VENDOR_PART_FIELDS } from '../../resources/registry/resources/vendor-part-fields'
import { WORK_ORDER_FIELDS } from '../../resources/registry/resources/work-order-fields'
import { ENTITY_INSTANCE_COLUMNS } from './constants'
import type { EntityDefMap, FieldMap, FieldRecord } from './types'
import { buildFieldOptions, mapCapabilities, shouldCreateField } from './utils'

const logger = createScopedLogger('entity-seeder:create-fields')

/**
 * Field registry mapping entity types to their field definitions.
 *
 * Exported for `seeded-unique-drift.int.test.ts`, which asserts that a freshly seeded
 * org's `CustomField` capability columns match what these registries declare. Restating
 * the map in the test is how the two would come to disagree about which entity types are
 * even seeded.
 */
export const FIELD_REGISTRY: Record<string, Record<string, ResourceField>> = {
  contact: CONTACT_FIELDS,
  ticket: TICKET_FIELDS,
  part: PART_FIELDS,
  inbox: INBOX_FIELDS,
  personal_inbox: PERSONAL_INBOX_FIELDS,
  tag: TAG_FIELDS,
  thread: THREAD_FIELDS,
  signature: SIGNATURE_FIELDS,
  vendor_part: VENDOR_PART_FIELDS,
  subpart: SUBPART_FIELDS,
  stock_movement: STOCK_MOVEMENT_FIELDS,
  company: COMPANY_FIELDS,
  meeting: MEETING_FIELDS,
  article: ARTICLE_FIELDS,
  work_order: WORK_ORDER_FIELDS,
  service_request: SERVICE_REQUEST_FIELDS,
  quote: QUOTE_FIELDS,
  line_item: LINE_ITEM_FIELDS,
  catalog_item: CATALOG_ITEM_FIELDS,
  catalog_group: CATALOG_GROUP_FIELDS,
  invoice: INVOICE_FIELDS,
  payment: PAYMENT_FIELDS,
  product: PRODUCT_FIELDS,
  gl_posting: GL_POSTING_FIELDS,
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
